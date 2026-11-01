/**
 * CI-only supervision, not a second test runner or a hang fix. The existing
 * suite shell owns the command, TAP/coverage guards and verdict. Its original
 * launch+45m deadline survives intervening upload steps. An independent witness
 * owns no test verdict and never writes into the suite's inherited stdout pipe.
 *
 * Checkpoints are immutable bounded JSON for the existing upload-artifact action;
 * no tokens, environment dumps, command lines or custom artifact API live here.
 * A missing terminal receipt is never success. SIGKILL can still prevent the
 * final receipt, but cannot erase an already-uploaded early checkpoint.
 */
import { execFileSync, spawn } from "node:child_process";
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	readlinkSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { constants } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

const SELF = fileURLToPath(import.meta.url);
export const SUITE_MS = 45 * 60_000;
export const JOB_MS = 50 * 60_000;
/** Opt-in: node stack reports on SIGUSR2, written into this directory. */
export const STACK_REPORTS_ENV = "LOCAL_OPERATOR_UI_STACK_REPORTS";
export const STACK_REPORT_SIGNAL = "SIGUSR2";
/** Opt-in: kernel census JSONL path. Unset means the probe never starts. */
export const KERNEL_CENSUS_ENV = "LOCAL_OPERATOR_UI_KERNEL_CENSUS";
export const KERNEL_CENSUS_SAMPLES = 8;
export const KERNEL_CENSUS_BYTES = 4096;
export const KERNEL_CENSUS_INTERVAL_MS = 5 * 60_000;
/** Test-only override so a control can prove the cadence without waiting. */
// Kernel metadata path shared by ownership checks and the census. It is a
// module constant because the pre-existing /proc reads in identity() and
// snapshot() must never resolve an unbound name on the Linux branch.
const procRoot = "/proc";

/** Where the runner drops its anchored suite-start marker for the supervisor. */
export const SUITE_STATE_ENV = "LOCAL_OPERATOR_UI_SUITE_STATE";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const atomic = (path, value) => {
	writeFileSync(`${path}.next`, `${JSON.stringify(value)}\n`);
	renameSync(`${path}.next`, path);
};
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const optional = (path) => {
	try {
		return read(path);
	} catch {
		return null;
	}
};

/** Linux start ticks disambiguate PID reuse; Darwin fallback carries lstart. */
export function identity(pid, root = procRoot) {
	try {
		if (process.platform === "linux") {
			const text = readFileSync(`${root}/${pid}/stat`, "utf8");
			const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
			return {
				pid,
				ppid: Number(fields[1]),
				pgid: Number(fields[2]),
				state: fields[0],
				start: fields[19],
				cpu: [fields[11], fields[12]],
			};
		}
		const line = execFileSync(
			"ps",
			["-p", String(pid), "-o", "ppid=,pgid=,stat=,lstart="],
			{ encoding: "utf8", timeout: 500 },
		)
			.trim()
			.split(/\s+/);
		if (!line.length || !line[0]) return null;
		return {
			pid,
			ppid: Number(line[0]),
			pgid: Number(line[1]),
			state: line[2],
			start: line.slice(3).join(" "),
		};
	} catch {
		return null;
	}
}
const same = (a, b) => a && b && a.pid === b.pid && a.start === b.start;
const ownedIdentity = (owner) => {
	const current = owner?.pid ? identity(owner.pid) : null;
	return same(owner, current) ? current : null;
};
export function publishCoordinator(path, pid) {
	if (path) atomic(path, identity(pid) ?? { pid, identityUnavailable: true });
}

