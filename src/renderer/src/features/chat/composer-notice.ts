import { SEND_FAILURE_COPY } from "@shared/store/canonical-sessions-store";
import type { LateDeliveryBox } from "@shared/store/conversation-input-store";
import {
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_LOST_SIGHT_CODE,
	DESKTOP_REFUSAL_CODE,
	RUNTIME_BUSY_CODE,
	RUNTIME_RETIRING_CODE,
} from "../../../../shared/desktop-contract";
import type { ComposerSendError } from "./components/message-input";

/**
 * The composer's notice, decided in ONE place and testable without the pane.
 *
 * WHY THIS IS A FUNCTION RATHER THAN AN OBJECT BUILT INLINE. The pane's notice has
 * three possible sources - a failure this pane just caught, a failure the ROW
 * kept from a send that outlived this component, and the muted statement that a
 * message handed back turned out to be delivered - and the branch between them is
 * where two blockers lived, invisible to every unit test because the tests
 * replaced the pane with a stand-in (review round 1, B3/B4, 16). As a function
 * over plain inputs it is driven directly, and the pane's JSX only renders what it
 * returns.
 *
 * THE RULE, in order:
 *
 * 1. A message that arrived LATE is a statement about one message and nothing
 *    else, so it wins over any failure text still sitting in the row: the user's
 *    text is in the box, the message is in the transcript, and the only true thing
 *    left to say is that it arrived. Muted, and with no controls - there is
 *    nothing to repair and nothing to press (`SEND_FAILURE_COPY.lateDelivery`).
 * 2. A failure THIS pane caught is stated as it was classified: the sentence, the
 *    register, and whether a press of Retry can work, all from `sendFailureCopy`
 *    at the moment of the failure.
 * 3. A failure the ROW kept - this pane mounted after it happened, or was
 *    remounted under it - is stated from the row's own fields. `errorRetry` is
 *    what the classifier decided at the time; a row written before that field
 *    existed falls back to the code (`retryOfferedForFailureCode`), and only a
 *    row with no code at all - an outcome nothing could name - is treated as
 *    pressable, which is the same answer the unknown class gets.
 */
export function composerNoticeFor(input: {
	/** The sentence this pane caught, or null. */
	error: string | null;
	code: string | undefined;
	/** `sendFailureCopy(error).retry` for the failure above. */
	retry: boolean;
	muted: boolean;
	/** The row's own copy of a failure that outlived this component. */
	rowError: string | undefined;
	rowCode: string | undefined;
	/** What the classifier decided for the row's failure, when the row carries it. */
	rowRetry: boolean | undefined;
	/**
	 * The row's note that a handed-back message was delivered after all, and which
	 * box it sits over - the delivered message has come OUT of the composer, or it
	 * is still in there because the user edited inside it (`LateDeliveryBox`).
	 */
	lateDelivered: LateDeliveryBox | undefined;
}): ComposerSendError | undefined {
	if (input.lateDelivered)
		return {
			/*
			 * ONE ROW PER ARM, and the arm picks the sentence rather than the sentence
			 * guessing the arm (design round 9, D17): `delivered` is the arm that never
			 * read the box, so it takes the sentence that is true whatever is in it.
			 */
			message:
				input.lateDelivered === "delivered"
					? SEND_FAILURE_COPY.lateDelivery
					: input.lateDelivered === "draft-only"
						? SEND_FAILURE_COPY.lateDeliveryDraft
						: SEND_FAILURE_COPY.lateDeliveryOverlap,
			muted: true,
			// Announce, do not interrupt: nothing failed, nothing needs repairing, and
			// the reader may be listening to the message that has just been delivered.
			polite: true,
		};
	if (input.error)
		return {
			message: input.error,
			code: input.code,
			/*
			 * MONOTONE, AND THAT IS THE FIX (review/design round 11, R11-1 = D1 = U1). The
			 * carried verdict is STATE and the code is the fact about this failure, so a
			 * carried `true` may only ever REMOVE a press, never add one.
			 *
			 * It could add one, and did: both of main's aside raise sites install a sentence
			 * and a code and never write the flag, and `clearError()` clears the sentence and
			 * the code without it - so one earlier retryable failure left `retry` true and the
			 * `Retry` control rendered over `aside_still_answering`, the arm this branch's own
			 * record calls Clear-only. Asking the code is what the ROW path has always done
			 * (`retryOfferedForFailureCode`, the line below); the notice now agrees with it,
			 * and the classifier can no longer be outvoted by leftover state.
			 */
			retry: input.retry && retryOfferedForFailureCode(input.code),
			muted: input.muted,
		};
	if (input.rowError)
		return {
			message: input.rowError,
			code: input.rowCode,
			retry: input.rowRetry ?? retryOfferedForFailureCode(input.rowCode),
			muted: false,
		};
	return undefined;
}

