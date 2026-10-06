# Summary Re-prefill — Design Spec

**Date:** 2026-09-17  
**Status:** Implemented (2026-09-17)  
**Scope:** Coordinator-orchestrated conversation compaction via text summarization and fresh worker sessions. Covers session-full recovery, proactive threshold compaction, worker failure/drain migration, and system KV pressure relief. **Client protocol unchanged** — compaction is completely invisible.

## Goal

Today when a worker session hits KV/context budget (`session_full`), the worker is lost (`session_gone`), or a worker is drained, the coordinator returns `409` and the client must rotate `conversation_id`. Continuity is lost because:

1. KV cache state lives only on the worker and cannot be summarized or exported.
2. The coordinator stores no conversation transcript — only `{ sessionId, workerId, approxTokens }`.

After this change:

1. The coordinator maintains a **transcript** per `conversation_id` (user prompts + assistant completions).
2. On any compaction trigger, the coordinator **summarizes older turns**, **re-prefills** a fresh session (on any healthy worker), updates sticky routing, and **deletes** the old session.
3. The **same `conversation_id`** continues transparently. No new SSE event types, no response headers, no client-visible signal that compaction occurred.
4. `409 session_full` / `409 session_gone` are returned only when compaction itself fails (no transcript, summary+truncate still exceed budget, worker unavailable).

## Decisions

| Topic | Choice |
|-------|--------|
| Compaction strategy | **Summary re-prefill** — summarize older transcript turns, keep recent turns verbatim, prefill combined text into a new `create` session. |
| Client visibility | **Completely invisible.** Wire format unchanged (`{ token, seq }` on worker SSE; coordinator forwards as today). No `compacted` SSE event, no headers, no JSON fields. |
| Transcript storage | In-memory `Map` on coordinator, keyed by `conversation_id`. Same process lifetime as `conversationRegistry`. Cleared on idle TTL sweep. |
| Summarization model | Same model as the conversation (`body.model` on TinyLlama worker). Fixed prompt template; `max_tokens` capped (default 384). |
| Compaction timing (v1) | **Synchronous** — user's request blocks during summarization decode. Upgrade to async background compaction if p99 latency regresses. |
| KV cache migration | **Not attempted.** Raw KV tensor export/import is out of scope (`llama_cpp` 0.3 has no portable API). Text re-prefill is the migration primitive. |
| Worker session teardown | New `DELETE /worker/sessions/:session_id` endpoint for explicit cleanup after successful compaction. TTL eviction remains fallback. |
| Worker drain signal | Worker heartbeat adds optional `draining: boolean`. Coordinator stops scheduling new sessions to draining workers and migrates sticky conversations. |
| Proactive threshold | Compact when `approxTokens ≥ 80%` of `MAX_CONTEXT_TOKENS` (1638 at 2048) **before** continue prefill, if transcript has more than the verbatim tail. |
| Fallback ladder | (1) summary re-prefill → (2) truncated re-prefill (drop head, keep tail) → (3) `409` to client. |
| Out of scope | KV tensor export, persistent transcript DB, dedicated summarization model, client-side compaction UI, tokenizer-accurate KV accounting, GPU |

## Background: Why KV Cache Cannot Be Summarized

The worker KV cache is per-layer key/value attention tensors inside `LlamaSession`. It is opaque numerical state, not retrievable conversation text. There is no lossy compression of KV tensors that preserves model behavior while freeing context slots.

The portable representation of conversation state is **text**. Summary re-prefill trades some fidelity (summary is lossy) for unbounded multi-turn continuity within model context limits.

### Current failure path

```
Client → POST /infer (continue)
Coordinator → POST /worker/prefill (continue)
Worker → 409 session_full
Coordinator → 409 session_full → client rotates conversation_id
```

### Target path

```
Client → POST /infer (continue)
Coordinator → detect trigger (proactive threshold OR reactive session_full)
Coordinator → CompactionService.compact()
  → summarize head turns (internal prefill+decode)
  → prefill create on new worker with [SUMMARY] + [RECENT]
  → update conversationRegistry (same conversation_id)
  → DELETE old worker session
Coordinator → POST /worker/prefill (continue) on new session
Coordinator → POST /worker/decode → SSE tokens to client (unchanged shape)
```

Client observes slightly higher latency on compaction turns; otherwise identical behavior.

## Architecture

