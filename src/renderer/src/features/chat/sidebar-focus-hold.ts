/**
 * Holding the row the cursor is on inside its scroll container across a re-file.
 *
 * WHY THIS IS A MODULE OF ITS OWN. It lived as four functions above
 * `ChatSidebar` until round 3 (R3-2): the rule is pure geometry plus one stored
 * record, but the only thing that exercised it was a Storybook story driven by a
 * hand-run rig, so the half that defends the single-commit path had no cell at
 * all - not in the rig, not in `test:desktop`. A leaf module with no imports is
 * bundlable in memory and drivable with a fake DOM (`scripts/sidebar-focus-hold.test.mjs`),
 * exactly as `clear-search.ts` beside it is, so the guarantee runs in CI rather
 * than resting on a path nothing covers.
 */

/**
 * Where a scroll container last saw the row that held keyboard focus.
 *
 * `visibility` is the row's OWN containment as of the last time this record was
 * refreshed - the layout effect's own run, or the container's last scroll - and it
 * is what separates "the completion took the cursor's row out of the panel" from
 * "the reader scrolled it out themselves". Both leave the row outside the panel,
 * and only the first is this rule's to correct: a record carrying the slot alone
 * cannot tell them apart, which is how the first version of the rule moved a
 * reader who had deliberately scrolled away from their own cursor (round 2: U5,
 * R2-4, D2).
 *
 * THREE states rather than two, and the middle one is load-bearing (round 3, U6
 * and D3, found independently by the UX and design streams). A binary record put
 * the browser's own focus scroll - which lands a row flush or a fraction of a
 * pixel past the clip edge - in the same bucket as a row the reader had wheeled
 * fully out of view, so the next arrival refused to follow a cursor the reader
 * could still SEE and stranded it 185 px above the panel. `partly` is that state:
 * the row is on screen, so the reader is looking at it, and the re-file taking it
 * the rest of the way out is this rule's to correct - while a row they scrolled
 * fully out is still never touched.
 */
export type FocusedSlot = {
	node: HTMLElement | null;
	index: number;
	visibility: RowVisibility;
};

/** A row's containment in its container, as the gate reads it. */
export type RowVisibility = "inside" | "partly" | "outside";

/**
 * A scroller's CLIP box: its padding box, not its border box.
 *
 * `getBoundingClientRect()` reports the border box and a scroll container clips at
 * its padding box, so a row aligned to the border box sits one border-width above
 * the clip - on the list, which carries `border-t border-hairline`, the row's own
 * first pixel is painted over by the container (design round 3, D1).
 */
export const clipBox = (container: HTMLElement) => {
	const box = container.getBoundingClientRect();
	const top = box.top + container.clientTop;
	return { top, bottom: top + container.clientHeight };
};

/**
 * Where a row sits relative to its panel right now: fully in, partly in, or out.
 *
 * Fully in means the whole box is between the clip edges; out means no part of it
 * is; everything between the two is `partly`, and that middle state exists because
 * the two cases it separates are different questions. "Was any of the row on
 * screen when this change landed?" is answered by `inside | partly` and is what
 * decides whether the reader was looking at the row; "is the row outside now?" is
 * what decides whether there is anything to correct.
 */
export const rowVisibility = (
	node: HTMLElement,
	container: HTMLElement,
): RowVisibility => {
	const clip = clipBox(container);
	const box = node.getBoundingClientRect();
	if (box.bottom <= clip.top || box.top >= clip.bottom) return "outside";
	return box.top >= clip.top && box.bottom <= clip.bottom ? "inside" : "partly";
};

/**
 * The band the focused row's own ring needs outside its box, in px.
 *
 * Focus is an `outline` here (the branding contract forbids a `box-shadow` ring on
 * these scroll containers, which clip it), so the row's PAINTED extent is larger
 * than its box: correcting the box flush to the clip edge ships a ring with a
 * segment cut off (D1). Read from the computed style rather than hard-coded so a
 * change to the focus treatment moves this with it.
 *
 * The band is 0 whenever NO ring is painted, and that is a real case rather than a
 * degenerate one: the row's treatment is `focus-visible:outline-2 outline-offset-2`,
 * and a row focused by a POINTER does not match `:focus-visible`, so its computed
 * `outline-style` reads `none` and it is owed no clearance at all. The two
 * landings therefore differ by exactly this band - the keyboard cells land the box
 * at `clipTop + 4` and a mouse-focused row lands flush at `clipTop` - and both are
 * correct, because nothing is drawn outside the box in the second case (QA round
 * 3, Q8).
 */
