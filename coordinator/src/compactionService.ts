import { v4 as uuidv4 } from 'uuid';
import {
  buildCompactionPrefill,
  buildSummaryPrompt,
  estimateTokens,
  MAX_CONTEXT_TOKENS,
  splitTranscript,
  SUMMARY_MAX_TOKENS,
  TranscriptTurn,
  truncatePrefillToFit,
  COMPACTION_DEBOUNCE_MS,
} from './compactionPolicy';
import { conversationRegistry } from './conversationRegistry';
import { healthTable } from './healthTable';
import { selectWorker, RequestMeta, WorkerSelectionError } from './scheduler';
import { sessionTracker } from './sessionTracker';
import { transcriptStore, TranscriptStore } from './transcriptStore';
import {
  deleteWorkerSession,
  runInternalDecode,
  tryPrefill,
} from './workerClient';
import { recordCompactionFailure, recordCompactionSuccess } from './compactionMetrics';
import { Worker } from './types';

export type CompactionTrigger =
  | 'proactive'
  | 'session_full'
  | 'session_gone'
  | 'worker_drain'
  | 'system_kv_pressure';

export type CompactionResult =
  | { ok: true; sessionId: string; workerId: string }
  | { ok: false; reason: string };

const lastCompactMsByConversation = new Map<string, number>();

export function shouldDebounce(conversationId: string, nowMs: number = Date.now()): boolean {
  const last = lastCompactMsByConversation.get(conversationId);
  if (last === undefined) return false;
  return nowMs - last < COMPACTION_DEBOUNCE_MS;
}

function peelInflightUserTurn(
  turns: TranscriptTurn[],
  incomingPrompt?: string
): TranscriptTurn[] {
  if (!incomingPrompt || turns.length === 0) return turns;
  const last = turns[turns.length - 1];
  if (last.role === 'user' && last.content === incomingPrompt) {
    return turns.slice(0, -1);
  }
  return turns;
}

export function buildPostCompactionTranscript(
  summary: string,
  tail: TranscriptTurn[]
): TranscriptTurn[] {
  const now = Date.now();
  const turns: TranscriptTurn[] = [];
  const trimmed = summary.trim();
  if (trimmed) {
    turns.push({ role: 'assistant', content: `[Summary] ${trimmed}`, ts: now });
  }
  turns.push(...tail);
  return turns;
}

export interface CompactOptions {
  transcriptStore?: TranscriptStore;
  incomingPrompt?: string;
  excludeWorkerId?: string;
}

async function pickWorker(model: string, excludeWorkerId?: string): Promise<Worker | null> {
  const workers = healthTable
    .getWorkersForScheduler()
    .filter((w) => w.health?.alive && !w.health?.draining)
    .filter((w) => w.id !== excludeWorkerId);
  if (workers.length === 0) return null;
  try {
    return selectWorker({ model }, workers);
  } catch (err) {
    if (err instanceof WorkerSelectionError) return null;
    throw err;
  }
}

export async function compact(
  conversationId: string,
  trigger: CompactionTrigger,
  model: string,
  options: CompactOptions = {}
): Promise<CompactionResult> {
  const store = options.transcriptStore ?? transcriptStore;
  const started = Date.now();
  const rawTranscript = store.get(conversationId);
  if (rawTranscript.length === 0) {
    recordCompactionFailure(trigger, 'no_transcript');
    return { ok: false, reason: 'no_transcript' };
  }

  const entry = conversationRegistry.get(conversationId);
  const oldSessionId = entry?.sessionId;
  const oldWorkerId = entry?.workerId;

  const peeled = peelInflightUserTurn(rawTranscript, options.incomingPrompt);
  const { head, tail } = splitTranscript(peeled);

  let summary = '';
  if (head.length > 0) {
    const summaryWorker = await pickWorker(model, options.excludeWorkerId);
    if (!summaryWorker) {
      recordCompactionFailure(trigger, 'no_worker_for_summary');
      return { ok: false, reason: 'no_worker_for_summary' };
    }
    const tempSessionId = uuidv4();
    const summaryPrompt = buildSummaryPrompt(head);
    const summaryPrefill = await tryPrefill(
      summaryWorker,
      tempSessionId,
      { prompt: summaryPrompt, model, max_tokens: SUMMARY_MAX_TOKENS },
      'create'
    );
    if (summaryPrefill.ok) {
      const decoded = await runInternalDecode(summaryWorker, tempSessionId, SUMMARY_MAX_TOKENS);
      if (decoded.ok) summary = decoded.text;
    }
    await deleteWorkerSession(summaryWorker, tempSessionId);
  }

  let prefillText = buildCompactionPrefill(summary, tail);
  prefillText = truncatePrefillToFit(prefillText, MAX_CONTEXT_TOKENS) ?? '';
  if (!prefillText || estimateTokens(prefillText) > MAX_CONTEXT_TOKENS) {
    recordCompactionFailure(trigger, 'still_too_long');
    return { ok: false, reason: 'still_too_long' };
  }

  const targetWorker = await pickWorker(model, options.excludeWorkerId);
  if (!targetWorker) {
    recordCompactionFailure(trigger, 'prefill_failed');
    return { ok: false, reason: 'prefill_failed' };
  }

  const newSessionId = uuidv4();
  const estimatedKv = prefillText.length * 512;
  const createResult = await tryPrefill(
    targetWorker,
    newSessionId,
    { prompt: prefillText, model, max_tokens: SUMMARY_MAX_TOKENS },
    'create'
  );
  if (!createResult.ok) {
    recordCompactionFailure(trigger, 'prefill_failed');
    return { ok: false, reason: 'prefill_failed' };
  }

  if (oldSessionId) {
    sessionTracker.sessionEnd(oldSessionId);
  }
  sessionTracker.sessionStart(newSessionId, targetWorker.id, estimatedKv);

  conversationRegistry.set(conversationId, {
    sessionId: newSessionId,
    workerId: targetWorker.id,
    approxTokens: createResult.totalTokensEst,
    lastActiveMs: Date.now(),
    model,
  });

  if (oldSessionId && oldWorkerId) {
    const oldWorker = healthTable
      .getWorkersForScheduler()
      .find((w) => w.id === oldWorkerId);
    if (oldWorker) {
      await deleteWorkerSession(oldWorker, oldSessionId);
    }
  }

  store.replace(conversationId, buildPostCompactionTranscript(summary, tail));
  lastCompactMsByConversation.set(conversationId, Date.now());
  recordCompactionSuccess(trigger, Date.now() - started);
  return { ok: true, sessionId: newSessionId, workerId: targetWorker.id };
}

/** @internal test reset */
export function resetCompactionDebounce(): void {
  lastCompactMsByConversation.clear();
}
