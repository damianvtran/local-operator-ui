import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	NATIVE_EXACT,
	NATIVE_PREFIXES,
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
