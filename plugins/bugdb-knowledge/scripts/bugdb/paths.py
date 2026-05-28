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

_config_cache: dict | None = None


def get_config_file() -> Path:
    """返回 config.json 路径。"""
    return _CONFIG_FILE


def read_config() -> dict:
    """读取 config.json，带模块级缓存。文件不存在或解析失败返回空 dict。"""
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    try:
        _config_cache = json.loads(_CONFIG_FILE.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        _config_cache = {}
    return _config_cache


def _clear_config_cache() -> None:
    """清除配置缓存（供测试使用）。"""
    global _config_cache
    _config_cache = None


def get_bugdb_home() -> Path:
    """获取 BUGDB_HOME 目录。

    优先级：BUGDB_HOME 环境变量 > 默认 ~/.claude/bugdb
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
    """
    if explicit is not None and explicit != "":
        return Path(explicit).expanduser()

    env = os.environ.get('BUGDB_HOME', '').strip()
    if env:
        return Path(env).expanduser() / 'bugs.db'

    cfg = read_config()
    db_path = cfg.get('db_path')
    if db_path and str(db_path).strip():
        return Path(db_path).expanduser()

    return _DEFAULT_DIR / 'bugs.db'


def get_log_path() -> Path:
    """解析日志文件路径。

    优先级：
    1. BUGDB_HOME 环境变量 → $BUGDB_HOME/bugdb.log
    2. config.json 中的 log_path
    3. 默认 ~/.claude/bugdb/bugdb.log
    """
    env = os.environ.get('BUGDB_HOME', '').strip()
    if env:
        return Path(env).expanduser() / 'bugdb.log'

    cfg = read_config()
    log_path = cfg.get('log_path')
    if log_path and str(log_path).strip():
        return Path(log_path).expanduser()

    return _DEFAULT_DIR / 'bugdb.log'
