"""覆盖 search fallback 与 explore 子命令的端到端测试。

复用 test_cli.py 的 _run 模式，通过 subprocess 调 CLI 拿 JSON。
"""
import json
import os
import subprocess
import sys
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[2]
CLI = str(PLUGIN_DIR / "bugdb" / "cli.py")


def _run(args, home_dir, input_str=None):
    """与 test_cli._run 对齐：注入 BUGDB_HOME 隔离测试数据库。"""
    env = os.environ.copy()
    env["BUGDB_HOME"] = str(home_dir)
    env["PYTHONPATH"] = str(PLUGIN_DIR) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(
        [sys.executable, CLI, *args],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        input=input_str,
    )


def _seed_lnk2001(home):
    """种一条 LNK2001 link 类的记录，作为 fallback/explore 邻区命中目标。"""
    r = _run([
        "add", "--category", "link",
        "--context", "error LNK2001: unresolved external symbol __imp_WSAStartup",
        "--cause", "missing ws2_32.lib",
        "--content", "link ws2_32.lib in target_link_libraries",
        "--action-steps", '["open CMakeLists","add ws2_32","rebuild"]',
        "--language", "c++",
        "--tags", "linker,windows,winsock",
    ], home)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)["id"]


def _seed_practice(home):
    """种一条 practice 类记录，用于 entry_kind 过滤测试。"""
    r = _run([
        "add", "--entry-kind", "practice", "--category", "practice",
        "--key-pattern", "f-string formatting",
        "--cause", "格式化场景",
        "--content", "优先使用 f-string",
        "--language", "python",
        "--tags", "style,python",
    ], home)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)["id"]


# ---------------------------------------------------------------------------
# search fallback 行为
# ---------------------------------------------------------------------------

def test_search_fallback_kicks_in_on_zero_hit(tmp_path):
    """库里只有 LNK2001 类，搜完全无重叠的 query → results=[], fallback 非空。

    用 'PQR9999 xyzabc nomatch' 这种与 seed 无任何 trigram 重叠的串，
    强制主搜索 0 命中，验证 fallback 邻区生效。
    """
    seed_id = _seed_lnk2001(tmp_path)
    r = _run([
        "search", "--query", "PQR9999 xyzabc nomatch zzz",
        "--language", "c++",
    ], tmp_path)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    assert obj["results"] == [], f"expected empty, got {obj['results']}"
    assert obj.get("fallback") is True
    fb = obj.get("fallback_results") or []
    # category 推断不到 link → fallback 走 language 兜底，c++ 下 LNK2001 应在
    assert any(item["id"] == seed_id for item in fb)
    item = next(i for i in fb if i["id"] == seed_id)
    assert "key_pattern" in item
    assert "content" in item
    assert "confidence" in item
    assert "category" in item


def test_search_no_fallback_flag_returns_empty(tmp_path):
    """加 --no-fallback 时维持旧行为：results=[]，不要 fallback 字段。"""
    _seed_lnk2001(tmp_path)
    r = _run([
        "search", "--query", "PQR9999 xyzabc nomatch zzz",
        "--language", "c++", "--no-fallback",
    ], tmp_path)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    assert obj["results"] == []
    assert "fallback_results" not in obj
    assert "fallback" not in obj


def test_search_hit_does_not_emit_fallback(tmp_path):
    """命中主搜索时不应混入 fallback —— 避免 hook 拿到的语义被污染。"""
    seed_id = _seed_lnk2001(tmp_path)
    r = _run([
        "search", "--query", "LNK2001 unresolved external symbol",
        "--language", "c++",
    ], tmp_path)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    assert any(rec["id"] == seed_id for rec in obj["results"])
    assert "fallback_results" not in obj
    assert "fallback" not in obj


def test_search_text_fallback_marker(tmp_path):
    """text 输出 0 命中时应打 [BUGDB_FALLBACK] 标记。"""
    _seed_lnk2001(tmp_path)
    r = _run([
        "search", "--query", "PQR9999 xyzabc nomatch zzz",
        "--language", "c++", "--format", "text",
    ], tmp_path)
    assert r.returncode == 0, r.stderr
    assert "[BUGDB_FALLBACK]" in r.stdout


# ---------------------------------------------------------------------------
# explore 子命令
# ---------------------------------------------------------------------------

def test_explore_query_only_finds_via_fts_or_like(tmp_path):
    """仅 query：FTS5 OR + LIKE 子串都应能从 winsock 这种 tag/cause 联想到。"""
    seed_id = _seed_lnk2001(tmp_path)
    r = _run(["explore", "--query", "winsock"], tmp_path)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    assert obj["total"] >= 1
    assert any(item["id"] == seed_id for item in obj["results"])


def test_explore_filter_only_lists_active(tmp_path):
    """无 query 时按 filter 列：category=link 应命中 LNK2001 但不命中 practice。"""
    link_id = _seed_lnk2001(tmp_path)
    practice_id = _seed_practice(tmp_path)
    r = _run(["explore", "--category", "link"], tmp_path)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    ids = [item["id"] for item in obj["results"]]
    assert link_id in ids
    assert practice_id not in ids


def test_explore_query_plus_filter_combines(tmp_path):
    """query=unresolved + entry_kind=bug → 只返回 bug 类记录。"""
    link_id = _seed_lnk2001(tmp_path)
    practice_id = _seed_practice(tmp_path)
    r = _run([
        "explore", "--query", "unresolved",
        "--entry-kind", "bug",
    ], tmp_path)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    ids = [item["id"] for item in obj["results"]]
    assert link_id in ids
    assert practice_id not in ids


def test_explore_tags_match_any(tmp_path):
    """tags 命中任一即可：传 'winsock,nope' 也应命中 LNK2001。"""
    seed_id = _seed_lnk2001(tmp_path)
    r = _run(["explore", "--tags", "winsock,definitelynotreal"], tmp_path)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    assert any(item["id"] == seed_id for item in obj["results"])


def test_explore_returns_total_and_filters(tmp_path):
    """JSON 输出必须包含 total / query / filters / results。"""
    _seed_lnk2001(tmp_path)
    r = _run(["explore", "--query", "linker", "--language", "c++"], tmp_path)
    assert r.returncode == 0, r.stderr
    obj = json.loads(r.stdout)
    assert "total" in obj
    assert "query" in obj
    assert "filters" in obj
    assert "results" in obj
    assert obj["filters"]["language"] == "c++"
