# Conversation Session Reuse — Design Spec

**Date:** 2026-08-01  
**Status:** Approved for implementation planning  
**Scope:** Multi-turn chat via coordinator-held `conversation_id` → sticky worker KV session; queue concurrent turns; client reset when session full. No truncated re-prefill in v1.

## Goal

Reuse the same worker `LlamaSession` (KV cache) across multiple `/infer` requests that share a `conversation_id`, until the session hits KV or context-token limits. Then force the client to start a new conversation. Document future truncated-history re-prefill as follow-on work.

## Decisions

| Topic | Choice |
|-------|--------|
| Product goal | Multi-turn chat with real KV reuse (not sticky-worker-only) |
| Session identity | Coordinator-held map: `conversation_id` → `{ session_id, worker_id, ... }` |
| Client key | Required `conversation_id` (UUID) in JSON body; client-generated |
| Continue payload | New user `prompt` only; prior assistant tokens already in KV from decode |
| Session full | Either per-session KV budget **or** context token budget exceeded |
| On full / reset | HTTP `409` with `reason: session_full` or `session_gone`; client uses a new `conversation_id` (required after full) |
| Concurrent turns | FIFO queue per `conversation_id` on coordinator (one in-flight decode) |
| Lifecycle start | First successful prefill creates registry entry |
| Lifecycle end | Idle TTL (align with worker 5 min), session_full, decode/prefill hard failure, worker loss |
| Approach | Coordinator conversation registry + worker continue-prefill |
| Out of scope v1 | Truncated re-prefill, durable registry across coordinator restart, KV migration |

## Background: Context vs KV

- **Context** = token sequence the model may attend to.
- **KV cache** = Key/Value tensors for those tokens, held only on the owning worker session.
- Prefill (`advance_context`) writes KV for new text tokens.
- Decode (`start_completing_with`) grows KV as each assistant token is generated; v1 does **not** need a separate post-decode `advance_context(answer)` when the same `LlamaSession` is retained.
- The model does not “remember” chat without a live session; a new session requires a full prefill of whatever text is provided.

## Architecture

```
Client                     Coordinator                         Worker
  |                              |                                |
  | POST /infer                  |                                |
  |  { conversation_id,          |                                |
  |    prompt, model,            |                                |
  |    max_tokens }              |                                |
  |----------------------------->|                                |
  |                              | ConversationRegistry lookup    |
  |                              | FIFO lock per conversation_id  |
  |                              |                                |
  |                              | miss: selectWorker + create    |
  |                              | hit:  sticky worker + continue |
  |                              |---- POST /worker/prefill ----->|
  |                              |<--- 200 ok | 409 session_full -|
  |                              |---- POST /worker/decode ------>|
  |<======== SSE tokens =========================================|
  |                              | release lock; touch TTL          |
```

### Components

| Piece | Responsibility |
|-------|----------------|
| `ConversationRegistry` | Soft-state map + per-id FIFO lock + idle TTL |
| `/infer` | Validate `conversation_id`; sticky route; queue; split request-end from session-end |
| Worker `/prefill` | Create or continue; enforce KV + token budgets; return `session_full` |
| Worker `/decode` | Unchanged API; session remains in map after stream completes |
| Frontend / protocol docs | Send `conversation_id`; handle `409` reset; document future truncated re-prefill |

Coordinator never stores KV tensors. Worker remains source of truth for session existence and budget checks.

## API & data model

### Client → Coordinator `POST /infer`

```json
{
  "conversation_id": "uuid",
  "prompt": "string",
  "model": "string",
  "max_tokens": number
}
```

- `conversation_id` is **required** (uniform multi-turn path).
- `prompt` is this turn’s user text only (not full history), when continuing a live session.
- Response remains `text/event-stream` token SSE. Optional debug metadata (`session_id`) may be added later; clients key on `conversation_id`.

### Errors

| Status | When |
|--------|------|
| `400` | Missing required fields including `conversation_id` |
| `503` | System / worker capacity (existing admission) |
| `409` | Reset required. Body includes `reason`: `session_full` (budget), or `session_gone` (worker/session lost / inconsistent). Client must start a **new** `conversation_id` for `session_full`; for `session_gone` may retry with a new id (recommended) or same id after registry clear (same id ⇒ fresh session). |
| `502` | Prefill/decode transport or worker failure on **create** path before a durable registry entry exists |

