import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { join } from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const moduleUrl = new URL("./desktop-suite-checkpoints.mjs", import.meta.url);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api() {
	assert.ok(
		existsSync(moduleUrl),
		"independent checkpoint supervisor must exist before a blocked suite can publish evidence",
	);
	return import(moduleUrl);
}
function fixture(body) {
	const dir = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"suite-checkpoint-",
		),
	);
	const shell = join(dir, "suite.sh");
	writeFileSync(shell, `#!/bin/bash\nset -o pipefail\n${body}\n`);
	return { dir, shell, state: join(dir, "state") };
}

test("checkpoint: immutable evidence is available while the subject is blocked", async () => {
	const a = await api();
	const f = fixture('echo "subject-started"; sleep 30');
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 4000,
		setupStarted: Date.now(),
		witnessMs: 50,
	});
	const readyDeadline = Date.now() + 2500;
	while (Date.now() < readyDeadline) {
		try {
			if (
				JSON.parse(readFileSync(join(f.state, "witness.json"), "utf8")).snapshot
			)
				break;
		} catch {
			/* Not published yet. */
		}
		await pause(50);
	}
	const first = await a.checkpoint({
		state: f.state,
		afterMs: 150,
		output: join(f.dir, "early.json"),
	});
	assert.equal(first.terminal, null);
	assert.ok(first.witness.sequence > 0);
	assert.ok(first.witness.snapshot.rows.length > 0);
	const frozen = readFileSync(join(f.dir, "early.json"), "utf8");
	await a.checkpoint({
		state: f.state,
		afterMs: 350,
		output: join(f.dir, "later.json"),
	});
	assert.equal(readFileSync(join(f.dir, "early.json"), "utf8"), frozen);
	const result = await a.awaitResult({ state: f.state });
	assert.equal(result.code, 124);
	assert.equal(result.reason, "absolute-deadline");
	assert.equal(
		result.deadline,
		first.deadline,
		"checkpoint waits cannot restart the absolute suite allowance",
	);
	assert.equal(result.deadline - result.launched, 4000);
});

test("checkpoint: healthy, failing and late-TLA subjects keep their actual verdict", async () => {
	const a = await api();
	for (const [body, wanted] of [
		["echo healthy; exit 0", 0],
		["echo failing; exit 23", 23],
		["echo before-errexit; false; echo MUST-NOT-RUN", 1],
		[
			`'${process.execPath}' --input-type=module -e 'await new Promise(r=>setTimeout(r,100));console.log("late registration ran")'`,
			0,
		],
	]) {
		const f = fixture(body);
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 5000,
			setupStarted: Date.now(),
			witnessMs: 50,
		});
		const result = await a.awaitResult({ state: f.state });
		assert.equal(result.code, wanted);
		assert.ok(readFileSync(join(f.state, "console.log"), "utf8").length > 0);
		assert.equal(result.cleanup.remaining.length, 0);
	}
});

async function witnessReady(state, predicate = (w) => Boolean(w.snapshot)) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		try {
			const w = JSON.parse(readFileSync(join(state, "witness.json"), "utf8"));
			if (predicate(w)) return w;
		} catch {
			/* Initial handoff not written yet. */
		}
		await pause(50);
	}
	assert.fail("independent witness did not publish the required observation");
}

test("checkpoint: sampler timeout is bounded and the next sample can run", async () => {
	const a = await api();
	const sample = a.startSample(
		[process.execPath, "-e", "setInterval(()=>{},1000)"],
		{ timeoutMs: 100 },
	);
	assert.equal((await sample.done).event, "sample-timeout");
	assert.equal(a.identity(sample.child.pid), null);
	const control = a.startSample([
		process.execPath,
		"-e",
		"console.log(JSON.stringify({rows:[]}))",
	]);
	assert.equal((await control.done).event, "sample-end");
});

test("checkpoint: reaping a frozen holder releases the inherited pipe and keeps the evidence", async () => {
	const a = await api();
	const f = fixture("exit 0");
	mkdirSync(f.state);
	// A stand-in supervisor: detached, so it owns its group, and holding THIS
	// process's pipe exactly as a step's supervisor would hold the runner's. It
	// is stopped, because that is the state the real hang is in - a process that
	// cannot run its own cleanup - and a stopped process still holds its fds.
	const holder = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const released = new Promise((r) => holder.once("exit", () => r("released")));
	try {
		process.kill(holder.pid, "SIGSTOP");
		writeFileSync(
			join(f.state, "owner.json"),
			JSON.stringify(a.identity(holder.pid)),
		);
		// The census is the artifact that must survive the bound.
		writeFileSync(join(f.state, "kernel-census.jsonl"), '{"index":0}\n');
		// RED: unreaped, the pipe stays held and the step could never end.
		assert.equal(
			await Promise.race([released, pause(400).then(() => "held")]),
			"held",
			"a frozen holder keeps an inherited pipe open, which is the hang",
		);
		// GREEN: the failure arm reaps the recorded group, and the pipe closes.
		assert.equal(a.reap(f.state).receipts[0].killed, true);
		assert.equal(
			await Promise.race([released, pause(4000).then(() => "held")]),
			"released",
			"reaping the recorded group must release the inherited pipe",
		);
		assert.ok(
			readFileSync(join(f.state, "kernel-census.jsonl"), "utf8").length > 0,
			"the census must still be reachable after the bound",
		);
	} finally {
		try {
			process.kill(holder.pid, "SIGKILL");
		} catch {
			/* Already reaped. */
		}
	}
});

