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
	type TransportFragment,
	stripErrorPrefixes,
	transientTransportFragment,
} from "../../../../shared/transport-failure";
import { unwrapIpcErrorMessage } from "./ipc-error-message";

export interface UpdateErrorCopy {
	/** The sentence a person reads. */
	sentence: string;
	/** The machine's own words, subordinate, or null when there are none. */
	detail: string | null;
	/**
	 * What the reader may be offered to do about it.
	 *
	 * `"check"` means running the check again is the action that works, and it is
	 * null for a failure in the download or install stage: those surfaces keep
	 * their own control, and a second check would not re-download anything. The
	 * distinction is made HERE rather than by each alert, so the two registers
	 * cannot disagree about whether "then try again" has an owner (design D3, UX
	 * U3).
	 */
	action: "check" | null;
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
 * The sentences for a failure the transport classifier does not know.
 *
 * WHY AN UNRECOGNISED FAILURE GETS ONE TOO. Leaving the raw string as the
 * sentence meant a feed that answered `HttpError: 404 Not Found` painted a
 * developer's line at reading weight with no next step in it, which is the same
 * defect as the raw `net::ERR_*` alert one register over - the operator's
 * report, and design round 1's D3: a failure has to say what happened and what
 * to do, and only a message the app AUTHORED can be trusted to do that by
 * itself. Two stages, one sentence each, because the action differs: a check
 * that failed is retried, a download that failed has to be started again.
 */
const UPDATE_CHECK_FAILED =
	"The app could not check for updates. Try again in a moment.";
const UPDATE_DOWNLOAD_FAILED =
	"The update could not be downloaded. Check the connection, then try again.";

/**
 * How long an app-authored label may be before it is machine wrapping.
 *
 * The boundary between the two is a length, because that is what the shapes in
 * the log differ by: `Error downloading update:` is 24 characters of the app's
 * own stage label, while the wrapper electron-updater builds around a failed
 * feed fetch is 200 characters of parse narration. A label is also not allowed
 * to carry an address, a code or a nested `Error:`; see `isAuthoredLabel`.
 */
const AUTHORED_LABEL_MAX_LENGTH = 72;
/**
 * How long a whole sentence the app wrote may be.
 *
 * Above this a message is not copy, it is a dump - and the point of the limit is
 * that such a message goes to the machine line rather than to the reader's.
 */
const AUTHORED_SENTENCE_MAX_LENGTH = 400;

/*
 * The marks of a string a machine wrote: an address, a protocol code, an errno
 * form, a library's error class, or a bare HTTP status. Any one of them means
 * the text around it is machine vocabulary, whatever it spells in English, and
 * it is the same test for both jobs below - whether a surviving prefix is an
 * app label, and whether an unrecognised message is already a sentence.
 */
const MACHINE_MARK =
	/https?:\/\/|\b(?:net::)?(?:ERR_[A-Z0-9_]+|[A-Z]{2,}_[A-Z_]+)\b|\bE[A-Z]{3,}\b|HttpError|\b[45]\d\d\b/;

/**
 * The stage labels this app prefixes its own download and install failures with.
 *
 * They are what tells a failure of the DOWNLOAD apart from a failure of the
 * CHECK: only the latter is answered by pressing the check again, which is the
 * action the copy offers.
 */
const UPDATE_STAGE_LABEL =
	/^(?:Error downloading update|Error starting the update|Error quitting for the update)\b/i;

/*
 * The two shapes `isAuthoredLabel`/`isAuthoredSentence` work with, hoisted: a
 * literal inside a function is rebuilt on every classification.
 */
const TRAILING_SEPARATOR = /[:\uff1a\u2014]+$/;
const WHITESPACE_RUN = /\s+/;

/**
 * Split one update-path message into the sentence and the machine detail.
 *
 * The prefixes are stripped BEFORE the code is looked for, so the doubled
 * `Error: Error: net::ERR_X` shape a nested failure produces is classified and
 * shown cleanly rather than travelling to the reader as-is.
 */
export function updateErrorCopy(message: string): UpdateErrorCopy {
	const cleaned = stripErrorPrefixes(message).trim();
	/*
	 * What the reader may be offered is decided from the STAGE, before anything
	 * else: a failure in the download or install stage is not answered by another
	 * check, and those surfaces keep their own control.
	 */
	const action: "check" | null = UPDATE_STAGE_LABEL.test(cleaned)
		? null
		: "check";
	const fragment = transientTransportFragment(cleaned);
	if (fragment === null) {
		/*
		 * Not a transport failure. A message the app wrote for a person is already
		 * the sentence; anything else is a machine string and goes to the machine's
		 * own line, under a sentence that says what happened and what to do.
		 */
		if (isAuthoredSentence(cleaned)) {
			return { sentence: cleaned, detail: null, action };
		}
		return {
			sentence: UPDATE_STAGE_LABEL.test(cleaned)
				? UPDATE_DOWNLOAD_FAILED
				: UPDATE_CHECK_FAILED,
			detail: cleaned === "" ? null : cleaned,
			action,
		};
	}
	const detail = transportDetail(fragment);
	/*
	 * A fragment that is its own clause was written around AUTHORED text, so the
	 * sentence takes its place and the text survives. One that is embedded is
	 * machine vocabulary ("getaddrinfo ENOTFOUND pypi.org"), and substituting a
	 * sentence into the middle of it would be worse than the code was: the
	 * sentence takes the whole message.
	 */
	if (!fragment.clause) {
		return { sentence: UPDATE_SERVER_UNREACHABLE, detail, action };
	}
	/*
	 * AND THE SURVIVING PREFIX HAS TO BE THE APP'S OWN LABEL, which is where the
	 * wrapper case went wrong: electron-updater builds "Cannot parse releases feed:
	 * Unable to find latest version on GitHub (https://...), please ensure a
	 * production release exists: " around the code, and keeping it welded 200
	 * characters of release-engineer prose - address and all - to the front of a
	 * sentence written for a person (design D1, UX U2). A prefix is kept only when
	 * it reads as a label, and a tail only when there is one and it reads the same
	 * way; otherwise the sentence stands alone and the machine keeps its words on
	 * the line below.
	 */
	const prefix = cleaned.slice(0, fragment.start);
	const tail = cleaned.slice(fragment.end).trim();
	if (!isAuthoredLabel(prefix) || (tail !== "" && !isAuthoredLabel(tail))) {
		return { sentence: UPDATE_SERVER_UNREACHABLE, detail, action };
	}
	return {
		sentence: `${prefix}${UPDATE_SERVER_UNREACHABLE}${cleaned.slice(fragment.end)}`,
		detail,
		action,
	};
}

/**
 * The machine's own line for one transport fragment, or null when it adds nothing.
 *
 * A Chromium code names itself (`net::ERR_TIMED_OUT` is the finding a bug report
 * needs). An errno form does not: `getaddrinfo ENOTFOUND pypi.org` is one clause
 * whose subject is the whole phrase, so a bare `ENOTFOUND` was a machine line
 * with no noun in it, and an engine phrase like `Failed to fetch` is what the
 * sentence above has already said in English (design round 1, D8). The clause
 * wins when it says more than the token; otherwise the sentence stands alone.
 */
function transportDetail(fragment: TransportFragment): string | null {
	if (fragment.code.startsWith("net::")) return fragment.code;
	const clause = fragment.clauseText.trim();
	if (clause === "" || clause === fragment.code) return null;
	return clause;
}

/**
 * Whether this text is a label the APP wrote, rather than machine wrapping.
 *
 * The trailing separator is dropped first: a prefix is held with the `: ` that
 * introduced the code, and that punctuation is not part of the label.
 */
function isAuthoredLabel(text: string): boolean {
	const label = text.trim().replace(TRAILING_SEPARATOR, "").trim();
	if (label === "" || label.length > AUTHORED_LABEL_MAX_LENGTH) return false;
	if (label.includes("\n")) return false;
	return !MACHINE_MARK.test(label);
}

/**
 * Whether this text is already a sentence for a person.
 *
 * Deliberately conservative: a phrase of a few words with none of the machine's
 * marks. Anything else - a bare code, a library error, a `label: code` pair, a
 * narration long enough to be a dump - is treated as the machine's and gets the
 * sentence and the machine line instead. Guessing that a machine string is copy
 * is the failure this module exists to remove, so the default is the opposite.
 */
function isAuthoredSentence(text: string): boolean {
	const sentence = text.trim();
	if (sentence === "" || sentence.length > AUTHORED_SENTENCE_MAX_LENGTH) {
		return false;
	}
	if (MACHINE_MARK.test(sentence)) return false;
	return sentence.split(WHITESPACE_RUN).length >= 4;
}

/** Just the sentence, for a surface that has nowhere to put a machine line. */
export function updateErrorMessage(message: string): string {
	return updateErrorCopy(message).sentence;
}

/**
 * The message one caught value carries, in the shape `updateErrorCopy` reads.
 *
 * WHY IT IS ONE FUNCTION. Two clean-ups have to happen in this order and both
 * are easy to get wrong the other way round: Electron's invoke envelope comes
 * off first (`unwrapIpcErrorMessage`, because it wraps the whole thing), then
 * the `Error: ` prefixes the nesting left behind (`stripErrorPrefixes`). The pair
 * was written out by hand at six call sites in two components (review round 1,
 * R6), which is six places for the order to drift - and the order is what
 * decides whether a doubled prefix reaches the reader.
 */
export function updateMessageOf(caught: unknown): string {
	return stripErrorPrefixes(unwrapIpcErrorMessage(caught));
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
 * What to DO with one update-path message, wherever it arrived from.
 *
 * - `muted`: it is a known non-failure; logged, never painted. A release with
 *   no artifact for this build is not a failure the user can act on, and the
 *   panel already shows what is true.
 * - `show`: the app owes the reader a sentence.
 *
 * Total by construction: every message gets one of the two, so no message can
 * be silent by omission on one channel and loud on the other.
 *
 * THERE WAS A THIRD FATE, `by-hand`, ROUTED ON THE SUBSTRING "manually" (review
 * round 1, R4). It is gone because it was dead on both channels: main's only
 * producer of that wording was replaced by the structured
 * `backend-update-manual-required` event, which carries the command and the
 * installation it was read from, and no other producer in the tree emits the
 * word. A substring test that can no longer match is worse than none - it reads
 * as a live rule - so the route is deleted rather than justified in place.
 */
export type UpdateMessageFate = "muted" | "show";

export function updateMessageFate(message: string): UpdateMessageFate {
	if (RELEASE_ARTIFACT_ERROR_REGEX.test(message)) return "muted";
	return "show";
}