Concurrent turns use **queueing**, not `409 Conflict`.

### Registry entry

```
conversation_id → {
  session_id,
  worker_id,
  approx_tokens,
  last_active_ms,
  in_flight,
  waiters (FIFO)
}
```

Idle TTL: align with worker `SESSION_TTL` (300s). After expiry, the next `/infer` with the same `conversation_id` creates a **fresh** worker session (prior KV gone).

### Coordinator → Worker `POST /prefill`

```json
{
  "session_id": "uuid",
  "prompt": "string",
  "model": "string",
  "max_tokens": number,
  "mode": "create" | "continue"
}
```

- `mode` may be explicit or inferred (continue iff `session_id` exists on worker); prefer explicit from coordinator for clarity.
- Success: `200` with optional `tokens_added` / `total_tokens_est` for coordinator mirror.
- Full: `409 { "error": "...", "reason": "session_full" }`.
- Continue with unknown `session_id`: worker `404` → coordinator clears registry and surfaces `409` with `reason: session_gone`.
- Continue with mismatched `model`: reject `400`; do not mix models on one KV.

Decode request/response unchanged.

## Control flow

1. Validate body.
2. Acquire FIFO lock for `conversation_id`.
3. Registry miss → `selectWorker`, new `session_id`, prefill `mode=create`. On success, insert registry.
4. Registry hit → if worker unhealthy, clear registry and fail with reset semantics; else prefill `mode=continue` on sticky session.
5. On prefill success: update `approx_tokens`, `last_active`; keep session tracked across turns.
6. Decode and stream (existing SSE path).
7. On stream complete: update estimates from tokens written; touch TTL; **release lock**. Do **not** call conversation/session teardown on normal turn end.
8. On `session_full`: delete registry entry, release lock, return `409` to client.
9. On decode hard failure: clear registry (KV may be inconsistent), release lock.
10. On client disconnect mid-stream: release lock; **keep** registry and worker session (TTL); next turn may continue.

### Capacity

- **Create** counts toward worker/system session limits (existing checks).
- **Continue** does not allocate a new session slot; only per-session KV growth and token budget apply.

### Request end vs session end

Today, stream end calls `sessionTracker.sessionEnd`. v1 must distinguish:

- **Request/stream end** → stream metrics only; release conversation lock.
- **Session/conversation end** → TTL, `session_full`, hard failure, or worker loss.

## Budgets

| Budget | Source | Behavior |
|--------|--------|----------|
| Per-session KV | Existing `MAX_KV_CACHE_PER_SESSION` | On continue, project with estimate for new prompt; reject with `session_full` before mutate |
| Context tokens | New constant (e.g. `MAX_CONTEXT_TOKENS`), worker-authoritative | Reject continue/create when `current + added` would exceed |
| Bookkeeping | Update after decode with emitted token count when practical | Improves next-turn full detection |

Exact numeric token limit may be chosen at implementation time from model/`SessionParams` defaults; document the constant in worker state.

## Failure & restart

| Event | Behavior |
|-------|----------|
| Coordinator restart | Registry empty; same `conversation_id` creates a new session (silent cold start). Document. |
| Worker death / eviction | Next turn: continue fails → clear mapping → `409` reset semantics |
| Idle TTL (either side) | Mapping and/or KV dropped; same `conversation_id` starts fresh session |

Failover does **not** migrate KV (existing invariant).

## Future work (document only in v1)

When session is full, instead of client-only reset: re-prefill a **truncated** history into a new session for the same `conversation_id`. Not implemented in this change.

## Testing

1. Two sequential `/infer` with same `conversation_id` → same worker `session_id`; second prefill is continue.
2. Overlapping `/infer` same id → second waits; completion order matches queue order.
3. Force over budget → `409 session_full`; new `conversation_id` works; same id after clear creates fresh session.
4. Idle past TTL → fresh session for same `conversation_id`.
5. Worker unavailable mid-conversation → reset semantics on next turn.
6. Create-path admission / capacity regression still passes.

## Non-goals

- Truncated re-prefill on full
- Persisted conversation store / cross-coordinator durability
- Client-visible sticky `session_id` as primary key
- Parallel decodes on one conversation
- Moving KV across workers
