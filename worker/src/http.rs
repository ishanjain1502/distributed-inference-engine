use std::convert::Infallible;
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;
use tracing::{debug, info, warn};

use crate::metrics::metrics;
use crate::state::{check_capacity, Session, Sessions};
use crate::stream::TokenEmitter;

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

/// Error response for capacity exceeded
#[derive(Serialize)]
pub struct CapacityExceededResponse {
    pub error: &'static str,
    pub reason: String,
}

/// POST /prefill - Prefill phase of inference
///
/// Enforces capacity limits:
/// - Max sessions per worker
/// - Max KV cache per session
/// - Max total KV cache
///
/// Fails fast with 503 if limits exceeded.
pub async fn prefill(
    State(sessions): State<Sessions>,
    Json(req): Json<PrefillRequest>,
) -> Result<Json<PrefillResponse>, (StatusCode, Json<CapacityExceededResponse>)> {
    let prefill_start = Instant::now();
    let session_id = req.session_id.clone();

    let kv_cache_bytes = (req.prompt.len() as u64) * 512;

    // Check capacity BEFORE creating session - fail fast
    {
        let sessions_read = sessions.read().await;
        if let Err(capacity_err) = check_capacity(&sessions_read, kv_cache_bytes) {
            warn!(
                session_id = %session_id,
                reason = %capacity_err,
                kv_cache_bytes = kv_cache_bytes,
                "prefill.capacity_exceeded"
            );
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(CapacityExceededResponse {
                    error: "Capacity exceeded",
                    reason: capacity_err.to_string(),
                }),
            ));
        }
    }

    let session = Session {
        prompt: req.prompt,
        model: req.model.clone(),
        max_tokens: req.max_tokens,
        kv_cache_bytes,
        last_activity: Instant::now(),
    };

    // Insert session and update metrics
    {
        let mut sessions_write = sessions.write().await;

        // Double-check capacity with write lock (race condition protection)
        if let Err(capacity_err) = check_capacity(&sessions_write, kv_cache_bytes) {
            warn!(
                session_id = %session_id,
                reason = %capacity_err,
                "prefill.capacity_exceeded_race"
            );
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(CapacityExceededResponse {
                    error: "Capacity exceeded",
                    reason: capacity_err.to_string(),
                }),
            ));
        }

        sessions_write.insert(session_id.clone(), session);

        let total_kv: u64 = sessions_write.values().map(|s| s.kv_cache_bytes).sum();
        let session_count = sessions_write.len() as u64;
        metrics().set_kv_cache_bytes(total_kv);
        metrics().set_active_sessions(session_count);
    }

    let prefill_latency = prefill_start.elapsed();
    metrics().record_prefill(prefill_latency);

    info!(
        session_id = %session_id,
        model = %req.model,
        max_tokens = req.max_tokens,
        kv_cache_bytes = kv_cache_bytes,
        prefill_latency_ms = prefill_latency.as_secs_f64() * 1000.0,
        "session.start"
    );

    Ok(Json(PrefillResponse { status: "ok" }))
}

#[derive(Deserialize)]
pub struct DecodeRequest {
    pub session_id: String,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Copy)]
pub enum DecodeEndReason {
    Complete,
    ClientDisconnect,
    Error,
}

impl std::fmt::Display for DecodeEndReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecodeEndReason::Complete => write!(f, "complete"),
            DecodeEndReason::ClientDisconnect => write!(f, "client_disconnect"),
            DecodeEndReason::Error => write!(f, "error"),
        }
    }
}

pub async fn decode(
    State(sessions): State<Sessions>,
    Json(req): Json<DecodeRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, StatusCode> {
    let session_id = req.session_id.clone();

    let mut sessions_write = sessions.write().await;
    let session = match sessions_write.get_mut(&req.session_id) {
        Some(s) => s,
        None => {
            warn!(session_id = %session_id, "decode.session_not_found");
            return Err(StatusCode::NOT_FOUND);
        }
    };
    session.touch();

    let max_tokens = req.max_tokens.min(session.max_tokens);
    drop(sessions_write);

    let (emitter, rx) = TokenEmitter::new();

    let task_session_id = session_id.clone();
    let task_sessions = sessions.clone();

    tokio::spawn(async move {
        let decode_start = Instant::now();
        let mut tokens_emitted: u32 = 0;
        let mut end_reason = DecodeEndReason::Complete;

        debug!(session_id = %task_session_id, max_tokens = max_tokens, "Starting decode loop");

        for i in 0..max_tokens {
            let token = format!("tok_{}", i);

            match emitter.emit(token).await {
                Ok(seq) => {
                    tokens_emitted += 1;
                    metrics().record_token_decoded().await;
                    debug!(session_id = %task_session_id, seq = seq, "Emitted token");
                }
                Err(_) => {
                    end_reason = DecodeEndReason::ClientDisconnect;
                    warn!(
                        session_id = %task_session_id,
                        tokens_emitted = tokens_emitted,
                        reason = %end_reason,
                        "decode.early_termination"
                    );
                    metrics().record_decode_failure();
                    break;
                }
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        let decode_duration = decode_start.elapsed();
        let tps = if decode_duration.as_secs_f64() > 0.0 {
            tokens_emitted as f64 / decode_duration.as_secs_f64()
        } else {
            0.0
        };

        info!(
            session_id = %task_session_id,
            tokens_emitted = tokens_emitted,
            decode_duration_ms = decode_duration.as_secs_f64() * 1000.0,
            decode_tps = tps,
            reason = %end_reason,
            "session.end"
        );

        let sessions_read = task_sessions.read().await;
        let total_kv: u64 = sessions_read.values().map(|s| s.kv_cache_bytes).sum();
        let session_count = sessions_read.len() as u64;
        metrics().set_kv_cache_bytes(total_kv);
        metrics().set_active_sessions(session_count);
    });

    let stream = ReceiverStream::new(rx).map(|msg| {
        Ok(Event::default().json_data(msg).unwrap())
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub alive: bool,
    pub active_sessions: usize,
    pub kv_cache_bytes: u64,
}

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
