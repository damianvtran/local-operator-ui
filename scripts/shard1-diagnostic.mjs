#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
/**
 * Opt-in evidence for the baseline shard-1 timeout, NOT a replacement gate.
 *
 * A paired Linux control must use the real dispatcher, concurrency three and
 * piped TAP. Per-process JSONL bypasses ordered TAP buffering: root-after means
 * tests completed, not that the worker exited. Unref resource samples must never
 * make a healthy worker stay alive. No timer clearing or forced successful exit.
 *
 * The supervisor owns one aggregate deadline/memory budget, including detached
 * dispatcher children. PID + start identity is checked before EVERY signal;
 * killing only the shell would orphan Node's detached test group/keeper. Records
 * are incremental and always uploaded by the workflow, including failed setup.
 */
import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

export const FILES = Object.freeze([
	"scripts/child-reader-foot-react.test.mjs",
	"scripts/ci-scope.test.mjs",
	"scripts/code-review-model.test.mjs",
]);
export const WALL_MS = 90_000;
export const MEMORY_MB = 3072;
const SHA_RE = /^[a-f0-9]{40}$/;
const UBUNTU_RE = /^VERSION_ID="?26\.04"?$/m;
const SPACE_RE = /\s+/;
const TRACE_FILE_RE = /^\d+\.jsonl$/;
const FAIL_ZERO_RE = /^# fail 0$/m;
const TEST_COUNT_RE = /^# tests [1-9]\d*$/m;
const SELF = fileURLToPath(import.meta.url);
const TRACE = "LOCAL_OPERATOR_UI_SHARD1_TRACE";
const ENTRYPOINTS = "LOCAL_OPERATOR_UI_SHARD1_ENTRIES";
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const json = (path, value) =>
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const hash = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

export function validSha(sha) {
	if (!SHA_RE.test(sha ?? ""))
		throw new Error("Expected full lowercase commit SHA");
	return sha;
}
export function outputPath(path, root = process.env.RUNNER_TEMP) {
	if (!root || !isAbsolute(path ?? ""))
		throw new Error("Absolute output beneath RUNNER_TEMP required");
	const rel = relative(realpathSync(root), resolve(path));
	if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel))
		throw new Error("Output escapes RUNNER_TEMP");
	// An existing symlink ancestor must not redirect evidence outside the root.
	let parent = resolve(path);
	while (!existsSync(parent)) parent = dirname(parent);
	const physical = relative(realpathSync(root), realpathSync(parent));
	if (physical === ".." || physical.startsWith("../") || isAbsolute(physical))
		throw new Error("Symlink output escapes RUNNER_TEMP");
	return resolve(path);
}
export function parity() {
	const release = readFileSync("/etc/os-release", "utf8");
	if (
		process.platform !== "linux" ||
		process.version !== "v22.23.4" ||
		!UBUNTU_RE.test(release)
	) {
		throw new Error(
			"Requires actual Linux Ubuntu26.04 / Node22.23.4; no approximate-parity success",
		);
	}
	return { platform: process.platform, node: process.version, release };
}
export function classify(result, events) {
	if (result.interrupted || result.samplingFailed || result.survivors?.length)
		return "instrumentation-or-cleanup-failure";
	if (result.memory) return "memory-bound";
	if (result.timeout) {
		// A different worker or the dispatcher may hold the pipeline. Preserve
		// evidence that THIS worker already exited rather than blaming every
		// completed neighbour for the shared deadline.
		if (
			events.some((e) => e.event === "TESTS_COMPLETE") &&
			events.some((e) => e.event === "EXIT" && e.code === 0)
		)
			return "completed-before-cutoff";
		return events.some((e) => e.event === "TESTS_COMPLETE")
			? "held-after-tests"
			: "incomplete-body-or-import";
	}
	if (result.code !== 0 || result.signal) return "assertion-or-launch-failure";
	return events.some((e) => e.event === "BEFORE_EXIT") &&
		events.some((e) => e.event === "TESTS_COMPLETE")
		? "completed"
		: "missing-lifecycle";
}

