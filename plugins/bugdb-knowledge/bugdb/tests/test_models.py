from bugdb.models import Category, EntryKind, KnowledgeRecord, Status


def test_category_str_enum():
    assert Category.COMPILE == "compile"
    assert Category.LINK.value == "link"


def test_entrykind_str_enum():
    assert EntryKind.BUG == "bug"
    assert EntryKind.PRACTICE.value == "practice"


def test_status_str_enum():
    assert Status.ACTIVE == "active"
    assert Status.DEPRECATED.value == "deprecated"


def test_knowledgerecord_defaults():
    r = KnowledgeRecord(
        entry_kind=EntryKind.BUG,
        category=Category.COMPILE,
        key_pattern="LNK2001",
        cause="missing lib",
        content="add ws2_32",
    )
    assert r.id is None
    assert r.context == ""
    assert r.action_steps == []
    assert r.tags == []
    assert r.confidence == 100
    assert r.usage_count == 0
    assert r.success_count == 0
    assert r.status == Status.ACTIVE
    assert r.language == "any"
    assert r.project_type == "any"
    assert r.title == ""


def test_category_includes_bug_and_knowledge_values():
    """Category 必须覆盖原 bug 类别 + 新增知识类别。"""
    expected = {
        'compile', 'link', 'runtime', 'type', 'import', 'build', 'config',
        'practice', 'tool', 'decision', 'workflow',
    }
    actual = {e.value for e in Category}
    assert actual == expected


def test_entrykind_all_members():
    expected = {'bug', 'practice', 'tool', 'decision', 'workflow'}
    actual = {e.value for e in EntryKind}
    assert actual == expected


def test_status_all_members():
    """Status 必须包含 schema 要求的全部 4 个成员。"""
    expected = {'active', 'deprecated', 'obsolete', 'archived'}
    actual = {s.value for s in Status}
    assert actual == expected


def test_default_factory_isolation():
    """两个 KnowledgeRecord 实例的可变默认值不能共享。"""
    r1 = KnowledgeRecord()
    r2 = KnowledgeRecord()
    assert r1.action_steps is not r2.action_steps
    r1.action_steps.append('x')
    assert r2.action_steps == []
    assert r1.tags is not r2.tags
