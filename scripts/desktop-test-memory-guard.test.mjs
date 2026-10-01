import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
	killTree,
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

/** Module-scope patterns (biome's `useTopLevelRegex`). */
const REFUSING = /refusing/;
const TABLE_UNREADABLE = /process table was unreadable \(walk coverage\)/;
const LIMIT_EXCEEDED = /MEMORY LIMIT EXCEEDED/;
const KILLED_GROUP_LINE = /MEMORY LIMIT EXCEEDED — killed process group \d+/;
const NAMES_GROUP = /process group 4242 \(2 processes\)/;
const NAMES_FIGURE = /1\.1 GB owned \(footprint 1\.1 GB, rss 40 MB\)/;
const NAMES_BUDGET = /budget 300 MB/;
const WATCHDOG_OFF = /memory watchdog OFF/;
const BUDGET_LINE = /desktop tests: memory bound \d/;

test("the derived budget has a floor, scales with RAM, and is capped for small hosts", () => {
	// 36 GB host: 25% (9,216 MB) beats the floor.
	assert.equal(computeMemoryBudget({ totalMb: 36864 }).budgetMb, 9216);
	// 16 GB hosted runner: the 8,192 MB floor beats 25% (4,096 MB) and is exactly
	// the 50% ceiling.
	assert.equal(
		computeMemoryBudget({ totalMb: 16384 }).budgetMb,
		_BUDGET_FLOOR_MB,
	);
	// 8 GB box: the floor would be 100% of RAM, so the 50% ceiling binds.
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

test("the sampler survives each probe-failure shape, and says how complete it was", async () => {
	const tableText =
		"  100     1   100  2048 Tue Sep 30 21:56:12 2026\n  101   100   100  1024 Tue Sep 30 21:56:13 2026\n";
	const fpText =
		"n [100]: 64-bit    Footprint: 5000 MB (16384 bytes per page)\n";
	const darwin = { platform: "darwin" };
	const noWalk = (cmd) => cmd === "pgrep";
	// Both probes fine: footprint wins over RSS, the tree was fully read.
	let reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd) => (cmd === "ps" ? tableText : fpText),
	});
	assert.equal(reading.totalBytes, 5000 * MB + 1024 * 1024);
	assert.equal(reading.coverage, "table");
	assert.equal(reading.blind, false);
	// `ps` starved and nothing discoverable: only the leader is read. It is still a
	// valid kill signal (so the leader's footprint counts) but it is BLIND - this is
	// the first revision's hole, where this shape reset the warning counter.
	reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd) => (noWalk(cmd) ? "" : cmd === "ps" ? null : fpText),
	});
	assert.equal(reading.totalBytes, 5000 * MB);
	assert.equal(reading.coverage, "leader");
	assert.equal(reading.blind, true);
	// `ps` starved but `pgrep -P` finds the children: the tree is seen, not blind.
	const kids = { 100: "101\n102\n", 101: "", 102: "" };
	reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd, args) => {
			if (cmd === "ps") return null;
			if (cmd === "pgrep") {
				return args[1]
					.split(",")
					.map((pid) => kids[pid] ?? "")
					.join("");
			}
			return "n [100]: 64-bit    Footprint: 10 MB (16384 bytes per page)\nc [102]: 64-bit    Footprint: 4000 MB (16384 bytes per page)\n";
		},
	});
	assert.deepEqual(reading.members.map((m) => m.pid).sort(), [100, 101, 102]);
	assert.equal(reading.coverage, "walk");
	assert.equal(reading.blind, false);
	assert.equal(reading.totalBytes, 4010 * MB);
	// A DEGENERATE table (parses to nothing, or lacks the leader) is the same as a
	// failed one, not a clean empty tree.
	reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd) =>
			noWalk(cmd) ? "" : cmd === "ps" ? "\ngarbage\n" : fpText,
	});
	assert.equal(reading.blind, true);
	// `footprint` starved: degrade to RSS, but that is the blind instrument.
	reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd) => (cmd === "ps" ? tableText : null),
	});
	assert.equal(reading.totalBytes, 3072 * 1024);
	assert.equal(reading.blind, true);
	// Everything starved: nothing to judge -> null (skip the tick).
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

