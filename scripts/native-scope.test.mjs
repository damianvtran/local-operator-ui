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
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	NATIVE_EXACT,
	NATIVE_PREFIXES,
	deriveNativeSurfaces,
	isNativeSurface,
	main,
	nativeSurfacePaths,
	requiresNativeProof,
} from "./native-scope.mjs";

const SCRIPT = fileURLToPath(new URL("./native-scope.mjs", import.meta.url));

/**
 * The queue-wide defect these tests pin, in the two directions that matter.
 *
 * The bug: `native-proofs` was gated on `needs.changes.outputs.pack`, and the
 * gate path runs the classifier with `--all`, where `pack` is true for every
 * diff. Runs 45197525243 and 45111954815 each ran the macOS lane for a diff
 * with no native surface. The fix is only correct if it works BOTH ways: a
 * backend-only diff must stop selecting the lane, and a diff that really can
 * change the packed app must still select it. A predicate that only proved the
 * first half would silently stop proving native behaviour altogether.
 */

// The negative control that pays for the change: a real backend diff, taken
// from the repository's own history rather than invented, must not select the
// lane.
const BACKEND_ONLY_DIFF = [
	"src/renderer/src/features/chat/chat-model.ts",
	"src/renderer/src/features/chat/chat-model.test.ts",
	"i18n/locales/en-US.json",
	"docs/renderer/chat.md",
];

test("a backend-only diff does not select the native lane", () => {
	assert.equal(requiresNativeProof(BACKEND_ONLY_DIFF), false);
	assert.deepEqual(nativeSurfacePaths(BACKEND_ONLY_DIFF), []);
});

test("a shared-policy diff selects the lane", () => {
	// The reviewer's counter-example: the macOS entitlement policy lives under
	// `src/shared`, is read by `src/main/update-install.ts`, and 61 main-process
	// files import from that tree. A diff confined to it can change what a signed
	// app is allowed to do.
	assert.equal(
		requiresNativeProof(["src/shared/mac-os-entitlement-policy.ts"]),
		true,
	);
});

test("a runtime-action diff selects the lane", () => {
	// The macOS job runs `./.github/actions/electron-runtime`, so the action is
	// part of what the proof executes.
	assert.equal(
		requiresNativeProof([".github/actions/electron-runtime/action.yml"]),
		true,
	);
});

test("the workflow wires the scope to the lane, by name", () => {
	// Renaming the step id, the output or the `if:` expression would silently put
	// every backend PR back on a macOS runner with every test still green - the
	// exact regression this file exists for. Pin the three links.
	const workflow = readFileSync(
		new URL("../.github/workflows/full-suite.yml", import.meta.url),
		"utf8",
	);
	assert.match(workflow, /native: \$\{\{ steps\.native\.outputs\.native \}\}/u);
	assert.match(workflow, /id: native\n/);
	assert.match(workflow, /node scripts\/native-scope\.mjs/u);
	assert.match(workflow, /needs\.changes\.outputs\.native != 'false'/u);
	assert.doesNotMatch(
		workflow,
		/needs\.changes\.outputs\.pack != 'false'/u,
		"pack is true for every diff here; gating the lane on it is the defect",
	);
});

test("a native-touching diff still selects the lane", () => {
	for (const path of [
		"src/main/browser/ownership.ts",
		"src/preload/index.ts",
		"build/entitlements.mac.plist",
		"resources/icon.icns",
		"scripts/model-uncertainty-native.mjs",
		"package.json",
		"pnpm-lock.yaml",
		"electron.vite.config.js",
		".github/workflows/full-suite.yml",
	]) {
		assert.equal(
			requiresNativeProof([path]),
			true,
			`${path} must select the lane`,
		);
	}
});

test("one native path in a large diff still selects the lane", () => {
	const changed = [...BACKEND_ONLY_DIFF, "src/main/app-icon-badge.ts"];
	assert.equal(requiresNativeProof(changed), true);
	assert.deepEqual(nativeSurfacePaths(changed), ["src/main/app-icon-badge.ts"]);
});

test("unknown scope is never read as a skip", () => {
	// No list at all, and an empty list, are both "we could not tell". Treating
	// either as false would let a broken diff step quietly disable the lane.
	assert.equal(requiresNativeProof([]), true);
	assert.equal(requiresNativeProof(undefined), true);
	assert.equal(requiresNativeProof(null), true);
});

