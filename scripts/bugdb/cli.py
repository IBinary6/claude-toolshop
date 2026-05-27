"""BugDB CLI 入口。

所有外部调用方（Hook/Skill/Command）通过此模块。默认输出 JSON；
``--format text`` 切换为人类可读。

Example:
    >>> # python -m bugdb.cli search --query "LNK2001" --language c++
    >>> # python -m bugdb.cli stats --format text
"""
import argparse
import sys
from pathlib import Path

# 允许直接以脚本方式调用：把父目录加入 sys.path
_PARENT = Path(__file__).resolve().parent.parent
if str(_PARENT) not in sys.path:
    sys.path.insert(0, str(_PARENT))

from bugdb import formatters, search as search_mod  # noqa: E402
from bugdb import utils as _utils  # noqa: E402
from bugdb.db import BugDB  # noqa: E402
from bugdb.exceptions import BugDBError, RecordNotFound  # noqa: E402
from bugdb.models import BugRecord, ErrorType  # noqa: E402


def _parse_steps(raw: str) -> list | None:
    """解析 --solution-steps JSON 数组字符串。

    None 表示解析失败或非 list（调用方应 exit 2）；空字符串视为 []。

    Example:
        >>> _parse_steps('["a","b"]') == ['a', 'b']
        True
        >>> _parse_steps('null') is None
        True
    """
    parsed = _utils.safe_json_loads(raw)
    if parsed is None:
        # 区分：raw 是 "[]" 默认值（合法空列表） vs "null"（明确错误）
        if (raw or '').strip() == '[]':
            return []
        return None
    if not isinstance(parsed, list):
        return None
    return parsed


def _print(payload: str) -> None:
    """把 payload 写入 stdout，缺少尾换行时补一个。"""
    sys.stdout.write(payload)
    if not payload.endswith('\n'):
        sys.stdout.write('\n')


def _output(obj, kind: str, fmt: str) -> None:
    """根据 fmt + kind 选择 formatter 并写出。

    Example:
        >>> # _output(results, 'results', 'json')
    """
    if fmt == 'text':
        if kind == 'results':
            _print(formatters.results_to_text(obj))
        elif kind == 'record':
            _print(formatters.record_to_text(obj))
        else:
            _print(formatters.stats_to_text(obj))
    else:
        if kind == 'results':
            _print(formatters.results_to_json(obj))
        elif kind == 'record':
            _print(formatters.record_to_json(obj))
        else:
            _print(formatters.stats_to_json(obj))


def cmd_search(args, db: BugDB) -> int:
    """search 子命令处理函数。"""
    query = args.query
    if args.query_b64:
        import base64
        query = base64.b64decode(args.query_b64).decode('utf-8', errors='replace')
    results = search_mod.search(
        db, query=query, language=args.language,
        include_deprecated=args.include_deprecated, limit=args.limit,
    )
    _output(results, 'results', args.format)
    return 0


def cmd_get(args, db: BugDB) -> int:
    """get 子命令处理函数。"""
    rec = db.get(args.id)
    _output(rec, 'record', args.format)
    return 0


def cmd_list(args, db: BugDB) -> int:
    """list 子命令处理函数。"""
    records = db.list_all(status=args.status, language=args.language)
    _output(records, 'results', args.format)
    return 0


def cmd_stats(args, db: BugDB) -> int:
    """stats 子命令处理函数。"""
    stats = db.stats()
    _output(stats, 'stats', args.format)
    return 0


def cmd_add(args, db: BugDB) -> int:
    """add 子命令处理函数：构造 BugRecord 并写入。"""
    from bugdb import normalizer
    steps = _parse_steps(args.solution_steps)
    if steps is None:
        sys.stderr.write("error: --solution-steps must be a JSON array\n")
        return 2
    pattern = args.error_pattern or normalizer.normalize(args.error_message)
    if not pattern:
        sys.stderr.write("error: error_pattern is empty (provide --error-pattern or non-empty --error-message)\n")
        return 2
    rec = BugRecord(
        error_type=ErrorType(args.error_type),
        error_pattern=pattern,
        error_message=args.error_message,
        root_cause=args.root_cause,
        solution=args.solution,
        solution_steps=steps,
        language=args.language,
        project_type=args.project_type,
        tags=_utils.comma_split(args.tags),
        confidence=args.confidence,
        valid_for=args.valid_for,
    )
    saved = db.add(rec)
    _output(saved, 'record', args.format)
    return 0


def cmd_update(args, db: BugDB) -> int:
    """update 子命令处理函数：仅覆盖显式给出的字段。"""
    rec = db.get(args.id)
    if args.solution is not None:
        rec.solution = args.solution
    if args.root_cause is not None:
        rec.root_cause = args.root_cause
    if args.solution_steps is not None:
        steps = _parse_steps(args.solution_steps)
        if steps is None:
            sys.stderr.write("error: --solution-steps must be a JSON array\n")
            return 2
        rec.solution_steps = steps
    if args.tags is not None:
        rec.tags = _utils.comma_split(args.tags)
    if args.valid_for is not None:
        rec.valid_for = args.valid_for
    if args.confidence is not None:
        rec.confidence = args.confidence
    if args.language is not None:
        rec.language = args.language
    if args.project_type is not None:
        rec.project_type = args.project_type
    updated = db.update(rec)
    _output(updated, 'record', args.format)
    return 0


