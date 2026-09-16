/**
 * What an update-path message MEANS on the way to a person.
 *
 * WHY THIS EXISTS. The operator's alert read, exactly,
 * `net::ERR_INTERNET_DISCONNECTED`: main sends the machine's own message on
 * `update-error`, the surface painted it verbatim, and a Chromium transport
 * code is not a sentence. `docs/branding.md` says an error says what happened,
 * what it means and what to do - and the app knew all three. It also knew
 * which failures are transient transport ones, because main retries them
 * through the same shared classifier (`shared/transport-failure.ts`), so the
 * sentence is decided from the same fact on both sides of the IPC boundary.
 *
 * ONE POLICY, NOT A THIRD COPY OF ONE. Two judgements already existed in this
 * tree and both are reused here rather than restated:
 *
 * - `userFacingMessage(error, fallback)` (`shared/api/local-operator/desktop-api.ts`)
 *   is the rule "a thrown value is only copy when we know who wrote it". Every
 *   message this module is handed comes from the app's own update path - main
 *   built it - so it is copy by construction, and the fallback half of that
 *   rule is not needed. What is needed is the other half, which this module
 *   adds: a message we may show is still not a message we may show RAW when
 *   the machine wrote it.
 * - `browser-load-failure.tsx` already maps a Chromium `ERR_*` to a sentence
 *   and keeps the code as a separate machine-voice line, and its table already
 *   names `ERR_INTERNET_DISCONNECTED` and `ERR_CONNECTION_REFUSED`. That is
 *   the SHAPE this module follows for the update path: a sentence for the
 *   person, the machine's own words subordinate in monospace. The sentence
 *   differs because the surface differs - that file is about a page the user
 *   asked for, this one is about the app's own update check - and neither
 *   table is asked to answer for the other's failure.
 *
 * WHAT THE TWO LINES ARE. The sentence is a person's: what happened and what
 * to do about it. The detail is the machine's own words on their own line and
 * in monospace, subordinate. Where a message carries an AUTHORED prefix around
 * a machine fragment ("Error downloading update: net::ERR_TIMED_OUT") the
 * prefix is kept and only the fragment is replaced, so the context survives
 * and the reader never sees the code. Where the message is not a transport
 * failure the sentence IS the message: only the transport family has a copy
 * table behind it, and inventing a cause for an unrecognised failure is the
 * defect class this whole change exists to remove.
 */

import {
	stripErrorPrefixes,
	transientTransportFragment,
} from "../../../../shared/transport-failure";

export interface UpdateErrorCopy {
	/** The sentence a person reads. */
	sentence: string;
	/** The machine's own words, subordinate, or null when there are none. */
	detail: string | null;
}

/**
 * What a transport failure means here, in one sentence.
 *
 * "The update server" rather than a URL: every path into this surface fetches
 * the same two things from the same place (the app's release feed, the
 * published server version), and the address is not something the reader can
 * act on. The action named is the one that works - the connection, then try
 * again - because the transient shape is exactly the one a retry fixes.
 */
const UPDATE_SERVER_UNREACHABLE =
	"The app could not reach the update server. Check this machine's connection, then try again.";

/**
 * Split one update-path message into the sentence and the machine detail.
 *
 * The prefixes are stripped BEFORE the code is looked for, so the doubled
 * `Error: Error: net::ERR_X` shape a nested failure produces is classified and
 * shown cleanly rather than travelling to the reader as-is.
 */
export function updateErrorCopy(message: string): UpdateErrorCopy {
	const cleaned = stripErrorPrefixes(message).trim();
	const fragment = transientTransportFragment(cleaned);
	if (fragment === null) {
		return { sentence: cleaned, detail: null };
	}
	/*
	 * A fragment that is its own clause was written around AUTHORED text, so the
	 * sentence takes its place and the text survives. One that is embedded is
	 * machine vocabulary ("getaddrinfo ENOTFOUND pypi.org"), and substituting a
	 * sentence into the middle of it would be worse than the code was: the
	 * sentence takes the whole message.
	 */
	const sentence = fragment.clause
		? `${cleaned.slice(0, fragment.start)}${UPDATE_SERVER_UNREACHABLE}${cleaned.slice(fragment.end)}`
		: UPDATE_SERVER_UNREACHABLE;
	return { sentence, detail: fragment.code };
}

/** Just the sentence, for a surface that has nowhere to put a machine line. */
export function updateErrorMessage(message: string): string {
	return updateErrorCopy(message).sentence;
}

/**
 * The release-artifact wording, which means "this build's own release carries
 * no artifact for it" rather than "the update failed".
 *
 * Moved here from the component that owned it so that BOTH producers of the
 * error state can be judged by one rule: it used to silence the invoke
 * rejection while the same failure arriving as an `error` event painted the
 * alert, and which one a reader got was a race between two channels carrying
 * one failure.
 */
const RELEASE_ARTIFACT_ERROR_REGEX =
	/cannot find .* in the latest release artifacts/i;

/**
 * The legacy wording one main-process path still emits for an unmanaged server
 * ("please update manually with pip"). It is not an error to show: the by-hand
 * panel is its surface, and it is decided by the same rule on both channels
 * for the same reason as the artifact wording above.
 */
const MANUAL_UPDATE_WORDING = "manually";

/**
 * What to DO with one update-path message, wherever it arrived from.
 *
 * - `by-hand`: the by-hand panel owns it (an unmanaged server the app cannot
 *   update itself).
 * - `muted`: it is a known non-failure; logged, never painted. A release with
 *   no artifact for this build is not a failure the user can act on, and the
 *   panel already shows what is true.
 * - `show`: the app owes the reader a sentence.
 *
 * Total by construction: every message gets one of the three, so no message
 * can be silent by omission on one channel and loud on the other.
 */
export type UpdateMessageFate = "by-hand" | "muted" | "show";

export function updateMessageFate(message: string): UpdateMessageFate {
	if (message.includes(MANUAL_UPDATE_WORDING)) return "by-hand";
	if (RELEASE_ARTIFACT_ERROR_REGEX.test(message)) return "muted";
	return "show";
}
