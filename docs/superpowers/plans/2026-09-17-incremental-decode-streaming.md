# Incremental Decode Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stream worker decode tokens incrementally so TTFT reflects one forward pass and the bounded channel applies backpressure during generation.

**Architecture:** Replace batch `generate_tokens()` with `run_decode_stream()` — `start_completing_with` once, iterate `into_strings()`, `emit_blocking` per piece inside `spawn_blocking`. Coordinator unchanged.

**Tech Stack:** Rust worker, `llama_cpp` 0.3, Axum SSE.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-17-incremental-decode-streaming-design.md`
- Stay on `llama_cpp` 0.3 (no crate migration)
- Coordinator protocol unchanged (`token` + `seq`)
- Commit only if user asks

---

### Task 1: TokenEmitter blocking API — ✅

- [x] Add `emit_blocking` + `EmitError` in `worker/src/stream.rs`
- [x] Unit tests: backpressure + receiver dropped

### Task 2: Incremental decode loop — ✅

- [x] Add `run_decode_stream` + `DecodeStreamResult` in `worker/src/model.rs`
- [x] Remove `generate_tokens`

### Task 3: Wire decode handler — ✅

- [x] Update `worker/src/http.rs` to call `run_decode_stream`
- [x] Preserve logging, metrics, session budget updates

### Task 4: Docs — ✅

- [x] `docs/WORKER.md`, `docs/STREAMING.md`, `README.md` Current Status

### Task 5: Verification

- [x] `cargo test` in `worker/` (16 tests pass)
- [ ] Manual: `./start.sh` + UI progressive tokens
- [ ] Bench: `python scripts/bench.py --mode bench --concurrency 1 --requests 5 --max-tokens 50` (TTFT drop)