test("surface matching is exact-prefix, not substring", () => {
	// A renderer file that merely CONTAINS "src/main" in its name is not main.
	assert.equal(isNativeSurface("src/renderer/src/main-view.ts"), false);
	assert.equal(isNativeSurface("docs/src/main/notes.md"), false);
	assert.equal(
		isNativeSurface("./package.json"),
		true,
		"a leading ./ is normalised",
	);
	assert.equal(isNativeSurface(""), false);
});

test("the surface lists stay small enough to audit", () => {
	// A prefix list is a reviewable claim about what can change the packed app.
	// If it grows past this, the next person should read it rather than accept it.
	assert.ok(
		NATIVE_PREFIXES.length <= 12,
		`prefixes: ${NATIVE_PREFIXES.length}`,
	);
	assert.ok(NATIVE_EXACT.size <= 15, `exact: ${NATIVE_EXACT.size}`);
});

test("the CLI writes the output file the workflow reads", () => {
	const directory = mkdtempSync(join(tmpdir(), "native-scope-"));
	try {
		const changed = join(directory, "changed.txt");
		const output = join(directory, "out.txt");
		const summary = join(directory, "summary.md");

		writeFileSync(changed, `${BACKEND_ONLY_DIFF.join("\n")}\n`);
		const skip = spawnSync(
			process.execPath,
			[
				SCRIPT,
				"--changed-file",
				changed,
				"--github-output",
				output,
				"--summary",
				summary,
			],
			{ encoding: "utf8" },
		);
		assert.equal(skip.status, 0, skip.stderr);
		assert.match(skip.stdout, /native=false/);

		writeFileSync(changed, "src/main/browser/ownership.ts\n");
		const run = spawnSync(
			process.execPath,
			[SCRIPT, "--changed-file", changed, "--github-output", output],
			{ encoding: "utf8" },
		);
		assert.equal(run.status, 0, run.stderr);
		assert.match(run.stdout, /native=true/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("an unreadable list fails closed", () => {
	const output = join(tmpdir(), `native-scope-missing-${process.pid}.txt`);
	const result = spawnSync(
		process.execPath,
		[
			SCRIPT,
			"--changed-file",
			"/nonexistent/changed.txt",
			"--github-output",
			output,
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(
		result.stdout,
		/native=true/,
		"an unreadable list must run the lane",
	);
	rmSync(output, { force: true });
});

test("no list and an explicit force both report through stdout", () => {
	// The workflow reads the output file, but the log line is what a human reads
	// when a run goes the wrong way. Both answers must be legible there.
	const capture = (argv) => {
		const chunks = [];
		const original = console.log;
		console.log = (...parts) => chunks.push(parts.join(" "));
		try {
			assert.equal(main(argv), 0);
		} finally {
			console.log = original;
		}
		return chunks.join("\n");
	};

	assert.match(capture([]), /native=true \(no --changed-file given/);
	assert.match(capture(["--force", "false"]), /native=false/);
	assert.match(capture(["--force", "true"]), /native=true/);
});

// ---------------------------------------------------------------------------
// scripts/ and .github/ are derived, not whole prefixes.
//
// #2066 changed only CI plumbing and still selected the macOS lane, because
// `scripts/` and `.github/` were whole prefixes. Every narrowing test below
// FAILS against the prefix classifier (a7d1e70187a), which is the point: it
// proves the test discriminates. Every control below must stay `true` on both.
// ---------------------------------------------------------------------------

/** #2066's exact changed-path list (gh pr view 2066 --json files). */
const PR_2066 = [
	".github/workflows/ci.yml",
	"scripts/check-named-test.mjs",
	"scripts/check-named-test.test.mjs",
	"scripts/entry-point.test.mjs",
];

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("#2066's CI-only diff does not select the native lane", () => {
	assert.deepEqual(nativeSurfacePaths(PR_2066), []);
	assert.equal(requiresNativeProof(PR_2066), false);
});

test("the lane's rig, its imports and the gating stay native", () => {
	const notificationsScene = readFileSync(
		join(ROOT, "scripts/notifications-app-scene.mjs"),
		"utf8",
	);
	// The transitive control is only meaningful while the rig really imports it.
	assert.match(notificationsScene, /from "\.\/python-child-env\.mjs"/u);
	assert.match(
		readFileSync(join(ROOT, "scripts/model-uncertainty-native.mjs"), "utf8"),
		/"model_uncertainty_backend\.py"/u,
	);
	for (const path of [
		// executed by the native-proofs job
		"scripts/notifications-app-scene.mjs",
		// spawned by the lane's model-uncertainty rig through a path literal
		"scripts/model_uncertainty_backend.py",
		// imported by that rig, never named in the workflow
		"scripts/python-child-env.mjs",
		// electron-builder afterPack hook, and a module it imports
		"scripts/after-pack.mjs",
		"scripts/bundled-runtime-layout.mjs",
		// the classifier and the verdict: the gating for this lane (D14)
		"scripts/native-scope.mjs",
		"scripts/merge-gate-verdict.mjs",
		".github/workflows/full-suite.yml",
		".github/actions/electron-runtime/action.yml",
		// package.json `files` ships `bin` (no entry of it is under scripts/)
		"bin/local-operator-ui.js",
		"package.json",
		"src/main/x.ts",
		"src/preload/x.ts",
	]) {
		assert.equal(isNativeSurface(path), true, `${path} must select the lane`);
	}
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	assert.ok(pkg.files.includes("bin"), "the bin control rests on `files`");
});

test("other workflows and unexecuted tests under the derived trees are not native", () => {
	for (const path of [
		".github/workflows/ci.yml",
		".github/harness-paths",
		"scripts/native-scope.test.mjs",
		"scripts/check-named-test.mjs",
	]) {
		assert.equal(isNativeSurface(path), false, `${path} is CI-only`);
	}
});

/**
 * A minimal repository with the same shape as this one, so derivation rules can
 * be proved against inputs the test controls (and broken on purpose).
 */
function fixtureRepo({ laneRun = "node scripts/scene.mjs" } = {}) {
	const root = mkdtempSync(join(tmpdir(), "native-scope-root-"));
	const write = (path, text) => {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), text);
	};
	write(
		"package.json",
		JSON.stringify({
			files: ["bin", "scripts/shipped"],
			scripts: {
				build: "electron-vite build",
				pack: "pnpm run build && electron-builder --dir",
				lint: "node scripts/lint-only.mjs",
			},
			build: { afterPack: "scripts/after.mjs" },
		}),
	);
	write(
		".github/workflows/full-suite.yml",
		[
			"jobs:",
			"  changes:",
			"    steps:",
			"      - run: node scripts/native-scope.mjs",
			"  native-proofs:",
			"    steps:",
			"      - uses: ./.github/actions/rt",
			"      # node scripts/commented-out.mjs",
			`      - run: ${laneRun}`,
			"  merge-gate:",
			"    steps:",
			"      - run: node scripts/verdict.mjs",
			"",
		].join("\n"),
	);
	write(".github/actions/rt/action.yml", "runs:\n  using: composite\n");
	// The scene spawns a Python helper by literal (as model-uncertainty-native
	// does) and names a test file by literal (as inventory scripts do): only
	// the first is a surface.
	write(
		"scripts/scene.mjs",
		'import { x } from "./helper.mjs";\nconst py = join(here, "backend.py");\nconst t = "scripts/listed.test.mjs";\n',
	);
	write("scripts/backend.py", "import json\nimport backend_util\n");
	write("scripts/backend_util.py", "\n");
	write("scripts/listed.test.mjs", "\n");
	write("scripts/helper.mjs", "export const x = 1;\n");
	write("scripts/shipped/run.mjs", "\n");
	write("scripts/after.mjs", "\n");
	write("scripts/lint-only.mjs", "\n");
	return root;
}

test("each derivation source is read, and nothing else is", () => {
	const root = fixtureRepo();
	try {
		const derived = deriveNativeSurfaces(root);
		assert.equal(derived.ok, true, derived.errors.join("; "));
		const native = (path) => isNativeSurface(path, derived);
		assert.equal(native("scripts/scene.mjs"), true, "lane run body");
		assert.equal(native("scripts/helper.mjs"), true, "transitive import");
		assert.equal(native("scripts/shipped/run.mjs"), true, "package `files`");
		assert.equal(native("scripts/after.mjs"), true, "afterPack hook");
		assert.equal(native("scripts/native-scope.mjs"), true, "changes job");
		assert.equal(native("scripts/verdict.mjs"), true, "merge-gate job");
		assert.equal(native(".github/actions/rt/action.yml"), true, "used action");
		assert.equal(
			native("scripts/lint-only.mjs"),
			false,
			"non-packaging script",
		);
		assert.equal(
			native("scripts/commented-out.mjs"),
			false,
			"a comment runs nothing",
		);
		assert.equal(native("scripts/backend.py"), true, "spawned by literal");
		assert.equal(native("scripts/backend_util.py"), true, "python import");
		assert.equal(
			native("scripts/listed.test.mjs"),
			false,
			"a JS literal is a name, not an execution",
		);
		assert.equal(native(".github/workflows/ci.yml"), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a new script in the native-proofs job is native without editing the classifier", () => {
	const before = fixtureRepo();
	const after = fixtureRepo({
		laneRun: "node scripts/scene.mjs && node scripts/foo.mjs",
	});
	try {
		assert.equal(
			isNativeSurface("scripts/foo.mjs", deriveNativeSurfaces(before)),
			false,
		);
		assert.equal(
			isNativeSurface("scripts/foo.mjs", deriveNativeSurfaces(after)),
			true,
		);
	} finally {
		rmSync(before, { recursive: true, force: true });
		rmSync(after, { recursive: true, force: true });
	}
});

test("an underivable repository makes every scripts/ and .github/ path native", () => {
	const breakages = {
		"unparseable package.json": (root) =>
			writeFileSync(join(root, "package.json"), "{ not json"),
		"missing package.json": (root) => rmSync(join(root, "package.json")),
		"missing full-suite.yml": (root) =>
			rmSync(join(root, ".github/workflows/full-suite.yml")),
		"no native-proofs job": (root) =>
			writeFileSync(
				join(root, ".github/workflows/full-suite.yml"),
				"jobs:\n  changes:\n    steps: []\n  merge-gate:\n    steps: []\n",
			),
		"a lane naming no script": (root) =>
			writeFileSync(
				join(root, ".github/workflows/full-suite.yml"),
				"jobs:\n  changes:\n    steps: []\n  native-proofs:\n    steps: []\n  merge-gate:\n    steps: []\n",
			),
	};
	for (const [name, breakIt] of Object.entries(breakages)) {
		const root = fixtureRepo();
		try {
			breakIt(root);
			const derived = deriveNativeSurfaces(root);
			assert.equal(derived.ok, false, name);
			for (const path of [...PR_2066, "scripts/lint-only.mjs"]) {
				assert.equal(isNativeSurface(path, derived), true, `${name}: ${path}`);
			}
			// Fail-closed widens only the derived trees, not the whole repository.
			assert.equal(isNativeSurface("docs/notes.md", derived), false, name);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

test("the CLI derives from the repository, not the cwd, and says when it fails closed", () => {
	const directory = mkdtempSync(join(tmpdir(), "native-scope-cwd-"));
	const broken = fixtureRepo();
	try {
		const changed = join(directory, "changed.txt");
		writeFileSync(changed, `${PR_2066.join("\n")}\n`);
		const fromElsewhere = spawnSync(
			process.execPath,
			[SCRIPT, "--changed-file", changed],
			{ encoding: "utf8", cwd: directory },
		);
		assert.equal(fromElsewhere.status, 0, fromElsewhere.stderr);
		assert.match(fromElsewhere.stdout, /native=false/);

		writeFileSync(join(broken, "package.json"), "{ not json");
		const summary = join(directory, "summary.md");
		const failClosed = spawnSync(
			process.execPath,
			[
				SCRIPT,
				"--changed-file",
				changed,
				"--root",
				broken,
				"--summary",
				summary,
			],
			{ encoding: "utf8", cwd: directory },
		);
		assert.equal(failClosed.status, 0, failClosed.stderr);
		assert.match(failClosed.stdout, /native=true/);
		assert.match(
			failClosed.stderr,
			/every scripts\/ and \.github\/ path is native/,
		);
		assert.match(readFileSync(summary, "utf8"), /Native scope fail-closed/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
		rmSync(broken, { recursive: true, force: true });
	}
});
