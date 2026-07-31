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

  get(conversationId: string): ConversationEntry | undefined {
    const entry = this.entries.get(conversationId);
    if (!entry) return undefined;
    if (Date.now() - entry.lastActiveMs > CONVERSATION_IDLE_TTL_MS) {
      this.entries.delete(conversationId);
      return undefined;
    }
    return entry;
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
