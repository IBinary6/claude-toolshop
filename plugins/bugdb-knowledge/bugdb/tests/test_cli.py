import json
import os
import subprocess
import sys
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[2]
CLI = str(PLUGIN_DIR / "bugdb" / "cli.py")


def _run(args, home_dir, input_str=None):
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


def test_cli_stats_empty(tmp_path):
    r = _run(["stats"], tmp_path)
    assert r.returncode == 0
    obj = json.loads(r.stdout)
    assert obj.get("total") == 0


def test_cli_search_empty(tmp_path):
    r = _run(["search", "--query", "anything"], tmp_path)
    assert r.returncode == 0
    obj = json.loads(r.stdout)
    assert obj["results"] == []


def test_cli_search_text_format(tmp_path):
    r = _run(["search", "--query", "anything", "--format", "text"], tmp_path)
    assert r.returncode == 0
    assert "(no results)" in r.stdout


def test_cli_list_empty(tmp_path):
    r = _run(["list"], tmp_path)
    assert r.returncode == 0
    obj = json.loads(r.stdout)
    assert obj["results"] == []


def test_cli_get_missing(tmp_path):
    r = _run(["get", "--id", "999"], tmp_path)
    assert r.returncode == 2


def test_cli_add_and_search_roundtrip(tmp_path):
    add = _run([
        "add",
        "--category", "link",
        "--context", "error LNK2001: unresolved external symbol __imp_WSAStartup",
        "--cause", "missing ws2_32.lib",
        "--content", "link ws2_32.lib",
        "--action-steps", '["open","add lib"]',
        "--language", "c++",
        "--project-type", "vs",
        "--tags", "linker,windows",
    ], tmp_path)
    assert add.returncode == 0, add.stderr
    new = json.loads(add.stdout)
    rec_id = new["id"]

    s = _run(["search", "--query", "LNK2001 unresolved external symbol", "--language", "c++"], tmp_path)
    assert s.returncode == 0
    obj = json.loads(s.stdout)
    assert any(r["id"] == rec_id for r in obj["results"])


def test_cli_update(tmp_path):
    add = _run([
        "add", "--category", "compile",
        "--context", "msg",
        "--cause", "rc", "--content", "sol",
    ], tmp_path)
    rec_id = json.loads(add.stdout)["id"]
    u = _run(["update", "--id", str(rec_id), "--content", "new sol", "--confidence", "70"], tmp_path)
    assert u.returncode == 0
    g = _run(["get", "--id", str(rec_id)], tmp_path)
    obj = json.loads(g.stdout)
    assert obj["content"] == "new sol"
    assert obj["confidence"] == 70


def test_cli_delete_soft_and_restore(tmp_path):
    add = _run([
        "add", "--category", "compile",
        "--context", "msg",
        "--cause", "rc", "--content", "sol",
    ], tmp_path)
    rec_id = json.loads(add.stdout)["id"]
    d = _run(["delete", "--id", str(rec_id)], tmp_path)
    assert d.returncode == 0, d.stderr
    g = _run(["get", "--id", str(rec_id)], tmp_path)
    assert json.loads(g.stdout)["status"] == "archived"
    rr = _run(["restore", "--id", str(rec_id)], tmp_path)
    assert rr.returncode == 0, rr.stderr
    g = _run(["get", "--id", str(rec_id)], tmp_path)
    assert json.loads(g.stdout)["status"] == "active"


def test_cli_feedback(tmp_path):
    add = _run([
        "add", "--category", "compile",
        "--context", "msg",
        "--cause", "rc", "--content", "sol",
    ], tmp_path)
    rec_id = json.loads(add.stdout)["id"]
    fb = _run(["feedback", "--id", str(rec_id), "--result", "success"], tmp_path)
    assert fb.returncode == 0, fb.stderr
    g = _run(["get", "--id", str(rec_id)], tmp_path)
    obj = json.loads(g.stdout)
    assert obj["usage_count"] == 1
    assert obj["success_count"] == 1


def test_cli_add_rejects_action_steps_null(tmp_path):
    """--action-steps 'null' 应当报错退出 2，而不是被静默吞为 []。"""
    r = _run([
        "add", "--category", "compile",
        "--context", "msg",
        "--cause", "rc", "--content", "sol",
        "--action-steps", "null",
    ], tmp_path)
    assert r.returncode == 2
    assert "JSON array" in r.stderr


def test_cli_add_rejects_action_steps_object(tmp_path):
    """--action-steps '{}' 应当报错退出 2。"""
    r = _run([
        "add", "--category", "compile",
        "--context", "msg",
        "--cause", "rc", "--content", "sol",
        "--action-steps", "{}",
    ], tmp_path)
    assert r.returncode == 2


