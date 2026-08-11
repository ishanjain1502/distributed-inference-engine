import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from bench_lib.metrics import (  # noqa: E402
    RequestResult,
    aggregate,
    percentile,
    per_request_tps,
    status_bucket,
)


def test_percentile_p50_p95():
    vals = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert percentile(vals, 50) == 30.0
    assert percentile(vals, 95) == 50.0
    assert percentile([], 50) is None


def test_status_bucket():
    assert status_bucket(200) == "200"
    assert status_bucket(503) == "503"
    assert status_bucket(502) == "502"
    assert status_bucket(409) == "409"
    assert status_bucket(400) == "4xx"
    assert status_bucket(500) == "other"
    assert status_bucket(0) == "client_error"


def test_per_request_tps():
    ok = RequestResult(
        status=200, ttft_ms=100.0, tokens=11, duration_ms=1100.0, error=None, rejected=False
    )
    # (11-1) / ((1100-100)/1000) = 10 / 1.0 = 10
    assert per_request_tps(ok) == 10.0
    short = RequestResult(
        status=200, ttft_ms=50.0, tokens=1, duration_ms=50.0, error=None, rejected=False
    )
    assert per_request_tps(short) is None


def test_aggregate_rates_and_histogram():
    results = [
        RequestResult(200, 10.0, 5, 100.0, None, False),
        RequestResult(503, None, 0, 20.0, None, True),
        RequestResult(0, None, 0, 5.0, "timeout", False),
    ]
    summary = aggregate(results, wall_clock_s=2.0)
    assert summary["attempts"] == 3
    assert summary["histogram"]["200"] == 1
    assert summary["histogram"]["503"] == 1
    assert summary["histogram"]["client_error"] == 1
    assert summary["reject_rate"] == 1 / 3
    assert summary["error_rate"] == 2 / 3  # 503 + client_error
    assert summary["aggregate_tps"] == 5 / 2.0
    assert summary["ttft_p50_ms"] == 10.0

