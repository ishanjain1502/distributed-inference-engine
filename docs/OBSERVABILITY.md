We are going to have basically 3 types of signals
    1. Logs
    2. Metrics
    3. Traces

We can Say our observability Metrics Have to ansewr Following Questions 
Scheduler questions
    Why was this worker selected?
    Are workers actually balanced?
    Are we rejecting requests?

Worker questions
    Is decode slow or stalled?
    Is KV cache growing uncontrollably?
    Are we CPU-bound or network-bound?

Coordinator questions
    Are clients slow?
    Are buffers filling?
    Are we dropping sessions?

---

## Implementation Status

### Worker Observability (`worker/src/metrics.rs`)

**Metrics Emitted (every 10s):**
- `worker.prefill.latency_ms` - Last prefill latency
- `worker.decode.tokens_per_second` - Current decode TPS (5s sliding window)
- `worker.kv_cache.bytes` - Total KV cache memory
- `worker.active_sessions` - Current session count
- `worker.decode.failures` - Total decode failures

**Logs:**
- `session.start` - When prefill completes (includes session_id, model, max_tokens, kv_cache_bytes, prefill_latency_ms)
- `session.end` - When decode completes (includes session_id, tokens_emitted, decode_duration_ms, decode_tps, reason)
- `decode.early_termination` - When decode stops early (includes reason: complete/client_disconnect/error)
- `decode.session_not_found` - When decode requested for unknown session

### Scheduler Observability (`coordinator/src/scheduler.ts`)

**Metrics Tracked:**
- `rejectedNoWorkers` - Requests rejected due to no healthy workers
- `rejectedAtCapacity` - Requests rejected due to all workers at capacity
- `totalSelections` - Total successful worker selections

**Logs:**
- `scheduler.select` - Worker selection decision with scoring:
  - `selected_worker`, `selected_score`, `selected_sessions`, `selected_kv_bytes`
  - `selected_session_pct`, `selected_kv_pct` (capacity utilization)
  - `candidates_count`, `runner_up` (for debugging balance)
- `scheduler.reject` - Request rejection:
  - `reason`: `no_healthy_workers` | `all_at_capacity`
  - `workers_total`, `workers_alive`, `workers_available`

### Coordinator Observability (`coordinator/src/streamMetrics.ts`)

**Metrics Tracked:**
- `activeSessions` - Currently streaming sessions
- `terminatedByReason` - Counts by: complete, client_disconnect, write_timeout, worker_error, buffer_overflow
- `totalBufferOverflows` - Tokens dropped due to buffer limit
- `peakBufferFillRatio` - Highest buffer utilization seen
- `avgWriteLatencyMs` - Average client write latency
- `slowClientCount` - Clients exceeding 1s write latency

**Logs:**
- `stream.session_start` - Session begins (session_id, worker_id, active_sessions)
- `stream.session_end` - Session ends (session_id, reason, duration_ms, tokens_received, tokens_written, peak_buffer_size)
- `stream.slow_client` - Client write exceeds threshold (session_id, write_latency_ms)
- `stream.buffer_high` - Buffer > 80% full (session_id, current_size, max_size, fill_ratio)
- `stream.buffer_overflow` - Token dropped (session_id, dropped_seq)
- `stream.sequence_gap` - Unexpected sequence number (session_id, expected_seq, actual_seq)
- `stream.write_timeout` - Client write deadline exceeded (session_id, token_seq, deadline_ms)

---

### Metrics to define
1. Scheduler: It is responsible for selecting/rejecting worker, it is aware of load on worker, it can tell us capacity available for system and pressure on sysetm

Scheduler Metrics:
scheduler.worker_alive.count
scheduler.worker_load.active_sessions
scheduler.worker_load.kv_bytes
scheduler.request.rejected.count

2. Worker Metrics: 
worker.prefill.latency_ms
worker.decode.tokens_per_second
worker.kv_cache.bytes
worker.active_sessions
worker.decode.failures

3. Coordinator metrics
coordinator.stream.buffer_fill_ratio
coordinator.client_write_latency_ms
coordinator.sessions.active
coordinator.sessions.terminated

### Logging rules
Every log line must have:
    1. request_id
    2. session_id
    3. worker_id (if applicable)

### Tracing
    Trace structure:
        Client request → request_id
        Prefill span
        Decode span
        Streaming span

    Each span has:
        start time
        end time
        component name

### DETECTING AI-SPECIFIC LIES
    We must detect:
        hallucination rate spikes
        token throughput drops
        abnormal KV growth

    Signals
        decode TPS sudden drop
        prefill latency spike
        KV cache growing faster than token count
