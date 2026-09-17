import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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
const {
	listDirectory,
	outsideWorkspace,
	realPathOrNull,
	PRUNE_NAMES,
	resolveUserPath,
	DIRECTORY_SCAN_LIMIT,
} = await import(
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

test("a listing returns entries sorted, with dotfiles and build directories out", async () => {
	const listing = await listDirectory(root);
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

test("a directory is a directory row, and a symlink follows the link", async () => {
	const listing = await listDirectory(root);
	const kinds = new Map(
		listing.entries.map((entry) => [entry.name, entry.directory]),
	);
	assert.equal(kinds.get("src"), true);
	assert.equal(kinds.get("app.py"), false);
	// The link points at a directory, and `stat` follows it: a terminal that asked
	// would say directory, and so does this.
	assert.equal(kinds.get("link"), true);
});

test("a name containing a space lists as one entry", async () => {
	writeFileSync(join(root, "my file.txt"), "x\n");
	const listing = await listDirectory(root);
	assert.ok(listing.entries.some((entry) => entry.name === "my file.txt"));
});

test("an unreadable directory is an error with its reason, not an empty folder", async () => {
	const listing = await listDirectory(join(root, "does-not-exist"));
	assert.deepEqual(listing.entries, []);
	assert.equal(listing.truncated, false);
	assert.equal(typeof listing.error, "string");
	assert.ok(listing.error.length > 0);
	// "Unreadable" and "empty" are different facts and the caller says so: an empty
	// directory is a listing with no error at all.
	const empty = join(root, "target");
	assert.deepEqual((await listDirectory(empty)).entries, []);
	assert.equal((await listDirectory(empty)).error, undefined);
});

test("the entry cap bounds the list and reports the truncation", async () => {
	mkdirSync(join(root, "wide"));
	for (let index = 0; index < 230; index++)
		writeFileSync(
			join(root, "wide", `f${String(index).padStart(3, "0")}.txt`),
			"",
		);
	const listing = await listDirectory(join(root, "wide"));
	assert.equal(listing.entries.length, 200);
	assert.equal(listing.truncated, true);
});

/*
 * THE PATH RULE, and the defect this test exists for. A brand-new chat's draft
 * carries the literal cwd `"~"` (`canonical-sessions-store.ts`), and the rule
 * used to expand only a cwd matching `~/…`: the bare `~` fell through, `join("~",
 * ".")` was `"~"`, and the picker ran `scandir '~'` — ENOENT, zero rows, and no
 * token could ever resolve either, because `probe-files` resolves the same way
 * and answered `~/README.md` for `@README.md`. The feature's only entry point
 * failed on the first attempt of every user who had not yet chosen a directory.
 */
test("a bare `~` working directory expands exactly like a bare `~` path", async () => {
	const home = homedir();
	assert.equal(resolveUserPath("~", undefined, home), home);
	assert.equal(resolveUserPath(".", "~", home), home);
	assert.equal(
		resolveUserPath("README.md", "~", home),
		join(home, "README.md"),
	);
	assert.equal(resolveUserPath("src/", "~", home), join(home, "src/"));
	// The `~/…` spelling keeps working, and both reach the same directory.
	assert.equal(resolveUserPath(".", "~/project", home), join(home, "project"));
	assert.equal(
		resolveUserPath("a.py", "~/project", home),
		resolveUserPath("a.py", join(home, "project"), home),
	);
	// An absolute path is taken literally and an absent cwd changes nothing.
	assert.equal(resolveUserPath("/etc/hosts", "~", home), "/etc/hosts");
	assert.equal(resolveUserPath("a.py", undefined, home), "a.py");
	// Outside the home directory a `~` mid-path is a NAME, not an expansion:
	// `/tmp/~x` is a real directory nobody's home is.
	assert.equal(resolveUserPath("a.py", "/tmp/~x", home), "/tmp/~x/a.py");
});

/*
 * THE SCAN CAP, asserted as a retention rule rather than as a row count.
 *
 * The bound is on the WORK, and the answer it produces is the one a
 * sort-then-truncate produced: the alphabetically-smallest candidates. A shape
 * that simply stopped reading at the cap would answer with whatever the
 * directory's own enumeration order happened to give, which is a listing whose
 * contents depend on the filesystem — so this builds more than twice the cap and
 * checks the 200 rows against the FIRST 200 of a full sorted listing.
 */
test("more than twice the scan cap still answers with the smallest names", async () => {
	const count = DIRECTORY_SCAN_LIMIT * 2 + 200;
	const wide = join(root, "wider");
	mkdirSync(wide);
	for (let index = 0; index < count; index++)
		writeFileSync(join(wide, `f${String(index).padStart(5, "0")}.txt`), "");
	const listing = await listDirectory(wide);
	assert.equal(listing.truncated, true);
	assert.equal(listing.entries.length, 200);
	const expected = readdirSync(wide)
		.filter((name) => !name.startsWith(".") && !PRUNE_NAMES.includes(name))
		.sort((a, b) => a.localeCompare(b))
		.slice(0, 200);
	assert.deepEqual(
		listing.entries.map((entry) => entry.name),
		expected,
	);
});

test("outsideWorkspace is the harness's containment rule", async () => {
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

test("realPathOrNull resolves a symlink, and says nothing when it cannot", async () => {
	// Compared against the resolved ROOT rather than the temp path the test built:
	// on macOS `realpath` also resolves `/var` to `/private/var`, which is exactly
	// the kind of difference that makes this function worth having.
	assert.equal(
		realPathOrNull(join(root, "link")),
		join(realPathOrNull(root), "target"),
	);
	assert.equal(realPathOrNull(join(root, "missing")), null);
});
