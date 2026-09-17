import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

/*
 * The two main-process facts the composer's `@` picker is built on, exercised
 * against a REAL directory tree rather than a mock.
 *
 * `listDirectory` is the only way a renderer can learn a directory's membership,
 * and `outsideWorkspace` is the fact the chip's needs-approval fill is painted
 * from. Both are asserted here because both are decisions with a right answer
 * that a reviewer would otherwise read off the source: the exclusions are the
 * harness's own listing vocabulary, and the containment rule is the harness's
 * approval gate's (`builtin.py:_resolve_workspace_path` — both sides fully
 * resolved, symlinks included).
 *
 * Bundled rather than imported because the module is TypeScript under `src/main`,
 * the pattern `desktop-contract.test.mjs` established for that tree.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/directory-listing";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { listDirectory, outsideWorkspace, realPathOrNull, PRUNE_NAMES } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

let root;

before(() => {
	root = mkdtempSync(join(tmpdir(), "lo-directory-listing-"));
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, "node_modules"));
	mkdirSync(join(root, "node_modules", "left-pad"));
	mkdirSync(join(root, ".git"));
	mkdirSync(join(root, "build"));
	writeFileSync(join(root, "app.py"), "print('hi')\n");
	writeFileSync(join(root, "README.md"), "# readme\n");
	writeFileSync(join(root, ".env"), "SECRET=1\n");
	writeFileSync(join(root, "src", "main.ts"), "export {}\n");
	// A symlink to a directory, because the harness follows the link when it asks
	// what an entry is (`DirEntry.is_dir()` does), so a link is a directory row.
	mkdirSync(join(root, "target"));
	symlinkSync(join(root, "target"), join(root, "link"));
});

after(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

test("a listing returns entries sorted, with dotfiles and build directories out", () => {
	const listing = listDirectory(root);
	assert.equal(listing.dir, root);
	assert.equal(listing.error, undefined);
	assert.equal(listing.truncated, false);
	assert.deepEqual(
		listing.entries.map((entry) => entry.name),
		["app.py", "link", "README.md", "src", "target"],
	);
	// A missing exclusion costs ROWS and cannot expand anything the gate would
	// refuse, which is why the set is copied rather than shared with the harness.
	for (const excluded of [".env", ".git", "node_modules", "build"])
		assert.equal(
			listing.entries.some((entry) => entry.name === excluded),
			false,
			`${excluded} should not be listed`,
		);
	for (const name of PRUNE_NAMES)
		assert.ok(typeof name === "string" && name.length > 0);
});

test("a directory is a directory row, and a symlink follows the link", () => {
	const listing = listDirectory(root);
	const kinds = new Map(
		listing.entries.map((entry) => [entry.name, entry.directory]),
	);
	assert.equal(kinds.get("src"), true);
	assert.equal(kinds.get("app.py"), false);
	// The link points at a directory, and `stat` follows it: a terminal that asked
	// would say directory, and so does this.
	assert.equal(kinds.get("link"), true);
});

test("a name containing a space lists as one entry", () => {
	writeFileSync(join(root, "my file.txt"), "x\n");
	const listing = listDirectory(root);
	assert.ok(listing.entries.some((entry) => entry.name === "my file.txt"));
});

test("an unreadable directory is an error with its reason, not an empty folder", () => {
	const listing = listDirectory(join(root, "does-not-exist"));
	assert.deepEqual(listing.entries, []);
	assert.equal(listing.truncated, false);
	assert.equal(typeof listing.error, "string");
	assert.ok(listing.error.length > 0);
	// "Unreadable" and "empty" are different facts and the caller says so: an empty
	// directory is a listing with no error at all.
	const empty = join(root, "target");
	assert.deepEqual(listDirectory(empty).entries, []);
	assert.equal(listDirectory(empty).error, undefined);
});

test("the entry cap bounds the list and reports the truncation", () => {
	mkdirSync(join(root, "wide"));
	for (let index = 0; index < 230; index++)
		writeFileSync(
			join(root, "wide", `f${String(index).padStart(3, "0")}.txt`),
			"",
		);
	const listing = listDirectory(join(root, "wide"));
	assert.equal(listing.entries.length, 200);
	assert.equal(listing.truncated, true);
});

test("outsideWorkspace is the harness's containment rule", () => {
	assert.equal(outsideWorkspace("/ws/a", "/ws"), false);
	assert.equal(outsideWorkspace("/ws", "/ws"), false);
	assert.equal(outsideWorkspace("/other/a", "/ws"), true);
	// `/wsx` is NOT inside `/ws`, which a prefix test without the separator would
	// get wrong — the same trap the tool-tier check documents.
	assert.equal(outsideWorkspace("/wsx/a", "/ws"), true);
	// An unanswerable question is `undefined` rather than a verdict either way,
	// and an unresolvable target fails closed the way the approval gate does.
	assert.equal(outsideWorkspace("/ws/a", null), undefined);
	assert.equal(outsideWorkspace(null, "/ws"), true);
});

test("realPathOrNull resolves a symlink, and says nothing when it cannot", () => {
	// Compared against the resolved ROOT rather than the temp path the test built:
	// on macOS `realpath` also resolves `/var` to `/private/var`, which is exactly
	// the kind of difference that makes this function worth having.
	assert.equal(
		realPathOrNull(join(root, "link")),
		join(realPathOrNull(root), "target"),
	);
	assert.equal(realPathOrNull(join(root, "missing")), null);
});
