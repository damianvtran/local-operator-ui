#!/usr/bin/env node
/** Audit the ACTUAL native menu receipt beside the shipped registry and browser
 * classifier. A same-chord multi-door alias is legal only when named below;
 * unexpected overlaps fail rather than hiding behind headless OS-input limits.
 * Usage: node scripts/check-browser-chord-collisions.mjs <native-results.json>
 * The input is the synthetic native proof's `menu actual` row, not a live profile.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

async function load(path) {
	const output = await build({
		entryPoints: [path],
		bundle: true,
		write: false,
		platform: "node",
		format: "esm",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
	);
}
const { KEYMAP_ACTIONS, RESERVED_CHORDS } = await load(
	"src/renderer/src/shared/keymap/keymap-registry.ts",
);
const { browserChordIntent } = await load("src/shared/browser-chord.ts");
const file = process.argv[2];
assert(
	file,
	"Supply the actual native menu JSON receipt; absent menu evidence is not a pass.",
);
const rows = JSON.parse(readFileSync(file, "utf8"));
const menus = rows.find((row) => row.name === "menu actual")?.actual.menus;
assert(
	Array.isArray(menus) && menus.length,
	"No actual menu enumeration in receipt.",
);
const aliases = new Map([
	["primary+r", "reload: menu/main/DOM are focus-scoped doors"],
	["primary+shift+r", "hard-reload: menu/main/DOM are focus-scoped doors"],
	["primary+w", "close: browser tab vs existing app window, by focus"],
	["primary+[", "history: browser page vs chat route, by focus"],
	["primary+]", "history: browser page vs chat route, by focus"],
	// Existing native menu editing aliases are the same app operation, not a
	// browser interception. Two platform Quit menu entries also share one owner.
	["primary+q", "existing app quit (platform/menu aliases)"],
	["primary+z", "existing native undo"],
	["primary+shift+z", "existing native redo"],
	["primary+x", "existing native cut"],
	["primary+c", "existing native copy"],
	["primary+v", "existing native paste"],
	["primary+a", "existing native select all"],
	["primary+m", "existing native minimize"],
	// Frozen a1 explicitly leaves the historical Actual Size/Cmd+O conflict
	// unchanged for a2. It is recorded, NOT silently called a fixed collision.
	[
		"primary+o",
		"PRE-EXISTING: app Actual Size vs canvas open; a2, not fixed by a1",
	],
]);
function canonical(value) {
	const bits = value
		.toLowerCase()
		.split("+")
		.map((bit) => {
			if (["commandorcontrol", "cmdorctrl", "command", "meta"].includes(bit))
				return "primary";
			if (bit === "ctrl") return "control";
			return bit;
		});
	const key = bits.pop();
	return [...bits.sort(), key].join("+");
}
const owners = new Map();
function add(chord, owner) {
	const key = canonical(chord);
	owners.set(key, [...(owners.get(key) ?? []), owner]);
}
// A reserved row whose sentence names the browser DOCUMENTS the browser chord
// (brief a1-8) rather than being a second owner; it is checked below instead of
// being counted as a collision with the chord it describes.
const documentedByReserved = new Set();
for (const [chord, reason] of RESERVED_CHORDS) {
	if (/browser/.test(reason) && !/chats|window/.test(reason)) {
		documentedByReserved.add(chord);
		continue;
	}
	add(chord, `reserved: ${reason}`);
}
for (const action of KEYMAP_ACTIONS)
	if (action.defaultChord) add(action.defaultChord, `default: ${action.id}`);
for (const item of menus) {
	assert(
		!["reload", "forcereload", "close"].includes(item.role?.toLowerCase()),
		"Unconditional browser-colliding menu role remains.",
	);
	add(item.accelerator, `menu: ${item.id || item.role || "existing app zoom"}`);
}
for (const key of [
	"r",
	"R",
	"l",
	"t",
	"T",
	"w",
	"[",
	"]",
	"{",
	"}",
	..."123456789",
]) {
	const shift = ["R", "T", "{", "}"].includes(key);
	const intent = browserChordIntent(
		{ type: "keyDown", key, meta: true, control: false, alt: false, shift },
		"darwin",
	);
	if (intent)
		add(
			`primary+${shift ? "shift+" : ""}${key === "{" ? "[" : key === "}" ? "]" : key.toLowerCase()}`,
			`browser: ${intent} (main/DOM)`,
		);
}
for (const shift of [false, true]) {
	const intent = browserChordIntent(
		{
			type: "keyDown",
			key: "Tab",
			meta: false,
			control: true,
			alt: false,
			shift,
		},
		"darwin",
	);
	assert(intent);
	add(`control+${shift ? "shift+" : ""}tab`, `browser: ${intent}`);
}
// Every fixed browser chord that Settings could otherwise capture must be
// reserved; the digits and letters are checked against the real registry.
for (const [chord, entries] of owners) {
	// Only a chord Settings can CAPTURE needs a row: punctuation (`[`, `]`) and
	// `tab` are unrepresentable in the chord grammar, so a user can never bind them
	// and a reserved row would document nothing.
	const capturable = /^(primary\+)(shift\+)?[a-z0-9]$/.test(chord);
	const browserOnly =
		capturable &&
		entries.every((entry) => entry.startsWith("browser:")) &&
		!chord.startsWith("control+");
	assert(
		!browserOnly || documentedByReserved.has(chord),
		`Browser chord ${chord} has no RESERVED_CHORDS row; Settings would accept a dead binding.`,
	);
}
let unexpected = 0;
for (const [chord, entries] of owners) {
	const reason = aliases.get(chord);
	if (entries.length > 1 && !reason) unexpected++;
	console.log(
		JSON.stringify({
			chord,
			owners: entries,
			disposition:
				entries.length < 2
					? "single owner"
					: (reason ?? "UNEXPECTED COLLISION"),
		}),
	);
}
assert.equal(unexpected, 0, "Unexpected shortcut collisions");
console.log(
	"PASS: actual native menu + reserved/default registry + per-view classifier; known aliases explicit; Actual Size conflict remains documented, not fixed",
);
