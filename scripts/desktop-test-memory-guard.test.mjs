import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	BREACH_EXIT_CODE,
	MEMORY_BUDGET_OVERRIDE_ENV,
	_BLIND_TICKS_WARN,
	_BUDGET_FLOOR_MB,
	computeMemoryBudget,
	createMemoryWatchdog,
	formatBreachLine,
	killGroup,
	parseFootprintBytes,
	parseProcessTable,
	sampleGroup,
	selectMembers,
	totalMemory,
} from "./desktop-test-memory-guard.mjs";

/*
 * The memory watchdog behind `pnpm test:desktop` (see
 * `desktop-test-memory-guard.mjs` for the incident and every constant).
 *
 * Two layers, on purpose. The arithmetic and every probe-failure shape are pure
 * and pinned against canned output, so they never depend on this host. The one
 * integration cell then runs the REAL runner over a REAL test file that
 * allocates past a small test-only budget, because "the watchdog exists" and
 * "the runner kills the group and says so" are different claims and only the
 * second one is the product.
 */

const RUNNER = join(process.cwd(), "scripts", "run-desktop-tests.mjs");
const MB = 1024 * 1024;

test("the derived budget has a floor, scales with RAM, and is capped for small hosts", () => {
	// 36 GB host: 25% (9,216 MB) beats the floor.
	assert.equal(computeMemoryBudget({ totalMb: 36864 }).budgetMb, 9216);
	// 16 GB hosted runner: the 6,144 MB floor beats 25% (4,096 MB).
	assert.equal(
		computeMemoryBudget({ totalMb: 16384 }).budgetMb,
		_BUDGET_FLOOR_MB,
	);
	// 8 GB box: the floor would be 75% of RAM, so the 50% ceiling binds.
	assert.equal(computeMemoryBudget({ totalMb: 8192 }).budgetMb, 4096);
	// Unmeasurable RAM still bounds the run.
	const unknown = computeMemoryBudget({ totalMb: null });
	assert.equal(unknown.budgetMb, _BUDGET_FLOOR_MB);
	assert.equal(unknown.arm, "fallback");
});

test("the override is honoured unclamped, `off` disables, and a typo is ignored", () => {
	assert.deepEqual(
		computeMemoryBudget({ totalMb: 36864, override: "300" }).budgetMb,
		300,
	);
	assert.equal(
		computeMemoryBudget({ totalMb: 36864, override: "OFF" }).arm,
		"off",
	);
	for (const typo of ["0", "-2", "4abc", "1.5"]) {
		const decision = computeMemoryBudget({ totalMb: 36864, override: typo });
		assert.equal(decision.arm, "derived", typo);
	}
	assert.equal(
		computeMemoryBudget({ totalMb: 36864, override: "" }).arm,
		"derived",
	);
});

test("membership is the leader's group plus descendants that left it", () => {
	const rows = parseProcessTable(
		[
			"  100     1   100  2048", // leader
			"  101   100   100  1024", // same group
			"  102   101   102   512", // setsid'd child of a member
			"  103     1   100   256", // reparented but still in the group
			"  200     1   200  9999", // unrelated
			"garbage line",
		].join("\n"),
	);
	const pids = selectMembers(rows, 100)
		.map((row) => row.pid)
		.sort();
	assert.deepEqual(pids, [100, 101, 102, 103]);
	// An unrelated process is never claimed, and a missing leader yields nothing
	// from the ppid walk (its group may still match).
	assert.deepEqual(selectMembers(rows, 999), []);
});

test("the footprint parser reads every unit footprint prints and skips vanished pids", () => {
	const text = [
		"footprint: Unable to find pid for process matching '999999'",
		"node [14739]: 64-bit    Footprint: 309 MB (16384 bytes per page)",
		"sleep [96693]: 64-bit    Footprint: 1163504 B (16384 bytes per page)",
		"big [7]: 64-bit    Footprint: 1.5 GB (16384 bytes per page)",
	].join("\n");
	const parsed = parseFootprintBytes(text);
	assert.equal(parsed.get(14739), 309 * MB);
	assert.equal(parsed.get(96693), 1163504);
	assert.equal(parsed.get(7), 1.5 * 1024 * MB);
	assert.equal(parsed.has(999999), false);
});

