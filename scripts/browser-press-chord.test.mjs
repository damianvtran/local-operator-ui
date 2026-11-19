import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The `press` chord grammar (src/main/browser/actions/press-chord.ts), host-free.
 * The host-level wiring (what reaches `Input.dispatchKeyEvent`, the refusals before
 * any input) is covered in `browser-host.test.mjs`; this file pins the TABLES,
 * because a wrong virtual-key code or a `text` on a shortcut is invisible to a test
 * that only checks "something was dispatched".
 */
async function moduleAt(file) {
	const result = await build({
		entryPoints: [file],
		bundle: true,
		write: false,
		platform: "node",
		format: "esm",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
	);
}
const { parsePressChord, describeRefusedKey } = await moduleAt(
	"src/main/browser/actions/press-chord.ts",
);

const CONTROL = 2;
const ALT = 1;
const META = 4;
const SHIFT = 8;

test("the eight pre-existing spellings parse to exactly what the old table sent", () => {
	// Frozen copy of the old PRESS_KEYS table: key, code, virtual key, modifiers.
	const old = {
		Tab: ["Tab", "Tab", 9, 0],
		"Shift+Tab": ["Tab", "Tab", 9, 8],
		Enter: ["Enter", "Enter", 13, 0],
		Escape: ["Escape", "Escape", 27, 0],
		ArrowUp: ["ArrowUp", "ArrowUp", 38, 0],
		ArrowDown: ["ArrowDown", "ArrowDown", 40, 0],
		ArrowLeft: ["ArrowLeft", "ArrowLeft", 37, 0],
		ArrowRight: ["ArrowRight", "ArrowRight", 39, 0],
	};
	for (const [spelling, [key, code, vk, modifiers]] of Object.entries(old)) {
		const chord = parsePressChord(spelling);
		assert.ok(chord, spelling);
		assert.equal(chord.canonical, spelling, `${spelling} echoes unchanged`);
		assert.equal(chord.key, key);
		assert.equal(chord.code, code);
		assert.equal(chord.windowsVirtualKeyCode, vk);
		assert.equal(chord.modifiers, modifiers);
	}
	// Only Enter ever carried text, as "\r" on keyDown.
	assert.equal(parsePressChord("Enter").text, "\r");
	for (const spelling of Object.keys(old).filter((k) => k !== "Enter")) {
		assert.equal(parsePressChord(spelling).text, undefined, spelling);
	}
});

test("every modifier combination sets exactly its bits and canonicalises its spelling", () => {
	const names = [
		["Shift", SHIFT],
		["Control", CONTROL],
		["Alt", ALT],
		["Meta", META],
	];
	for (let mask = 1; mask < 16; mask += 1) {
		const chosen = names.filter((_, index) => mask & (1 << index));
		const bits = chosen.reduce((sum, [, bit]) => sum + bit, 0);
		// Written in the REVERSE of canonical order, to prove order is normalised.
		const written = [...chosen.map(([name]) => name)].reverse();
		const chord = parsePressChord(`${written.join("+")}+ArrowDown`);
		assert.ok(chord, written.join("+"));
		assert.equal(chord.modifiers, bits, written.join("+"));
		assert.equal(
			chord.canonical,
			["Control", "Alt", "Shift", "Meta"]
				.filter((n) => chosen.some(([c]) => c === n))
				.concat("ArrowDown")
				.join("+"),
		);
	}
});

test("aliases and case: Ctrl and Cmd canonicalise, spellings are case-insensitive", () => {
	assert.equal(parsePressChord("Ctrl+k").canonical, "Control+k");
	assert.equal(parsePressChord("CMD+k").canonical, "Meta+k");
	assert.equal(parsePressChord("cmd+shift+Tab").canonical, "Shift+Meta+Tab");
	assert.equal(
		parsePressChord("ctrl+ALT+Delete").canonical,
		"Control+Alt+Delete",
	);
	assert.equal(parsePressChord("control+k").modifiers, CONTROL);
});

test("Control+K and Meta+K carry key 'k', the code KeyK and NO text", () => {
	for (const [spelling, bit] of [
		["Control+K", CONTROL],
		["Meta+K", META],
		["Alt+K", ALT],
	]) {
		const chord = parsePressChord(spelling);
		assert.equal(
			chord.key,
			"k",
			`${spelling}: a real Ctrl+K keydown has key k`,
		);
		assert.equal(chord.code, "KeyK");
		assert.equal(chord.windowsVirtualKeyCode, 75);
		assert.equal(chord.modifiers, bit);
		assert.equal(
			chord.text,
			undefined,
			`${spelling}: text would fire keypress`,
		);
		assert.equal(chord.unmodifiedText, undefined);
	}
	// Shift held keeps the upper case; Shift alone is not a shortcut modifier.
	assert.equal(parsePressChord("Control+Shift+k").key, "K");
	assert.equal(parsePressChord("Shift+k").key, "K");
	assert.equal(parsePressChord("Shift+k").text, "K");
});

test("a printable key with no Control/Meta/Alt sets text so keypress fires", () => {
	const e = parsePressChord("e");
	assert.deepEqual(
		[
			e.key,
			e.code,
			e.windowsVirtualKeyCode,
			e.modifiers,
			e.text,
			e.unmodifiedText,
		],
		["e", "KeyE", 69, 0, "e", "e"],
	);
	const big = parsePressChord("E");
	assert.deepEqual([big.key, big.text, big.unmodifiedText], ["E", "E", "e"]);
	const seven = parsePressChord("7");
	assert.deepEqual(
		[seven.code, seven.windowsVirtualKeyCode, seven.text],
		["Digit7", 55, "7"],
	);
	const bang = parsePressChord("!");
	assert.deepEqual(
		[bang.code, bang.windowsVirtualKeyCode, bang.text, bang.unmodifiedText],
		["Digit1", 49, "!", "1"],
	);
	const slash = parsePressChord("/");
	assert.deepEqual([slash.code, slash.windowsVirtualKeyCode], ["Slash", 191]);
	const space = parsePressChord("Space");
	assert.deepEqual([space.key, space.code, space.text], [" ", "Space", " "]);
	// Alt+Enter / Control+Space: the held modifier removes the character.
	assert.equal(parsePressChord("Control+Space").text, undefined);
	assert.equal(parsePressChord("Alt+Enter").text, undefined);
	assert.equal(parsePressChord("Shift+Enter").text, "\r");
});

test("the plus sign is a legal base, and a bare separator is not", () => {
	assert.equal(parsePressChord("+").key, "+");
	assert.equal(parsePressChord("Control++").key, "+");
	assert.equal(parsePressChord("Control++").modifiers, CONTROL);
	assert.equal(parsePressChord("Control+Shift++").canonical, "Control+Shift++");
	for (const bad of ["++", "+Control", "Control+", "Control+Shift+", "+a"]) {
		assert.equal(parsePressChord(bad), null, bad);
	}
});

test("every named key in the closed table parses, with the DOM key and a real virtual key", () => {
	const named = {
		Enter: 13,
		Escape: 27,
		Tab: 9,
		Backspace: 8,
		Delete: 46,
		Space: 32,
		ArrowUp: 38,
		ArrowDown: 40,
		ArrowLeft: 37,
		ArrowRight: 39,
		Home: 36,
		End: 35,
		PageUp: 33,
		PageDown: 34,
	};
	for (let n = 1; n <= 12; n += 1) named[`F${n}`] = 111 + n;
	for (const [name, vk] of Object.entries(named)) {
		const chord = parsePressChord(name);
		assert.ok(chord, name);
		assert.equal(chord.windowsVirtualKeyCode, vk, name);
		assert.equal(chord.key, name === "Space" ? " " : name);
	}
	assert.equal(Object.keys(named).length, 26);
});

test("refusals: anything outside the closed grammar parses to null", () => {
	const refused = [
		undefined,
		null,
		9,
		{},
		[],
		true,
		"",
		// not named keys / wrong case for a NAME (names are exact)
		"tab",
		"enter",
		"escape",
		"esc",
		"Return",
		"Shift",
		"Control",
		"Meta",
		"Alt",
		"F0",
		"F13",
		"f1",
		"Arrow",
		"ArrowUpp",
		"Del",
		"PgUp",
		// multi-character strings that are not a named key: no credentials, no words
		"ab",
		"hello",
		"hunter2-hunter2",
		"a b",
		"e ",
		" e",
		"ee",
		// bad modifiers
		"Super+k",
		"Win+k",
		"Hyper+k",
		"Shift+Shift+k",
		"Ctrl+Control+k",
		"Cmd+Meta+k",
		"Ctrl+Nope",
		"Control+Tab+k",
		"Control+Shift",
		"Shift+",
		// non-ASCII, control characters, empty pieces
		"é",
		"Control+é",
		"\n",
		"Control+\t",
		"k\u0000",
		"Control+ ",
		// CDP-field smuggling
		"Control+k;text=boom",
		"__proto__",
		"constructor",
		"toString",
	];
	for (const input of refused) {
		assert.equal(parsePressChord(input), null, JSON.stringify(input));
	}
	assert.equal(parsePressChord("x".repeat(500)), null);
	assert.equal(parsePressChord(`Control+${"x".repeat(60)}`), null);
});

test("a refusal echoes a bounded value, never a credential-sized one", () => {
	assert.equal(describeRefusedKey("tab"), "tab");
	const echoed = describeRefusedKey("hunter2".repeat(20));
	assert.ok(echoed.length <= 27, echoed);
	assert.equal(describeRefusedKey(undefined), "undefined");
});

test("no caller text reaches the result: only table values are emitted", () => {
	for (const input of [
		"Control+k",
		"Shift+Tab",
		"e",
		"Alt+F4",
		"Meta+Shift+ArrowLeft",
	]) {
		const chord = parsePressChord(input);
		assert.deepEqual(
			Object.keys(chord)
				.sort()
				.filter((k) => !["unmodifiedText", "text"].includes(k)),
			["canonical", "code", "key", "modifiers", "windowsVirtualKeyCode"],
		);
	}
});
