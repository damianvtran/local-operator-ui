/**
 * The checkpoint rail's jump: §D7's near path in one place — ensure the row is
 * within the DOM's reach, reveal it through the collapse branch's walk, centre
 * it in the transcript region, and flash where it landed.
 *
 * WHY THE LOOP LIVES HERE AND NOT IN THE COMPONENT. `canonical-transcript.tsx`
 * owns the two halves the loop cannot: where the row sits in the row model
 * (`rowDistance`), and the state write that mounts the window far enough to
 * include it (`mount`). Everything else — the page budget, the stop
 * condition, the frame waits — is policy, and policy that a jsdom test can
 * drive against fakes is policy worth pinning (`scripts/reveal-record.test.mjs`).
 *
 * WHY THE REVEAL HALF IS NOT HERE. Opening the gated layers is the collapse
 * branch's walk (`failed-row-jump.ts`'s `revealRecord`, exported for exactly
 * this caller by D7's ownership note). A second copy of it in this file is
 * the defect that note exists to prevent.
 *
 * WHY `scrollRegionToCenter` AND NOT `scrollIntoView`. The rail's jump is the
 * third consumer this repository's region-scroll helper was written for (see
 * `shared/lib/scroll.ts`'s header): `scrollIntoView` walks the ancestor chain
 * and can scroll the app frame at narrow widths — measured, twice, in the
 * built app. The rail targets a row inside the transcript's own scroller, so
 * the jump moves that region and nothing else - with the region's OWN axis
 * named at the call site (`"reversed"`: the transcript scrolls on
 * `flex-col-reverse`), which design round 1's D1 measured as the difference
 * between landing and a silent no-op. The failure jump keeps its platform
 * scroll; that is its shipped behaviour and this module does not own it.
 *
 * This module honours the rail's contract that a failed jump is a SENTENCE,
 * never an error: every path resolves, and the caller (the transcript) is the
 * one that speaks to the reader.
 */

import { scrollRegionToCenter } from "@shared/lib/scroll";
import { revealRecord } from "./failed-row-jump";
import {
	LOADER_SETTLE_FRAMES,
	createBackwardLoader,
} from "./transcript-loader";

/** The attribute the landing highlight paints on the revealed row. */
export const JUMP_HIGHLIGHT_ATTR = "data-jump-highlight";

/** How long the landing highlight stays (§D7: ~1.4 s, removed by timer). */
export const JUMP_HIGHLIGHT_MS = 1400;

/** D7's MAX_AUTO_PAGES: how many pages the near path may fetch. */
export const JUMP_MAX_PAGES = 12;

/**
 * The near path's mount budget, in rows from the tail.
 *
 * A jump mounts everything between its target and the newest row — the render
 * window is newest-anchored (`canonical-transcript.tsx` slices it from the
 * end), so there is no cheaper way to show a distant row. D7 bounds the near
 * path at 12 pages × 100 rows; this is that bound stated where the mount
 * happens. A row further back is the FAR path's subject (UI-B's anchored
 * window) and v1 refuses it honestly rather than stalling the pane.
 */
export const JUMP_MAX_MOUNTED_ROWS = 1200;

/**
 * How many frames a mount or an applied page is given to reach the DOM.
 *
 * Both land through React state — the window is a `setState`, a page is an
 * external-store write — so the DOM does not know about either until a commit
 * after the promise resolves. Six frames (~100 ms) is generous for a commit
 * and still bounds a jump whose row will never appear; the loop above re-reads
 * its state after each wait, so a slow frame costs latency, never correctness.
 */
export const JUMP_SETTLE_FRAMES = LOADER_SETTLE_FRAMES;

export type ReachOptions = {
	/**
	 * The DOM's own answer (`isRecordReachable`): the row is on screen, or a
	 * collapsed bar/fold in the DOM names it. Deliberately not a model check —
	 * a row behind a collapsed bar is reachable although it is not mounted.
	 */
	isReachable: () => boolean;
	/**
	 * When the row is in the store but outside the mounted window: how many
	 * rows from the tail it sits, i.e. the window size that would include it.
	 * `null` when the store does not hold it (yet).
	 */
	rowDistance: () => number | null;
	/** Mount the window `distance` rows wide (newest-anchored). */
	mount: (distance: number) => void;
	/** Fetch one older page; `false` when none was applied. */
	loadOlder: () => Promise<boolean>;
	/**
	 * When the row is in the store: whether the store already holds the margin
	 * above it (older rows) that a CENTRED landing needs. The mount can only
	 * include rows the store has, so a target that is the store's oldest row —
	 * the leading row of every fetched page — mounts with nothing above it and
	 * centres clamped at the content's top (QA Q-2, measured −254 px, the first
	 * ~8 rows of every page). The loop fetches another page while this is
	 * false, inside `JUMP_MAX_PAGES`; optional, and `true` is the default for a
	 * caller with no margin requirement.
	 */
	hasHeadroom?: () => boolean;
};

