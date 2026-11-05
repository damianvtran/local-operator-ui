import type { ThreadItem } from "./team-bridge-model";

/**
 * THE WINDOWED TIMELINE'S ARITHMETIC: pure offsets, no DOM, no React.
 *
 * WHY A HAND-WRITTEN WINDOW. `TeamBridgeMessageList` mounted one row per message
 * for the whole history: a channel with thousands of messages paid for thousands
 * of markdown renders, reaction lookups and attachment boxes on open, and the
 * 8 s poll re-rendered all of them. The renderer ships no virtualizer and adding
 * one for a single list is a dependency (a bundle, a second styling vocabulary
 * and its own release cadence) for about a hundred and fifty lines of offset
 * math - so the math lives here, where it is testable without a DOM, and the
 * component only mounts what the math names.
 *
 * ROWS ARE VARIABLE HEIGHT, SO THEY ARE MEASURED - NOT ASSUMED. A row can be a
 * one-line reply (44px), a name-and-body first message (96px) or a code block
 * taller than the viewport. Guessing a single row height makes a window that
 * either jumps as it corrects or, worse, mounts thousands of rows because every
 * estimate was too small. The estimates below are only the FIRST guess for a row
 * that has never been mounted; every mounted row replaces its estimate with its
 * measured height (`ResizeObserver` in `use-team-bridge-window.ts`), and the
 * layout is recomputed from the same prefix sums, so a correction shifts content
 * by exactly the difference the reader would otherwise see as a jump.
 *
 * THE STRIP MODEL. The list renders ONE contiguous slice of `threadItems`
 * (`windowRange`) between two spacer blocks whose heights are the sum of the
 * items outside it. Nothing is absolutely positioned and nothing is transformed:
 * the rows keep their normal flow, their `<ol>`, their sticky day pill and their
 * CSS exactly as they were, which is the point - this change is about what is
 * MOUNTED, not about how a row looks.
 */

/** Rows rendered above and below the visible range, so a fast scroll never
 * shows a blank strip before React catches up. Six is a screenful of slack at
 * the row heights this list uses; more only costs mount time. */
export const TEAM_BRIDGE_WINDOW_OVERSCAN = 6;

/** First guess for a day divider row (hairline + pill). */
export const TEAM_BRIDGE_DAY_ITEM_HEIGHT = 40;
/** First guess for a continuation row: body only, clock in the gutter. */
export const TEAM_BRIDGE_CONTINUATION_ROW_HEIGHT = 44;
/** First guess for a run header: avatar, name line, then the body. */
export const TEAM_BRIDGE_HEADER_ROW_HEIGHT = 96;

/**
 * PROXIMITY PAGING THRESHOLDS - the list, not the reader, decides.
 *
 * Older history is fetched when the reader is within one viewport of the top, OR
 * the first visible ROW is within the top twelve. The viewport distance matters
 * because a tall viewport shows many rows: "the top is one screen away" is what
 * a person experiences as "nearly there", and it gives a page a full screen of
 * runway to arrive in. The row count covers the opposite case (a short pane, a
 * zoomed-out one) where one viewport is only a row or two, so a single flick
 * lands on the boundary. Neither fires on open: the list opens pinned to the
 * newest row, thousands of pixels from index 0.
 */
export const TEAM_BRIDGE_TOPNESS_VIEWPORTS = 1;
export const TEAM_BRIDGE_TOPNESS_ROWS = 12;

/**
 * ONE RENDERED ITEM, WITH THE IDENTITY THE STRIP KEYS IT BY.
 *
 * `key` is the ROW identity when the caller has one, and it is load-bearing:
 * an optimistic row keeps its key when the server row replaces it
 * (`team-bridge-pending-sends.ts`), and a strip keyed on the SERVER id would
 * remount that row at the exact moment the reader is watching it settle. A day
 * divider keys on its calendar day, so a day that gains a message keeps its
 * height record.
 *
 * `entryKey` is the one place that rule is written; the component builds its
 * stream through it and the layout below only ever sees the string.
 */
export type WindowEntry = { key: string; item: ThreadItem };

export function windowEntryKey(item: ThreadItem, rowKey?: string): string {
	return item.type === "day"
		? `day:${item.key}`
		: `msg:${rowKey ?? item.message.id}`;
}

