# Conversation Session Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse one worker KV session across multi-turn `/infer` calls that share a client-generated `conversation_id`, until KV or context-token budgets force a client reset.

**Architecture:** Coordinator `ConversationRegistry` maps `conversation_id → { session_id, worker_id, … }` with a per-id FIFO lock. First turn creates a worker session; later turns sticky-route and `prefill` with `mode: "continue"` (`advance_context` on the same `LlamaSession`). Stream end does not destroy the session; idle TTL / `session_full` / hard failure does.

**Tech Stack:** TypeScript/Express coordinator, Rust/Axum worker, llama.cpp `LlamaSession`, existing SSE streaming.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-01-conversation-session-reuse-design.md` exactly.
- `conversation_id` is required on every `/infer`.
- On budget full: HTTP `409` with `reason: "session_full"`; client must use a new `conversation_id`.
- On lost/inconsistent session: HTTP `409` with `reason: "session_gone"`.
- Concurrent turns for the same id: FIFO queue (hold lock across prefill+decode); do not return conflict.
- No truncated re-prefill in v1 (document as future work only).
- Continue does not consume a new worker session slot; create still uses existing admission.
- Idle TTL: 300_000 ms on coordinator (match worker `SESSION_TTL` = 300s).
- Context token budget constant: `MAX_CONTEXT_TOKENS = 2048` on the worker (document in `state.rs`).
- Commit steps only if the user asks.

## File map

| File | Role |
|------|------|
| `coordinator/src/conversationRegistry.ts` | Soft-state map, FIFO lock, idle TTL |
| `coordinator/tests/conversationRegistry.test.mjs` | Unit tests (Node built-in test runner) |
| `coordinator/src/types.ts` | Add `conversation_id` to `InferRequest` |
| `coordinator/src/infer.ts` | Sticky route, lock, create vs continue, no session teardown on turn end |
| `coordinator/src/sessionTracker.ts` | Unchanged API; callers stop ending session on turn complete |
| `coordinator/package.json` | `test` script → build + `node --test` |
| `worker/src/state.rs` | `approx_tokens`, `MAX_CONTEXT_TOKENS`, continue budget helpers |
| `worker/src/http.rs` | Prefill create/continue; `409 session_full`; model mismatch `400` |
| `worker/src/model.rs` | Export/reuse token estimate helpers as needed |
| `frontend/index.html` | Persist `conversation_id`; handle `409` reset |
| `protocol/inference.http.md` | Document `conversation_id`, prefill `mode`, errors |
| `protocol/types.md` | Note conversation vs session |
| `docs/superpowers/specs/2026-08-01-conversation-session-reuse-design.md` | Already has future-work section (no change required unless drift) |

---

### Task 1: ConversationRegistry (coordinator)

**Files:**
- Create: `coordinator/src/conversationRegistry.ts`
- Create: `coordinator/tests/conversationRegistry.test.mjs`
- Modify: `coordinator/package.json` (`test` script)

**Interfaces:**
- Consumes: nothing (pure in-memory)
- Produces:
  - `export interface ConversationEntry { sessionId: string; workerId: string; approxTokens: number; lastActiveMs: number; model: string }`
  - `export const CONVERSATION_IDLE_TTL_MS = 300_000`
  - `export class ConversationRegistry`
    - `acquire(conversationId: string): Promise<() => void>` — FIFO; resolve with release fn
    - `get(conversationId: string): ConversationEntry | undefined` — returns undefined if missing or idle-expired (and deletes expired)
    - `set(conversationId: string, entry: ConversationEntry): void` — sets/replaces; bumps `lastActiveMs` if caller passes it
    - `touch(conversationId: string, approxTokens?: number): void`
    - `delete(conversationId: string): void`
    - `clear(): void` — tests only

- [ ] **Step 1: Write the failing unit test**

Create `coordinator/tests/conversationRegistry.test.mjs`:

```javascript
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  ConversationRegistry,
  CONVERSATION_IDLE_TTL_MS,
} = require('../dist/conversationRegistry.js');

