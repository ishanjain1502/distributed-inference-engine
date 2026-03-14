# Inference Engine

A distributed inference framework for large language models that routes requests to workers, manages KV cache lifecycle, handles failures gracefully, and applies backpressure so memory — not compute — is the bottleneck.

<!--
Metadata for LLM parsing:
- Project Type: Distributed inference system, LLM serving infrastructure
- Technology Stack: TypeScript/Node.js (Coordinator), Rust (Worker), Express, Axum
- Use Cases: Horizontal scaling of LLM inference, memory-aware load balancing, distributed token generation
- Status: Infrastructure complete, LLM integration pending
- Key Concepts: KV cache management, backpressure, admission control, session management, worker scheduling
- Architecture Pattern: Coordinator-Worker distributed system
-->

> **Note:** This is the infrastructure layer. LLM integration is not yet implemented. The system provides the distributed architecture, routing, and session management, but actual model inference needs to be integrated.

## TL;DR

**What this is:** A production-ready distributed inference framework for scaling LLM serving across multiple workers with memory-aware admission control, backpressure handling, and automatic failure recovery.

**What this isn't:** A complete LLM inference solution (model integration pending) or a single-server inference engine.

**Tech Stack:** TypeScript/Node.js (Coordinator) + Rust (Worker) with Express and Axum.

**Key Features:** O(1) admission control, horizontal scaling, backpressure, session management, heartbeat-based health monitoring.

## Use Cases

This framework is designed for:
- **Scaling LLM inference** across multiple GPU workers
- **Memory-constrained environments** where KV cache management is critical
- **Production deployments** requiring high availability and failure resilience
- **Multi-tenant systems** needing session isolation and capacity management
- **Streaming inference** with backpressure to handle slow clients gracefully

## Quick Start

```bash
git clone <repository-url>
cd inference-engine
./start.sh
```

Then test inference: `python test_inference.py "What is the capital of France?"` or use the curl/scripts below. See **Setup and running** for full prerequisites and options.

---

## Setup and running

### Prerequisites