test("checkpoint: the reaper refuses an unsafe or mismatched record instead of signalling blind", async () => {
	const a = await api();
	const f = fixture("exit 0");
	mkdirSync(f.state);
	const live = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
		detached: true,
		stdio: "ignore",
	});
	const signals = [];
	const kill = (pgid) => signals.push(pgid);
	const record = (value) =>
		writeFileSync(join(f.state, "owner.json"), JSON.stringify(value));
	try {
		for (const [label, value, reason] of [
			["init", { pid: 1, pgid: 1, start: "1" }, "refused-unsafe-pid"],
			["zero", { pid: 0, pgid: 0, start: "1" }, "refused-unsafe-pid"],
			[
				"mismatched start",
				{ ...a.identity(live.pid), start: "not-the-recorded-start" },
				"refused-identity-changed",
			],
			[
				"borrowed group",
				{ ...a.identity(live.pid), pgid: 1 },
				"refused-not-own-group",
			],
		]) {
			record(value);
			const receipt = a.reap(f.state, { kill });
			assert.equal(receipt.receipts[0].reason, reason, label);
			assert.equal(receipt.receipts[0].killed, false, label);
		}
		assert.deepEqual(
			signals,
			[],
			"no refusal may reach a kill, and pid <= 1 is never signalled",
		);
		// The control that keeps the refusals honest: the SAME live process, with
		// its own identity recorded, is killed.
		record(a.identity(live.pid));
		const receipt = a.reap(f.state, { kill });
		assert.equal(receipt.receipts[0].killed, true);
		assert.deepEqual(signals, [live.pid]);
	} finally {
		try {
			process.kill(-live.pid, "SIGKILL");
		} catch {
			/* Already gone. */
		}
	}
});

test("checkpoint: a finished run leaves the reaper nothing to kill", async () => {
	const a = await api();
	const f = fixture('echo "tap: ok"');
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 5000,
		setupStarted: Date.now(),
		witnessMs: 50,
	});
	const result = await a.awaitResult({ state: f.state });
	assert.equal(result.code, 0);
	assert.equal(result.cleanup.remaining.length, 0);
	assert.ok(
		readFileSync(join(f.state, "console.log"), "utf8").includes("tap: ok"),
	);
	// The supervisor is still exiting when the verdict lands; wait for the exit
	// rather than racing it, so "nothing to kill" is a fact and not a coin toss.
	const owner = JSON.parse(readFileSync(join(f.state, "owner.json"), "utf8"));
	const deadline = Date.now() + 10_000;
	while (a.identity(owner.pid) && Date.now() < deadline) await pause(25);
	const receipt = a.reap(f.state);
	assert.deepEqual(
		receipt.receipts.map((r) => r.killed),
		[false, false],
		"a completed run must leave no group to kill",
	);
	assert.ok(
		readFileSync(join(f.state, "console.log"), "utf8").includes("tap: ok"),
		"the verdict and the forwarded TAP must be untouched by the arm",
	);
});

// A process census cannot separate the witness's sampler from the helper child
// `identity()` forks on Darwin: that helper (and its pre-exec fork copy) shows up
// in a `ps -axo` sweep of the observer's children, so counting children races the
// probe and reads the probe itself as a second sampler. The witness already
// publishes both facts the assertions need — the ordered event stream and the
// sampler it latched — so read those two files in one iteration instead.
async function witnessWithLatch(state, predicate) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		let witness = null;
		let owner = null;
		try {
			witness = JSON.parse(readFileSync(join(state, "witness.json"), "utf8"));
		} catch {
			/* Initial handoff not written yet. */
		}
		try {
			owner = JSON.parse(
				readFileSync(join(state, "sample-owner.json"), "utf8"),
			);
		} catch {
			/* No sample is in flight. */
		}
		if (witness && predicate(witness, owner)) return { witness, owner };
		await pause(10);
	}
	assert.fail("independent witness did not publish the required observation");
}

const SAMPLE_SETTLED = new Set([
	"sample-timeout",
	"sample-end",
	"sample-error",
]);

test("checkpoint: witness advances while a hung detailed sampler times out without overlap", async () => {
	const a = await api();
	const f = fixture("exit 0");
	mkdirSync(f.state);
	writeFileSync(
		join(f.state, "config.json"),
		JSON.stringify({
			state: f.state,
			deadline: Date.now() + 10_000,
			witnessMs: 50,
			launcher: a.identity(process.pid),
		}),
	);
	// A portable fake-ps stand-in: it never resolves, has no inherited Actions
	// pipe and must be killed/reaped solely as the witness's own sample group.
	const code = `import {witness} from "${moduleUrl.href}"; await witness(process.argv[1], {sampleCommand:[process.execPath,"-e","setInterval(()=>{},1000)"],sampleTimeoutMs:600});`;
	const observer = spawn(
		process.execPath,
		["--input-type=module", "-e", code, f.state],
		{ detached: true, stdio: "ignore" },
	);
	const exited = new Promise((r) => observer.once("exit", r));
	try {
		// The event stream and the latch are read in one iteration, and the latch is
		// only accepted while the first sample is the only one begun and none has
		// settled, so `owner` is provably that sample's sampler rather than a
		// successor's.
		const hung = await witnessWithLatch(
			f.state,
			(w, owner) =>
				owner &&
				w.events.filter((e) => e.event === "sample-begin").length === 1 &&
				!w.events.some((e) => SAMPLE_SETTLED.has(e.event)),
		);
		assert.equal(
			hung.owner.ppid,
			observer.pid,
			"the sampler runs as the witness's own child",
		);
		assert.equal(
			hung.owner.pgid,
			hung.owner.pid,
			"the sampler owns the group the witness kills",
		);
		const settled = await witnessWithLatch(f.state, (w) =>
			w.events.some((e) => SAMPLE_SETTLED.has(e.event)),
		);
		assert.ok(
			settled.witness.sequence > hung.witness.sequence,
			"the witness keeps ticking while its sampler is hung",
		);
		const stream = settled.witness.events;
		const begin = stream.findIndex((e) => e.event === "sample-begin");
		const end = stream.findIndex((e) => SAMPLE_SETTLED.has(e.event));
		assert.ok(
			begin >= 0 && end > begin,
			"the sample must open before it settles",
		);
		assert.equal(
			stream[end].event,
			"sample-timeout",
			"a sampler that never resolves is bounded by its timeout",
		);
		const inFlight = stream.slice(begin + 1, end);
		assert.equal(
			inFlight.filter((e) => e.event === "sample-begin").length,
			0,
			"independent ticks must not accumulate overlapping samplers",
		);
		assert.ok(
			inFlight.some((e) => e.event === "witness-alive"),
			"the witness advances while the hung sampler is still in flight",
		);
		assert.equal(
			a.identity(hung.owner.pid),
			null,
			"timed-out sampler was reaped",
		);
	} finally {
		observer.kill("SIGTERM");
		await exited;
	}
});

