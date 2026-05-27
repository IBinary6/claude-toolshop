"""测试 BugDB 异常层次结构。

验证意图：所有自定义异常应继承统一基类 BugDBError，
以便调用方可以用单个 except 捕获所有 BugDB 相关错误。
"""
import pytest
from bugdb import exceptions as exc


def test_hierarchy():
    """所有具体异常都应继承自 BugDBError 基类。"""
    assert issubclass(exc.RecordNotFound, exc.BugDBError)
    assert issubclass(exc.DuplicateRecord, exc.BugDBError)
    assert issubclass(exc.InvalidState, exc.BugDBError)
    assert issubclass(exc.SchemaMigrationError, exc.BugDBError)


def test_raise_record_not_found():
    """RecordNotFound 抛出后应能被 BugDBError 捕获。"""
    with pytest.raises(exc.BugDBError):
        raise exc.RecordNotFound("id=42 not found")
