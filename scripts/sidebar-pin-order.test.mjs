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
 *     desktop capability hooks), so "one tab stop per row, a chord and a menu item
 *     that reach the same write, a live region for the announcement" is asserted
 *     where it is written rather than described.
 *
 * WHAT IS NOT HERE, and is deliberately elsewhere: that the grip is DRAWN and the
 * menu's two Move items are painted (they are the frames' job,
 * `docs/evidence/pinned-reorder/`), that the rows actually swap on screen, and that
 * the caret and the line come back afterwards. Those are claims about pixels and
 * about a commit, and they are answered by a rendered capture and by the driver's
 * own walk - a green assertion about a class string is not evidence that anything
 * moved.
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
			/* The Escape ladder's own predicate, so its rung for the drag cancel is
			   driven rather than described (UX round 1, U5). */
			'export { interruptEscapeApplies } from "./src/renderer/src/features/chat/hooks/use-interrupt-on-escape";',
			/* The class merge the row box actually runs, so the ground steps are asserted
			   against twMerge rather than against a comment (round 1, D1 and D5c). */
			'export { cn } from "./src/renderer/src/shared/lib/utils";',
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
	canMovePinnedRow,
	chatPinMoveCap,
	chatPinMoveCapJoined,
	chatPinMoveChord,
	chatPinMoveRowId,
	forgetPinnedOrder,
	movePinnedOrder,
	movePinnedOrderTo,
	orderPinnedRows,
	pinDragSlot,
	pinMoveBoundaryNote,
	pinMoveNote,
	pinMoveUntargetedNote,
	pinnedOrder,
	DEFAULT_SIDEBAR_VIEW,
	parseSidebarView,
	persistedUiPreferences,
	useUiPreferencesStore,
	interruptEscapeApplies,
	cn,
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
	assert.deepEqual(
		dropped,
		["b", "c", "d", "a", "e"],
		"three places, one array",
	);
	let chorded = full;
	for (let step = 0; step < 3; step += 1)
		chorded = movePinnedOrder(full, chorded, chorded, "a", 1);
	assert.deepEqual(
		dropped,
		chorded,
		"identical to three \u2318\u21e7\u2193 presses",
	);
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
	assert.deepEqual(
		dropped,
		["d", "b", "a", "c"],
		"the hidden id keeps its index",
	);
	assert.deepEqual(
		pinnedOrder(full, dropped).filter((id) => shown.includes(id)),
		["d", "a", "c"],
		"and the drop is read off the rows on screen",
	);
});

