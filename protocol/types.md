# Protocol Types

Canonical type definitions shared across coordinator and worker.

---

## Session

Represents an active inference session on a worker.

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | UUID, created by coordinator |
| `prompt` | string | Raw input text |
| `model` | string | Model identifier |
| `max_tokens` | number | Maximum tokens to generate |
| `kv_cache_bytes` | number | Memory used by KV cache |

---

## TokenMessage

Single token in the streaming response with sequence number.

| Field | Type | Description |
|-------|------|-------------|
| `token` | string | Generated token |
| `seq` | number | Sequence number (0-indexed) for gap/retry detection |

**Note:** Sequence numbers are monotonically increasing per decode session. The coordinator uses them to detect gaps or retries in the token stream.

---

## WorkerHealth

Health status reported by worker.

| Field | Type | Description |
|-------|------|-------------|
| `alive` | boolean | Worker is operational |
| `active_sessions` | number | Current session count |
| `kv_cache_bytes` | number | Total KV cache memory usage |

---

## Error

Standard error response.

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Human-readable error message |

---

## Invariants

- `session_id` is globally unique (UUID v4)
- `max_tokens` in decode ≤ `max_tokens` from prefill
- Worker owns all tokenization and decoding
- Coordinator never interprets token content

