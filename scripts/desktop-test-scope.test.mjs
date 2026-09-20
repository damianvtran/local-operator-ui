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

test("the resolver grounds an argument in its OWN chain, and nothing else", async () => {
	const { bindingsOf, pathExpressionText } = await import(
		"./desktop-test-scope.mjs"
	);
	/*
	 * The rules, read directly rather than only through a plan. This is the shape
	 * review round 1's blocker came through - a token arriving from an expression
	 * the read does not depend on - so the answers that must be `null` are asserted
	 * beside the ones that must resolve, and the table is the module's contract with
	 * its own fail-closed path.
	 */
	const bindings = bindingsOf(
		[
			'const ROOT = "src/renderer/src";',
			'const BUNDLE = new URL("./_x.bundle.mjs", import.meta.url);',
			'const LIST = JSON.parse(readFileSync("scripts/fixtures/list.json", "utf8"));',
			'const TEMP = mkdtempSync(join(tmpdir(), "x-"));',
			"",
		].join("\n"),
	);
	const resolves = (expression) => pathExpressionText(expression, bindings);
	assert.equal(resolves('"src/main/index.ts"'), '"src/main/index.ts"');
	assert.equal(resolves("ROOT"), '"src/renderer/src"');
	assert.match(
		resolves('join(ROOT, "main/index.ts")') ?? "",
		/src\/renderer\/src/,
	);
	// A member of a path this file built, and the same member of DATA.
	assert.match(resolves("BUNDLE.href") ?? "", /_x\.bundle\.mjs/);
	assert.equal(resolves("LIST.files"), null);
	assert.equal(resolves("LIST.files[0].path"), null);
	assert.match(
		resolves('mkdtempSync(join(tmpdir(), "x-"))') ?? "",
		/mkdtempSync/,
	);
	// The BINDING carries the same marker through, so a temp directory stays
	// "outside this repository" when it arrives by name rather than inline.
	assert.match(resolves("TEMP") ?? "", /mkdtemp/);
	// A call whose result is not path text, a property of data, and a loop variable
	// over data: all three are the same answer, which is what makes the fix hold.
	assert.equal(
		resolves('JSON.parse(readFileSync("scripts/fixtures/list.json", "utf8"))'),
		null,
	);
	assert.equal(resolves("entry.path"), null);
});

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

test("a read of a path that comes from parsed data is not grounded by the fixture", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	/*
	 * THE ROUND-1 BLOCKER, as a case. `readFileSync(entry.path)` reads whatever the
	 * fixture names, and the fixture's own path is a repository literal one
	 * expression away. An expander that concatenates the source of every binding
	 * whose name occurs in the argument grounded the read on that literal, so a diff
	 * to the file the fixture points at selected NOTHING: the module printed
	 * `desktop scope [none]` and the runner exited 0 while the test that fails on
	 * that diff sat in the suite. Grounding has to come from the read's own chain -
	 * `entry` is an element of parsed data, not a path expression - so this file
	 * belongs in the unresolved class, which is selected for every diff.
	 */
	const reader = [
		'import { readFileSync } from "node:fs";',
		'const list = JSON.parse(readFileSync("scripts/fixtures/list.json", "utf8"));',
		"for (const entry of list.files) {",
		'\treadFileSync(entry.path, "utf8");',
		"}",
		"",
	].join("\n");
	withRoot(
		{
			suite: [T],
			files: {
				[T]: reader,
				"scripts/fixtures/list.json":
					'{"files":[{"path":"src/main/index.ts"}]}',
				"src/main/index.ts": "export const x = 1;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({ paths: ["src/main/index.ts"], root });
			assert.notEqual(plan.mode, SCOPE_MODES.NONE, plan.reason);
			assert.ok(
				plan.files.includes(T),
				`a file whose read comes from parsed data is not selectable: ${JSON.stringify(plan.files)}`,
			);
		},
	);
});