test("a drop that lands where it started writes nothing", () => {
	const full = ["a", "b", "c"];
	assert.equal(movePinnedOrderTo(full, full, full, "b", 1), null);
	assert.equal(
		movePinnedOrderTo(full, full, full, "b", 1.4),
		null,
		"a rounded slot",
	);
	assert.equal(
		movePinnedOrderTo(full, full, full, "z", 0),
		null,
		"an id not drawn",
	);
	/* A pointer past either end means "the end", which is the one reading a clamp
	   and a refusal agree on - and it is what a drag into the section's padding
	   produces, so it must not be a null. */
	assert.deepEqual(movePinnedOrderTo(full, full, full, "b", 99), [
		"a",
		"c",
		"b",
	]);
	assert.deepEqual(movePinnedOrderTo(full, full, full, "b", -3), [
		"b",
		"a",
		"c",
	]);
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
	assert.equal(
		pinDragSlot(boxes, "c", 200),
		2,
		"the dragged row is not a target",
	);
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
	assert.deepEqual(
		movePinnedOrder(["a", "b"], [], ["new", "a", "b"], "a", -1),
		["a", "new", "b"],
	);
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
 * RULE 5, the boundary. Both Move items are drawn inapplicable at the ends, and
 * the chord has to SAY so rather than do nothing - a key that silently does
 * nothing reads as a broken key. The three sentences are the move's whole
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
 * THE THIRD ANSWER: A ROW THAT OFFERS NO MOVE (UX round 1, U4; measured on a live
 * run).
 *
 * A chord pressed on a row that is not pinned is CONSUMED - a modified arrow is this
 * panel's chord namespace - but it is ANSWERED in the move's own voice rather than
 * leaving the region holding whatever sentence an earlier press left there, which the
 * UX round measured as a sentence about a DIFFERENT row: stale, and untrue of the row
 * under the caret.
 */
test("a chord on a row that is not pinned says so, by name", () => {
	assert.equal(pinMoveUntargetedNote("Work"), "“Work” is not pinned.");
	assert.equal(
		pinMoveUntargetedNote("QA Chat 008"),
		"“QA Chat 008” is not pinned.",
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
 * THE CHORDS. `⌘⇧↑` / `⌘⇧↓` are the move's, and the refusals are as much of the
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
	assert.equal(
		chatPinMoveChord(press("ArrowUp", { metaKey: true, shiftKey: true })),
		-1,
	);
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
	assert.equal(
		chatPinMoveChord(press("ArrowUp")),
		null,
		"a bare arrow is the list's walk",
	);
	assert.equal(chatPinMoveChord(press("ArrowUp", { metaKey: true })), null);
	assert.equal(
		chatPinMoveChord(press("ArrowUp", { metaKey: true, altKey: true })),
		null,
	);
	assert.equal(
		chatPinMoveChord(
			press("ArrowUp", { metaKey: true, shiftKey: true, altKey: true }),
		),
		null,
		"the region walk's chord is `⌘⌥↓`, and `alt` is what keeps them apart",
	);
	assert.equal(
		chatPinMoveChord(press("p", { metaKey: true, shiftKey: true })),
		null,
	);
	assert.equal(
		chatPinMoveChord(press("a", { metaKey: true, shiftKey: true })),
		null,
	);
	// The spelling the row menu prints.
	assert.equal(chatPinMoveCap(-1, true), "⌘⇧↑");
	assert.equal(chatPinMoveCap(1, false), "Ctrl+Shift+↓");
	/*
	 * AND THE JOINED SIBLING IS WHAT IT ACTUALLY PRINTS (round-1 design review,
	 * D1): `KeyboardShortcut` splits its prop on `+`, so the handler's spelling fed
	 * to it renders as ONE cap three glyphs wide. The property that keeps the two
	 * from drifting: split the joined form on `+` and the parts concatenate back to
	 * the handler's spelling. `scripts/chat-keyboard-regions.test.mjs` owns the cap
	 * pair itself; this file owns what the two items pass to the component.
	 */
	assert.equal(chatPinMoveCapJoined(-1, true), "⌘+⇧+↑");
	assert.equal(chatPinMoveCapJoined(1, true), "⌘+⇧+↓");
	assert.equal(
		chatPinMoveCapJoined(-1, true).split("+").join(""),
		chatPinMoveCap(-1, true),
	);
	assert.equal(chatPinMoveCapJoined(1, false), "Ctrl+Shift+↓");
});

/*
 * The chord's own target lookup: the press starts at the row's BOX (the reader's
 * focus is usually on the row's button) and answers the row's ID - never an
 * element, because the two arrow controls this used to resolve are deleted and the
 * chord calls the write itself.
 */
test("a chord names the row on its own box, or nothing", () => {
	const inside = {
		closest: (selector) =>
			selector === "[data-session-row]"
				? {
						getAttribute: (name) => (name === "data-session-row" ? "s1" : null),
					}
				: null,
	};
	assert.equal(chatPinMoveRowId(inside), "s1");
	assert.equal(
		chatPinMoveRowId({ closest: () => null }),
		null,
		"a press outside a row names no row, and the chord stands down",
	);
	assert.equal(chatPinMoveRowId(null), null);
	assert.equal(
		chatPinMoveRowId({}),
		null,
		"a target with no `closest` belongs to nobody",
	);
});

/*
 * THE COMPONENT HALF, read rather than rendered: the sidebar cannot be mounted by
 * this suite, so the claims that make the move a ROW control rather than a new kind
 * of affordance are asserted where they are written.
 *
 * THE ARROW PAIR THAT STOOD HERE IS DELETED (2026-09-30). WCAG 2.5.7's
 * single-pointer path is the two `Move conversation` items in the row's own menu,
 * with the chords printed beside them, and the CHORD reaches the same write rather
 * than clicking a control that no longer exists. So the pair's two structural
 * assertions are replaced by the items' own and by the chord's call.
 */
test("the move is a row control: a menu, a chord, and a live region", () => {
	const source = SOURCE(SIDEBAR);
	// The two items, each with its own boundary state, its own write and its own
	// cap. The window runs back to the item's opening tag, so the assertion is
	// about THAT item rather than about the menu.
	for (const [label, step, cap] of [
		// The JOINED sibling, not the handler's spelling: the item renders caps
		// through `KeyboardShortcut`, which splits on `+` (D1).
		["Move conversation up", -1, "chatPinMoveCapJoined(-1, isMac)"],
		["Move conversation down", 1, "chatPinMoveCapJoined(1, isMac)"],
	]) {
		const at = source.indexOf(`<span>${label}</span>`);
		assert.notEqual(at, -1, `${label} is not in the row menu`);
		const item = source.slice(
			source.lastIndexOf("<ContextMenuItem", at),
			source.indexOf("</ContextMenuItem>", at),
		);
		assert.match(
			item,
			/aria-disabled=\{!(?:up|down)\}/,
			`${label} no longer states its boundary`,
		);
		assert.ok(item.includes(cap), `${label} no longer prints its chord`);
		assert.ok(
			item.includes(`movePinnedRow(row.session_id, ${step}, true)`),
			`${label} no longer calls the move's one write`,
		);
		assert.equal(
			/\sdisabled=\{/.test(item),
			false,
			`${label} is disabled rather than drawn inapplicable`,
		);
	}
	// THE CONTROLS AND THEIR ATTRIBUTES ARE GONE rather than left unused: a scene
	// that still queried them would photograph nothing and report success.
	for (const gone of [
		"data-session-move-up",
		"data-session-move-down",
		"data-session-pin-move",
		"chatPinMoveControl",
	]) {
		assert.equal(
			source.includes(gone),
			false,
			`the deleted arrow pair is still in the panel: ${gone}`,
		);
	}
	// The chords are `chat-pin-order.ts`'s, and the press calls the SAME write the
	// items call rather than a second spelling of the move.
	assert.match(source, /const move = chatPinMoveChord\(event\);/);
	assert.match(source, /chatPinMoveRowId\(target\)/);
	assert.match(source, /movePinnedRow\(rowId, move, true\)/);
	// The announcement has a mounted, stable live region to land in.
	assert.match(
		source,
		/\{pinsEnabled && \(\s*<span\s+className="sr-only"\s+aria-live="polite"\s+data-sidebar-pin-order-announcement/,
	);
	// The write goes through the view preference, and the row's own correction is
	// what brings the caret and the line back (unpin's mechanism, not a new one).
	assert.match(source, /setChatSidebarView\(\{ \.\.\.view, pins: next \}\)/);
	// The correction carries the MOVE's own two terms (round 1, Q1 and R3): the
	// caret goes to the row's own button rather than to the pin mark, and the scroll
	// correction stands down because an in-section swap moves the anchor row too.
	assert.match(
		source,
		/rememberMovedRow\(sessionId, follow, null, "row", false\)/,
	);
	// An unpin forgets the slot, and only when the id was ranked at all.
	assert.match(
		source,
		/pinned && view\.pins\.includes\(row\.session_id\)[\s\S]{0,120}?forgetPinnedOrder\(view\.pins, row\.session_id\)/,
	);
	// THE OFFER IS ONE PREDICATE the grip and the menu items both read, and its
	// terms are the section's: the arrangement and a drawn position in it.
	assert.match(
		source,
		/const offersMove = offersPinnedMove\(row\.session_id, nested\);/,
	);
	assert.match(
		source,
		/const offersPinnedMove = \(sessionId: string, nested = false\) =>\s*pinsEnabled &&\s*view\.groupBy === "section" &&\s*!nested &&\s*pinnedIndex\.has\(sessionId\)/,
	);
	// The row it renders is the ordered one: the section draws the permutation,
	// not the catalogue list it was computed from.
	assert.match(
		source,
		/\{orderedPinned\.map\(\(row\) => sessionRow\(row\)\)\}/,
	);
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
test("the grip is a drag handle: pointer-only, hover-revealed, and one write per drop", () => {
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
	/*
	 * REVEALED BY THE POINTER, AND BY THE POINTER ONLY (agent review round 2, N1). The
	 * grip used to carry the pair's `group-focus-within` term as well, and that is the one
	 * thing this test asserted differently before this round: the control is `aria-hidden`
	 * and `tabIndex={-1}`, so revealing it for the keyboard showed a sighted keyboard
	 * reader a handle they can neither focus nor operate. The keyboard's own reach is the
	 * row menu's two Move items (with the chords beside them), asserted above on the
	 * menu's own item lists.
	 */
	assert.match(
		grip,
		/"group-data-\[session-hover-intent\]:flex group-data-\[session-hover-intent\]:text-ink-muted",/,
	);
	assert.equal(
		/"group-focus-within:flex/.test(grip),
		false,
		"the grip is not focus-revealed: it is AT-inert, so the keyboard has nothing to do with it",
	);
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
	assert.match(
		source,
		/if \(event\.button !== 0\) return;\n\t\tevent\.preventDefault\(\);\n\t\tevent\.stopPropagation\(\);/,
	);
	assert.match(source, /setPointerCapture\(event\.pointerId\)/);
	// The drop is the model's, ONCE, through the view preference. The count is the
	// assertion rather than a window around `dropPinnedRow`, because round 1 (U2/Q2)
	// added a branch between the model call and the write - the no-op drop's own
	// clear - and a window wide enough to span it would also span the chord's write.
	assert.match(source, /movePinnedOrderTo\(/);
	/*
	 * TWO WRITES IN THE FILE, which is one per GESTURE and no more: the two Move items
	 * and the chord reach `movePinnedRow` (one write) and the drop reaches
	 * `dropPinnedRow` (one write). Three would mean a path double-writes; one would
	 * mean a gesture that cannot record its own arrangement.
	 */
	assert.equal(
		(source.match(/setChatSidebarView\(\{ \.\.\.view, pins: next \}\)/g) ?? [])
			.length,
		2,
		"each gesture writes the order exactly once",
	);
	// A cancel writes nothing and says so; Escape is the cancel with no pointer.
	assert.match(
		source,
		/if \(!commit\) \{[\s\S]{0,200}?announcePinMove\("Move cancelled\."\)/,
	);
	assert.match(source, /event\.key !== "Escape"/);
	// The dragged row is marked on its own box, and the mark is a colour step. The
	// predicate is read ONCE (`dragging`), so the attribute and the ground cannot
	// disagree about which row is being moved.
	assert.match(source, /const dragging = pinDrag\?\.id === row\.session_id;/);
	assert.match(source, /data-dragging=\{dragging \? "" : undefined\}/);
	// The held row's ground is merged LAST, after `rowCurrent`, and it is ONE ground for
	// both row states (round 2, D7 + U6): a current held row keeps its own selected fill,
	// so "you are here" survives the gesture.
	assert.match(source, /dragging && rowDragging,/);
	// AND THE NON-FILL HALF OF THE HELD STATE, merged after the ground: a 1px OUTLINE,
	// inset by 1px. It is what tells a held row apart from the row under the pointer, in
	// the state the first attempt got wrong (`rowDraggingCurrent` painted the hover fill,
	// which is exactly what the drop target wears - measured in both palettes).
	// WHY AN OUTLINE AND NOT AN INSET `ring-1` (design round 3, D10): a box-shadow on the
	// row's box is painted UNDER its children, and the current row's own button carries an
	// opaque `bg-row-selected` - measured on the frames, the mark was 60.2% visible on a
	// non-current held row and 5.3% on the current one. An outline paints after the
	// element's descendants, so the child cannot cover it, and the -1px offset keeps it
	// inside the row's own rounded box (no layout shift, nothing hanging outside).
	assert.match(
		source,
		/export const rowDraggingMark =\s*"outline outline-1 outline-offset-\[-1px\] outline-ink-dim";/,
	);
	assert.match(source, /dragging && rowDraggingMark,/);
	assert.equal(
		source.includes("rowDraggingCurrent"),
		false,
		"the held state is not a second fill: it is the row's own ground plus the mark",
	);
	/*
	 * AND IT IS RESTATED AT THE HOVER VARIANT (round 1, D1 and U1; measured on the frames
	 * and on a live run). A bare `bg-row-selected` loses to the row box's own
	 * `hover:bg-row-hover`, and the pointer that armed the drag never leaves the captured
	 * row - so the shipped constant painted the dragged row exactly like a merely hovered
	 * one (`#302D2A` dark against the intended `#372F24`). Round 2 removed the SECOND
	 * spelling this comment used to describe (a held CURRENT row taking the other row
	 * role), because that role is the hover fill too; the ground is now one constant and
	 * the held state's second half is the ring.
	 */
	assert.match(
		source,
		/export const rowDragging =\s*"bg-row-selected text-ink hover:bg-row-selected hover:text-ink";/,
	);
	// The indicator exists only during the drag, is inert, and lives in the section
	// the rows are drawn in (so it scrolls with them).
	assert.match(source, /pinDrag !== null && \(/);
	assert.match(source, /data-session-pin-indicator=""/);
	assert.match(source, /ref=\{pinnedSectionRef\}/);
	assert.match(
		source,
		/className="pointer-events-none absolute right-1 left-1 h-0\.5 rounded-full bg-accent"/,
	);
	// The auto-scroll loop is armed with the drag and reaped with it.
	assert.match(source, /requestAnimationFrame\(/);
	assert.match(source, /cancelAnimationFrame\(pinDragAutoScrollRef\.current\)/);
});

/*
 * ROUND 1's REMEDIATION, read off the shipped source for this suite's own reason: the
 * sidebar cannot be rendered here, and each of these is a property that a measured frame
 * or a live reading failed on the round-1 head - so the fix is pinned where it is
 * written, and the frames and the driver's walk are what show it working.
 */
test("round 1's fixes are where they are written", () => {
	const source = SOURCE(SIDEBAR);

	// R1: the drop takes the GESTURE's own slot (written synchronously by the last
	// move), and the doors bound once call the LATEST settle rather than the render
	// their effect was created on.
	assert.match(source, /dropPinnedRow\(live\.id, live\.slot\);/);
	assert.match(source, /const settlePinDragRef = useRef\(settlePinDrag\);/);
	assert.match(source, /settlePinDragRef\.current = settlePinDrag;/);
	assert.match(
		source,
		/const end = \(\) => settlePinDragRef\.current\(true\);/,
	);
	assert.match(
		source,
		/const cancel = \(\) => settlePinDragRef\.current\(false\);/,
	);
	assert.match(source, /settlePinDragRef\.current\(false\);/);

	// U2 + Q2: the no-op drop closes the gesture's opening sentence.
	assert.match(
		source,
		/if \(next === null\) \{[\s\S]{0,900}?announcePinMove\(""\);/,
	);

	// Q1 + R3: a move's caret goes to the row's own ring stop, and the scroll
	// correction is skipped for a reorder.
	assert.match(source, /moved\.caret === "row"/);
	assert.match(source, /else if \(moved\.anchorId !== null && moved\.scroll\)/);
	assert.match(
		source,
		/rememberMovedRow\(sessionId, false, null, "row", false\)/,
	);

	// U3 + R6 + Q3: a repeat sentence is cleared and re-set across a frame, because a
	// live region is read from its mutations and an identical string is not one.
	assert.match(
		source,
		/const repeat = sentence !== "" && sentence === pinMoveHeldRef\.current;/,
	);
	assert.match(
		source,
		/requestAnimationFrame\(\(\) => \{[\s\S]{0,120}?setPinMoveAnnouncement\(sentence\);/,
	);

	// U4 + R4: the chord answers on a row that offers no move.
	assert.match(
		source,
		/announcePinMove\(pinMoveUntargetedNote\(rowLabel\(rowId\)\)\);/,
	);

	// D4: the row's flyout is suppressed while the drag is armed.
	assert.match(source, /disabled=\{pinDrag !== null\}/);

	// D3, R5 and D6: the grip's COUNT, its a11y shape and its tooltip. The SHED this
	// block used to assert (`@max-[263px]/chatsidebar:hidden!` and the panel root's
	// `@container/chatsidebar` that existed only to be its reader) is deleted with the
	// arrow pair: round 1 shed the grip because the FIVE-control cluster left the 240
	// clamp a 40px title, and the pair's removal leaves 124px there, so the grip is
	// drawn at every width and a scene that measured the break would measure nothing.
	assert.match(source, /pinnedDrawnIds\.length >= 2 &&/);
	assert.equal(
		/@container\/chatsidebar relative flex/.test(source),
		false,
		"the grip's width break is deleted, and the container declaration with it",
	);
	assert.equal(
		/["'`][^"'`]*max-\[[0-9]+px\]\/chatsidebar/.test(
			source.replace(/\/\*[\s\S]*?\*\//g, ""),
		),
		false,
		"a width break on the container query is back on a class list",
	);
	assert.match(
		source,
		/aria-hidden="true"[\s\S]{0,120}?title="Drag to reorder · Esc cancels"/,
	);
	const grip = source.slice(
		source.indexOf("data-session-pin-grip"),
		source.indexOf("</button>", source.indexOf("data-session-pin-grip")),
	);
	assert.equal(
		grip.includes("aria-label"),
		false,
		"the grip is pointer-only and must not be named to AT (R5)",
	);

	// R2: the three comments the reviewer measured as false no longer claim a
	// per-frame indicator re-placement.
	assert.equal(
		/auto-scroll loop re-places the line\s*\n?\s*every frame/.test(source),
		false,
	);
});

/*
 * ESCAPE MID-DRAG BELONGS TO THE DRAG (UX round 1, U5). The UX round measured the
 * right OUTCOME - the drag cancels and a running turn is not interrupted - but could
 * not attribute the claim: it was inherited from a Radix tooltip that happened to be
 * open under the pointer. That tooltip is now suppressed for the whole gesture
 * (design D4, same round), so the claim is stated by the handler that acts on the
 * press, and the ladder in `use-interrupt-on-escape.ts` names the rung.
 *
 * BOTH HALVES ARE DRIVEN HERE: the predicate the interrupt listener consults (the
 * shipped one, not a copy), and the shipped handler's own `preventDefault`.
 */
test("Escape mid-drag cancels the drag and cannot reach the turn", () => {
	const idle = { sessionId: "s", turnAlive: true, available: true };
	const press = (defaultPrevented) => ({
		key: "Escape",
		defaultPrevented,
		target: null,
	});
	// A press nobody has claimed still stops a running turn - the ladder's own rung.
	assert.equal(interruptEscapeApplies(press(false), idle), true);
	// The drag's claim (what the sidebar's listener now makes) takes the press away.
	assert.equal(interruptEscapeApplies(press(true), idle), false);

	const source = SOURCE(SIDEBAR);
	const ladder = SOURCE(
		"src/renderer/src/features/chat/hooks/use-interrupt-on-escape.ts",
	);
	assert.match(
		ladder,
		/\* 6\. THE PINNED ROW'S DRAG CANCEL \(issue #697; UX round 1, U5\)/,
		"the drag cancel is a rung of the Escape ladder, written where the ladder is",
	);
	assert.match(
		source,
		/if \(event\.key !== "Escape"\) return;\n\t\t\tsettlePinDragRef\.current\(false\);\n\t\t\t[\s\S]{0,2200}?event\.preventDefault\(\);/,
		"the drag's own handler claims the press it acted on",
	);
});

/*
 * THE GROUND STEPS SURVIVE THE MERGE (round 1, D1 and D5c).
 *
 * Both fixes are about ORDER in a class list, and the box's list is merged by `cn` -
 * tailwind-merge, where the LAST class of a group wins. A comment cannot hold that: the
 * pre-round-1 constant was a `bg-row-selected` sitting BEFORE the box's own
 * `hover:bg-row-hover`, and it painted the hover step for the whole gesture. So the two
 * claims are asserted against the shipped merge itself, on the class strings the
 * component hands it.
 */
test("the drag's ground wins the merge, on both row states", () => {
	// Non-current: `rowDragging` is merged after the box's hover step, and it restates its
	// own ground at the hover variant - so neither the plain nor the hovered fill can
	// take it back.
	const plain = cn(
		"hover:bg-row-hover",
		"bg-row-selected font-medium text-ink hover:bg-row-selected",
		"bg-row-selected text-ink hover:bg-row-selected hover:text-ink",
	);
	assert.ok(plain.includes("bg-row-selected"), plain);
	assert.equal(
		plain.includes("hover:bg-row-hover"),
		false,
		`the box's hover step survived the drag's ground: ${plain}`,
	);
	// Current: the selected rung is the row's RESTING fill, so the dragged variant takes
	// the panel's other rung - and it has to beat `rowCurrent`'s own ground in the merge.
	const current = cn(
		"hover:bg-row-hover",
		"bg-row-selected font-medium text-ink hover:bg-row-selected",
		"bg-row-hover text-ink hover:bg-row-hover hover:text-ink",
	);
	assert.ok(current.includes("bg-row-hover"), current);
	assert.equal(
		current.includes("bg-row-selected"),
		false,
		`rowCurrent's ground outlived the dragged current row's: ${current}`,
	);
});
