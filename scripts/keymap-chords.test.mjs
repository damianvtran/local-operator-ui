/**
 * The chord grammar, the event match, the display and the refusal table (#928).
 *
 *     node --test scripts/keymap-chords.test.mjs
 *
 * WHY THIS FILE EXISTS. A user-assignable chord is stored, matched and printed
 * as ONE canonical string, and the three readers of that string — the settings
 * recorder, the dispatcher, the rail's caps — have to agree about it or a user
 * binds a chord that prints one way and answers another. The pieces are pure
 * (`keymap-chord.ts`, `chord-capture.ts`), so this file presses the same shapes
 * the components pass: literal events, never a re-statement of the rule. The
 * display cases are pinned AGAINST `formatQuickSendDisplay`, because the whole
 * point of importing the mini view's tables is that the two spellings cannot
 * drift.
 *
 * It bundles from source with esbuild, the `new-chat-shortcut.test.mjs` idiom.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: `
			export {
				buildChordMap,
				captureRefusal,
				chordCaps,
				chordGlyph,
				chordTokens,
				effectiveChord,
				normalizeChord,
				sanitizeShortcutBindings,
			} from "./src/renderer/src/shared/keymap/keymap-chord";
			export {
				KEYMAP_ACTIONS,
				LEGACY_BROWSER_CHORDS,
				RESERVED_CHORDS,
			} from "./src/renderer/src/shared/keymap/keymap-registry";
			export { chordFromEvent } from "./src/renderer/src/shared/keymap/chord-capture";
			export { formatQuickSendDisplay } from "./src/shared/mini-view";
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
const bundlePath = new URL("./_keymap-chords.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	buildChordMap,
	captureRefusal,
	chordCaps,
	chordGlyph,
	chordTokens,
	effectiveChord,
	formatQuickSendDisplay,
	LEGACY_BROWSER_CHORDS,
	normalizeChord,
	RESERVED_CHORDS,
	chordFromEvent,
	sanitizeShortcutBindings,
} = await import(bundlePath.href);
await unlink(bundlePath);

test("normalizeChord: aliases, order, dedupe, validation", () => {
	// The canonical spelling round-trips untouched.
	assert.equal(normalizeChord("primary+j"), "primary+j");
	assert.equal(normalizeChord("primary+shift+c"), "primary+shift+c");
	// Case-insensitive, and the aliases collapse to `primary` (meta || ctrl,
	// the judgement every predicate in the app already makes).
	assert.equal(normalizeChord("PRIMARY+SHIFT+C"), "primary+shift+c");
	assert.equal(normalizeChord("meta+j"), "primary+j");
	assert.equal(normalizeChord("cmd+j"), "primary+j");
	assert.equal(normalizeChord("command+j"), "primary+j");
	assert.equal(normalizeChord("super+j"), "primary+j");
	assert.equal(normalizeChord("ctrl+j"), "primary+j");
	// Modifiers order and dedupe.
	assert.equal(normalizeChord("shift+primary+j"), "primary+shift+j");
	assert.equal(normalizeChord("alt+primary+j"), "primary+alt+j");
	assert.equal(normalizeChord("primary+meta+j"), "primary+j");
	// Named keys, and the layout spellings that produce them.
	assert.equal(normalizeChord("primary+shift+space"), "primary+shift+space");
	assert.equal(normalizeChord("primary+alt+ArrowDown"), null);
	// A key without a modifier still PARSES (bindability is captureRefusal's
	// question, not the grammar's).
	assert.equal(normalizeChord("j"), "j");
	// Refusals: two keys, no key, unknown tokens, multi-character keys,
	// punctuation (unrepresentable by construction).
	assert.equal(normalizeChord("j+k"), null);
	assert.equal(normalizeChord("primary"), null);
	assert.equal(normalizeChord("primary+f13"), null);
	assert.equal(normalizeChord("primary+12"), null);
	assert.equal(normalizeChord("primary+é"), null);
	assert.equal(normalizeChord("primary+/"), null);
	assert.equal(normalizeChord("primary+escape"), null);
	assert.equal(normalizeChord(""), null);
	assert.equal(normalizeChord("   "), null);
	assert.equal(normalizeChord(undefined), null);
	assert.equal(normalizeChord(42), null);
});

test("chordFromEvent: the event shapes the recorder and dispatcher pass", () => {
	const press = (overrides = {}) => ({
		key: "j",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...overrides,
	});
	// meta and ctrl are the same chord (the app modifier).
	assert.equal(chordFromEvent(press({ metaKey: true })), "primary+j");
	assert.equal(chordFromEvent(press({ ctrlKey: true })), "primary+j");
	// Exact modifier set, ordered canonically whatever the order of flags.
	assert.equal(
		chordFromEvent(press({ metaKey: true, shiftKey: true, key: "C" })),
		"primary+shift+c",
	);
	assert.equal(
		chordFromEvent(press({ ctrlKey: true, altKey: true })),
		"primary+alt+j",
	);
	// Named keys and space.
	assert.equal(
		chordFromEvent(press({ key: "ArrowDown", metaKey: true })),
		"primary+down",
	);
	assert.equal(
		chordFromEvent(press({ key: " ", metaKey: true, ctrlKey: true })),
		"primary+space",
	);
	// A letter with no modifier spells a bindable-looking chord; the refusal is
	// captureRefusal's sentence, not the event layer's.
	assert.equal(chordFromEvent(press()), "j");
	// Refusals: modifier-only, IME, and keys the grammar cannot name.
	assert.equal(chordFromEvent(press({ key: "Meta" })), null);
	assert.equal(chordFromEvent(press({ key: "Shift" })), null);
	assert.equal(
		chordFromEvent(press({ metaKey: true, isComposing: true })),
		null,
	);
	assert.equal(chordFromEvent(press({ key: "F13", metaKey: true })), null);
	assert.equal(chordFromEvent(press({ key: "Enter", metaKey: true })), null);
	assert.equal(chordFromEvent(press({ key: "Escape" })), null);
	assert.equal(
		chordFromEvent(
			press({ key: "®", code: "KeyR", altKey: true, metaKey: true }),
		),
		"primary+alt+r",
	);
	assert.equal(
		chordFromEvent(press({ key: "q", code: "KeyA", metaKey: true })),
		"primary+q",
		"no-Alt AZERTY keeps event.key rather than the physical US letter",
	);
});

test("display: glyph, caps and tokens match the mini view's own tables", () => {
	// The parity that matters: these are the same function, so a second copy of
	// the tables would be the only way to drift.
	for (const platform of ["mac", "win", "linux"]) {
		for (const chord of [
			"primary+shift+c",
			"primary+j",
			"primary+alt+shift+space",
			"primary+alt+down",
		]) {
			assert.equal(
				chordGlyph(chord, platform),
				formatQuickSendDisplay(chord, platform),
			);
		}
	}
	// The canvas default prints exactly what the retired `canvasToggleCap` did.
	assert.equal(chordGlyph("primary+shift+c", "mac"), "⌘⇧C");
	assert.equal(chordGlyph("primary+shift+c", "win"), "Ctrl+Shift+C");
	assert.equal(chordGlyph("primary+j", "mac"), "⌘J");
	// Caps join the tokens with "+" (the `paletteDoorCaps` shape — the
	// KeyboardShortcut component splits on it).
	assert.equal(chordCaps("primary+shift+c", "mac"), "⌘+⇧+C");
	assert.equal(
		chordTokens("primary+shift+c", "linux").join("+"),
		"Ctrl+Shift+C",
	);
});

test("captureRefusal: the four sentences, in precedence order", () => {
	assert.equal(
		captureRefusal(null, "panel.console", {}),
		"That key cannot be bound.",
	);
	assert.equal(
		captureRefusal("f13", "panel.console", {}),
		"That key cannot be bound.",
	);
	/*
	 * The needs-a-modifier sentence follows the reading machine (U5): the default
	 * is the same `linux` fallback `rendererPlatform()` documents, and macOS
	 * keeps both spellings because `primary` collapses `meta` AND `ctrl` there.
	 */
	assert.equal(
		captureRefusal("j", "panel.console", {}),
		"A shortcut needs Ctrl.",
	);
	assert.equal(
		captureRefusal("j", "panel.console", {}, "mac"),
		"A shortcut needs ⌘ or Ctrl.",
	);
	// Reserved matching is canonical-form matching: the alias spelling refuses
	// with the same sentence the stored form does.
	const reserved = RESERVED_CHORDS.get("primary+k");
	assert.ok(reserved, "primary+k must be a reserved chord");
	assert.equal(captureRefusal("cmd+k", "panel.console", {}), reserved);
	assert.equal(captureRefusal("META+K", "panel.console", {}), reserved);
	// Brief a1-8: a chord the browser surface swallows is refused at capture, so
	// Settings never accepts a binding that would be silently dead in the browser.
	for (const chord of [
		"primary+t",
		"primary+shift+t",
		"primary+l",
		"primary+r",
		"primary+shift+r",
		"primary+1",
		"primary+5",
		"primary+9",
		"cmd+t",
	]) {
		const refusal = captureRefusal(chord, "panel.console", {});
		assert.match(refusal ?? "", /^Reserved: .*browser.*\.$/, chord);
	}
	assert.match(
		RESERVED_CHORDS.get("primary+w") ?? "",
		/browser tab/,
		"primary+w no longer claims it only closes the window",
	);
	// A chord another action answers is refused BY NAME, against the other
	// action's EFFECTIVE chord — a default counts as taken.
	assert.equal(
		captureRefusal("primary+shift+c", "panel.console", {}),
		"Already assigned to Open canvas.",
	);
	assert.equal(
		captureRefusal("primary+j", "panel.canvas", {}),
		"Already assigned to Open console.",
	);
	// ...and only for OTHER actions: re-pressing the row's own chord is not a
	// conflict.
	assert.equal(captureRefusal("primary+j", "panel.console", {}), null);
	// ...and a CLEARED action claims nothing (U4): its default is free.
	assert.equal(
		captureRefusal("primary+j", "panel.browser", { "panel.console": null }),
		null,
	);
	/*
	 * The review round's four newly-reserved chords (F1 = Q1): the canvas
	 * editors listen on `window` (the router's document listener runs first in
	 * the bubble phase) and the pin-move returns skip `preventDefault`, so each
	 * is refused with the sentence naming its job.
	 */
	for (const [chord, sentence] of [
		["primary+s", "Reserved: saves the canvas document."],
		["primary+o", "Reserved: opens a file in the canvas."],
		["meta+shift+up", "Reserved: moves the focused chat up the pinned order."],
		[
			"ctrl+shift+down",
			"Reserved: moves the focused chat down the pinned order.",
		],
	]) {
		assert.equal(captureRefusal(chord, "panel.console", {}), sentence, chord);
	}
	// An override redirects the refusal to whoever now holds the chord (bindings
	// are canonical by the time anything reads them: the write boundary and the
	// hydrating sanitizer are `setShortcutBinding`/`sanitizeShortcutBindings`).
	assert.equal(
		captureRefusal("primary+i", "panel.console", {
			"panel.browser": "primary+i",
		}),
		"Already assigned to Open browser.",
	);
	assert.equal(
		captureRefusal(
			"primary+shift+s",
			"panel.console",
			{},
			"linux",
			new Map([
				["primary+shift+s", "Start recording already uses this chord."],
			]),
		),
		"Start recording already uses this chord.",
	);
});

