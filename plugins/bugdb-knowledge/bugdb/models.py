"""知识记录数据模型与状态枚举。零依赖，纯 dataclass。"""
from dataclasses import dataclass, field
from enum import Enum


class EntryKind(str, Enum):
    """条目类型：区分知识库中不同性质的记录。"""
    BUG = "bug"
    PRACTICE = "practice"
    TOOL = "tool"
    DECISION = "decision"
    WORKFLOW = "workflow"


class Category(str, Enum):
    """知识分类。保留所有 bug 相关旧值，新增知识类别。"""
    # bug 相关
    COMPILE = "compile"
    LINK = "link"
    RUNTIME = "runtime"
    TYPE = "type"
    IMPORT = "import"
    BUILD = "build"
    CONFIG = "config"
    # 知识条目相关
    PRACTICE = "practice"
    TOOL = "tool"
    DECISION = "decision"
    WORKFLOW = "workflow"


class Status(str, Enum):
    """记录生命周期状态。"""
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    OBSOLETE = "obsolete"
    ARCHIVED = "archived"


@dataclass
class KnowledgeRecord:
    """单条知识记录。字段顺序对应 SQLite 列。

    confidence: 0-100 整数百分比（100=最高，0=完全失效）。
    """
    entry_kind: EntryKind = EntryKind.BUG
    category: Category = Category.COMPILE
    key_pattern: str = ""
    cause: str = ""
    content: str = ""
    id: int | None = None
    context: str = ""
    action_steps: list[str] = field(default_factory=list)
    title: str = ""
    language: str = "any"
    project_type: str = "any"
    tags: list[str] = field(default_factory=list)
    confidence: int = 100
    usage_count: int = 0
    success_count: int = 0
    status: Status = Status.ACTIVE
    replaced_by_id: int | None = None
    valid_for: str | None = None
    deprecation_note: str | None = None
    consecutive_failures: int = 0
    created_at: str = ""
    updated_at: str = ""
    # 非持久化字段：search() 命中 deprecated 时附加替代记录
    replacement_hint: "KnowledgeRecord | None" = None


# 向后兼容别名（deprecated，后续版本移除）
ErrorType = Category
BugRecord = KnowledgeRecord
