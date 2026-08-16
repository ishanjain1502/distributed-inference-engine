from __future__ import annotations

import asyncio
import hashlib
import statistics
from dataclasses import asdict, dataclass
from typing import Any

import httpx

from .environment import collect_environment
from .metrics import RequestResult, aggregate
from .ramp import concurrency_levels
from .runner import run_fixed
from .stats_poller import StatsPoller, empty_stats_peaks, merge_stats_peaks


@dataclass(frozen=True)
class CapacityThresholds:
    reject_rate_admission: float = 0.10
    max_error_rate: float = 0.05
    max_p95_ttft_ms: float = 30_000.0
    max_reject_rate_slo: float = 0.01
    capacity_pct_threshold: float = 90.0
    physical_error_rate_heuristic: float = 0.25


def admission_fail(summary: dict[str, Any], thresholds: CapacityThresholds) -> bool:
    return summary["reject_rate"] >= thresholds.reject_rate_admission


def slo_fail(summary: dict[str, Any], thresholds: CapacityThresholds) -> bool:
    if summary["error_rate"] > thresholds.max_error_rate:
        return True
    if summary["reject_rate"] > thresholds.max_reject_rate_slo:
        return True
    p95 = summary.get("ttft_p95_ms")
    if p95 is not None and p95 > thresholds.max_p95_ttft_ms:
        return True
    return False


def physical_fail_stats(
    stats_peaks: dict[str, float], thresholds: CapacityThresholds
) -> bool:
    session_pct = stats_peaks.get("max_session_capacity_pct", 0.0)
    kv_pct = stats_peaks.get("max_kv_cache_capacity_pct", 0.0)
    return (
        session_pct >= thresholds.capacity_pct_threshold
        or kv_pct >= thresholds.capacity_pct_threshold
    )


def physical_fail_heuristic(
    summary: dict[str, Any], thresholds: CapacityThresholds
) -> bool:
    return (
        summary["reject_rate"] == 0.0
        and summary["error_rate"] >= thresholds.physical_error_rate_heuristic
    )


def physical_fail(
    summary: dict[str, Any],
    stats_peaks: dict[str, float],
    thresholds: CapacityThresholds,
) -> bool:
    return physical_fail_stats(stats_peaks, thresholds) or physical_fail_heuristic(
        summary, thresholds
    )


def level_fail_any(
    summary: dict[str, Any],
    stats_peaks: dict[str, float],
    thresholds: CapacityThresholds,
) -> bool:
    return (
        admission_fail(summary, thresholds)
        or slo_fail(summary, thresholds)
        or physical_fail(summary, stats_peaks, thresholds)
    )


def admission_pass(summary: dict[str, Any], thresholds: CapacityThresholds) -> bool:
    return not admission_fail(summary, thresholds)


def slo_pass(summary: dict[str, Any], thresholds: CapacityThresholds) -> bool:
    return not slo_fail(summary, thresholds)


def physical_pass(
    summary: dict[str, Any],
    stats_peaks: dict[str, float],
    thresholds: CapacityThresholds,
) -> bool:
    return not physical_fail(summary, stats_peaks, thresholds)


def median_summary(summaries: list[dict[str, Any]]) -> dict[str, Any]:
    if not summaries:
        raise ValueError("summaries must not be empty")
    if len(summaries) == 1:
        return dict(summaries[0])

    def med(key: str) -> float | None:
        vals = [s[key] for s in summaries if s.get(key) is not None]
        if not vals:
            return None
        return float(statistics.median(vals))

    attempts = int(statistics.median([s["attempts"] for s in summaries]))
    return {
        "attempts": attempts,
        "histogram": summaries[-1]["histogram"],
        "ttft_p50_ms": med("ttft_p50_ms"),
        "ttft_p95_ms": med("ttft_p95_ms"),
        "mean_tokens_per_s": med("mean_tokens_per_s"),
        "aggregate_tps": med("aggregate_tps"),
        "error_rate": med("error_rate") or 0.0,
        "reject_rate": med("reject_rate") or 0.0,
    }


