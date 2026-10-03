/**
 * @file speech-gate.ts
 * @description
 * What a disabled speech control says, and the ONE reading it says it from.
 *
 * WHY THIS MODULE EXISTS (agent review round 1; design review round 1, D1/D2/D5;
 * UX review round 1, U1/U2). Five surfaces disable themselves on the same
 * reading - the composer's mic, the message strip's speak-aloud control, the
 * selection toolbar's speech control, the canvas editor's mic and the answer
 * action row, last to join (UX round 2, U6) - and each used to inline its own
 * sentence: three names for the mic ("Start recording" / "audio recording" /
 * "Voice input") and two for the speak control ("Speak aloud" / "text to
 * speech"), so the same control was described differently depending on which
 * arm you were standing on. And the sign-in sentence was the fallback for EVERY
 * arm that did not know the account - in flight, refused, unreachable - so it
 * told a signed-in user to sign in during an outage, a remedy their account
 * could not use.
 *
 * The reading is therefore one classification (`RadientSpeechBlock`) derived
 * from the account read's own classes, and the sentences live here as one table
 * per control, so the five call sites cannot drift apart one string at a time.
 *
 * THE SENTENCES, AND WHAT EACH BLOCK MEANS:
 *
 *   - `checking`        - the account read is in flight and nothing has failed.
 *                         This is the FIRST moment after a mount — including the
 *                         window before the feature negotiation has answered,
 *                         when nothing has asked yet (design round 2, D6; see
 *                         the ladder) — which used to render the offline
 *                         sentence before anything had even been asked (UX
 *                         round 1, U2): a sentence about a failed check, shown
 *                         before a check had started, is the kind of copy that
 *                         teaches a reader to distrust the tooltip.
 *   - `sign-in`         - the account read ANSWERED "no account" (`signed-out`)
 *                         or "Radient refused this credential" (`refused`). Only
 *                         these two get the sign-in sentence, because only these
 *                         two have signing in as their remedy (design round 1,
 *                         D1).
 *   - `could-not-check` - the read reached a failure the reader cannot fix by
 *                         signing in (`unavailable`, `unknown`), the feature
 *                         negotiation itself failed so the read could not ask
 *                         (design round 2, D6), or the backend cannot serve
 *                         Radient at all: an outage is not an account problem,
 *                         so the copy says what is true - the check did not
 *                         answer - without sending anyone to a settings page
 *                         their account cannot repair.
 *   - `offline`         - the local server itself is down, which is the only
 *                         state the offline sentence describes. The connectivity
 *                         banner is the way out this sentence points at; making
 *                         the tooltip itself actionable is a separate question
 *                         (design round 1, D3, deferred to the banner).
 */

import type { RadientAccountRead } from "@shared/hooks/use-radient-user-query";

/**
 * The two families of speech control this app has, named once per CONTROL so
 * the disabled copy uses the same name as the enabled control and the aria
 * label (`Start recording` / `Speak aloud`).
 */
export type SpeechControl = "recording" | "speaking-aloud";

/**
 * Why a speech control is disabled, as one class per remedy the copy can offer.
 *
 * A block is ALWAYS present on the probe (there is a reason even when the
 * capability holds - it is simply not rendered), so this type carries no
 * "none": a surface renders it only on the disabled arm.
 */
export type RadientSpeechBlock =
	| "checking"
	| "sign-in"
	| "could-not-check"
	| "offline";

/**
 * Classify the current reading into the sentence's block.
 *
 * ORDER IS THE POLICY:
 *  1. The local server being down is stated first: it is the only state the
 *     offline sentence is true for, it is what the connectivity banner explains,
 *     and no account read can answer while it holds.
 *  2. THE FEATURE NEGOTIATION ANSWERS BEFORE THE ACCOUNT READ MAY ASK (design
 *     round 2, D6). The account query is DISABLED until the capabilities read
 *     answers (`enabled = desktopFeatureEnabled(capabilities.data, "radient")`),
 *     and a disabled query reports no data and no error — so `pending` is a
 *     window in which nothing has asked yet and its silence must read as the
 *     check itself (`checking`), while an `error` in the negotiation is a check
 *     that will not answer (`could-not-check`). Either silence read as an
 *     account class is the Q1 defect one level up: it told a signed-in reader
 *     to sign in on the cold mount and through every capabilities outage.
 *  3. A backend that cannot serve Radient is stated next, and BEFORE the account
 *     read's own class — because on that backend the read never asked. The
 *     feature gate DISABLES the query (`desktopFeatureEnabled(capabilities.data,
 *     "radient")` is false), so React Query reports no data and no error and
 *     `accountRead` lands on `signed-out` without an answer behind it (measured
 *     by QA round 1: an older backend rendered the sign-in sentence). Reading
 *     that silence as "no account" is the same defect class as reading it as
 *     "offline", and consulting the unavailable reading ahead of the account
 *     classes is what makes the `could-not-check` arm reachable in integration
 *     rather than only in unit assertions.
 *  4. An in-flight read is `checking`.
 *  5. Only an ANSWERED "no" (`signed-out`, `refused`) earns the sign-in
 *     sentence; signing in is its remedy and nothing else's.
 *  6. Every other failure is the check itself failing, and the copy says so.
 *
 * @param state.serverOnline - the connectivity gate's reading, `false` once the
 *   local server is known to be down.
 * @param state.accountRead - the account read's class, from the one reading in
 *   `use-radient-user-query`.
 * @param state.accountUnavailable - the backend cannot serve Radient at all
 *   (an older backend), so the read never answered and will never leave
 *   `signed-out`.
 * @param state.capabilitiesState - the capabilities read's own state, because
 *   the feature gate DISABLES the account read until it answers: `pending`
 *   (the cold-mount window; nothing has asked) and `error` (the negotiation
 *   itself failed) are both "no answer behind the silence" and must not
 *   classify as an answer class (design round 2, D6); `answered` leaves the
 *   account classes below as the only reading.
 */
