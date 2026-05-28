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


def test_errortype_all_members():
    """ErrorType 必须包含 schema 要求的全部 7 个成员。"""
    expected = {'compile', 'link', 'runtime', 'type', 'import', 'build', 'config'}
    actual = {e.value for e in ErrorType}
    assert actual == expected


def test_status_all_members():
    """Status 必须包含 schema 要求的全部 4 个成员。"""
    expected = {'active', 'deprecated', 'obsolete', 'archived'}
    actual = {s.value for s in Status}
    assert actual == expected


def test_default_factory_isolation():
    """两个 BugRecord 实例的可变默认值不能共享。"""
    b1 = BugRecord()
    b2 = BugRecord()
    if isinstance(b1.solution_steps, list):
        assert b1.solution_steps is not b2.solution_steps
        b1.solution_steps.append('x')
        assert b2.solution_steps == []
    if isinstance(b1.tags, list):
        assert b1.tags is not b2.tags