/** Private resource TYPES only: no environment, socket contents or handle URLs. */
function resources() {
	return process.getActiveResourcesInfo();
}
function preload() {
	const dir = outputPath(process.env[TRACE]);
	mkdirSync(dir, { recursive: true });
	const entries = JSON.parse(process.env[ENTRYPOINTS] ?? "[]").map((p) =>
		realpathSync(p),
	);
	let worker = false;
	const log = (event, extra = {}) =>
		appendFileSync(
			join(dir, `${process.pid}.jsonl`),
			`${JSON.stringify({ event, pid: process.pid, ppid: process.ppid, at: Date.now(), worker, resources: resources(), ...extra })}\n`,
		);
	log("PROCESS_START");
	globalThis.__loShard1Trace = log;
	registerHooks({
		load(url, context, next) {
			const got = next(url, context);
			if (
				!url.startsWith("file:") ||
				!isEntryPoint(url) ||
				!entries.includes(realpathSync(fileURLToPath(url)))
			)
				return got;
			worker = true;
			log("FILE_LOAD", { file: basename(fileURLToPath(url)) });
			// Instrument only the physical worker entry, never imported suites or
			// wrappers. Assertions and production imports remain byte-for-byte.
			return {
				...got,
				source: `import { before as __loBefore, after as __loAfter } from 'node:test';\n__loBefore(() => globalThis.__loShard1Trace('TESTS_START'));\n__loAfter(() => globalThis.__loShard1Trace('TESTS_COMPLETE'));\nglobalThis.__loShard1Trace('MODULE_START');\n${got.source}\n;globalThis.__loShard1Trace('MODULE_EVALUATED');\n`,
			};
		},
	});
	const ticker = setInterval(() => log("RESOURCES"), 250);
	ticker.unref();
	process.on("beforeExit", (code) => log("BEFORE_EXIT", { code }));
	process.on("exit", (code) => log("EXIT", { code }));
	// TERM is not intercepted: changing termination semantics would conceal
	// failures. Last unref sample remains evidence, not an invented cutoff read.
}

