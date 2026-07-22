# Frontend Token Usage on Status — Design Spec

**Date:** 2026-07-22  
**Status:** Approved for implementation planning

## Goal

On successful inference, show estimated prompt tokens and counted completion tokens alongside elapsed time on the `#status` line — without changing the API shape.

## Decisions

| Topic | Choice |
|-------|--------|
| Prompt tokens | Client estimate: `Math.ceil(prompt.length / 4)` (matches coordinator scheduling heuristic) |
| Completion tokens | Count each SSE `data:` payload with a string `token` field |
| Success display | `Done · 1.24s · ~12 + 48 tokens` |
| Errors | Elapsed time only (no token suffix) |
| API | Unchanged |

## Scope

- **In:** `frontend/index.html` only.
- **Out:** Server-reported usage events, true tokenizer counts, CSS redesign, showing tokens on error.

## Behavior

1. After valid submit, compute `promptTokens = Math.ceil(prompt.length / 4)`.
2. While streaming, increment `completionTokens` for each accepted token event (same path that appends text to the response panel).
3. On success:  
   `Done · ${formatElapsed(ms)} · ~${promptTokens} + ${completionTokens} tokens`
4. On error: unchanged from elapsed-time design — `message · ${formatElapsed(ms)}`.
5. Empty-prompt validation: no timer, no token stats.

## Testing

Manual: submit a prompt; confirm Done shows `· ~Np + Nc tokens` with `Nc` matching streamed pieces. Force an error; confirm no token suffix. Empty prompt unchanged.
