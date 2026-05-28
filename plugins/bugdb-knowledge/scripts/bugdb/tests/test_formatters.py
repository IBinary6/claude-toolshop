import json
from bugdb.models import BugRecord, ErrorType, Status
from bugdb import formatters


def _rec() -> BugRecord:
    return BugRecord(
        id=42,
        error_type=ErrorType.LINK,
        error_pattern="LNK2001",
        error_message="error LNK2001: unresolved",
        root_cause="missing lib",
        solution="link lib",
        solution_steps=["a", "b"],
        language="c++",
        project_type="vs",
        tags=["linker"],
        confidence=95,
        status=Status.ACTIVE,
    )


def test_to_json_results():
    data = formatters.results_to_json([_rec()])
    obj = json.loads(data)
    assert obj['results'][0]['id'] == 42
    assert obj['results'][0]['solution_steps'] == ["a", "b"]
    assert obj['results'][0]['tags'] == ["linker"]
    assert obj['results'][0]['status'] == "active"


def test_to_json_record():
    data = formatters.record_to_json(_rec())
    obj = json.loads(data)
    assert obj['id'] == 42
    assert obj['error_type'] == "link"


def test_to_text_results():
    txt = formatters.results_to_text([_rec()])
    assert "42" in txt
    assert "LNK2001" in txt
    assert "link lib" in txt


def test_to_json_empty_results():
    data = formatters.results_to_json([])
    obj = json.loads(data)
    assert obj == {"results": []}


def test_record_to_json_with_replacement_hint():
    r = _rec()
    repl = _rec()
    repl.id = 55
    r.replacement_hint = repl
    obj = json.loads(formatters.record_to_json(r))
    assert obj['replacement_id'] == 55


def test_record_to_text_single():
    """单条 text 输出必须包含 id/error_type/confidence/status/pattern/solution/编号步骤。"""
    txt = formatters.record_to_text(_rec())
    assert "#42" in txt
    assert "[link]" in txt
    assert "confidence=95" in txt
    assert "status=active" in txt
    assert "pattern: LNK2001" in txt
    assert "solution: link lib" in txt
    assert "1. a" in txt
    assert "2. b" in txt


def test_results_to_text_empty():
    """空列表锁定占位输出。"""
    assert formatters.results_to_text([]) == "(no results)"


def test_results_to_text_with_replacement_hint():
    """text 输出必须呈现 replacement_hint 跳转行。"""
    r = _rec()
    repl = _rec()
    repl.id = 55
    repl.solution = "link lib"
    r.replacement_hint = repl
    txt = formatters.results_to_text([r])
    assert "-> replaced by #55: link lib" in txt


def test_stats_to_json():
    """stats dict → JSON 往返必须保留键值对。"""
    obj = json.loads(formatters.stats_to_json({"total": 10, "active": 8}))
    assert obj == {"total": 10, "active": 8}


def test_stats_to_text_sorted():
    """stats_to_text 锁定按 key 字母序输出（消除字典插入序依赖）。"""
    txt = formatters.stats_to_text({"total": 10, "active": 8, "deprecated": 2})
    assert txt == "active: 8\ndeprecated: 2\ntotal: 10"
