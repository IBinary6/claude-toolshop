"""BugDB 异常层次。所有自定义异常继承 BugDBError。"""


class BugDBError(Exception):
    """BugDB 模块所有异常的基类。"""


class RecordNotFound(BugDBError):
    """按 ID 或条件查询时记录不存在。"""


class DuplicateRecord(BugDBError):
    """录入时检测到重复记录。"""


class InvalidState(BugDBError):
    """状态机迁移不合法（如从 archived 直接到 active 之外的状态）。"""


class SchemaMigrationError(BugDBError):
    """Schema 迁移失败。"""
