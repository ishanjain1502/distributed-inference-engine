import { Worker, WorkerHealth } from './types';

export enum WorkerStatus {
  ALIVE = 'alive',
  STALE = 'stale',
  DEAD = 'dead',
}

export interface WorkerEntry {
  id: string;
  url: string;
  health: WorkerHealth;
  lastHeartbeat: number;
  status: WorkerStatus;
}

export interface HeartbeatPayload {
  worker_id: string;
  worker_url: string;
  timestamp: number;
  health: WorkerHealth;
}

const CONFIG = {
  HEARTBEAT_STALENESS_MS: 30_000,
  STALE_THRESHOLD_MS: 30_000,
  DEAD_THRESHOLD_MS: 60_000,
  CLEANUP_INTERVAL_MS: 60_000,
};

/**
 * Pre-computed aggregates for O(1) capacity checks.
 * Updated on heartbeat ingestion, not on every request.
 */
export interface ClusterAggregates {
  totalSessions: number;
  totalKvCacheBytes: number;
  aliveWorkerCount: number;
}

/**
 * HealthTable - Single source of truth for worker health
 * 
 * Used by scheduler to get available workers.
 * Updated by heartbeat ingestion.
 * 
 * Maintains pre-computed aggregates for O(1) admission control.
 */
class HealthTable {
  private workers = new Map<string, WorkerEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  // Pre-computed aggregates - updated on heartbeat, O(1) access
  private aggregates: ClusterAggregates = {
    totalSessions: 0,
    totalKvCacheBytes: 0,
    aliveWorkerCount: 0,
  };

  constructor() {
    this.startCleanup();
  }

  /**
   * Get pre-computed cluster aggregates - O(1)
   */
  getAggregates(): Readonly<ClusterAggregates> {
    return { ...this.aggregates };
  }

  /**
   * Validate heartbeat timestamp (clock drift protection)
   */
  private isValidTimestamp(heartbeatTs: number, nowTs: number): boolean {
    const drift = nowTs - heartbeatTs;
    return drift >= -5000 && drift <= CONFIG.HEARTBEAT_STALENESS_MS;
  }

  /**
   * Compute worker status based on last heartbeat
   */
  private computeStatus(lastHeartbeat: number, nowTs: number): WorkerStatus {
    const age = nowTs - lastHeartbeat;
    if (age < CONFIG.STALE_THRESHOLD_MS) return WorkerStatus.ALIVE;
    if (age < CONFIG.DEAD_THRESHOLD_MS) return WorkerStatus.STALE;
    return WorkerStatus.DEAD;
  }

  /**
   * Recompute aggregates from current worker state.
   * Called after any mutation to workers map.
   */
  private recomputeAggregates(nowTs: number = Date.now()): void {
    let totalSessions = 0;
    let totalKvCacheBytes = 0;
    let aliveWorkerCount = 0;

    for (const entry of this.workers.values()) {
      const status = this.computeStatus(entry.lastHeartbeat, nowTs);
      if (status === WorkerStatus.ALIVE) {
        aliveWorkerCount++;
        totalSessions += entry.health.active_sessions;
        totalKvCacheBytes += entry.health.kv_cache_bytes;
      }
    }

    this.aggregates = { totalSessions, totalKvCacheBytes, aliveWorkerCount };
  }

  /**
   * Ingest a heartbeat from a worker.
   * Updates pre-computed aggregates for O(1) capacity checks.
   */
  ingest(
    payload: HeartbeatPayload,
    nowTs: number = Date.now()
  ): { success: boolean; error?: string } {
    if (!this.isValidTimestamp(payload.timestamp, nowTs)) {
      return { success: false, error: 'Stale or invalid timestamp' };
    }

    if (!payload.worker_id || !payload.worker_url || !payload.health) {
      return { success: false, error: 'Missing required fields' };
    }

    this.workers.set(payload.worker_id, {
      id: payload.worker_id,
      url: payload.worker_url,
      health: payload.health,
      lastHeartbeat: nowTs,
      status: WorkerStatus.ALIVE,
    });

    // Recompute aggregates after update
    this.recomputeAggregates(nowTs);

    return { success: true };
  }

  /**
   * Get all workers suitable for scheduling
   * Returns Worker[] format compatible with scheduler
   */
  getWorkersForScheduler(nowTs: number = Date.now()): Worker[] {
    const result: Worker[] = [];

    for (const entry of this.workers.values()) {
      const status = this.computeStatus(entry.lastHeartbeat, nowTs);

      if (status === WorkerStatus.ALIVE) {
        result.push({
          id: entry.id,
          url: entry.url,
          health: entry.health,
        });
      }
    }

    return result;
  }

  /**
   * Get all worker entries with status (for monitoring)
   */
  getAllWorkers(nowTs: number = Date.now()): WorkerEntry[] {
    const result: WorkerEntry[] = [];

    for (const entry of this.workers.values()) {
      const status = this.computeStatus(entry.lastHeartbeat, nowTs);
      result.push({ ...entry, status });
    }

    return result;
  }

  /**
   * Get counts by status (for metrics)
   */
  getCounts(nowTs: number = Date.now()): Record<WorkerStatus, number> {
    const counts = {
      [WorkerStatus.ALIVE]: 0,
      [WorkerStatus.STALE]: 0,
      [WorkerStatus.DEAD]: 0,
    };

    for (const entry of this.workers.values()) {
      const status = this.computeStatus(entry.lastHeartbeat, nowTs);
      counts[status]++;
    }

    return counts;
  }

  /**
   * Remove dead workers from the table.
   * Recomputes aggregates after removal.
   */
  cleanup(nowTs: number = Date.now()): number {
    let removed = 0;

    for (const [id, entry] of this.workers.entries()) {
      if (this.computeStatus(entry.lastHeartbeat, nowTs) === WorkerStatus.DEAD) {
        this.workers.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.recomputeAggregates(nowTs);
    }

    return removed;
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const removed = this.cleanup();
      if (removed > 0) {
        console.log(`[HealthTable] Cleaned up ${removed} dead workers`);
      }
    }, CONFIG.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop cleanup (for testing)
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clear all workers (for testing)
   */
  clear(): void {
    this.workers.clear();
    this.aggregates = { totalSessions: 0, totalKvCacheBytes: 0, aliveWorkerCount: 0 };
  }

  /**
   * Get worker count
   */
  get size(): number {
    return this.workers.size;
  }
}

export const healthTable = new HealthTable();