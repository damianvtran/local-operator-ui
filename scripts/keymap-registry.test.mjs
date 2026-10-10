/**
 * The action registry and the reserved set (#928).
 *
 *     node --test scripts/keymap-registry.test.mjs
 *
 * WHY THIS FILE EXISTS. The registry is the single place an action's id, its
 * sentence and its default chord are declared, and both halves are silent
 * contracts: the id is the key a user's override is persisted under (a rename
 * orphans it), and the default is a chord the app promises to answer (a typo
 * ships a dead promise). The reserved set is the other side of the same
 * contract — every entry is a chord capture refuses, so a missing entry arms a
 * double-fire and an unneeded entry takes a binding away for no reason.
 *
 * WHAT IS DELIBERATELY PINNED AS LITERALS. The canvas default is compared to
 * the exact string the retired `canvasToggleCap` printed — this suite is where
 * that output's parity lives now that the module is gone — and the reserved
 * list is pinned in full, so widening or narrowing it is a reviewed edit rather
 * than a drift.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: `
			export { KEYMAP_ACTIONS, RESERVED_CHORDS } from "./src/renderer/src/shared/keymap/keymap-registry";
			export { chordGlyph, effectiveChord, normalizeChord } from "./src/renderer/src/shared/keymap/keymap-chord";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL("./_keymap-registry.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	KEYMAP_ACTIONS,
	RESERVED_CHORDS,
	chordGlyph,
	effectiveChord,
	normalizeChord,
} = await import(bundlePath.href);
await unlink(bundlePath);

test("the six ids are stable and unique, in registry order", () => {
	assert.deepEqual(
		KEYMAP_ACTIONS.map((action) => action.id),
		[
			"panel.console",
			"panel.canvas",
			"panel.run",
			"panel.ask",
			"panel.browser",
			"panel.code",
		],
	);
	assert.equal(
		new Set(KEYMAP_ACTIONS.map((a) => a.id)).size,
		KEYMAP_ACTIONS.length,
	);
	for (const action of KEYMAP_ACTIONS) {
		assert.equal(action.scope, "app");
		assert.equal(action.category, "Panels");
		assert.match(action.label, /^Open [a-z]/, "labels are sentence-case verbs");
	}
});

test("every default parses, is unique, and is not reserved", () => {
	const chords = [];
	for (const action of KEYMAP_ACTIONS) {
		if (action.defaultChord === null) continue;
		assert.equal(
			normalizeChord(action.defaultChord),
			action.defaultChord,
			`${action.id}'s default must be in canonical form`,
		);
		assert.ok(
			!RESERVED_CHORDS.has(action.defaultChord),
			`${action.id}'s default must not be reserved`,
		);
		chords.push(action.defaultChord);
	}
	assert.equal(
		new Set(chords).size,
		chords.length,
		"defaults must not collide",
	);
});

test("the shipped defaults are the decided ones", () => {
	assert.equal(effectiveChord("panel.console", undefined), "primary+j");
	assert.equal(effectiveChord("panel.canvas", undefined), "primary+shift+c");
	for (const id of ["panel.run", "panel.ask", "panel.browser", "panel.code"]) {
		assert.equal(effectiveChord(id, undefined), null, `${id} ships unbound`);
	}
	/*
	 * THE CANVAS PARITY, pinned as literals: these are the exact strings the
	 * retired `canvasToggleCap(isMac)` printed, so the chord the control shipped
	 * printing is still the chord the registry derives — one spelling, now from
	 * the canonical string rather than a hand-kept constant.
	 */
	assert.equal(chordGlyph("primary+shift+c", "mac"), "⌘⇧C");
	assert.equal(chordGlyph("primary+shift+c", "win"), "Ctrl+Shift+C");
	assert.equal(chordGlyph("primary+shift+c", "linux"), "Ctrl+Shift+C");
});

test("every reserved entry is canonical, stated in the app's voice, and explained", () => {
	for (const [chord, sentence] of RESERVED_CHORDS) {
		const normalized = normalizeChord(chord);
		if (normalized === null) {
			/*
			 * PUNCTUATION IS UNREPRESENTABLE BY CONSTRUCTION (§1), and the list
			 * still documents the app's inventory: `⌘[`/`⌘]` are the navigation
			 * gestures (the same scan that produced the rest of the list finds
			 * them), and they can never be a capture candidate — a press of `[`
			 * is refused upstream as "not a key you can bind". The regex here
			 * keeps a TYPO in an unrepresentable entry from riding the same
			 * branch silently.
			 */
			assert.match(
				chord,
				/^primary\+[\[\]]$/,
				`unrepresentable reserved entry "${chord}" is not the punctuation class`,
			);
		} else {
			assert.equal(
				normalized,
				chord,
				`reserved entry "${chord}" must be a canonical chord`,
			);
		}
		assert.match(
			sentence,
			/^Reserved: .+\.$/,
			`"${chord}" must carry a full sentence naming the job`,
		);
	}
	for (const action of KEYMAP_ACTIONS) {
		const chord = action.defaultChord;
		if (chord === null) continue;
		assert.ok(!RESERVED_CHORDS.has(chord));
	}
});

test("the reserved inventory is exactly the decoded list", () => {
	/*
	 * The RFC's reserved set, verbatim: the main process's three doors, the
	 * renderer chords that fire app-wide, the native text-editing chords a
	 * focused field must keep, and the application menu's own. Pinned in full so
	 * a lane that adds a fixed chord to the tree is TOLD to add it here (the
	 * rule `keymap-registry.ts` states), and so an accidental deletion of an
	 * entry fails this file rather than arming a double-fire in the field.
	 */
	const expected = [
		"primary+alt+down",
		"primary+alt+up",
		"primary+b",
		"primary+c",
		"primary+f",
		"primary+k",
		"primary+m",
		"primary+n",
		"primary+p",
		"primary+q",
		"primary+shift+a",
		"primary+shift+p",
		"primary+shift+s",
		"primary+shift+z",
		"primary+v",
		"primary+w",
		"primary+x",
		"primary+y",
		"primary+z",
		"primary+[",
		"primary+]",
		"primary+a",
	];
	assert.deepEqual([...RESERVED_CHORDS.keys()].sort(), expected.sort());
	assert.equal(RESERVED_CHORDS.size, expected.length);
});