```
Client              Coordinator                         Worker(s)
  |                      |                                  |
  |-- POST /infer ------>|                                  |
  |  (conversation_id)   |-- [trigger?] compact()           |
  |                      |    TranscriptStore               |
  |                      |    CompactionService             |
  |                      |-------- prefill (summary) ------->|
  |                      |-------- decode (summary) -------->|
  |                      |-------- prefill (create) -------->|
  |                      |-------- DELETE old session ------>|
  |                      |-------- prefill (continue) ------>|
  |                      |-------- decode ------------------->|
  |<== SSE token,seq ====|                                  |
```

### New coordinator modules

| Module | Responsibility |
|--------|----------------|
| `transcriptStore.ts` | Per-`conversation_id` ordered `{ role: 'user' \| 'assistant', content: string, ts: number }[]`. CRUD, tail split, idle sweep with registry. |
| `compactionService.ts` | `compact(conversationId, trigger, opts)` — orchestrates summary decode, fresh session create, registry swap, old session delete, metrics/logging. |
| `compactionPolicy.ts` | Thresholds, verbatim tail turn count, summary `max_tokens`, debounce interval, prefill text template. |

### Changes to existing modules

| File | Change |
|------|--------|
| `coordinator/src/infer.ts` | Append user prompt to transcript at turn start; accumulate assistant text during `streamTokensToClient`; invoke compaction on triggers A–E before returning `409`; retry prefill after successful compact. |
| `coordinator/src/conversationRegistry.ts` | `updateSession(conversationId, { sessionId, workerId, approxTokens })` for post-compaction swap. |
| `coordinator/src/capacity.ts` | On `system_kv_cache_full`, attempt to compact largest/oldest sessions before rejecting (best-effort). |
| `coordinator/src/healthTable.ts` / heartbeat types | Honor `draining` flag in scheduler scoring. |
| `coordinator/src/scheduler.ts` | Exclude draining workers from new session selection; prefer non-draining targets for compaction. |
| `coordinator/src/stats.ts` | Internal metrics: `compactions_total`, `compaction_failures_total`, `compaction_latency_ms` (not exposed on client SSE). |
| `worker/src/http.rs` | `DELETE /worker/sessions/:session_id` — remove session, free KV. Idempotent 404 OK. |
| `worker/src/heartbeat.rs` | Optional `draining` field in heartbeat payload. |
| `protocol/inference.http.md` | Document invisible compaction behavior; update `409` semantics (only when compaction fails). |
| `README.md` | Move "Summary re-prefill" from planned to specified. |

## Transcript Capture

### When to append

| Event | Action |
|-------|--------|
| Request accepted (inside `acquire` lock) | Append `{ role: 'user', content: body.prompt }` |
| Each token successfully written to client SSE | Append to in-flight assistant buffer for this turn |
| Stream ends (complete, disconnect, timeout) | Flush assistant buffer as one `{ role: 'assistant', content }` turn (partial OK) |
| Compaction succeeds | Transcript **replaced** with synthetic turns: one `assistant` summary block + verbatim tail turns (not the raw pre-compaction transcript) |
| `conversationRegistry.delete` / idle TTL | `transcriptStore.delete(conversation_id)` |

### Concurrency

The existing per-`conversation_id` FIFO lock (`conversationRegistry.acquire`) serializes compaction and inference for the same conversation. No additional lock needed.

## Compaction Procedure

### Inputs

- `conversationId: string`
- `trigger: 'proactive' | 'session_full' | 'session_gone' | 'worker_drain' | 'system_kv_pressure'`
- `model: string` (from conversation entry or current request)
- `incomingPrompt?: string` — the user turn that triggered reactive compaction (already in transcript if appended at request start)

### Algorithm

