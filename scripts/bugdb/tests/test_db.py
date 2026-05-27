"""Schema 初始化与迁移测试。"""
import sqlite3
import pytest
from bugdb.db import BugDB, MIGRATIONS
from bugdb import utils
from bugdb.models import BugRecord, ErrorType, Status


def test_schema_initialized(db):
    """核心表（bugs / bugs_fts / schema_version）应在初始化后存在。"""
    with db._connection() as conn:
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
    assert 'bugs' in tables
    assert 'bugs_fts' in tables
    assert 'schema_version' in tables


def test_schema_version_recorded(db):
    """schema_version 应记录已应用迁移到最新版本。"""
    with db._connection() as conn:
        v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    assert v == max(MIGRATIONS.keys())


def test_consecutive_failures_column_exists(db):
    """v2 迁移应已添加 consecutive_failures 列。"""
    with db._connection() as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(bugs)")]
    assert 'consecutive_failures' in cols


def test_fts_triggers_exist(db):
    """FTS5 同步三个触发器（insert/delete/update）应存在。"""
    with db._connection() as conn:
        triggers = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger'"
        )}
    assert 'bugs_fts_insert' in triggers
    assert 'bugs_fts_delete' in triggers
    assert 'bugs_fts_update' in triggers


def test_construct_is_idempotent(tmp_path):
    """二次构造 BugDB 应不重复写入 schema_version 行。"""
    db_file = tmp_path / "idem.db"
    BugDB(db_path=db_file)
    BugDB(db_path=db_file)
    instance = BugDB(db_path=db_file)
    with instance._connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0]
    assert count == len(MIGRATIONS)


def test_fts_trigger_syncs_on_raw_insert(db):
    """直接 INSERT bugs 一行后，bugs_fts MATCH 应能命中（验证 bugs_ai 触发器）。"""
    now = utils.now_iso()
    with db._connection() as conn:
        conn.execute(
            """
            INSERT INTO bugs(error_type, error_pattern, root_cause, solution,
                             created_at, updated_at)
            VALUES ('compile', 'xxx_unique_token', 'rc', 'sol', ?, ?)
            """,
            (now, now),
        )
    with db._connection() as conn:
        row = conn.execute(
            "SELECT error_pattern FROM bugs_fts WHERE bugs_fts MATCH 'xxx_unique_token'"
        ).fetchone()
    assert row is not None
    assert row[0] == 'xxx_unique_token'


def test_fk_replaces_id_on_delete_set_null(db):
    """删除 A 时，B.replaces_id 应被置 NULL（验证 PRAGMA foreign_keys=ON 实际生效）。"""
    now = utils.now_iso()
    with db._connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO bugs(error_type, error_pattern, root_cause, solution,
                             created_at, updated_at)
            VALUES ('compile', 'pat-A', 'rc', 'sol', ?, ?)
            """,
            (now, now),
        )
        a_id = cur.lastrowid
        cur = conn.execute(
            """
            INSERT INTO bugs(error_type, error_pattern, root_cause, solution,
                             replaces_id, created_at, updated_at)
            VALUES ('compile', 'pat-B', 'rc', 'sol', ?, ?, ?)
            """,
            (a_id, now, now),
        )
        b_id = cur.lastrowid
    with db._connection() as conn:
        conn.execute("DELETE FROM bugs WHERE id = ?", (a_id,))
    with db._connection() as conn:
        row = conn.execute("SELECT replaces_id FROM bugs WHERE id = ?", (b_id,)).fetchone()
    assert row is not None
    assert row[0] is None


# ============================================================
# Task 6: CRUD 测试
# ============================================================

def _sample_bug() -> BugRecord:
    return BugRecord(
        error_type=ErrorType.LINK,
        error_pattern="LNK2001 unresolved external symbol",
        error_message="error LNK2001: unresolved external symbol __imp_WSAStartup",
        root_cause="missing ws2_32.lib",
        solution="link ws2_32.lib",
        solution_steps=["open project", "linker > input", "add ws2_32.lib"],
        language="c++",
        project_type="vs",
        tags=["linker", "windows"],
    )


def test_add_returns_id(db):
    b = db.add(_sample_bug())
    assert b.id is not None
    assert b.created_at != ""
    assert b.updated_at != ""


def test_get_returns_record(db):
    added = db.add(_sample_bug())
    fetched = db.get(added.id)
    assert fetched.error_pattern == added.error_pattern
    assert fetched.solution_steps == ["open project", "linker > input", "add ws2_32.lib"]
    assert fetched.tags == ["linker", "windows"]
    assert fetched.status == Status.ACTIVE


def test_get_missing_raises(db):
    from bugdb.exceptions import RecordNotFound
    with pytest.raises(RecordNotFound):
        db.get(99999)


def test_update_changes_fields(db):
    b = db.add(_sample_bug())
    b.solution = "updated solution"
    b.confidence = 80
    db.update(b)
    fetched = db.get(b.id)
    assert fetched.solution == "updated solution"
    assert fetched.confidence == 80


def test_delete_soft(db):
    b = db.add(_sample_bug())
    db.delete(b.id, hard=False)
    fetched = db.get(b.id)
    assert fetched.status == Status.ARCHIVED


def test_delete_hard(db):
    from bugdb.exceptions import RecordNotFound
    b = db.add(_sample_bug())
    db.delete(b.id, hard=True)
    with pytest.raises(RecordNotFound):
        db.get(b.id)


def test_restore(db):
    b = db.add(_sample_bug())
    db.delete(b.id, hard=False)
    db.restore(b.id)
    fetched = db.get(b.id)
    assert fetched.status == Status.ACTIVE
    assert fetched.consecutive_failures == 0


def test_list_all(db):
    db.add(_sample_bug())
    db.add(_sample_bug())
    rows = db.list_all()
    assert len(rows) >= 2
