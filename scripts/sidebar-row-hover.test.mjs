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
const SESSION_RESET_SPARES_CURRENT = /:not\(\s*\[data-workspace-current\]\s*\)/;
const CLASS_NAME_ATTR = /className=(\{cn\([\s\S]*?\)\}|"[^"]*")/;
const FULL_WIDTH = /\bw-full\b/;
const ROW_HOVER_CLASS = /hover:bg-row-hover/;
const ROW_STYLE = /\browStyle\b/;
const CHAT_ROW_MARKER = /\sdata-chat-row[\s=]/;
const ROW_BUTTON_MARKER = /\sdata-sidebar-row-button[\s=]/;
const ROW_BUTTON_ATTR = /data-sidebar-row-button/;
const CREATE_TEAM_MARKED =
	/data-sidebar-row-button\s*\n(\s*)data-sidebar-create-team/;

const SELECTED_GROUND =
	/background-color:\s*var\(--sidebar-conversation-current\)/;
const HOVER_GROUND = /background-color:\s*var\(--sidebar-conversation-hover\)/;
const CONVERSATION_LIGHT_DARK =
	/--sidebar-conversation-hover:\s*light-dark\(\s*var\(--color-row-hover\),\s*color-mix\(in srgb, var\(--color-row-hover\), var\(--lo-ink\) 3%\)/;
const OPAQUE_SELECTED_GROUND =
	/--sidebar-conversation-current:\s*light-dark\(\s*var\(--color-row-selected\),\s*color-mix\(in srgb, var\(--color-row-selected\), var\(--lo-ink\) 3%\)/;
const GLASS_DARK_HOVER =
	/--sidebar-conversation-hover:\s*light-dark\(\s*var\(--color-row-hover\),\s*color-mix\(in srgb, var\(--color-row-hover\), var\(--color-row-selected\) 24%\)/;
const GLASS_SELECTED_GROUND =
	/--sidebar-conversation-current:\s*var\(--color-row-selected\)/;
const CONVERSATION_BUTTON_SEED = /\bdata-chat-row\s+data-session-row-button\b/;
const SELECTOR_PAREN_WHITESPACE = /\( +| +\)/g;

const SIDEBAR_MARKERS =
	/\[data-(?:sidebar-band|entity|workspace-launcher|session-row|workspace-current|temporary-row)\]/;

/* Read one block level at a time so an at-rule's conditions stay attached. */
function topLevelBlocks(stylesheet) {
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
				rules.push({ prelude, body: code.slice(start, i) });
				start = i + 1;
			}
		} else if (ch === ";" && depth === 0) {
			start = i + 1;
		}
	}
	return rules;
}

function unlayeredRules(stylesheet) {
	return topLevelBlocks(stylesheet).filter(
		({ prelude }) => !prelude.startsWith("@"),
	);
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
	/(?:\[data-session-row\]\[class~="(?:hover:)?bg-row-hover"\]|\[data-workspace-current\][^>]*|\[data-entity\] > \[data-entity-staged\]) > \[data-chat-row\]$/;

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
	const sessionReset = unlayeredRules(css)
		.filter(({ body }) => TRANSPARENT_BODY.test(body))
		.flatMap(({ prelude }) => splitSelectors(prelude).flatMap(expandIs))
		.find((selector) => SESSION_ROW_NOT.test(selector));
	assert.ok(
		sessionReset,
		"the non-current session's resting reset still exists",
	);
	assert.match(sessionReset, SESSION_RESET_SPARES_CURRENT);
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

function selectorsPainting(ground, stylesheet = css) {
	return unlayeredRules(stylesheet)
		.filter(({ body }) => ground.test(body))
		.flatMap(({ prelude }) => splitSelectors(prelude).flatMap(expandIs))
		.map((selector) =>
			selector.replace(SELECTOR_PAREN_WHITESPACE, (match) => match.trim()),
		);
}

// Selection survives a hover anywhere, including on the current row itself.
// Only the box paints for a wrapped row; the temporary button paints itself.
test("current conversations keep one selected ground before and during hover", () => {
	const currentBox = "[data-workspace-current]:not([data-dragging])";
	const currentTemporary =
		'[data-temporary-row] > [data-chat-row][aria-current="page"]';
	const selected = selectorsPainting(SELECTED_GROUND).filter((selector) =>
		selector.startsWith("[data-workspace-shell] "),
	);
	assert.ok(selected.includes(`[data-workspace-shell] ${currentBox}`));
	assert.ok(selected.includes(`[data-workspace-shell] ${currentTemporary}`));
	const resets = selectorsPainting(TRANSPARENT_BODY);
	assert.ok(
		resets.includes(`[data-workspace-shell] ${currentBox} > [data-chat-row]`),
	);
	for (const owner of [currentBox, currentTemporary]) {
		assert.ok(!resets.includes(`[data-workspace-shell] ${owner}:not(:hover)`));
	}
});

test("conversation grounds use the sidebar's opaque and glass roles", () => {
	const shell = "[data-workspace-shell]";
	const sidebar = '[data-chat-region="sidebar"]';
	const rules = unlayeredRules(css);
	const opaque = rules.find(({ prelude }) => prelude === `${shell} ${sidebar}`);
	const glass = rules.find(
		({ prelude }) =>
			prelude.startsWith('html[data-glass~="sidebar"]') &&
			prelude.includes(`${sidebar}[data-glass-region="sidebar"]`),
	);
	assert.match(opaque?.body ?? "", CONVERSATION_LIGHT_DARK);
	assert.match(opaque?.body ?? "", OPAQUE_SELECTED_GROUND);
	assert.match(glass?.body ?? "", GLASS_DARK_HOVER);
	assert.match(glass?.body ?? "", GLASS_SELECTED_GROUND);
});

test("only pointer paints require hover capability; a menu holds its ground on touch", () => {
	const shell = "[data-workspace-shell]";
	const sessionBox = `${shell} [data-session-row]:not([data-workspace-current]):not([data-dragging])`;
	assert.deepEqual(
		selectorsPainting(HOVER_GROUND),
		[`${sessionBox}[class~="bg-row-hover"]`],
		"only the menu-held fill can paint unconditionally",
	);
	// A tap can leave :hover latched even when the primary pointer cannot hover.
	// Check the actual rule bodies inside the same capability query Tailwind uses.
	const hoverMedia = topLevelBlocks(css)
		.filter(({ prelude }) => prelude === "@media (hover: hover)")
		.map(({ body }) => body)
		.join("\n");
	assert.deepEqual(selectorsPainting(HOVER_GROUND, hoverMedia), [
		`${sessionBox}[class~="hover:bg-row-hover"]:hover`,
		`${shell} [data-session-row-button]:not([aria-current="page"]):not([data-session-row][class~="hover:bg-row-hover"] > *, [data-session-row][class~="bg-row-hover"] > *, [data-session-row][data-dragging] > *):hover`,
		`${shell} [data-temporary-row] > [data-chat-row]:not([aria-current="page"]):hover`,
	]);
	assert.deepEqual(selectorsPainting(SELECTED_GROUND, hoverMedia), []);
	assert.match(sidebarSource, CONVERSATION_BUTTON_SEED);
});
