"""搜索引擎。组合 normalizer + db.fts_search，实现两轮策略与替代链跟随。

两轮策略：
1. 第一轮：在 ``error_pattern`` 列上用提取出的关键词做精确 FTS 匹配。
2. 第一轮无结果时：在 ``error_message``/``root_cause``/``solution`` 上用
   归一化后的全文做回退检索。

deprecated 命中会自动附带 ``replacement_hint`` 属性，指向其替代记录。
"""
from .db import BugDB
from .models import BugRecord, Status
from . import normalizer


def search(db: BugDB, query: str, language: str | None = None,
           include_deprecated: bool = False, limit: int = 3) -> list:
    """两轮搜索：error_pattern 精确 → 全文回退；附带替代链。

    返回最多 ``limit`` 条 BugRecord。命中 deprecated 时记录的
    ``replacement_hint`` 属性为其替代记录（``BugRecord`` 或 ``None``）。

    # Example
    ```python
    from bugdb.db import BugDB
    from bugdb.search import search
    db = BugDB()
    hits = search(db, "error LNK2001 unresolved external symbol", language="c++")
    for r in hits:
        print(r.id, r.error_pattern)
    ```
    """
    if not query or not query.strip():
        return []

    normalized = normalizer.normalize(query)
    keywords = normalizer.extract_keywords(normalized)

    statuses = ['active']
    if include_deprecated:
        statuses.append('deprecated')

    # 第一轮：error_pattern 精确匹配
    results = db.fts_search(
        columns=["error_pattern"],
        query=keywords,
        statuses=statuses,
        language=language,
        limit=limit * 3,
    )

    # 第二轮：全文回退
    if not results:
        results = db.fts_search(
            columns=["error_message", "root_cause", "solution"],
            query=normalized,
            statuses=statuses,
            language=language,
            limit=limit * 3,
        )

    # 排序：confidence DESC, success_count DESC
    results.sort(key=lambda r: (r.confidence, r.success_count), reverse=True)

    # 替代链跟随
    for r in results:
        if r.status == Status.DEPRECATED and r.replaces_id:
            try:
                r.replacement_hint = db.get(r.replaces_id)
            except Exception:
                r.replacement_hint = None

    return results[:limit]


def find_similar(db: BugDB, pattern: str, threshold: float = 0.7, limit: int = 5) -> list:
    """去重检查辅助函数。基于 ``error_pattern``/``error_message`` 列的 FTS5 命中。

    ``threshold`` 当前用作过滤窗口（保留，未来可结合 BM25 评分）。

    # Example
    ```python
    from bugdb.db import BugDB
    from bugdb.search import find_similar
    db = BugDB()
    dups = find_similar(db, "LNK2001 unresolved external symbol")
    ```
    """
    if not pattern or not pattern.strip():
        return []
    normalized = normalizer.normalize(pattern)
    keywords = normalizer.extract_keywords(normalized)
    rows = db.fts_search(
        columns=["error_pattern", "error_message"],
        query=keywords,
        statuses=['active', 'deprecated'],
        limit=limit,
    )
    return rows
