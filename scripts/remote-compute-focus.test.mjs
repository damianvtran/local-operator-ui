/**
 * Where the sheet's caret comes from, and where it goes back to.
 *
 * WHY THIS FILE EXISTS. Both halves are one predicate over `document.activeElement`,
 * and that is `document.body` whenever nothing is focused - which is exactly the state
 * the hand-off leaves behind (UX round 4, U9): the row that held the caret unmounts
 * with the menu, so a capture taken after the hand-off reads body, and `body.focus()`
 * satisfies "the caret is on the target" without moving it. A test can pin the
 * predicate here; the caret ACTUALLY landing on the chip needs a real browser with
 * Radix's focus guards, and that is the round's own evidence, not this file's claim.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const bundle = await build({
	stdin: {
		contents:
			'export { sheetOpener, restoreSheetFocus } from "./src/renderer/src/features/remote-compute/remote-compute-focus";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { sheetOpener, restoreSheetFocus } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A document with the chat header's chip in it, which is the door. */
const page = () => {
	const dom = new JSDOM(
		'<!doctype html><html><body><button data-device-chip id="chip">On this device</button><div id="panel"></div></body></html>',
	);
	const { document } = dom.window;
	return {
		document,
		chip: document.querySelector("[data-device-chip]"),
	};
};

test("the body is not an opener", () => {
	const { document } = page();
	assert.equal(sheetOpener(document.body), null);
	assert.equal(sheetOpener(null), null);
});

test("an opener has to be in the document to be one", () => {
	const { document, chip } = page();
	assert.equal(sheetOpener(chip), chip);
	const gone = document.createElement("button");
	assert.equal(sheetOpener(gone), null);
});

test("closing with no opener puts the caret on the chip, not on the body", () => {
	const { document, chip } = page();
	document.body.focus();
	restoreSheetFocus(null, document);
	assert.equal(document.activeElement, chip);
});

test("a BODY opener is spent on the chip, which is the U9 regression", () => {
	const { document, chip } = page();
	restoreSheetFocus(document.body, document);
	assert.equal(document.activeElement, chip);
});

test("a live opener keeps the caret, and the chip is only the fallback", () => {
	const { document } = page();
	const opener = document.createElement("button");
	document.body.append(opener);
	restoreSheetFocus(opener, document);
	assert.equal(document.activeElement, opener);
});

test("an opener removed between the click and the close falls back to the chip", () => {
	const { document, chip } = page();
	const opener = document.createElement("button");
	opener.focus();
	opener.remove();
	restoreSheetFocus(opener, document);
	assert.equal(document.activeElement, chip);
});

test("a page with no chip left does not throw", () => {
	const dom = new JSDOM("<!doctype html><html><body></body></html>");
	const { document } = dom.window;
	assert.doesNotThrow(() => restoreSheetFocus(document.body, document));
});
