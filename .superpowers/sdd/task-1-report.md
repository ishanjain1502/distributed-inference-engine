# Task 1 Report — Metrics core

Files added:
- scripts/bench_lib/__init__.py
- scripts/bench_lib/metrics.py
- tests/unit/test_bench_metrics.py

TDD Evidence

1) RED — failing tests after adding tests (import error)

Command:
python -m pytest tests/unit/test_bench_metrics.py -q

Output (excerpt):
```
E   ModuleNotFoundError: No module named 'bench_lib'
ERROR tests/unit/test_bench_metrics.py
1 error in 0.44s
```

2) GREEN — after implementing metrics

Command:
python -m pytest tests/unit/test_bench_metrics.py -q

Output:
```
4 passed in 0.03s
```

Notes
- Implemented RequestResult dataclass and functions: percentile, status_bucket, per_request_tps, aggregate.
- Percentile uses nearest-rank (ceil) as specified by tests.

Commands run

- python -m pytest tests/unit/test_bench_metrics.py -q  # initial, failed import
- python -m pytest tests/unit/test_bench_metrics.py -q  # after implementation, all tests pass

Summary

- Status: DONE
- Test summary: 4 passed, 0 failed

# Task 1 Report: ConversationRegistry (coordinator)

## Status

DONE_WITH_CONCERNS

## TDD Evidence

### RED (Step 2)

```bash
cd coordinator && npm run build 2>/dev/null; node --test tests/conversationRegistry.test.mjs
```

Initial run with verbatim brief test (top-level `require` in `.mjs`) failed with:

```
ReferenceError: require is not defined in ES module scope
```

After adding a two-line `createRequire` shim (see Concerns), re-ran:

```
Error: Cannot find module '../dist/conversationRegistry.js'
  code: 'MODULE_NOT_FOUND'
```

This matches the brief’s expected RED failure (missing module/export).

### GREEN (Step 4)

```bash
cd coordinator && npm test
```

```
# tests 5
# pass 5
# fail 0
```

All five tests pass: unknown id, set/get, delete, idle TTL expiry, FIFO acquire.

## Files Changed

| File | Action |
|------|--------|
| `coordinator/src/conversationRegistry.ts` | Created — registry, TTL, FIFO lock, singleton export |
| `coordinator/tests/conversationRegistry.test.mjs` | Created — unit tests per brief (+ `createRequire` shim) |
| `coordinator/package.json` | Modified — `"test": "tsc && node --test tests/conversationRegistry.test.mjs"` |

## Commit

```
41ac934 Add ConversationRegistry with FIFO lock and idle TTL
```

## Self-Review

**Matches spec**

- `ConversationEntry` interface and `CONVERSATION_IDLE_TTL_MS = 300_000` exported as specified.
- `get` lazy-deletes entries when `Date.now() - lastActiveMs > TTL`.
- `set` shallow-copies entry; does not auto-bump `lastActiveMs` (caller responsibility).
- `touch` updates `lastActiveMs` and optional `approxTokens`; no-op if missing.
- `delete`, `clear` (entries + lock tails), `acquire` FIFO via per-conversation promise chain with idempotent release.
- Module singleton `conversationRegistry` exported for later coordinator wiring.

**Implementation quality**

- Implementation copied verbatim from plan; no extra behavior beyond spec.
- TypeScript compiles cleanly; no linter issues on new source file.

**Minor notes**

- `Waiter` type in source is declared but unused (present in plan snippet; harmless).
- `touch()` reads via `entries.get` directly, not `get()`, so an idle-expired entry can still be touched without TTL cleanup until the next `get`. Consistent with plan; future callers should use `get` for reads.

## Concerns

1. **`.mjs` + `require` incompatibility** — Node treats `.mjs` as ESM; top-level `require` from the brief fails on Node 22. Added minimal shim at top of test file:

   ```javascript
   import { createRequire } from 'node:module';
   const require = createRequire(import.meta.url);
   ```

   All test cases and assertions remain verbatim; only this bootstrap differs.

2. **No tests for `touch` or `clear`** — Out of scope for Task 1 brief; covered in later integration tasks.

3. **Singleton not exercised in tests** — Each test uses `new ConversationRegistry()`; module export untested until coordinator integration.

## Review Fix (tails memory leak)

**Finding:** `tails` Map entries were never removed after queues drained, causing unbounded memory retention per conversation ID.

**Fix:**
- Store the installed tail Promise in a local `tail` variable; on `tail.finally`, delete from `tails` only when `this.tails.get(conversationId) === tail` (avoids deleting a newer chained tail).
- Removed unused `Waiter` type.
- Added test-only `hasTail(conversationId)` for regression coverage.

**Test:**

```bash
cd coordinator && npm test
```

```
# tests 6
# pass 6
# fail 0
```

New test: `release removes drained tail from map`.
