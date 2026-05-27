from bugdb.models import BugRecord, ErrorType, Status


def test_errortype_str_enum():
    assert ErrorType.COMPILE == "compile"
    assert ErrorType.LINK.value == "link"


def test_status_str_enum():
    assert Status.ACTIVE == "active"
    assert Status.DEPRECATED.value == "deprecated"


def test_bugrecord_defaults():
    b = BugRecord(
        error_type=ErrorType.COMPILE,
        error_pattern="LNK2001",
        root_cause="missing lib",
        solution="add ws2_32",
    )
    assert b.id is None
    assert b.error_message == ""
    assert b.solution_steps == []
    assert b.tags == []
    assert b.confidence == 100
    assert b.usage_count == 0
    assert b.success_count == 0
    assert b.status == Status.ACTIVE
    assert b.language == "any"
    assert b.project_type == "any"
