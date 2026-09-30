/**
 * @file speech-gate.ts
 * @description
 * What a disabled speech control says, and the ONE reading it says it from.
 *
 * WHY THIS MODULE EXISTS (agent review round 1; design review round 1, D1/D2/D5;
 * UX review round 1, U1/U2). Four surfaces disable themselves on the same
 * reading - the composer's mic, the message strip's speak-aloud control, the
 * selection toolbar's speech control and the canvas editor's mic - and each used
 * to inline its own sentence: three names for the mic ("Start recording" /
 * "audio recording" / "Voice input") and two for the speak control ("Speak
 * aloud" / "text to speech"), so the same control was described differently
 * depending on which arm you were standing on. And the sign-in sentence was the
 * fallback for EVERY arm that did not know the account - in flight, refused,
 * unreachable - so it told a signed-in user to sign in during an outage, a
 * remedy their account could not use.
 *
 * The reading is therefore one classification (`RadientSpeechBlock`) derived
 * from the account read's own classes, and the sentences live here as one table
 * per control, so the four call sites cannot drift apart one string at a time.
 *
 * THE SENTENCES, AND WHAT EACH BLOCK MEANS:
 *
 *   - `checking`        - the account read is in flight and nothing has failed.
 *                         This is the FIRST moment after a mount, which used to
 *                         render the offline sentence before anything had even
 *                         been asked (UX round 1, U2): a sentence about a failed
 *                         check, shown before a check had started, is the kind
 *                         of copy that teaches a reader to distrust the tooltip.
 *   - `sign-in`         - the account read ANSWERED "no account" (`signed-out`)
 *                         or "Radient refused this credential" (`refused`). Only
 *                         these two get the sign-in sentence, because only these
 *                         two have signing in as their remedy (design round 1,
 *                         D1).
 *   - `could-not-check` - the read reached a failure the reader cannot fix by
 *                         signing in (`unavailable`, `unknown`), or the backend
 *                         cannot serve Radient at all: an outage is not an
 *                         account problem, so the copy says what is true - the
 *                         check did not answer - without sending anyone to a
 *                         settings page their account cannot repair.
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
 *  2. An in-flight read is `checking` - and on a backend that cannot serve
 *     Radient at all it will stay in flight forever, which is not something to
 *     wait out, so that case is `could-not-check` instead.
 *  3. Only an ANSWERED "no" (`signed-out`, `refused`) earns the sign-in
 *     sentence; signing in is its remedy and nothing else's.
 *  4. Every other failure is the check itself failing, and the copy says so.
 *
 * @param state.serverOnline - the connectivity gate's reading, `false` once the
 *   local server is known to be down.
 * @param state.accountRead - the account read's class, from the one reading in
 *   `use-radient-user-query`.
 * @param state.accountUnavailable - the backend cannot serve Radient at all
 *   (an older backend), so the read will never leave `checking`.
 */
export function radientSpeechBlock(state: {
	serverOnline: boolean;
	accountRead: RadientAccountRead;
	accountUnavailable: boolean;
}): RadientSpeechBlock {
	if (!state.serverOnline) return "offline";
	if (state.accountRead === "checking") {
		return state.accountUnavailable ? "could-not-check" : "checking";
	}
	if (state.accountRead === "signed-out" || state.accountRead === "refused") {
		return "sign-in";
	}
	return "could-not-check";
}

/**
 * The one sentence table. One entry per control per block, so a new block or a
 * new control is a completeness failure at type-check time rather than a
 * surface quietly rendering the wrong name.
 */
const REASONS: Record<SpeechControl, Record<RadientSpeechBlock, string>> = {
	recording: {
		checking: "Checking your Radient sign-in…",
		"sign-in": "Sign in to Radient in the settings page to enable recording",
		"could-not-check":
			"Your Radient sign-in could not be checked, so recording is unavailable for now",
		offline: "Recording is unavailable while Local Operator is offline",
	},
	"speaking-aloud": {
		checking: "Checking your Radient sign-in…",
		"sign-in":
			"Sign in to Radient in the settings page to enable speaking aloud",
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
