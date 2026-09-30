/**
 * The checkpoint rail's jump: §D7's near path in one place — ensure the row is
 * within the DOM's reach, reveal it through the collapse branch's walk, anchor
 * its top at the transcript region's top, and flash where it landed.
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
 * WHY A FIXED TOP ANCHOR AND NOT THE CENTRE. Issue #680 measured the centred
 * landing resolving at varying viewport positions — the single synchronous
 * read races the windowed mount and the collapse walk's own layout changes,
 * and the reversed-axis clamps make both content ends ambiguous. The decided
 * rule, ONE deterministic landing, anchors the target row's TOP at the
 * transcript scrollport's top and re-measures it over a bounded settle before
 * resolving; the boundary cases (nearest-end offset clamping, the oldest-end
 * clamp, taller-than-viewport rows) are named at `landOnTop` below.
 * `scrollIntoView` stays out for the reason `shared/lib/scroll.ts`'s header
 * measures (it scrolls the app frame at narrow widths, twice in the built
 * app), and the region's OWN axis is still named at the call site
 * (`"reversed"`: the transcript scrolls on `flex-col-reverse`, the contract in
 * `use-scroll-paging.ts`). The failure jump keeps its platform scroll; that is
 * its shipped behaviour and this module does not own it.
 *
 * This module honours the rail's contract that a failed jump is a SENTENCE,
 * never an error: every path resolves, and the caller (the transcript) is the
 * one that speaks to the reader.
 */

