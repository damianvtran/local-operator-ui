import type { AccessQueueEntry } from "../vendor/driver/access-queue";
import { CHROME_API_DEADLINE_MS } from "../vendor/driver/deadline";

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
 * numbers sit under its own timeout chain. This is the extension's
 * `CHROME_API_DEADLINE_MS` value under this host's name for the API it bounds —
 * the same 5 s "an API call that is milliseconds when healthy" ceiling, named
 * for what it bounds here. Taking the value from the vendored table rather than
 * re-spelling `5_000` keeps one number in this repo.
 */
export const WEB_CONTENTS_DEADLINE_MS = CHROME_API_DEADLINE_MS;
