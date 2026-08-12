# Model Auto-Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-download the default (or `MODEL_URL`) GGUF when missing for `./start.sh` and Docker Compose, without baking models into images.

**Architecture:** Shared `scripts/ensure_model.sh` performs skip/exists/download with atomic `*.partial` rename. `start.sh` sets a host `MODEL_PATH` then calls ensure before starting services. Worker container uses `scripts/worker-entrypoint.sh` as ENTRYPOINT; Compose mounts `./modelFiles:/models` read-write. Worker Docker build context moves to repo root so scripts can be copied.

**Tech Stack:** Bash (`curl`/`wget`), existing `start.sh`, Docker multi-stage worker image, Docker Compose.

## Global Constraints

- Never bake GGUF into images; keep `modelFiles/` gitignored and in `.dockerignore`.
- No Rust worker download logic; no checksums; no HF auth; no Render-specific bootstrap.
- Default filename: `tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`.
- Default URL: `https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`.
- Opt-out: `SKIP_MODEL_DOWNLOAD=1`.
- Prefer `curl -fL`; fall back to `wget -O`; if neither exists, exit 1.
- Commit steps only if the user asks.

## File map

| File | Role |
|------|------|
| `scripts/ensure_model.sh` | Idempotent ensure / download helper |
| `scripts/worker-entrypoint.sh` | Run ensure, then `exec "$@"` |
| `tests/scripts/test_ensure_model.sh` | Shell tests for ensure behavior |
| `start.sh` | Set default host `MODEL_PATH`, call ensure before build/start |
| `worker/Dockerfile` | Repo-root context; copy scripts; ENTRYPOINT |
| `docker-compose.yml` | RW volume; root build context; optional env passthrough |
| `README.md` | Auto-download docs; `MODEL_URL` / `SKIP_MODEL_DOWNLOAD` |

---

### Task 1: `ensure_model.sh` + shell tests

**Files:**
- Create: `scripts/ensure_model.sh`
- Create: `tests/scripts/test_ensure_model.sh`

**Interfaces:**
- Consumes: `MODEL_PATH`, `MODEL_URL`, `SKIP_MODEL_DOWNLOAD`
- Produces: exit 0 when dest exists (or was downloaded); exit 1 on skip-missing / download failure / no curl|wget; writes file at `MODEL_PATH` (or `$ROOT/modelFiles/<default>` when unset)

- [x] **Step 1: Write the failing test harness**

Create `tests/scripts/test_ensure_model.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENSURE="$ROOT/scripts/ensure_model.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# --- exists: no download ---
DEST="$TMP/already.gguf"
echo tiny > "$DEST"
MODEL_PATH="$DEST" SKIP_MODEL_DOWNLOAD=0 bash "$ENSURE" || fail "exists should exit 0"
[[ -f "$DEST" ]] || fail "dest missing after exists path"
pass "exists skips download"

# --- SKIP with missing file ---
MISSING="$TMP/missing.gguf"
rm -f "$MISSING"
if MODEL_PATH="$MISSING" SKIP_MODEL_DOWNLOAD=1 bash "$ENSURE"; then
  fail "SKIP + missing should exit non-zero"
fi
pass "SKIP + missing exits non-zero"

# --- SKIP with present file ---
MODEL_PATH="$DEST" SKIP_MODEL_DOWNLOAD=1 bash "$ENSURE" || fail "SKIP + present should exit 0"
pass "SKIP + present exits 0"

# --- download via local HTTP + atomic rename ---
PAYLOAD="$TMP/payload.bin"
echo 'fake-gguf-bytes' > "$PAYLOAD"
PORT=8765
python -m http.server "$PORT" --directory "$TMP" >/dev/null 2>&1 &
HTTP_PID=$!
trap 'kill $HTTP_PID 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 0.5

OUT="$TMP/downloaded.gguf"
rm -f "$OUT" "$OUT.partial"
MODEL_PATH="$OUT" MODEL_URL="http://127.0.0.1:${PORT}/payload.bin" \
  bash "$ENSURE" || fail "download should succeed"
[[ -f "$OUT" ]] || fail "downloaded file missing"
[[ ! -f "$OUT.partial" ]] || fail "partial left behind"
grep -q 'fake-gguf-bytes' "$OUT" || fail "content mismatch"
pass "download + atomic rename"

# --- failed download leaves no final file ---
BAD="$TMP/bad.gguf"
rm -f "$BAD" "$BAD.partial"
if MODEL_PATH="$BAD" MODEL_URL="http://127.0.0.1:${PORT}/no-such-file.bin" \
  bash "$ENSURE"; then
  fail "bad URL should fail"
fi
[[ ! -f "$BAD" ]] || fail "corrupt final file after failed download"
[[ ! -f "$BAD.partial" ]] || fail "partial left after failed download"
pass "failed download cleans partial"

echo "All ensure_model tests passed."
```