test("that read is unresolved whether the fixture path is a literal or not", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	/*
	 * The asymmetry the round-1 probe exposed: the file was in the unresolved class
	 * only when its own fixture path STOPPED being a repository literal
	 * (`process.env.LIST_PATH`). Both shapes have to land in the same class, because
	 * in both the read's value is data; the literal is not what makes it safe.
	 */
	const fromEnvironment = [
		'import { readFileSync } from "node:fs";',
		'const list = JSON.parse(readFileSync(process.env.LIST_PATH, "utf8"));',
		"for (const entry of list.files) {",
		'\treadFileSync(entry.path, "utf8");',
		"}",
		"",
	].join("\n");
	withRoot(
		{
			suite: [T, U],
			files: {
				[T]: fromEnvironment,
				// The control: a read whose argument IS a path expression, so the file
				// is selectable only for the source it names.
				[U]: 'import { readFileSync } from "node:fs";\nconst text = readFileSync("src/main/other.ts", "utf8");\n',
				"src/main/other.ts": "export const y = 2;\n",
				"src/main/index.ts": "export const x = 1;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({ paths: ["src/main/index.ts"], root });
			assert.notEqual(plan.mode, SCOPE_MODES.NONE, plan.reason);
			assert.ok(
				plan.files.includes(T),
				"the environment-driven reader must be selected",
			);
			assert.ok(
				!plan.files.includes(U),
				"a read of another file's path must not be dragged in",
			);
		},
	);
});

test("the fixture a test parses is a live tree, so changing it fails closed", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	/*
	 * The other half of the same probe: the fixture literal is load-bearing in the
	 * sense that the fixture is a file under `scripts/`, which a suite test invokes
	 * by path. A change to it must run the WHOLE suite - not because the reader
	 * grounds the read on it, but because a suite input moved.
	 */
	withRoot(
		{
			suite: [T],
			files: {
				[T]: [
					'import { readFileSync } from "node:fs";',
					'const list = JSON.parse(readFileSync("scripts/fixtures/list.json", "utf8"));',
					"export const files = list.files;",
					"",
				].join("\n"),
				"scripts/fixtures/list.json": '{"files":[]}',
				"src/main/index.ts": "export const x = 1;\n",
			},
		},
		(root) => {
			const plan = planDesktopTestScope({
				paths: ["scripts/fixtures/list.json"],
				root,
			});
			assert.equal(plan.mode, SCOPE_MODES.WHOLE);
			assert.match(plan.reason, /live tree|structural/);
		},
	);
});

test("a doc a suite file records is selected; a doc nothing records runs nothing", async () => {
	const { planDesktopTestScope, SCOPE_MODES } = await import(
		"./desktop-test-scope.mjs"
	);
	/*
	 * `docs/**` is prose to the classifier, and that used to be the whole decision:
	 * the plan returned NONE by category before the graph ran. A suite file that
	 * records the path is a READER of it, so the graph has to decide - and the
	 * distinction is the difference between "nothing can see this diff" and "one
	 * test can", which is the claim this module makes. Review round 1, MINOR-1.
	 */
	const reader = [
		'import assert from "node:assert/strict";',
		'import { readFileSync } from "node:fs";',
		'const text = readFileSync("docs/design/notes.md", "utf8");',
		"assert.ok(text.length > 0);",
		"",
	].join("\n");
	withRoot(
		{
			suite: [T, U],
			files: { [T]: reader, [U]: "// no references\n" },
		},
		(root) => {
			const recorded = planDesktopTestScope({
				paths: ["docs/design/notes.md"],
				root,
			});
			assert.equal(recorded.mode, SCOPE_MODES.SCOPED);
			assert.deepEqual(recorded.files, [T]);
			const unrecorded = planDesktopTestScope({
				paths: ["docs/design/other.md"],
				root,
			});
			assert.equal(unrecorded.mode, SCOPE_MODES.NONE);
			assert.match(unrecorded.reason, /classifier sets no unit flag/);
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
			assert.match(plan.reason, /no suite file reaches 1 changed path/);
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