export function radientSpeechBlock(state: {
	serverOnline: boolean;
	accountRead: RadientAccountRead;
	accountUnavailable: boolean;
	capabilitiesState: "pending" | "error" | "answered";
}): RadientSpeechBlock {
	if (!state.serverOnline) return "offline";
	if (state.capabilitiesState === "pending") return "checking";
	if (state.capabilitiesState === "error") return "could-not-check";
	if (state.accountUnavailable) return "could-not-check";
	if (state.accountRead === "checking") return "checking";
	if (state.accountRead === "signed-out" || state.accountRead === "refused") {
		return "sign-in";
	}
	return "could-not-check";
}

/**
 * The one sentence table. One entry per control per block, so a new block or a
 * new control is a completeness failure at type-check time rather than a
 * surface quietly rendering the wrong name.
 *
 * THE SIGN-IN SENTENCE NAMES `Settings`, not "the settings page" (copy review
 * round 2, C4): the app's own copy names the destination `Settings` ("Connect
 * one in Settings > Providers") and uses "on the settings page" where it
 * means the page, so the old phrasing was off on the preposition and on the
 * name at once - on the one sentence that is a reader's whole instruction for
 * fixing the state, and which design round 1's D2 now puts in front of a
 * screen-reader reader a second time as the control's description.
 */
const REASONS: Record<SpeechControl, Record<RadientSpeechBlock, string>> = {
	recording: {
		checking: "Checking your Radient sign-in…",
		"sign-in": "Sign in to Radient in Settings to enable recording",
		"could-not-check":
			"Your Radient sign-in could not be checked, so recording is unavailable for now",
		offline: "Recording is unavailable while Local Operator is offline",
	},
	"speaking-aloud": {
		checking: "Checking your Radient sign-in…",
		"sign-in": "Sign in to Radient in Settings to enable speaking aloud",
		"could-not-check":
			"Your Radient sign-in could not be checked, so speaking aloud is unavailable for now",
		offline: "Speaking aloud is unavailable while Local Operator is offline",
	},
};

/**
 * The tooltip sentence for a disabled speech control.
 *
 * @param control - which family of control is asking (`recording` for the mics,
 *   `speaking-aloud` for the message strip and the selection toolbar).
 * @param block - the classification from {@link radientSpeechBlock}.
 */
export function speechUnavailableReason(
	control: SpeechControl,
	block: RadientSpeechBlock,
): string {
	return REASONS[control][block];
}

/**
 * The SETTINGS group's sentence per block, from the same classification.
 *
 * WHY A SECOND TABLE AND NOT THE TOOLTIP'S. The disabled control's sentence is
 * written for a reader standing on a TRANSCRIPT, so its remedy has to name the
 * destination ("Sign in to Radient in Settings to enable speaking aloud") — and
 * that sentence, rendered on the Settings page itself, tells a reader standing
 * in Settings to go to Settings. The group is also the one place that can afford
 * to name the exact route, which is what the design note asks of it: `/login
 * radient` is runnable as printed, whereas "sign in" is a description of a
 * gesture.
 *
 * WHY IT STILL BELONGS IN THIS MODULE: the CLASSIFICATION is the thing that may
 * not be duplicated — `speechBlock` is derived from one reading of the account
 * and the capability negotiation (see the ladder above), and the group renders
 * its arm of that same reading rather than re-deriving "is the reader signed
 * in" from the account query itself. Two sentences from one classification is a
 * copy decision; two classifications would be the defect this module exists to
 * prevent.
 */
const SETTINGS_REASONS: Record<RadientSpeechBlock, string> = {
	checking: "Checking whether this machine can speak aloud…",
	"sign-in": "Nothing can speak aloud yet: run `/login radient` to sign in",
	"could-not-check":
		"Your Radient sign-in could not be checked, so nothing can speak aloud yet",
	offline: "Local Operator is offline, so nothing can speak aloud right now",
};

/**
 * The settings group's sentence for a block, from {@link radientSpeechBlock}.
 *
 * @param block - the classification the disabled control already renders from.
 */
export function speechSettingsNote(block: RadientSpeechBlock): string {
	return SETTINGS_REASONS[block];
}
