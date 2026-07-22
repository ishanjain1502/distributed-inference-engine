# Minimal Inference Frontend — Design Spec

**Date:** 2026-07-22  
**Status:** Approved for implementation planning

## Goal

Provide a minimal browser UI for the inference-engine: enter a question, stream the answer live onto the page. Plain HTML/CSS/JS only — no React, Next, or build tooling.

## Decisions

| Topic | Choice |
|-------|--------|
| Rendering | Stream tokens live (typewriter / growing text) |
| Serving | Coordinator serves the UI at `/` (same origin as API) |
| File layout | Single self-contained `frontend/index.html` (inline CSS + JS) |
| Interaction | Single turn — new submit replaces previous answer |
| Controls | Prompt + model name + max tokens |

## Architecture

```
Browser  →  GET /  →  frontend/index.html (via Express)
Browser  →  POST /coordinator/infer  →  existing SSE stream
```

- Static page lives at repo root: `frontend/index.html`.
- Coordinator (`coordinator/src/server.ts`) replaces the current Hello World root handler by serving that file (e.g. `express.static` on `../frontend` or explicit `sendFile` for `index.html`).
- Existing `/coordinator/health` and `/coordinator/infer` routes stay unchanged.
- No CORS changes required (same origin).
- No API schema changes.

## UI

- **Header:** short title (e.g. “Inference Engine”).
- **Form:**
  - Prompt: required textarea.
  - Model: text input, default `tinyllama-1.1b` (matches existing test scripts).
  - Max tokens: number input, default `50`, `min=1`, `max=1000` (README curl example ceiling). Clamp to `[1, 1000]` on submit.
  - Submit button: disabled while a stream is in progress.
- **Output:** one response panel; empty until submit; grows as tokens arrive (`white-space: pre-wrap`).
- **Status line:** idle / streaming / done / error.
- Styling: simple readable CSS inline in the HTML file — usable, not a design system.

## Data flow

1. On submit, validate non-empty prompt; clamp `max_tokens`.
2. Clear previous response text; set status to streaming; disable submit.
3. `POST /coordinator/infer` with JSON `{ prompt, model, max_tokens }`.
4. Non-200 responses: read body as text/JSON, show error in status, re-enable submit (covers 400, 503 capacity, 502).
5. On 200 (`text/event-stream`): read `res.body` with `ReadableStream` + `TextDecoder`; buffer incomplete lines.
6. For each complete line starting with `data:`: parse JSON; append `token` string to the panel; if payload has `error`, show it and stop.
7. On stream end: status “done”; re-enable submit.
8. Double-submit prevented by disabled button (AbortController optional, not required).

**Note:** `EventSource` is GET-only; the client must use `fetch` + stream reading.

## Error handling

| Case | UI behavior |
|------|-------------|
| Empty prompt | Do not call API; brief validation message |
| `max_tokens` out of range | Clamp to `[1, 1000]` before send |
| HTTP 4xx/5xx before stream | Show status error; re-enable submit |
| SSE payload `{ error: ... }` | Show error; stop appending; re-enable submit |
| Network / coordinator down | Show connection error; re-enable submit |

## Scope

### In scope

- `frontend/index.html` (HTML + inline CSS + inline JS)
- Coordinator change to serve the page at `/`
- Short README note: UI available at `http://localhost:1337` after `./start.sh`

### Out of scope

- Multi-turn chat / history
- Auth
- Model dropdown beyond a free-text field
- Stop/cancel button
- Metrics / health UI
- React or build tooling
- CORS for other origins
- Automated frontend tests

## Manual test plan

1. Start stack (`./start.sh`) → open `http://localhost:1337` → page loads.
2. Submit a short prompt → tokens stream into the response panel.
3. Submit again → previous answer cleared; new stream starts.
4. Set max tokens above 1000 → UI clamps to 1000 (or blocks over-max).
5. Empty prompt → no request.
6. Coordinator unavailable or 503 → error in status; submit re-enabled.

## Implementation notes

- Infer endpoint already streams SSE lines shaped like `data: {"token":"...","seq":N}\n\n` (see `test_inference.py`).
- Required body fields: `prompt`, `model`, `max_tokens` (coordinator returns 400 if missing).
- Path from `coordinator/src/server.ts` to frontend: resolve relative to project layout (e.g. `path.join(__dirname, '../../frontend')` from compiled `dist/`, or equivalent from source — verify against `tsconfig` outDir when implementing).