test("checkpoint: blocked parent/coordinator loops do not block the witness", async () => {
	const a = await api();
	for (const role of ["parent", "coordinator"]) {
		const publish =
			role === "coordinator"
				? `import {publishCoordinator} from "${moduleUrl.href}"; publishCoordinator(process.env.LOCAL_OPERATOR_UI_COORDINATOR_IDENTITY, process.pid);`
				: "";
		const f = fixture(
			`'${process.execPath}' --input-type=module -e '${publish} console.log("${role}-begin"); const until=Date.now()+1700; while(Date.now()<until){}; console.log("${role}-end")'`,
		);
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 5000,
			setupStarted: Date.now(),
			witnessMs: 75,
		});
		const first = await witnessReady(f.state);
		await pause(150);
		const later = await witnessReady(
			f.state,
			(w) => w.sequence > first.sequence,
		);
		assert.ok(later.sequence > first.sequence);
		const progress = readFileSync(join(f.state, "console.log"), "utf8");
		assert.ok(progress.includes(`${role}-begin`));
		assert.ok(
			!progress.includes(`${role}-end`),
			"witness must advance during the synchronous block, not just after it",
		);
		if (role === "coordinator") assert.ok(later.snapshot.coordinator?.pid);
		else assert.equal(later.snapshot.coordinator, null);
		assert.equal((await a.awaitResult({ state: f.state })).code, 0);
	}
});

test("checkpoint: sink backpressure does not stop file witness; draining forwards once", async () => {
	const a = await api();
	const f = fixture('printf "one-progress-record\\n"; sleep 1');
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 5000,
		setupStarted: Date.now(),
		witnessMs: 75,
	});
	const first = await witnessReady(f.state);
	const blocked = new Writable({
		highWaterMark: 1,
		write(_chunk, _encoding, _done) {},
	});
	a.forwardAvailable(f.state, blocked);
	assert.equal(blocked.writableNeedDrain, true);
	const later = await witnessReady(f.state, (w) => w.sequence > first.sequence);
	assert.ok(later.sequence > first.sequence);
	let text = "";
	const draining = new Writable({
		write(chunk, _encoding, done) {
			text += chunk.toString();
			done();
		},
	});
	const before = readFileSync(join(f.state, "forward-offset.json"), "utf8");
	a.forwardAvailable(f.state, blocked);
	assert.equal(
		readFileSync(join(f.state, "forward-offset.json"), "utf8"),
		before,
	);
	assert.equal((await a.awaitResult({ state: f.state })).code, 0);
	a.forwardAvailable(f.state, draining);
	a.forwardAvailable(f.state, draining);
	assert.equal(
		text,
		"",
		"already forwarded bytes must not become duplicate TAP evidence",
	);
	blocked.destroy();
	const control = fixture('printf "draining-control\\n"');
	a.launch({
		state: control.state,
		shell: control.shell,
		durationMs: 5000,
		setupStarted: Date.now(),
		witnessMs: 75,
	});
	assert.equal((await a.awaitResult({ state: control.state })).code, 0);
	a.forwardAvailable(control.state, draining);
	a.forwardAvailable(control.state, draining);
	assert.equal(text, "draining-control\n");
	draining.destroy();
});

test("checkpoint: an exited coordinator leaves a stdout holder visible in its own group only", async () => {
	const a = await api();
	const f = fixture(
		`'${process.execPath}' --input-type=module -e 'import {publishCoordinator} from "${moduleUrl.href}"; import {spawn} from "node:child_process"; publishCoordinator(process.env.LOCAL_OPERATOR_UI_COORDINATOR_IDENTITY, process.pid); spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:["ignore",1,2]}).unref();' | cat`,
	);
	const unrelated = spawn(
		process.execPath,
		["-e", "setInterval(()=>{},1000)"],
		{ detached: true, stdio: "ignore" },
	);
	try {
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 2000,
			setupStarted: Date.now(),
			witnessMs: 75,
		});
		const w = await witnessReady(f.state, (w) =>
			w.snapshot?.rows.some((r) => r.ppid === 1),
		);
		assert.ok(w.snapshot.rows.some((r) => r.ppid === 1));
		assert.ok(w.snapshot.coordinator?.pid);
		assert.equal(
			a.identity(w.snapshot.coordinator.pid),
			null,
			"coordinator exited while the owned-group holder remains",
		);
		assert.ok(!w.snapshot.rows.some((r) => r.pid === unrelated.pid));
		assert.ok(a.identity(unrelated.pid), "unrelated group must not be reaped");
		if (process.platform === "linux") {
			const holder = w.snapshot.rows.find(
				(row) => row.ppid === 1 && row.endpoints?.some((fd) => fd.fd === 1),
			);
			assert.ok(
				holder,
				"Linux must expose the inherited stdout endpoint of the owned holder",
			);
			const knownGroup = JSON.parse(
				readFileSync(join(f.state, "config.json"), "utf8"),
			).pipeline.pgid;
			for (const row of w.snapshot.rows) {
				assert.equal(row.pgid, knownGroup);
				assert.ok(!("command" in row) && !("argv" in row) && !("env" in row));
				for (const fd of row.endpoints ?? [])
					assert.match(fd.target, /^(pipe|socket):\[\d+\]$/);
			}
		} else
			assert.equal(
				w.snapshot.pipeSupport,
				"unsupported on Darwin; no pipe-owner attribution",
			);
		assert.equal((await a.awaitResult({ state: f.state })).code, 124);
	} finally {
		unrelated.kill("SIGKILL");
		await new Promise((r) => unrelated.once("exit", r));
	}
});

