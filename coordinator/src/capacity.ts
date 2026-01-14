// System-wide capacity tracking and admission control
//
// Tracks:
// - Total active sessions across all workers
// - Total KV cache bytes across all workers
//
// Provides:
// - Early rejection when system is full - O(1) checks
// - Capacity metrics for monitoring
//
// Uses pre-computed aggregates from HealthTable (updated on heartbeat)
// and SessionTracker (updated immediately when sessions end).

import { healthTable } from './healthTable';
import { sessionTracker } from './sessionTracker';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface SystemCapacityConfig {
  /** Maximum total sessions across all workers */
  maxTotalSessions: number;
  /** Maximum total KV cache bytes across all workers */
  maxTotalKvCacheBytes: number;
  /** Per-worker session limit (for scheduling) */
  maxSessionsPerWorker: number;
  /** Per-worker KV cache limit (for scheduling) */
  maxKvCacheBytesPerWorker: number;
}

const DEFAULT_CAPACITY_CONFIG: SystemCapacityConfig = {
  maxTotalSessions: 1000,
  maxTotalKvCacheBytes: 64 * 1024 * 1024 * 1024, // 64 GB total
  maxSessionsPerWorker: 100,
  maxKvCacheBytesPerWorker: 8 * 1024 * 1024 * 1024, // 8 GB per worker
};

let capacityConfig = { ...DEFAULT_CAPACITY_CONFIG };

/** Update capacity configuration */
export function setCapacityConfig(config: Partial<SystemCapacityConfig>): void {
  capacityConfig = { ...capacityConfig, ...config };
}

/** Get current capacity configuration */
export function getCapacityConfig(): Readonly<SystemCapacityConfig> {
  return { ...capacityConfig };
}

// ─────────────────────────────────────────────────────────────────────────────
// System-wide Metrics
// ─────────────────────────────────────────────────────────────────────────────

export interface SystemCapacityMetrics {
  totalSessions: number;
  totalKvCacheBytes: number;
  totalWorkers: number;
  aliveWorkers: number;
  sessionCapacityPct: number;
  kvCacheCapacityPct: number;
  // In-flight sessions tracked by coordinator (more up-to-date than heartbeat)
  inFlightSessions: number;
  inFlightKvBytes: number;
}

/**
 * Get current system-wide capacity metrics - O(1) operation.
 * Uses pre-computed aggregates from HealthTable + SessionTracker.
 */
export function getSystemCapacityMetrics(): SystemCapacityMetrics {
  // O(1) lookup from pre-computed aggregates
  const aggregates = healthTable.getAggregates();
  const inFlight = sessionTracker.getSummary();

  // Use the higher of heartbeat data or in-flight tracking
  // (heartbeat might lag behind actual state)
  const totalSessions = Math.max(aggregates.totalSessions, inFlight.activeCount);
  const totalKvCacheBytes = Math.max(
    aggregates.totalKvCacheBytes,
    inFlight.totalEstimatedKvBytes
  );

  return {
    totalSessions,
    totalKvCacheBytes,
    totalWorkers: healthTable.size,
    aliveWorkers: aggregates.aliveWorkerCount,
    sessionCapacityPct:
      (totalSessions / capacityConfig.maxTotalSessions) * 100,
    kvCacheCapacityPct:
      (totalKvCacheBytes / capacityConfig.maxTotalKvCacheBytes) * 100,
    inFlightSessions: inFlight.activeCount,
    inFlightKvBytes: inFlight.totalEstimatedKvBytes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admission Control
// ─────────────────────────────────────────────────────────────────────────────

export type RejectionReason =
  | 'no_workers'
  | 'system_sessions_full'
  | 'system_kv_cache_full'
  | 'all_workers_at_capacity';

export interface AdmissionDecision {
  canAccept: boolean;
  reason?: RejectionReason;
  metrics: SystemCapacityMetrics;
}

/**
 * Check if the system can accept a new request.
 * This is a fast early-rejection check before scheduling.
 *
 * @param estimatedKvBytes - Optional estimated KV cache for this request
 */
export function canAcceptRequest(
  estimatedKvBytes: number = 0
): AdmissionDecision {
  const metrics = getSystemCapacityMetrics();

  // No workers available
  if (metrics.aliveWorkers === 0) {
    console.warn(
      JSON.stringify({
        event: 'admission.reject',
        reason: 'no_workers',
        alive_workers: 0,
        total_workers: metrics.totalWorkers,
      })
    );
    return { canAccept: false, reason: 'no_workers', metrics };
  }

  // System-wide session limit
  if (metrics.totalSessions >= capacityConfig.maxTotalSessions) {
    console.warn(
      JSON.stringify({
        event: 'admission.reject',
        reason: 'system_sessions_full',
        total_sessions: metrics.totalSessions,
        max_sessions: capacityConfig.maxTotalSessions,
      })
    );
    return { canAccept: false, reason: 'system_sessions_full', metrics };
  }

  // System-wide KV cache limit (with estimated addition)
  const projectedKvCache = metrics.totalKvCacheBytes + estimatedKvBytes;
  if (projectedKvCache >= capacityConfig.maxTotalKvCacheBytes) {
    console.warn(
      JSON.stringify({
        event: 'admission.reject',
        reason: 'system_kv_cache_full',
        total_kv_bytes: metrics.totalKvCacheBytes,
        estimated_addition: estimatedKvBytes,
        max_kv_bytes: capacityConfig.maxTotalKvCacheBytes,
      })
    );
    return { canAccept: false, reason: 'system_kv_cache_full', metrics };
  }

  return { canAccept: true, metrics };
}

/**
 * Emit system capacity metrics as a log line
 */
export function emitCapacityMetricsLog(): void {
  const metrics = getSystemCapacityMetrics();
  console.log(
    JSON.stringify({
      event: 'system.capacity',
      total_sessions: metrics.totalSessions,
      total_kv_bytes: metrics.totalKvCacheBytes,
      total_workers: metrics.totalWorkers,
      alive_workers: metrics.aliveWorkers,
      session_capacity_pct: metrics.sessionCapacityPct.toFixed(1),
      kv_cache_capacity_pct: metrics.kvCacheCapacityPct.toFixed(1),
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rejection Tracking
// ─────────────────────────────────────────────────────────────────────────────

interface AdmissionMetrics {
  acceptedRequests: number;
  rejectedNoWorkers: number;
  rejectedSessionsFull: number;
  rejectedKvCacheFull: number;
}

const admissionMetrics: AdmissionMetrics = {
  acceptedRequests: 0,
  rejectedNoWorkers: 0,
  rejectedSessionsFull: 0,
  rejectedKvCacheFull: 0,
};

/** Record an admission decision */
export function recordAdmissionDecision(decision: AdmissionDecision): void {
  if (decision.canAccept) {
    admissionMetrics.acceptedRequests++;
  } else {
    switch (decision.reason) {
      case 'no_workers':
        admissionMetrics.rejectedNoWorkers++;
        break;
      case 'system_sessions_full':
        admissionMetrics.rejectedSessionsFull++;
        break;
      case 'system_kv_cache_full':
        admissionMetrics.rejectedKvCacheFull++;
        break;
    }
  }
}

/** Get admission metrics */
export function getAdmissionMetrics(): Readonly<AdmissionMetrics> {
  return { ...admissionMetrics };
}

/** Reset admission metrics (for testing) */
export function resetAdmissionMetrics(): void {
  admissionMetrics.acceptedRequests = 0;
  admissionMetrics.rejectedNoWorkers = 0;
  admissionMetrics.rejectedSessionsFull = 0;
  admissionMetrics.rejectedKvCacheFull = 0;
}
