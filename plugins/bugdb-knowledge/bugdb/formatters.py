"""序列化 KnowledgeRecord 为 JSON / 人类可读纯文本。"""
import json
from .models import KnowledgeRecord


def record_to_dict(r: KnowledgeRecord) -> dict:
    """将 KnowledgeRecord 转为 JSON 友好的 dict。"""
    d = {
        'id': r.id,
        'entry_kind': r.entry_kind.value,
        'category': r.category.value,
        'key_pattern': r.key_pattern,
        'context': r.context,
        'cause': r.cause,
        'content': r.content,
        'action_steps': list(r.action_steps),
        'title': r.title,
        'language': r.language,
        'project_type': r.project_type,
        'tags': list(r.tags),
        'confidence': r.confidence,
        'usage_count': r.usage_count,
        'success_count': r.success_count,
        'status': r.status.value,
        'replaced_by_id': r.replaced_by_id,
        'valid_for': r.valid_for,
        'deprecation_note': r.deprecation_note,
        'created_at': r.created_at,
        'updated_at': r.updated_at,
    }
    hint = r.replacement_hint
    if hint is not None:
        d['replacement_id'] = hint.id
        d['replacement_content'] = hint.content
    return d


def record_to_json(r: KnowledgeRecord) -> str:
    """单条记录序列化为 JSON 字符串。"""
    return json.dumps(record_to_dict(r), ensure_ascii=False, indent=2)


def results_to_json(results: list) -> str:
    """搜索结果列表序列化为 ``{"results": [...]}`` JSON。"""
    return json.dumps(
        {'results': [record_to_dict(r) for r in results]},
        ensure_ascii=False,
        indent=2,
    )


def results_to_text(results: list) -> str:
    """搜索结果列表序列化为人类可读纯文本。"""
    if not results:
        return "(no results)"
    lines = []
    for r in results:
        cat = r.category.value
        st = r.status.value
        kind = r.entry_kind.value
        lines.append(f"#{r.id} [{kind}/{cat}] confidence={r.confidence} status={st}")
        lines.append(f"  pattern: {r.key_pattern}")
        lines.append(f"  content: {r.content}")
        if r.action_steps:
            for i, step in enumerate(r.action_steps, 1):
                lines.append(f"    {i}. {step}")
        hint = r.replacement_hint
        if hint is not None:
            lines.append(f"  -> replaced by #{hint.id}: {hint.content}")
        lines.append("")
    return '\n'.join(lines)


def record_to_text(r: KnowledgeRecord) -> str:
    """单条记录序列化为人类可读纯文本。"""
    return results_to_text([r])


def stats_to_json(stats: dict) -> str:
    """stats 字典序列化为 JSON。"""
    return json.dumps(stats, ensure_ascii=False, indent=2)


def stats_to_text(stats: dict) -> str:
    """stats 字典序列化为人类可读纯文本。"""
    lines = [f"{k}: {v}" for k, v in sorted(stats.items())]
    return '\n'.join(lines)


def record_to_summary(r: KnowledgeRecord, content_limit: int = 80) -> dict:
    """精简摘要：用于 search fallback / explore 列表展示。

    字段精简到 id/entry_kind/category/key_pattern/content[:N]/confidence/
    language/tags，避免长记录撑爆上下文。
    """
    content = (r.content or '')
    if len(content) > content_limit:
        content = content[:content_limit] + '...'
    return {
        'id': r.id,
        'entry_kind': r.entry_kind.value,
        'category': r.category.value,
        'key_pattern': r.key_pattern,
        'content': content,
        'confidence': r.confidence,
        'language': r.language,
        'tags': list(r.tags),
    }


def search_results_to_json(results: list, fallback: list | None = None) -> str:
    """search 结果序列化为 JSON；可选附带 fallback 邻区摘要。

    - 主结果在 ``results``（命中时非空）
    - fallback 命中时附加 ``fallback: true`` + ``fallback_results: [...]``
    - 两者不相互替代；hook 只读 ``results``，fallback 是给 Claude 看的兜底
    """
    payload: dict = {'results': [record_to_dict(r) for r in results]}
    if fallback:
        payload['fallback'] = True
        payload['fallback_results'] = [record_to_summary(r) for r in fallback]
    return json.dumps(payload, ensure_ascii=False, indent=2)


def search_results_to_text(results: list, fallback: list | None = None) -> str:
    """search 结果序列化为人类可读纯文本；可选附带 fallback 邻区摘要。"""
    if results:
        return results_to_text(results)
    if fallback:
        lines = [
            "[BUGDB_FALLBACK] 没有精确命中，以下是同分类下的历史记录（可能相关）：",
            "",
        ]
        for r in fallback:
            s = record_to_summary(r)
            lines.append(
                f"#{s['id']} [{s['entry_kind']}/{s['category']}] "
                f"confidence={s['confidence']} language={s['language']}"
            )
            lines.append(f"  pattern: {s['key_pattern']}")
            lines.append(f"  content: {s['content']}")
            lines.append("")
        return '\n'.join(lines)
    return "(no results)"


def explore_to_json(results: list, query: str, filters: dict) -> str:
    """explore 结果序列化为 JSON。"""
    payload = {
        'total': len(results),
        'query': query,
        'filters': filters,
        'results': [record_to_summary(r, content_limit=120) for r in results],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def explore_to_text(results: list, query: str, filters: dict) -> str:
    """explore 结果序列化为人类可读纯文本。"""
    if not results:
        return "(no results)"
    lines = [f"# explore query={query!r} filters={filters} total={len(results)}", ""]
    for r in results:
        s = record_to_summary(r, content_limit=120)
        lines.append(
            f"#{s['id']} [{s['entry_kind']}/{s['category']}] "
            f"confidence={s['confidence']} language={s['language']} "
            f"tags={','.join(s['tags']) if s['tags'] else '-'}"
        )
        lines.append(f"  pattern: {s['key_pattern']}")
        lines.append(f"  content: {s['content']}")
        lines.append("")
    return '\n'.join(lines)
