import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
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
const workflow = load(
	readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
);
const job = workflow.jobs["bytecode-build"];
const stage = job.steps.find(
	(step) => step.name === "Stage native bytecode artifact and hash manifest",
);
const code = stage.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, "");
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
		["--input-type=module", "-e", code],
		{ cwd: root, env, encoding: "utf8", timeout: 10000 },
	);
	return { root, temp, result };
}

test("Mac CI build gets bounded heap without changing Linux or Electron runtime probes", () => {
	const build = job.steps.find(
		(step) => step.name === "Build main with V8 bytecode",
	);
	assert.equal(
		build.env.NODE_OPTIONS,
		"${{ matrix.runner == 'macos-15' && '--max-old-space-size=4096' || '' }}",
	);
	// Scope matters as much as size: Electron disallows some Node options, and
	// its runtime identity probe must measure the shipped runtime unmodified.
	assert.equal(workflow.env?.NODE_OPTIONS, undefined);
	assert.equal(job.env.NODE_OPTIONS, undefined);
	for (const step of job.steps.filter((step) => step !== build)) {
		assert.equal(step.env?.NODE_OPTIONS, undefined, step.name);
	}
	assert.equal(build.run, "pnpm build");
});

test("native artifact retains Linux gate, adds one Mac build and uploads only staged output", () => {
	assert.deepEqual(job.strategy.matrix.runner, ["ubuntu-latest", "macos-15"]);
	assert.equal(job.strategy["fail-fast"], false);
	assert.equal(job.name, "Bytecode Build Check");
	assert.equal(job.env.VITE_DISABLE_BACKEND_MANAGER, "true");
	assert.equal(job.env.VITE_LOCAL_OPERATOR_API_URL, "http://127.0.0.1:9");
	assert.equal(job.env.VITE_RADIENT_SERVER_BASE_URL, "http://127.0.0.1:9");
	assert.equal(job.env.VITE_PUBLIC_POSTHOG_HOST, "http://127.0.0.1:9");
	assert.ok(job.steps[0].with.ref.includes("pull_request.head.sha"));
	assert.equal(job.steps.filter((step) => step.run === "pnpm build").length, 1);
	assert.ok(
		job.steps.some((step) =>
			step.run?.includes("if [ ! -f out/main/index.jsc ]"),
		),
	);
	const upload = job.steps.find((step) =>
		step.uses?.startsWith("actions/upload-artifact@"),
	);
	assert.equal(upload.if, "matrix.runner == 'macos-15'");
	assert.equal(upload.with.path, "${{ runner.temp }}/ui-native-bytecode/");
	assert.equal(upload.with["retention-days"], 1);
	assert.equal(upload.with["if-no-files-found"], "error");
	assert.ok(upload.with.name.includes("pull_request.head.sha"));
	assert.ok(upload.with.name.includes("github.run_attempt"));
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
