/**
 * One classification of "what is wrong with the backend", and one sentence per
 * outcome, shared by every surface that reports it.
 *
 * Two surfaces read the same `DesktopControlError.status` and each drew its own
 * conclusion from it. The compatibility banner split it three ways; the
 * providers grid split it two, so a rejected bearer (401/403) fell into the
 * grid's `else` and told the user "the backend may need an update" while the
 * banner told them to restart and re-pair -- and deliberately withheld its
 * update button, because installing a newer backend cannot fix a bearer the
 * running one refuses. Sending a user through a several-minute install that
 * cannot repair their fault is the exact defect this change set exists to
 * remove; it had simply moved from "offline" to "unauthorized".
 *
 * The fix is structural rather than a third copy of the same `if`: the status
 * is classified ONCE here, and both surfaces render sentences that also live
 * here. Neither can drift from the other without changing this file, and the
 * agreement is assertable because both selectors are plain functions.
 */

import { DesktopControlError } from "./desktop-api";

/**
 * What a failed desktop control says about the backend, in terms of the ONE
 * thing the user has to do about it.
 *
 * Deliberately named for the user's remedy rather than the HTTP status,
 * because the remedy is what the two surfaces disagreed about. `unknown` is a
 * real member, not a default: it means the status matched no case we can
 * advise on, and the copy for it must therefore assert no remedy at all.
 */
export type BackendErrorKind =
	| "unreachable"
	| "unauthorized"
	| "outdated"
	| "unknown";

/**
 * Classify a desktop control failure by the remedy it calls for.
 *
 * - `null` means the request produced no HTTP status: a rejected IPC call, a
 *   dead dev proxy, or the transport's stalled-request deadline. No backend
 *   was reached.
 * - 503 is the main process's own "could not complete this request", which is
 *   what a backend that is down or refusing work produces.
 * - 401/403 mean a backend answered and refused this app's bearer, so it is
 *   running and current -- only the pairing is broken.
 * - 404 means the route is absent, so this backend predates the desktop
 *   contract. It is the ONLY status a backend update repairs.
 *
 * Anything else is `unknown` on purpose. The previous fallback asserted the
 * update remedy for every unmatched status, so a 500 -- a backend that is
 * running, current and merely erroring -- was answered with an install.
 */
export function backendErrorKind(error: unknown): BackendErrorKind {
	const status = error instanceof DesktopControlError ? error.status : null;
	if (status === null || status === 503) return "unreachable";
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 404) return "outdated";
	return "unknown";
}

/**
 * The action sentence for each outcome, shared verbatim by every surface.
 *
 * `unknown` carries no remedy because we have not established one; a surface
 * renders its diagnosis alone rather than guessing. That is the status-neutral
 * fallback the two-way split lacked.
 */
export const BACKEND_ERROR_REMEDY: Record<BackendErrorKind, string> = {
	unreachable: "Retry once it has started.",
	unauthorized: "Restart the app so it starts and pairs with its own backend.",
	outdated: "Update the backend and try again.",
	unknown: "",
};

/**
 * Whether installing a newer backend is actually the remedy.
 *
 * The banner gates its "Update backend" button on this. It is stated here
 * beside the classification instead of as a chain of negated booleans at the
 * call site, because "which states does update fix" is the same question the
 * copy answers, and the button must not contradict the sentence above it.
 *
 * Takes the same inputs as `backendCompatibilityMessage` so the two are read
 * off one state rather than two. `unpaired` is not status-derived -- it is a
 * backend that answered fine while this app holds no bearer for it -- and a
 * status only classifies anything when nothing answered, which is why
 * `answered` gates the classification rather than being folded into it.
 */
