# Frontend Elapsed Time on Status — Design Spec

**Date:** 2026-07-22  
**Status:** Approved for implementation planning

## Goal

Show how long a request took, alongside the existing `#status` text, after an inference attempt finishes (success or error).

## Decisions

| Topic | Choice |
|-------|--------|
| Measurement | Client wall-clock from Submit click until stream finishes / error |
| Display | Inline in `#status`: `Done · 1.24s` / `<error> · 0.41s` |
| Format | Seconds with two decimals (`(ms / 1000).toFixed(2) + "s"`) |
| Mid-flight | Keep `Streaming…` with no live updating timer |
| Validation-only exits | No timer (e.g. empty prompt) |

## Scope

- **In:** `frontend/index.html` only — start timing on valid submit; append elapsed to success and error status strings.
- **Out:** Server-reported latency, separate DOM element, live timer during streaming, CSS redesign.

## Behavior

1. After prompt validation and max-tokens clamp succeed, record `startedAt = performance.now()`.
2. Clear response; set status to `Streaming…`; disable submit (unchanged).
3. On successful stream end: `setStatus("Done · " + formatElapsed(performance.now() - startedAt), false)`.
4. On catch (HTTP error, stream error, network): `setStatus(message + " · " + formatElapsed(...), true)`.
5. `formatElapsed(ms)` returns `(ms / 1000).toFixed(2) + "s"`.

## Testing

Manual: submit a prompt; confirm Done shows `· X.XXs`. Force an error (bad model / stop coordinator); confirm error line also includes elapsed time. Empty prompt still shows validation message with no duration suffix.
