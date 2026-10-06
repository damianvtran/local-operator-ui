import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The palette's keyboard decisions: the DOORS — which keys open it, which view
 * each one asks for, and which keystrokes belong to a surface that got there
 * first — and the WALK — the arrow and Ctrl+N/Ctrl+P presses that move the
 * selection while it is open (issue #761). Pure, so the rules that matter are
 * pinned here rather than inferred from a listener.
 *
 * SINCE ISSUE #850 THERE ARE THREE DOORS and one rule: K -> chats (`#`),
 * P -> everything (empty), Shift+P -> commands (`>`). A closed palette opens on
 * the door's seed; an open palette already in that door's view closes; an open
 * palette in another view switches. The rule itself (`paletteDoorOutcome`) is
 * exercised on all three arms below, because the arm that used to be missing —
 * close — is the one a listener bug would silently reinstate.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/command-palette/palette-shortcut";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	paletteDoorCaps,
	paletteDoorLabel,
	paletteDoorOutcome,
	paletteReachableStepCaps,
	paletteShortcutIntent,
	paletteStepCaps,
	paletteStepIndex,
	paletteStepIntent,
} = module;

/** A keystroke, with everything unset unless the test asks for it. */
const key = (overrides = {}) => ({
	key: "k",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	defaultPrevented: false,
	repeat: false,
	...overrides,
});

test("Cmd+K and Ctrl+K are the chats door", () => {
	assert.equal(paletteShortcutIntent(key({ metaKey: true })), "chats");
	assert.equal(paletteShortcutIntent(key({ ctrlKey: true })), "chats");
	// The letter's case depends on the layout and the modifiers, and the rule
	// reads it case-insensitively.
	assert.equal(
		paletteShortcutIntent(key({ metaKey: true, key: "K" })),
		"chats",
	);
});

test("the gesture is a chord, not a bare letter", () => {
	assert.equal(paletteShortcutIntent(key()), null);
});

test("a surface that claimed the key keeps it", () => {
	/*
	 * This is the rule that lets the canvas editors keep Cmd+K: the code editor
	 * opens its AI edit on it and the Markdown editor inserts a link, which is
	 * what Cmd+K means in every editor a user has met. They preventDefault as the
	 * event bubbles, and by the time the window listener runs the answer is here.
	 */
	assert.equal(
		paletteShortcutIntent(key({ metaKey: true, defaultPrevented: true })),
		null,
	);
});

test("nothing else about the chord is accepted", () => {
	/*
	 * Shift and Alt are refused here even though Cmd+Shift+P is one of the three
	 * chords: that one is decided in MAIN (`src/main/index.ts`), which is the only
	 * half that can see a press the window handles before the renderer does. This
	 * function answers exactly the K door, and a Shift+K is not it.
	 */
	assert.equal(
		paletteShortcutIntent(key({ metaKey: true, shiftKey: true })),
		null,
	);
	assert.equal(
		paletteShortcutIntent(key({ metaKey: true, altKey: true })),
		null,
	);
	assert.equal(
		paletteShortcutIntent(key({ metaKey: true, repeat: true })),
		null,
	);
});

test("Cmd+P is not this module's gesture", () => {
	/*
	 * Deliberately not adopted. Cmd/Ctrl+P is answered by the main process's own
	 * hook, which knows nothing about what the renderer is doing and therefore
	 * cannot be the place Cmd+K is decided. Since issue #850 that hook's message
	 * asks for the EVERYTHING view; this module answers the K door alone, and if
	 * this function also answered P a single press would be answered twice.
	 */
	assert.equal(paletteShortcutIntent(key({ metaKey: true, key: "p" })), null);
	assert.equal(paletteShortcutIntent(key({ ctrlKey: true, key: "p" })), null);
});

test("each door's chord is spelled once, in both registers", () => {
	// Prose (the tour, the rail's accessible name).
	assert.equal(paletteDoorLabel("chats", true), "⌘K");
	assert.equal(paletteDoorLabel("chats", false), "Ctrl+K");
	assert.equal(paletteDoorLabel("everything", true), "⌘P");
	assert.equal(paletteDoorLabel("everything", false), "Ctrl+P");
	assert.equal(paletteDoorLabel("commands", true), "⌘⇧P");
	assert.equal(paletteDoorLabel("commands", false), "Ctrl+Shift+P");
	// `KeyboardShortcut` prop text, which splits on `+`.
	assert.equal(paletteDoorCaps("chats", true), "⌘+K");
	assert.equal(paletteDoorCaps("chats", false), "Ctrl+K");
	assert.equal(paletteDoorCaps("everything", true), "⌘+P");
	assert.equal(paletteDoorCaps("everything", false), "Ctrl+P");
	assert.equal(paletteDoorCaps("commands", true), "⌘+⇧+P");
	assert.equal(paletteDoorCaps("commands", false), "Ctrl+Shift+P");
});

