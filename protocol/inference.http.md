# Inference HTTP Protocol

## Client → Coordinator

### POST /coordinator/infer

Start an inference request. Returns streaming tokens.

**Request**
```json
{
  "prompt": "string",
  "model": "string",
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
| 400 | Missing required fields |
| 502 | Worker unreachable or failed |
| 503 | No healthy workers |

---

## Coordinator → Worker

### POST /worker/prefill

Initialize session state. No tokens returned.

**Request**
```json
{
  "session_id": "string",
  "prompt": "string",
  "model": "string",
  "max_tokens": number
}
```

**Response**
```json
{
  "status": "ok"
}
```

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
  |                      |-- GET /health ------>|
  |                      |<----- health --------|
  |                      |                      |
  |                      |-- POST /prefill ---->|
  |                      |<----- ok ------------|
  |                      |                      |
  |                      |-- POST /decode ----->|
  |<== SSE stream ==============================|
  |                      |                      |
```