| Requirement | Purpose |
|-------------|---------|
| **Node.js 18+** | Coordinator (TypeScript/Node) |
| **npm** | Install coordinator dependencies |
| **Rust 1.70+** | Worker (Rust) — install from [rustup.rs](https://rustup.rs) |
| **LLVM (Windows only)** | Worker build needs **libclang**, **llvm-nm**, and **llvm-objcopy** for the `llama_cpp_sys` crate. Install [LLVM](https://github.com/llvm/llvm-project/releases) (e.g. 17.x) and set **`LIBCLANG_PATH`** to the LLVM `bin` directory (e.g. `C:\Program Files\LLVM\bin`). Also set **`NM_PATH`** to the full path to `llvm-nm.exe` and **`OBJCOPY_PATH`** to the full path to `llvm-objcopy.exe` in the same directory (e.g. `C:\Program Files\LLVM\bin\llvm-objcopy.exe`), or add that directory to **PATH**. `start.sh` derives `NM_PATH` from `LIBCLANG_PATH` if set. |

### 1. Clone and install

```bash
git clone <repository-url>
cd inference-engine
```

**Coordinator (one-time):**
```bash
cd coordinator
npm install
cd ..
```

**Worker:** No separate install step; `start.sh` (or `cargo build`) will compile it.

### 2. Download a model (required for inference)

The worker loads a GGUF model file. Default is **TinyLlama 1.1B**.

1. Download a TinyLlama GGUF from [TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF) (e.g. `tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`).
2. Place it in `modelFiles/` in the project root (create the folder if needed).
3. Optional: set **`MODEL_PATH`** to the full path to your `.gguf` file if you use a different path or filename. Use **forward slashes** when setting in Git Bash (e.g. `E:/Projects/inference-engine/modelFiles/my-model.gguf`).

### 3. Run the system

**Option A – Start both with one script (recommended):**

```bash
./start.sh
```

This will:
- Build and start the **Coordinator** on `http://localhost:1337`
- Build and start the **Worker** on `http://localhost:3001`

Press `Ctrl+C` to stop both.

**Option B – Run Coordinator and Worker separately:**

Terminal 1 – Coordinator:
```bash
cd coordinator
npm run build
npm start
```

Terminal 2 – Worker (from project root):
```bash
# Optional: set model path (use forward slashes on Windows in Git Bash)
# export MODEL_PATH="E:/Projects/inference-engine/modelFiles/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

cd worker
cargo build
cargo run
```

### 4. Test the API

**Health checks:**
```bash
curl http://localhost:1337/coordinator/health
curl http://localhost:3001/worker/health
curl http://localhost:1337/coordinator/health/workers
```

**Streaming inference (curl):**
```bash
curl -N -X POST http://localhost:1337/coordinator/infer \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is the capital of France?","model":"tinyllama-1.1b","max_tokens":1000}'
```

**Python test script:**
```bash
python test_inference.py "What is the capital of France?" 1000
```

**Shell test script:**
```bash
./test_inference.sh "What is the capital of France?" 1000
```

### 5. Environment variables (optional)

| Variable | Where | Description |
|----------|--------|-------------|
| `MODEL_PATH` | Worker | Path to GGUF model file. Use forward slashes in Git Bash. Default: `.../modelFiles/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` |
| `LIBCLANG_PATH` | Worker build (Windows) | LLVM `bin` directory (for libclang), e.g. `C:\Program Files\LLVM\bin`. |
| `NM_PATH` | Worker build (Windows) | Full path to `llvm-nm.exe`. Can be derived from `LIBCLANG_PATH` (see `start.sh`). |
| `OBJCOPY_PATH` | Worker build (Windows) | Full path to `llvm-objcopy.exe`, e.g. `C:\Program Files\LLVM\bin\llvm-objcopy.exe`. |
| `PORT` | Coordinator | Coordinator port (default `1337`). |
| `HOST` | Coordinator | Coordinator host (default `0.0.0.0`). |
| `WORKER_ID`, `WORKER_URL`, `COORDINATOR_URL` | Worker | Override worker identity and URLs if running multiple workers or custom topology. |

---

## Architecture

**System Type:** Distributed coordinator-worker architecture with stateless scheduling.

**Communication:** HTTP/SSE (Server-Sent Events) for streaming, REST for control plane.

**Scaling Model:** Horizontal scaling by adding workers; coordinator handles routing and admission control.

The system consists of three components, each with a single responsibility:

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       COORDINATOR                               │
│  • Admission control (O(1))                                     │
│  • Session tracking                                             │
│  • Backpressure + streaming                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│     WORKER 1      │ │     WORKER 2      │ │     WORKER N      │
│  • KV Cache       │ │  • KV Cache       │ │  • KV Cache       │
│  • Model Weights  │ │  • Model Weights  │ │  • Model Weights  │
│  • Decode Loop    │ │  • Decode Loop    │ │  • Decode Loop    │
└───────────────────┘ └───────────────────┘ └───────────────────┘
```

### Components

**Coordinator** (TypeScript/Node.js)
- Entry point for all client requests
- Streams tokens from worker to client
- Applies backpressure — buffers fill, clients get dropped, not workers
- Tracks sessions for real-time capacity awareness
- Never touches model weights or KV cache

**Scheduler** (Pure function)
- Selects which worker handles each request
- Scores workers by session count (60%) and KV cache usage (40%)
- Rejects early if system is at capacity (O(1) check)

**Worker** (Rust)
- Designed to own the model — weights, tokenizer, KV cache (LLM integration pending)
- Prefill: Tokenize prompt, build initial KV cache (infrastructure ready)
- Decode: Autoregressive token generation (infrastructure ready)
- Enforces local limits — max sessions, max KV per session
- No client awareness — just produces tokens into a bounded channel

---

## API Reference

### POST `/coordinator/infer`

Start an inference request. Returns streaming tokens via Server-Sent Events.

**Request:**
```json
{
  "prompt": "string",
  "model": "string",
  "max_tokens": number
}
```

**Response:** `text/event-stream`

Each SSE event:
```json
{
  "token": "string",
  "finished": boolean
}
```

**Status Codes:**
- `200` - Success (streaming)
- `400` - Missing required fields
- `502` - Worker unreachable or failed
- `503` - System at capacity

See [protocol/inference.http.md](protocol/inference.http.md) for complete API documentation.

---

## Configuration

### Coordinator

Environment variables (optional):
- `PORT` - Server port (default: `1337`)
- `HOST` - Server host (default: `0.0.0.0`)

### Worker

Environment variables:
- `MODEL_PATH` - Path to GGUF model file. Use **forward slashes** (e.g. `E:/path/to/model.gguf`) when setting in Git Bash. Default: `E:/Projects/inference-engine/modelFiles/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`

**Supported models:** The worker uses the `llama_cpp` Rust crate (v0.3), which bundles llama.cpp. Default is **TinyLlama 1.1B** (TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF); use any quant e.g. `Q4_K_M.gguf`. Other supported architectures include Llama, Gemma 2, Phi, Mistral, etc. Gemma 3 is not yet supported by the bundled llama.cpp.
- `WORKER_ID` - Unique identifier (default: `worker-1`)
- `WORKER_URL` - Reachable URL for coordinator (default: `http://localhost:3001`)
- `COORDINATOR_URL` - Coordinator base URL (default: `http://localhost:1337`)

### System Limits

**Per Worker:**
- 100 max sessions
- 512 MB max KV per session
- 8 GB total KV cache

**System-wide:**
- 1000 total sessions
- 64 GB total KV cache

---

## Project Structure

```
inference-engine/
├── coordinator/          # TypeScript/Node.js coordinator service
│   ├── src/
│   │   ├── server.ts     # Express server setup
│   │   ├── infer.ts      # Inference request handling
│   │   ├── scheduler.ts  # Worker selection logic
│   │   ├── health.ts     # Health check endpoints
│   │   └── ...
│   └── package.json
│
├── worker/               # Rust worker service
│   ├── src/
│   │   ├── main.rs       # Entry point
│   │   ├── model.rs      # Model loading & inference
│   │   ├── cache.rs      # KV cache management
│   │   ├── stream.rs     # Token streaming
│   │   └── ...
│   └── Cargo.toml
│
├── docs/                 # Detailed documentation
│   ├── ARCHITECTURE.md   # System design deep dive
│   ├── COORDINATOR.md    # Coordinator implementation
│   ├── WORKER.md         # Worker implementation
│   ├── FAILURE_MODES.md  # Failure handling strategies
│   └── ...
│
├── protocol/             # API specifications
│   └── inference.http.md
│
├── start.sh              # Quick start script
└── README.md
```

---

## Key Features

- **Distributed Architecture**: Framework for scaling inference across multiple workers
- **Memory-Aware Admission Control**: O(1) capacity checks prevent overload
- **Backpressure**: Slow clients are dropped, not workers
- **Failure Resilience**: Automatic retries for prefill failures
- **Session Management**: KV cache lifecycle infrastructure with TTL-based cleanup
- **Real-time Health Tracking**: Heartbeat-based worker monitoring
- **Streaming Infrastructure**: Server-Sent Events with bounded channels for backpressure

**Keywords:** distributed inference, LLM serving, KV cache management, backpressure, admission control, worker scheduling, session management, horizontal scaling, memory-aware load balancing, token streaming, Server-Sent Events, coordinator-worker pattern, failure resilience, health monitoring, heartbeat protocol

---

## Documentation

For detailed information, see:

- **[System Overview](inference-engine.md)** - High-level design and problem statement
- **[Architecture](docs/ARCHITECTURE.md)** - Deep dive into system design
- **[Coordinator](docs/COORDINATOR.md)** - Coordinator implementation details
- **[Worker](docs/WORKER.md)** - Worker implementation details
- **[Failure Modes](docs/FAILURE_MODES.md)** - Failure handling strategies
- **[Streaming](docs/STREAMING.md)** - Token streaming and backpressure
- **[KV Cache](docs/KV_CACHE.md)** - KV cache management
- **[Scheduler](docs/SHEDULER.md)** - Worker selection algorithm
- **[Observability](docs/OBSERVABILITY.md)** - Metrics and monitoring

---

## Current Status

**Project Phase:** Infrastructure complete, LLM integration pending.

This project provides the **infrastructure layer** for distributed LLM inference:

✅ **Implemented:**
- Coordinator with admission control and session tracking
- Worker framework with health monitoring and heartbeat
- Scheduler for worker selection
- Streaming infrastructure with backpressure
- Session management and KV cache lifecycle (infrastructure)
- Failure handling and retry logic

🚧 **Pending:**
- LLM model integration (model loading, tokenization, inference)
- Actual KV cache implementation tied to a specific model backend
- Token generation logic

**Integration Requirements:** To complete LLM integration, implement model loading, tokenization, and inference logic in the worker's `model.rs` module. The infrastructure for session management, streaming, and KV cache lifecycle is ready.

---

## Troubleshooting

### Worker fails to start

- **Check ports**: Ensure port 3001 is not in use
- **Verify Rust installation**: `rustc --version` should show 1.70+
- **Check build errors**: Review `cargo build` output for dependency issues

### Coordinator returns 503 "System at capacity"

- **Check worker health**: `curl http://localhost:3001/worker/health`
- **Verify worker registration**: `curl http://localhost:1337/coordinator/health/workers`
- **Check system limits**: Review session and KV cache limits
- **Ensure worker is running**: Worker must be running and sending heartbeats

### Coordinator can't reach worker

- **Verify worker URL**: Check `WORKER_URL` environment variable matches actual worker address
- **Check network**: Ensure coordinator can reach worker on the specified port
- **Check heartbeat**: Worker should be sending heartbeats every 10 seconds

---

## Development

### Building

**Coordinator:**
```bash
cd coordinator
npm install
npm run build
```

**Worker:**
```bash
cd worker
cargo build --release
```

### Testing

See individual component documentation for testing instructions.

---

## Contributing

Contributions welcome! Please read the architecture documentation before making significant changes.

---

## For AI/LLM Parsing

**Project Summary:** Distributed inference framework for LLM serving with coordinator-worker architecture, memory-aware admission control, and backpressure handling.

**Primary Technologies:** TypeScript, Node.js, Rust, Express, Axum, Server-Sent Events.

**Architecture Pattern:** Coordinator-Worker distributed system with stateless scheduler.

**Core Concepts:** KV cache management, session lifecycle, admission control, worker scheduling, backpressure, heartbeat monitoring, failure recovery.

**Current State:** Infrastructure layer complete; LLM model integration pending.

**Related Documentation:** See `docs/` directory for detailed architecture, failure modes, streaming, and component-specific documentation.
