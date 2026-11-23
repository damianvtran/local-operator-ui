import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Board column headers with a status `Object.prototype` answers for (QA round
 * 3, Q10).
 *
 * The defect was one plain-object lookup in the column header
 * (`COLUMN_NOTE[column.status]`): `__proto__` handed React the prototype object
 * (minified error #31) and took the whole app down. The model's own helpers
 * were already guarded, so only the header expression itself reaches it. This
 * file therefore executes the SHIPPED header JSX and note table, extracted from
 * `project-board.tsx` by unique source boundaries (the
 * `project-presentation-i18n.test.mjs` pattern), and renders them with SSR.
 *
 * WHY EXTRACTION AND NOT THE WHOLE `ProjectBoard`: bundling the full component
 * pulls in the entire UI kit, router and query stack, and a run of that shape
 * was killed at 5.4 GB on this machine. The extracted span is the exact
 * expression the board renders, which is what the defect lives in. It is not
 * layout or native evidence. The milestone and filter-token label helpers carry
 * the same own-key guard and are pinned at the bottom.
 */
const boardPath = resolve(
	"src/renderer/src/features/projects/components/project-board.tsx",
);
const board = readFileSync(boardPath, "utf8");
const notes = [...board.matchAll(/^const COLUMN_NOTE\b[\s\S]*?^\};/gm)];
assert.equal(notes.length, 1, "unique production COLUMN_NOTE boundary");
// The guard helper: present after the Q10 fix, absent before it.
const helper = [...board.matchAll(/^function columnNote\([\s\S]*?^\}/gm)];
const headers = [
	...board.matchAll(
		/<span className="flex min-w-0 items-baseline gap-2">[\s\S]*?<\/span>\s*\)\}\s*<\/span>/g,
	),
];
assert.equal(headers.length, 1, "unique production column-header label span");

const bundle = await build({
	stdin: {
		contents: `import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { t, setLocale } from "./src/i18n";
import { projectStatusMeta, milestoneStatusMeta } from "./src/renderer/src/features/projects/project-model";
import { filterOptionLabel } from "./src/renderer/src/features/projects/project-filters";
${notes[0][0]}
${helper[0]?.[0] ?? ""}
export { setLocale, milestoneStatusMeta, filterOptionLabel };
export const header = (status) => {
	const column = { status, projects: [] };
	const meta = projectStatusMeta(status);
	return renderToStaticMarkup(${headers[0][0]});
};`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	banner: {
		js: `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(import.meta.url)});`,
	},
	jsx: "automatic",
	write: false,
	alias: {
		"@shared/i18n": resolve("src/i18n/index.ts"),
		"@shared": resolve("src/renderer/src/shared"),
	},
});
const { setLocale, header, milestoneStatusMeta, filterOptionLabel } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

const INHERITED = ["__proto__", "constructor", "toString"];
const label =
	/<span class="truncate text-body-sm font-medium text-ink">(.*?)<\/span>/;
const note = /<span class="truncate text-meta text-ink-muted">(.*?)<\/span>/;

for (const locale of ["en", "fr"]) {
	for (const status of INHERITED) {
		test(`${locale}: a "${status}" column header renders its literal label and no note`, () => {
			setLocale(locale);
			const markup = header(status);
			assert.equal(markup.match(label)?.[1], status);
			assert.equal(markup.match(note), null, "no inherited member as note");
		});
	}
	test(`${locale}: a known column keeps its translated note`, () => {
		setLocale(locale);
		const markup = header("active");
		assert.equal(
			markup.match(note)?.[1],
			locale === "fr" ? "En cours" : "In flight",
		);
	});
}

test("milestone and filter-token labels keep inherited names literal", () => {
	setLocale("en");
	for (const status of INHERITED) {
		assert.deepEqual(milestoneStatusMeta(status), {
			label: status,
			variant: "neutral",
		});
		assert.equal(filterOptionLabel("progress", status), status);
	}
	assert.equal(milestoneStatusMeta("overdue").variant, "warning");
	assert.equal(filterOptionLabel("progress", "stale"), "Stale");
});