/** Output only owned groups and explicitly named observer/launcher identities. */
export function snapshot(config) {
	const coordinator = optional(join(config.state, "coordinator.json"));
	const groups = [config.pipeline, coordinator].filter(
		(x) => x?.start && x.pid > 1 && x.pgid === x.pid,
	);
	const verified = groups.filter((g) => {
		const current = identity(g.pid);
		// A missing leader may leave group members behind. A reused leader must
		// never license collecting or signalling the replacement process group.
		return !current || same(g, current);
	});
	let candidates;
	if (process.platform === "linux")
		candidates = readdirSync("/proc")
			.filter((x) => /^\d+$/.test(x))
			.slice(0, 32768)
			.map(Number);
	else
		candidates = execFileSync("ps", ["-axo", "pid=,pgid="], {
			encoding: "utf8",
			timeout: 500,
			maxBuffer: 2 * 1024 * 1024,
		})
			.trim()
			.split("\n")
			.map((line) => line.trim().split(/\s+/).map(Number))
			.filter(([, pg]) => verified.some((g) => g.pgid === pg))
			.map(([pid]) => pid);
	const rows = [];
	let truncated = false;
	for (const pid of candidates) {
		const row = identity(pid);
		if (!row || !verified.some((g) => g.pgid === row.pgid)) continue;
		if (rows.length === 64) {
			truncated = true;
			break;
		}
		if (process.platform === "linux") {
			row.endpoints = [];
			try {
				try {
					row.waitChannel = readFileSync(`${procRoot}/${pid}/wchan`, "utf8")
						.slice(0, 64)
						.trim();
				} catch {
					row.waitChannel = "unavailable";
				}
				const fds = readdirSync(`/proc/${pid}/fd`);
				row.fdScanTruncated = fds.length > 128;
				for (const fd of new Set(["1", "2", ...fds.slice(0, 126)])) {
					try {
						const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
						if (
							(target.startsWith("pipe:[") || target.startsWith("socket:[")) &&
							row.endpoints.length < 16
						)
							row.endpoints.push({ fd: Number(fd), target });
					} catch {
						/* Process/descriptor may disappear during the census. */
					}
				}
			} catch {
				row.descriptors = "unreadable";
			}
		}
		rows.push(row);
	}
	return {
		rows,
		truncated,
		launcher: ownedIdentity(config.launcher),
		supervisor: ownedIdentity(config.supervisor),
		coordinator,
		pipeSupport:
			process.platform === "linux"
				? "owned-group pipe/socket endpoint identities; socket peers unknown; ownership does not prove blockage"
				: "unsupported on Darwin; no pipe-owner attribution",
	};
}

/** One asynchronous detailed sampler, bounded independently of witness ticks. */
export function startSample(command, { timeoutMs = 1500 } = {}) {
	const child = spawn(command[0], command.slice(1), {
		detached: true,
		stdio: ["ignore", "pipe", "ignore"],
	});
	let bytes = "";
	let timedOut = false;
	const kill = () => {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			/* Already gone. */
		}
	};
	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, timeoutMs);
	child.stdout.on("data", (chunk) => {
		if (bytes.length + chunk.length <= 96 * 1024) bytes += chunk;
		else {
			timedOut = true;
			kill();
		}
	});
	const done = new Promise((resolveDone) => {
		child.once("error", () => {
			clearTimeout(timer);
			resolveDone({ event: "sample-error" });
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			if (timedOut) return resolveDone({ event: "sample-timeout" });
			try {
				resolveDone({
					event: code === 0 ? "sample-end" : "sample-error",
					snapshot: JSON.parse(bytes),
				});
			} catch {
				resolveDone({ event: "sample-error" });
			}
		});
	});
	return { child, done, kill };
}

// Command injection is an execution-test seam, not an environment/CLI override.
// Production always samples through this module's bounded own-group reader.
export async function witness(
	state,
	{
		sampleCommand = [process.execPath, SELF, "sample", state],
		sampleTimeoutMs = 1500,
	} = {},
) {
	const config = read(join(state, "config.json"));
	let sequence = 0;
	let sampler = null;
	let last = null;
	let stopped = false;
	let wake = null;
	const events = [];
	let eventsDropped = 0;
	const event = (value) => {
		events.push({ at: Date.now(), ...value });
		if (events.length > 128) {
			events.shift();
			eventsDropped += 1;
		}
	};
	const persist = () => {
		const value = {
			sequence: ++sequence,
			at: Date.now(),
			events,
			snapshot: last,
			eventsTruncated: eventsDropped > 0,
			eventsDropped,
		};
		while (
			Buffer.byteLength(JSON.stringify(value)) > 120 * 1024 &&
			events.length
		) {
			events.shift();
			eventsDropped += 1;
			value.eventsDropped = eventsDropped;
			value.eventsTruncated = true;
		}
		atomic(join(state, "witness.json"), value);
	};
	const tick = () => {
		event({
			event: "witness-alive",
			launcher: ownedIdentity(config.launcher),
			supervisor: ownedIdentity(config.supervisor),
		});
		if (!sampler) {
			event({ event: "sample-begin" });
			sampler = startSample(sampleCommand, { timeoutMs: sampleTimeoutMs });
			atomic(join(state, "sample-owner.json"), identity(sampler.child.pid));
			sampler.done.then((result) => {
				atomic(join(state, "sample-owner.json"), null);
				event({ event: result.event });
				if (result.snapshot) last = result.snapshot;
				sampler = null;
				persist();
			});
		}
		persist();
	};
	const stop = () => {
		stopped = true;
		wake?.();
	};
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	tick();
	while (!stopped && Date.now() < config.deadline + 5000) {
		await new Promise((r) => {
			const timer = setTimeout(r, config.witnessMs);
			wake = () => {
				clearTimeout(timer);
				r();
			};
		});
		if (!stopped) tick();
	}
	// Reap only our sampler. Test processes belong to the existing runner.
	if (sampler) {
		sampler.kill();
		await sampler.done;
	}
	// A final bounded sample distinguishes a vanished coordinator from a
	// surviving owned-group pipe holder, without keeping any test alive.
	const final = startSample(sampleCommand, { timeoutMs: sampleTimeoutMs });
	atomic(join(state, "sample-owner.json"), identity(final.child.pid));
	const finalResult = await final.done;
	atomic(join(state, "sample-owner.json"), null);
	event({ event: finalResult.event });
	if (finalResult.snapshot) last = finalResult.snapshot;
	event({ event: "witness-stop" });
	persist();
}

