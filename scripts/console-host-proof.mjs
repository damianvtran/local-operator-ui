#!/usr/bin/env node
/**
 * End-to-end proof for the console host.
 *
 * Why this exists: the desktop suite's console tests drive the RULES with a fake pty
 * and a fake window, and no test in that suite has ever forked a process or
 * photographed a pane. This harness is the run that can falsify the rest of the
 * claim — it boots the BUILT app headless, forges a REAL pty through the app's own
 * main process, and drives the real `/rpc` with real requests, printing what came
 * back. It is committed rather than pasted into a PR because a transcript that cannot
 * be re-run is a claim, not evidence.
 *
 * Isolation (non-negotiable, and why each piece is here):
 *   - `HOME` AND `LOCAL_OPERATOR_CONFIG_DIR` are both redirected: the config dir
 *     alone leaves the cache and hard-coded home roots in the real home.
 *   - `LOCAL_OPERATOR_LOG_DIR` is redirected as well, and it is the one path the
 *     scratch HOME cannot move: the app's logger takes its default from Electron's
 *     `home` — the OS ACCOUNT's home on macOS — so a run missing this override
 *     appends to the operator's own log files.
 *   - the Electron profile root is a scratch `--user-data-dir`, so the run cannot
 *     see or touch the operator's real profile.
 *   - `--window-mode=headless` (mirrored as the env var for a launch that passes no
 *     flag) and every `CMUX_*`/`LOP_*` variable removed: the app must never take the
 *     operator's focus, and an inherited cmux workspace id has already renamed his
 *     real workspaces once.
 *   - the app's backend manager is disabled: this run is about a console, and a pip
 *     install in a scratch HOME has a quit path of its own.
 *
 * Usage:
 *   node scripts/console-host-proof.mjs [--keep] [--out <dir>]
 *   node scripts/console-host-proof.mjs --packaged "/Applications/Local Operator.app"
 *
 * The packaged mode is the second half of P13: it asserts the two packing traps in a
 * tree electron-builder produced (`stat -f %Sp` on the unpacked helper, and the
 * absence of the pruned foreign-platform prebuilds). It does not boot the app.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The REAL Electron binary, not `node_modules/.bin/electron`: that path is a
// shell -> `node cli.js` -> Electron chain, so the pid a harness holds is the
// SHIM's, and signalling it stops the shim while the app keeps running.
import electronPath from "electron";
import { withNotificationsOff } from "./notifications-off.mjs";

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const PACKAGED = argValue("--packaged");
const ROOT = process.cwd();

/** The value after a flag, or undefined. Named `argValue` rather than `valueOf`,
 * which would shadow a global and read as something else entirely at a call site. */
function argValue(flag) {
	const index = argv.indexOf(flag);
	return index === -1 ? undefined : argv[index + 1];
}

/** The surface-handle grammar, and the two shapes this rig parses out of other
 * tools' output. Module scope: each is compiled once rather than per call, which is
 * the rule the repo's own lint enforces everywhere else. */
const SURFACE_HANDLE = /^con:\d+:[A-Za-z0-9_-]+$/;
const PLIST_EXECUTABLE =
	/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/;
const PS_LINE = /^\s*(\d+)\s+(.*)$/;

const SCRATCH = join(
	tmpdir(),
	`lo-console-proof-${PACKAGED ? "packaged-" : ""}${process.pid}`,
);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const LOG_DIR = join(SCRATCH, "logs");
const OUT_DIR = argValue("--out") ?? join(SCRATCH, "out");
const HISTORY_DIR = join(CONFIG_DIR, "run", "ui-console", "history");
const SESSION = "proof-session";

const transcript = [];
let failures = 0;
let app = null;
let DEVTOOLS_PORT = 0;

function record(label, body) {
	say(`\n## ${label}\n`);
	say("```");
	say(typeof body === "string" ? body : JSON.stringify(body, null, 2));
	say("```");
}

function say(line) {
	transcript.push(line);
	console.log(line);
}

