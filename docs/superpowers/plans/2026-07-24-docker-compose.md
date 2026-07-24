# Docker Compose (Single-Machine Demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `docker compose up --build` so a host with Docker and a GGUF in `modelFiles/` can run the full stack (coordinator + CPU worker) and use the UI at `http://localhost:1337`.

**Architecture:** Two Compose services on one host network. Coordinator image serves API + `frontend/*.html`. Worker image runs the Rust binary with `MODEL_PATH` on a read-only `./modelFiles` → `/models` volume. Heartbeats use Compose DNS (`http://coordinator:1337`, `http://worker:3001`). Only port 1337 is published.

**Tech Stack:** Docker multi-stage builds, Docker Compose, Node 20, Rust (Debian), existing Express/Axum apps.

## Global Constraints

- Single machine, CPU-only worker; no GPU, no auto model download, no multi-worker scale.
- Never bake GGUF into images; `.dockerignore` must exclude `modelFiles/`.
- Do not copy `coordinator/.env` into the coordinator image (`HOST=localhost` would break binding).
- Coordinator image layout must keep `../../frontend` resolution from `coordinator/dist/server.js`.
- Compose env: `HOST=0.0.0.0`, `WORKER_URL=http://worker:3001`, `COORDINATOR_URL=http://coordinator:1337`, `MODEL_PATH=/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`.
- Commit steps only if the user asks.

## File map

| File | Role |
|------|------|
| `worker/src/main.rs` | Portable `MODEL_PATH` default `/models/...` |
| `coordinator/Dockerfile` | Multi-stage Node build; context = repo root |
| `.dockerignore` | Root build context exclusions |
| `worker/Dockerfile` | Multi-stage Rust + llama.cpp CPU build |
| `worker/.dockerignore` | Worker context exclusions |
| `docker-compose.yml` | Services, env, volume, healthchecks, ports |
| `README.md` | “Run with Docker” + updated `MODEL_PATH` default docs |

---

### Task 1: Portable `MODEL_PATH` default

**Files:**
- Modify: `worker/src/main.rs` (model path `unwrap_or_else`)
- Modify: `README.md` (env table rows that still say the Windows default path)

**Interfaces:**
- Consumes: `MODEL_PATH` env var (unchanged)
- Produces: default path string `/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` when unset

- [ ] **Step 1: Change the default in `worker/src/main.rs`**

Replace the Windows hard-coded default:

```rust
    let model_path = std::env::var("MODEL_PATH")
        .map(|p| p.replace('\\', "/"))
        .unwrap_or_else(|_| {
            "/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf".to_string()
        });
```

- [ ] **Step 2: Update README env docs**

In both places that document the worker `MODEL_PATH` default (the quick env table ~line 148 and the Configuration section ~line 260), change the default text to:

`/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`

Keep the existing note that native/`start.sh` users should set `MODEL_PATH` to their host GGUF path (forward slashes on Git Bash). Optionally add one sentence near the model download step: “For Docker, Compose mounts `modelFiles/` at `/models` and sets `MODEL_PATH` automatically.”

- [ ] **Step 3: Sanity-check the string (no Docker required)**

Run from repo root (Git Bash / bash):

```bash
rg -n "E:/Projects/inference-engine/modelFiles" worker/src/main.rs README.md || true
rg -n '/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf' worker/src/main.rs README.md
```

Expected: no remaining Windows default in those files; both files mention the `/models/...` default.

- [ ] **Step 4: Commit** (only if the user asks)

```bash
git add worker/src/main.rs README.md
git commit -m "Use portable MODEL_PATH default for Docker mounts"
```

---

### Task 2: Coordinator Dockerfile + root `.dockerignore`

**Files:**
- Create: `coordinator/Dockerfile`
- Create: `.dockerignore` (repo root)

**Interfaces:**
- Consumes: repo `coordinator/` sources + lockfile, `frontend/index.html`, `frontend/stats.html`
- Produces: image that runs `node dist/server.js` with frontend at `/app/frontend/` and dist at `/app/coordinator/dist/`

- [ ] **Step 1: Create `.dockerignore` at repo root**

```gitignore
.git
.superpowers
.vscode
docs
modelFiles
**/node_modules
**/dist
worker/target
**/*.md
TESTING.md
test_inference.py
test_inference.sh
start.sh
inference-engine.md
coordinator/.env
```

