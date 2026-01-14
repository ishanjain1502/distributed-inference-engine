// Coordinator stream metrics for observability
//
// Tracks:
// - Buffer occupancy
// - Slow client detection
// - Session termination reasons
//
// Metrics:
// - coordinator.stream.buffer_fill_ratio
// - coordinator.client_write_latency_ms
// - coordinator.sessions.active
// - coordinator.sessions.terminated

export type SessionTerminationReason =
  | 'complete'
  | 'client_disconnect'
  | 'write_timeout'
  | 'worker_error'
  | 'buffer_overflow';

interface SessionInfo {
  sessionId: string;
  workerId: string;
  startTime: number;
  tokensReceived: number;
  tokensWritten: number;
  lastWriteLatencyMs: number;
  peakBufferSize: number;
}

interface StreamMetricsState {
  activeSessions: Map<string, SessionInfo>;
  terminatedByReason: Record<SessionTerminationReason, number>;
  totalBufferOverflows: number;
  peakBufferFillRatio: number;
  writeLatencySumMs: number;
  writeLatencyCount: number;
  slowClientCount: number;
}

const state: StreamMetricsState = {
  activeSessions: new Map(),
  terminatedByReason: {
    complete: 0,
    client_disconnect: 0,
    write_timeout: 0,
    worker_error: 0,
    buffer_overflow: 0,
  },
  totalBufferOverflows: 0,
  peakBufferFillRatio: 0,
  writeLatencySumMs: 0,
  writeLatencyCount: 0,
  slowClientCount: 0,
};

const SLOW_CLIENT_THRESHOLD_MS = 1000;

export const streamMetrics = {
  /**
   * Start tracking a new streaming session
   */
  sessionStart(sessionId: string, workerId: string): void {
    state.activeSessions.set(sessionId, {
      sessionId,
      workerId,
      startTime: Date.now(),
      tokensReceived: 0,
      tokensWritten: 0,
      lastWriteLatencyMs: 0,
      peakBufferSize: 0,
    });

    console.log(
      JSON.stringify({
        event: 'stream.session_start',
        session_id: sessionId,
        worker_id: workerId,
        active_sessions: state.activeSessions.size,
      })
    );
  },

  /**
   * Record a token received from worker
   */
  tokenReceived(sessionId: string): void {
    const session = state.activeSessions.get(sessionId);
    if (session) {
      session.tokensReceived++;
    }
  },

  /**
   * Record a token written to client with latency
   */
  tokenWritten(sessionId: string, writeLatencyMs: number): void {
    const session = state.activeSessions.get(sessionId);
    if (session) {
      session.tokensWritten++;
      session.lastWriteLatencyMs = writeLatencyMs;
    }

    state.writeLatencySumMs += writeLatencyMs;
    state.writeLatencyCount++;

    if (writeLatencyMs > SLOW_CLIENT_THRESHOLD_MS) {
      state.slowClientCount++;
      console.warn(
        JSON.stringify({
          event: 'stream.slow_client',
          session_id: sessionId,
          write_latency_ms: writeLatencyMs,
          threshold_ms: SLOW_CLIENT_THRESHOLD_MS,
        })
      );
    }
  },

  /**
   * Update buffer occupancy for a session
   */
  updateBufferOccupancy(
    sessionId: string,
    currentSize: number,
    maxSize: number
  ): void {
    const session = state.activeSessions.get(sessionId);
    if (session && currentSize > session.peakBufferSize) {
      session.peakBufferSize = currentSize;
    }

    const fillRatio = currentSize / maxSize;
    if (fillRatio > state.peakBufferFillRatio) {
      state.peakBufferFillRatio = fillRatio;
    }

    if (fillRatio > 0.8) {
      console.warn(
        JSON.stringify({
          event: 'stream.buffer_high',
          session_id: sessionId,
          current_size: currentSize,
          max_size: maxSize,
          fill_ratio: fillRatio.toFixed(2),
        })
      );
    }
  },

  /**
   * Record buffer overflow (token dropped)
   */
  bufferOverflow(sessionId: string, droppedSeq: number): void {
    state.totalBufferOverflows++;
    console.warn(
      JSON.stringify({
        event: 'stream.buffer_overflow',
        session_id: sessionId,
        dropped_seq: droppedSeq,
        total_overflows: state.totalBufferOverflows,
      })
    );
  },

  /**
   * End a streaming session with reason
   */
  sessionEnd(sessionId: string, reason: SessionTerminationReason): void {
    const session = state.activeSessions.get(sessionId);

    state.terminatedByReason[reason]++;
    state.activeSessions.delete(sessionId);

    const duration = session ? Date.now() - session.startTime : 0;

    console.log(
      JSON.stringify({
        event: 'stream.session_end',
        session_id: sessionId,
        reason,
        duration_ms: duration,
        tokens_received: session?.tokensReceived ?? 0,
        tokens_written: session?.tokensWritten ?? 0,
        peak_buffer_size: session?.peakBufferSize ?? 0,
        active_sessions: state.activeSessions.size,
      })
    );
  },

  /**
   * Get current metrics snapshot
   */
  getMetrics() {
    const avgWriteLatency =
      state.writeLatencyCount > 0
        ? state.writeLatencySumMs / state.writeLatencyCount
        : 0;

    return {
      activeSessions: state.activeSessions.size,
      terminatedByReason: { ...state.terminatedByReason },
      totalTerminated: Object.values(state.terminatedByReason).reduce(
        (a, b) => a + b,
        0
      ),
      bufferOverflows: state.totalBufferOverflows,
      peakBufferFillRatio: state.peakBufferFillRatio,
      avgWriteLatencyMs: avgWriteLatency,
      slowClientCount: state.slowClientCount,
    };
  },

  /**
   * Emit metrics as log line
   */
  emitMetricsLog(): void {
    const metrics = this.getMetrics();
    console.log(
      JSON.stringify({
        event: 'coordinator.metrics',
        ...metrics,
      })
    );
  },
};