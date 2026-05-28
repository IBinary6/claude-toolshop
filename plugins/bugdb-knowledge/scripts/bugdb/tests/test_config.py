from pathlib import Path
from bugdb import config

_DEFAULT_DB = Path.home() / '.claude' / 'bugdb' / 'bugs.db'


def test_default_path(monkeypatch):
    monkeypatch.delenv('BUGDB_HOME', raising=False)
    assert config.get_db_path() == _DEFAULT_DB

def test_bugdb_home_override(monkeypatch, tmp_path):
    monkeypatch.setenv('BUGDB_HOME', str(tmp_path))
    assert config.get_db_path() == tmp_path / 'bugs.db'

def test_explicit_arg_wins(monkeypatch, tmp_path):
    monkeypatch.setenv('BUGDB_HOME', str(tmp_path / 'env_dir'))
    assert config.get_db_path(tmp_path / 'arg.db') == tmp_path / 'arg.db'

def test_empty_string_env_falls_back(monkeypatch):
    monkeypatch.setenv('BUGDB_HOME', '')
    assert config.get_db_path() == _DEFAULT_DB

def test_empty_string_explicit_falls_back(monkeypatch):
    monkeypatch.delenv('BUGDB_HOME', raising=False)
    assert config.get_db_path('') == _DEFAULT_DB