function check(label, ok, detail) {
	if (!ok) failures += 1;
	record(
		`${ok ? "PASS" : "FAIL"} — ${label}`,
		detail === undefined ? "(no detail)" : detail,
	);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- packaged mode */

/**
 * The two packing traps, asserted on a tree someone else built.
 *
 *  1. `prebuilds/` must be UNPACKED, not merely rewritable: node-pty rewrites
 *     `app.asar` to `app.asar.unpacked` before forking, so in a fully-packed
 *     archive the path looks right and the spawn still fails.
 *  2. The helper must be executable. The published tarball ships it 0644, and an
 *     in-app update stages a ZIP with no step that re-asserts modes while
 *     `codesign`'s seal does not cover them.
 */
async function packagedProof(appPath) {
	const resources = join(appPath, "Contents", "Resources");
	const archive = join(resources, "app.asar");
	const unpackedRoot = join(
		resources,
		"app.asar.unpacked",
		"node_modules",
		"node-pty",
	);
	check("the packed app has an asar archive", existsSync(archive), archive);
	check(
		"node-pty is unpacked out of the archive",
		existsSync(unpackedRoot),
		unpackedRoot,
	);
	if (!existsSync(unpackedRoot)) return;

	const prebuilds = join(unpackedRoot, "prebuilds");
	const present = existsSync(prebuilds) ? readdirSync(prebuilds) : [];
	// ONE prebuild directory, and it is this artifact's. The published package ships
	// ~58 MB of win32 prebuilds and `.pdb` files against ~136 KB of darwin-arm64
	// ones, and the prune in `afterPack` is what removes them.
	check(
		"exactly this artifact's prebuilds ship",
		present.length === 1 &&
			present[0].startsWith("darwin-") &&
			!present.some((name) => name.startsWith("win32")),
		present,
	);
	const helper = join(prebuilds, "darwin-arm64", "spawn-helper");
	const helperExists = existsSync(helper);
	check("the helper is present", helperExists, helper);
	if (helperExists) {
		const mode = statSync(helper).mode & 0o777;
		check(
			"the helper is executable (trap 1)",
			mode === 0o755,
			`${helper} mode 0${mode.toString(8)} (expected 0755)`,
		);
	}
	const native = join(prebuilds, "darwin-arm64", "pty.node");
	check("the native module is unpacked too", existsSync(native), native);
	// AND the JavaScript stays IN the archive. That is not tidiness: node-pty rewrites
	// `app.asar` to `app.asar.unpacked` inside itself, so a `lib/` that also sits on
	// disk makes the require land on an `app.asar.unpacked` path and the rewrite appends
	// a second `.unpacked`, killing the first spawn.
	const archived = asarEntries(archive).some(
		(entry) => entry === "node_modules/node-pty/lib/index.js",
	);
	check(
		"node-pty's JavaScript is still inside the archive (trap 2)",
		archived,
		{ archive, contains: "node_modules/node-pty/lib/index.js" },
	);
	record(
		"prebuild sizes",
		present.map((name) => ({
			name,
			bytes: directoryBytes(join(prebuilds, name)),
		})),
	);
	record(
		"packaging step log",
		"the hook's own line is in the build output; the two numbers it reports are the mode it found and the mode it left",
	);

	/*
	 * And then the half that a stat cannot prove: a REAL pty forked from the PACKAGED
	 * app. A tree with the right modes and an app whose `spawn` fails for another
	 * reason are two different failures, and only this cell tells them apart.
	 */
	const executable = packagedExecutable(appPath);
	check(
		"the bundle's executable is where it is expected",
		!!executable,
		executable,
	);
	if (!executable) return;
	app = await launchApp(executable);
	const state = await waitForState();
	const created = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-c", "printf 'packaged-marker\n'; sleep 0.2"],
		cols: 100,
		rows: 30,
		sizing: "fixed",
	});
	const read = await readUntil(state, created.surface, "packaged-marker");
	check(
		"the packaged app forks a real pty and reads it back (P11)",
		read.text.includes("packaged-marker"),
		{ surface: created.surface, pid: created.pid, viewport: read.text },
	);
	// The same two focus facts as the dev run, on the artifact rather than the tree:
	// the mode is named on this launch too, and the WindowServer is asked whether the
	// app took the front.
	const packagedState = await rendererEvaluate(
		"JSON.stringify({ visibility: document.visibilityState, focused: document.hasFocus() })",
	);
	check(
		"the packaged launch's window never holds key focus, and it never took the front",
		JSON.parse(packagedState).focused === false &&
			(app.watch?.ours() ?? 0) === 0,
		{
			window: packagedState,
			samples: app.watch?.samples.length ?? 0,
			ours: app.watch?.ours() ?? 0,
		},
	);
	await rpcOk(state, "console_close", { surface: created.surface });
}

/** The app bundle's own executable, read from its Info.plist rather than guessed
 * from a product name a build can change. */
function packagedExecutable(appPath) {
	const plist = join(appPath, "Contents", "Info.plist");
	if (!existsSync(plist)) return null;
	// Read the declaration rather than listing `Contents/MacOS`: a bundle can carry a
	// helper beside its main executable, and the plist is what says which is which.
	const match = PLIST_EXECUTABLE.exec(readFileSync(plist, "utf8"));
	// A binary plist would need a parser; electron-builder writes XML here, and
	// anything else is reported rather than guessed.
	return match ? join(appPath, "Contents", "MacOS", match[1]) : null;
}

/**
 * The file paths inside an asar archive, read from its header.
 *
 * WHY THE HEADER AND NOT A SUBSTRING SEARCH: an asar header stores a TREE, so the
 * full path of a file never appears as a contiguous string — a `grep` for
 * `node_modules/node-pty/lib/index.js` over the archive reports "absent" for a file
 * that is present (measured, and it made this rig claim the JavaScript had been
 * unpacked when it had not). The header is the only place that knows.
 */
