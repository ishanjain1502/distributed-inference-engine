pub const MAX_CONTEXT_TOKENS: u32 = 2048;
pub const KV_BYTES_PER_TOKEN: u64 = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionBudgetError {
    SessionFullKv,
    SessionFullTokens,
}

pub fn estimate_tokens(text: &str) -> u32 {
    (text.len() / 4).max(1) as u32
}

pub fn estimate_kv_bytes_for_tokens(tokens: u32) -> u64 {
    tokens as u64 * KV_BYTES_PER_TOKEN
}

pub fn check_continue_budget(
    current_tokens: u32,
    current_kv: u64,
    added_tokens: u32,
    max_kv_per_session: u64,
) -> Result<(), SessionBudgetError> {
    let projected_tokens = current_tokens.saturating_add(added_tokens);
    if projected_tokens > MAX_CONTEXT_TOKENS {
        return Err(SessionBudgetError::SessionFullTokens);
    }
    let projected_kv = current_kv.saturating_add(estimate_kv_bytes_for_tokens(added_tokens));
    if projected_kv > max_kv_per_session {
        return Err(SessionBudgetError::SessionFullKv);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_over_token_budget() {
        let err = check_continue_budget(2000, 0, 100, 512 * 1024 * 1024).unwrap_err();
        assert_eq!(err, SessionBudgetError::SessionFullTokens);
    }

    #[test]
    fn rejects_over_kv_budget() {
        let max_kv = 1000;
        let err = check_continue_budget(0, 900, 10, max_kv).unwrap_err();
        assert_eq!(err, SessionBudgetError::SessionFullKv);
    }

    #[test]
    fn accepts_within_budget() {
        assert!(check_continue_budget(10, 5120, 5, 512 * 1024 * 1024).is_ok());
    }
}
