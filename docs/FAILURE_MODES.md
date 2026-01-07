## Failure Mode

| Failure                 | What breaks                                                         | What survives                                                   | What user sees                 |
| ----------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------ |
| Worker dies mid-prefill | prefilling process, or the tokens that were recieved in pre filling | coordinator, health monitor, scheduler, other workers           | request falied, prefill process starts again                 |
| Worker dies mid-decode  | generated output failed to get processed, or error in decoder       | coordinator, health monitor, scheduler, other workers           | request failed                 |
| Coordinator crashes     | owns lot of things<br>request, worker registry, memory issue etc    | nothing, as coordinator is one that will connect all components | system restart, request failed |
| Network timeout         | kv cache, or worker stopped responding                              | coordinator, health monitor, scheduler, workers                 | timeout error                  |