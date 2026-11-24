/**
 * THE SIDEBAR'S ROWS PAINT THEIR HOVER GROUND (v0.63.0 regression).
 *
 * The operator: "The improved design looks good however we seem to have lost
 * the highlight interaction on hover on the left sidebar items". The shared
 * inset (PR #2043) strips the sidebar's resting fills with UNLAYERED rules in
 * `styles/index.css`, and an unlayered declaration beats every
 * `@layer utilities` one regardless of specificity. Those rules matched the
 * rows at all times, so `hover:bg-row-hover` on the pinned/chat row boxes and
 * on the Agents/Teams row buttons could never win: no row highlighted.
 *
 * WHAT THIS PINS, derived from the stylesheet rather than a list of known
 * rules: every unlayered rule that names a sidebar row marker and clears the
 * background must leave the pointer's ground alone. Each of its selectors has
 * to be one of
 *   (a) a chrome reset on buttons that exempts the row button while hovered
 *       (`:not([data-chat-row]:hover)`), so icon buttons keep no pill but the
 *       row itself paints;
 *   (b) a reset of a row box/wrapper at rest only (`:not(:hover)`), which for
 *       the session box also spares the menu's held ground (`bg-row-hover`);
 *   (c) a row button whose enclosing box paints the ground itself (a session
 *       box carrying `hover:bg-row-hover`, a current box, a staged entity
 *       wrapper) - transparent so glass's translucent grounds do not stack.
 * And a dragged row is never reset: `rowDragging` owns its ground.
 *
 * NEGATIVE CONTROL: the pre-fix (v0.63.0) rules, verbatim, must fail.
 *
 * WHAT THIS CANNOT SAY: that the pixels change. Rendered proof is the design
 * round's capture of a hovered pinned row and a hovered Teams row.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync("src/renderer/src/styles/index.css", "utf8");

const SIDEBAR_MARKERS =
	/\[data-(?:sidebar-band|entity|workspace-launcher|session-row|workspace-current|temporary-row)\]/;

/*
 * Top-level (unlayered) rules only: a rule inside `@layer` loses to nothing the
 * row wears that matters here, and nested blocks are skipped by tracking depth.
 */
function unlayeredRules(stylesheet) {
	const code = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = [];
	let depth = 0;
	let start = 0;
	let prelude = "";
	for (let i = 0; i < code.length; i++) {
		const ch = code[i];
		if (ch === "{") {
			if (depth === 0) prelude = code.slice(start, i).trim();
			depth++;
			if (depth === 1) start = i + 1;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				if (!prelude.startsWith("@"))
					rules.push({ prelude, body: code.slice(start, i) });
				start = i + 1;
			}
		} else if (ch === ";" && depth === 0) {
			start = i + 1;
		}
	}
	return rules;
}