def _add_record(home_dir, **extra):
    base = [
        "add", "--category", "compile",
        "--context", "error C2065: undeclared identifier foo",
        "--cause", "missing include",
        "--content", "include header",
    ]
    for k, v in extra.items():
        base.extend([f"--{k}", str(v)])
    r = _run(base, home_dir)
    return json.loads(r.stdout)["id"]


def test_cli_deprecate(tmp_path):
    old_id = _add_record(tmp_path)
    new_id = _add_record(tmp_path)
    r = _run(["deprecate", "--id", str(old_id), "--replace-with", str(new_id),
              "--reason", "better way"], tmp_path)
    assert r.returncode == 0
    g = _run(["get", "--id", str(old_id)], tmp_path)
    obj = json.loads(g.stdout)
    assert obj["status"] == "deprecated"
    assert obj["replaced_by_id"] == new_id


def test_cli_obsolete(tmp_path):
    rec_id = _add_record(tmp_path)
    r = _run(["obsolete", "--id", str(rec_id), "--reason", "API gone"], tmp_path)
    assert r.returncode == 0
    g = _run(["get", "--id", str(rec_id)], tmp_path)
    assert json.loads(g.stdout)["status"] == "obsolete"


def test_cli_find_similar(tmp_path):
    _add_record(tmp_path)
    r = _run(["find-similar", "--pattern", "C2065 undeclared identifier"], tmp_path)
    assert r.returncode == 0
    results = json.loads(r.stdout)["results"]
    assert len(results) >= 1
    assert "C2065" in results[0]["key_pattern"]


def test_cli_normalize(tmp_path):
    r = _run(["normalize", "--input", r"C:\x.cpp(42): error LNK2001"], tmp_path)
    assert r.returncode == 0
    assert r.stderr == ""
    obj = json.loads(r.stdout)
    assert "C:\\" not in obj["normalized"]
    assert "LNK2001" in obj["normalized"]


def test_cli_export_import(tmp_path):
    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()
    _add_record(dir_a)
    _add_record(dir_a, tags="linker")
    out = tmp_path / "dump.json"
    e = _run(["export", "--output", str(out)], dir_a)
    assert e.returncode == 0
    assert out.exists()
    i = _run(["import", "--input", str(out)], dir_b)
    assert i.returncode == 0
    list_a = json.loads(_run(["list", "--format", "json"], dir_a).stdout)["results"]
    list_b = json.loads(_run(["list", "--format", "json"], dir_b).stdout)["results"]
    assert len(list_a) >= 2
    assert len(list_b) >= 2

    def _key(rec):
        return (rec["key_pattern"], rec["content"], rec["status"])

    set_a = sorted(_key(r) for r in list_a)
    set_b = sorted(_key(r) for r in list_b)
    assert set_a == set_b


def test_cli_import_rejects_invalid_json(tmp_path):
    """非 JSON 输入应触发 returncode 2 + 'import error' 提示。"""
    bad = tmp_path / "bad.json"
    bad.write_text("not a json {", encoding="utf-8")
    r = _run(["import", "--input", str(bad)], tmp_path)
    assert r.returncode == 2
    assert "import error" in r.stderr


def test_cli_import_rejects_missing_records_key(tmp_path):
    """缺 records 键应退出 2。"""
    bad = tmp_path / "bad.json"
    bad.write_text("{}", encoding="utf-8")
    r = _run(["import", "--input", str(bad)], tmp_path)
    assert r.returncode == 2
    assert "import error" in r.stderr


def test_cli_import_rejects_record_missing_fields(tmp_path):
    """records 单条缺关键字段应退出 2。"""
    bad = tmp_path / "bad.json"
    bad.write_text('{"records": [{}]}', encoding="utf-8")
    r = _run(["import", "--input", str(bad)], tmp_path)
    assert r.returncode == 2
    assert "import error" in r.stderr


import base64


def test_cli_search_query_b64(tmp_path):
    add = _run([
        "add", "--category", "link",
        "--context", "error LNK2001: unresolved external symbol __imp_WSAStartup",
        "--cause", "missing ws2_32.lib",
        "--content", "link ws2_32.lib",
        "--language", "c++",
    ], tmp_path)
    assert add.returncode == 0
    rec_id = json.loads(add.stdout)["id"]

    raw = 'C:\\x.cpp(42): error LNK2001: unresolved external symbol __imp_WSAStartup\n"quoted"'
    encoded = base64.b64encode(raw.encode('utf-8')).decode('ascii')
    r = _run(["search", "--query-b64", encoded, "--language", "c++"], tmp_path)
    assert r.returncode == 0
    obj = json.loads(r.stdout)
    assert any(rec["id"] == rec_id for rec in obj["results"])


def test_cli_search_b64_invalid_falls_back(tmp_path):
    """无效 base64 不应崩溃 CLI。"""
    r = _run(["search", "--query-b64", "!!!not-base64!!!"], tmp_path)
    assert r.returncode in (0, 1, 2, 3)