describe('ConversationRegistry', () => {
  /** @type {ConversationRegistry} */
  let reg;

  beforeEach(() => {
    reg = new ConversationRegistry();
  });

  it('get returns undefined for unknown id', () => {
    assert.equal(reg.get('missing'), undefined);
  });

  it('set then get returns entry', () => {
    reg.set('c1', {
      sessionId: 's1',
      workerId: 'w1',
      approxTokens: 10,
      lastActiveMs: Date.now(),
      model: 'm',
    });
    const e = reg.get('c1');
    assert.equal(e.sessionId, 's1');
    assert.equal(e.workerId, 'w1');
  });

  it('delete removes entry', () => {
    reg.set('c1', {
      sessionId: 's1',
      workerId: 'w1',
      approxTokens: 0,
      lastActiveMs: Date.now(),
      model: 'm',
    });
    reg.delete('c1');
    assert.equal(reg.get('c1'), undefined);
  });

  it('expired entry is dropped on get', () => {
    reg.set('c1', {
      sessionId: 's1',
      workerId: 'w1',
      approxTokens: 0,
      lastActiveMs: Date.now() - CONVERSATION_IDLE_TTL_MS - 1,
      model: 'm',
    });
    assert.equal(reg.get('c1'), undefined);
  });

  it('acquire is FIFO', async () => {
    const order = [];
    const r1 = reg.acquire('c1').then(async (release) => {
      order.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a-end');
      release();
    });
    const r2 = reg.acquire('c1').then(async (release) => {
      order.push('b-start');
      release();
    });
    await Promise.all([r1, r2]);
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd coordinator && npm run build 2>/dev/null; node --test tests/conversationRegistry.test.mjs
```

Expected: FAIL (cannot find `../dist/conversationRegistry.js` or export missing).

- [ ] **Step 3: Implement `conversationRegistry.ts`**

```typescript
export const CONVERSATION_IDLE_TTL_MS = 300_000;

export interface ConversationEntry {
  sessionId: string;
  workerId: string;
  approxTokens: number;
  lastActiveMs: number;
  model: string;
}

type Waiter = {
  resolve: (release: () => void) => void;
};

export class ConversationRegistry {
  private entries = new Map<string, ConversationEntry>();
  private tails = new Map<string, Promise<void>>();

  get(conversationId: string): ConversationEntry | undefined {
    const entry = this.entries.get(conversationId);
    if (!entry) return undefined;
    if (Date.now() - entry.lastActiveMs > CONVERSATION_IDLE_TTL_MS) {
      this.entries.delete(conversationId);
      return undefined;
    }
    return entry;
  }

  set(conversationId: string, entry: ConversationEntry): void {
    this.entries.set(conversationId, { ...entry });
  }

  touch(conversationId: string, approxTokens?: number): void {
    const entry = this.entries.get(conversationId);
    if (!entry) return;
    entry.lastActiveMs = Date.now();
    if (typeof approxTokens === 'number') {
      entry.approxTokens = approxTokens;
    }
  }

  delete(conversationId: string): void {
    this.entries.delete(conversationId);
  }

  clear(): void {
    this.entries.clear();
    this.tails.clear();
  }

  acquire(conversationId: string): Promise<() => void> {
    const prev = this.tails.get(conversationId) ?? Promise.resolve();
    let releasePrev!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePrev = resolve;
    });
    this.tails.set(
      conversationId,
      prev.then(() => gate)
    );

    return prev.then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releasePrev();
      };
    });
  }
}

export const conversationRegistry = new ConversationRegistry();
```

- [ ] **Step 4: Wire npm test and run**

In `coordinator/package.json` set:

```json
"test": "tsc && node --test tests/conversationRegistry.test.mjs"
```

Run:

```bash
cd coordinator && npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit** (only if the user asks)

```bash
git add coordinator/src/conversationRegistry.ts coordinator/tests/conversationRegistry.test.mjs coordinator/package.json
git commit -m "Add ConversationRegistry with FIFO lock and idle TTL"
```

---

### Task 2: Worker session token budget + continue capacity helpers

**Files:**
- Modify: `worker/src/state.rs`
- Create: `worker/src/budget.rs` (pure helpers + unit tests) — keep llama types out of unit-tested budget math
- Modify: `worker/src/main.rs` or `lib` layout only if needed for `#[cfg(test)]` — prefer `budget.rs` as a module declared in `main.rs`

