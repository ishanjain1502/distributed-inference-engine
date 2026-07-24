# Frontend Thread Stats Page — Design Spec

**Date:** 2026-07-23  
**Status:** Approved for implementation planning

## Goal

Add a live `/stats` page that shows cluster/worker capacity and expandable per-session (thread) detail — active session count and KV cache per session — without exposing prompt text.

## Decisions

| Topic | Choice |
|-------|--------|
| Data depth | Cluster + per-worker summary, expandable per-session rows |
| Data path | Coordinator fan-out: `GET /coordinator/stats` aggregates health table + alive workers’ session lists |
| Refresh | Auto-poll every 2s while the tab is visible |
| Navigation | Separate page at `/stats`; Infer ↔ Stats links on both pages |
| Prompt text | Never included in APIs or UI |
| Layout | Stacked worker rows; expand to show that worker’s session table |

## Architecture

```
Browser /stats  --poll 2s-->  GET /coordinator/stats
                                 |
                                 +-- healthTable (workers, status, aggregates)
                                 +-- parallel GET {worker_url}/worker/sessions (alive only, ~500ms timeout)
```

- Browser talks only to the coordinator (same origin).
- Workers stay reachable only from the coordinator.
- Infer routes and existing health endpoints stay unchanged.

## APIs

### `GET /worker/sessions` (new)

Returns sessions held on that worker. No prompt field.

```json
{
  "sessions": [
    {
      "session_id": "...",
      "model": "tinyllama-1.1b",
      "max_tokens": 50,
      "kv_cache_bytes": 123456,
      "idle_ms": 420
    }
  ],
  "active_sessions": 1,
  "total_kv_cache_bytes": 123456,
  "max_sessions": 100,
  "max_kv_cache_bytes": 8589934592
}
```

`idle_ms` is derived from `last_activity` at response time.

### `GET /coordinator/stats` (new)

Response shape (conceptual):

- `cluster`: alive/stale/dead counts, total sessions, total KV bytes, capacity maxima / % when available from capacity config + worker maxima
- `workers[]`: id, url, status, heartbeat health (`active_sessions`, `kv_cache_bytes`), optional `sessions[]` (tagged with worker id), optional `sessions_error`
- `fetched_at`: coordinator wall time for the snapshot

Rules:

- Fan-out only to **alive** workers.
- Per-worker fan-out failure or timeout → worker remains in list with `sessions_error`; others unaffected.
- Stale/dead workers appear from the health table but are not fan-out targets (no session list).

## UI

### Pages

| Path | File |
|------|------|
| `/` | `frontend/index.html` (infer) — add nav link to Stats |
| `/stats` | `frontend/stats.html` (new) — add nav link to Infer |

Coordinator serves `/stats` the same way it serves `/` (static file send).

### Stats page structure (layout A)

1. **Nav** — Infer | Stats  
2. **Cluster strip** — alive workers, total sessions (/ max if known), total KV (/ capacity), last update indicator  
3. **Worker rows** — id, status, session count, KV used; click toggles expand/collapse  
4. **Expanded table** — session_id, model, humanized `kv_cache_bytes`, idle age, max_tokens  
5. If `sessions_error` — show that message instead of the table  

Behavior:

- Poll interval **2s**; pause when `document.visibilityState !== "visible"`.
- Preserve expanded `worker_id`s across successful polls.
- Default expand: workers with `active_sessions > 0`; empty workers collapsed.
- Match existing infer page visual tokens (Georgia, `--bg`, `--fg`, `--accent`, etc.). No redesign of the infer form beyond the nav link.

### Fetch errors

Keep the last successful snapshot; show muted “Update failed · retrying…” on the strip; next poll retries.

## Scope

**In**

- Worker `GET /worker/sessions`
- Coordinator `GET /coordinator/stats` (fan-out + health aggregates)
- `frontend/stats.html` + route + nav links
- Humanized bytes / idle duration display helpers on the stats page

**Out**

- Prompt text anywhere in stats
- Charts, history, pause toggle
- Auth on stats endpoints
- Automated E2E
- Changing heartbeat payload or infer/scheduling logic

## Testing (manual)

1. Idle cluster: `/stats` shows alive workers, 0 sessions; empty workers collapsed.  
2. During infer: within ~2s, session appears under the correct worker with KV / idle / model / max_tokens.  
3. Kill or block one worker: that worker shows `sessions_error` or becomes dead; others still update.  
4. Hide the tab: polling pauses; show again: resumes.  
5. Infer ↔ Stats navigation works; `/coordinator/health` and `/coordinator/infer` unchanged.

## Implementation notes

- Reuse `get_capacity_metrics` / session map reads on the worker for accurate counts (read lock only).
- Coordinator: parallel fetches with AbortSignal/timeout; do not block the whole response on one slow worker beyond the timeout.
- Prefer small, focused modules (e.g. `coordinator/src/stats.ts`) over growing `server.ts` / `health.ts` unbounded.