- [ ] **Step 2: Run tests — expect failure (script missing)**

Run:

```bash
bash tests/scripts/test_ensure_model.sh
```

Expected: FAIL because `scripts/ensure_model.sh` does not exist (or is not executable).

- [ ] **Step 3: Implement `scripts/ensure_model.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

DEFAULT_FILENAME="tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
DEFAULT_URL="https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEST="${MODEL_PATH:-$ROOT_DIR/modelFiles/$DEFAULT_FILENAME}"
URL="${MODEL_URL:-$DEFAULT_URL}"
PARTIAL="${DEST}.partial"

if [[ "${SKIP_MODEL_DOWNLOAD:-0}" == "1" ]]; then
  if [[ -f "$DEST" ]]; then
    echo "Model present at $DEST (SKIP_MODEL_DOWNLOAD=1)"
    exit 0
  fi
  echo "ERROR: Model missing at $DEST and SKIP_MODEL_DOWNLOAD=1" >&2
  exit 1
fi

if [[ -f "$DEST" ]]; then
  echo "Model already present: $DEST"
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
rm -f "$PARTIAL"

echo "Downloading model"
echo "  URL:  $URL"
echo "  Dest: $DEST"

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "$PARTIAL" "$URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$PARTIAL" "$URL"
  else
    echo "ERROR: need curl or wget to download model" >&2
    exit 1
  fi
}

if ! download; then
  rm -f "$PARTIAL"
  echo "ERROR: download failed" >&2
  exit 1
fi

mv "$PARTIAL" "$DEST"
echo "Model ready: $DEST"
```

Make executable: `chmod +x scripts/ensure_model.sh tests/scripts/test_ensure_model.sh`

- [ ] **Step 4: Re-run tests — expect pass**

```bash
bash tests/scripts/test_ensure_model.sh
```

Expected: all `PASS:` lines and `All ensure_model tests passed.`

- [ ] **Step 5: Commit** (only if the user asks)

```bash
git add scripts/ensure_model.sh tests/scripts/test_ensure_model.sh
git commit -m "Add ensure_model.sh with skip/exists/download tests"
```

---

### Task 2: Wire `start.sh`

**Files:**
- Modify: `start.sh` (after `ROOT_DIR=...`, before coordinator build)

**Interfaces:**
- Consumes: `scripts/ensure_model.sh`; optional existing `MODEL_PATH` / `MODEL_URL` / `SKIP_MODEL_DOWNLOAD`
- Produces: exported `MODEL_PATH` pointing at host `modelFiles/<default>` when previously unset; aborts if ensure fails

- [ ] **Step 1: Insert ensure block after `ROOT_DIR` / before coordinator build**

After the banner and `ROOT_DIR=...` (and after `trap`), add before `# Build and start Coordinator`:

```bash
DEFAULT_MODEL_FILENAME="tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
if [ -z "${MODEL_PATH:-}" ]; then
    export MODEL_PATH="$ROOT_DIR/modelFiles/$DEFAULT_MODEL_FILENAME"
fi

echo -e "${YELLOW}Ensuring model at $MODEL_PATH...${NC}"
if ! bash "$ROOT_DIR/scripts/ensure_model.sh"; then
    echo -e "${RED}Failed to ensure model file!${NC}"
    exit 1
fi
echo ""
```

Keep the later `MODEL_PATH=$MODEL_PATH cargo run` as-is (now always set for the common case).

