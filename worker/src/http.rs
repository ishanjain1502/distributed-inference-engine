use std::convert::Infallible;
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use tokio_stream::StreamExt;

use crate::state::{Session, Sessions};

#[derive(Deserialize)]
pub struct PrefillRequest {
    pub session_id: String,
    pub prompt: String,
    pub model: String,
    pub max_tokens: u32,
}

#[derive(Serialize)]
pub struct PrefillResponse {
    pub status: &'static str,
}

/// POST /prefill - Prefill phase of inference
pub async fn prefill(
    State(sessions): State<Sessions>,
    Json(req): Json<PrefillRequest>,
) -> Result<Json<PrefillResponse>, StatusCode> {
    // TODO: Compute actual KV cache size from prompt tokenization
    let kv_cache_bytes = (req.prompt.len() as u64) * 512; // placeholder estimate

    let session = Session {
        prompt: req.prompt,
        model: req.model,
        max_tokens: req.max_tokens,
        kv_cache_bytes,
        last_activity: Instant::now(),
    };

    sessions.write().await.insert(req.session_id, session);

    Ok(Json(PrefillResponse { status: "ok" }))
}

#[derive(Deserialize)]
pub struct DecodeRequest {
    pub session_id: String,
    pub max_tokens: u32,
}

#[derive(Serialize)]
pub struct DecodeChunk {
    pub token: String,
    pub finished: bool,
}

/// POST /decode - Decode phase of inference (streaming)
pub async fn decode(
    State(sessions): State<Sessions>,
    Json(req): Json<DecodeRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    // Touch session to update last_activity
    let mut sessions_write = sessions.write().await;
    let session = sessions_write.get_mut(&req.session_id).ok_or(StatusCode::NOT_FOUND)?;
    session.touch();

    let max_tokens = req.max_tokens.min(session.max_tokens);
    drop(sessions_write);

    // TODO: Real inference - for now, emit placeholder tokens
    let stream = stream::iter(0..max_tokens)
        .throttle(Duration::from_millis(50))
        .map(move |i| {
            let finished = i == max_tokens - 1;
            let chunk = DecodeChunk {
                token: format!("tok_{}", i),
                finished,
            };
            Ok(Event::default().json_data(chunk).unwrap())
        });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub alive: bool,
    pub active_sessions: usize,
    pub kv_cache_bytes: u64,
}

/// GET /health - Health check endpoint
pub async fn health(State(sessions): State<Sessions>) -> Json<HealthResponse> {
    let sessions_read = sessions.read().await;
    let active_sessions = sessions_read.len();
    let kv_cache_bytes: u64 = sessions_read.values().map(|s| s.kv_cache_bytes).sum();

    Json(HealthResponse {
        alive: true,
        active_sessions,
        kv_cache_bytes,
    })
}