export function backendUpdateIsRemedy(input: {
	kind: BackendErrorKind;
	unpaired: boolean;
	answered: boolean;
}): boolean {
	const { kind, unpaired, answered } = input;
	// Re-pairing, not installing, is what an unpaired backend needs.
	if (unpaired) return false;
	// A backend that answered and named the features it lacks is genuinely out
	// of date; that is the negotiated case, not a guess from a missing payload.
	if (answered) return true;
	// `unknown` deliberately does NOT offer the update. It used to, because the
	// fallback sentence was the update sentence, so every unmatched status was
	// answered with an install that could not fix it.
	return kind === "outdated";
}

/**
 * The compatibility banner's sentence.
 *
 * Extracted from the component so the copy sits beside the classification that
 * selects it, and so a test can assert the banner and the providers grid agree
 * by calling both shipped selectors rather than restating either. The wording
 * is unchanged from when it lived in the component: this reorganises where the
 * decision is made, not what the user reads.
 *
 * The banner names the surfaces that stop working because it is the app-wide
 * notice; the grid speaks only about providers. Both end on the same remedy
 * sentence, which is the part that has to match.
 */
export function backendCompatibilityMessage(input: {
	kind: BackendErrorKind;
	/** A backend answered, but this app did not start it and holds no bearer. */
	unpaired: boolean;
	/** Negotiated features the backend does not advertise. */
	missing: readonly string[];
	/** True once a capabilities payload was received at all. */
	answered: boolean;
}): string {
	const { kind, unpaired, missing, answered } = input;
	if (!answered) {
		if (kind === "unreachable")
			return `The backend is not answering. Provider sign-in, settings, slash commands and MCP management need it running. ${BACKEND_ERROR_REMEDY.unreachable}`;
		if (kind === "unauthorized")
			return `This app cannot authenticate to the running backend, so protected controls are unavailable. ${BACKEND_ERROR_REMEDY.unauthorized}`;
		if (kind === "outdated")
			// The trailing clause was "stay off until it is updated", which said
			// the remedy in a second set of words. Ending on the shared sentence
			// instead is what lets a test assert the two surfaces agree by string
			// rather than by a human reading both and judging them equivalent.
			return `This backend is older than the app expects. Provider sign-in, settings, slash commands and MCP management stay off until then. ${BACKEND_ERROR_REMEDY.outdated}`;
	}
	if (unpaired)
		return "This app is not paired with the running backend, so protected controls are unavailable. Restart the app so it can manage its own backend.";
	if (!answered)
		// Nothing answered and the status matched no case we can advise on. The
		// old fallback claimed the backend was "missing" every negotiated feature
		// -- inferred purely from the absence of a payload -- and offered an
		// install, so a backend that was running, current and merely erroring got
		// the same several-minute remedy as one that predates the contract. State
		// the failure and stop.
		return "Provider sign-in, settings, slash commands and MCP management are unavailable because the backend did not answer as expected.";
	return `The backend is missing ${missing.join(", ")} support. Update it to enable those surfaces.`;
}

/**
 * Whether a failed desktop query is worth asking again.
 *
 * React Query's default `retry: 1` charges the full renderer deadline twice for
 * a request that never gets an answer: the stalled-IPC shape cost 30s, then
 * another 30s, so a user watched an unbroken spinner for ~60s before the error
 * state could render. That is the symptom issue 89 was reported for, merely
 * bounded -- a user who gave up at 45s before still gives up at 45s.
 *
 * The distinction that matters is whether anything answered. A `status: null`
 * failure means the deadline expired or the transport never reached a backend;
 * we already waited the entire budget and learned nothing, and a second
 * identical wait cannot learn more. Every other failure came from a backend
 * that DID answer -- a 503 from a reachable process is a genuine transient --
 * so those keep the default single retry.
 */
export function retryDesktopQuery(
	failureCount: number,
	// Typed as `Error` rather than `unknown` to match React Query's default
	// `TError`: a wider parameter here makes the whole query's error type infer
	// as `{}`, and callers lose `error.message`.
	error: Error,
): boolean {
	if (error instanceof DesktopControlError && error.status === null)
		return false;
	return failureCount < 1;
}
