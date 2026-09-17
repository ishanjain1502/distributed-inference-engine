export type TranscriptRole = 'user' | 'assistant';

export interface TranscriptTurn {
  role: TranscriptRole;
  content: string;
  ts: number;
}

export const MAX_CONTEXT_TOKENS = 2048;
export const PROACTIVE_THRESHOLD_PCT = 0.8;
export const PROACTIVE_THRESHOLD_TOKENS = Math.floor(MAX_CONTEXT_TOKENS * PROACTIVE_THRESHOLD_PCT);
export const VERBATIM_TAIL_TURNS = 2;
export const SUMMARY_MAX_TOKENS = 384;
export const COMPACTION_DEBOUNCE_MS = 30_000;
export const SYSTEM_KV_COMPACT_BATCH = 3;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 4));
}

export function shouldCompactProactively(approxTokens: number): boolean {
  return approxTokens >= PROACTIVE_THRESHOLD_TOKENS;
}

export function formatTurn(turn: TranscriptTurn): string {
  const label = turn.role === 'user' ? 'User' : 'Assistant';
  return `${label}: ${turn.content}`;
}

export function splitTranscript(
  turns: TranscriptTurn[],
  tailTurns: number = VERBATIM_TAIL_TURNS
): { head: TranscriptTurn[]; tail: TranscriptTurn[] } {
  if (turns.length <= tailTurns) {
    return { head: [], tail: [...turns] };
  }
  const splitAt = turns.length - tailTurns;
  return { head: turns.slice(0, splitAt), tail: turns.slice(splitAt) };
}

export function buildSummaryPrompt(head: TranscriptTurn[]): string {
  const body = head.map(formatTurn).join('\n');
  return (
    'Summarize the following conversation for continuation. ' +
    'Preserve facts, names, decisions, and open questions. Be concise.\n\n' +
    body +
    '\n\nSummary:'
  );
}

export function buildCompactionPrefill(summary: string, tail: TranscriptTurn[]): string {
  const parts: string[] = [];
  const trimmed = summary.trim();
  if (trimmed) {
    parts.push('[CONVERSATION SUMMARY]', trimmed, '');
  }
  parts.push('[RECENT MESSAGES]');
  parts.push(...tail.map(formatTurn));
  return parts.join('\n');
}

export function truncatePrefillToFit(prefill: string, maxTokens: number): string | null {
  if (estimateTokens(prefill) <= maxTokens) return prefill;
  const tailOnly = prefill.includes('[RECENT MESSAGES]')
    ? prefill.slice(prefill.indexOf('[RECENT MESSAGES]'))
    : prefill;
  if (estimateTokens(tailOnly) <= maxTokens) return tailOnly;
  return null;
}