def median_stats_peaks(peak_list: list[dict[str, float]]) -> dict[str, float]:
    if not peak_list:
        return empty_stats_peaks()
    return {
        "max_session_capacity_pct": float(
            statistics.median([p.get("max_session_capacity_pct", 0.0) for p in peak_list])
        ),
        "max_kv_cache_capacity_pct": float(
            statistics.median(
                [p.get("max_kv_cache_capacity_pct", 0.0) for p in peak_list]
            )
        ),
    }


def refine_band(
    coarse_levels: list[dict[str, Any]], thresholds: CapacityThresholds
) -> tuple[int | None, int | None]:
    """Return (last_pass, first_fail) concurrency from coarse phase."""
    last_pass: int | None = None
    first_fail: int | None = None
    for level in coarse_levels:
        summary = level["summary"]
        stats_peaks = level.get("stats_peaks", empty_stats_peaks())
        conc = int(level["concurrency"])
        if level_fail_any(summary, stats_peaks, thresholds):
            if first_fail is None:
                first_fail = conc
        else:
            last_pass = conc
    return last_pass, first_fail


def refine_levels(last_pass: int | None, first_fail: int | None, step: int) -> list[int]:
    if last_pass is None or first_fail is None:
        return []
    if first_fail <= last_pass + step:
        return list(range(last_pass + 1, first_fail + 1))
    levels: list[int] = []
    n = last_pass + step
    while n < first_fail:
        levels.append(n)
        n += step
    levels.append(first_fail)
    return levels


def highest_passing_concurrency(
    levels: list[dict[str, Any]],
    thresholds: CapacityThresholds,
    pass_fn,
) -> int | None:
    best: int | None = None
    for level in levels:
        summary = level["summary"]
        stats_peaks = level.get("stats_peaks", empty_stats_peaks())
        conc = int(level["concurrency"])
        if pass_fn(summary, stats_peaks, thresholds):
            best = conc
    return best


def compute_capacity_verdict(
    all_levels: list[dict[str, Any]], thresholds: CapacityThresholds
) -> dict[str, Any]:
    notes: list[str] = []

    admission = highest_passing_concurrency(
        all_levels, thresholds, lambda s, _p, t: admission_pass(s, t)
    )
    slo = highest_passing_concurrency(
        all_levels, thresholds, lambda s, _p, t: slo_pass(s, t)
    )
    physical = highest_passing_concurrency(
        all_levels, thresholds, lambda s, p, t: physical_pass(s, p, t)
    )

    admission_found = any(
        admission_fail(level["summary"], thresholds) for level in all_levels
    )
    if admission is None and not admission_found:
        notes.append("admission: no reject knee observed in tested range")

    for level in all_levels:
        summary = level["summary"]
        stats_peaks = level.get("stats_peaks", empty_stats_peaks())
        conc = level["concurrency"]
        if physical_fail_heuristic(summary, thresholds):
            notes.append(
                f"physical: timeouts_without_503 suspected at concurrency {conc}"
            )
        if physical_fail_stats(stats_peaks, thresholds):
            notes.append(
                f"physical: stats capacity >= {thresholds.capacity_pct_threshold}% "
                f"at concurrency {conc}"
            )

    return {
        "admission_concurrency": admission,
        "slo_concurrency": slo,
        "physical_concurrency": physical,
        "admission_found": admission_found,
        "notes": notes,
    }


def build_workload_block(
    *,
    model: str,
    prompt: str,
    max_tokens: int,
    timeout_s: float,
) -> dict[str, Any]:
    return {
        "model": model,
        "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        "max_tokens": max_tokens,
        "timeout_s": timeout_s,
    }