/** launch is deliberately the only detached work; receipt identifies its owner. */
export function launch({
	censusIntervalMs,
	state,
	shell,
	durationMs = SUITE_MS,
	setupStarted,
	witnessMs = 5000,
}) {
	if (
		!shell ||
		!Number.isFinite(setupStarted) ||
		!Number.isFinite(durationMs) ||
		durationMs <= 0 ||
		durationMs > SUITE_MS
	)
		throw Error("Invalid checkpoint launch arguments");
	state = resolve(state);
	mkdirSync(state, { recursive: false }); // Existing allocation must never be overwritten.
	const launched = Date.now();
	const config = {
		state,
		shell: resolve(shell),
		cwd: process.cwd(),
		launched,
		deadline: launched + durationMs,
		setupStarted,
		launcherPid: process.pid,
		launcher: identity(process.pid),
		witnessMs,
		censusIntervalMs,
	};
	atomic(join(state, "config.json"), config);
	const worker = spawn(process.execPath, [SELF, "worker", state], {
		detached: true,
		stdio: "ignore",
		// Like the real desktop runner, never let a node:test caller mark the
		// separately owned CLI as a recursive test context (which exits 0 while
		// skipping the actual files, including late registration/TLA controls).
		env: Object.fromEntries(
			Object.entries(process.env).filter(
				([key]) => key !== "NODE_TEST_CONTEXT",
			),
		),
	});
	atomic(join(state, "owner.json"), {
		...identity(worker.pid),
		pid: worker.pid,
		launched,
	});
	worker.unref();
	return config;
}

/**
 * Ask every owned, still-live process for a stack report at the deadline.
 *
 * WHY HERE. The shard logs that end mid-stream keep the per-lane bound armed
 * and never name a lane, so the instrument that names a blocking frame must
 * live outside the process that froze. Node writes a report on SIGUSR2 only
 * while the target's own event loop is still turning, so this covers the
 * WAITING class (for example a coordinator parked on a pipe it will never
 * drain) and not a process whose loop is hard-blocked; that boundary is pinned
 * by a control rather than papered over.
 *
 * It never decides a verdict and never fails a job: capture is best effort and
 * the existing kill path runs unchanged afterwards.
 */
export async function captureStacks(
	state,
	config,
	{ signal = STACK_REPORT_SIGNAL, waitMs = 2000 } = {},
) {
	const reportDirectory = process.env[STACK_REPORTS_ENV] ?? null;
	const sent = [];
	const skipped = [];
	const skippedDetail = [];
	// Default off, deliberately: SIGUSR2 without --report-on-signal terminates a
	// node process, and this instrument may not change how a suite dies outside
	// the CI job that opts in.
	if (reportDirectory) {
		// Only node processes answer SIGUSR2 with a report; any other owned
		// process would simply die of it, so the signal is scoped by command name
		// as well as by ownership and liveness.
		const rows = (config.targets ?? snapshot(config).rows ?? []).filter(
			(row) =>
				row.pid > 1 &&
				row.pid !== process.pid &&
				!(row.state ?? "").startsWith("Z") &&
				/(^|\/)(node|nodejs)$/u.test(commandName(row.pid)),
		);
		for (const row of rows) {
			// A process without the report flag dies of SIGUSR2 instead of writing
			// a report, so capability is checked before any signal is sent.
			if (!answersReportSignal(row.pid)) {
				skipped.push(row.pid);
				skippedDetail.push({ pid: row.pid, reason: "no-report-flag" });
				continue;
			}
			try {
				process.kill(row.pid, signal);
				sent.push(row.pid);
			} catch {
				skipped.push(row.pid);
				skippedDetail.push({ pid: row.pid, reason: "signal-failed" });
			}
		}
		if (rows.length === 0) skipped.push("no-owned-live-pid");
	}
	const entry = {
		at: Date.now(),
		signal,
		reportDirectory,
		sent,
		skipped,
		skippedDetail,
	};
	atomic(join(state, "stack-capture.json"), entry);
	// No report directory means nothing to wait for: the 2 s grace only exists
	// to let an opted-in target write its file.
	if (reportDirectory) await pause(waitMs);
	const written = reportDirectory ? reportNames(reportDirectory) : [];
	atomic(join(state, "stack-capture.json"), { ...entry, written });
	return { ...entry, written };
}

