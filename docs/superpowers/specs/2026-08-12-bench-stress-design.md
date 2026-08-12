# Benchmark & Stress Script Design

Date: 2026-08-12  
Status: Ready for review

## Goal

Add a single Python CLI that can:

1. **Benchmark** fixed-concurrency inference load (TTFT, tokens/s, success rates).
2. **Stress** the system by ramping concurrency until capacity pressure (e.g. `503`) appears.

Default behavior is report-only. Optional threshold gates can fail the process for later CI use.

## Non-goals (v1)

- Slow-client / backpressure mode
- Multi-turn conversation reuse load
- Worker-kill / chaos hooks
- CSV export
- GitHub Actions / CI wiring
- Replacing `test_inference.py` (smoke stays as-is)

## Approach

**Single async CLI** at `scripts/bench.py` with `--mode bench|stress`.

Shared stack:

- Async HTTP SSE client (`httpx`)
- Per-request recorder
- Aggregator (percentiles, histograms, TPS)
- Console reporter + optional JSON (`--out`)
- Optional `--fail-on` gates

## Architecture

```
CLI (argparse)
  → run_bench() | run_stress()
       → Semaphore-limited asyncio tasks
            → POST /coordinator/infer (SSE)
            → RecordRequestResult
       → aggregate()
       → print_summary()
       → write_json() [optional]
       → evaluate_gates() [optional]
```

Each request uses a **unique** `conversation_id` (UUID). No sticky multi-turn reuse in v1.

## CLI

### Common flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--mode` | required | `bench` or `stress` |
| `--base-url` | `http://localhost:1337` | Coordinator base |
| `--model` | `tinyllama-1.1b` | Model name in request body |
| `--prompt` | short fixed default | Prompt text |
| `--prompt-file` | unset | Override prompt from file |
| `--max-tokens` | `50` | Cap generation length for fast runs |
| `--timeout-s` | `120` | Per-request timeout |
| `--out` | unset | Write JSON results path |
| `--fail-on` | unset | Comma list of `key=value` gates |

### Bench mode

```bash
python scripts/bench.py --mode bench --concurrency 8 --requests 40 --max-tokens 50
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--concurrency` | `4` | Max in-flight streams |
| `--requests` | `20` | Total requests to issue |

### Stress mode

```bash
python scripts/bench.py --mode stress --max-concurrency 64 --step 8 --requests-per-step 16
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--max-concurrency` | `32` | Upper concurrency in ramp |
| `--step` | `4` | Concurrency increment |
| `--requests-per-step` | `16` | Fixed number of requests issued at each concurrency level |
| `--stop-reject-rate` | `0.5` | Stop ramp when `503/attempts` at a level ≥ this; `1.0` disables soft stop |

Ramp levels: `step, 2*step, …` up to `max-concurrency` (include `max-concurrency` even if not a multiple).

## Metrics

### Per-request

- `status` — HTTP status (or `0` on client-side failure)
- `ttft_ms` — request start → first SSE `data:` token (null if none)
- `tokens` — count of token events
- `duration_ms` — request start → stream end / error
- `error` — optional string (timeout, connect, parse, etc.)
- `rejected` — true when status is `503`

### Aggregates

- Status histogram (`200`, `503`, `502`, `409`, `4xx`, `other`, `client_error`)
- TTFT p50 / p95 over requests with a first token
- Mean per-request tokens/s where `tokens > 1`: `(tokens - 1) / ((duration_ms - ttft_ms) / 1000)`
- Aggregate TPS: `sum(tokens on success) / wall_clock_seconds`
- `error_rate`: non-200 (including client failures) / total attempts  
  Note: `503` counts toward `error_rate` for gates, but stress soft-stop uses **rejection rate** (`503` / attempts) separately.
- `reject_rate`: `503` / attempts

### Console

Print mode parameters, status histogram, TTFT p50/p95, mean tokens/s, aggregate TPS, wall time.  
Stress also prints a per-level table and the “knee” (last level before soft stop, or max if completed).

### JSON (`--out`)

```json
{
  "timestamp": "ISO-8601",
  "mode": "bench|stress",
  "config": { "...flags..." },
  "summary": { "...aggregates..." },
  "levels": [ ],
  "requests": [ ]
}
```

- `levels` present only for `stress` (one entry per concurrency level).
- `requests` is the flat list of per-request records for the whole run.

## Mode behavior

### Bench

1. Create an async client.
2. Schedule `requests` tasks limited by a semaphore of size `concurrency`.
3. Await completion.
4. Aggregate → print → optional JSON → optional gates.

### Stress

1. For each concurrency level in the ramp:
   - Run `requests-per-step` requests at that concurrency (same mechanics as bench).
   - Record level summary (`concurrency`, attempts, reject_rate, ttft, tps, …).
   - If `reject_rate >= stop-reject-rate`, stop further levels.
2. Print per-level table + overall summary.
3. Optional JSON + gates on **overall** aggregates across all completed levels.

## Error handling

| Case | Behavior |
|------|----------|
| Coordinator unreachable at start | Fail fast; non-zero exit; clear message to check health |
| Per-request timeout / stream error | Record failure; continue other requests |
| `503` | Record as rejected; expected under stress |
| `502` / `409` / other 4xx/5xx | Record in histogram; count toward `error_rate` |
| No `--fail-on` | Exit 0 if the run completes (even with many `503`s) |
| `--fail-on` violated | Exit 1 after printing summary |

### Gates

`--fail-on error_rate=0.1,p95_ttft_ms=10000`

Supported keys in v1:

- `error_rate` — max allowed (0–1)
- `p95_ttft_ms` — max allowed p95 TTFT
- `reject_rate` — max allowed (useful for bench; stress often expects rejects)

Unknown keys → fail fast at startup with a parse error.

## Dependencies

- Add `httpx` as a documented optional/dev dependency for the script (pin in a small `scripts/requirements.txt` or note in README).
- Stdlib: `argparse`, `asyncio`, `json`, `statistics` / simple percentile helper, `uuid`, `time`.

## Docs

Add a short **Benchmark & stress** subsection to `README.md` under testing: how to run bench/stress examples and that the coordinator+worker must already be up.

## Verification (manual)

1. Start stack (`./start.sh` or Compose) with a small GGUF.
2. Smoke: `python scripts/bench.py --mode bench --concurrency 1 --requests 2 --max-tokens 10`
3. Bench: concurrency 4, requests 20 — expect mostly `200`, non-null TTFT.
4. Stress: ramp until soft stop — expect rising `503` near capacity; process stays up.
5. `--out results.json` writes a parseable file.
6. `--fail-on error_rate=0` on a run with forced failures exits 1.

## Open decisions (resolved)

| Topic | Decision |
|-------|----------|
| Primary goal | Both bench + stress |
| Pass criteria | Hybrid (report default, optional gates) |
| Language | Python |
| v1 scenarios | Fixed concurrency + ramp only |
| Output | Console + optional JSON |
| Implementation shape | Single async CLI |
