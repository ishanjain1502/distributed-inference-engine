pub const MAX_CONTEXT_TOKENS: u32 = 2048;
pub const KV_BYTES_PER_TOKEN: u64 = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionBudgetError {
    SessionFullKv,
    SessionFullTokens,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContinueReservation {
    pub tokens: u32,
    pub kv_bytes: u64,
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

pub fn reserve_continue_budget(
    current_tokens: &mut u32,
    current_kv: &mut u64,
    added_tokens: u32,
    max_kv_per_session: u64,
) -> Result<ContinueReservation, SessionBudgetError> {
    check_continue_budget(
        *current_tokens,
        *current_kv,
        added_tokens,
        max_kv_per_session,
    )?;

    let reservation = ContinueReservation {
        tokens: added_tokens,
        kv_bytes: estimate_kv_bytes_for_tokens(added_tokens),
    };
    *current_tokens += reservation.tokens;
    *current_kv += reservation.kv_bytes;
    Ok(reservation)
}

pub fn rollback_continue_budget(
    current_tokens: &mut u32,
    current_kv: &mut u64,
    reservation: ContinueReservation,
) {
    *current_tokens = current_tokens.saturating_sub(reservation.tokens);
    *current_kv = current_kv.saturating_sub(reservation.kv_bytes);
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

    #[test]
    fn reserves_continue_budget_atomically() {
        let mut tokens = 10;
        let mut kv_bytes = 5120;

        let reservation =
            reserve_continue_budget(&mut tokens, &mut kv_bytes, 5, 512 * 1024 * 1024).unwrap();

        assert_eq!(reservation.tokens, 5);
        assert_eq!(reservation.kv_bytes, 2560);
        assert_eq!(tokens, 15);
        assert_eq!(kv_bytes, 7680);
    }

    #[test]
    fn failed_reservation_does_not_mutate_budget() {
        let mut tokens = 2040;
        let mut kv_bytes = 5120;

        let result = reserve_continue_budget(&mut tokens, &mut kv_bytes, 10, 512 * 1024 * 1024);

        assert_eq!(result, Err(SessionBudgetError::SessionFullTokens));
        assert_eq!(tokens, 2040);
        assert_eq!(kv_bytes, 5120);
    }
}