```text
function compact(conversationId, trigger, model):
  transcript = transcriptStore.get(conversationId)
  if transcript is empty:
    return Failure('no_transcript')

  entry = conversationRegistry.get(conversationId)  // may be undefined for session_gone
  oldSessionId = entry?.sessionId
  oldWorkerId = entry?.workerId

  { head, tail } = splitTranscript(transcript, VERBATIM_TAIL_TURNS)  // default: 2 turns

  if head is empty:
    summary = ""
  else:
    summary = runSummarizationDecode(head, model)  // internal worker call
    if summary failed:
      summary = ""  // fall through to truncation-only

  prefillText = formatCompactionPrefill(summary, tail)

  if estimateTokens(prefillText) > MAX_CONTEXT_TOKENS:
    // truncation fallback: shrink tail turns until fits, or drop summary
    prefillText = truncateToFit(prefillText)
    if still too long:
      return Failure('still_too_long')

  targetWorker = scheduler.selectWorker(excludeDraining=true, exclude=oldWorkerId if draining)
  newSessionId = uuid()

  result = tryPrefill(targetWorker, newSessionId, { prompt: prefillText, model, mode: 'create' })
  if failed:
    return Failure('prefill_failed')

  conversationRegistry.set(conversationId, {
    sessionId: newSessionId,
    workerId: targetWorker.id,
    approxTokens: estimateTokens(prefillText),
    lastActiveMs: now(),
    model,
  })

  if oldSessionId and oldWorkerId:
    deleteWorkerSession(oldWorkerId, oldSessionId)  // best-effort, non-blocking on failure

  transcriptStore.replace(conversationId, buildPostCompactionTranscript(summary, tail))
  sessionTracker: end old session if tracked, start new session accounting

  log/metrics(compaction success, trigger, tokens_before, tokens_after)
  return Success({ sessionId: newSessionId, worker: targetWorker })
```

### Summarization prompt template

```text
Summarize the following conversation for continuation. Preserve facts, names, decisions, and open questions. Be concise.

{head formatted as User:/Assistant: lines}

Summary:
```

Summarization runs as a **coordinator-internal** prefill+decode on a selected worker, consuming the summary prompt and collecting the full decode output (not streamed to the client). `max_tokens` for this internal decode: **384** (configurable via `CompactionPolicy`).

### Post-compaction prefill format

```text
[CONVERSATION SUMMARY]
{summary text, or omitted if head was empty}

[RECENT MESSAGES]
{tail turns formatted as User:/Assistant: lines}
```

## Trigger Matrix

| ID | Trigger | Detection point | Coordinator action |
|----|---------|-----------------|-------------------|
| A | **Session full** | `tryPrefill` → `session_full` on continue | `compact()` → retry continue prefill on new session. No `409` if compact succeeds. |
| B | **Proactive** | `entry.approxTokens ≥ 0.8 × MAX_CONTEXT_TOKENS` before continue prefill | `compact()` if transcript has head beyond verbatim tail → then normal continue. |
| C | **Worker failure** | Worker missing from health table; prefill `404`/`session_gone` | `compact()` from transcript → new worker → retry user's turn. |
| D | **Worker drain** | Heartbeat `draining: true` | Background loop migrates all sticky conversations on that worker via `compact(trigger='worker_drain')`. New sessions not scheduled to draining worker. |
| E | **System KV full** | `canAcceptRequest` → `system_kv_cache_full` | Best-effort: compact sessions with largest `approxTokens` until admission passes or compaction exhausted; then `503`. |

### Worker drain lifecycle

1. Operator sets worker to draining (env `WORKER_DRAINING=true` or future admin API).
2. Worker heartbeat reports `draining: true`.
3. Coordinator drain loop (e.g. every heartbeat interval): for each `conversationRegistry` entry on draining worker, run `compact(trigger='worker_drain')`.
4. When worker reports `active_sessions: 0`, operator may stop/kill the worker process.

### Debounce

At most **one compaction per `conversation_id` per 30 seconds** (configurable). If a second trigger fires within the window, skip proactive compaction and rely on reactive `session_full` path. Prevents compaction storms on chatty clients.

## Client & Protocol

### Invisible compaction contract

- **No new SSE fields or event types.**
- **No response headers** indicating compaction.
- **No change** to request shape (`conversation_id`, `prompt`, `model`, `max_tokens`).
- Client continues reusing the same `conversation_id` across turns without awareness of backend session swaps.

### Updated error semantics

| Status | When (after this change) |
|--------|--------------------------|
| `409 session_full` | Compaction attempted and failed: no transcript, or post-truncation prefill still exceeds budget. |
| `409 session_gone` | Compaction attempted after worker loss but no transcript available, or compaction failed and recovery impossible. |
| `413 prompt_too_long` | Unchanged. Single-turn prompt exceeds context; compaction cannot help. |
| `503 system_kv_cache_full` | Unchanged, but coordinator tries compaction first. |

## Worker API Addition

### DELETE /worker/sessions/:session_id

**Request:** path parameter `session_id`

**Response:**
- `204 No Content` — session removed, KV freed.
- `404 Not Found` — session already gone (idempotent success for coordinator).