/**
 * Linux-only kernel census of the owned processes.
 *
 * WHY THIS EXISTS. A process blocked inside the kernel (a write into a pipe no
 * one drains) cannot answer SIGUSR2, because node services that report on its
 * event loop. These rows come from plain /proc reads, so they need no
 * cooperation from the target and name the wait: state char, wchan, syscall,
 * context switches and io deltas. Identities and syscalls only - never argv,
 * environment or command line. Off Linux the probe records why it skipped and
 * local runs stay green.
 */
export async function captureKernelCensus(
	state,
	config,
	{ index = 0, procRoot = "/proc", basis = "suite-start" } = {},
) {
	const file =
		process.env[KERNEL_CENSUS_ENV] || join(state, "kernel-census.jsonl");
	const base = { index, at: Date.now(), basis };
	if (index >= KERNEL_CENSUS_SAMPLES)
		return { ...base, rows: [], skipped: "sample-cap" };
	if (process.platform !== "linux" && procRoot === "/proc") {
		const skipped = {
			...base,
			rows: [],
			skipped: "unsupported-platform: /proc census is linux-only",
		};
		appendLine(file, skipped);
		return skipped;
	}
	const targets = config.targets ?? ownedTargets(config);
	const previous = lastCensusRows(file);
	const rows = [];
	for (const target of targets) {
		if (rows.length === 12) break;
		const pid = target?.pid;
		if (!(pid > 1)) continue;
		const row = censusRow(pid, previous.get(pid), procRoot);
		if (row) rows.push(row);
	}
	let sample = { ...base, rows };
	// The cap is on the whole sample, not per row: drop trailing rows rather
	// than emit a truncated JSON line a reader cannot parse.
	while (
		rows.length > 0 &&
		Buffer.byteLength(JSON.stringify(sample)) > KERNEL_CENSUS_BYTES
	)
		sample = {
			...base,
			rows: rows.slice(0, sample.rows.length - 1),
			truncated: true,
		};
	appendLine(file, sample);
	return sample;
}

/** Owned, identity-matching, live pids only; zombies are recorded, not hidden. */
function ownedTargets(config) {
	try {
		return (snapshot(config).rows ?? []).filter(
			(row) => row.pid > 1 && row.pid !== process.pid,
		);
	} catch {
		return [];
	}
}

function censusRow(pid, before, procRoot = "/proc") {
	const read = (path) => {
		try {
			return readFileSync(path, "utf8");
		} catch {
			return null;
		}
	};
	const stat = read(`${procRoot}/${pid}/stat`);
	if (!stat) return null;
	// Field 3 is the state char; fields 14/15 are utime/stime in clock ticks.
	const close = stat.lastIndexOf(")");
	const fields = stat.slice(close + 2).split(" ");
	const status = read(`${procRoot}/${pid}/status`) ?? "";
	const counters = {};
	for (const line of status.split("\n"))
		if (line.startsWith("voluntary_ctxt_switches:"))
			counters.voluntary = Number(line.split(":")[1]);
	const io = read(`${procRoot}/${pid}/io`) ?? "";
	const ioNow = {};
	for (const line of io.split("\n")) {
		const [key, value] = line.split(": ");
		if (key === "rchar" || key === "wchar") ioNow[key] = Number(value);
	}
	const syscallRaw = (read(`${procRoot}/${pid}/syscall`) ?? "")
		.trim()
		.slice(0, 64);
	const unreadable = [];
	if (!status) unreadable.push("status");
	if (!io) unreadable.push("io");
	const row = {
		pid,
		state: fields[0],
		...(unreadable.length ? { unreadable } : {}),
		userTicks: Number(fields[11]),
		systemTicks: Number(fields[12]),
		wchan:
			(read(`${procRoot}/${pid}/wchan`) ?? "").trim().slice(0, 32) || undefined,
		syscall: syscallRaw ? describeSyscall(syscallRaw) : undefined,
		voluntarySwitches: Number.isFinite(counters.voluntary)
			? counters.voluntary
			: undefined,
		io: {
			rchar: ioNow.rchar,
			wchar: ioNow.wchar,
			rcharDelta: delta(ioNow.rchar, before?.rchar),
			wcharDelta: delta(ioNow.wchar, before?.wchar),
		},
	};
	return row;
}

