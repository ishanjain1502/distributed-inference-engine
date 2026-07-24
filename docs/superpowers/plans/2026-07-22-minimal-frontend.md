# Minimal Inference Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-page plain HTML/CSS/JS UI at `/` that posts to `/coordinator/infer` and streams tokens live into a response panel.

**Architecture:** One self-contained `frontend/index.html` (inline CSS + JS). The coordinator Express app serves that file at `/` via `sendFile`, resolving the path from `coordinator/dist` (`__dirname` → `../../frontend`). Existing `/coordinator/*` API routes are unchanged. The browser uses `fetch` + `ReadableStream` (not `EventSource`) because infer is POST + SSE.

**Tech Stack:** Plain HTML/CSS/JS, Express 5 (`sendFile`), existing coordinator infer SSE API.

**Spec:** `docs/superpowers/specs/2026-07-22-minimal-frontend-design.md`

## Global Constraints

- Plain HTML/CSS/JS only — no React, Next, bundlers, or npm packages for the UI
- Single self-contained file: `frontend/index.html`
- Single-turn UX: new submit replaces the previous answer
- Model default: `tinyllama-1.1b`
- Max tokens: default `50`, clamp to `[1, 1000]` on submit; HTML `min=1` `max=1000`
- Same-origin only; no CORS changes
- No API schema changes; no automated frontend tests (manual verification only)

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/index.html` | Entire UI: markup, styles, SSE client logic |
| `coordinator/src/server.ts` | Serve `index.html` at `GET /`; keep health/infer mounts |
| `README.md` | One short note that the UI is at `http://localhost:1337` |

---

### Task 1: Create `frontend/index.html`

**Files:**
- Create: `frontend/index.html`

**Interfaces:**
- Consumes: `POST /coordinator/infer` with JSON `{ prompt: string, model: string, max_tokens: number }`; SSE lines `data: {"token":"...","seq":N}` or `data: {"error":"..."}`
- Produces: Browser page with form `#prompt`, `#model`, `#maxTokens`, `#submit`, `#response`, `#status`

- [ ] **Step 1: Create the frontend directory and file**

Create `frontend/index.html` with this exact content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Inference Engine</title>
  <style>
    :root {
      --bg: #f6f7f9;
      --fg: #1a1a1a;
      --muted: #5c5c5c;
      --border: #d0d4dc;
      --accent: #1f4e79;
      --error: #8b1e1e;
      --panel: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.5;
    }
    main {
      max-width: 40rem;
      margin: 0 auto;
      padding: 2rem 1.25rem 3rem;
    }
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin: 0 0 1.5rem;
      letter-spacing: -0.02em;
    }
    label {
      display: block;
      font-size: 0.9rem;
      margin-bottom: 0.35rem;
      color: var(--muted);
    }
    .field { margin-bottom: 1rem; }
    .row {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .row .field { flex: 1; min-width: 8rem; }
    textarea, input[type="text"], input[type="number"] {
      width: 100%;
      padding: 0.55rem 0.65rem;
      border: 1px solid var(--border);
      border-radius: 4px;
      font: inherit;
      background: var(--panel);
      color: var(--fg);
    }
    textarea { min-height: 6rem; resize: vertical; }
    button {
      margin-top: 0.25rem;
      padding: 0.6rem 1.25rem;
      border: none;
      border-radius: 4px;
      background: var(--accent);
      color: #fff;
      font: inherit;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    #status {
      margin: 1rem 0 0.5rem;
      font-size: 0.9rem;
      color: var(--muted);
      min-height: 1.35em;
    }
    #status.error { color: var(--error); }
    #response {
      margin: 0;
      padding: 1rem;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 4px;
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 8rem;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.95rem;
    }
  </style>