test("checkpoint: termination cannot turn a signal-handling subject into success", async () => {
	const a = await api();
	const f = fixture("trap 'exit 0' TERM; sleep 30");
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 5000,
		setupStarted: Date.now(),
		witnessMs: 75,
	});
	await witnessReady(f.state);
	const owner = JSON.parse(readFileSync(join(f.state, "owner.json"), "utf8"));
	process.kill(owner.pid, "SIGTERM");
	const result = await a.awaitResult({ state: f.state });
	assert.equal(result.code, 143);
	assert.equal(result.reason, "SIGTERM");
	assert.equal(result.cleanup.remaining.length, 0);
});

test("checkpoint: real CLI waits forward each byte once and retain status and outputs", async () => {
	const a = await api();
	const f = fixture(
		'echo "desktop tests: 1 file, concurrency 1"; sleep 0.6; echo "::error::synthetic annotation"; echo "elapsed=7" >> "$GITHUB_OUTPUT"; exit 23',
	);
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 5000,
		setupStarted: Date.now(),
		witnessMs: 75,
	});
	const env = { ...process.env, GITHUB_OUTPUT: join(f.dir, "step-outputs") };
	const early = spawnSync(
		process.execPath,
		[
			moduleUrl.pathname,
			"checkpoint",
			f.state,
			"250",
			join(f.dir, "checkpoint.json"),
		],
		{ env, encoding: "utf8", timeout: 8000 },
	);
	assert.equal(early.status, 0, early.stderr);
	const final = spawnSync(
		process.execPath,
		[moduleUrl.pathname, "await", f.state],
		{ env, encoding: "utf8", timeout: 8000 },
	);
	assert.equal(final.status, 23, final.stderr);
	assert.equal(
		early.stdout + final.stdout,
		readFileSync(join(f.state, "console.log"), "utf8"),
	);
	assert.equal(readFileSync(env.GITHUB_OUTPUT, "utf8"), "elapsed=7\n");
});

function boundedExit(child, ms) {
	return new Promise((r) => {
		const timer = setTimeout(() => r({ timedOut: true }), ms);
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			r({ code, signal, timedOut: false });
		});
	});
}

test("A1: checkpoint CLI exits with a real undrained stdout pipe", async () => {
	const a = await api();
	const f = fixture(
		`'${process.execPath}' -e 'process.stdout.write("x".repeat(512*1024));setInterval(()=>{},1000)'`,
	);
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 2500,
		setupStarted: Date.now(),
		witnessMs: 75,
	});
	const child = spawn(
		process.execPath,
		[
			moduleUrl.pathname,
			"checkpoint",
			f.state,
			"600",
			join(f.dir, "early.json"),
		],
		{ stdio: ["ignore", "pipe", "ignore"] },
	);
	// Intentionally NEVER read/resume stdout: this is the real OS pipe that
	// kept natural Node exit pending, not a Writable stub's bookkeeping flag.
	const exit = boundedExit(child, 1800);
	try {
		const first = await witnessReady(f.state);
		const result = await exit;
		assert.equal(
			result.timedOut,
			false,
			"early artifact handoff must not depend on stdout draining",
		);
		assert.equal(result.code, 0);
		assert.equal(
			child.stdout.readableLength,
			0,
			"checkpoint must be file-only",
		);
		await witnessReady(f.state, (w) => w.sequence > first.sequence);
		assert.ok(existsSync(join(f.dir, "early.json")));
	} finally {
		child.kill("SIGKILL");
		child.stdout.destroy();
		await a.awaitResult({ state: f.state });
	}
});

