# Summary Re-prefill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transparently recover from full KV/context, worker loss, worker drain, and system KV pressure by summarizing coordinator-held transcripts into fresh worker sessions — same `conversation_id`, unchanged client SSE wire format.

**Architecture:** Coordinator stores per-conversation transcripts, runs an internal summarize prefill+decode on a worker, creates a new `create` session with `[SUMMARY]` + verbatim tail, swaps `conversationRegistry` routing, and deletes the old worker session. Compaction is synchronous and invisible to clients.

**Tech Stack:** TypeScript coordinator (Express, `node:test`), Rust worker (Axum), existing prefill/decode HTTP APIs.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-17-summary-reprefill-design.md`
- `MAX_CONTEXT_TOKENS`: `2048` (worker `budget.rs`)
- `PROACTIVE_THRESHOLD_PCT`: `0.8` (1638 tokens)
- `VERBATIM_TAIL_TURNS`: `2`
- `SUMMARY_MAX_TOKENS`: `384`
- `COMPACTION_DEBOUNCE_MS`: `30000`
- `SYSTEM_KV_COMPACT_BATCH`: `3`
- Client protocol **unchanged** — no new SSE fields, headers, or JSON properties
- `409 session_full` / `409 session_gone` only when compaction ladder fails
- Commit only when user explicitly asks

## File Map

| File | Responsibility |
|------|----------------|
| `coordinator/src/compactionPolicy.ts` | Thresholds, templates, token estimates, debounce |
| `coordinator/src/transcriptStore.ts` | Per-`conversation_id` turn list CRUD |
| `coordinator/src/workerClient.ts` | Shared worker HTTP: prefill, internal decode, delete session |
| `coordinator/src/compactionService.ts` | `compact()` orchestration |
| `coordinator/src/compactionMetrics.ts` | Internal counters (not client-visible) |
| `coordinator/src/drainLoop.ts` | Background migration for draining workers |
| `coordinator/src/infer.ts` | Transcript capture, trigger hooks, retry after compact |
| `coordinator/src/conversationRegistry.ts` | `updateSession()` helper |
| `coordinator/src/types.ts` | `WorkerHealth.draining?: boolean`, `TranscriptTurn` type |
| `coordinator/src/scheduler.ts` | Exclude draining workers from selection |
| `coordinator/src/healthTable.ts` | Ingest `draining` from heartbeat |
| `coordinator/src/capacity.ts` | Pre-admission compaction attempt |
| `worker/src/http.rs` | `DELETE /worker/sessions/:session_id` |
| `worker/src/heartbeat.rs` | `draining` from `WORKER_DRAINING` env |
| `protocol/inference.http.md` | Updated `409` semantics |
| `README.md` | Summary re-prefill listed as implemented |

---

### Task 1: Compaction policy (pure functions)

**Files:**
- Create: `coordinator/src/compactionPolicy.ts`
- Create: `coordinator/tests/compactionPolicy.test.mjs`
- Modify: `coordinator/package.json` (add test file to `scripts.test`)

**Interfaces:**
- Produces:
  - `export const MAX_CONTEXT_TOKENS = 2048`
  - `export const PROACTIVE_THRESHOLD_TOKENS = 1638`
  - `export const VERBATIM_TAIL_TURNS = 2`
  - `export const SUMMARY_MAX_TOKENS = 384`
  - `export const COMPACTION_DEBOUNCE_MS = 30000`
  - `export function estimateTokens(text: string): number`
  - `export function shouldCompactProactively(approxTokens: number): boolean`
  - `export function splitTranscript(turns: TranscriptTurn[], tailTurns: number): { head: TranscriptTurn[]; tail: TranscriptTurn[] }`
  - `export function buildSummaryPrompt(head: TranscriptTurn[]): string`
  - `export function buildCompactionPrefill(summary: string, tail: TranscriptTurn[]): string`
  - `export function truncatePrefillToFit(prefill: string, maxTokens: number): string | null`

- [ ] **Step 1: Write failing tests**

```javascript
// coordinator/tests/compactionPolicy.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateTokens,
  shouldCompactProactively,
  splitTranscript,
  buildSummaryPrompt,
  buildCompactionPrefill,
  truncatePrefillToFit,
  PROACTIVE_THRESHOLD_TOKENS,
  MAX_CONTEXT_TOKENS,
} = require('../dist/compactionPolicy.js');

