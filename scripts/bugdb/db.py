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
