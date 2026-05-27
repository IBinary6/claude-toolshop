"""search 模块测试：两轮搜索 + deprecated 过滤 + 替代链跟随。"""
from bugdb.models import BugRecord, ErrorType, Status
from bugdb.search import search


def _add(db, **overrides) -> BugRecord:
    rec = BugRecord(
        error_type=ErrorType.LINK,
        error_pattern="LNK2001 unresolved external symbol",
        error_message="error LNK2001: unresolved external symbol __imp_WSAStartup",
        root_cause="missing ws2_32.lib",
        solution="link ws2_32.lib",
        solution_steps=["open", "link"],
        language="c++",
        project_type="vs",
        tags=["linker"],
    )
    for k, v in overrides.items():
        setattr(rec, k, v)
    return db.add(rec)


def test_search_pattern_hit(db):
    b = _add(db)
    results = search(db, query="error LNK2001 unresolved external symbol", language="c++")
    assert any(r.id == b.id for r in results)


def test_search_roundtrip_different_paths(db):
    _add(db, error_message=r"C:\proj\x.cpp(10): error LNK2001: unresolved external symbol __imp_WSAStartup")
    results = search(db, query=r"D:\other\y.cpp(99): error LNK2001: unresolved external symbol __imp_WSAStartup", language="c++")
    assert len(results) >= 1


def test_search_excludes_deprecated_by_default(db):
    b = _add(db, status=Status.DEPRECATED)
    results = search(db, query="LNK2001", language="c++")
    assert all(r.id != b.id for r in results)


def test_search_include_deprecated(db):
    b = _add(db, status=Status.DEPRECATED)
    results = search(db, query="LNK2001", language="c++", include_deprecated=True)
    assert any(r.id == b.id for r in results)


def test_search_replacement_chain(db):
    new = _add(db, error_pattern="LNK2001 new approach", solution="use cmake target_link_libraries")
    old = _add(db, status=Status.DEPRECATED, replaces_id=new.id)
    results = search(db, query="LNK2001", language="c++", include_deprecated=True)
    deprecated_hit = next((r for r in results if r.id == old.id), None)
    assert deprecated_hit is not None
    assert hasattr(deprecated_hit, 'replacement_hint')
    assert deprecated_hit.replacement_hint.id == new.id


def test_search_falls_back_to_full_text(db):
    b = _add(db, error_pattern="cryptic", error_message="something about ws2_32.lib being absent")
    results = search(db, query="ws2_32.lib")
    assert any(r.id == b.id for r in results)


def test_search_limit_3(db):
    for i in range(5):
        _add(db, error_pattern=f"LNK2001 variant {i}")
    results = search(db, query="LNK2001")
    assert len(results) <= 3