test("A2: identity, publication and observer startup failures reap only the owned suite", async () => {
	const a = await api();
	for (const fault of [
		"identity",
		"publication",
		"observer",
		"identity-mismatch",
	]) {
		const f = fixture('echo $$ > "$GITHUB_OUTPUT.pid"; sleep 30');
		mkdirSync(f.state);
		writeFileSync(
			join(f.state, "config.json"),
			JSON.stringify({
				state: f.state,
				shell: f.shell,
				cwd: process.cwd(),
				launched: Date.now(),
				deadline: Date.now() + 2500,
				setupStarted: Date.now(),
				launcher: a.identity(process.pid),
				witnessMs: 75,
			}),
		);
		const code = `import {worker,identity} from "${moduleUrl.href}"; import {spawn} from "node:child_process"; const fault=process.argv[2]; const options={}; if(fault==="identity")options.identify=()=>null; if(fault==="identity-mismatch")options.identify=pid=>pid===process.pid?identity(pid):identity(Number(process.argv[3])); if(fault==="publication")options.publish=()=>{throw Error("synthetic publication failure")}; if(fault==="observer")options.spawnObserver=()=>spawn("/nonexistent-observer-test-only",[],{detached:true,stdio:"ignore"}); try{await worker(process.argv[1],options)}catch{process.exitCode=1}`;
		const sentinel = spawn(
			process.execPath,
			["-e", "setInterval(()=>{},1000)"],
			{ detached: true, stdio: "ignore" },
		);
		const sentinelExit = boundedExit(sentinel, 8000);
		const child = spawn(
			process.execPath,
			["--input-type=module", "-e", code, f.state, fault, String(sentinel.pid)],
			{ stdio: "ignore" },
		);
		let ownedPid;
		try {
			const result = await boundedExit(child, 6000);
			// Old startup throws before a terminal receipt and leaves the shell.
			const waitUntil = Date.now() + 500;
			while (
				Date.now() < waitUntil &&
				!existsSync(join(f.state, "terminal.json")) &&
				!existsSync(join(f.state, "outputs.pid"))
			)
				await pause(25);
			let terminal = null;
			try {
				terminal = JSON.parse(
					readFileSync(join(f.state, "terminal.json"), "utf8"),
				);
			} catch {
				/* RED path */
			}
			try {
				ownedPid = Number(
					readFileSync(join(f.state, "outputs.pid"), "utf8").trim(),
				);
			} catch {
				ownedPid = terminal?.pipelinePid;
			}
			assert.equal(result.timedOut, false);
			assert.ok(
				terminal,
				`${fault}: startup failure must be supervised through cleanup and terminal publication`,
			);
			assert.equal(terminal.reason, "startup-error");
			assert.notEqual(terminal.code, 0);
			assert.ok(ownedPid > 1);
			assert.equal(
				a.identity(ownedPid),
				null,
				`${fault}: detached suite survived startup failure`,
			);
			assert.ok(
				a.identity(sentinel.pid),
				"unrelated sentinel must remain alive",
			);
		} finally {
			if (ownedPid > 1) {
				const row = a.identity(ownedPid);
				if (row?.pgid === ownedPid) {
					try {
						process.kill(-ownedPid, "SIGKILL");
					} catch {}
				}
			}
			child.kill("SIGTERM");
			sentinel.kill("SIGKILL");
			await sentinelExit;
		}
	}
});

/**
 * A synthetic /proc tree. The census is the same code with procRoot=/proc on a
 * Linux runner; this fixture lets the parsing and the byte cap be exercised on
 * this Darwin host, where /proc does not exist at all.
 */
const procFixture = (pids) => {
	const root = mkdtempSync(join(tmpdir(), "proc-fixture-"));
	for (const [pid, spec] of Object.entries(pids)) {
		const dir = join(root, String(pid));
		mkdirSync(dir, { recursive: true });
		const fields = new Array(50).fill("0");
		fields[0] = spec.state ?? "S";
		fields[11] = String(spec.userTicks ?? 0);
		fields[12] = String(spec.systemTicks ?? 0);
		writeFileSync(join(dir, "stat"), `${pid} (node) ${fields.join(" ")}\n`);
		writeFileSync(join(dir, "wchan"), `${spec.wchan ?? "0"}\n`);
		writeFileSync(join(dir, "syscall"), `${spec.syscall ?? "running"}\n`);
		writeFileSync(
			join(dir, "status"),
			`Name:\tnode\nvoluntary_ctxt_switches:\t${spec.voluntary ?? 3}\n`,
		);
		writeFileSync(
			join(dir, "io"),
			`rchar: ${spec.rchar ?? 100}\nwchar: ${spec.wchar ?? 100}\n`,
		);
	}
	return root;
};

