import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import {
	GUARD_TESTS,
	buildGraph,
	evidenceMarkdown,
	mentionedPaths,
	parseArgs,
	parseCounts,
	resolveSpecifier,
	selectTests,
} from "./affected-tests.mjs";
import { discoverDesktopTests } from "./desktop-test-inventory.mjs";

/*
 * `scripts/affected-tests.mjs` decides which desktop tests a pull request runs
 * now that the suite left PR CI, so a selection that quietly misses a reachable
 * test is the defect that matters most here, followed by one that quietly
 * selects the whole suite (which would hide the first behind a long green run).
 * Every case below is pinned on a scratch tree or synthetic graph so it reads
 * the same on any branch; the last cases pin the single-source guard list
 * against the real workflow and package.json.
 */

const scratch = mkdtempSync(join(tmpdir(), "affected-tests-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function tree(files) {
	const root = mkdtempSync(join(scratch, "tree-"));
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

test("an import chain, an alias and a join() mention each reach the test", () => {
	const root = tree({
		"src/renderer/src/shared/util.ts": "export const x = 1;\n",
		"src/renderer/src/features/a/widget.tsx":
			'import { x } from "@shared/util";\nexport default x;\n',
		"src/main/deep/leaf.ts": "export const y = 2;\n",
		"src/main/deep/mid.ts": 'export * from "./leaf";\n',
		"scripts/widget.test.mjs":
			'build({ entryPoints: ["src/renderer/src/features/a/widget.tsx"] });\n',
		"scripts/main.test.mjs":
			'const p = join(root, "src", "main", "deep", "mid.ts");\n',
		"scripts/evidence-walk.test.mjs":
			'readdirSync(join(root, "docs/evidence/usage"));\n',
		"docs/evidence/usage/01.png": "x",
		"src/renderer/src/orphan.ts": "export {};\n",
	});
	const graph = buildGraph(root);
	const inventory = [
		"scripts/evidence-walk.test.mjs",
		"scripts/main.test.mjs",
		"scripts/widget.test.mjs",
	];
	const pick = (paths) => selectTests(paths, { graph, inventory, exempt: {} });

	assert.deepEqual(pick(["src/renderer/src/shared/util.ts"]).affected, [
		"scripts/widget.test.mjs",
	]);
	assert.deepEqual(pick(["src/main/deep/leaf.ts"]).affected, [
		"scripts/main.test.mjs",
	]);
	assert.deepEqual(pick(["docs/evidence/usage/01.png"]).affected, [
		"scripts/evidence-walk.test.mjs",
	]);
	// A changed test selects itself.
	assert.deepEqual(pick(["scripts/main.test.mjs"]).affected, [
		"scripts/main.test.mjs",
	]);
	// Unreached is SAID, never silently widened to the suite.
	const orphan = pick(["src/renderer/src/orphan.ts"]);
	assert.deepEqual(orphan.affected, []);
	assert.deepEqual(orphan.unreached, ["src/renderer/src/orphan.ts"]);
	assert.ok(!orphan.files.includes("scripts/widget.test.mjs"));
});

test("guards are always selected; broad and inert paths are classified, not mapped", () => {
	const graph = { importers: new Map(), dirMentions: new Map() };
	const inventory = [...GUARD_TESTS, "scripts/other.test.mjs"];
	const result = selectTests(["package.json", "README.md", "pnpm-lock.yaml"], {
		graph,
		inventory,
		exempt: {},
	});
	assert.deepEqual(result.files, [...GUARD_TESTS].sort());
	assert.deepEqual(result.broad, ["package.json", "pnpm-lock.yaml"]);
	assert.deepEqual(result.inert, ["README.md"]);
	assert.ok(
		!result.files.includes("scripts/other.test.mjs"),
		"a broad change must not silently run the whole suite",
	);
});

test("a reached EXEMPT test is reported, not run", () => {
	const graph = {
		importers: new Map([["scripts/x.mjs", new Set(["scripts/x.test.mjs"])]]),
		dirMentions: new Map(),
	};
	const result = selectTests(["scripts/x.mjs"], {
		graph,
		inventory: [],
		exempt: { "scripts/x.test.mjs": "runs in the release-contracts step" },
	});
	assert.deepEqual(result.exempt, ["scripts/x.test.mjs"]);
	assert.ok(!result.files.includes("scripts/x.test.mjs"));
	assert.deepEqual(result.unreached, []);
});

test("tests are leaves: a file that only LISTS a test does not spread the selection", () => {
	const graph = {
		importers: new Map([
			["scripts/h.mjs", new Set(["scripts/a.test.mjs"])],
			["scripts/a.test.mjs", new Set(["scripts/inventory.test.mjs"])],
		]),
		dirMentions: new Map(),
	};
	const inventory = ["scripts/a.test.mjs", "scripts/inventory.test.mjs"];
	assert.deepEqual(
		selectTests(["scripts/h.mjs"], { graph, inventory, exempt: {} }).affected,
		["scripts/a.test.mjs"],
	);
});

test("specifier and mention parsing", () => {
	const exists = (p) =>
		["src/a.ts", "src/b/index.tsx", "src/renderer/src/features/f.tsx"].includes(
			p,
		);
	assert.equal(resolveSpecifier("src/x.ts", "./a", exists), "src/a.ts");
	assert.equal(resolveSpecifier("src/x.ts", "./b", exists), "src/b/index.tsx");
	assert.equal(
		resolveSpecifier("src/x.ts", "@features/f", exists),
		"src/renderer/src/features/f.tsx",
	);
	assert.equal(resolveSpecifier("src/x.ts", "react", exists), null);
	assert.deepEqual(
		[
			...mentionedPaths(
				'a("../src/main/x.ts"); join(repo, "src", "renderer", "y.tsx")',
			),
		].sort(),
		["src/main/x.ts", "src/renderer/y.tsx"],
	);
});

test("counts parse from both TAP and spec summaries", () => {
	assert.deepEqual(
		parseCounts("# tests 4\n# pass 3\n# fail 1\n# skipped 0\n"),
		{
			tests: 4,
			pass: 3,
			fail: 1,
			skipped: 0,
		},
	);
	assert.deepEqual(parseCounts("ℹ tests 2\nℹ pass 2\nℹ fail 0\n"), {
		tests: 2,
		pass: 2,
		fail: 0,
	});
});

test("the evidence block names the range, the exact command and the verdict", () => {
	const selection = {
		files: ["scripts/a.test.mjs"],
		affected: ["scripts/a.test.mjs"],
		guards: [],
		exempt: [],
		unreached: ["src/z.ts"],
		broad: [],
		inert: [],
	};
	const text = evidenceMarkdown({
		range: "abc..def",
		changed: ["src/a.ts", "src/z.ts"],
		selection,
		command: "node scripts/run-desktop-tests.mjs scripts/a.test.mjs",
		run: { exitCode: 1, counts: { tests: 3, pass: 2, fail: 1 }, wallMs: 1234 },
	});
	assert.match(text, /^## Targeted test evidence$/m);
	assert.match(text, /Range: `abc\.\.def`/);
	assert.match(text, /Changed paths: 2 /);
	assert.match(text, /\*\*FAIL\*\* \(exit 1\) - tests 3, pass 2, fail 1/);
	assert.match(text, /Wall time: 1\.2 s/);
	assert.match(text, /UNREACHED.*`src\/z\.ts`/);
	assert.ok(
		text.includes("node scripts/run-desktop-tests.mjs scripts/a.test.mjs"),
	);
});

test("argument parsing refuses ambiguity instead of guessing", () => {
	assert.throws(() => parseArgs(["--bogus"]), /Unknown flag/);
	assert.throws(() => parseArgs(["--since", "main", "src/a.ts"]), /exclusive/);
	assert.throws(() => parseArgs(["--since"]), /needs a ref/);
	assert.deepEqual(parseArgs(["./src/a.ts", "--run"]).paths, ["src/a.ts"]);
});

test("GUARD_TESTS is the one list: in the inventory, and what CI's Guards job runs", () => {
	const inventory = discoverDesktopTests();
	for (const guard of GUARD_TESTS)
		assert.ok(inventory.includes(guard), `${guard} is not a desktop test`);
	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	assert.equal(
		pkg.scripts["test:guards"],
		"node scripts/affected-tests.mjs --guards --run",
	);
	const ci = readFileSync(".github/workflows/ci.yml", "utf8");
	assert.match(
		ci,
		/\n {2}guards:\n {4}name: Guards\n[\s\S]*?run: pnpm test:guards\n/,
	);
});

test("the CLI lists a real selection without running it", () => {
	const result = spawnSync(
		process.execPath,
		["scripts/affected-tests.mjs", "--json", "scripts/ci-log-guard.mjs"],
		{
			encoding: "utf8",
		},
	);
	assert.equal(result.status, 0, result.stderr);
	const out = JSON.parse(result.stdout);
	assert.ok(out.affected.includes("scripts/ci-log-guard.test.mjs"));
	for (const guard of GUARD_TESTS) assert.ok(out.files.includes(guard));
	assert.ok(out.command.startsWith("node scripts/run-desktop-tests.mjs "));
});
