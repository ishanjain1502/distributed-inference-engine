// HealthTable - Centralized worker health tracking
//
// Soft state: rebuilt from heartbeats after coordinator restart
// No persistence needed - workers re-announce themselves

import { Worker, WorkerHealth } from './types';

export enum WorkerStatus {
  ALIVE = 'alive',     // Heartbeat within timeout
  STALE = 'stale',     // No recent heartbeat, may be recovering
  DEAD = 'dead',       // Exceeded timeout, considered unavailable
}

export interface WorkerEntry {
  id: string;
  url: string;
  health: WorkerHealth;
  lastHeartbeat: number;  // Unix ms
  status: WorkerStatus;
}

export interface HeartbeatPayload {
  worker_id: string;
  worker_url: string;     // Worker's reachable URL
  timestamp: number;      // Unix ms
  health: WorkerHealth;
}

// Configuration
const CONFIG = {
  HEARTBEAT_STALENESS_MS: 30_000,  // Reject heartbeats older than 30s
  STALE_THRESHOLD_MS: 30_000,      // Mark stale after 30s without heartbeat
  DEAD_THRESHOLD_MS: 60_000,       // Mark dead after 60s without heartbeat
  CLEANUP_INTERVAL_MS: 60_000,     // Run cleanup every 60s
};

/**
 * HealthTable - Single source of truth for worker health
 * 
 * Used by scheduler to get available workers.
 * Updated by heartbeat ingestion.
 */
class HealthTable {
  private workers = new Map<string, WorkerEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Validate heartbeat timestamp (clock drift protection)
   */
  private isValidTimestamp(heartbeatTs: number, nowTs: number): boolean {
    const drift = nowTs - heartbeatTs;
    // Reject if too old or from the future (clock skew > 5s)
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
   * Ingest a heartbeat from a worker
   */
  ingest(
    payload: HeartbeatPayload,
    nowTs: number = Date.now()
  ): { success: boolean; error?: string } {
    // Validate timestamp
    if (!this.isValidTimestamp(payload.timestamp, nowTs)) {
      return { success: false, error: 'Stale or invalid timestamp' };
    }

    // Validate required fields
    if (!payload.worker_id || !payload.worker_url || !payload.health) {
      return { success: false, error: 'Missing required fields' };
    }

    // Update or insert worker entry
    this.workers.set(payload.worker_id, {
      id: payload.worker_id,
      url: payload.worker_url,
      health: payload.health,
      lastHeartbeat: nowTs,
      status: WorkerStatus.ALIVE,
    });

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
      
      // Only include alive workers for scheduling
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
   * Remove dead workers from the table
   */
  cleanup(nowTs: number = Date.now()): number {
    let removed = 0;

    for (const [id, entry] of this.workers.entries()) {
      if (this.computeStatus(entry.lastHeartbeat, nowTs) === WorkerStatus.DEAD) {
        this.workers.delete(id);
        removed++;
      }
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
  }

  /**
   * Get worker count
   */
  get size(): number {
    return this.workers.size;
  }
}

// Singleton instance
export const healthTable = new HealthTable();

