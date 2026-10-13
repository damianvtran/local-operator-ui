#!/usr/bin/env node
/**
 * The renderer driver's IMPORT contract: importing it does nothing, and the CLI
 * it has always been still runs `main()` when it IS the entry point.
 *
 * WHY THIS FILE EXISTS. The Q1 acceptance caller must import
 * `scripts/renderer-driver.mjs` and drive its existing machinery (the CDP
 * client, the scene verbs, frame capture, the boot lifecycle) instead of
 * copying any of it — `scripts/relaunch-during-quit-proof.mjs` carries a
 * hand-copied `CdpClient` for exactly the want of this. Before the change this
 * suite pins, importing the driver EXECUTED a whole CLI run: `CdpClient` was
 * not exported and the footer called `main()` unconditionally. A caller cannot
 * watch for that defect and recover from it — an import that boots Electron is
 * a side effect, so the guard has to be the contract.
 *
 * WHAT IS ASSERTED, AND WHY EACH HALF IS NEEDED. Half one: an import has no
 * side effects — no `main()` output, no scratch tree under `tmpdir()` (the
 * driver's scratch is named by pid, so the child's own pid names the tree that
 * must not exist), and no `LOCAL_OPERATOR_UI_DEV_DRIVER*` in the child's
 * environment. Half two: a DIRECT run still reaches the CLI — run against a
 * tree with no `out/`, it still REFUSES before spawning anything (a refusal
 * with the pre-spawn guard's words is the cheapest proof that `main()` ran and
 * the guard did not swallow it). If only half one held, the guard could pass by
 * breaking the CLI outright.
 *
 * WHAT THIS DOES NOT DO. It never boots the app, opens a CDP connection or
 * touches the network; nothing here reads or writes anything outside the
 * throwaway child processes it spawns.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/** The shipped directory, resolved to the module loader's own (physical) URL. */
const SCRIPTS = dirname(
	fileURLToPath(new URL("./renderer-driver.mjs", import.meta.url)),
);
const REPO = dirname(SCRIPTS);
const DRIVER = join(SCRIPTS, "renderer-driver.mjs");

/** The pre-spawn refusal a tree with no `out/` gets (`assertBuildIsCurrent`). */
const REFUSAL = /refusing to run: `out\/` holds no built renderer assets/;

/** The driver's own opt-ins, stripped so nothing here can arm a boot. */
const SCRUBBED_PREFIX = /^(CMUX_|LOP_|LOCAL_OPERATOR_UI_DEV_DRIVER)/;

/** The footer line a direct run prints before its refusal (proves main() ran). */
const FAIL_LINE = /\[FAIL\] the run threw/;

/** The child environment: no CMUX_/LOP_ prefixes (house rule) and no dev-driver opt-ins. */
function childEnv() {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (SCRUBBED_PREFIX.test(key)) delete env[key];
	}
	return env;
}

test("the export surface is exactly the frozen facade", async () => {
	const mod = await import("./renderer-driver.mjs");
	assert.deepEqual(
		Object.keys(mod),
		["rendererDriverApi"],
		"one export, so the surface cannot accrete by accident",
	);
	const api = mod.rendererDriverApi;
	assert.ok(Object.isFrozen(api), "the facade must be frozen");
	assert.deepEqual(Object.keys(api).sort(), [
		"CdpClient",
		"capture",
		"launchApp",
		"reapLiveBoots",
		"verb",
	]);
	for (const key of [
		"CdpClient",
		"launchApp",
		"verb",
		"capture",
		"reapLiveBoots",
	]) {
		assert.equal(typeof api[key], "function", `${key} must be a function`);
	}
});

test("importing the driver runs nothing: no main, no scratch, no env writes", () => {
	const program = [
		`const mod = await import(${JSON.stringify(DRIVER)});`,
		"console.log(JSON.stringify({",
		"\tfacade: Boolean(mod.rendererDriverApi),",
		"\tpid: process.pid,",
		'\tdevDriverEnv: Object.keys(process.env).filter((k) => k.startsWith("LOCAL_OPERATOR_UI_DEV_DRIVER")),',
		"}));",
	].join("\n");
	const run = spawnSync(
		process.execPath,
		["--input-type=module", "-e", program],
		{
			cwd: REPO,
			encoding: "utf8",
			env: childEnv(),
			timeout: 60_000,
		},
	);
	assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
	const lines = run.stdout.trim().split("\n");
	assert.equal(
		lines.length,
		1,
		`an import must print nothing but its own report:\n${run.stdout}`,
	);
	const report = JSON.parse(lines[0]);
	assert.equal(report.facade, true);
	assert.deepEqual(report.devDriverEnv, []);
	assert.equal(
		existsSync(join(tmpdir(), `lo-renderer-driver-${report.pid}`)),
		false,
		"an import must not materialise the scratch tree",
	);
});

test("a direct CLI run still reaches main(): the pre-spawn refusal", () => {
	const run = spawnSync(process.execPath, [DRIVER, "--scene", "states"], {
		cwd: REPO,
		encoding: "utf8",
		env: childEnv(),
		timeout: 60_000,
	});
	assert.notEqual(run.status, 0, "a tree with no out/ must refuse, not pass");
	assert.match(run.stdout, REFUSAL, run.stdout);
	assert.match(run.stdout, FAIL_LINE, run.stdout);
});