**Interfaces:**
- Consumes: existing `MAX_KV_CACHE_PER_SESSION`
- Produces:
  - `pub const MAX_CONTEXT_TOKENS: u32 = 2048;`
  - `pub fn estimate_tokens(text: &str) -> u32` — `(text.len() / 4).max(1) as u32`
  - `pub fn estimate_kv_bytes_for_tokens(tokens: u32) -> u64` — `tokens as u64 * 512`
  - `pub enum SessionBudgetError { SessionFullKv, SessionFullTokens }`
  - `pub fn check_continue_budget(current_tokens: u32, current_kv: u64, added_tokens: u32) -> Result<(), SessionBudgetError>`
  - Extend `Session` with `pub approx_tokens: u32`

- [ ] **Step 1: Add module + failing tests in `worker/src/budget.rs`**

```rust
pub const MAX_CONTEXT_TOKENS: u32 = 2048;
pub const KV_BYTES_PER_TOKEN: u64 = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionBudgetError {
    SessionFullKv,
    SessionFullTokens,
}

pub fn estimate_tokens(text: &str) -> u32 {
    (text.len() / 4).max(1) as u32
}

pub fn estimate_kv_bytes_for_tokens(tokens: u32) -> u64 {
    tokens as u64 * KV_BYTES_PER_TOKEN
}

pub fn check_continue_budget(
    current_tokens: u32,
    current_kv: u64,
    added_tokens: u32,
    max_kv_per_session: u64,
) -> Result<(), SessionBudgetError> {
    let projected_tokens = current_tokens.saturating_add(added_tokens);
    if projected_tokens > MAX_CONTEXT_TOKENS {
        return Err(SessionBudgetError::SessionFullTokens);
    }
    let projected_kv = current_kv.saturating_add(estimate_kv_bytes_for_tokens(added_tokens));
    if projected_kv > max_kv_per_session {
        return Err(SessionBudgetError::SessionFullKv);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_over_token_budget() {
        let err = check_continue_budget(2000, 0, 100, 512 * 1024 * 1024).unwrap_err();
        assert_eq!(err, SessionBudgetError::SessionFullTokens);
    }

    #[test]
    fn rejects_over_kv_budget() {
        let max_kv = 1000;
        let err = check_continue_budget(0, 900, 10, max_kv).unwrap_err();
        assert_eq!(err, SessionBudgetError::SessionFullKv);
    }

    #[test]
    fn accepts_within_budget() {
        assert!(check_continue_budget(10, 5120, 5, 512 * 1024 * 1024).is_ok());
    }
}
```

Declare in `worker/src/main.rs`: `mod budget;`

- [ ] **Step 2: Run failing/passing compile**

```bash
cd worker && cargo test budget::tests -- --nocapture
```

Expected: PASS for budget tests once file is wired. If `mod budget` missing, FAIL then add the mod line.

- [ ] **Step 3: Extend `Session` in `state.rs`**

Add field:

```rust
pub approx_tokens: u32,
```

Update every `Session { ... }` construction site (prefill in `http.rs`) to set `approx_tokens` from `budget::estimate_tokens(&prompt)` on create.

Re-export or use `MAX_CONTEXT_TOKENS` from `budget` in docs comments in `state.rs`:

```rust
/// Context token budget: see `budget::MAX_CONTEXT_TOKENS` (2048).
```

- [ ] **Step 4: Commit** (only if the user asks)

```bash
git add worker/src/budget.rs worker/src/state.rs worker/src/main.rs worker/src/http.rs
git commit -m "Add per-session token/KV continue budget helpers"
```

---

### Task 3: Worker prefill create vs continue

**Files:**
- Modify: `worker/src/http.rs` (`PrefillRequest`, `prefill` handler)
- Modify: `worker/src/model.rs` — keep `prefill_session` / `advance_context`; optionally switch token estimate to call `budget::estimate_tokens` to DRY

**Interfaces:**
- Consumes: `budget::check_continue_budget`, `Sessions`, `ModelManager`
- Produces: HTTP behavior
  - Request body adds `"mode": "create" | "continue"` (default `"create"` if omitted for safety during rollout — coordinator always sends explicit mode)
  - Success `200`: `{ "status": "ok", "tokens_added": u32, "total_tokens_est": u32 }`
  - `409`: `{ "error": "Session full", "reason": "session_full" }`
  - Continue unknown session: `404`
  - Continue model mismatch: `400` `{ "error": "Model mismatch", "reason": "model_mismatch" }`

