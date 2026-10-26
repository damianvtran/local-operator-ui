/**
 * The native suggestion child's row builder, in a DOM.
 *
 * WHY THIS EXISTS: the child is its own document, so a row's text direction is
 * its own question. `dir="auto"` takes the paragraph direction from the first
 * strong character; an Urdu sentence around an address with no Latin letter
 * (`192.168.1.1/`, `[::1]:3000/`) therefore resolves RTL and the unisolated
 * value reorders (`192.168.1.1/` painted as `/192.168.1.1`). The renderer names
 * the value's span (`isolate`) and the child wraps it in `<bdi dir="ltr">`. This
 * drives the SHIPPED child script in jsdom: it proves the structure and that the
 * visible text is unchanged; the reordering itself is a layout fact that only the
 * built-app frame (`scripts/browser-address-overlay-probe.mjs`) can show.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const html = readFileSync(
	"src/renderer/browser-address-overlay-list.html",
	"utf8",
);
const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ""), {
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const result = await build({
	entryPoints: ["src/renderer/src/address-overlay-list/main.ts"],
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	loader: { ".css": "empty" },
	logLevel: "silent",
});
await import(
	`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const { apply } = dom.window.__loAddressOverlay;

const THEME = Object.fromEntries(
	[
		"elevated",
		"ink",
		"inkMuted",
		"accent",
		"accentWash",
		"rowHover",
		"hairline",
		"control",
	].map((name) => [name, "#112233"]),
);
const model = (rows, dir = "rtl") => ({
	v: 1,
	seq: 1,
	dir,
	label: "x",
	active: -1,
	height: 140,
	view: { kind: "rows", rows },
	theme: THEME,
});
const rowEls = () => [
	...document.querySelectorAll("#address-list-rows .lo-row-text"),
];
const BIDI_CONTROLS = /[\u2066-\u2069\u202A-\u202E]/;

test("a row with an isolate range wraps exactly the value in <bdi dir=ltr>", () => {
	// A ur-shaped sentence: an RTL-script quote-leading prefix, the value, a suffix.
	const text = "\u201C192.168.1.1/\u201D \u06A9\u06BE\u0648\u0644\u06CC\u06BA";
	apply(model([{ text, title: "", isolate: { start: 1, end: 13 } }]));
	const [span] = rowEls();
	const bdis = span.querySelectorAll("bdi");
	assert.equal(bdis.length, 1);
	assert.equal(bdis[0].getAttribute("dir"), "ltr");
	assert.equal(bdis[0].textContent, "192.168.1.1/");
	assert.equal(
		span.textContent,
		text,
		"the visible text is the unsplit text, byte for byte",
	);
	assert.equal(BIDI_CONTROLS.test(span.textContent), false);
	// CONTRACT CHANGED (design D1): a row that embeds a value is a sentence in the
	// UI's language and takes the model's direction (rtl here); `auto` skipped the
	// isolate and resolved from a leading Latin word. Plain rows keep `auto`, pinned
	// in the D1 case below.
	assert.equal(span.getAttribute("dir"), "rtl");
	assert.equal(span.innerHTML.includes("<script"), false);
});

test("a row without a range stays one text node, and hostile text is literal", () => {
	apply(
		model([
			{ text: "host.example.com/path", title: "" },
			{ text: "<b>x</b>", title: "", isolate: { start: 0, end: 8 } },
		]),
	);
	const [plain, hostile] = rowEls();
	assert.equal(plain.querySelectorAll("bdi").length, 0);
	assert.equal(plain.childNodes.length, 1);
	assert.equal(
		hostile.querySelector("b"),
		null,
		"text is never parsed as HTML",
	);
	assert.equal(hostile.querySelector("bdi").textContent, "<b>x</b>");
});

test("a range that does not fit the text paints plain text, never throws", () => {
	apply(model([{ text: "abc", title: "", isolate: { start: 2, end: 9 } }]));
	const [span] = rowEls();
	assert.equal(span.textContent, "abc");
	assert.equal(span.querySelectorAll("bdi").length, 0);
});

test("D1: a row that embeds a value takes the UI direction; plain rows keep auto", () => {
	// `dir=auto` skips isolates and reads the first strong character, which in an
	// Urdu sentence that opens with Latin text ("DuckDuckGo ...") is LTR - the
	// sentence painted left-to-right and left-aligned beside an RTL Open row.
	const sentence =
		'DuckDuckGo \u067E\u0631 "192.168.1.1/" \u062A\u0644\u0627\u0634';
	const start = sentence.indexOf("192");
	apply(
		model([
			{ text: sentence, title: "", isolate: { start, end: start + 12 } },
			{ text: "host.example.com/path", title: "" },
		]),
	);
	const [embedded, plain] = rowEls();
	assert.equal(embedded.getAttribute("dir"), "rtl");
	assert.equal(embedded.querySelector("bdi").getAttribute("dir"), "ltr");
	assert.equal(embedded.querySelector("bdi").textContent, "192.168.1.1/");
	assert.equal(plain.getAttribute("dir"), "auto");
	apply(
		model(
			[{ text: sentence, title: "", isolate: { start, end: start + 12 } }],
			"ltr",
		),
	);
	assert.equal(rowEls()[0].getAttribute("dir"), "ltr");
});

test("D4: only the embedded value is monospace; the sentence is UI type", () => {
	apply(
		model([
			{ text: 'Open "a.example"', title: "", isolate: { start: 6, end: 15 } },
		]),
	);
	const [span] = rowEls();
	assert.ok(span.classList.contains("is-sentence"));
	assert.equal(span.querySelector("bdi").textContent, "a.example");
});
