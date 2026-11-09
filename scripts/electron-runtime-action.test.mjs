import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { parse } from "yaml";

const read = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const action = parse(read(".github/actions/electron-runtime/action.yml"));
const steps = action.runs.steps;
const assertion = steps.find((step) => step.if === "inputs.phase == 'assert'");
const source = assertion.run
	.replace(/^node <<'NODE'\n/, "")
	.replace(/\nNODE\n?$/, "");

// Exercise the exact embedded watchdog without downloading Electron or waiting
// three minutes. A controlled clock also checks the orphan/grandchild case.
function watchdog() {
	const child = Object.assign(new EventEmitter(), { pid: 12345 });
	const timers = [];
	const errors = [];
	const kills = [];
	const exits = [];
	const process = {
		execPath: "/synthetic/node",
		kill: (...args) => kills.push(args),
		exit: (code) => exits.push(code),
	};
	vm.runInNewContext(source, {
		require: () => ({
			spawn: (exe, args, options) => {
				assert.equal(exe, process.execPath);
				assert.equal(args[0], "bin/ensure-electron.js");
				assert.equal(options.detached, true);
				return child;
			},
		}),
		process,
		console: { error: (message) => errors.push(message) },
		setTimeout: (callback, delay) => {
			const timer = { callback, delay, cleared: false };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			timer.cleared = true;
		},
	});
	return { child, timers, errors, kills, exits, process };
}

test("all three consumers restore before install and assert before building", () => {
	let consumers = 0;
	for (const path of [
		".github/workflows/ci.yml",
		".github/workflows/full-suite.yml",
	]) {
		const workflow = parse(read(path));
		for (const job of Object.values(workflow.jobs)) {
			const steps = job.steps ?? [];
			const prepare = steps.findIndex(
				(step) =>
					step.uses === "./.github/actions/electron-runtime" &&
					step.with.phase === "prepare",
			);
			if (prepare < 0) continue;
			consumers++;
			assert.equal(steps[prepare + 1].run, "pnpm install --frozen-lockfile");
			assert.equal(
				steps[prepare + 2].uses,
				"./.github/actions/electron-runtime",
			);
			assert.equal(steps[prepare + 2].with.phase, "assert");
		}
	}
	assert.equal(consumers, 3);
});

test("cache identity is exact and the resolver reads the actual lockfile", () => {
	const cache = steps.find((step) => step.uses === "actions/cache@v4");
	assert.equal(
		cache.with.key,
		"electron-runtime-${{ runner.os }}-${{ runner.arch }}-${{ steps.electron_runtime.outputs.version }}",
	);
	assert.equal(
		cache.with.path,
		"${{ runner.temp }}/electron-runtime-downloads",
	);
	assert.equal(cache.with["restore-keys"], undefined);
	const resolver = steps.find((step) => step.id === "electron_runtime");
	const command =
		resolver.run.slice(0, resolver.run.indexOf('echo "version=')) +
		'printf "%s" "$version"';
	const result = spawnSync("bash", ["-c", command], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	const lock = parse(read("pnpm-lock.yaml"));
	assert.equal(
		result.stdout,
		String(lock.importers["."].optionalDependencies.electron.version),
	);
});

test("healthy runtime clears the clock without failing", () => {
	const run = watchdog();
	run.child.emit("exit", 0, null);
	assert.equal(run.timers[0].cleared, true);
	assert.equal(run.errors.length, 0);
	assert.equal(run.process.exitCode, undefined);
});

test("fetch failure and spawn errors fail closed with the runtime and bound named", () => {
	for (const event of ["exit", "error"]) {
		const run = watchdog();
		if (event === "exit") run.child.emit(event, 7, null);
		else run.child.emit(event, new Error("fixture spawn failure"));
		assert.equal(run.process.exitCode, event === "exit" ? 7 : 1);
		assert.match(run.errors[0], /Electron runtime.*180s/);
		assert.equal(run.timers[0].cleared, true);
	}
});

test("180-second timeout names the fetch and reaps descendants even after parent exits", () => {
	const run = watchdog();
	assert.equal(run.timers[0].delay, 180000);
	run.timers[0].callback();
	assert.match(run.errors[0], /Electron runtime fetch timed out after 180s/);
	assert.deepEqual(run.kills[0], [-12345, "SIGTERM"]);
	run.child.emit("exit", null, "SIGTERM");
	assert.equal(run.timers[1].delay, 10000);
	assert.equal(run.timers[1].cleared, false);
	run.timers[1].callback();
	assert.deepEqual(run.kills[1], [-12345, "SIGKILL"]);
	assert.deepEqual(run.exits, [124]);
});