- [ ] **Step 1: Extend request/response types**

```rust
#[derive(Deserialize)]
pub struct PrefillRequest {
    pub session_id: String,
    pub prompt: String,
    pub model: String,
    pub max_tokens: u32,
    #[serde(default = "default_prefill_mode")]
    pub mode: String, // "create" | "continue"
}

fn default_prefill_mode() -> String {
    "create".to_string()
}

#[derive(Serialize)]
pub struct PrefillResponse {
    pub status: &'static str,
    pub tokens_added: u32,
    pub total_tokens_est: u32,
}
```

Use a shared error JSON shape:

```rust
#[derive(Serialize)]
pub struct PrefillErrorBody {
    pub error: String,
    pub reason: String,
}
```

- [ ] **Step 2: Implement continue branch before create**

Logic sketch inside `prefill`:

```rust
let added_tokens = crate::budget::estimate_tokens(&req.prompt);

if req.mode == "continue" {
    let mut sessions_write = sessions.write().await;
    let session = match sessions_write.get_mut(&req.session_id) {
        Some(s) => s,
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(PrefillErrorBody {
                    error: "Session not found".into(),
                    reason: "session_gone".into(),
                }),
            ));
        }
    };
    if session.model != req.model {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(PrefillErrorBody {
                error: "Model mismatch".into(),
                reason: "model_mismatch".into(),
            }),
        ));
    }
    if let Err(e) = crate::budget::check_continue_budget(
        session.approx_tokens,
        session.kv_cache_bytes,
        added_tokens,
        crate::state::MAX_KV_CACHE_PER_SESSION,
    ) {
        let _ = e;
        return Err((
            StatusCode::CONFLICT,
            Json(PrefillErrorBody {
                error: "Session full".into(),
                reason: "session_full".into(),
            }),
        ));
    }
    let model_session = session.model_session.clone();
    drop(sessions_write);

    prefill_session(model_session, req.prompt.clone()).await.map_err(...)?;

    let mut sessions_write = sessions.write().await;
    let session = sessions_write.get_mut(&req.session_id).ok_or(...)?;
    session.approx_tokens = session.approx_tokens.saturating_add(added_tokens);
    session.kv_cache_bytes = session
        .kv_cache_bytes
        .saturating_add(crate::budget::estimate_kv_bytes_for_tokens(added_tokens));
    session.max_tokens = req.max_tokens;
    session.touch();
    let total = session.approx_tokens;
    // refresh metrics...
    return Ok(Json(PrefillResponse {
        status: "ok",
        tokens_added: added_tokens,
        total_tokens_est: total,
    }));
}

// existing create path:
// - check_capacity for NEW session (unchanged)
// - also reject create if added_tokens > MAX_CONTEXT_TOKENS → 409 session_full
// - set approx_tokens = added_tokens
// - return tokens_added / total_tokens_est
```

Also update create-path success JSON to include the new fields (breaking for coordinator only — update Task 4 together if needed; coordinator currently ignores body beyond ok).

- [ ] **Step 3: Build worker**

```bash
cd worker && cargo build
```

Expected: success.

- [ ] **Step 4: Manual smoke (optional if stack running)**

```bash
# create
curl -s -X POST localhost:3001/worker/prefill -H 'content-type: application/json' \
  -d '{"session_id":"s-test","prompt":"Hello","model":"tinyllama","max_tokens":32,"mode":"create"}'
# continue
curl -s -X POST localhost:3001/worker/prefill -H 'content-type: application/json' \
  -d '{"session_id":"s-test","prompt":"Again","model":"tinyllama","max_tokens":32,"mode":"continue"}'
```

Expected: both `status: ok`; second bumps `total_tokens_est`.

- [ ] **Step 5: Commit** (only if the user asks)

```bash
git add worker/src/http.rs worker/src/model.rs
git commit -m "Support continue prefill with session_full budgets"
```

---

### Task 4: Worker decode updates token/KV estimates

**Files:**
- Modify: `worker/src/http.rs` (`decode` spawn task after token generation)