- [ ] **Step 2: Smoke-check skip path without full stack**

With a temp empty dir path:

```bash
SKIP_MODEL_DOWNLOAD=1 MODEL_PATH="/tmp/definitely-missing-model.gguf" bash start.sh
```

Expected: script prints ensure failure / exits non-zero **before** spending long on coordinator build (may still enter ensure immediately). Faster check:

```bash
SKIP_MODEL_DOWNLOAD=1 MODEL_PATH="/tmp/definitely-missing-model.gguf" bash scripts/ensure_model.sh; echo exit:$?
```

Expected: `exit:1`

- [ ] **Step 3: Commit** (only if the user asks)

```bash
git add start.sh
git commit -m "Ensure GGUF before start.sh launches services"
```

---

### Task 3: Worker entrypoint + Dockerfile (repo-root context)

**Files:**
- Create: `scripts/worker-entrypoint.sh`
- Modify: `worker/Dockerfile` (full rewrite of COPY paths + ENTRYPOINT)
- Modify: `docker-compose.yml` (worker build + volume + env)
- Review: `.dockerignore` (must still exclude `modelFiles`; must **not** exclude `scripts/`)

**Interfaces:**
- Consumes: `ensure_model.sh`; Compose `MODEL_PATH=/models/...`
- Produces: container starts `worker` only after ensure succeeds; host `modelFiles/` writable via RW mount

- [ ] **Step 1: Create `scripts/worker-entrypoint.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/ensure_model.sh"
exec "$@"
```

`chmod +x scripts/worker-entrypoint.sh`

- [ ] **Step 2: Update `worker/Dockerfile` for repo-root context**

Replace contents with:

```dockerfile
# syntax=docker/dockerfile:1
# Build context: repository root
FROM rust:1-bookworm AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    cmake \
    pkg-config \
    clang \
    libclang-dev \
    llvm \
    build-essential \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/Cargo.toml worker/Cargo.lock ./
COPY worker/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release \
    && cp /app/target/release/worker /app/worker-bin

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/worker-bin /usr/local/bin/worker
COPY scripts/ensure_model.sh scripts/worker-entrypoint.sh /app/scripts/
RUN chmod +x /app/scripts/ensure_model.sh /app/scripts/worker-entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["/app/scripts/worker-entrypoint.sh"]
CMD ["worker"]
```

- [ ] **Step 3: Update `docker-compose.yml` worker service**

Change the `worker:` block to:

```yaml
  worker:
    build:
      context: .
      dockerfile: worker/Dockerfile
    environment:
      WORKER_ID: worker-1
      WORKER_URL: http://worker:3001
      COORDINATOR_URL: http://coordinator:1337
      MODEL_PATH: /models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
      MODEL_URL: ${MODEL_URL:-}
      SKIP_MODEL_DOWNLOAD: ${SKIP_MODEL_DOWNLOAD:-0}
    volumes:
      - ./modelFiles:/models
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3001/worker/health"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 120s
```

Notes:
- Volume is RW (`./modelFiles:/models`).
- `start_period: 120s` gives first-boot download + model load more room before healthcheck failures.
- Empty `MODEL_URL` is fine: ensure_model uses its default URL when `MODEL_URL` is empty — **but** bash `URL="${MODEL_URL:-$DEFAULT_URL}"` treats empty as unset only with `:-`. Confirm: `${MODEL_URL:-}` in Compose may set `MODEL_URL=""`; ensure script must treat empty as unset:

In `scripts/ensure_model.sh`, use:

```bash
if [[ -z "${MODEL_URL:-}" ]]; then
  URL="$DEFAULT_URL"
else
  URL="$MODEL_URL"
fi
```

(If Task 1 used `${MODEL_URL:-$DEFAULT_URL}`, empty string already falls back — in bash `:-` does. Keep that form.)

- [ ] **Step 4: Confirm `.dockerignore` allows scripts**

```bash
rg -n 'scripts|modelFiles' .dockerignore
```

Expected: `modelFiles` excluded; no `scripts` exclusion. If `scripts` is excluded, remove that line.

- [ ] **Step 5: Build worker image (no full infer required)**

```bash
docker compose build worker
```

