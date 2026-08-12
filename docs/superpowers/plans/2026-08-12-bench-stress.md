# Benchmark & Stress Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `scripts/bench.py` — an async Python CLI with `bench` and `stress` modes that measure TTFT/TPS against `/coordinator/infer` and optionally write JSON / enforce gates.

**Architecture:** Thin CLI entrypoint delegates to a small `scripts/bench_lib/` package: pure metrics/gates (unit-tested), async SSE client (`httpx`), and runners for fixed-concurrency and ramp stress. No changes to coordinator/worker runtime.

**Tech Stack:** Python 3.10+, `httpx` (async), stdlib (`argparse`, `asyncio`, `json`, `uuid`, `statistics`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-bench-stress-design.md` — follow it; do not add slow-client, multi-turn, CSV, or CI.
- Entry point path must remain `scripts/bench.py` (callable as `python scripts/bench.py ...`).
- Each request uses a unique `conversation_id` (UUID).
- Default run is report-only (exit 0); `--fail-on` may exit 1.
- `503` is `rejected` for stress soft-stop; it also counts toward `error_rate` for gates.
- Do not replace or break `test_inference.py`.
- Commit only when the user explicitly asks (or at end of a completed task if they already approved commits for this work).

## File Structure

| Path | Responsibility |
|------|----------------|
| `scripts/requirements.txt` | Pin `httpx` for the bench tool |
| `scripts/bench_lib/__init__.py` | Re-exports used by CLI/tests |
| `scripts/bench_lib/metrics.py` | `RequestResult`, percentile, `aggregate`, status bucketing |
| `scripts/bench_lib/gates.py` | Parse `--fail-on`, evaluate gates |
| `scripts/bench_lib/ramp.py` | Build stress concurrency levels |
| `scripts/bench_lib/client.py` | Async SSE `infer_once` |
| `scripts/bench_lib/runner.py` | `run_fixed`, `run_stress`, health preflight |
| `scripts/bench.py` | argparse CLI → runners → print/JSON/gates → exit code |
| `tests/unit/test_bench_metrics.py` | Aggregate / percentile / tokens-per-sec |
| `tests/unit/test_bench_gates.py` | Gate parse + evaluate |
| `tests/unit/test_bench_ramp.py` | Ramp level list |
| `README.md` | Short “Benchmark & stress” subsection |

---

### Task 1: Metrics core (pure functions)

**Files:**
- Create: `scripts/bench_lib/__init__.py`
- Create: `scripts/bench_lib/metrics.py`
- Create: `tests/unit/test_bench_metrics.py`

**Interfaces:**
- Consumes: nothing (stdlib only)
- Produces:
  - `@dataclass RequestResult` with fields: `status: int`, `ttft_ms: float | None`, `tokens: int`, `duration_ms: float`, `error: str | None`, `rejected: bool`
  - `def percentile(sorted_values: list[float], p: float) -> float | None`
  - `def status_bucket(status: int) -> str` → one of `200`, `503`, `502`, `409`, `4xx`, `other`, `client_error`
  - `def per_request_tps(result: RequestResult) -> float | None`
  - `def aggregate(results: list[RequestResult], wall_clock_s: float) -> dict` with keys: `attempts`, `histogram`, `ttft_p50_ms`, `ttft_p95_ms`, `mean_tokens_per_s`, `aggregate_tps`, `error_rate`, `reject_rate`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/test_bench_metrics.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/test_bench_metrics.py -v`

Expected: FAIL (import error / module not found)

- [ ] **Step 3: Implement metrics**

Create `scripts/bench_lib/__init__.py` (can be empty or re-export later).

Create `scripts/bench_lib/metrics.py`:

```python
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
    # nearest-rank, 1-indexed
    k = max(1, min(len(sorted_values), int(round(p / 100.0 * len(sorted_values)))))
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
        histogram[status_bucket(r.status)] += 1
        if r.rejected or r.status == 503:
            rejects += 1
        if r.status != 200:
            errors += 1
        if r.ttft_ms is not None:
            ttfts.append(r.ttft_ms)
        tps = per_request_tps(r)
        if tps is not None:
            tps_samples.append(tps)
        if r.status == 200:
            success_tokens += r.tokens

    ttfts_sorted = sorted(ttfts)
    attempts = len(results)
    return {
        "attempts": attempts,
        "histogram": histogram,
        "ttft_p50_ms": percentile(ttfts_sorted, 50),
        "ttft_p95_ms": percentile(ttfts_sorted, 95),
        "mean_tokens_per_s": (
            sum(tps_samples) / len(tps_samples) if tps_samples else None
        ),
        "aggregate_tps": (
            success_tokens / wall_clock_s if wall_clock_s > 0 else None
        ),
        "error_rate": errors / attempts if attempts else 0.0,
        "reject_rate": rejects / attempts if attempts else 0.0,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/test_bench_metrics.py -v`

Expected: PASS (install pytest if missing: `pip install pytest`)

- [ ] **Step 5: Commit (only if user asked to commit)**

```bash
git add scripts/bench_lib/__init__.py scripts/bench_lib/metrics.py tests/unit/test_bench_metrics.py
git commit -m "bench: add metrics aggregation helpers for stress/benchmark CLI"
```

---

### Task 2: Gates and ramp helpers

**Files:**
- Create: `scripts/bench_lib/gates.py`
- Create: `scripts/bench_lib/ramp.py`
- Create: `tests/unit/test_bench_gates.py`
- Create: `tests/unit/test_bench_ramp.py`

**Interfaces:**
- Consumes: aggregate summary dict keys from Task 1
- Produces:
  - `ALLOWED_GATE_KEYS = {"error_rate", "p95_ttft_ms", "reject_rate"}`
  - `def parse_fail_on(spec: str | None) -> dict[str, float]` — empty dict if None/""; raise `ValueError` on unknown key or bad float
  - `def evaluate_gates(summary: dict, gates: dict[str, float]) -> list[str]` — list of human-readable failure messages (empty = pass)
  - `def concurrency_levels(step: int, max_concurrency: int) -> list[int]`

- [ ] **Step 1: Write the failing tests**

`tests/unit/test_bench_gates.py`:

```python
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
```

`tests/unit/test_bench_ramp.py`:

```python
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from bench_lib.ramp import concurrency_levels


def test_ramp_includes_max_even_if_not_multiple():
    assert concurrency_levels(step=8, max_concurrency=20) == [8, 16, 20]


def test_ramp_exact_multiple():
    assert concurrency_levels(step=4, max_concurrency=12) == [4, 8, 12]


def test_ramp_step_equals_max():
    assert concurrency_levels(step=5, max_concurrency=5) == [5]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/test_bench_gates.py tests/unit/test_bench_ramp.py -v`

Expected: FAIL (import errors)

- [ ] **Step 3: Implement gates and ramp**

`scripts/bench_lib/gates.py`:

```python
from __future__ import annotations

ALLOWED_GATE_KEYS = {"error_rate", "p95_ttft_ms", "reject_rate"}

_SUMMARY_KEY = {
    "error_rate": "error_rate",
    "reject_rate": "reject_rate",
    "p95_ttft_ms": "ttft_p95_ms",
}


def parse_fail_on(spec: str | None) -> dict[str, float]:
    if spec is None or spec.strip() == "":
        return {}
    gates: dict[str, float] = {}
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            raise ValueError(f"invalid fail-on item (expected key=value): {part!r}")
        key, raw = part.split("=", 1)
        key = key.strip()
        if key not in ALLOWED_GATE_KEYS:
            raise ValueError(f"unknown fail-on key: {key!r}")
        gates[key] = float(raw.strip())
    return gates


def evaluate_gates(summary: dict, gates: dict[str, float]) -> list[str]:
    failures: list[str] = []
    for key, limit in gates.items():
        summary_key = _SUMMARY_KEY[key]
        actual = summary.get(summary_key)
        if actual is None:
            failures.append(f"{key}: no value in summary (limit {limit})")
            continue
        if actual > limit:
            failures.append(f"{key}: {actual} > {limit}")
    return failures
```

`scripts/bench_lib/ramp.py`:

```python
from __future__ import annotations


def concurrency_levels(step: int, max_concurrency: int) -> list[int]:
    if step < 1:
        raise ValueError("step must be >= 1")
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be >= 1")
    levels: list[int] = []
    n = step
    while n < max_concurrency:
        levels.append(n)
        n += step
    levels.append(max_concurrency)
    return levels
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/test_bench_gates.py tests/unit/test_bench_ramp.py -v`

Expected: PASS

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add scripts/bench_lib/gates.py scripts/bench_lib/ramp.py tests/unit/test_bench_gates.py tests/unit/test_bench_ramp.py
git commit -m "bench: add fail-on gates and stress concurrency ramp helpers"
```

---

### Task 3: Async SSE client + runner

**Files:**
- Create: `scripts/requirements.txt`
- Create: `scripts/bench_lib/client.py`
- Create: `scripts/bench_lib/runner.py`
- Create: `tests/unit/test_bench_client_parse.py` (SSE line parsing only; no live server)

**Interfaces:**
- Consumes: `RequestResult` from metrics
- Produces:
  - `def parse_sse_data_line(line: str) -> dict | None` — if line starts with `data: `, JSON-load remainder; else None
  - `async def infer_once(client: httpx.AsyncClient, *, base_url: str, prompt: str, model: str, max_tokens: int, timeout_s: float) -> RequestResult`
  - `async def check_coordinator(client: httpx.AsyncClient, base_url: str) -> None` — GET `{base_url}/coordinator/health`; raise `RuntimeError` with clear message on failure
  - `async def run_fixed(...) -> tuple[list[RequestResult], float]` — returns results + wall_clock_s
  - `async def run_stress(...) -> tuple[list[dict], list[RequestResult], float]` — level summaries, all results, total wall_clock_s

- [ ] **Step 1: Write failing parse test**

`tests/unit/test_bench_client_parse.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/test_bench_client_parse.py -v`

Expected: FAIL

- [ ] **Step 3: Add dependency + implement client/runner**

`scripts/requirements.txt`:

```
httpx==0.28.1
```

Install: `pip install -r scripts/requirements.txt`

`scripts/bench_lib/client.py`:

```python
from __future__ import annotations

import json
import time
import uuid
from typing import Any

import httpx

from .metrics import RequestResult


def parse_sse_data_line(line: str) -> dict[str, Any] | None:
    if not line.startswith("data: "):
        return None
    raw = line[6:].strip()
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


async def infer_once(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    prompt: str,
    model: str,
    max_tokens: int,
    timeout_s: float,
) -> RequestResult:
    url = f"{base_url.rstrip('/')}/coordinator/infer"
    payload = {
        "conversation_id": str(uuid.uuid4()),
        "prompt": prompt,
        "model": model,
        "max_tokens": max_tokens,
    }
    start = time.perf_counter()
    ttft_ms: float | None = None
    tokens = 0
    try:
        async with client.stream(
            "POST",
            url,
            json=payload,
            timeout=timeout_s,
        ) as resp:
            status = resp.status_code
            if status != 200:
                # drain briefly for error body (optional)
                try:
                    await resp.aread()
                except Exception:
                    pass
                duration_ms = (time.perf_counter() - start) * 1000.0
                return RequestResult(
                    status=status,
                    ttft_ms=None,
                    tokens=0,
                    duration_ms=duration_ms,
                    error=None,
                    rejected=status == 503,
                )
            async for line in resp.aiter_lines():
                data = parse_sse_data_line(line)
                if data is None:
                    continue
                if "token" in data:
                    tokens += 1
                    if ttft_ms is None:
                        ttft_ms = (time.perf_counter() - start) * 1000.0
            duration_ms = (time.perf_counter() - start) * 1000.0
            return RequestResult(
                status=200,
                ttft_ms=ttft_ms,
                tokens=tokens,
                duration_ms=duration_ms,
                error=None,
                rejected=False,
            )
    except httpx.TimeoutException:
        duration_ms = (time.perf_counter() - start) * 1000.0
        return RequestResult(0, ttft_ms, tokens, duration_ms, "timeout", False)
    except httpx.ConnectError as e:
        duration_ms = (time.perf_counter() - start) * 1000.0
        return RequestResult(0, None, 0, duration_ms, f"connect: {e}", False)
    except Exception as e:
        duration_ms = (time.perf_counter() - start) * 1000.0
        return RequestResult(0, ttft_ms, tokens, duration_ms, str(e), False)


async def check_coordinator(client: httpx.AsyncClient, base_url: str) -> None:
    url = f"{base_url.rstrip('/')}/coordinator/health"
    try:
        resp = await client.get(url, timeout=5.0)
    except httpx.HTTPError as e:
        raise RuntimeError(
            f"Coordinator unreachable at {url}. Is it running? ({e})"
        ) from e
    if resp.status_code != 200:
        raise RuntimeError(
            f"Coordinator health check failed: HTTP {resp.status_code} from {url}"
        )
```

`scripts/bench_lib/runner.py`:

```python
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from .client import check_coordinator, infer_once
from .metrics import RequestResult, aggregate
from .ramp import concurrency_levels


async def run_fixed(
    *,
    base_url: str,
    prompt: str,
    model: str,
    max_tokens: int,
    timeout_s: float,
    concurrency: int,
    requests: int,
) -> tuple[list[RequestResult], float]:
    sem = asyncio.Semaphore(concurrency)
    results: list[RequestResult] = []

    async with httpx.AsyncClient() as client:
        await check_coordinator(client, base_url)

        async def one() -> RequestResult:
            async with sem:
                return await infer_once(
                    client,
                    base_url=base_url,
                    prompt=prompt,
                    model=model,
                    max_tokens=max_tokens,
                    timeout_s=timeout_s,
                )

        wall_start = time.perf_counter()
        results = list(await asyncio.gather(*[one() for _ in range(requests)]))
        wall_clock_s = time.perf_counter() - wall_start
    return results, wall_clock_s


async def run_stress(
    *,
    base_url: str,
    prompt: str,
    model: str,
    max_tokens: int,
    timeout_s: float,
    step: int,
    max_concurrency: int,
    requests_per_step: int,
    stop_reject_rate: float,
) -> tuple[list[dict[str, Any]], list[RequestResult], float]:
    levels_out: list[dict[str, Any]] = []
    all_results: list[RequestResult] = []
    total_start = time.perf_counter()

    async with httpx.AsyncClient() as client:
        await check_coordinator(client, base_url)

        for conc in concurrency_levels(step, max_concurrency):
            sem = asyncio.Semaphore(conc)

            async def one() -> RequestResult:
                async with sem:
                    return await infer_once(
                        client,
                        base_url=base_url,
                        prompt=prompt,
                        model=model,
                        max_tokens=max_tokens,
                        timeout_s=timeout_s,
                    )

            level_start = time.perf_counter()
            level_results = list(
                await asyncio.gather(*[one() for _ in range(requests_per_step)])
            )
            level_wall = time.perf_counter() - level_start
            summary = aggregate(level_results, level_wall)
            level_entry = {
                "concurrency": conc,
                "summary": summary,
            }
            levels_out.append(level_entry)
            all_results.extend(level_results)
            if summary["reject_rate"] >= stop_reject_rate:
                break

    total_wall = time.perf_counter() - total_start
    return levels_out, all_results, total_wall
```

- [ ] **Step 4: Run parse tests**

Run: `python -m pytest tests/unit/test_bench_client_parse.py -v`

Expected: PASS

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add scripts/requirements.txt scripts/bench_lib/client.py scripts/bench_lib/runner.py tests/unit/test_bench_client_parse.py
git commit -m "bench: add async SSE client and fixed/stress runners"
```

---

### Task 4: CLI entrypoint + reporting

**Files:**
- Create: `scripts/bench.py`
- Modify: `scripts/bench_lib/__init__.py` (optional re-exports)

**Interfaces:**
- Consumes: `run_fixed`, `run_stress`, `aggregate`, `parse_fail_on`, `evaluate_gates`, `RequestResult.to_dict`
- Produces: CLI `main()` → exit code 0/1/2

- [ ] **Step 1: Implement `scripts/bench.py`**

```python
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
        knee = None
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
                knee = level["concurrency"]
        if knee is not None:
            print(f"knee (first level at/above stop-reject-rate): {knee}")
        elif levels:
            print(f"knee: completed full ramp (max={levels[-1]['concurrency']})")

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
```

- [ ] **Step 2: Smoke the CLI help**

Run: `python scripts/bench.py --help`

Expected: usage text listing `--mode`, `--concurrency`, `--fail-on`, etc.

- [ ] **Step 3: Unit regression**

Run: `python -m pytest tests/unit/test_bench_metrics.py tests/unit/test_bench_gates.py tests/unit/test_bench_ramp.py tests/unit/test_bench_client_parse.py -v`

Expected: all PASS

- [ ] **Step 4: Manual live smoke (coordinator must be running)**

```bash
python scripts/bench.py --mode bench --concurrency 1 --requests 2 --max-tokens 10
```

Expected: histogram shows mostly/all `200`, non-null TTFT if tokens arrived; exit 0.

If coordinator is down: clear error and exit 2.

- [ ] **Step 5: Commit (only if user asked)**

```bash
git add scripts/bench.py scripts/bench_lib/
git commit -m "bench: add CLI for fixed-concurrency benchmark and concurrency ramp stress"
```

---

### Task 5: README docs

**Files:**
- Modify: `README.md` (near “Test the API” / after Python test script section ~lines 151–159)

**Interfaces:**
- Consumes: CLI from Task 4
- Produces: documented install + example commands

- [ ] **Step 1: Add subsection**

After the existing Python/`test_inference` examples, add:

```markdown
### Benchmark & stress

Requires the coordinator and worker already running, plus:

```bash
pip install -r scripts/requirements.txt
```

Fixed-concurrency benchmark:

```bash
python scripts/bench.py --mode bench --concurrency 8 --requests 40 --max-tokens 50
```

Concurrency ramp stress (stops when reject rate hits the threshold):

```bash
python scripts/bench.py --mode stress --max-concurrency 64 --step 8 --requests-per-step 16
```

Optional JSON output and gates:

```bash
python scripts/bench.py --mode bench --concurrency 4 --requests 20 \
  --out results.json --fail-on error_rate=0.1,p95_ttft_ms=10000
```
```

- [ ] **Step 2: Skim README for broken fences**

Open `README.md` and confirm the new subsection renders as intended (no unclosed fences).

- [ ] **Step 3: Commit (only if user asked)**

```bash
git add README.md
git commit -m "docs: document bench/stress CLI usage in README"
```

---

### Task 6: End-to-end verification checklist

No new files. Operator runs against a live stack.

- [ ] **Step 1: Install deps**

`pip install -r scripts/requirements.txt pytest`

- [ ] **Step 2: Unit suite**

`python -m pytest tests/unit/test_bench_*.py -v` → all PASS

- [ ] **Step 3: Live bench**

`python scripts/bench.py --mode bench --concurrency 4 --requests 20 --max-tokens 20 --out /tmp/bench.json`

Expected: mostly `200`; JSON has `summary` + `requests`.

- [ ] **Step 4: Live stress**

`python scripts/bench.py --mode stress --max-concurrency 32 --step 8 --requests-per-step 16 --stop-reject-rate 0.5`

Expected: levels printed; may stop early on `503`; process stays healthy (`curl` health still works).

- [ ] **Step 5: Gate failure path**

`python scripts/bench.py --mode bench --concurrency 1 --requests 1 --fail-on error_rate=0`

If the single request succeeds, exit 0. To force exit 1 without a live server: stop coordinator and run without relying on preflight… preflight exits 2. Instead use a completed run with known failures, or temporarily set `--fail-on p95_ttft_ms=0` after a successful run that has TTFT > 0 → exit 1.

Example:

```bash
python scripts/bench.py --mode bench --concurrency 1 --requests 1 --max-tokens 5 --fail-on p95_ttft_ms=0
```

Expected: exit code 1 and GATE FAILURES printed.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Single CLI `scripts/bench.py` | 4 |
| Modes `bench` / `stress` | 3, 4 |
| Unique `conversation_id` | 3 (`infer_once`) |
| Metrics TTFT / TPS / rates | 1 |
| Console + `--out` JSON | 4 |
| `--fail-on` hybrid gates | 2, 4 |
| Soft stop on reject rate | 3 (`run_stress`) |
| Ramp includes max concurrency | 2 (`concurrency_levels`) |
| Health fail-fast | 3 (`check_coordinator`) |
| `httpx` in `scripts/requirements.txt` | 3 |
| README subsection | 5 |
| Manual verification | 6 |
| Non-goals excluded | — (not implemented) |

**Placeholder scan:** none intentional.  
**Type consistency:** `RequestResult`, `aggregate` summary keys, gate keys aligned across tasks.
