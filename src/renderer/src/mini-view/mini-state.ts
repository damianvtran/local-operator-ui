/**
 * The mini composer's state machine — pure, so the desktop suite drives every
 * transition without a DOM and the component stays a drawing of it.
 *
 * WHY A MACHINE AND NOT `useState` CLUSTERS. The interaction has four sends
 * (idle, in flight, sent, refused) crossed with three seat answers (pending,
 * ready, blocked) and two dictation phases, and the pairs that matter are the
 * illegal ones: pressing Send twice, letting a second send start while the
 * "Sent" flash is up, retrying a message that may already have landed, or
 * offering Retry for a refusal that never reached the admission gate. Writing
 * those as booleans beside a component is how each of them ships; writing them
 * as transitions here means the suite can name each one.
 *
 * THE ONE INVARIANT WORTH STATING: `canSend` is false while the machine is
 * `sending` or `sent`, and while the seat is `blocked` — and Retry is offered
 * ONLY for a refusal classified as pre-admission (`retryable`), because a
 * post-admission failure may already be in the conversation and a Retry over
 * it would send twice (see `SEND_FAILURE_COPY`'s own note and
 * `isRefusedBeforeAdmission`).
 */

/** The send path's phase. `error` keeps the draft; it never clears it. */
export type MiniSendPhase = "idle" | "sending" | "sent" | "error";

/** The seat gate: pending until a resolution answers, then ready or blocked. */
export type MiniSeatGate = "pending" | "ready" | "blocked";

export interface MiniViewState {
	send: MiniSendPhase;
	seat: MiniSeatGate;
	/** The sentence under the composer, when there is one to show. */
	notice: string | null;
	/** Whether the current notice is a pre-admission refusal (Retry offered). */
	retryable: boolean;
}

export const MINI_INITIAL_STATE: MiniViewState = {
	send: "idle",
	seat: "pending",
	notice: null,
	retryable: false,
};

/**
 * Whether a press of Send may start a send right now, for the given draft.
 *
 * The seat being `pending` does NOT block the press: the press awaits the
 * in-flight resolution and proceeds when it answers `ready`, which is what
 * makes the first press after a summon feel immediate rather than gated on a
 * round trip nobody asked for. `blocked` is the only seat answer that refuses.
 */
export function canSend(state: MiniViewState, text: string): boolean {
	if (state.send === "sending" || state.send === "sent") return false;
	if (state.seat === "blocked") return false;
	return text.trim().length > 0;
}

/** Whether the message box accepts edits. Every phase but `sending` does. */
export function isEditable(state: MiniViewState): boolean {
	return state.send !== "sending";
}

export const miniTransitions = {
	/** A seat resolution answered with a usable conversation. */
	seatReady(state: MiniViewState): MiniViewState {
		return { ...state, seat: "ready", notice: null, retryable: false };
	},

	/** A seat resolution refused, with the sentence that says why. */
	seatBlocked(state: MiniViewState, sentence: string): MiniViewState {
		return { ...state, seat: "blocked", notice: sentence, retryable: false };
	},

	/**
	 * Retry, after a seat refusal: the gate goes back to pending so the NEXT
	 * send re-resolves instead of spending itself against the cached refusal.
	 * The caller clears its own cached id; this only states the gate's answer is
	 * no longer current. Notice and phase are left alone — the sentence that
	 * explains the refusal is still true until a resolution replaces it.
	 */
	seatRetry(state: MiniViewState): MiniViewState {
		return { ...state, seat: "pending" };
	},

	/** The send path has begun. */
	sendStarted(state: MiniViewState): MiniViewState {
		return { ...state, send: "sending", notice: null, retryable: false };
	},

	/** The message was admitted; the "Sent" flash is up. */
	sendSucceeded(state: MiniViewState): MiniViewState {
		return { ...state, send: "sent", notice: null, retryable: false };
	},

	/**
	 * The send failed or was refused. `retryable` is the classifier's answer
	 * and is never guessed here.
	 */
	sendFailed(
		state: MiniViewState,
		sentence: string,
		retryable: boolean,
	): MiniViewState {
		return { ...state, send: "error", notice: sentence, retryable };
	},

	/**
	 * A dismissal of the notice (the Retry press runs this before re-sending,
	 * so a failed retry replaces the notice rather than stacking).
	 */
	clearNotice(state: MiniViewState): MiniViewState {
		if (state.notice === null) return state;
		return { ...state, notice: null, retryable: false };
	},

	/**
	 * A re-summon. Only the "Sent" flash resets, and only the flash: the draft
	 * survives hide by design (§C.1), and a standing error notice keeps
	 * standing because the failure it names has not changed.
	 */
	summoned(state: MiniViewState): MiniViewState {
		if (state.send !== "sent") return state;
		return { ...state, send: "idle" };
	},
};
