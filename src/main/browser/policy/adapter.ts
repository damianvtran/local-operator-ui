import type { AccessQueueEntry } from "../vendor/driver/access-queue";
// `CHROME_API_DEADLINE_MS` is deliberately NOT imported any more: this file's own
// bound is a host-side number now (see `WEB_CONTENTS_DEADLINE_MS` below for the
// measurement), and the vendored table keeps its value for the API it describes.

/**
 * This host's own additions to the shared driver modules.
 *
 * WHAT THIS LAYER IS FOR. `src/main/browser/vendor/driver/` is a byte-for-byte
 * copy of the extension's host-free modules, written only by
 * `scripts/sync-vendored.mjs` and gated by `scripts/check-vendored.mjs`. Those
 * modules deliberately stop at the shared vocabulary; a host adds what is
 * genuinely its own ON TOP of them, here, rather than inside them. Nothing in
 * this file may be a re-implementation of something the vendored copies already
 * decide — that is the divergence the manifest gate exists to catch, and it
 * would be invisible to it (the gate proves the vendored bytes, not this file).
 *
 * Each export names where the extension keeps its own equivalent, so a reviewer
 * comparing the two hosts can check the claim rather than take it on trust.
 */

/**
 * The next queue sequence number for a new access request.
 *
 * The extension mints this in its worker (`extension/src/state.ts`) and passes
 * it into `newEntry`, which is why the shared access-queue module exports the
 * ordering READERS (`liveQueue`, `queuePosition`, `findPending`) and not a
 * minter. This host is one process, so the counter is derived from the queue it
 * holds: max + 1, which is the property the ordering depends on (a new entry
 * always sorts last among live ones) and is stable across expiry, because a
 * cleaned entry still raises the maximum for anything still queued.
 */
export function nextSequence(queue: AccessQueueEntry[] | undefined): number {
	return (
		(queue ?? []).reduce(
			(highest, entry) => Math.max(highest, entry.sequence),
			0,
		) + 1
	);
}

/**
 * The scroll directions this host accepts.
 *
 * The shared `scroll-expressions.ts` owns the EXPRESSIONS (`scrollExpressionFor`
 * and the two constants); which direction strings reach it is a parameter
 * decision each host makes. The extension validates its direction inside its
 * command layer, where a bad value is an argument error; here it is validated at
 * the same place — `actions/page.ts`'s `scroll` — so the set lives beside the
 * matrix rather than inside the shared module.
 */
export const SCROLL_DIRECTIONS: ReadonlySet<string> = new Set([
	"top",
	"bottom",
	"up",
	"down",
	"left",
	"right",
]);

/** A pause between two CDP-driven gestures (click settling before a follow-up
 * read, a click that starts a navigation before the settle is read). The
 * extension spells `sleep` inline where it needs one; two actions here share
 * it, so it is a named helper rather than two copies. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The ceiling on this host's own navigation calls (`webContents.loadURL`, and
 * the CDP commands issued around one).
 *
 * `deadline.ts`'s header is explicit that the helper and its reasoning are the
 * reusable part and the ceiling VALUES are host-side, because each host's
 * numbers sit under its own timeout chain. This bound was the extension's
 * `CHROME_API_DEADLINE_MS` value aliased under this host's name, and it is
 * HOST-SIDE NOW because the measurement that value came from does not hold for
 * this API: the extension's ceiling is about `chrome.tabs.*`/`chrome.storage.*`
 * (browser-process IPC with no page on the path, "milliseconds or the browser is
 * wedged"), while the call it bounds here is a FRESH VIEW'S FIRST NAVIGATION
 * (`cdp.ts`: `loadURL("about:blank")` before `debugger.attach`, which exists
 * because Chromium gives a never-navigated view no renderer at all). That starts
 * a renderer process, so it is a page-load-shaped cost rather than an IPC one.
 *
 * MEASURED (2026-09-19, this host, ~25 sessions, load average 100-190): the 5 s
 * alias fired on `loadURL("about:blank")` — the proof rig's `open` answered
 * `internal` / `data.stalled: "loadURL(about:blank)"` / "did not respond within
 * 5000ms", and every check downstream of it cascaded — on a box where the app's
 * own renderer took minutes to commit its first document.
 *
 * WHY A SATURATED DEV BOX IS THE RIGHT INSTRUMENT FOR A PRODUCT CEILING (review
 * round 5, R5-5, which asked for this case to be stated rather than assumed). The
 * cost of the new number lands on the failure path: a view that never produces a
 * document now answers `stalled` after 15 s instead of 5. Two things make that the
 * right trade. First, the call being bounded is a RENDERER START — Chromium gives a
 * never-navigated view no process at all — so its cost is scheduling and process
 * spawn, which is exactly what a loaded machine delays; an idle box cannot measure
 * this bound, it can only confirm the happy path, and the number it would produce
 * is the one that was already there. Second, the evidence is not one reading: the
 * alias failed here in the rig's own `open`, `tab_closed`/`stalled` cropped up in QA
 * round 4's runs on the same host at load 79-141, and design round 4 could not run
 * the repo rig at all for the same reason. A desk machine with ~25 agent sessions on
 * it is a supported target for this app, not an exotic one.
 *
 * 15 s is the same ceiling this app already gives its other "milliseconds when
 * healthy" channel (the cookie-jar handshake, `session-cookies`), and it stays well
 * under the 30 s navigation settle and the 35 s `open` budget above, so a genuinely
 * wedged view still ends in the typed `stalled` answer rather than in a hang.
 */
export const WEB_CONTENTS_DEADLINE_MS = 15_000;
