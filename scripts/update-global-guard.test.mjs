import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The two live defects in the shipped global-install update path, contract-checked
 * against the shipped TypeScript.
 *
 * 1. THE TIMEOUT'S REACH. The path ran `<resolved console path> update` through
 *    `runCommand`, which is `execFile` with a `timeout` - and that timeout signals
 *    the DIRECT CHILD. The child is a front end whose own children are `uv`, `pipx`
 *    or `pip`, so an expired budget signalled the front end and left the real
 *    installer replacing the install tree while the app declared the update failed.
 * 2. THE GUARD'S REACH. `globalUpdateInFlight` is one process's memory, and the
 *    durable record beside it was written but never CONSULTED before starting
 *    another updater - so a second app instance, or a relaunch after a crash, could
 *    put a second `<console path> update` on one install root. A record that says
 *    "running" has to be believed only when it is really this app's run: a pid is
 *    unique among LIVE processes only, and `EPERM` counts as alive.
 *
 * The properties under test are properties of real processes, so the runner cases
 * drive real children: a fixture that only records the calls cannot show that a
 * descendant stopped, and that is the whole point of the stop.
 */
const group = await build({
	stdin: {
		contents: 'export * from "./src/main/install-group-run";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const runner = await import(
	`data:text/javascript;base64,${Buffer.from(
		group.outputFiles[0].text,
	).toString("base64")}`
);
const {
	isInstallGroupAlive,
	readProcessStartStamp,
	runInOwnProcessGroup,
	waitForInstallGroupGone,
} = runner;

const installBundle = await build({
	stdin: {
		contents: 'export * from "./src/main/update-install";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const install = await import(
	`data:text/javascript;base64,${Buffer.from(
		installBundle.outputFiles[0].text,
	).toString("base64")}`
);
const {
	PENDING_SERVER_UPDATE_GRACE_MS,
	evaluatePendingServerUpdateMarker,
	parsePendingServerUpdateMarker,
} = install;

/** The two markers the happy-path fixture prints, hoisted per `useTopLevelRegex`. */
const STDOUT_MARKER = /out/;
const STDERR_MARKER = /err/;

/** Poll a predicate, because these are real processes with real timers. */
async function waitFor(predicate, budgetMs = 5000) {
	const started = Date.now();
	while (Date.now() - started < budgetMs) {
		if (predicate()) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return predicate();
}

test("the budget stops the whole group, and the verdict does not wait for a descendant", async () => {
	/*
	 * The M1 case, against the runner the shipped path now uses. The fixture's
	 * descendant TRAPS SIGTERM, so a stop that only signalled the leader, or only
	 * sent SIGTERM, would leave it appending to the ledger: the escalation is what
	 * has to end it, and the ledger stopping is how that is observed.
	 */
	const root = mkdtempSync(join(tmpdir(), "lo-global-group-"));
	const ledger = join(root, "writes.txt");
	const descendantPidFile = join(root, "descendant.pid");
	const fixture = join(root, "fixture.sh");
	writeFileSync(
		fixture,
		[
			"#!/bin/sh",
			`( trap '' TERM; i=0; while [ $i -lt 100000 ]; do echo "line $i" >> "${ledger}"; i=$((i+1)); sleep 0.01; done ) &`,
			`echo $! > "${descendantPidFile}"`,
			"wait",
		].join("\n"),
		{ mode: 0o755 },
	);
	let descendantPid = null;
	try {
		/*
		 * THE BUDGET IS LONG ENOUGH FOR THE FIXTURE TO START, and the escalation is
		 * short. Both are load decisions: a loaded machine can take longer to spawn
		 * `sh` than a 300ms budget, and a case whose fixture never starts proves
		 * nothing about the stop. What the case is actually about - that the verdict
		 * is taken on the timer instead of waiting for the descendant's streams - is
		 * unaffected: a violation of that property is bounded by the descendant's own
		 * loop (minutes), not by a second or two, so the generous bound below still
		 * discriminates while a tight one would fail this suite on a busy box and
		 * prove nothing on an idle one.
		 */
		const budgetMs = 4000;
		const startedAt = Date.now();
		const result = await runInOwnProcessGroup({
			command: "/bin/sh",
			args: [fixture],
			timeoutMs: budgetMs,
			graceMs: 500,
		});
		// (1) The verdict is taken on the timer, not on a descendant's exit.
		assert.equal(result.timedOut, true);
		assert.equal(result.ran, false);
		assert.ok(
			Date.now() - startedAt < budgetMs + 30_000,
			`the verdict waited for the descendant: ${Date.now() - startedAt}ms against a ${budgetMs}ms budget`,
		);
		assert.ok(result.groupPid !== null, "the run never reported its group");
		/*
		 * (2) THE DESCENDANT - not the leader - is what stopped, and `kill -0`
		 * answering ESRCH is the only proof that nothing is left writing into the
		 * install root. Its pid comes from the fixture itself, because the leader
		 * dying is exactly what a leader-only stop proved and exactly what was not
		 * enough - so the fixture's own pidfile is waited for rather than assumed.
		 */
		assert.equal(
			await waitFor(() => existsSync(descendantPidFile), 30_000),
			true,
			"the fixture never started its descendant",
		);
		descendantPid = Number(readFileSync(descendantPidFile, "utf8").trim());
		assert.ok(descendantPid > 0, "the fixture reported no descendant pid");
		assert.equal(
			await waitFor(() => !isInstallGroupAlive(result.groupPid), 30_000),
			true,
			"the signalled group outlived its wait",
		);
		// (3) The prefix stops growing.
		const lines = () => readFileSync(ledger, "utf8").split("\n").length;
		const settled = lines();
		await new Promise((resolve) => setTimeout(resolve, 1000));
		assert.equal(
			lines(),
			settled,
			"something was still writing into the prefix",
		);
	} finally {
		if (descendantPid !== null) {
			try {
				process.kill(descendantPid, "SIGKILL");
			} catch {
				/* Already gone, which is the expected state. */
			}
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("the escalation is armed on its own handle and does not hold the process open", async () => {
	/*
	 * The grace timer is what could keep the main process alive after the verdict has
	 * been delivered, and `close` knows nothing about it - so it is armed on a handle
	 * of its own and `unref`'d. Watched through the global rather than described, and
	 * the tick that arms it is identified by the log line the timeout handler writes
	 * first, so the assertion is about THAT timer and not about whichever timer the
	 * run happened to create last.
	 */
	const root = mkdtempSync(join(tmpdir(), "lo-global-escalation-"));
	const fixture = join(root, "ignore-term.sh");
	writeFileSync(fixture, ["#!/bin/sh", "trap '' TERM", "sleep 5"].join("\n"), {
		mode: 0o755,
	});
	const originalSetTimeout = globalThis.setTimeout;
	let inTimeoutTick = false;
	let escalation = null;
	globalThis.setTimeout = (fn, ms, ...rest) => {
		const handle = originalSetTimeout(fn, ms, ...rest);
		if (inTimeoutTick && escalation === null) escalation = handle;
		return handle;
	};
	try {
		const result = await runInOwnProcessGroup({
			command: "/bin/sh",
			args: [fixture],
			timeoutMs: 300,
			// Long enough that the escalation is still pending when it is inspected.
			graceMs: 10_000,
			log: (line) => {
				if (line.includes("did not finish within")) inTimeoutTick = true;
			},
		});
		assert.equal(result.timedOut, true);
		assert.ok(escalation, "the run never armed an escalation timer");
		assert.equal(
			escalation.hasRef(),
			false,
			"the escalation kept the event loop alive past the verdict",
		);
		if (result.groupPid !== null) {
			await waitForInstallGroupGone(result.groupPid, 15_000);
		}
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		if (escalation) originalSetTimeout(() => escalation.close?.(), 0);
		rmSync(root, { recursive: true, force: true });
	}
});

test("a run that finishes reports its code and both streams", async () => {
	const result = await runInOwnProcessGroup({
		command: "/bin/sh",
		args: ["-c", "echo out; echo err >&2; exit 7"],
		timeoutMs: 10_000,
	});
	assert.equal(result.ran, true);
	assert.equal(result.timedOut, false);
	assert.equal(result.exitCode, 7);
	assert.match(result.stdout, STDOUT_MARKER);
	assert.match(result.stderr, STDERR_MARKER);
	assert.equal(result.groupStillRunning, false);
});

test("the kernel's start stamp is the identity, and a dead pid has none", async () => {
	/*
	 * The evidence the refusal leans on. Read from the same `ps` the app reads, and
	 * against real processes: a live pid answers with a stamp, two live processes do
	 * not share one, and a pid that is gone answers null rather than a stale reading.
	 */
	const child = spawn("/bin/sh", ["-c", "sleep 30"], {
		detached: true,
		stdio: "ignore",
	});
	try {
		const stamp = readProcessStartStamp(child.pid);
		assert.equal(typeof stamp, "string");
		assert.notEqual(stamp, readProcessStartStamp(process.pid));
		process.kill(-child.pid, "SIGKILL");
		assert.equal(
			await waitFor(() => readProcessStartStamp(child.pid) === null),
			true,
			"a pid that is gone must answer null rather than a stale stamp",
		);
	} finally {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			/* Already gone. */
		}
	}
});

test("the recorded group is believed only when it is ours, and its deadline bounds it", () => {
	/*
	 * The refusal's decision table, with `now` as an input so the expiry is a case
	 * rather than a sleep. The failure mode of getting this wrong is a permanent
	 * refusal: a record whose pid was recycled describes a run that ended, and a
	 * refusal that believes it never lets a legitimate update through again.
	 */
	const marker = (over = {}) => ({
		before: "0.56.2",
		target: "0.56.3",
		startedAt: "2026-09-17T02:00:00.000Z",
		deadlineAt: "2026-09-17T02:15:00.000Z",
		groupPid: 4242,
		groupStartedAt: "Thu Sep 17 02:00:00 2026",
		...over,
	});
	const decide = (input) => {
		const outcome = evaluatePendingServerUpdateMarker(input);
		return [outcome.kind, outcome.reason ?? null];
	};
	// 1. Alive and ours, however long ago that was: the app's budget stops it
	//    WAITING, and nothing stops a detached updater from finishing after a crash.
	//    This is the one case with no age bound, because it is the only one with
	//    evidence the process is the one this app started.
	assert.deepEqual(
		decide({
			marker: marker(),
			groupAlive: true,
			liveGroupStamp: "Thu Sep 17 02:00:00 2026",
			now: Date.parse("2026-09-20T00:00:00.000Z"),
		}),
		["running", "owned"],
	);
	// 2. Alive and NOT ours - the pid was recycled onto a stranger - expires, which
	//    is what frees the record and lets a later update land.
	assert.deepEqual(
		decide({
			marker: marker(),
			groupAlive: true,
			liveGroupStamp: "Thu Sep 17 09:00:00 2026",
			now: Date.parse("2026-09-17T02:01:00.000Z"),
		}),
		["expired", "foreign-pid"],
	);
	// 3. Alive with no identity to compare, inside the budget plus the grace: the
	//    shape a record written before these fields existed has, and the honest
	//    answer is "running".
	assert.deepEqual(
		decide({
			marker: marker({ groupStartedAt: null }),
			groupAlive: true,
			liveGroupStamp: "Thu Sep 17 09:00:00 2026",
			now: Date.parse("2026-09-17T02:16:00.000Z"),
		}),
		["running", "unproven"],
	);
	// 4. The same record long past its own deadline expires: the budget is the app's
	//    own statement about how long a run may take.
	assert.deepEqual(
		decide({
			marker: marker({ groupStartedAt: null }),
			groupAlive: true,
			liveGroupStamp: "Thu Sep 17 09:00:00 2026",
			now: Date.parse("2026-09-17T10:30:00.000Z"),
		}),
		["expired", "expired"],
	);
	// 5. No group at all is the third reason, and an absent record is not a refusal.
	assert.deepEqual(decide({ marker: marker(), groupAlive: false }), [
		"expired",
		"gone",
	]);
	assert.deepEqual(decide({ marker: null, groupAlive: false }), ["none", null]);
	// 6. The parsed shape: the identity fields are additive, so a record written
	//    before them reads as "no evidence" rather than as a live group.
	const legacy = parsePendingServerUpdateMarker(
		JSON.stringify({
			before: "0.56.2",
			target: null,
			startedAt: "2026-09-17T02:00:00.000Z",
		}),
	);
	assert.equal(legacy?.groupPid, null);
	assert.equal(legacy?.groupStartedAt, null);
	assert.equal(legacy?.deadlineAt, null);
	assert.deepEqual(
		decide({
			marker: legacy,
			groupAlive: false,
			now: Date.parse("2026-09-17T02:01:00.000Z"),
		}),
		["expired", "gone"],
	);
	assert.ok(PENDING_SERVER_UPDATE_GRACE_MS > 0);
});