test("kernel census names a pipe-blocked process from the kernel alone", async () => {
	const a = await api();
	const state = mkdtempSync(join(tmpdir(), "census-pipe-state-"));
	if (process.platform === "linux") {
		// Real path: a writer with no reader blocks inside the kernel, where no
		// JS loop can answer a signal. Linux-only because it needs a real /proc.
		const dir = mkdtempSync(join(tmpdir(), "census-pipe-"));
		const fifo = join(dir, "undrained");
		execFileSync("mkfifo", [fifo]);
		const child = spawn(
			process.execPath,
			[
				"-e",
				`const fs=require("node:fs"); const b=Buffer.alloc(4*1024*1024); const fd=fs.openSync(${JSON.stringify(fifo)}, "w"); fs.writeSync(fd, b);`,
			],
			{ detached: true, stdio: "ignore" },
		);
		try {
			await pause(400);
			const sample = await a.captureKernelCensus(
				state,
				{ targets: [a.identity(child.pid)] },
				{ index: 0 },
			);
			const row = sample.rows.find((r) => r.pid === child.pid);
			assert.ok(row, "the blocked child must appear in the census");
			assert.notEqual(row.state, "Z");
			assert.match(
				`${row.wchan ?? ""} ${row.syscall?.name ?? ""}`,
				/pipe|write|openat/i,
				`expected a pipe/write wait, got ${JSON.stringify(row)}`,
			);
			assert.ok(Buffer.byteLength(JSON.stringify(sample)) <= 4096);
		} finally {
			child.kill("SIGKILL");
			await new Promise((r) => child.once("exit", r));
			rmSync(dir, { recursive: true, force: true });
		}
		return;
	}
	// Darwin: the kernel fields are injected, the reading and naming are not.
	const root = procFixture({
		4242: {
			state: "S",
			wchan: "pipe_wait",
			syscall: "1 0x7f 0x55 0x1000 0 0 0",
			userTicks: 11,
		},
	});
	try {
		const sample = await a.captureKernelCensus(
			state,
			{ targets: [{ pid: 4242 }] },
			{ index: 0, procRoot: root },
		);
		const row = sample.rows[0];
		assert.equal(row.state, "S");
		assert.equal(row.wchan, "pipe_wait");
		assert.equal(row.syscall.name, "write");
		assert.equal(row.voluntarySwitches, 3);
		assert.ok(Buffer.byteLength(JSON.stringify(sample)) <= 4096);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("kernel census shows a spinning process in state R with advancing time", async () => {
	const a = await api();
	const state = mkdtempSync(join(tmpdir(), "census-spin-state-"));
	if (process.platform === "linux") {
		const child = spawn(process.execPath, ["-e", "while(true){}"], {
			detached: true,
			stdio: "ignore",
		});
		try {
			await pause(300);
			const first = await a.captureKernelCensus(
				state,
				{ targets: [a.identity(child.pid)] },
				{ index: 0 },
			);
			await pause(600);
			const second = await a.captureKernelCensus(
				state,
				{ targets: [a.identity(child.pid)] },
				{ index: 1 },
			);
			const row = second.rows.find((r) => r.pid === child.pid);
			assert.equal(row.state, "R");
			const before = first.rows.find((r) => r.pid === child.pid);
			assert.ok(
				row.userTicks > before.userTicks,
				"a spinning child must accrue user time",
			);
		} finally {
			child.kill("SIGKILL");
			await new Promise((r) => child.once("exit", r));
		}
		return;
	}
	const root = procFixture({
		4343: { state: "R", syscall: "running", userTicks: 100, rchar: 10 },
	});
	try {
		await a.captureKernelCensus(
			state,
			{ targets: [{ pid: 4343 }] },
			{ index: 0, procRoot: root },
		);
		writeFileSync(
			join(root, "4343", "stat"),
			`4343 (node) ${["R", ...new Array(10).fill("0"), "160", "0", ...new Array(37).fill("0")].join(" ")}\n`,
		);
		writeFileSync(join(root, "4343", "io"), "rchar: 4100\nwchar: 100\n");
		const second = await a.captureKernelCensus(
			state,
			{ targets: [{ pid: 4343 }] },
			{ index: 1, procRoot: root },
		);
		const row = second.rows[0];
		assert.equal(row.state, "R");
		assert.equal(row.userTicks, 160);
		assert.equal(
			row.io.rcharDelta,
			4090,
			"io deltas are computed against the previous sample",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("kernel census file stays within its byte and sample caps", async () => {
	const a = await api();
	const state = mkdtempSync(join(tmpdir(), "census-cap-state-"));
	const pids = Object.fromEntries(
		Array.from({ length: 14 }, (_, i) => [
			5000 + i,
			{
				state: "S",
				wchan: `wait_channel_${i}`,
				syscall: "202 0x1 0x2 0x3 0x4 0x5 0x6",
				userTicks: i,
				rchar: 1000 + i,
			},
		]),
	);
	const root = procFixture(pids);
	try {
		const targets = Object.keys(pids).map((pid) => ({ pid: Number(pid) }));
		for (let index = 0; index < 10; index++) {
			const sample = await a.captureKernelCensus(
				state,
				{ targets },
				{ index, procRoot: root },
			);
			if (index < 8)
				assert.ok(
					Buffer.byteLength(JSON.stringify(sample)) <= 4096,
					`sample ${index} exceeded 4 KiB`,
				);
			else assert.equal(sample.skipped, "sample-cap");
		}
		const lines = readFileSync(join(state, "kernel-census.jsonl"), "utf8")
			.trim()
			.split("\n");
		assert.equal(
			lines.length,
			8,
			"the sample count is bounded; extra probes write nothing",
		);
		for (const line of lines)
			assert.ok(
				Buffer.byteLength(line) <= 4096,
				"every sample line stays within 4 KiB",
			);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("kernel census skips cleanly with a recorded reason off Linux", async () => {
	const a = await api();
	const state = mkdtempSync(join(tmpdir(), "census-platform-state-"));
	const sample = await a.captureKernelCensus(
		state,
		{ targets: [] },
		{ index: 0 },
	);
	if (process.platform === "linux") assert.equal(sample.skipped, undefined);
	else {
		assert.match(sample.skipped, /linux/i);
		assert.deepEqual(sample.rows, []);
		assert.ok(
			existsSync(join(state, "kernel-census.jsonl")),
			"the skip is still recorded for a reader",
		);
	}
});

test("the supervisor emits census samples from suite start and stops at the deadline", async () => {
	const a = await api();
	const census = join(
		mkdtempSync(join(tmpdir(), "census-wiring-")),
		"kernel-census.jsonl",
	);
	const state = mkdtempSync(join(tmpdir(), "census-wiring-state-"));
	// The marker the runner writes at its first output line. The fixture stands
	// in for the runner's marker, not for the supervisor's polling, which is the
	// production path under test here.
	// Written where the production runner writes it: the supervisor passes its
	// own state directory to the shell as LOCAL_OPERATOR_UI_SUITE_STATE.
	const marker = `printf '{"at":1600000000000}' > "$LOCAL_OPERATOR_UI_SUITE_STATE/suite-start.json"; sleep 8`;
	const f = fixture(marker);
	process.env.LOCAL_OPERATOR_UI_KERNEL_CENSUS = census;
	try {
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 3000,
			setupStarted: Date.now(),
			witnessMs: 200,
			censusIntervalMs: 150,
		});
		const result = await a.awaitResult({ state: f.state });
		assert.equal(
			result.code,
			124,
			"the census must not change the deadline verdict",
		);
		const lines = readFileSync(census, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean);
		assert.ok(
			lines.length >= 2,
			`expected periodic samples, got ${lines.length}`,
		);
		const samples = lines.map((line) => JSON.parse(line));
		assert.deepEqual(
			samples.map((s) => s.index),
			samples.map((_, i) => i),
			"samples are sequentially indexed from the suite-start marker",
		);
		for (const line of lines)
			assert.ok(
				Buffer.byteLength(line) <= 4096,
				"the real periodic writes stay within 4 KiB",
			);
		assert.ok(samples.length <= 8, "the sample count is bounded");
		if (process.platform === "linux")
			assert.ok(
				samples.some((s) => (s.rows ?? []).length > 0),
				"a linux run names at least one owned pid",
			);
		else
			assert.equal(
				samples[0].skipped,
				"unsupported-platform: /proc census is linux-only",
			);
		// Nothing may be emitted after the deadline: the last index stays below
		// the bound and no sample carries an `at` past the deadline plus a tick.
		assert.ok(
			samples.every((s) => s.at <= result.at + 50 || s.at <= Date.now()),
		);
	} finally {
		Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_UI_KERNEL_CENSUS");
	}
});

test("census falls back to launch basis when the suite-start marker never arrives", async () => {
	const a = await api();
	const census = join(
		mkdtempSync(join(tmpdir(), "census-nomarker-")),
		"kernel-census.jsonl",
	);
	const f = fixture("sleep 8");
	process.env.LOCAL_OPERATOR_UI_KERNEL_CENSUS = census;
	try {
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 2500,
			setupStarted: Date.now(),
			witnessMs: 200,
			censusIntervalMs: 150,
		});
		// Mid-flight: a synthetic subject that never prints the runner's marker
		// must not cause an early terminal on any consumer.
		await pause(900);
		assert.equal(
			existsSync(join(f.state, "terminal.json")),
			false,
			"no terminal may be published before the launch-anchored bound",
		);
		const result = await a.awaitResult({ state: f.state });
		assert.equal(result.code, 124, "the fallback never changes the verdict");
		const samples = readFileSync(census, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		assert.ok(samples.length >= 2, "sampling continues without a marker");
		assert.ok(
			samples.every((s) => s.basis === "launch"),
			"the absence is recorded on every sample rather than waited on silently",
		);
		assert.ok(
			Buffer.byteLength(JSON.stringify(samples[samples.length - 1])) <= 4096,
		);
	} finally {
		Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_UI_KERNEL_CENSUS");
	}
});

test("the transport-probe shape publishes no terminal before its own bound", async () => {
	const a = await api();
	// The probe's subject: blocks on an undrained fifo until a release file
	// appears, and never prints a suite-start marker.
	// Paths come from the supervisor-provided state directory, never the repo
	// cwd, so the control cannot leave a fifo behind or trip on an old one.
	const f = fixture(
		'mkfifo "$LOCAL_OPERATOR_UI_SUITE_STATE/tick.fifo"; exec 9<> "$LOCAL_OPERATOR_UI_SUITE_STATE/tick.fifo"; while [[ ! -f "$LOCAL_OPERATOR_UI_SUITE_STATE/release" ]]; do read -r -t 0.2 <&9 || :; done',
	);
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 3000,
		setupStarted: Date.now(),
		witnessMs: 200,
	});
	await pause(1200);
	assert.equal(
		existsSync(join(f.state, "terminal.json")),
		false,
		"the blocked subject must still be running at the compare step",
	);
	const witness = JSON.parse(
		readFileSync(join(f.state, "witness.json"), "utf8"),
	);
	assert.ok(witness.sequence > 0, "the independent witness is alive meanwhile");
	writeFileSync(join(f.state, "release"), "");
	const result = await a.awaitResult({ state: f.state });
	assert.notEqual(result.code, undefined);
});

test("no census file is created when the probe environment is unset", async () => {
	const a = await api();
	const state = mkdtempSync(join(tmpdir(), "census-unset-state-"));
	const f = fixture("sleep 8");
	Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_UI_KERNEL_CENSUS");
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 900,
		setupStarted: Date.now(),
		witnessMs: 200,
	});
	const result = await a.awaitResult({ state: f.state });
	assert.equal(result.code, 124);
	assert.equal(
		existsSync(join(state, "kernel-census.jsonl")),
		false,
		"no probe starts without the env",
	);
	assert.equal(existsSync(join(f.state, "kernel-census.jsonl")), false);
});

test("identity resolves the linux branch instead of throwing on an unbound path", async () => {
	const a = await api();
	const root = mkdtempSync(join(tmpdir(), "proc-identity-"));
	mkdirSync(join(root, "7373"), { recursive: true });
	// Field 0 state, 1 ppid, 2 pgid, 11/12 cpu, 19 start - the shape identity()
	// reads on Linux. Darwin never takes this branch, which is exactly how an
	// unbound path reference shipped and broke every ubuntu run.
	const fields = new Array(52).fill("0");
	fields[0] = "S";
	fields[1] = "1";
	fields[2] = "7373";
	fields[11] = "4";
	fields[12] = "5";
	fields[19] = "987654";
	writeFileSync(
		join(root, "7373", "stat"),
		`7373 (node) ${fields.join(" ")}\n`,
	);
	const original = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", {
		value: "linux",
		configurable: true,
	});
	try {
		const id = a.identity(7373, root);
		assert.ok(
			id,
			"the linux branch must return an identity, not null or a throw",
		);
		assert.equal(id.pid, 7373);
		assert.equal(id.pgid, 7373);
		assert.equal(id.start, "987654");
		assert.deepEqual(id.cpu, ["4", "5"]);
	} finally {
		Object.defineProperty(process, "platform", original);
	}
});

test("every named import in the entry point exists in the module it names", async () => {
	// NEVER import the entry point: it EXECUTES the suite. Round 8 proved that
	// the hard way - importing run-desktop-tests.mjs recursed into a detached
	// run and hung. This resolves the specifiers and reads the sources instead,
	// which is the same fact a link error reports without running anything.
	const dir = dirname(fileURLToPath(import.meta.url));
	const entry = join(dir, "run-desktop-tests.mjs");
	const source = readFileSync(entry, "utf8");
	const importPattern =
		/(?:import|export)\s+(?:\{([^}]*)\}\s+from\s*)?["'](\.{1,2}\/[^"']+)["']/gu;
	const failures = [];
	let checked = 0;
	for (const [, names = "", spec] of source.matchAll(importPattern)) {
		const target = join(dirname(entry), spec);
		let targetSource;
		try {
			targetSource = readFileSync(target, "utf8");
		} catch {
			failures.push(`${spec}: cannot be resolved`);
			continue;
		}
		const exported = new Set();
		for (const hit of targetSource.matchAll(
			/export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gu,
		))
			exported.add(hit[1]);
		for (const hit of targetSource.matchAll(/export\s*\{([^}]*)\}/gu))
			for (const part of hit[1].split(","))
				if (part.trim())
					exported.add(
						part
							.trim()
							.split(/\s+as\s+/)
							.pop()
							.trim(),
					);
		for (const rawName of names.split(",")) {
			const name = rawName
				.trim()
				.split(/\s+as\s+/)[0]
				.trim();
			if (!name) continue;
			checked += 1;
			if (!exported.has(name))
				failures.push(`${spec}: no export named '${name}'`);
		}
	}
	assert.equal(
		failures.length,
		0,
		`entry-point imports must resolve: ${failures.join("; ")}`,
	);
	assert.ok(
		checked >= 5,
		`the check must actually inspect the entry point's imports (saw ${checked})`,
	);
	console.log(
		`import-resolution: ${checked} named imports resolved against module sources; entry point never executed`,
	);
});

