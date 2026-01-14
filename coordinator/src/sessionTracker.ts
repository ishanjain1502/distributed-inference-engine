// Coordinator-side session tracking for immediate capacity updates
//
// Tracks active sessions to provide O(1) capacity adjustments when sessions end,
// rather than waiting for the next worker heartbeat (10s delay).
//
// This complements the HealthTable aggregates by providing real-time updates.

export interface TrackedSession {
  sessionId: string;
  workerId: string;
  estimatedKvBytes: number;
  startTime: number;
}

/**
 * SessionTracker - Tracks active sessions for immediate capacity updates
 *
 * When a session starts, we record estimated KV bytes.
 * When a session ends, we immediately update capacity counters.
 * This provides real-time capacity awareness between heartbeats.
 */
class SessionTracker {
  private sessions = new Map<string, TrackedSession>();

  // Running counters for O(1) capacity checks
  private _activeCount = 0;
  private _totalEstimatedKvBytes = 0;

  /**
   * Record a new session starting.
   * Called after successful prefill.
   */
  sessionStart(sessionId: string, workerId: string, estimatedKvBytes: number): void {
    if (this.sessions.has(sessionId)) {
      // Session already tracked (shouldn't happen, but be safe)
      return;
    }

    this.sessions.set(sessionId, {
      sessionId,
      workerId,
      estimatedKvBytes,
      startTime: Date.now(),
    });

    this._activeCount++;
    this._totalEstimatedKvBytes += estimatedKvBytes;
  }

  /**
   * Record a session ending.
   * Called when streaming completes, errors, or client disconnects.
   * Immediately updates capacity counters.
   */
  sessionEnd(sessionId: string): TrackedSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    this.sessions.delete(sessionId);
    this._activeCount--;
    this._totalEstimatedKvBytes -= session.estimatedKvBytes;

    return session;
  }

  /**
   * Get active session count - O(1)
   */
  get activeCount(): number {
    return this._activeCount;
  }

  /**
   * Get total estimated KV bytes across active sessions - O(1)
   */
  get totalEstimatedKvBytes(): number {
    return this._totalEstimatedKvBytes;
  }

  /**
   * Check if a session is being tracked
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): TrackedSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions for a worker (for debugging/monitoring)
   */
  getSessionsForWorker(workerId: string): TrackedSession[] {
    const result: TrackedSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.workerId === workerId) {
        result.push(session);
      }
    }
    return result;
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear();
    this._activeCount = 0;
    this._totalEstimatedKvBytes = 0;
  }

  /**
   * Get summary for logging
   */
  getSummary(): { activeCount: number; totalEstimatedKvBytes: number } {
    return {
      activeCount: this._activeCount,
      totalEstimatedKvBytes: this._totalEstimatedKvBytes,
    };
  }
}

export const sessionTracker = new SessionTracker();
