// POST /infer - Client-facing inference endpoint
//
// Coordinator responsibilities:
// - Reads worker stream
// - Writes to client stream
// - Maintains bounded buffer
// - Enforces write deadlines
// - Tracks sequence numbers for gap detection

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { InferRequest, Worker, TokenMessage, DEFAULT_STREAM_CONFIG } from './types';
import { selectWorker, RequestMeta, WorkerSelectionError } from './scheduler';
import { healthTable } from './healthTable';
import { streamMetrics } from './streamMetrics';

const MAX_PREFILL_RETRIES = 2;
const STREAM_CONFIG = DEFAULT_STREAM_CONFIG;

const router = Router();

/**
 * Attempt prefill on a worker.
 * Returns the worker on success, null on failure.
 */
async function tryPrefill(
  worker: Worker,
  sessionId: string,
  body: InferRequest
): Promise<boolean> {
  try {
    const prefillRes = await fetch(`${worker.url}/worker/prefill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        prompt: body.prompt,
        model: body.model,
        max_tokens: body.max_tokens,
      }),
    });
    return prefillRes.ok;
  } catch {
    return false;
  }
}

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as InferRequest;
  const requestId = uuidv4();

  if (!body.prompt || !body.model || !body.max_tokens) {
    res.status(400).json({ error: 'Missing required fields: prompt, model, max_tokens' });
    return;
  }

  const requestMeta: RequestMeta = {
    model: body.model,
    prompt_tokens: Math.ceil(body.prompt.length / 4),
    request_id: requestId,
  };

  const triedWorkerIds = new Set<string>();
  let selectedWorker: Worker | null = null;
  let sessionId: string = '';
  let lastRejectionReason: string | null = null;

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
    sessionId = uuidv4();

    const success = await tryPrefill(worker, sessionId, body);
    if (success) {
      selectedWorker = worker;
      break;
    }
  }

  if (!selectedWorker) {
    res.status(502).json({
      error: 'All prefill attempts failed',
      tried: triedWorkerIds.size,
      reason: lastRejectionReason,
    });
    return;
  }

  // 3. Stream tokens back from worker /decode
  // NOTE: Decode failures are TERMINAL - no retry (KV cache is on this worker)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Start tracking this session
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
      streamMetrics.sessionEnd(sessionId, 'worker_error');
      return;
    }

    // Stream tokens from worker to client with bounded buffer and write deadlines
    await streamTokensToClient(sessionId, decodeRes.body, res);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'Worker connection lost during decode' })}\n\n`);
    res.end();
    streamMetrics.sessionEnd(sessionId, 'worker_error');
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
 */
async function streamTokensToClient(
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
    streamMetrics.sessionEnd(sessionId, terminationReason);
  }
}

export default router;