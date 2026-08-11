#!/usr/bin/env python3
"""Benchmark and stress-test the inference coordinator.

Usage:
  python scripts/bench.py --mode bench --concurrency 4 --requests 20
  python scripts/bench.py --mode stress --max-concurrency 32 --step 4
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow `python scripts/bench.py` without installing a package
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bench_lib.gates import evaluate_gates, parse_fail_on
from bench_lib.metrics import RequestResult, aggregate
from bench_lib.runner import run_fixed, run_stress

DEFAULT_PROMPT = "Write one short sentence about the ocean."


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Inference engine bench/stress tool")
    p.add_argument("--mode", choices=("bench", "stress"), required=True)
    p.add_argument("--base-url", default="http://localhost:1337")
    p.add_argument("--model", default="tinyllama-1.1b")
    p.add_argument("--prompt", default=DEFAULT_PROMPT)
    p.add_argument("--prompt-file", default=None)
    p.add_argument("--max-tokens", type=int, default=50)
    p.add_argument("--timeout-s", type=float, default=120.0)
    p.add_argument("--out", default=None, help="Write JSON results to this path")
    p.add_argument("--fail-on", default=None, help="e.g. error_rate=0.1,p95_ttft_ms=10000")

    # bench
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--requests", type=int, default=20)

    # stress
    p.add_argument("--max-concurrency", type=int, default=32)
    p.add_argument("--step", type=int, default=4)
    p.add_argument("--requests-per-step", type=int, default=16)
    p.add_argument("--stop-reject-rate", type=float, default=0.5)
    return p


def resolve_prompt(args: argparse.Namespace) -> str:
    if args.prompt_file:
        return Path(args.prompt_file).read_text(encoding="utf-8")
    return args.prompt


def print_summary(title: str, summary: dict) -> None:
    print(f"\n=== {title} ===")
    print(f"attempts: {summary['attempts']}")
    print(f"histogram: {summary['histogram']}")
    print(f"ttft_p50_ms: {summary['ttft_p50_ms']}")
    print(f"ttft_p95_ms: {summary['ttft_p95_ms']}")
    print(f"mean_tokens_per_s: {summary['mean_tokens_per_s']}")
    print(f"aggregate_tps: {summary['aggregate_tps']}")
    print(f"error_rate: {summary['error_rate']:.4f}")
    print(f"reject_rate: {summary['reject_rate']:.4f}")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        gates = parse_fail_on(args.fail_on)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    prompt = resolve_prompt(args)
    config = {k: getattr(args, k) for k in vars(args)}
    config["prompt"] = prompt
    levels: list[dict] = []
    results: list[RequestResult]
    wall: float

    try:
        if args.mode == "bench":
            results, wall = asyncio.run(
                run_fixed(
                    base_url=args.base_url,
                    prompt=prompt,
                    model=args.model,
                    max_tokens=args.max_tokens,
                    timeout_s=args.timeout_s,
                    concurrency=args.concurrency,
                    requests=args.requests,
                )
            )
        else:
            levels, results, wall = asyncio.run(
                run_stress(
                    base_url=args.base_url,
                    prompt=prompt,
                    model=args.model,
                    max_tokens=args.max_tokens,
                    timeout_s=args.timeout_s,
                    step=args.step,
                    max_concurrency=args.max_concurrency,
                    requests_per_step=args.requests_per_step,
                    stop_reject_rate=args.stop_reject_rate,
                )
            )
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    summary = aggregate(results, wall)
    print(f"mode: {args.mode}")
    print(f"wall_clock_s: {wall:.3f}")
    if levels:
        print("\n=== stress levels ===")
        knee: int | None = None
        soft_stopped = False
        for i, level in enumerate(levels):
            s = level["summary"]
            print(
                f"concurrency={level['concurrency']}: "
                f"reject_rate={s['reject_rate']:.3f} "
                f"error_rate={s['error_rate']:.3f} "
                f"ttft_p50={s['ttft_p50_ms']} "
                f"agg_tps={s['aggregate_tps']}"
            )
            if s["reject_rate"] >= args.stop_reject_rate:
                soft_stopped = True
                knee = levels[i - 1]["concurrency"] if i > 0 else None
                break
        if soft_stopped:
            if knee is not None:
                print(f"knee (last level before soft stop): {knee}")
            else:
                print("knee: soft stop at first level (no prior level)")
        elif levels:
            knee = levels[-1]["concurrency"]
            print(f"knee: completed full ramp (max={knee})")

    print_summary("overall", summary)

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "mode": args.mode,
        "config": config,
        "summary": summary,
        "levels": levels,
        "requests": [r.to_dict() for r in results],
    }
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"\nwrote {out_path}")

    failures = evaluate_gates(summary, gates)
    if failures:
        print("\nGATE FAILURES:", file=sys.stderr)
        for msg in failures:
            print(f"  - {msg}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