</head>
<body>
  <main>
    <h1>Inference Engine</h1>
    <form id="inferForm">
      <div class="field">
        <label for="prompt">Question</label>
        <textarea id="prompt" name="prompt" required placeholder="What is the capital of France?"></textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="model">Model</label>
          <input id="model" name="model" type="text" value="tinyllama-1.1b" required />
        </div>
        <div class="field">
          <label for="maxTokens">Max tokens</label>
          <input id="maxTokens" name="maxTokens" type="number" value="50" min="1" max="1000" required />
        </div>
      </div>
      <button type="submit" id="submit">Submit</button>
    </form>
    <p id="status">Idle</p>
    <pre id="response" aria-live="polite"></pre>
  </main>
  <script>
    const MAX_TOKENS_CAP = 1000;
    const form = document.getElementById("inferForm");
    const promptEl = document.getElementById("prompt");
    const modelEl = document.getElementById("model");
    const maxTokensEl = document.getElementById("maxTokens");
    const submitBtn = document.getElementById("submit");
    const statusEl = document.getElementById("status");
    const responseEl = document.getElementById("response");

    function setStatus(text, isError) {
      statusEl.textContent = text;
      statusEl.classList.toggle("error", Boolean(isError));
    }

    function clampMaxTokens(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 50;
      return Math.min(Math.max(1, Math.floor(n)), MAX_TOKENS_CAP);
    }

    async function readErrorBody(res) {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (json.error) {
          return json.reason ? json.error + ": " + json.reason : String(json.error);
        }
        return text || res.statusText;
      } catch {
        return text || res.statusText;
      }
    }

    function appendTokenFromSseLine(line) {
      if (!line.startsWith("data:")) return;
      const raw = line.slice(5).trim();
      if (!raw) return;
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (payload.error) {
        throw new Error(String(payload.error));
      }
      if (typeof payload.token === "string") {
        responseEl.textContent += payload.token;
      }
    }

    async function streamSse(res) {
      if (!res.body) {
        throw new Error("No response body");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          appendTokenFromSseLine(line.trimEnd());
        }
      }
      if (buffer.trim()) {
        appendTokenFromSseLine(buffer.trim());
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const prompt = promptEl.value.trim();
      if (!prompt) {
        setStatus("Enter a question.", true);
        return;
      }

      const model = modelEl.value.trim() || "tinyllama-1.1b";
      const maxTokens = clampMaxTokens(maxTokensEl.value);
      maxTokensEl.value = String(maxTokens);

      responseEl.textContent = "";
      setStatus("Streaming…", false);
      submitBtn.disabled = true;

      try {
        const res = await fetch("/coordinator/infer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt,
            model: model,
            max_tokens: maxTokens,
          }),
        });

        if (!res.ok) {
          const msg = await readErrorBody(res);
          throw new Error("HTTP " + res.status + ": " + msg);
        }

        await streamSse(res);
        setStatus("Done", false);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setStatus(message, true);
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Sanity-check the file exists**

Run:

```bash
test -f frontend/index.html && wc -l frontend/index.html
```

Expected: file exists; line count roughly 250+ (exact count may vary slightly).

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "Add minimal single-page inference UI"
```

---

### Task 2: Serve the UI from the coordinator

**Files:**
- Modify: `coordinator/src/server.ts`

**Interfaces:**
- Consumes: `frontend/index.html` on disk at `path.join(__dirname, '../../frontend/index.html')` when running from `coordinator/dist/server.js`
- Produces: `GET /` returns the HTML page with status 200 and `Content-Type` including `text/html`

- [ ] **Step 1: Update `coordinator/src/server.ts`**

Replace the full file with:

```typescript
import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

import healthRouter from './health';
import inferRouter from './infer';

const app = express();
const port = process.env.PORT || 1337;
const host = process.env.HOST || '0.0.0.0';

const frontendIndex = path.join(__dirname, '../../frontend/index.html');

app.use(express.json());

app.get('/', (_req, res) => {
  res.sendFile(frontendIndex);
});

app.use('/coordinator/health', healthRouter);
app.use('/coordinator/infer', inferRouter);