**Interfaces:**
- Consumes: `tokens_emitted` count from decode loop
- Produces: after successful generation, mutate session: `approx_tokens += tokens_emitted`, `kv_cache_bytes += estimate_kv_bytes_for_tokens(tokens_emitted)`, `touch()`

- [ ] **Step 1: After emitting tokens in decode task, update session counters**

Inside the `tokio::spawn` in `decode`, after the emit loop (and only if `end_reason` is `Complete` or still after partial client disconnect — prefer always add `tokens_emitted` so KV tracking matches reality):

```rust
{
    let mut sessions_write = task_sessions.write().await;
    if let Some(session) = sessions_write.get_mut(&task_session_id) {
        session.approx_tokens = session.approx_tokens.saturating_add(tokens_emitted);
        session.kv_cache_bytes = session.kv_cache_bytes.saturating_add(
            crate::budget::estimate_kv_bytes_for_tokens(tokens_emitted),
        );
        session.touch();
    }
    let total_kv: u64 = sessions_write.values().map(|s| s.kv_cache_bytes).sum();
    let session_count = sessions_write.len() as u64;
    metrics().set_kv_cache_bytes(total_kv);
    metrics().set_active_sessions(session_count);
}
```

Remove the old read-only metrics refresh that did not update per-session counters, or replace it with the block above.

- [ ] **Step 2: `cargo build`**

```bash
cd worker && cargo build
```

Expected: success.

- [ ] **Step 3: Commit** (only if the user asks)

```bash
git add worker/src/http.rs
git commit -m "Update session token/KV estimates after decode"
```

---

### Task 5: Coordinator types + infer wiring

**Files:**
- Modify: `coordinator/src/types.ts`
- Modify: `coordinator/src/infer.ts`
- Modify: `coordinator/src/sessionTracker.ts` only if comments need updating (API stays)

**Interfaces:**
- Consumes: `conversationRegistry`, `selectWorker`, `sessionTracker`, `streamMetrics`, `healthTable`
- Produces: `/infer` behavior per spec

- [ ] **Step 1: Update `InferRequest`**

```typescript
export interface InferRequest {
  conversation_id: string;
  prompt: string;
  model: string;
  max_tokens: number;
}
```

- [ ] **Step 2: Rewrite `tryPrefill` to send mode and parse errors**

