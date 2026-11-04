import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * THE RAIL KEEPS ITS SCROLL POSITION (operator report: "when I click a channel
 * it scrolls me back to the top ... the scroll position in the sidebar should
 * be held so I can sift through channels/DMs").
 *
 * ROOT CAUSE THIS EXISTS FOR. `TeamBridgePageView` is keyed by
 * `viewKeyFor(account, tenant, target)` on purpose: a new target gets a fresh
 * view, so no timeline scroll, thread pane or composer state leaks from one
 * conversation into the next. The rail is drawn INSIDE that view, so every
 * selection unmounted the rail's `ScrollArea` and mounted a new viewport at
 * `scrollTop` 0. Measured on the shipped page (jsdom, 31 rows): 640 before
 * the click, 0 after, and the old viewport `isConnected === false` - a remount,
 * not a scroll. The key is load-bearing, so the fix keeps it and carries the
 * rail's offset across the remount instead.
 *
 * WHY IN MEMORY, NOT `team-bridge-view-memory`. That record persists ids
 * across app restarts; a raw pixel offset into a list whose rows, sections and
 * unread ordering will all have changed by the next launch is not something to
 * restore after a restart. Within one renderer session the list is the same
 * list, so a module-level map survives both the per-target remount and leaving
 * Team Bridge for another route (the route element unmounts; this module does
 * not). It is keyed by account AND scope, so each organization - and "All
 * organizations" - keeps its own position, and one account never inherits
 * another's.
 *
 * WHEN THE RAIL MAY MOVE ITSELF. Only when the selected row came from outside
 * the rail (a deep link, a notification click, "Message" on a profile opened
 * from the timeline - a profile card opened FROM a rail row is portaled but
 * still inside the rail's React tree, so its "Message" counts as a rail pick,
 * which is harmless because its row is the one beside the card) AND that
 * row is entirely outside the viewport, and then by `block: "nearest"` - the
 * smallest move that shows it. A pick made in the rail never moves the rail
 * (the reader just clicked a row they could see), and neither does returning
 * to the conversation the rail was last held on. Nothing here ever scrolls to
 * the top.
 */
type HeldRailScroll = {
	top: number;
	/** The selection this position was last held under. */
	targetKey: string | null;
	/**
	 * When a click inside the rail last landed (ms), consumed by the next mount.
	 * A time, not a flag: a click that selects nothing (a section toggle) must
	 * not suppress the reveal a much later deep link is owed.
	 */
	railPickAt: number;
};

/** A rail click's selection commits in the same task; this is generous slack. */
const RAIL_PICK_WINDOW_MS = 2_000;
/**
 * How long a remount keeps re-applying the held offset while late rows (the
 * directory's people and chiefs) arrive. Past it the list is what it is.
 */
const RESTORE_WINDOW_MS = 3_000;

const held = new Map<string, HeldRailScroll>();

/** Tests only: positions are module state and would leak between cases. */
export function resetHeldRailScrollForTest(): void {
	held.clear();
}

const entryFor = (key: string): HeldRailScroll => {
	let entry = held.get(key);
	if (!entry) {
		entry = { top: 0, targetKey: null, railPickAt: 0 };
		held.set(key, entry);
	}
	return entry;
};

const viewportOf = (root: HTMLElement | null) =>
	root?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]") ?? null;

/**
 * Hold the rail viewport's `scrollTop` under `holdKey` (account + scope), or
 * hold nothing while `holdKey` is `null` (the account is not resolved yet).
 * `targetKey` identifies the current selection. Returns the callback ref for
 * the rail's ScrollArea root and the click-capture handler that marks a pick
 * made inside the rail.
 */