test("the always() upload glob matches where the census is actually written", async () => {
	// The census is worthless if the artifact glob does not cover it: the last
	// two hangs produced no artifact at all. The workflow's census env path and
	// its artifact glob must name the same files.
	const dir = dirname(fileURLToPath(import.meta.url));
	const workflow = readFileSync(
		join(dir, "..", ".github", "workflows", "ci.yml"),
		"utf8",
	);
	const envPath =
		/LOCAL_OPERATOR_UI_KERNEL_CENSUS:\s*\$\{\{\s*runner\.temp\s*\}\}\/([^\s]+)/u.exec(
			workflow,
		);
	assert.ok(envPath, "the workflow must configure the census path");
	const upload =
		/Upload kernel census[\s\S]*?path:\s*\$\{\{\s*runner\.temp\s*\}\}\/(\S+)/u.exec(
			workflow,
		);
	assert.ok(upload, "an always() upload step must exist for the census");
	assert.ok(upload[0].includes("always()"), "the upload must be unconditional");
	const toPattern = (name) =>
		new RegExp(`^${name.replace(/[.]/gu, "\\.").replace(/\*/gu, ".*")}$`, "u");
	assert.match(
		`kernel-census-${"0"}.jsonl`,
		toPattern(upload[1]),
		`the artifact glob ${upload[1]} must cover ${envPath[1]}`,
	);
	assert.ok(
		toPattern(upload[1]).test("kernel-census-0.jsonl"),
		"a per-shard census file matches the upload glob",
	);
	console.log(
		`artifact-glob: upload "${upload[1]}" covers census "${envPath[1]}"`,
	);
});

