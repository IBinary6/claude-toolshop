"""Schema 初始化与迁移测试。"""
import sqlite3
import time
import pytest
from bugdb.db import BugDB, MIGRATIONS
from bugdb import utils
from bugdb.models import KnowledgeRecord, Category, EntryKind, Status


def test_schema_initialized(db):
    """核心表（knowledge / knowledge_fts / schema_version）应在初始化后存在。"""
    with db._connection() as conn:
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
    assert 'knowledge' in tables
    assert 'knowledge_fts' in tables
    assert 'schema_version' in tables


def test_schema_version_recorded(db):
    """schema_version 应记录已应用迁移到最新版本。"""
    with db._connection() as conn:
        v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    assert v == max(MIGRATIONS.keys())


def test_consecutive_failures_column_exists(db):
    """v2 迁移应已添加 consecutive_failures 列。"""
    with db._connection() as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(knowledge)")]
    assert 'consecutive_failures' in cols


def test_fts_triggers_exist(db):
    """FTS5 同步三个触发器（insert/delete/update）应存在。"""
    with db._connection() as conn:
        triggers = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger'"
        )}
    assert 'knowledge_fts_insert' in triggers
    assert 'knowledge_fts_delete' in triggers
    assert 'knowledge_fts_update' in triggers


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
    """直接 INSERT knowledge 一行后，knowledge_fts MATCH 应能命中。"""
    now = utils.now_iso()
    with db._connection() as conn:
        conn.execute(
            """
            INSERT INTO knowledge(category, key_pattern, cause, content,
                                  created_at, updated_at)
            VALUES ('compile', 'xxx_unique_token', 'rc', 'sol', ?, ?)
            """,
            (now, now),
        )
    with db._connection() as conn:
        row = conn.execute(
            "SELECT key_pattern FROM knowledge_fts WHERE knowledge_fts MATCH 'xxx_unique_token'"
        ).fetchone()
    assert row is not None
    assert row[0] == 'xxx_unique_token'


