use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::mpsc;

pub const TOKEN_CHANNEL_CAPACITY: usize = 32;

#[derive(Debug, Clone, serde::Serialize)]
pub struct TokenMessage {
    pub token: String,
    pub seq: u64,
}

pub struct TokenEmitter {
    tx: mpsc::Sender<TokenMessage>,
    seq: AtomicU64,
}

impl TokenEmitter {
    pub fn new() -> (Self, mpsc::Receiver<TokenMessage>) {
        let (tx, rx) = mpsc::channel(TOKEN_CHANNEL_CAPACITY);
        let emitter = Self {
            tx,
            seq: AtomicU64::new(0),
        };
        (emitter, rx)
    }

    pub async fn emit(&self, token: String) -> Result<u64, mpsc::error::SendError<TokenMessage>> {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst);
        let msg = TokenMessage { token, seq };
        self.tx.send(msg).await?;
        Ok(seq)
    }

    pub fn next_seq(&self) -> u64 {
        self.seq.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_token_emitter_sequence() {
        let (emitter, mut rx) = TokenEmitter::new();

        emitter.emit("hello".to_string()).await.unwrap();
        emitter.emit("world".to_string()).await.unwrap();

        let msg1 = rx.recv().await.unwrap();
        assert_eq!(msg1.seq, 0);
        assert_eq!(msg1.token, "hello");

        let msg2 = rx.recv().await.unwrap();
        assert_eq!(msg2.seq, 1);
        assert_eq!(msg2.token, "world");
    }

    #[tokio::test]
    async fn test_backpressure() {
        let (tx, mut rx) = mpsc::channel::<TokenMessage>(2);
        let emitter = TokenEmitter {
            tx,
            seq: AtomicU64::new(0),
        };

        emitter.emit("a".to_string()).await.unwrap();
        emitter.emit("b".to_string()).await.unwrap();

        let emit_handle = tokio::spawn(async move {
            emitter.emit("c".to_string()).await.unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(!emit_handle.is_finished());

        rx.recv().await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(emit_handle.is_finished());
    }
}
