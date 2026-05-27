"""BugDB 数据访问层 (DAL)。Schema 初始化 + FTS5 同步 + 版本迁移。"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from . import config, utils
from .exceptions import SchemaMigrationError


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
            v = current
            try:
                for v in range(current + 1, target + 1):
                    MIGRATIONS[v](conn)
                    conn.execute(
                        "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
                        (v, utils.now_iso()),
                    )
            except sqlite3.Error as e:
                raise SchemaMigrationError(f"migration to v{v} failed: {e}") from e