const delta = (now, before) =>
	Number.isFinite(now) && Number.isFinite(before) ? now - before : undefined;

const SYSCALL_NAMES = {
	0: "read",
	1: "write",
	7: "poll",
	23: "select",
	35: "nanosleep",
	61: "wait4",
	202: "futex",
	232: "epoll_wait",
	257: "openat",
	271: "ppoll",
	281: "epoll_pwait",
	288: "accept4",
};

/** Kernel line is "running" for a userspace process, else number + args. */
function describeSyscall(raw) {
	if (raw.startsWith("running")) return { name: "running" };
	const [number] = raw.split(" ");
	if (!/^\d+$/u.test(number ?? "")) return undefined;
	return {
		number: Number(number),
		name: SYSCALL_NAMES[Number(number)] ?? "unknown",
	};
}

/** Previous sample's counters, so io deltas survive across probes and restarts. */
function lastCensusRows(file) {
	const map = new Map();
	try {
		const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
		const last = JSON.parse(lines[lines.length - 1]);
		for (const row of last.rows ?? []) map.set(row.pid, row.io ?? {});
	} catch {
		/* First probe, or an unreadable file: deltas simply start here. */
	}
	return map;
}

function appendLine(file, value) {
	try {
		appendFileSync(file, `${JSON.stringify(value)}\n`);
	} catch {
		/* A census that cannot be written must never fail a suite. */
	}
}

/** The executable name only; never argv or environment. */
function commandName(pid) {
	try {
		if (process.platform === "linux")
			return readFileSync(`/proc/${pid}/comm`, "utf8").trim();
		return execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
			encoding: "utf8",
			timeout: 500,
		}).trim();
	} catch {
		return "";
	}
}

/**
 * Does this process answer SIGUSR2 with a report? Only a node started with
 * --report-on-signal does; every other owned process would simply be killed by
 * the signal, so the census of candidates has to prove the flag first.
 */
function answersReportSignal(pid, root = procRoot) {
	try {
		const cmdline =
			process.platform === "linux"
				? readFileSync(`${root}/${pid}/cmdline`, "utf8")
				: execFileSync("ps", ["-p", String(pid), "-o", "command="], {
						encoding: "utf8",
						timeout: 500,
					});
		return cmdline.includes("--report-on-signal");
	} catch {
		return false;
	}
}

/** Report files a capture produced, bounded and sorted for a stable artifact. */
export function reportNames(directory) {
	try {
		return readdirSync(directory)
			.filter((name) => name.endsWith(".json"))
			.sort()
			.slice(0, 64);
	} catch {
		return [];
	}
}

