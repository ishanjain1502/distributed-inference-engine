# Speculative Decoding with Auto-Selection — Design Spec

**Date:** 2026-08-02  
**Status:** Approved for implementation planning  
**Scope:** Worker-side speculative decoding with automatic strategy selection (MTP, EAGLE-3, draft model, n-gram cache, baseline fallback). Coordinator protocol unchanged. Requires migration from `llama_cpp` 0.3 to `llama-cpp-4`.

## Goal

Increase decode throughput on the Rust worker by adding speculative decoding as a transparent optimization. Clients and the coordinator continue to use the same SSE token stream; the worker selects the best available speculation strategy based on model capabilities and configuration.

## Decisions

| Topic | Choice |
|-------|--------|
| Placement | Worker only; coordinator protocol unchanged in v1 |
| Crate | Migrate `llama_cpp` 0.3 → `llama-cpp-4` (speculative APIs unavailable in 0.3) |
| Strategy selection | Auto-resolve at worker startup; explicit `SPEC_TYPE` override supported |
| Modes (priority) | MTP → EAGLE-3 → draft model → n-gram cache → baseline |
| Streaming | Refactor decode from batch-then-stream to per-accepted-token emit |
| Failure policy | Best-effort: fall back to next strategy or baseline; never fail request solely due to spec misconfig |
| Metrics | Add draft/acceptance counters; expose `spec_strategy` in logs and heartbeat |
| Out of scope v1 | Coordinator API changes, cross-worker draft sharing, mid-session strategy switching, DFlash/DSpark |

## Background: Speculative Decoding

Autoregressive decoding generates one token per forward pass. Speculative decoding proposes multiple candidate tokens (via a draft mechanism), verifies them in parallel on the target model, and accepts the longest matching prefix. This amortizes target-model forward passes and increases tokens-per-second when acceptance rates are high.

llama.cpp supports several implementations (see upstream `docs/speculative.md`):

| Type | Mechanism | Extra weights |
|------|-----------|---------------|
| `draft-mtp` | Multi-token prediction heads on target model | None (same GGUF) |
| `draft-eagle3` | EAGLE draft reads target hidden states | EAGLE draft GGUF |
| `draft-simple` | Smaller separate draft model | Draft GGUF |
| `ngram-cache` | N-gram lookup (draftless) | None |
| `none` | Standard autoregressive | None |

The `llama-cpp-4` Rust crate exposes `MtpSession`, `Eagle3Session`, and upstream speculative helpers used by `llama-server`.

## Auto-Selection Logic

When `SPEC_TYPE=auto` (default), resolve at worker startup:

```
1. MTP         → target model reports n_layer_nextn > 0
2. EAGLE-3     → SPEC_EAGLE_DRAFT_PATH set and model supports EAGLE
3. Draft model → DRAFT_MODEL_PATH set and vocab compatibility check passes
4. N-gram      → SPECULATIVE_ENABLED=true (always available when enabled)
5. Baseline    → SPECULATIVE_ENABLED=false, or all above unavailable/failed
```

**Explicit override:** `SPEC_TYPE` may be `mtp | eagle3 | draft | ngram | none`. If the forced mode is not viable (e.g. `mtp` on TinyLlama), log a warning and fall back through the auto chain — do not crash.

**Vocab compatibility** (draft / EAGLE): at load time, compare tokenizer vocab sizes and a deterministic sample-tokenization hash; reject incompatible pairs before accepting traffic.

## Architecture

```
Client                     Coordinator                         Worker
  |                              |                                |
  | POST /infer                  |                                |
  |----------------------------->|---- POST /worker/prefill ------>|
  |                              |---- POST /worker/decode ------>|
  |<======== SSE tokens ===========================================|
  |                              |                                |
  |                    (coordinator unaware of spec strategy)       |
```

### Worker internals

```
main.rs
  └── SpecConfig::from_env()
  └── ModelManager (llama-cpp-4)
        ├── target: LlamaModel
        ├── draft:  optional LlamaModel (draft / eagle)
        └── resolved: SpecStrategy

http::decode()
  └── speculative::decode_stream(strategy, session, emitter)
        ├── MtpDecoder
        ├── Eagle3Decoder
        ├── DraftModelDecoder
        ├── NgramDecoder
        └── BaselineDecoder
              └── TokenEmitter → SSE (unchanged)
```

### New modules

| Module | Responsibility |
|--------|----------------|
| `spec_config.rs` | Parse env, auto-resolve strategy, vocab checks |
| `speculative/mod.rs` | `SpecStrategy` enum, factory, shared types |
| `speculative/mtp.rs` | `MtpSession` verify/accept loop |
| `speculative/draft.rs` | Classic draft+target loop |
| `speculative/eagle.rs` | EAGLE-3 session loop |
| `speculative/ngram.rs` | N-gram cache speculative path |
| `speculative/baseline.rs` | Current autoregressive decode |

