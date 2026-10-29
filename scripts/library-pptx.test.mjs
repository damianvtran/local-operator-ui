import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

/*
 * The PPTX fixture's text is real, and the extraction surface the viewer uses
 * for its transcript returns it. The canvas renderer (pptx-browser) draws the
 * deck; this test pins the fallback the viewer shows when a deck's text lives
 * in shapes the canvas path does not paint.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.URL = dom.window.URL;

const { PptxRenderer } = await import("pptx-browser");

test("the fixture exposes both body strings through extractAll", async () => {
	const bytes = new Uint8Array(
		readFileSync("scripts/fixtures/library/sample.pptx"),
	);
	const renderer = new PptxRenderer();
	await renderer.load(bytes);
	const slides = await renderer.extractAll();
	const text = slides
		.flatMap((slide) => slide.textShapes.map((shape) => shape.text))
		.join("\n");
	assert.match(text, /Library preview/);
	assert.match(text, /What the viewer renders/);
	assert.match(text, /Each slide is drawn onto a canvas\./);
	assert.match(text, /Text runs are visible in the rendered slide\./);
	renderer.destroy();
});
