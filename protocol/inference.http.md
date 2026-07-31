# Inference HTTP Protocol

## Client → Coordinator

### POST /coordinator/infer

Start an inference request. Returns streaming tokens.

**Request**
```json
{
  "conversation_id": "uuid",
  "prompt": "string",
  "model": "string",
  "max_tokens": number
}
```

- `conversation_id` is **required** (client-generated UUID). Reuse the same id across turns in a chat; the coordinator maps it to a sticky worker session and reuses KV cache until the session is full, idle-expired, or lost.
- `prompt` is this turn's user text only (not full history) when continuing a live session.
- Concurrent requests with the same `conversation_id` are **queued** (FIFO); only one decode runs at a time per conversation.

**Response**: `text/event-stream`

Each SSE event contains:
```json
{
  "token": "string",
  "finished": boolean
}
```

**Errors**
| Status | Meaning |
|--------|---------|
| 400 | Missing required fields (including `conversation_id`) |
| 409 | Conversation reset required. Body includes `reason`: `session_full` (KV or context budget exceeded) or `session_gone` (worker/session lost). Client must use a **new** `conversation_id` after `session_full`; for `session_gone`, a new id is recommended. |
| 502 | Worker unreachable or failed |
| 503 | No healthy workers |

---

## Coordinator → Worker

### POST /worker/prefill

Initialize or extend session state. No tokens returned.

**Request**
```json
{
  "session_id": "string",
  "prompt": "string",
  "model": "string",
  "max_tokens": number,
  "mode": "create" | "continue"
}
```

- `mode`: `create` for a new worker session; `continue` to append this turn's prompt to an existing session's KV cache.
- Continue with unknown `session_id`: worker returns `404` → coordinator surfaces `409` with `reason: session_gone`.
- Continue with mismatched `model`: worker returns `400` (`reason: model_mismatch`).

**Response (success)**
```json
{
  "status": "ok",
  "tokens_added": number,
  "total_tokens_est": number
}
```

**Errors**
| Status | Meaning |
|--------|---------|
| 400 | Invalid `mode` or model mismatch on continue |
| 404 | Session not found (continue path) |
| 409 | Session budget exceeded. Body includes `reason: session_full`. |

---

### POST /worker/decode

Stream tokens for an existing session.

**Request**
```json
{
  "session_id": "string",
  "max_tokens": number
}
```

**Response**: `text/event-stream`

Each SSE event contains:
```json
{
  "token": "string",
  "finished": boolean
}
```

**Errors**
| Status | Meaning |
|--------|---------|
| 404 | Session not found |

---

### GET /worker/health

Health check for scheduler.

**Response**
```json
{
  "alive": boolean,
  "active_sessions": number,
  "kv_cache_bytes": number
}
```

---

## Sequence

```
Client              Coordinator              Worker
  |                      |                      |
  |-- POST /infer ------>|                      |
  |  (conversation_id)   |                      |
  |                      |-- GET /health ------>|
  |                      |<----- health --------|
  |                      |                      |
  |                      |-- POST /prefill ---->|
  |                      |  (mode=create|cont.) |
  |                      |<----- ok ------------|
  |                      |                      |
  |                      |-- POST /decode ----->|
  |<== SSE stream ==============================|
  |                      |                      |
```

---

## Future work

- **Truncated re-prefill:** When a session hits KV or context limits (`session_full`), instead of requiring the client to start a new `conversation_id`, re-prefill a truncated history into a fresh worker session while keeping the same `conversation_id`. Not implemented in v1.
