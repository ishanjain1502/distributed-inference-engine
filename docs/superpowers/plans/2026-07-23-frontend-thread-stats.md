# Frontend Thread Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Live `/stats` page with cluster/worker summary and expandable per-session KV/metadata via coordinator fan-out.

**Architecture:** Worker exposes `GET /worker/sessions`. Coordinator `GET /coordinator/stats` merges healthTable with parallel session fetches from alive workers. `frontend/stats.html` polls every 2s; `/` and `/stats` share Infer|Stats nav.

**Tech Stack:** Rust/Axum worker, Express/TS coordinator, plain HTML/JS frontend.

## Global Constraints

- No prompt text in APIs or UI.
- Fan-out only to alive workers; ~500ms per-worker timeout; failures → `sessions_error`.
- Poll 2s while tab visible; preserve expanded worker ids; default-expand workers with sessions > 0.
- Match existing frontend visual tokens; do not redesign infer form beyond nav.
- Prefer `coordinator/src/stats.ts`; do not bloating `server.ts`/`health.ts`.
- Do not commit unless the user asks.

---

### Task 1: Worker `GET /worker/sessions`

**Files:**
- Modify: `worker/src/http.rs`
- Modify: `worker/src/main.rs`

**Interfaces:**
- Produces: `list_sessions` handler at `GET /worker/sessions` returning JSON per design spec (no prompt).

- [ ] **Step 1: Add response types and handler in `http.rs`**

After `health`, add:

```rust
#[derive(Serialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub model: String,
    pub max_tokens: u32,
    pub kv_cache_bytes: u64,
    pub idle_ms: u64,
}

#[derive(Serialize)]
pub struct SessionsResponse {
    pub sessions: Vec<SessionSummary>,
    pub active_sessions: usize,
    pub total_kv_cache_bytes: u64,
    pub max_sessions: usize,
    pub max_kv_cache_bytes: u64,
}

pub async fn list_sessions(
    State((sessions, _model_manager)): State<(Sessions, Arc<ModelManager>)>,
) -> Json<SessionsResponse> {
    use crate::state::{MAX_SESSIONS, MAX_TOTAL_KV_CACHE};

    let sessions_read = sessions.read().await;
    let mut list: Vec<SessionSummary> = sessions_read
        .iter()
        .map(|(id, s)| SessionSummary {
            session_id: id.clone(),
            model: s.model.clone(),
            max_tokens: s.max_tokens,
            kv_cache_bytes: s.kv_cache_bytes,
            idle_ms: s.last_activity.elapsed().as_millis() as u64,
        })
        .collect();
    list.sort_by(|a, b| a.session_id.cmp(&b.session_id));

    let total_kv_cache_bytes: u64 = list.iter().map(|s| s.kv_cache_bytes).sum();
    let active_sessions = list.len();

    Json(SessionsResponse {
        sessions: list,
        active_sessions,
        total_kv_cache_bytes,
        max_sessions: MAX_SESSIONS,
        max_kv_cache_bytes: MAX_TOTAL_KV_CACHE,
    })
}
```

- [ ] **Step 2: Register route in `main.rs`**

```rust
.route("/worker/sessions", axum::routing::get(http::list_sessions))
```

- [ ] **Step 3: Verify**

With worker running: `curl -s http://localhost:3001/worker/sessions` → JSON with empty `sessions` when idle.

---

### Task 2: Coordinator `GET /coordinator/stats`

**Files:**
- Create: `coordinator/src/stats.ts`
- Modify: `coordinator/src/server.ts`

**Interfaces:**
- Consumes: `healthTable.getAllWorkers()`, `healthTable.getCounts()`, `getSystemCapacityMetrics()`, `getCapacityConfig()`, `WorkerStatus.ALIVE`
- Produces: Express router mounted at `/coordinator/stats`

- [ ] **Step 1: Create `coordinator/src/stats.ts`**

