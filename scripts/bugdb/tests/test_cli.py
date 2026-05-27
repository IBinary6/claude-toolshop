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
