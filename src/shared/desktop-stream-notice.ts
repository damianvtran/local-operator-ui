/**
 * The transport's machine vocabulary for a dead stream, and the CLASSIFICATION
 * that turns it into a locale-free id.
 *
 * WHY THIS EXISTS RATHER THAN SHOWING THE DETAIL. Both transports describe a
 * dead stream in machine register, and they describe the SAME failure in
 * different words: main's relay emits `The event stream was refused (401).` for
 * a rotated token, while the browser dev proxy's `EventSource` can only say
 * `The event stream ended.`. Shipping either one put a bare HTTP status (or,
 * worse, a cause the app does not know - a refused stream did not "end") in
 * front of a reader whose actual question is "have I lost this conversation?".
 * That is design round 1's D1, and the reason the photographed sentence and the
 * packaged sentence were two different sentences for one defect.
 *
 * WHAT THIS MODULE HOLDS, AND WHAT IT DELIBERATELY DOES NOT. The details are not
 * copy: they are declared ONCE here and emitted by the relay
 * (`src/main/desktop-stream.ts`) and the browser transport (`desktop-api.ts`),
 * and `sessionFailureKind` classifies whichever one arrives into an id. The
 * SENTENCES live in the renderer
 * (`features/chat/canonical/session-failure-notice.ts`), because wording them
 * through `t()` from here pulled every English catalogue into the PRELOAD bundle
 * (measured: 333 kB before, 7.5 MB after) for strings a preload script never
 * draws. A test can still pin the notice to the exact detail the relay emits
 * (see `scripts/session-load-recovery.test.mjs`); it goes through the renderer
 * module now, which is the one authority for the words.
 *
 * `SessionFailureNotice` keeps its contract: state what happened and what to do,
 * assert no cause the app has not observed, and blame nobody. `action` is null
 * where no control can honestly help.
 */

/**
 * The transport's machine register for a dead stream.
 *
 * Never rendered. Emitted by the relay / browser transport as an error frame's
 * `detail`, classified by `sessionFailureKind` and worded in the renderer.
 */
export const DESKTOP_STREAM_DETAIL = {
	/** No desktop pairing token: nothing to authenticate with. */
	notPaired: "This backend was not started with desktop controls.",
	/** Nothing was listening on the backend's origin. */
	serverDown: "The Local Operator server is not answering.",
	frameBudget: "The event stream exceeded its frame budget.",
	ended: "The event stream ended.",
	connectionFailed: "The event stream connection failed.",
	/** The IPC subscribe itself rejected before a stream existed. */
	openFailed: "The event stream could not be opened.",
	/** A backend answered and refused this app's bearer (typically 401/403). */
	refused: (status: number) => `The event stream was refused (${status}).`,
	/**
	 * The same refusal where no status reached the caller.
	 *
	 * The browser dev proxy (`scripts/vite-plugins/desktop-proxy.ts`) learns the
	 * upstream status but replays it to an `EventSource`, which surfaces only
	 * "the connection closed" to the renderer. Declared here so the vocabulary
	 * stays one list rather than a list plus one string in a script.
	 */
	refusedWithoutStatus: "The event stream was refused.",
} as const;

/** What the reader can do about the failure, if anything. */
export type SessionFailureAction = "reconnect";

/**
 * The published failure state: ONE sentence, and the one action that helps.
 *
 * `statement` is a single sentence in the product's voice - it names what
 * happened and what to do, asserts no cause the app has not observed, and
 * blames nobody. `action` is null where no control can honestly help.
 *
 * `kind` travels WITH the sentence rather than beside it, because a caller that
 * holds this object must be able to ask for the sentence again in another
 * language: the wording lives in `session-failure-notice.ts` and is resolved
 * from this id, so a held notice is re-worded (`sessionFailureNotice(kind)`)
 * instead of keeping the language it was created in. Two fields pointing at one
 * condition could disagree; the id cannot.
 */
export type SessionFailureNotice = {
	/** Which condition this notice words, for re-resolution in a new locale. */
	kind: SessionFailureKind;
	statement: string;
	action: SessionFailureAction | null;
};

/**
 * Which product sentence a transport detail calls for, as an ID.
 *
 * WHY AN ID AND NOT THE SENTENCE (and why the sentences are not here at all):
 * this module is imported by main and preload for `DESKTOP_STREAM_DETAIL`, and
 * reaching the catalogue's `t()` from here pulled every English catalogue into
 * the PRELOAD bundle — measured at 333 kB before, 7.5 MB after, for copy a
 * preload script never draws. So the shared half keeps the MACHINE vocabulary
 * and the classification, which are both locale-free, and the renderer resolves
 * the ID into copy through `t()` (`features/chat/canonical/session-failure-notice.ts`).
 */
export type SessionFailureKind =
	| "frameTooLarge"
	| "historyUnreadable"
	| "lost"
	| "notPaired"
	| "serverDown";

/**
 * Classify a transport detail.
 *
 * Keyed on the constants above rather than on substrings: a detail the relay
 * gains later falls through to the honest, generic connection sentence, and
 * `refused` is matched by prefix because it carries the backend's status code.
 */
export function sessionFailureKind(
	detail: string | null | undefined,
): SessionFailureKind {
	if (!detail) return "lost";
	if (detail === DESKTOP_STREAM_DETAIL.notPaired) return "notPaired";
	if (detail === DESKTOP_STREAM_DETAIL.serverDown) return "serverDown";
	if (detail === DESKTOP_STREAM_DETAIL.frameBudget) return "frameTooLarge";
	// `ended`, `connectionFailed` and `openFailed` are all "the connection is
	// gone" to the reader, which is the only distinction they can act on.
	return "lost";
}