function asarEntries(archive) {
	const fd = openSync(archive, "r");
	try {
		// The archive starts with a three-word pickle prologue: the size of the next
		// field, the payload size, and the JSON string's own length. The JSON follows
		// at a fixed 16-byte offset.
		const head = Buffer.alloc(16);
		readSync(fd, head, 0, 16, 0);
		const size = head.readUInt32LE(8);
		const buffer = Buffer.alloc(size);
		readSync(fd, buffer, 0, size, 16);
		// The header's JSON is padded to a 4-byte boundary with bytes that are not part
		// of it, so the object is cut at its own closing brace rather than trimmed of
		// NULs — the padding is not always NUL (measured: 2 padding bytes that were not).
		const text = buffer.toString("utf8");
		const json = JSON.parse(text.slice(0, text.lastIndexOf("}") + 1));
		const walk = (node, prefix) => {
			const out = [];
			for (const [name, meta] of Object.entries(node)) {
				if (meta && typeof meta === "object" && meta.files) {
					out.push(...walk(meta.files, `${prefix}${name}/`));
				} else {
					out.push(`${prefix}${name}`);
				}
			}
			return out;
		};
		return walk(json.files ?? {}, "");
	} finally {
		closeSync(fd);
	}
}

function directoryBytes(path) {
	let total = 0;
	let entries;
	try {
		const stats = statSync(path);
		if (stats.isFile()) return stats.size;
		entries = readdirSync(path);
	} catch {
		return 0;
	}
	for (const entry of entries) total += directoryBytes(join(path, entry));
	return total;
}

/* ---------------------------------------------------------------- the app */

async function stopApp() {
	if (!app) return;
	const stopping = app;
	app = null;
	stopping.flush();
	await stopping.stop();
}

function pickDevtoolsPort() {
	return 9400 + (process.pid % 400);
}

async function freeDevtoolsPort(timeoutMs = 10_000) {
	const started = Date.now();
	for (let port = pickDevtoolsPort(); ; port += 1) {
		try {
			await fetch(`http://127.0.0.1:${port}/json/version`);
		} catch (error) {
			if (error instanceof TypeError) return port;
			throw error;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error("no free debugging port");
		}
	}
}

