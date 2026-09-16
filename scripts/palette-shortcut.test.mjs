import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The palette's keyboard door, as a decision. Pure, so the rules that matter —
 * which keys toggle it, and which keystrokes belong to a surface that got there
 * first — are pinned here rather than inferred from a listener.
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
const { paletteShortcutCaps, paletteShortcutIntent, paletteShortcutLabel } =
	module;

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
	assert.equal(paletteShortcutIntent(key({ metaKey: true, key: "K" })), "toggle");
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
	assert.equal(paletteShortcutIntent(key({ metaKey: true, shiftKey: true })), null);
	assert.equal(paletteShortcutIntent(key({ metaKey: true, altKey: true })), null);
	assert.equal(paletteShortcutIntent(key({ metaKey: true, repeat: true })), null);
});

test("Cmd+P is not this module's gesture", () => {
	/*
	 * Deliberately not adopted. Cmd/Ctrl+P is the gesture this palette shipped
	 * with, and the people who learned it from the app's own tour still have it —
	 * it is answered by the main process's own hook, which knows nothing about
	 * what the renderer is doing and therefore cannot be the place Cmd+K is
	 * decided. Two gestures, two owners, and no keystroke claimed twice: if this
	 * function also answered P, a single press would toggle twice and the palette
	 * would not open at all.
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
});
