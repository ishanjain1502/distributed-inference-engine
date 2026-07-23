import { Router, Request, Response } from 'express';
import { healthTable, WorkerStatus } from './healthTable';
import { getCapacityConfig, getSystemCapacityMetrics } from './capacity';

const FANOUT_TIMEOUT_MS = 500;

export interface SessionSummary {
  session_id: string;
  model: string;
  max_tokens: number;
  kv_cache_bytes: number;
  idle_ms: number;
  worker_id: string;
}

interface WorkerSessionsPayload {
  sessions: Array<{
    session_id: string;
    model: string;
    max_tokens: number;
    kv_cache_bytes: number;
    idle_ms: number;
  }>;
  active_sessions: number;
  total_kv_cache_bytes: number;
  max_sessions: number;
  max_kv_cache_bytes: number;
}

async function fetchWorkerSessions(
  workerUrl: string,
  workerId: string
): Promise<{ sessions: SessionSummary[]; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FANOUT_TIMEOUT_MS);
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/worker/sessions`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return { sessions: [], error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as WorkerSessionsPayload;
    const sessions = (data.sessions || []).map((s) => ({
      ...s,
      worker_id: workerId,
    }));
    return { sessions };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sessions: [], error: message };
  } finally {
    clearTimeout(timer);
  }
}

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const capacity = getSystemCapacityMetrics();
  const config = getCapacityConfig();
  const counts = healthTable.getCounts();
  const workers = healthTable.getAllWorkers();

  const enriched = await Promise.all(
    workers.map(async (w) => {
      const base: {
        id: string;
        url: string;
        status: WorkerStatus;
        health: typeof w.health;
        lastHeartbeat: number;
        sessions: SessionSummary[];
        sessions_error?: string;
      } = {
        id: w.id,
        url: w.url,
        status: w.status,
        health: w.health,
        lastHeartbeat: w.lastHeartbeat,
        sessions: [],
      };

      if (w.status !== WorkerStatus.ALIVE) {
        return base;
      }

      const result = await fetchWorkerSessions(w.url, w.id);
      base.sessions = result.sessions;
      if (result.error) {
        base.sessions_error = result.error;
      }
      return base;
    })
  );

  res.json({
    fetched_at: Date.now(),
    cluster: {
      alive: counts[WorkerStatus.ALIVE],
      stale: counts[WorkerStatus.STALE],
      dead: counts[WorkerStatus.DEAD],
      total_sessions: capacity.totalSessions,
      total_kv_cache_bytes: capacity.totalKvCacheBytes,
      max_total_sessions: config.maxTotalSessions,
      max_total_kv_cache_bytes: config.maxTotalKvCacheBytes,
      session_capacity_pct: capacity.sessionCapacityPct,
      kv_cache_capacity_pct: capacity.kvCacheCapacityPct,
    },
    workers: enriched,
  });
});

export default router;
