use std::time::Duration;

use reqwest::Client;
use serde::Serialize;
use tracing::{debug, error, warn};

use crate::state::Sessions;

#[derive(Serialize)]
struct HeartbeatPayload {
    worker_id: String,
    worker_url: String,
    timestamp: u64,
    health: WorkerHealth,
}

#[derive(Serialize)]
struct WorkerHealth {
    alive: bool,
    active_sessions: usize,
    kv_cache_bytes: u64,
}

pub struct HeartbeatConfig {
    pub worker_id: String,
    pub worker_url: String,
    pub coordinator_url: String,
    pub interval: Duration,
}

impl Default for HeartbeatConfig {
    fn default() -> Self {
        Self {
            worker_id: std::env::var("WORKER_ID").unwrap_or_else(|_| "worker-1".into()),
            worker_url: std::env::var("WORKER_URL")
                .unwrap_or_else(|_| "http://localhost:3001".into()),
            coordinator_url: std::env::var("COORDINATOR_URL")
                .unwrap_or_else(|_| "http://localhost:1337".into()),
            interval: Duration::from_secs(10),
        }
    }
}

async fn gather_health(sessions: &Sessions) -> WorkerHealth {
    let sessions_read = sessions.read().await;
    let active_sessions = sessions_read.len();
    let kv_cache_bytes: u64 = sessions_read.values().map(|s| s.kv_cache_bytes).sum();

    WorkerHealth {
        alive: true,
        active_sessions,
        kv_cache_bytes,
    }
}

pub async fn run_heartbeat_loop(sessions: Sessions, config: HeartbeatConfig) {
    let client = Client::new();
    let heartbeat_url = format!("{}/coordinator/health/heartbeat", config.coordinator_url);

    debug!(
        worker_id = %config.worker_id,
        worker_url = %config.worker_url,
        coordinator = %config.coordinator_url,
        interval_secs = config.interval.as_secs(),
        "Starting heartbeat loop"
    );

    let mut interval = tokio::time::interval(config.interval);

    loop {
        interval.tick().await;

        let health = gather_health(&sessions).await;
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let payload = HeartbeatPayload {
            worker_id: config.worker_id.clone(),
            worker_url: config.worker_url.clone(),
            timestamp,
            health,
        };

        match client.post(&heartbeat_url).json(&payload).send().await {
            Ok(resp) if resp.status().is_success() => {
                debug!(worker_id = %config.worker_id, "Heartbeat sent");
            }
            Ok(resp) => {
                warn!(
                    worker_id = %config.worker_id,
                    status = %resp.status(),
                    "Heartbeat rejected by coordinator"
                );
            }
            Err(e) => {
                error!(
                    worker_id = %config.worker_id,
                    error = %e,
                    "Failed to send heartbeat"
                );
            }
        }
    }
}

