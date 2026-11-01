import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Exercise the production sentence builder and render its result, rather than
// testing the join key alone: a translated key cannot protect an unwired caller.
const bundle = await build({
	stdin: {
		contents: `
			export { builtinOfferSentence } from "./src/renderer/src/features/chat/components/builtin-offer-sentence";
			export { clearRegisteredCatalogues, registerCatalogue, setLocale } from "@shared/i18n";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { "@shared": "./src/renderer/src/shared" },
	define: { "import.meta.env": "{}" },
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const render = (names) =>
	renderToStaticMarkup(
		createElement(
			"p",
			null,
			mod.builtinOfferSentence(names.map((name) => ({ name }))),
		),
	);

// Synthetic joiners are test-only catalogue overrides, NOT shipped translations.
// Distinct pair/middle/end shapes catch flattening the joiner to one word and
// losing the separators or the serial-comma choice in the three-item case.
test("offer renders locale-owned pair, middle and final separators", () => {
	mod.setLocale("fr");
	mod.registerCatalogue("fr", {
		"ui.chat.sidebar.agents.builtin_offer": "{count, number}: {list}",
		"ui.chat.sidebar.agents.list_join":
			"{position, select, pair {{head} [PAIR] {tail}} middle {{head}、{tail}} other {{head}、[END] {tail}}}",
	});
	try {
		assert.equal(
			render(["Coder", "Reviewer"]),
			"<p>2: Coder [PAIR] Reviewer</p>",
		);
		assert.equal(
			render(["Coder", "Reviewer", "Designer"]),
			"<p>3: Coder、Reviewer、[END] Designer</p>",
		);
		assert.equal(render(["A", "B", "C", "D"]), "<p>4: A、B、C、[END] D</p>");
		assert.equal(render([]), "<p>0: </p>");
		assert.equal(render(["Coder"]), "<p>1: Coder</p>");
	} finally {
		mod.clearRegisteredCatalogues();
		mod.setLocale("en");
	}
});

test("English control for two and three names", () => {
	assert.equal(
		render(["Coder", "Reviewer"]),
		"<p>Two built-in agents are ready to install — Coder and Reviewer. You can edit them once installed.</p>",
	);
	assert.equal(
		render(["Coder", "Reviewer", "Designer"]),
		"<p>Three built-in agents are ready to install — Coder, Reviewer and Designer. You can edit them once installed.</p>",
	);
});

test("sidebar still renders the tested sentence builder", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	assert.ok(
		source.includes(
			'import { builtinOfferSentence } from "./builtin-offer-sentence"',
		),
	);
	assert.ok(source.includes("{builtinOfferSentence(availableBuiltins)}"));
});