/** The first guess for an unmounted item's height (see the module note). */
export function estimateItemHeight(item: ThreadItem): number {
	if (item.type === "day") return TEAM_BRIDGE_DAY_ITEM_HEIGHT;
	return item.continuation
		? TEAM_BRIDGE_CONTINUATION_ROW_HEIGHT
		: TEAM_BRIDGE_HEADER_ROW_HEIGHT;
}

/** The laid-out strip: one offset and one height per item, and the total. */
export type WindowLayout = {
	keys: string[];
	offsets: number[];
	heights: number[];
	total: number;
};

/**
 * Prefix sums over the items, with measured heights replacing estimates.
 *
 * `measured` is read ONCE per item so a resize cannot make the offsets disagree
 * with the heights that produced them (a map mutated mid-walk would produce a
 * layout where `offsets[i] + heights[i] !== offsets[i + 1]`, and the spacer math
 * downstream assumes it does).
 */
export function windowLayout(
	entries: readonly WindowEntry[],
	measured: ReadonlyMap<string, number>,
): WindowLayout {
	const keys: string[] = [];
	const offsets: number[] = [];
	const heights: number[] = [];
	let total = 0;
	for (const entry of entries) {
		const height = measured.get(entry.key) ?? estimateItemHeight(entry.item);
		keys.push(entry.key);
		offsets.push(total);
		heights.push(height);
		total += height;
	}
	return { keys, offsets, heights, total };
}

/** The index of the item under a viewport's top edge, or the last item when the
 * viewport sits below the end of the strip. Binary search: the layout is a
 * monotonic prefix sum and this runs on every scroll frame. */
export function firstVisibleIndex(
	layout: WindowLayout,
	scrollTop: number,
): number {
	const count = layout.offsets.length;
	if (count === 0) return 0;
	let low = 0;
	let high = count - 1;
	let found = count - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if (layout.offsets[middle] + layout.heights[middle] > scrollTop) {
			found = middle;
			high = middle - 1;
		} else low = middle + 1;
	}
	return found;
}

/**
 * The slice to mount: the visible items plus overscan, as a half-open range.
 *
 * An EMPTY list is the one case that must not produce a range at all: `${0}-${0}`
 * is indistinguishable from "one item, index 0" once it is a string, and a list
 * with no items that mounts a zero-length slice still pays for the render.
 */
export function windowRange(
	layout: WindowLayout,
	scrollTop: number,
	viewportHeight: number,
	overscan: number = TEAM_BRIDGE_WINDOW_OVERSCAN,
): { start: number; end: number } {
	const count = layout.offsets.length;
	if (count === 0) return { start: 0, end: 0 };
	const first = firstVisibleIndex(layout, scrollTop);
	let last = first;
	const bottom = scrollTop + Math.max(viewportHeight, 0);
	while (last + 1 < count && layout.offsets[last + 1] < bottom) last += 1;
	return {
		start: Math.max(0, first - overscan),
		end: Math.min(count, last + overscan + 1),
	};
}

/** The strip above `start` and below `end`, i.e. what the spacers stand in for. */
export function windowSpacers(
	layout: WindowLayout,
	range: { start: number; end: number },
): { before: number; after: number } {
	const before = range.start > 0 ? layout.offsets[range.start] : 0;
	const after =
		range.end < layout.keys.length
			? layout.total - (layout.offsets[range.end] ?? layout.total)
			: 0;
	return { before: Math.max(0, before), after: Math.max(0, after) };
}

/**
 * WHERE THE READER IS, AS AN ITEM AND ITS OFFSET IN THE STRIP - the anchor a
 * prepend must preserve.
 *
 * Deliberately an item identity plus its ABSOLUTE offset in the layout, not a
 * `scrollTop` or a pixel distance from the edge: a history page landing above
 * the reader changes `scrollHeight` and every offset below it, but it does not
 * change WHICH ITEM the reader is looking at. The hook captures this before a
 * merge and re-applies it after; the difference between the two offsets is the
 * correction. Keeping the offset absolute (rather than relative to the viewport)
 * is what lets the delta be one subtraction with no scroll position folded in -
 * the reader may have scrolled between capture and correction, and that scroll
 * is not this hook's to undo.
 */
export type WindowAnchor = { key: string; offset: number };

export function windowAnchor(
	layout: WindowLayout,
	scrollTop: number,
): WindowAnchor | null {
	if (layout.keys.length === 0) return null;
	const index = firstVisibleIndex(layout, scrollTop);
	const key = layout.keys[index];
	if (key === undefined) return null;
	return { key, offset: layout.offsets[index] };
}

