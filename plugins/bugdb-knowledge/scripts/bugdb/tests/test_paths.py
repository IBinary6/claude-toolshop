"""paths.py 的测试覆盖。

覆盖项：
- get_bugdb_home(): 默认路径 / BUGDB_HOME 覆盖
- get_db_path(): 完整优先级链 explicit > BUGDB_HOME > config.json > default
- get_log_path(): 优先级链 BUGDB_HOME > config.json > default
- _read_config(): 文件不存在 / 非法 JSON / 正常读取
"""
import json
from pathlib import Path

import pytest

from bugdb import paths
from bugdb.paths import (
    _read_config,
    get_bugdb_home,
    get_db_path,
    get_log_path,
)


# ---------- _read_config ----------


class TestReadConfig:
    """_read_config 读取 config.json 的行为。"""

    def test_file_not_exist(self, tmp_path, monkeypatch):
        """config.json 不存在时返回空 dict。"""
        monkeypatch.setattr(paths, "_CONFIG_FILE", tmp_path / "nonexistent.json")
        assert _read_config() == {}

    def test_invalid_json(self, tmp_path, monkeypatch):
        """config.json 包含非法 JSON 时返回空 dict。"""
        bad_file = tmp_path / "config.json"
        bad_file.write_text("{invalid", encoding="utf-8")
        monkeypatch.setattr(paths, "_CONFIG_FILE", bad_file)
        assert _read_config() == {}

    def test_valid_json(self, tmp_path, monkeypatch):
        """config.json 正常读取。"""
        cfg_file = tmp_path / "config.json"
        data = {"db_path": "/custom/bugs.db", "log_path": "/custom/bugdb.log"}
        cfg_file.write_text(json.dumps(data), encoding="utf-8")
        monkeypatch.setattr(paths, "_CONFIG_FILE", cfg_file)
        assert _read_config() == data


# ---------- get_bugdb_home ----------


class TestGetBugdbHome:
    """get_bugdb_home 的默认值与环境变量覆盖。"""

    def test_default(self, monkeypatch):
        """无 BUGDB_HOME 时返回默认 ~/.claude/bugdb。"""
        monkeypatch.delenv("BUGDB_HOME", raising=False)
        result = get_bugdb_home()
        assert result == Path.home() / ".claude" / "bugdb"

    def test_env_override(self, tmp_path, monkeypatch):
        """BUGDB_HOME 环境变量覆盖默认路径。"""
        monkeypatch.setenv("BUGDB_HOME", str(tmp_path / "custom"))
        result = get_bugdb_home()
        assert result == tmp_path / "custom"

    def test_empty_env_falls_back(self, monkeypatch):
        """BUGDB_HOME 为空字符串时回退到默认。"""
        monkeypatch.setenv("BUGDB_HOME", "")
        result = get_bugdb_home()
        assert result == Path.home() / ".claude" / "bugdb"

    def test_whitespace_env_falls_back(self, monkeypatch):
        """BUGDB_HOME 仅含空白时回退到默认。"""
        monkeypatch.setenv("BUGDB_HOME", "   ")
        result = get_bugdb_home()
        assert result == Path.home() / ".claude" / "bugdb"


# ---------- get_db_path ----------


