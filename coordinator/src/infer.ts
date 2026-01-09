// POST /infer - Client-facing inference endpoint

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { InferRequest, Worker } from './types';
import { selectWorker, RequestMeta } from './scheduler';
import { healthTable } from './healthTable';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as InferRequest;

  // Validate request
  if (!body.prompt || !body.model || !body.max_tokens) {
    res.status(400).json({ error: 'Missing required fields: prompt, model, max_tokens' });
    return;
  }

  const sessionId = uuidv4();

  // 1. Get workers from health table and select best one
  const requestMeta: RequestMeta = {
    model: body.model,
    prompt_tokens: Math.ceil(body.prompt.length / 4), // rough estimate
  };

  let worker: Worker;
  try {
    const availableWorkers = healthTable.getWorkersForScheduler();
    worker = selectWorker(requestMeta, availableWorkers);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No healthy workers available';
    const status = message === 'All workers at capacity' ? 429 : 503;
    res.status(status).json({ error: message });
    return;
  }

  // 2. Forward to worker /prefill
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

    if (!prefillRes.ok) {
      res.status(502).json({ error: 'Worker prefill failed' });
      return;
    }
  } catch (err) {
    res.status(502).json({ error: 'Worker unreachable during prefill' });
    return;
  }

  // 3. Stream tokens back from worker /decode
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const decodeRes = await fetch(`${worker.url}/worker/decode`, {
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
      return;
    }

    // Pipe SSE stream from worker to client
    const reader = decodeRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'Worker connection lost during decode' })}\n\n`);
    res.end();
  }
});

export default router;
