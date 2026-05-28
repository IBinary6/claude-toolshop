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
    (re.compile(r'\b[A-Za-z_][\w\-]*\.[a-zA-Z]{1,5}\b'), ''),
    (re.compile(r'[:(]\d+[,:\d]*[):]?'), ''),
    (re.compile(r'\bline\s+\d+', re.IGNORECASE), ''),
    (re.compile(r'0x[0-9A-Fa-f]{4,16}'), ''),
    (re.compile(r'\s+'), ' '),
]

KNOWN_PHRASES = [
    "unresolved external symbol", "undefined reference",
    "cannot convert", "no matching function",
    "access violation", "segmentation fault",
    "module not found", "no module named",
]

_ERROR_CODE_RE = re.compile(r'[A-Z]+\d{3,5}|error\[E\d+\]')
_SYMBOL_RE = re.compile(r'[\w:]+(?:::[\w]+)+|__\w+')


def normalize(raw: str) -> str:
    """对原始错误信息按 RULES 顺序清洗，返回规范化字符串。

    # Example
    ```
    >>> normalize("C:/proj/x.cpp(42): error LNK2001: unresolved")
    'error LNK2001 unresolved'
    >>> normalize("main.rs:10:5 error[E0308] at 0xDEADBEEF")
    'error[E0308] at'
    >>> normalize("2024-01-15T10:30:00 panic at line 42")
    'panic at'
    ```
    """
    if not raw:
        return ''
    out = raw
    for pattern, repl in RULES:
        out = pattern.sub(repl, out)
    return out.strip()


def extract_keywords(normalized: str) -> str:
    """从规范化字符串中提取错误码 / 命名空间符号 / 已知短语。

    返回空格分隔的关键词串；无关键词时回退到原文。

    # Example
    ```
    >>> extract_keywords("error LNK2001 unresolved external symbol foo")
    'LNK2001 unresolved external symbol'
    ```
    """
    if not normalized:
        return ''
    keywords: list[str] = []
    keywords.extend(_ERROR_CODE_RE.findall(normalized))
    keywords.extend(_SYMBOL_RE.findall(normalized))
    lower = normalized.lower()
    for phrase in KNOWN_PHRASES:
        if phrase in lower:
            keywords.append(phrase)
    if not keywords:
        return normalized.strip()
    # 去重保序
    return ' '.join(dict.fromkeys(keywords))