test("effectiveChord and buildChordMap: override ?? default, first claim wins", () => {
	assert.equal(effectiveChord("panel.console", {}), "primary+j");
	assert.equal(effectiveChord("panel.browser", {}), null);
	assert.equal(
		effectiveChord("panel.browser", { "panel.browser": "primary+i" }),
		"primary+i",
	);
	/*
	 * The explicit no-chord state (U4): a stored `null` answers "nothing", where
	 * absence falls back to the default — the two are different states, and only
	 * the delete-absence arm means "unchanged from the default".
	 */
	assert.equal(
		effectiveChord("panel.console", { "panel.console": null }),
		null,
	);
	const map = buildChordMap({
		"panel.browser": "primary+i",
		"panel.console": "primary+j",
	});
	assert.equal(map.get("primary+i"), "panel.browser");
	assert.equal(map.get("primary+j"), "panel.console");
	assert.equal(map.get("primary+shift+c"), "panel.canvas");
	assert.equal(map.size, 3);
	// A cleared action drops out of the map entirely, and its default is freed
	// for another row to answer instead — which is the point of clearing.
	const cleared = buildChordMap({ "panel.console": null });
	assert.equal(cleared.get("primary+j"), undefined);
	assert.equal(cleared.get("primary+shift+c"), "panel.canvas");
	assert.equal(cleared.size, 1);
	const freed = buildChordMap({
		"panel.console": null,
		"panel.browser": "primary+j",
	});
	assert.equal(freed.get("primary+j"), "panel.browser");
});

