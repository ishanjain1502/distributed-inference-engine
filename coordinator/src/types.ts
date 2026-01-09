// Request/Response types

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

