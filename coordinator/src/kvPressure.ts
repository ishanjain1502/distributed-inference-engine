import { conversationRegistry } from './conversationRegistry';

export interface CompactionCandidate {
  conversationId: string;
  approxTokens: number;
  model: string;
}

/** Pick conversations with the largest approx token counts for KV pressure relief. */
export function pickSessionsToCompact(limit: number): CompactionCandidate[] {
  const candidates = conversationRegistry
    .entriesForCompaction()
    .sort((a, b) => b.approxTokens - a.approxTokens);
  return candidates.slice(0, limit);
}
