"""Schema 初始化与迁移测试。"""
import sqlite3
import pytest
from bugdb.db import BugDB


def test_schema_initialized(db):
    """核心表（bugs / bugs_fts / schema_version）应在初始化后存在。"""
    with db._connection() as conn:
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
    assert 'bugs' in tables
    assert 'bugs_fts' in tables
    assert 'schema_version' in tables


def test_schema_version_recorded(db):
    """schema_version 应记录已应用迁移到至少 v2。"""
    with db._connection() as conn:
        v = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
    assert v >= 2


def test_consecutive_failures_column_exists(db):
    """v2 迁移应已添加 consecutive_failures 列。"""
    with db._connection() as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(bugs)")]
    assert 'consecutive_failures' in cols


def test_fts_triggers_exist(db):
    """FTS5 同步三个触发器（insert/delete/update）应存在。"""
    with db._connection() as conn:
        triggers = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger'"
        )}
    assert 'bugs_fts_insert' in triggers
    assert 'bugs_fts_delete' in triggers
    assert 'bugs_fts_update' in triggers
