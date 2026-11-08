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
	exemptCommand,
	literalPins,
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

test("a test that pins a file's text by path, suffix or name is selected without an import", () => {
	// The shapes of the real escapes: shell-path.test.mjs read src/main/index.ts
	// as text; default-on-banner.test.mjs pinned team-bridge-page.tsx by a
	// partial path; picker tests named session-model by its bare stem.
	const root = tree({
		"src/main/index.ts": "export {};\n",
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx":
			"export {};\n",
		"src/renderer/src/features/chat/session-model.ts": "export {};\n",
		"src/renderer/src/features/chat/index.ts": "export {};\n",
		"scripts/shell-path.test.mjs":
			'const src = readFileSync(join(root, "src/main/index.ts"), "utf8");\n',
		"scripts/banner.test.mjs": "read(`team-bridge/team-bridge-page.tsx`);\n",
		"scripts/picker.test.mjs": 'const owner = "session-model";\n',
		"scripts/generic.test.mjs": 'const name = "index";\n',
	});
	const graph = buildGraph(root);
	const inventory = [
		"scripts/banner.test.mjs",
		"scripts/generic.test.mjs",
		"scripts/picker.test.mjs",
		"scripts/shell-path.test.mjs",
	];
	const pick = (path) =>
		selectTests([path], { graph, inventory, exempt: {} }).affected;
	assert.deepEqual(pick("src/main/index.ts"), ["scripts/shell-path.test.mjs"]);
	assert.deepEqual(
		pick("src/renderer/src/features/team-bridge/team-bridge-page.tsx"),
		["scripts/banner.test.mjs"],
	);
	assert.deepEqual(pick("src/renderer/src/features/chat/session-model.ts"), [
		"scripts/picker.test.mjs",
	]);
	// A generic stem is not a pin: `"index"` names no file in particular.
	assert.deepEqual(pick("src/renderer/src/features/chat/index.ts"), []);
	assert.deepEqual(literalPins("src/main/index.ts", new Map()), []);
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

/*
 * Defect (PR #1750 QA round 1, M2): a reached EXEMPT test was named but no
 * command was given, and with the desktop suite off PR CI nothing ran it.
 * Mutation: drop the package.json lookup, or fall back to a bare `node --test`.
 */
test("a reached EXEMPT test carries the exact command that runs it", () => {
	const scripts = {
		"//test:tag-dialogs": "a note naming scripts/t.test.mjs",
		"test:tag-dialogs": "node scripts/run-desktop-tests.mjs scripts/t.test.mjs",
	};
	assert.equal(
		exemptCommand("scripts/t.test.mjs", { scripts }),
		"pnpm test:tag-dialogs",
	);
	assert.equal(
		exemptCommand("scripts/w.test.mjs", {
			scripts,
			reason: "`pnpm test:window-guards` - boots the REAL Electron",
		}),
		"pnpm test:window-guards",
	);
	assert.equal(
		exemptCommand("scripts/r.test.mjs", { scripts, reason: "release step" }),
		"node scripts/run-desktop-tests.mjs scripts/r.test.mjs",
	);
	// The real table: the case QA reproduced.
	assert.equal(
		exemptCommand("scripts/chat-tag-dialogs-immediate.test.mjs"),
		"pnpm test:tag-dialogs",
	);
	const graph = {
		importers: new Map([["scripts/x.mjs", new Set(["scripts/t.test.mjs"])]]),
		dirMentions: new Map(),
	};
	const selection = selectTests(["scripts/x.mjs"], {
		graph,
		inventory: [],
		exempt: { "scripts/t.test.mjs": "its own step" },
		scripts,
	});
	assert.deepEqual(selection.exemptRuns, [
		{ file: "scripts/t.test.mjs", command: "pnpm test:tag-dialogs" },
	]);
	const text = evidenceMarkdown({
		range: "a..b",
		changed: ["scripts/x.mjs"],
		selection,
		command: "node scripts/run-desktop-tests.mjs",
		run: null,
	});
	assert.match(
		text,
		/exempt.*`scripts\/t\.test\.mjs` → `pnpm test:tag-dialogs`/,
	);
});

/*
 * Defect (PR #1750 review round 1, R1-1): tree-wide guards whose subject is a
 * NEW file's absence or an INERT path (Chrome launch sites, conflict markers,
 * WebSocket construction, settings routes) were not guards, so a diff walk
 * could never select them and only the nightly would catch them.
 */
test("the tree-wide inventories a diff walk cannot reach are guards", () => {
	for (const guard of [
		"scripts/chrome-keychain.test.mjs",
		"scripts/conflict-markers.test.mjs",
		"scripts/no-websocket-plane.test.mjs",
		"scripts/settings-section-routes.test.mjs",
	])
		assert.ok(GUARD_TESTS.includes(guard), `${guard} is not a guard`);
	assert.deepEqual([...GUARD_TESTS].sort(), [...GUARD_TESTS]);
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
