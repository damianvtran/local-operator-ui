/**
 * THE APP SIDEBAR LOOKS THE SAME ON EVERY ROUTE (design round 7, D1).
 *
 * The operator asked for the shell to be "consistent / standard across pages".
 * Round 7 measured the same `ChatSidebar` drawing two presentations: on Chat the
 * approved one (uppercase `sectionLabel` headings, borderless "Install all
 * built-in agents", no current-row pill), everywhere else the legacy one
 * (chevron + glyph disclosure headings 32px to the right, a bordered secondary
 * button, a filled current row, TODAY 16px lower). Three route gates produced
 * it:
 *
 *   1. `const workspaceLauncher = location.pathname === "/chat" || ...` in the
 *      component, choosing `sectionLabel(...)` or the legacy `heading(...)`;
 *   2. `<Button variant="secondary">` in `InstallBuiltinAgents`, made
 *      borderless only by a stylesheet rule;
 *   3. that rule, and the current-row no-fill rule, keyed on
 *      `[data-workspace-shell]:has([data-chat-workspace])` - i.e. "Chat is
 *      mounted".
 *
 * Each predicate below is the shape one of those gates had, and each is run
 * against a NEGATIVE CONTROL (the old shape, reintroduced as text) so the test
 * is shown able to fail rather than assumed to.
 *
 * WHAT THIS CANNOT SAY: that the pixels match. Rendered proof is the design
 * round's capture of `/chat` beside a non-Chat route.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = "src/renderer/src/";
const sidebar = readFileSync(
	`${root}features/chat/components/chat-sidebar.tsx`,
	"utf8",
);
const install = readFileSync(
	`${root}features/agents/components/install-builtin-agents.tsx`,
	"utf8",
);
const css = readFileSync(`${root}styles/index.css`, "utf8");

/*
 * Code only: a docblock may tell the history of a gate (this file's own
 * header does), and that is not a gate.
 */
const stripComments = (source) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/*
 * Every remaining route read in the sidebar must be a NAVIGATION decision
 * ("if not on Chat, go there"), never a presentation one. A `pathname` that
 * feeds a const, a ternary or a className is the D1 shape.
 */
function routeReadsDecidingPresentation(source) {
	const code = stripComments(source);
	return code
		.split("\n")
		.filter((line) => /\bpathname\b/.test(line))
		.filter((line) => !/navigate\(/.test(line));
}

function sectionHeadingsAreShared(source) {
	const code = stripComments(source);
	return (
		!/\bworkspaceLauncher\b/.test(code) &&
		!/\bconst heading = \(/.test(code) &&
		/\{sectionLabel\(\s*t\(SIDEBAR_SECTION_LABEL\.agents\)/.test(code) &&
		/\{sectionLabel\(\s*t\(SIDEBAR_SECTION_LABEL\.teams\)/.test(code)
	);
}

/* The primary action's own variant: borderless at source, no route read. */
function installIsBorderless(source) {
	const code = stripComments(source);
	const primary = code.match(
		/presentation === "primary" \? \(\s*<Button([\s\S]*?)>/,
	);
	if (!primary) return false;
	return (
		/variant="ghost"/.test(primary[1]) &&
		!/\bborder\b/.test(primary[1]) &&
		!/\b(?:useLocation|pathname)\b/.test(code)
	);
}

/*
 * The stylesheet rules that strip the sidebar rows' fills and borders. A rule
 * naming a sidebar-only marker must not also require Chat to be mounted; only
 * the panel rail (which Chat alone mounts) may keep that gate.
 */
const SIDEBAR_MARKERS =
	/\[data-(?:sidebar-band|entity|workspace-launcher|session-row|workspace-current|temporary-row)\]/;
function chatGatedSidebarSelectors(stylesheet) {
	const code = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
	const gated = [];
	for (const [, selectors] of code.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
		for (const selector of selectors.split(/,(?![^(]*\))/)) {
			if (
				SIDEBAR_MARKERS.test(selector) &&
				/:has\(\s*\[data-chat-workspace\]\s*\)/.test(selector)
			)
				gated.push(selector.trim().replace(/\s+/g, " "));
		}
	}
	return gated;
}

test("no route read decides the sidebar's presentation", () => {
	assert.deepEqual(routeReadsDecidingPresentation(sidebar), []);
	// Negative control: the round-7 gate, verbatim.
	const gate = `${sidebar}\n\tconst workspaceLauncher =\n\t\tlocation.pathname === "/chat" || location.pathname.startsWith("/chat/");\n`;
	assert.equal(routeReadsDecidingPresentation(gate).length, 1);
});

test("Agents and Teams headings are the shared sectionLabel on every route", () => {
	assert.equal(sectionHeadingsAreShared(sidebar), true);
	// Negative controls: the variant switch, and the legacy heading builder.
	const ternary = sidebar.replace(
		"{sectionLabel(\n\t\t\t\t\t\t\t\tt(SIDEBAR_SECTION_LABEL.teams)",
		"{workspaceLauncher ? sectionLabel(\n\t\t\t\t\t\t\t\tt(SIDEBAR_SECTION_LABEL.teams)",
	);
	assert.notEqual(ternary, sidebar, "control mutation applied");
	assert.equal(sectionHeadingsAreShared(ternary), false);
	assert.equal(
		sectionHeadingsAreShared(`${sidebar}\n\tconst heading = (key) => key;\n`),
		false,
	);
});

test("Install all built-in agents is borderless at source, not by a Chat-only rule", () => {
	assert.equal(installIsBorderless(install), true);
	const bordered = install.replace('variant="ghost"', 'variant="secondary"');
	assert.notEqual(bordered, install, "control mutation applied");
	assert.equal(installIsBorderless(bordered), false);
});

test("the sidebar's no-fill rules key off the sidebar, not the Chat route", () => {
	assert.deepEqual(chatGatedSidebarSelectors(css), []);
	// The rules still exist, unconditionally scoped to the shell.
	assert.match(
		css,
		/\[data-workspace-shell\]\s*:is\(\s*\[data-sidebar-band\],\s*\[data-entity\],\s*\[data-workspace-launcher\],\s*\[data-session-row\]\s*\)\s*button:not\(\[data-lo-floating\] \*\):not\(\[data-chat-row\]:hover\) \{/,
	);
	assert.match(
		css,
		/\[data-workspace-shell\]\s*:is\(\s*\[data-session-row\]:not\(\[data-dragging\]\):not\(:hover\)[\s\S]*?\[data-workspace-launcher\] \[data-entity\] > div:first-child:not\(:hover\),[\s\S]*?\) \{\s*background: transparent;/,
	);
	// Negative control: the round-7 gate, verbatim.
	const gated = `${css}\n[data-workspace-shell]:has([data-chat-workspace])\n\t:is([data-entity], [data-session-row])\n\tbutton { background: transparent; }\n`;
	assert.equal(chatGatedSidebarSelectors(gated).length, 1);
});
