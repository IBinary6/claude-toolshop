"""数据库路径解析。优先级：显式参数 > BUGDB_PATH 环境变量 > 默认 ~/.claude/bugs.db"""
import os
from pathlib import Path

def get_db_path(explicit: Path | str | None = None) -> Path:
    """解析 BugDB SQLite 路径。

    # Examples
    ```
    >>> get_db_path('/tmp/x.db')
    PosixPath('/tmp/x.db')
    ```
    """
    if explicit:
        return Path(explicit).expanduser()
    env = os.environ.get('BUGDB_PATH')
    if env:
        return Path(env).expanduser()
    return Path.home() / '.claude' / 'bugs.db'
