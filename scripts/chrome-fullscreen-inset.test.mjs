/**
 * Full screen keeps a modest top inset, and windowed layouts do not move.
 *
 * WHY THIS EXISTS. The operator (2026-11-13): in macOS full screen the sidebar's
 * brand row, the chat header row and the panel rail sat hard against the top
 * edge. The fix gives full screen `--chrome-fullscreen-top` (one 8px step) as the
 * top inset on EVERY OS and chrome mode, as padding inside each column (the
 * value rides `--chrome-strip-h`, which `panel-top-pad`/`panel-scroll` and the
 * shell's `<main>` already consume), and hides the lane and the route band so
 * the number never becomes a drag strip or a second inset.
 *
 * WHY A CASCADE RATHER THAN A REGEX. The defect class here is precedence: the
 * mac rule sets the strip to 32px with the same specificity as the full-screen
 * rule, and the route band's `:not(...)` arm outranks a naive hide rule. A regex
 * on one block cannot see that another block wins. So this file resolves the
 * root-level chrome custom properties the way a browser does - every top-level
 * rule whose selector jsdom says matches the document element, ranked by
 * specificity then source order - and asserts the RESOLVED value per state. The
 * selectors involved are attribute tests, `:root` and `:not(...)` only, so
 * specificity is a count of attribute/pseudo-class tests; a selector of any
 * other shape fails the file loudly rather than being mis-ranked.
 *
 * It proves the stylesheet's decisions, not pixels: the frames on the PR are the
 * geometry evidence.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const css = readFileSync(
	`${process.cwd()}/src/renderer/src/styles/index.css`,
	"utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Top-level `selector { body }` blocks with no nested braces. */
const blocks = [];
{
	let depth = 0;
	let start = 0;
	for (let i = 0; i < css.length; i += 1) {
		if (css[i] === "{") {
			if (depth === 0) {
				const prelude = css.slice(start, i).trim();
				const close = css.indexOf("}", i);
				const body = css.slice(i + 1, close);
				if (!body.includes("{")) blocks.push({ prelude, body, order: i });
			}
			depth += 1;
		} else if (css[i] === "}") {
			depth -= 1;
			if (depth === 0) start = i + 1;
		} else if (css[i] === ";" && depth === 0) {
			start = i + 1;
		}
	}
}

