import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[2]
CLI = str(SCRIPTS_DIR / "bugdb" / "cli.py")


def _run(args, env_db, input_str=None):
    env = os.environ.copy()
    env["BUGDB_PATH"] = str(env_db)
    env["PYTHONPATH"] = str(SCRIPTS_DIR) + os.pathsep + env.get("PYTHONPATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run(
        [sys.executable, CLI, *args],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        input=input_str,
    )


def test_cli_stats_empty(tmp_path):
    r = _run(["stats"], tmp_path / "x.db")
    assert r.returncode == 0
    obj = json.loads(r.stdout)
    assert obj.get("total") == 0


def test_cli_search_empty(tmp_path):
    r = _run(["search", "--query", "anything"], tmp_path / "x.db")
    assert r.returncode == 0
    obj = json.loads(r.stdout)
    assert obj["results"] == []


def test_cli_search_text_format(tmp_path):
    r = _run(["search", "--query", "anything", "--format", "text"], tmp_path / "x.db")
    assert r.returncode == 0
    assert "(no results)" in r.stdout


def test_cli_list_empty(tmp_path):
    r = _run(["list"], tmp_path / "x.db")
    assert r.returncode == 0
    obj = json.loads(r.stdout)
    assert obj["results"] == []


def test_cli_get_missing(tmp_path):
    r = _run(["get", "--id", "999"], tmp_path / "x.db")
    assert r.returncode == 2  # RecordNotFound 退出码契约


def test_cli_add_and_search_roundtrip(tmp_path):
    db_file = tmp_path / "rt.db"
    add = _run([
        "add",
        "--error-type", "link",
        "--error-message", "error LNK2001: unresolved external symbol __imp_WSAStartup",
        "--root-cause", "missing ws2_32.lib",
        "--solution", "link ws2_32.lib",
        "--solution-steps", '["open","add lib"]',
        "--language", "c++",
        "--project-type", "vs",
        "--tags", "linker,windows",
    ], db_file)
    assert add.returncode == 0, add.stderr
    new = json.loads(add.stdout)
    bug_id = new["id"]

    s = _run(["search", "--query", "LNK2001 unresolved external symbol", "--language", "c++"], db_file)
    assert s.returncode == 0
    obj = json.loads(s.stdout)
    assert any(r["id"] == bug_id for r in obj["results"])


def test_cli_update(tmp_path):
    db_file = tmp_path / "u.db"
    add = _run([
        "add", "--error-type", "compile",
        "--error-message", "msg",
        "--root-cause", "rc", "--solution", "sol",
    ], db_file)
    bug_id = json.loads(add.stdout)["id"]
    u = _run(["update", "--id", str(bug_id), "--solution", "new sol", "--confidence", "70"], db_file)
    assert u.returncode == 0
    g = _run(["get", "--id", str(bug_id)], db_file)
    obj = json.loads(g.stdout)
    assert obj["solution"] == "new sol"
    assert obj["confidence"] == 70


def test_cli_delete_soft_and_restore(tmp_path):
    db_file = tmp_path / "d.db"
    add = _run([
        "add", "--error-type", "compile",
        "--error-message", "msg",
        "--root-cause", "rc", "--solution", "sol",
    ], db_file)
    bug_id = json.loads(add.stdout)["id"]
    d = _run(["delete", "--id", str(bug_id)], db_file)
    assert d.returncode == 0, d.stderr
    g = _run(["get", "--id", str(bug_id)], db_file)
    assert json.loads(g.stdout)["status"] == "archived"
    rr = _run(["restore", "--id", str(bug_id)], db_file)
    assert rr.returncode == 0, rr.stderr
    g = _run(["get", "--id", str(bug_id)], db_file)
    assert json.loads(g.stdout)["status"] == "active"


def test_cli_feedback(tmp_path):
    db_file = tmp_path / "f.db"
    add = _run([
        "add", "--error-type", "compile",
        "--error-message", "msg",
        "--root-cause", "rc", "--solution", "sol",
    ], db_file)
    bug_id = json.loads(add.stdout)["id"]
    fb = _run(["feedback", "--id", str(bug_id), "--result", "success"], db_file)
    assert fb.returncode == 0, fb.stderr
    g = _run(["get", "--id", str(bug_id)], db_file)
    obj = json.loads(g.stdout)
    assert obj["usage_count"] == 1
    assert obj["success_count"] == 1


def test_cli_add_rejects_solution_steps_null(tmp_path):
    """--solution-steps 'null' 应当报错退出 2，而不是被静默吞为 []。"""
    db_file = tmp_path / "n.db"
    r = _run([
        "add", "--error-type", "compile",
        "--error-message", "msg",
        "--root-cause", "rc", "--solution", "sol",
        "--solution-steps", "null",
    ], db_file)
    assert r.returncode == 2
    assert "JSON array" in r.stderr


def test_cli_add_rejects_solution_steps_object(tmp_path):
    """--solution-steps '{}' 应当报错退出 2。"""
    db_file = tmp_path / "o.db"
    r = _run([
        "add", "--error-type", "compile",
        "--error-message", "msg",
        "--root-cause", "rc", "--solution", "sol",
        "--solution-steps", "{}",
    ], db_file)
    assert r.returncode == 2
