## Total States in the system
#### Control Plane
- request registry (Coordinator)
- session metadata (Coordinator)
- worker registry (Scheduler)
- worker health & load (Scheduler)
- routing policy (Scheduler)
#### Data Plane
- model weights (Worker)
- tokenizer (Worker)
- KV cache (Worker)
- execution queue (Worker)
- decode loop state (Worker)

#### Lifecycle / Garbage
- expired KV cache (Worker)
- orphaned sessions (Coordinator)
- dead worker cleanup (Scheduler)
---

### Coordinator
coordinator connects clients with the system, its the entry point of our inference engine.
- What it owns
    
    validating and sanitizing client requests
    model registry and version control
    request registry and tracking
    response aggregation
    backpressure control
    sessionsMetaData
- What it NEVER owns
    worker threads, it holds a registry of them that is provided by the scheduler
    model itself
    kv store for cache
- What state it keeps
    Active requests
    model metadata
    system wide load
    session registry
    request → worker mapping
    high-level request state (`CREATED / RUNNING / DONE`)
- What state it must NOT keep
  loaded model
  execution queue
  tokens

### Worker
It fills up the kv cache required for the incoming requests, processes that requests, expires the kv cache as well
- What it owns
    KV cache
    model weights 
    execution of task
- What it NEVER owns
    request retries
    worker registry
    scheduling decision
- What state it keeps
    kv cache
    execution state of the request
    load on self
- What state it must NOT keep
  worker registry
  request registry
  
### Scheduler
Schedules request to worker
- What it owns
    routing policy
    load balancing on worker -> strategy/algorithm
- What it NEVER owns
    workers
    client request
    kv cache
- What state it keeps
    health status of workers, load status on workers
- What state it must NOT keep
  kv cache
  request registry
  model weights
  execution queue

### Health Monitor
Asses health of different components in the system , primarily workers
- What it owns
    health status aggregation
- What it NEVER owns
    ability to mutate any component's health status
- What state it keeps
    health status of workers
- What state it must NOT keep
  kv cache
  request registry
  model weights
  execution queue
  
### Defining Request Lifecycle
1. client sends prompt
2. coordinator recieves that prompt
3. coordinator asks scheduler to assign a worker
4. worker gets assigned
5. coordination sends prompt + session id to worker
6. worker tokenizes
7. prefilling takes place
8. kv cache is prepared in the worker now
9. worker enters decode loop (autoregressive generation)
10. worked generates output tokens
11. worker detokenizes and returns words
12. output words are streamed back to coordinator
13. sessions ends -> cache expires

### Streaming Pipeline
Worker
  └─ decode loop
      └─ token stream
          └─ Coordinator
              └─ client stream

### Some Important Rules
Coordinator is the pressure valve
Coordinator:
    buffers tokens
    applies backpressure
    drops or terminates sessions if needed
    Worker never manages client flow.


Backpressure is explicit, not implicit
If buffers fill:
    something must stop
    or something must die
    “Unlimited buffering” is not a strategy.

BUFFERING STRATEGY
    Worker → Coordinator buffer
    Small (e.g. 8–32 tokens)
    If full:
        worker pauses decode OR
        worker drops session
        For this system: Pause decode



## PART 5 — TIMEOUTS (TIME KILLS SYSTEMS)
**Three essential timeouts must be enforced:**
---
### Worker Decode Idle Timeout
- **Condition:**  
  If a worker cannot send tokens for _X_ seconds (decode is stalled).
- **Action:**  
  - Assume the session is stuck.
  - Terminate the session.

---
### Coordinator Write Timeout
- **Condition:**  
  If the client does not accept data for _Y_ seconds (e.g. slow or unreachable client).
- **Action:**  
  - Close the client connection.
  - Notify the worker to stop decoding (or allow TTL/other mechanism to clean up the session).

---
### End-to-End Session Timeout
- **Condition:**  
  A session exceeds a pre-defined hard cap on total lifetime.
- **Action:**  
  - Terminate the session.
  - Infinite sessions are disallowed.

---

FAILURE SCENARIOS

Case 1: Client is slow
    Coordinator buffer fills
    Coordinator stops reading worker stream
    Worker pauses decode
    If persists → session terminated

Case 2: Client disconnects
    Coordinator detects broken stream
    Session marked cancelled
    Worker stops decode or TTL cleans up

Case 3: Network hiccup between worker & coordinator
    Worker send blocks or errors
    Decode paused
    If timeout → session ends