/** Specificity of an attribute/`:root`/`:not()`-only compound selector. */
const specificity = (selector) => {
	const stripped = selector.replace(/"[^"]*"/g, '""');
	assert.match(
		stripped,
		/^(?::root|\[[a-z-]+(?:=""?)?\]|:not\(\s*\[[a-z-]+(?:="")?\]\s*\))+$/,
		`unexpected root selector shape: ${selector}`,
	);
	return (stripped.match(/\[|:root/g) ?? []).length;
};

const doc = new JSDOM("<!doctype html><html><body></body></html>").window
	.document;

/** Resolve a custom property on `<html>` carrying `attrs`. */
const resolve = (attrs, property) => {
	const root = doc.documentElement;
	for (const name of [...root.getAttributeNames()]) root.removeAttribute(name);
	for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
	const declared = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`);
	let winner = null;
	for (const block of blocks) {
		const value = block.body.match(declared)?.[1]?.trim();
		if (value === undefined) continue;
		for (const raw of block.prelude.split(",")) {
			const selector = raw.trim();
			// Only rules that target the root element itself set these tokens.
			if (/\s/.test(selector) || !root.matches(selector)) continue;
			const rank = [specificity(selector), block.order];
			if (
				!winner ||
				rank[0] > winner.rank[0] ||
				(rank[0] === winner.rank[0] && rank[1] > winner.rank[1])
			) {
				winner = { rank, value };
			}
		}
	}
	return winner?.value;
};

/** Every windowed state the app writes, and what each must keep resolving to. */
const WINDOWED = [
	[
		"mac integrated",
		{ "data-chrome-mode": "integrated", "data-chrome-platform": "mac" },
		"32px",
	],
	[
		"windows integrated (trailing buttons)",
		{
			"data-chrome-mode": "integrated",
			"data-chrome-platform": "win",
			"data-chrome-trailing": "true",
		},
		"0px",
	],
	[
		"linux integrated, leading buttons",
		{
			"data-chrome-mode": "integrated",
			"data-chrome-platform": "linux",
			"data-chrome-leading": "true",
		},
		"env(titlebar-area-height, 0px)",
	],
	[
		"linux integrated, trailing buttons",
		{
			"data-chrome-mode": "integrated",
			"data-chrome-platform": "linux",
			"data-chrome-trailing": "true",
		},
		"0px",
	],
	[
		"windows native frame",
		{ "data-chrome-mode": "native", "data-chrome-platform": "win" },
		"0px",
	],
	[
		"linux native frame",
		{ "data-chrome-mode": "native", "data-chrome-platform": "linux" },
		"0px",
	],
];

test("the full-screen inset is one named 8px step", () => {
	assert.equal(resolve({}, "--chrome-fullscreen-top"), "8px");
});

test("windowed layouts resolve exactly as before, with or without the full-screen attribute at false", () => {
	for (const [label, attrs, strip] of WINDOWED) {
		for (const fullscreen of [undefined, "false"]) {
			const state = fullscreen
				? { ...attrs, "data-chrome-fullscreen": fullscreen }
				: attrs;
			assert.equal(
				resolve(state, "--chrome-strip-h"),
				strip,
				`${label}: windowed strip`,
			);
		}
	}
});

test("full screen gives every OS and chrome mode the same top inset and no side insets", () => {
	for (const [label, attrs] of WINDOWED) {
		const state = { ...attrs, "data-chrome-fullscreen": "true" };
		assert.equal(
			resolve(state, "--chrome-strip-h"),
			"var(--chrome-fullscreen-top)",
			`${label}: full-screen top inset`,
		);
		for (const inset of [
			"--chrome-inset-start",
			"--chrome-inset-end",
			"--chrome-inset-end-h",
		]) {
			assert.equal(resolve(state, inset), "0px", `${label}: ${inset}`);
		}
	}
});

test("full screen hides the lane and the route band, out-ranking both of their show rules", () => {
	const hide = blocks.find((b) =>
		/\[data-chrome-fullscreen="true"\]\s+:is\(\[data-titlebar-lane\],\s*\[data-chrome-route-band\]\)/.test(
			b.prelude,
		),
	);
	assert.ok(hide, "the full-screen hide rule exists");
	assert.match(hide.body, /display:\s*none;/);
	// `[a][b][c] :is(x)` is (0,4,0): attribute tests on the root plus the :is arg.
	const hideSpec = (hide.prelude.match(/\[/g) ?? []).length - 1;
	for (const show of blocks.filter(
		(b) =>
			/\[data-titlebar-lane\]|\[data-chrome-route-band\]/.test(b.prelude) &&
			/display:\s*block;/.test(b.body),
	)) {
		for (const arm of show.prelude.split(/,(?![^(]*\))/)) {
			const spec = (arm.match(/\[/g) ?? []).length;
			assert.ok(
				hideSpec > spec || (hideSpec === spec && hide.order > show.order),
				`full-screen hide must win over "${arm.trim()}"`,
			);
		}
	}
	// And its lane/band arguments really are the elements those rules show.
	for (const [label, attrs] of WINDOWED) {
		const root = doc.documentElement;
		for (const name of [...root.getAttributeNames()])
			root.removeAttribute(name);
		root.innerHTML =
			"<body><div data-titlebar-lane></div><div data-chrome-route-band></div></body>";
		for (const [k, v] of Object.entries({
			...attrs,
			"data-chrome-fullscreen": "true",
		}))
			root.setAttribute(k, v);
		const hits = doc.querySelectorAll(hide.prelude);
		assert.equal(hits.length, 2, `${label}: both drag surfaces are hidden`);
	}
});