/* ------------------------------------------------------------------ *
 * The doors, as one rule (issue #850)
 * ------------------------------------------------------------------ */

test("a closed palette opens on the door's own seed", () => {
	assert.deepEqual(paletteDoorOutcome("chats", { open: false, query: "" }), {
		action: "open",
		query: "#",
	});
	assert.deepEqual(
		paletteDoorOutcome("everything", { open: false, query: "" }),
		{
			action: "open",
			query: "",
		},
	);
	assert.deepEqual(paletteDoorOutcome("commands", { open: false, query: "" }), {
		action: "open",
		query: ">",
	});
});

test("pressing the door whose view is showing closes", () => {
	/*
	 * The arm that did not exist before #850: the switcher key could only MOVE an
	 * open palette, never dismiss it, so a repeat press could not close from any
	 * door. It is derived from the query's SCOPE rather than from a remembered
	 * mode, which is what makes a hand-edited field answerable: `>usage` is still
	 * the commands view, so the commands door closes it.
	 */
	assert.deepEqual(paletteDoorOutcome("chats", { open: true, query: "#" }), {
		action: "close",
	});
	assert.deepEqual(
		paletteDoorOutcome("everything", { open: true, query: "" }),
		{ action: "close" },
	);
	assert.deepEqual(paletteDoorOutcome("commands", { open: true, query: ">" }), {
		action: "close",
	});
	// Terms after the glyph are in the same view.
	assert.deepEqual(
		paletteDoorOutcome("commands", { open: true, query: ">usage" }),
		{ action: "close" },
	);
	assert.deepEqual(
		paletteDoorOutcome("chats", { open: true, query: "#retention" }),
		{ action: "close" },
	);
});

test("a different door switches the view rather than closing", () => {
	/*
	 * "Switcher" muscle memory expects the scope to change: K from the commands
	 * view goes to chats, and the second Shift+P is what closes it. Every ordered
	 * pair is asserted, because the failure a single example would miss is one
	 * door answered by another door's view.
	 */
	assert.deepEqual(paletteDoorOutcome("chats", { open: true, query: ">" }), {
		action: "switch",
		query: "#",
	});
	assert.deepEqual(paletteDoorOutcome("chats", { open: true, query: "" }), {
		action: "switch",
		query: "#",
	});
	assert.deepEqual(paletteDoorOutcome("commands", { open: true, query: "#" }), {
		action: "switch",
		query: ">",
	});
	assert.deepEqual(
		paletteDoorOutcome("everything", { open: true, query: "#retention" }),
		{ action: "switch", query: "" },
	);
	/*
	 * And a query that names no scope IS the everything view, so the other two
	 * doors switch out of it rather than closing.
	 */
	assert.deepEqual(
		paletteDoorOutcome("commands", { open: true, query: "retention" }),
		{ action: "switch", query: ">" },
	);
});

/* ------------------------------------------------------------------ *
 * The walk (issue #761)
 * ------------------------------------------------------------------ */

/** A press, with everything unset unless the test asks for it. */
const press = (overrides = {}) => ({
	key: "n",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...overrides,
});

/**
 * A cap fed back through the walk's decision: `"Ctrl+N"` -> the press it
 * spells. Shared by the bound-set and advertised-set pins below so both read
 * the same spelling convention.
 */
const fromCap = (cap) => {
	const [modifier, letter] = cap.split("+");
	return press({ key: letter, ctrlKey: modifier === "Ctrl" });
};

test("the arrows walk the list, exactly as they always did", () => {
	assert.equal(paletteStepIntent(press({ key: "ArrowDown" })), "next");
	assert.equal(paletteStepIntent(press({ key: "ArrowUp" })), "previous");
	// Cmd+Arrow is still the list's: it has no caret meaning in this field.
	assert.equal(
		paletteStepIntent(press({ key: "ArrowDown", metaKey: true })),
		"next",
	);
});

test("a modified arrow is not the list's", () => {
	/*
	 * The guard that used to sit in the component's own branches, kept whole
	 * where the decision moved: Shift+Arrow is the caret extending a selection,
	 * Alt+Arrow is the OS's, and Ctrl+Arrow is the caret's word-jump on Windows
	 * and Linux (UX round 2, U3; round 3's review caught the first guard was
	 * macOS-only). None of the three is the walk — and this is the case that
	 * fails if the pair's arrival ever weakens the arrows' ctrl refusal.
	 */
	for (const arrow of ["ArrowDown", "ArrowUp"]) {
		assert.equal(
			paletteStepIntent(press({ key: arrow, shiftKey: true })),
			null,
		);
		assert.equal(paletteStepIntent(press({ key: arrow, altKey: true })), null);
		assert.equal(paletteStepIntent(press({ key: arrow, ctrlKey: true })), null);
	}
});

