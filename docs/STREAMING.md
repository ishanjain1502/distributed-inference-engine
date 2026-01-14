## Streaming Pipeline Flow

Token streaming from worker decode loop to client with backpressure, buffering, and flow control.

---

## End-to-End Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           STREAMING PIPELINE                                 │
└──────────────────────────────────────────────────────────────────────────────┘

┌────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌────────┐
│   Worker   │     │   Bounded        │     │   Coordinator   │     │ Client │
│   Decode   │────►│   Channel        │────►│   Buffer        │────►│        │
│   Loop     │     │   (32 tokens)    │     │   (64 tokens)   │     │        │
└────────────┘     └──────────────────┘     └─────────────────┘     └────────┘
      │                    │                        │                    │
      │                    │                        │                    │
 Backpressure         Backpressure            Write Deadline        Slow client
 (blocks emit)        (blocks read)           (5s timeout)          detection
```

---

## Token Message Format

```
Worker emits:
  {
    "token": "Hello",     // Generated text
    "seq": 0              // Sequence number (monotonic)
  }

SSE wire format:
  data: {"token":"Hello","seq":0}

  data: {"token":" world","seq":1}

  data: {"token":"!","seq":2}
```

---

## Worker Side (stream.rs)

```
TokenEmitter
     │
     ├─► mpsc::channel(32)  ◄── Bounded capacity
     │
     ├─► seq: AtomicU64     ◄── Monotonic sequence
     │
     └─► emit(token) ──────────────────────────┐
                                               │
                         ┌─────────────────────▼─────────────────────┐
                         │                                           │
                         │  seq = seq.fetch_add(1)                   │
                         │  msg = TokenMessage { token, seq }        │
                         │  tx.send(msg).await  ◄── BLOCKS if full   │
                         │                                           │
                         └───────────────────────────────────────────┘

                                               │
                                               ▼
                         ┌───────────────────────────────────────────┐
                         │               Receiver (rx)               │
                         │                                           │
                         │  ReceiverStream::new(rx)                  │
                         │    .map(|msg| Event::json_data(msg))      │
                         │                                           │
                         └───────────────────────────────────────────┘
                                               │
                                               ▼
                                           SSE Stream
```

---

## Coordinator Side (infer.ts)

```
                              Fetch Worker /decode
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        streamTokensToClient()                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
   ┌─────────────┐           ┌─────────────────┐          ┌──────────────┐
   │   Reader    │           │  Bounded Buffer │          │    Writer    │
   │             │           │   (64 tokens)   │          │              │
   │ workerBody  │           │                 │          │  res.write() │
   │  .getReader │──────────►│  buffer.push()  │─────────►│              │
   │  .read()    │           │                 │          │ writeWith    │
   │             │           │  buffer.shift() │          │  Deadline()  │
   └─────────────┘           └─────────────────┘          └──────────────┘
          │                           │                           │
          │                           │                           │
          ▼                           ▼                           ▼
   ┌─────────────┐           ┌─────────────────┐          ┌──────────────┐
   │ parseSSE    │           │ Overflow:       │          │ Timeout:     │
   │ Tokens()    │           │  drop oldest    │          │  terminate   │
   │             │           │  log overflow   │          │  session     │
   └─────────────┘           └─────────────────┘          └──────────────┘
```

---

## Sequence Gap Detection

```
Worker                          Coordinator
  │                                 │
  │  seq=0                          │  expectedSeq=0
  ├────────────────────────────────►│  ✓ match, expectedSeq=1
  │                                 │
  │  seq=1                          │  expectedSeq=1
  ├────────────────────────────────►│  ✓ match, expectedSeq=2
  │                                 │
  │  seq=3  (seq=2 lost!)           │  expectedSeq=2
  ├────────────────────────────────►│  ⚠ GAP DETECTED
  │                                 │    log: stream.sequence_gap
  │                                 │    expected=2, actual=3
  │                                 │    continue anyway
  │                                 │    expectedSeq=4
  │                                 │
```

---

## Buffer Overflow Handling

```
                    ┌────────────────────────────────┐
                    │      Coordinator Buffer        │
                    │         (max=64)               │
                    └────────────────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
   buffer.length < 64        buffer.length = 64       buffer.length > 64
         │                         │                         │
         ▼                         ▼                         ▼
   ┌───────────┐           ┌───────────────┐         ┌───────────────┐
   │ push()    │           │ buffer full   │         │ while > 64:   │
   │ normally  │           │ warn if >80%  │         │   drop oldest │
   └───────────┘           └───────────────┘         │   log overflow│
                                                     └───────────────┘


Events logged:

  buffer >80%:
    { event: "stream.buffer_high", fill_ratio: "0.85" }

  overflow:
    { event: "stream.buffer_overflow", dropped_seq: 12 }
```

---

## Write Deadline Flow

```
writeWithDeadline(res, token, 5000ms)
                │
                ▼
   ┌────────────────────────────────┐
   │  setTimeout(5000)              │
   │  res.write(data, callback)     │
   └────────────────────────────────┘
                │
     ┌──────────┴──────────┐
     │                     │
 callback                timeout
 fires first           fires first
     │                     │
     ▼                     ▼
┌───────────┐      ┌───────────────────┐
│ success   │      │ write_timeout     │
│ latencyMs │      │ terminate session │
│ continue  │      │ clientDisconnected│
└───────────┘      │   = true          │
                   └───────────────────┘
```

---

## Slow Client Detection

```
                     tokenWritten(sessionId, latencyMs)
                                   │
                                   ▼
                     ┌─────────────────────────────┐
                     │ latencyMs > 1000ms ?        │
                     └─────────────────────────────┘
                            │              │
                           yes            no
                            │              │
                            ▼              ▼
               ┌─────────────────┐   ┌───────────┐
               │ slowClientCount++│   │ continue  │
               │ log:             │   └───────────┘
               │  stream.slow_    │
               │  client          │
               └─────────────────┘
```

---

## Session Termination Reasons

| Reason             | Trigger                                    | Action                        |
|--------------------|--------------------------------------------|-------------------------------|
| `complete`         | Worker stream ends normally                | Clean session end             |
| `client_disconnect`| Client closes connection                   | Stop reading worker stream    |
| `write_timeout`    | res.write() exceeds 5s deadline            | Terminate, log timeout        |
| `worker_error`     | Worker decode fails or connection lost     | Return error to client        |
| `buffer_overflow`  | Buffer exceeds capacity                    | Drop tokens, log overflow     |

---

## Metrics Tracked

| Metric                          | Location         | Description                       |
|---------------------------------|------------------|-----------------------------------|
| `stream.session_start`          | streamMetrics.ts | New session created               |
| `stream.session_end`            | streamMetrics.ts | Session terminated with reason    |
| `stream.sequence_gap`           | infer.ts         | Token sequence gap detected       |
| `stream.buffer_high`            | streamMetrics.ts | Buffer >80% full                  |
| `stream.buffer_overflow`        | streamMetrics.ts | Token dropped from buffer         |
| `stream.slow_client`            | streamMetrics.ts | Write latency >1s                 |
| `stream.write_timeout`          | infer.ts         | Write exceeded deadline           |
| `tokensReceived`                | streamMetrics.ts | Count per session                 |
| `tokensWritten`                 | streamMetrics.ts | Count per session                 |
| `peakBufferSize`                | streamMetrics.ts | Max buffer size per session       |
| `avgWriteLatencyMs`             | streamMetrics.ts | Average write latency             |
