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

from bugdb import config, formatters, search as search_mod  # noqa: E402
from bugdb.db import BugDB  # noqa: E402
from bugdb.exceptions import BugDBError, RecordNotFound  # noqa: E402
from bugdb.models import BugRecord, ErrorType, Status  # noqa: E402


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
    """stats 子命令处理函数。聚合 total + by_status/language/error_type。"""
    with db._connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM bugs").fetchone()[0]
        by_status = dict(conn.execute(
            "SELECT status, COUNT(*) FROM bugs GROUP BY status"
        ).fetchall())
        by_language = dict(conn.execute(
            "SELECT language, COUNT(*) FROM bugs GROUP BY language"
        ).fetchall())
        by_error_type = dict(conn.execute(
            "SELECT error_type, COUNT(*) FROM bugs GROUP BY error_type"
        ).fetchall())
    stats = {
        'total': total,
        'by_status': by_status,
        'by_language': by_language,
        'by_error_type': by_error_type,
        'db_path': str(db._path),
    }
    _output(stats, 'stats', args.format)
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

    return parser


def main(argv: list | None = None) -> int:
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


if __name__ == '__main__':
    sys.exit(main())
