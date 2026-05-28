"""search 模块测试：两轮搜索 + deprecated 过滤 + 替代链跟随。"""
from bugdb.models import KnowledgeRecord, Category, EntryKind, Status
from bugdb.search import search


def _add(db, **overrides) -> KnowledgeRecord:
    rec = KnowledgeRecord(
        entry_kind=EntryKind.BUG,
        category=Category.LINK,
        key_pattern="LNK2001 unresolved external symbol",
        context="error LNK2001: unresolved external symbol __imp_WSAStartup",
        cause="missing ws2_32.lib",
        content="link ws2_32.lib",
        action_steps=["open", "link"],
        language="c++",
        project_type="vs",
        tags=["linker"],
    )
    for k, v in overrides.items():
        setattr(rec, k, v)
    return db.add(rec)


def test_search_pattern_hit(db):
    saved = _add(db)
    results = search(db, query="error LNK2001 unresolved external symbol", language="c++")
    assert any(r.id == saved.id for r in results)


def test_search_roundtrip_different_paths(db):
    _add(db, context=r"C:\proj\x.cpp(10): error LNK2001: unresolved external symbol __imp_WSAStartup")
    results = search(db, query=r"D:\other\y.cpp(99): error LNK2001: unresolved external symbol __imp_WSAStartup", language="c++")
    assert len(results) >= 1


def test_search_excludes_deprecated_by_default(db):
    saved = _add(db, status=Status.DEPRECATED)
    results = search(db, query="LNK2001", language="c++")
    assert all(r.id != saved.id for r in results)


def test_search_include_deprecated(db):
    saved = _add(db, status=Status.DEPRECATED)
    results = search(db, query="LNK2001", language="c++", include_deprecated=True)
    assert any(r.id == saved.id for r in results)


def test_search_replacement_chain(db):
    new = _add(db, key_pattern="LNK2001 new approach", content="use cmake target_link_libraries")
    old = _add(db, status=Status.DEPRECATED, replaced_by_id=new.id)
    results = search(db, query="LNK2001", language="c++", include_deprecated=True)
    deprecated_hit = next((r for r in results if r.id == old.id), None)
    assert deprecated_hit is not None
    assert hasattr(deprecated_hit, 'replacement_hint')
    assert deprecated_hit.replacement_hint.id == new.id


def test_search_falls_back_to_full_text(db):
    saved = _add(db, key_pattern="cryptic", context="something about linker dependency being absent")
    results = search(db, query="linker dependency absent")
    assert any(r.id == saved.id for r in results)


def test_search_limit_3(db):
    for i in range(5):
        _add(db, key_pattern=f"LNK2001 variant {i}")
    results = search(db, query="LNK2001")
    assert len(results) <= 3


def test_search_orders_by_confidence_then_success_count(db):
    """排序契约：confidence DESC 为主键，success_count DESC 为 tiebreak。"""
    a = _add(db, key_pattern="LNK9999 ordering probe")
    b = _add(db, key_pattern="LNK9999 ordering probe")
    c = _add(db, key_pattern="LNK9999 ordering probe")

    a.confidence = 50
    a.success_count = 10
    db.update(a)
    b.confidence = 90
    b.success_count = 0
    db.update(b)
    c.confidence = 90
    c.success_count = 5
    db.update(c)

    results = search(db, query="LNK9999 ordering probe", language="c++")
    assert len(results) <= 3
    assert [r.id for r in results] == [c.id, b.id, a.id]
