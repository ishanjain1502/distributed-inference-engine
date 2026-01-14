## Coordinator Component Flow

The coordinator is the entry point of the inference engine. It connects clients with workers and manages the request lifecycle.

---

## Module Structure

```
coordinator/src/
  ├─ server.ts        Entry point, Express app setup
  ├─ health.ts        Health endpoints, heartbeat ingestion
  ├─ healthTable.ts   Worker registry, status tracking
  ├─ infer.ts         Inference endpoint, streaming pipeline
  ├─ scheduler.ts     Worker selection, load balancing
  ├─ streamMetrics.ts Session and buffer metrics
  └─ types.ts         Shared type definitions
```

---

## Request Flow

```
                              ┌─────────────────────────────────────────┐
                              │            COORDINATOR                  │
                              └─────────────────────────────────────────┘

Client                                                                      Worker
  │                                                                           │
  │  POST /coordinator/infer                                                  │
  │  { prompt, model, max_tokens }                                            │
  ├───────────────────────────────────►┐                                      │
  │                                    │                                      │
  │                          ┌─────────▼─────────┐                            │
  │                          │    infer.ts       │                            │
  │                          │  Validate request │                            │
  │                          └─────────┬─────────┘                            │
  │                                    │                                      │
  │                          ┌─────────▼─────────┐                            │
  │                          │  healthTable.ts   │                            │
  │                          │ getWorkersFor     │                            │
  │                          │   Scheduler()     │                            │
  │                          └─────────┬─────────┘                            │
  │                                    │                                      │
  │                          ┌─────────▼─────────┐                            │
  │                          │   scheduler.ts    │                            │
  │                          │  selectWorker()   │                            │
  │                          │  Score & pick     │                            │
  │                          └─────────┬─────────┘                            │
  │                                    │                                      │
  │                                    │  POST /worker/prefill                │
  │                                    ├─────────────────────────────────────►│
  │                                    │                                      │
  │                                    │◄─────────────────────────────────────┤
  │                                    │  200 OK                              │
  │                                    │                                      │
  │                                    │  POST /worker/decode                 │
  │                                    ├─────────────────────────────────────►│
  │                                    │                                      │
  │  SSE: data: {"token":"..","seq":0} │◄ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
  │◄───────────────────────────────────┤  SSE stream                          │
  │  SSE: data: {"token":"..","seq":1} │                                      │
  │◄───────────────────────────────────┤                                      │
  │  ...                               │                                      │
  │                                    │                                      │
```

---

## Health Table Flow

```
Worker                                Coordinator
  │                                      │
  │  POST /coordinator/health/heartbeat  │
  │  {                                   │
  │    worker_id,                        │
  │    worker_url,                       │
  │    timestamp,                        │
  │    health: {                         │
  │      alive,                          │
  │      active_sessions,                │
  │      kv_cache_bytes                  │
  │    }                                 │
  │  }                                   │
  ├─────────────────────────────────────►│
  │                                      │
  │                            ┌─────────▼─────────┐
  │                            │   health.ts       │
  │                            │ POST /heartbeat   │
  │                            └─────────┬─────────┘
  │                                      │
  │                            ┌─────────▼─────────┐
  │                            │  healthTable.ts   │
  │                            │    ingest()       │
  │                            │                   │
  │                            │ ┌───────────────┐ │
  │                            │ │ workers Map   │ │
  │                            │ │  worker-1 ──► │ │
  │                            │ │  worker-2 ──► │ │
  │                            │ └───────────────┘ │
  │                            └───────────────────┘
  │                                      │
  │◄─────────────────────────────────────┤
  │  200 OK { ack: true }                │


Status Transitions:
  ┌───────┐  heartbeat   ┌───────┐  30s timeout  ┌───────┐  60s timeout  ┌──────┐
  │ (new) │ ───────────► │ ALIVE │ ────────────► │ STALE │ ────────────► │ DEAD │
  └───────┘              └───────┘               └───────┘               └──────┘
                              ▲                                              │
                              │                   cleanup()                  │
                              │◄─────────────────────────────────────────────┘
                                         (removed from table)
```

---

## Scheduler Flow

