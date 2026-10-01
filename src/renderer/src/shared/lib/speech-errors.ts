/**
 * @file speech-errors.ts
 * @description
 * The toast sentence for a failed speech press: the daemon's designed refusals
 * kept verbatim, everything else collapsed to one designed sentence.
 *
 * WHY A MAPPER AND NOT `err.message` DIRECTLY. The store hands whatever the
 * relay chain rejected with to the app's one toast, and that string is not
 * always copy: the daemon's unmapped path forwards its own support diagnostic
 * ("Speech generation failed upstream: Upstream responded 503 with no body.")
 * and a transport failure arrives in whatever words the fetch layer used.
 * Those sentences were written for whoever is on support, and the reader's
 * slot shows exactly one sentence.
 *
 * THE REFUSALS THE READER CAN ACT ON ARE KEPT EXACTLY. `local-operator`'s
 * speech route (PR #1835, `local_operator/server/routes/speech.py`) ships a
 * fixed sentence per refusal a reader can act on - 401/402/429/503 - plus the
 * no-credential and unknown-agent sentences, written in the app's register
 * ("Every sentence ends with a full stop so the set reads alike in one toast",
 * that file's own note). That is the designed copy; rewriting it here would be
 * the second opinion this module exists to prevent.
 *
 * THE MATCH IS EXACT, on purpose: the moment a string arrives from a path that
 * was not designed (a 4xx written by a proxy, version skew, a diagnostic that
 * shares a prefix), it lands on the fallback sentence with its detail in the
 * console rather than in the reader's toast.
 */

/** The console's marker for a speech failure's raw detail. */
export const SPEECH_FAILURE_DETAIL_PREFIX = "[speech]";

/**
 * The reader's sentence for a failed speech fetch, when the failure is not one
 * of the designed refusals. Covers every transport shape the store can reject
 * with, including a null body ("no audio data received" is the transport
 * describing itself; the reader is owed what happened and what to do).
 */
export const SPEECH_FAILURE_COPY = "Couldn't speak this aloud. Try again.";

/**
 * The reader's sentence for a playback failure (autoplay refused, a decode
 * failure on a returned blob). Playback fails locally, so no daemon sentence
 * can cover it.
 *
 * DELIBERATELY THE SAME SENTENCE as the fetch arm (copy review round 2, C3):
 * the two arms were `read` and `play` where the button says `speak` (four names
 * for one feature in the module whose whole point is ending name drift), and
 * the reader cannot act on the pipeline stage that failed anyway - the raw
 * detail that distinguishes the arms is already on the console under
 * `[speech]`. One sentence keeps one vocabulary and loses nothing a reader
 * could use.
 *
 * AND SAYS NO OBJECT NOUN (copy review round 3, C-r3-1): the same press
 * renders on the selection toolbars, where the thing that failed is the
 * highlight, not a message - "this message" named an object half the surfaces
 * do not have. The object-less form is true everywhere the press mounts.
 */
export const SPEECH_PLAYBACK_COPY = "Couldn't speak this aloud. Try again.";

/**
 * The `detail` sentences the speech route answers with, verbatim from
 * `local-operator` PR #1835 (`_SPEECH_REFUSAL_SENTENCES` plus the route's two
 * named constants). A change there is a change here - the strings are the
 * contract between the two repositories, which is why they are pinned
 * character-for-character. LAST READ AT #1835's `bcca80808` (the C4 alignment:
 * the daemon's two sign-in sentences now use the app's `Settings` naming -
 * `Sign in to Radient in Settings to enable speaking aloud.` and `Your Radient
 * sign-in has stopped working. Sign in again in Settings.`), replacing the
 * spellings its commit retired; a daemon still on the OLD literal falls to the
 * designed fallback until it redeploys, which is the same deploy-skew window
 * the note on agent-server's base 503 below describes.
 */
const DESIGNED_SPEECH_SENTENCES: ReadonlySet<string> = new Set([
	"Your Radient sign-in has stopped working. Sign in again in Settings.",
	"Your Radient credit balance is too low for speech. Add credits in the Radient Console to continue.",
	"Speech is unavailable right now. Try again in a moment.",
	"Speech is temporarily unavailable. Try again in a moment.",
	/*
	 * agent-server's own base 503 sentence, one hop upstream. The daemon
	 * absorbs it into the extended sentence above, but during the window where
	 * agent-server has shipped and the daemon has not, it can be the string
	 * that reaches the UI - and it is designed copy either way, so it is kept
	 * rather than replaced by the fallback.
	 */
	"Speech is temporarily unavailable.",
	"Sign in to Radient in Settings to enable speaking aloud.",
	"This conversation's agent is no longer available.",
]);

/**
 * The reader's sentence for a failed speech fetch.
 *
 * Takes the permissive `unknown` because a rejected promise carries anything:
 * a non-string rejection cannot match a designed sentence, so it falls to the
 * fallback with its rendering kept for the console.
 */
export function speechFailureCopy(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	if (DESIGNED_SPEECH_SENTENCES.has(raw)) return raw;
	console.error(`${SPEECH_FAILURE_DETAIL_PREFIX} ${raw}`);
	return SPEECH_FAILURE_COPY;
}