/* Split a selector list on top-level commas only (`:is(a, b)` stays whole). */
function splitSelectors(list) {
	const out = [];
	let depth = 0;
	let cur = "";
	for (const ch of list) {
		if (ch === "(") depth++;
		if (ch === ")") depth--;
		if (ch === "," && depth === 0) {
			out.push(cur);
			cur = "";
		} else cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/* Expand one level of `:is(...)` so each row marker is judged on its own. */
function expandIs(selector) {
	const m = selector.match(/^(.*?):is\(/);
	if (!m) return [selector];
	let depth = 1;
	let i = m[0].length;
	for (; i < selector.length && depth; i++) {
		if (selector[i] === "(") depth++;
		if (selector[i] === ")") depth--;
	}
	const inner = selector.slice(m[0].length, i - 1);
	const tail = selector.slice(i);
	return splitSelectors(inner).map((part) => `${m[1]}${part}${tail}`.trim());
}

const BOX_PAINTS =
	/(?:\[data-session-row\]\[class~="hover:bg-row-hover"\]|\[data-workspace-current\][^>]*|\[data-entity\] > div\[class~="bg-row-selected"\]) > \[data-chat-row\]$/;

/* Returns the offending selectors: empty means every reset spares the pointer. */
function hoverKillingResets(stylesheet) {
	const offenders = [];
	for (const { prelude, body } of unlayeredRules(stylesheet)) {
		if (!/background(?:-color)?:\s*transparent/.test(body)) continue;
		for (const listed of splitSelectors(prelude)) {
			for (const selector of expandIs(listed)) {
				if (!SIDEBAR_MARKERS.test(selector)) continue;
				// A dragged row must never be reset.
				// (Button chrome resets are judged below; this is about the row box.)
				const drags =
					!/ button/.test(selector) &&
					/\[data-session-row\]|\[data-workspace-current\]/.test(selector);
				if (
					drags &&
					!/\[data-chat-row\]$/.test(selector) &&
					!/:not\(\[data-dragging\]\)/.test(selector)
				) {
					offenders.push(selector);
					continue;
				}
				const ok =
					// (a) button chrome reset that frees the hovered row button
					(/ button:not\(\[data-lo-floating\] \*\)/.test(selector) &&
						/:not\(\[data-chat-row\]:hover\)$/.test(selector)) ||
					// (c) the enclosing box paints
					BOX_PAINTS.test(selector) ||
					// (b) resting-only reset; the session box spares the held ground
					(/:not\(:hover\)/.test(selector) &&
						(!/\[data-session-row\]:not/.test(selector) ||
							/:not\( ?\[class~="bg-row-hover"\] ?\)/.test(selector)));
				if (!ok) offenders.push(selector);
			}
		}
	}
	return offenders;
}

/* The v0.63.0 rules, verbatim: the shape that killed every row's hover. */
const PRE_FIX = `
[data-workspace-shell]
	:is(
		[data-sidebar-band],
		[data-entity],
		[data-workspace-launcher],
		[data-session-row]
	)
	button:not([data-lo-floating] *) {
	background: transparent;
	border-width: 0;
	box-shadow: none;
}
[data-workspace-shell]
	:is(
		[data-session-row]:not([data-dragging]),
		[data-temporary-row] > [data-chat-row][aria-current="page"],
		[data-workspace-current]:not([data-dragging]),
		[data-workspace-current]:not([data-dragging]) > [data-chat-row],
		[data-workspace-launcher] [data-entity] > div:first-child
	) {
	background: transparent;
}
`;

test("the shipped stylesheet's sidebar resets leave the hover ground to the rows", () => {
	assert.deepEqual(hoverKillingResets(css), []);
	// The resets still exist: this is a narrowing, not a removal.
	assert.match(
		css,
		/button:not\(\[data-lo-floating\] \*\):not\(\[data-chat-row\]:hover\) \{/,
	);
	assert.match(
		css,
		/\[data-workspace-current\]:not\(\[data-dragging\]\):not\(:hover\)/,
	);
});

test("negative control: the v0.63.0 rules are caught, one offender per row kind", () => {
	const offenders = hoverKillingResets(PRE_FIX);
	assert.deepEqual(offenders, [
		"[data-workspace-shell] [data-sidebar-band] button:not([data-lo-floating] *)",
		"[data-workspace-shell] [data-entity] button:not([data-lo-floating] *)",
		"[data-workspace-shell] [data-workspace-launcher] button:not([data-lo-floating] *)",
		"[data-workspace-shell] [data-session-row] button:not([data-lo-floating] *)",
		"[data-workspace-shell] [data-session-row]:not([data-dragging])",
		'[data-workspace-shell] [data-temporary-row] > [data-chat-row][aria-current="page"]',
		"[data-workspace-shell] [data-workspace-current]:not([data-dragging])",
		"[data-workspace-shell] [data-workspace-launcher] [data-entity] > div:first-child",
	]);
});

test("negative controls: a reset that kills the menu's held ground or a dragged row is caught", () => {
	const heldGround =
		"[data-workspace-shell] [data-session-row]:not([data-dragging]):not(:hover) { background: transparent; }";
	assert.equal(hoverKillingResets(heldGround).length, 1);
	const dragged = `[data-workspace-shell] [data-session-row]:not(:hover):not([class~="bg-row-hover"]) { background: transparent; }`;
	assert.equal(hoverKillingResets(dragged).length, 1);
});