test("a blind-but-successful reading counts toward the warning, and an over-budget one still kills", async () => {
	const warnings = [];
	let reading = {
		totalBytes: 10,
		footprintBytes: 10,
		rssBytes: 0,
		blind: true,
		members: [],
	};
	const watchdog = createMemoryWatchdog({
		leaderPid: 4242,
		budgetBytes: 1000,
		sample: async () => reading,
		kill: async () => ({ signalled: 0, skipped: 0, errors: [] }),
		onBreach: () => {},
		onBlind: (ticks) => warnings.push(ticks),
	});
	for (let i = 0; i < _BLIND_TICKS_WARN; i++) {
		assert.equal(await watchdog.tick(), "blind");
	}
	assert.deepEqual(warnings, [_BLIND_TICKS_WARN]);
	// The leader-only reading is a valid kill signal even though it is blind.
	reading = { ...reading, totalBytes: 1000, footprintBytes: 1000 };
	assert.equal(await watchdog.tick(), "breach");
});

test("the group is signalled first; EPERM/ESRCH never escape or skip the rest", async () => {
	const sent = [];
	const kill = (target, signal) => {
		sent.push([target, signal]);
		// macOS: a zombie-only group answers EPERM.
		if (target === -100) {
			throw Object.assign(new Error("zombies"), { code: "EPERM" });
		}
	};
	const stamp = "Tue Sep 30 21:56:12 2026";
	const fresh = `  102   100   102  512 ${stamp}\n`;
	const outcome = await killTree(
		100,
		[
			{ pid: 101, pgid: 100, lstart: stamp },
			{ pid: 102, pgid: 102, lstart: stamp },
		],
		{ kill, run: async () => fresh },
	);
	assert.deepEqual(sent, [
		[-100, "SIGKILL"],
		[102, "SIGKILL"],
	]);
	assert.deepEqual(outcome, { signalled: 1, skipped: 0, errors: [] });
	// Anything other than gone/EPERM is reported, not thrown, and not fatal to the
	// remaining sends.
	const failing = await killTree(
		100,
		[{ pid: 102, pgid: 102, lstart: stamp }],
		{
			kill: (target) => {
				throw Object.assign(new Error("odd"), { code: "EIO", target });
			},
			run: async () => fresh,
		},
	);
	assert.equal(failing.errors.length, 2);
	assert.equal(failing.signalled, 0);
});

test("a recycled pid is not signalled: identity is re-read before a by-pid kill", async () => {
	const sent = [];
	const kill = (target) => sent.push(target);
	const sampled = "Tue Sep 30 21:56:12 2026";
	const members = [{ pid: 102, pgid: 102, lstart: sampled }];
	// The pid now belongs to a process started later, with an unrelated parent.
	let outcome = await killTree(100, members, {
		kill,
		run: async () => "  102     1   102  512 Tue Sep 30 22:10:00 2026\n",
	});
	assert.deepEqual(sent, [-100]);
	assert.equal(outcome.skipped, 1);
	// An unreadable re-check skips every by-pid kill and says so.
	sent.length = 0;
	outcome = await killTree(100, members, { kill, run: async () => null });
	assert.deepEqual(sent, [-100]);
	assert.equal(outcome.skipped, 1);
	// A pid that is simply gone is fine and not counted.
	sent.length = 0;
	outcome = await killTree(100, members, { kill, run: async () => "" });
	assert.deepEqual(sent, [-100]);
	assert.equal(outcome.skipped, 0);
	// A walked member (no start time on record) is trusted only while its parent is
	// still in this tree.
	sent.length = 0;
	const walked = [{ pid: 103, pgid: null, lstart: null }];
	outcome = await killTree(100, walked, {
		kill,
		run: async () => "  103   100   103  8 Tue Sep 30 21:56:12 2026\n",
	});
	assert.deepEqual(sent, [-100, 103]);
	sent.length = 0;
	outcome = await killTree(100, walked, {
		kill,
		run: async () => "  103     1   103  8 Tue Sep 30 21:56:12 2026\n",
	});
	assert.deepEqual(sent, [-100]);
	assert.equal(outcome.skipped, 1);
});