export const ringBand = (node: HTMLElement) => {
	const style = getComputedStyle(node);
	if (style.outlineStyle === "none") return 0;
	const width = Number.parseFloat(style.outlineWidth);
	const offset = Number.parseFloat(style.outlineOffset);
	return (
		(Number.isFinite(width) ? width : 0) +
		(Number.isFinite(offset) ? offset : 0)
	);
};

/**
 * Hold the row that holds FOCUS inside its scroll container across a re-file.
 *
 * `overflow-anchor: none` on the two scrollers this panel owns is what stops a
 * completion dragging a reader who is somewhere else in the list (see the note at
 * each declaration). This is that rule's one cost, and it is paid by the reader
 * who is NOT somewhere else: a keyboard cursor is an ELEMENT, so the row the
 * cursor is on can re-file to a slot outside the panel while the container
 * correctly holds its position - and the cursor leaves the screen. The next arrow
 * press focuses the neighbouring row, the browser's own scroll-into-view pays for
 * the distance, and the jump measured as 386 px to the top of the band on the
 * operator's roster (UX round 1, U1).
 *
 * So when the row that holds focus changes SLOT, the container follows it, by the
 * minimum that puts it back inside the panel. Two properties are what make this
 * the honest shape rather than a re-introduction of the drag the declaration
 * removes: the row followed is the one the cursor is on, which is the argument the
 * transcript's sibling rule already makes for following content a reader is pinned
 * to (`canonical-transcript.tsx` sets `overflow-anchor: auto` for exactly that),
 * and it is one instantaneous `scrollTop` assignment - no transition, no
 * animation, nothing at all for a reader whose focus is not inside the list.
 *
 * The other shape the finding offered - move focus to the row that takes the
 * departed row's place - is rejected rather than untried: the DOM node IS the
 * session, so transferring focus would retarget the cursor to a DIFFERENT
 * conversation under an unchanged ring, and `Enter` would open a chat the reader
 * never chose without anything on screen saying so. A bounded viewport adjustment
 * is the smaller surprise of the two, and the row it reveals is the one the
 * reader's own cursor moved with.
 *
 * GATED ON THE FOCUSED ROW LEAVING THE PANEL, not on the slot changing and not on
 * any re-order. Three facts have to hold together, and each of them is a case this
 * rule got wrong before it was written down:
 *
 *  1. the row's SLOT changed, so a reader who scrolled the panel away from their
 *     cursor and watches an arrival re-file some OTHER row keeps the position they
 *     scrolled to;
 *  2. the row was on screen when the record was last refreshed - `inside` or
 *     `partly`, never `outside` - so it was the reader's own scroll that took it
 *     the whole way out rather than this change (U5, and then U6/D3);
 *  3. the row is OUTSIDE the panel now, so there is something to correct.
 *
 * Fact 2 is why `FocusedSlot` carries `visibility` rather than the slot alone. A
 * record refreshed only here could not see a wheel scroll at all - scrolling does
 * not commit - so a reader who scrolled their cursor away would have been followed
 * by the next completion: the drag this rule exists to remove, reintroduced by its
 * own remedy. The record is therefore refreshed on the containers' own scroll too
 * (`refreshFocusedInside`), and the correction only ever fires for a row that was
 * on screen and left it as this change landed.
 *
 * THE CLEARANCE IS EXACT, NOT PADDED, and that is the intent rather than an
 * accident of the arithmetic: `band` is what the ring needs and no more, so the
 * ring's outer edge lands ON the clip boundary rather than a pixel inside a rule
 * nobody measured. What makes that a contract rather than a coincidence is that
 * `scripts/sidebar-resort-geometry.mjs` now measures it - it asserts
 * `ringClippedPx === 0` on the keyboard story, off the row's own computed outline,
 * so a future focus treatment that draws outside the band fails a cell instead of
 * shipping a shaved ring (round 3, R3-4 / D4).
 *
 * The NODE is the identity, not an attribute: React keys each row by session id,
 * so an intra-section re-file moves the same element and no row carries a session
 * id for a rig to read (see `scripts/attach-frame-evidence.mjs` on why not). A
 * focus change between two commits (`previous.node !== active`) is the reader
 * moving rather than the row, and is left alone for the same reason.
 */
