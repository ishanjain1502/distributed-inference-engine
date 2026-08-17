import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from bench_lib.capacity import (  # noqa: E402
    CapacityThresholds,
    admission_fail,
    admission_pass,
    compute_capacity_verdict,
    format_tweet_line,
    level_fail_any,
    median_stats_peaks,
    median_summary,
    physical_fail,
    physical_fail_heuristic,
    physical_pass,
    print_capacity_report,
    refine_band,
    refine_levels,
    slo_fail,
    slo_pass,
)


def _summary(
    *,
    error_rate: float = 0.0,
    reject_rate: float = 0.0,
    ttft_p95_ms: float | None = 1000.0,
) -> dict:
    return {
        "attempts": 10,
        "histogram": {},
        "ttft_p50_ms": 500.0,
        "ttft_p95_ms": ttft_p95_ms,
        "mean_tokens_per_s": 10.0,
        "aggregate_tps": 1.0,
        "error_rate": error_rate,
        "reject_rate": reject_rate,
    }


def test_admission_fail_at_threshold():
    t = CapacityThresholds(reject_rate_admission=0.10)
    assert admission_fail(_summary(reject_rate=0.10), t)
    assert not admission_fail(_summary(reject_rate=0.09), t)


def test_slo_fail_on_error_and_ttft():
    t = CapacityThresholds(max_error_rate=0.05, max_p95_ttft_ms=30_000.0)
    assert slo_fail(_summary(error_rate=0.06), t)
    assert slo_fail(_summary(ttft_p95_ms=30_001.0), t)
    assert not slo_fail(_summary(error_rate=0.04, ttft_p95_ms=20_000.0), t)


def test_physical_heuristic_without_503():
    t = CapacityThresholds(physical_error_rate_heuristic=0.25)
    peaks = {"max_session_capacity_pct": 10.0, "max_kv_cache_capacity_pct": 10.0}
    assert physical_fail_heuristic(_summary(error_rate=0.25, reject_rate=0.0), t)
    assert not physical_fail(
        _summary(error_rate=0.24, reject_rate=0.0), peaks, t
    )


def test_level_fail_any_combines_signals():
    t = CapacityThresholds()
    peaks = {"max_session_capacity_pct": 0.0, "max_kv_cache_capacity_pct": 0.0}
    assert not level_fail_any(_summary(), peaks, t)
    assert level_fail_any(_summary(reject_rate=0.5), peaks, t)


def test_median_summary():
    a = _summary(error_rate=0.0, reject_rate=0.0)
    b = _summary(error_rate=0.2, reject_rate=0.1)
    med = median_summary([a, b])
    assert med["error_rate"] == 0.1
    assert med["reject_rate"] == 0.05


def test_median_stats_peaks():
    med = median_stats_peaks(
        [
            {"max_session_capacity_pct": 10.0, "max_kv_cache_capacity_pct": 20.0},
            {"max_session_capacity_pct": 30.0, "max_kv_cache_capacity_pct": 40.0},
        ]
    )
    assert med["max_session_capacity_pct"] == 20.0
    assert med["max_kv_cache_capacity_pct"] == 30.0


def test_refine_band_and_levels():
    t = CapacityThresholds()
    coarse = [
        {
            "concurrency": 4,
            "summary": _summary(),
            "stats_peaks": {"max_session_capacity_pct": 0.0, "max_kv_cache_capacity_pct": 0.0},
        },
        {
            "concurrency": 8,
            "summary": _summary(error_rate=0.5),
            "stats_peaks": {"max_session_capacity_pct": 0.0, "max_kv_cache_capacity_pct": 0.0},
        },
    ]
    last_pass, first_fail = refine_band(coarse, t)
    assert last_pass == 4
    assert first_fail == 8
    assert refine_levels(last_pass, first_fail, 1) == [5, 6, 7, 8]


def test_compute_capacity_verdict():
    t = CapacityThresholds()
    levels = [
        {
            "concurrency": 4,
            "summary": _summary(),
            "stats_peaks": {"max_session_capacity_pct": 0.0, "max_kv_cache_capacity_pct": 0.0},
        },
        {
            "concurrency": 8,
            "summary": _summary(reject_rate=0.2, error_rate=0.3, ttft_p95_ms=50_000.0),
            "stats_peaks": {"max_session_capacity_pct": 95.0, "max_kv_cache_capacity_pct": 0.0},
        },
    ]
    verdict = compute_capacity_verdict(levels, t)
    assert verdict["admission_concurrency"] == 4
    assert verdict["slo_concurrency"] == 4
    assert verdict["physical_concurrency"] == 4
    assert verdict["admission_found"] is True


def test_pass_helpers():
    t = CapacityThresholds()
    peaks = {"max_session_capacity_pct": 0.0, "max_kv_cache_capacity_pct": 0.0}
    s = _summary()
    assert admission_pass(s, t)
    assert slo_pass(s, t)
    assert physical_pass(s, peaks, t)


def test_format_tweet_line():
    verdict = {
        "slo_concurrency": 4,
        "admission_concurrency": None,
        "physical_concurrency": 6,
    }
    env = {"ram_gb": 8, "alive_worker_count": 2}
    workload = {"model": "tinyllama-1.1b"}
    line = format_tweet_line(verdict, env, workload)
    assert "slo=4" in line
    assert "admission=none" in line
    assert "physical=6" in line
    assert "8GB" in line


def test_print_capacity_report_includes_tweet_line(capsys):
    payload = {
        "environment": {"cpu": "test-cpu", "alive_worker_count": 2},
        "thresholds": {},
        "phases": {"coarse": [], "refine": []},
        "capacity": {"notes": []},
        "tweet_line": "CAPACITY slo=4 admission=none physical=6",
    }
    print_capacity_report(payload)
    captured = capsys.readouterr()
    assert "CAPACITY slo=4" in captured.out
