let compactionsTotal = 0;
let compactionFailuresTotal = 0;

export function recordCompactionSuccess(trigger: string, latencyMs: number): void {
  compactionsTotal += 1;
  console.info(
    JSON.stringify({ event: 'compaction.success', trigger, latency_ms: latencyMs })
  );
}

export function recordCompactionFailure(trigger: string, reason: string): void {
  compactionFailuresTotal += 1;
  console.warn(JSON.stringify({ event: 'compaction.failure', trigger, reason }));
}

export function getCompactionMetrics(): { compactionsTotal: number; compactionFailuresTotal: number } {
  return { compactionsTotal, compactionFailuresTotal };
}

/** @internal test reset */
export function resetCompactionMetrics(): void {
  compactionsTotal = 0;
  compactionFailuresTotal = 0;
}
