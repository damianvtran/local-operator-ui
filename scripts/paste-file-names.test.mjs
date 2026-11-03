import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE "IS THIS TEXT ONLY THE PASTED FILES' NAMES?" PREDICATE (issue #1573),
 * pinned on its own because three paste handlers - the shared chat composer and
 * both Team Bridge composers - cancel the browser's text insert on its word, and
 * a false "yes" would silently drop prose the operator meant to paste.
 *
 * The positive shapes are the ones a file copy delivers: macOS Finder puts the
 * bare name(s) on `text/plain`, one per line; other sources spell them as paths
 * or `file://` URLs (measured on this machine: `osascript -e 'set the clipboard
 * to (POSIX file ...)'` writes `public.file-url` = `file:///.../word.txt`).
 */
const bundle = await build({
	entryPoints: ["src/renderer/src/shared/utils/paste-utils.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { clipboardFileNames, pastedTextIsOnlyFileNames } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const fileItem = (name) => ({
	kind: "file",
	getAsFile: () => ({ name }),
});

test("only the names: bare, multi-line (LF/CRLF/CR), padded, path and file:// URL", () => {
	assert.equal(pastedTextIsOnlyFileNames("word.txt", ["word.txt"]), true);
	assert.equal(pastedTextIsOnlyFileNames("  word.txt\n", ["word.txt"]), true);
	for (const sep of ["\n", "\r\n", "\r"])
		assert.equal(
			pastedTextIsOnlyFileNames(`a.png${sep}b.pdf`, ["a.png", "b.pdf"]),
			true,
			JSON.stringify(sep),
		);
	assert.equal(
		pastedTextIsOnlyFileNames("/Users/me/Desktop/word.txt", ["word.txt"]),
		true,
	);
	assert.equal(
		pastedTextIsOnlyFileNames("file:///Users/me/My%20Doc.pdf", ["My Doc.pdf"]),
		true,
	);
	assert.equal(
		pastedTextIsOnlyFileNames("C:\\Users\\me\\word.txt", ["word.txt"]),
		true,
	);
});

test("real text is never read as names (the prose must survive)", () => {
	assert.equal(
		pastedTextIsOnlyFileNames("please review this", ["word.txt"]),
		false,
	);
	assert.equal(
		pastedTextIsOnlyFileNames("see word.txt please", ["word.txt"]),
		false,
		"a name with words around it is prose",
	);
	assert.equal(
		pastedTextIsOnlyFileNames("word.txt\nand also this", ["word.txt"]),
		false,
		"one extra line keeps the whole text",
	);
	assert.equal(
		pastedTextIsOnlyFileNames("other.txt", ["word.txt"]),
		false,
		"a different name is not the pasted file's",
	);
	assert.equal(pastedTextIsOnlyFileNames("word.txt", []), false, "no files");
	assert.equal(pastedTextIsOnlyFileNames("", ["word.txt"]), false, "no text");
	assert.equal(pastedTextIsOnlyFileNames(" \n ", ["word.txt"]), false);
	assert.equal(
		pastedTextIsOnlyFileNames("file://%E0%A4%A", ["word.txt"]),
		false,
		"a malformed URL is text, not a name",
	);
});

test("clipboardFileNames reads file items (not strings), else files, never both", () => {
	assert.deepEqual(
		clipboardFileNames({
			items: [fileItem("a.png"), { kind: "string", getAsFile: () => null }],
			files: [{ name: "a.png" }],
		}),
		["a.png"],
	);
	assert.deepEqual(
		clipboardFileNames({ items: [], files: [{ name: "b.pdf" }] }),
		["b.pdf"],
	);
	assert.deepEqual(clipboardFileNames(null), []);
});
