// Tracks coordinator-side in-flight decode streams for CPU-aware admission.
//
// A decode is counted from successful worker /decode handshake until the
// coordinator finishes forwarding tokens (or the stream errors out).

export interface DecodeAdmissionConfig {
  maxTotalInFlightDecodes: number;
  maxInFlightDecodesPerWorker: number;
}

function parsePositiveInt(env: string | undefined, defaultValue: number): number {
  if (!env) return defaultValue;
  const n = parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

export function getDecodeAdmissionConfig(): Readonly<DecodeAdmissionConfig> {
  return {
    maxTotalInFlightDecodes: parsePositiveInt(process.env.MAX_IN_FLIGHT_DECODES, 32),
    maxInFlightDecodesPerWorker: parsePositiveInt(
      process.env.MAX_IN_FLIGHT_DECODES_PER_WORKER,
      4
    ),
  };
}

export type DecodeAdmissionReason =
  | 'system_in_flight_decode_full'
  | 'worker_in_flight_decode_full'
  | 'all_workers_decode_busy';

export type DecodeAdmissionResult =
  | { canAccept: true }
  | { canAccept: false; reason: DecodeAdmissionReason };

class DecodeTracker {
  /** sessionId -> workerId for active decode streams */
  private sessions = new Map<string, string>();
  private workerCounts = new Map<string, number>();
  private total = 0;

  decodeStart(sessionId: string, workerId: string): void {
    if (this.sessions.has(sessionId)) {
      return;
    }
    this.sessions.set(sessionId, workerId);
    this.total++;
    this.workerCounts.set(workerId, (this.workerCounts.get(workerId) ?? 0) + 1);
  }

  decodeEnd(sessionId: string): void {
    const workerId = this.sessions.get(sessionId);
    if (!workerId) {
      return;
    }
    this.sessions.delete(sessionId);
    this.total = Math.max(0, this.total - 1);
    const next = (this.workerCounts.get(workerId) ?? 1) - 1;
    if (next <= 0) {
      this.workerCounts.delete(workerId);
    } else {
      this.workerCounts.set(workerId, next);
    }
  }

  getTotal(): number {
    return this.total;
  }

  getWorkerCount(workerId: string): number {
    return this.workerCounts.get(workerId) ?? 0;
  }

  workerHasCapacity(workerId: string, config: DecodeAdmissionConfig = getDecodeAdmissionConfig()): boolean {
    return this.getWorkerCount(workerId) < config.maxInFlightDecodesPerWorker;
  }

  anyWorkerHasCapacity(
    workerIds: string[],
    config: DecodeAdmissionConfig = getDecodeAdmissionConfig()
  ): boolean {
    return workerIds.some((id) => this.workerHasCapacity(id, config));
  }

  canAccept(workerId?: string): DecodeAdmissionResult {
    const config = getDecodeAdmissionConfig();

    if (this.total >= config.maxTotalInFlightDecodes) {
      return { canAccept: false, reason: 'system_in_flight_decode_full' };
    }

    if (workerId !== undefined && !this.workerHasCapacity(workerId, config)) {
      return { canAccept: false, reason: 'worker_in_flight_decode_full' };
    }

    return { canAccept: true };
  }

  canAcceptOnAnyWorker(workerIds: string[]): DecodeAdmissionResult {
    const systemCheck = this.canAccept();
    if (!systemCheck.canAccept) {
      return systemCheck;
    }

    if (workerIds.length === 0 || !this.anyWorkerHasCapacity(workerIds)) {
      return { canAccept: false, reason: 'all_workers_decode_busy' };
    }

    return { canAccept: true };
  }

  getSummary(): {
    total: number;
    perWorker: Record<string, number>;
    config: DecodeAdmissionConfig;
  } {
    const config = getDecodeAdmissionConfig();
    const perWorker: Record<string, number> = {};
    for (const [workerId, count] of this.workerCounts.entries()) {
      perWorker[workerId] = count;
    }
    return {
      total: this.total,
      perWorker,
      config,
    };
  }

  clear(): void {
    this.sessions.clear();
    this.workerCounts.clear();
    this.total = 0;
  }
}

export const decodeTracker = new DecodeTracker();