// Dependency injection only exercises startup-failure boundaries in synthetic
// processes; production CLI always uses these exact defaults, with no env knob.
export async function worker(
	state,
	{
		identify = identity,
		publish = atomic,
		spawnObserver = () =>
			spawn(process.execPath, [SELF, "witness", state], {
				detached: true,
				stdio: "ignore",
			}),
	} = {},
) {
	const config = read(join(state, "config.json"));
	const fd = openSync(join(state, "console.log"), "wx");
	// The private control FD prevents ANY suite code/forks before deadline,
	// identity publication and observer startup have an owner. On failure this
	// direct child is still ours and inert, even if identity lookup itself failed.
	const child = spawn(
		"bash",
		[
			"--noprofile",
			"--norc",
			"-e",
			"-c",
			'IFS= read -r permission <&3; test "$permission" = go; exec 3<&-; exec bash --noprofile --norc -e "$1"',
			"desktop-suite-owned-start",
			config.shell,
		],
		{
			cwd: config.cwd,
			detached: true,
			// FD0 stays ignored as before; FD3 closes before the original shell.
			stdio: ["ignore", fd, fd, "pipe"],
			env: {
				...process.env,
				GITHUB_OUTPUT: join(state, "outputs"),
				LOCAL_OPERATOR_UI_COORDINATOR_IDENTITY: join(state, "coordinator.json"),
				// The runner writes its first-output marker here: the supervisor
				// owns the probe cadence and cannot see the suite's stdout.
				LOCAL_OPERATOR_UI_SUITE_STATE: state,
			},
		},
	);
	const gate = child.stdio[3];
	let observer = null;
	let observationFailure = null;
	let observerClosing = false;
	let released = false;
	let startupPhase = "identity";
	const exited = new Promise((resolveExit) => {
		child.once("error", () =>
			resolveExit({ code: 1, signal: null, reason: "spawn-error" }),
		);
		child.once("exit", (code, signal) =>
			resolveExit({
				code: code ?? 128 + (constants.signals[signal] ?? 1),
				signal,
			}),
		);
	});
	// EPIPE when a gate was terminated is paired with the child's actual exit;
	// it must not crash the deadline owner before that child has been reaped.
	gate?.on("error", () => {});
	let reason = "completed";
	let stopping = false;
	const signals = [];
	const signalGroup = (g, signal) => {
		if (!g?.start || g.pid <= 1 || g.pgid !== g.pid) return;
		const current = identity(g.pid);
		if (current && !same(g, current)) return;
		try {
			process.kill(-g.pgid, signal);
		} catch {
			/* Group already ended. */
		}
	};
	const signalOwned = (signal) => {
		if (
			!released &&
			child.pid > 1 &&
			child.exitCode === null &&
			child.signalCode === null
		) {
			// PID reuse is impossible while the unreaped direct gate is alive;
			// detached:true gave exactly this child its own process group.
			try {
				process.kill(-child.pid, signal);
			} catch {
				/* Gate already ended. */
			}
		} else signalGroup(config.pipeline, signal);
		signalGroup(optional(join(state, "coordinator.json")), signal);
	};
	const stop = (why, signal = "SIGTERM") => {
		if (stopping) return;
		stopping = true;
		reason = why;
		signalOwned(signal);
		// Only on the existing deadline/termination path; normal success never
		// grows a new test-process kill or hides an inherited-pipe wait.
		const escalation = setTimeout(() => signalOwned("SIGKILL"), 1500);
		signals.push(escalation);
	};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
		process.on(signal, () => stop(signal, signal));
	// Kernel census: a plain-file probe that needs nothing from the target, so it
	// names the hard-blocked class a SIGUSR2 report cannot cover. It MUST run in
	// this supervisor, never the coordinator, which is the process that freezes.
	// Cadence is anchored to the runner's own first output: the runner drops
	// suite-start.json here as it prints its cardinality line, so the first
	// sample lands at suite start, the rest ride a fixed interval, the count is
	// bounded and nothing is emitted past the deadline.
	let censusIndex = 0;
	let censusTimer = null;
	let censusWatcher = null;
	const censusInterval = Math.max(
		1,
		Number(config.censusIntervalMs ?? KERNEL_CENSUS_INTERVAL_MS) ||
			KERNEL_CENSUS_INTERVAL_MS,
	);
	let censusBasis = "launch";
	const emitCensus = () => {
		try {
			if (
				censusIndex >= KERNEL_CENSUS_SAMPLES ||
				Date.now() >= config.deadline
			) {
				if (censusTimer) clearInterval(censusTimer);
				censusTimer = null;
				return;
			}
			void captureKernelCensus(state, config, {
				index: censusIndex++,
				basis: censusBasis,
			}).catch(() => undefined);
		} catch {
			/* A census probe may never take the deadline owner down with it. */
		}
	};
	if (process.env[KERNEL_CENSUS_ENV]) {
		// The marker may never arrive (a synthetic subject, a suite that dies
		// during import). The census must still sample - launch-anchored - and
		// say so, because a probe that waited silently for a marker would be the
		// same blind spot it exists to remove. It never moves the deadline: that
		// bound is fixed by launch() from the requested duration, and nothing
		// here can create, shorten or publish around it.
		const startWatch = setInterval(() => {
			try {
				if (!existsSync(join(state, "suite-start.json"))) return;
				if (censusWatcher) clearInterval(censusWatcher);
				censusWatcher = null;
				censusBasis = "suite-start";
				emitCensus();
				censusTimer = setInterval(emitCensus, censusInterval);
				censusTimer?.unref?.();
			} catch {
				/* Polling failures are not suite failures. */
			}
		}, 250);
		censusWatcher = startWatch;
		censusWatcher?.unref?.();
		// First sample is launch-anchored unless the marker is already present.
		emitCensus();
		censusTimer = setInterval(emitCensus, censusInterval);
		censusTimer?.unref?.();
	}
	let capturedStacks = false;
	const deadline = setTimeout(
		() => {
			// Capture BEFORE the kill path so a live-but-parked process still answers;
			// the reap itself is unchanged, only delayed by the bounded wait. The
			// reason is pinned first so a target that dies of the report signal can
			// never turn the deadline verdict into an unattributed signal death.
			if (capturedStacks) return stop("absolute-deadline");
			capturedStacks = true;
			reason = "absolute-deadline";
			void captureStacks(state, config)
				.catch(() => undefined)
				.finally(() => stop("absolute-deadline"));
		},
		Math.max(0, config.deadline - Date.now()),
	);
	// Ownership is armed before any fallible startup lookup/publication. A
	// startup exception cannot leave a detached body without its deadline.
	try {
		closeSync(fd);
		const pipeline = identify(child.pid);
		// Never publish rejected identity into the cleanup authority: even a
		// mismatched-but-live identity must not license escalation to that group.
		if (!pipeline || pipeline.pid !== child.pid || pipeline.pgid !== child.pid)
			throw Error("Cannot identify owned suite group");
		config.pipeline = pipeline;
		config.supervisorPid = process.pid;
		config.supervisor = identify(process.pid);
		startupPhase = "publication";
		publish(join(state, "config.json"), config);
		startupPhase = "observer";
		observer = spawnObserver();
		observer.on("error", (error) => {
			observationFailure = {
				phase: "observer",
				code: error.code ?? error.name,
			};
		});
		observer.on("exit", (code, signal) => {
			if (!observerClosing && (code !== 0 || signal))
				observationFailure = { phase: "observer-exit", code: code ?? signal };
		});
		await new Promise((ready, reject) => {
			const timer = setTimeout(
				() => reject(Error("Observer startup timed out")),
				Math.min(1500, Math.max(0, config.deadline - Date.now())),
			);
			observer.once("spawn", () => {
				clearTimeout(timer);
				ready();
			});
			observer.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
		});
		if (Date.now() >= config.deadline) stop("absolute-deadline");
		if (stopping) throw Error("Startup interrupted before suite release");
		released = true;
		gate.end("go\n");
	} catch (error) {
		observationFailure = {
			phase: startupPhase,
			code: error.code ?? error.name,
		};
		stop("startup-error");
		gate?.destroy();
	}
	const result = await exited;
	clearTimeout(deadline);
	// Let any deadline escalation reap the owned group before publishing final
	// status. No keepalive is added to a normal test/coordinator exit.
	if (stopping) await pause(1600);
	for (const timer of signals) clearTimeout(timer);
	observerClosing = true;
	if (
		observer?.pid > 1 &&
		observer.exitCode === null &&
		observer.signalCode === null
	) {
		try {
			observer.kill("SIGTERM");
		} catch {
			/* Already gone. */
		}
		await new Promise((r) => {
			const timer = setTimeout(r, 2500);
			observer.once("exit", () => {
				clearTimeout(timer);
				r();
			});
		});
		if (
			observer?.pid > 1 &&
			observer.exitCode === null &&
			observer.signalCode === null
		) {
			try {
				process.kill(-observer.pid, "SIGKILL");
			} catch {
				/* Already gone. */
			}
		}
	}
	const finalSampleOwner = optional(join(state, "sample-owner.json"));
	signalGroup(finalSampleOwner, "SIGKILL");
	if (
		observer?.pid > 1 &&
		observer.exitCode === null &&
		observer.signalCode === null
	) {
		await new Promise((r) => {
			const timer = setTimeout(r, 500);
			observer.once("exit", () => {
				clearTimeout(timer);
				r();
			});
		});
	}
	const remaining = [];
	if (observer?.pid > 1 && identity(observer.pid)) remaining.push(observer.pid);
	if (ownedIdentity(finalSampleOwner)) remaining.push(finalSampleOwner.pid);
	atomic(join(state, "terminal.json"), {
		...result,
		code:
			reason === "absolute-deadline"
				? 124
				: reason === "startup-error"
					? 1
					: reason !== "completed"
						? 128 + (constants.signals[reason] ?? 1)
						: result.code,
		reason: result.reason ?? reason,
		pipelinePid: child.pid,
		observationFailure,
		launched: config.launched,
		deadline: config.deadline,
		elapsedMs: Date.now() - config.launched,
		cleanup: { remaining },
	});
}