/**
 * Whether a press can work for a failure the ROW records, read from its code.
 *
 * The fallback for a row that predates `errorRetry` (`ChatDraft.errorRetry`). It
 * answers the same question `sendFailureCopy` answers from the failure itself, and
 * it is deliberately the UNION of the arms that sentence offers a press for: an
 * unknown outcome (no code at all), the transport's own deadline, a lost hop and the
 * two "come back in a moment" refusals. Everything else - the read window, a
 * refusal that states the message was not admitted, a store that could not write,
 * a pairing state, a slash-prefixed draft, a payload too large - is a press that
 * would meet the same refusal, so it is not offered.
 */
/**
 * The notice the PANE shows for a failure IT caught, and the reason it is a function
 * (review round 4, M1).
 *
 * The pane used to classify the failure itself, with the only fact it had - the
 * PRE-SEND row's `admissionAttempted`. That is the off-by-one the round named: an
 * edited payload rotates the request id in the same call the store admits it, so the
 * fact described an id the attempt no longer carried, and the screen showed
 * "Couldn't confirm your message was sent. Sending it again is safe." with a Retry
 * over a body the daemon had just refused - while the row the store wrote said
 * not-sent with Clear only, and a remount flipped the same failure to the daemon's
 * sentence. One failure, two renderings, and only the screen was wrong.
 *
 * So the classification is the STORE's, taken from the row it wrote; `fallback` is
 * used only when there is no row at all (a throw before a draft existed), and it is
 * deliberately fact-less rather than guessed.
 */
export function caughtFailureNotice(input: {
	rowError: string | undefined;
	rowCode: string | undefined;
	rowRetry: boolean | undefined;
	fallback: () => ComposerSendError | undefined;
}): ComposerSendError | undefined {
	if (input.rowError === undefined) return input.fallback();
	return {
		message: input.rowError,
		code: input.rowCode,
		retry: input.rowRetry ?? retryOfferedForFailureCode(input.rowCode),
		muted: false,
	};
}

/**
 * Whether a muted lock answer has outlived the flight it described (review round 5,
 * m5-1, extracted for the pin n5-2 asks for).
 *
 * The answer is a claim about a send that is still out, so it must be on screen only
 * while one is. Three things can hold a flight open, and the row is only one of them:
 * `ChatDraft.pending` exists once an admission has been issued, while the pane's own
 * `admitting` covers the window BEFORE that - a press answered during image decode or
 * an `awaitWindow` had its sentence retired in the same commit - and the approval
 * gate's own lock answers to the question on screen rather than to any flight.
 */
export function lockAnswerOutlived(input: {
	/** `ChatDraft.pending` for this conversation, if it has a row at all. */
	rowPending: boolean;
	/** The pane's own admission flag, set before any row exists. */
	admitting: boolean;
	/** The approval gate the answer may have come from instead. */
	gatePending: boolean;
	/** Whether the notice on screen is the muted lock answer at all. */
	muted: boolean;
}): boolean {
	if (!input.muted) return false;
	return !(input.rowPending || input.admitting || input.gatePending);
}

export function retryOfferedForFailureCode(code: string | undefined): boolean {
	if (code === undefined) return true;
	return RETRYABLE_FAILURE_CODES.has(code);
}

/*
 * The arms a press can actually work for. It is NOT simply `!withholdsRetryHint`:
 * a payload refusal (too large) and a conversation that is gone are in neither list,
 * because the press is not what fixes them and it is not what re-refuses it either -
 * so both are stated here deliberately.
 *
 * `SESSION_UNVALIDATED_CODE` LEFT THIS SET (design round 11, D2) and joined the
 * predicate instead: a window that answers `"failed"` the moment it is asked re-refuses
 * the press and re-paints the same sentence, so offering it is the loop, not a second
 * instruction. Both rules now answer the read window the same way - no press.
 */
const RETRYABLE_FAILURE_CODES = new Set([
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_REFUSAL_CODE.transportFailed,
	DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable,
	RUNTIME_BUSY_CODE,
	RUNTIME_RETIRING_CODE,
]);