import { scrollRegionToTop } from "@shared/lib/scroll";
import { TRANSCRIPT_TOP_FADE_PX } from "@shared/lib/transcript-fade";
import { revealRecord } from "./failed-row-jump";
import {
	LOADER_SETTLE_FRAMES,
	createBackwardLoader,
	nextFrame,
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

/*
 * The anchor settle (issue #680). `JUMP_ANCHOR_MAX_FRAMES` is the loader's own
 * settle plus the two frames a late window-mount commit can take before a
 * re-apply is believed; a target that holds for `JUMP_ANCHOR_STABLE_FRAMES`
 * consecutive frames at the scrollport's top is anchored. The tolerance is a
 * pixel: sub-pixel rounding is not drift, and chasing it would re-assign
 * `scrollTop` forever on a fractional layout.
 */
const JUMP_ANCHOR_MAX_FRAMES = JUMP_SETTLE_FRAMES + 2;
const JUMP_ANCHOR_STABLE_FRAMES = 2;
const JUMP_ANCHOR_EPSILON_PX = 1;

/*
 * The landing inset (design round 1's D1): the target's top lands this far
 * below the scrollport's top, and the value IS the transcript's top-fade depth
 * - at 0px the row sits inside the mask's ramp and reads dimmed (peak ink 189
 * against 238 unmasked, measured), which is the fix trading a row in the wrong
 * place for one that is half-invisible. Derived from the fade's own constant
 * rather than restated, so a fade edit moves the landing with it; the rail's
 * reading line (`use-active-checkpoint.ts`) names the same constant, because a
 * landing at `top + INSET` fails a `<= top + 1` line test and the rail would
 * light the tick BEFORE the target (the correction to D1).
 */
export const JUMP_ANCHOR_INSET_PX = TRANSCRIPT_TOP_FADE_PX;

/*
 * The settle's generation (review round 1, MINOR 2): the LAST jump's loop owns
 * the scroller. A newer settle (another tick press, a search hit) bumps this,
 * and every earlier loop stops re-applying on its next frame check instead of
 * contending for its own remaining budget - without it, two overlapping jumps
 * can visibly oscillate between their anchors after the reader has moved on.
 */
let settleGeneration = 0;

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
/**
 * Anchor, then settle.
 *
 * The first assignment is the anchor arithmetic; the loop that follows exists
 * because the reveal can commit layout AFTER the walk reports `onRevealed`
 * (the window mount is a React state write, and expanding a collapsed run
 * changes the heights above the target), so a single read is a read of a
 * moving page. Each frame re-measures the target's top against the
 * scrollport's top and re-applies the anchor while it drifts; a target that
 * holds for `JUMP_ANCHOR_STABLE_FRAMES` frames is anchored, and the loop is
 * bounded by `JUMP_ANCHOR_MAX_FRAMES` so a pathological layout costs frames,
 * not a hang.
 *
 * THE SETTLE YIELDS TO THE READER: a wheel, pointer-down or touch on the
 * region, or a scroll key (arrows, page keys, home/end, space) anywhere, during
 * the window means the reader is steering, and re-applying the anchor would
 * yank the view out from under them; the jump has already revealed the target,
 * so the loop stops touching `scrollTop` and returns. The keyboard arm exists
 * because the rail's own jump is a keyboard gesture (focus a tick, Enter) and
 * the next press is a scroll key more often than not (review round 1's NIT 1).
 *
 * Boundary rules on the reversed axis (issue #680's table): a target within a
 * viewport of the newest rows cannot be pushed to the scrollport's top (that
 * needs a positive offset, and nothing exists past the newest row) - it lands
 * at `scrollTop` 0, the closest achievable, the only allowed alternative; a
 * target at the oldest end clamps at the browser's negative bound; and a row
 * taller than the viewport anchors its TOP by construction.
 */
async function landOnTop(
	region: HTMLElement,
	target: HTMLElement,
): Promise<void> {
	/*
	 * `settleGeneration += 1` is its own statement, not an assignment expression:
	 * the repo's Biome rates `noAssignInExpressions` an error (review round 2's
	 * BLOCKER - the inherited warnings elsewhere were why the first round went
	 * green), and the two lines say the same thing.
	 */
	settleGeneration += 1;
	const generation = settleGeneration;
	scrollRegionToTop(region, target, "reversed", JUMP_ANCHOR_INSET_PX);
	const SCROLL_KEYS = new Set([
		"ArrowUp",
		"ArrowDown",
		"PageUp",
		"PageDown",
		"Home",
		"End",
		" ",
	]);
	let yielded = false;
	const yieldToReader = () => {
		yielded = true;
	};
	const onKey = (event: KeyboardEvent) => {
		if (SCROLL_KEYS.has(event.key)) yielded = true;
	};
	/*
	 * `passive` and `once`: the listener never reads or prevents anything, and
	 * only the first gesture matters. The listeners that never fire are removed
	 * below - `once` releases only the one that does. The keyboard listener is
	 * window-level: the transcript scroller is not focusable, so the next press
	 * after a tick's Enter lands on the body (or the tick itself), not on it.
	 */
	region.addEventListener("wheel", yieldToReader, {
		passive: true,
		once: true,
	});
	region.addEventListener("pointerdown", yieldToReader, {
		passive: true,
		once: true,
	});
	region.addEventListener("touchstart", yieldToReader, {
		passive: true,
		once: true,
	});
	window.addEventListener("keydown", onKey);
	try {
		let stable = 0;
		for (let frame = 0; frame < JUMP_ANCHOR_MAX_FRAMES; frame += 1) {
			await nextFrame();
			if (yielded || generation !== settleGeneration) break;
			const drift =
				target.getBoundingClientRect().top -
				region.getBoundingClientRect().top -
				region.clientTop -
				JUMP_ANCHOR_INSET_PX;
			if (Math.abs(drift) <= JUMP_ANCHOR_EPSILON_PX) {
				stable += 1;
				if (stable >= JUMP_ANCHOR_STABLE_FRAMES) break;
				continue;
			}
			stable = 0;
			scrollRegionToTop(region, target, "reversed", JUMP_ANCHOR_INSET_PX);
		}
	} finally {
		region.removeEventListener("wheel", yieldToReader);
		region.removeEventListener("pointerdown", yieldToReader);
		region.removeEventListener("touchstart", yieldToReader);
		window.removeEventListener("keydown", onKey);
	}
}

export function jumpToEntry(
	root: ParentNode,
	region: HTMLElement,
	id: string,
): Promise<JumpOutcome> {
	return new Promise((resolve) => {
		revealRecord(root, id, {
			onRevealed: (target) => {
				/*
				 * The wash paints at the reveal, not after the settle: it is the
				 * arrival cue, and it belongs to the target row wherever the settle
				 * leaves it. The promise resolves once the anchor has settled (or the
				 * reader took over), matching the contract above.
				 */
				paintJumpHighlight(target);
				void landOnTop(region, target).then(() => {
					resolve("landed");
				});
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
 * still for the same window instead (only the animation is gated on
 * `prefers-reduced-motion: no-preference`; the `[data-jump-highlight]` ground
 * sits outside it), because the flash is information before it is motion:
 * without it a reduced-motion reader arrives somewhere with no cue at all.
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
