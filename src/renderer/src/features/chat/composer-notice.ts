import {
	SEND_FAILURE_COPY,
	SESSION_UNVALIDATED_CODE,
} from "@shared/store/canonical-sessions-store";
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
	/** The row's note that a handed-back message was delivered after all. */
	lateDelivered: boolean;
}): ComposerSendError | undefined {
	if (input.lateDelivered)
		return { message: SEND_FAILURE_COPY.lateDelivery, muted: true };
	if (input.error)
		return {
			message: input.error,
			code: input.code,
			retry: input.retry,
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
 * unknown outcome (no code at all), the transport's own deadline, a lost hop, the
 * two "come back in a moment" refusals and the read window. Everything else - a
 * refusal that states the message was not admitted, a store that could not write,
 * a pairing state, a slash-prefixed draft, a payload too large - is a press that
 * would meet the same refusal, so it is not offered.
 */
export function retryOfferedForFailureCode(code: string | undefined): boolean {
	if (code === undefined) return true;
	return RETRYABLE_FAILURE_CODES.has(code);
}

const RETRYABLE_FAILURE_CODES = new Set([
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_REFUSAL_CODE.transportFailed,
	DESKTOP_LOST_SIGHT_CODE.runtimeUnreachable,
	RUNTIME_BUSY_CODE,
	RUNTIME_RETIRING_CODE,
	SESSION_UNVALIDATED_CODE,
]);
