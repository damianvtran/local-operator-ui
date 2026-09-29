import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The navigation gestures, as decisions (issue #675). Two modules, one feature:
 * the renderer half answers the app's router and the main-process half answers
 * a driven browser view's own history. They are separate spellings because the
 * two processes cannot share a module (the main bundle does not import the
 * renderer's `@shared` tree), so this file is where the two are held to the
 * same rules: Cmd/Ctrl accepted on both platforms' muscle memory, shift/alt
 * refused so the chord is exactly the two keys the conventions name, repeat
 * refused so holding it does not walk the stack, and the mouse buttons mapped
 * by the DOM's own numbers.
 */
const bundle = await build({
	stdin: {
		contents:
			'export * as app from "./src/renderer/src/shared/navigation-gesture";' +
			'export * as pane from "./src/main/browser/navigation-chord";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { app, pane } = mod;

/** A keystroke, with everything unset unless the test asks for it. */
const key = (overrides = {}) => ({
	key: "[",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	defaultPrevented: false,
	repeat: false,
	...overrides,
});

/** A mouse press, defaulting to the back button. */
const mouse = (overrides = {}) => ({
	button: 3,
	defaultPrevented: false,
	...overrides,
});

/** An Electron input object, defaulting to a bare Cmd+[ press. */
const input = (overrides = {}) => ({
	type: "keyDown",
	key: "[",
	isAutoRepeat: false,
	shift: false,
	control: false,
	alt: false,
	meta: true,
	...overrides,
});

test("Cmd/Ctrl+[ is back and Cmd/Ctrl+] is forward, on both modifiers", () => {
	assert.equal(app.navigationChordDirection(key({ metaKey: true })), "back");
	assert.equal(app.navigationChordDirection(key({ ctrlKey: true })), "back");
	assert.equal(
		app.navigationChordDirection(key({ metaKey: true, key: "]" })),
		"forward",
	);
	assert.equal(
		app.navigationChordDirection(key({ ctrlKey: true, key: "]" })),
		"forward",
	);
});

test("the chord refuses what the palette's chord refuses, for the same reasons", () => {
	// No modifier: a bare bracket types a bracket.
	assert.equal(app.navigationChordDirection(key({})), null);
	// The extended chords belong to surfaces and platforms, not to us.
	assert.equal(
		app.navigationChordDirection(key({ metaKey: true, shiftKey: true })),
		null,
	);
	assert.equal(
		app.navigationChordDirection(key({ metaKey: true, altKey: true })),
		null,
	);
	// Holding the chord must not strobe the history stack.
	assert.equal(
		app.navigationChordDirection(key({ metaKey: true, repeat: true })),
		null,
	);
	// The ordering rule: a surface that got here first is saying "mine" — the
	// run-details reader's step-back-out and any editor's own Mod-[.
	assert.equal(
		app.navigationChordDirection(
			key({ metaKey: true, defaultPrevented: true }),
		),
		null,
	);
	// Other keys, including the palette's, are not ours.
	assert.equal(
		app.navigationChordDirection(key({ metaKey: true, key: "k" })),
		null,
	);
});

test("the mouse's back and forward buttons are 3 and 4, and nothing else moves", () => {
	assert.equal(app.navigationMouseDirection(mouse({})), "back");
	assert.equal(app.navigationMouseDirection(mouse({ button: 4 })), "forward");
	// Left, middle and right stay the page's.
	for (const button of [0, 1, 2, 5]) {
		assert.equal(app.navigationMouseDirection(mouse({ button })), null);
	}
	assert.equal(
		app.navigationMouseDirection(mouse({ defaultPrevented: true })),
		null,
	);
});

test("the pane's chord matches the app's: Cmd/Ctrl, brackets, presses only", () => {
	assert.equal(pane.paneNavigationDirection(input({})), "back");
	assert.equal(pane.paneNavigationDirection(input({ key: "]" })), "forward");
	assert.equal(
		pane.paneNavigationDirection(input({ meta: false, control: true })),
		"back",
	);
});

test("the pane's chord refuses the same extensions, and both edges", () => {
	// `before-input-event` fires on keyUp too; the release is not a second move.
	assert.equal(pane.paneNavigationDirection(input({ type: "keyUp" })), null);
	assert.equal(
		pane.paneNavigationDirection(input({ isAutoRepeat: true })),
		null,
	);
	assert.equal(pane.paneNavigationDirection(input({ shift: true })), null);
	assert.equal(pane.paneNavigationDirection(input({ alt: true })), null);
	assert.equal(
		pane.paneNavigationDirection(input({ meta: false, control: false })),
		null,
	);
	assert.equal(pane.paneNavigationDirection(input({ key: "k" })), null);
});
