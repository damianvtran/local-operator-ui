/**
 * The `Pinned chats` section's own order, executable (issue #693).
 *
 *     node --test scripts/sidebar-pin-order.test.mjs
 *
 * WHAT THIS FILE HOLDS, and why each half is where it is. The operator's ask was
 * "pinned chats cannot be reordered" - the section drew the catalogue's own order
 * and there was no way to arrange it. The fix has three halves and this file
 * treats them the way the repository's other sidebar tests do:
 *
 *   - the ORDER MODEL is exercised for real, by bundling `chat-pin-order.ts` and
 *     calling it - it is a pure module precisely so this is possible, and the six
 *     rules the change was specified with are the tests below;
 *   - the PREFERENCE round trip is exercised against the real store (zustand's
 *     persisted middleware writing into a `localStorage` shim), because "the order
 *     survives a relaunch" is a claim about the store's bytes and not about the
 *     sidebar's markup;
 *   - the COMPONENT half is read off the shipped source, in the idiom
 *     `chat-sidebar-pins.test.mjs` established: the sidebar cannot be rendered by
 *     this suite (it reads the router, the canonical-sessions store and the
 *     desktop capability hooks), so "one tab stop per row, a chord that presses
 *     the control, a live region for the announcement" is asserted where it is
 *     written rather than described.
 *
 * WHAT IS NOT HERE, and is deliberately elsewhere: that the pair is DRAWN, that
 * the rows actually swap on screen, and that the caret and the line come back
 * afterwards. Those are claims about pixels and about a commit, and they are
 * answered by a rendered capture and by the driver's own walk - a green assertion
 * about a class string is not evidence that anything moved.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The storage shim the store needs to load in node at all: zustand's `persist`
 * writes through `localStorage` on every `setState`, which node lacks (the same
 * shim `chat-sidebar-view.test.mjs` and `chat-sidebar-sections.test.mjs` carry).
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const SOURCE = (relative) => readFileSync(relative, "utf8");

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/chat-pin-order";',
			'export { DEFAULT_SIDEBAR_VIEW, parseSidebarView } from "./src/renderer/src/features/chat/chat-sidebar-view";',
			'export { useUiPreferencesStore, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
		].join("\n"),
		resolveDir: ROOT,
		loader: "ts",
	},
	alias: {
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared": `${ROOT}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const {
	CHAT_PIN_MOVE_ATTR,
	canMovePinnedRow,
	chatPinMoveAttr,
	chatPinMoveCap,
	chatPinMoveChord,
	chatPinMoveControl,
	forgetPinnedOrder,
	movePinnedOrder,
	movePinnedOrderTo,
	orderPinnedRows,
	pinDragSlot,
	pinMoveBoundaryNote,
	pinMoveNote,
	pinnedOrder,
	DEFAULT_SIDEBAR_VIEW,
	parseSidebarView,
	persistedUiPreferences,
	useUiPreferencesStore,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

/** A catalogue row, in the fields the section's own model reads. */
const row = (session_id, over = {}) => ({
	session_id,
	title: `Chat ${session_id}`,
	...over,
});
const ids = (rows) => rows.map((item) => item.session_id);

/*
 * THE DRAG'S OWN MODEL (issue #697, item 7): a drop is the same sequence of
 * single-step swaps the chords make, so the two routes cannot produce two
 * different stored arrays from the same start.
 *
 * WHAT IS ASSERTED HERE AND NOT IN THE COMPONENT: that a drop several places away
 * is ONE array (one store write), that the intervening ids keep their slots, and
 * that the result is EXACTLY what repeating the corresponding chord would have
 * produced - which is the property that makes a drag and a keyboard move the same
 * act rather than two implementations of one idea.
 */
test("a drop lands as the sequence of swaps the chords would have made", () => {
	const full = ["a", "b", "c", "d", "e"];
	const dropped = movePinnedOrderTo(full, full, full, "a", 3);
	assert.deepEqual(dropped, ["b", "c", "d", "a", "e"], "three places, one array");
	let chorded = full;
	for (let step = 0; step < 3; step += 1)
		chorded = movePinnedOrder(full, chorded, chorded, "a", 1);
	assert.deepEqual(dropped, chorded, "identical to three \u2318\u21e7\u2193 presses");
	// And the same in the other direction, from the same start.
	assert.deepEqual(movePinnedOrderTo(full, full, full, "e", 0), [
		"e",
		"a",
		"b",
		"c",
		"d",
	]);
});

