"""跨模块复用纯工具函数。无业务逻辑，无 IO。"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def now_iso() -> str:
    """当前 UTC 时间 ISO8601 字符串（带时区后缀 +00:00）。"""
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def parse_iso(s: str) -> datetime:
    """解析 ISO8601 字符串为 datetime，兼容末尾 Z 后缀。"""
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    return datetime.fromisoformat(s)


def safe_json_loads(s: str):
    """解析 JSON，失败返回 None。"""
    if not s:
        return None
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


def to_json_array(items: list) -> str:
    """list[str] 序列化为 JSON 数组字符串。"""
    return json.dumps(list(items), ensure_ascii=False)


def truncate(s: str, max_len: int = 200) -> str:
    """超长字符串截断并追加省略号，返回长度 <= max_len。

    max_len 必须 >= 4（否则无空间放省略号）。
    """
    if s is None:
        return ''
    if len(s) <= max_len:
        return s
    if max_len < 4:
        return s[:max_len]
    return s[: max_len - 3] + '...'


def comma_split(s: str) -> list:
    """逗号分隔字符串拆为 list，自动 strip 空元素。"""
    if not s:
        return []
    return [x.strip() for x in s.split(',') if x.strip()]


def comma_join(items) -> str:
    """list 拼接为逗号分隔字符串。"""
    return ','.join(str(x) for x in items)


def expand_path(p: str) -> Path:
    """展开 ~ 与环境变量。"""
    return Path(os.path.expandvars(os.path.expanduser(p)))