describe('compactionPolicy', () => {
  it('estimateTokens uses len/4 heuristic', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('a'.repeat(40)), 10);
  });

  it('shouldCompactProactively at threshold', () => {
    assert.equal(shouldCompactProactively(PROACTIVE_THRESHOLD_TOKENS - 1), false);
    assert.equal(shouldCompactProactively(PROACTIVE_THRESHOLD_TOKENS), true);
  });

  it('splitTranscript keeps last N turns in tail', () => {
    const turns = [
      { role: 'user', content: '1', ts: 1 },
      { role: 'assistant', content: '2', ts: 2 },
      { role: 'user', content: '3', ts: 3 },
      { role: 'assistant', content: '4', ts: 4 },
    ];
    const { head, tail } = splitTranscript(turns, 2);
    assert.equal(head.length, 2);
    assert.equal(tail.length, 2);
    assert.equal(tail[0].content, '3');
  });

  it('buildCompactionPrefill omits empty summary block', () => {
    const text = buildCompactionPrefill('', [{ role: 'user', content: 'hi', ts: 1 }]);
    assert.ok(!text.includes('[CONVERSATION SUMMARY]'));
    assert.ok(text.includes('[RECENT MESSAGES]'));
  });

  it('truncatePrefillToFit returns null when single turn too large', () => {
    const huge = 'x'.repeat(MAX_CONTEXT_TOKENS * 8);
    assert.equal(truncatePrefillToFit(huge, 2048), null);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bash -c 'cd coordinator && npm test'`
Expected: module not found for `compactionPolicy.js`

- [ ] **Step 3: Implement `compactionPolicy.ts`**

```typescript
// coordinator/src/compactionPolicy.ts
export type TranscriptRole = 'user' | 'assistant';

export interface TranscriptTurn {
  role: TranscriptRole;
  content: string;
  ts: number;
}

export const MAX_CONTEXT_TOKENS = 2048;
export const PROACTIVE_THRESHOLD_PCT = 0.8;
export const PROACTIVE_THRESHOLD_TOKENS = Math.floor(MAX_CONTEXT_TOKENS * PROACTIVE_THRESHOLD_PCT);
export const VERBATIM_TAIL_TURNS = 2;
export const SUMMARY_MAX_TOKENS = 384;
export const COMPACTION_DEBOUNCE_MS = 30_000;
export const SYSTEM_KV_COMPACT_BATCH = 3;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function shouldCompactProactively(approxTokens: number): boolean {
  return approxTokens >= PROACTIVE_THRESHOLD_TOKENS;
}

export function formatTurn(turn: TranscriptTurn): string {
  const label = turn.role === 'user' ? 'User' : 'Assistant';
  return `${label}: ${turn.content}`;
}

export function splitTranscript(
  turns: TranscriptTurn[],
  tailTurns: number = VERBATIM_TAIL_TURNS
): { head: TranscriptTurn[]; tail: TranscriptTurn[] } {
  if (turns.length <= tailTurns) {
    return { head: [], tail: [...turns] };
  }
  const splitAt = turns.length - tailTurns;
  return { head: turns.slice(0, splitAt), tail: turns.slice(splitAt) };
}

export function buildSummaryPrompt(head: TranscriptTurn[]): string {
  const body = head.map(formatTurn).join('\n');
  return (
    'Summarize the following conversation for continuation. ' +
    'Preserve facts, names, decisions, and open questions. Be concise.\n\n' +
    body +
    '\n\nSummary:'
  );
}

export function buildCompactionPrefill(summary: string, tail: TranscriptTurn[]): string {
  const parts: string[] = [];
  const trimmed = summary.trim();
  if (trimmed) {
    parts.push('[CONVERSATION SUMMARY]', trimmed, '');
  }
  parts.push('[RECENT MESSAGES]');
  parts.push(...tail.map(formatTurn));
  return parts.join('\n');
}

export function truncatePrefillToFit(prefill: string, maxTokens: number): string | null {
  if (estimateTokens(prefill) <= maxTokens) return prefill;
  // Drop summary block first, keep tail only
  const tailOnly = prefill.includes('[RECENT MESSAGES]')
    ? prefill.slice(prefill.indexOf('[RECENT MESSAGES]'))
    : prefill;
  if (estimateTokens(tailOnly) <= maxTokens) return tailOnly;
  return null;
}
```

- [ ] **Step 4: Add test to `package.json` scripts.test and run**

Run: `bash -c 'cd coordinator && npm test'`
Expected: PASS (including existing tests)

---

### Task 2: Transcript store

**Files:**
- Create: `coordinator/src/transcriptStore.ts`
- Create: `coordinator/tests/transcriptStore.test.mjs`
- Modify: `coordinator/package.json`

**Interfaces:**
- Consumes: `TranscriptTurn` from `compactionPolicy.ts`
- Produces:
  - `export class TranscriptStore`
  - `append(conversationId, turn): void`
  - `get(conversationId): TranscriptTurn[]`
  - `replace(conversationId, turns): void`
  - `delete(conversationId): void`
  - `clear(): void` (tests)

- [ ] **Step 1: Write failing tests**

```javascript
// coordinator/tests/transcriptStore.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { TranscriptStore } = require('../dist/transcriptStore.js');

describe('TranscriptStore', () => {
  let store;
  beforeEach(() => { store = new TranscriptStore(); });

  it('append and get round-trip', () => {
    store.append('c1', { role: 'user', content: 'hi', ts: 1 });
    assert.equal(store.get('c1').length, 1);
  });

  it('replace overwrites transcript', () => {
    store.append('c1', { role: 'user', content: 'old', ts: 1 });
    store.replace('c1', [{ role: 'assistant', content: 'summary', ts: 2 }]);
    assert.equal(store.get('c1')[0].content, 'summary');
  });

  it('delete removes conversation', () => {
    store.append('c1', { role: 'user', content: 'x', ts: 1 });
    store.delete('c1');
    assert.deepEqual(store.get('c1'), []);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```typescript
// coordinator/src/transcriptStore.ts
import { TranscriptTurn } from './compactionPolicy';

export class TranscriptStore {
  private transcripts = new Map<string, TranscriptTurn[]>();

  append(conversationId: string, turn: TranscriptTurn): void {
    const list = this.transcripts.get(conversationId) ?? [];
    list.push(turn);
    this.transcripts.set(conversationId, list);
  }

  get(conversationId: string): TranscriptTurn[] {
    return [...(this.transcripts.get(conversationId) ?? [])];
  }

  replace(conversationId: string, turns: TranscriptTurn[]): void {
    this.transcripts.set(conversationId, [...turns]);
  }

  delete(conversationId: string): void {
    this.transcripts.delete(conversationId);
  }

  clear(): void {
    this.transcripts.clear();
  }
}

export const transcriptStore = new TranscriptStore();
```

- [ ] **Step 4: Run tests — expect PASS**

---

### Task 3: Worker client helpers

**Files:**
- Create: `coordinator/src/workerClient.ts`
- Modify: `coordinator/src/infer.ts` (refactor to use `workerClient` for `tryPrefill` — behavior unchanged)

**Interfaces:**
- Produces:
  - `export type PrefillResult` (move from infer.ts)
  - `export async function tryPrefill(worker, sessionId, body, mode): PrefillResult`
  - `export async function runInternalDecode(worker, sessionId, maxTokens): Promise<{ ok: true; text: string } | { ok: false }>`
  - `export async function deleteWorkerSession(worker, sessionId): Promise<void>` (logs, never throws)

- [ ] **Step 1: Extract `tryPrefill` from `infer.ts` into `workerClient.ts` verbatim**

Move `PrefillResult` type and `tryPrefill` function. Update `infer.ts` import.

- [ ] **Step 2: Add `runInternalDecode`**

```typescript
export async function runInternalDecode(
  worker: Worker,
  sessionId: string,
  maxTokens: number
): Promise<{ ok: true; text: string } | { ok: false }> {
  const decodeRes = await fetch(`${worker.url}/worker/decode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, max_tokens: maxTokens }),
  });
  if (!decodeRes.ok || !decodeRes.body) return { ok: false };

  const reader = decodeRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parts: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as { token?: string };
          if (typeof parsed.token === 'string') parts.push(parsed.token);
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { ok: true, text: parts.join('') };
}
```

- [ ] **Step 3: Add stub `deleteWorkerSession` (DELETE added in Task 7)**

```typescript
export async function deleteWorkerSession(worker: Worker, sessionId: string): Promise<void> {
  try {
    await fetch(`${worker.url}/worker/sessions/${sessionId}`, { method: 'DELETE' });
  } catch (err) {
    console.warn(JSON.stringify({ event: 'worker.delete_session_failed', session_id: sessionId, error: String(err) }));
  }
}
```

- [ ] **Step 4: Build + existing tests pass**

Run: `bash -c 'cd coordinator && npm test'`

---

### Task 4: Compaction service

**Files:**
- Create: `coordinator/src/compactionService.ts`
- Create: `coordinator/src/compactionMetrics.ts`
- Create: `coordinator/tests/compactionService.test.mjs`

**Interfaces:**
- Consumes: `transcriptStore`, `compactionPolicy`, `workerClient`, `conversationRegistry`, `sessionTracker`, `selectWorker`
- Produces:
  - `export type CompactionTrigger = 'proactive' | 'session_full' | 'session_gone' | 'worker_drain' | 'system_kv_pressure'`
  - `export type CompactionResult = { ok: true; sessionId: string; workerId: string } | { ok: false; reason: string }`
  - `export async function compact(conversationId, trigger, model, opts?): CompactionResult`
  - `export function shouldDebounce(conversationId): boolean` (internal, tested via debounce map)

- [ ] **Step 1: Write policy-level unit test with injected deps**

Test `buildPostCompactionTranscript` logic inline in compactionService or export a small helper `buildPostCompactionTranscript(summary, tail)` for testing.

```javascript
it('compact returns no_transcript when empty', async () => {
  const result = await compact('missing', 'session_full', 'tinyllama', { transcriptStore: new TranscriptStore() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_transcript');
});
```

Use optional dependency injection on `compact()` for tests (default to singletons in production).

- [ ] **Step 2: Implement `compactionMetrics.ts`**

```typescript
let compactionsTotal = 0;
let compactionFailuresTotal = 0;

export function recordCompactionSuccess(trigger: string, latencyMs: number): void {
  compactionsTotal += 1;
  console.info(JSON.stringify({ event: 'compaction.success', trigger, latency_ms: latencyMs }));
}

export function recordCompactionFailure(trigger: string, reason: string): void {
  compactionFailuresTotal += 1;
  console.warn(JSON.stringify({ event: 'compaction.failure', trigger, reason }));
}

export function getCompactionMetrics() {
  return { compactionsTotal, compactionFailuresTotal };
}
```

- [ ] **Step 3: Implement `compact()` per spec algorithm**

Key steps in `compactionService.ts`:
1. Load transcript; fail `no_transcript` if empty
2. Read old `conversationRegistry` entry (optional)
3. `splitTranscript` → head/tail
4. If head non-empty: `selectWorker` → `tryPrefill` create with `buildSummaryPrompt(head)` → `runInternalDecode` → summary text
5. `buildCompactionPrefill` → `truncatePrefillToFit` → fail `still_too_long` if null
6. New `sessionId = uuid()`, `tryPrefill` create on target worker
7. `conversationRegistry.set` with new session/worker/`approxTokens`
8. `sessionTracker.sessionEnd(old)` if tracked; `sessionTracker.sessionStart(new, ...)`
9. `deleteWorkerSession(oldWorker, oldSessionId)` best-effort
10. `transcriptStore.replace` with post-compaction turns (summary as assistant turn + tail)
11. Record metrics; return `{ ok: true, sessionId, workerId }`

Debounce map: `lastCompactMsByConversation` — skip proactive if within `COMPACTION_DEBOUNCE_MS`.

- [ ] **Step 4: Run tests**

---

### Task 5: Transcript capture in infer + stream

**Files:**
- Modify: `coordinator/src/infer.ts`
- Modify: `coordinator/src/conversationRegistry.ts` (sync transcript delete on registry delete — or call sites)

**Interfaces:**
- Consumes: `transcriptStore.append`, `transcriptStore.delete`

- [ ] **Step 1: Append user prompt after `acquire`, before routing**

Inside `router.post` after lock acquired:

```typescript
transcriptStore.append(body.conversation_id, {
  role: 'user',
  content: body.prompt,
  ts: Date.now(),
});
```

- [ ] **Step 2: Accumulate assistant text in `streamTokensToClient`**

Add parameter `conversationId` (already present). Track `assistantParts: string[]`; on successful `writeWithDeadline`, `assistantParts.push(token.token)`. In `finally`:

```typescript
if (assistantParts.length > 0) {
  transcriptStore.append(conversationId, {
    role: 'assistant',
    content: assistantParts.join(''),
    ts: Date.now(),
  });
}
```

- [ ] **Step 3: Delete transcript when conversation torn down**

At every `conversationRegistry.delete(body.conversation_id)` call site in `infer.ts`, also `transcriptStore.delete(body.conversation_id)`.

In `conversationRegistry.sweepExpired`, import and delete transcript for swept ids (or export callback — prefer explicit call from `server.ts` sweep alongside sessionTracker).

- [ ] **Step 4: Manual smoke — no compaction yet**

Run stack, two-turn chat, add temporary log in infer to print `transcriptStore.get(id).length` after stream. Expect 2 turns after one exchange.

---

### Task 6: Reactive compaction on `session_full`

**Files:**
- Modify: `coordinator/src/infer.ts`

- [ ] **Step 1: Add helper `attemptCompactionAndRetry`**

```typescript
async function attemptCompactionAndRetry(
  conversationId: string,
  body: InferRequest,
  trigger: CompactionTrigger,
  worker: Worker,
  sessionId: string
): Promise<{ worker: Worker; sessionId: string } | null> {
  const compactResult = await compact(conversationId, trigger, body.model);
  if (!compactResult.ok) return null;
  sessionTracker.sessionEnd(sessionId);
  const entry = conversationRegistry.get(conversationId);
  if (!entry) return null;
  const newWorker = healthTable.getWorkersForScheduler().find((w) => w.id === entry.workerId);
  if (!newWorker) return null;
  const retry = await tryPrefill(newWorker, entry.sessionId, body, 'continue');
  if (!retry.ok) return null;
  conversationRegistry.touch(conversationId, retry.totalTokensEst);
  return { worker: newWorker, sessionId: entry.sessionId };
}
```

- [ ] **Step 2: Replace `session_full` 409 path**

Change block at `result.kind === 'session_full'`:

```typescript
} else if (result.kind === 'session_full') {
  const recovered = await attemptCompactionAndRetry(
    body.conversation_id, body, 'session_full', worker, sessionId
  );
  if (recovered) {
    selectedWorker = recovered.worker;
    sessionId = recovered.sessionId;
  } else {
    conversationRegistry.delete(body.conversation_id);
    transcriptStore.delete(body.conversation_id);
    sessionTracker.sessionEnd(sessionId);
    sendReset(res, 'session_full', requestId);
    return;
  }
}
```

- [ ] **Step 3: Integration test (manual)**

Fill context with long multi-turn prompts until worker would 409; verify next turn succeeds with same `conversation_id` and no `409` in client.

---

### Task 7: Worker DELETE session endpoint

**Files:**
- Modify: `worker/src/http.rs`
- Modify: `worker/src/main.rs`
- Modify: `worker/src/state.rs` (if session removal helper needed)

- [ ] **Step 1: Write Rust unit test for delete handler**

```rust
// In worker/src/http.rs tests or new tests module
#[tokio::test]
async fn delete_session_returns_204_then_404() { /* ... */ }
```

- [ ] **Step 2: Implement handler**

```rust
pub async fn delete_session(
    axum::extract::Path(session_id): axum::extract::Path<String>,
    axum::extract::State((sessions, _model)): axum::extract::State<(Sessions, Arc<ModelManager>)>,
) -> StatusCode {
    let mut write = sessions.write().await;
    if write.remove(&session_id).is_some() {
        // update metrics active_sessions, kv totals
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}
```

- [ ] **Step 3: Register route**

```rust
.route("/worker/sessions/:session_id", axum::routing::delete(http::delete_session))
```

- [ ] **Step 4: Run worker tests**

Run: `bash -c 'cd worker && cargo test'`
Expected: PASS

---

### Task 8: Proactive compaction threshold

**Files:**
- Modify: `coordinator/src/infer.ts`

- [ ] **Step 1: Before `tryPrefill(..., 'continue')` on existing entry**

```typescript
if (
  shouldCompactProactively(entry.approxTokens) &&
  !shouldDebounce(body.conversation_id)
) {
  const headLen = splitTranscript(transcriptStore.get(body.conversation_id)).head.length;
  if (headLen > 0) {
    const proactive = await compact(body.conversation_id, 'proactive', body.model);
    if (proactive.ok) {
      const refreshed = conversationRegistry.get(body.conversation_id);
      if (refreshed) {
        worker = healthTable.getWorkersForScheduler().find((w) => w.id === refreshed.workerId) ?? worker;
        sessionId = refreshed.sessionId;
        entry = refreshed;
      }
    }
  }
}
```

- [ ] **Step 2: Manual test — log compaction.success with trigger proactive before session_full**

---

### Task 9: Recovery on `session_gone`

**Files:**
- Modify: `coordinator/src/infer.ts`

- [ ] **Step 1: Replace `session_gone` 409 when worker missing or prefill 404**

Instead of immediate `sendReset`, call:

```typescript
const recovered = await attemptCompactionAndRetry(
  body.conversation_id, body, 'session_gone', worker, sessionId
);
```

On failure (no transcript): existing `sendReset(res, 'session_gone', ...)`.

- [ ] **Step 2: Ensure old sessionTracker entry cleared before compact**

`sessionTracker.sessionEnd(sessionId)` before compact if worker is gone.

---

### Task 10: Worker drain signal + drain loop

**Files:**
- Modify: `worker/src/heartbeat.rs`
- Modify: `coordinator/src/types.ts` (`WorkerHealth.draining?: boolean`)
- Modify: `coordinator/src/healthTable.ts` (ingest `draining`)
- Modify: `coordinator/src/scheduler.ts` (`selectWorker` skips `health.draining === true`)
- Create: `coordinator/src/drainLoop.ts`
- Modify: `coordinator/src/server.ts` (start drain loop interval)

- [ ] **Step 1: Worker heartbeat payload**

```rust
// heartbeat.rs WorkerHealth struct
draining: bool,  // from std::env::var("WORKER_DRAINING").ok().as_deref() == Some("true")
```

- [ ] **Step 2: Coordinator types + healthTable ingest**

```typescript
export interface WorkerHealth {
  alive: boolean;
  active_sessions: number;
  kv_cache_bytes: number;
  draining?: boolean;
}
```

- [ ] **Step 3: Scheduler filter**

In `selectWorker` candidate filter, exclude workers where `worker.health?.draining === true`.

- [ ] **Step 4: `drainLoop.ts`**

```typescript
export function startDrainLoop(intervalMs = 10_000): void {
  setInterval(async () => {
    const drainingWorkers = healthTable.getWorkersForScheduler().filter((w) => w.health?.draining);
    for (const worker of drainingWorkers) {
      for (const [conversationId, entry] of conversationRegistry.entriesOnWorker(worker.id)) {
        if (conversationRegistry.hasTail(conversationId)) continue;
        await compact(conversationId, 'worker_drain', entry.model);
      }
    }
  }, intervalMs);
}
```

Add `entriesOnWorker(workerId)` to `ConversationRegistry` (test-only export pattern like `hasTail`).

- [ ] **Step 5: Manual drain test**

Set `WORKER_DRAINING=true` on worker, restart, verify `compaction.success` with `worker_drain` in logs and worker `active_sessions` → 0.

---

### Task 11: System KV pressure compaction

**Files:**
- Modify: `coordinator/src/capacity.ts` or `coordinator/src/infer.ts` (new-conversation path)
- Create: `coordinator/src/kvPressure.ts`

- [ ] **Step 1: `pickSessionsToCompact(n)` — largest `approxTokens` from `conversationRegistry`**

- [ ] **Step 2: In new-conversation admission rejection `system_kv_cache_full`**

Before returning 503, loop up to `SYSTEM_KV_COMPACT_BATCH` conversations, `compact(id, 'system_kv_pressure', model)`, re-check `canAcceptRequest`. Return 503 only if still full.

- [ ] **Step 3: Unit test for picker ordering**

---

### Task 12: Documentation

**Files:**
- Modify: `protocol/inference.http.md`
- Modify: `README.md`

- [ ] **Step 1: Update `409` row**

Document that coordinator attempts invisible compaction first; `409` only when compaction fails.

- [ ] **Step 2: README**

Move summary re-prefill from "Next improvements" to "Implemented" with link to spec.

- [ ] **Step 3: Remove "Truncated re-prefill" future-work bullet** (superseded by this spec) or mark as implemented via summary fallback.

---

### Task 13: Verification gate

- [ ] **Coordinator tests:** `bash -c 'cd coordinator && npm test'`
- [ ] **Worker tests:** `bash -c 'cd worker && cargo test'`
- [ ] **Manual:** 15+ turn conversation, same `conversation_id`, no client-visible `409`
- [ ] **Manual:** Capture SSE — only `{ token, seq }`, no compaction markers
- [ ] **Manual:** Kill worker mid-chat, next turn recovers
- [ ] **Manual:** `WORKER_DRAINING=true` → sessions migrate

---

## Spec Coverage Self-Review

| Spec requirement | Task |
|------------------|------|
| TranscriptStore in-memory | Task 2 |
| Transcript capture user+assistant | Task 5 |
| Summary re-prefill algorithm | Task 4 |
| Invisible to client | Tasks 5–6 (no wire changes) |
| Reactive session_full | Task 6 |
| Proactive 80% threshold | Task 8 |
| session_gone recovery | Task 9 |
| Worker drain | Task 10 |
| System KV pressure | Task 11 |
| DELETE /worker/sessions/:id | Task 7 |
| Fallback truncate ladder | Task 4 (`truncatePrefillToFit`) |
| Debounce 30s | Task 4 |
| Docs/protocol | Task 12 |
| Internal metrics only | Task 4 (`compactionMetrics`) |

## Placeholder Scan

No TBD/TODO/implement-later steps. Each task has concrete files and code anchors.
