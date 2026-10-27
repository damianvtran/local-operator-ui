/**
 * The one user-facing sentence the app shows when it cannot read a conversation.
 *
 * WHY this exists rather than showing the transport's own `detail` string. Both
 * transports describe a dead stream in machine register, and they describe the
 * SAME failure in different words: main's relay emits
 * `The event stream was refused (401).` for a rotated token, while the browser
 * dev proxy's `EventSource` can only say `The event stream ended.`. Shipping
 * either one put a bare HTTP status (or, worse, a cause the app does not know -
 * a refused stream did not "end") in front of a reader whose actual question is
 * "have I lost this conversation?". That is design round 1's D1, and the reason
 * the photographed sentence and the packaged sentence were two different
 * sentences for one defect.
 *
 * So the detail strings are no longer copy. They are a machine vocabulary,
 * declared ONCE here and emitted by the relay (`src/main/desktop-stream.ts`)
 * and the browser transport (`desktop-api.ts`), and `streamFailureNotice`
 * translates whichever one arrives into a single product sentence that says
 * what happened and what to do next. One authority for the strings means a
 * test can pin the notice to the exact detail the relay emits (see
 * `scripts/session-load-recovery.test.mjs`) instead of asserting a copy that
 * nothing produces.
 *
 * Scope: these are the sentences for "this conversation cannot be read". A
 * condition the app cannot act on offers no `action`, so the UI does not paint
 * a control that would promise something it cannot deliver.
 */

/**
 * The transport's machine register for a dead stream.
 *
 * Never rendered. Emitted by the relay / browser transport as an error frame's
 * `detail`, translated by `streamFailureNotice`.
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
 */
export type SessionFailureNotice = {
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