```
                    ┌────────────────────────────────────────┐
                    │              selectWorker()            │
                    └────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌────────────────────────────────────────┐
                    │   Filter: workers.health?.alive        │
                    └────────────────────────────────────────┘
                                       │
                         ┌─────────────┴─────────────┐
                         │                           │
                    alive.length === 0          alive.length > 0
                         │                           │
                         ▼                           ▼
              ┌──────────────────┐    ┌────────────────────────────────┐
              │ throw            │    │ Filter: isWithinCapacity()     │
              │ WorkerSelection  │    │   active_sessions < max        │
              │ Error            │    │   kv_cache_bytes < max         │
              │ 'no_healthy_     │    └────────────────────────────────┘
              │  workers'        │                     │
              └──────────────────┘       ┌─────────────┴─────────────┐
                                         │                           │
                                    available === 0            available > 0
                                         │                           │
                                         ▼                           ▼
                              ┌──────────────────┐    ┌────────────────────────────┐
                              │ throw            │    │ Score each worker:         │
                              │ WorkerSelection  │    │   score = sessions*0.6     │
                              │ Error            │    │         + kv_cache*0.4     │
                              │ 'all_at_capacity'│    └────────────────────────────┘
                              └──────────────────┘                 │
                                                                   ▼
                                                    ┌────────────────────────────┐
                                                    │ Sort by score (ascending)  │
                                                    │ Return workers[0]          │
                                                    └────────────────────────────┘
```

---

## Prefill Retry Flow

```
                         ┌─────────────────────────┐
                         │   MAX_PREFILL_RETRIES=2 │
                         │   attempts = 0          │
                         └────────────┬────────────┘
                                      │
                    ┌─────────────────▼─────────────────┐
               ┌───►│ Select worker (exclude tried)    │
               │    └─────────────────┬─────────────────┘
               │                      │
               │    ┌─────────────────▼─────────────────┐
               │    │ POST /worker/prefill              │
               │    └─────────────────┬─────────────────┘
               │                      │
               │         ┌────────────┴────────────┐
               │         │                         │
               │     success                    failure
               │         │                         │
               │         ▼                         │
               │    ┌──────────┐                   │
               │    │ Continue │                   │
               │    │ to decode│                   │
               │    └──────────┘                   │
               │                                   │
               │                    ┌──────────────▼──────────────┐
               │                    │ attempts < MAX_RETRIES ?    │
               │                    └──────────────┬──────────────┘
               │                          │                │
               │                        yes               no
               │                          │                │
               └──────────────────────────┘                │
                                                           ▼
                                              ┌─────────────────────┐
                                              │ 502 All prefill     │
                                              │ attempts failed     │
                                              └─────────────────────┘
```

---

## Endpoints

| Method | Path                              | Handler          | Description                    |
|--------|-----------------------------------|------------------|--------------------------------|
| GET    | `/`                               | server.ts        | Hello world                    |
| GET    | `/coordinator/health`             | health.ts        | Health check                   |
| POST   | `/coordinator/health/heartbeat`   | health.ts        | Worker heartbeat ingestion     |
| GET    | `/coordinator/health/workers`     | health.ts        | All workers with status        |
| GET    | `/coordinator/health/workers/available` | health.ts  | Workers available for scheduling |
| POST   | `/coordinator/infer`              | infer.ts         | Client inference endpoint      |

---

## Configuration

| Constant                  | Value   | Location        | Description                        |
|---------------------------|---------|-----------------|------------------------------------|
| `MAX_PREFILL_RETRIES`     | 2       | infer.ts        | Prefill retry attempts             |
| `bufferSize`              | 64      | types.ts        | Token buffer size                  |
| `writeDeadlineMs`         | 5000    | types.ts        | Client write timeout               |
| `HEARTBEAT_STALENESS_MS`  | 30000   | healthTable.ts  | Reject stale heartbeats            |
| `STALE_THRESHOLD_MS`      | 30000   | healthTable.ts  | Mark worker stale after            |
| `DEAD_THRESHOLD_MS`       | 60000   | healthTable.ts  | Mark worker dead after             |
| `maxActiveSessions`       | 100     | scheduler.ts    | Max sessions per worker            |
| `maxKvCacheBytes`         | 8GB     | scheduler.ts    | Max KV cache per worker            |
