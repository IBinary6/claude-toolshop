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
