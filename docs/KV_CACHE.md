- what KV cache is
KV cache is the per-session execution state of an LLM, stored locally on a worker, that accumulates with each generated token and must remain co-located with the model weights for the duration of decoding. Losing it terminates the session.
    
- why it’s large
It stores sets of high dimensional vectors for each token for every layer
    
- why it’s worker-local
It is an expensive process in the first place to prefill and create a kv cachce, then the decoding process, the next output token, depends on previous token, this makes the loop stateful, on top of it, moving the process is very expeisve, serializing the cache, transfering it over network, then desiralizing it, making sure no memory got missed, and state is corruputed yet, this all gets dominated by the value it could have generated on local inferencing.

- lifecycle
1. Worker gets assigned for a request
2. Prompt hits the worker
3. prompt gets tokenized and is prefilled ( this is a batchable process)
4. this produces the kv cache
5. this kv cache is tightly coupled with weights of the model, and is used for inferencing
6. the output token are generated sequentially
7. this is then decoded, and send back to coordinator
8. lifecycle ends when the output completes, timeout, explicit cancel, worker crash