test("the kill refuses a pid that could address the world", async () => {
	for (const bad of [0, 1, -5, process.pid, Number.NaN, undefined]) {
		await assert.rejects(
			killTree(bad, [], { kill: () => assert.fail("must not signal") }),
			REFUSING,
			String(bad),
		);
	}
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
	assert.match(line, LIMIT_EXCEEDED);
	assert.match(line, NAMES_GROUP);
	assert.match(line, NAMES_FIGURE);
	assert.match(line, NAMES_BUDGET);
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
	assert.match(result.stderr, KILLED_GROUP_LINE);
	assert.match(result.stderr, NAMES_BUDGET);
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

/*
 * R1: a SIGKILL of the RUNNER's group (what a per-command guard or a
 * `timeout`-by-pgid wrapper does) must not leave the detached test tree running
 * with its watchdog dead. The watchdog is switched OFF here so the only thing that
 * can reap the tree is the keeper.
 */
test("SIGKILL of the runner's group leaves no survivor from the test tree", async () => {
	const pidFile = join(scratch, "grandchild-r1.pid");
	const holder = join(scratch, "r1-holder.test.mjs");
	writeFileSync(
		holder,
		`import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
test("holds", async () => {
	const g = spawn("sleep", ["60"], { stdio: "ignore" });
	writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
	await new Promise((resolve) => setTimeout(resolve, 60000));
});
`,
	);
	// The runner leads its own group, as it does under a harness that kills by pgid.
	const runner = spawn(
		process.execPath,
		[RUNNER, "--test-concurrency=1", holder],
		{
			detached: true,
			stdio: "ignore",
			env: { ...process.env, [MEMORY_BUDGET_OVERRIDE_ENV]: "off" },
		},
	);
	let grandchild = null;
	for (let i = 0; i < 100 && grandchild === null; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			grandchild = Number(readFileSync(pidFile, "utf8"));
		} catch {
			grandchild = null;
		}
	}
	assert.ok(grandchild, "the grandchild never started");
	assert.ok(alive(grandchild));
	process.kill(-runner.pid, "SIGKILL");
	let reaped = false;
	for (let i = 0; i < 80 && !reaped; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		reaped = !alive(grandchild);
	}
	if (!reaped) process.kill(grandchild, "SIGKILL");
	assert.ok(reaped, `grandchild ${grandchild} survived the runner's death`);
});

/*
 * Q1: with `ps` failing the whole run, a memory hog must still be killed (found
 * through `pgrep -P`), not waved through because only the ~17 MB coordinator was
 * read. A fake `ps` first on PATH fails the TABLE read only; the narrow pre-kill
 * re-check and everything else pass through to the real one.
 */
test("with the process table unreadable the runaway is still found and killed", () => {
	const bin = join(scratch, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(
		join(bin, "ps"),
		'#!/bin/sh\nif [ "$1" = "-axo" ]; then exit 1; fi\nexec /bin/ps "$@"\n',
	);
	chmodSync(join(bin, "ps"), 0o755);
	const result = spawnSync(
		process.execPath,
		[RUNNER, "--test-concurrency=1", HOLDER],
		{
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				[MEMORY_BUDGET_OVERRIDE_ENV]: "300",
			},
			timeout: 45000,
		},
	);
	assert.equal(result.status, BREACH_EXIT_CODE, result.stdout + result.stderr);
	assert.match(result.stderr, KILLED_GROUP_LINE);
	assert.match(result.stderr, TABLE_UNREADABLE);
});

/*
 * Q5: with the table unreadable AND a descendant that left the group (`setsid`),
 * the breach must still reach that descendant. Once the group is dead it is
 * re-parented to pid 1, so a "parent still in this tree" identity can never match
 * it; the walk therefore has to record its start time while the tree is still
 * intact. Pure shape first, then the real runner.
 */
test("a walked member's identity is recorded at walk time, so a re-parented one is still killed", async () => {
	const stamp = "Tue Sep 30 21:56:12 2026";
	const darwin = { platform: "darwin" };
	const reading = await sampleGroup(100, {
		...darwin,
		run: async (cmd, args) => {
			if (cmd === "pgrep") return args[1] === "100" ? "102\n" : "";
			if (cmd === "ps" && args[0] === "-axo") return null;
			if (cmd === "ps") return `  102   100   102  512 ${stamp}\n`;
			return "n [100]: 64-bit    Footprint: 10 MB (16384 bytes per page)\n";
		},
	});
	const walked = reading.members.find((member) => member.pid === 102);
	assert.equal(walked.lstart, stamp);
	assert.equal(walked.pgid, 102);
	// After the group kill the grandchild's parent is pid 1; same start time.
	const sent = [];
	const outcome = await killTree(100, reading.members, {
		kill: (target) => sent.push(target),
		run: async () => `  102     1   102  512 ${stamp}\n`,
	});
	assert.deepEqual(sent, [-100, 102]);
	assert.equal(outcome.skipped, 0);
});

test("with the table unreadable, a setsid'd grandchild does not survive the breach", () => {
	const bin = join(scratch, "bin-q5");
	mkdirSync(bin, { recursive: true });
	writeFileSync(
		join(bin, "ps"),
		'#!/bin/sh\nif [ "$1" = "-axo" ]; then exit 1; fi\nexec /bin/ps "$@"\n',
	);
	chmodSync(join(bin, "ps"), 0o755);
	const pidFile = join(scratch, "grandchild-q5.pid");
	const holder = join(scratch, "q5-holder.test.mjs");
	writeFileSync(
		holder,
		`import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
test("holds", async () => {
	const g = spawn("sleep", ["60"], { stdio: "ignore", detached: true });
	g.unref();
	writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
	const held = [];
	for (let i = 0; i < 20; i++) held.push(Buffer.alloc(64 * 1024 * 1024, 1));
	await new Promise((resolve) => setTimeout(resolve, 60000));
});
`,
	);
	const result = spawnSync(
		process.execPath,
		[RUNNER, "--test-concurrency=1", holder],
		{
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				[MEMORY_BUDGET_OVERRIDE_ENV]: "300",
			},
			timeout: 45000,
		},
	);
	assert.equal(result.status, BREACH_EXIT_CODE, result.stdout + result.stderr);
	const grandchild = Number(readFileSync(pidFile, "utf8"));
	const survived = alive(grandchild);
	if (survived) process.kill(grandchild, "SIGKILL");
	assert.equal(survived, false, `setsid grandchild ${grandchild} survived`);
});

