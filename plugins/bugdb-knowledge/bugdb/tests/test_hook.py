"""bugdb_check.js Hook 集成测试。

直接调用 node 跑 hook 脚本，验证 stdin/stdout 协议契约：
1. 输入无错误模式 → 空 stdout，exit 0（不打扰）。
2. 输入命中模式但 DB 无记录 → 空 stdout，exit 0（静默）。
3. 输入命中模式且 DB 有记录 → 输出标准 hookSpecificOutput.additionalContext JSON。
4. stdin 空 / 损坏 JSON → 不崩溃，exit 0。

Hook 一直是 Python 测试盲区，本文件填补该覆盖。
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

PLUGIN_DIR = Path(__file__).resolve().parents[2]
CLI = str(PLUGIN_DIR / "bugdb" / "cli.py")
HOOK = str(PLUGIN_DIR / "hooks" / "js" / "bugdb_check" / "bugdb_check.js")

NODE = shutil.which("node")

skip_no_node = pytest.mark.skipif(NODE is None, reason="node executable not in PATH")


def _hook_env(home_dir):
    env = os.environ.copy()
    env["BUGDB_HOME"] = str(home_dir)
    env["CLAUDE_PLUGIN_ROOT"] = str(PLUGIN_DIR)
    env["PYTHONPATH"] = str(PLUGIN_DIR) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    env["BUGDB_PYTHON"] = sys.executable
    return env


def _run_hook(payload: dict, home_dir):
    """同步调用 hook，返回 CompletedProcess。"""
    return subprocess.run(
        [NODE, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=_hook_env(home_dir),
        timeout=10,
    )


def _seed_record(home_dir, *, category="link", context, cause, content,
                 language="c++"):
    """通过 CLI 录一条知识，返回 id。"""
    env = _hook_env(home_dir)
    res = subprocess.run(
        [sys.executable, CLI, "add",
         "--category", category,
         "--context", context,
         "--cause", cause,
         "--content", content,
         "--language", language],
        capture_output=True, text=True, encoding="utf-8", env=env,
    )
    assert res.returncode == 0, f"seed failed: {res.stderr}"
    return json.loads(res.stdout)["id"]


@skip_no_node
def test_hook_no_error_pattern_silent(tmp_path):
    """普通命令输出无错误关键词 → hook 不应输出任何东西。"""
    res = _run_hook({
        "tool_name": "Bash",
        "tool_response": {"stdout": "hello world\nall fine", "stderr": ""},
    }, tmp_path)
    assert res.returncode == 0
    assert res.stdout == ""


@skip_no_node
def test_hook_pattern_hit_no_db_record_silent(tmp_path):
    """命中错误模式但 DB 没有记录 → 仍空输出，不干扰主流程。"""
    res = _run_hook({
        "tool_name": "Bash",
        "tool_response": {
            "stdout": "main.cpp(10): error LNK2001: unresolved external symbol __imp_FooBar",
            "stderr": "",
        },
    }, tmp_path)
    assert res.returncode == 0
    assert res.stdout == ""


@skip_no_node
def test_hook_hit_returns_additional_context(tmp_path):
    """命中知识库 → 必须按标准协议返回 hookSpecificOutput.additionalContext。"""
    seeded_id = _seed_record(
        tmp_path,
        context="error LNK2001: unresolved external symbol __imp_WSAStartup",
        cause="missing ws2_32.lib",
        content="link ws2_32.lib",
    )
    res = _run_hook({
        "tool_name": "Bash",
        "tool_response": {
            "stdout": "main.cpp(42): error LNK2001: unresolved external symbol __imp_WSAStartup",
            "stderr": "",
        },
    }, tmp_path)
    assert res.returncode == 0, f"stderr={res.stderr}"
    assert res.stdout, "hook should emit JSON when DB hits"

    payload = json.loads(res.stdout)
    assert "hookSpecificOutput" in payload, payload
    hso = payload["hookSpecificOutput"]
    assert hso.get("hookEventName") == "PostToolUse"
    ctx = hso.get("additionalContext", "")
    assert "[BUGDB_MATCH]" in ctx
    assert f"id={seeded_id}" in ctx
    assert "link ws2_32.lib" in ctx


@skip_no_node
def test_hook_reads_stderr_field(tmp_path):
    """错误可能出现在 stderr 而非 stdout，hook 必须两者都扫描。"""
    seeded_id = _seed_record(
        tmp_path,
        context="error LNK2019: unresolved external symbol foo",
        cause="missing definition",
        content="define foo or link the lib",
    )
    res = _run_hook({
        "tool_name": "Bash",
        "tool_response": {
            "stdout": "",
            "stderr": "main.cpp(1): error LNK2019: unresolved external symbol foo",
        },
    }, tmp_path)
    assert res.returncode == 0
    assert f"id={seeded_id}" in res.stdout


@skip_no_node
def test_hook_empty_stdin_no_crash(tmp_path):
    """stdin 为空（Claude Code 偶尔会有的边界情况）→ exit 0，无 stdout，无 traceback。"""
    res = subprocess.run(
        [NODE, HOOK],
        input="",
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=_hook_env(tmp_path),
        timeout=5,
    )
    assert res.returncode == 0
    assert res.stdout == ""


@skip_no_node
def test_hook_malformed_json_silent(tmp_path):
    """损坏的 JSON → 静默吞掉，绝不阻塞主流程。"""
    res = subprocess.run(
        [NODE, HOOK],
        input="{not json",
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=_hook_env(tmp_path),
        timeout=5,
    )
    assert res.returncode == 0
    assert res.stdout == ""


@skip_no_node
def test_hook_missing_tool_response_field_silent(tmp_path):
    """input 缺 tool_response 字段 → 静默退出。"""
    res = _run_hook({"tool_name": "Bash"}, tmp_path)
    assert res.returncode == 0
    assert res.stdout == ""
