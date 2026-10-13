/**
 * Electron's `ipcRenderer.invoke` rejection envelope, unwrapped in one place.
 *
 * WHY. A rejected invoke is not the error the handler threw: Electron wraps it
 * as `Error invoking remote method '<channel>': <the error's toString()>`, so a
 * renderer that renders `error.message` shows the wire's own framing - and,
 * because the envelope embeds `Error: <message>`, it also carries a second
 * `Error: ` that the update surfaces used to print. Measured shape of the
 * message the check producer saw:
 *
 *     Error invoking remote method 'check-for-updates': Error: net::ERR_TIMED_OUT
 *
 * The unwrap is a loop rather than a single replace because the envelope nests
 * when a handler's own work goes through another invoke, and the
 * `Error: ` that follows the colon is the caught error's own name prefix -
 * `stripErrorPrefixes` in `shared/transport-failure.ts` is what removes that
 * half, so the two are used together rather than one regex being grown to do
 * both jobs.
 *
 * The prefix itself was already spelled once, in
 * `features/browser/hooks/use-browser-chrome.ts`, for the same reason. That
 * copy imports this one now: a second spelling of one rule is how the two
 * surfaces start to disagree about what an IPC failure says.
 *
 * AND SO DOES THE PROJECTION STORE, which carried the third copy — a single
 * `replace` rather than the loop below, so a NESTED envelope still reached the
 * band wearing the wire's own `Error:` framing (review round 2, A-3). There is
 * one spelling of this rule and it is this file's, which is why the store's own
 * `IPC_ERROR_PREFIX` and `messageOf` were deleted rather than corrected in
 * place.
 */
export const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*/;

/** A leading `<code>: ` marker the main process attaches for machine matching.
 * Only the intended code is stripped, not any `word:` prefix: a caller-supplied
 * message must not be truncated because it happened to start with a colon-shaped
 * token (round 2, NN-1). `browser_unavailable:` is the one code the browser IPC
 * handlers attach; the tests that match `browser_unavailable` read the raw
 * message, not this presentation form. */
export const ERROR_CODE_PREFIX = /^browser_unavailable:\s+/;

/** The message a person may be shown, with the invoke envelope removed. */
export function unwrapIpcErrorMessage(caught: unknown): string {
	const raw = caught instanceof Error ? caught.message : String(caught);
	let message = raw.trim();
	while (IPC_ERROR_PREFIX.test(message)) {
		message = message.replace(IPC_ERROR_PREFIX, "").trim();
	}
	// The code rides the wire for machine matching; strip it from the string a
	// surface may render (review round 1, F3).
	return message.replace(ERROR_CODE_PREFIX, "").trim();
}
