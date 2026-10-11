/**
 * The supplement block's DOM contract, asked of the SHIPPED row.
 *
 * WHAT THIS FILE IS FOR (design round 1, D1's pin): while the block's own turn
 * renders condensed the block is ONE PASSIVE LINE — `[data-supplement-condensed]`
 * on it, no `[data-supplement-slot]`, no iframe, and its whole text is the line
 * itself with nothing else — and the expanded form is what carries the
 * slots and the disclosures. It also pins the condensed copy table's bytes
 * (`condensedBlockLine`'s arms, rendered) and the graphics disclosure's
 * singular arm (`Show all 1 graphic`, U7).
 *
 * WHY STATIC MARKUP AND NOT A MOUNT. The contract is about what the row
 * RENDERS; `renderToStaticMarkup` runs every render pass and no effect, so a
 * slot in the markup means the row decided to show one — and a document fetch,
 * which is an effect, cannot muddy the reading. The mount-level transitions
 * (a bar opening restores the block) are `turn-collapse-model.test.mjs`'s
 * `runIsCondensed` case and the transcript's own behaviour suite; the pixels
 * are the frames.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: [
			'export { SupplementRow } from "./src/renderer/src/features/chat/canonical/supplement-row";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_supplement-row-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(async () => {
	await unlink(bundlePath);
});
const { SupplementRow } = await import(bundlePath.href);

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_791_000_060;
const digest = (seed) =>
	createHash("sha256").update(seed).digest("hex").slice(0, 32);
const file = (path, name, sizeBytes, kind = "markdown") => ({
	path,
	name,
	kind,
	sizeBytes,
	mtime: 1_790_999_940,
	why: "written by write",
});
const component = (seed, title, heightHint) => ({
	attachment: digest(seed),
	title,
	source: "bench.csv rows 1-4 (tool result of bash at 10:41)",
	mime: "text/html",
	heightHint,
});
const supplement = (over) => ({
	kind: "supplement",
	ts: TS,
	anchor: "a1",
	job: "0123456789ab",
	version: 1,
	state: "done",
	files: [],
	filesMore: 0,
	more: [],
	components: [],
	error: "",
	dismissed: false,
	live: false,
	...over,
});
const render = (record, condensed) =>
	renderToStaticMarkup(
		h(SupplementRow, {
			record,
			sessionId: "5ea1face0001",
			condensed,
		}),
	);
const textOf = (markup) =>
	markup
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&middot;/g, "·")
		.replace(/\s+/g, " ")
		.trim();

/* -------------------------- the condensed arms --------------------------- */

test("a condensed block is one passive line: no slot, no iframe, nothing else", () => {
	const arms = [
		// components only
		[supplement({ components: [component("one", "Chart", 320)] }), "1 graphic"],
		[
			supplement({
				components: [
					component("one", "Chart", 320),
					component("two", "Table", 320),
				],
			}),
			"2 graphics",
		],
		// files only, ≤ 2: the existing one-liner, unchanged
		[
			supplement({
				files: [
					file("reports/latency.md", "latency.md", 4120),
					file("data/bench.csv", "bench.csv", 913, "csv"),
				],
			}),
			"2 files: latency.md, bench.csv",
		],
		// files only, > 2: counts, not names
		[
			supplement({
				files: [
					file("reports/latency.md", "latency.md", 4120),
					file("data/bench.csv", "bench.csv", 913, "csv"),
				],
				filesMore: 5,
				more: ["a/q1.md", "a/q2.md", "a/q3.md", "a/q4.md", "a/q5.md"],
			}),
			"7 files",
		],
		// mixed: both clauses, the design's separator
		[
			supplement({
				files: [
					file("reports/latency.md", "latency.md", 4120),
					file("data/bench.csv", "bench.csv", 913, "csv"),
				],
				components: [component("one", "Chart", 320)],
			}),
			"2 files · 1 graphic",
		],
	];
	for (const [record, line] of arms) {
		const markup = render(record, true);
		assert.ok(
			markup.includes("data-supplement-condensed"),
			`the condensed line must be pinned on the DOM: ${line}`,
		);
		assert.ok(
			!markup.includes("data-supplement-slot"),
			`no slot under a condensed block: ${line}`,
		);
		assert.ok(
			!markup.includes("<iframe"),
			`no iframe under a condensed block: ${line}`,
		);
		assert.equal(textOf(markup), line, `whole text is the one line: ${line}`);
	}
});

test("a not-settled condensed block leads with its counts and keeps its actions", () => {
	const record = supplement({
		state: "queued",
		live: true,
		files: [
			file("reports/latency.md", "latency.md", 4120),
			file("data/bench.csv", "bench.csv", 913, "csv"),
		],
	});
	const markup = render(record, true);
	/*
	 * The separators are their OWN spans and the gaps between segments are flex
	 * gaps — the state line's existing grammar (its measured children were
	 * shimmer / copy / `·` / `Adjust…` / `Cancel` on an 8px pitch). The dots are
	 * therefore in the TEXT and the spaces are not; the assertion pins exactly
	 * that: three `·`, the counts clause leading, and both actions present.
	 */
	assert.equal(textOf(markup), "2 files·Preparing highlights…·Adjust…Cancel");
	assert.ok(!markup.includes("data-supplement-slot"));
	assert.ok(!markup.includes("data-supplement-file="));
});

test("the expanded form carries the slots and the disclosures' own grammar", () => {
	// Two 480px hints against the static-markup fallback budget (900): the
	// second is behind the disclosure, singularized for one (U7).
	const record = supplement({
		components: [
			component("one", "Chart", 480),
			component("two", "Table", 480),
		],
	});
	const markup = render(record, false);
	assert.ok(markup.includes("data-supplement-slot"));
	assert.ok(markup.includes("Show all 1 graphic"), markup.slice(0, 400));
	assert.ok(!markup.includes("Show all 1 graphics"));
	assert.ok(markup.includes("data-supplement-show-all"));
	// The files disclosure, its own grammar: a chevron slot in the app's
	// disclosure idiom and the toggle's collapsed copy.
	const withFiles = render(
		supplement({
			files: [
				file("reports/latency.md", "latency.md", 4120),
				file("data/bench.csv", "bench.csv", 913, "csv"),
			],
			filesMore: 2,
			more: ["reports/q3.md", "reports/q4.md"],
		}),
		false,
	);
	assert.ok(withFiles.includes("2 more files"));
	assert.ok(withFiles.includes("data-supplement-more"));
	// The tail rows stay unmounted while collapsed; the toggle owns them.
	assert.ok(!withFiles.includes("q3.md"));
});
