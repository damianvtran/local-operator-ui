#!/usr/bin/env node
/**
 * Exercise the production diff plugin with real CodeMirror state/decorations.
 * No DOM imitation or browser engine: rendering and accept/reject are checked
 * in the live editor fixture. esbuild bundles the module and its renderer
 * aliases in memory, as the other script-side TS harnesses do. It does not use
 * the TypeScript compiler: TypeScript 7's package exports only
 * `version`/`versionMajorMinor` from its root, so the `ts.transpileModule` this
 * script used to call does not exist there any more.
 */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EditorState } from "@codemirror/state";
import { build } from "esbuild";

const source = new URL(
	"../src/renderer/src/features/chat/components/canvas/code-editor-diff.ts",
	import.meta.url,
);
const filename = process.argv[2] || fileURLToPath(source);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
	entryPoints: [filename],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The extracted labels use the renderer's @shared/i18n alias; a bare CJS
	// transform cannot resolve it, while the desktop tests already bundle aliases.
	alias: {
		"@shared": resolve(root, "src/renderer/src/shared"),
		"@features": resolve(root, "src/renderer/src/features"),
	},
});
const { diffHighlight } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

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
