import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

/*
 * The scope rules, pinned one at a time.
 *
 * WHY THE FIXTURE ROOT IS SYNTHETIC. Every rule here is a claim about which
 * files a change can REACH, and the interesting cases (an import chain three
 * modules deep, a reference that cannot be grounded, a tree nothing reaches) are
 * awkward to keep true in the real repository: a test that asserted "this src
 * file is unreachable" would go red the moment somebody referenced it, which is
 * a true statement about the tree and a false alarm about this module. So the
 * graph rules run against a tree built here, and the real repository is touched
 * only where the question is about it - that its suite list, its alias table and
 * its git plumbing still answer.
 */

/** A repository-shaped tmpdir: package.json, vite aliases, sources, tests. */
function makeRoot({ suite, files, aliases = true }) {
	const root = mkdtempSync(join(tmpdir(), "lo-ui-scope-"));
	const pkg = {
		scripts: {
			"test:desktop": `node scripts/run-desktop-tests.mjs ${suite.join(" ")}`,
		},
	};
	for (const [path, contents] of Object.entries({
		"package.json": JSON.stringify(pkg, null, 2),
		...(aliases
			? {
					"electron.vite.config.js":
						'export default {\n\tresolve: {\n\t\talias: {\n\t\t\t"@renderer": resolve("src/renderer/src"),\n\t\t\t"@shared": resolve("src/renderer/src/shared"),\n\t\t},\n\t},\n};\n',
				}
			: {}),
		...files,
	})) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, contents);
	}
	return root;
}

/** Run `body(root)` and always reclaim the fixture tree. */
function withRoot(options, body) {
	const root = makeRoot(options);
	try {
		return body(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const T = "scripts/alpha.test.mjs";
const U = "scripts/beta.test.mjs";

test("a prose-only diff runs nothing, quoting the classifier's own rule", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot({ suite: [T], files: { [T]: "// no references\n" } }, (root) => {
		const plan = planDesktopTestScope({ paths: ["README.md"], root });
		assert.equal(plan.mode, SCOPE_MODES.NONE);
		assert.match(plan.reason, /classifier sets no unit flag/);
	});
});

test("a structural diff fails closed to the whole suite, naming the path", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	const structural = [
		"package.json",
		"pnpm-lock.yaml",
		"docs/evidence/frames/manifest.json",
		".github/workflows/ci.yml",
		"scripts/check-vendored.mjs",
		"tsconfig.web.json",
		"resources/icon.png",
		"something-nobody-enumerated.txt",
	];
	for (const path of structural) {
		withRoot(
			{ suite: [T], files: { [T]: "// no references\n", "src/app.ts": "" } },
			(root) => {
				const plan = planDesktopTestScope({ paths: [path], root });
				assert.equal(plan.mode, SCOPE_MODES.WHOLE, `${path} must fail closed`);
				assert.match(plan.reason, new RegExp(path.split("/")[0]));
			},
		);
	}
});

test("prose beside a source change is ignored, not fatal", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T, U],
			files: {
				[T]: 'const source = readFileSync("src/main/index.ts", "utf8");\n',
				[U]: "// nothing\n",
				"src/main/index.ts": "export const x = 1;\n",
			},
		},
		(root) => {
			// `docs` is the classifier's inert category: a README next to the change
			// must not turn a scoped run into the whole suite, which is what failing
			// closed on it would do on almost every pull request.
			const plan = planDesktopTestScope({
				paths: ["README.md", "docs/notes/thing.md", "src/main/index.ts"],
				root,
			});
			assert.equal(plan.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(plan.files, [T]);
		},
	);
});

test("a suite test file's own change selects exactly that file", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T, U],
			files: { [T]: "// nothing\n", [U]: "// nothing\n" },
		},
		(root) => {
			const plan = planDesktopTestScope({ paths: [U], root });
			assert.equal(plan.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(plan.files, [U]);
			assert.equal(plan.detail.reasons.get(U), "the test file itself changed");
		},
	);
});

test("a source path the test names literally selects it", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T, U],
			files: {
				[T]: 'const source = readFileSync("src/main/index.ts", "utf8");\n',
				[U]: "// nothing\n",
				"src/main/index.ts": "export const x = 1;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({ paths: ["src/main/index.ts"], root });
			assert.equal(plan.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(plan.files, [T]);
			assert.match(
				plan.detail.reasons.get(T),
				/references src\/main\/index\.ts/,
			);
		},
	);
});

test("a source file reached only through an import chain selects the test", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T, U],
			files: {
				// The suite's bundles are built from these `export * from` strings,
				// so the entry module is named in a template literal and never in an
				// import statement the test file itself carries.
				[T]: 'const spec = `export * from "./src/renderer/a.ts";`;\n',
				[U]: "// nothing\n",
				"src/renderer/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
				"src/renderer/b.ts": "export const b = 2;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({ paths: ["src/renderer/b.ts"], root });
			assert.equal(plan.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(plan.files, [T]);
			assert.match(plan.detail.reasons.get(T), /imports src\/renderer\/b\.ts/);
		},
	);
});

test("an alias resolves the same way the vite config maps it", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T],
			files: {
				[T]: 'const spec = `export * from "@shared/thing";`;\n',
				"src/renderer/src/shared/thing.ts": "export const thing = 3;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({
				paths: ["src/renderer/src/shared/thing.ts"],
				root,
			});
			assert.equal(plan.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(plan.files, [T]);
		},
	);
});

