/**
 * The sidebar's focus-held-across-a-re-file rule, executable.
 *
 *     node --test scripts/sidebar-focus-hold.test.mjs
 *
 * WHY THIS FILE EXISTS. The rule itself (`src/renderer/src/features/chat/sidebar-focus-hold.ts`)
 * has been measured in a real browser twice - the rig's keyboard story, and the
 * app-level cells the UX and QA streams drove - and every one of those cells is
 * driven by a COMPLETION, which commits twice: a status frame, then the order
 * frame. The first commit re-measures the cursor's row anyway, so no completion
 * cell can tell whether the container's own scroll refresh (`refreshFocusedInside`)
 * is load-bearing at all: remove both handlers and the rig stays green (round 3,
 * R3-2). That left half the rule resting on construction rather than on a cell.
 *
 * The paths it defends are real and reachable - a receipt applied elsewhere, a
 * session deleted from another window, the safety poll's own re-read: the UX
 * stream measured one such re-order landing in a SINGLE batch at +1102 ms, with no
 * preceding commit for the cursor's row - and the discriminator is a sequence, not
 * a picture, which is exactly what a browser cell is bad at and a driver is good
 * at. So the rule is a leaf module with no imports (the `clear-search.ts` pattern
 * beside it), bundled in memory and driven here through a one-dimensional scroller
 * that models the two things it reads: content offsets and `scrollTop`.
 *
 * WHAT THE DRIVER IS, AND WHAT IT IS NOT. Rows sit at content offsets in a
 * container whose clip box is its padding box; a row's viewport rect is
 * `clipTop + offset - scrollTop`, which is the whole of the geometry this rule
 * touches. That model can be wrong about a browser (antialiasing, sub-pixel
 * layout, a fractional pitch) and it cannot be wrong about the RULE, because the
 * rule's inputs are those numbers. The browser half stays where it is: the rig's
 * `--assert` run and the committed frames.
 *
 * Read the assertions as the three states rather than as three cases: a row that
 * was inside and left is followed (U1), a row that was PARTLY on screen and left
 * is followed too (U6/D3 - the state the binary record got wrong), and a row the
 * reader had already scrolled fully out is never touched (D2/U5), whatever it does
 * afterwards.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

// Bundled in memory so the guard runs against the shipped TS module rather than a
// re-implementation. `sidebar-focus-hold.ts` imports nothing, so no fixture
// plugins are needed.
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/sidebar-focus-hold";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { holdFocusedRow, refreshFocusedInside, rowVisibility, ringBand } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

/*
 * The DOM the module sees. `document.activeElement instanceof HTMLElement` is a
 * real check in the module, so the rows are instances of a stand-in class rather
 * than plain objects - a plain object would make the rule read "no active element"
 * and pass every cell below for the wrong reason.
 */
class FakeElement {}
globalThis.HTMLElement = FakeElement;
globalThis.document = { activeElement: null };

const ROW_H = 32;
/** The row's own ring, as the two focus treatments compute it. */
const KEYBOARD_RING = {
	outlineStyle: "solid",
	outlineWidth: "2px",
	outlineOffset: "2px",
};
const POINTER_RING = {
	outlineStyle: "none",
	outlineWidth: "3px",
	outlineOffset: "0px",
};

/**
 * A scroller with `count` rows of `ROW_H`, `panel` px of clip box, a 1 px top
 * border, and whichever focus treatment its rows wear.
 */
