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
const {
	clipboardFileNames,
	pasteInsertsOnlyFileNames,
	pastedTextIsOnlyFileNames,
} = await import(
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
		pastedTextIsOnlyFileNames("see notes/shot.png", ["shot.png"]),
		false,
		"a relative-looking slash is prose, not a path (review R1)",
	);
	assert.equal(
		pastedTextIsOnlyFileNames("Look at this: a/b/shot.png", ["shot.png"]),
		false,
	);
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

test("NFD and NFC spellings of one name compare equal (review R2)", () => {
	const nfc = "a b\u00e9.txt";
	assert.equal(
		pastedTextIsOnlyFileNames("file:///Users/x/a%20be%CC%81.txt", [nfc]),
		true,
	);
	assert.equal(pastedTextIsOnlyFileNames(nfc.normalize("NFD"), [nfc]), true);
	assert.equal(
		pastedTextIsOnlyFileNames("~/Desktop/word.txt", ["word.txt"]),
		true,
	);
});

/*
 * THE MEASURED EVENT SHAPE (QA round 1): a macOS file paste reaches the handler
 * as `types: ["Files"]`, `getData("text/plain") === ""`; the text Chromium will
 * insert is only on the pasteboard, which the seam reads.
 */
const filesOnly = (name) => ({
	types: ["Files"],
	getData: () => "",
	items: [fileItem(name)],
	files: [],
});

test("pasteInsertsOnlyFileNames: event text first, else the pasteboard read", () => {
	let reads = 0;
	const reader = (text) => () => {
		reads += 1;
		return text;
	};
	assert.equal(
		pasteInsertsOnlyFileNames(filesOnly("word.txt"), reader("word.txt")),
		true,
	);
	assert.equal(
		pasteInsertsOnlyFileNames(
			filesOnly("word.txt"),
			reader("please review this"),
		),
		false,
	);
	assert.equal(
		pasteInsertsOnlyFileNames(filesOnly("word.txt"), reader("")),
		true,
	);
	reads = 0;
	const withText = (text) => ({
		types: ["Files", "text/plain"],
		getData: (t) => (t === "text/plain" ? text : ""),
		items: [fileItem("word.txt")],
		files: [],
	});
	assert.equal(
		pasteInsertsOnlyFileNames(withText("word.txt"), reader("prose")),
		true,
	);
	assert.equal(
		pasteInsertsOnlyFileNames(withText("prose"), reader("word.txt")),
		false,
	);
	assert.equal(reads, 0, "event text present: the pasteboard is not read");
	const textOnly = {
		types: ["text/plain"],
		getData: () => "hi",
		items: [],
		files: [],
	};
	assert.equal(pasteInsertsOnlyFileNames(textOnly, reader("hi")), false);
	assert.equal(reads, 0, "a paste with no files never crosses to main");
	assert.equal(pasteInsertsOnlyFileNames(null, reader("x")), false);
});
