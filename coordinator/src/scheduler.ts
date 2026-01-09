// Worker selection logic — pure functions, no side effects

import { Worker } from './types';

export interface RequestMeta {
  model: string;
  prompt_tokens?: number;  // estimated from prompt length
}

export interface SchedulerConfig {
  maxActiveSessions: number;
  maxKvCacheBytes: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  maxActiveSessions: 100,
  maxKvCacheBytes: 8 * 1024 * 1024 * 1024, // 8 GB
};

/**
 * Check if worker is within capacity thresholds.
 * Pure function.
 */
function isWithinCapacity(worker: Worker, config: SchedulerConfig): boolean {
  if (!worker.health) return false;
  return (
    worker.health.active_sessions < config.maxActiveSessions &&
    worker.health.kv_cache_bytes < config.maxKvCacheBytes
  );
}

/**
 * Select best worker for a request.
 * Pure function: no I/O, no side effects.
 *
 * @throws Error if no healthy workers with capacity available
 */
export function selectWorker(
  requestMeta: RequestMeta,
  workers: Worker[],
  config: SchedulerConfig = DEFAULT_CONFIG
): Worker {
  // Filter alive workers
  const alive = workers.filter((w) => w.health?.alive);

  if (alive.length === 0) {
    throw new Error('No healthy workers available');
  }

  // Filter by capacity thresholds
  const available = alive.filter((w) => isWithinCapacity(w, config));

  if (available.length === 0) {
    throw new Error('All workers at capacity');
  }

  // Filter by model support (if we track that later)
  // const capable = available.filter(w => w.models?.includes(requestMeta.model));

  // Pick worker with fewest active sessions (least loaded)
  const sorted = [...available].sort(
    (a, b) =>
      (a.health?.active_sessions ?? Infinity) -
      (b.health?.active_sessions ?? Infinity)
  );

  return sorted[0];
}
