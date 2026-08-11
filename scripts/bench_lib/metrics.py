from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class RequestResult:
    status: int
    ttft_ms: float | None
    tokens: int
    duration_ms: float
    error: str | None
    rejected: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def percentile(sorted_values: list[float], p: float) -> float | None:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    # nearest-rank (Excel style): k = ceil(p/100 * n), 1-indexed
    from math import ceil

    k = int(ceil(p / 100.0 * len(sorted_values)))
    k = max(1, min(len(sorted_values), k))
    return sorted_values[k - 1]


def status_bucket(status: int) -> str:
    if status == 0:
        return "client_error"
    if status in (200, 503, 502, 409):
        return str(status)
    if 400 <= status < 500:
        return "4xx"
    return "other"


def per_request_tps(result: RequestResult) -> float | None:
    if result.tokens <= 1 or result.ttft_ms is None:
        return None
    decode_s = (result.duration_ms - result.ttft_ms) / 1000.0
    if decode_s <= 0:
        return None
    return (result.tokens - 1) / decode_s


def aggregate(results: list[RequestResult], wall_clock_s: float) -> dict[str, Any]:
    histogram = {
        "200": 0,
        "503": 0,
        "502": 0,
        "409": 0,
        "4xx": 0,
        "other": 0,
        "client_error": 0,
    }
    ttfts: list[float] = []
    tps_samples: list[float] = []
    success_tokens = 0
    rejects = 0
    errors = 0

    for r in results:
        bucket = status_bucket(r.status)
        # ensure bucket key exists
        if bucket not in histogram:
            histogram[bucket] = 0
        histogram[bucket] += 1
        if r.rejected or r.status == 503:
            rejects += 1
        if r.status != 200 or r.error is not None:
            errors += 1
        if r.ttft_ms is not None:
            ttfts.append(r.ttft_ms)
        tps = per_request_tps(r)
        if tps is not None:
            tps_samples.append(tps)
        if r.status == 200 and r.error is None:
            success_tokens += r.tokens

    ttfts_sorted = sorted(ttfts)
    attempts = len(results)
    return {
        "attempts": attempts,
        "histogram": histogram,
        "ttft_p50_ms": percentile(ttfts_sorted, 50),
        "ttft_p95_ms": percentile(ttfts_sorted, 95),
        "mean_tokens_per_s": (sum(tps_samples) / len(tps_samples) if tps_samples else None),
        "aggregate_tps": (success_tokens / wall_clock_s if wall_clock_s > 0 else None),
        "error_rate": errors / attempts if attempts else 0.0,
        "reject_rate": rejects / attempts if attempts else 0.0,
    }

