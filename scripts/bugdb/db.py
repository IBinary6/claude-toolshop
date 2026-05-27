"""BugDB 数据访问层 (DAL)。Schema 初始化 + FTS5 同步 + 版本迁移。"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from . import config, utils
from .exceptions import RecordNotFound, SchemaMigrationError
from .models import BugRecord, ErrorType, Status

# 显式列名常量。顺序与 schema (v1 + v2) 列定义保持一致，避免 SELECT * 隐式依赖列顺序。
_COLUMNS = (
    "id, error_type, error_pattern, error_message, root_cause, solution, "
    "solution_steps, language, project_type, tags, confidence, usage_count, "
    "success_count, status, replaces_id, valid_for, deprecation_note, "
    "created_at, updated_at, consecutive_failures"
)

# 反馈衰减规则常量。集中定义以便测试 import 复用，避免 magic number 散落。
_DECAY_FAILURE_THRESHOLD = 3   # 触发衰减所需的连续失败次数
_DECAY_STEP = 20               # 每次衰减扣减的 confidence
_DECAY_FLOOR = 20              # confidence 衰减下限（同时也是 deprecated 阈值）
_DECAY_SUCCESS_RATE = 0.3      # 成功率低于该值才允许衰减


def _migrate_v0_to_v1(conn: sqlite3.Connection) -> None:
    """初始建表 + FTS5 + 触发器。"""
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS bugs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        error_type       TEXT    NOT NULL CHECK(error_type IN ('compile','link','runtime','type','import','build','config')),
        error_pattern    TEXT    NOT NULL,
        error_message    TEXT    DEFAULT '',
        root_cause       TEXT    NOT NULL,
        solution         TEXT    NOT NULL,
        solution_steps   TEXT    DEFAULT '[]',
        language         TEXT    DEFAULT 'any',
        project_type     TEXT    DEFAULT 'any',
        tags             TEXT    DEFAULT '',
        confidence       INTEGER DEFAULT 100 CHECK(confidence BETWEEN 0 AND 100),
        usage_count      INTEGER DEFAULT 0,
        success_count    INTEGER DEFAULT 0,
        status           TEXT    DEFAULT 'active' CHECK(status IN ('active','deprecated','obsolete','archived')),
        replaces_id      INTEGER REFERENCES bugs(id) ON DELETE SET NULL,
        valid_for        TEXT,
        deprecation_note TEXT,
        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status);
    CREATE INDEX IF NOT EXISTS idx_bugs_language ON bugs(language);
    CREATE INDEX IF NOT EXISTS idx_bugs_error_type ON bugs(error_type);
    CREATE INDEX IF NOT EXISTS idx_bugs_confidence ON bugs(confidence DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS bugs_fts USING fts5(
        error_pattern, error_message, root_cause, solution, tags,
        content=bugs, content_rowid=id,
        tokenize='trigram'
    );

    CREATE TRIGGER IF NOT EXISTS bugs_fts_insert AFTER INSERT ON bugs BEGIN
        INSERT INTO bugs_fts(rowid, error_pattern, error_message, root_cause, solution, tags)
        VALUES (new.id, new.error_pattern, new.error_message, new.root_cause, new.solution, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS bugs_fts_delete AFTER DELETE ON bugs BEGIN
        INSERT INTO bugs_fts(bugs_fts, rowid, error_pattern, error_message, root_cause, solution, tags)
        VALUES ('delete', old.id, old.error_pattern, old.error_message, old.root_cause, old.solution, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS bugs_fts_update AFTER UPDATE ON bugs BEGIN
        INSERT INTO bugs_fts(bugs_fts, rowid, error_pattern, error_message, root_cause, solution, tags)
        VALUES ('delete', old.id, old.error_pattern, old.error_message, old.root_cause, old.solution, old.tags);
        INSERT INTO bugs_fts(rowid, error_pattern, error_message, root_cause, solution, tags)
        VALUES (new.id, new.error_pattern, new.error_message, new.root_cause, new.solution, new.tags);
    END;
    """)


