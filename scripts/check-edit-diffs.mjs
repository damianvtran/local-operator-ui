#!/usr/bin/env node
/**
 * Exercise the production diff plugin with real CodeMirror state/decorations.
 * No DOM imitation or browser engine: rendering and accept/reject are checked
 * in the live editor fixture. esbuild transpiles the module in memory -- the
 * same dependency the other script-side TS harnesses in this repository use,
 * and no longer the TypeScript compiler: TypeScript 7's package exports only
 * `version`/`versionMajorMinor` from its root, so the `ts.transpileModule` this
 * script used to call does not exist there any more.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { transform } from "esbuild";

const source = new URL(
	"../src/renderer/src/features/chat/components/canvas/code-editor-diff.ts",
	import.meta.url,
);
const filename = process.argv[2] || fileURLToPath(source);
const compiled = (
	await transform(readFileSync(filename, "utf8"), {
		loader: "ts",
		format: "cjs",
		target: "es2022",
	})
).code;
const module = { exports: {} };
// Execute exactly the checked-in implementation, not a reimplementation of its
// ranges. createRequire resolves dependencies from this repository even when a
// before-fix source snapshot is passed as an explicit argument.
new Function("require", "module", "exports", compiled)(
	createRequire(source),
	module,
	module.exports,
);
const { diffHighlight } = module.exports;

for (const document of ["", "Existing trailing text"]) {
	for (const replacement of [
		"New line",
		"First line\nSecond line\nThird line",
	]) {
		const diff = { find: "", replace: replacement };
		const plugin = diffHighlight({
			diffs: [diff],
			currentIndex: 0,
			approvedDiffs: [],
			originalContent: document,
		});
		const state = EditorState.create({ doc: document });
		const instance = plugin.create({ state });
		const cursor = instance.decorations.iter();
		assert.equal(cursor.from, 0);
		assert.equal(cursor.to, 0);
		assert.ok(
			cursor.value.spec.widget,
			"insertion must remain inspectable as a widget",
		);
		assert.equal(cursor.value.spec.widget.newText, replacement);
		assert.equal(cursor.value.spec.widget.oldText, "");
		assert.equal(
			state.doc.toString(),
			document,
			"preview cannot modify the live buffer",
		);
	}
}

const normal = diffHighlight({
	diffs: [{ find: "old", replace: "new" }],
	currentIndex: 0,
	approvedDiffs: [],
	originalContent: "old",
}).create({ state: EditorState.create({ doc: "old" }) });
assert.equal(
	normal.decorations.size,
	1,
	"nonempty inline replacement must stay unchanged",
);
assert.equal(normal.decorations.iter().to, 3);
const multiline = diffHighlight({
	diffs: [{ find: "old\nline", replace: "new\nline" }],
	currentIndex: 0,
	approvedDiffs: [],
	originalContent: "old\nline",
}).create({ state: EditorState.create({ doc: "old\nline" }) });
assert.equal(
	multiline.decorations.size,
	2,
	"nonempty multiline mark + widget must stay unchanged",
);
const dismissed = diffHighlight(null).create({
	state: EditorState.create({ doc: "" }),
});
assert.equal(dismissed.decorations.size, 0);
console.log(
	"Edit diff regressions: 4 insertion previews + unchanged nonempty/dismissed states passed",
);
