"""端到端：模拟真实使用流（add → search hit → feedback → deprecate → 替代链 → export/import）。"""
import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[2]
CLI = str(SCRIPTS_DIR / "bugdb" / "cli.py")


def _run(args, home_dir):
    env = os.environ.copy()
    env["BUGDB_HOME"] = str(home_dir)
    env["PYTHONPATH"] = str(SCRIPTS_DIR) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(
        [sys.executable, CLI, *args],
        env=env, capture_output=True, text=True, encoding="utf-8",
    )


def test_e2e_full_lifecycle(tmp_path):
    home = tmp_path / "e2e"
    home.mkdir()

    # 1. 空库 stats
    r = _run(["stats"], home)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["total"] == 0

    # 2. add
    add = _run([
        "add", "--error-type", "link",
        "--error-message", "main.cpp(10): error LNK2001: unresolved external symbol __imp_WSAStartup",
        "--root-cause", "missing ws2_32.lib in linker input",
        "--solution", "add ws2_32.lib to linker additional dependencies",
        "--solution-steps", '["open project props","Linker > Input","add ws2_32.lib"]',
        "--language", "c++", "--project-type", "vs", "--tags", "linker,windows",
    ], home)
    assert add.returncode == 0, add.stderr
    old_id = json.loads(add.stdout)["id"]

    # 3. search 命中（不同路径/行号 normalize 后仍命中）
    s = _run([
        "search", "--query",
        r"D:\other\proj.cpp(99): error LNK2001: unresolved external symbol __imp_WSAStartup",
        "--language", "c++",
    ], home)
    assert s.returncode == 0
    obj = json.loads(s.stdout)
    assert any(r_["id"] == old_id for r_ in obj["results"])

    # 4. feedback 成功
    fb = _run(["feedback", "--id", str(old_id), "--result", "success"], home)
    assert fb.returncode == 0
    g = json.loads(_run(["get", "--id", str(old_id)], home).stdout)
    assert g["success_count"] == 1

    # 5. add 替代方案 + deprecate 旧
    new_add = _run([
        "add", "--error-type", "link",
        "--error-message", "LNK2001 unresolved external symbol __imp_WSAStartup",
        "--root-cause", "missing lib via cmake",
        "--solution", "target_link_libraries(target ws2_32)",
        "--language", "c++", "--project-type", "cmake",
    ], home)
    assert new_add.returncode == 0
    new_id = json.loads(new_add.stdout)["id"]
    dep = _run(["deprecate", "--id", str(old_id), "--replace-with", str(new_id),
                "--reason", "cmake recommended"], home)
    assert dep.returncode == 0

    # 6. include-deprecated 搜索携带替代提示
    s2 = _run([
        "search", "--query", "LNK2001 __imp_WSAStartup",
        "--language", "c++", "--include-deprecated",
    ], home)
    assert s2.returncode == 0
    items = json.loads(s2.stdout)["results"]
    deprecated_hit = next((it for it in items if it["id"] == old_id), None)
    assert deprecated_hit is not None
    assert deprecated_hit.get("replacement_id") == new_id

    # 7. export/import roundtrip
    out = tmp_path / "dump.json"
    er = _run(["export", "--output", str(out)], home)
    assert er.returncode == 0
    home2 = tmp_path / "e2e2"
    home2.mkdir()
    ir = _run(["import", "--input", str(out)], home2)
    assert ir.returncode == 0
    lst = _run(["list", "--status", "all"], home2)
    assert lst.returncode == 0
    assert len(json.loads(lst.stdout)["results"]) >= 2
