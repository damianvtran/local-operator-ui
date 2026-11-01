import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";

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
		const first = await witnessReady(f.state, (w) =>
			w.events.some((e) => e.event === "sample-begin"),
		);
		const later = await witnessReady(
			f.state,
			(w) => w.sequence > first.sequence,
		);
		assert.ok(!later.events.some((e) => e.event === "sample-timeout"));
		const table = execFileSync("ps", ["-axo", "pid=,ppid="], {
			encoding: "utf8",
			timeout: 500,
		});
		const children = table
			.trim()
			.split("\n")
			.map((l) => l.trim().split(/\s+/).map(Number))
			.filter(([, ppid]) => ppid === observer.pid);
		assert.equal(
			children.length,
			1,
			"independent ticks must not accumulate overlapping samplers",
		);
		await witnessReady(f.state, (w) =>
			w.events.some((e) => e.event === "sample-timeout"),
		);
		assert.equal(
			a.identity(children[0][0]),
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