/**
 * The `scrollTop` correction a relaid-out strip needs so the anchored item stays
 * exactly where it was on screen: the item's new offset minus its old one.
 *
 * `null` means "nothing to correct": no anchor, or an anchor whose item is no
 * longer in the strip (it was trimmed out of the retained window, or the reader
 * changed conversations). The caller then leaves the scroll position alone -
 * guessing in that case is how a prepend yanks a reader who had scrolled up.
 */
export function windowAnchorDelta(
	anchor: WindowAnchor | null,
	layout: WindowLayout,
): number | null {
	if (anchor === null) return null;
	const index = layout.keys.indexOf(anchor.key);
	if (index === -1) return null;
	return layout.offsets[index] - anchor.offset;
}

/**
 * Should the list ask for an older page, given where it is?
 *
 * `atTop` is the scroll position within one viewport (and within the first
 * `TEAM_BRIDGE_TOPNESS_ROWS` rows) of the top - see the threshold note above.
 * `hasOlder` and `loading` are the caller's: a list with no more history and a
 * list already waiting on a page must not ask again, and a spinner that fires on
 * every scroll frame would turn one page into a burst of identical requests.
 */
export function nearHistoryEdge({
	scrollTop,
	viewportHeight,
	firstVisible,
	hasOlder,
	loading,
}: {
	scrollTop: number;
	viewportHeight: number;
	firstVisible: number;
	hasOlder: boolean;
	loading: boolean;
}): boolean {
	if (!hasOlder || loading) return false;
	if (firstVisible <= TEAM_BRIDGE_TOPNESS_ROWS) return true;
	return scrollTop <= viewportHeight * TEAM_BRIDGE_TOPNESS_VIEWPORTS;
}

/**
 * WHERE THE FLOATING DAY PILL RESTS, in pixels below the viewport's top edge,
 * and how tall it is (`h-6` in `DayPill`).
 *
 * The grouped list's pill is `sticky top-2` (8px), and this overlay stands in
 * for it in the windowed strip, so the two must rest at the same place: a reader
 * who resizes, or switches conversation, must not see the date move. The height
 * is what decides the HANDOVER below.
 */
export const TEAM_BRIDGE_DAY_PILL_REST_PX = 8;
export const TEAM_BRIDGE_DAY_PILL_HEIGHT_PX = 24;

/** The day divider that owns the top of the viewport, for the floating pill. */
export type StickyDay = {
	day: Extract<ThreadItem, { type: "day" }>;
	key: string;
	/** That day's own divider is still on screen at the top edge, so drawing the
	 * overlay as well would show two labels for one day. */
	hidden: boolean;
};

/**
 * WHICH DAY THE FLOATING PILL SHOWS - exactly what the grouped list's sticky
 * pill showed before the timeline was windowed.
 *
 * The rule is the first VISIBLE item's day: walk back from the first item whose
 * bottom is below the viewport's top edge to the day divider that precedes it.
 * That is what `position: sticky` inside a per-day containing block did - while
 * you scroll through a long day its label stays put, and the moment the next
 * day's divider arrives the label changes.
 *
 * `hidden` is the HANDOVER, and its band is the pill's own height rather than an
 * arbitrary few pixels: a day divider is only ever the first visible item once
 * its own top has reached the viewport's top edge (`top <= 0`), and its pill -
 * 24px tall - is still partly on screen until `top < -24`. Overlaying a second
 * pill while that one is visible is the double label this flag exists to
 * prevent; the overlay takes over exactly when the divider's pill has gone.
 *
 * `null` means "no pill": an empty strip, or a top row whose day divider is not
 * in the retained window at all (the oldest history was trimmed, so there is no
 * label to show rather than a guessed one).
 */
export function stickyDayAt(
	entries: readonly WindowEntry[],
	layout: WindowLayout,
	scrollTop: number,
	pillHeight: number = TEAM_BRIDGE_DAY_PILL_HEIGHT_PX,
): StickyDay | null {
	if (entries.length === 0 || layout.keys.length === 0) return null;
	const start = Math.min(
		firstVisibleIndex(layout, scrollTop),
		entries.length - 1,
	);
	for (let index = start; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry.item.type !== "day") continue;
		return {
			day: entry.item,
			key: entry.key,
			hidden: layout.offsets[index] - scrollTop > -pillHeight,
		};
	}
	return null;
}
