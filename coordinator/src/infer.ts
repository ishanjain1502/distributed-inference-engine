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

const MAX_PREFILL_RETRIES = 2;
const STREAM_CONFIG = DEFAULT_STREAM_CONFIG;

const router = Router();

type PrefillResult =
  | { ok: true; tokensAdded: number; totalTokensEst: number }
  | {
      ok: false;
      kind: 'session_full' | 'session_gone' | 'model_mismatch' | 'capacity' | 'other';
      status: number;
    };

/**
 * Attempt prefill on a worker for either a new ("create") or existing
 * ("continue") session, returning a structured result so the caller can
 * distinguish retryable failures from ones requiring a conversation reset.
 */
async function tryPrefill(
  worker: Worker,
  sessionId: string,
  body: InferRequest,
  mode: 'create' | 'continue'
): Promise<PrefillResult> {
  try {
    const prefillRes = await fetch(`${worker.url}/worker/prefill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        prompt: body.prompt,
        model: body.model,
        max_tokens: body.max_tokens,
        mode,
      }),
    });
    if (prefillRes.ok) {
      const data = (await prefillRes.json()) as {
        tokens_added?: number;
        total_tokens_est?: number;
      };
      return {
        ok: true,
        tokensAdded: data.tokens_added ?? 0,
        totalTokensEst: data.total_tokens_est ?? 0,
      };
    }
    let reason = 'other';
    try {
      const errBody = (await prefillRes.json()) as { reason?: string };
      if (errBody.reason === 'session_full') reason = 'session_full';
      else if (errBody.reason === 'session_gone') reason = 'session_gone';
      else if (errBody.reason === 'model_mismatch') reason = 'model_mismatch';
    } catch {
      /* ignore */
    }
    if (prefillRes.status === 409 && reason === 'session_full') {
      return { ok: false, kind: 'session_full', status: 409 };
    }
    if (prefillRes.status === 404 || reason === 'session_gone') {
      return { ok: false, kind: 'session_gone', status: prefillRes.status };
    }
    if (prefillRes.status === 400 && reason === 'model_mismatch') {
      return { ok: false, kind: 'model_mismatch', status: 400 };
    }
    if (prefillRes.status === 503) {
      return { ok: false, kind: 'capacity', status: 503 };
    }
    return { ok: false, kind: 'other', status: prefillRes.status };
  } catch {
    return { ok: false, kind: 'other', status: 0 };
  }
}

function sendReset(res: Response, reason: 'session_full' | 'session_gone', requestId: string): void {
  res.status(409).json({
    error: 'Conversation reset required',
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
    let entry = conversationRegistry.get(body.conversation_id);

    let selectedWorker: Worker | null = null;
    let sessionId: string;

    if (entry) {
      // Sticky continue: resolve the worker this conversation already lives on.
      const worker = healthTable
        .getWorkersForScheduler()
        .find((w) => w.id === entry!.workerId);

      if (!worker) {
        conversationRegistry.delete(body.conversation_id);
        sessionTracker.sessionEnd(entry.sessionId);
        sendReset(res, 'session_gone', requestId);
        return;
      }

      sessionId = entry.sessionId;
      const result = await tryPrefill(worker, sessionId, body, 'continue');

      if (result.ok === true) {
        selectedWorker = worker;
      } else if (result.kind === 'session_full') {
        conversationRegistry.delete(body.conversation_id);
        sessionTracker.sessionEnd(sessionId);
        sendReset(res, 'session_full', requestId);
        return;
      } else if (result.kind === 'session_gone') {
        conversationRegistry.delete(body.conversation_id);
        sessionTracker.sessionEnd(sessionId);
        sendReset(res, 'session_gone', requestId);
        return;
      } else {
        conversationRegistry.delete(body.conversation_id);
        sessionTracker.sessionEnd(sessionId);
        res.status(502).json({
          error: 'Continuation prefill failed',
          reason: result.kind,
          request_id: requestId,
        });
        return;
      }
    } else {
      // New conversation: admission control + worker selection retry loop.
      const allWorkers = healthTable.getWorkersForScheduler();
      const admissionCheck = canAcceptRequest(allWorkers, estimatedKvBytes);

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
        if (result.ok === false && result.kind !== 'other' && result.kind !== 'capacity') {
          lastRejectionReason = result.kind;
        }
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

    streamMetrics.sessionStart(sessionId, selectedWorker.id);

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
        res.write(`data: ${JSON.stringify({ error: 'Worker decode failed' })}\n\n`);
        res.end();
        conversationRegistry.delete(body.conversation_id);
        sessionTracker.sessionEnd(sessionId);
        streamMetrics.sessionEnd(sessionId, 'worker_error');
        return;
      }

      // Stream tokens from worker to client with bounded buffer and write deadlines
      await streamTokensToClient(body.conversation_id, sessionId, decodeRes.body, res);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: 'Worker connection lost during decode' })}\n\n`);
      res.end();
      conversationRegistry.delete(body.conversation_id);
      sessionTracker.sessionEnd(sessionId);
      streamMetrics.sessionEnd(sessionId, 'worker_error');
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
    conversationRegistry.touch(conversationId);
    streamMetrics.sessionEnd(sessionId, terminationReason);
  }
}

export default router;