```typescript
type PrefillResult =
  | { ok: true; tokensAdded: number; totalTokensEst: number }
  | { ok: false; kind: 'session_full' | 'session_gone' | 'model_mismatch' | 'capacity' | 'other'; status: number };

async function tryPrefill(
  worker: Worker,
  sessionId: string,
  body: InferRequest,
  mode: 'create' | 'continue'
): Promise<PrefillResult> {
  try {
    const prefillRes = await fetch(`${worker.url}/worker/prefill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        prompt: body.prompt,
        model: body.model,
        max_tokens: body.max_tokens,
        mode,
      }),
    });
    if (prefillRes.ok) {
      const data = (await prefillRes.json()) as {
        tokens_added?: number;
        total_tokens_est?: number;
      };
      return {
        ok: true,
        tokensAdded: data.tokens_added ?? 0,
        totalTokensEst: data.total_tokens_est ?? 0,
      };
    }
    let reason = 'other';
    try {
      const errBody = (await prefillRes.json()) as { reason?: string };
      if (errBody.reason === 'session_full') reason = 'session_full';
      else if (errBody.reason === 'session_gone') reason = 'session_gone';
      else if (errBody.reason === 'model_mismatch') reason = 'model_mismatch';
    } catch {
      /* ignore */
    }
    if (prefillRes.status === 409 && reason === 'session_full') {
      return { ok: false, kind: 'session_full', status: 409 };
    }
    if (prefillRes.status === 404 || reason === 'session_gone') {
      return { ok: false, kind: 'session_gone', status: prefillRes.status };
    }
    if (prefillRes.status === 400 && reason === 'model_mismatch') {
      return { ok: false, kind: 'model_mismatch', status: 400 };
    }
    if (prefillRes.status === 503) {
      return { ok: false, kind: 'capacity', status: 503 };
    }
    return { ok: false, kind: 'other', status: prefillRes.status };
  } catch {
    return { ok: false, kind: 'other', status: 0 };
  }
}
```

- [ ] **Step 3: Restructure `router.post('/')` control flow**

Replace the current “always new uuid + sessionEnd on stream complete” flow with:

1. Validate `conversation_id`, `prompt`, `model`, `max_tokens` → else `400`.
2. Early `canAcceptRequest` only when registry miss (create path). On continue, skip new-session admission (still OK to keep a lightweight health check).
3. `const release = await conversationRegistry.acquire(body.conversation_id);`
4. `try { ... } finally { release(); }`
5. Inside try:
   - `let entry = conversationRegistry.get(body.conversation_id);`
   - If entry: resolve worker by `entry.workerId` from `healthTable`; if missing/unhealthy → `conversationRegistry.delete(...)`; `sessionTracker.sessionEnd(entry.sessionId)` if tracked; return `409` `{ error, reason: 'session_gone', request_id }`.
   - If entry: `tryPrefill(..., 'continue')`. On `session_full` → delete registry, `sessionTracker.sessionEnd`, return `409 session_full`. On `session_gone` → same. On other failure → delete, end tracker, `502`.
   - If no entry: existing retry loop with `selectWorker`, new `uuidv4()` session id, `mode: 'create'`. On success: `conversationRegistry.set(...)`, `sessionTracker.sessionStart(sessionId, worker.id, estimatedKvBytes)`.
   - Decode + `streamTokensToClient` as today.
   - **Change** `streamTokensToClient` finally block: call `streamMetrics.sessionEnd` for the *request* metrics, but **do not** call `sessionTracker.sessionEnd` on normal complete / client_disconnect / write_timeout.
   - After successful stream: `conversationRegistry.touch(conversation_id, totalTokensEst + completionTokensEstimate)` — use tokens written from streamMetrics if available, or `touch` with prefill `totalTokensEst` only if simpler; minimum: `touch(conversation_id)` to refresh TTL.
   - On decode hard failure (worker error paths that currently `sessionEnd`): also `conversationRegistry.delete(conversation_id)` and `sessionTracker.sessionEnd(sessionId)`.

Helper for reset responses:

```typescript
function sendReset(res: Response, reason: 'session_full' | 'session_gone', requestId: string) {
  res.status(409).json({
    error: 'Conversation reset required',
    reason,
    request_id: requestId,
  });
}
```

Important: keep the conversation lock held until streaming finishes (or errors out), so queued turns wait.

- [ ] **Step 4: Build coordinator**

```bash
cd coordinator && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit** (only if the user asks)

```bash
git add coordinator/src/types.ts coordinator/src/infer.ts
git commit -m "Route multi-turn infer via conversation registry"
```

---

### Task 6: Frontend conversation_id + 409 handling

**Files:**
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: `/coordinator/infer` JSON contract
- Produces: stable `conversation_id` per browser tab until reset

- [ ] **Step 1: Add conversation state near other script locals**

```javascript
let conversationId = crypto.randomUUID();

function resetConversation(reason) {
  conversationId = crypto.randomUUID();
  setStatus(
    (reason ? reason + " · " : "") + "New conversation " + conversationId.slice(0, 8) + "…",
    !!reason
  );
}
```

- [ ] **Step 2: Include `conversation_id` in fetch body**

```javascript
body: JSON.stringify({
  conversation_id: conversationId,
  prompt: prompt,
  model: model.name,
  max_tokens: maxTokens,
}),
```

- [ ] **Step 3: On HTTP 409, reset and show message**

In the `!res.ok` branch:

```javascript
if (res.status === 409) {
  let reason = "session reset";
  try {
    const body = JSON.parse(await res.text());
    reason = body.reason || reason;
  } catch (_) {}
  resetConversation(reason);
  throw new Error("Conversation reset (" + reason + "). Ask again in the new conversation.");
}
```

Optional: add a small “New conversation” button that calls `resetConversation(null)`.

- [ ] **Step 4: Manual UI check**

With stack up: submit two questions without reload; both should succeed. Force reset by temporarily lowering `MAX_CONTEXT_TOKENS` in a local build or by waiting for idle TTL with a shortened test constant if needed.

- [ ] **Step 5: Commit** (only if the user asks)

