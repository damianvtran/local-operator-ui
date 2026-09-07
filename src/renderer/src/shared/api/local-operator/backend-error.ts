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
 *
 * Every sentence here names something the USER can do. `unreachable` used to
 * read "Retry once it has started.", which is the most common of the five
 * conditions and the only one that asked the user to wait for an event they
 * have no way to cause -- while the `unauthorized` sentence beside it states
 * plainly that the app starts the server itself (design D5). Restarting the
 * app is the action that actually reaches the stated outcome.
 *
 * ## The noun is "the Local Operator server"
 *
 * One process, one name. These sentences render alongside the connectivity
 * banner ("The server is offline.") and the providers header, and a viewport
 * previously showed "server" and "backend" naming the same process (design
 * D7). "backend" is the implementation's word; branding.md section 8 forbids a
 * jargon noun where an everyday one works. Full name on a surface's first
 * mention, "the server" thereafter -- which is why the diagnosis strings below
 * carry the long form and these remedies carry the short one.
 *
 * The "Update backend" BUTTON keeps its label: it names a distinct installable
 * artifact rather than the running process, and it is a control, not prose.
 */
export const BACKEND_ERROR_REMEDY: Record<BackendErrorKind, string> = {
	unreachable: "Restart the app so it can start its own server.",
	unauthorized: "Restart the app so it starts and pairs with its own server.",
	outdated: "Update the server and try again.",
	unknown: "",
};

/**
 * What each outcome says the server is doing, in the user's terms.
 *
 * Split from the remedy because a surface pairs its OWN lead sentence ("Your
 * settings could not be loaded.", "Providers could not be loaded.") with this
 * shared middle and the shared remedy above. The scope differs per surface;
 * the diagnosis and the action must not.
 *
 * Empty for `unknown`, for the same reason the remedy is: a status we cannot
 * advise on gets the surface's lead sentence and nothing more.
 */
export const BACKEND_ERROR_DIAGNOSIS: Record<BackendErrorKind, string> = {
	unreachable: "The Local Operator server is not answering.",
	unauthorized:
		"This app cannot authenticate to the running Local Operator server.",
	// "may need an update" hedged while the sentence after it issued a command
	// (design D9). 404 on the desktop route is not a "may": it is the ONLY
	// status an update repairs, and the confidence of the diagnosis has to match
	// the confidence of the imperative.
	outdated: "The Local Operator server is older than this app expects.",
	unknown: "",
};

/**
 * The sentence a surface renders when a load failed because of the server.
 *
 * `lead` is the only per-surface part -- what could not be loaded, in that
 * surface's scope. Everything after it is shared, so two surfaces reporting
 * one fault cannot describe it differently or point at different actions.
 * That agreement is the whole point of this module, and routing every surface
 * through one function is what makes it structural rather than a convention.
 *
 * ## Severity: these are `warning`, not `danger`
 *
 * Every surface that renders this string offers a Retry beside it, and none of
 * the four outcomes has lost the user anything. Settings previously rendered
 * `danger` while the providers grid rendered `warning` for the same underlying
 * fact, so the hue encoded which screen you were on rather than how bad it was
 * (design D8). branding.md section 2 authors four separable semantics so a user
 * can read severity off hue; `danger` here is reserved for a failure the user
 * cannot recover from in place.
 */
export function backendLoadErrorMessage(lead: string, error: unknown): string {
	const kind = backendErrorKind(error);
	return [lead, BACKEND_ERROR_DIAGNOSIS[kind], BACKEND_ERROR_REMEDY[kind]]
		.filter(Boolean)
		.join(" ");
}

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
			return `${BACKEND_ERROR_DIAGNOSIS.unreachable} Provider sign-in, settings, slash commands and MCP management need it running. ${BACKEND_ERROR_REMEDY.unreachable}`;
		if (kind === "unauthorized")
			// "protected controls are unavailable" was jargon two sentences away
			// from this file's own plain list of the same surfaces (design D10).
			return `This app cannot authenticate to the running Local Operator server, so provider sign-in, settings, slash commands and MCP management are unavailable. ${BACKEND_ERROR_REMEDY.unauthorized}`;
		if (kind === "outdated")
			// The trailing clause read "stay off until then", whose antecedent left
			// with the remedy when it was extracted into the shared sentence --
			// nothing before it named a time or an event (design D4). Binding the
			// consequence to the diagnosis with "so" removes the dangling referent
			// rather than restating the remedy in a second set of words, which is
			// what lets a test assert the two surfaces agree by string.
			return `The Local Operator server is older than this app expects, so provider sign-in, settings, slash commands and MCP management are off. ${BACKEND_ERROR_REMEDY.outdated}`;
	}
	if (unpaired)
		return "This app is not paired with the running Local Operator server, so provider sign-in, settings, slash commands and MCP management are unavailable. Restart the app so it can manage its own server.";
	if (!answered)
		// Nothing answered and the status matched no case we can advise on. The
		// old fallback claimed the backend was "missing" every negotiated feature
		// -- inferred purely from the absence of a payload -- and offered an
		// install, so a backend that was running, current and merely erroring got
		// the same several-minute remedy as one that predates the contract. State
		// the failure and stop.
		return "Provider sign-in, settings, slash commands and MCP management are unavailable because the Local Operator server did not answer as expected.";
	return `The Local Operator server is missing ${missing.join(", ")} support. Update it to enable those surfaces.`;
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