test("a drop over a filtered section keeps every hidden id's slot", () => {
	const full = ["a", "b", "c", "d"];
	const shown = ["a", "c", "d"]; // `b` is filtered out of the section
	const dropped = movePinnedOrderTo(full, full, shown, "d", 0);
	assert.deepEqual(dropped, ["d", "b", "a", "c"], "the hidden id keeps its index");
	assert.deepEqual(
		pinnedOrder(full, dropped).filter((id) => shown.includes(id)),
		["d", "a", "c"],
		"and the drop is read off the rows on screen",
	);
});

test("a drop that lands where it started writes nothing", () => {
	const full = ["a", "b", "c"];
	assert.equal(movePinnedOrderTo(full, full, full, "b", 1), null);
	assert.equal(movePinnedOrderTo(full, full, full, "b", 1.4), null, "a rounded slot");
	assert.equal(movePinnedOrderTo(full, full, full, "z", 0), null, "an id not drawn");
	/* A pointer past either end means "the end", which is the one reading a clamp
	   and a refusal agree on - and it is what a drag into the section's padding
	   produces, so it must not be a null. */
	assert.deepEqual(movePinnedOrderTo(full, full, full, "b", 99), ["a", "c", "b"]);
	assert.deepEqual(movePinnedOrderTo(full, full, full, "b", -3), ["b", "a", "c"]);
	/* And a row ALREADY at that end has nowhere to go, so the clamp is a null - the
	   same "no write" a drop on its own slot gives. */
	assert.equal(movePinnedOrderTo(full, full, full, "c", 99), null);
});

/*
 * THE HIT TEST (item 5): the midpoint comparison the component feeds from the
 * section's own row boxes. Geometry here rather than in the component because a
 * rule this small is exactly what this repository keeps where a test can drive it.
 */
test("the drop slot is the rows the pointer has crossed, and never the dragged row", () => {
	const boxes = [
		{ id: "a", top: 0, bottom: 20 },
		{ id: "b", top: 20, bottom: 40 },
		{ id: "c", top: 40, bottom: 60 },
	];
	assert.equal(pinDragSlot(boxes, "c", 5), 0, "above every midpoint");
	assert.equal(pinDragSlot(boxes, "c", 25), 1, "past a's midpoint");
	assert.equal(pinDragSlot(boxes, "c", 45), 2, "past b's midpoint");
	assert.equal(pinDragSlot(boxes, "c", 200), 2, "the dragged row is not a target");
	// A row dragged one place toward its neighbour reports the slot it would move into.
	assert.equal(pinDragSlot(boxes, "a", 35), 1, "one place down");
});

/*
 * RULE 1. A fresh profile - or one where nobody has moved a pinned row - draws
 * what it drew before this change. The pass-through is asserted on the IDENTITY
 * of the sequence rather than on its contents alone, because "the catalogue's own
 * order, untouched" is what the section's comment promises and a re-sort that
 * happened to agree with it here would be the failure this test exists for.
 */
test("rule 1: with no stored order the catalogue's own order is passed through", () => {
	const catalogue = ["dddd", "aaaa", "cccc"];
	assert.deepEqual(pinnedOrder(catalogue, []), catalogue);
	assert.deepEqual(pinnedOrder(catalogue, []), catalogue);
	const rows = catalogue.map((id) => row(id, { pinned: true }));
	assert.deepEqual(ids(orderPinnedRows(rows, [])), catalogue);
});

/*
 * RULE 3. An id the stored order does not know is drawn ABOVE every id it does -
 * the just-pinned conversation, or one pinned in the terminal between two
 * renders. Both orders matter: the unknowns keep the CATALOGUE's order among
 * themselves (which is the recency the backend sent), and the known ids keep the
 * READER's.
 */
test("rule 3: a pinned row the order has never seen arrives at the top", () => {
	assert.deepEqual(pinnedOrder(["new", "b", "c"], ["c", "b"]), [
		"new",
		"c",
		"b",
	]);
	// Two unknowns keep the catalogue's order among themselves.
	assert.deepEqual(pinnedOrder(["new1", "new2", "b"], ["b"]), [
		"new1",
		"new2",
		"b",
	]);
});

