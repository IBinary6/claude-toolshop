import os
from pathlib import Path
from bugdb import config

def test_default_path(monkeypatch):
    monkeypatch.delenv('BUGDB_PATH', raising=False)
    assert config.get_db_path() == Path.home() / '.claude' / 'bugs.db'

def test_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv('BUGDB_PATH', str(tmp_path / 'x.db'))
    assert config.get_db_path() == tmp_path / 'x.db'

def test_explicit_arg_wins(monkeypatch, tmp_path):
    monkeypatch.setenv('BUGDB_PATH', str(tmp_path / 'env.db'))
    assert config.get_db_path(tmp_path / 'arg.db') == tmp_path / 'arg.db'
