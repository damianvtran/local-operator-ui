/**
 * The bounded-await helper, and the ceilings the driver's own awaits use.
 *
 * LOCAL PORT of the `deadline()` half of `extension/src/settle.ts` in
 * `damianvtran/local-operator` at `d383e6bfe`. The other half of that module —
 * `settle()`, built on `chrome.webNavigation` — is NOT portable and is not
 * ported: design 12.1 lists the substitution the UI must make (`did-finish-load`
 * / `did-fail-load` / `did-navigate-in-page`), and `settle.ts` in this host is
 * the rewritten version against real Electron events.
 *
 * TODO(vendoring): replace with the vendored copy — see
 * `scroll-expressions.ts`'s header.
 *
 * CEILINGS ("this operation is milliseconds when healthy"), not measured
 * budgets. The numbers are the extension's, unchanged, and they exist because a
 * lost CDP reply on a healthy page is rare while a hung await in a long-lived
 * main process is permanent: without a ceiling one stalled call parks a tab's
 * command lane forever and every later command on that tab reads as `busy`.
 */

import { BrowserHostError } from "../errors";

/** Most CDP commands (`Runtime.evaluate`, `DOM.*`, `Accessibility.getFullAXTree`,
 * `Page.captureScreenshot`). Raised from 10 s because a healthy heavy screenshot
 * was measured well past it, and a false `stalled` on a working page is worse
 * than a slow one. */
export const CDP_DEADLINE_MS = 15_000;

/** Attaching a debugger session, and the liveness probe that distinguishes our
 * own surviving attachment from a foreign one. Short on purpose: a probe that
 * does not answer is the answer this ceiling exists to give. */
export const CDP_ATTACH_DEADLINE_MS = 5_000;

/** A main-process API call that is milliseconds when healthy (loading a URL,
 * reading navigation history, closing a view). */
export const WEB_CONTENTS_DEADLINE_MS = 5_000;

/** Page script run through the debugger (`read`, `type`'s read-back). Shares the
 * CDP profile. */
export const SCRIPTING_DEADLINE_MS = 15_000;

/**
 * Bound an await, rejecting with a typed error instead of hanging forever.
 *
 * `what` names the stalled operation and rides in `data.stalled`, following the
 * extension's rule that a new wire code would be silently dropped by an
 * already-released session client while a discriminator on an existing code is
 * always legible. The code is `internal` for the same reason.
 *
 * Both arms clear the timer AND both are attached immediately: the abandoned
 * operation's eventual rejection must be handled here or it surfaces as an
 * unhandled rejection in the main process.
 */
export function deadline<T>(
	op: Promise<T>,
	ms: number,
	what: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(
				new BrowserHostError(
					"internal",
					`${what} did not respond within ${ms}ms`,
					{ stalled: what },
				),
			);
		}, ms);
		op.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** Whether a throwable is this module's own ceiling firing rather than a real
 * failure from the operation. Callers that would otherwise interpret a stall as
 * evidence about the page (a closed tab, a missing element) must not: our own
 * event loop stalling says nothing about the page. */
export function isStalled(error: unknown): boolean {
	return (
		error instanceof BrowserHostError && typeof error.data.stalled === "string"
	);
}

/** A plain sleep, named so the call sites read as a settle grace rather than an
 * unexplained timer. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