def test_fk_replaced_by_id_on_delete_set_null(db):
    """删除 A 时，B.replaced_by_id 应被置 NULL（验证 PRAGMA foreign_keys=ON 实际生效）。"""
    now = utils.now_iso()
    with db._connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO knowledge(category, key_pattern, cause, content,
                                  created_at, updated_at)
            VALUES ('compile', 'pat-A', 'rc', 'sol', ?, ?)
            """,
            (now, now),
        )
        a_id = cur.lastrowid
        cur = conn.execute(
            """
            INSERT INTO knowledge(category, key_pattern, cause, content,
                                  replaced_by_id, created_at, updated_at)
            VALUES ('compile', 'pat-B', 'rc', 'sol', ?, ?, ?)
            """,
            (a_id, now, now),
        )
        b_id = cur.lastrowid
    with db._connection() as conn:
        conn.execute("DELETE FROM knowledge WHERE id = ?", (a_id,))
    with db._connection() as conn:
        row = conn.execute("SELECT replaced_by_id FROM knowledge WHERE id = ?", (b_id,)).fetchone()
    assert row is not None
    assert row[0] is None


# ============================================================
# CRUD 测试
# ============================================================

def _sample_record() -> KnowledgeRecord:
    return KnowledgeRecord(
        entry_kind=EntryKind.BUG,
        category=Category.LINK,
        key_pattern="LNK2001 unresolved external symbol",
        context="error LNK2001: unresolved external symbol __imp_WSAStartup",
        cause="missing ws2_32.lib",
        content="link ws2_32.lib",
        action_steps=["open project", "linker > input", "add ws2_32.lib"],
        language="c++",
        project_type="vs",
        tags=["linker", "windows"],
    )


def test_add_returns_new_record_with_id(db):
    rec = _sample_record()
    saved = db.add(rec)
    assert saved.id is not None
    assert saved.created_at != ""
    assert saved.updated_at != ""
    assert rec.id is None  # 原对象不变（纯函数）


def test_get_returns_record(db):
    saved = db.add(_sample_record())
    fetched = db.get(saved.id)
    assert fetched.key_pattern == saved.key_pattern
    assert fetched.action_steps == ["open project", "linker > input", "add ws2_32.lib"]
    assert fetched.tags == ["linker", "windows"]
    assert fetched.status == Status.ACTIVE


def test_get_missing_raises(db):
    from bugdb.exceptions import RecordNotFound
    with pytest.raises(RecordNotFound):
        db.get(99999)


def test_update_changes_fields(db):
    saved = db.add(_sample_record())
    saved.content = "updated content"
    saved.confidence = 80
    db.update(saved)
    fetched = db.get(saved.id)
    assert fetched.content == "updated content"
    assert fetched.confidence == 80


def test_delete_soft(db):
    saved = db.add(_sample_record())
    db.delete(saved.id, hard=False)
    fetched = db.get(saved.id)
    assert fetched.status == Status.ARCHIVED


def test_delete_hard(db):
    from bugdb.exceptions import RecordNotFound
    saved = db.add(_sample_record())
    db.delete(saved.id, hard=True)
    with pytest.raises(RecordNotFound):
        db.get(saved.id)


def test_restore(db):
    saved = db.add(_sample_record())
    db.delete(saved.id, hard=False)
    db.restore(saved.id)
    fetched = db.get(saved.id)
    assert fetched.status == Status.ACTIVE
    assert fetched.consecutive_failures == 0


def test_list_all(db):
    db.add(_sample_record())
    db.add(_sample_record())
    rows = db.list_all()
    assert len(rows) >= 2


def test_update_refreshes_updated_at(db):
    """update() 必须刷新 updated_at（用于版本追踪、衰减计算）。"""
    saved = db.add(_sample_record())
    t1 = saved.updated_at
    time.sleep(1.1)
    saved.content = "another"
    db.update(saved)
    assert saved.updated_at > t1


def test_update_missing_id_raises(db):
    """id=None 的记录无法定位行，必须抛 RecordNotFound 而非静默 no-op。"""
    from bugdb.exceptions import RecordNotFound
    rec = _sample_record()
    assert rec.id is None
    with pytest.raises(RecordNotFound):
        db.update(rec)


def test_update_nonexistent_id_raises(db):
    """指定不存在的 id 必须抛 RecordNotFound（rowcount==0 检查）。"""
    from bugdb.exceptions import RecordNotFound
    rec = _sample_record()
    rec.id = 99999
    with pytest.raises(RecordNotFound):
        db.update(rec)


def test_delete_hard_missing_raises(db):
    """物理删除不存在的 id 必须抛 RecordNotFound，不可静默成功。"""
    from bugdb.exceptions import RecordNotFound
    with pytest.raises(RecordNotFound):
        db.delete(99999, hard=True)


def test_json_roundtrip_empty_and_special_chars(db):
    """action_steps 空列表与含引号/反斜杠/换行/中文 的 step 必须完整往返。"""
    rec1 = _sample_record()
    rec1.action_steps = []
    saved1 = db.add(rec1)
    assert db.get(saved1.id).action_steps == []

    rec2 = _sample_record()
    rec2.action_steps = ['"quoted"', 'back\\slash', 'line1\nline2', '中文步骤']
    saved2 = db.add(rec2)
    fetched = db.get(saved2.id)
    assert fetched.action_steps == ['"quoted"', 'back\\slash', 'line1\nline2', '中文步骤']


def test_list_all_sorted_by_confidence_desc(db):
    """list_all 必须按 confidence DESC 排序（spec 列表语义）。"""
    a = _sample_record(); a.confidence = 50
    b = _sample_record(); b.confidence = 90
    c = _sample_record(); c.confidence = 70
    sa = db.add(a)
    sb = db.add(b)
    sc = db.add(c)
    rows = db.list_all()
    confidences = [r.confidence for r in rows]
    assert confidences == sorted(confidences, reverse=True)
    assert confidences[:3] == [90, 70, 50]


# ============================================================
# FTS5 搜索
# ============================================================

def test_fts_search_by_pattern(db):
    """FTS5 MATCH 应能按 key_pattern 命中。"""
    saved = db.add(_sample_record())
    rows = db.fts_search(["key_pattern"], "LNK2001")
    assert any(r.id == saved.id for r in rows)


def test_fts_search_filters_status(db):
    """软删后默认状态过滤应排除 archived。"""
    saved = db.add(_sample_record())
    db.delete(saved.id, hard=False)
    rows = db.fts_search(["key_pattern"], "LNK2001", statuses=["active"])
    assert all(r.id != saved.id for r in rows)


def test_fts_search_filters_language(db):
    """language 过滤：c++ 记录不应匹配 rust 过滤。"""
    saved = db.add(_sample_record())
    rows = db.fts_search(["key_pattern"], "LNK2001", language="rust")
    matching = [r for r in rows if r.id == saved.id]
    assert matching == []


def test_fts_search_falls_back_to_like(db, monkeypatch):
    """FTS 路径异常时应自动回退到 LIKE 兜底。"""
    saved = db.add(_sample_record())
    monkeypatch.setattr(db, '_fts_query', lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("force")))
    rows = db.fts_search(["key_pattern"], "LNK2001")
    assert any(r.id == saved.id for r in rows)


def test_fts_search_handles_special_chars(db):
    """查询含 FTS5 特殊字符（如 ``:``）不应抛语法错误，必须能正常命中。"""
    saved = db.add(_sample_record())
    rows = db.fts_search(["key_pattern", "context"], "LNK2001:")
    assert any(r.id == saved.id for r in rows)


def test_fts_search_short_query_uses_like(db):
    """短于 3 字符的查询应走 LIKE 兜底（trigram tokenize 要求 ≥ 3 字符）。"""
    rec = _sample_record()
    rec.key_pattern = "build OK status"
    saved = db.add(rec)
    rows = db.fts_search(["key_pattern"], "OK")
    assert any(r.id == saved.id for r in rows)


def test_fts_search_returns_all_matches(db):
    """FTS 搜索（按 rank 排序）应返回所有匹配记录。"""
    a = _sample_record(); a.confidence = 50
    b = _sample_record(); b.confidence = 90
    c = _sample_record(); c.confidence = 70
    sa = db.add(a); sb = db.add(b); sc = db.add(c)
    rows = db.fts_search(["key_pattern"], "LNK2001")
    ids = {r.id for r in rows}
    assert {sa.id, sb.id, sc.id} == ids


def test_like_fallback_escapes_wildcards(db, monkeypatch):
    """LIKE 兜底必须转义 ``%`` / ``_`` 字面匹配，避免被通配符吞掉。"""
    rec1 = _sample_record()
    rec1.key_pattern = "progress 100% complete"
    hit = db.add(rec1)
    rec2 = _sample_record()
    rec2.key_pattern = "progress 1XYZ complete"
    miss = db.add(rec2)
    monkeypatch.setattr(db, '_fts_query', lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("force")))
    rows = db.fts_search(["key_pattern"], "100%")
    ids = {r.id for r in rows}
    assert hit.id in ids
    assert miss.id not in ids


def test_fts_search_language_any_compat(db):
    """language='any' 的记录用 language='c++' 搜索时应可见（跨语言可见）。"""
    rec = _sample_record()
    rec.language = "any"
    saved = db.add(rec)
    rows = db.fts_search(["key_pattern"], "LNK2001", language="c++")
    assert any(r.id == saved.id for r in rows)
