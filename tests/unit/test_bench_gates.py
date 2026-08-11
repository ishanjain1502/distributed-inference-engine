import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import pytest
from bench_lib.gates import evaluate_gates, parse_fail_on


def test_parse_fail_on_empty():
    assert parse_fail_on(None) == {}
    assert parse_fail_on("") == {}


def test_parse_fail_on_valid():
    assert parse_fail_on("error_rate=0.1,p95_ttft_ms=10000") == {
        "error_rate": 0.1,
        "p95_ttft_ms": 10000.0,
    }


def test_parse_fail_on_unknown_key():
    with pytest.raises(ValueError, match="unknown"):
        parse_fail_on("latency=1")


def test_evaluate_gates_pass_and_fail():
    summary = {
        "error_rate": 0.05,
        "reject_rate": 0.0,
        "ttft_p95_ms": 500.0,
    }
    assert evaluate_gates(summary, {"error_rate": 0.1}) == []
    failures = evaluate_gates(summary, {"error_rate": 0.01, "p95_ttft_ms": 100.0})
    assert len(failures) == 2

