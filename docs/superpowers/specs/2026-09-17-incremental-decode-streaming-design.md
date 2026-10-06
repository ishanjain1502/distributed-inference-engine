# Incremental Decode Streaming — Design Spec

**Date:** 2026-09-17  
**Status:** Approved for implementation planning  
**Scope:** Worker-side incremental token emission on `llama_cpp` 0.3. Fix TTFT and wire real backpressure at the worker→coordinator boundary. No crate migration, no coordinator protocol changes.

## Goal

Today the worker generates the **full** completion in memory, then iterates the result into the SSE channel. Clients therefore wait for nearly all tokens before seeing the first one, and the bounded 32-token channel never pauses decode during generation.

After this change:

1. **TTFT** ≈ time for one forward pass after prefill (not `max_tokens` passes).
2. **Worker→coordinator backpressure** blocks the decode emit loop when the 32-token channel is full (coordinator slow to read worker SSE).
3. **Coordinator and client protocol unchanged** — same SSE payload shape (`token` + `seq`).

## Decisions

| Topic | Choice |
|-------|--------|
| Crate | Stay on `llama_cpp` 0.3 (Approach A). No `llama-cpp-4` migration in this work. |
| API surface | Worker `/worker/decode` request/response unchanged. Coordinator `/coordinator/infer` unchanged. |
| Decode API | Keep `start_completing_with` **once per decode** (crate requirement). Iterate `CompletionHandle::into_strings()` incrementally; do **not** `.collect()`. |
| Threading | Single `spawn_blocking` task per decode: start completion, loop `strings.next()`, `emit_blocking` each piece. |
| Session lock | Hold `Mutex<LlamaSession>` only for `start_completing_with`, then release while iterating (background llama thread owns cloned session). |
| Cancel | On `emit_blocking` failure (receiver dropped) or SSE consumer gone: break loop, drop `CompletionHandle` → llama background thread stops (`tx.send` fails). |
| `finished` flag | **Out of scope.** Keep `{ token, seq }` on worker SSE. Protocol docs that mention `finished` are a separate alignment task. |
| Metrics | Record per-token decode count after loop (or sync counter inside blocking task + one async flush). Optional: log `decode.first_token_ms`. |
| Out of scope | `llama-cpp-4`, speculative decoding, coordinator admission changes, real tokenizer/KV accounting, `finished` on client SSE, continuous batching, GPU |

## Background: Current vs Target

### Current (broken for TTFT)

```
POST /decode
  spawn async task
    spawn_blocking: start_completing → into_strings().collect()  // ALL tokens
    return Vec<String>
  for token in vec { emitter.emit().await }  // fake streaming
```

First client-visible token arrives after **full** generation.

### Target

```
POST /decode
  spawn async task
    spawn_blocking:
      lock session
      handle = start_completing_with(sampler, max_tokens)
      unlock session
      for token in handle.into_strings():
        emit_blocking(token)?   // blocks when channel full (32)
        on Err → break (client/coordinator disconnect)
    update session budget + metrics
```

First client-visible token arrives after **first** iterator step.

## `llama_cpp` 0.3 Constraints

From crate source (`llama_cpp-0.3.2`):

| Fact | Implication |
|------|-------------|
| `start_completing_with` spawns a **background OS thread** | Do not call it per token; call once per decode session. |
| Background thread sends tokens via **`UnboundedReceiver`** | Internal buffer can grow if we stop calling `next()` while generation continues. |
| Dropping `CompletionHandle` stops generation | When `rx` is dropped, `tx.send` fails and the background thread exits. |
| `into_strings()` is lazy | Each `.next()` waits for the next token from the background thread — sufficient for TTFT. |

### Backpressure honesty (ponytail)

**Upgrade to stepwise decode on the inference thread** (e.g. `llama-cpp-4` refactor) **if** slow-client scenarios show unbounded internal buffering exceeding acceptable memory (e.g. `max_tokens=1000` with many stalled sessions).

For v1:

- Worker→coordinator path uses bounded channel (32) — **real backpressure at the SSE boundary**.
- Llama background thread may continue filling its internal unbounded queue while emit is blocked — bounded by `max_tokens` per request and session count.
- On disconnect, drop the iterator/handle promptly to stop the background thread.

This is acceptable for TinyLlama demos and matches Approach A scope.

## Architecture

```
Client          Coordinator              Worker
  |                  |                      |
  | POST /infer      |                      |
  |----------------->| POST /decode         |
  |                  |--------------------->|
  |                  |                      | spawn_blocking decode loop
  |                  |                      |   start_completing_with (once)
  |                  |                      |   loop: next string → emit_blocking
  |                  |<==== SSE token,seq ==|   (blocks if mpsc full)
  |<==== SSE ========|                      |
```

Coordinator path (`streamTokensToClient`) is already incremental — **no code changes required** for the core TTFT fix.

