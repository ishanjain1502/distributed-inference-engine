# Inference Engine — System Overview

---

## 1. Problem Statement (30 sec)

**What problem does this system solve?**

Large language models can't serve requests directly — they're too slow and too memory-hungry. A single inference can take seconds and consume gigabytes of GPU memory for KV cache.

**Why naive approaches fail:**

1. **Single-server:** Can't handle concurrent users. KV cache fills memory. One slow client blocks everyone.
2. **Stateless load balancing:** Doesn't work. KV cache is pinned to the machine that ran prefill — you can't move a request mid-generation.
3. **No backpressure:** Slow clients cause memory to explode. Fast workers overwhelm slow networks.

**What we built:** A distributed inference system that routes requests to workers, manages KV cache lifecycle, handles failures gracefully, and applies backpressure so memory — not compute — is the bottleneck.

---

## 2. Architecture (60 sec)

Three components, each with a single responsibility:

### Coordinator
- **Entry point** for all client requests
- **Streams tokens** from worker to client
- **Applies backpressure** — buffers fill, clients get dropped, not workers
- **Tracks sessions** for real-time capacity awareness
- Never touches model weights or KV cache

### Scheduler
- **Selects which worker** handles each request
- **Pure function** — no side effects, no I/O
- **Scores workers** by session count (60%) and KV cache usage (40%)
- **Rejects early** if system is at capacity (O(1) check using pre-computed aggregates)

### Worker
- **Owns the model** — weights, tokenizer, KV cache
- **Prefill:** Tokenize prompt, build initial KV cache
- **Decode:** Autoregressive token generation
- **Enforces local limits** — max sessions, max KV per session
- **No client awareness** — just produces tokens into a bounded channel

**Why this split?** 
- Coordinator handles the messy client world (slow, unreliable)
- Workers stay focused on fast inference
- Scheduler is stateless and testable

---

## 3. Request Lifecycle (90 sec)

### Phase 1: Admission (Coordinator)
```
Client POST /infer { prompt, model, max_tokens }
    ↓
Validate request
    ↓
Estimate KV cache (prompt_length × 512 bytes)
    ↓
canAcceptRequest() — O(1) check against system limits
    ↓
If rejected → 503 "System at capacity"
```

### Phase 2: Scheduling & Prefill
```
Scheduler scores all alive workers
    ↓
Select worker with lowest (sessions × 0.6 + kv_cache × 0.4)
    ↓
POST /worker/prefill { session_id, prompt, model, max_tokens }
    ↓
Worker tokenizes prompt
    ↓
Worker builds KV cache (this is the expensive step)
    ↓
Worker stores session, returns OK
    ↓
If prefill fails → retry on different worker (up to 2 retries)
```

### Phase 3: Decode & Streaming
```
POST /worker/decode { session_id, max_tokens }
    ↓
Worker enters decode loop:
    - Generate token
    - Emit to bounded channel (capacity: 32)
    - If channel full → decode pauses (backpressure)
    ↓
Coordinator reads worker SSE stream
    ↓
Parses tokens: { "token": "...", "seq": 0 }
    ↓
Writes to client with 5s deadline
    ↓
If client slow → buffer fills → drop client, not worker
```

### Phase 4: Cleanup
```
Stream ends (complete / error / disconnect)
    ↓
sessionTracker.sessionEnd() — immediate capacity update
    ↓
Worker session expires via TTL (5 min idle) or explicit cleanup
    ↓
KV cache freed
```

---

## 4. Failure Handling (60 sec)

### Worker Crash Mid-Prefill
- Coordinator catches failed prefill
- Retries on a **different worker** (fresh session ID)
- Up to 2 retries, then 502 to client
- KV cache was never built — nothing to clean up

### Worker Crash Mid-Decode
- **Terminal failure** — KV cache is gone
- No retry possible (can't rebuild state)
- Coordinator closes client stream with error
- Session tracker updates immediately

### Slow Client
- Coordinator buffer fills (64 tokens max)
- Worker's bounded channel fills (32 tokens)
- Backpressure pauses decode loop
- If client write exceeds 5s deadline → **drop the client**
- Worker continues or cleans up via TTL
- **Key principle:** Slow clients don't kill workers

### System Overload
- Admission control rejects at coordinator (O(1) check)
- Returns 503 before wasting any worker resources
- Reasons: `no_workers`, `system_sessions_full`, `system_kv_cache_full`
- Worker also enforces local limits — double protection

---

## 5. Scaling & Limits (60 sec)

### What Scales
| Component | How it scales |
|-----------|---------------|
| Workers | Add more machines, each with GPU + memory |
| Throughput | Linear with worker count |
| Admission control | O(1) — pre-computed aggregates, no iteration |

### What Doesn't Scale
| Constraint | Why |
|------------|-----|
| KV cache per request | Fixed by model architecture |
| Coordinator | Single point (can be replicated, but adds complexity) |
| Session migration | KV cache can't move — request is pinned to worker |

### Current Limits
```
Per Worker:
  - 100 max sessions
  - 512 MB max KV per session
  - 8 GB total KV cache

System-wide:
  - 1000 total sessions
  - 64 GB total KV cache
```

### Why Rejection Exists

Rejection is **intentional load shedding**:
- Better to reject 1 request fast than slow down 100 requests
- Memory is the real limit — admission control reflects that
- Clients can retry or queue externally
- System stays healthy under burst load

**Mantra:** "Reject early, fail fast, protect memory."

---

## Quick Reference

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

---