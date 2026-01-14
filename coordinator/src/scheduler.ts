// Worker selection logic with observability
//
// Logs:
// - Worker selection decisions with scoring inputs
// - Rejected requests
//
// Metrics tracked:
// - scheduler.request.rejected.count

import { Worker } from './types';

export interface RequestMeta {
  model: string;
  prompt_tokens?: number;
  request_id?: string;
}

export interface SchedulerConfig {
  maxActiveSessions: number;
  maxKvCacheBytes: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  maxActiveSessions: 100,
  maxKvCacheBytes: 8 * 1024 * 1024 * 1024,
};

export interface SchedulerMetrics {
  rejectedNoWorkers: number;
  rejectedAtCapacity: number;
  totalSelections: number;
}

const schedulerMetrics: SchedulerMetrics = {
  rejectedNoWorkers: 0,
  rejectedAtCapacity: 0,
  totalSelections: 0,
};

export function getSchedulerMetrics(): Readonly<SchedulerMetrics> {
  return { ...schedulerMetrics };
}

export function resetSchedulerMetrics(): void {
  schedulerMetrics.rejectedNoWorkers = 0;
  schedulerMetrics.rejectedAtCapacity = 0;
  schedulerMetrics.totalSelections = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Scoring
// ─────────────────────────────────────────────────────────────────────────────

interface WorkerScore {
  workerId: string;
  activeSessions: number;
  kvCacheBytes: number;
  sessionCapacityPct: number;
  kvCapacityPct: number;
  score: number;
}

/**
 * Score a worker for selection. Lower score = better choice.
 */
function scoreWorker(worker: Worker, config: SchedulerConfig): WorkerScore {
  const activeSessions = worker.health?.active_sessions ?? 0;
  const kvCacheBytes = worker.health?.kv_cache_bytes ?? 0;

  const sessionCapacityPct = (activeSessions / config.maxActiveSessions) * 100;
  const kvCapacityPct = (kvCacheBytes / config.maxKvCacheBytes) * 100;

  const score = sessionCapacityPct * 0.6 + kvCapacityPct * 0.4;

  return {
    workerId: worker.id,
    activeSessions,
    kvCacheBytes,
    sessionCapacityPct,
    kvCapacityPct,
    score,
  };
}

/**
 * Check if worker is within capacity thresholds.
 */
function isWithinCapacity(worker: Worker, config: SchedulerConfig): boolean {
  if (!worker.health) return false;
  return (
    worker.health.active_sessions < config.maxActiveSessions &&
    worker.health.kv_cache_bytes < config.maxKvCacheBytes
  );
}

export type SelectionRejectionReason = 'no_healthy_workers' | 'all_at_capacity';

export class WorkerSelectionError extends Error {
  constructor(
    public readonly reason: SelectionRejectionReason,
    public readonly workersChecked: number
  ) {
    super(
      reason === 'no_healthy_workers'
        ? 'No healthy workers available'
        : 'All workers at capacity'
    );
    this.name = 'WorkerSelectionError';
  }
}

/**
 * Select best worker for a request.
 *
 * Logs worker selection decision with scoring inputs.
 * Tracks rejected request metrics.
 *
 * @throws WorkerSelectionError if no healthy workers with capacity available
 */
export function selectWorker(
  requestMeta: RequestMeta,
  workers: Worker[],
  config: SchedulerConfig = DEFAULT_CONFIG
): Worker {
  const requestId = requestMeta.request_id ?? 'unknown';

  const alive = workers.filter((w) => w.health?.alive);

  if (alive.length === 0) {
    schedulerMetrics.rejectedNoWorkers++;
    console.warn(
      JSON.stringify({
        event: 'scheduler.reject',
        request_id: requestId,
        reason: 'no_healthy_workers',
        workers_total: workers.length,
        workers_alive: 0,
      })
    );
    throw new WorkerSelectionError('no_healthy_workers', workers.length);
  }

  const available = alive.filter((w) => isWithinCapacity(w, config));

  if (available.length === 0) {
    schedulerMetrics.rejectedAtCapacity++;
    console.warn(
      JSON.stringify({
        event: 'scheduler.reject',
        request_id: requestId,
        reason: 'all_at_capacity',
        workers_total: workers.length,
        workers_alive: alive.length,
        workers_available: 0,
      })
    );
    throw new WorkerSelectionError('all_at_capacity', workers.length);
  }

  const scored = available.map((w) => ({
    worker: w,
    score: scoreWorker(w, config),
  }));

  scored.sort((a, b) => a.score.score - b.score.score);

  const selected = scored[0];
  schedulerMetrics.totalSelections++;

  console.log(
    JSON.stringify({
      event: 'scheduler.select',
      request_id: requestId,
      model: requestMeta.model,
      prompt_tokens: requestMeta.prompt_tokens,
      selected_worker: selected.score.workerId,
      selected_score: selected.score.score.toFixed(2),
      selected_sessions: selected.score.activeSessions,
      selected_kv_bytes: selected.score.kvCacheBytes,
      selected_session_pct: selected.score.sessionCapacityPct.toFixed(1),
      selected_kv_pct: selected.score.kvCapacityPct.toFixed(1),
      candidates_count: available.length,
      runner_up: scored[1]
        ? {
            worker: scored[1].score.workerId,
            score: scored[1].score.score.toFixed(2),
          }
        : null,
    })
  );

  return selected.worker;
}
