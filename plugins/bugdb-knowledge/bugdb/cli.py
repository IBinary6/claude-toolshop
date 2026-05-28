"""BugDB CLI 入口。

所有外部调用方（Hook/Skill/Command）通过此模块。默认输出 JSON；
``--format text`` 切换为人类可读。
"""
import argparse
import json
import sys
from pathlib import Path

from bugdb import formatters, search as search_mod
from bugdb import utils as _utils
from bugdb.db import BugDB
from bugdb.exceptions import BugDBError, RecordNotFound
from bugdb.models import Category, EntryKind, KnowledgeRecord, Status, validate_kind_category
from bugdb.paths import get_db_path, get_log_path, get_bugdb_home
from bugdb.paths import get_config_file, read_config


def _parse_steps(raw: str) -> list | None:
    """解析 --action-steps JSON 数组字符串。

    None 表示解析失败或非 list（调用方应 exit 2）；空字符串视为 []。
    """
    parsed = _utils.safe_json_loads(raw)
    if parsed is None:
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
    """根据 fmt + kind 选择 formatter 并写出。"""
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
    """add 子命令处理函数：构造 KnowledgeRecord 并写入。"""
    from bugdb import normalizer
    steps = _parse_steps(args.action_steps)
    if steps is None:
        sys.stderr.write("error: --action-steps must be a JSON array\n")
        return 2
    pattern = args.key_pattern or normalizer.normalize(args.context)
    if not pattern:
        sys.stderr.write("error: key_pattern is empty (provide --key-pattern or non-empty --context)\n")
        return 2
    kind_enum = EntryKind(args.entry_kind)
    cat_enum = Category(args.category)
    err = validate_kind_category(kind_enum, cat_enum)
    if err:
        sys.stderr.write(f"error: {err}\n")
        return 2
    rec = KnowledgeRecord(
        entry_kind=kind_enum,
        category=cat_enum,
        key_pattern=pattern,
        context=args.context,
        cause=args.cause,
        content=args.content,
        action_steps=steps,
        title=args.title,
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
    if args.content is not None:
        rec.content = args.content
    if args.cause is not None:
        rec.cause = args.cause
    if args.action_steps is not None:
        steps = _parse_steps(args.action_steps)
        if steps is None:
            sys.stderr.write("error: --action-steps must be a JSON array\n")
            return 2
        rec.action_steps = steps
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
    if args.title is not None:
        rec.title = args.title
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


def cmd_deprecate(args, db: BugDB) -> int:
    """deprecate 子命令处理：标记为废弃 + 关联替代方案。"""
    rec = db.get(args.id)
    rec.status = Status.DEPRECATED
    if args.replace_with is not None:
        rec.replaced_by_id = args.replace_with
    if args.reason:
        rec.deprecation_note = args.reason
    updated = db.update(rec)
    _output(updated, 'record', args.format)
    return 0


def cmd_obsolete(args, db: BugDB) -> int:
    """obsolete 子命令处理：标记为方案不可用。"""
    rec = db.get(args.id)
    rec.status = Status.OBSOLETE
    if args.reason:
        rec.deprecation_note = args.reason
    updated = db.update(rec)
    _output(updated, 'record', args.format)
    return 0


def cmd_find_similar(args, db: BugDB) -> int:
    """find-similar 子命令处理：录入前去重。"""
    results = search_mod.find_similar(db, pattern=args.pattern,
                                      threshold=args.threshold, limit=args.limit)
    _output(results, 'results', args.format)
    return 0


def cmd_normalize(args, db: BugDB) -> int:
    """normalize 子命令处理：暴露 normalizer 给 Hook/Skill。"""
    from bugdb import normalizer
    normalized = normalizer.normalize(args.input)
    keywords = normalizer.extract_keywords(normalized)
    out = {'normalized': normalized, 'keywords': keywords}
    if args.format == 'text':
        _print(f"normalized: {normalized}\nkeywords:   {keywords}")
    else:
        _print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def cmd_export(args, db: BugDB) -> int:
    """export 子命令处理：全量导出到 JSON 文件。"""
    records = db.list_all(status='all')
    payload = {
        'version': 2,
        'records': [formatters.record_to_dict(r) for r in records],
    }
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                 encoding='utf-8')
    _output({'exported': len(records), 'path': args.output}, 'stats', args.format)
    return 0