/*
 * RULE 2, the `moveSection` half. A move is taken over the rows ON SCREEN, so
 * under a search filter "up" means the pinned row above the one the reader can
 * see - and the stored order stays a permutation of the FULL list, because the
 * move SWAPS two entries of it rather than rebuilding it from the visible
 * subset. The hidden id's slot is the thing to watch: it keeps its index.
 */
test("rule 2: a move takes one SHOWN place and every hidden id keeps its slot", () => {
	const full = ["a", "b", "c", "d"];
	const shown = ["a", "c", "d"]; // `b` is filtered out of the section
	const moved = movePinnedOrder(full, full, shown, "d", -1);
	assert.deepEqual(moved, ["a", "b", "d", "c"], "a swap, not a splice");
	assert.deepEqual(
		pinnedOrder(full, moved),
		["a", "b", "d", "c"],
		"the stored order stays a permutation of the full list",
	);
	assert.deepEqual(
		pinnedOrder(full, moved).filter((id) => shown.includes(id)),
		["a", "d", "c"],
		"and `d` has moved exactly one place among the rows on screen",
	);
	// The symmetric move puts it back.
	assert.deepEqual(movePinnedOrder(full, moved, ["a", "d", "c"], "d", 1), full);
});

/*
 * THE MATERIALIZATION, which is rule 2's other half and the reason a first move
 * works at all: the panel cannot know the order of pins it has not drawn yet, so
 * the stored order is seeded at the PRESS, from what the reader was looking at,
 * with their move applied.
 */
test("the first move records the arrangement the reader was looking at", () => {
	const catalogue = ["a", "b", "c"];
	assert.deepEqual(movePinnedOrder(catalogue, [], catalogue, "c", -1), [
		"a",
		"c",
		"b",
	]);
	// And an unknown drawn at the top keeps its place through that first move.
	assert.deepEqual(movePinnedOrder(["a", "b"], [], ["new", "a", "b"], "a", -1), [
		"a",
		"new",
		"b",
	]);
});

/*
 * AN ID THE PANEL IS DRAWING IS ADDRESSABLE EVEN WHEN THE CALLER'S KNOWN LIST HAS
 * NOT CAUGHT UP. A search answer can carry a pinned row this client's page does
 * not (`chat-search.ts`'s synthesised hits), and a move whose target is such a
 * row must not drop it: the model unions the two lists rather than trusting them
 * to nest.
 */
test("a row from a search answer is still an addressable neighbour", () => {
	const moved = movePinnedOrder(["a", "b"], [], ["hit", "a", "b"], "a", -1);
	assert.deepEqual(moved, ["a", "hit", "b"]);
	assert.equal(moved.includes("hit"), true, "the neighbour was not dropped");
});

/*
 * RULE 5, the boundary. Both controls are drawn inapplicable at the ends, and
 * the chord has to SAY so rather than do nothing - a key that silently does
 * nothing reads as a broken key. The three sentences are the pair's whole
 * vocabulary, and the "only" case is its own because a single pinned row is both
 * boundaries at once.
 */
test("rule 5: a boundary cannot move, and says which boundary it is", () => {
	const shown = ["a", "b", "c"];
	assert.equal(canMovePinnedRow(shown, "a", -1), false);
	assert.equal(canMovePinnedRow(shown, "c", 1), false);
	assert.equal(canMovePinnedRow(shown, "b", -1), true);
	assert.equal(canMovePinnedRow(shown, "b", 1), true);
	assert.equal(canMovePinnedRow(shown, "nope", 1), false);
	assert.equal(movePinnedOrder(shown, shown, shown, "a", -1), null);
	assert.equal(movePinnedOrder(shown, shown, shown, "c", 1), null);

	assert.equal(
		pinMoveBoundaryNote("Work", 0, 3),
		"“Work” is already the first pinned chat.",
	);
	assert.equal(
		pinMoveBoundaryNote("Work", 2, 3),
		"“Work” is already the last pinned chat.",
	);
	assert.equal(
		pinMoveBoundaryNote("Work", 0, 1),
		"“Work” is the only pinned chat.",
	);
	assert.equal(
		pinMoveBoundaryNote("Work", 0, 0),
		"“Work” is the only pinned chat.",
		"an empty section answers as the empty case rather than as a boundary",
	);
});