test("a member is charged max(footprint, rss): the incident shape is NOT hidden by a small RSS", () => {
	// The measured shape: footprint 4,113 MB while RSS read 37 MB.
	const members = [{ pid: 5, rssBytes: 37 * MB }];
	const hidden = totalMemory(members, new Map([[5, 4113 * MB]]));
	assert.equal(hidden.totalBytes, 4113 * MB);
	// And RSS is the floor when footprint is unavailable for that pid.
	const floor = totalMemory(members, new Map());
	assert.equal(floor.totalBytes, 37 * MB);
});

test("a failed probe skips the tick; only a successful reading at the budget kills", async () => {
	const kills = [];
	let next = null;
	const watchdog = createMemoryWatchdog({
		leaderPid: 4242,
		budgetBytes: 1000,
		sample: async () => next,
		kill: (members) => kills.push(members),
		onBreach: () => {},
	});
	next = null;
	assert.equal(await watchdog.tick(), "blind");
	next = { totalBytes: 999, footprintBytes: 999, rssBytes: 1, members: [] };
	assert.equal(await watchdog.tick(), "ok");
	assert.equal(kills.length, 0);
	next = { totalBytes: 1000, footprintBytes: 1000, rssBytes: 1, members: [] };
	assert.equal(await watchdog.tick(), "breach");
	assert.equal(kills.length, 1);
	// One breach, one kill: a stopped watchdog does not fire twice.
	assert.equal(await watchdog.tick(), "stopped");
	assert.equal(kills.length, 1);
});

test("a sampler that throws is a skipped tick, and a blind run warns exactly once", async () => {
	const warnings = [];
	const watchdog = createMemoryWatchdog({
		leaderPid: 4242,
		budgetBytes: 1000,
		sample: async () => {
			throw new Error("ps starved");
		},
		kill: () => assert.fail("must not kill on an unreadable group"),
		onBreach: () => assert.fail("must not breach on an unreadable group"),
		onBlind: (ticks) => warnings.push(ticks),
	});
	for (let i = 0; i < _BLIND_TICKS_WARN + 3; i++) await watchdog.tick();
	assert.deepEqual(warnings, [_BLIND_TICKS_WARN]);
});

test("the sampler survives each probe-failure shape", async () => {
	const tableText = "  100     1   100  2048\n  101   100   100  1024\n";
	const fpText =
		"n [100]: 64-bit    Footprint: 5000 MB (16384 bytes per page)\n";
	const darwin = { platform: "darwin" };
	// Both probes fine: footprint wins over RSS.
	let reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd) => (cmd === "ps" ? tableText : fpText),
	});
	assert.equal(reading.totalBytes, 5000 * MB + 1024 * 1024);
	// `ps` starved: the leader's own footprint is still read, so a runaway leader
	// is still caught without a table.
	reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd) => (cmd === "ps" ? null : fpText),
	});
	assert.equal(reading.totalBytes, 5000 * MB);
	// `footprint` starved: degrade to RSS, do not skip.
	reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd) => (cmd === "ps" ? tableText : null),
	});
	assert.equal(reading.totalBytes, 3072 * 1024);
	// Both starved: nothing to judge -> null (skip the tick).
	assert.equal(
		await sampleGroup(100, { ...darwin, run: async () => null }),
		null,
	);
	// Non-darwin, no table: null, not a guess.
	assert.equal(
		await sampleGroup(100, { platform: "linux", run: async () => null }),
		null,
	);
});

test("the kill addresses the group and out-of-group members, and refuses unsafe pids", () => {
	const sent = [];
	const kill = (target, signal) => sent.push([target, signal]);
	killGroup(
		100,
		[
			{ pid: 101, pgid: 100 },
			{ pid: 102, pgid: 102 },
		],
		{ kill },
	);
	assert.deepEqual(sent, [
		[-100, "SIGKILL"],
		[102, "SIGKILL"],
	]);
	for (const bad of [0, 1, -5, process.pid, Number.NaN, undefined]) {
		assert.throws(() => killGroup(bad, [], { kill }), /refusing/, String(bad));
	}
	// ESRCH is the expected race, any other failure is real.
	assert.doesNotThrow(() =>
		killGroup(100, [], {
			kill: () => {
				throw Object.assign(new Error("gone"), { code: "ESRCH" });
			},
		}),
	);
	assert.throws(() =>
		killGroup(100, [], {
			kill: () => {
				throw Object.assign(new Error("nope"), { code: "EPERM" });
			},
		}),
	);
});

