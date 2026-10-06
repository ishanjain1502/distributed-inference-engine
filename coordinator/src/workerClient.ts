import { InferRequest, TokenMessage, Worker } from './types';

export type PrefillResult =
  | { ok: true; tokensAdded: number; totalTokensEst: number }
  | {
      ok: false;
      kind:
        | 'session_full'
        | 'session_gone'
        | 'model_mismatch'
        | 'prompt_too_long'
        | 'capacity'
        | 'other';
      status: number;
    };

export interface PrefillParams {
  prompt: string;
  model: string;
  max_tokens: number;
}

function toPrefillParams(body: InferRequest | PrefillParams): PrefillParams {
  return {
    prompt: body.prompt,
    model: body.model,
    max_tokens: body.max_tokens,
  };
}

/**
 * Attempt prefill on a worker for either a new ("create") or existing
 * ("continue") session.
 */
export async function tryPrefill(
  worker: Worker,
  sessionId: string,
  body: InferRequest | PrefillParams,
  mode: 'create' | 'continue'
): Promise<PrefillResult> {
  const params = toPrefillParams(body);
  try {
    const prefillRes = await fetch(`${worker.url}/worker/prefill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        prompt: params.prompt,
        model: params.model,
        max_tokens: params.max_tokens,
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
      else if (errBody.reason === 'prompt_too_long') reason = 'prompt_too_long';
    } catch {
      /* ignore */
    }
    if (prefillRes.status === 409 && reason === 'session_full') {
      return { ok: false, kind: 'session_full', status: 409 };
    }
    if (prefillRes.status === 413 || reason === 'prompt_too_long') {
      return { ok: false, kind: 'prompt_too_long', status: 413 };
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

function parseSSETokens(text: string): TokenMessage[] {
  const tokens: TokenMessage[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as TokenMessage;
      if (typeof parsed.token === 'string') tokens.push(parsed);
    } catch {
      /* skip */
    }
  }
  return tokens;
}

/** Collect full decode output (internal summarization — not streamed to client). */
export async function runInternalDecode(
  worker: Worker,
  sessionId: string,
  maxTokens: number
): Promise<{ ok: true; text: string } | { ok: false }> {
  const decodeRes = await fetch(`${worker.url}/worker/decode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, max_tokens: maxTokens }),
  });
  if (!decodeRes.ok || !decodeRes.body) return { ok: false };

  const reader = decodeRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parts: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as { token?: string };
          if (typeof parsed.token === 'string') parts.push(parsed.token);
        } catch {
          /* skip */
        }
      }
    }
    if (buffer) {
      for (const token of parseSSETokens(buffer)) {
        parts.push(token.token);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { ok: true, text: parts.join('') };
}

export async function deleteWorkerSession(worker: Worker, sessionId: string): Promise<void> {
  try {
    await fetch(`${worker.url}/worker/sessions/${sessionId}`, { method: 'DELETE' });
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: 'worker.delete_session_failed',
        session_id: sessionId,
        worker_id: worker.id,
        error: String(err),
      })
    );
  }
}