def cmd_delete(args, db: BugDB) -> int:
    """delete 子命令处理函数：--hard 表示物理删。"""
    db.delete(args.id, hard=args.hard)
    _output({'deleted': args.id, 'hard': args.hard}, 'stats', args.format)
    return 0


def cmd_restore(args, db: BugDB) -> int:
    """restore 子命令处理函数：从 archived 恢复为 active。"""
    rec = db.restore(args.id)
    _output(rec, 'record', args.format)
    return 0


def cmd_feedback(args, db: BugDB) -> int:
    """feedback 子命令处理函数：成功/失败反馈，驱动 confidence 衰减。"""
    rec = db.feedback(args.id, success=(args.result == 'success'))
    _output(rec, 'record', args.format)
    return 0


def _add_common(p: argparse.ArgumentParser) -> None:
    """所有子命令共用的参数。"""
    p.add_argument('--format', choices=['json', 'text'], default='json')


def build_parser() -> argparse.ArgumentParser:
    """构造 argparse 主解析器。"""
    parser = argparse.ArgumentParser(prog='bugdb', description='BugDB CLI')
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('search', help='搜索 bug 记录')
    p.add_argument('--query', default='')
    p.add_argument('--query-b64', dest='query_b64', default=None,
                   help='base64-encoded query (Hook 用，避免 shell 注入)')
    p.add_argument('--language', default=None)
    p.add_argument('--include-deprecated', action='store_true')
    p.add_argument('--limit', type=int, default=3)
    _add_common(p)

    p = sub.add_parser('get', help='按 ID 查询单条记录')
    p.add_argument('--id', type=int, required=True)
    _add_common(p)

    p = sub.add_parser('list', help='列出记录')
    p.add_argument('--status', default='active',
                   choices=['active', 'deprecated', 'obsolete', 'archived', 'all'])
    p.add_argument('--language', default=None)
    _add_common(p)

    p = sub.add_parser('stats', help='数据库统计信息')
    _add_common(p)

    # add
    p = sub.add_parser('add', help='录入新记录')
    p.add_argument('--error-type', required=True,
                   choices=[e.value for e in ErrorType])
    p.add_argument('--error-pattern', default=None,
                   help='缺省时由 normalize(error_message) 自动生成')
    p.add_argument('--error-message', default='')
    p.add_argument('--root-cause', required=True)
    p.add_argument('--solution', required=True)
    p.add_argument('--solution-steps', default='[]',
                   help='JSON 数组字符串')
    p.add_argument('--language', default='any')
    p.add_argument('--project-type', default='any')
    p.add_argument('--tags', default='')
    p.add_argument('--confidence', type=int, default=100)
    p.add_argument('--valid-for', default=None)
    _add_common(p)

    # update
    p = sub.add_parser('update', help='更新已有记录')
    p.add_argument('--id', type=int, required=True)
    p.add_argument('--solution', default=None)
    p.add_argument('--root-cause', default=None)
    p.add_argument('--solution-steps', default=None)
    p.add_argument('--tags', default=None)
    p.add_argument('--valid-for', default=None)
    p.add_argument('--confidence', type=int, default=None)
    p.add_argument('--language', default=None)
    p.add_argument('--project-type', default=None)
    _add_common(p)

    # delete
    p = sub.add_parser('delete', help='删除记录（默认软删除）')
    p.add_argument('--id', type=int, required=True)
    p.add_argument('--hard', action='store_true')
    _add_common(p)

    # restore
    p = sub.add_parser('restore', help='恢复软删除记录')
    p.add_argument('--id', type=int, required=True)
    _add_common(p)

    # feedback
    p = sub.add_parser('feedback', help='反馈方案有效性')
    p.add_argument('--id', type=int, required=True)
    p.add_argument('--result', required=True, choices=['success', 'failure'])
    _add_common(p)

    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI 主入口。"""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        db = BugDB()
        handler = HANDLERS[args.command]
        return handler(args, db)
    except RecordNotFound as e:
        sys.stderr.write(f"error: {e}\n")
        return 2
    except BugDBError as e:
        sys.stderr.write(f"bugdb error: {e}\n")
        return 3
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"unexpected error: {e}\n")
        return 1


HANDLERS = {
    'search': cmd_search,
    'get': cmd_get,
    'list': cmd_list,
    'stats': cmd_stats,
}

HANDLERS.update({
    'add': cmd_add,
    'update': cmd_update,
    'delete': cmd_delete,
    'restore': cmd_restore,
    'feedback': cmd_feedback,
})


if __name__ == '__main__':
    sys.exit(main())