/*
 * THE MOVE'S OWN SENTENCE, in the family PR #618 gave its board columns ("Moved
 * QA column to position 2 of 3."): the position is 1-based and the total is the
 * number of rows the reader is looking at, not the size of the stored order.
 */
test("a landed move says where the row went", () => {
	assert.equal(pinMoveNote("Work", 0, 3), "Moved “Work” to position 1 of 3.");
	assert.equal(pinMoveNote("Work", 2, 5), "Moved “Work” to position 3 of 5.");
});

/*
 * RULE 4. Unpinning forgets the slot, so re-pinning is a NEW pin at the top
 * rather than the resurrection of a position the reader unwound - and the stored
 * list cannot accumulate ids for conversations that are no longer in the section
 * it orders. The no-op case is asserted because the caller SKIPS its store write
 * on it.
 */
test("rule 4: unpinning forgets the slot, and an unranked id writes nothing", () => {
	assert.deepEqual(forgetPinnedOrder(["a", "b", "c"], "b"), ["a", "c"]);
	assert.deepEqual(forgetPinnedOrder(["a", "b", "c"], "zzz"), ["a", "b", "c"]);
	assert.deepEqual(forgetPinnedOrder([], "a"), []);
});

/*
 * RULE 6, and the one rule that is not this module's: the order is a preference,
 * so it travels through the store the reader's other view choices already live
 * in - written by the persist middleware, validated on read by
 * `parseSidebarView`, and absent from a profile that never moved a row.
 */
test("rule 6: the order is a validated preference and survives a relaunch", () => {
	// A tampered blob can neither widen the field nor smuggle a non-string in.
	assert.deepEqual(parseSidebarView({}).pins, []);
	assert.deepEqual(parseSidebarView({ pins: "a" }).pins, []);
	assert.deepEqual(parseSidebarView({ pins: [1, null, {}] }).pins, []);
	assert.deepEqual(
		parseSidebarView({ pins: ["a", "", "a", "b"] }).pins,
		["a", "b"],
		"empty entries and duplicates are dropped, order is kept",
	);
	assert.deepEqual(
		parseSidebarView({ pins: ["gone-session"] }).pins,
		["gone-session"],
		"an id this client does not have is KEPT: only the panel knows which rows exist",
	);
	assert.deepEqual(DEFAULT_SIDEBAR_VIEW.pins, []);

	memory.clear();
	const store = useUiPreferencesStore;
	const view = { ...DEFAULT_SIDEBAR_VIEW, pins: ["c", "a"] };
	store.getState().setChatSidebarView(view);
	assert.deepEqual(
		persistedUiPreferences(store.getState()).chatSidebarView,
		view,
		"the field is in the persisted blob rather than filtered out of it",
	);
	const key = [...memory.keys()].find((entry) => {
		try {
			return JSON.parse(memory.get(entry)).state?.chatSidebarView !== undefined;
		} catch {
			return false;
		}
	});
	assert.notEqual(key, undefined, "the store wrote no view at all");
	const bytes = JSON.parse(memory.get(key)).state.chatSidebarView;
	assert.deepEqual(
		parseSidebarView(bytes).pins,
		["c", "a"],
		"the next launch parses back the reader's own order",
	);
});

/*
 * THE CHORDS. `⌘⇧↑` / `⌘⇧↓` are the pair's, and the refusals are as much of the
 * contract as the presses: the region walk's `⌘⌥↓`/`⌘⌥↑` carry `alt`, the row's
 * acts are letters, the list's arrow walk reads a BARE arrow (so a shifted one
 * must not be taken as one), and an unmodified arrow must stay the walk's.
 */