async function launchApp(appPath = ".") {
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	// Every inherited cmux/lop variable is REMOVED rather than overwritten: this
	// process is driven by a session that has them set, and the pty inherits this
	// environment — an inherited `CMUX_WORKSPACE_ID` has already renamed the
	// operator's real cmux workspaces from a test run once.
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	DEVTOOLS_PORT = await freeDevtoolsPort();
	// A packaged bundle is launched by ITS OWN executable; the development tree is
	// launched by Electron with the working directory as the app path. Both get the
	// same isolation, because both are the same app to this harness.
	const child = spawn(
		appPath === "." ? electronPath : appPath,
		[
			...(appPath === "." ? ["."] : []),
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${DEVTOOLS_PORT}`,
			// NAMED, not inferred. The repo resolves an agent-driven launch to
			// `headless` on its own, and this rig says so anyway: a mode that is only
			// INFERRED is a mode whose meaning can change under the rig without the rig
			// saying anything, and a peer measured an agent-launched, windowless,
			// headless instance holding the operator's frontmost application for ~8
			// seconds — so "windowless" is not the same claim as "does not take focus"
			// and the rig states its mode rather than relying on the shape rule.
			"--window-mode=headless",
		],
		{ env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	const logPath = join(SCRATCH, "app.log");
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	// Best effort, and it has to be: the exit handler flushes AFTER this harness may
	// have removed the scratch tree, and a teardown that throws from a child's own
	// `exit` event turns a clean run into an ENOENT stack trace.
	const flush = () => {
		try {
			writeFileSync(logPath, stream.join(""));
		} catch {
			/* the scratch tree is gone: nothing to write into */
		}
	};
	const timer = setInterval(flush, 500);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});
	const watch = startFocusWatch(child.pid);
	return {
		child,
		logPath,
		stream,
		flush,
		watch,
		stop: () =>
			new Promise((resolve) => {
				watch.stop();
				// Kill the process GROUP, not just the pid: Electron spawns helpers
				// (renderer, GPU, utility) and a signal to the direct child alone is not
				// a stop. `reapConsoleHostProof` below also sweeps by pid, because a
				// killed app can leave a `spawn-helper` child behind.
				const killTree = (signal) => {
					try {
						process.kill(-child.pid, signal);
					} catch {
						try {
							child.kill(signal);
						} catch {
							/* already dead */
						}
					}
				};
				child.once("exit", resolve);
				killTree("SIGTERM");
				setTimeout(() => {
					killTree("SIGKILL");
					resolve();
				}, 5000);
			}),
	};
}

/** Any `spawn-helper` this run's app left behind, killed by exact pid.
 *
 * The pty's helper is a child of the app, not of this harness, and killing the
 * app's process group does not always take it: a leaked helper holds a pty open and
 * shows up as a busy process on the operator's machine, which is the class of leak
 * this repo's rigs are expected to reap. The command line carries this run's scratch
 * profile, so nothing another session started can match. */
function reapConsoleHostProof() {
	let out = "";
	try {
		out = execFileSync("ps", ["-ax", "-o", "pid=,command="], {
			encoding: "utf8",
		});
	} catch {
		return 0;
	}
	const lines = out.split("\n");
	let reaped = 0;
	for (const line of lines) {
		const match = PS_LINE.exec(line);
		if (!match) continue;
		const [, pid, command] = match;
		if (!command.includes("spawn-helper")) continue;
		if (!command.includes(SCRATCH)) continue;
		try {
			process.kill(Number(pid), "SIGKILL");
			reaped += 1;
		} catch {
			/* gone already */
		}
	}
	return reaped;
}

/**
 * Everything the app has written that this harness can read: its stdout/stderr, and
 * any log file under the redirected log directory.
 *
 * BOTH, because they are not the same channel: the app's `log()` reaches a file
 * through its own logger, and a check that read only the child's streams reported a
 * heal as unlogged while the file carried the line (measured).
 */
function appLogText() {
	const parts = [];
	try {
		parts.push(readFileSync(join(SCRATCH, "app.log"), "utf8"));
	} catch {
		/* no stream log yet */
	}
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".log")) {
				try {
					parts.push(readFileSync(path, "utf8"));
				} catch {
					/* raced with a rotation */
				}
			}
		}
	};
	walk(LOG_DIR);
	return parts.join("\n");
}

function stateFilePath() {
	return join(CONFIG_DIR, "run", "ui-browser", "host.json");
}

async function waitForState(timeoutMs = 60_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (existsSync(stateFilePath())) {
			try {
				const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
				if (parsed.port) return parsed;
			} catch {
				// The writer stages and renames, so a half-written file is a "not yet".
			}
		}
		await sleep(250);
	}
	throw new Error(`no state file appeared at ${stateFilePath()}`);
}

async function rpc(state, method, params = {}, options = {}) {
	const key = options.key === undefined ? state.session_key : options.key;
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(options.omitKey ? {} : { "X-Bridge-Key": key }),
		},
		body: JSON.stringify({
			id: options.id ?? `proof-${method}`,
			method,
			params,
		}),
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* not JSON: the status is the fact */
	}
	return { status: response.status, text, json };
}

async function rpcOk(state, method, params = {}) {
	const out = await rpc(state, method, params);
	if (out.status !== 200 || !out.json?.ok) {
		throw new Error(`${method} failed: ${out.status} ${out.text}`);
	}
	return out.json.result;
}

/** Poll until `console_read` shows `needle`, or fail with what was actually there. */
async function readUntil(state, surface, needle, timeoutMs = 20_000) {
	const started = Date.now();
	let last = null;
	while (Date.now() - started < timeoutMs) {
		last = await rpcOk(state, "console_read", { surface, mode: "viewport" });
		if (last.text.includes(needle)) return last;
		await sleep(200);
	}
	throw new Error(
		`${needle} never appeared in the viewport; last read was ${JSON.stringify(last?.text)}`,
	);
}

/* ------------------------------------------------------- the renderer, CDP */

async function rendererEvaluate(expression) {
	const list = await (
		await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)
	).json();
	const page = list.find(
		(target) => target.type === "page" && target.url.startsWith("file:"),
	);
	if (!page) throw new Error("no renderer target on the debugging port");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const message = await new Promise((resolve, reject) => {
		socket.addEventListener("message", (event) => {
			const incoming = JSON.parse(event.data);
			if (incoming.id === 1) resolve(incoming);
		});
		socket.addEventListener("error", reject, { once: true });
		socket.send(
			JSON.stringify({
				id: 1,
				method: "Runtime.evaluate",
				params: { expression, awaitPromise: true, returnByValue: true },
			}),
		);
	});
	socket.close();
	if (message.error) throw new Error(`CDP: ${message.error.message}`);
	if (message.result?.exceptionDetails) {
		throw new Error(
			message.result.exceptionDetails.exception?.description ??
				message.result.exceptionDetails.text ??
				"the renderer threw",
		);
	}
	return message.result?.result?.value;
}

/**
 * What the WindowServer says is frontmost, right now.
 *
 * `lsappinfo` rather than AppleScript on purpose: it needs no Automation grant, so a
 * sampling loop cannot raise a permission dialog on the operator's screen. The pid is
 * the sharp half — the app this rig launched is identified by ITS pid, not by a name
 * that a dev-tree launch ("Electron") shares with every other Electron process.
 */
function frontmostSample() {
	try {
		const asn = execFileSync("lsappinfo", ["front"], {
			encoding: "utf8",
		}).trim();
		if (!asn) return null;
		const info = execFileSync("lsappinfo", ["info", "-only", "pid,name", asn], {
			encoding: "utf8",
		});
		const pid = /"pid"\s*=\s*(\d+)/.exec(info);
		const name = /"(?:LSDisplayName|name)"\s*=\s*"([^"]*)"/.exec(info);
		return { pid: pid ? Number(pid[1]) : null, name: name ? name[1] : null };
	} catch {
		return null;
	}
}

/** Sample the frontmost application for as long as the app runs. */
function startFocusWatch(pid) {
	const samples = [];
	const timer = setInterval(() => {
		const sample = frontmostSample();
		if (sample) samples.push(sample);
	}, 500);
	return {
		samples,
		stop: () => clearInterval(timer),
		ours: () => samples.filter((sample) => sample.pid === pid).length,
	};
}

/** Wait until the renderer's preload has exposed the console namespace: the state
 * file appears before the window's first paint, so everything the renderer does has
 * to wait for it. */
async function waitForRenderer(timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		const ready = await rendererEvaluate(
			"typeof window.api?.console?.state === 'function' ? 'ready' : 'waiting'",
		);
		if (ready === "ready") return;
		if (Date.now() - started > timeoutMs) {
			throw new Error("the renderer never exposed window.api.console");
		}
		await sleep(250);
	}
}

/* ------------------------------------------------------------ the run */

async function main() {
	if (PACKAGED) {
		/*
		 * The scratch tree is created HERE as well as in the app path, and that is not
		 * tidiness: `HOME` points at `HOME_DIR`, the app derives a surface's default
		 * working directory from `homedir()`, and node-pty's `spawn-helper` `_exit(1)`s
		 * when its `chdir` fails. An app launched against a HOME that does not exist
		 * therefore forks a pty whose every child dies with exit status 1 and no output —
		 * which is exactly what this rig measured before this line existed.
		 */
		for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA, OUT_DIR]) {
			mkdirSync(dir, { recursive: true });
		}
		await packagedProof(PACKAGED);
		finish();
		return;
	}

	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(HOME_DIR, { recursive: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(USER_DATA, { recursive: true });
	mkdirSync(OUT_DIR, { recursive: true });

	if (!existsSync(join(ROOT, "out", "main", "index.js"))) {
		throw new Error(
			"no built app: run `pnpm build` first (this rig drives the BUILT app)",
		);
	}

	/*
	 * TRAP 1, in the dev tree: the published tarball's helper arrives 0644, and the
	 * runtime heal is what keeps a delivery that dropped the mode (an in-app update
	 * stages a ZIP, and `codesign`'s seal does not cover modes) from failing at
	 * `posix_spawn`. The mode is RESET here rather than assumed, so the cell proves the
	 * heal ran instead of observing a mode something else already fixed.
	 */
	const devHelper = join(
		ROOT,
		"node_modules",
		"node-pty",
		"prebuilds",
		`darwin-${process.arch}`,
		"spawn-helper",
	);
	const helperPresent = existsSync(devHelper);
	if (helperPresent) chmodSync(devHelper, 0o644);

	app = await launchApp();
	const state = await waitForState();

	// ---- the record and the probe ------------------------------------------
	check(
		"the discovery record carries the console capability",
		state.console === true &&
			state.console_surfaces === 0 &&
			state.console_agent_surfaces === 0,
		{
			console: state.console,
			console_surfaces: state.console_surfaces,
			console_agent_surfaces: state.console_agent_surfaces,
			pid: state.pid,
			proto: state.proto,
		},
	);
	const health = await (
		await fetch(`http://127.0.0.1:${state.port}/health`)
	).json();
	check(
		"/health reports the console capability",
		health.console === true,
		health,
	);

	// ---- the four safety rules, on the console's own methods ---------------
	const noKey = await rpc(state, "console_list", {}, { omitKey: true });
	check("a request with no key is a 401 with no detail", noKey.status === 401, {
		status: noKey.status,
		body: noKey.text,
	});
	const wrongKey = await rpc(state, "console_list", {}, { key: "not-the-key" });
	check("a wrong key is a 401 with no detail", wrongKey.status === 401, {
		status: wrongKey.status,
		body: wrongKey.text,
	});
	const skew = await rpc(state, "console_frobnicate", {});
	check(
		"an unknown console method is a typed version-skew refusal, not a 422",
		skew.status === 200 && skew.json?.error?.code === "unsupported_method",
		{ status: skew.status, body: skew.json },
	);

	// ---- create, read, resize, capture, close ------------------------------
	const created = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-f", "-i"],
		cols: 120,
		rows: 40,
		reveal: "none",
	});
	record("console_create", created);
	check(
		"a surface is born at the grid it was asked for, in the user's home",
		created.cols === 120 && created.rows === 40 && created.live === true,
		created,
	);
	const surface = created.surface;
	check("the handle names its host", SURFACE_HANDLE.test(surface), surface);

	if (helperPresent) {
		// Read the log after the spawn that healed it: the app flushes its own log, and
		// the line is the app saying what it did rather than the file's mode alone.
		await sleep(600);
		const devLog = appLogText();
		check(
			"the runtime restored the helper's exec bit (trap 1)",
			devLog.includes("restored the exec bit") &&
				(statSync(devHelper).mode & 0o777) === 0o755,
			{
				helper: devHelper,
				modeBefore: "0644 (the published tarball's own mode)",
				modeAfter: `0${(statSync(devHelper).mode & 0o777).toString(8)}`,
				logged: devLog.includes("restored the exec bit"),
			},
		);
	}

	// A real program, in a real pty, read from the record with no view present (R7).
	await rpcOk(state, "console_input", {
		surface,
		text: "printf 'marker-424242\\n'\r",
	});
	const read = await readUntil(state, surface, "marker-424242");
	check(
		"console_read answers from the record, with no view present (R7)",
		read.text.includes("marker-424242") &&
			read.cols === 120 &&
			read.rows === 40,
		{ text: read.text, cols: read.cols, rows: read.rows, cursor: read.cursor },
	);

	// The grid reaches the PROCESS: `stty size` is the kernel's own answer, so this
	// is the one cell that proves the resize was more than a number in a record.
	const resized = await rpcOk(state, "console_resize", {
		surface,
		cols: 100,
		rows: 30,
	});
	await rpcOk(state, "console_input", { surface, text: "stty size\r" });
	const stty = await readUntil(state, surface, "30 100");
	check(
		"a resize reaches the pty (one SIGWINCH, and stty agrees)",
		resized.cols === 100 && resized.rows === 30 && stty.text.includes("30 100"),
		{ resize: resized, viewport: stty.text },
	);

	// Keys go through main's encoder, and the surface survives them.
	const keys = await rpcOk(state, "console_keys", {
		surface,
		keys: ["up", "ctrl+c"],
	});
	check(
		"named keys are encoded and accepted",
		keys.accepted === true && keys.encoded.length === 2,
		keys,
	);
	await readUntil(state, surface, "marker-424242");

	// A payload past the bound is refused BEFORE it reaches the pty, so "accepted: 0"
	// is the truth rather than a partial write.
	const flood = await rpc(state, "console_input", {
		surface,
		// Past the host's own bound and comfortably inside the transport's 1 MiB body
		// cap, so the answer is the typed refusal rather than a dropped socket.
		text: "x".repeat(400_000),
	});
	check(
		"an input payload past the bound is refused, naming what it accepted",
		flood.json?.error?.code === "input_queue_full" &&
			flood.json?.error?.data?.accepted === 0,
		flood.json?.error,
	);

	// Bracketed paste is keyed on the record's LIVE mode: the program turns it on by
	// printing the sequence, and the next `paste: true` call must be wrapped.
	await rpcOk(state, "console_input", {
		surface,
		text: "printf '\\033[?2004h'\r",
	});
	const status = await waitForMode(state, surface, "bracketedPaste", true);
	const paste = await rpcOk(state, "console_input", {
		surface,
		text: "pasted",
		paste: true,
	});
	check(
		"paste is bracketed because the record's live mode says so",
		status.modes.bracketedPaste === true &&
			paste.bytes === "pasted".length + 12,
		{ modes: status.modes, bytes: paste.bytes },
	);

	// ---- the capture, through the real preload path ------------------------
	// The pane's own ops are driven through the app's renderer over CDP, which is the
	// supported way to reach a renderer (docs/agent-driver.md) and the only way this
	// harness can report a content rect the way a pane would.
	await waitForRenderer();
	/*
	 * The window observation, independent of the mode this rig named.
	 *
	 * A headless launch CREATES the window and never shows it, so the renderer must
	 * report itself hidden and unfocused. Neither call touches focus — `focus()` is
	 * deliberately absent from this rig, because a peer measured a headless,
	 * windowless agent instance holding the frontmost application for ~8 s and named
	 * `window.focus()` over CDP as the leading (unproven) suspect. Keys reach the pty
	 * through `console_keys`/`console_input` and are read back from the record, so no
	 * cell here needs the window to hold key focus.
	 */
	const windowState = await rendererEvaluate(
		"JSON.stringify({ visibility: document.visibilityState, focused: document.hasFocus() })",
	);
	// `focused === false` is the assertion; `visibility` is recorded rather than
	// asserted, and that is a MEASUREMENT: a never-shown Electron window reports
	// `document.visibilityState === "visible"` (measured here, Electron 44.3.0), so a
	// rig that leaned on it would be asserting the opposite of what it reads as. What
	// this rig relies on for the focus claim is the frontmost sample below, which asks
	// the WindowServer rather than the page.
	check(
		"a headless launch's window never holds key focus (the mode it named)",
		JSON.parse(windowState).focused === false,
		windowState,
	);
	await rendererEvaluate(
		`window.api.console.openPane(${JSON.stringify(surface)})`,
	);
	const reported = await rendererEvaluate(
		`window.api.console.setContentRect(${JSON.stringify(surface)}, ${JSON.stringify(
			{
				contentRect: { x: 20, y: 20, width: 800, height: 400 },
				cellWidth: 8.425,
				cellHeight: 16,
				visible: true,
				theme: "proof",
			},
		)})`,
	);
	check(
		"the renderer reports a rect and main decides the grid from it",
		reported?.displayed_surface === surface,
		reported?.surfaces?.find((entry) => entry.surface === surface) ?? reported,
	);
	const shot = await rpcOk(state, "console_screenshot", { surface });
	const png = Buffer.from(shot.image_base64, "base64");
	const framePath = join(
		OUT_DIR,
		`console-${surface.replace(/[^A-Za-z0-9_-]/g, "_")}.png`,
	);
	writeFileSync(framePath, png);
	record("capture geometry", {
		rendered: shot.rendered,
		cols: shot.cols,
		rows: shot.rows,
		theme: shot.theme,
		live: shot.live,
		bytes: png.length,
		sha256: createHash("sha256").update(png).digest("hex"),
		file: framePath,
	});
	check(
		"a screenshot is the app's own window, cropped to the pane's rect (design 13.2)",
		shot.rendered === "displayed" &&
			shot.cols === 94 &&
			shot.rows === 25 &&
			png.length > 2000,
		{
			rendered: shot.rendered,
			cols: shot.cols,
			rows: shot.rows,
			bytes: png.length,
		},
	);

	// With no pane on it, the frame is refused with the typed gap rather than answered
	// with a photograph of something else. The offscreen capture view is PR B's.
	await rendererEvaluate("window.api.console.closePane()");
	const noPane = await rpc(state, "console_screenshot", { surface });
	check(
		"a capture with no displayed pane is refused, and says which gap it is",
		noPane.json?.error?.code === "capture_unavailable",
		noPane.json,
	);

	// ---- secure input -------------------------------------------------------
	await rpcOk(state, "console_secure", { surface, on: true });
	const secureRead = await rpc(state, "console_read", {
		surface,
		mode: "viewport",
	});
	const secureShot = await rpc(state, "console_screenshot", { surface });
	check(
		"secure input refuses a read and a capture",
		secureRead.json?.error?.code === "secure_input_active" &&
			secureShot.json?.error?.code === "secure_input_active",
		{ read: secureRead.json?.error, screenshot: secureShot.json?.error },
	);
	await rpcOk(state, "console_secure", { surface, on: false });

	// ---- typed refusals -----------------------------------------------------
	const missing = await rpc(state, "console_status", {
		surface: "con:99:nope",
	});
	check(
		"an unknown handle names the handle and how many exist",
		missing.json?.error?.code === "surface_unavailable" &&
			typeof missing.json?.error?.data?.count === "number",
		missing.json?.error,
	);
	const badGrid = await rpc(state, "console_resize", {
		surface,
		cols: 10,
		rows: 30,
	});
	check(
		"an out-of-range grid is refused with the clamp it would have applied",
		badGrid.json?.error?.code === "invalid_grid" &&
			badGrid.json?.error?.data?.clamp?.cols === 40,
		badGrid.json?.error,
	);
	const badKey = await rpc(state, "console_keys", {
		surface,
		keys: ["page-down"],
	});
	check(
		"an unknown key lists what is accepted",
		badKey.json?.error?.code === "unknown_key" &&
			Array.isArray(badKey.json?.error?.data?.accepted),
		badKey.json?.error,
	);

	// ---- a process that exits ----------------------------------------------
	const quick = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-c", "printf 'exited-marker\\n'; exit 5"],
		cols: 80,
		rows: 24,
		sizing: "fixed",
	});
	const exited = await waitForExit(state, quick.surface, 5);
	check(
		"a surface's process exit is observed once, with its code",
		exited.running === false && exited.exit_code === 5,
		exited,
	);
	const afterExit = await rpc(state, "console_read", {
		surface: quick.surface,
		mode: "viewport",
	});
	check(
		"an exited surface still reads, and reads as live rather than as history",
		afterExit.json?.ok === true &&
			afterExit.json.result.text.includes("exited-marker") &&
			afterExit.json.result.live === true,
		afterExit.json?.result,
	);
	const inputAfterExit = await rpc(state, "console_input", {
		surface: quick.surface,
		text: "x",
	});
	check(
		"input to an exited surface is a typed refusal carrying the code",
		inputAfterExit.json?.error?.code === "process_exited" &&
			inputAfterExit.json?.error?.data?.exit_code === 5,
		inputAfterExit.json?.error,
	);

	// ---- retention ----------------------------------------------------------
	const retained = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-c", "printf 'retained-marker\\n'; sleep 0.3"],
		retain: true,
	});
	await waitForExit(state, retained.surface, 0);
	await rpcOk(state, "console_close", { surface: retained.surface });
	const historyFile = join(
		HISTORY_DIR,
		SESSION,
		`${retained.surface.replace(/[^A-Za-z0-9_-]/g, "_")}.log`,
	);
	const existed = existsSync(historyFile);
	check(
		"a retained surface's bytes are on disk, 0600, and say what it printed",
		existed &&
			(readFileSync(historyFile).toString("utf8").includes("retained-marker") ||
				readFileSync(`${historyFile.slice(0, -4)}.json`)
					.toString("utf8")
					.includes(retained.surface)),
		{
			file: historyFile,
			mode: existed ? statSync(historyFile).mode & 0o777 : null,
		},
	);
	if (existed) {
		check(
			"the retained history is 0600",
			(statSync(historyFile).mode & 0o777) === 0o600,
			{ mode: (statSync(historyFile).mode & 0o777).toString(8) },
		);
	}

	// ---- the caps -----------------------------------------------------------
	// Up to the cap rather than eight more: the session already holds the surfaces
	// this run made, and the cap counts SURFACES rather than running processes.
	const held = (
		await rpcOk(state, "console_list", { session_id: SESSION })
	).surfaces.filter((entry) => entry.agent_owned).length;
	const made = [];
	for (let index = held; index < 8; index += 1) {
		made.push(
			await rpcOk(state, "console_create", {
				session_id: SESSION,
				command: "/bin/sh",
				args: ["-c", "sleep 3"],
			}),
		);
	}
	const ninth = await rpc(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-c", "sleep 3"],
	});
	check(
		"the ninth agent surface in one session is refused, with the browser's own code",
		ninth.json?.error?.code === "tab_limit" &&
			ninth.json?.error?.data?.scope === "session" &&
			ninth.json?.error?.data?.limit === 8,
		{ heldBefore: held, created: made.length, refusal: ninth.json?.error },
	);

	// ---- close --------------------------------------------------------------
	const closed = await rpcOk(state, "console_close", { surface, kill: true });
	check(
		"closing a running surface signals it, learns its exit code and answers",
		closed.closed === true,
		closed,
	);
	const listed = await rpcOk(state, "console_list", { session_id: SESSION });
	record("console_list after the close", listed);
	check(
		"a closed surface is gone from the listing",
		listed.surfaces.every((entry) => entry.surface !== surface),
		{ count: listed.count },
	);
	// The focus sample, reported with its numbers: this rig named `headless`, the
	// window above is hidden, and the observations say whether the app took the
	// operator's front anyway. A peer's machine-wide watch measured that happening
	// with no window at all, so this reads the WindowServer rather than assuming.
	const watch = app?.watch;
	check(
		"the run never held the operator's frontmost application",
		(watch?.ours() ?? 0) === 0,
		{
			samples: watch?.samples.length ?? 0,
			frontmostOurs: watch?.ours() ?? 0,
			distinct: [
				...new Set((watch?.samples ?? []).map((sample) => sample.name)),
			].slice(0, 8),
		},
	);

	const appLog = appLogText();
	check(
		"the app log carries events, never terminal content (design 11.6.1)",
		appLog.includes("[console] surface") && !appLog.includes("marker-424242"),
		{
			lines: appLog
				.split("\n")
				.filter((line) => line.includes("[console]"))
				.slice(0, 12),
		},
	);

	finish();
}

