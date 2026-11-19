import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

// Exercise catalogue display copy independently of JSX source anchors: aliases,
// identifiers and unknown server-owned values must not be localized as keys.
const bundle = await build({
	stdin: {
		contents: [
			'export { t, setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";',
			'export { SESSION_SEARCH_MAX_CHARS } from "./src/shared/desktop-contract";',
			'export { chipClause, laneStateClause, ciClause, commentClause, updatedClause, viaTag, actedTag } from "./src/renderer/src/features/code-review/code-review-model";',
			'export { PALETTE_SECTION_TITLES, SCOPE_LEGEND, parsePaletteQuery, paletteEmptyStateCopy } from "./src/renderer/src/features/command-palette/palette-search";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const runtime = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The "search terms are limited to <N> characters, so chats are matched by
 * name." line is not a stored string: it is composed in
 * `command-palette.tsx` from two catalogue fragments around the bare
 * `SESSION_SEARCH_MAX_CHARS` constant. Each fragment already carries its own
 * surrounding space ("...limited to " / " characters, ..."), so the JSX must
 * NOT insert a `{" "}` between them — that renders a doubled space the
 * pre-extraction literal never had, when the whole line was one JSX text node:
 *
 *     Search terms are limited to {SESSION_SEARCH_MAX_CHARS} characters,
 *     so chats are matched by name.
 *
 * That defect lives in the JSX, so reading only the catalogue cannot see it:
 * these assertions read the composition out of the component source, render it
 * through the shipped `t`, and compare byte-for-byte to that base literal at
 * the SHIPPED characters constant.
 */
const MATCH_LINE_COMPONENT =
	"src/renderer/src/features/command-palette/components/command-palette.tsx";
const MATCH_LINE_SOURCE = readFileSync(MATCH_LINE_COMPONENT, "utf8");

// The byte-comparison failure the negative control must reach.
const STRICT_EQUAL_FAILURE = /Expected values to be strictly equal/;

// Text the JSX children between the two fragments contribute: the constant, a
// literal space, or nothing (a JSX comment). Anything else is a shape this pin
// does not understand and must fail loudly rather than silently pass.
function matchLineMiddleText(middle, count) {
	let text = "";
	for (const match of middle.matchAll(/\{([\s\S]*?)\}/g)) {
		const inner = match[1].trim();
		if (inner.startsWith("/*")) continue;
		if (inner === '" "' || inner === "' '") {
			text += " ";
			continue;
		}
		if (inner === "SESSION_SEARCH_MAX_CHARS") {
			text += String(count);
			continue;
		}
		assert.fail(
			`unexpected JSX child between the palette match fragments: {${inner}}`,
		);
	}
	return text;
}

function composePaletteMatchLine(source) {
	runtime.setLocale("en");
	const head = runtime.t(
		"ui.command_palette.command_palette.search_terms_are_limited_to",
	);
	const tail = runtime.t(
		"ui.command_palette.command_palette.characters_so_chats_are_matched_by_name",
	);
	const headAt = source.indexOf(
		"ui.command_palette.command_palette.search_terms_are_limited_to",
	);
	const tailAt = source.indexOf(
		"ui.command_palette.command_palette.characters_so_chats_are_matched_by_name",
		headAt,
	);
	assert.ok(
		headAt !== -1 && tailAt !== -1,
		"the palette match line no longer renders both fragments together",
	);
	const headClose = source.indexOf(")}", headAt);
	assert.ok(headClose !== -1, "the lead fragment is no longer a t() call");
	const tailOpen = source.lastIndexOf("{t(", tailAt);
	assert.ok(tailOpen !== -1, "the trailing fragment is no longer a t() call");
	const middle = source.slice(headClose + 2, tailOpen);
	return (
		head + matchLineMiddleText(middle, runtime.SESSION_SEARCH_MAX_CHARS) + tail
	);
}

test("English feature copy preserves singular, plural and unknown wire fallback", () => {
	runtime.setLocale("en");
	assert.equal(runtime.chipClause(1), "1 code request");
	// The destination wiring pin follows the typed getter; its English value
	// must still match the existing rail label, independently of source shape.
	assert.equal(
		runtime.t("ui.command_palette.use_palette_sources.mesh"),
		"Mesh",
	);
	assert.equal(runtime.chipClause(3), "3 code requests");
	assert.equal(runtime.chipClause(1000), "1000 code requests");
	assert.equal(runtime.commentClause(1), "1 comment");
	assert.equal(runtime.commentClause(1000), "1000 comments");
	assert.equal(runtime.updatedClause(0, 120_000), "updated 2 min ago");
	assert.equal(
		runtime.viaTag({ path: ["coder", "reviewer"] }),
		"via subagent coder › reviewer",
	);
	assert.equal(
		runtime.actedTag({ acted: ["comment", "future-action"] }),
		"you commented, future-action",
	);
	assert.equal(
		runtime.laneStateClause({ state: "remediation_posted", round: 2 }),
		"Round 2 · remediation posted · awaiting re-review",
	);
	assert.equal(
		runtime.laneStateClause({ state: "future server state", round: 4 }),
		"Round 4 · future server state",
	);
	assert.equal(
		runtime.ciClause({ status: "success", passed: 2, total: 3 }).text,
		"2/3 passed",
	);
	assert.equal(
		runtime.t("ui.command_palette.use_palette_sources.agent_chat"),
		"Agent chat",
	);
	assert.equal(
		runtime.t("ui.command_palette.use_palette_sources.team_chat"),
		"Team chat",
	);
	assert.equal(
		runtime.t("ui.installer.status.step", { step: "3", total: "4" }),
		"Step 3 of 4",
	);
});

for (const count of [0, 1, 2]) {
	test(`counted result/comment nouns and invariant status clauses at ${count}`, () => {
		assert.equal(
			runtime.t("ui.code_review.comments.count", {
				count,
				countText: String(count),
			}),
			`${count} comment${count === 1 ? "" : "s"}`,
		);
		assert.equal(
			runtime.t("ui.code_review.tool.more", {
				count,
				countText: String(count),
				capped: "",
			}),
			`${count} more seen in tool output`,
		);
		assert.equal(
			runtime.t("ui.code_review.ci.failing", {
				count,
				countText: String(count),
			}),
			`${count} failing`,
		);
		assert.equal(
			runtime.t("ui.command_palette.matches.best", {
				countText: String(count),
				total: count,
				totalText: String(count),
			}),
			`showing the best ${count} of ${count} matches`,
		);
	});
}

test("display headings read current locale without translating scope identifiers", () => {
	/*
	 * A SYNTHETIC TAG, deliberately — this is `keyed-copy-behaviour.test.mjs`'s
	 * pattern, and the reason is that the fallback assertion below must be REAL.
	 * The shipped `fr` catalogue now carries
	 * `palette_search.no_conversations_yet`, so registering a partial `fr` map
	 * would still find the bundled French value
	 * on a miss and "falls back to English" would only be re-reading fr's own
	 * completeness. `xx` has no bundled catalogue at all, which is the one state
	 * in which "this locale has no message for this key" is true.
	 */
	try {
		runtime.registerCatalogue("xx", {
			"ui.command_palette.palette_search.chats": "fixture chats",
			"ui.command_palette.palette_search.commands_and_pages":
				"fixture commands",
			"ui.command_palette.palette_search.no_conversations_yet":
				"fixture no conversations",
		});
		runtime.setLocale("xx");
		assert.equal(runtime.PALETTE_SECTION_TITLES.chats, "fixture chats");
		assert.equal(runtime.SCOPE_LEGEND[0].label, "fixture commands");
		assert.equal(runtime.parsePaletteQuery("#retention").scope, "chat");
		assert.equal(
			runtime.paletteEmptyStateCopy({
				scope: "chat",
				hasTerms: false,
				terms: "",
				awaiting: false,
				catalogue: "ready",
			}).line,
			"fixture no conversations",
		);
	} finally {
		runtime.clearRegisteredCatalogues();
		runtime.setLocale("en");
	}
});

test("the composed palette match line is byte-identical to its base literal", () => {
	const composed = composePaletteMatchLine(MATCH_LINE_SOURCE);
	const base = `Search terms are limited to ${runtime.SESSION_SEARCH_MAX_CHARS} characters, so chats are matched by name.`;
	assert.equal(composed, base);
	// The base had exactly one space between the count and the word, so a
	// doubled space is the exact defect this pin exists to catch.
	assert.ok(
		!composed.includes("  "),
		"the composed line carries a doubled space",
	);
});

test("negative control: the pin fails when the doubled space is reinstated", () => {
	const doubled = MATCH_LINE_SOURCE.replace(
		"{SESSION_SEARCH_MAX_CHARS}",
		'{SESSION_SEARCH_MAX_CHARS}{" "}',
	);
	assert.notEqual(
		doubled,
		MATCH_LINE_SOURCE,
		"the negative control no longer finds the count to double",
	);
	assert.throws(
		() =>
			assert.equal(
				composePaletteMatchLine(doubled),
				`Search terms are limited to ${runtime.SESSION_SEARCH_MAX_CHARS} characters, so chats are matched by name.`,
			),
		STRICT_EQUAL_FAILURE,
	);
});