def _migrate_v1_to_v2(conn: sqlite3.Connection) -> None:
    """添加 consecutive_failures 列（用于自动置信度衰减）。"""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(bugs)")]
    if 'consecutive_failures' not in cols:
        conn.execute("ALTER TABLE bugs ADD COLUMN consecutive_failures INTEGER DEFAULT 0")


MIGRATIONS = {
    1: _migrate_v0_to_v1,
    2: _migrate_v1_to_v2,
}


class BugDB:
    """BugDB DAL。通过 ``with self._connection() as conn`` 模式访问 SQLite。"""

    def __init__(self, db_path: Path | str | None = None):
        self._path = config.get_db_path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    @contextmanager
    def _connection(self):
        """打开连接，启用 WAL + 外键，事务自动提交/回滚。"""
        conn = sqlite3.connect(str(self._path))
        # WAL 与 foreign_keys 都必须在任何事务开启之前设置：
        # - journal_mode=WAL 是数据库级持久设置，但若已在事务内则会被忽略；
        # - foreign_keys 是连接级开关，不跨连接持久化，因此每次新建连接都要重新打开。
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _ensure_schema(self) -> None:
        """按 MIGRATIONS 顺序补齐到最新版本。"""
        with self._connection() as conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL,
                applied_at TEXT NOT NULL
            )
            """)
            row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
            current = row[0] if row and row[0] is not None else 0
            target = max(MIGRATIONS.keys())
            failed_version = current
            try:
                for v in range(current + 1, target + 1):
                    failed_version = v
                    MIGRATIONS[v](conn)
                    conn.execute(
                        "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
                        (v, utils.now_iso()),
                    )
            except sqlite3.Error as e:
                raise SchemaMigrationError(f"migration to v{failed_version} failed: {e}") from e

    # --- 序列化辅助 ---
    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> BugRecord:
        """sqlite3.Row -> BugRecord。

        Example::

            row = conn.execute("SELECT * FROM bugs WHERE id=1").fetchone()
            rec = BugDB._row_to_record(row)
        """
        steps_raw = row['solution_steps'] or '[]'
        steps = utils.safe_json_loads(steps_raw) or []
        tags = utils.comma_split(row['tags'] or '')
        cf = row['consecutive_failures'] or 0
        return BugRecord(
            id=row['id'],
            error_type=ErrorType(row['error_type']),
            error_pattern=row['error_pattern'],
            error_message=row['error_message'] or '',
            root_cause=row['root_cause'],
            solution=row['solution'],
            solution_steps=steps,
            language=row['language'] or 'any',
            project_type=row['project_type'] or 'any',
            tags=tags,
            confidence=row['confidence'],
            usage_count=row['usage_count'],
            success_count=row['success_count'],
            status=Status(row['status']),
            replaces_id=row['replaces_id'],
            valid_for=row['valid_for'],
            deprecation_note=row['deprecation_note'],
            consecutive_failures=cf,
            created_at=row['created_at'],
            updated_at=row['updated_at'],
        )

    # --- CRUD ---
    def add(self, record: BugRecord) -> BugRecord:
        """插入一条记录。原地补全 id 与时间戳并返回该对象（注意：会修改入参）。

        Example::

            rec = BugRecord(error_type=ErrorType.LINK, error_pattern="LNK2001",
                            root_cause="missing lib", solution="link ws2_32.lib")
            saved = db.add(rec)
            assert saved.id is not None
        """
        now = utils.now_iso()
        record.created_at = record.created_at or now
        record.updated_at = now
        with self._connection() as conn:
            cur = conn.execute(
                """INSERT INTO bugs(
                    error_type, error_pattern, error_message, root_cause, solution,
                    solution_steps, language, project_type, tags,
                    confidence, usage_count, success_count, status,
                    replaces_id, valid_for, deprecation_note,
                    consecutive_failures, created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    # BugRecord 是普通 dataclass，不强制 Enum；调用方可能直接传字符串。
                    record.error_type.value if isinstance(record.error_type, ErrorType) else record.error_type,
                    record.error_pattern,
                    record.error_message,
                    record.root_cause,
                    record.solution,
                    utils.to_json_array(record.solution_steps),
                    record.language,
                    record.project_type,
                    utils.comma_join(record.tags),
                    record.confidence,
                    record.usage_count,
                    record.success_count,
                    record.status.value if isinstance(record.status, Status) else record.status,
                    record.replaces_id,
                    record.valid_for,
                    record.deprecation_note,
                    record.consecutive_failures,
                    record.created_at,
                    record.updated_at,
                ),
            )
            record.id = cur.lastrowid
        return record

    def get(self, bug_id: int) -> BugRecord:
        """按 ID 查询，缺失抛 RecordNotFound。

        Example::

            rec = db.get(1)
            print(rec.error_pattern)
        """
        with self._connection() as conn:
            row = conn.execute(f"SELECT {_COLUMNS} FROM bugs WHERE id=?", (bug_id,)).fetchone()
        if row is None:
            raise RecordNotFound(f"bug id={bug_id} not found")
        return self._row_to_record(row)

    def update(self, record: BugRecord) -> BugRecord:
        """整条更新（整行覆盖语义）。会刷新 updated_at。

        调用方应先 ``get()`` 拿到完整记录，再修改字段后 ``update()``。
        期间若有其他进程/线程修改了同一行，本次 update 会用入参中的字段值
        完整覆盖整行，外部并发修改会被静默丢弃。

        Example::

            rec = db.get(1)
            rec.solution = "new"
            db.update(rec)
        """
        if record.id is None:
            raise RecordNotFound("cannot update record without id")
        record.updated_at = utils.now_iso()
        with self._connection() as conn:
            cur = conn.execute(
                """UPDATE bugs SET
                    error_type=?, error_pattern=?, error_message=?, root_cause=?, solution=?,
                    solution_steps=?, language=?, project_type=?, tags=?,
                    confidence=?, usage_count=?, success_count=?, status=?,
                    replaces_id=?, valid_for=?, deprecation_note=?,
                    consecutive_failures=?, updated_at=?
                WHERE id=?""",
                (
                    record.error_type.value if isinstance(record.error_type, ErrorType) else record.error_type,
                    record.error_pattern,
                    record.error_message,
                    record.root_cause,
                    record.solution,
                    utils.to_json_array(record.solution_steps),
                    record.language,
                    record.project_type,
                    utils.comma_join(record.tags),
                    record.confidence,
                    record.usage_count,
                    record.success_count,
                    record.status.value if isinstance(record.status, Status) else record.status,
                    record.replaces_id,
                    record.valid_for,
                    record.deprecation_note,
                    record.consecutive_failures,
                    record.updated_at,
                    record.id,
                ),
            )
            if cur.rowcount == 0:
                raise RecordNotFound(f"bug id={record.id} not found")
        return record

    def delete(self, bug_id: int, hard: bool = False) -> None:
        """删除。默认软删（status=archived），hard=True 物理删除。

        Example::

            db.delete(1)             # 软删 -> archived
            db.delete(1, hard=True)  # 物理 DELETE
        """
        if hard:
            with self._connection() as conn:
                cur = conn.execute("DELETE FROM bugs WHERE id=?", (bug_id,))
                if cur.rowcount == 0:
                    raise RecordNotFound(f"bug id={bug_id} not found")
            return
        record = self.get(bug_id)
        record.status = Status.ARCHIVED
        self.update(record)

    def restore(self, bug_id: int) -> BugRecord:
        """从 archived 恢复为 active，并清零 consecutive_failures。

        Example::

            db.delete(1)
            db.restore(1)  # 状态回到 active
        """
        record = self.get(bug_id)
        record.status = Status.ACTIVE
        record.consecutive_failures = 0
        return self.update(record)

    # --- 反馈与自动衰减 ---
    def feedback(self, bug_id: int, success: bool) -> BugRecord:
        """记录一次使用反馈，触发置信度衰减规则。

        规则（常量见模块顶部 ``_DECAY_*``）：
        - 失败：``usage_count+1``, ``consecutive_failures+1``
        - 成功：``usage_count+1``, ``success_count+1``, ``consecutive_failures=0``
        - 衰减触发：``consecutive_failures >= _DECAY_FAILURE_THRESHOLD`` 且
          ``success_count/usage_count < _DECAY_SUCCESS_RATE``
          → ``confidence = max(confidence - _DECAY_STEP, _DECAY_FLOOR)``，
          ``consecutive_failures=0``
        - 衰减后 ``confidence <= _DECAY_FLOOR`` → ``status=deprecated``，
          ``deprecation_note='auto: low confidence'``

        SELECT 与 UPDATE 在同一 ``_connection()`` 事务内执行，避免并发
        read-modify-write 丢失更新；id 不存在抛 ``RecordNotFound``。

        Example::

            rec = db.feedback(1, success=False)
            assert rec.consecutive_failures >= 1
        """
        with self._connection() as conn:
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM bugs WHERE id=?", (bug_id,)
            ).fetchone()
            if row is None:
                raise RecordNotFound(f"bug id={bug_id} not found")
            bug = self._row_to_record(row)

            bug.usage_count += 1
            if success:
                bug.success_count += 1
                bug.consecutive_failures = 0
            else:
                bug.consecutive_failures += 1
                # 失败分支必然已经 usage_count+=1，分母不可能为 0。
                rate = bug.success_count / bug.usage_count
                if (bug.consecutive_failures >= _DECAY_FAILURE_THRESHOLD
                        and rate < _DECAY_SUCCESS_RATE):
                    bug.confidence = max(bug.confidence - _DECAY_STEP, _DECAY_FLOOR)
                    bug.consecutive_failures = 0
                    if bug.confidence <= _DECAY_FLOOR:
                        bug.status = Status.DEPRECATED
                        bug.deprecation_note = 'auto: low confidence'

            bug.updated_at = utils.now_iso()
            conn.execute(
                """UPDATE bugs SET
                    usage_count=?, success_count=?, consecutive_failures=?,
                    confidence=?, status=?, deprecation_note=?, updated_at=?
                WHERE id=?""",
                (
                    bug.usage_count,
                    bug.success_count,
                    bug.consecutive_failures,
                    bug.confidence,
                    bug.status.value if isinstance(bug.status, Status) else bug.status,
                    bug.deprecation_note,
                    bug.updated_at,
                    bug.id,
                ),
            )
        return bug

    def list_all(self, status: str | None = None, language: str | None = None) -> list[BugRecord]:
        """列出记录，可按 status/language 过滤。

        - status='all' 等同不过滤；language 过滤时同时匹配 'any'。
        - 排序：confidence DESC, id DESC。

        Example::

            actives = db.list_all(status='active', language='c++')
        """
        sql = f"SELECT {_COLUMNS} FROM bugs WHERE 1=1"
        params: list = []
        if status and status != 'all':
            sql += " AND status=?"
            params.append(status)
        if language:
            sql += " AND (language=? OR language='any')"
            params.append(language)
        sql += " ORDER BY confidence DESC, id DESC"
        with self._connection() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._row_to_record(r) for r in rows]

    # --- FTS5 搜索 ---
    @staticmethod
    def _build_match_expr(safe_query: str, columns: list) -> str:
        """把用户查询安全地转换为 FTS5 MATCH 表达式。

        每个 term 用双引号包成 phrase，term 中已有的 ``"`` 转义为 ``""``，
        避免 ``:`` / ``-`` / ``*`` / ``(`` / ``)`` 等触发 FTS5 语法错误。
        """
        terms = [t for t in safe_query.split() if t.strip()]
        if not terms:
            return ""
        quoted = " OR ".join(f'"{t.replace(chr(34), chr(34) * 2)}"' for t in terms)
        return " OR ".join(f"{col}:({quoted})" for col in columns)

    def _fts_query(self, columns: list, query: str, statuses: list | None,
                   language: str | None, limit: int) -> list:
        """构造并执行 FTS5 MATCH 查询。

        - columns 由调用方传入，且仅用于构造 MATCH 表达式的列名前缀
          （白名单语义，禁止接受用户输入）。
        - 其余参数全部走绑定占位符防注入。
        - MATCH 表达式构造失败由调用方 ``fts_search`` 兜底走 LIKE。

        Example::

            db._fts_query(['error_pattern'], 'LNK2001', ['active'], 'c++', 20)
        """
        col_expr = self._build_match_expr(query, columns)
        # 显式投影到 bugs.<col> 以匹配 _row_to_record 期望的列顺序。
        projection = ', '.join(f"bugs.{c.strip()}" for c in _COLUMNS.split(','))
        sql = (
            f"SELECT {projection} FROM bugs_fts "
            "JOIN bugs ON bugs.id = bugs_fts.rowid "
            "WHERE bugs_fts MATCH ?"
        )
        params: list = [col_expr]
        if statuses:
            placeholders = ','.join('?' * len(statuses))
            sql += f" AND bugs.status IN ({placeholders})"
            params.extend(statuses)
        if language:
            sql += " AND (bugs.language=? OR bugs.language='any')"
            params.append(language)
        sql += " ORDER BY bugs.confidence DESC, bugs.success_count DESC LIMIT ?"
        params.append(limit)
        with self._connection() as conn:
            return conn.execute(sql, params).fetchall()

    def _like_fallback(self, columns: list, query: str, statuses: list | None,
                       language: str | None, limit: int) -> list:
        """FTS5 不可用时的兜底 LIKE 查询。

        将 query 按空白拆词，每个词对每列做 LIKE OR；全部参数化绑定。
        term 中的 ``\\`` / ``%`` / ``_`` 会被转义，并通过 ``ESCAPE '\\'`` 字面匹配，
        避免用户搜 ``100%`` / ``foo_bar`` 时被通配符吞掉。

        Example::

            db._like_fallback(['error_pattern'], 'LNK2001', None, None, 20)
        """
        like_terms = [t for t in query.split() if t]
        if not like_terms:
            return []
        where_or = ' OR '.join(f"{c} LIKE ? ESCAPE '\\'" for c in columns for _ in like_terms)
        params: list = []
        for c in columns:
            for t in like_terms:
                escaped = t.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
                params.append(f"%{escaped}%")
        sql = f"SELECT {_COLUMNS} FROM bugs WHERE ({where_or})"
        if statuses:
            placeholders = ','.join('?' * len(statuses))
            sql += f" AND status IN ({placeholders})"
            params.extend(statuses)
        if language:
            sql += " AND (language=? OR language='any')"
            params.append(language)
        sql += " ORDER BY confidence DESC, success_count DESC LIMIT ?"
        params.append(limit)
        with self._connection() as conn:
            return conn.execute(sql, params).fetchall()

    def fts_search(self, columns: list, query: str,
                   statuses: list | None = None,
                   language: str | None = None,
                   limit: int = 20) -> list:
        """两层兜底搜索：先 FTS5 MATCH，失败回退 LIKE。

        - columns：白名单列（如 ``['error_pattern','error_message','root_cause']``）。
        - query：用户查询字符串，会先 strip 并把双引号替换为空格（防注入 FTS 表达式）。
        - statuses：状态过滤；None=不过滤；典型 ``['active']`` 或 ``['active','deprecated']``。
        - language：精确语言；同时匹配 'any'。

        Example::

            db.fts_search(['error_pattern'], 'LNK2001',
                          statuses=['active'], language='c++')
        """
        if not query or not query.strip():
            return []
        safe_query = query.replace('"', ' ').strip()
        # trigram tokenize 要求 ≥ 3 字符，短查询 MATCH 不报错但返回空，前置走 LIKE。
        if len(safe_query.replace(' ', '')) < 3:
            rows = self._like_fallback(columns, safe_query, statuses, language, limit)
            return [self._row_to_record(r) for r in rows]
        try:
            rows = self._fts_query(columns, safe_query, statuses, language, limit)
        except Exception:
            rows = self._like_fallback(columns, safe_query, statuses, language, limit)
        return [self._row_to_record(r) for r in rows]
