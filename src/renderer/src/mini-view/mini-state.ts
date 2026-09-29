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

/**
 * HOW A MESSAGE WAS PRODUCED (arch §4.2), the mini's half of the composer's
 * `input_mode`: `dictated` for a message only a transcript put there, `typed`
 * for one only the keyboard did, `mixed` for both — since the box last
 * emptied. `undefined` when the harness has not advertised
 * `features.input_mode`: the wire drops the field entirely, which is the
 * legacy body an older harness validates with `extra="forbid"`.
 *
 * Pure, and here rather than in the component so the derivation is driven
 * without a DOM (the same discipline as the transitions above): the composer
 * reads the two booleans off its refs at the press and passes the gate's own
 * answer in — `features.input_mode`, resolved from the capability map the
 * seat resolution already read.
 */
export type MiniInputMode = "typed" | "dictated" | "mixed";

export function wireInputMode(
	enabled: boolean,
	sawTyping: boolean,
	sawDictation: boolean,
): MiniInputMode | undefined {
	if (!enabled) return undefined;
	if (!sawDictation) return "typed";
	return sawTyping ? "mixed" : "dictated";
}

export const miniTransitions = {
	/**
	 * A seat resolution answered with a usable conversation.
	 *
	 * A STANDING RETRYABLE REFUSAL SURVIVES IT (QA round 1, Q1): the sentence a
	 * pre-admission send failure put up — "still here, retry" — names a fact
	 * that has not changed, and Retry is the only in-window recovery §E.2/§E.4
	 * provide. The natural re-summon gesture re-resolves the seat, so without
	 * this guard pressing the hotkey again ERASED the refusal and disabled Send,
	 * leaving the draft's only way out a hide plus another summon. The gate and
	 * the notice are different facts, so the gate moves and the notice stays.
	 */
	seatReady(state: MiniViewState): MiniViewState {
		if (state.retryable && state.notice !== null)
			return { ...state, seat: "ready" };
		return { ...state, seat: "ready", notice: null, retryable: false };
	},

	/**
	 * A seat resolution refused, with the sentence that says why.
	 *
	 * Preserves a standing retryable refusal the same way `seatReady` does (QA
	 * round 1, Q1): a re-resolution that fails again must not replace the
	 * sentence the reader was already acting on with a second opinion on the
	 * same outage — Retry stays, and its next press re-resolves anyway.
	 */
	seatBlocked(state: MiniViewState, sentence: string): MiniViewState {
		if (state.retryable && state.notice !== null)
			return { ...state, seat: "blocked" };
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
