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


def fallback_neighborhood(db: BugDB, query: str, language: str | None = None,
                          limit: int = 5) -> list:
    """search 0 结果时的兜底邻区检索。

    优先用 query 推断 category（基于关键词），找不到则不限分类。
    返回同 category/language 下活跃记录的 top N，按 confidence DESC,
    success_count DESC 排序。用于让 Claude 看到根因相近的历史记录，
    而非空手而归。
    """
    category = _guess_category_from_query(query)

    # 第一轮：同 category + language 命中
    if category:
        rows = db.list_by_filters(
            category=category, language=language,
            statuses=['active'], limit=limit,
        )
        if rows:
            return rows

    # 第二轮：仅 language 命中
    if language:
        rows = db.list_by_filters(
            language=language, statuses=['active'], limit=limit,
        )
        if rows:
            return rows

    # 第三轮：无任何过滤，取最强 top N
    return db.list_by_filters(statuses=['active'], limit=limit)


# 关键词到 category 的粗映射，用于 fallback 时缩窄邻区范围。
# 命中任一关键词即返回对应 category；保守起见，不做完整正则。
_CATEGORY_HINTS: list[tuple[str, str]] = [
    ('lnk', 'link'),
    ('unresolved external', 'link'),
    ('undefined reference', 'link'),
    ('linker', 'link'),
    ('error c', 'compile'),
    ('compile', 'compile'),
    ('error e', 'compile'),
    ('access violation', 'runtime'),
    ('segfault', 'runtime'),
    ('segmentation fault', 'runtime'),
    ('runtime', 'runtime'),
    ('modulenotfounderror', 'import'),
    ('no module named', 'import'),
    ('importerror', 'import'),
    ('typeerror', 'type'),
    ('cmake error', 'build'),
    ('ninja: build stopped', 'build'),
    ('msbuild', 'build'),
    ('make: ***', 'build'),
]


def _guess_category_from_query(query: str) -> str | None:
    """从查询文本粗略推断 category；无线索返回 None。"""
    if not query:
        return None
    q = query.lower()
    for needle, cat in _CATEGORY_HINTS:
        if needle in q:
            return cat
    return None


def explore(db: BugDB, query: str = '', language: str | None = None,
            category: str | None = None, entry_kind: str | None = None,
            tags: list | None = None, limit: int = 20) -> list:
    """自由文本联想检索：FTS5 OR + LIKE 子串双路合并去重。

    设计意图：不要求关键词精确匹配；只要存在文本/分类/标签上的可能相关性，
    都返回给调用方（一般是 Claude）让它自己判断。

    - 若 ``query`` 非空：先用 FTS5（OR 语义）在 key_pattern/context/cause/
      content/tags 上检索，再用 LIKE 子串在同列上检索，两路合并去重。
    - 若 ``query`` 为空：直接按 filter 列出 active 记录。
    - 过滤项均为 AND 语义；``tags`` 为命中任一即可（OR）。
    """
    statuses = ['active']
    columns = ['key_pattern', 'context', 'cause', 'content', 'tags']

    if not query or not query.strip():
        return db.list_by_filters(
            category=category, language=language, entry_kind=entry_kind,
            tags_any=tags, statuses=statuses, limit=limit,
        )

    normalized = normalizer.normalize(query)
    keywords = normalizer.extract_keywords(normalized) or normalized

    seen: dict[int, KnowledgeRecord] = {}

    # 第一路：FTS5 OR 匹配
    try:
        fts_rows = db.fts_search(
            columns=columns, query=keywords,
            statuses=statuses, language=language, limit=limit * 2,
        )
    except Exception:
        fts_rows = []
    for r in fts_rows:
        if r.id is not None and r.id not in seen:
            seen[r.id] = r

    # 第二路：LIKE 子串匹配（用原始归一化后的文本，避免分词丢失）
    like_rows = db.like_search(
        columns=columns, query=normalized,
        statuses=statuses, language=language, limit=limit * 2,
    )
    for r in like_rows:
        if r.id is not None and r.id not in seen:
            seen[r.id] = r

    results = list(seen.values())

    # 后过滤：category / entry_kind / tags（FTS/LIKE 本身不支持这几项）
    def _match(r: KnowledgeRecord) -> bool:
        if category and r.category.value != category:
            return False
        if entry_kind and r.entry_kind.value != entry_kind:
            return False
        if tags:
            rec_tags = [t.lower() for t in (r.tags or [])]
            if not any(t.lower() in rec_tags or
                       any(t.lower() in rt for rt in rec_tags)
                       for t in tags):
                return False
        return True

    results = [r for r in results if _match(r)]
    results.sort(key=lambda r: (r.confidence, r.success_count), reverse=True)
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