(Do not list `frontend/` — it must be in the build context.)

- [ ] **Step 2: Create `coordinator/Dockerfile`**

```dockerfile
# Build context: repository root
FROM node:20-bookworm-slim AS build
WORKDIR /app/coordinator
COPY coordinator/package.json coordinator/package-lock.json ./
RUN npm ci
COPY coordinator/tsconfig.json ./
COPY coordinator/src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/coordinator
ENV NODE_ENV=production
COPY coordinator/package.json coordinator/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/coordinator/dist ./dist
COPY frontend /app/frontend
EXPOSE 1337
CMD ["node", "dist/server.js"]
```

Critical: do **not** `COPY coordinator/.env`. Runtime layout:

```
/app/coordinator/dist/server.js
/app/frontend/index.html
/app/frontend/stats.html
```

so `path.join(__dirname, '../../frontend/...')` resolves correctly.

- [ ] **Step 3: Build the coordinator image alone**

```bash
docker build -f coordinator/Dockerfile -t inference-engine-coordinator:local .
```

Expected: build succeeds. First `npm ci` may take a minute.

- [ ] **Step 4: Smoke-test static UI path inside a throwaway container**

```bash
docker run --rm -d --name ie-coord-smoke -e HOST=0.0.0.0 -e PORT=1337 -p 1337:1337 inference-engine-coordinator:local
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:1337/
curl -s -o /dev/null -w "%{http_code}" http://localhost:1337/coordinator/health
docker stop ie-coord-smoke
```

Expected: `200` for `/` and `/coordinator/health`. (Workers list may be empty — fine.)

- [ ] **Step 5: Commit** (only if the user asks)

```bash
git add coordinator/Dockerfile .dockerignore
git commit -m "Add coordinator Docker image for Compose demos"
```

---

### Task 3: Worker Dockerfile + `worker/.dockerignore`

**Files:**
- Create: `worker/Dockerfile`
- Create: `worker/.dockerignore`

**Interfaces:**
- Consumes: `worker/Cargo.toml`, `worker/Cargo.lock`, `worker/src/**`
- Produces: runtime image with `/usr/local/bin/worker` listening on `0.0.0.0:3001`

- [ ] **Step 1: Create `worker/.dockerignore`**

```gitignore
target
.git
*.md
```

- [ ] **Step 2: Create `worker/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
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
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release \
    && cp /app/target/release/worker /app/worker-bin

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/worker-bin /usr/local/bin/worker
EXPOSE 3001
CMD ["worker"]
```

Notes:

- BuildKit cache mounts keep Cargo/registry and `target/` across rebuilds.
- `cp` out of the cache mount is required because cache mounts are not in the final image layers.
- If `rust:1-bookworm` pulls an unexpectedly old toolchain, pin an explicit recent stable (e.g. `rust:1.85-bookworm` or newer) that supports Cargo edition 2024.
- If the link step fails looking for OpenMP or other libs, add the missing `-dev` package to the **build** stage and the matching runtime `.so` package to **runtime** (start with `libgomp1` as above).

- [ ] **Step 3: Build the worker image**

```bash
DOCKER_BUILDKIT=1 docker build -f worker/Dockerfile -t inference-engine-worker:local ./worker
```

Expected: succeeds (first build can take 10–30+ minutes compiling llama.cpp).

- [ ] **Step 4: Commit** (only if the user asks)

```bash
git add worker/Dockerfile worker/.dockerignore
git commit -m "Add CPU worker Docker image with llama.cpp build"
```

---

### Task 4: `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml` (repo root)

**Interfaces:**
- Consumes: Dockerfiles from Tasks 2–3
- Produces: `coordinator` + `worker` services with healthchecks and model volume

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  coordinator:
    build:
      context: .
      dockerfile: coordinator/Dockerfile
    ports:
      - "1337:1337"
    environment:
      HOST: "0.0.0.0"
      PORT: "1337"
    depends_on:
      worker:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:1337/coordinator/health"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 10s

  worker:
    build:
      context: ./worker
      dockerfile: Dockerfile
    environment:
      WORKER_ID: worker-1
      WORKER_URL: http://worker:3001
      COORDINATOR_URL: http://coordinator:1337
      MODEL_PATH: /models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
    volumes:
      - ./modelFiles:/models:ro
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3001/worker/health"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 60s
```

No `ports:` on `worker`. Do not add a GPU device section.

- [ ] **Step 2: Bring the stack up**

Prerequisite: `modelFiles/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` exists on the host.

```bash
docker compose up --build -d
docker compose ps
```

Expected: both services `running` / healthy (worker may stay `starting` until the model loads).

- [ ] **Step 3: Verify registration and health from the host**

```bash
curl -s http://localhost:1337/coordinator/health
curl -s http://localhost:1337/coordinator/health/workers
```

Expected: health 200; workers JSON includes `worker-1` with `alive: true` (or equivalent) and URL `http://worker:3001`. Wait up to ~15s after healthy for the first heartbeat if needed.

