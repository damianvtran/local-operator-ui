import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Exercise catalogue display copy independently of JSX source anchors: aliases,
// identifiers and unknown server-owned values must not be localized as keys.
const bundle = await build({
	stdin: {
		contents: [
			'export { t, setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";',
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
			`showing the best ${count} of ${count} match${count === 1 ? "" : "es"}`,
		);
	});
}

test("display headings read current locale without translating scope identifiers", () => {
	try {
		runtime.registerCatalogue("fr", {
			"ui.command_palette.palette_search.chats": "fixture chats",
			"ui.command_palette.palette_search.commands_and_pages":
				"fixture commands",
		});
		runtime.setLocale("fr");
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
			"No conversations yet",
		);
	} finally {
		runtime.clearRegisteredCatalogues();
		runtime.setLocale("en");
	}
});
