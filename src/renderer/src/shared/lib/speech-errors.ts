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
 * sign-in has stopped working. Sign in again in Settings.`), whose commit
 * retired two spellings that are kept BESIDE the new pair below as skew
 * entries: the daemon side of #1835 is unmerged at this head, so every daemon
 * in the field still answers the retired spellings, and they retire from this
 * set only once the shipped daemon's floor is past `bcca80808`.
 *
 * THE BYO REFUSALS ARE A SECOND FAMILY, added by `local-operator` PR #1922
 * (read at its round-2 remediation head `e4f8d9e8`, the S2 daemon TTS work).
 * When the refused leg is served by the reader's OWN vendor key, the daemon
 * answers in the vendor's words instead of the Radient sentences above: on a
 * BYO-only machine there may be no Radient account in the exchange at all, and
 * telling someone their Radient sign-in broke when their own ElevenLabs key was
 * refused sends them to fix the wrong thing. These four are ADDITIVE pins - the
 * Radient sentences stay for the Radient rung - and they ride the same skew
 * rule as the retired spellings below, in the opposite direction: #1922 is
 * unmerged at this head, so no shipped daemon can emit the vendor sentences
 * yet, and because the strings are pinned to an unmerged head they are a moving
 * target - if the vendor sentences change before the daemon ships, this set
 * moves with them.
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
	/*
	 * The BYO vendor refusals (`local-operator` PR #1922 at its round-2
	 * remediation head `e4f8d9e8`, `_VENDOR_REFUSAL_SENTENCES` formatted with
	 * `_RUNG_VENDOR_LABELS`): the pair per vendor the route can pick. The
	 * daemon classifies the CONDITION from the vendor's response BODY, not the
	 * status - ElevenLabs reports an exhausted quota as 401 and OpenAI as 429 -
	 * and answers a credit refusal as 402 and a leftover 401 as the key one.
	 * Both are stable sentences, and #1922's route states the contract outright:
	 * `detail` is always one of these fixed sentences, never an upstream code or
	 * body, precisely because this module maps exact strings. They therefore
	 * arrive as the same plain `detail` the Radient refusals do and the mapper
	 * needs no new rule - exact membership is the whole match (the store hands
	 * `err.message` straight through and `mediaError` builds that Error from the
	 * response's `detail`, so a vendor sentence reaches this set verbatim). A
	 * third vendor on the route is a third pair here, not a code change.
	 */
	"ElevenLabs refused your API key. Replace it.",
	"Your ElevenLabs credit balance is too low for speech. Add credits with ElevenLabs to continue.",
	"OpenAI refused your API key. Replace it.",
	"Your OpenAI credit balance is too low for speech. Add credits with OpenAI to continue.",
	/*
	 * The two spellings `bcca80808` retired, kept as skew entries on the same
	 * rule as agent-server's base 503 above: `local-operator` #1835 is not
	 * shipped, so no daemon in the field can emit the new pair yet - a refusal
	 * that reaches the app today still answers these, they are designed copy
	 * either way, and dropping them degraded the actionable 401 ("Sign in
	 * again") to `Try again` in a state where trying again cannot work (agent
	 * review round 4, MINOR-1). Remove them once the shipped daemon's floor is
	 * past `bcca80808`.
	 */
	"Your Radient sign-in has stopped working. Sign in again in the settings page.",
	"Sign in to Radient in the settings page to enable text to speech.",
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
