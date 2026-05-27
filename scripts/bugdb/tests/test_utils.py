from datetime import datetime
from pathlib import Path
from bugdb import utils

def test_now_iso_roundtrip():
    s = utils.now_iso()
    dt = utils.parse_iso(s)
    assert isinstance(dt, datetime)

def test_safe_json_loads_ok():
    assert utils.safe_json_loads('[1,2,3]') == [1, 2, 3]

def test_safe_json_loads_bad():
    assert utils.safe_json_loads('not json') is None

def test_to_json_array():
    assert utils.to_json_array(['a', 'b']) == '["a", "b"]'

def test_truncate_short():
    assert utils.truncate('abc', 10) == 'abc'

def test_truncate_long():
    out = utils.truncate('a' * 300, 10)
    assert len(out) <= 13
    assert out.endswith('...')

def test_comma_split_empty():
    assert utils.comma_split('') == []

def test_comma_split_basic():
    assert utils.comma_split('a, b ,c') == ['a', 'b', 'c']

def test_comma_join():
    assert utils.comma_join(['a', 'b']) == 'a,b'

def test_expand_path(monkeypatch, tmp_path):
    monkeypatch.setenv('FOO', str(tmp_path))
    result = utils.expand_path('$FOO/x')
    assert result == tmp_path / 'x'