/*
 * Keeper path with a space in it: `new URL(...).pathname` is percent-encoded, so
 * the keeper exited 1 under such a checkout and the runner never noticed. The
 * runner and what it imports are copied into a directory with a space and the
 * runner-SIGKILL case is repeated from there.
 */
test("the keeper still reaps the group when the checkout path contains a space", async () => {
	const dir = join(scratch, "dir with space", "scripts");
	mkdirSync(dir, { recursive: true });
	for (const name of [
		"run-desktop-tests.mjs",
		"desktop-test-keeper.mjs",
		"desktop-test-memory-guard.mjs",
		"desktop-test-concurrency.mjs",
		"notifications-off.mjs",
		"telemetry-off.mjs",
		"no-hardlink-write-preload.mjs",
		"no-hardlink-write.mjs",
	]) {
		copyFileSync(join(process.cwd(), "scripts", name), join(dir, name));
	}
	const pidFile = join(scratch, "grandchild-space.pid");
	const holder = join(scratch, "space-holder.test.mjs");
	writeFileSync(
		holder,
		`import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";
test("holds", async () => {
	const g = spawn("sleep", ["60"], { stdio: "ignore" });
	writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
	await new Promise((resolve) => setTimeout(resolve, 60000));
});
`,
	);
	const runner = spawn(
		process.execPath,
		[join(dir, "run-desktop-tests.mjs"), "--test-concurrency=1", holder],
		{
			detached: true,
			stdio: "ignore",
			env: { ...process.env, [MEMORY_BUDGET_OVERRIDE_ENV]: "off" },
		},
	);
	let grandchild = null;
	for (let i = 0; i < 100 && grandchild === null; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			grandchild = Number(readFileSync(pidFile, "utf8"));
		} catch {
			grandchild = null;
		}
	}
	assert.ok(grandchild, "the grandchild never started");
	process.kill(-runner.pid, "SIGKILL");
	let reaped = false;
	for (let i = 0; i < 80 && !reaped; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		reaped = !alive(grandchild);
	}
	if (!reaped) process.kill(grandchild, "SIGKILL");
	assert.ok(reaped, `grandchild ${grandchild} survived under a spaced path`);
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
	assert.match(result.stdout, WATCHDOG_OFF);
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
	assert.match(result.stdout, BUDGET_LINE);
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));
