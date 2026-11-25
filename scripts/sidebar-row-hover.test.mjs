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

/* Hoisted patterns (biome useTopLevelRegex; the scripts lint gate). */
const IS_HEAD = /^(.*?):is\(/;
const TRANSPARENT_BODY = /background(?:-color)?:\s*transparent/;
const BUTTON_DESCENDANT = / button/;
const DRAGGABLE_ROW = /\[data-session-row\]|\[data-workspace-current\]/;
const CHAT_ROW_TAIL = /\[data-chat-row\]$/;
const NOT_DRAGGING = /:not\(\[data-dragging\]\)/;
const BUTTON_CHROME_RESET = / button:not\(\[data-lo-floating\] \*\)/;
const RESTING_ONLY = /:not\(:hover\)/;
const SESSION_ROW_NOT = /\[data-session-row\]:not/;
const SPARES_HELD_GROUND = /:not\( ?\[class~="bg-row-hover"\] ?\)/;
const SHIPPED_RELEASE =
	/button:not\(\[data-lo-floating\] \*\):not\( :is\(\[data-chat-row\], \[data-sidebar-row-button\]\):hover \) \{/;
const CURRENT_RESTING_RESET =
	/\[data-workspace-current\]:not\(\[data-dragging\]\):not\(:hover\)/;
const CLASS_NAME_ATTR = /className=(\{cn\([\s\S]*?\)\}|"[^"]*")/;
const FULL_WIDTH = /\bw-full\b/;
const ROW_HOVER_CLASS = /hover:bg-row-hover/;
const ROW_STYLE = /\browStyle\b/;
const CHAT_ROW_MARKER = /\sdata-chat-row[\s=]/;
const ROW_BUTTON_MARKER = /\sdata-sidebar-row-button[\s=]/;
const ROW_BUTTON_ATTR = /data-sidebar-row-button/;
const CREATE_TEAM_MARKED =
	/data-sidebar-row-button\s*\n(\s*)data-sidebar-create-team/;

const CURRENT_MARKER = /\[data-workspace-current\]/;
const HOVER_PSEUDO = /:hover/;
const ROW_HOVER_GROUND = /background-color:\s*var\(--color-row-hover\)/;
const TEMPORARY_MARKER = /\[data-temporary-row\]/;
const STAGED_MARKER = /\[data-entity-staged\]/;
const NOT_DRAGGING_HOVER_TAIL = /:not\(\[data-dragging\]\):hover$/;
const CURRENT_PAGE_HOVER_TAIL = /\[aria-current="page"\]:hover$/;
const CURRENT_BUTTON_CLEARED =
	/\[data-workspace-current\]:not\(\[data-dragging\]\) > \[data-chat-row\]/;
const CURRENT_HOVER_RULE =
	/\[data-workspace-shell\]\s*:is\(\s*\[data-workspace-current\]:not\(\[data-dragging\]\):hover,[\s\S]*?\}/;

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
	const m = selector.match(IS_HEAD);
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
	/(?:\[data-session-row\]\[class~="hover:bg-row-hover"\]|\[data-workspace-current\][^>]*|\[data-entity\] > \[data-entity-staged\]) > \[data-chat-row\]$/;

/*
 * The release (a) requires: BOTH row-button kinds are freed while hovered - the
 * chat row and the full-width text rows that are not chats (QA round 1, Q1-1).
 */
const ROW_BUTTON_RELEASE =
	/:not\( ?:is\(\[data-chat-row\], ?\[data-sidebar-row-button\]\):hover ?\)$/;

/* Returns the offending selectors: empty means every reset spares the pointer. */
function hoverKillingResets(stylesheet) {
	const offenders = [];
	for (const { prelude, body } of unlayeredRules(stylesheet)) {
		if (!TRANSPARENT_BODY.test(body)) continue;
		for (const listed of splitSelectors(prelude)) {
			for (const selector of expandIs(listed)) {
				if (!SIDEBAR_MARKERS.test(selector)) continue;
				// A dragged row must never be reset.
				// (Button chrome resets are judged below; this is about the row box.)
				const drags =
					!BUTTON_DESCENDANT.test(selector) && DRAGGABLE_ROW.test(selector);
				if (
					drags &&
					!CHAT_ROW_TAIL.test(selector) &&
					!NOT_DRAGGING.test(selector)
				) {
					offenders.push(selector);
					continue;
				}
				const ok =
					// (a) button chrome reset that frees the hovered row button
					(BUTTON_CHROME_RESET.test(selector) &&
						ROW_BUTTON_RELEASE.test(selector)) ||
					// (c) the enclosing box paints
					BOX_PAINTS.test(selector) ||
					// (b) resting-only reset; the session box spares the held ground
					(RESTING_ONLY.test(selector) &&
						(!SESSION_ROW_NOT.test(selector) ||
							SPARES_HELD_GROUND.test(selector)));
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
	assert.match(css.replace(/\s+/g, " "), SHIPPED_RELEASE);
	assert.match(css, CURRENT_RESTING_RESET);
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

/**
 * THE FULL-WIDTH TEXT ROWS THAT ARE NOT CHATS PAINT THEIR HOVER (QA round 1, Q1-1).
 *
 * "Create team", "Create agent" and every "Show N more" foot declare
 * `hover:bg-row-hover`, but the chrome reset above freed only `[data-chat-row]`
 * buttons, so they stayed `rgba(0, 0, 0, 0)` with `:hover` true. They now carry
 * `data-sidebar-row-button`, the stylesheet frees that marker too, and this test
 * pins BOTH halves: the stylesheet's release (via `hoverKillingResets`), and that
 * every full-width row-styled button in the sidebar wears one of the two markers -
 * so a new foot or launcher row cannot be added dead under the pointer.
 */
const sidebarSource = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
);

/* Full-width buttons that declare the row hover ground but wear neither marker. */
function unmarkedRowButtons(source) {
	const code = source
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
	const found = [];
	let at = 0;
	for (;;) {
		at = code.indexOf("<button", at);
		if (at < 0) break;
		const end = code.indexOf("</button>", at);
		const element = code.slice(at, end);
		const cls = element.match(CLASS_NAME_ATTR);
		const classes = cls ? cls[1] : "";
		const rowLike =
			FULL_WIDTH.test(classes) &&
			(ROW_HOVER_CLASS.test(classes) || ROW_STYLE.test(classes));
		const opening = cls ? element.slice(0, cls.index) : element;
		if (
			rowLike &&
			!CHAT_ROW_MARKER.test(opening) &&
			!ROW_BUTTON_MARKER.test(opening)
		)
			found.push(classes.slice(0, 60));
		at = end;
	}
	return found;
}

test("every full-width text row button is marked, so the reset frees its hover", () => {
	assert.deepEqual(unmarkedRowButtons(sidebarSource), []);
	// The rows QA reproduced on: "Create team", "Create agent", each "Show N more".
	for (const hook of [
		"data-sidebar-create-team",
		"data-sidebar-create-agent",
		"data-sidebar-section-more={key}",
		"data-sidebar-page-more\n",
		"data-sidebar-page-more-tag={bucket.id}",
	]) {
		const at = sidebarSource.indexOf(hook);
		assert.ok(at > 0, `${hook} located`);
		const opening = sidebarSource.slice(
			sidebarSource.lastIndexOf("<button", at),
			at,
		);
		assert.match(opening, ROW_BUTTON_ATTR, `${hook} is marked`);
	}
	// Negative control: the a27135e shape, the marker absent from "Create team".
	const unmarked = sidebarSource.replace(
		CREATE_TEAM_MARKED,
		"$1data-sidebar-create-team",
	);
	assert.notEqual(unmarked, sidebarSource, "control mutation applied");
	assert.equal(unmarkedRowButtons(unmarked).length, 1);
});

test("negative control: a reset that frees only the chat row (a27135e) is caught", () => {
	const chatRowOnly =
		"[data-workspace-shell] :is([data-sidebar-band], [data-workspace-launcher]) button:not([data-lo-floating] *):not([data-chat-row]:hover) { background: transparent; }";
	assert.equal(hoverKillingResets(chatRowOnly).length, 2);
});

/**
 * THE CURRENT ROW HOVERS WITH `row-hover`, ONE LAYER (design round 1, D5).
 *
 * The inset clears a current row's resting fill, so `rowCurrent`'s
 * `hover:bg-row-selected` was the only ground it painted - the selected step,
 * under the pointer only. The stylesheet must give the hovered current box (and
 * the box-less temporary current row, and a staged launcher entity) the same
 * `--color-row-hover` every other row hovers with, never on a dragged row, and
 * the current box's row button must stay transparent so the two do not stack.
 */
function currentHoverRule(stylesheet) {
	return unlayeredRules(stylesheet).find(
		({ prelude, body }) =>
			CURRENT_MARKER.test(prelude) &&
			HOVER_PSEUDO.test(prelude) &&
			ROW_HOVER_GROUND.test(body),
	);
}

function currentHoverIsOneRowHoverLayer(stylesheet) {
	const rule = currentHoverRule(stylesheet);
	if (!rule) return false;
	const selectors = splitSelectors(rule.prelude).flatMap(expandIs);
	const box = selectors.find((s) => CURRENT_MARKER.test(s));
	const temp = selectors.find((s) => TEMPORARY_MARKER.test(s));
	const staged = selectors.find((s) => STAGED_MARKER.test(s));
	return (
		Boolean(box && temp && staged) &&
		NOT_DRAGGING_HOVER_TAIL.test(box) &&
		CURRENT_PAGE_HOVER_TAIL.test(temp) &&
		// the single layer: the current box's row button is cleared
		CURRENT_BUTTON_CLEARED.test(stylesheet.replace(/\s+/g, " "))
	);
}

test("the hovered current row takes row-hover, not row-selected, in one layer", () => {
	assert.equal(currentHoverIsOneRowHoverLayer(css), true);
	// Negative control: the a27135e stylesheet, with no current-row hover rule.
	const before = css.replace(CURRENT_HOVER_RULE, "");
	assert.notEqual(before, css, "control mutation applied");
	assert.equal(currentHoverIsOneRowHoverLayer(before), false);
	// Negative control: a rule that also paints a dragged current row.
	const paintsDrag = css.replace(
		"[data-workspace-current]:not([data-dragging]):hover,",
		"[data-workspace-current]:hover,",
	);
	assert.notEqual(paintsDrag, css, "control mutation applied");
	assert.equal(currentHoverIsOneRowHoverLayer(paintsDrag), false);
});