test("a directory listing covers the subtree beneath it", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T, U],
			files: {
				// `readdirSync(dir)` cannot say which file it reads next; the
				// reference is the subtree, which is what makes this sound.
				[T]: 'for (const name of readdirSync("src/renderer/rows")) {}\n',
				[U]: "// nothing\n",
				"src/renderer/rows/one.ts": "export const one = 1;\n",
				"src/renderer/rows/two.ts": "export const two = 2;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({
				paths: ["src/renderer/rows/two.ts"],
				root,
			});
			assert.equal(plan.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(plan.files, [T]);
		},
	);
});

test("an ungrounded file access is selected for every diff, and says so", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T, U],
			files: {
				// `chosen` comes from a fixture, so no literal in this file bounds
				// what it reads: the honest answer is "run me always", not "skip me".
				[T]: 'export function read(chosen) {\n\treturn readFileSync(chosen, "utf8");\n}\n',
				[U]: "// nothing\n",
				"src/app/other.ts": "export const other = 1;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({ paths: ["src/app/other.ts"], root });
			assert.equal(plan.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(plan.files, [T]);
			assert.match(plan.detail.reasons.get(T), /unresolved reference class/);
			assert.equal(plan.detail.alwaysSelected.length, 1);
			assert.match(plan.reason, /1 always-selected/);
		},
	);
});

test("an unresolvable import in a closure is an unresolved class, not a skip", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T, U],
			files: {
				[T]: 'const spec = `export * from "./src/renderer/a.ts";`;\n',
				[U]: "// nothing\n",
				// `a.ts` imports a module that is not there. Treating that as "no
				// dependency" is exactly the false green this module exists to stop.
				"src/renderer/a.ts":
					'import { gone } from "./missing";\nexport const a = gone;\n',
				"src/app/other.ts": "export const other = 1;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({ paths: ["src/app/other.ts"], root });
			assert.equal(plan.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(plan.files, [T]);
			assert.match(
				plan.detail.reasons.get(T),
				/unresolved reference class: no file for specifier/,
			);
		},
	);
});

test("a source change nothing reaches runs nothing, with the reachability reason", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T, U],
			files: {
				[T]: 'const spec = `export * from "./src/renderer/a.ts";`;\n',
				[U]: "// nothing at all\n",
				"src/renderer/a.ts": "export const a = 1;\n",
				"src/app/unreferenced.ts": "export const unused = 1;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({
				paths: ["src/app/unreferenced.ts"],
				root,
			});
			assert.equal(plan.mode, SCOPE_MODES.NONE);
			assert.match(plan.reason, /no suite file reaches 1 changed source path/);
			assert.deepEqual(plan.files, []);
		},
	);
});

test("an empty change set runs nothing rather than everything", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot({ suite: [T], files: { [T]: "// nothing\n" } }, (root) => {
		const plan = planDesktopTestScope({ paths: [], root });
		assert.equal(plan.mode, SCOPE_MODES.NONE);
		assert.match(plan.reason, /no changed paths/);
	});
});

test("a suite list that cannot be read fails closed, not open", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	withRoot(
		{
			suite: [T],
			files: { [T]: "// nothing\n", "src/a.ts": "export const a = 1;\n" },
		},
		(root) => {
			const plan = planDesktopTestScope({
				paths: ["src/a.ts"],
				root,
				suite: [],
			});
			assert.equal(plan.mode, SCOPE_MODES.WHOLE);
			assert.match(plan.reason, /suite list/);
		},
	);
});

test("the real repository answers: suite list, alias table, git plumbing", async () => {
	const { aliasTable, planFromGit, readSuiteFiles, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	const root = process.cwd();
	const suite = readSuiteFiles(root);
	assert.ok(
		suite.length > 100,
		`suite list looks wrong: ${suite.length} files`,
	);
	assert.ok(
		suite.every(
			(file) => file.startsWith("scripts/") && file.endsWith(".test.mjs"),
		),
		"every suite entry is a scripts/*.test.mjs",
	);

	const aliases = aliasTable(root);
	assert.deepEqual(
		aliases.map((entry) => entry.name).sort(),
		[
			"@api",
			"@assets",
			"@components",
			"@features",
			"@hooks",
			"@renderer",
			"@shared",
			"@store",
		],
		"the vite alias table is the module's resolution table too",
	);

	// A base ref that does not exist must not read as an empty diff: the whole
	// suite is the fail-closed answer, and the reason has to say why.
	const bogus = planFromGit({ root, since: "refs/heads/definitely-not-a-ref" });
	assert.equal(bogus.mode, SCOPE_MODES.WHOLE);
	assert.match(bogus.reason, /could not resolve a diff base/);

	// HEAD against itself: the change set is whatever the classifier's own git
	// plumbing reports - here usually the untracked files of a worktree, which is
	// exactly why the local form cannot be `git diff` alone. What is pinned is
	// that this module's diff IS the classifier's diff, not a second opinion.
	const self = planFromGit({ root, since: "HEAD" });
	const { collectPaths, resolveBase } = await import("./ci-scope.mjs");
	const base = resolveBase("HEAD", root);
	assert.deepEqual(
		self.detail.changed,
		[...collectPaths(base, true, root)].sort(),
	);
	if (self.detail.changed.length === 0) {
		assert.equal(self.mode, SCOPE_MODES.NONE);
	} else {
		assert.notEqual(self.mode, SCOPE_MODES.NONE);
	}
});
