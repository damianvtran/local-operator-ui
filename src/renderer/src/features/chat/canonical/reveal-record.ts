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
 * the jump moves that region and nothing else. The failure jump keeps its
 * platform scroll; that is its shipped behaviour and this module does not own
 * it.
 *
 * This module honours the rail's contract that a failed jump is a SENTENCE,
 * never an error: every path resolves, and the caller (the transcript) is the
 * one that speaks to the reader.
 */

import { scrollRegionToCenter } from "@shared/lib/scroll";
import { revealRecord } from "./failed-row-jump";

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
export const JUMP_SETTLE_FRAMES = 6;

const nextFrame = (): Promise<void> =>
	new Promise((resolve) => {
		window.requestAnimationFrame(() => {
			resolve();
		});
	});

const settleFrames = async (done: () => boolean): Promise<void> => {
	for (let frame = 0; frame < JUMP_SETTLE_FRAMES && !done(); frame += 1) {
		await nextFrame();
	}
};

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
};

/**
 * Bring the row within the DOM's reach, or report that it cannot be reached.
 *
 * The loop is D7's near path with the render window added: load pages until
 * the row is in the model, then mount the window far enough to include it,
 * then wait for the commit. The budget is refused in both currencies the
 * design names — pages fetched and rows mounted — and a refusal is a `false`
 * for the caller's one-line notice, never a throw.
 */
export async function ensureReachable(options: ReachOptions): Promise<boolean> {
	const { isReachable, rowDistance, mount, loadOlder } = options;
	let pages = 0;
	while (true) {
		if (isReachable()) return true;
		const distance = rowDistance();
		if (distance !== null) {
			if (distance > JUMP_MAX_MOUNTED_ROWS) return false;
			mount(distance);
			await settleFrames(isReachable);
			return isReachable();
		}
		if (pages >= JUMP_MAX_PAGES) return false;
		pages += 1;
		if (!(await loadOlder())) return false;
		/*
		 * The applied page lands a commit later; waiting for the model to show
		 * it is what stops the loop fetching the next page blind (and what
		 * stops a fast loop from spending its whole page budget in one task).
		 */
		await settleFrames(() => isReachable() || rowDistance() !== null);
	}
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
				scrollRegionToCenter(region, target);
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