const scroller = ({ count = 12, panel = 5, ring = KEYBOARD_RING } = {}) => {
	const container = new FakeElement();
	const rows = [];
	const rings = new Map();
	const state = { scrollTop: 0, offsets: [] };
	const CLIP_TOP = 400 + 1; // the container's border box top, plus its 1px border

	container.clientTop = 1;
	Object.defineProperty(container, "clientHeight", {
		get: () => panel * ROW_H,
	});
	Object.defineProperty(container, "scrollHeight", {
		get: () => rows.length * ROW_H,
	});
	Object.defineProperty(container, "scrollTop", {
		get: () => state.scrollTop,
		set: (value) => {
			const max = container.scrollHeight - container.clientHeight;
			state.scrollTop = Math.min(Math.max(value, 0), max);
		},
	});
	container.getBoundingClientRect = () => ({
		top: 400,
		bottom: 400 + container.clientHeight,
	});
	container.contains = (node) => rows.includes(node);
	container.querySelectorAll = () => rows;

	for (let i = 0; i < count; i++) {
		const row = new FakeElement();
		row.isConnected = true;
		/*
		 * Position by IDENTITY, not by the index the row was built with: the whole
		 * point of these cells is a row that keeps its node and changes slot, so a
		 * rect frozen to its original index would not move when an arrival lands
		 * above it - and every assertion below would then be measuring a container
		 * nothing happened in.
		 */
		row.getBoundingClientRect = () => ({
			top: CLIP_TOP + state.offsets[rows.indexOf(row)] - state.scrollTop,
			bottom:
				CLIP_TOP + state.offsets[rows.indexOf(row)] - state.scrollTop + ROW_H,
		});
		rings.set(row, ring);
		rows.push(row);
	}
	state.offsets = rows.map((_, i) => i * ROW_H);

	globalThis.getComputedStyle = (node) => rings.get(node) ?? POINTER_RING;

	return {
		container,
		rows,
		clipTop: CLIP_TOP,
		clipBottom: CLIP_TOP + panel * ROW_H,
		/** The row the cursor is on, as the DOM reports it. */
		focus(index) {
			globalThis.document.activeElement = rows[index];
			return rows[index];
		},
		/** The reader's own wheel, which fires `scroll` and never commits. */
		wheel(px) {
			container.scrollTop = state.scrollTop + px;
		},
		/** The cursor's row keeps its node and changes slot - an arrival above it. */
		arriveAbove(index) {
			const row = new FakeElement();
			row.isConnected = true;
			const at = index;
			row.getBoundingClientRect = () => ({
				top: CLIP_TOP + state.offsets[rows.indexOf(row)] - state.scrollTop,
				bottom:
					CLIP_TOP + state.offsets[rows.indexOf(row)] - state.scrollTop + ROW_H,
			});
			rings.set(row, ring);
			rows.splice(at, 0, row);
			state.offsets = rows.map((_, i) => i * ROW_H);
			return row;
		},
		visibilityOf(row) {
			return rowVisibility(row, container);
		},
		/** The cursor's row, in viewport terms. */
		rectOf(row) {
			return row.getBoundingClientRect();
		},
		scrollTop: () => state.scrollTop,
	};
};

/** A record, as the component's ref holds it. */
const slot = () => ({
	current: { node: null, index: -1, visibility: "outside" },
});

test("a reader who scrolled the cursor's row fully out is never moved", () => {
	const s = scroller();
	const record = slot();
	s.focus(2);
	// The row is at the top of the panel, on screen: the state a completion leaves
	// behind for a reader who has not scrolled.
	s.container.scrollTop = 64;
	holdFocusedRow(s.container, record);
	assert.equal(
		record.current.visibility,
		"inside",
		"the cursor's row starts inside",
	);

	// Their own wheel takes it out of the panel, and the container's `scroll`
	// handler refreshes the record - which is the whole difference from below.
	s.wheel(100);
	refreshFocusedInside(s.container, record);
	assert.equal(
		record.current.visibility,
		"outside",
		"the reader's own scroll has to be recorded, or the gate cannot attribute the move",
	);
	const held = s.scrollTop();

	// The re-file lands: an arrival above the cursor's row, so its slot changes.
	s.arriveAbove(0);
	holdFocusedRow(s.container, record);

	assert.equal(
		s.scrollTop(),
		held,
		"a row the READER scrolled out must be left where they put it (U5, D2)",
	);
});

test("the same commit without the scroll refresh drags the reader away", () => {
	/*
	 * The discriminating half, and the reason the handler is not redundant: the
	 * SAME sequence with `refreshFocusedInside` never called. That is exactly what
	 * removing the two `onScroll` handlers does, and it is the only cell that can
	 * tell the two mechanisms apart - a completion commits twice, so the first
	 * commit re-measures the row and hides the difference (round 3, R3-2).
	 */
	const s = scroller();
	const record = slot();
	s.focus(2);
	s.container.scrollTop = 64;
	holdFocusedRow(s.container, record);

	s.wheel(100); // the reader moves; no refresh, because the handler is gone
	const held = s.scrollTop();

	s.arriveAbove(0);
	holdFocusedRow(s.container, record);

	assert.notEqual(
		s.scrollTop(),
		held,
		"with the record stale, the gate reads the row as inside and follows it - this is the drag the refresh removes",
	);
	assert.equal(
		record.current.visibility,
		"inside",
		"and it lands the row back in the panel, which is why the stale record reads as a pass in any cell that does not check the reader's position",
	);
});