def format_tweet_line(
    verdict: dict[str, Any], environment: dict[str, Any], workload: dict[str, Any]
) -> str:
    def fmt_cap(value: int | None) -> str:
        return str(value) if value is not None else "none"

    ram = environment.get("ram_gb")
    ram_part = f"{int(ram)}GB" if isinstance(ram, (int, float)) else "CPU"
    workers = environment.get("alive_worker_count") or environment.get("worker_count")
    worker_part = f"{workers} workers" if workers is not None else "workers"
    model = workload.get("model", "model")

    return (
        f"CAPACITY slo={fmt_cap(verdict.get('slo_concurrency'))} "
        f"admission={fmt_cap(verdict.get('admission_concurrency'))} "
        f"physical={fmt_cap(verdict.get('physical_concurrency'))} "
        f"({ram_part} CPU, {worker_part}, {model})"
    )


async def _run_level_once(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    prompt: str,
    model: str,
    max_tokens: int,
    timeout_s: float,
    concurrency: int,
    requests: int,
    stats_poll_interval_s: float,
) -> tuple[list[RequestResult], float, dict[str, float], dict[str, Any]]:
    poller = StatsPoller(client, base_url, stats_poll_interval_s)
    await poller.start()
    try:
        results, wall = await run_fixed(
            base_url=base_url,
            prompt=prompt,
            model=model,
            max_tokens=max_tokens,
            timeout_s=timeout_s,
            concurrency=concurrency,
            requests=requests,
            client=client,
        )
    finally:
        stats_peaks = await poller.stop()
    summary = aggregate(results, wall)
    return results, wall, stats_peaks, summary


async def _cooldown(seconds: float) -> None:
    if seconds > 0:
        await asyncio.sleep(seconds)


async def run_capacity(
    *,
    base_url: str,
    prompt: str,
    model: str,
    max_tokens: int,
    timeout_s: float,
    max_concurrency: int,
    coarse_step: int,
    refine_step: int,
    requests_per_level: int,
    refine_repeats: int,
    cooldown_s: float,
    stats_poll_interval_s: float,
    thresholds: CapacityThresholds,
) -> dict[str, Any]:
    coarse_out: list[dict[str, Any]] = []
    refine_out: list[dict[str, Any]] = []
    all_request_results: list[RequestResult] = []

    pool_size = max(max_concurrency, 1) + 10
    limits = httpx.Limits(max_connections=pool_size)
    async with httpx.AsyncClient(limits=limits) as client:
        from .client import check_coordinator

        await check_coordinator(client, base_url)
        environment = await collect_environment(client, base_url)
        workload = build_workload_block(
            model=model, prompt=prompt, max_tokens=max_tokens, timeout_s=timeout_s
        )

        coarse_levels_list = concurrency_levels(coarse_step, max_concurrency)
        stopped_early = False

        for i, conc in enumerate(coarse_levels_list):
            results, wall, stats_peaks, summary = await _run_level_once(
                client,
                base_url=base_url,
                prompt=prompt,
                model=model,
                max_tokens=max_tokens,
                timeout_s=timeout_s,
                concurrency=conc,
                requests=requests_per_level,
                stats_poll_interval_s=stats_poll_interval_s,
            )
            all_request_results.extend(results)
            coarse_out.append(
                {
                    "concurrency": conc,
                    "runs": 1,
                    "wall_clock_s": wall,
                    "summary": summary,
                    "stats_peaks": stats_peaks,
                }
            )
            if level_fail_any(summary, stats_peaks, thresholds):
                stopped_early = True
                break
            if i < len(coarse_levels_list) - 1:
                await _cooldown(cooldown_s)

        last_pass, first_fail = refine_band(coarse_out, thresholds)
        for conc in refine_levels(last_pass, first_fail, refine_step):
            run_summaries: list[dict[str, Any]] = []
            run_peaks: list[dict[str, float]] = []
            total_wall = 0.0
            for repeat_idx in range(refine_repeats):
                if repeat_idx > 0:
                    await _cooldown(cooldown_s)
                results, wall, stats_peaks, summary = await _run_level_once(
                    client,
                    base_url=base_url,
                    prompt=prompt,
                    model=model,
                    max_tokens=max_tokens,
                    timeout_s=timeout_s,
                    concurrency=conc,
                    requests=requests_per_level,
                    stats_poll_interval_s=stats_poll_interval_s,
                )
                all_request_results.extend(results)
                run_summaries.append(summary)
                run_peaks.append(stats_peaks)
                total_wall += wall

            summary_median = median_summary(run_summaries)
            stats_peaks_median = median_stats_peaks(run_peaks)
            refine_out.append(
                {
                    "concurrency": conc,
                    "runs": refine_repeats,
                    "wall_clock_s": total_wall,
                    "summary": summary_median,
                    "stats_peaks": stats_peaks_median,
                    "run_summaries": run_summaries,
                }
            )
            await _cooldown(cooldown_s)

    all_levels = coarse_out + refine_out
    verdict = compute_capacity_verdict(all_levels, thresholds)
    tweet_line = format_tweet_line(verdict, environment, workload)

    return {
        "mode": "capacity",
        "capacity": verdict,
        "thresholds": asdict(thresholds),
        "workload": workload,
        "environment": environment,
        "phases": {
            "coarse": coarse_out,
            "refine": refine_out,
            "coarse_stopped_early": stopped_early,
        },
        "tweet_line": tweet_line,
        "requests": [r.to_dict() for r in all_request_results],
    }


