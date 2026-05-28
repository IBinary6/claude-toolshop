from bugdb.models import Category, EntryKind, KnowledgeRecord, Status, validate_kind_category


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


# ---------- validate_kind_category ----------

import pytest


@pytest.mark.parametrize("category", [
    Category.COMPILE, Category.LINK, Category.RUNTIME,
    Category.TYPE, Category.IMPORT, Category.BUILD, Category.CONFIG,
])
def test_validate_bug_allows_all_bug_categories(category):
    """entry_kind=bug 允许所有 7 个 bug 类别。"""
    assert validate_kind_category(EntryKind.BUG, category) is None


@pytest.mark.parametrize("kind,category", [
    (EntryKind.PRACTICE, Category.PRACTICE),
    (EntryKind.TOOL, Category.TOOL),
    (EntryKind.DECISION, Category.DECISION),
    (EntryKind.WORKFLOW, Category.WORKFLOW),
])
def test_validate_knowledge_kind_matches_same_category(kind, category):
    """非 bug 的 4 类 kind 必须配同名 category。"""
    assert validate_kind_category(kind, category) is None


@pytest.mark.parametrize("kind,category", [
    (EntryKind.BUG, Category.PRACTICE),
    (EntryKind.BUG, Category.TOOL),
    (EntryKind.PRACTICE, Category.RUNTIME),
    (EntryKind.TOOL, Category.COMPILE),
    (EntryKind.DECISION, Category.WORKFLOW),
    (EntryKind.WORKFLOW, Category.DECISION),
])
def test_validate_rejects_mismatched_combinations(kind, category):
    """语义自相矛盾的组合必须被拒绝，错误信息要包含 entry_kind/category 让人能定位。"""
    err = validate_kind_category(kind, category)
    assert err is not None
    assert kind.value in err
    assert category.value in err