export const holdFocusedRow = (
	container: HTMLElement | null,
	slot: { current: FocusedSlot },
) => {
	if (!container) {
		slot.current = { node: null, index: -1, visibility: "outside" };
		return;
	}
	/*
	 * `rowNodes`, not `rows`. `scripts/clear-search.test.mjs` slices
	 * `chat-sidebar.tsx` from the arrow-key handler down to the sidebar's own rows
	 * array literal, so a local sharing that name one module above the component
	 * makes the slice empty and turns a green-looking file into a red guard - which
	 * is how CI's Desktop Tests step found this (round 1). The comment and the
	 * names moved here with the code, and the constraint still binds the caller:
	 * the names may appear only where they are declared.
	 */
	const rowNodes = [
		...container.querySelectorAll<HTMLElement>("[data-chat-row]"),
	];
	const active =
		document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
	const index = active ? rowNodes.indexOf(active) : -1;
	const previous = slot.current;
	if (!active || index < 0) {
		slot.current = { node: null, index: -1, visibility: "outside" };
		return;
	}
	const visibilityNow = rowVisibility(active, container);
	if (
		previous.node !== active ||
		previous.index < 0 ||
		previous.index === index ||
		previous.visibility === "outside" ||
		visibilityNow !== "outside"
	) {
		slot.current = { node: active, index, visibility: visibilityNow };
		return;
	}
	const clip = clipBox(container);
	const rowBox = active.getBoundingClientRect();
	const above = rowBox.top - clip.top;
	const below = clip.bottom - rowBox.bottom;
	/*
	 * The row enters from the edge it is off past, and the correction leaves the
	 * ring's own band as clearance there rather than landing the box flush: the
	 * minimum that puts the row - not just its box - inside the panel.
	 */
	const band = ringBand(active);
	container.scrollTop = Math.min(
		Math.max(
			container.scrollTop + (above < 0 ? above - band : -below + band),
			0,
		),
		container.scrollHeight - container.clientHeight,
	);
	slot.current = {
		node: active,
		index,
		visibility: rowVisibility(active, container),
	};
};

/**
 * Refresh a record's containment on the reader's OWN scroll.
 *
 * The reader scrolling is the one input to `holdFocusedRow`'s gate that never
 * commits, so without this the record keeps saying "inside" after a wheel scroll
 * has taken the row out of the panel - which is exactly the state U5 reproduced
 * (three times, in both containers). Cheap by construction: one focused row's box
 * against its container's clip box, and only while a row is recorded.
 *
 * It is not redundant with the layout effect that calls `holdFocusedRow`, and the
 * cells that say so are `scripts/sidebar-focus-hold.test.mjs`'s pair: the SAME
 * commit re-file, once on the record this refresh wrote and once on the record it
 * did not, holds the reader in the first case and drags them in the second. The
 * completions in the rig and in the app commit twice (a status frame, then the
 * order frame) and the first commit re-measures the row anyway, so no cell driven
 * off a completion can tell the two apart - while a single-batch re-order (a
 * receipt applied elsewhere, a session deleted from another window, the safety
 * poll's own re-read: UX round 3 measured one at +1102 ms carrying both the
 * arrival and the order) reaches this container with no preceding commit for the
 * cursor's row, and that is the path this half defends (round 3, R3-2).
 */
export const refreshFocusedInside = (
	container: HTMLElement | null,
	slot: { current: FocusedSlot },
) => {
	const node = slot.current.node;
	if (!container || !node || !node.isConnected || !container.contains(node))
		return;
	if (node !== document.activeElement) return;
	slot.current = {
		...slot.current,
		visibility: rowVisibility(node, container),
	};
};
