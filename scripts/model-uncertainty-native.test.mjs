const MISSING_CORE_PATTERN = /published core/;
const MISSING_BUILD_PATTERN = /build receipt/;
/** Pure producer/policy doors. No Electron, app build, backend or dependency install. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	assertModelTraffic,
	buildReceipt,
	modelUncertaintyCase,
	startModelBackend,
	verifyModelBuild,
} from "./model-uncertainty-native.mjs";

const sid = "aaaaaaaaaaaa";
test("real model case is explicit opt-in and candidate-scoped, never part of old default matrix", () => {
	assert.equal(modelUncertaintyCase.backendMode, "real-core");
	assert.equal(modelUncertaintyCase.optInOnly, true);
	assert.equal(modelUncertaintyCase.frames.control, undefined);
	assert.equal(modelUncertaintyCase.frames.candidate.length, 8);
	const source = readFileSync(
		new URL("./asks-app-regression.mjs", import.meta.url),
		"utf8",
	);
	assert(source.includes("!entry.optInOnly"));
	assert(source.includes("startAsksAppFixture({ root: scratch, token })"));
});
test("missing compiled receipt refuses before native runtime or backend setup", () => {
	assert.throws(
		() => verifyModelBuild("/not-a-product", undefined),
		MISSING_BUILD_PATTERN,
	);
});
test("stale compiled bytes refuse before any native executable is resolved", () => {
	// A metadata-only fake tree calibrates rejection, never native success.
	const root = mkdtempSync(join(tmpdir(), "model-build-contract-"));
	const env = {
		...process.env,
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_NAME: "Fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.invalid",
		GIT_COMMITTER_NAME: "Fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.invalid",
	};
	const git = (...args) =>
		execFileSync("git", ["-C", root, ...args], { env, stdio: "pipe" });
	for (const directory of ["src", "out/main", "out/preload", "out/renderer"])
		mkdirSync(join(root, directory), { recursive: true });
	writeFileSync(join(root, "src/main.ts"), "fixture-source");
	writeFileSync(join(root, "pnpm-lock.yaml"), "fixture-lock");
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ optionalDependencies: { electron: "45.1.0" } }),
	);
	for (const file of [
		"out/main/index.js",
		"out/preload/index.js",
		"out/renderer/index.html",
	])
		writeFileSync(join(root, file), "fixture-compiled");
	git("init", "-q");
	git("add", ".");
	git("commit", "-qm", "test: seal metadata fixture");
	const receipt = join(root, "receipt.json");
	writeFileSync(receipt, JSON.stringify(buildReceipt(root)));
	writeFileSync(join(root, "out/renderer/index.html"), "stale-or-mutated");
	const previous = process.env.MODEL_CASE_EXPECTED_HEAD;
	process.env.MODEL_CASE_EXPECTED_HEAD = git("rev-parse", "HEAD")
		.toString()
		.trim();
	try {
		assert.throws(
			() => verifyModelBuild(root, receipt),
			(error) => error.message.includes("compiled inputs/outputs"),
		);
	} finally {
		if (previous === undefined)
			Reflect.deleteProperty(process.env, "MODEL_CASE_EXPECTED_HEAD");
		else process.env.MODEL_CASE_EXPECTED_HEAD = previous;
	}
});
test("missing core refuses without manufacturing a fixture", async () => {
	const old = process.env.LOCAL_OPERATOR_CORE_PYTHON;
	try {
		process.env.LOCAL_OPERATOR_CORE_PYTHON = "/missing-owned-core/python";
		await assert.rejects(
			startModelBackend({ output: "/not-created" }),
			MISSING_CORE_PATTERN,
		);
	} finally {
		if (old === undefined)
			Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_CORE_PYTHON");
		else process.env.LOCAL_OPERATOR_CORE_PYTHON = old;
	}
});
test("new write policy is exact for session, model, keys and bodies", () => {
	const row = {
		method: "POST",
		path: `/v1/desktop/sessions/${sid}/commands`,
		body: {
			request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			command: "model",
			args: "test/mock-model-b",
		},
	};
	assert.doesNotThrow(() => assertModelTraffic([row], sid));
	assert.throws(() =>
		assertModelTraffic(
			[{ ...row, path: "/v1/desktop/sessions/bbbbbbbbbbbb/commands" }],
			sid,
		),
	);
	assert.throws(() =>
		assertModelTraffic(
			[{ ...row, body: { ...row.body, args: "test/wrong" } }],
			sid,
		),
	);
	assert.throws(() =>
		assertModelTraffic(
			[
				{
					method: "PATCH",
					path: "/v1/settings/api_key",
					body: { value: "never", base: null },
				},
			],
			sid,
		),
	);
	assert.throws(() =>
		assertModelTraffic(
			[
				{
					method: "PATCH",
					path: "/v1/settings/model_name",
					body: { value: "mock-model-a", base: null },
				},
			],
			sid,
		),
	);
	assert.throws(() =>
		assertModelTraffic([{ method: "GET", path: "/unmodeled-endpoint" }], sid),
	);
	assert.throws(() =>
		assertModelTraffic(
			[{ method: "DELETE", path: `/v1/desktop/sessions/${sid}` }],
			sid,
		),
	);
});
test("Python transport contracts preserve genuine bytes and never enforce the candidate default fence", () => {
	const output = execFileSync(
		"python3",
		[new URL("./model_uncertainty_backend_test.py", import.meta.url).pathname],
		{
			encoding: "utf8",
			env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
			timeout: 20_000,
		},
	);
	assert.equal(typeof output, "string");
});
