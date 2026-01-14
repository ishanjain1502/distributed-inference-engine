## Worker Component Flow

The worker handles inference execution: prefilling KV cache, running the decode loop, and streaming tokens back to the coordinator.

---

## Module Structure

```
worker/src/
  ├─ main.rs       Entry point, HTTP server, background tasks
  ├─ http.rs       HTTP handlers: prefill, decode, health
  ├─ state.rs      Session storage, TTL eviction
  ├─ stream.rs     Token emitter with backpressure
  ├─ heartbeat.rs  Periodic health reporting to coordinator
  ├─ metrics.rs    Performance metrics, TPS tracking
  └─ cache.rs      KV cache management (placeholder)
```

---

## Startup Flow

```
main()
  │
  ├─► tracing_subscriber::init()
  │
  ├─► Sessions = Arc<RwLock<HashMap>>
  │
  ├─► tokio::spawn(heartbeat::run_heartbeat_loop)
  │       │
  │       └─► Every 10s: POST health to coordinator
  │
  ├─► tokio::spawn(state::run_eviction_loop)
  │       │
  │       └─► Every 60s: evict sessions with TTL > 5min
  │
  ├─► tokio::spawn(metrics::run_metrics_loop)
  │       │
  │       └─► Every 10s: emit metrics log line
  │
  └─► axum::serve(Router)
          │
          ├─ POST /worker/prefill  ──► http::prefill
          ├─ POST /worker/decode   ──► http::decode
          └─ GET  /worker/health   ──► http::health
```

---

## Prefill Flow

```
POST /worker/prefill
{ session_id, prompt, model, max_tokens }
              │
              ▼
┌─────────────────────────────────────┐
│           http::prefill()           │
└─────────────────────────────────────┘
              │
              ├─► Start timer
              │
              ├─► Estimate KV cache size
              │     kv_cache_bytes = prompt.len() * 512
              │
              ├─► Create Session {
              │     prompt,
              │     model,
              │     max_tokens,
              │     kv_cache_bytes,
              │     last_activity: now
              │   }
              │
              ├─► sessions.write().insert(session_id, session)
              │
              ├─► Update metrics:
              │     total_kv_cache
              │     active_sessions
              │
              ├─► Record prefill latency
              │
              ├─► Log: session.start
              │
              └─► Return { status: "ok" }
```

---

## Decode Flow

```
POST /worker/decode
{ session_id, max_tokens }
              │
              ▼
┌─────────────────────────────────────┐
│           http::decode()            │
└─────────────────────────────────────┘
              │
              ├─► sessions.write().get_mut(session_id)
              │     └─► session.touch() (update last_activity)
              │
              ├─► Create TokenEmitter (bounded channel, capacity=32)
              │     │
              │     ├─► emitter (Sender side)
              │     └─► rx (Receiver side)
              │
              ├─► tokio::spawn(decode_loop)
              │     │
              │     └─────────────────────────────────────────┐
              │                                               │
              │                                               ▼
              │                              ┌────────────────────────────┐
              │                              │      DECODE LOOP           │
              │                              │                            │
              │                              │  for i in 0..max_tokens {  │
              │                              │    token = generate()      │
              │                              │    emitter.emit(token)     │
              │                              │      └─► blocks if full    │
              │                              │    sleep(50ms)             │
              │                              │  }                         │
              │                              │                            │
              │                              │  Log: session.end          │
              │                              └────────────────────────────┘
              │
              └─► Return Sse::new(ReceiverStream::new(rx))
                        │
                        ▼
              ┌────────────────────────────┐
              │  SSE Stream to Coordinator │
              │                            │
              │  data: {"token":"tok_0",   │
              │         "seq":0}           │
              │  data: {"token":"tok_1",   │
              │         "seq":1}           │
              │  ...                       │
              └────────────────────────────┘
```

---