test("sanitizeShortcutBindings: junk, unknown ids, reserved chords, duplicates", () => {
	assert.deepEqual(sanitizeShortcutBindings(undefined), {});
	assert.deepEqual(sanitizeShortcutBindings("junk"), {});
	assert.deepEqual(sanitizeShortcutBindings([]), {});
	// A valid override survives, canonicalised.
	assert.deepEqual(sanitizeShortcutBindings({ "panel.browser": "meta+I" }), {
		"panel.browser": "primary+i",
	});
	// Unknown ids are dropped by construction (the loop is the registry).
	assert.deepEqual(
		sanitizeShortcutBindings({ "panel.nope": "primary+i", nope: "primary+j" }),
		{},
	);
	// Unparseable, reserved, and primary-less entries are all dropped.
	assert.deepEqual(
		sanitizeShortcutBindings({
			"panel.browser": "f13",
			"panel.run": "primary+k",
			"panel.ask": "j",
		}),
		{},
	);
	/*
	 * Duplicates keep the FIRST action in registry order; the later one falls
	 * back to its default (its own default chord still claims, so nothing below
	 * it can take it either).
	 */
	assert.deepEqual(
		sanitizeShortcutBindings({
			"panel.canvas": "primary+i",
			"panel.browser": "primary+i",
		}),
		{ "panel.canvas": "primary+i" },
	);
	assert.deepEqual(
		sanitizeShortcutBindings({
			"panel.browser": "primary+shift+c",
			"panel.run": "primary+j",
		}),
		{},
		"an override equal to another action's DEFAULT is a duplicate too",
	);
	// Non-string values are dropped like junk.
	assert.deepEqual(sanitizeShortcutBindings({ "panel.browser": 7 }), {});
	/*
	 * The explicit no-chord state survives the boundary (U4) — for known ids
	 * only — and it claims nothing, which is what frees a cleared action's
	 * default for another row.
	 */
	assert.deepEqual(sanitizeShortcutBindings({ "panel.console": null }), {
		"panel.console": null,
	});
	assert.deepEqual(sanitizeShortcutBindings({ "panel.nope": null }), {});
	assert.deepEqual(
		sanitizeShortcutBindings({
			"panel.console": null,
			"panel.browser": "primary+j",
		}),
		{ "panel.console": null, "panel.browser": "primary+j" },
	);
});

