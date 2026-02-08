use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use anyhow::{Context, Result};
use llama_cpp::{
    LlamaModel, LlamaParams, SessionParams, LlamaSession,
    standard_sampler::StandardSampler,
};
use tracing::info;

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
        let session_params = SessionParams::default();
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
    info!(prompt_len = prompt_len, "Starting prefill");
    
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

/// Generate tokens and return them as a vector
/// This runs in a blocking task since llama-cpp operations are blocking
pub async fn generate_tokens(
    session: Arc<Mutex<LlamaSession>>,
    max_tokens: u32,
) -> Result<Vec<String>> {
    // Use spawn_blocking to run the blocking model operation
    let sampler = StandardSampler::default();
    
    tokio::task::spawn_blocking(move || {
        let mut session_guard = session.lock().unwrap();
        
        // Start completion - this creates a worker thread (returns Result<CompletionHandle, _>)
        let completions = session_guard.start_completing_with(sampler, max_tokens as usize)?;
        
        // Collect tokens into a vector
        let tokens: Vec<String> = completions
            .into_strings()
            .take(max_tokens as usize)
            .collect();
        
        Ok::<Vec<String>, anyhow::Error>(tokens)
    })
    .await
    .context("Token generation task panicked")?
    .context("Token generation failed")
}
