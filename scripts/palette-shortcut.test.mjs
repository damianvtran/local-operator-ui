import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The palette's keyboard decisions: the DOOR — which keys toggle it, and which
 * keystrokes belong to a surface that got there first — and the WALK — the
 * arrow and Ctrl+N/Ctrl+P presses that move the selection while it is open
 * (issue #761). Pure, so the rules that matter are pinned here rather than
 * inferred from a listener.
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
	paletteReachableStepCaps,
	paletteShortcutCaps,
	paletteShortcutIntent,
	paletteShortcutLabel,
	paletteStepCaps,
	paletteStepIndex,
	paletteStepIntent,
	switcherShortcutLabel,
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

test("Cmd+K and Ctrl+K both open the palette", () => {
	assert.equal(paletteShortcutIntent(key({ metaKey: true })), "toggle");
	assert.equal(paletteShortcutIntent(key({ ctrlKey: true })), "toggle");
	// The letter's case depends on the layout and the modifiers, and the rule
	// reads it case-insensitively.
	assert.equal(
		paletteShortcutIntent(key({ metaKey: true, key: "K" })),
		"toggle",
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
	 * Deliberately not adopted. Cmd/Ctrl+P is the gesture this palette shipped
	 * with, and the people who learned it from the app's own tour still have it —
	 * it is answered by the main process's own hook, which knows nothing about
	 * what the renderer is doing and therefore cannot be the place Cmd+K is
	 * decided. Since issue #659 that hook's message opens the palette seeded to
	 * its conversations source (the quick switcher), while this module keeps
	 * answering the unseeded toggle: two gestures, two owners, two jobs, and no
	 * keystroke claimed twice — if this function also answered P, a single press
	 * would toggle twice and the palette would not open at all.
	 */
	assert.equal(paletteShortcutIntent(key({ metaKey: true, key: "p" })), null);
	assert.equal(paletteShortcutIntent(key({ ctrlKey: true, key: "p" })), null);
});

test("the copy and the key caps are the same spellings", () => {
	assert.equal(paletteShortcutLabel(true), "⌘K");
	assert.equal(paletteShortcutLabel(false), "Ctrl+K");
	// `KeyboardShortcut` splits prop text on `+`, so the caps keep the modifier
	// and the letter as two keys.
	assert.equal(paletteShortcutCaps(true), "⌘+K");
	assert.equal(paletteShortcutCaps(false), "Ctrl+K");
	// The switcher door's label (issue #659), for the tour's prose and any
	// future cap: spelled here so a rebinding cannot leave stale `⌘P` copy.
	assert.equal(switcherShortcutLabel(true), "⌘P");
	assert.equal(switcherShortcutLabel(false), "Ctrl+P");
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
	 * and Cmd+P the switcher's — both with jobs that are not this one — so
	 * claiming either inside the palette would silently re-bind a press the app
	 * already means something by. On the pair, refusing meta mirrors the arrows
	 * refusing ctrl.
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

test("the advertised caps are the reachable set - Ctrl+P is bound but unreachable", () => {
	const advertised = paletteReachableStepCaps();
	assert.deepEqual(advertised, ["Ctrl+N"]);
	// Reachable implies bound: every advertised cap steps.
	for (const cap of advertised)
		assert.equal(paletteStepIntent(fromCap(cap)), "next");
	/*
	 * The asymmetry, recorded where it can be seen (design round 1, D1). The
	 * binding keeps Ctrl+P — it steps wherever it arrives, and the UX/QA rigs
	 * measured that — but the footer must not advertise it: in the packaged
	 * app main's `before-input-event` owns the press (`src/main/index.ts`
	 * :3492-3500) and answers it with the `#` switcher seed rather than a move,
	 * so from a typed search it would discard the query. This case fails if
	 * Ctrl+P is re-advertised; the bound-set case above fails if it is unbound;
	 * `scripts/palette-contract.test.mjs` pins the component drawing the
	 * advertised set.
	 */
	assert.ok(paletteStepCaps().includes("Ctrl+P"));
	assert.ok(!advertised.includes("Ctrl+P"));
});