app.listen(Number(port), host, () => {
  console.log(`Coordinator listening at http://${host}:${port}`);
});
```

Path note: compiled output is `coordinator/dist/server.js`, so `__dirname` is `.../coordinator/dist`. Two levels up is the repo root; then `frontend/index.html`.

- [ ] **Step 2: Build the coordinator**

Run:

```bash
cd coordinator && npm run build
```

Expected: `tsc` exits 0; `dist/server.js` updated.

- [ ] **Step 3: Smoke-test `GET /` (coordinator running)**

If the stack is already up via `./start.sh`, or start only the coordinator:

```bash
cd coordinator && npm start
```

In another shell:

```bash
curl -s -o /tmp/ie-index.html -w "%{http_code}" http://localhost:1337/
head -n 5 /tmp/ie-index.html
```

Expected: HTTP status `200`; first lines include `<!DOCTYPE html>` and `Inference Engine`.

Also confirm API route still works:

```bash
curl -s http://localhost:1337/coordinator/health
```

Expected: JSON health payload (not the HTML page).

- [ ] **Step 4: Commit**

```bash
git add coordinator/src/server.ts
git commit -m "Serve inference UI from coordinator root"
```

---

### Task 3: Document the UI in the README

**Files:**
- Modify: `README.md` (Quick Start section and Test the API section)

**Interfaces:**
- Consumes: none
- Produces: README mentions browser UI at `http://localhost:1337`

- [ ] **Step 1: Update Quick Start**

In `README.md`, find the Quick Start block that ends with the python/curl test hint. Change:

```markdown
Then test inference: `python test_inference.py "What is the capital of France?"` or use the curl/scripts below. See **Setup and running** for full prerequisites and options.
```

to:

```markdown
Open the UI at [http://localhost:1337](http://localhost:1337), or test inference with `python test_inference.py "What is the capital of France?"` / the curl scripts below. See **Setup and running** for full prerequisites and options.
```

- [ ] **Step 2: Add a browser UI bullet under “Test the API”**

In section **4. Test the API**, immediately after the heading (before **Health checks:**), insert:

```markdown
**Browser UI:** open [http://localhost:1337](http://localhost:1337) — enter a question, optional model / max tokens (max 1000), and watch tokens stream into the response panel.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document browser UI in README"
```

---

### Task 4: End-to-end manual verification

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: running coordinator + worker from `./start.sh`; UI from Tasks 1–2
- Produces: confirmation that streaming UI works against live infer

- [ ] **Step 1: Start the stack**

```bash
./start.sh
```

Expected: coordinator on `:1337`, worker on `:3001`, no crash on model load.

- [ ] **Step 2: Open the UI and run the manual checklist**

Open `http://localhost:1337` and verify:

1. Page title/header shows “Inference Engine”; form fields present with defaults `tinyllama-1.1b` and `50`.
2. Submit a short question (e.g. “What is the capital of France?”) → status becomes “Streaming…”, tokens appear in `#response`, then status “Done”; submit re-enabled.
3. Submit again → previous answer cleared; new stream appears.
4. Set max tokens to `1001` and submit → field becomes `1000` (clamp); request still succeeds.
5. Clear the question and submit → status shows validation error; no hanging “Streaming…” state.
6. (Optional) Stop the coordinator and submit → status shows a connection/HTTP error; submit re-enabled.

- [ ] **Step 3: No further commit unless fixes were needed**

If bugs were found, fix in the relevant file from Tasks 1–2, re-verify, and commit with a message like `Fix inference UI streaming edge case`.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Single `frontend/index.html` | Task 1 |
| Live token streaming | Task 1 (`streamSse`) |
| Prompt + model + max tokens | Task 1 |
| Defaults `tinyllama-1.1b` / `50`, clamp `[1,1000]` | Task 1 |
| Single-turn replace on resubmit | Task 1 |
| Disable submit while streaming | Task 1 |
| Error handling (empty, HTTP, SSE error, network) | Task 1 |
| Coordinator serves UI at `/` | Task 2 |
| No API / CORS changes | Task 2 (only `GET /` replaced) |
| README note | Task 3 |
| Manual test plan | Task 4 |
