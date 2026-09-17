use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use anyhow::{Context, Result};
use llama_cpp::{
    LlamaModel, LlamaParams, SessionParams, LlamaSession,
    standard_sampler::StandardSampler,
};
use tracing::info;

use crate::budget;
use crate::stream::{EmitError, TokenEmitter};

/// Thread count for llama.cpp sessions.
///
/// `SessionParams::default()` uses `num_cpus::get_physical() - 1`, which is 0 in
/// Docker when the container reports a single physical CPU — triggering
/// `GGML_ASSERT(n_threads > 0)` during prefill.
fn inference_threads() -> u32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4)
        .max(1)
}

fn default_session_params() -> SessionParams {
    let mut params = SessionParams::default();
    let threads = inference_threads();
    params.n_threads = threads;
    params.n_threads_batch = threads;
    // Match coordinator/worker token budget so long prefills are not truncated by llama.cpp defaults (512).
    let ctx = budget::MAX_CONTEXT_TOKENS;
    params.n_ctx = ctx;
    params.n_batch = ctx;
    params.n_ubatch = ctx;
    params
}

/// Global model instance shared across all sessions
pub struct ModelManager {
    model: Arc<LlamaModel>,
}

impl ModelManager {
    /// Load the model from the specified path
    pub fn load(model_path: &str) -> Result<Self> {
        let path = PathBuf::from(model_path);
        
        if !path.exists() {
            let hint = if model_path.contains(':') && !model_path.contains('/') && !model_path.contains('\\') {
                " (Tip: set MODEL_PATH with forward slashes, e.g. E:/Projects/.../file.gguf, to avoid shell stripping backslashes)"
            } else {
                ""
            };
            anyhow::bail!("Model file not found: {}{}", model_path, hint);
        }

        info!(model_path = %model_path, "Loading model");
        
        let params = LlamaParams::default();
        let model = LlamaModel::load_from_file(&path, params)
            .with_context(|| format!("Failed to load model from {}", model_path))?;

        info!("Model loaded successfully");
        
        Ok(Self {
            model: Arc::new(model),
        })
    }

    /// Create a new session for inference
    /// Returns a Mutex-wrapped session since LlamaSession may not be Send/Sync
    pub fn create_session(&self) -> Result<Arc<Mutex<LlamaSession>>> {
        let session_params = default_session_params();
        let session = self.model
            .create_session(session_params)
            .context("Failed to create model session")?;
        Ok(Arc::new(Mutex::new(session)))
    }

    /// Get a reference to the underlying model
    pub fn model(&self) -> &Arc<LlamaModel> {
        &self.model
    }
}

/// Estimate KV cache size based on prompt length
/// This is a rough estimate: each token typically requires ~512 bytes of KV cache
pub fn estimate_kv_cache_bytes(prompt: &str) -> u64 {
    // Rough estimate: assume average token is ~4 characters
    let estimated_tokens = prompt.len() / 4;
    (estimated_tokens as u64) * 512
}

/// Tokenize prompt and build initial KV cache (prefill phase)
/// This runs in a blocking thread since llama-cpp operations are blocking
pub async fn prefill_session(
    session: Arc<Mutex<LlamaSession>>,
    prompt: String,
) -> Result<u32> {
    let prompt_len = prompt.len();
    info!(prompt = %prompt, prompt_len = prompt_len, "Starting prefill");
    
    // Run blocking model operation in a thread pool
    let token_count = tokio::task::spawn_blocking(move || {
        let mut session_guard = session.lock().unwrap();
        
        // Advance context with the prompt - this builds the KV cache
        session_guard
            .advance_context(&prompt)
            .context("Failed to advance context during prefill")?;

        // Estimate token count (rough approximation)
        let token_count = estimate_token_count(&prompt);
        Ok::<u32, anyhow::Error>(token_count)
    })
    .await
    .context("Prefill task panicked")??;
    
    info!(token_count = token_count, "Prefill complete");
    Ok(token_count)
}

/// Estimate token count from prompt (rough approximation)
fn estimate_token_count(text: &str) -> u32 {
    // Rough estimate: average token is ~4 characters
    // This is a simplification - actual tokenization depends on the model
    (text.len() / 4).max(1) as u32
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeStreamEnd {
    Complete,
    ClientDisconnect,
    Error,
}

pub struct DecodeStreamResult {
    pub tokens_emitted: u32,
    pub end: DecodeStreamEnd,
    pub first_token_ms: Option<f64>,
}

/// Incrementally decode and emit tokens via a bounded channel.
/// Holds the session mutex only for `start_completing_with`, then streams one
/// string piece at a time so TTFT reflects a single forward pass.
pub async fn run_decode_stream(
    session: Arc<Mutex<LlamaSession>>,
    max_tokens: u32,
    emitter: TokenEmitter,
) -> DecodeStreamResult {
    let blocking_result = tokio::task::spawn_blocking(move || {
        let decode_start = Instant::now();
        let mut session_guard = match session.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return DecodeStreamResult {
                    tokens_emitted: 0,
                    end: DecodeStreamEnd::Error,
                    first_token_ms: None,
                };
            }
        };

        let sampler = StandardSampler::default();
        let handle = match session_guard.start_completing_with(sampler, max_tokens as usize) {
            Ok(handle) => handle,
            Err(_) => {
                return DecodeStreamResult {
                    tokens_emitted: 0,
                    end: DecodeStreamEnd::Error,
                    first_token_ms: None,
                };
            }
        };
        drop(session_guard);

        let mut strings = handle.into_strings();
        let mut tokens_emitted = 0u32;
        let mut end = DecodeStreamEnd::Complete;
        let mut first_token_ms = None;

        while let Some(token) = strings.next() {
            match emitter.emit_blocking(token) {
                Ok(_) => {
                    if tokens_emitted == 0 {
                        first_token_ms =
                            Some(decode_start.elapsed().as_secs_f64() * 1000.0);
                    }
                    tokens_emitted += 1;
                }
                Err(EmitError::ChannelClosed) => {
                    end = DecodeStreamEnd::ClientDisconnect;
                    break;
                }
            }
        }

        DecodeStreamResult {
            tokens_emitted,
            end,
            first_token_ms,
        }
    })
    .await;

    match blocking_result {
        Ok(result) => result,
        Err(_) => DecodeStreamResult {
            tokens_emitted: 0,
            end: DecodeStreamEnd::Error,
            first_token_ms: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inference_threads_is_at_least_one() {
        assert!(inference_threads() >= 1);
    }

    #[test]
    fn default_session_params_sets_positive_thread_count() {
        let params = default_session_params();
        assert!(params.n_threads >= 1);
        assert!(params.n_threads_batch >= 1);
        assert_eq!(params.n_ctx, budget::MAX_CONTEXT_TOKENS);
        assert_eq!(params.n_batch, budget::MAX_CONTEXT_TOKENS);
    }
}
