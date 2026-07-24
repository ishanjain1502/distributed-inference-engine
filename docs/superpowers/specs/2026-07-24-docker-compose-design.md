# Docker Compose (Single-Machine Demo) — Design Spec

**Date:** 2026-07-24  
**Status:** Approved for implementation planning  
**Scope:** Single-host `docker compose up` for demos/dev; CPU-only worker; no GPU, no multi-host, no auto model download

## Goal

Package the inference engine so anyone with Docker can place a GGUF in `modelFiles/` and run `docker compose up --build`, then use the UI at `http://localhost:1337`.

## Decisions

| Topic | Choice |
|-------|--------|
| Topology | Two services: `coordinator` + `worker` |
| Models | Host volume `./modelFiles` → `/models` (read-only); never bake GGUF into images |
| GPU | Out of scope (CPU only) |
| Published ports | Only coordinator `1337`; worker stays on the Compose network |
| Networking | Compose DNS: `coordinator`, `worker` |
| Scaling workers | Out of scope for v1 (single `worker-1`) |
| Model download | Manual; README documents TinyLlama placement |
| Process model | Separate containers (not all-in-one) |

## Architecture

```
Host browser
    │
    ▼
localhost:1337 ──► coordinator (Node/Express)
                      │  serves frontend/*.html
                      │  /coordinator/*
                      │
                      ▼  http://worker:3001
                   worker (Rust/Axum + llama.cpp CPU)
                      │
                      ▼
                   /models/*.gguf  ◄── volume ./modelFiles:ro
```

- Worker heartbeats to `http://coordinator:1337`
- Coordinator routes inference to `http://worker:3001` using the URL from heartbeats (`WORKER_URL`)
- Browser never talks to the worker directly

## Services

### Coordinator

- **Build:** multi-stage Node 20 image; compile TypeScript; runtime runs `node dist/server.js`
- **Layout in image:** preserve paths relative to `dist/server.js`:

  ```
  /app/coordinator/dist/server.js
  /app/frontend/index.html
  /app/frontend/stats.html
  ```

  (`server.ts` resolves `../../frontend/` from `__dirname` = `.../coordinator/dist`)

- **Do not** copy `coordinator/.env` into the image (Compose supplies env)
- **Env:**

  | Variable | Value |
  |----------|--------|
  | `HOST` | `0.0.0.0` |
  | `PORT` | `1337` |

- **Ports:** `1337:1337`

### Worker

- **Build:** multi-stage Rust image on Debian/Ubuntu; build deps for `llama_cpp` (cmake, clang/llvm as needed on Linux); runtime image copies the binary only
- **Env:**

  | Variable | Value |
  |----------|--------|
  | `WORKER_ID` | `worker-1` |
  | `WORKER_URL` | `http://worker:3001` |
  | `COORDINATOR_URL` | `http://coordinator:1337` |
  | `MODEL_PATH` | `/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` (overridable) |

- **Volumes:** `./modelFiles:/models:ro`
- **Ports:** none published

### Compose

- Root `docker-compose.yml`
- `.dockerignore` at build contexts: exclude `node_modules`, `target/`, `modelFiles/`, `.git`, and other heavy/irrelevant paths
- Optional `depends_on: worker` on coordinator is convenience only; heartbeats already retry

## Code / config tweaks

1. **Worker `MODEL_PATH` default** — change the hard-coded Windows path in `worker/src/main.rs` to `/models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`. Native `start.sh` users must set `MODEL_PATH` to their host path (already documented); Docker Compose sets the same `/models/...` path explicitly.
2. **Do not ship `coordinator/.env` in the image** — that file currently sets `HOST=localhost`, which would break container networking if loaded. Dockerfile must omit `.env`; Compose supplies `HOST`/`PORT`.
3. **README** — add a short “Run with Docker” section: place GGUF, `docker compose up --build`, open `http://localhost:1337`.

## Build caching

- Coordinator: layer cache on `package-lock.json` before copying sources
- Worker: use BuildKit cache mounts for Cargo registry/target when practical so rebuilds do not recompile llama.cpp from scratch every time

## Failure modes & healthchecks

| Scenario | Expected behavior |
|----------|-------------------|
| Missing / wrong `MODEL_PATH` | Worker exits non-zero at startup; Compose shows worker unhealthy/exited; logs name the path |
| Coordinator up, worker down | UI loads; infer fails or no workers; `/coordinator/health/workers` empty or stale |
| Worker up, coordinator down | Worker logs heartbeat errors and retries |
| Empty `modelFiles/` | Same as missing model |

**Healthchecks (Compose):**

- Coordinator: `GET http://127.0.0.1:1337/coordinator/health` (existing route mounts health router at `/coordinator/health`)
- Worker: `GET http://127.0.0.1:3001/worker/health`

Install `curl` (or `wget`) in both runtime images so Compose `healthcheck` can use it. Manual verification from the host remains as in the test plan below.

## Out of scope (v1)

- GPU / CUDA images
- Auto-download of GGUF on first start
- Multi-worker / `scale` with unique IDs
- Kubernetes / Swarm
- Publishing images to a registry (local build is enough)

## Done when

1. From a clean machine with Docker + a TinyLlama GGUF in `modelFiles/`, `docker compose up --build` starts both services
2. Browser UI at `http://localhost:1337` can run a short infer and stream tokens
3. `GET /coordinator/health/workers` shows `worker-1` alive with URL `http://worker:3001`
4. Images do not contain GGUF files; `.dockerignore` keeps `modelFiles/` out of build context
5. README documents the Docker path alongside `./start.sh`

## Test plan

1. `docker compose build` succeeds (worker may take several minutes on first build)
2. `docker compose up -d` → both containers running
3. `curl -s http://localhost:1337/coordinator/health` → 200
4. `curl -s http://localhost:1337/coordinator/health/workers` → includes alive `worker-1`
5. Short infer via UI or `curl -N` to `/coordinator/infer`
6. Stop worker → workers list reflects unhealthy/missing after TTL; restart recovers
