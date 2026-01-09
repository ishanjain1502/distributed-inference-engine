If request.session_id exists:
    route to worker owning that session

### Scheduler keeps:

soft-state view of workers

last heartbeat

last known load

---

### Scheduler does NOT keep:

authoritative truth

session ownership

durable state

---

### If scheduler restarts:

system continues

next heartbeat rebuilds state

This is intentional.

---

### If all workers exceed thresholds:

active_sessions > MAX

kv_cache_bytes > LIMIT

Then:

    scheduler rejects request

    coordinator returns 429 Too Many Requests

    This protects the system.



## SESSION CLEANUP (GARBAGE COLLECTION)

Now the ugly part: orphaned state.

### Orphaned session scenarios

    Client disconnects mid-decode

    Coordinator crashes

    Network drops

    Worker stalls

### Cleanup policy (WRITE THIS)

On worker:

    Each session has:

        last_activity_ts

    If idle > SESSION_TTL:

        evict KV cache

        free memory

On coordinator:

    Session registry entries expire
    
    No attempt to resurrect

No coordination needed.
No two-phase cleanup.
Local responsibility only.