/** Wait until a surface reports the mode the program set. */
async function waitForMode(state, surface, key, value, timeoutMs = 15_000) {
	const started = Date.now();
	let last = null;
	while (Date.now() - started < timeoutMs) {
		last = await rpcOk(state, "console_status", { surface });
		if (last.modes?.[key] === value) return last;
		await sleep(200);
	}
	throw new Error(
		`the record never reported ${key}=${String(value)}: ${JSON.stringify(last?.modes)}`,
	);
}

async function waitForExit(state, surface, code, timeoutMs = 20_000) {
	const started = Date.now();
	let last = null;
	while (Date.now() - started < timeoutMs) {
		last = await rpcOk(state, "console_status", { surface });
		if (last.running === false && last.exit_code === code) return last;
		await sleep(200);
	}
	throw new Error(
		`${surface} never exited with ${code}: ${JSON.stringify(last)}`,
	);
}

function finish() {
	const reaped = reapConsoleHostProof();
	const summary = [
		PACKAGED
			? "# Console host: packaged-tree proof (P13)"
			: "# Console host end-to-end proof",
		"",
		`Scratch: \`${SCRATCH}\``,
		`Result: ${failures === 0 ? "every check passed" : `${failures} check(s) FAILED`}`,
		`Reaped stray spawn-helper processes: ${reaped}`,
		"",
		transcript.join("\n"),
	].join("\n");
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(join(OUT_DIR, "proof.md"), summary);
	say(`\ntranscript: ${join(OUT_DIR, "proof.md")}`);
	say(`frames: ${OUT_DIR}`);
	if (failures > 0) process.exitCode = 1;
}

main()
	.catch(async (error) => {
		console.error("proof run failed:", error);
		mkdirSync(OUT_DIR, { recursive: true });
		writeFileSync(
			join(OUT_DIR, "proof.md"),
			`# Console host end-to-end proof\n\nFAILED: ${error?.stack ?? error}\n\n${transcript.join("\n")}`,
		);
		process.exitCode = 1;
	})
	.finally(async () => {
		// A failed run must not leave an app behind holding a state file and a pty.
		await stopApp();
		if (!KEEP && !PACKAGED) {
			// The scratch tree is this run's own, under the system temp dir: removing it
			// is the "do not leave a sandbox behind" rule, and nothing outside it is
			// touched.
			rmSync(SCRATCH, { recursive: true, force: true });
		} else {
			console.log(`kept: ${SCRATCH}`);
		}
	});
