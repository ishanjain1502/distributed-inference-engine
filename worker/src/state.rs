// Worker state management

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::RwLock;
use tracing::{debug, info};

/// Session TTL - evict after this idle duration
pub const SESSION_TTL: Duration = Duration::from_secs(300); // 5 minutes

/// Active inference session
pub struct Session {
    pub prompt: String,
    pub model: String,
    pub max_tokens: u32,
    pub kv_cache_bytes: u64,
    pub last_activity: Instant,
}

impl Session {
    /// Touch session to update last_activity
    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    /// Check if session has exceeded TTL
    pub fn is_expired(&self) -> bool {
        self.last_activity.elapsed() > SESSION_TTL
    }
}

/// Shared session store
pub type Sessions = Arc<RwLock<HashMap<String, Session>>>;

/// Evict expired sessions. Returns number of sessions evicted.
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

/// Run session eviction loop - call as spawned background task
pub async fn run_eviction_loop(sessions: Sessions) {
    let check_interval = Duration::from_secs(60); // Check every minute
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