## Components to Change

| File | Change |
|------|--------|
| `worker/src/model.rs` | Remove `generate_tokens()`. Add `run_decode_stream(session, max_tokens, emitter)` (or equivalent) encapsulating blocking loop. |
| `worker/src/stream.rs` | Add `emit_blocking(&self, token: String) -> Result<u64, EmitError>`. Reuse existing `seq` atomic. Extend unit tests. |
| `worker/src/http.rs` | Replace batch `generate_tokens` + `for` loop with `run_decode_stream`. Preserve `DecodeEndReason`, session budget update, logging. |
| `worker/src/metrics.rs` | Optional `first_token_latency_ms` on decode; ensure TPS still updates per token. |
| `docs/WORKER.md` | Align decode flow diagram with implementation (remove placeholder sleep). |
| `docs/STREAMING.md` | Clarify backpressure applies during emit loop, note llama_cpp 0.3 internal queue caveat. |
| `README.md` | Fix stale “LLM integration pending” in Current Status (separate small doc fix). |

### Unchanged

| File | Reason |
|------|--------|
| `coordinator/src/infer.ts` | Already forwards worker SSE as it arrives. |
| `coordinator/src/types.ts` | `TokenMessage` unchanged. |
| `worker/src/state.rs` | Session lifecycle unchanged. |
| `protocol/*` | No wire-format change in this spec. |

## Decode Loop Detail

### Pseudocode (blocking task)

```text
fn run_decode_stream(session: Arc<Mutex<LlamaSession>>, max_tokens: u32, emitter: TokenEmitter) -> DecodeStreamResult:
    let mut guard = session.lock()?
    let handle = guard.start_completing_with(StandardSampler::default(), max_tokens as usize)?
    drop(guard)

    let mut strings = handle.into_strings()
    let mut tokens_emitted = 0
    let mut end_reason = Complete

    while let Some(token) = strings.next():
        match emitter.emit_blocking(token):
            Ok(_) => tokens_emitted += 1
            Err(_) => end_reason = ClientDisconnect; break

    return { tokens_emitted, end_reason }
```

### Error handling

| Condition | Behavior |
|-----------|----------|
| `start_completing_with` fails | `DecodeEndReason::Error`, log, record decode failure, empty SSE stream |
| `emit_blocking` fails | `ClientDisconnect`, stop iteration (handle dropped → llama thread stops) |
| Iterator ends normally | `Complete` |
| `spawn_blocking` panics | Existing `??` / error path in `http.rs` |

Session budget update (`approx_tokens`, `kv_cache_bytes`) stays at end of decode task — same as today, using `tokens_emitted` count.

## Testing

### Unit tests (no model file)

| Test | File | Asserts |
|------|------|---------|
| `emit_blocking` blocks when channel full | `stream.rs` | Third send waits until recv |
| `emit_blocking` fails when receiver dropped | `stream.rs` | Returns error after drop |
| Thread / session params | `model.rs` | Existing tests unchanged |

### Integration / manual

| Check | Command / method | Expected |
|-------|------------------|----------|
| Progressive UI | `./start.sh`, infer in browser | Tokens appear one-by-one, not in one burst |
| TTFT improvement | `python scripts/bench.py --mode bench --concurrency 1 --requests 5 --max-tokens 50` | `ttft_p50_ms` drops vs pre-change baseline (~18s in Aug 2026 baseline) |
| Backpressure smoke | Artificially slow coordinator read (optional dev test) | Worker decode task blocks; no worker OOM at modest concurrency |
| Multi-turn | Same `conversation_id`, two turns | Second turn still continues session (KV reuse intact) |

## Verification Gate (definition of done)

- [ ] Worker compiles on Windows + Linux (existing Docker path).
- [ ] Single-request infer shows first token within seconds, not after full completion.
- [ ] Bench TTFT p50 materially lower than batch baseline at `max_tokens=50`.
- [ ] No coordinator changes required for happy path.
- [ ] `docs/WORKER.md` and `docs/STREAMING.md` updated.

## Relationship to Future Work

| Follow-on | Dependency on this work |
|-----------|-------------------------|
| Speculative decoding (`llama-cpp-4`) | Requires incremental per-token emit loop — this spec delivers that pattern on 0.3. |
| In-flight decode admission (item #2) | Needs honest TTFT before admission tuning is meaningful. |
| Summary re-prefill on failure (item #3) | Independent. |
| Protocol `finished` flag | Optional doc/API alignment; not blocking. |

## Risks

| Risk | Mitigation |
|------|------------|
| Holding session mutex too long | Release after `start_completing_with` |
| UTF-8 split tokens | Use crate `into_strings()`, not raw token bytes |
| Internal unbounded llama buffer under slow clients | Document; stop thread on disconnect; cap `max_tokens` |
| Metrics from blocking thread | Use atomic counter in blocking task; async metrics flush after join |
