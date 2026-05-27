"""共享 pytest fixtures。"""
import pytest
from bugdb.db import BugDB


@pytest.fixture
def db(tmp_path, monkeypatch):
    """每个测试一个干净的 DB（用临时文件，避开 :memory: WAL 限制）。"""
    db_file = tmp_path / "test_bugs.db"
    monkeypatch.setenv("BUGDB_PATH", str(db_file))
    instance = BugDB(db_path=db_file)
    yield instance
