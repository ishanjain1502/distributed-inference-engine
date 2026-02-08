mod cache;
mod heartbeat;
mod http;
mod metrics;
mod model;
mod state;
mod stream;

use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use tokio::sync::RwLock;
use tracing::info;

use heartbeat::HeartbeatConfig;
use state::Sessions;
use model::ModelManager;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // Load model from environment variable or use default.
    // Use forward slashes so the path is not corrupted by shells (e.g. Git Bash strips backslashes).
    let model_path = std::env::var("MODEL_PATH")
        .map(|p| p.replace('\\', "/"))
        .unwrap_or_else(|_| "E:/Projects/inference-engine/modelFiles/gemma-3-270m-it-Q8_0.gguf".to_string());
    
    let model_manager = match ModelManager::load(&model_path) {
        Ok(manager) => {
            info!(model_path = %model_path, "Model loaded successfully");
            Arc::new(manager)
        }
        Err(e) => {
            tracing::error!(error = %e, model_path = %model_path, "Failed to load model");
            std::process::exit(1);
        }
    };

    let sessions: Sessions = Arc::new(RwLock::new(HashMap::new()));

    let heartbeat_sessions = sessions.clone();
    let heartbeat_config = HeartbeatConfig::default();
    info!(
        worker_id = %heartbeat_config.worker_id,
        worker_url = %heartbeat_config.worker_url,
        coordinator = %heartbeat_config.coordinator_url,
        "Starting worker with heartbeat"
    );
    tokio::spawn(heartbeat::run_heartbeat_loop(
        heartbeat_sessions,
        heartbeat_config,
    ));

    let eviction_sessions = sessions.clone();
    tokio::spawn(state::run_eviction_loop(eviction_sessions));

    tokio::spawn(metrics::run_metrics_loop());

    let app = Router::new()
        .route("/worker/prefill", axum::routing::post(http::prefill))
        .route("/worker/decode", axum::routing::post(http::decode))
        .route("/worker/health", axum::routing::get(http::health))
        .with_state((sessions, model_manager));

    let addr = "0.0.0.0:3001";
    info!("Worker listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
