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
 * in monospace, subordinate - and it is the CODE that reaches it, not the
 * wrapper's prose: where electron-updater builds 200 characters of parse
 * narration around a failure, only the code is kept, because the narration is
 * addressed to a release owner and not to the person reading the alert (design
 * round 2, U11). Where a message carries an AUTHORED prefix around a machine
 * fragment ("Error downloading update: net::ERR_TIMED_OUT") the prefix is kept
 * and only the fragment is replaced, so the context survives and the reader
 * never sees the code. Where the message is not a transport failure the
 * sentence IS the message when the app wrote it: inventing a cause for an
 * unrecognised failure is the defect class this whole change exists to remove.
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
 * The download stage's own sentence, and WHY IT NAMES THE ACTION IT CAN KEEP.
 *
 * The surface for this stage offers no check control - a check would not
 * re-download anything (`action` is null below) - so a tail that says "then try
 * again" instructed the reader to do something no control in the box answers
 * (design round 2, D-9; UX U9). It names the surface that does own it instead:
 * the update panel's own download control, which is behind this alert.
 */
/**
 * ONE SENTENCE PER STAGE, and why the stages are told apart at all.
 *
 * All three of these labels are live producers reachable from a press - the
 * download, the install-start and the quit-for-install catches in
 * `update-notification.tsx` - and a single sentence for the family said "the update
 * could not be downloaded" to a reader whose download had already landed, sending
 * them back to a control that re-downloads an artifact they already have (design
 * round 3, D-17; review R3-1). Each sentence names its own stage's next action and the
 * surface that owns it: the update panel behind this alert carries the control in
 * every case.
 */
const UPDATE_STAGE_SENTENCE: Record<UpdateStage, string> = {
	download:
		"The update could not be downloaded. Check this machine's connection, then start the download again.",
	install:
		"The update could not be installed. Check this machine's connection, then start it again from the update panel.",
	quit: "The app could not quit to finish the install. Quit the app yourself, then let the update finish.",
};

/**
 * The sentence for a failure a RETRY CANNOT FIX, and why it promises nothing.
 *
 * The classifier refuses to retry this family - a certificate the machine will
 * refuse again, a 404, a 502 - so offering a retry control here would
 * contradict the app's own rule, and "try again in a moment" is a promise the
 * module cannot keep (design round 2, D-12). What is true is that the check did
 * not finish and that the app will ask again on its own schedule, which is the
 * sentence: the machine's own words go to the line below for whoever has to
 * read them.
 */
const UPDATE_CHECK_INCOMPLETE =
	"The update check could not finish. The app will try again at its next check.";

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
	/https?:\/\/|\b(?:net::)?(?:ERR_[A-Z0-9_]+|[A-Z]{2,}_[A-Z_]+)\b|\bE[A-Z]{3,}\b|HttpError|(?:\b[45]\d\d\s+[A-Z][a-z]|:\s*[45]\d\d\b)/;

/**
 * The stage labels this app prefixes its own download and install failures with.
 *
 * They are what tells a failure of the DOWNLOAD apart from a failure of the
 * CHECK: only the latter is answered by pressing the check again, which is the
 * action the copy offers.
 */
const UPDATE_STAGE_LABEL =
	/^(Error downloading update|Error starting the update|Error quitting for the update)\b/i;

/** The stage a labelled failure came from, or null when it carries no stage label. */
type UpdateStage = "download" | "install" | "quit";

function updateStageOf(message: string): UpdateStage | null {
	switch (UPDATE_STAGE_LABEL.exec(message)?.[1]?.toLowerCase()) {
		case "error downloading update":
			return "download";
		case "error starting the update":
			return "install";
		case "error quitting for the update":
			return "quit";
		default:
			return null;
	}
}

/**
 * The whole set of labels THIS APP writes in front of an update failure, and why it
 * is a closed set rather than a length.
 *
 * IT IS EMPTY TODAY, and that is the honest state rather than an oversight. Every label
 * this app writes into a MESSAGE is one of the three stage labels
 * (`UPDATE_STAGE_LABEL`), and those are mapped to their own sentence before this set is
 * consulted - so a surviving prefix has no live producer. The two entries that used to
 * be here named the CHECK stage, which main writes into its LOG ("Error checking for
 * updates:", `update-service.ts`) and not into the payload it sends: the sent message is
 * the bare error, and a rule that kept that prefix alive was keeping a string the app
 * never emits. A new non-stage app label has to be named here to survive, which is one
 * line.
 *
 * A surviving prefix is only worth keeping when the app wrote it: it says which
 * stage of the app was talking, which is context the sentence cannot invent. A
 * prefix a LIBRARY wrote - `Cannot parse releases feed:`, `Request timed out after
 * 30000ms:`, electron-updater's own narration - is addressed to a release owner, and
 * welding it back on was the defect design round 1 (D1) opened this module for. The
 * length-and-marks heuristic this replaces let short library narration through,
 * which the design round measured and recorded as its own trap (round 2, D-14);
 * naming the set instead means an unrecognised prefix cannot be copy by accident.
 *
 * The cost is that a NEW app label has to be added here to survive. That is the
 * right way round: a missing label drops context into the machine line, while a
 * wrong one puts a stranger's prose at reading weight.
 */
const APP_AUTHORED_LABELS: string[] = [];

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
	const stage = updateStageOf(cleaned);
	const fragment = transientTransportFragment(cleaned);
	if (fragment === null) {
		/*
		 * Not a transport failure. A message the app wrote for a person is already
		 * the sentence, and it names its own next step - so no control is offered
		 * over it. Anything else is a machine string and goes to the machine's own
		 * line, under the sentence for its stage: the download stage says what the
		 * reader can do about it, and the check stage promises only what the app
		 * will do, because a retry is exactly what this family refuses.
		 */
		if (isAuthoredSentence(cleaned)) {
			return { sentence: cleaned, detail: null, action: null };
		}
		return {
			sentence:
				stage === null ? UPDATE_CHECK_INCOMPLETE : UPDATE_STAGE_SENTENCE[stage],
			detail: cleaned === "" ? null : cleaned,
			action: null,
		};
	}
	const detail = transportDetail(fragment);
	/*
	 * A TRANSPORT FAILURE IN THE DOWNLOAD STAGE still gets the download's own
	 * sentence: what failed is the download, and the retry the connection
	 * sentence names would be a check that cannot re-download anything (UX U9).
	 */
	if (stage !== null) {
		return { sentence: UPDATE_STAGE_SENTENCE[stage], detail, action: null };
	}
	const action: "check" | null = "check";
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
	if (label === "") return true;
	if (label.includes("\n") || label.length > AUTHORED_LABEL_MAX_LENGTH) {
		return false;
	}
	if (MACHINE_MARK.test(label)) return false;
	/*
	 * The app's own labels, and nothing else: see `APP_AUTHORED_LABELS` for why this
	 * is a set rather than a shape.
	 */
	return APP_AUTHORED_LABELS.includes(label.toLowerCase());
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
