import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from bench_lib.client import parse_sse_data_line


def test_parse_sse_token_line():
    line = 'data: {"token":"Hi","finished":false}'
    data = parse_sse_data_line(line)
    assert data == {"token": "Hi", "finished": False}


def test_parse_sse_ignores_non_data():
    assert parse_sse_data_line(": keep-alive") is None
    assert parse_sse_data_line("") is None


def test_parse_sse_bad_json_returns_none():
    assert parse_sse_data_line("data: {not-json") is None