```typescript
import { Router, Request, Response } from 'express';
import { healthTable, WorkerStatus } from './healthTable';
import { getCapacityConfig, getSystemCapacityMetrics } from './capacity';

const FANOUT_TIMEOUT_MS = 500;

export interface SessionSummary {
  session_id: string;
  model: string;
  max_tokens: number;
  kv_cache_bytes: number;
  idle_ms: number;
  worker_id: string;
}

interface WorkerSessionsPayload {
  sessions: Array<{
    session_id: string;
    model: string;
    max_tokens: number;
    kv_cache_bytes: number;
    idle_ms: number;
  }>;
  active_sessions: number;
  total_kv_cache_bytes: number;
  max_sessions: number;
  max_kv_cache_bytes: number;
}

async function fetchWorkerSessions(
  workerUrl: string,
  workerId: string
): Promise<{ sessions: SessionSummary[]; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FANOUT_TIMEOUT_MS);
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/worker/sessions`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return { sessions: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as WorkerSessionsPayload;
    const sessions = (data.sessions || []).map((s) => ({
      ...s,
      worker_id: workerId,
    }));
    return { sessions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sessions: [], error: message };
  } finally {
    clearTimeout(timer);
  }
}

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const capacity = getSystemCapacityMetrics();
  const config = getCapacityConfig();
  const counts = healthTable.getCounts();
  const workers = healthTable.getAllWorkers();

  const enriched = await Promise.all(
    workers.map(async (w) => {
      const base = {
        id: w.id,
        url: w.url,
        status: w.status,
        health: w.health,
        lastHeartbeat: w.lastHeartbeat,
        sessions: [] as SessionSummary[],
        sessions_error: undefined as string | undefined,
      };

      if (w.status !== WorkerStatus.ALIVE) {
        return base;
      }

      const result = await fetchWorkerSessions(w.url, w.id);
      base.sessions = result.sessions;
      if (result.error) {
        base.sessions_error = result.error;
      }
      return base;
    })
  );

  res.json({
    fetched_at: Date.now(),
    cluster: {
      alive: counts[WorkerStatus.ALIVE],
      stale: counts[WorkerStatus.STALE],
      dead: counts[WorkerStatus.DEAD],
      total_sessions: capacity.totalSessions,
      total_kv_cache_bytes: capacity.totalKvCacheBytes,
      max_total_sessions: config.maxTotalSessions,
      max_total_kv_cache_bytes: config.maxTotalKvCacheBytes,
      session_capacity_pct: capacity.sessionCapacityPct,
      kv_cache_capacity_pct: capacity.kvCacheCapacityPct,
    },
    workers: enriched,
  });
});

export default router;
```

- [ ] **Step 2: Mount in `server.ts`**

```typescript
import statsRouter from './stats';
// ...
app.use('/coordinator/stats', statsRouter);
```

- [ ] **Step 3: Verify**

`curl -s http://localhost:1337/coordinator/stats` → cluster + workers JSON.

---

### Task 3: Frontend `/stats` page + nav + route

**Files:**
- Create: `frontend/stats.html`
- Modify: `frontend/index.html` (nav only)
- Modify: `coordinator/src/server.ts` (serve `/stats`)

**Interfaces:**
- Consumes: `GET /coordinator/stats` response from Task 2

- [ ] **Step 1: Serve stats file from coordinator**

```typescript
const frontendStats = path.join(__dirname, '../../frontend/stats.html');
app.get('/stats', (_req, res) => {
  res.sendFile(frontendStats);
});
```

- [ ] **Step 2: Add nav to `index.html`**

Before `<h1>`, add:

```html
<nav style="margin-bottom: 1rem; font-size: 0.95rem;">
  <a href="/" aria-current="page">Infer</a>
  <span style="color: var(--muted);"> · </span>
  <a href="/stats">Stats</a>
</nav>
```

Style active link with `font-weight: 700` via small CSS for `nav a[aria-current="page"]`.

- [ ] **Step 3: Create `frontend/stats.html`**

Single-page HTML matching design: same CSS variables as index; cluster strip; expandable worker rows; 2s poll with visibility pause; preserve expanded set; humanize bytes and idle; show `sessions_error`; keep last good snapshot on fetch failure with “Update failed · retrying…”.

Key JS behaviors:

```javascript
const POLL_MS = 2000;
const expanded = new Set(); // worker ids
let lastSnapshot = null;
let pollTimer = null;
let userToggled = false; // after first user toggle, stop auto-default expand overrides for known ids

async function poll() {
  if (document.visibilityState !== 'visible') return;
  try {
    const res = await fetch('/coordinator/stats');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    lastSnapshot = await res.json();
    render(lastSnapshot, false);
  } catch {
    if (lastSnapshot) render(lastSnapshot, true);
    else setStripError(true);
  }
}

function schedule() {
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_MS);
}
```

Default expand: on each successful render, for workers not yet in `seenWorkers`, if `health.active_sessions > 0` add to `expanded`.

- [ ] **Step 4: Manual UI check**

Open `/stats`, confirm strip + workers; run infer; session appears within ~2s.

---

### Task 4: End-to-end verification

- [ ] **Step 1:** `curl` worker sessions + coordinator stats  
- [ ] **Step 2:** Browser: idle → infer → session row → nav both ways  
- [ ] **Step 3:** Confirm no prompt fields in JSON  

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| `/worker/sessions` | 1 |
| `/coordinator/stats` fan-out | 2 |
| `/stats` page layout A | 3 |
| Nav Infer ↔ Stats | 3 |
| 2s visible poll, expand preserve | 3 |
| No prompts | 1–3 |
| Manual tests | 4 |