test("Ctrl+N / Ctrl+P step next / previous (issue #761)", () => {
	assert.equal(paletteStepIntent(press({ key: "n", ctrlKey: true })), "next");
	assert.equal(
		paletteStepIntent(press({ key: "p", ctrlKey: true })),
		"previous",
	);
	// The letter's case depends on the layout and the modifiers; read it
	// case-insensitively, the way the door's chord reads K.
	assert.equal(paletteStepIntent(press({ key: "N", ctrlKey: true })), "next");
});

test("the pair is Control's alone", () => {
	// A bare letter is text the user is typing into the field.
	assert.equal(paletteStepIntent(press({ key: "n" })), null);
	/*
	 * Cmd is refused deliberately: on macOS Cmd+N is the app's new-chat chord
	 * and Cmd+P the palette's everything door — both with jobs that are not this
	 * one — so claiming either inside the palette would silently re-bind a press
	 * the app already means something by. On the pair, refusing meta mirrors the
	 * arrows refusing ctrl. Since #850 this refusal is also what keeps Cmd+P
	 * (handled in MAIN) from colliding with the walk's Ctrl+P.
	 */
	assert.equal(paletteStepIntent(press({ key: "n", metaKey: true })), null);
	assert.equal(paletteStepIntent(press({ key: "p", metaKey: true })), null);
	// Shift/Alt are refused for the pair as they are for the arrows: a chord
	// this app does not implement stays available rather than firing the
	// neighbouring one.
	assert.equal(
		paletteStepIntent(press({ key: "n", ctrlKey: true, shiftKey: true })),
		null,
	);
	assert.equal(
		paletteStepIntent(press({ key: "p", ctrlKey: true, altKey: true })),
		null,
	);
	assert.equal(
		paletteStepIntent(press({ key: "n", ctrlKey: true, metaKey: true })),
		null,
	);
});

test("the walk wraps at both ends, and an empty list does not move", () => {
	assert.equal(paletteStepIndex(0, 3, "next"), 1);
	assert.equal(paletteStepIndex(2, 3, "next"), 0);
	assert.equal(paletteStepIndex(0, 3, "previous"), 2);
	assert.equal(paletteStepIndex(1, 3, "previous"), 0);
	/*
	 * count = 0 answers null — the modulo-by-zero case, which used to compute
	 * NaN and leave every row unselected with no way back. The handler treats
	 * null as "stay where you are".
	 */
	assert.equal(paletteStepIndex(0, 0, "next"), null);
	assert.equal(paletteStepIndex(0, 0, "previous"), null);
});

test("the caps are the binding's own spellings", () => {
	const [nextCap, previousCap] = paletteStepCaps();
	assert.equal(nextCap, "Ctrl+N");
	assert.equal(previousCap, "Ctrl+P");
	/*
	 * This is the BOUND set — every spelling the decision accepts — pinned by
	 * FEEDING each cap back through the decision, not by asserting the literal
	 * alone: a rename of either side that stops the handler's binding and the
	 * spelled pair agreeing fails here. It is deliberately NOT the set the
	 * footer draws; the advertised set is pinned by the next case.
	 */
	assert.equal(paletteStepIntent(fromCap(nextCap)), "next");
	assert.equal(paletteStepIntent(fromCap(previousCap)), "previous");
});

test("the advertised caps are the reachable set, which is a platform fact", () => {
	/*
	 * ISSUE #850 CHANGED WHY Ctrl+P IS OR IS NOT TAUGHT. It used to be dead
	 * everywhere, because main folded Control into Cmd and swallowed the press on
	 * every platform. The palette branch in `src/main/index.ts` now answers Cmd
	 * alone on darwin, so on macOS Ctrl+P REACHES the renderer and steps — and the
	 * footer advertises it there. Everywhere else main still preventDefaults it
	 * and answers with the palette's everything door, so the legend keeps teaching
	 * Ctrl+N alone (design round 1, D1).
	 */
	assert.deepEqual(paletteReachableStepCaps(true), ["Ctrl+N", "Ctrl+P"]);
	assert.deepEqual(paletteReachableStepCaps(false), ["Ctrl+N"]);
	/*
	 * The invariant the two sets share, asserted for both platforms: reachable
	 * implies bound. A cap the footer draws that the decision would refuse is the
	 * dead-cap regression wearing the opposite costume.
	 */
	for (const isMac of [true, false]) {
		for (const cap of paletteReachableStepCaps(isMac)) {
			const step = paletteStepIntent(fromCap(cap));
			assert.ok(
				step === "next" || step === "previous",
				`${cap} is advertised on ${isMac ? "macOS" : "other platforms"} but the walk refuses it`,
			);
		}
	}
	// Ctrl+P is always BOUND, whatever the platform advertises.
	assert.ok(paletteStepCaps().includes("Ctrl+P"));
	// And it is advertised on exactly one platform.
	assert.ok(paletteReachableStepCaps(true).includes("Ctrl+P"));
	assert.ok(!paletteReachableStepCaps(false).includes("Ctrl+P"));
});
