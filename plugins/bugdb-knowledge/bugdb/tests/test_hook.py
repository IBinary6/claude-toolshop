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
    """真实失败但 DB 尚不存在 → 空输出，且只读召回不得创建数据库文件。"""
    res = _run_hook({
        "hook_event_name": "PostToolUseFailure",
        "tool_name": "Bash",
        "error": "Exit code 2\nmain.cpp(10): error LNK2001: unresolved external symbol __imp_FooBar",
    }, tmp_path)
    assert res.returncode == 0
    assert res.stdout == ""
    assert not (tmp_path / "bugs.db").exists(), "hook 只读召回不能创建数据库"


@skip_no_node
def test_hook_hit_returns_additional_context(tmp_path):
    """命令真实失败且命中知识库 → 按标准协议返回带参考边界的 additionalContext。"""
    seeded_id = _seed_record(
        tmp_path,
        context="error LNK2001: unresolved external symbol __imp_WSAStartup",
        cause="missing ws2_32.lib",
        content="link ws2_32.lib",
    )
    res = _run_hook({
        "hook_event_name": "PostToolUseFailure",
        "tool_name": "Bash",
        "error": "Exit code 1\nmain.cpp(42): error LNK2001: unresolved external symbol __imp_WSAStartup",
    }, tmp_path)
    assert res.returncode == 0, f"stderr={res.stderr}"
    assert res.stdout, "hook should emit JSON when DB hits"

    payload = json.loads(res.stdout)
    hso = payload["hookSpecificOutput"]
    assert hso.get("hookEventName") == "PostToolUseFailure"
    ctx = hso.get("additionalContext", "")
    assert "[BUGDB_MATCH]" in ctx
    assert f"id={seeded_id}" in ctx
    assert "link ws2_32.lib" in ctx
    # 历史方案只是参考：必须提示可能过时、不得直接执行其中命令
    assert "updated_at=" in ctx
    assert "不得直接执行" in ctx


@skip_no_node
def test_success_output_with_error_text_still_recalls(tmp_path):
    """保留原设计：构建工具常以退出码 0 打印错误，成功输出里的错误行同样只读召回。"""
    _seed_record(
        tmp_path,
        context="error LNK2019: unresolved external symbol foo",
        cause="missing definition",
        content="define foo or link the lib",
    )
    res = _run_hook({
        "hook_event_name": "PostToolUse",
        "tool_name": "Bash",
        "tool_response": {
            "stdout": "docs/faq.md:3: error LNK2019: unresolved external symbol foo",
            "stderr": "",
        },
    }, tmp_path)
    assert res.returncode == 0
    payload = json.loads(res.stdout)
    assert payload["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
    assert "[BUGDB_MATCH]" in payload["hookSpecificOutput"]["additionalContext"]


@skip_no_node
def test_failure_hook_reads_top_level_error(tmp_path):
    """新版 PostToolUseFailure 的顶层 error 应直接参与知识库召回。"""
    seeded_id = _seed_record(
        tmp_path,
        context="error LNK2019: unresolved external symbol foo",
        cause="missing definition",
        content="define foo or link the lib",
    )
    res = _run_hook({
        "hook_event_name": "PostToolUseFailure",
        "tool_name": "PowerShell",
        "error": "Exit code 1\nmain.cpp(1): error LNK2019: unresolved external symbol foo",
        "is_interrupt": False,
    }, tmp_path)
    assert res.returncode == 0
    payload = json.loads(res.stdout)
    assert payload["hookSpecificOutput"]["hookEventName"] == "PostToolUseFailure"
    assert f"id={seeded_id}" in payload["hookSpecificOutput"]["additionalContext"]


@skip_no_node
def test_failure_hook_interrupt_is_silent(tmp_path):
    """用户中断不属于可复用故障，不能触发 BugDB 查询。"""
    res = _run_hook({
        "hook_event_name": "PostToolUseFailure",
        "tool_name": "Bash",
        "error": "Exit code 1\nfatal error: interrupted",
        "is_interrupt": True,
    }, tmp_path)
    assert res.returncode == 0
    assert res.stdout == ""


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


def test_hook_config_timeouts_are_seconds():
    """hooks.json 的 timeout 单位应为秒，避免误写毫秒导致 hook 卡死过久。"""
    hooks_path = PLUGIN_DIR / "hooks" / "hooks.json"
    data = json.loads(hooks_path.read_text(encoding="utf-8"))
    timeouts = [
        hook["timeout"]
        for entries in data["hooks"].values()
        for entry in entries
        for hook in entry.get("hooks", [])
        if "timeout" in hook
    ]
    assert timeouts
    assert all(1 <= timeout <= 60 for timeout in timeouts)


def test_hooks_register_failure_and_prompt_events():
    """Hook 注册本身属于公开合同：失败输出与用户粘贴的错误召回，成功输出不召回。"""
    hooks_path = PLUGIN_DIR / "hooks" / "hooks.json"
    hooks = json.loads(hooks_path.read_text(encoding="utf-8"))["hooks"]

    entry = hooks["PostToolUseFailure"][0]
    assert "Bash" in entry["matcher"]
    assert "PowerShell" in entry["matcher"]
    assert any("bugdb_check.js" in hook["command"] for hook in entry["hooks"])
    assert any(
        "bugdb_prompt.js" in hook["command"]
        for entry in hooks["UserPromptSubmit"] for hook in entry["hooks"]
    )
    assert "PostToolUse" in hooks, "成功输出的查库行为按原设计保留"


PROMPT_HOOK = str(PLUGIN_DIR / "hooks" / "js" / "bugdb_check" / "bugdb_prompt.js")


def _run_prompt_hook(prompt: str, home_dir, **env_overrides):
    env = _hook_env(home_dir)
    env.update(env_overrides)
    return subprocess.run(
        [NODE, PROMPT_HOOK],
        input=json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": prompt}),
        capture_output=True, text=True, encoding="utf-8", env=env, timeout=10,
    )


@skip_no_node
def test_prompt_hook_without_error_line_is_silent(tmp_path):
    """普通提示零输出，不打扰对话。"""
    res = _run_prompt_hook("帮我重构一下这个函数", tmp_path)
    assert res.returncode == 0
    assert res.stdout == ""


@skip_no_node
def test_prompt_hook_recalls_pasted_error(tmp_path):
    """用户粘贴的错误行命中知识库 → 注入 [BUGDB_MATCH]。"""
    seeded_id = _seed_record(
        tmp_path,
        context="error LNK2019: unresolved external symbol foo",
        cause="missing definition",
        content="define foo or link the lib",
    )
    res = _run_prompt_hook("链接失败了：\nmain.obj : error LNK2019: unresolved external symbol foo", tmp_path)
    hso = json.loads(res.stdout)["hookSpecificOutput"]
    assert hso["hookEventName"] == "UserPromptSubmit"
    assert f"id={seeded_id}" in hso["additionalContext"]


@skip_no_node
def test_prompt_hook_distinguishes_no_hit_from_failure(tmp_path):
    """无命中与召回失败必须给出不同提示：失败不能被表述为“没有历史记录”。"""
    prompt = "构建报错 fatal error C1083: Cannot open include file"
    no_hit = json.loads(_run_prompt_hook(prompt, tmp_path).stdout)
    assert "没有命中" in no_hit["hookSpecificOutput"]["additionalContext"]

    failed = json.loads(_run_prompt_hook(
        prompt, tmp_path, BUGDB_PYTHON=str(tmp_path / "no-such-python")).stdout)
    ctx = failed["hookSpecificOutput"]["additionalContext"]
    assert "召回未完成" in ctx
    assert "没有命中" not in ctx
