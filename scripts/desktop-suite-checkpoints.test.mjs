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

test("stack capture reports a waiting node process at the deadline", async () => {
	const a = await api();
	const reports = mkdtempSync(join(tmpdir(), "stack-reports-"));
	const f = fixture(
		`'${process.execPath}' --report-on-signal --report-signal=SIGUSR2 --report-directory='${reports}' -e 'setInterval(()=>{},1000)' & wait`,
	);
	process.env.LOCAL_OPERATOR_UI_STACK_REPORTS = reports;
	try {
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 1500,
			setupStarted: Date.now(),
			witnessMs: 200,
		});
		const result = await a.awaitResult({ state: f.state });
		assert.equal(
			result.code,
			124,
			"capture must not change the deadline verdict",
		);
		assert.equal(result.reason, "absolute-deadline");
		const capture = JSON.parse(
			readFileSync(join(f.state, "stack-capture.json"), "utf8"),
		);
		assert.ok(
			capture.sent.length >= 1,
			"the still-live coordinator must be asked for a report",
		);
		assert.ok(
			capture.written.length >= 1,
			"an idle event loop answers SIGUSR2 with a report",
		);
		const report = JSON.parse(
			readFileSync(join(reports, capture.written[0]), "utf8"),
		);
		assert.ok(
			Array.isArray(report.javascriptStack?.stack) ||
				typeof report.javascriptStack === "string" ||
				report.javascriptStack,
			"the report must carry a JS stack",
		);
	} finally {
		Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_UI_STACK_REPORTS");
		rmSync(reports, { recursive: true, force: true });
	}
});

test("stack capture reports the measured boundary for a hard-blocked loop", async () => {
	const a = await api();
	const reports = mkdtempSync(join(tmpdir(), "stack-busy-"));
	const f = fixture(
		`'${process.execPath}' --report-on-signal --report-signal=SIGUSR2 --report-directory='${reports}' -e 'process.on("SIGTERM",()=>{});while(true){}' & wait`,
	);
	process.env.LOCAL_OPERATOR_UI_STACK_REPORTS = reports;
	try {
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 1500,
			setupStarted: Date.now(),
			witnessMs: 200,
		});
		const result = await a.awaitResult({ state: f.state });
		assert.equal(result.code, 124);
		const capture = JSON.parse(
			readFileSync(join(f.state, "stack-capture.json"), "utf8"),
		);
		// MEASURED, not assumed: node services its report signal on the event
		// loop, so a loop that never turns writes nothing. Pinned so the
		// instrument is never credited with covering this class.
		assert.deepEqual(
			capture.written,
			[],
			"a hard-blocked loop cannot answer SIGUSR2 with a report",
		);
	} finally {
		Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_UI_STACK_REPORTS");
		rmSync(reports, { recursive: true, force: true });
	}
});

test("stack capture skips an already-gone pid without failing the run", async () => {
	const a = await api();
	const reports = mkdtempSync(join(tmpdir(), "stack-gone-"));
	process.env.LOCAL_OPERATOR_UI_STACK_REPORTS = reports;
	try {
		const state = mkdtempSync(join(tmpdir(), "stack-gone-state-"));
		writeFileSync(
			join(state, "config.json"),
			JSON.stringify({
				state,
				pipeline: { pid: 999999, pgid: 999999, start: "gone", pidGone: true },
				launcher: a.identity(process.pid),
			}),
		);
		const capture = await a.captureStacks(
			state,
			JSON.parse(readFileSync(join(state, "config.json"), "utf8")),
			{ waitMs: 100 },
		);
		assert.deepEqual(capture.sent, [], "a vanished pid is never signalled");
		assert.ok(
			capture.skipped.length >= 1,
			"the skip is recorded rather than thrown",
		);
		assert.deepEqual(capture.written, []);
	} finally {
		Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_UI_STACK_REPORTS");
		rmSync(reports, { recursive: true, force: true });
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
	process.env.LOCAL_OPERATOR_UI_CENSUS_INTERVAL_MS = "120";
	try {
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 3000,
			setupStarted: Date.now(),
			witnessMs: 200,
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
		Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_UI_CENSUS_INTERVAL_MS");
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
	process.env.LOCAL_OPERATOR_UI_CENSUS_INTERVAL_MS = "150";
	try {
		a.launch({
			state: f.state,
			shell: f.shell,
			durationMs: 2500,
			setupStarted: Date.now(),
			witnessMs: 200,
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
		Reflect.deleteProperty(process.env, "LOCAL_OPERATOR_UI_CENSUS_INTERVAL_MS");
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
