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
