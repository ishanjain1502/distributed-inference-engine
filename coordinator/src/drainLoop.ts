import { compact } from './compactionService';
import { conversationRegistry } from './conversationRegistry';
import { healthTable } from './healthTable';

const DRAIN_LOOP_INTERVAL_MS = 10_000;

export function startDrainLoop(intervalMs: number = DRAIN_LOOP_INTERVAL_MS): void {
  setInterval(() => {
    void runDrainCycle();
  }, intervalMs).unref();
}

async function runDrainCycle(): Promise<void> {
  const drainingWorkers = healthTable
    .getWorkersForScheduler()
    .filter((w) => w.health?.draining === true);

  for (const worker of drainingWorkers) {
    for (const { conversationId, entry } of conversationRegistry.entriesOnWorker(
      worker.id
    )) {
      if (conversationRegistry.hasTail(conversationId)) continue;
      try {
        await compact(conversationId, 'worker_drain', entry.model, {
          excludeWorkerId: worker.id,
        });
      } catch (err) {
        console.warn(
          JSON.stringify({
            event: 'drain.compact_failed',
            conversation_id: conversationId,
            worker_id: worker.id,
            error: String(err),
          })
        );
      }
    }
  }
}
