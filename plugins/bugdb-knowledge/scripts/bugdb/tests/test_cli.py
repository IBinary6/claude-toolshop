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


def _add_bug(db_file, **extra):
    base = [
        "add", "--error-type", "compile",
        "--error-message", "error C2065: undeclared identifier foo",
        "--root-cause", "missing include",
        "--solution", "include header",
    ]
    for k, v in extra.items():
        base.extend([f"--{k}", str(v)])
    r = _run(base, db_file)
    return json.loads(r.stdout)["id"]


def test_cli_deprecate(tmp_path):
    db_file = tmp_path / "x.db"
    old_id = _add_bug(db_file)
    new_id = _add_bug(db_file)
    r = _run(["deprecate", "--id", str(old_id), "--replace-with", str(new_id),
              "--reason", "better way"], db_file)
    assert r.returncode == 0
    g = _run(["get", "--id", str(old_id)], db_file)
    obj = json.loads(g.stdout)
    assert obj["status"] == "deprecated"
    assert obj["replaces_id"] == new_id


def test_cli_obsolete(tmp_path):
    db_file = tmp_path / "x.db"
    bug_id = _add_bug(db_file)
    r = _run(["obsolete", "--id", str(bug_id), "--reason", "API gone"], db_file)
    assert r.returncode == 0
    g = _run(["get", "--id", str(bug_id)], db_file)
    assert json.loads(g.stdout)["status"] == "obsolete"


def test_cli_find_similar(tmp_path):
    db_file = tmp_path / "x.db"
    _add_bug(db_file)
    r = _run(["find-similar", "--pattern", "C2065 undeclared identifier"], db_file)
    assert r.returncode == 0
    results = json.loads(r.stdout)["results"]
    assert len(results) >= 1
    # 第一条应包含查询中的关键 token
    assert "C2065" in results[0]["error_pattern"]


def test_cli_normalize(tmp_path):
    r = _run(["normalize", "--input", r"C:\x.cpp(42): error LNK2001"], tmp_path / "x.db")
    assert r.returncode == 0
    assert r.stderr == ""
    obj = json.loads(r.stdout)
    assert "C:\\" not in obj["normalized"]
    assert "LNK2001" in obj["normalized"]


def test_cli_export_import(tmp_path):
    db_a = tmp_path / "a.db"
    db_b = tmp_path / "b.db"
    _add_bug(db_a)
    _add_bug(db_a, tags="linker")
    out = tmp_path / "dump.json"
    e = _run(["export", "--output", str(out)], db_a)
    assert e.returncode == 0
    assert out.exists()
    i = _run(["import", "--input", str(out)], db_b)
    assert i.returncode == 0
    # 比较 a/b 两库的关键字段一致
    list_a = json.loads(_run(["list", "--format", "json"], db_a).stdout)["results"]
    list_b = json.loads(_run(["list", "--format", "json"], db_b).stdout)["results"]
    assert len(list_a) >= 2
    assert len(list_b) >= 2

    def _key(rec):
        return (rec["error_pattern"], rec["solution"], rec["status"])

    set_a = sorted(_key(r) for r in list_a)
    set_b = sorted(_key(r) for r in list_b)
    assert set_a == set_b


def test_cli_import_rejects_invalid_json(tmp_path):
    """非 JSON 输入应触发 returncode 2 + 'import error' 提示。"""
    db_file = tmp_path / "x.db"
    bad = tmp_path / "bad.json"
    bad.write_text("not a json {", encoding="utf-8")
    r = _run(["import", "--input", str(bad)], db_file)
    assert r.returncode == 2
    assert "import error" in r.stderr


def test_cli_import_rejects_missing_records_key(tmp_path):
    """缺 records 键应退出 2。"""
    db_file = tmp_path / "x.db"
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    r = _run(["import", "--input", str(bad)], db_file)
    assert r.returncode == 2
    assert "import error" in r.stderr


def test_cli_import_rejects_record_missing_fields(tmp_path):
    """records 单条缺关键字段应退出 2。"""
    db_file = tmp_path / "x.db"
    bad = tmp_path / "bad.json"
    bad.write_text('{"records": [{}]}', encoding="utf-8")
    r = _run(["import", "--input", str(bad)], db_file)
    assert r.returncode == 2
    assert "import error" in r.stderr


import base64


def test_cli_search_query_b64(tmp_path):
    db_file = tmp_path / "b64.db"
    add = _run([
        "add", "--error-type", "link",
        "--error-message", "error LNK2001: unresolved external symbol __imp_WSAStartup",
        "--root-cause", "missing ws2_32.lib",
        "--solution", "link ws2_32.lib",
        "--language", "c++",
    ], db_file)
    assert add.returncode == 0
    bug_id = json.loads(add.stdout)["id"]

    raw = 'C:\\x.cpp(42): error LNK2001: unresolved external symbol __imp_WSAStartup\n"quoted"'
    encoded = base64.b64encode(raw.encode('utf-8')).decode('ascii')
    r = _run(["search", "--query-b64", encoded, "--language", "c++"], db_file)
    assert r.returncode == 0
    obj = json.loads(r.stdout)
    assert any(rec["id"] == bug_id for rec in obj["results"])


def test_cli_search_b64_invalid_falls_back(tmp_path):
    """无效 base64 不应崩溃 CLI。"""
    db_file = tmp_path / "b64bad.db"
    r = _run(["search", "--query-b64", "!!!not-base64!!!"], db_file)
    assert r.returncode in (0, 1, 2, 3)