test("the breach line names the leader, the measured figure and the budget", () => {
	const line = formatBreachLine({
		leaderPid: 4242,
		budgetBytes: 300 * MB,
		reading: {
			totalBytes: 1100 * MB,
			footprintBytes: 1100 * MB,
			rssBytes: 40 * MB,
			members: [{}, {}],
		},
	});
	assert.match(line, /MEMORY LIMIT EXCEEDED/);
	assert.match(line, /process group 4242 \(2 processes\)/);
	assert.match(line, /1\.1 GB owned \(footprint 1\.1 GB, rss 40 MB\)/);
	assert.match(line, /budget 300 MB/);
	assert.match(line, new RegExp(MEMORY_BUDGET_OVERRIDE_ENV));
});

/*
 * THE INTEGRATION CELL. A real test file allocates and TOUCHES 1.2 GB of
 * Buffers (so the pages are owned, not merely reserved), spawns a grandchild
 * that must die with the group, and then would sleep for 60 s. With a 300 MB
 * test-only budget the runner has to kill the group, print the loud line and
 * exit 137 in a few seconds. If the watchdog were broken the file would sit
 * there until the spawnSync timeout, which fails the assertions below.
 */
const scratch = mkdtempSync(join(tmpdir(), "desktop-memguard-"));
const PID_FILE = join(scratch, "grandchild.pid");
const HOLDER = join(scratch, "holds-memory.test.mjs");
writeFileSync(
	HOLDER,
	`import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
test("holds memory", async () => {
	const grandchild = spawn("sleep", ["60"], { stdio: "ignore" });
	writeFileSync(${JSON.stringify(PID_FILE)}, String(grandchild.pid));
	const held = [];
	for (let i = 0; i < 20; i++) held.push(Buffer.alloc(64 * 1024 * 1024, 1));
	await new Promise((resolve) => setTimeout(resolve, 60000));
	held.length = 0;
});
`,
);

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

test("the real runner kills a runaway group, names it, and exits non-zero", () => {
	const started = Date.now();
	const result = spawnSync(
		process.execPath,
		[RUNNER, "--test-concurrency=1", HOLDER],
		{
			encoding: "utf8",
			env: { ...process.env, [MEMORY_BUDGET_OVERRIDE_ENV]: "300" },
			timeout: 45000,
		},
	);
	const elapsed = Date.now() - started;
	assert.equal(result.status, BREACH_EXIT_CODE, result.stdout + result.stderr);
	assert.match(
		result.stderr,
		/MEMORY LIMIT EXCEEDED — killed process group \d+/,
	);
	assert.match(result.stderr, /budget 300 MB/);
	// Fast: the cadence is 2 s, so a trip is seconds, nowhere near the 60 s hold.
	assert.ok(elapsed < 30000, `took ${elapsed} ms`);
	// The grandchild was in the killed group; no orphan is left holding anything.
	const grandchild = Number(readFileSync(PID_FILE, "utf8"));
	let reaped = false;
	for (let i = 0; i < 20 && !reaped; i++) {
		reaped = !alive(grandchild);
		if (!reaped) spawnSync("sleep", ["0.1"]);
	}
	if (!reaped) process.kill(grandchild, "SIGKILL");
	assert.ok(reaped, `grandchild ${grandchild} survived the group kill`);
});

test("the override `off` runs the suite unbounded and says so", () => {
	const passes = join(scratch, "passes.test.mjs");
	writeFileSync(
		passes,
		'import { test } from "node:test";\ntest("ok", () => {});\n',
	);
	const result = spawnSync(process.execPath, [RUNNER, passes], {
		encoding: "utf8",
		env: { ...process.env, [MEMORY_BUDGET_OVERRIDE_ENV]: "off" },
		timeout: 60000,
	});
	assert.equal(result.status, 0, result.stdout);
	assert.match(result.stdout, /memory watchdog OFF/);
});

test("a normal run prints the budget line and is unaffected", () => {
	const passes = join(scratch, "passes.test.mjs");
	writeFileSync(
		passes,
		'import { test } from "node:test";\ntest("ok", () => {});\n',
	);
	const result = spawnSync(process.execPath, [RUNNER, passes], {
		encoding: "utf8",
		env: { ...process.env, [MEMORY_BUDGET_OVERRIDE_ENV]: undefined },
		timeout: 60000,
	});
	assert.equal(result.status, 0, result.stdout);
	assert.match(result.stdout, /desktop tests: memory bound \d/);
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));
