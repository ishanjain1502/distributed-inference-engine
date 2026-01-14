## Heartbeat Flow

Worker self-reports health to coordinator at fixed intervals.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HEARTBEAT LOOP                              │
└─────────────────────────────────────────────────────────────────────┘

    ┌──────────┐                                    ┌─────────────┐
    │  Worker  │                                    │ Coordinator │
    └────┬─────┘                                    └──────┬──────┘
         │                                                 │
         │  ┌─────────────────────────────────────┐        │
         │  │ Every N seconds (default: 10s)      │        │
         │  └─────────────────────────────────────┘        │
         │                                                 │
         ├─────────────────────────────────────────────────►
         │  POST /coordinator/health/heartbeat             │
         │  {                                              │
         │    worker_id: "worker-1",                       │
         │    worker_url: "http://localhost:3001",         │
         │    timestamp: 1704067200000,                    │
         │    health: {                                    │
         │      alive: true,                               │
         │      active_sessions: 5,                        │
         │      kv_cache_bytes: 1073741824                 │
         │    }                                            │
         │  }                                              │
         │                                                 │
         │◄─────────────────────────────────────────────────
         │  200 OK / 4xx / 5xx                             │
         │                                                 │
         ▼                                                 ▼

```

---

## Component Responsibilities

### Worker (sender)
- Spawns background task on startup
- Gathers local state: session count, KV cache usage
- Sends POST to coordinator every interval
- Logs warnings on rejection, errors on failure

### Coordinator (receiver)
- Receives heartbeat at `/coordinator/health/heartbeat`
- Updates health table with worker status
- Uses data for scheduler decisions

### Scheduler (consumer)
- Reads health table to get available workers
- Filters workers by `alive` status
- Scores workers by `active_sessions` and `kv_cache_bytes`

---

## Data Flow

```
Worker State                  Heartbeat Payload              Coordinator State
─────────────                 ─────────────────              ─────────────────
Sessions Map      ──────►     active_sessions     ──────►    Health Table
  └─ kv_cache_bytes ──────►   kv_cache_bytes      ──────►      └─ Worker Entry
                              worker_id           ──────►         ├─ id
                              worker_url          ──────►         ├─ url
                              timestamp           ──────►         ├─ last_seen
                                                                  └─ health
```

---

## Configuration

| Env Variable       | Default                   | Description                          |
|--------------------|---------------------------|--------------------------------------|
| `WORKER_ID`        | `worker-1`                | Unique identifier for this worker    |
| `WORKER_URL`       | `http://localhost:3001`   | URL coordinator uses to reach worker |
| `COORDINATOR_URL`  | `http://localhost:1337`   | Coordinator base URL                 |

Heartbeat interval: 10 seconds (hardcoded in `HeartbeatConfig::default()`)

---

## Failure Handling

| Scenario                  | Worker Behavior                     | System Effect                        |
|---------------------------|-------------------------------------|--------------------------------------|
| Coordinator unreachable   | Logs error, continues retrying      | Worker removed from health table     |
| Heartbeat rejected (4xx)  | Logs warning, continues             | Worker may be marked unhealthy       |
| Worker crashes            | No heartbeats sent                  | Coordinator TTL expires worker entry |

---

## Integration Points

```
main.rs
  └─ tokio::spawn(heartbeat::run_heartbeat_loop(...))
        │
        ▼
heartbeat.rs
  └─ run_heartbeat_loop()
        ├─ gather_health() ◄─── state.rs (Sessions)
        └─ POST to coordinator
              │
              ▼
coordinator/src/healthTable.ts
  └─ receiveHeartbeat()
        │
        ▼
coordinator/src/scheduler.ts
  └─ selectWorker() reads health table
```
