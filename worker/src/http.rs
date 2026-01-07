use axum::http::StatusCode;

/// POST /prefill - Prefill phase of inference
pub async fn prefill() -> StatusCode {
    StatusCode::OK
}

/// POST /decode - Decode phase of inference
pub async fn decode() -> StatusCode {
    StatusCode::OK
}

/// GET /health - Health check endpoint
pub async fn health() -> StatusCode {
    StatusCode::OK
}

