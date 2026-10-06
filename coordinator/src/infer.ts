// POST /infer - Client-facing inference endpoint
//
// Coordinator responsibilities:
// - Reads worker stream
// - Writes to client stream
// - Maintains bounded buffer
// - Enforces write deadlines
// - Tracks sequence numbers for gap detection
// - Routes multi-turn conversations to the sticky worker via conversationRegistry

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { InferRequest, Worker, TokenMessage, DEFAULT_STREAM_CONFIG } from './types';
import { selectWorker, RequestMeta, WorkerSelectionError, canAcceptRequest } from './scheduler';
import { healthTable } from './healthTable';
import { streamMetrics } from './streamMetrics';
import { sessionTracker } from './sessionTracker';
import { conversationRegistry } from './conversationRegistry';
import { decodeTracker } from './decodeTracker';
import { transcriptStore } from './transcriptStore';
import {
  compact,
  CompactionTrigger,
  shouldDebounce,
} from './compactionService';
import {
  shouldCompactProactively,
  splitTranscript,
  SYSTEM_KV_COMPACT_BATCH,
} from './compactionPolicy';
import { pickSessionsToCompact } from './kvPressure';
import { tryPrefill } from './workerClient';

const MAX_PREFILL_RETRIES = 2;
const STREAM_CONFIG = DEFAULT_STREAM_CONFIG;

const router = Router();

function tearDownConversation(conversationId: string, sessionId: string): void {
  conversationRegistry.delete(conversationId);
  sessionTracker.sessionEnd(sessionId);
}

async function tryCompactionRecovery(
  conversationId: string,
  body: InferRequest,
  trigger: CompactionTrigger,
  oldSessionId?: string
): Promise<{ worker: Worker; sessionId: string } | null> {
  if (oldSessionId) {
    sessionTracker.sessionEnd(oldSessionId);
  }
  const compactResult = await compact(conversationId, trigger, body.model, {
    incomingPrompt: body.prompt,
  });
  if (!compactResult.ok) return null;

  const entry = conversationRegistry.get(conversationId);
  if (!entry) return null;

  const worker = healthTable
    .getWorkersForScheduler()
    .find((w) => w.id === entry.workerId);
  if (!worker) return null;

  const prefill = await tryPrefill(worker, entry.sessionId, body, 'continue');
  if (!prefill.ok) return null;

  conversationRegistry.touch(conversationId, prefill.totalTokensEst);
  return { worker, sessionId: entry.sessionId };
}

function transcriptHasCompactableHead(conversationId: string, incomingPrompt: string): boolean {
  const turns = transcriptStore.get(conversationId);
  if (turns.length === 0) return false;
  const last = turns[turns.length - 1];
  const peeled =
    last.role === 'user' && last.content === incomingPrompt
      ? turns.slice(0, -1)
      : turns;
  return splitTranscript(peeled).head.length > 0;
}

function sendReset(res: Response, reason: 'session_full' | 'session_gone', requestId: string): void {
  res.status(409).json({
    error: 'Conversation reset required',
    reason,
    request_id: requestId,
  });
}

