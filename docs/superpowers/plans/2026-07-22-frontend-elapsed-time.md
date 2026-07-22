# Frontend Elapsed Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show client wall-clock duration on the `#status` line after each inference attempt finishes (success or error).

**Architecture:** In `frontend/index.html`, record `performance.now()` after valid submit, then append ` · X.XXs` to Done and error status strings via a small `formatElapsed` helper. No API or CSS changes.

**Tech Stack:** Plain HTML/JS in `frontend/index.html` (existing single-page UI).

## Global Constraints

- Measure from valid Submit until stream end or catch.
- Format: `(ms / 1000).toFixed(2) + "s"` with middle-dot separator ` · `.
- Mid-flight status stays `Streaming…` (no live timer).
- Empty-prompt validation does not start a timer.
- Touch only `frontend/index.html`.

---

### Task 1: Add elapsed time to status

**Files:**
- Modify: `frontend/index.html` (script section around `setStatus` and the submit handler)

**Interfaces:**
- Produces: `formatElapsed(ms: number): string` → e.g. `"1.24s"`

- [ ] **Step 1: Add `formatElapsed` helper**

After `setStatus`, add:

```javascript
function formatElapsed(ms) {
  return (ms / 1000).toFixed(2) + "s";
}
```

- [ ] **Step 2: Wire timing into the submit handler**

After validation/clamp succeeds (before clearing response), set:

```javascript
const startedAt = performance.now();
```

On success after `streamSse`:

```javascript
setStatus("Done · " + formatElapsed(performance.now() - startedAt), false);
```

In the catch block:

```javascript
const message = err && err.message ? err.message : String(err);
setStatus(message + " · " + formatElapsed(performance.now() - startedAt), true);
```

Ensure `startedAt` is only declared after the empty-prompt early return so validation failures never append a duration.

- [ ] **Step 3: Manual verify**

1. Load the UI, submit a prompt → status like `Done · 1.24s`.
2. Trigger an error (e.g. stop coordinator or invalid request) → error text includes ` · X.XXs`.
3. Submit empty prompt → `Enter a question.` with no duration suffix.

- [ ] **Step 4: Commit** (only if the user asks)

```bash
git add frontend/index.html
git commit -m "Show request elapsed time on inference status"
```