Coordinator calls this **after** successful compaction registry swap. Failures are logged but do not fail the user request (TTL eviction cleans up eventually).

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Summarization decode fails | Fall back to truncated re-prefill (tail only, no summary block). |
| Truncated prefill still too long | Return `409 session_full` to client. |
| No transcript on `session_gone` | Return `409 session_gone` (same as today). |
| Compaction prefill fails (capacity) | Return `503` with appropriate `reason`. |
| `DELETE` old session fails | Log warning; proceed (TTL eviction fallback). |
| Concurrent drain + user request | FIFO lock per `conversation_id` prevents double-compaction. |

## Configuration (defaults)

| Parameter | Default | Notes |
|-----------|---------|-------|
| `PROACTIVE_THRESHOLD_PCT` | `0.8` | Of `MAX_CONTEXT_TOKENS` (2048 → 1638) |
| `VERBATIM_TAIL_TURNS` | `2` | User+assistant pairs kept verbatim |
| `SUMMARY_MAX_TOKENS` | `384` | Internal summarization decode cap |
| `COMPACTION_DEBOUNCE_MS` | `30000` | Per conversation |
| `SYSTEM_KV_COMPACT_BATCH` | `3` | Max sessions to compact per admission rejection |

## Testing

### Unit tests (coordinator)

| Test | Asserts |
|------|---------|
| `splitTranscript` tail/head | Correct turn boundaries |
| `formatCompactionPrefill` | Template shape, empty summary omitted |
| `truncateToFit` | Drops oldest tail turns until under budget |
| Transcript append on user prompt | User turn recorded at request start |
| Assistant accumulation | Tokens joined into single assistant turn on stream end |
| Debounce | Second proactive trigger within window skipped |

### Integration / manual

| Check | Method | Expected |
|-------|--------|----------|
| Long multi-turn | 15+ turns same `conversation_id` | No `409`; conversation continues |
| Proactive compaction | Turn that would hit ~80% budget | Succeeds without `session_full` |
| Worker kill mid-conversation | Kill worker process, next turn | Transparent recovery, same `conversation_id` |
| Worker drain | Set `WORKER_DRAINING=true`, wait | Sessions migrate; worker reaches 0 sessions |
| Client invisibility | Capture SSE during compaction turn | Only `{ token, seq }` events; no compaction markers |
| Fallback | Force summary failure (mock) | Truncated re-prefill still works |
| `413` unchanged | Single prompt > 2048 tokens est. | Still `413`, not `409` |

## Implementation Phases

| Phase | Deliverable |
|-------|-------------|
| **1** | `transcriptStore.ts` + capture in `infer.ts` / `streamTokensToClient` |
| **2** | `compactionService.ts` + reactive compaction on `session_full` |
| **3** | Proactive threshold (trigger B) |
| **4** | `DELETE /worker/sessions/:id` + recovery on `session_gone` (trigger C) |
| **5** | Worker drain signal + migration loop (trigger D) |
| **6** | System KV pressure compaction (trigger E) + docs/protocol updates |

## Verification Gate (definition of done)

- [ ] 15+ turn conversation completes without client `conversation_id` rotation.
- [ ] SSE wire capture shows no new fields during compaction turns.
- [ ] Worker kill + next turn recovers transparently when transcript exists.
- [ ] Draining worker reaches zero sessions after sticky conversations migrate.
- [ ] `409` only when compaction ladder exhausts.
- [ ] Unit tests pass for transcript and compaction policy.
- [ ] `protocol/inference.http.md` and README updated.

## Risks

| Risk | Mitigation |
|------|------------|
| Summary quality poor on TinyLlama | Verbatim tail preserves recent context; template tuned for fact retention |
| Compaction latency spikes user-visible wait | Proactive threshold; debounce; internal metrics for tuning |
| Coordinator restart loses transcripts | Accepted for v1; persistence is follow-on |
| Double session accounting leak | `sessionTracker.sessionEnd` old + `sessionStart` new in compact() |
| Race on worker drain | Per-conversation lock; drain loop respects active locks |

## Relationship to Other Work

| Related spec | Interaction |
|--------------|-------------|
| Incremental decode streaming (2026-09-17) | Compaction uses same prefill+decode path; internal summary decode benefits from incremental emit |
| Conversation session reuse (2026-08-01) | Replaces client-visible `409 session_full` with coordinator-side recovery |
| Accurate tokenizer KV accounting (future) | Will improve proactive threshold accuracy; does not change compaction architecture |
