# Speculative Decoding — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the worker to `llama-cpp-4`, refactor decode to incremental token streaming, and ship baseline + n-gram speculative decoding with partial auto-selection (`ngram` vs `baseline` only).

**Architecture:** Replace `llama_cpp` 0.3 with `llama-cpp-4`'s batch decode loop. Introduce `SpeculativeDecoder`; `http::decode` drives a step loop via `TokenEmitter`. Phase 1 resolves only `Ngram` or `Baseline`.

**Tech Stack:** Rust/Axum worker, `llama-cpp-4` 0.4.x.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-02-speculative-decoding-design.md` Phase 1 scope.
- Coordinator protocol unchanged.
- `SPECULATIVE_ENABLED=false` or `SPEC_TYPE=none` → baseline.
- Spec errors fall back to baseline for session remainder.
- Default: `SPECULATIVE_ENABLED=true`, `SPEC_TYPE=auto` → ngram when enabled.
- Commit only if user asks.

## File map

| File | Role |
|------|------|
| `worker/Cargo.toml` | `llama-cpp-4 = "0.4"` |
| `worker/src/backend.rs` | LlamaBackend holder |
| `worker/src/session_handle.rs` | Per-session LlamaContext |
| `worker/src/model.rs` | Load + prefill |
| `worker/src/spec_config.rs` | Env + Phase 1 resolve |
| `worker/src/speculative/mod.rs` | Trait + factory + run_decode |
| `worker/src/speculative/baseline.rs` | One-token steps |
| `worker/src/speculative/ngram.rs` | N-gram draft + verify |
| `worker/src/http.rs` | Wire speculative loop |
| `worker/src/state.rs` | InferenceSession type |
| `worker/src/main.rs` | Backend + SpecConfig in state |
| `worker/src/metrics.rs` | Draft/acceptance counters |
| `worker/src/heartbeat.rs` | spec_strategy field |
| `README.md`, `docs/WORKER.md` | Docs |

Future: Phase 2 = draft model; Phase 3 = MTP + EAGLE + full auto.

---

### Task 1: Dependency swap + backend

- [ ] Replace `llama_cpp` with `llama-cpp-4` in `Cargo.toml`
- [ ] Add `backend.rs` with `LlamaBackendHandle::init()`
- [ ] Init backend in `main.rs`
- [ ] Run `cargo build` — expect model.rs errors

### Task 2: Model + prefill rewrite

- [ ] `session_handle.rs` with `InferenceSession`
- [ ] Prefill via `str_to_token` + `LlamaBatch` + `ctx.decode`
- [ ] Update `state.rs`, `http.rs` prefill path
- [ ] Smoke test prefill/infer

### Task 3: SpecConfig

- [ ] `spec_config.rs` with `SpecStrategy::{Baseline,Ngram}`
- [ ] `resolve()`: auto/ngram→Ngram; none/disabled→Baseline; draft/mtp/eagle3→warn+Ngram
- [ ] Unit tests + startup log

### Task 4: Baseline decoder

- [ ] `SpeculativeDecoder` trait, `StepResult`, `DraftStats`
- [ ] `BaselineDecoder`: greedy sample + decode per step
- [ ] `run_decode()` emits via TokenEmitter, respects max_tokens
- [ ] Mock decoder unit test

### Task 5: N-gram decoder

- [ ] Rust-side n-gram proposer (no llama-cpp-4 wrapper yet)
- [ ] Verify drafts on target context; emit accepted prefix
- [ ] Wire `make_decoder()`

### Task 6: Decode handler

- [ ] Router state `(Sessions, ModelManager, SpecConfig)`
- [ ] Remove `generate_tokens`; use `run_decode`
- [ ] Step error → baseline fallback
- [ ] Integration: default, `SPEC_TYPE=none`, `SPEC_TYPE=ngram`

### Task 7: Metrics + docs

- [ ] `record_spec_step`, acceptance rate, heartbeat `spec_strategy`
- [ ] README env vars; WORKER.md diagram
- [ ] `cargo test && cargo build --release`

**Ranking:** #1 Incremental delivery.
