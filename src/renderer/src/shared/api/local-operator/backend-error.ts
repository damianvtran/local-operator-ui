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

import type { DaemonPairingCause } from "../../../../../shared/backend-status";
import { pairingHasRemedy } from "../../../../../shared/backend-status";
import type { DesktopCapabilities } from "../../../../../shared/desktop-contract";
import { DesktopControlError, isDeadlineExceeded } from "./desktop-api";

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
	| "deadline"
	| "unauthorized"
	| "outdated"
	| "unknown";

/**
 * Classify a desktop control failure by the remedy it calls for.
 *
 * - `deadline` is the transport's own request budget expiring: the request may
 *   well have been received and may still be running, so this is neither
 *   "no backend was reached" (nothing says that) nor "we cannot advise" (we
 *   can: the server did not answer in time). It is a kind of its own for the
 *   reason R4/D3 give — `unknown` carries an EMPTY diagnosis and remedy, and
 *   the compatibility banner is the surface where a server wedged for twenty
 *   seconds is exactly the case the user needs an instruction for.
 * - `null` means the request produced no HTTP status: a rejected IPC call, a
 *   dead dev proxy, or the transport failing before any byte left the process.
 *   No backend was reached.
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
	if (isDeadlineExceeded(error)) return "deadline";
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
 * conditions, and the case that taught this table its shape: it used to carry
 * "Restart the app so it can start its own server.", which asked the user to make
 * the app own a plane this change exists to let it adopt (UX round 2, U2). What
 * is left for these three kinds is a DIAGNOSIS and no instruction at all; the
 * surfaces that can repair a pairing offer the reconnect control themselves.
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
	/*
	 * EMPTY for the three causes that used to carry the app-managed instruction, and
	 * that instruction is gone from the vocabulary entirely (UX round 2, U2): it was
	 * "Restart the app so it can start its own server.", which asks the user to make
	 * the app own a plane this change exists to let it ADOPT. Settings rendered it in
	 * every state the change introduces, including two where restarting the app cannot
	 * reach the daemon at all.
	 *
	 * Empty rather than reworded, because the act belongs to the surface and the
	 * cause: the surfaces that can repair a pairing offer the reconnect control, and
	 * one that cannot states the condition and stops. A shared string cannot know
	 * which of those a caller is, so it says nothing and the composition drops it.
	 */
	unreachable: "",
	// As `unreachable`, and for the same reason: a server that has been silent for
	// the whole budget is not answering. It is NOT the panel copy — a panel renders
	// the request's own authored sentence, which says the app stopped waiting
	// rather than that the server is down (design round 1, D3) — and it carries no
	// instruction (UX round 2, U2).
	deadline: "",
	unauthorized: "",
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
	deadline: "The Local Operator server did not answer in time.",
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
 * The ONE sentence per pairing cause, shared by every surface that must explain
 * it (design § 2's table is the contract; these are its strings).
 *
 * WHY they live here rather than in the banner. The banner and the chat pane both
 * reported this condition and each wrote its own explanation, which is how the
 * same fact reached the operator as an ownership instruction in one place and a
 * version problem in the other (design § 0). `backendCompatibilityMessage` below
 * selects from this table for the app-wide notice, and every per-surface gate
 * selects from it through {@link backendPairingSentence}, so a sixth copy of the
 * pairing predicate is this change's own defect rather than a wording nit.
 *
 * TWO RULES these sentences keep, both asserted by test rather than by review:
 *
 * 1. NONE of them tells the user to update the server, and none asks them to
 *    change what the app manages. Every one of these causes is a PAIRING fact -
 *    pairing is the app's own business, and the remedy that exists (re-claiming)
 *    is the app's to perform (design § 3.1, § 4's falsifiable prediction).
 * 2. The sentence names what the app OBSERVED and stops. S2 in particular must
 *    not imply the user can clear it: the daemon refuses a second claim even when
 *    it presents the correct key, so the honest answer is that this app cannot
 *    use that plane and no control is offered at all (design § 2, § 3.2).
 */
