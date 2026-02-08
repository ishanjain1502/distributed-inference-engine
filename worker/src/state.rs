use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::RwLock;
use tracing::{debug, info, warn};
use llama_cpp::LlamaSession;

/// Session TTL - evict after this idle duration
pub const SESSION_TTL: Duration = Duration::from_secs(300); // 5 minutes

/// Maximum sessions per worker
pub const MAX_SESSIONS: usize = 100;

/// Maximum KV cache bytes per session
pub const MAX_KV_CACHE_PER_SESSION: u64 = 512 * 1024 * 1024; // 512 MB

/// Maximum total KV cache bytes across all sessions
pub const MAX_TOTAL_KV_CACHE: u64 = 8 * 1024 * 1024 * 1024; // 8 GB

pub struct Session {
    pub prompt: String,
    pub model: String,
    pub max_tokens: u32,
    pub kv_cache_bytes: u64,
    pub last_activity: Instant,
    /// Model session for this inference request
    /// Wrapped in Arc<Mutex<>> because LlamaSession may not be Send/Sync
    pub model_session: Arc<Mutex<LlamaSession>>,
}

impl Session {
    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    pub fn is_expired(&self) -> bool {
        self.last_activity.elapsed() > SESSION_TTL
    }
}

pub type Sessions = Arc<RwLock<HashMap<String, Session>>>;


#[derive(Debug, Clone, Copy)]
pub enum CapacityError {
    MaxSessionsExceeded,
    SessionKvCacheTooLarge,
    TotalKvCacheExceeded,
}

impl std::fmt::Display for CapacityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CapacityError::MaxSessionsExceeded => write!(f, "max_sessions_exceeded"),
            CapacityError::SessionKvCacheTooLarge => write!(f, "session_kv_cache_too_large"),
            CapacityError::TotalKvCacheExceeded => write!(f, "total_kv_cache_exceeded"),
        }
    }
}

/// Check if we can accept a new session with the given KV cache size.
/// Returns Ok(()) if acceptable, Err(CapacityError) if not.
pub fn check_capacity(
    sessions: &HashMap<String, Session>,
    new_kv_cache_bytes: u64,
) -> Result<(), CapacityError> {
    // Check session count
    if sessions.len() >= MAX_SESSIONS {
        warn!(
            current_sessions = sessions.len(),
            max_sessions = MAX_SESSIONS,
            "capacity.max_sessions_exceeded"
        );
        return Err(CapacityError::MaxSessionsExceeded);
    }

    // Check per-session KV cache limit
    if new_kv_cache_bytes > MAX_KV_CACHE_PER_SESSION {
        warn!(
            requested_kv_bytes = new_kv_cache_bytes,
            max_per_session = MAX_KV_CACHE_PER_SESSION,
            "capacity.session_kv_cache_too_large"
        );
        return Err(CapacityError::SessionKvCacheTooLarge);
    }

    // Check total KV cache limit
    let current_total: u64 = sessions.values().map(|s| s.kv_cache_bytes).sum();
    let projected_total = current_total + new_kv_cache_bytes;

    if projected_total > MAX_TOTAL_KV_CACHE {
        warn!(
            current_kv_bytes = current_total,
            requested_kv_bytes = new_kv_cache_bytes,
            projected_total = projected_total,
            max_total = MAX_TOTAL_KV_CACHE,
            "capacity.total_kv_cache_exceeded"
        );
        return Err(CapacityError::TotalKvCacheExceeded);
    }

    Ok(())
}

/// Get current capacity metrics
pub fn get_capacity_metrics(sessions: &HashMap<String, Session>) -> CapacityMetrics {
    let total_kv_cache: u64 = sessions.values().map(|s| s.kv_cache_bytes).sum();
    CapacityMetrics {
        active_sessions: sessions.len(),
        max_sessions: MAX_SESSIONS,
        total_kv_cache_bytes: total_kv_cache,
        max_kv_cache_bytes: MAX_TOTAL_KV_CACHE,
        session_utilization_pct: (sessions.len() as f64 / MAX_SESSIONS as f64) * 100.0,
        kv_cache_utilization_pct: (total_kv_cache as f64 / MAX_TOTAL_KV_CACHE as f64) * 100.0,
    }
}

#[derive(Debug)]
pub struct CapacityMetrics {
    pub active_sessions: usize,
    pub max_sessions: usize,
    pub total_kv_cache_bytes: u64,
    pub max_kv_cache_bytes: u64,
    pub session_utilization_pct: f64,
    pub kv_cache_utilization_pct: f64,
}

pub async fn evict_expired_sessions(sessions: &Sessions) -> usize {
    let mut sessions_write = sessions.write().await;
    let before = sessions_write.len();

    sessions_write.retain(|id, session| {
        let expired = session.is_expired();
        if expired {
            debug!(session_id = %id, "Evicting expired session");
        }
        !expired
    });

    let evicted = before - sessions_write.len();
    if evicted > 0 {
        info!(evicted = evicted, remaining = sessions_write.len(), "Session eviction complete");
    }
    evicted
}

pub async fn run_eviction_loop(sessions: Sessions) {
    let check_interval = Duration::from_secs(60);
    let mut interval = tokio::time::interval(check_interval);

    info!(
        ttl_secs = SESSION_TTL.as_secs(),
        check_interval_secs = check_interval.as_secs(),
        "Starting session eviction loop"
    );

    loop {
        interval.tick().await;
        evict_expired_sessions(&sessions).await;
    }
}
