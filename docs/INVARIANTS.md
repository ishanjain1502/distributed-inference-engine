## Invariants
need to write atleast 6
some hard wired prinicples that cannot be broken, and if they are to be broken, update the invariant

1. If a WORKER fails, then its crash should not affect any other worker
(FAILED worker will restart and will remain isolated from other workers)
2. Sessions SHOULD route to the same worker for KV-cache locality.
   Sessions MUST failover to another worker if the original is unhealthy.
   (Failover loses KV-cache; client may experience increased latency)
3. If a request state is to be mutated, then it can be mutated only by a coordinator
    (REQUEST can only be mutated via  a coordinator)
4. If  a request is processed, then it should be processed only once
    (no repeat processing, as it will decrease system's efficiency)
5. Scheduler only has READ APIs, it cannot mutate any state
6. Model weights are always resident in worker memory after startup.
   KV cache is present for all ACTIVE sessions; evicted under memory pressure (LRU).
7. kv cache exists if an only if its respective worker is alive, if worker dies, cache should also get cleared
8. when worker fails, all requests on the workers' execution queue also get failed
9. Health Monitor only has READ APIs, it cannot mutate anything
10. Once decode starts on a worker, all future decode steps for that session must happen on the same worker.
