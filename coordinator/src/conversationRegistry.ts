import { sessionTracker } from './sessionTracker';

export const CONVERSATION_IDLE_TTL_MS = 300_000;

export interface ConversationEntry {
  sessionId: string;
  workerId: string;
  approxTokens: number;
  lastActiveMs: number;
  model: string;
}

export class ConversationRegistry {
  private entries = new Map<string, ConversationEntry>();
  private tails = new Map<string, Promise<void>>();

  private isExpired(entry: ConversationEntry, now: number): boolean {
    return now - entry.lastActiveMs > CONVERSATION_IDLE_TTL_MS;
  }

  get(conversationId: string): ConversationEntry | undefined {
    const entry = this.entries.get(conversationId);
    if (!entry) return undefined;
    if (this.isExpired(entry, Date.now())) {
      this.entries.delete(conversationId);
      // Caller never round-trips through sweepExpired() for this id since
      // it's already been removed here, so end tracker accounting now to
      // avoid a capacity leak.
      sessionTracker.sessionEnd(entry.sessionId);
      return undefined;
    }
    return entry;
  }

  /**
   * Remove all idle-expired entries and end their tracked sessions.
   * Handles conversation_ids that are abandoned outright (never queried
   * again via get()), which would otherwise never be swept and would leak
   * sessionTracker capacity accounting indefinitely. Intended to be called
   * periodically (e.g. from a setInterval in server.ts).
   */
  sweepExpired(now: number = Date.now()): ConversationEntry[] {
    const expired: ConversationEntry[] = [];
    for (const [id, entry] of this.entries) {
      if (this.isExpired(entry, now)) {
        expired.push(entry);
        this.entries.delete(id);
      }
    }
    for (const entry of expired) {
      sessionTracker.sessionEnd(entry.sessionId);
    }
    return expired;
  }

  set(conversationId: string, entry: ConversationEntry): void {
    this.entries.set(conversationId, { ...entry });
  }

  touch(conversationId: string, approxTokens?: number): void {
    const entry = this.entries.get(conversationId);
    if (!entry) return;
    entry.lastActiveMs = Date.now();
    if (typeof approxTokens === 'number') {
      entry.approxTokens = approxTokens;
    }
  }

  delete(conversationId: string): void {
    this.entries.delete(conversationId);
  }

  clear(): void {
    this.entries.clear();
    this.tails.clear();
  }

  /** @internal test-only inspection */
  hasTail(conversationId: string): boolean {
    return this.tails.has(conversationId);
  }

  acquire(conversationId: string): Promise<() => void> {
    const prev = this.tails.get(conversationId) ?? Promise.resolve();
    let releasePrev!: () => void;
    const gate = new Promise<void>((resolve) => {
      releasePrev = resolve;
    });
    const tail = prev.then(() => gate);
    this.tails.set(conversationId, tail);
    tail.finally(() => {
      if (this.tails.get(conversationId) === tail) {
        this.tails.delete(conversationId);
      }
    });

    return prev.then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releasePrev();
      };
    });
  }
}

export const conversationRegistry = new ConversationRegistry();