test("a cursor row the re-file takes out of the panel is followed, band included", () => {
	const s = scroller();
	const record = slot();
	s.focus(2);
	s.container.scrollTop = 64;
	holdFocusedRow(s.container, record);

	// The re-file takes the cursor's row above the panel with no reader input.
	s.arriveAbove(0);
	s.container.scrollTop = 64 + 96; // the panel now sits 96 px further down
	holdFocusedRow(s.container, record);

	const rect = s.rectOf(s.rows[3]);
	assert.equal(
		rect.top,
		s.clipTop + 4,
		"the correction leaves the row's own ring band (2px outline + 2px offset) as clearance (U1, D1)",
	);
	assert.equal(
		record.current.visibility,
		"inside",
		"the cursor is back on screen",
	);
});

test("a PARTLY visible cursor row is followed too, not stranded (U6, D3)", () => {
	/*
	 * The state the binary record got wrong. The panel is 150 px here, so the
	 * cursor's row is 10 px past its lower edge - the most ordinary resting
	 * position there is, and the app's own focus scroll lands one exactly like it
	 * (UX round 3 measured 2 of 19 landings strictly outside by 0.5 px). Under a
	 * two-state record this row was `outside` before the change landed, so the
	 * correction refused and the re-file left the reader's cursor 185 px ABOVE the
	 * panel - a focused row they could not see.
	 */
	const s = scroller({ panel: 4.6875 }); // 150 px of clip box
	const record = slot();
	s.focus(4);
	holdFocusedRow(s.container, record);
	assert.equal(
		record.current.visibility,
		"partly",
		"a row cut by the panel's edge is on screen - that is the state this record has to carry",
	);

	// The arrival above moves the cursor's row (index 4 -> 5) and takes it the rest
	// of the way out, below the panel.
	s.arriveAbove(0);
	holdFocusedRow(s.container, record);

	const rect = s.rectOf(s.rows[5]);
	assert.ok(
		s.scrollTop() > 0,
		"the partly-visible case has to be corrected, not left where the re-file put it",
	);
	assert.ok(
		rect.bottom <= s.clipBottom && rect.top >= s.clipTop,
		`the cursor's row is back inside the panel (top ${rect.top}, bottom ${rect.bottom}, clip ${s.clipTop}..${s.clipBottom})`,
	);
});

test("the clearance is the band the row's own focus treatment asks for", () => {
	/*
	 * Both cases, because they are both real and a reader can see either: a row
	 * focused from the KEYBOARD wears `:focus-visible` and lands 4 px clear of the
	 * clip edge; one focused by a POINTER wears no ring at all, so its band is 0 and
	 * it lands flush (QA round 3, Q8 - the code is right in both, but the two
	 * numbers appear side by side in the app's own cells).
	 */
	for (const [ring, expected, why] of [
		[KEYBOARD_RING, 4, "the keyboard ring is 2px at a 2px offset"],
		[
			POINTER_RING,
			0,
			"a pressed row paints no ring, so it is owed no clearance",
		],
	]) {
		const s = scroller({ ring });
		const record = slot();
		s.focus(2);
		s.container.scrollTop = 64;
		holdFocusedRow(s.container, record);
		s.arriveAbove(0);
		s.container.scrollTop = 64 + 96;
		holdFocusedRow(s.container, record);
		assert.equal(s.rectOf(s.rows[3]).top, s.clipTop + expected, why);
		assert.equal(ringBand(s.rows[3]), expected);
	}
});

test("an arrival that does not move the cursor's row is left alone", () => {
	// The gate is on the cursor's SLOT changing, not on a re-order happening: a row
	// inserted below the cursor shifts nothing the reader is looking at.
	const s = scroller();
	const record = slot();
	s.focus(2);
	s.container.scrollTop = 64;
	holdFocusedRow(s.container, record);
	const held = s.scrollTop();

	s.arriveAbove(8);
	holdFocusedRow(s.container, record);

	assert.equal(s.scrollTop(), held, "the container holds its position");
	assert.equal(
		record.current.index,
		2,
		"and the cursor's row is still the row it was on",
	);
});