test("the move chords are the shifted arrows and nothing else", () => {
	const press = (key, mods = {}) => ({
		key,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...mods,
	});
	assert.equal(chatPinMoveChord(press("ArrowUp", { metaKey: true, shiftKey: true })), -1);
	assert.equal(
		chatPinMoveChord(press("ArrowDown", { metaKey: true, shiftKey: true })),
		1,
	);
	assert.equal(
		chatPinMoveChord(press("ArrowDown", { ctrlKey: true, shiftKey: true })),
		1,
		"the Ctrl spelling is the same chord elsewhere",
	);
	// Refusals.
	assert.equal(chatPinMoveChord(press("ArrowUp")), null, "a bare arrow is the list's walk");
	assert.equal(chatPinMoveChord(press("ArrowUp", { metaKey: true })), null);
	assert.equal(chatPinMoveChord(press("ArrowUp", { metaKey: true, altKey: true })), null);
	assert.equal(
		chatPinMoveChord(press("ArrowUp", { metaKey: true, shiftKey: true, altKey: true })),
		null,
		"the region walk's chord is `⌘⌥↓`, and `alt` is what keeps them apart",
	);
	assert.equal(chatPinMoveChord(press("p", { metaKey: true, shiftKey: true })), null);
	assert.equal(chatPinMoveChord(press("a", { metaKey: true, shiftKey: true })), null);
	// The spelling the controls would print.
	assert.equal(chatPinMoveCap(-1, true), "⌘⇧↑");
	assert.equal(chatPinMoveCap(1, false), "Ctrl+Shift+↓");
	assert.equal(chatPinMoveAttr(-1), CHAT_PIN_MOVE_ATTR.up);
	assert.equal(chatPinMoveAttr(1), CHAT_PIN_MOVE_ATTR.down);
});

/*
 * The chord's own dispatch, as a lookup: the press starts at the row's BOX (the
 * controls are siblings of the row's button, and that is where the reader's
 * focus usually is) and answers null for a row that offers no pair.
 */
test("a chord finds the control on the row's own box, or nothing", () => {
	const up = { tag: "up" };
	const down = { tag: "down" };
	const rowEl = {
		querySelector: (selector) =>
			selector === "[data-session-move-up]"
				? up
				: selector === "[data-session-move-down]"
					? down
					: null,
	};
	const inside = { closest: (selector) => (selector === "[data-session-row]" ? rowEl : null) };
	assert.equal(chatPinMoveControl(inside, -1), up);
	assert.equal(chatPinMoveControl(inside, 1), down);
	assert.equal(
		chatPinMoveControl({ closest: () => null }, 1),
		null,
		"a row with no pair answers with no control",
	);
	assert.equal(chatPinMoveControl(null, 1), null);
	assert.equal(chatPinMoveControl({}, 1), null, "a target with no `closest` belongs to nobody");
});

/*
 * THE COMPONENT HALF, read rather than rendered: the sidebar cannot be mounted by
 * this suite, so the three claims that make the pair a ROW control rather than a
 * new kind of affordance are asserted where they are written.
 */
