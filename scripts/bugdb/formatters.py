"""序列化 BugRecord 为 JSON / 人类可读纯文本。"""
import json
from .models import BugRecord, ErrorType, Status


def _record_to_dict(r: BugRecord) -> dict:
    """将 BugRecord 转为 JSON 友好的 dict。

    Enum 字段使用 ``.value`` 字符串化；solution_steps / tags 转为 list；
    replacement_hint 通过 getattr 防御性读取并展开为 replacement_id / replacement_solution。
    """
    d = {
        'id': r.id,
        'error_type': r.error_type.value if isinstance(r.error_type, ErrorType) else r.error_type,
        'error_pattern': r.error_pattern,
        'error_message': r.error_message,
        'root_cause': r.root_cause,
        'solution': r.solution,
        'solution_steps': list(r.solution_steps or []),
        'language': r.language,
        'project_type': r.project_type,
        'tags': list(r.tags or []),
        'confidence': r.confidence,
        'usage_count': r.usage_count,
        'success_count': r.success_count,
        'status': r.status.value if isinstance(r.status, Status) else r.status,
        'replaces_id': r.replaces_id,
        'valid_for': r.valid_for,
        'deprecation_note': r.deprecation_note,
        'created_at': r.created_at,
        'updated_at': r.updated_at,
    }
    hint = getattr(r, 'replacement_hint', None)
    if hint is not None and hasattr(hint, 'id'):
        d['replacement_id'] = hint.id
        d['replacement_solution'] = hint.solution
    return d


def record_to_json(r: BugRecord) -> str:
    """单条记录序列化为 JSON 字符串。

    # Example
    ```python
    >>> import json
    >>> from bugdb.models import BugRecord, ErrorType, Status
    >>> r = BugRecord(id=1, error_type=ErrorType.LINK, error_pattern="LNK2001",
    ...               error_message="x", root_cause="y", solution="z",
    ...               language="c++", project_type="vs", confidence=90,
    ...               status=Status.ACTIVE)
    >>> json.loads(record_to_json(r))['id']
    1
    ```
    """
    return json.dumps(_record_to_dict(r), ensure_ascii=False, indent=2)


def results_to_json(results: list) -> str:
    """搜索结果列表序列化为 ``{"results": [...]}`` JSON。

    # Example
    ```python
    >>> import json
    >>> json.loads(results_to_json([]))
    {'results': []}
    ```
    """
    return json.dumps(
        {'results': [_record_to_dict(r) for r in results]},
        ensure_ascii=False,
        indent=2,
    )


def results_to_text(results: list) -> str:
    """搜索结果列表序列化为人类可读纯文本。

    # Example
    ```python
    >>> results_to_text([])
    '(no results)'
    ```
    """
    if not results:
        return "(no results)"
    lines = []
    for r in results:
        et = r.error_type.value if isinstance(r.error_type, ErrorType) else r.error_type
        st = r.status.value if isinstance(r.status, Status) else r.status
        lines.append(f"#{r.id} [{et}] confidence={r.confidence} status={st}")
        lines.append(f"  pattern: {r.error_pattern}")
        lines.append(f"  solution: {r.solution}")
        if r.solution_steps:
            for i, step in enumerate(r.solution_steps, 1):
                lines.append(f"    {i}. {step}")
        hint = getattr(r, 'replacement_hint', None)
        if hint is not None and hasattr(hint, 'id'):
            lines.append(f"  -> replaced by #{hint.id}: {hint.solution}")
        lines.append("")
    return '\n'.join(lines)


def record_to_text(r: BugRecord) -> str:
    """单条记录序列化为人类可读纯文本。

    # Example
    ```python
    >>> from bugdb.models import BugRecord, ErrorType, Status
    >>> r = BugRecord(id=7, error_type=ErrorType.LINK, error_pattern="P",
    ...               error_message="m", root_cause="rc", solution="sol",
    ...               language="c++", project_type="vs", confidence=80,
    ...               status=Status.ACTIVE)
    >>> "#7" in record_to_text(r)
    True
    ```
    """
    return results_to_text([r])


def stats_to_json(stats: dict) -> str:
    """stats 字典序列化为 JSON。

    # Example
    ```python
    >>> stats_to_json({"total": 10})
    '{\\n  "total": 10\\n}'
    ```
    """
    return json.dumps(stats, ensure_ascii=False, indent=2)


def stats_to_text(stats: dict) -> str:
    """stats 字典序列化为人类可读纯文本。

    # Example
    ```python
    >>> stats_to_text({"total": 10, "active": 8})
    'total: 10\\nactive: 8'
    ```
    """
    lines = [f"{k}: {v}" for k, v in stats.items()]
    return '\n'.join(lines)
