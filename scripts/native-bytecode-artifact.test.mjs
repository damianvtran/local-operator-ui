import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const appRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { load } = appRequire("js-yaml");
const workflowsDir = new URL("../.github/workflows/", import.meta.url);
const workflow = load(readFileSync(new URL("ci.yml", workflowsDir), "utf8"));
// The Linux gate that carries the required check, and the Mac job that builds
// and uploads the native artifact. They are two jobs, not a matrix: see the
// comment above `bytecode-build-macos` in ci.yml and the guards at the end.
const gateJob = workflow.jobs["bytecode-build"];
// A missing Mac job fails each test that needs it rather than aborting the
// file at load, so the required-name guards below still report on their own.
const job = workflow.jobs["bytecode-build-macos"] ?? { steps: [] };
function stagingCode() {
	const stage = job.steps.find(
		(step) => step.name === "Stage native bytecode artifact and hash manifest",
	);
	assert.ok(stage, "ci.yml has no bytecode-build-macos staging step");
	return stage.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, "");
}
const required = [
	"main/index.jsc",
	"main/index.js",
	"preload/index.js",
	"preload/browser-approvals-overlay.js",
	"renderer/index.html",
	"renderer/browser-approvals-overlay.html",
];

// Execute the workflow's actual staging code on inert files, not a second
// implementation. No Electron, profile, dependency install or native build runs.
function fixture(t, mutate = () => {}) {
	const scratch =
		process.env.LOCAL_OPERATOR_SCRATCHPAD || process.env.RUNNER_TEMP;
	assert.ok(scratch, "scratch root required");
	const root = mkdtempSync(join(scratch, "native-artifact-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const temp = join(root, "temp");
	mkdirSync(temp);
	mkdirSync(join(root, "bin"));
	writeFileSync(
		join(root, "bin/git"),
		'#!/bin/sh\nif [ "$1" = "rev-parse" ]; then echo head; else echo "base head"; fi\n',
	);
	chmodSync(join(root, "bin/git"), 0o755);
	for (const file of [...required, "renderer/assets/card.js"]) {
		mkdirSync(resolve(root, "out", file, ".."), { recursive: true });
		writeFileSync(join(root, "out", file), `synthetic ${file}`);
	}
	writeFileSync(join(root, "package.json"), '{"main":"./out/main/index.js"}');
	writeFileSync(join(root, ".env"), "MUST_NOT_UPLOAD=synthetic");
	writeFileSync(
		join(temp, "bytecode-runtime.json"),
		JSON.stringify({
			platform: "darwin",
			arch: "arm64",
			versions: { electron: "45.1.0", v8: "synthetic" },
			cachedDataVersionTag: 123,
		}),
	);
	const env = {
		...job.env,
		PATH: `${root}/bin:${process.env.PATH}`,
		RUNNER_TEMP: temp,
		SOURCE_HEAD: "head",
		GITHUB_RUN_ID: "123",
		GITHUB_RUN_ATTEMPT: "1",
	};
	mutate({ root, env });
	const result = spawnSync(
		process.execPath,
		["--input-type=module", "-e", stagingCode()],
		{ cwd: root, env, encoding: "utf8", timeout: 10000 },
	);
	return { root, temp, result };
}

test("Mac CI build gets bounded heap without changing Linux or Electron runtime probes", () => {
	const build = job.steps.find(
		(step) => step.name === "Build main with V8 bytecode",
	);
	assert.equal(build.env.NODE_OPTIONS, "--max-old-space-size=4096");
	// Scope matters as much as size: Electron disallows some Node options, and
	// its runtime identity probe must measure the shipped runtime unmodified.
	assert.equal(workflow.env?.NODE_OPTIONS, undefined);
	assert.equal(job.env.NODE_OPTIONS, undefined);
	for (const step of job.steps.filter((step) => step !== build)) {
		assert.equal(step.env?.NODE_OPTIONS, undefined, step.name);
	}
	assert.equal(build.run, "pnpm build");
	// The Linux gate keeps Node's default heap.
	assert.equal(gateJob.env?.NODE_OPTIONS, undefined);
	for (const step of gateJob.steps) {
		assert.equal(step.env?.NODE_OPTIONS, undefined, step.name);
	}
});

test("native artifact retains the Linux gate, adds one Mac build job and uploads only staged output", () => {
	// Same trigger as the gate, so the artifact exists exactly when the gate ran.
	assert.deepEqual(job.needs, gateJob.needs);
	assert.equal(String(job.if).trim(), String(gateJob.if).trim());
	assert.equal(job["runs-on"], "macos-15");
	assert.equal(job.strategy, undefined);
	assert.ok(workflow.jobs["ci-gate"].needs.includes("bytecode-build-macos"));
	assert.equal(job.env.VITE_DISABLE_BACKEND_MANAGER, "true");
	assert.equal(job.env.VITE_LOCAL_OPERATOR_API_URL, "http://127.0.0.1:9");
	assert.equal(job.env.VITE_RADIENT_SERVER_BASE_URL, "http://127.0.0.1:9");
	assert.equal(job.env.VITE_PUBLIC_POSTHOG_HOST, "http://127.0.0.1:9");
	assert.ok(job.steps[0].with.ref.includes("pull_request.head.sha"));
	// The Mac artifact is built and validated like the gate's: every step the
	// gate runs (checkout, toolchain, Electron cache, install, runtime and
	// bytecode assertions) runs here too, under the same name.
	const macSteps = new Set(job.steps.map((step) => step.name));
	for (const step of gateJob.steps)
		assert.ok(macSteps.has(step.name), step.name);
	assert.equal(job.steps.filter((step) => step.run === "pnpm build").length, 1);
	assert.ok(
		job.steps.some((step) =>
			step.run?.includes("if [ ! -f out/main/index.jsc ]"),
		),
	);
	assert.ok(
		job.steps.some((step) => step.with?.phase === "assert"),
		"Mac job lost the Electron runtime assertion",
	);
	const upload = job.steps.find((step) =>
		step.uses?.startsWith("actions/upload-artifact@"),
	);
	assert.ok(upload, "Mac job does not upload the native artifact");
	assert.equal(upload.if, undefined);
	assert.equal(upload.with.path, "${{ runner.temp }}/ui-native-bytecode/");
	assert.equal(upload.with["retention-days"], 1);
	assert.equal(upload.with["if-no-files-found"], "error");
	assert.equal(
		upload.with.name,
		"ui-native-bytecode-darwin-arm64-${{ github.event.pull_request.head.sha || github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
	);
	// Nothing leaves the Linux gate.
	assert.ok(
		!gateJob.steps.some((step) =>
			step.uses?.startsWith("actions/upload-artifact@"),
		),
	);
	const runtime = job.steps.find(
		(step) => step.name === "Record native bytecode runtime",
	);
	assert.equal(runtime.env.ELECTRON_RUN_AS_NODE, "1");
	assert.ok(runtime.run.includes("process.versions.electron !== pin"));
	assert.ok(
		runtime.run.includes(
			'process.platform !== "darwin" || process.arch !== "arm64"',
		),
	);
});

test("staging hashes all ordinary outputs and package metadata with exact head/runtime identity", (t) => {
	const { temp, result } = fixture(t);
	assert.equal(result.status, 0, result.stderr);
	const dir = join(temp, "ui-native-bytecode");
	const manifest = JSON.parse(readFileSync(join(dir, "manifest.json")));
	assert.equal(manifest.schemaVersion, 1);
	assert.equal(
		manifest.compiledBindings.VITE_LOCAL_OPERATOR_API_URL,
		"http://127.0.0.1:9",
	);
	assert.equal(
		manifest.requiredRuntimeBindings.VITE_DISABLE_BACKEND_MANAGER,
		"true",
	);
	assert.equal(manifest.sourceHead, "head");
	assert.equal(manifest.checkout, "head");
	assert.equal(manifest.runtime.versions.electron, "45.1.0");
	assert.equal(manifest.files.length, required.length + 2);
	for (const file of manifest.files) {
		const bytes = readFileSync(join(dir, file.path));
		assert.equal(file.size, bytes.length);
		assert.equal(file.sha256, createHash("sha256").update(bytes).digest("hex"));
		assert.ok(file.path === "package.json" || file.path.startsWith("out/"));
	}
});

for (const [name, mutate, message] of [
	[
		"missing compiled approvals",
		({ root }) =>
			rmSync(join(root, "out/renderer/browser-approvals-overlay.html")),
		/Missing compiled surface/,
	],
	[
		"unbound head",
		({ env }) => {
			env.SOURCE_HEAD = "other";
		},
		/Source head is not/,
	],
	[
		"symlink escape",
		({ root }) => symlinkSync("../../.env", join(root, "out/main/escape")),
		/Unsafe artifact entry/,
	],
	[
		"environment file in output",
		({ root }) => writeFileSync(join(root, "out/.env.local"), "synthetic"),
		/Unsafe artifact entry/,
	],
]) {
	test(`staging refuses ${name}`, (t) => {
		const { result } = fixture(t, mutate);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, message);
	});
}

// Required status checks are keyed by a job's rendered DISPLAY name, and a
// required name that never reports blocks merge. Two shapes have broken this
// on PR #1887, and both are pinned here:
//   - a literal `name:` under a matrix gains a suffix
//     (`Bytecode Build Check (ubuntu-latest)`), so the bare name never reports;
//   - an expression `name:` renders while the job runs, but a job SKIPPED by its
//     `if:` posts one check under the raw, unevaluated string (main 92984394
//     shows `NPX Sanity Check (${{ matrix.os }})`), and this job is skipped
//     whenever the `changes` classifier clears the `bytecode` flag.
// These are the ruleset's required check names as of 2026-11-14 (read from the
// branch ruleset, not derivable from the tree): keep this list in step with it.
const REQUIRED_CHECK_NAMES = [
	"Bytecode Build Check",
	"CI Gate",
	"Merge gate (full suite)",
];

function allWorkflowJobs() {
	const out = [];
	for (const file of readdirSync(workflowsDir).sort()) {
		if (!/\.ya?ml$/.test(file)) continue;
		const doc = load(readFileSync(new URL(file, workflowsDir), "utf8"));
		for (const [id, body] of Object.entries(doc?.jobs ?? {})) {
			out.push({ file, id, body });
		}
	}
	return out;
}

test("every required check name is a literal, matrix-free job name", () => {
	const jobs = allWorkflowJobs();
	for (const required of REQUIRED_CHECK_NAMES) {
		const owners = jobs.filter(({ body }) => body.name === required);
		assert.ok(
			owners.length >= 1,
			`no job is literally named '${required}': a required check must not depend on rendering an expression or matrix suffix`,
		);
		for (const { file, id, body } of owners) {
			assert.equal(
				body.strategy?.matrix,
				undefined,
				`${file}:${id} carries required check '${required}' under a matrix, so it reports with a suffix`,
			);
		}
	}
	// An expression name that merely CONTAINS a required name renders it only
	// while the job runs; skipped, it posts the raw expression.
	for (const { file, id, body } of jobs) {
		const name = String(body.name ?? "");
		if (!name.includes("${{")) continue;
		for (const required of REQUIRED_CHECK_NAMES) {
			assert.ok(
				!name.includes(`'${required}'`) && !name.includes(`"${required}"`),
				`${file}:${id} renders required check '${required}' from an expression (${name}); a skipped job posts the raw string`,
			);
		}
	}
});

test("bytecode-build keeps the literal required name with no matrix; the Mac job is apart", () => {
	assert.equal(gateJob.name, "Bytecode Build Check");
	assert.ok(!gateJob.name.includes("${{"));
	assert.equal(gateJob.strategy, undefined);
	assert.equal(gateJob["runs-on"], "ubuntu-latest");
	assert.equal(job.name, "Bytecode Build Check (macos-15)");
	assert.ok(!job.name.includes("${{"));
});
