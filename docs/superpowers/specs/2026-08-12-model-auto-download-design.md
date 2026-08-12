# Model Auto-Download — Design Spec

**Date:** 2026-08-12  
**Status:** Approved for implementation planning  
**Scope:** Auto-download default (or configured) GGUF when missing for native `start.sh` and Docker Compose; no Rust worker changes; no Render-specific bootstrap

## Goal

Let a fresh clone start inference without a manual Hugging Face download: if the model file is missing, fetch it once, then start coordinator + worker as today.

## Decisions

| Topic | Choice |
|-------|--------|
| Where | Shared shell helper used by `start.sh` and Docker worker entrypoint |
| Default model | TinyLlama 1.1B Chat Q4_K_M GGUF (matches Compose `MODEL_PATH` default) |
| URL override | `MODEL_URL` env; TinyLlama Hugging Face URL when unset |
| Dest path | `MODEL_PATH` when set; else native `modelFiles/<default>.gguf`, Compose `/models/<default>.gguf` |
| When | On by default if file missing |
| Opt-out | `SKIP_MODEL_DOWNLOAD=1` — do not fetch; startup fails if file still missing |
| Skip fetch | File already exists at dest — no network |
| Atomic write | Download to `*.partial`, rename on success; delete partial on failure |
| Tools | Prefer `curl -fL`; fallback `wget` |
| Compose volume | `./modelFiles:/models` **read-write** so first start can populate the host folder |
| Bake into image | Never — GGUF stays on volume / host `modelFiles/` (still gitignored) |

## Behavior

```
ensure_model:
  if SKIP_MODEL_DOWNLOAD == 1:
    if dest missing → exit 1 (clear message)
    else → exit 0
  if dest exists → exit 0
  resolve URL = MODEL_URL or default TinyLlama URL
  mkdir -p parent(dest)
  download URL → dest.partial
  on success → mv dest.partial dest
  on failure → rm dest.partial, exit 1
```

### Defaults

| Variable | Default |
|----------|---------|
| Default filename | `tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` |
| Default `MODEL_URL` | `https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` |
| Native dest (no `MODEL_PATH`) | `$ROOT/modelFiles/<default filename>` |
| Compose / container dest | `/models/<default filename>` (via existing Compose `MODEL_PATH`) |

### Env summary

| Variable | Used by | Description |
|----------|---------|-------------|
| `MODEL_PATH` | ensure + worker | Absolute or relative path to GGUF |
| `MODEL_URL` | ensure | Override download URL |
| `SKIP_MODEL_DOWNLOAD` | ensure | Set to `1` to disable fetch |

## Architecture

```
Native:
  ./start.sh
       │
       ├─► scripts/ensure_model.sh  ──(if missing)──► Hugging Face
       │         │
       │         ▼
       │    modelFiles/*.gguf
       │
       ├─► coordinator (npm)
       └─► worker (cargo)  MODEL_PATH=.../modelFiles/...

Docker Compose:
  worker container entrypoint
       │
       ├─► ensure_model.sh  ──(if missing)──► Hugging Face
       │         │
       │         ▼
       │    /models/*.gguf  ◄── volume ./modelFiles (RW)
       └─► exec worker
```

## Components

### `scripts/ensure_model.sh`

- Single source of truth for download / skip / exists logic
- Must be safe to re-run (idempotent when file present)
- Print clear progress (URL, dest, success/failure)
- Exit non-zero on any failure so callers abort startup
- **Dest resolution when `MODEL_PATH` unset:** derive repo root as `$(cd "$(dirname "$0")/.." && pwd)`, then use `$ROOT/modelFiles/<default filename>`. Callers that need a different path (Compose `/models/...`) must set `MODEL_PATH` before invoking the script.
- Prefer `curl -fL`; if `curl` is missing, fall back to `wget -O`. If neither exists, exit 1 with a clear error.

### `start.sh`

- Before ensure: if `MODEL_PATH` is unset, export `MODEL_PATH="$ROOT_DIR/modelFiles/<default filename>"` so both ensure and the host worker share one path (never the container default `/models/...`)
- Call `ensure_model.sh`; abort startup on non-zero exit
- Existing coordinator + worker startup unchanged otherwise

### `scripts/worker-entrypoint.sh`

- Run `ensure_model.sh`, then `exec "$@"` (Compose/CMD supplies `worker`)
- Runtime image already has `curl` (healthchecks); keep it for downloads

### `docker-compose.yml`

- Change volume from `./modelFiles:/models:ro` to `./modelFiles:/models` (read-write)
- Pass through optional env: `MODEL_URL`, `SKIP_MODEL_DOWNLOAD` (and keep `MODEL_PATH`)
- Coordinator service unchanged
- **Worker build context:** change to repository root (same pattern as coordinator) so the image can `COPY scripts/...` and `COPY worker/...`; set `dockerfile: worker/Dockerfile`. Adjust Dockerfile `COPY` paths accordingly (see below).

### `worker/Dockerfile`

- Build context becomes **repository root** (Compose + any documented `docker build` commands)
- Copy `scripts/ensure_model.sh` and `scripts/worker-entrypoint.sh` into the runtime image (e.g. `/usr/local/bin/` or `/app/scripts/`)
- Keep multi-stage Rust build; source copies move from context-relative `Cargo.toml` / `src` to `worker/Cargo.toml` / `worker/src`
- `ENTRYPOINT` → worker entrypoint; `CMD ["worker"]`

## Docs

- README: auto-download when missing; document `MODEL_URL`, `SKIP_MODEL_DOWNLOAD`; manual download remains optional
- Note Compose RW volume and that first `docker compose up` may take time while downloading
- This spec supersedes the Docker Compose design’s “no auto model download” / “manual only” decisions for first-start UX (images still must not bake GGUFs)

## Out of scope (v1)

- Resume of interrupted downloads beyond delete-partial-and-retry
- Checksums / signature verification
- Hugging Face auth / gated models
- Multi-model catalogs or UI picker
- Download logic inside the Rust worker
- Render-specific bootstrap (scripts remain reusable later)

## Success criteria

1. Empty `modelFiles/` + `./start.sh` → downloads default GGUF, sets usable `MODEL_PATH`, starts both services
2. Empty `modelFiles/` + `docker compose up --build` → entrypoint downloads into `/models`, file appears under host `modelFiles/`
3. File already present → no network fetch
4. `SKIP_MODEL_DOWNLOAD=1` with missing file → fail with a clear error, no download attempt
5. Failed / interrupted download leaves no corrupt final GGUF (partial removed or not renamed)

## Test plan (manual)

1. Remove `modelFiles/*.gguf` (or use empty dir); run `./start.sh`; confirm download log + worker loads model
2. Re-run `./start.sh`; confirm “already exists” / no re-download
3. `SKIP_MODEL_DOWNLOAD=1` with empty dir; confirm non-zero exit before services stay up
4. `docker compose up --build` with empty `modelFiles/`; confirm download + UI infer works; confirm host file created
5. Optional: `MODEL_URL` pointing at same TinyLlama URL with custom `MODEL_PATH` filename under `modelFiles/`