// R15: persistence must keep downgrade data without arming browser-owned chords.
test("all fifteen legacy browser mappings survive dormant, never dispatch, and remain refused", () => {
	assert.equal(LEGACY_BROWSER_CHORDS.size, 15);
	assert.deepEqual(
		[...LEGACY_BROWSER_CHORDS],
		[
			"primary+0",
			"primary+r",
			"primary+shift+r",
			"primary+t",
			"primary+shift+t",
			"primary+l",
			...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => `primary+${digit}`),
		],
	);
	for (const chord of LEGACY_BROWSER_CHORDS) {
		const bindings = sanitizeShortcutBindings({ "panel.console": chord });
		assert.equal(bindings["panel.console"], chord);
		assert.equal(effectiveChord("panel.console", bindings), "primary+j");
		assert.equal(buildChordMap(bindings).has(chord), false);
		assert.ok(captureRefusal(chord, "panel.console", bindings));
		const unbound = sanitizeShortcutBindings({ "panel.run": chord });
		assert.equal(unbound["panel.run"], chord);
		assert.equal(effectiveChord("panel.run", unbound), null);
		assert.equal(buildChordMap(unbound).has(chord), false);
		assert.equal(
			chordCaps(effectiveChord("panel.console", bindings), "mac"),
			chordCaps("primary+j", "mac"),
		);
	}
	assert.deepEqual(
		sanitizeShortcutBindings({
			"panel.console": "primary+t",
			"panel.canvas": "primary+j",
			"panel.run": "primary+shift+u",
			"panel.ask": null,
		}),
		{
			"panel.console": "primary+t",
			"panel.run": "primary+shift+u",
			"panel.ask": null,
		},
	);
	assert.deepEqual(
		sanitizeShortcutBindings({
			"panel.console": "primary+p",
			"panel.canvas": "garbage",
			"panel.run": "alt+t",
		}),
		{},
	);
});