```bash
git add frontend/index.html
git commit -m "Send conversation_id from frontend and handle 409 reset"
```

---

### Task 7: Protocol + docs

**Files:**
- Modify: `protocol/inference.http.md`
- Modify: `protocol/types.md`
- Modify: `docs/SHEDULER.md` (sticky session note already present — align with `conversation_id`)
- Modify: `README.md` only if the public API example shows `/infer` body (add `conversation_id`)

**Interfaces:**
- Produces: docs matching implemented behavior + future truncated re-prefill note

- [ ] **Step 1: Update `protocol/inference.http.md` client request**

Document required `conversation_id`, `409` reasons (`session_full`, `session_gone`), and that concurrent requests for the same id are queued.

Document worker prefill `mode`, success fields `tokens_added` / `total_tokens_est`, and `409 session_full`.

Add **Future work** bullet: truncated-history re-prefill when session full (same `conversation_id`).

- [ ] **Step 2: Update `protocol/types.md`**

Add a short **Conversation** vs **Session** subsection: client `conversation_id` maps to worker `session_id` via coordinator soft-state.

- [ ] **Step 3: Align `docs/SHEDULER.md` opening**

Change the sticky rule to:

```
If request.conversation_id maps to a live registry entry:
    route to worker owning that session
Else:
    select worker by load score
```

- [ ] **Step 4: Commit** (only if the user asks)

```bash
git add protocol/inference.http.md protocol/types.md docs/SHEDULER.md README.md
git commit -m "Document conversation-scoped session reuse protocol"
```

---

### Task 8: End-to-end verification

**Files:**
- None (manual / script checks). Optionally extend `test_inference.py` if it posts to `/infer`.

- [ ] **Step 1: Check `test_inference.py` / `test_inference.sh`**

If they POST without `conversation_id`, update them to send `crypto`-style UUIDs / `uuid.uuid4()`.

- [ ] **Step 2: Run coordinator unit tests**

```bash
cd coordinator && npm test
```

Expected: PASS.

- [ ] **Step 3: Run worker budget tests**

```bash
cd worker && cargo test budget::tests
```

Expected: PASS.

- [ ] **Step 4: Live multi-turn check** (stack running)

```bash
CID=$(uuidgen 2>/dev/null || python -c 'import uuid; print(uuid.uuid4())')
curl -N -X POST localhost:1337/coordinator/infer -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CID\",\"prompt\":\"Hi\",\"model\":\"tinyllama\",\"max_tokens\":16}"
# second turn same CID
curl -N -X POST localhost:1337/coordinator/infer -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CID\",\"prompt\":\"What did I just say?\",\"model\":\"tinyllama\",\"max_tokens\":32}"
```

Expected: both stream tokens; worker logs show continue on second prefill (`session.start` only once / continue path logs).

- [ ] **Step 5: Overlapping requests**

Fire two curls with same `CID` nearly simultaneously; second should wait; both eventually complete (or second starts after first SSE ends).

- [ ] **Step 6: Missing `conversation_id` → 400**

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST localhost:1337/coordinator/infer \
  -H 'content-type: application/json' \
  -d '{"prompt":"x","model":"tinyllama","max_tokens":8}'
```

Expected: `400`.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Multi-turn KV reuse | 3, 5 |
| Coordinator-held `conversation_id` map | 1, 5 |
| Required `conversation_id` in body | 5, 6, 7 |
| Continue = new prompt only | 3, 5 |
| Full = KV or token budget | 2, 3 |
| `409 session_full` / `session_gone` | 3, 5, 6 |
| FIFO queue per conversation | 1, 5 |
| Idle TTL 5 min | 1 |
| No session teardown on turn end | 5 |
| Decode grows tracked tokens | 4 |
| Frontend + protocol docs | 6, 7 |
| Future truncated re-prefill documented only | 7 |
| E2E tests from spec | 8 |

## Self-review notes

- No truncated re-prefill implementation tasks (YAGNI / spec non-goal).
- Registry `acquire` release must run in `finally` even when returning `409` before decode.
- `sessionTracker.sessionEnd` only on conversation teardown paths so capacity stays accurate for live KV sessions.
- Worker create path must still call `check_capacity` for new sessions; continue must not.
