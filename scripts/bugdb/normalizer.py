"""错误信息标准化。纯函数，无副作用。

normalize(): 清洗（剥离路径/行号/地址/时间戳/UUID），保留错误码与符号关键词。
"""
import re

# 清洗规则（按顺序执行）
# 注意：timestamp/UUID 必须在 line-number 规则之前匹配，否则 `:30:00` 等子串
# 会被 line-number 规则先吃掉，导致后续 timestamp 模式失配。
RULES = [
    (re.compile(r'[A-Za-z]:\\[\w\\.\-\s]+'), ''),
    (re.compile(r'/[\w/.\-]+\.\w+'), ''),
    (re.compile(r'\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}[:\d.]*'), ''),
    (re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'), ''),
    (re.compile(r'[:(]\d+[,:\d]*[):]?'), ''),
    (re.compile(r'\bline\s+\d+', re.IGNORECASE), ''),
    (re.compile(r'0x[0-9A-Fa-f]{4,16}'), ''),
    (re.compile(r'\s+'), ' '),
]


def normalize(raw: str) -> str:
    """对原始错误信息按 RULES 顺序清洗，返回规范化字符串。"""
    if not raw:
        return ''
    out = raw
    for pattern, repl in RULES:
        out = pattern.sub(repl, out)
    return out.strip()