def _load_import_payload(path: Path) -> list[dict]:
    """读取并校验 import JSON。"""
    raw = path.read_text(encoding='utf-8')
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON: {e}") from e
    if not isinstance(payload, dict):
        raise ValueError("payload must be a JSON object")
    if 'records' not in payload:
        raise ValueError("missing required key: records")
    records = payload['records']
    if not isinstance(records, list):
        raise ValueError("records must be a list")
    for idx, item in enumerate(records):
        if not isinstance(item, dict):
            raise ValueError(f"records[{idx}] must be an object")
        # 兼容 v1 (error_type/error_pattern) 和 v2 (category/key_pattern) 格式
        cat = item.get('category') or item.get('error_type')
        pat = item.get('key_pattern') or item.get('error_pattern')
        if not cat:
            raise ValueError(f"records[{idx}] missing field: category (or error_type)")
        if not pat:
            raise ValueError(f"records[{idx}] missing field: key_pattern (or error_pattern)")
    return records


def cmd_import(args, db: BugDB) -> int:
    """import 子命令处理：从 JSON 文件批量导入。

    先全量校验（含 kind×category 组合）再统一写入，避免部分成功部分失败
    留下半残状态。
    """
    try:
        records = _load_import_payload(Path(args.input))
    except (ValueError, OSError) as e:
        sys.stderr.write(f"import error: {e}\n")
        return 2
    pending: list[KnowledgeRecord] = []
    for idx, d in enumerate(records):
        try:
            kind_enum = EntryKind(d.get('entry_kind', 'bug'))
            cat_enum = Category(d.get('category') or d.get('error_type', 'compile'))
        except ValueError as e:
            sys.stderr.write(f"import error at record #{idx}: {e}\n")
            return 2
        err = validate_kind_category(kind_enum, cat_enum)
        if err:
            sys.stderr.write(f"import error at record #{idx}: {err}\n")
            return 2
        pending.append(KnowledgeRecord(
            entry_kind=kind_enum,
            category=cat_enum,
            key_pattern=d.get('key_pattern') or d.get('error_pattern', ''),
            context=d.get('context') or d.get('error_message', ''),
            cause=d.get('cause') or d.get('root_cause', ''),
            content=d.get('content') or d.get('solution', ''),
            action_steps=list(d.get('action_steps') or d.get('solution_steps') or []),
            title=d.get('title', ''),
            language=d.get('language', 'any'),
            project_type=d.get('project_type', 'any'),
            tags=list(d.get('tags') or []),
            confidence=int(d.get('confidence', 100)),
            usage_count=int(d.get('usage_count', 0)),
            success_count=int(d.get('success_count', 0)),
            status=Status(d.get('status', 'active')),
            replaced_by_id=d.get('replaced_by_id') or d.get('replaces_id'),
            valid_for=d.get('valid_for'),
            deprecation_note=d.get('deprecation_note'),
        ))
    for rec in pending:
        db.add(rec)
    _output({'imported': len(pending), 'path': args.input}, 'stats', args.format)
    return 0


