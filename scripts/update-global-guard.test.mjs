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
	didSourceRebuildLand,
	evaluatePendingServerUpdateMarker,
	installDiagnosisLines,
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
	// 5. A group that is gone is `gone`, and an absent record is not a refusal.
	assert.deepEqual(decide({ marker: marker(), groupAlive: false }), [
		"expired",
		"gone",
	]);
	assert.deepEqual(decide({ marker: null, groupAlive: false }), ["none", null]);
	/*
	 * 5b. A record with NO GROUP NAMED expires as well, for the reason the marker is
	 *     rewritten with the group's pid the moment the spawn reports one: a record
	 *     still carrying `null` is an app that died before starting anything, and
	 *     treating it as live would wedge every later update behind a run that never
	 *     began. Its REASON is `unproven` rather than `gone` - the record never held a
	 *     pid, so "gone" would be a claim about evidence it does not have (review
	 *     round 3, N1).
	 */
	assert.deepEqual(
		decide({ marker: marker({ groupPid: null }), groupAlive: false }),
		["expired", "unproven"],
	);
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
		// No pid was ever recorded in this one, so the honest reason is `unproven`
		// (review round 3, N1): the record never held a group that could be gone.
		["expired", "unproven"],
	);
	assert.ok(PENDING_SERVER_UPDATE_GRACE_MS > 0);
});

test("a refusal's diagnosis is the head, and the bypass advice never reaches the panel", () => {
	/*
	 * THE OPERATOR'S OWN `lop-update`, refusing. Captured by driving the real script
	 * in an isolated repository - `LOCAL_OPERATOR_REPO` pointing at a throwaway
	 * checkout whose `main` is one commit behind its `origin/main`, so the script
	 * refuses BEFORE it builds anything - and pasted here verbatim, because the
	 * shape is the finding: the verdict and the refs are the FIRST paragraph, and
	 * the last line tells the reader to disable the guard that just refused them
	 * (review round 2, U7).
	 */
	const refusal = [
		"lop-update: warning: could not fetch origin (offline?); comparing against the last known state of origin/main",
		"lop-update: REFUSING to release a stale ref.",
		"",
		"  local  main          = 2a0b473",
		"  remote origin/main = 4b32d95  (1 commit(s) ahead)",
		"",
		"Local main is BEHIND origin/main, so installing it would publish code",
		"older than what is merged -- and would report success while doing it.",
		"",
		"Update the local ref first, then re-run:",
		"",
		"  git -C /repo fetch origin",
		"  git -C /repo update-ref refs/heads/main origin/main   # safe while another branch is checked out",
		"  lop-update main",
		"",
		"(If main is the checked-out branch, use 'git -C /repo merge --ff-only origin/main' instead.)",
		"",
		"To install the local ref anyway: lop-update main --skip-remote-check",
	].join("\n");

	const diagnosis = installDiagnosisLines(refusal);
	// The verdict, the refs and the consequence - the part that says WHY.
	assert.match(diagnosis, /REFUSING to release a stale ref\./);
	assert.match(diagnosis, /local {2}main {10}= 2a0b473/);
	assert.match(diagnosis, /4b32d95 {2}\(1 commit\(s\) ahead\)/);
	assert.match(diagnosis, /BEHIND origin\/main/);
	// Never the line that advises going around the refusal.
	assert.doesNotMatch(diagnosis, /--skip-remote-check/);
	assert.doesNotMatch(diagnosis, /bypass/i);
	// And never the shell recipe, which belongs to the by-hand path the panel
	// already offers - and which nests a `lop-update` line inside a message about
	// an app-run `lop-update`.
	assert.doesNotMatch(diagnosis, /git -C/);
	assert.doesNotMatch(diagnosis, /^lop-update .*$/m);
	assert.ok(diagnosis.split("\n").length <= 6, "the panel sentence is bounded");

	// A crash-shaped output keeps working: a one-line exit reason IS the diagnosis
	// when there is no structure to prefer, which is why the fallback is the tail.
	assert.equal(
		installDiagnosisLines("error: Failed to install\ninstaller exited 127"),
		"error: Failed to install\ninstaller exited 127",
	);
	// Nothing at all stays nothing: the panel then shows its own sentence alone.
	assert.equal(installDiagnosisLines("   \n\n  "), "");
});

test("a rebuild's landing is the marker, not the version", () => {
	/*
	 * The evidence rule for the source-build route. `lop-update` builds from the
	 * checkout's `main` while `pyproject.toml` names the last release, so a landed
	 * rebuild usually keeps the version - `0.56.x -> 0.56.x` - and a version
	 * comparison would report a success as a failure.
	 */
	const state = (ref, mtimeMs) => ({ ref, mtimeMs });
	const landed = (before, after) => didSourceRebuildLand({ before, after });
	assert.equal(
		landed(state("a".repeat(40), 1), state("b".repeat(40), 2)),
		true,
	);
	// The same commit reinstalled is NOT a landed update: the install still holds
	// the revision it held, and the panel must say so rather than claim progress.
	assert.equal(
		landed(state("a".repeat(40), 1), state("a".repeat(40), 9)),
		false,
	);
	// No refs to compare - an older writer, or a rebuild after a `reset` - the
	// marker's own write time is the fallback.
	assert.equal(landed(state(null, 1), state(null, 2)), true);
	assert.equal(landed(state(null, 2), state(null, 2)), false);
	// The first rebuild of a prefix that never carried a marker.
	assert.equal(landed(state(null, null), state("b".repeat(40), 2)), true);
	// An absent after reading is not evidence of anything good: the tool removed
	// the marker, or the prefix could not be read, and both are failures.
	assert.equal(landed(state("a".repeat(40), 1), state(null, null)), false);
	assert.equal(landed(state(null, null), state(null, null)), false);
});
