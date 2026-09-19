import {
	type WebauthnChoiceRequest,
	type WebauthnSettledOutcome,
	settledChooserCopy,
} from "./webauthn-chooser";

/**
 * What the chooser panel is showing, as one value rather than two flags.
 *
 * WHY THIS IS A DISCRIMINATED UNION AND NOT A `notice` SLOT BESIDE A `request`.
 * Round 1 shipped a single `notice` and a queue, and the two could disagree: with
 * two requests queued, the OLDEST expiring set the notice, the panel rendered the
 * ending *instead of* the newer request's rows, and the only button on screen —
 * the ending's Close — ran the live branch's `answer(current.requestId, null)`,
 * cancelling a passkey request the user had never been shown (agent review round
 * 2, R1 MAJOR, reproduced against the branch's own component). The defect was
 * structural: one state value carried the ending while the component kept a live
 * request in reach, so a press meant to acknowledge an ending could answer
 * something else.
 *
 * THE RULE THIS ENCODES, and it is the whole reason the type exists:
 *
 *   what is on screen is ALWAYS the request the user can actually answer, and an
 *   ending may never hide or cancel a live request.
 *
 * A live request therefore always wins over a pending ending (the ending waits
 * its turn and is shown once nothing is answerable), and the `ending` branch
 * carries no request to answer at all — the panel the user presses Close on has
 * nothing in it that a dismissal could settle.
 *
 * The ordering rule is also why the queue is offered OLDEST FIRST: the request
 * closest to its deadline is the one on screen, and the ones behind it are
 * counted rather than swapped in.
 */

/** An ending waiting to be acknowledged. Its own request id is here for the
 * mirror's bookkeeping; the PANEL type is what keeps it out of the dialog's
 * reach. */
export interface WebauthnEnding {
	requestId: string;
	title: string;
	body: string;
}

export type WebauthnPanel =
	| { kind: "none" }
	| {
			kind: "request";
			request: WebauthnChoiceRequest;
			/** Requests waiting behind this one, which are named, not hidden. */
			waitingBehind: number;
			/** True while an answer to a request is in flight. */
			answering: boolean;
	  }
	| { kind: "ending"; title: string; body: string };

export interface ChooserPanelInput {
	/** Main's pending requests, oldest first, as the mirror holds them. */
	requests: readonly WebauthnChoiceRequest[];
	/** The newest ending nobody has acknowledged yet, or null. */
	ending: WebauthnEnding | null;
	answering: boolean;
}

/** The one value the dialog renders. See the header for the rule it encodes. */
export function chooserPanel(input: ChooserPanelInput): WebauthnPanel {
	const request = input.requests[0];
	if (request) {
		return {
			kind: "request",
			request,
			waitingBehind: Math.max(0, input.requests.length - 1),
			answering: input.answering,
		};
	}
	if (input.ending) {
		return {
			kind: "ending",
			title: input.ending.title,
			body: input.ending.body,
		};
	}
	return { kind: "none" };
}

/**
 * The ending a settled request leaves behind, or null for the endings the user
 * caused themselves.
 *
 * `chosen` and `dismissed` are the user's own act and need no paragraph; the rest
 * ended without them and are explained. Null also covers an outcome main does not
 * define, so an unknown value cannot render an empty panel.
 */
export function endingFor(
	requestId: string,
	outcome: WebauthnSettledOutcome,
): WebauthnEnding | null {
	const copy = settledChooserCopy(outcome);
	if (!copy) return null;
	return { requestId, title: copy.title, body: copy.body };
}