def cmd_config(args) -> int:
    """config 子命令处理函数（不需要 BugDB 实例）。"""
    action = args.config_action
    fmt = args.format
    config_file = get_config_file()

    if action == 'path':
        info = {
            'db_path': str(get_db_path()),
            'log_path': str(get_log_path()),
            'bugdb_home': str(get_bugdb_home()),
            'config_file': str(config_file),
        }
        if fmt == 'text':
            for k, v in info.items():
                _print(f"{k}: {v}")
        else:
            _print(json.dumps(info, ensure_ascii=False, indent=2))
        return 0

    if action == 'get':
        key = args.key
        if key is None:
            sys.stderr.write("error: config get 需要 <key> 参数\n")
            return 2
        cfg = read_config()
        value = cfg.get(key)
        if fmt == 'text':
            if value is None:
                _print(f"{key}: (未设置)")
            else:
                _print(f"{key}: {value}")
        else:
            _print(json.dumps({key: value}, ensure_ascii=False, indent=2))
        return 0

    if action == 'set':
        key = args.key
        value = args.value
        if key is None or value is None:
            sys.stderr.write("error: config set 需要 <key> <value> 参数\n")
            return 2
        cfg = read_config()
        cfg[key] = value
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
        from bugdb.paths import _clear_config_cache
        _clear_config_cache()
        if fmt == 'text':
            _print(f"{key} = {value}")
        else:
            _print(json.dumps({'key': key, 'value': value}, ensure_ascii=False, indent=2))
        return 0

    if action == 'init':
        if config_file.exists():
            msg = f"config.json 已存在: {config_file}"
            if fmt == 'text':
                _print(msg)
            else:
                _print(json.dumps({'exists': True, 'path': str(config_file)},
                                  ensure_ascii=False, indent=2))
            return 0
        default_cfg = {
            'db_path': str(get_bugdb_home() / 'bugs.db'),
            'log_path': str(get_bugdb_home() / 'bugdb.log'),
        }
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text(
            json.dumps(default_cfg, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
        if fmt == 'text':
            _print(f"已创建: {config_file}")
        else:
            _print(json.dumps({'created': True, 'path': str(config_file)},
                              ensure_ascii=False, indent=2))
        return 0

    sys.stderr.write(f"error: unknown config action: {action}\n")
    return 2


def _add_common(p: argparse.ArgumentParser) -> None:
    """所有子命令共用的参数。"""
    p.add_argument('--format', choices=['json', 'text'], default='json')


def build_parser() -> argparse.ArgumentParser:
    """构造 argparse 主解析器。"""
    parser = argparse.ArgumentParser(prog='bugdb', description='BugDB CLI')
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('search', help='搜索知识记录')
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
    p.add_argument('--entry-kind', dest='entry_kind', default='bug',
                   choices=[e.value for e in EntryKind])
    p.add_argument('--category', required=True,
                   help='知识分类')
    p.add_argument('--key-pattern', dest='key_pattern', default=None,
                   help='缺省时由 normalize(context) 自动生成')
    p.add_argument('--context', default='')
    p.add_argument('--cause', required=True)
    p.add_argument('--content', required=True)
    p.add_argument('--action-steps', dest='action_steps', default='[]',
                   help='JSON 数组字符串')
    p.add_argument('--title', default='')
    p.add_argument('--language', default='any')
    p.add_argument('--project-type', default='any')
    p.add_argument('--tags', default='')
    p.add_argument('--confidence', type=int, default=100)
    p.add_argument('--valid-for', default=None)
    _add_common(p)

    # update
    p = sub.add_parser('update', help='更新已有记录')
    p.add_argument('--id', type=int, required=True)
    p.add_argument('--content', default=None)
    p.add_argument('--cause', default=None)
    p.add_argument('--action-steps', dest='action_steps', default=None)
    p.add_argument('--tags', default=None)
    p.add_argument('--valid-for', default=None)
    p.add_argument('--confidence', type=int, default=None)
    p.add_argument('--language', default=None)
    p.add_argument('--project-type', default=None)
    p.add_argument('--title', default=None)
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

    # deprecate
    p = sub.add_parser('deprecate', help='标记记录为废弃（建议有替代方案）')
    p.add_argument('--id', type=int, required=True)
    p.add_argument('--replace-with', dest='replace_with', type=int, default=None)
    p.add_argument('--reason', default=None)
    _add_common(p)

    # obsolete
    p = sub.add_parser('obsolete', help='标记记录为方案不可用（无替代）')
    p.add_argument('--id', type=int, required=True)
    p.add_argument('--reason', default=None)
    _add_common(p)

    # find-similar
    p = sub.add_parser('find-similar', help='录入前查找相似记录')
    p.add_argument('--pattern', required=True)
    p.add_argument('--threshold', type=float, default=0.7)
    p.add_argument('--limit', type=int, default=5)
    _add_common(p)

    # normalize
    p = sub.add_parser('normalize', help='对错误消息做归一化（暴露给 Hook/Skill）')
    p.add_argument('--input', required=True)
    _add_common(p)

    # export
    p = sub.add_parser('export', help='全量导出到 JSON 文件')
    p.add_argument('--output', required=True)
    _add_common(p)

    # import
    p = sub.add_parser('import', help='从 JSON 文件批量导入')
    p.add_argument('--input', required=True)
    _add_common(p)

    # config
    p = sub.add_parser('config', help='查看/修改 BugDB 配置')
    p.add_argument('config_action', choices=['path', 'get', 'set', 'init'],
                   help='path=显示路径 | get=读取配置项 | set=设置配置项 | init=创建默认配置')
    p.add_argument('key', nargs='?', default=None,
                   help='配置项名称（get/set 时必须）')
    p.add_argument('value', nargs='?', default=None,
                   help='配置项值（set 时必须）')
    _add_common(p)

    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI 主入口。"""
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == 'config':
            return cmd_config(args)
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
    'add': cmd_add,
    'update': cmd_update,
    'delete': cmd_delete,
    'restore': cmd_restore,
    'feedback': cmd_feedback,
    'deprecate': cmd_deprecate,
    'obsolete': cmd_obsolete,
    'find-similar': cmd_find_similar,
    'normalize': cmd_normalize,
    'export': cmd_export,
    'import': cmd_import,
    'config': cmd_config,
}


if __name__ == '__main__':
    sys.exit(main())
