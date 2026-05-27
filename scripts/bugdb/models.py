"""Bug 记录数据模型与状态枚举。零依赖，纯 dataclass。"""
from dataclasses import dataclass, field
from enum import Enum


class ErrorType(str, Enum):
    """错误大类。"""
    COMPILE = "compile"
    LINK = "link"
    RUNTIME = "runtime"
    TYPE = "type"
    IMPORT = "import"
    BUILD = "build"
    CONFIG = "config"


class Status(str, Enum):
    """记录生命周期状态。"""
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    OBSOLETE = "obsolete"
    ARCHIVED = "archived"


@dataclass
class BugRecord:
    """单条 Bug 记录。字段顺序对应 SQLite 列。"""
    error_type: ErrorType = ErrorType.COMPILE
    error_pattern: str = ""
    root_cause: str = ""
    solution: str = ""
    id: int | None = None
    error_message: str = ""
    solution_steps: list = field(default_factory=list)
    language: str = "any"
    project_type: str = "any"
    tags: list = field(default_factory=list)
    confidence: int = 100
    usage_count: int = 0
    success_count: int = 0
    status: Status = Status.ACTIVE
    replaces_id: int | None = None
    valid_for: str | None = None
    deprecation_note: str | None = None
    consecutive_failures: int = 0
    created_at: str = ""
    updated_at: str = ""
