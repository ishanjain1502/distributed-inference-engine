# Protocol Types

Canonical type definitions shared across coordinator and worker.

---

## Conversation vs Session

| Concept | Scope | Identity | Description |
|---------|-------|----------|-------------|
| **Conversation** | Client ↔ Coordinator | `conversation_id` (client-generated UUID) | Stable key for multi-turn chat. The coordinator holds soft-state mapping to a worker session. |
| **Session** | Coordinator ↔ Worker | `session_id` (coordinator-generated UUID) | Live KV cache on one worker. Created on first turn; continued on later turns for the same `conversation_id`. |

The coordinator's `ConversationRegistry` maps `conversation_id` → `{ session_id, worker_id, ... }`. Clients send only `conversation_id`; workers know only `session_id`. Idle TTL, session full, or worker loss clears the mapping; the same `conversation_id` may then start a fresh session.

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