function identity(pid) {
	try {
		if (process.platform === "linux") {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			return fields[0] === "Z" ? null : fields[19];
		}
		// Local synthetic controls only; never accepted as Linux subject parity.
		return (
			execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
				encoding: "utf8",
				timeout: 1000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim() || null
		);
	} catch {
		return null;
	}
}
function table() {
	return execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,rss="], {
		encoding: "utf8",
		timeout: 1000,
	})
		.trim()
		.split("\n")
		.map((line) => {
			const [pid, ppid, pgid, rssKb] = line.trim().split(SPACE_RE).map(Number);
			return { pid, ppid, pgid, rssKb };
		});
}
function signal(pid, sig) {
	try {
		process.kill(pid, sig);
	} catch (e) {
		if (e.code !== "ESRCH") throw e;
	}
}
export function cleanEnv(out) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			["PATH", "LANG", "LC_ALL", "LC_CTYPE", "RUNNER_TEMP"].includes(key),
		),
	);
	Object.assign(env, {
		HOME: join(out, "home"),
		TMPDIR: join(out, "tmp"),
		XDG_CONFIG_HOME: join(out, "home/config"),
		LOCAL_OPERATOR_CONFIG_DIR: join(out, "home/lop"),
		LOCAL_OPERATOR_LOG_DIR: join(out, "logs"),
		CI: "1",
		TERM: "xterm-256color",
		GIT_CONFIG_SYSTEM: "/dev/null",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "/bin/false",
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
	});
	for (const path of [env.HOME, env.TMPDIR])
		mkdirSync(path, { recursive: true });
	return env;
}
/** Real shell pipeline, with pipefail. The command is positional, never eval. */
export async function supervise({
	command,
	cwd,
	out,
	env,
	wallMs,
	memoryMb = MEMORY_MB,
}) {
	mkdirSync(out, { recursive: true });
	const startedAt = Date.now();
	let peakRssMb = 0;
	const log = join(out, "tap.log");
	const child = spawn(
		"bash",
		[
			"-o",
			"pipefail",
			"-c",
			'"$@" 2>&1 | tee "$DIAG_TAP"',
			"diagnostic",
			...command,
		],
		{
			cwd,
			env: { ...env, DIAG_TAP: log },
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const owned = new Map();
	let timeout = false;
	let memory = false;
	let samplingFailed = false;
	let interrupted = false;
	let observedClose = false;
	const done = new Promise((finish) => {
		child.once("error", (error) =>
			finish({ code: null, signal: null, error: error.message }),
		);
		child.once("close", (code, sig) => {
			observedClose = true;
			finish({ code, signal: sig });
		});
	});
	// tee's independent file survives a blocked CI log sink; drain launcher pipes
	// without retaining full TAP in memory or letting an unread pipe deadlock it.
	child.stdout.resume();
	child.stderr.on("data", (chunk) =>
		appendFileSync(join(out, "launcher-stderr.log"), chunk),
	);
	const sample = () => {
		try {
			const rows = table();
			for (let i = 0; i < rows.length; i++) {
				let changed = false;
				for (const row of rows)
					if (
						!owned.has(row.pid) &&
						(row.pid === child.pid || owned.has(row.ppid))
					) {
						const id = identity(row.pid);
						if (id) {
							owned.set(row.pid, { ...row, id });
							changed = true;
						}
					}
				if (!changed) break;
			}
			const live = rows.filter(
				(row) =>
					owned.has(row.pid) && owned.get(row.pid).id === identity(row.pid),
			);
			appendFileSync(
				join(out, "processes.jsonl"),
				`${JSON.stringify({ at: Date.now(), processes: live })}\n`,
			);
			return live;
		} catch {
			samplingFailed = true;
			return [];
		}
	};
	const reap = (sig) => {
		sample();
		for (const [pid, row] of owned)
			if (pid === row.pgid && identity(pid) === row.id) signal(-pid, sig);
		for (const [pid, row] of owned)
			if (identity(pid) === row.id) signal(pid, sig);
	};
	const stop = () => {
		interrupted = true;
		reap("SIGTERM");
	};
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	sample();
	const tick = setInterval(() => {
		const live = sample();
		const rssMb =
			(process.memoryUsage().rss / 1024 +
				live.reduce((sum, row) => sum + row.rssKb, 0)) /
			1024;
		peakRssMb = Math.max(peakRssMb, rssMb);
		if (rssMb > memoryMb) {
			memory = true;
			reap("SIGTERM");
		}
		if (memory || timeout || interrupted || samplingFailed) reap("SIGKILL");
	}, 250);
	const deadline = setTimeout(() => {
		timeout = true;
		reap("SIGTERM");
	}, wallMs);
	let result;
	let completionTimer;
	try {
		// A pipe inherited by a stranded helper can keep close pending after the
		// shell exits. Cancel this backstop on success: an abandoned timeout would
		// itself retain a healthy supervisor until the entire deadline elapsed.
		const cutoff = new Promise((finish) => {
			completionTimer = setTimeout(
				() => finish({ code: null, signal: "DEADLINE" }),
				wallMs + 2000,
			);
		});
		result = await Promise.race([done, cutoff]);
	} finally {
		clearTimeout(completionTimer);
		clearInterval(tick);
		clearTimeout(deadline);
		reap("SIGTERM");
		await wait(100);
		reap("SIGKILL");
		await wait(100);
		process.removeListener("SIGTERM", stop);
		process.removeListener("SIGINT", stop);
	}
	const survivors = sample().map((row) => row.pid);
	if (!observedClose) {
		child.stdout.destroy();
		child.stderr.destroy();
	}
	const record = {
		...result,
		timeout,
		memory,
		interrupted,
		samplingFailed,
		survivors,
		memoryMb,
		wallMs,
		elapsedMs: Date.now() - startedAt,
		peakRssMb,
	};
	json(join(out, "result.json"), record);
	return record;
}
export function traceEvents(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => TRACE_FILE_RE.test(name))
		.flatMap((name) =>
			readFileSync(join(dir, name), "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((s) => JSON.parse(s)),
		);
}
function git(root, ...args) {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		timeout: 10_000,
	}).trim();
}
function options(args) {
	const allowed = new Set([
		"--mode",
		"--base",
		"--candidate",
		"--root",
		"--out",
		"--store",
	]);
	const found = {};
	for (let i = 0; i < args.length; i += 2) {
		if (
			!allowed.has(args[i]) ||
			!args[i + 1] ||
			Object.hasOwn(found, args[i].slice(2))
		)
			throw new Error("Unknown/repeated/missing option");
		found[args[i].slice(2)] = args[i + 1];
	}
	return found;
}
export async function main(args) {
	const started = Date.now();
	const o = options(args);
	const out = outputPath(o.out);
	mkdirSync(out, { recursive: true });
	json(join(out, "started.json"), {
		at: new Date().toISOString(),
		phase: "preflight",
		linuxProof: false,
	});
	const platform = parity();
	const base = validSha(o.base);
	const candidate = validSha(o.candidate);
	const root = realpathSync(o.root);
	if (git(root, "rev-parse", "HEAD") !== candidate)
		throw new Error("Candidate checkout SHA mismatch");
	git(root, "merge-base", "--is-ancestor", base, candidate);
	const lock = hash(join(root, "pnpm-lock.yaml"));
	const baseLock = createHash("sha256")
		.update(
			execFileSync("git", ["show", `${base}:pnpm-lock.yaml`], {
				cwd: root,
				timeout: 10_000,
			}),
		)
		.digest("hex");
	if (lock !== baseLock)
		throw new Error(
			"Controls have different lockfiles; no shared install permitted",
		);
	json(join(out, "provenance.json"), {
		platform,
		base,
		candidate,
		lock,
		tooling: git(dirname(SELF), "rev-parse", "HEAD"),
		files: FILES,
		concurrency: 3,
		wallMs: WALL_MS,
		memoryMb: MEMORY_MB,
		mode: o.mode,
	});
	if (o.mode === "setup") {
		if (!isAbsolute(o.store ?? ""))
			throw new Error("Absolute dependency cache store required");
		const result = await supervise({
			command: [
				"pnpm",
				"install",
				"--frozen-lockfile",
				"--ignore-scripts",
				"--store-dir",
				o.store,
			],
			cwd: root,
			out: join(out, "setup"),
			env: cleanEnv(join(out, "setup")),
			wallMs: 597_000,
		});
		return result.code === 0 &&
			!result.timeout &&
			!result.memory &&
			!result.samplingFailed &&
			!result.survivors.length
			? 0
			: 1;
	}
	if (o.mode !== "run") throw new Error("Expected setup or run mode");
	// Existing shared install only. No install is hidden in diagnostic execution.
	const installed = join(root, "node_modules/.pnpm/lock.yaml");
	if (hash(installed) !== lock)
		throw new Error("Installed lock differs from controls");
	const baseRoot = join(root, ".worktrees/shard1-base");
	git(root, "worktree", "add", "--detach", baseRoot, base);
	symlinkSync("../../node_modules", join(baseRoot, "node_modules"), "dir");
	const results = [];
	// Prove instrumentation before interpreting a product worker. Synthetic
	// faults run inside this SAME aggregate deadline/budget, not hidden setup.
	const self = await supervise({
		command: [
			process.execPath,
			"--test",
			"--test-concurrency=1",
			join(dirname(SELF), "shard1-diagnostic.test.mjs"),
		],
		cwd: dirname(dirname(SELF)),
		out: join(out, "negative-controls"),
		env: cleanEnv(join(out, "negative-controls")),
		wallMs: 6000,
	});
	if (
		self.code !== 0 ||
		self.timeout ||
		self.memory ||
		self.samplingFailed ||
		self.survivors.length
	)
		throw new Error(
			"Instrumentation negative controls did not pass; subjects NOT_RUN",
		);
	for (const [side, cwd, sha] of [
		["base", baseRoot, base],
		["candidate", root, candidate],
	]) {
		const remaining = WALL_MS - (Date.now() - started) - 2500;
		if (remaining < 1000) {
			results.push({ side, status: "NOT_RUN", reason: "aggregate deadline" });
			break;
		}
		const dir = join(out, side);
		const env = cleanEnv(dir);
		Object.assign(env, {
			NODE_OPTIONS: `--max-old-space-size=768 --import=${SELF}`,
			[TRACE]: join(dir, "trace"),
			[ENTRYPOINTS]: JSON.stringify(FILES.map((f) => join(cwd, f))),
			LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB: String(MEMORY_MB),
		});
		const result = await supervise({
			command: [
				process.execPath,
				"scripts/run-desktop-tests.mjs",
				"--test-concurrency=3",
				"--test-reporter=tap",
				...FILES,
			],
			cwd,
			out: dir,
			env,
			wallMs: Math.min(38_000, remaining),
		});
		const events = traceEvents(join(dir, "trace")).filter(
			(event) => event.worker,
		);
		const workers = FILES.map((file) => {
			const own = events.filter(
				(event) =>
					event.file === basename(file) ||
					event.pid ===
						events.find(
							(e) => e.event === "FILE_LOAD" && e.file === basename(file),
						)?.pid,
			);
			return { file, status: classify(result, own) };
		});
		const tap = readFileSync(join(dir, "tap.log"), "utf8");
		const summary = FAIL_ZERO_RE.test(tap) && TEST_COUNT_RE.test(tap);
		results.push({ side, sha, ...result, workers, summary });
		json(join(out, "controls.json"), results);
		if (result.samplingFailed || result.survivors.length) break;
	}
	json(join(out, "controls.json"), results);
	return results.length === 2 &&
		results.every(
			(r) =>
				r.code === 0 &&
				!r.signal &&
				!r.timeout &&
				!r.memory &&
				!r.interrupted &&
				!r.samplingFailed &&
				r.survivors.length === 0 &&
				r.summary &&
				r.workers.every((w) => w.status === "completed"),
		)
		? 0
		: 1;
}
if (process.env[TRACE]) preload();
else if (isEntryPoint(import.meta.url)) {
	main(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			console.error(`shard1 diagnostic refused: ${error.message}`);
			process.exitCode = 1;
		});
}
