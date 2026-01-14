export interface InferRequest {
  prompt: string;
  model: string;
  max_tokens: number;
}

export interface WorkerHealth {
  alive: boolean;
  active_sessions: number;
  kv_cache_bytes: number;
}

export interface Worker {
  id: string;
  url: string;
  health?: WorkerHealth;
}

export interface TokenMessage {
  token: string;
  seq: number;
}

export interface StreamConfig {
  bufferSize: number;
  writeDeadlineMs: number;
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  bufferSize: 64,
  writeDeadlineMs: 5000,
};
