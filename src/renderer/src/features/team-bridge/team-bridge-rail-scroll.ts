import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

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
 * the rail (a deep link, a notification click, a profile's "Message") AND that
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
 * Hold the rail viewport's `scrollTop` under `holdKey` (account + scope).
 * `targetKey` identifies the current selection. Returns the click-capture
 * handler that marks a pick made inside the rail.
 */
export function useHeldRailScroll(
	rootRef: RefObject<HTMLElement | null>,
	holdKey: string,
	targetKey: string | null,
): { onClickCapture: () => void } {
	const entry = entryFor(holdKey);
	/*
	 * Decided ONCE per mount, from the state the previous mount left: a rail
	 * pick, or the same selection as before, holds; anything else may reveal.
	 */
	const plan = useRef<{
		key: string;
		restore: number | null;
		/** The restore gives up after this (ms epoch); see the layout effect. */
		restoreUntil: number;
		reveal: boolean;
	} | null>(null);
	if (plan.current?.key !== holdKey) {
		plan.current = {
			key: holdKey,
			restore: entry.top > 0 ? entry.top : null,
			restoreUntil: Date.now() + RESTORE_WINDOW_MS,
			reveal:
				Date.now() - entry.railPickAt > RAIL_PICK_WINDOW_MS &&
				entry.targetKey !== targetKey,
		};
	}
	/*
	 * The entry is written in effects, never during render: a render React
	 * discards or repeats (StrictMode) must not consume the pick or the
	 * selection the plan above was derived from.
	 */
	useLayoutEffect(() => {
		const current = entryFor(holdKey);
		current.railPickAt = 0;
		current.targetKey = targetKey;
	}, [holdKey, targetKey]);

	/*
	 * Re-tried on every commit until it lands: rows that arrive a render later
	 * (the directory's people and chiefs) can leave the viewport too short for
	 * the offset in the first frame, and the browser would clamp it. Layout
	 * effect, so the restored offset is the first one painted.
	 */
	useLayoutEffect(() => {
		const viewport = viewportOf(rootRef.current);
		const current = plan.current;
		if (!viewport || !current) return;
		if (current.restore !== null) {
			viewport.scrollTop = current.restore;
			/* Landed, or the list never grew back to that length (rows removed
			   since): either way stop, so the reader's own scrolls record again. */
			if (
				Math.abs(viewport.scrollTop - current.restore) < 1 ||
				Date.now() > current.restoreUntil
			)
				current.restore = null;
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
		const viewport = viewportOf(rootRef.current);
		if (!viewport) return;
		const record = () => {
			/* A clamp during a pending restore is not the reader's position. */
			if (plan.current?.restore != null) return;
			entryFor(holdKey).top = viewport.scrollTop;
		};
		/* The reader taking the wheel cancels anything still pending. */
		const takeOver = () => {
			if (!plan.current) return;
			plan.current.restore = null;
			plan.current.reveal = false;
		};
		viewport.addEventListener("scroll", record, { passive: true });
		viewport.addEventListener("wheel", takeOver, { passive: true });
		viewport.addEventListener("touchstart", takeOver, { passive: true });
		viewport.addEventListener("pointerdown", takeOver);
		viewport.addEventListener("keydown", takeOver);
		return () => {
			viewport.removeEventListener("scroll", record);
			viewport.removeEventListener("wheel", takeOver);
			viewport.removeEventListener("touchstart", takeOver);
			viewport.removeEventListener("pointerdown", takeOver);
			viewport.removeEventListener("keydown", takeOver);
		};
	}, [rootRef, holdKey]);

	return {
		onClickCapture: () => {
			entryFor(holdKey).railPickAt = Date.now();
		},
	};
}
