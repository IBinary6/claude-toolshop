"""normalizer.normalize 清洗规则测试。

验证意图：清洗后的字符串能让不同路径/行号/地址下的相同错误产生一致的 pattern，
从而保证 BugDB 的命中率。
"""
from bugdb.normalizer import normalize, extract_keywords


def test_windows_path_stripped():
    raw = r"C:\Users\dev\project\main.cpp(42): error LNK2001"
    out = normalize(raw)
    assert "C:\\" not in out
    assert "LNK2001" in out


def test_unix_path_stripped():
    raw = "/home/u/src/main.cpp:42:1: error: bad"
    out = normalize(raw)
    assert "/home" not in out


def test_line_number_stripped():
    raw = "main.cpp(42): error"
    assert "(42)" not in normalize(raw)


def test_line_keyword_stripped():
    raw = "at line 42 of file"
    assert "line 42" not in normalize(raw)


def test_memory_address_stripped():
    raw = "crash at 0xDEADBEEF in module"
    assert "0xDEADBEEF" not in normalize(raw)


def test_timestamp_stripped():
    raw = "2026-05-27T10:30:00 error"
    out = normalize(raw)
    assert "2026" not in out


def test_uuid_stripped():
    raw = "request 550e8400-e29b-41d4-a716-446655440000 failed"
    out = normalize(raw)
    assert "550e8400" not in out


def test_bare_filename_stripped():
    """裸文件名（如 main.cpp）应被清洗掉。"""
    raw = "main.cpp: error C2065"
    out = normalize(raw)
    assert "main.cpp" not in out
    assert "C2065" in out


def test_whitespace_compressed():
    raw = "error    LNK2001   unresolved"
    assert "    " not in normalize(raw)


def test_preserves_error_code():
    assert "LNK2001" in normalize("foo LNK2001 bar")
    assert "C2065" in normalize("foo C2065 bar")


def test_same_error_different_paths_normalize_equal():
    """命中率核心：不同路径下相同错误应产生相同 pattern。"""
    a = normalize(r"C:\Users\alice\proj\main.cpp(42): error LNK2001 unresolved")
    b = normalize(r"D:\dev\other\src\main.cpp(99): error LNK2001 unresolved")
    assert a == b


def test_extract_error_code():
    kw = extract_keywords("error LNK2001 unresolved")
    assert "LNK2001" in kw


def test_extract_rust_error_code():
    kw = extract_keywords("error[E0308]: mismatched types")
    assert "error[E0308]" in kw


def test_extract_namespace_symbol():
    kw = extract_keywords("undefined reference to std::vector::push_back")
    assert "std::vector::push_back" in kw


def test_extract_double_underscore_symbol():
    kw = extract_keywords("__imp_WSAStartup unresolved")
    assert "__imp_WSAStartup" in kw


def test_extract_known_phrase():
    kw = extract_keywords("unresolved external symbol foo")
    assert "unresolved external symbol" in kw


def test_extract_fallback_to_input():
    kw = extract_keywords("just some plain words")
    assert kw == "just some plain words"