export const BACKEND_PAIRING_SENTENCE: Record<DaemonPairingCause, string> = {
	successor:
		"The Local Operator server was replaced while this app was running. Pairing with the new one.",
	"governed-elsewhere":
		"The Local Operator server on this machine is already managed by another program, so this app cannot use its settings, provider sign-in, slash commands or MCP management.",
	// The age is the fixable part, so it is named - and so is what the daemon's OWN
	// users lose, which is nothing: an older daemon answers /health and its own
	// routes fine, and saying so is a decision rather than an implication
	// (design § 3.3).
	"pre-handshake":
		"The Local Operator server on this machine is older than the pairing handshake this app uses, so this app cannot drive its controls. The server itself, and anything you run against it from the terminal, are unaffected.",
	"credential-refused":
		"This app's credential for the running Local Operator server was refused, so provider sign-in, settings, slash commands and MCP management are unavailable.",
	unpaired:
		"This app is not paired with the running Local Operator server, so provider sign-in, settings, slash commands and MCP management are unavailable.",
};

/**
 * The pairing sentence for a per-surface gate, or null when the surface is
 * paired and owes this condition nothing.
 *
 * THE seam both the pane and the list read, so "one condition, one statement" is
 * structural: `state` comes from `desktopFeatureState` and `cause` from main's own
 * `DaemonPairing`, and neither surface is free to author its own version of
 * either (design § 4, § 11.1). A `below-version` state returns null here because
 * the sentence for it is the surface's OWN (what that surface cannot do), which
 * is the split S6 keeps.
 */
/**
 * The PANE's own sentence, per cause.
 *
 * WHY THE PANE DOES NOT REUSE THE BANNER'S TABLE, measured from the frame
 * (design review round 1, D1): the governed screen rendered the band's
 * 169-character sentence twice - once across the top, once centred in the pane -
 * and the second copy listed what the APP loses (settings, provider sign-in,
 * slash commands, MCP) inside a pane whose own consequence is that this
 * conversation cannot be read. A reader who reached the pane learned nothing the
 * band had not already said a screen-height above.
 *
 * So the two surfaces are worded from their own consequence and still selected
 * from the SAME cause: the band says what the app cannot do, the pane says what
 * this conversation cannot do - and, because that is the screen which hides the
 * user's conversations, it also says where they still are (design round 1, D6).
 */
export const BACKEND_PANE_SENTENCE: Record<DaemonPairingCause, string> = {
	successor:
		"This conversation cannot be read here until the app finishes pairing with the replacement server. Your chats are still on that server.",
	"governed-elsewhere":
		"This conversation cannot be read here: the server's desktop controls belong to another program. Your chats are still on that server.",
	"pre-handshake":
		"This conversation cannot be read here: that server is older than the pairing handshake this app uses. Your chats are still on that server.",
	"credential-refused":
		"This conversation cannot be read here: the server refused this app's credential. Your chats are still on that server.",
	unpaired:
		"This conversation cannot be read here: the app is not paired with the running server. Your chats are still on that server.",
};

/**
 * The pane's sentence, or null when the pane's own reading is not a pairing
 * condition (a version gap keeps its own copy).
 */
export function backendPaneSentence(
	state: "enabled" | "unpaired" | "below-version" | "unknown",
	cause: DaemonPairingCause | null,
): string | null {
	if (state !== "unpaired") return null;
	return BACKEND_PANE_SENTENCE[cause ?? "unpaired"];
}

export function backendPairingSentence(
	state: "enabled" | "unpaired" | "below-version" | "unknown",
	cause: DaemonPairingCause | null,
): string | null {
	if (state !== "unpaired") return null;
	return BACKEND_PAIRING_SENTENCE[cause ?? "unpaired"];
}

/**
 * Whether the update control may be OFFERED, and the cause is half the answer.
 *
 * The old rule refused the update for every unpaired backend, which is right for
 * S2/S5 - installing a newer server cannot repair a credential this app does not
 * hold - and wrong for S3, where the daemon predates the handshake AND the
 * install is one this app may move: there, update-then-restart is exactly the
 * remedy.
 *
 * `servedByThisApp` is main's own ownership answer (`DaemonStatusSnapshot.owned`,
 * "this app spawned the daemon, and is the only process that may stop it"). The
 * renderer may NOT derive it from `installKind` or from any reading of the
 * record: a user's `lop` is their tool, and a surface that offered to update one
 * the app does not hold would be offering to move something that is not its to
 * move (design § 3.4, § 10.1).
 */
