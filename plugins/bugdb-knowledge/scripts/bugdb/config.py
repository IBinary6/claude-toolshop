"""数据库路径解析。薄代理层，实际逻辑在 paths.py。

保留本模块的公开接口 get_db_path 以兼容现有 import。
"""
from pathlib import Path

from . import paths


def get_db_path(explicit: Path | str | None = None) -> Path:
    """解析 BugDB SQLite 路径。转发到 paths.get_db_path。"""
    return paths.get_db_path(explicit)