class TestGetDbPath:
    """get_db_path 的完整优先级链测试。"""

    def test_explicit_wins(self, tmp_path, monkeypatch):
        """explicit 参数优先级最高。"""
        monkeypatch.setenv("BUGDB_HOME", str(tmp_path))
        explicit = tmp_path / "explicit.db"
        result = get_db_path(explicit=explicit)
        assert result == explicit

    def test_explicit_str(self, tmp_path, monkeypatch):
        """explicit 接受字符串类型。"""
        monkeypatch.delenv("BUGDB_HOME", raising=False)
        result = get_db_path(explicit=str(tmp_path / "str.db"))
        assert result == tmp_path / "str.db"

    def test_explicit_empty_string_skipped(self, monkeypatch):
        """explicit 为空字符串时视为未提供，回退到下一级。"""
        monkeypatch.delenv("BUGDB_HOME", raising=False)
        monkeypatch.setattr(paths, "_CONFIG_FILE", Path("/nonexistent/config.json"))
        result = get_db_path(explicit="")
        assert result == Path.home() / ".claude" / "bugdb" / "bugs.db"

    def test_bugdb_home_second(self, tmp_path, monkeypatch):
        """BUGDB_HOME 是第二优先级。"""
        monkeypatch.setenv("BUGDB_HOME", str(tmp_path))
        result = get_db_path()
        assert result == tmp_path / "bugs.db"

    def test_config_json_third(self, tmp_path, monkeypatch):
        """config.json 中的 db_path 是第三优先级。"""
        monkeypatch.delenv("BUGDB_HOME", raising=False)
        cfg_file = tmp_path / "config.json"
        custom_db = tmp_path / "from_config.db"
        cfg_file.write_text(json.dumps({"db_path": str(custom_db)}), encoding="utf-8")
        monkeypatch.setattr(paths, "_CONFIG_FILE", cfg_file)
        result = get_db_path()
        assert result == custom_db

    def test_default_fallback(self, monkeypatch):
        """所有来源均未提供时返回默认路径。"""
        monkeypatch.delenv("BUGDB_HOME", raising=False)
        monkeypatch.setattr(paths, "_CONFIG_FILE", Path("/nonexistent/config.json"))
        result = get_db_path()
        assert result == Path.home() / ".claude" / "bugdb" / "bugs.db"

    def test_bugdb_home_takes_precedence_over_config(self, tmp_path, monkeypatch):
        """BUGDB_HOME 优先于 config.json。"""
        home_dir = tmp_path / "home"
        monkeypatch.setenv("BUGDB_HOME", str(home_dir))
        cfg_file = tmp_path / "config.json"
        cfg_file.write_text(
            json.dumps({"db_path": str(tmp_path / "config.db")}),
            encoding="utf-8",
        )
        monkeypatch.setattr(paths, "_CONFIG_FILE", cfg_file)
        result = get_db_path()
        assert result == home_dir / "bugs.db"


# ---------- get_log_path ----------


class TestGetLogPath:
    """get_log_path 的优先级链测试。"""

    def test_bugdb_home_first(self, tmp_path, monkeypatch):
        """BUGDB_HOME 是最高优先级。"""
        monkeypatch.setenv("BUGDB_HOME", str(tmp_path))
        result = get_log_path()
        assert result == tmp_path / "bugdb.log"

    def test_config_json_second(self, tmp_path, monkeypatch):
        """config.json 中的 log_path 是第二优先级。"""
        monkeypatch.delenv("BUGDB_HOME", raising=False)
        cfg_file = tmp_path / "config.json"
        custom_log = tmp_path / "custom.log"
        cfg_file.write_text(
            json.dumps({"log_path": str(custom_log)}), encoding="utf-8"
        )
        monkeypatch.setattr(paths, "_CONFIG_FILE", cfg_file)
        result = get_log_path()
        assert result == custom_log

    def test_default_fallback(self, monkeypatch):
        """所有来源均未提供时返回默认路径。"""
        monkeypatch.delenv("BUGDB_HOME", raising=False)
        monkeypatch.setattr(paths, "_CONFIG_FILE", Path("/nonexistent/config.json"))
        result = get_log_path()
        assert result == Path.home() / ".claude" / "bugdb" / "bugdb.log"

    def test_bugdb_home_takes_precedence_over_config(self, tmp_path, monkeypatch):
        """BUGDB_HOME 优先于 config.json。"""
        home_dir = tmp_path / "home"
        monkeypatch.setenv("BUGDB_HOME", str(home_dir))
        cfg_file = tmp_path / "config.json"
        cfg_file.write_text(
            json.dumps({"log_path": str(tmp_path / "config.log")}),
            encoding="utf-8",
        )
        monkeypatch.setattr(paths, "_CONFIG_FILE", cfg_file)
        result = get_log_path()
        assert result == home_dir / "bugdb.log"