## Backpressure Flow

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────┐
│ Decode Loop │         │  Bounded Channel │         │ Coordinator │
│             │         │   capacity=32    │         │             │
└──────┬──────┘         └────────┬─────────┘         └──────┬──────┘
       │                         │                          │
       │  emit(token)            │                          │
       ├────────────────────────►│                          │
       │                         │                          │
       │  emit(token)            │    SSE: token            │
       ├────────────────────────►├─────────────────────────►│
       │                         │                          │
       │  emit(token)            │    SSE: token            │
       ├────────────────────────►├─────────────────────────►│
       │                         │                          │
       │        ...              │        ...               │
       │                         │                          │
       │  ┌──────────────────────┤                          │
       │  │ Channel FULL (32)    │                          │
       │  └──────────────────────┤                          │
       │                         │                          │
       │  emit(token)            │         (slow client)    │
       │  BLOCKS ◄───────────────┤◄─────────────────────────│
       │                         │                          │
       │     (decode paused)     │                          │
       │                         │                          │
       │                         │    SSE: token            │
       │                         ├─────────────────────────►│
       │                         │                          │
       │  UNBLOCKED              │                          │
       │◄────────────────────────┤                          │
       │                         │                          │
       │  emit(token)            │                          │
       ├────────────────────────►│                          │
       │                         │                          │
```

---

## Session Eviction Flow

```
┌───────────────────────────────────────────────────────────┐
│                  run_eviction_loop()                      │
│                                                           │
│  Every 60 seconds:                                        │
│                                                           │
│    ┌─────────────────────────────────────────────────┐    │
│    │  sessions.write()                               │    │
│    │                                                 │    │
│    │  for each (id, session):                        │    │
│    │    if session.last_activity.elapsed() > 5min:  │    │
│    │      remove(id)                                 │    │
│    │      log: "Evicting expired session"            │    │
│    │                                                 │    │
│    │  if evicted > 0:                                │    │
│    │    log: "Session eviction complete"             │    │
│    └─────────────────────────────────────────────────┘    │
│                                                           │
└───────────────────────────────────────────────────────────┘


Session Lifecycle:

  prefill()           decode()              5min idle
     │                   │                     │
     ▼                   ▼                     ▼
┌─────────┐        ┌───────────┐        ┌───────────┐
│ Created │───────►│  Active   │───────►│  Expired  │───► Evicted
└─────────┘        └───────────┘        └───────────┘
                         │
                    touch() on decode
```

---

## Heartbeat Flow

```
┌───────────────────────────────────────────────────────────┐
│                  run_heartbeat_loop()                     │
│                                                           │
│  Every 10 seconds:                                        │
│                                                           │
│    ┌─────────────────────────────────────────────────┐    │
│    │  gather_health(sessions)                        │    │
│    │    └─► active_sessions = sessions.len()         │    │
│    │    └─► kv_cache_bytes = sum(s.kv_cache_bytes)   │    │
│    └─────────────────────────────────────────────────┘    │
│                           │                               │
│                           ▼                               │
│    ┌─────────────────────────────────────────────────┐    │
│    │  POST /coordinator/health/heartbeat             │    │
│    │  {                                              │    │
│    │    worker_id,                                   │    │
│    │    worker_url,                                  │    │
│    │    timestamp,                                   │    │
│    │    health: { alive, active_sessions, kv_bytes } │    │
│    │  }                                              │    │
│    └─────────────────────────────────────────────────┘    │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## Endpoints

| Method | Path              | Handler       | Description                    |
|--------|-------------------|---------------|--------------------------------|
| POST   | `/worker/prefill` | http::prefill | Initialize session, fill KV    |
| POST   | `/worker/decode`  | http::decode  | Stream tokens (SSE)            |
| GET    | `/worker/health`  | http::health  | Health status for monitoring   |

---

## Configuration

| Constant               | Value  | Location      | Description                       |
|------------------------|--------|---------------|-----------------------------------|
| `SESSION_TTL`          | 300s   | state.rs      | Idle session expiration           |
| `TOKEN_CHANNEL_CAPACITY` | 32   | stream.rs     | Backpressure buffer size          |
| `WORKER_ID`            | env    | heartbeat.rs  | Worker identifier                 |
| `WORKER_URL`           | env    | heartbeat.rs  | Reachable URL for coordinator     |
| `COORDINATOR_URL`      | env    | heartbeat.rs  | Coordinator base URL              |
| Heartbeat interval     | 10s    | heartbeat.rs  | Health report frequency           |
| Eviction check         | 60s    | state.rs      | Session cleanup frequency         |
| Metrics emission       | 10s    | metrics.rs    | Metrics log frequency             |
