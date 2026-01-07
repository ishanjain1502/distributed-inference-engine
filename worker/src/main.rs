mod cache;
mod http;
mod state;

use axum::Router;
use tracing::info;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app = Router::new()
        .route("/worker/prefill", axum::routing::post(http::prefill))
        .route("/worker/decode", axum::routing::post(http::decode))
        .route("/worker/health", axum::routing::get(http::health));

    let addr = "0.0.0.0:3001";
    info!("Worker listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