function sendDecodeCapacityReject(
  res: Response,
  reason: string,
  requestId: string,
  workerId?: string
): void {
  console.warn(
    JSON.stringify({
      event: 'infer.decode_capacity_reject',
      request_id: requestId,
      reason,
      worker_id: workerId ?? null,
      in_flight_decodes: decodeTracker.getTotal(),
    })
  );
  res.status(503).json({
    error: 'System at capacity',
    reason,
    request_id: requestId,
  });
}

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as InferRequest;
  const requestId = uuidv4();

  if (!body.conversation_id || !body.prompt || !body.model || !body.max_tokens) {
    res.status(400).json({
      error: 'Missing required fields: conversation_id, prompt, model, max_tokens',
    });
    return;
  }

  // Estimate KV cache for this request (for admission control)
  const estimatedKvBytes = body.prompt.length * 512; // Same estimate as worker

  const release = await conversationRegistry.acquire(body.conversation_id);
  try {
    transcriptStore.append(body.conversation_id, {
      role: 'user',
      content: body.prompt,
      ts: Date.now(),
    });

    let entry = conversationRegistry.get(body.conversation_id);

    let selectedWorker: Worker | null = null;
    let sessionId: string;

    if (entry) {
      conversationRegistry.touch(body.conversation_id);

      if (
        shouldCompactProactively(entry.approxTokens) &&
        !shouldDebounce(body.conversation_id) &&
        transcriptHasCompactableHead(body.conversation_id, body.prompt)
      ) {
        const proactive = await tryCompactionRecovery(
          body.conversation_id,
          body,
          'proactive',
          entry.sessionId
        );
        if (proactive) {
          selectedWorker = proactive.worker;
          sessionId = proactive.sessionId;
          entry = conversationRegistry.get(body.conversation_id)!;
        }
      }

      if (!selectedWorker) {
        let worker = healthTable
          .getWorkersForScheduler()
          .find((w) => w.id === entry!.workerId);

        if (!worker) {
          const recovered = await tryCompactionRecovery(
            body.conversation_id,
            body,
            'session_gone',
            entry.sessionId
          );
          if (recovered) {
            selectedWorker = recovered.worker;
            sessionId = recovered.sessionId;
          } else {
            tearDownConversation(body.conversation_id, entry.sessionId);
            sendReset(res, 'session_gone', requestId);
            return;
          }
        } else {
          const decodeAdmission = decodeTracker.canAccept(worker.id);
          if (decodeAdmission.canAccept === false) {
            sendDecodeCapacityReject(res, decodeAdmission.reason, requestId, worker.id);
            return;
          }

          sessionId = entry.sessionId;
          const result = await tryPrefill(worker, sessionId, body, 'continue');

          if (result.ok === true) {
            selectedWorker = worker;
          } else if (result.kind === 'session_full') {
            const recovered = await tryCompactionRecovery(
              body.conversation_id,
              body,
              'session_full',
              sessionId
            );
            if (recovered) {
              selectedWorker = recovered.worker;
              sessionId = recovered.sessionId;
            } else {
              tearDownConversation(body.conversation_id, sessionId);
              sendReset(res, 'session_full', requestId);
              return;
            }
          } else if (result.kind === 'session_gone') {
            const recovered = await tryCompactionRecovery(
              body.conversation_id,
              body,
              'session_gone',
              sessionId
            );
            if (recovered) {
              selectedWorker = recovered.worker;
              sessionId = recovered.sessionId;
            } else {
              tearDownConversation(body.conversation_id, sessionId);
              sendReset(res, 'session_gone', requestId);
              return;
            }
          } else if (result.kind === 'model_mismatch') {
            tearDownConversation(body.conversation_id, sessionId);
            sendReset(res, 'session_gone', requestId);
            return;
          } else if (result.kind === 'prompt_too_long') {
            tearDownConversation(body.conversation_id, sessionId);
            res.status(413).json({
              error: 'Prompt too long',
              reason: 'prompt_too_long',
              request_id: requestId,
            });
            return;
          } else {
            tearDownConversation(body.conversation_id, sessionId);
            res.status(502).json({
              error: 'Continuation prefill failed',
              reason: result.kind,
              request_id: requestId,
            });
            return;
          }
        }
      }
    } else {
      // New conversation: admission control + worker selection retry loop.
      let allWorkers = healthTable.getWorkersForScheduler();
      let admissionCheck = canAcceptRequest(allWorkers, estimatedKvBytes);

      if (!admissionCheck.canAccept) {
        const rejection = admissionCheck as { canAccept: false; reason: string };
        if (rejection.reason === 'system_kv_cache_full') {
          for (const candidate of pickSessionsToCompact(SYSTEM_KV_COMPACT_BATCH)) {
            await compact(candidate.conversationId, 'system_kv_pressure', candidate.model);
          }
          allWorkers = healthTable.getWorkersForScheduler();
          admissionCheck = canAcceptRequest(allWorkers, estimatedKvBytes);
        }
      }

      if (!admissionCheck.canAccept) {
        const rejection = admissionCheck as { canAccept: false; reason: string };
        console.warn(
          JSON.stringify({
            event: 'infer.early_reject',
            request_id: requestId,
            reason: rejection.reason,
            prompt_length: body.prompt.length,
            estimated_kv_bytes: estimatedKvBytes,
          })
        );
        res.status(503).json({
          error: 'System at capacity',
          reason: rejection.reason,
          request_id: requestId,
        });
        return;
      }

      const requestMeta: RequestMeta = {
        model: body.model,
        prompt_tokens: Math.ceil(body.prompt.length / 4),
        request_id: requestId,
      };

      const triedWorkerIds = new Set<string>();
      let lastRejectionReason: string | null = null;
      sessionId = '';

      for (let attempt = 0; attempt <= MAX_PREFILL_RETRIES; attempt++) {
        let worker: Worker;
        try {
          const availableWorkers = healthTable
            .getWorkersForScheduler()
            .filter((w) => !triedWorkerIds.has(w.id));
          worker = selectWorker(requestMeta, availableWorkers);
        } catch (err) {
          if (err instanceof WorkerSelectionError) {
            lastRejectionReason = err.reason;
          }
          break;
        }

        triedWorkerIds.add(worker.id);
        const candidateSessionId = uuidv4();

        const result = await tryPrefill(worker, candidateSessionId, body, 'create');
        if (result.ok === true) {
          selectedWorker = worker;
          sessionId = candidateSessionId;
          conversationRegistry.set(body.conversation_id, {
            sessionId,
            workerId: worker.id,
            approxTokens: result.totalTokensEst,
            lastActiveMs: Date.now(),
            model: body.model,
          });
          sessionTracker.sessionStart(sessionId, worker.id, estimatedKvBytes);
          break;
        }
        if (result.kind === 'session_full') {
          // Prompt is too large regardless of which worker serves it -
          // retrying other workers cannot help, so fail fast.
          sendReset(res, 'session_full', requestId);
          return;
        }
        if (result.kind === 'prompt_too_long') {
          // The prompt alone (with no prior history) exceeds the context
          // budget - no conversation_id rotation or worker retry can fix
          // this, so surface it distinctly from session_full (409) instead
          // of trapping the client in an unwinnable reset loop.
          res.status(413).json({
            error: 'Prompt too long',
            reason: 'prompt_too_long',
            request_id: requestId,
          });
          return;
        }
        lastRejectionReason = result.kind;
      }

      if (!selectedWorker) {
        res.status(502).json({
          error: 'All prefill attempts failed',
          tried: triedWorkerIds.size,
          reason: lastRejectionReason,
          request_id: requestId,
        });
        return;
      }
    }

    // Stream tokens back from worker /decode
    // NOTE: Decode failures are TERMINAL for this session's worker - the
    // conversation is torn down and a fresh session must be created on retry.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let decodeStarted = false;
    try {
      const decodeRes = await fetch(`${selectedWorker.url}/worker/decode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          max_tokens: body.max_tokens,
        }),
      });

      if (!decodeRes.ok || !decodeRes.body) {
        tearDownConversation(body.conversation_id, sessionId);
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: 'Worker decode failed' })}\n\n`);
          res.end();
        }
        return;
      }

      decodeTracker.decodeStart(sessionId, selectedWorker.id);
      streamMetrics.sessionStart(sessionId, selectedWorker.id);
      decodeStarted = true;

      // Stream tokens from worker to client with bounded buffer and write deadlines
      await streamTokensToClient(body.conversation_id, sessionId, decodeRes.body, res);
    } catch (err) {
      tearDownConversation(body.conversation_id, sessionId);
      if (decodeStarted) {
        decodeTracker.decodeEnd(sessionId);
        streamMetrics.sessionEnd(sessionId, 'worker_error');
      }
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: 'Worker connection lost during decode' })}\n\n`);
        res.end();
      }
    }
  } finally {
    release();
  }
});

/**
 * Parse SSE data events from a chunk of text.
 * Returns array of parsed TokenMessage objects.
 */
function parseSSETokens(text: string): TokenMessage[] {
  const tokens: TokenMessage[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data) {
        try {
          const parsed = JSON.parse(data) as TokenMessage;
          if (typeof parsed.token === 'string' && typeof parsed.seq === 'number') {
            tokens.push(parsed);
          }
        } catch {
        }
      }
    }
  }

  return tokens;
}

/**
 * Write a token to the client with deadline enforcement.
 * Returns { success: boolean, latencyMs: number }
 */
async function writeWithDeadline(
  res: Response,
  token: TokenMessage,
  deadlineMs: number
): Promise<{ success: boolean; latencyMs: number }> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, latencyMs: Date.now() - startTime });
    }, deadlineMs);

    const data = `data: ${JSON.stringify(token)}\n\n`;

    res.write(data, (err) => {
      clearTimeout(timeout);
      resolve({ success: !err, latencyMs: Date.now() - startTime });
    });
  });
}

/**
 * Stream tokens from worker to client.
 * - Reads worker stream
 * - Maintains bounded buffer
 * - Enforces write deadlines
 * - Tracks sequence numbers for gap detection
 * - Records metrics for observability
 *
 * On normal completion (or client disconnect / write timeout) the
 * conversation and its worker session stay alive so the next turn can
 * continue on the same worker; only decode hard failures tear it down
 * (handled by the caller).
 */
async function streamTokensToClient(
  conversationId: string,
  sessionId: string,
  workerBody: ReadableStream<Uint8Array>,
  res: Response
): Promise<void> {
  const reader = workerBody.getReader();
  const decoder = new TextDecoder();

  const buffer: TokenMessage[] = [];
  const assistantParts: string[] = [];
  let expectedSeq = 0;
  let clientDisconnected = false;
  let terminationReason: 'complete' | 'client_disconnect' | 'write_timeout' =
    'complete';

  res.on('close', () => {
    clientDisconnected = true;
    terminationReason = 'client_disconnect';
  });

  try {
    while (!clientDisconnected) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const tokens = parseSSETokens(text);

      for (const token of tokens) {
        streamMetrics.tokenReceived(sessionId);

        if (token.seq !== expectedSeq) {
          console.warn(
            JSON.stringify({
              event: 'stream.sequence_gap',
              session_id: sessionId,
              expected_seq: expectedSeq,
              actual_seq: token.seq,
            })
          );
        }
        expectedSeq = token.seq + 1;

        buffer.push(token);

        streamMetrics.updateBufferOccupancy(
          sessionId,
          buffer.length,
          STREAM_CONFIG.bufferSize
        );

        while (buffer.length > STREAM_CONFIG.bufferSize) {
          const dropped = buffer.shift();
          if (dropped) {
            streamMetrics.bufferOverflow(sessionId, dropped.seq);
          }
        }
      }

      while (buffer.length > 0 && !clientDisconnected) {
        const token = buffer.shift()!;
        const { success, latencyMs } = await writeWithDeadline(
          res,
          token,
          STREAM_CONFIG.writeDeadlineMs
        );

        if (success) {
          assistantParts.push(token.token);
          streamMetrics.tokenWritten(sessionId, latencyMs);
        } else {
          console.warn(
            JSON.stringify({
              event: 'stream.write_timeout',
              session_id: sessionId,
              token_seq: token.seq,
              deadline_ms: STREAM_CONFIG.writeDeadlineMs,
            })
          );
          terminationReason = 'write_timeout';
          clientDisconnected = true;
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
    res.end();
    // Normal completion / client disconnect / write timeout keep the
    // conversation + worker session alive for the next turn; only
    // sessionTracker teardown paths (session_full, session_gone, decode
    // hard failure) end the underlying worker session.
    if (assistantParts.length > 0) {
      transcriptStore.append(conversationId, {
        role: 'assistant',
        content: assistantParts.join(''),
        ts: Date.now(),
      });
    }
    conversationRegistry.touch(conversationId);
    decodeTracker.decodeEnd(sessionId);
    streamMetrics.sessionEnd(sessionId, terminationReason);
  }
}

export default router;