export function readTerminal(state) {
	const result = read(join(state, "terminal.json"));
	if (
		!Number.isInteger(result.code) ||
		result.code < 0 ||
		result.code > 255 ||
		!Number.isFinite(result.elapsedMs) ||
		!result.cleanup ||
		result.cleanup.remaining.length
	)
		throw Error("Invalid terminal receipt or observer cleanup");
	return result;
}
// Only await forwards console bytes. Checkpoints are file-only so an undrained
// Actions pipe cannot hold the next upload step hostage. Initial TAP is delayed
// through both checkpoints (~3 minutes plus uploads); recording never waits.
// The witness uses neither this stream nor its backpressure-sensitive loop.
export function forwardAvailable(state, sink = process.stdout) {
	const path = join(state, "console.log");
	if (!existsSync(path) || sink.writableNeedDrain) return;
	let offset = optional(join(state, "forward-offset.json"))?.offset ?? 0;
	const size = statSync(path).size;
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(Math.min(65536, Math.max(0, size - offset)));
		if (!buffer.length) return;
		const count = readSync(fd, buffer, 0, buffer.length, offset);
		sink.write(buffer.subarray(0, count));
		offset += count;
		atomic(join(state, "forward-offset.json"), { offset });
	} finally {
		closeSync(fd);
	}
}
export async function awaitResult({ state, forward = false }) {
	const config = read(join(state, "config.json"));
	while (!existsSync(join(state, "terminal.json"))) {
		const owner = optional(join(state, "owner.json"));
		if (owner && Date.now() > config.launched + 1000) {
			const current = identity(owner.pid);
			if (!current || (owner.start && !same(owner, current)))
				throw Error(
					"Missing terminal receipt: supervisor exited or identity changed",
				);
		}
		if (Date.now() > config.deadline + 10_000)
			throw Error("Missing terminal receipt after original deadline");
		if (forward) forwardAvailable(state);
		await pause(50);
	}
	if (forward) {
		const drainDeadline = Date.now() + 10_000;
		while (
			(optional(join(state, "forward-offset.json"))?.offset ?? 0) <
			statSync(join(state, "console.log")).size
		) {
			if (Date.now() > drainDeadline)
				throw Error(
					"Console sink did not drain; terminal verdict is not delivered",
				);
			forwardAvailable(state);
			await pause(0);
		}
	}
	return readTerminal(state);
}
export async function checkpoint({ state, afterMs, output }) {
	const config = read(join(state, "config.json"));
	const until = Math.min(
		config.launched + afterMs,
		config.deadline,
		config.setupStarted + JOB_MS - 5 * 60_000,
	);
	while (Date.now() < until && !existsSync(join(state, "terminal.json"))) {
		await pause(50);
	}
	const witness = optional(join(state, "witness.json"));
	const frozen = {
		launched: config.launched,
		deadline: config.deadline,
		setupStarted: config.setupStarted,
		at: Date.now(),
		terminal: optional(join(state, "terminal.json")),
		witness,
		witnessMissing: !witness,
	};
	if (Buffer.byteLength(JSON.stringify(frozen)) > 128 * 1024)
		throw Error("Checkpoint exceeds bounded payload");
	writeFileSync(output, `${JSON.stringify(frozen)}\n`, { flag: "wx" });
	return frozen;
}

