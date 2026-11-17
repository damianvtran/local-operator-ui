/*
 * THE TURN BAR'S `took <duration>` CLAUSE IS KEYED.
 *
 * `condenseSentence` (canonical-transcript.tsx) builds the turn bar's spoken
 * summary - the live-region announcement when a turn condenses, and the text the
 * bar's context menu copies. It is never painted, which is why the string
 * ratchet never saw it: the clause was a template literal, `took ${duration}`.
 * It is one catalogue message now (`ui.chat.canonical.transcript.took_duration`,
 * the sibling of the painted `worked_for`), so a language chooses where the
 * duration goes.
 *
 * Two claims: English prints exactly what the template literal printed, and the
 * language reaches it. `condenseSentence` is module-private inside a very large
 * component file, so the call site is pinned by source and the message by its
 * own formatter - the same split `archive-confirm-i18n.test.mjs` uses.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { t, registerCatalogue, setLocale } from "./src/renderer/src/shared/i18n";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: { "@shared": join(process.cwd(), "src/renderer/src/shared") },
	logLevel: "silent",
});
const { t, registerCatalogue, setLocale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const KEY = "ui.chat.canonical.transcript.took_duration";

test("English is byte-identical to the old template literal", () => {
	for (const duration of ["3s", "2m 4s", "20m30s", "1h 2m"]) {
		assert.equal(t(KEY, { duration }), `took ${duration}`);
	}
});

test("the language reaches it and may reorder the duration", () => {
	registerCatalogue("fr", { [KEY]: "FR {duration} took" });
	try {
		setLocale("fr");
		assert.equal(t(KEY, { duration: "2m 4s" }), "FR 2m 4s took");
	} finally {
		setLocale("en");
	}
	assert.equal(t(KEY, { duration: "2m 4s" }), "took 2m 4s");
});

test("the call site reads the key and the template literal is gone", () => {
	const source = readFileSync(
		join(
			process.cwd(),
			"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		),
		"utf8",
	);
	assert.match(source, /"ui\.chat\.canonical\.transcript\.took_duration"/);
	assert.doesNotMatch(source, /`took \$\{/);
});
