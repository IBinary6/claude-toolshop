"""统一路径解析。

优先级链：
1. 环境变量 BUGDB_HOME → 该目录下的 bugs.db / bugdb.log
2. ~/.claude/bugdb/config.json 中的 db_path / log_path 字段
3. 默认 ~/.claude/bugdb/bugs.db 和 ~/.claude/bugdb/bugdb.log
"""
import json
import os
from pathlib import Path

_DEFAULT_DIR = Path.home() / '.claude' / 'bugdb'
_CONFIG_FILE = _DEFAULT_DIR / 'config.json'


def _read_config() -> dict:
    """读取 config.json，文件不存在或解析失败返回空 dict。"""
    try:
        return json.loads(_CONFIG_FILE.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def get_bugdb_home() -> Path:
    """获取 BUGDB_HOME 目录。

    优先级：BUGDB_HOME 环境变量 > 默认 ~/.claude/bugdb

    Example::

        home = get_bugdb_home()
        # -> Path('~/.claude/bugdb') 或 BUGDB_HOME 指定的目录
    """
    env = os.environ.get('BUGDB_HOME')
    if env and env.strip():
        return Path(env).expanduser()
    return _DEFAULT_DIR


def get_db_path(explicit: Path | str | None = None) -> Path:
    """解析 BugDB SQLite 路径。

    优先级：
    1. explicit 参数（非空）
    2. BUGDB_HOME 环境变量 → $BUGDB_HOME/bugs.db
    3. config.json 中的 db_path
    4. 默认 ~/.claude/bugdb/bugs.db

    空字符串视为未提供，回退到下一级来源。

    Example::

        path = get_db_path()
        # -> Path('~/.claude/bugdb/bugs.db')
    """
    # 1. 显式参数
    if explicit is not None and explicit != "":
        return Path(explicit).expanduser()

    # 2. BUGDB_HOME 环境变量
    bugdb_home = os.environ.get('BUGDB_HOME')
    if bugdb_home and bugdb_home.strip():
        return Path(bugdb_home).expanduser() / 'bugs.db'

    # 3. config.json
    cfg = _read_config()
    db_path = cfg.get('db_path')
    if db_path and str(db_path).strip():
        return Path(db_path).expanduser()

    # 4. 默认路径
    return _DEFAULT_DIR / 'bugs.db'


def get_log_path() -> Path:
    """解析日志文件路径。

    优先级：
    1. BUGDB_HOME 环境变量 → $BUGDB_HOME/bugdb.log
    2. config.json 中的 log_path
    3. 默认 ~/.claude/bugdb/bugdb.log

    Example::

        log = get_log_path()
        # -> Path('~/.claude/bugdb/bugdb.log')
    """
    # 1. BUGDB_HOME 环境变量
    bugdb_home = os.environ.get('BUGDB_HOME')
    if bugdb_home and bugdb_home.strip():
        return Path(bugdb_home).expanduser() / 'bugdb.log'

    # 2. config.json
    cfg = _read_config()
    log_path = cfg.get('log_path')
    if log_path and str(log_path).strip():
        return Path(log_path).expanduser()

    # 3. 默认路径
    return _DEFAULT_DIR / 'bugdb.log'
