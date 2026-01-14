use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::RwLock;
use tracing::info;

static METRICS: once_cell::sync::Lazy<Metrics> = once_cell::sync::Lazy::new(Metrics::new);

pub fn metrics() -> &'static Metrics {
    &METRICS
}

pub struct Metrics {
    prefill_count: AtomicU64,
    prefill_latency_us_sum: AtomicU64,
    last_prefill_latency_us: AtomicU64,
    tokens_decoded: AtomicU64,
    decode_failures: AtomicU64,
    kv_cache_bytes: AtomicU64,
    active_sessions: AtomicU64,
    tps_tracker: RwLock<TpsTracker>,
}

impl Metrics {
    fn new() -> Self {
        Self {
            prefill_count: AtomicU64::new(0),
            prefill_latency_us_sum: AtomicU64::new(0),
            last_prefill_latency_us: AtomicU64::new(0),
            tokens_decoded: AtomicU64::new(0),
            decode_failures: AtomicU64::new(0),
            kv_cache_bytes: AtomicU64::new(0),
            active_sessions: AtomicU64::new(0),
            tps_tracker: RwLock::new(TpsTracker::new()),
        }
    }

    pub fn record_prefill(&self, latency: Duration) {
        let latency_us = latency.as_micros() as u64;
        self.prefill_count.fetch_add(1, Ordering::Relaxed);
        self.prefill_latency_us_sum.fetch_add(latency_us, Ordering::Relaxed);
        self.last_prefill_latency_us.store(latency_us, Ordering::Relaxed);
    }

    pub fn last_prefill_latency_ms(&self) -> f64 {
        self.last_prefill_latency_us.load(Ordering::Relaxed) as f64 / 1000.0
    }

    pub fn avg_prefill_latency_ms(&self) -> f64 {
        let count = self.prefill_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let sum = self.prefill_latency_us_sum.load(Ordering::Relaxed);
        (sum as f64 / count as f64) / 1000.0
    }

    pub async fn record_token_decoded(&self) {
        self.tokens_decoded.fetch_add(1, Ordering::Relaxed);
        self.tps_tracker.write().await.record_token();
    }

    pub fn record_decode_failure(&self) {
        self.decode_failures.fetch_add(1, Ordering::Relaxed);
    }

    pub async fn decode_tps(&self) -> f64 {
        self.tps_tracker.read().await.tps()
    }

    pub fn total_tokens_decoded(&self) -> u64 {
        self.tokens_decoded.load(Ordering::Relaxed)
    }

    pub fn decode_failure_count(&self) -> u64 {
        self.decode_failures.load(Ordering::Relaxed)
    }

    pub fn set_kv_cache_bytes(&self, bytes: u64) {
        self.kv_cache_bytes.store(bytes, Ordering::Relaxed);
    }

    pub fn kv_cache_bytes(&self) -> u64 {
        self.kv_cache_bytes.load(Ordering::Relaxed)
    }

    pub fn set_active_sessions(&self, count: u64) {
        self.active_sessions.store(count, Ordering::Relaxed);
    }

    pub fn active_sessions(&self) -> u64 {
        self.active_sessions.load(Ordering::Relaxed)
    }

    pub async fn emit_metrics_log(&self) {
        let tps = self.decode_tps().await;
        info!(
            prefill_latency_ms = self.last_prefill_latency_ms(),
            avg_prefill_latency_ms = self.avg_prefill_latency_ms(),
            decode_tps = tps,
            tokens_decoded = self.total_tokens_decoded(),
            decode_failures = self.decode_failure_count(),
            kv_cache_bytes = self.kv_cache_bytes(),
            active_sessions = self.active_sessions(),
            "worker.metrics"
        );
    }
}

struct TpsTracker {
    window: Vec<(Instant, u64)>,
    window_duration: Duration,
}

impl TpsTracker {
    fn new() -> Self {
        Self {
            window: Vec::with_capacity(100),
            window_duration: Duration::from_secs(5),
        }
    }

    fn record_token(&mut self) {
        let now = Instant::now();
        self.window.push((now, 1));
        self.prune_old();
    }

    fn prune_old(&mut self) {
        let cutoff = Instant::now() - self.window_duration;
        self.window.retain(|(t, _)| *t > cutoff);
    }

    fn tps(&self) -> f64 {
        if self.window.is_empty() {
            return 0.0;
        }

        let total_tokens: u64 = self.window.iter().map(|(_, c)| c).sum();
        let elapsed = match (self.window.first(), self.window.last()) {
            (Some((first, _)), Some((last, _))) => {
                let dur = last.duration_since(*first);
                if dur.is_zero() {
                    Duration::from_secs(1)
                } else {
                    dur
                }
            }
            _ => Duration::from_secs(1),
        };

        total_tokens as f64 / elapsed.as_secs_f64()
    }
}

pub async fn run_metrics_loop() {
    let interval = Duration::from_secs(10);
    let mut ticker = tokio::time::interval(interval);

    info!(interval_secs = interval.as_secs(), "Starting metrics emission loop");

    loop {
        ticker.tick().await;
        metrics().emit_metrics_log().await;
    }
}