Expected: build succeeds; image includes `/app/scripts/ensure_model.sh`.

- [ ] **Step 6: Commit** (only if the user asks)

```bash
git add scripts/worker-entrypoint.sh worker/Dockerfile docker-compose.yml scripts/ensure_model.sh
git commit -m "Wire model ensure into worker Docker entrypoint"
```

---

### Task 4: README docs

**Files:**
- Modify: `README.md` (section “Download a model”, Docker Compose prerequisites, env tables)

**Interfaces:**
- Consumes: behavior from Tasks 1–3
- Produces: docs matching auto-download + optional manual download

- [ ] **Step 1: Rewrite “Download a model” section**

Replace the hard “required manual download” framing with:

```markdown
### 2. Model file (auto-download or manual)

On first start, `./start.sh` and Docker Compose **auto-download** TinyLlama Q4_K_M into `modelFiles/` if the file is missing (needs network + `curl` or `wget`).

Optional overrides:
- **`MODEL_URL`** — download URL (default: TheBloke TinyLlama Q4_K_M on Hugging Face)
- **`SKIP_MODEL_DOWNLOAD=1`** — never fetch; fail if the file is missing (air-gapped / CI)
- **`MODEL_PATH`** — path to an existing `.gguf` (forward slashes in Git Bash)

You can still download manually into `modelFiles/` if you prefer; existing files are never re-fetched.
```

- [ ] **Step 2: Update Docker Compose prerequisites**

Change “and a TinyLlama GGUF in `modelFiles/`” to note that an empty `modelFiles/` is OK on first run (download may take several minutes). Mention the volume is read-write so the host keeps the file.

- [ ] **Step 3: Add env rows**

In both env tables (~section 5 and Configuration), add:

| `MODEL_URL` | Worker / ensure | Override GGUF download URL |
| `SKIP_MODEL_DOWNLOAD` | Worker / ensure | Set to `1` to disable auto-download |

Keep `MODEL_PATH` row; note `start.sh` defaults it to `$ROOT/modelFiles/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`.

- [ ] **Step 4: Commit** (only if the user asks)

```bash
git add README.md
git commit -m "Document model auto-download for start.sh and Compose"
```

---

### Task 5: End-to-end verification

**Files:** none (manual / scripted checks)

- [ ] **Step 1: Re-run unit shell tests**

```bash
bash tests/scripts/test_ensure_model.sh
```

Expected: pass.

- [ ] **Step 2: Native ensure into real `modelFiles/` (optional network)**

If you want a live HF download once:

```bash
# move aside existing model if present
mkdir -p modelFiles
# only if you accept a ~600MB+ download:
# rm -f modelFiles/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
bash scripts/ensure_model.sh
ls -lh modelFiles/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

Expected: file present; second run prints “already present”.

- [ ] **Step 3: Compose path (when Docker available)**

```bash
docker compose up --build
```

Expected: worker logs download (if empty) then health becomes healthy; UI at `http://localhost:1337`; host `modelFiles/` contains the GGUF.

- [ ] **Step 4: SKIP path**

```bash
SKIP_MODEL_DOWNLOAD=1 MODEL_PATH=/tmp/nope.gguf bash scripts/ensure_model.sh; echo $?
```

Expected: non-zero exit, no network.

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Shared `ensure_model.sh` | Task 1 |
| `MODEL_URL` + TinyLlama default | Task 1 |
| `SKIP_MODEL_DOWNLOAD=1` | Task 1 |
| Exists → no fetch; atomic partial | Task 1 |
| `start.sh` sets host `MODEL_PATH` + ensure | Task 2 |
| Worker entrypoint + Dockerfile scripts | Task 3 |
| Compose RW volume + root context | Task 3 |
| README docs | Task 4 |
| Success criteria / manual E2E | Task 5 |
| No Rust download / no bake into image | Global + Task 3 `.dockerignore` |

## Placeholder / consistency scan

- Default filename and URL match the spec verbatim.
- Empty Compose `MODEL_URL` relies on bash `${MODEL_URL:-$DEFAULT_URL}` (empty → default).
- Worker health `start_period` raised to 120s for first-boot download.
