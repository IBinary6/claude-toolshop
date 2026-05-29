"""BugDB 数据访问层 (DAL)。Schema 初始化 + FTS5 同步 + 版本迁移。"""
import sqlite3
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

from . import paths, utils
from .exceptions import RecordNotFound, SchemaMigrationError
from .models import Category, EntryKind, KnowledgeRecord, Status

_COLUMNS = (
    "id, entry_kind, category, key_pattern, context, cause, content, "
    "action_steps, title, language, project_type, tags, confidence, usage_count, "
    "success_count, status, replaced_by_id, valid_for, deprecation_note, "
    "created_at, updated_at, consecutive_failures"
)

_DECAY_FAILURE_THRESHOLD = 3
_DECAY_STEP = 20
_DECAY_FLOOR = 20
_DECAY_SUCCESS_RATE = 0.3


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
    """添加 consecutive_failures 列。"""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(bugs)")]
    if 'consecutive_failures' not in cols:
        conn.execute("ALTER TABLE bugs ADD COLUMN consecutive_failures INTEGER DEFAULT 0")


def _migrate_v2_to_v3(conn: sqlite3.Connection) -> None:
    """bugs 表重命名为 knowledge，字段重命名，FTS5 重建。

    不使用 executescript()，避免其隐式 COMMIT 与 FTS5 虚拟表交互问题。
    """
    conn.execute("""
    CREATE TABLE knowledge (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_kind       TEXT    NOT NULL DEFAULT 'bug',
        category         TEXT    NOT NULL,
        key_pattern      TEXT    NOT NULL,
        context          TEXT    DEFAULT '',
        cause            TEXT    NOT NULL,
        content          TEXT    NOT NULL,
        action_steps     TEXT    DEFAULT '[]',
        title            TEXT    DEFAULT '',
        language         TEXT    DEFAULT 'any',
        project_type     TEXT    DEFAULT 'any',
        tags             TEXT    DEFAULT '',
        confidence       INTEGER DEFAULT 100 CHECK(confidence BETWEEN 0 AND 100),
        usage_count      INTEGER DEFAULT 0,
        success_count    INTEGER DEFAULT 0,
        status           TEXT    DEFAULT 'active'
                         CHECK(status IN ('active','deprecated','obsolete','archived')),
        replaced_by_id   INTEGER REFERENCES knowledge(id) ON DELETE SET NULL,
        valid_for        TEXT,
        deprecation_note TEXT,
        consecutive_failures INTEGER DEFAULT 0,
        created_at       TEXT    NOT NULL,
        updated_at       TEXT    NOT NULL
    )
    """)
    conn.execute("""
    INSERT INTO knowledge(
        id, entry_kind, category, key_pattern, context, cause, content,
        action_steps, title, language, project_type, tags, confidence, usage_count,
        success_count, status, replaced_by_id, valid_for, deprecation_note,
        consecutive_failures, created_at, updated_at
    )
    SELECT
        id, 'bug', error_type, error_pattern, error_message, root_cause, solution,
        solution_steps, '', language, project_type, tags, confidence, usage_count,
        success_count, status, replaces_id, valid_for, deprecation_note,
        consecutive_failures, created_at, updated_at
    FROM bugs
    """)
    conn.execute("DROP TRIGGER IF EXISTS bugs_fts_insert")
    conn.execute("DROP TRIGGER IF EXISTS bugs_fts_delete")
    conn.execute("DROP TRIGGER IF EXISTS bugs_fts_update")
    conn.execute("DROP TABLE IF EXISTS bugs_fts")
    conn.execute("DROP TABLE IF EXISTS bugs")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_knowledge_language ON knowledge(language)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_knowledge_confidence ON knowledge(confidence DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_knowledge_entry_kind ON knowledge(entry_kind)")
    conn.execute("""
    CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        key_pattern, context, cause, content, tags,
        content=knowledge, content_rowid=id,
        tokenize='trigram'
    )
    """)
    conn.execute("""
    INSERT INTO knowledge_fts(rowid, key_pattern, context, cause, content, tags)
    SELECT id, key_pattern, context, cause, content, tags FROM knowledge
    """)
    conn.execute("""
    CREATE TRIGGER knowledge_fts_insert AFTER INSERT ON knowledge BEGIN
        INSERT INTO knowledge_fts(rowid, key_pattern, context, cause, content, tags)
        VALUES (new.id, new.key_pattern, new.context, new.cause, new.content, new.tags);
    END
    """)
    conn.execute("""
    CREATE TRIGGER knowledge_fts_delete AFTER DELETE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, key_pattern, context, cause, content, tags)
        VALUES ('delete', old.id, old.key_pattern, old.context, old.cause, old.content, old.tags);
    END
    """)
    conn.execute("""
    CREATE TRIGGER knowledge_fts_update AFTER UPDATE ON knowledge BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, key_pattern, context, cause, content, tags)
        VALUES ('delete', old.id, old.key_pattern, old.context, old.cause, old.content, old.tags);
        INSERT INTO knowledge_fts(rowid, key_pattern, context, cause, content, tags)
        VALUES (new.id, new.key_pattern, new.context, new.cause, new.content, new.tags);
    END
    """)


MIGRATIONS = {
    1: _migrate_v0_to_v1,
    2: _migrate_v1_to_v2,
    3: _migrate_v2_to_v3,
}


class BugDB:
    """BugDB DAL。通过 ``with self._connection() as conn`` 模式访问 SQLite。"""

    def __init__(self, db_path: Path | str | None = None):
        self._path = paths.get_db_path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    @contextmanager
    def _connection(self):
        """打开连接，启用 WAL + 外键，事务自动提交/回滚。"""
        conn = sqlite3.connect(str(self._path))
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

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> KnowledgeRecord:
        """sqlite3.Row -> KnowledgeRecord。"""
        steps_raw = row['action_steps'] or '[]'
        steps = utils.safe_json_loads(steps_raw) or []
        tags = utils.comma_split(row['tags'] or '')
        cf = row['consecutive_failures'] or 0
        return KnowledgeRecord(
            id=row['id'],
            entry_kind=EntryKind(row['entry_kind']),
            category=Category(row['category']),
            key_pattern=row['key_pattern'],
            context=row['context'] or '',
            cause=row['cause'],
            content=row['content'],
            action_steps=steps,
            title=row['title'] or '',
            language=row['language'] or 'any',
            project_type=row['project_type'] or 'any',
            tags=tags,
            confidence=row['confidence'],
            usage_count=row['usage_count'],
            success_count=row['success_count'],
            status=Status(row['status']),
            replaced_by_id=row['replaced_by_id'],
            valid_for=row['valid_for'],
            deprecation_note=row['deprecation_note'],
            consecutive_failures=cf,
            created_at=row['created_at'],
            updated_at=row['updated_at'],
        )

    def add(self, record: KnowledgeRecord) -> KnowledgeRecord:
        """插入一条记录，返回含 id 与时间戳的新对象（不修改入参）。"""
        now = utils.now_iso()
        created = record.created_at or now
        with self._connection() as conn:
            cur = conn.execute(
                """INSERT INTO knowledge(
                    entry_kind, category, key_pattern, context, cause, content,
                    action_steps, title, language, project_type, tags,
                    confidence, usage_count, success_count, status,
                    replaced_by_id, valid_for, deprecation_note,
                    consecutive_failures, created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    record.entry_kind.value if isinstance(record.entry_kind, EntryKind) else record.entry_kind,
                    record.category.value if isinstance(record.category, Category) else record.category,
                    record.key_pattern,
                    record.context,
                    record.cause,
                    record.content,
                    utils.to_json_array(record.action_steps),
                    record.title,
                    record.language,
                    record.project_type,
                    utils.comma_join(record.tags),
                    record.confidence,
                    record.usage_count,
                    record.success_count,
                    record.status.value if isinstance(record.status, Status) else record.status,
                    record.replaced_by_id,
                    record.valid_for,
                    record.deprecation_note,
                    record.consecutive_failures,
                    created,
                    now,
                ),
            )
            new_id = cur.lastrowid
        return replace(record, id=new_id, created_at=created, updated_at=now)

    def get(self, record_id: int) -> KnowledgeRecord:
        """按 ID 查询，缺失抛 RecordNotFound。"""
        with self._connection() as conn:
            row = conn.execute(f"SELECT {_COLUMNS} FROM knowledge WHERE id=?", (record_id,)).fetchone()
        if row is None:
            raise RecordNotFound(f"record id={record_id} not found")
        return self._row_to_record(row)

    def update(self, record: KnowledgeRecord) -> KnowledgeRecord:
        """整条更新（整行覆盖语义）。会刷新 updated_at。"""
        if record.id is None:
            raise RecordNotFound("cannot update record without id")
        record.updated_at = utils.now_iso()
        with self._connection() as conn:
            cur = conn.execute(
                """UPDATE knowledge SET
                    entry_kind=?, category=?, key_pattern=?, context=?, cause=?, content=?,
                    action_steps=?, title=?, language=?, project_type=?, tags=?,
                    confidence=?, usage_count=?, success_count=?, status=?,
                    replaced_by_id=?, valid_for=?, deprecation_note=?,
                    consecutive_failures=?, updated_at=?
                WHERE id=?""",
                (
                    record.entry_kind.value if isinstance(record.entry_kind, EntryKind) else record.entry_kind,
                    record.category.value if isinstance(record.category, Category) else record.category,
                    record.key_pattern,
                    record.context,
                    record.cause,
                    record.content,
                    utils.to_json_array(record.action_steps),
                    record.title,
                    record.language,
                    record.project_type,
                    utils.comma_join(record.tags),
                    record.confidence,
                    record.usage_count,
                    record.success_count,
                    record.status.value if isinstance(record.status, Status) else record.status,
                    record.replaced_by_id,
                    record.valid_for,
                    record.deprecation_note,
                    record.consecutive_failures,
                    record.updated_at,
                    record.id,
                ),
            )
            if cur.rowcount == 0:
                raise RecordNotFound(f"record id={record.id} not found")
        return record

    def delete(self, record_id: int, hard: bool = False) -> None:
        """删除。默认软删（status=archived），hard=True 物理删除。"""
        if hard:
            with self._connection() as conn:
                cur = conn.execute("DELETE FROM knowledge WHERE id=?", (record_id,))
                if cur.rowcount == 0:
                    raise RecordNotFound(f"record id={record_id} not found")
            return
        record = self.get(record_id)
        record.status = Status.ARCHIVED
        self.update(record)

    def restore(self, record_id: int) -> KnowledgeRecord:
        """从 archived 恢复为 active，并清零 consecutive_failures。"""
        record = self.get(record_id)
        record.status = Status.ACTIVE
        record.consecutive_failures = 0
        return self.update(record)

    def feedback(self, record_id: int, success: bool) -> KnowledgeRecord:
        """记录一次使用反馈，触发置信度衰减规则。"""
        with self._connection() as conn:
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM knowledge WHERE id=?", (record_id,)
            ).fetchone()
            if row is None:
                raise RecordNotFound(f"record id={record_id} not found")
            rec = self._row_to_record(row)

            rec.usage_count += 1
            if success:
                rec.success_count += 1
                rec.consecutive_failures = 0
            else:
                rec.consecutive_failures += 1
                rate = rec.success_count / rec.usage_count
                if (rec.consecutive_failures >= _DECAY_FAILURE_THRESHOLD
                        and rate < _DECAY_SUCCESS_RATE):
                    rec.confidence = max(rec.confidence - _DECAY_STEP, _DECAY_FLOOR)
                    rec.consecutive_failures = 0
                    if rec.confidence <= _DECAY_FLOOR:
                        rec.status = Status.DEPRECATED
                        rec.deprecation_note = 'auto: low confidence'

            rec.updated_at = utils.now_iso()
            conn.execute(
                """UPDATE knowledge SET
                    usage_count=?, success_count=?, consecutive_failures=?,
                    confidence=?, status=?, deprecation_note=?, updated_at=?
                WHERE id=?""",
                (
                    rec.usage_count,
                    rec.success_count,
                    rec.consecutive_failures,
                    rec.confidence,
                    rec.status.value if isinstance(rec.status, Status) else rec.status,
                    rec.deprecation_note,
                    rec.updated_at,
                    rec.id,
                ),
            )
        return rec

    def list_all(self, status: str | None = None, language: str | None = None) -> list[KnowledgeRecord]:
        """列出记录，可按 status/language 过滤。"""
        sql = f"SELECT {_COLUMNS} FROM knowledge WHERE 1=1"
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

    def stats(self) -> dict:
        """聚合知识表统计信息。"""
        with self._connection() as conn:
            total = conn.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0]
            by_status = dict(conn.execute(
                "SELECT status, COUNT(*) FROM knowledge GROUP BY status"
            ).fetchall())
            by_language = dict(conn.execute(
                "SELECT language, COUNT(*) FROM knowledge GROUP BY language"
            ).fetchall())
            by_category = dict(conn.execute(
                "SELECT category, COUNT(*) FROM knowledge GROUP BY category"
            ).fetchall())
            by_entry_kind = dict(conn.execute(
                "SELECT entry_kind, COUNT(*) FROM knowledge GROUP BY entry_kind"
            ).fetchall())
        return {
            'total': total,
            'by_status': by_status,
            'by_language': by_language,
            'by_category': by_category,
            'by_entry_kind': by_entry_kind,
            'db_path': str(self._path),
        }

    @staticmethod
    def _build_match_expr(safe_query: str, columns: list) -> str:
        """把用户查询安全地转换为 FTS5 MATCH 表达式。"""
        terms = [t for t in safe_query.split() if t.strip()]
        if not terms:
            return ""
        quoted = " OR ".join(f'"{t.replace(chr(34), chr(34) * 2)}"' for t in terms)
        return " OR ".join(f"{col}:({quoted})" for col in columns)

    def _fts_query(self, columns: list, query: str, statuses: list | None,
                   language: str | None, limit: int) -> list:
        """构造并执行 FTS5 MATCH 查询。ORDER BY rank 以利用 BM25 相关性。"""
        col_expr = self._build_match_expr(query, columns)
        projection = ', '.join(f"knowledge.{c.strip()}" for c in _COLUMNS.split(','))
        sql = (
            f"SELECT {projection} FROM knowledge_fts "
            "JOIN knowledge ON knowledge.id = knowledge_fts.rowid "
            "WHERE knowledge_fts MATCH ?"
        )
        params: list = [col_expr]
        if statuses:
            placeholders = ','.join('?' * len(statuses))
            sql += f" AND knowledge.status IN ({placeholders})"
            params.extend(statuses)
        if language:
            sql += " AND (knowledge.language=? OR knowledge.language='any')"
            params.append(language)
        sql += " ORDER BY rank LIMIT ?"
        params.append(limit)
        with self._connection() as conn:
            return conn.execute(sql, params).fetchall()

    def _like_fallback(self, columns: list, query: str, statuses: list | None,
                       language: str | None, limit: int) -> list:
        """FTS5 不可用时的兜底 LIKE 查询。"""
        like_terms = [t for t in query.split() if t]
        if not like_terms:
            return []
        where_or = ' OR '.join(f"{c} LIKE ? ESCAPE '\\'" for c in columns for _ in like_terms)
        params: list = []
        for c in columns:
            for t in like_terms:
                escaped = t.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
                params.append(f"%{escaped}%")
        sql = f"SELECT {_COLUMNS} FROM knowledge WHERE ({where_or})"
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
        """两层兜底搜索：先 FTS5 MATCH，失败回退 LIKE。"""
        if not query or not query.strip():
            return []
        safe_query = query.replace('"', ' ').strip()
        if len(safe_query.replace(' ', '')) < 3:
            rows = self._like_fallback(columns, safe_query, statuses, language, limit)
            return [self._row_to_record(r) for r in rows]
        try:
            rows = self._fts_query(columns, safe_query, statuses, language, limit)
        except Exception:
            rows = self._like_fallback(columns, safe_query, statuses, language, limit)
        return [self._row_to_record(r) for r in rows]

    def like_search(self, columns: list, query: str,
                    statuses: list | None = None,
                    language: str | None = None,
                    limit: int = 20) -> list:
        """对外暴露 LIKE 子串搜索：用于 explore 子命令的双路合并。

        与 fts_search 区别：不走 FTS5、不需要分词重叠，只做子串匹配，
        适合自由文本联想检索。返回 KnowledgeRecord 列表。
        """
        rows = self._like_fallback(columns, query or '', statuses, language, limit)
        return [self._row_to_record(r) for r in rows]

    def list_by_filters(self, category: str | None = None,
                        language: str | None = None,
                        entry_kind: str | None = None,
                        tags_any: list | None = None,
                        statuses: list | None = None,
                        limit: int = 20) -> list:
        """按 category/language/entry_kind/tags 多条件列出记录。

        ``tags_any`` 表示标签命中任一即满足（OR 语义，子串匹配）。
        ``statuses`` 缺省为 ``['active']``。结果按 confidence DESC,
        success_count DESC 排序。
        """
        statuses = statuses or ['active']
        sql = f"SELECT {_COLUMNS} FROM knowledge WHERE 1=1"
        params: list = []
        placeholders = ','.join('?' * len(statuses))
        sql += f" AND status IN ({placeholders})"
        params.extend(statuses)
        if category:
            sql += " AND category=?"
            params.append(category)
        if language:
            sql += " AND (language=? OR language='any')"
            params.append(language)
        if entry_kind:
            sql += " AND entry_kind=?"
            params.append(entry_kind)
        if tags_any:
            tag_clauses = []
            for t in tags_any:
                tag_clauses.append("tags LIKE ? ESCAPE '\\'")
                escaped = t.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
                params.append(f"%{escaped}%")
            if tag_clauses:
                sql += " AND (" + " OR ".join(tag_clauses) + ")"
        sql += " ORDER BY confidence DESC, success_count DESC, id DESC LIMIT ?"
        params.append(limit)
        with self._connection() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._row_to_record(r) for r in rows]