def print_capacity_report(payload: dict[str, Any]) -> None:
    env = payload.get("environment", {})
    print("\n=== capacity probe ===")
    ram = env.get("ram_gb")
    cpu = env.get("cpu") or "unknown CPU"
    workers = env.get("alive_worker_count") or env.get("worker_count") or "?"
    git_sha = env.get("git_sha")
    git_part = f", git {str(git_sha)[:8]}" if git_sha else ""
    ram_part = f"{ram}GB RAM, " if ram is not None else ""
    print(f"environment: {ram_part}{cpu}, {workers} workers{git_part}")

    thresholds = CapacityThresholds(**payload.get("thresholds", {}))

    def status_line(level: dict[str, Any]) -> str:
        summary = level["summary"]
        stats_peaks = level.get("stats_peaks", empty_stats_peaks())
        flags: list[str] = []
        if admission_fail(summary, thresholds):
            flags.append("admission")
        if slo_fail(summary, thresholds):
            flags.append("slo")
        if physical_fail(summary, stats_peaks, thresholds):
            flags.append("physical")
        status = "FAIL " + "+".join(flags) if flags else "OK"
        p95 = summary.get("ttft_p95_ms")
        p95_s = f"{p95 / 1000:.1f}s" if isinstance(p95, (int, float)) else "n/a"
        kv = stats_peaks.get("max_kv_cache_capacity_pct", 0.0)
        return (
            f"  c={level['concurrency']:>2}  {status:<20} "
            f"err={summary['error_rate'] * 100:5.1f}%  "
            f"reject={summary['reject_rate'] * 100:5.1f}%  "
            f"ttft_p95={p95_s:<8} kv_pct={kv:5.1f}%"
        )

    coarse = payload.get("phases", {}).get("coarse", [])
    if coarse:
        print("\nphase 1 (coarse):")
        for level in coarse:
            print(status_line(level))

    refine = payload.get("phases", {}).get("refine", [])
    if refine:
        print("\nphase 2 (refine, median of repeats):")
        for level in refine:
            print(status_line(level))

    cap = payload.get("capacity", {})

    def fmt(v: Any) -> str:
        return str(v) if v is not None else "—"

    print(
        f"\nCAPACITY admission={fmt(cap.get('admission_concurrency'))}  "
        f"slo={fmt(cap.get('slo_concurrency'))}  "
        f"physical={fmt(cap.get('physical_concurrency'))}"
    )
    for note in cap.get("notes", []):
        print(f"  note: {note}")
    print(f"\n{tweet_line}")