export async function main(args) {
	const [mode, state, ...rest] = args;
	if (
		!state ||
		!["launch", "worker", "witness", "sample", "checkpoint", "await"].includes(
			mode,
		)
	)
		throw Error(
			"Usage: desktop-suite-checkpoints <launch|checkpoint|await> <state> ...",
		);
	if (mode === "worker") {
		await worker(state);
		return 0;
	}
	if (mode === "witness") {
		await witness(state);
		return 0;
	}
	if (mode === "sample") {
		console.log(JSON.stringify(snapshot(read(join(state, "config.json")))));
		return 0;
	}
	if (mode === "launch") {
		launch({ state, shell: rest[0], setupStarted: Number(rest[1]) });
		return 0;
	}
	if (mode === "checkpoint") {
		await checkpoint({
			state,
			afterMs: Number(rest[0]),
			output: rest[1],
		});
		return 0;
	}
	const result = await awaitResult({ state, forward: true });
	if (process.env.GITHUB_OUTPUT && existsSync(join(state, "outputs")))
		writeFileSync(
			process.env.GITHUB_OUTPUT,
			readFileSync(join(state, "outputs"), "utf8"),
			{ flag: "a" },
		);
	return result.code;
}
if (isEntryPoint(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (error) {
		if (process.argv[2] === "checkpoint") {
			// Even failure handoff is file-only. Do not replace an immutable
			// checkpoint or let a saturated stderr pipe postpone Actions upload.
			try {
				writeFileSync(
					process.argv[5],
					`${JSON.stringify({ diagnosticFailure: true, phase: "checkpoint", code: error.code ?? error.name })}\n`,
					{ flag: "wx" },
				);
			} catch {
				/* Nonzero exit still exposes unavailable evidence. */
			}
		} else
			console.error(`Desktop checkpoint supervision failed: ${error.message}`);
		process.exitCode = 1;
	}
}