- [ ] **Step 4: Short infer smoke test**

```bash
curl -N -X POST http://localhost:1337/coordinator/infer \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hi in one word.","model":"tinyllama-1.1b","max_tokens":16}'
```

Expected: SSE/token stream (or the project’s existing infer response shape) without coordinator 5xx. Alternatively open `http://localhost:1337` and submit a short prompt.

- [ ] **Step 5: Confirm GGUF not in images**

```bash
docker compose config --images
# For each image id/name:
docker image history --no-trunc "$(docker compose images -q worker | head -1)" 2>/dev/null || true
# Practical check: build context exclude
grep -n modelFiles .dockerignore worker/.dockerignore
```

Expected: root `.dockerignore` lists `modelFiles`. Worker image history/layers show no multi-hundred-MB GGUF copy.

- [ ] **Step 6: Commit** (only if the user asks)

```bash
git add docker-compose.yml
git commit -m "Add docker compose stack for single-host demos"
```

---

### Task 5: README “Run with Docker”

**Files:**
- Modify: `README.md` (Quick Start and/or Setup section)

**Interfaces:**
- Consumes: working Compose from Task 4
- Produces: documented Docker path next to `./start.sh`

- [ ] **Step 1: Add Docker option to Quick Start / Setup**

After the existing Quick Start `./start.sh` block (or as **Option C** under “Run the system”), add:

```markdown
**Option C – Docker Compose (recommended for portable demos):**

Prerequisites: [Docker](https://docs.docker.com/get-docker/) with Compose v2, and a TinyLlama GGUF in `modelFiles/` (same as above).

```bash
docker compose up --build
```

Open the UI at [http://localhost:1337](http://localhost:1337). Press `Ctrl+C` to stop (or `docker compose down` if detached).

Only the coordinator port (`1337`) is published. The worker is reachable on the Compose network as `http://worker:3001`. Override the model with `MODEL_PATH` in `docker-compose.yml` or a Compose `.env` if you use a different filename under `modelFiles/`.
```

Also add **Docker** to the Prerequisites table:

| **Docker (Compose v2)** | Optional: run coordinator + worker without local Node/Rust toolchains |

- [ ] **Step 2: Skim for contradictions**

Ensure the native path still says set `MODEL_PATH` for `start.sh`, and Docker docs say Compose sets `/models/...`.

- [ ] **Step 3: Commit** (only if the user asks)

```bash
git add README.md
git commit -m "Document docker compose demo workflow"
```

---

### Task 6: End-to-end checklist (spec “done when”)

**Files:** none (verification only)

- [ ] **Step 1: Fresh compose cycle**

```bash
docker compose down
docker compose up --build -d
```

- [ ] **Step 2: Run the spec test plan**

1. `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:1337/coordinator/health` → `200`
2. `curl -s http://localhost:1337/coordinator/health/workers` → includes alive `worker-1` / `http://worker:3001`
3. Short infer via UI or curl (Task 4 Step 4)
4. `docker compose stop worker` → after heartbeat TTL, workers list no longer shows a healthy worker; `docker compose start worker` recovers

- [ ] **Step 3: Mark plan complete**

If any step fails, fix in the corresponding task’s files (usually Compose env, Dockerfile deps, or missing GGUF) before claiming done.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Two services + model volume | 4 |
| No GGUF in images / dockerignore | 2, 3, 4 |
| Coordinator layout + no `.env` | 2 |
| Worker CPU image + curl healthcheck | 3, 4 |
| Compose DNS env vars | 4 |
| `MODEL_PATH` default change | 1 |
| README Docker section | 5 |
| Healthchecks | 4 |
| Done-when / test plan | 6 |
| Out of scope (GPU, download, scale) | Not implemented (intentionally) |
