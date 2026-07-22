# Frontend Token Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On successful Done status, show `~{promptEst} + {completion} tokens` alongside elapsed time, client-side only.

**Architecture:** Estimate prompt as `Math.ceil(prompt.length / 4)`. Count completion tokens while streaming SSE. Append to Done status only; errors keep time only.

**Tech Stack:** Plain HTML/JS in `frontend/index.html`.

## Global Constraints

- Format: `Done · ${elapsed} · ~${promptTokens} + ${completionTokens} tokens`
- Errors: no token suffix
- No API changes; touch only `frontend/index.html`
- Manual verification by user (no e2e loop)

---

### Task 1: Count tokens and show on Done

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Return count from token/SSE helpers**

`appendTokenFromSseLine` returns `1` when a token string is appended, else `0`. `streamSse` accumulates and returns the total.

- [ ] **Step 2: Wire status on success**

```javascript
const promptTokens = Math.ceil(prompt.length / 4);
const completionTokens = await streamSse(res);
setStatus(
  "Done · " + formatElapsed(performance.now() - startedAt) +
    " · ~" + promptTokens + " + " + completionTokens + " tokens",
  false
);
```

Leave the catch block unchanged (time only).

- [ ] **Step 3: Manual verify** (user) — Done shows tokens; errors do not.
