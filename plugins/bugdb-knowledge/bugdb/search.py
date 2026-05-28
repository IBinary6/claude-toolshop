"""搜索引擎。组合 normalizer + db.fts_search，实现两轮策略与替代链跟随。

两轮策略：
1. 第一轮：在 ``key_pattern`` 列上用提取出的关键词做精确 FTS 匹配。
2. 第一轮无结果时：在 ``context``/``cause``/``content`` 上用
   归一化后的全文做回退检索。

deprecated 命中会自动附带 ``replacement_hint`` 属性，指向其替代记录。
"""
from .db import BugDB
from .exceptions import RecordNotFound
from .models import KnowledgeRecord, Status
from . import normalizer


_OVERFETCH_FACTOR = 3


def search(db: BugDB, query: str, language: str | None = None,
           include_deprecated: bool = False, limit: int = 3) -> list:
    """两轮搜索：key_pattern 精确 → 全文回退；附带替代链。

    返回最多 ``limit`` 条 KnowledgeRecord。命中 deprecated 时记录的
    ``replacement_hint`` 属性为其替代记录（``KnowledgeRecord`` 或 ``None``）。
    """
    if not query or not query.strip():
        return []

    normalized = normalizer.normalize(query)
    keywords = normalizer.extract_keywords(normalized)

    statuses = ['active']
    if include_deprecated:
        statuses.append('deprecated')

    # 第一轮：key_pattern 精确匹配
    results = db.fts_search(
        columns=["key_pattern"],
        query=keywords,
        statuses=statuses,
        language=language,
        limit=limit * _OVERFETCH_FACTOR,
    )

    # 第二轮：全文回退
    if not results:
        results = db.fts_search(
            columns=["context", "cause", "content"],
            query=normalized,
            statuses=statuses,
            language=language,
            limit=limit * _OVERFETCH_FACTOR,
        )

    # 排序：confidence DESC, success_count DESC
    results.sort(key=lambda r: (r.confidence, r.success_count), reverse=True)

    # 替代链跟随
    for r in results:
        if r.status == Status.DEPRECATED and r.replaced_by_id:
            try:
                r.replacement_hint = db.get(r.replaced_by_id)
            except RecordNotFound:
                r.replacement_hint = None

    return results[:limit]


def find_similar(db: BugDB, pattern: str, threshold: float = 0.7, limit: int = 5) -> list:
    """去重检查辅助函数。基于 ``key_pattern``/``context`` 列的 FTS5 命中。

    覆盖所有状态（含 archived/obsolete），避免重复录入已软删除的相同记录。
    """
    if not pattern or not pattern.strip():
        return []
    normalized = normalizer.normalize(pattern)
    keywords = normalizer.extract_keywords(normalized)
    rows = db.fts_search(
        columns=["key_pattern", "context"],
        query=keywords,
        statuses=['active', 'deprecated', 'obsolete', 'archived'],
        limit=limit,
    )
    return rows