test("checkpoint: missing terminal receipt cannot pass", async () => {
	const a = await api();
	const f = fixture("exit 0");
	assert.throws(() => a.readTerminal(f.state), /terminal|receipt/);
	const { mkdirSync } = await import("node:fs");
	mkdirSync(f.state);
	writeFileSync(
		join(f.state, "config.json"),
		JSON.stringify({
			launched: Date.now() - 2000,
			deadline: Date.now() + 10_000,
		}),
	);
	writeFileSync(
		join(f.state, "owner.json"),
		JSON.stringify({ pid: process.pid, start: "not-a-real-supervisor" }),
	);
	await assert.rejects(
		a.awaitResult({ state: f.state }),
		/Missing terminal receipt/,
	);
});

test("checkpoint: real Node late registration and top-level await are not cut short", async () => {
	const a = await api();
	const f = fixture("exit 99");
	const testFile = join(f.dir, "late.test.mjs");
	writeFileSync(
		testFile,
		'import {test} from "node:test"; await new Promise(r=>setTimeout(r,150)); test("late-registered-test-executed", ()=>{});',
	);
	writeFileSync(
		f.shell,
		`set -o pipefail\n'${process.execPath}' --test --test-reporter=tap '${testFile}'\n`,
	);
	a.launch({
		state: f.state,
		shell: f.shell,
		durationMs: 5000,
		setupStarted: Date.now(),
		witnessMs: 75,
	});
	assert.equal((await a.awaitResult({ state: f.state })).code, 0);
	const console = readFileSync(join(f.state, "console.log"), "utf8");
	assert.ok(console.includes("late-registered-test-executed"));
	assert.ok(console.includes("# tests 1"));
});