/**
 * Bring the row within the DOM's reach, or report that it cannot be reached.
 *
 * The loop is D7's near path with the render window added: load pages until
 * the row is in the model, fetch the margin's page while the store ends at
 * the row (see `hasHeadroom`), then mount the window far enough to include
 * it, then wait for the commit. The budget is refused in both currencies the
 * design names — pages fetched and rows mounted — and a refusal is a `false`
 * for the caller's one-line notice, never a throw.
 */
export async function ensureReachable(options: ReachOptions): Promise<boolean> {
	const { isReachable, rowDistance, mount, loadOlder } = options;
	const hasHeadroom = options.hasHeadroom ?? (() => true);
	/*
	 * The walk itself lives in `transcript-loader.ts` — the shared module the
	 * collapse lane's diagnosis named as the one home for this policy. This
	 * call is the jump's adapter: the loader's budgets are lifted from the
	 * constants above, and "landed" is the boolean this module's callers have
	 * always been handed. Keeping the constants here (rather than in the
	 * loader) is deliberate: they are the JUMP's budget, and a reader's paging
	 * or an align fetch passes its own.
	 */
	const walk = createBackwardLoader({
		reachable: isReachable,
		rowDistance,
		mount,
		loadOlder,
		hasHeadroom,
	});
	const outcome = await walk.loadThrough({
		maxPages: JUMP_MAX_PAGES,
		maxRows: JUMP_MAX_MOUNTED_ROWS,
	});
	return outcome === "landed";
}

export type JumpOutcome = "landed" | "missing";

/**
 * The reveal → centre → highlight leg, over the shared walk.
 *
 * Resolves once the row has been revealed and centred, or once the walk
 * reports there is nothing in the DOM to reveal (`"missing"` — the caller's
 * ensure half was skipped or raced a remount; either way the caller speaks).
 */
export function jumpToEntry(
	root: ParentNode,
	region: HTMLElement,
	id: string,
): Promise<JumpOutcome> {
	return new Promise((resolve) => {
		revealRecord(root, id, {
			onRevealed: (target) => {
				/*
				 * `"reversed"`: the region here is the canonical transcript's own
				 * scroller, whose `flex-col-reverse` axis runs 0 at the newest row to
				 * a negative bound at the oldest (the measured contract in
				 * `use-scroll-paging.ts`). Design round 1's D1 measured the cost of
				 * leaving this to the default: with the normal-axis clamp the
				 * landing was a no-op and the wash painted off-screen.
				 */
				scrollRegionToCenter(region, target, "reversed");
				paintJumpHighlight(target);
				resolve("landed");
			},
			onMissing: () => {
				resolve("missing");
			},
		});
	});
}

/**
 * Timers already running per element, so a second jump to the same row
 * restarts the flash instead of letting the first jump's timer clear it early.
 */
const highlightTimers = new WeakMap<HTMLElement, number>();

/**
 * Flash the landed row: the attribute `styles/index.css` animates, removed
 * again after `JUMP_HIGHLIGHT_MS`.
 *
 * Reduced motion does not cancel the highlight — the stylesheet holds the wash
 * still for the same window instead (`prefers-reduced-motion: no-preference`
 * gates only the animation, the same split `.lo-install-sweep` documents),
 * because the flash is information before it is motion: without it a reduced-
 * motion reader arrives somewhere with no cue at all.
 */
export function paintJumpHighlight(target: HTMLElement): void {
	const running = highlightTimers.get(target);
	if (running !== undefined) window.clearTimeout(running);
	const alreadyLit = target.hasAttribute(JUMP_HIGHLIGHT_ATTR);
	target.removeAttribute(JUMP_HIGHLIGHT_ATTR);
	// One forced reflow, and only on a repeat: removing and re-adding the
	// attribute inside one task is invisible to the style engine otherwise, and
	// the animation would not restart.
	if (alreadyLit) void target.offsetHeight;
	target.setAttribute(JUMP_HIGHLIGHT_ATTR, "");
	highlightTimers.set(
		target,
		window.setTimeout(() => {
			highlightTimers.delete(target);
			target.removeAttribute(JUMP_HIGHLIGHT_ATTR);
		}, JUMP_HIGHLIGHT_MS),
	);
}
