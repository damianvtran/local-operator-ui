import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: [
		"src/renderer/src/shared/components/navigation/desktop-navigation-history.ts",
	],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { DesktopNavigationHistory } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const chatA = "#/chat/00000000000a";
const chatB = "#/chat/00000000000b";
const settings = "#/settings?section=general";

const offsets = (history) => [history.offset(-1), history.offset(1)];

test("window-local history begins at a deep link, even with an existing native index", () => {
	const history = new DesktopNavigationHistory();
	history.visit(8, chatA, "pop");
	assert.deepEqual(offsets(history), [undefined, undefined]);
	history.visit(9, chatB, "push");
	history.visit(10, settings, "push");
	assert.deepEqual(offsets(history), [-1, undefined]);
	history.visit(9, chatB, "pop");
	assert.deepEqual(offsets(history), [-1, 1]);
	history.visit(8, chatA, "pop");
	assert.deepEqual(offsets(history), [undefined, 1]);
});

test("forward survives REPLACE and is cut by a real navigation after Back", () => {
	const history = new DesktopNavigationHistory();
	history.visit(0, chatA, "pop");
	history.visit(1, chatB, "push");
	history.visit(2, settings, "push");
	history.visit(1, chatB, "pop");
	history.visit(1, chatB, "replace");
	assert.deepEqual(offsets(history), [-1, 1]);
	history.visit(2, "#/projects/item", "push");
	assert.deepEqual(offsets(history), [-1, undefined]);
	history.visit(1, chatB, "pop");
	assert.deepEqual(offsets(history), [-1, 1]);
});

test("refused opens and redirects do not produce duplicate stops", () => {
	const history = new DesktopNavigationHistory();
	history.visit(0, chatA, "pop");
	history.visit(1, chatB, "push");
	history.visit(2, "#/not-available", "push");
	history.visit(2, chatB, "replace");
	assert.deepEqual(offsets(history), [-2, undefined]);
	history.visit(0, chatA, "pop");
	assert.deepEqual(offsets(history), [undefined, 1]);
	history.visit(1, chatB, "pop");
	assert.deepEqual(offsets(history), [-1, undefined]);
});

test("an unindexed external hash change does not expose another page's history", () => {
	const history = new DesktopNavigationHistory();
	history.visit(1, chatA, "push");
	history.visit(2, chatB, "push");
	history.visit(undefined, settings, "pop");
	assert.deepEqual(offsets(history), [undefined, undefined]);
	history.visit(1, "#/library/assets/one", "push");
	assert.deepEqual(offsets(history), [undefined, undefined]);
});