test("the pair is a row control: one stop per row, a chord, and a live region", () => {
	const source = SOURCE(SIDEBAR);
	// Out of the Tab ring, on the row's own one-stop model, and not in the arrow
	// ring either (`data-chat-row` is what that walk collects).
	for (const anchor of ["data-session-move-up\n", "data-session-move-down\n"]) {
		const at = source.indexOf(anchor);
		assert.notEqual(at, -1, `${anchor.trim()} is not in the sidebar`);
		const control = source.slice(at, source.indexOf("</button>", at));
		assert.match(control, /tabIndex=\{-1\}/);
		assert.equal(
			control.includes("data-chat-row"),
			false,
			"the move pair must not join the arrow ring",
		);
	}
	// The chords are `chat-pin-order.ts`'s, and the press goes through the CONTROL
	// rather than reimplementing the move - the row acts' own rule.
	assert.match(source, /const move = chatPinMoveChord\(event\);/);
	assert.match(source, /chatPinMoveControl\(target, move\)/);
	assert.match(source, /control\.click\(\);/);
	// The announcement has a mounted, stable live region to land in.
	assert.match(
		source,
		/\{pinsEnabled && \(\s*<span\s+className="sr-only"\s+aria-live="polite"\s+data-sidebar-pin-order-announcement/,
	);
	// The write goes through the view preference, and the row's own correction is
	// what brings the caret and the line back (unpin's mechanism, not a new one).
	assert.match(source, /setChatSidebarView\(\{ \.\.\.view, pins: next \}\)/);
	assert.match(source, /rememberMovedRow\(sessionId, follow, null\)/);
	// An unpin forgets the slot, and only when the id was ranked at all.
	assert.match(
		source,
		/pinned && view\.pins\.includes\(row\.session_id\)[\s\S]{0,120}?forgetPinnedOrder\(view\.pins, row\.session_id\)/,
	);
	// The pair is offered only where the section's own order is on screen.
	assert.match(source, /!nested &&\s*pinsEnabled &&\s*view\.groupBy === "section" &&/);
	// And it is drawn for PINNED rows only.
	assert.match(source, /\{row\.pinned === true &&/);
	// The row it renders is the ordered one: the section draws the permutation,
	// not the catalogue list it was computed from.
	assert.match(source, /\{orderedPinned\.map\(\(row\) => sessionRow\(row\)\)\}/);
});

/*
 * THE DRAG HALF (issue #697, items 1, 4, 5 and 6), read off the shipped source in
 * the same idiom as the test above - and for the same reason: the sidebar cannot
 * be rendered here, so the properties that make the gesture safe are asserted
 * where they are written.
 *
 * WHAT THIS TEST IS NOT: evidence that a drag works. The pixels, the indicator
 * mid-gesture and the order after a drop are the driver's (`pinned-reorder`), and
 * a class string that looks right is not a row that moved.
 */
test("the grip is a drag handle: pointer-only, revealed like the pair, and one write per drop", () => {
	const source = SOURCE(SIDEBAR);
	const at = source.indexOf("data-session-pin-grip");
	assert.notEqual(at, -1, "the grip is not in the sidebar");
	const grip = source.slice(at, source.indexOf("</button>", at));
	// Out of both rings: the Tab ring and the arrow ring (`data-chat-row`).
	assert.match(grip, /tabIndex=\{-1\}/);
	assert.equal(
		grip.includes("data-chat-row"),
		false,
		"the grip must not join the arrow ring",
	);
	// Revealed by the row's pointer or its focus, exactly as the pair is.
	assert.match(grip, /group-hover:flex/);
	assert.match(grip, /group-focus-within:flex/);
	// A cursor, never a transform: nothing in the control lifts, scales or fades.
	assert.match(grip, /cursor-grab/);
	assert.equal(/opacity-|scale-|translate-|shadow-/.test(grip), false);
	// The four pointer handlers, all on the grip: the press is the only entry to a
	// drag, and the capture keeps every move aimed at it.
	assert.match(grip, /onPointerDown=\{\(event\) =>/);
	assert.match(grip, /startPinDrag\(row\.session_id, label, event\)/);
	assert.match(grip, /onPointerMove=\{movePinDrag\}/);
	assert.match(grip, /onPointerUp=\{\(\) => settlePinDrag\(true\)\}/);
	assert.match(grip, /onPointerCancel=\{\(\) => settlePinDrag\(false\)\}/);
	// The press refuses a non-primary button and stops the row's own plumbing.
	assert.match(source, /if \(event\.button !== 0\) return;\n\t\tevent\.preventDefault\(\);\n\t\tevent\.stopPropagation\(\);/);
	assert.match(source, /setPointerCapture\(event\.pointerId\)/);
	// The drop is the model's, once, through the view preference.
	assert.match(source, /movePinnedOrderTo\(/);
	assert.match(source, /dropPinnedRow[\s\S]{0,600}?setChatSidebarView\(\{ \.\.\.view, pins: next \}\)/);
	// A cancel writes nothing and says so; Escape is the cancel with no pointer.
	assert.match(source, /if \(!commit\) \{[\s\S]{0,200}?announcePinMove\("Move cancelled\."\)/);
	assert.match(source, /event\.key !== "Escape"/);
	// The dragged row is marked on its own box, and the mark is a colour step. The
	// predicate is read ONCE (`dragging`), so the attribute and the ground cannot
	// disagree about which row is being moved.
	assert.match(source, /const dragging = pinDrag\?\.id === row\.session_id;/);
	assert.match(source, /data-dragging=\{dragging \? "" : undefined\}/);
	assert.match(source, /dragging && rowDragging,/);
	assert.match(source, /export const rowDragging = "bg-row-selected text-ink";/);
	// The indicator exists only during the drag, is inert, and lives in the section
	// the rows are drawn in (so it scrolls with them).
	assert.match(source, /pinDrag !== null && \(/);
	assert.match(source, /data-session-pin-indicator=""/);
	assert.match(source, /ref=\{pinnedSectionRef\}/);
	assert.match(source, /className="pointer-events-none absolute right-1 left-1 h-0\.5 rounded-full bg-accent"/);
	// The auto-scroll loop is armed with the drag and reaped with it.
	assert.match(source, /requestAnimationFrame\(/);
	assert.match(source, /cancelAnimationFrame\(pinDragAutoScrollRef\.current\)/);
});
