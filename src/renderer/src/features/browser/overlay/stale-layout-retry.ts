/** Four frame-spaced retries: about 67 ms at 60 Hz (round 3, U19). */
export const STALE_LAYOUT_ATTEMPTS = 4;

/**
 * The retry budget after one outcome, as a pure decision so the reset rule can
 * be exercised without a frame loop.
 *
 * A `stale_layout` refusal consumes one attempt and forces one re-projection
 * until the budget is spent; a REAL projection change (the signature differs)
 * starts a new budget even when it lands while a forced retry is pending. After
 * the budget is spent, identical frames idle rather than poll.
 */
export function nextStaleAttempt(state: {
	attempts: number;
	refused: boolean;
	signatureChanged: boolean;
}): { attempts: number; retry: boolean } {
	if (state.signatureChanged) return { attempts: 0, retry: false };
	if (!state.refused) return { attempts: 0, retry: false };
	if (state.attempts >= STALE_LAYOUT_ATTEMPTS)
		return { attempts: state.attempts, retry: false };
	return { attempts: state.attempts + 1, retry: true };
}
