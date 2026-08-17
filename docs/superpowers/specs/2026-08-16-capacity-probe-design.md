# Capacity Probe Design

Date: 2026-08-16  
Status: Approved

## Goal

Add `--mode capacity` to `scripts/bench.py` to discover three capacity limits on a running coordinator + worker stack:

1. **Admission capacity** — highest concurrency before `reject_rate ≥ 10%` (503s).
2. **SLO capacity** — highest concurrency where error rate ≤ 5%, TTFT p95 ≤ 30s, reject rate ≤ 1%.
3. **Physical capacity** — highest concurrency before coordinator stats exceed 90% session/KV capacity, or a timeout-without-503 heuristic (error ≥ 25%, reject = 0).

## Non-goals (v1)

- `--fail-on` CI gates (v2)
- Docker stats subprocess
- `max_tokens` sweep in one run
- Coordinator/worker code changes

## Approach

Extend `scripts/bench.py` with `--mode capacity`. Reuse `bench_lib` runners and metrics. New modules:

- `capacity.py` — two-phase search, thresholds, verdicts
- `stats_poller.py` — poll `GET /coordinator/stats` during each level
- `environment.py` — best-effort host/git/worker metadata

## Search strategy

**Phase 1 (coarse):** concurrency `coarse_step, 2×coarse_step, …` up to `max_concurrency`; one run per level. Stop when any threshold fails.

**Phase 2 (refine):** between last passing and first failing coarse levels; step `refine_step`; three repeats per level; median metrics.

## Thresholds (defaults, all CLI-overridable)

| Type | Condition |
|------|-----------|
| Admission fail | `reject_rate ≥ 0.10` |
| SLO fail | `error_rate > 0.05` OR `ttft_p95_ms > 30000` OR `reject_rate > 0.01` |
| Physical (stats) | `session_capacity_pct ≥ 90` OR `kv_cache_capacity_pct ≥ 90` |
| Physical (heuristic) | `reject_rate == 0` AND `error_rate ≥ 0.25` |

## Workload defaults

Same as stress baseline: `tinyllama-1.1b`, default ocean prompt, `max_tokens=100`, `timeout_s=300`, unique `conversation_id` per request. JSON includes `workload` block with `prompt_sha256`.

## Session hygiene

`--cooldown-s` (default `0`). README recommends `300` for published benchmarks (session TTL ~5 min).

## Output

Console summary, JSON report, and one-line `tweet_line`. Report-only (exit 0 on completion).

## JSON shape

```json
{
  "mode": "capacity",
  "capacity": {
    "admission_concurrency": 12,
    "slo_concurrency": 4,
    "physical_concurrency": 6,
    "admission_found": true,
    "notes": []
  },
  "thresholds": {},
  "workload": {},
  "environment": {},
  "phases": { "coarse": [], "refine": [] },
  "tweet_line": "..."
}
```

## Verification

- Unit tests for threshold evaluation, median aggregation, refine band, verdict computation
- Manual run on VM with `--cooldown-s 300`