export function backendUpdateIsRemedy(input: {
	kind: BackendErrorKind;
	/** A backend answered, but this app did not start it and holds no bearer. */
	unpaired: boolean;
	/** True once a capabilities payload was received at all. */
	answered: boolean;
	/** Main's own pairing cause, null when this app is paired. */
	cause?: DaemonPairingCause | null;
	/** Main's answer that this app holds the serving install (`owned`). */
	servedByThisApp?: boolean;
}): boolean {
	const {
		kind,
		unpaired,
		answered,
		cause = null,
		servedByThisApp = false,
	} = input;
	// S3 is the ONE pairing cause an install can repair, and only for an install
	// this app holds.
	if (cause === "pre-handshake") return servedByThisApp;
	// Every other pairing cause: re-pairing is the remedy, and the app performs it.
	if (cause !== null) return false;
	// Re-pairing, not installing, is what an unpaired backend needs.
	if (unpaired) return false;
	/*
	 * The negotiated case - a backend that answered and named the features it
	 * lacks - is the one place an update is genuinely the remedy, and it is still
	 * the app's to offer only when the install is the app's to move. A paired
	 * daemon adopted from elsewhere with an absent feature is not out of date in
	 * any way this app may repair: installing a newer server cannot make somebody
	 * else's daemon advertise a capability to this app (design § 3.4, § 10.1).
	 */
	if (answered) return servedByThisApp;
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
	/**
	 * Main's own pairing cause, or null when this app is paired.
	 *
	 * The cause WINS over every status-based branch below, and that precedence is
	 * the fix for the operator's screenshot: the status of a capabilities request
	 * describes how that request went, while the pairing record says why this app
	 * cannot use the server it can see. Reading the status first is how a pairing
	 * condition came to be worded as an ownership instruction and, in the pane, as
	 * a version problem (design § 0, § 2).
	 */
	cause?: DaemonPairingCause | null;
}): string {
	const { kind, unpaired, missing, answered, cause = null } = input;
	if (cause !== null) return BACKEND_PAIRING_SENTENCE[cause];
	if (!answered) {
		if (kind === "unreachable")
			return `${BACKEND_ERROR_DIAGNOSIS.unreachable} Provider sign-in, settings, slash commands and MCP management need it running.`;
		if (kind === "unauthorized")
			// "protected controls are unavailable" was jargon two sentences away
			// from this file's own plain list of the same surfaces (design D10).
			return "This app cannot authenticate to the running Local Operator server, so provider sign-in, settings, slash commands and MCP management are unavailable.";
		if (kind === "deadline")
			// A server that has been silent for the app's whole budget is a wedged
			// server, which is the case this banner exists for. It names that, and
			// names NO action: keeping the restart instruction here was justified by
			// the banner having no retry of its own, but the instruction is the one
			// this change removes, and the justification was false anyway — this
			// branch is reached in every state, including ones where the banner does
			// offer a Retry (review round 3). It is also not "as expected": nothing
			// arrived at all, which is a different fact from an unexpected answer.
			return `${BACKEND_ERROR_DIAGNOSIS.deadline} Provider sign-in, settings, slash commands and MCP management need it answering.`;
		if (kind === "outdated")
			// The trailing clause read "stay off until then", whose antecedent left
			// with the remedy when it was extracted into the shared sentence --
			// nothing before it named a time or an event (design D4). Binding the
			// consequence to the diagnosis with "so" removes the dangling referent
			// rather than restating the remedy in a second set of words, which is
			// what lets a test assert the two surfaces agree by string.
			return `The Local Operator server is older than this app expects, so provider sign-in, settings, slash commands and MCP management are off. ${BACKEND_ERROR_REMEDY.outdated}`;
	}
	// S5: a backend this app holds no bearer for, with no cause established yet.
	// The sentence is the pairing table's and it offers no ownership instruction:
	// "Restart the app so it can manage its own server" asked the user to
	// re-architect their machine for a client's failure, which is the model this
	// change removes (design § 3.1). The banner's own control is `Retry`, which
	// asks MAIN to re-claim - the one act that can change this condition.
	if (unpaired) return BACKEND_PAIRING_SENTENCE.unpaired;
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
 * The negotiated features the compatibility banner holds a backend to.
 *
 * It lives here rather than in the banner because a second surface now needs
 * the SAME question answered: the chat sidebar must know whether a statement
 * about this condition is already on screen before it adds its own (design
 * round 1, D3 / review round 2, MINOR-2 / QA round 1, Q-5). Two copies of this
 * list is how "one statement per condition" silently becomes two.
 */
export const REQUIRED_BACKEND_FEATURES = [
	"auth",
	"settings",
	"commands",
	"catalogues",
	"lifecycle",
	"mcp",
	"radient",
] as const;

/**
 * Whether `BackendCompatibilityBanner` is on screen for this capabilities
 * answer - which is the same question as "is the operator already being told
 * about this".
 *
 * Written as the NEGATION of the banner's own early return so the two cannot
 * disagree: the banner renders unless the plane is available AND every required
 * feature is advertised. An absent answer counts as shown, which is also what
 * the banner does (it lists every required feature as missing until one
 * arrives).
 */
export function compatibilityBannerShown(
	capabilities:
		| Pick<DesktopCapabilities, "desktop_available" | "features">
		| null
		| undefined,
	/**
	 * Main's pairing cause, when the renderer has one.
	 *
	 * A cause is a reason to speak even when the capabilities answer looks healthy:
	 * the public capability route is answered by a daemon the app is NOT paired with
	 * just as cheerfully as by one it is, so `desktop_available: true` is not
	 * evidence that this app may drive anything (design § 2 S1).
	 */
	cause: DaemonPairingCause | null = null,
): boolean {
	if (cause !== null) return true;
	if (!capabilities) return true;
	const missing = REQUIRED_BACKEND_FEATURES.filter(
		(feature) => (capabilities.features?.[feature] ?? 0) < 1,
	);
	return missing.length > 0 || capabilities.desktop_available !== true;
}

/**
 * Whether a failed desktop query is worth asking again.
 *
 * React Query's default `retry: 1` charges the renderer deadline twice for a
 * request that never gets an answer: the stalled-IPC shape ended one wait, then
 * the retry began another, so a user watched an unbroken spinner for the sum of
 * the two before the error state could render. That is the symptom issue 89 was
 * reported for, merely bounded -- a user who gave up at 45s before still gives
 * up at 45s.
 *
 * The deadline here is the OP'S OWN, derived per op
 * (`desktopRequestTimeoutMs`), not one literal: a control waits 25 s and a
 * ledger read 95 s, so the two waits this refuses to double are 25 s and 95 s
 * respectively.
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

/**
 * The SETTINGS CARD's own sentence, per cause.
 *
 * WHY THE CARD DOES NOT REUSE THE BANNER'S TABLE (design review rounds 1 and 5,
 * D1/D37, and UX round 5's U13, which is the same finding): the card rendered the
 * band's 169-character sentence verbatim - the same string, 380 px apart on one
 * screen - and lost its own lead with it, because that sentence is written for a
 * band listing what the APP loses. A reader who reached the card learned nothing the
 * band had not already said, and the card stopped saying what THIS PAGE cannot do.
 * Same cause, card-scoped words, one lead.
 */
export const BACKEND_PAIRING_CARD_SENTENCE: Record<DaemonPairingCause, string> =
	{
		successor:
			"Your settings could not be loaded: the app is pairing with the server that replaced the one it was using.",
		"governed-elsewhere":
			"Your settings could not be loaded: another program is managing this machine's Local Operator server, so this page cannot read or change them here.",
		"pre-handshake":
			"Your settings could not be loaded: the server this app is talking to is older than the pairing handshake, so this page cannot read them from it.",
		"credential-refused":
			"Your settings could not be loaded: the server refused this app's credential, so this page cannot read them from it.",
		unpaired:
			"Your settings could not be loaded: this app is not paired with the running server, so this page cannot read them from it.",
	};

/**
 *
 * WHY ONE FUNCTION (review round 5, Q-6 / UX U2): two surfaces render this card - the
 * settings page's load error and the Backend section's - and they drifted. The page kept
 * printing "The Local Operator server is not answering." with a Retry over a daemon that
 * IS answering, while the two bands on the same screen named the cause. So the sentence
 * is the pairing table's for the cause main published, and the control exists only where
 * an act does (`pairingHasRemedy`). `cause === null` means no pairing cause was
 * published at all, which is when the transport classification's sentence is the right
 * one and its Retry is a real act.
 */
export function pairingCardCopy(
	cause: DaemonPairingCause | null,
	fallback: string,
	error: unknown,
): { sentence: string; remedy: boolean } {
	/*
	 * The CARD's table, not the band's (D37/U13): rendering the band's sentence here
	 * repeated it verbatim 380 px below itself and dropped this page's own lead. The
	 * no-cause branch is the one the composed classifier is for, which is why it keeps
	 * the `fallback` argument's lead.
	 */
	return cause === null
		? { sentence: backendLoadErrorMessage(fallback, error), remedy: true }
		: {
				sentence: BACKEND_PAIRING_CARD_SENTENCE[cause],
				remedy: pairingHasRemedy(cause),
			};
}