## Decode Data Flow

Replace batch collection in `model::generate_tokens` with a stepwise loop:

```
until max_tokens or EOS or client disconnect:
  1. Draft   → propose 0..N candidate tokens (mode-specific)
  2. Verify  → target model evaluates candidates
  3. Accept  → sync KV cache with accepted prefix
  4. Emit    → stream each accepted token via TokenEmitter
  5. Metrics → record draft_count, accepted_count
```

Shared trait:

```rust
trait SpeculativeDecoder {
    fn decode_step(&mut self, emitter: &TokenEmitter) -> Result<StepResult>;
}
// StepResult: { tokens_emitted, finished, draft_stats }
```

`http::decode()` spawns a loop calling `decode_step()` until finished or client disconnect. Backpressure behavior unchanged via bounded `TokenEmitter` channel.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SPECULATIVE_ENABLED` | `true` | Master switch; `false` → baseline only |
| `SPEC_TYPE` | `auto` | `auto \| mtp \| eagle3 \| draft \| ngram \| none` |
| `DRAFT_MODEL_PATH` | unset | GGUF for draft-simple mode |
| `SPEC_EAGLE_DRAFT_PATH` | unset | EAGLE-3 draft weights |
| `SPEC_N_DRAFT_MAX` | `3` | Max tokens per speculation step |
| `SPEC_N_DRAFT_MIN` | `0` | Min draft tokens before verify |
| `SPEC_P_MIN` | `0.0` | MTP confidence threshold |

Startup log example:

```
speculative.resolved strategy=mtp n_draft_max=3 draft_model=none
```

## Memory & Capacity

| Mode | Extra memory beyond target KV |
|------|-------------------------------|
| MTP | Second context on same weights (minimal) |
| Draft | Full second model in RAM/VRAM |
| EAGLE | Draft model + hidden-state buffers |
| N-gram | Small lookup table (KB–MB) |
| Baseline | None |

Changes:

- `ModelManager::memory_footprint_bytes()` computed at load
- `check_capacity()` accounts for base model memory against worker limits
- Heartbeat payload gains optional `spec_strategy` and `model_memory_bytes` (coordinator ignores in v1)

## Metrics & Observability

Extend `metrics.rs`:

| Metric | Purpose |
|--------|---------|
| `spec_strategy` | Active mode label |
| `spec_draft_tokens_total` | Tokens proposed |
| `spec_accepted_tokens_total` | Tokens verified |
| `spec_acceptance_rate` | accepted / draft (rolling window) |
| `decode_tps` | Existing; should improve with good acceptance |

Session-end log:

```
session.end tokens_emitted=42 spec_strategy=draft acceptance_rate=0.72 draft_tokens=58
```

## Error Handling

| Failure | Behavior |
|---------|----------|
| Draft model load fails | Fall back to next strategy in auto chain |
| Vocab mismatch | Skip draft/eagle; try ngram or baseline |
| Spec decode step error | Log warning; fall back to baseline for remainder of session |
| Client disconnect | Stop loop; update session stats (unchanged) |
| MTP on unsupported model | Skip to draft/ngram/baseline |

Speculative decoding is best-effort: failed speculation never fails the HTTP request if baseline can continue.

## Testing

| Test | Verifies |
|------|----------|
| Unit: `SpecConfig::resolve()` | Auto-selection per env + model capabilities |
| Unit: vocab compatibility | Rejects mismatched draft/target pairs |
| Integration: baseline regression | TinyLlama without spec → valid stream, comparable output |
| Integration: ngram | `SPEC_TYPE=ngram` produces valid SSE stream |
| Integration: draft | Paired models stream tokens; acceptance_rate > 0 |
| Benchmark | TPS comparison baseline vs each mode on fixed prompt |

## Implementation Phases

1. Migrate `llama_cpp` → `llama-cpp-4`; restore prefill + baseline decode
2. Refactor decode to incremental streaming (`SpeculativeDecoder` trait)
3. Add n-gram mode (validates plumbing with minimal extra weights)
4. Add draft model mode + vocab check
5. Add MTP auto-detection
6. Add EAGLE-3 support
7. Wire auto-selection, metrics, README/docs

## Compatibility Notes

- Default **TinyLlama 1.1B** does not support MTP; with `SPEC_TYPE=auto` and no draft model, n-gram or baseline will be selected.
- Draft model pairs should be same model family with compatible tokenizers (e.g. Llama 3.1 8B + 1B, Qwen 32B + 1.5B).
- Windows build requirements (LLVM for `llama-cpp-sys`) remain; verify after crate migration.
