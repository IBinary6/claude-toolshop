import os
from pathlib import Path
from bugdb import config

_DEFAULT_DB = Path.home() / '.claude' / 'bugdb' / 'bugs.db'


def test_default_path(monkeypatch):
    monkeypatch.delenv('BUGDB_PATH', raising=False)
    monkeypatch.delenv('BUGDB_HOME', raising=False)
    assert config.get_db_path() == _DEFAULT_DB

def test_env_override(monkeypatch, tmp_path):
    monkeypatch.delenv('BUGDB_HOME', raising=False)
    monkeypatch.setenv('BUGDB_PATH', str(tmp_path / 'x.db'))
    assert config.get_db_path() == tmp_path / 'x.db'

def test_explicit_arg_wins(monkeypatch, tmp_path):
    monkeypatch.setenv('BUGDB_PATH', str(tmp_path / 'env.db'))
    assert config.get_db_path(tmp_path / 'arg.db') == tmp_path / 'arg.db'

def test_empty_string_env_falls_back(monkeypatch):
    monkeypatch.setenv('BUGDB_PATH', '')
    monkeypatch.delenv('BUGDB_HOME', raising=False)
    assert config.get_db_path() == _DEFAULT_DB

def test_empty_string_explicit_falls_back(monkeypatch, tmp_path):
    monkeypatch.delenv('BUGDB_PATH', raising=False)
    monkeypatch.delenv('BUGDB_HOME', raising=False)
    assert config.get_db_path('') == _DEFAULT_DB