export function useHeldRailScroll(
	holdKey: string | null,
	targetKey: string | null,
): {
	ref: (root: HTMLElement | null) => void;
	onClickCapture: () => void;
} {
	/*
	 * THE ROOT IS STATE, NOT A REF OBJECT (QA round 1, Q2 / review R6). The rail
	 * is not in the DOM on every commit: after leaving and returning, the view's
	 * first render can be an early state (`gatePending`) with no ScrollArea, and
	 * the rail mounts a commit later under the SAME `holdKey`. An effect that
	 * read `ref.current` once bailed on that first commit and never re-ran, so no
	 * scroll listener was attached and the reader's next scrolls were never
	 * recorded - the next pick or return snapped back to the stale offset. A
	 * callback ref into state re-runs the listener effect whenever the root
	 * element itself appears or changes.
	 */
	const [root, setRoot] = useState<HTMLElement | null>(null);
	/*
	 * Decided ONCE per mount (and again if the account resolves), from the state
	 * the previous mount left: a rail pick, or the same selection as before,
	 * holds; anything else may reveal.
	 */
	const plan = useRef<{
		key: string | null;
		restore: number | null;
		/** The restore gives up after this (ms epoch); see the layout effect. */
		restoreUntil: number;
		reveal: boolean;
		/** The viewport element the plan last ran against. */
		viewport: HTMLElement | null;
	} | null>(null);
	/*
	 * Set once the reader scrolls, wheels, drags or presses in the rail during
	 * this mount. A plan recomputed after that (the hold key flipping from "no
	 * account yet" to the resolved account, review R3) must not restore over a
	 * rail the reader is already moving.
	 */
	const readerMoved = useRef(false);
	if (plan.current === null || plan.current.key !== holdKey) {
		const entry = holdKey === null ? null : entryFor(holdKey);
		plan.current = {
			key: holdKey,
			restore:
				entry && entry.top > 0 && !readerMoved.current ? entry.top : null,
			restoreUntil: Date.now() + RESTORE_WINDOW_MS,
			/*
			 * An entry with no recorded selection (a scope opened for the first
			 * time) may reveal: that is the deep-link-into-a-fresh-scope case.
			 */
			reveal:
				entry !== null &&
				targetKey !== null &&
				!readerMoved.current &&
				Date.now() - entry.railPickAt > RAIL_PICK_WINDOW_MS &&
				entry.targetKey !== targetKey,
			viewport: null,
		};
	}
	/*
	 * The entry is written in effects, never during render: a render React
	 * discards or repeats (StrictMode) must not consume the pick or the
	 * selection the plan above was derived from.
	 *
	 * A `null` selection is NEVER recorded (review R1 / QA Q1). An org switch
	 * passes through `target === null` (`changeScope` clears it, then the
	 * landing restores the remembered one); writing that `null` made the return
	 * look like a NEW selection, so the reveal fired and `nearest` pulled a rail
	 * held at 816 to 756, and one held at 516 to 36.
	 */
	useLayoutEffect(() => {
		if (holdKey === null) return;
		const current = entryFor(holdKey);
		current.railPickAt = 0;
		if (targetKey !== null) current.targetKey = targetKey;
	}, [holdKey, targetKey]);

	/*
	 * Re-tried on every commit until it lands: rows that arrive a render later
	 * (the directory's people and chiefs) can leave the viewport too short for
	 * the offset in the first frame, and the browser would clamp it. Layout
	 * effect, so the restored offset is the first one painted.
	 */
	useLayoutEffect(() => {
		const viewport = viewportOf(root);
		const current = plan.current;
		if (!viewport || !current) return;
		/*
		 * A NEW VIEWPORT INSIDE THE SAME MOUNT starts at 0 again (QA Q2: a return
		 * paints the cached rail, the gate settles, and the rail's ScrollArea is
		 * replaced by a fresh one after the restore had already landed on the
		 * first). Re-arm the restore from the latest held offset for it, unless
		 * the reader has taken the rail since.
		 */
		if (current.viewport !== viewport) {
			const previous = current.viewport;
			current.viewport = viewport;
			if (previous !== null && current.key !== null && !readerMoved.current) {
				const top = entryFor(current.key).top;
				if (top > 0) {
					current.restore = top;
					current.restoreUntil = Date.now() + RESTORE_WINDOW_MS;
				}
			}
		}
		if (current.restore !== null) {
			viewport.scrollTop = current.restore;
			/* Landed, or the list never grew back to that length (rows removed
			   since): either way stop, so the reader's own scrolls record again. */
			if (
				Math.abs(viewport.scrollTop - current.restore) < 1 ||
				Date.now() > current.restoreUntil
			)
				current.restore = null;
			/* A reveal measured against a rail still being restored would judge
			   the wrong rows off screen; it waits for the restore to settle. */ else
				return;
		}
		if (current.reveal) {
			const row = viewport.querySelector<HTMLElement>('[aria-current="page"]');
			if (!row) return;
			current.reveal = false;
			const box = viewport.getBoundingClientRect();
			const rect = row.getBoundingClientRect();
			if (rect.bottom <= box.top || rect.top >= box.bottom)
				row.scrollIntoView?.({ block: "nearest" });
		}
	});

	useEffect(() => {
		const viewport = viewportOf(root);
		if (!root || !viewport || holdKey === null) return;
		const record = () => {
			/* A clamp during a pending restore is not the reader's position. */
			if (plan.current?.restore != null) return;
			entryFor(holdKey).top = viewport.scrollTop;
		};
		/* The reader taking the rail cancels anything still pending. */
		const takeOver = () => {
			readerMoved.current = true;
			if (!plan.current) return;
			plan.current.restore = null;
			plan.current.reveal = false;
		};
		viewport.addEventListener("scroll", record, { passive: true });
		/*
		 * On the ROOT, not the viewport (review R4): Radix draws the scrollbar as
		 * the viewport's sibling, so a thumb drag's pointerdown never reaches the
		 * viewport. `wheel`, `touchstart`, `pointerdown` and `keydown` all bubble.
		 */
		root.addEventListener("wheel", takeOver, { passive: true });
		root.addEventListener("touchstart", takeOver, { passive: true });
		root.addEventListener("pointerdown", takeOver);
		root.addEventListener("keydown", takeOver);
		return () => {
			viewport.removeEventListener("scroll", record);
			root.removeEventListener("wheel", takeOver);
			root.removeEventListener("touchstart", takeOver);
			root.removeEventListener("pointerdown", takeOver);
			root.removeEventListener("keydown", takeOver);
		};
	}, [root, holdKey]);

	return {
		ref: setRoot,
		onClickCapture: () => {
			if (holdKey !== null) entryFor(holdKey).railPickAt = Date.now();
		},
	};
}
