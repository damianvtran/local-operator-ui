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
 * PRECONDITION, STATED BECAUSE A RUN THAT HIDES IT IS A DEAD INSTRUMENT (QA round 4's Q-10):
 * the pane cells — the console trigger, the mounted pane, and the displayed capture — need the
 * app PAIRED with a backend, because the chat route renders no conversation header without one.
 * Pairing a backend is outside this rig's reach (the API base is baked into the bundle, and the
 * daemon that answers it is the operator's own), so a run without one does not fail and does
 * not pretend: those cells are reported as BLOCKED with this reason, every other cell still
 * runs, and the run EXITS NON-ZERO with the counts it actually reached.
 *
 * Usage:
 *   node scripts/console-host-proof.mjs [--keep] [--out <dir>]
 *   node scripts/console-host-proof.mjs --packaged "/Applications/Local Operator.app"
 *   node scripts/console-host-proof.mjs --pair <port>
 *
 * `--pair <port>` LETS THIS RIG SUPPLY THE PRECONDITION THE PANE CELLS NEED, by
 * standing up a daemon it owns and handing the app that daemon's own serve record.
 * The app discovers it in this run's scratch config root and pairs through the same
 * claim route it uses for a daemon the operator started (`attach-frame-evidence.mjs`
 * is the committed proof of that route). The tree must be BUILT for the same
 * address, because the renderer's copy is inlined at build time:
 *
 *     VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> pnpm build
 *
 * Without this flag the pane cells block exactly as before (no backend to serve a
 * conversation) and every other cell still runs; with it, a run from a clean
 * profile is a full pass. The port is refused at 1111, the operator's own daemon,
 * and the daemon runs with this run's scratch HOME/config/logs, so nothing it does
 * can reach the operator's state.
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
import { withTelemetryOff } from "./telemetry-off.mjs";

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const PACKAGED = argValue("--packaged");
/** The port `--pair` names for this run's own daemon; refused at 1111 (the
 * operator's own) and validated in `main`. */
const PAIR_PORT = argValue("--pair");
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
/*
 * The one `file:` page on the debugging port that is NOT the app's window.
 *
 * THE CAPTURE VIEW IS A SECOND RENDERER (design 13.2/13.3): a hidden `BrowserWindow`
 * that replays a record to be photographed, created lazily by the first
 * `console_screenshot` with no pane displaying the surface. It is therefore also a
 * `type: "page"` target on the debugging port, and it appears BEFORE the app's own
 * window in the list — so a rig that picked the first `file:` page silently drove the
 * capture view instead. That is not a harmless wrong address: the capture view is
 * deliberately not an authorized console client, and the app refuses its IPC with
 * "This window cannot use the console" — which is what this rig reported, at the cell
 * that opens the pane AFTER the first screenshot, until this filter existed.
 *
 * THE MATCH IS POSITIVE AND NAMES THE APP'S OWN DOCUMENT rather than excluding the
 * capture view by name: the rig wants the window that serves the app, and a page that
 * is neither is not one this rig has any business driving. The port also carries the
 * browser host's tab views as `about:blank` pages, and a negative list would have to
 * grow every time another renderer joins the app.
 */
/*
 * THE APP'S OWN DOCUMENT, matched on the URL's PATHNAME rather than on the whole
 * string — and the difference is the blocker QA round 1 measured (Q-1).
 *
 * The app's router is a `HashRouter` (`src/renderer/src/main.tsx`), so a MOUNTED app
 * is at `file:///…/renderer/index.html#/chat`. The anchored `/\/index\.html$/` this
 * replaced never matched that, and it matched only the case where the renderer had
 * NOT mounted (no hash yet) — which is precisely the mis-built artifact of that
 * round. The rig therefore worked against a blank window and failed against a real
 * one: `no renderer target on the debugging port` at 9.6 s, twice, on every
 * correctly built tree.
 *
 * The capture view is excluded BY NAME for the same reason it has to be: it is also
 * a `file:` URL ending in `.html`, and (being a renderer) it can appear on the same
 * port, so a matcher that accepted it would let the rig drive a reconstruction
 * nobody is looking at instead of the app's window.
 */
const APP_DOCUMENT = (url) => {
	try {
		const path = new URL(url).pathname;
		return path.endsWith("/index.html") && !path.includes("console-capture");
	} catch {
		// A target whose URL will not parse (an `about:blank` between navigations) is
		// not the app's document.
		return false;
	}
};
const SURFACE_HANDLE = /^con:\d+:[A-Za-z0-9_-]+$/;
const PLIST_EXECUTABLE =
	/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/;
const PS_LINE = /^\s*(\d+)\s+(.*)$/;

/*
 * HOW LONG THE RIG WAITS FOR THE APP, in one number.
 *
 * The default stays where the rig put it, because a bound is a claim about the app
 * and loosening it for everyone would hide a slow boot. But the app's boot is not
 * only the app's: this repo is worked through ~20 concurrent worktrees, and a fleet
 * at load 200+ stretches a 10-second boot past a minute — measured here, on this
 * machine, where the console host was ready 65 s after launch and the rig's own 60 s
 * bound had already fired. `--wait-ms <ms>` (or `--wait-ms=<ms>`, or
 * `LOCAL_OPERATOR_UI_PROOF_WAIT_MS`) raises it for one run, which is the difference
 * between "the app is broken" and "the fleet is busy"; nothing else about the run
 * changes.
 */
const WAIT_MS = (() => {
	/*
	 * BOTH SPELLINGS, because the two are indistinguishable to a reader and only one
	 * of them works: this rig's own `argValue` takes the SPACE-separated form, while
	 * the repo's other rigs (`capture-evidence.mjs`) take `--flag=<value>`. A run that
	 * wrote `--wait-ms=300000` therefore silently got the default and failed with a
	 * message about a state file — which is exactly what happened while writing this.
	 * `--wait-ms=missing` is refused too: a flag whose value is absent must not read
	 * as "use the default".
	 */
	const equals = argv.find((entry) => entry.startsWith("--wait-ms="));
	const raw =
		(equals === undefined ? undefined : equals.slice("--wait-ms=".length)) ||
		argValue("--wait-ms") ||
		process.env.LOCAL_OPERATOR_UI_PROOF_WAIT_MS;
	if (raw === undefined) return null;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(
			`--wait-ms / LOCAL_OPERATOR_UI_PROOF_WAIT_MS must be a positive whole number of milliseconds, got ${JSON.stringify(raw)}`,
		);
	}
	return value;
})();
/** The bound for one wait: the caller's own, or this run's override, or the rig's
 * own default. Named so every wait site reads the same way. */
const bounded = (own, fallback) => WAIT_MS ?? own ?? fallback;

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
/*
 * A CANONICAL SESSION ID, twelve lowercase hex characters, because the app's own parser
 * validates the shape before it will honour it (`src/shared/open-session.ts`'s
 * `SESSION_ID`) and treats anything else as ABSENT. The first version of this rig used a
 * readable name, which is why the pane could not be mounted: `--open-session=proof-session`
 * validated to nothing, the window opened on the catalogue, and the run's own diagnostic
 * showed `activeSessionId: null` with no `console-pane` element in the DOM (Q-5).
 *
 * A `let`, because `--pair` REPLACES it with the id of the conversation this run seeds
 * into its own daemon: the app shows the conversation the DAEMON knows, and the console
 * surfaces this rig creates have to belong to that same id.
 */
let SESSION = "abcdef012345";

const transcript = [];
let failures = 0;
/** How many cells were ASKED, so a run that stopped early cannot report a total it never
 * reached (Q-10: 27 of 45 cells never ran and the summary could not say so). */
let checks = 0;
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

/**
 * A CELL THAT COULD NOT RUN, which is neither a pass nor a failure.
 *
 * WHY IT EXISTS (QA round 4's Q-10): this rig reported "45 PASS / 0 FAIL" on a machine whose
 * daemon happened to be running, and QA's clean-state run of the same command gave 17 PASS,
 * 1 FAIL and a crash — 27 cells never ran, and the run's own summary could not say so. A
 * precondition that is silently assumed is the shape this repository's AGENTS.md names: a
 * dead instrument returns a reading, not an error. So a blocked cell is COUNTED, PRINTED and
 * makes the run exit non-zero, and the summary names the precondition rather than the number
 * of cells that happened to be reachable.
 */
const blockedCells = [];
function blocked(label, reason, detail) {
	blockedCells.push({ label, reason });
	transcript.push(
		`\n## BLOCKED — ${label}\n\n${reason}\n\n\`\`\`\n${JSON.stringify(detail, null, 2)}\n\`\`\`\n`,
	);
}

function check(label, ok, detail) {
	checks += 1;
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
		"the packaged app forks a real pty and reads it back (P11, UNSIGNED --dir build)",
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

/* --------------------------------------------------------- the paired daemon */

/**
 * This run's own daemon (`--pair <port>`), or null.
 *
 * WHY THE RIG STARTS ONE AT ALL, when its docstring used to say pairing was
 * outside its reach: the pane cells need a conversation the APP can read, and an
 * app reads conversations from a backend it is paired with. `--pair` makes this
 * run supply that backend instead of hoping the machine has one: a `lop serve`
 * child on this run's own scratch HOME/config/logs, whose own serve record the
 * app discovers in the same scratch config root - the claim route a daemon
 * started by a TUI uses, and the route `attach-frame-evidence.mjs` already runs
 * in CI. The operator's daemon (1111) is refused rather than borrowed, so a bad
 * argument cannot point this rig at the live server.
 */
let daemon = null;

/** The conversation this run seeds into its own daemon, so the app has one to
 * show. Returns its id (12 hex characters, the shape the app's launch intent
 * validates). */
function seedPairedConversation() {
	const seeded = execFileSync(
		process.execPath,
		["scripts/seed-paging-session.mjs", CONFIG_DIR, "8", "console close"],
		{ cwd: ROOT, env: { ...process.env, HOME: HOME_DIR }, encoding: "utf8" },
	);
	const { sessionId } = JSON.parse(seeded);
	return sessionId;
}

async function startPairedDaemon(port) {
	/*
	 * THE VALUES THE FLAGS IMPLY, WRITTEN BEFORE THE DAEMON STARTS: a fresh config
	 * root gets no hosting from `--hosting`, and the trap `docs/agent-driver.md`
	 * records - every turn dying in the daemon with HostingNotConfiguredError -
	 * costs a whole pass when it fires. This flow needs no provider at all; the
	 * values are what make the daemon's session and desktop routes normal.
	 */
	writeFileSync(
		join(CONFIG_DIR, "config.yml"),
		"values:\n  hosting: test\n  model_name: mock-model\n",
	);
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${port}`,
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	const child = spawn(
		"lop",
		[
			"serve",
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
			"--hosting",
			"test",
			"--model",
			"mock-model",
		],
		{ env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const record = join(CONFIG_DIR, "run", "serve", `${child.pid}.json`);
	const started = Date.now();
	while (!existsSync(record) && Date.now() - started < 60_000) {
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	if (!existsSync(record)) {
		throw new Error(
			`the paired daemon wrote no serve record in 60 s; its output follows\n${stream.join("").slice(-2000)}`,
		);
	}
	return { child, record, text: () => stream.join("") };
}

async function stopDaemon() {
	if (!daemon) return;
	const stopping = daemon;
	daemon = null;
	await new Promise((resolve) => {
		const killTree = (signal) => {
			try {
				process.kill(-stopping.child.pid, signal);
			} catch {
				try {
					stopping.child.kill(signal);
				} catch {
					/* already dead */
				}
			}
		};
		stopping.child.once("exit", resolve);
		killTree("SIGTERM");
		setTimeout(() => {
			killTree("SIGKILL");
			resolve();
		}, 5000);
	});
}

function pickDevtoolsPort() {
	return 9400 + (process.pid % 400);
}

async function freeDevtoolsPort(timeoutMs = bounded(null, 10_000)) {
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
	/*
	 * `withTelemetryOff`: this rig boots the built app and, with `--packaged`, an
	 * electron-builder bundle of it - two launches, both carrying the live PostHog
	 * project key that the renderer's build inlined. A console run recorded in the
	 * product's own analytics is a user who does not exist. See
	 * `telemetry-off.mjs`.
	 */
	withTelemetryOff(env);
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
			/*
			 * THE CONVERSATION THIS WINDOW EXISTS TO SHOW, through the app's own launch
			 * intent rather than a seeded store (Q-5). This is the same argument a
			 * click-produced window carries (`--open-session=<id>`, `src/shared/open-session.ts`)
			 * and it is what makes the pane mountable at all on a host with no backend to
			 * serve a conversation list: the store's hydration honours the launch intent
			 * over the persisted id, so the first render is already the conversation whose
			 * console this rig photographs.
			 */
			`--open-session=${SESSION}`,
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
 * The app tree's RSS in bytes, summed over its process GROUP.
 *
 * Electron's tree is main plus a renderer, a GPU process and utilities, and the question a
 * memory ceiling asks is about the tree rather than about one of its members. `null` when the
 * tree is gone or `ps` cannot answer, so a missing reading is a missing reading and never a
 * zero that would pass a ceiling.
 */
function appTreeRssBytes(appPid) {
	let out = "";
	try {
		out = execFileSync("ps", ["-ax", "-o", "pgid=,rss="], { encoding: "utf8" });
	} catch {
		return null;
	}
	let total = 0;
	for (const line of out.split("\n")) {
		const [pgid, rss] = line.trim().split(/\s+/);
		if (Number(pgid) === appPid) total += Number(rss) * 1024;
	}
	return total > 0 ? total : null;
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

async function waitForState(timeoutMs = bounded(null, 60_000)) {
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

/*
 * WHAT THE RENDERER IS USED FOR, and what it is deliberately NOT used for: every
 * console operation is DISPATCHED and read back from the record, and the renderer is
 * reached only for the two things that are genuinely its own — reporting a pane's
 * content rect, and opening/closing the pane. No cell clicks the app's interface,
 * drags it, or synthesizes a keystroke into a real window.
 *
 * That is not only about flakiness. A peer measured a rig that pulled the operator's
 * real browser to the front by clicking a browser's own UI through System Events/AX;
 * the console's equivalent would be driving a terminal by clicking it instead of
 * dispatching into the surface. A pty has no need for that — its bytes go through
 * the record — so the trap is named here, where the next author would reach for it.
 */

/**
 * One CDP command against the APP's own document, on the app's own debugging port.
 *
 * Two entry points rather than two implementations: `rendererCall` speaks the protocol,
 * and `rendererEvaluate` is the `Runtime.evaluate` case of it. The second was the only
 * one this rig needed until Q-5, which has to seed the app's persisted store and RELOAD
 * the renderer to mount the pane in a conversation — `Page.*` commands, same plumbing.
 */
async function withRendererSession(work) {
	const list = await (
		await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)
	).json();
	const page = list.find(
		(target) => target.type === "page" && APP_DOCUMENT(target.url),
	);
	if (!page) throw new Error("no renderer target on the debugging port");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let nextId = 1;
	const call = async (method, params = {}) => {
		const id = nextId++;
		const message = await new Promise((resolve, reject) => {
			const onMessage = (event) => {
				const incoming = JSON.parse(event.data);
				if (incoming.id !== id) return;
				socket.removeEventListener("message", onMessage);
				resolve(incoming);
			};
			socket.addEventListener("message", onMessage);
			socket.addEventListener("error", reject, { once: true });
			socket.send(JSON.stringify({ id, method, params }));
		});
		if (message.error) {
			throw new Error(`CDP ${method}: ${message.error.message}`);
		}
		return message.result;
	};
	try {
		return await work(call);
	} finally {
		socket.close();
	}
}

async function rendererCall(method, params = {}) {
	return withRendererSession((call) => call(method, params));
}

/**
 * SEVERAL CALLS ON ONE SESSION, which is not a convenience: CDP's
 * `Page.addScriptToEvaluateOnNewDocument` lives as long as the CONNECTION that registered
 * it, so a helper that opened a socket per call registered the pane-mounting seed and then
 * dropped it before the reload could use it — measured, and the run that found it reported
 * `trigger: false, pane: false` on a `#/chat` route, i.e. the app had booted with no
 * conversation at all. One session for the sequence is what makes the seed survive to the
 * document it is for.
 */
async function rendererCalls(calls) {
	return withRendererSession(async (call) => {
		const results = [];
		for (const { method, params } of calls) {
			results.push(await call(method, params));
		}
		return results;
	});
}

async function rendererEvaluate(expression) {
	const result = await rendererCall("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result?.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text ??
				"the renderer threw",
		);
	}
	return result?.result?.value;
}

/**
 * The pane and its terminal, once both are on screen — or `null` at the bound.
 *
 * Returns the boxes rather than a boolean because the box is what the capture cell below
 * asserts against: the frame is cropped to the pane's own reported rect, so the picture's
 * size has to be the terminal's size, and a cell that only knew "the pane exists" would
 * have no way to tell the pane from the window's top-left corner (which is exactly what it
 * certified before Q-5).
 */
async function waitForConsolePane(timeoutMs = bounded(null, 60_000)) {
	const started = Date.now();
	for (;;) {
		const boxes = await rendererEvaluate(
			`(() => {
				const pane = document.querySelector('[data-tour-tag="console-pane"]');
				const mirror = document.querySelector('[data-tour-tag="console-mirror"]');
				if (!pane || !mirror) return null;
				const a = pane.getBoundingClientRect();
				const b = mirror.getBoundingClientRect();
				if (b.width < 1 || b.height < 1) return null;
				return {
					pane: { x: a.x, y: a.y, width: a.width, height: a.height },
					mirror: { x: b.x, y: b.y, width: b.width, height: b.height },
				};
			})()`,
		).catch(() => null);
		if (boxes) return boxes;
		if (Date.now() - started > timeoutMs) {
			/*
			 * A BOUND THAT REPORTS WHAT IT SAW rather than `null`: "the pane is not
			 * mounted" is not actionable on its own, and the four facts below say which
			 * half is missing — the route (a hash), the pane, the terminal, or the app.
			 */
			return await rendererEvaluate(
				`(() => ({
					failed: true,
					hash: location.hash,
					app: document.getElementById('app')?.childElementCount ?? 0,
					trigger: Boolean(document.querySelector('[data-tour-tag="console-pane-trigger"]')),
					pane: Boolean(document.querySelector('[data-tour-tag="console-pane"]')),
					mirror: Boolean(document.querySelector('[data-tour-tag="console-mirror"]')),
					slot: Boolean(document.querySelector('[data-tour-tag="console-pane-slot"]')),
					viaDomClick: window.__consoleProofDomClick ?? null,
					openedByPress: null,
					tourTags: [...document.querySelectorAll('[data-tour-tag]')]
						.map((el) => el.getAttribute('data-tour-tag'))
						.slice(0, 40),
					stored: (window.localStorage.getItem('canonical-sessions-storage') || '').slice(0, 200),
					main: (document.querySelector('main')?.innerText || '').slice(0, 200),
				}))()`,
			).catch((error) => ({ failed: true, diagnostic: String(error) }));
		}
		await sleep(250);
	}
}

/** The console trigger's centre, or `null` while the app has not painted it. */
const TRIGGER_BOX = `(() => {
	const el = document.querySelector('[data-tour-tag="console-pane-trigger"]');
	if (!el) return null;
	const box = el.getBoundingClientRect();
	if (box.width < 1 || box.height < 1) return null;
	return { x: box.x + box.width / 2, y: box.y + box.height / 2, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
})()`;

/**
 * Give the app a conversation of its OWN, then WAIT for its console trigger (Q-10).
 *
 * Two things this replaced, and QA round 3 measured both. The rig used to rely on whatever
 * conversation happened to be in the profile — a run in isolation found an empty session
 * store, the "not paired" banner and no trigger, and the three Q-5 cells failed with it, so
 * the rig's claim was only reproducible when some other state was present. And it read the
 * trigger exactly ONCE, which turns any slow paint into a failed cell.
 *
 * So: the app's own persisted `canonical-sessions-storage` is seeded with the conversation
 * this rig's console belongs to (the same way a returning profile carries one), the renderer
 * reloads, and the trigger is POLLED for. The seed is registered on the SAME CDP session that
 * performs the reload, because `Page.addScriptToEvaluateOnNewDocument` lives only as long as
 * the connection that registered it — a per-call helper dropped it before the reload could
 * use it, which is a mistake this file has now made once and states.
 *
 * Returns the trigger's box, or the failure diagnostic when the bound expires.
 */
async function mountConversation(timeoutMs) {
	return withRendererSession(async (call) => {
		const evaluate = async (expression) => {
			const result = await call("Runtime.evaluate", {
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			if (result?.exceptionDetails) return null;
			return result?.result?.value;
		};
		await call("Page.enable", {});
		await call("Page.addScriptToEvaluateOnNewDocument", {
			source: `try { window.localStorage.setItem("canonical-sessions-storage", ${JSON.stringify(
				JSON.stringify({
					state: { activeSessionId: SESSION, activeDraftKey: null },
					version: 0,
				}),
			)});
			/*
			 * THE FIRST-RUN WIZARD, MARKED DONE, and it is not this rig's subject: it is a
			 * MODAL, and a modal swallows every press and sits in front of every frame. A
			 * paired daemon on a scratch config is a first-run user by construction, so
			 * without this flag the pane cells photograph the wizard instead of the pane
			 * (measured 2026-10-02: "Connect a model provider" was the first role=dialog
			 * element in the DOM, and every dialog read found it). The shape is
			 * renderer-driver.mjs's seedOnboardingComplete, key and all.
			 */
			window.localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) {}`,
		});
		await call("Page.reload", { ignoreCache: false });
		const started = Date.now();
		for (;;) {
			const box = await evaluate(TRIGGER_BOX).catch(() => null);
			if (box) return box;
			if (Date.now() - started > timeoutMs) {
				return await evaluate(
					`(() => ({
						failed: true,
						hash: location.hash,
						app: document.getElementById('app')?.childElementCount ?? 0,
						trigger: Boolean(document.querySelector('[data-tour-tag="console-pane-trigger"]')),
						stored: (window.localStorage.getItem('canonical-sessions-storage') || '').slice(0, 200),
						main: (document.querySelector('main')?.innerText || '').slice(0, 200),
					}))()`,
				).catch((error) => ({ failed: true, diagnostic: String(error) }));
			}
			await sleep(250);
		}
	});
}

/**
 * The element's own `click()`, for the pane's own controls.
 *
 * Measured above (the pane cells): a compositor press does not reach a window that is
 * never shown, and the element's own `click()` is the path that runs; `openedByPress`
 * records which one did where that matters.
 */
const pressDom = (selector) =>
	rendererEvaluate(
		`(() => { const el = document.querySelector('${selector}'); if (!el) return false; el.click(); return true; })()`,
	);

/** Put the keyboard into a control the way a keyboard user arrives at it, so a removal
 * cell can observe where the pane hands the keyboard afterwards. `focus()` alone does
 * not arm `:focus-visible`; the `focusVisible` option does, which is the state the
 * ring frame photographs (Chromium honours it). */
const focusDom = (selector) =>
	rendererEvaluate(
		`(() => { const el = document.querySelector('${selector}'); if (!el) return false; el.focus({ focusVisible: true }); return document.activeElement === el; })()`,
	);

/** Which row's tab the keyboard is in right now, off the live document. */
const focusedSurface = () =>
	rendererEvaluate(`(() => {
		const active = document.activeElement;
		if (!active) return null;
		const row = active.closest ? active.closest('[data-surface]') : null;
		if (row) return row.getAttribute('data-surface');
		return active.tagName.toLowerCase();
	})()`);

/** A real Enter through Chromium's own input pipeline. Unlike a press, a KEY event
 * reaches the never-shown window (measured, review round 2), and on a focused button
 * it fires the platform's own activation - which is what lets the close run as a
 * keyboard user's, so the app's own focus writes carry the keyboard heuristic and
 * the landing paints its ring with no device of the rig's. */
const pressEnter = async () => {
	await withRendererSession((call) =>
		call("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
			text: "\r",
		}),
	);
	await sleep(60);
	await withRendererSession((call) =>
		call("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
		}),
	);
};

/** The close control's reveal, focus state and RING GEOMETRY against the strip's own
 * clip (design round 1, D2: a `focus-visible` outline 3px beyond a 28px button that
 * sits in a `px-2 py-1` scrolling strip is exactly how a ring gets trimmed). */
const closeFocusReading = (surface) =>
	rendererEvaluate(`(() => {
		const row = document.querySelector('[data-surface="${surface.replace(/"/g, '\\"')}"]');
		const close = row ? row.querySelector('[data-tour-tag="console-surface-close"]') : null;
		const strip = document.querySelector('[role="tablist"]');
		if (!close || !strip) return null;
		const box = close.getBoundingClientRect();
		const clip = strip.getBoundingClientRect();
		const style = getComputedStyle(close);
		const reach = (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0);
		return {
			focused: document.activeElement === close,
			focusVisible: close.matches(':focus-visible'),
			opacity: style.opacity,
			outline: style.outlineStyle + ' ' + style.outlineWidth + ' offset ' + style.outlineOffset,
			ring: { top: box.top - reach, bottom: box.bottom + reach, left: box.left - reach, right: box.right + reach },
			clip: { top: clip.top, bottom: clip.bottom, left: clip.left, right: clip.right },
			fits: box.top - reach >= clip.top && box.bottom + reach <= clip.bottom && box.left - reach >= clip.left && box.right + reach <= clip.right,
		};
	})()`);

/** The successor TAB's ring, read the way `closeFocusReading` reads the control's: the
 * tab carries no outline utility of its own (`console-pane.tsx`), so `index.css`'s
 * global focus-visible rule applies - 2px at a 2px offset, a 4px reach whose outer box
 * sits flush against the strip's clip (measured: 72 vs 72, 0px of margin, nothing
 * trimmed). The landing cell asserts it (design round 2, D6). */
const tabRingReading = (surface) =>
	rendererEvaluate(`(() => {
		const row = document.querySelector('[data-surface="${surface.replace(/"/g, '\\"')}"]');
		const tab = row ? row.querySelector('[role="tab"]') : null;
		const strip = document.querySelector('[role="tablist"]');
		if (!tab || !strip) return null;
		const box = tab.getBoundingClientRect();
		const clip = strip.getBoundingClientRect();
		const style = getComputedStyle(tab);
		const reach = (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0);
		return {
			isTab: document.activeElement === tab,
			focusVisible: tab.matches(':focus-visible'),
			outline: style.outlineStyle + ' ' + style.outlineWidth + ' offset ' + style.outlineOffset,
			reach,
			ring: { top: box.top - reach, bottom: box.bottom + reach, left: box.left - reach, right: box.right + reach },
			clip: { top: clip.top, bottom: clip.bottom, left: clip.left, right: clip.right },
			fits: box.top - reach >= clip.top && box.bottom + reach <= clip.bottom && box.left - reach >= clip.left && box.right + reach <= clip.right,
		};
	})()`);

/** A pointer MOVE at a control's centre through Chromium's own input pipeline - the
 * same path measured above NOT to reach a never-shown window for presses; whether a
 * move does is what this returns. */
const hoverDom = async (selector) => {
	const point = await rendererEvaluate(
		`(() => { const el = document.querySelector('${selector}'); if (!el) return null; const box = el.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`,
	);
	if (!point) return null;
	await withRendererSession((call) =>
		call("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: point.x,
			y: point.y,
		}),
	);
	await sleep(220);
	return rendererEvaluate(
		`(() => { const el = document.querySelector('${selector}'); if (!el) return null; return { hovered: el.matches(':hover'), opacity: getComputedStyle(el).opacity }; })()`,
	);
};

/** The strip's rows as the live DOM has them: each close control's accessible name,
 * computed opacity (the reveal) and box. A reader for the #754 cells, both of which
 * (the close block and the restart block) call it. */
const rowsReading = () =>
	rendererEvaluate(`(() => {
		return [...document.querySelectorAll('[data-surface]')].map((row) => {
			const close = row.querySelector('[data-tour-tag="console-surface-close"]');
			const box = close ? close.getBoundingClientRect() : null;
			return {
				surface: row.getAttribute('data-surface'),
				label: close ? close.getAttribute('aria-label') : null,
				opacity: close ? getComputedStyle(close).opacity : null,
				width: box ? box.width : null,
				height: box ? box.height : null,
				/*
				 * The keyboard question, read off the element: a real button is in the tab order
				 * and activates on Enter/Space by the platform's own behaviour, which is what
				 * "ready for keyboard" means; a div with a click handler would answer neither,
				 * and the next cell would name it.
				 */
				tag: close ? close.tagName.toLowerCase() : null,
				tabIndex: close ? close.tabIndex : null,
			};
		});
	})()`);

/** Which row the strip says is selected, read from the tab the pane marks
 * `aria-selected` — the same fact the eye reads, not a store value, so the cells
 * below assert what a user sees rather than what the pane believes. */
const selectedSurface = () =>
	rendererEvaluate(`(() => {
		const tab = document.querySelector('[data-surface] [role="tab"][aria-selected="true"]');
		return tab ? tab.closest('[data-surface]').getAttribute('data-surface') : null;
	})()`);

/** The close question as the DOM has it (Radix's portal included).
 *
 * FOUND BY ITS CONFIRM ACTION, not as the first `role="dialog"`: the app can have
 * other dialogs up (a first-run wizard is one), and a reader that took whichever
 * dialog was first reported the wrong text and made "the question is gone" fail
 * on a dialog that was never the close question. */
const questionReading = () =>
	rendererEvaluate(`(() => {
		const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
			(candidate) => candidate.querySelector('[data-confirm-action]'),
		);
		if (!dialog) return null;
		return {
			text: (dialog.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
			cancel: Boolean(dialog.querySelector('[data-cancel-action]')),
			confirm: Boolean(dialog.querySelector('[data-confirm-action]')),
		};
	})()`);

const waitForQuestion = async (timeoutMs = 10_000) => {
	const started = Date.now();
	for (;;) {
		const found = await questionReading().catch(() => null);
		if (found) return found;
		if (Date.now() - started > timeoutMs) return null;
		await sleep(150);
	}
};

const surfacesOf = async (state) =>
	(await rpcOk(state, "console_list", { session_id: SESSION })).surfaces;

/** A surface the USER asked for, through the pane's own `+` control. */
const createUserSurface = async (state) => {
	const before = new Set((await surfacesOf(state)).map((row) => row.surface));
	await pressDom('[data-tour-tag="console-new-surface"]');
	const started = Date.now();
	for (;;) {
		const fresh = (await surfacesOf(state)).find(
			(row) => !before.has(row.surface),
		);
		if (fresh) return fresh.surface;
		if (Date.now() - started > 15_000) {
			throw new Error("the pane's + never produced a user surface");
		}
		await sleep(250);
	}
};

/** The close control's selector for one surface. */
const closeSelectorFor = (surface) =>
	`[data-surface="${surface.replace(/"/g, '\\"')}"] [data-tour-tag="console-surface-close"]`;

/** One close control's accessible name ends with its tablist position (#754, UX
 * round 1 U4): `Close zsh, tab 2 of 4`. Declared once so the label cell and the
 * screen reader agree on the form. */
const CLOSE_LABEL_POSITION = /, tab \d+ of \d+$/;

/** A window-level frame through CDP, for moments the pane's own crop cannot show
 * (the close question is a modal over the whole window, not an xterm frame). */
const captureAppFrame = async (name) => {
	const shot = await withRendererSession((call) =>
		call("Page.captureScreenshot", { format: "png" }),
	);
	const png = Buffer.from(shot.data, "base64");
	const file = join(OUT_DIR, name);
	writeFileSync(file, png);
	record(`frame ${name}`, {
		file,
		bytes: png.length,
		size: pngSize(png),
		viewport: await rendererEvaluate(
			"(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))()",
		),
		sha256: createHash("sha256").update(png).digest("hex"),
	});
};

/** The history file's own name for a surface or session (`history.ts`'s `fileStem`). */
const fileStemOf = (value) => value.replace(/[^A-Za-z0-9_-]/g, "_");

/**
 * A REAL PRESS at a page coordinate, through Chromium's own input pipeline.
 *
 * `Input.dispatchMouseEvent` rather than a synthetic `element.click()`: the pane's trigger
 * is a React control, and a dispatched DOM event is not the same fact as a press the
 * compositor routes — the UX round's own walk was rebuilt on this distinction. Both
 * halves of the click go on one session, because a press without its release leaves the
 * button stuck down for the rest of the run.
 */
async function clickAt(x, y) {
	await rendererCalls([
		{
			method: "Input.dispatchMouseEvent",
			params: { type: "mouseMoved", x, y, button: "none", buttons: 0 },
		},
		{
			// `buttons: 1` IS the one that makes the press land. Measured: without it the
			// compositor delivered a press the page never saw, and the pane did not open —
			// while the element's own `click()` did, which is how the two questions were told
			// apart. `clickCount` and `button` are not enough on their own.
			method: "Input.dispatchMouseEvent",
			params: {
				type: "mousePressed",
				x,
				y,
				button: "left",
				buttons: 1,
				clickCount: 1,
			},
		},
		{
			method: "Input.dispatchMouseEvent",
			params: {
				type: "mouseReleased",
				x,
				y,
				button: "left",
				buttons: 0,
				clickCount: 1,
			},
		},
	]);
}

/** A PNG's own pixel size, read off its IHDR — the picture's dimensions rather than a
 * number the rig was handed. */
const pngSize = (png) => ({
	width: png.readUInt32BE(16),
	height: png.readUInt32BE(20),
});

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
async function waitForRenderer(timeoutMs = bounded(null, 60_000)) {
	const started = Date.now();
	for (;;) {
		let ready = "waiting";
		try {
			ready = await rendererEvaluate(
				"typeof window.api?.console?.state === 'function' ? 'ready' : 'waiting'",
			);
		} catch (error) {
			/*
			 * A WINDOW THAT IS NOT ON THE PORT YET IS WHAT THIS LOOP IS FOR (Q-1).
			 *
			 * The state file appears before the window's first paint, so the ordinary
			 * case one boot in is a target that has not been created — and this used to
			 * throw straight out of the wait, aborting the whole run at 9.6 s with
			 * "no renderer target on the debugging port", which reads like a broken app
			 * and is actually a renderer one poll away. Only that error is tolerated:
			 * anything else (a CDP failure, a throw inside the renderer) is a real
			 * fault and still surfaces immediately rather than being retried into a
			 * timeout.
			 */
			if (!/no renderer target/.test(String(error?.message ?? error))) {
				throw error;
			}
		}
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

	/*
	 * THE PANE CELLS' PRECONDITION, supplied when the run was asked for it
	 * (`--pair <port>`): this rig's own daemon, seeded with one conversation, its
	 * serve record left in this run's scratch config root so the app pairs through
	 * the same claim route a TUI-started daemon uses. Started BEFORE the app,
	 * because discovery happens at boot. 1111 is refused: that is the operator's
	 * own daemon and borrowing it is the thing the isolation exists for.
	 */
	if (PAIR_PORT !== undefined) {
		const port = Number(PAIR_PORT);
		if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
			throw new Error(
				`--pair must name a port, got ${JSON.stringify(PAIR_PORT)}`,
			);
		}
		if (port === 1111) {
			throw new Error("--pair refuses 1111: that is the operator's own daemon");
		}
		mkdirSync(LOG_DIR, { recursive: true });
		SESSION = seedPairedConversation();
		daemon = await startPairedDaemon(port);
		check(
			"--pair supplied a daemon and a conversation for the pane cells",
			existsSync(daemon.record),
			{ port, session: SESSION, record: daemon.record },
		);
	}

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

	// ---- non-ASCII, both directions (the defect a byte-shaped test cannot see) --
	/*
	 * The pty's socket is decoded as UTF-8 by node-pty, so `printf '日本'` arrives as
	 * a decoded string; reading it as latin1 truncated each code point to its low
	 * byte and the loss was SILENT (no error, no `truncated` flag) — every non-ASCII
	 * byte a program printed. `printf 'ABC'` passes either way, which is why nothing
	 * before this cell noticed.
	 *
	 * The command is passed as an ARGV rather than typed into the surface's line
	 * editor, so the cell measures the byte path and not whether a shell in whatever
	 * locale this host runs in chose to keep a multi-byte character.
	 */
	const cjkSurface = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-c", "printf '日本\\n'"],
		cols: 80,
		rows: 24,
		sizing: "fixed",
	});
	const cjkRead = await readUntil(state, cjkSurface.surface, "日本");
	check(
		"non-ASCII output reaches the record intact",
		cjkRead.text.includes("日本"),
		{ text: cjkRead.text.slice(-120) },
	);
	// A character SPLIT ACROSS TWO WRITES is the half a per-chunk decode gets wrong:
	// the three bytes of `日` are written in two reads 300 ms apart, and the record
	// must still hold the character rather than two replacement halves.
	const splitSurface = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-c", "printf '\\346\\227'; sleep 0.3; printf '\\245\\n'"],
		cols: 80,
		rows: 24,
		sizing: "fixed",
	});
	const splitRead = await readUntil(state, splitSurface.surface, "日");
	check(
		"a character split across two pty reads is still one character",
		splitRead.text.includes("日") && !splitRead.text.includes("\ufffd"),
		{ tail: splitRead.text.slice(-120) },
	);

	// INPUT. The same defect ran the other way: a payload was decoded to a string and
	// node-pty re-encoded it as UTF-8, doubling every byte above 0x7F. The program's
	// own file is the witness — `cat` writes exactly what it received.
	const roundTrip = join(OUT_DIR, "input-roundtrip.bin");
	rmSync(roundTrip, { force: true });
	const catcher = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-c", `stty -echo; cat > ${roundTrip}`],
		cols: 80,
		rows: 24,
	});
	await sleep(700);
	await rpcOk(state, "console_input", {
		surface: catcher.surface,
		text: "日本",
	});
	await rpcOk(state, "console_input", {
		surface: catcher.surface,
		bytes: [...Buffer.from("日\n", "utf8")],
	});
	await sleep(900);
	await rpcOk(state, "console_close", { surface: catcher.surface, kill: true });
	await sleep(300);
	const written = existsSync(roundTrip)
		? readFileSync(roundTrip)
		: Buffer.alloc(0);
	const expectedInput = Buffer.concat([
		// The `text` path: the host encodes it once and the pty receives those bytes.
		Buffer.from("日本", "utf8"),
		// The `bytes` path: what the caller sent, unchanged.
		Buffer.from("日\n", "utf8"),
	]);
	check(
		"a non-ASCII payload reaches the program byte for byte, on both paths",
		written.equals(expectedInput),
		{
			expected: expectedInput.toString("hex"),
			got: written.toString("hex"),
			file: roundTrip,
		},
	);

	// Keys go through main's encoder, and the surface survives them.
	const keys = await rpcOk(state, "console_keys", {
		surface,
		keys: ["up", "ctrl+c"],
	});
	check(
		"named keys are encoded and accepted, and `encoded` is the SEQUENCES",
		keys.accepted === true &&
			keys.encoded.length === 2 &&
			keys.encoded[0] === "\u001b[A" &&
			keys.encoded[1] === "\u0003",
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
	 * report itself hidden and unfocused. No call in this rig asks the window to take
	 * focus — that request is what `scripts/window-mode.test.mjs` scans these trees
	 * for, by TEXT, because it is the one call that reaches the operating system and
	 * orders the window. It is absent here for its own reason and not because removing
	 * it fixed a measurement: a peer measured a headless, windowless agent instance
	 * holding the frontmost application for ~8 s and named that call as the leading
	 * suspect, and the suspect was later CLEARED — the instance that took the front
	 * ran a driver whose only focus calls were element-level. So the rule stands on
	 * its own terms (a rig has no business asking for the keyboard) and this rig makes
	 * no claim about that measurement. Keys reach the pty through
	 * `console_keys`/`console_input` and are read back from the record, so no cell here
	 * needs the window to hold key focus.
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
	/*
	 * MOUNT THE PANE, AND LET IT REPORT ITS OWN RECT (Q-5 / D17).
	 *
	 * What this replaced, and why it was a false claim rather than a weak one: the rig
	 * fabricated a rect (`{20, 20, 800, 400}`) and handed it to `console_set_content_rect`,
	 * so main cropped FAITHFULLY to a box the pane was not in. The committed
	 * `displayed-capture.png` was the window's top-left quadrant — the sidebar, "Chats",
	 * "Start a chat" — with no pane in it, certified as "a screenshot is the app's own
	 * window, cropped to the pane's rect". The artifact was honest about the rect and
	 * untrue about the pane, which is the one thing this cell exists to establish.
	 *
	 * So the pane is mounted for real, the way a returning user's profile mounts it: the
	 * app's OWN persisted `canonical-sessions-storage` is seeded with an open conversation
	 * (this host has no isolated backend to serve one, and nothing about the pane, the
	 * terminal or the capture is stubbed by the seed), the renderer reloads, and the pane
	 * is opened through its renderer bridge. From here on the rect main crops to is the one
	 * the PANE reported from its own `ResizeObserver` — this rig never calls
	 * `setContentRect` — and the cell below asserts the PICTURE's size against the
	 * terminal's own box, which is what tells the pane apart from the window's corner.
	 */
	await waitForRenderer();
	/*
	 * THE PANE IS OPENED BY PRESSING ITS TRIGGER, which is the affordance a person uses and
	 * the only thing that mounts the pane: the renderer bridge's `openPane` reports WHICH
	 * surface a pane already shows (it is `host.setDisplayed`, main's half), so a rig that
	 * called it and then photographed the window would be photographing a pane that was
	 * never mounted — which is precisely the hole Q-5 found in the old cell.
	 *
	 * The conversation is this rig's OWN (Q-10, `mountConversation`) and the trigger is waited
	 * for rather than sampled once, so a run from a clean profile is the same run as one in a
	 * profile that happens to carry a conversation.
	 */
	// A FLOOR OF 30 s REGARDLESS OF `--wait-ms`: this wait is a boot plus a navigation
	// rather than a poll of something already up, and a small `--wait-ms` (QA's 20 s, which
	// found this) would otherwise starve the one step that depends on the app having painted.
	/*
	 * THE PRECONDITION IS NAMED, NOT ASSUMED (QA round 4's Q-10).
	 *
	 * This rig's pane cells need a conversation on the chat route, and the chat route renders
	 * one only when the app is PAIRED with a backend — measured: with no pairing the body
	 * carries "This app is not paired with the running Local Operator server", the route is
	 * `#/chat` with an empty session store, and no trigger ever appears; with a pairing it
	 * appears in 1,250 ms. The rig's first version therefore reported 45 PASS / 0 FAIL on a
	 * machine whose daemon happened to be up, and QA's clean-state run of the same command
	 * got 17 PASS, 1 FAIL and a crash — 27 cells never ran.
	 *
	 * PAIRING A BACKEND IS OUTSIDE THIS RIG'S REACH, and that is a judgement rather than a
	 * shrug: the app's API base is baked into the bundle it is built with, the daemon that
	 * answers it is the operator's own, and a rig that stood up a stub and pointed the app at
	 * it would be photographing an app no user runs. So the honest end state is this one: the
	 * cells that need the pane are BLOCKED BY NAME, every other cell still runs, the summary
	 * counts what actually ran, and the run exits non-zero — a partial pass can no longer be
	 * reported as a pass.
	 *
	 * `--pair` SUPPLIES THAT PRECONDITION RATHER THAN FAKING IT (see the header): a real
	 * `lop serve` on this run's own scratch root, its serve record where the app looks for
	 * one, and the same claim route a TUI-started daemon pairs through. The blocked path
	 * above remains for a run without the flag.
	 */
	const mounted = await mountConversation(Math.max(30_000, WAIT_MS ?? 0));
	const paneAvailable = mounted !== null && mounted.failed !== true;
	let boxes = null;
	let shot = null;
	let dpr = 1;
	if (!paneAvailable) {
		blocked(
			"the pane cells (the trigger, the mounted pane, and the displayed capture)",
			"a PAIRED backend. The chat route renders no conversation header without one, so the pane cannot be mounted and this rig cannot photograph it; every other cell in this run does not need it and has run.",
			mounted,
		);
	}
	if (paneAvailable) {
		check(
			"the console trigger is on screen in a conversation's header (Q-5, Q-10)",
			true,
			mounted,
		);
		/*
		 * A page that has STOPPED MOVING before the press, which is the UX round's own
		 * measured step: the trigger is found while the conversation is still settling, and
		 * a press aimed at the box from one frame earlier lands on whatever moved into that
		 * place. Two identical reads a beat apart is the cheap test that the box is stable.
		 */
		let previous = JSON.stringify(mounted.box);
		for (let i = 0; i < 12; i++) {
			await sleep(250);
			const now = await rendererEvaluate(
				`(() => { const el = document.querySelector('[data-tour-tag="console-pane-trigger"]'); if (!el) return null; const b = el.getBoundingClientRect(); return JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }); })()`,
			);
			if (now === previous) break;
			previous = now;
		}
		/*
		 * The pointer probe is guarded, because the box can vanish between the wait and the
		 * read — and a `null` there used to throw out of `elementFromPoint` and take the rest
		 * of the run with it, which is how QA's clean-state run lost 27 cells (Q-10).
		 */
		const under = await rendererEvaluate(
			`(() => {
				const el = document.elementFromPoint(${mounted.x}, ${mounted.y});
				return el ? { tag: el.tagName, tag_: el.getAttribute('data-tour-tag'), closest: Boolean(el.closest('[data-tour-tag="console-pane-trigger"]')) } : null;
			})()`,
		).catch(() => null);
		record("what is under the pointer at the trigger's centre", {
			under,
			triggerAt: mounted,
		});
		await clickAt(mounted.x, mounted.y);
		boxes = await waitForConsolePane();
		/** Whether the compositor's own press opened the pane, or the fallback below did. */
		const openedByPress = !(boxes === null || boxes.failed === true);
		if (!openedByPress) {
			/*
			 * THE PRESS DOES NOT ALWAYS REACH THE PAGE, and in a window that is never shown it
			 * does not: measured, with the pointer verifiably over a settled button. So the pane
			 * is opened with the element's own `click()` — the same handler, reached a way the
			 * compositor does not have to deliver — and WHICH PATH RAN is recorded rather than
			 * implied. (This fallback was lost for one run when the pane section was
			 * restructured for Q-10, which is what a `pressTook` record is for: the run that
			 * lost it failed loudly instead of quietly photographing a window.)
			 */
			await rendererEvaluate(
				`(() => { const el = document.querySelector('[data-tour-tag="console-pane-trigger"]'); window.__consoleProofDomClick = el ? 'clicked' : 'no-trigger'; if (el) el.click(); })()`,
			);
			boxes = await waitForConsolePane(Math.max(15_000, WAIT_MS ?? 0));
		}
		record("how the pane was opened", { pressTook: openedByPress });
		check(
			"the pane is mounted on a conversation and its terminal is on screen (Q-5)",
			boxes !== null && boxes.failed !== true,
			boxes,
		);
		/*
		 * THE THEME IS READ FROM THE APP, not typed here, and that is the fix for a measured
		 * defect: this rig reported `theme: "proof"`, a name no palette answers, so the
		 * capture view wrote `data-theme="proof"`, resolved no role variables at all, and the
		 * offscreen frame came back as xterm's own `#000000`/`#ffffff` with zero
		 * role-coloured pixels. The rig was reporting a theme the app was not wearing, and the
		 * pane's whole claim is that it follows the app's palette.
		 */
		const themeName = await rendererEvaluate(
			"document.documentElement.dataset.theme || ''",
		);
		check(
			"the app is wearing a named theme (the capture view is fed its name)",
			typeof themeName === "string" && themeName.length > 0,
			themeName,
		);
		/*
		 * A beat for the pane's report to reach main before the screenshot: the report is a
		 * `ResizeObserver` callback, so it lands on a frame of its own rather than
		 * synchronously with the mount. Bounded, and the assertion that follows is what
		 * catches a report that never arrived — the frame would come back at the pane's
		 * previous size.
		 */
		await sleep(500);
		shot = await rpcOk(state, "console_screenshot", { surface });
		const png = Buffer.from(shot.image_base64, "base64");
		const framePath = join(
			OUT_DIR,
			`console-${surface.replace(/[^A-Za-z0-9_-]/g, "_")}.png`,
		);
		writeFileSync(framePath, png);
		const size = pngSize(png);
		/*
		 * THE FRAME IS IN PHYSICAL PIXELS AND THE DOM BOX IS IN CSS ONES, which is the
		 * measurement this cell needed and the first version of it got wrong: the frame came
		 * back 1286x1404 against a 659x779.5 box, i.e. exactly the window's device pixel ratio
		 * of 2. `capturePage` returns the photograph at the compositor's scale, so the
		 * comparison is `mirror * dpr`.
		 */
		dpr = await rendererEvaluate("window.devicePixelRatio || 1");
		record("capture geometry", {
			rendered: shot.rendered,
			cols: shot.cols,
			rows: shot.rows,
			theme: shot.theme,
			live: shot.live,
			bytes: png.length,
			frame: size,
			pane: boxes?.pane ?? null,
			mirror: boxes?.mirror ?? null,
			dpr,
			sha256: createHash("sha256").update(png).digest("hex"),
			file: framePath,
		});
		check(
			"a screenshot is the app's own window, cropped to the PANE's rect (design 13.2, Q-5)",
			shot.rendered === "displayed" &&
				boxes !== null &&
				boxes.failed !== true &&
				// The crop is integer-floored and clipped to the window's content bounds
				// (`cropToWindow`), so the tolerance is the rounding, not a slack.
				Math.abs(size.width - boxes.mirror.width * dpr) <= 2 &&
				Math.abs(size.height - boxes.mirror.height * dpr) <= 2 &&
				shot.cols > 0 &&
				shot.rows > 0,
			{
				rendered: shot.rendered,
				cols: shot.cols,
				rows: shot.rows,
				frame: size,
				mirror: boxes?.mirror ?? null,
				dpr,
				bytes: png.length,
			},
		);
	}

	// ---- #754: the per-surface close path -----------------------------------
	/*
	 * The strip's own close control, driven the way the pane's other controls are: the
	 * element's own `click()` (measured above: a compositor press does not reach a
	 * never-shown window, so the DOM path is the one that runs), and the question's buttons
	 * pressed the same way.
	 *
	 * THE SURFACES ARE THE USER'S OWN, created through the pane's `+`, because the two
	 * behaviours under test are origin-dependent: a user's surface is retained (design
	 * 7.2), and that is what lets the restart cells tell a DISMISSAL from a CLOSE — the
	 * close keeps the record for the next launch, the dismissal removes it. An agent's
	 * surface (`retain: false`) erases that difference.
	 */
	let closeCase = null;
	if (paneAvailable) {
		// 1. the affordance: on the row, named for the terminal, revealed by state
		const runningSurface = await createUserSurface(state);
		await pressDom(`[data-surface="${runningSurface}"] [role="tab"]`);
		await sleep(300);
		check(
			"pressing a tab selects it (#754 leaves select-on-click alone)",
			(await selectedSurface()) === runningSurface,
			{ runningSurface, selected: await selectedSurface() },
		);
		/*
		 * THE PANE'S OWN Close console IS NOT THIS CONTROL, and this cell is here to keep
		 * the two apart: the header's closes the PANE and the surface keeps running (design
		 * 6.4) - the sentence #754's row control exists beside. It runs FIRST, on the
		 * running surface the affordance cell then photographs, and the re-open lands the
		 * pane back on that surface's row.
		 */
		await pressDom(
			'[data-tour-tag="console-pane"] [data-tour-tag="console-pane-close"]',
		);
		const paneGoneDeadline = Date.now() + 10_000;
		let paneGone = false;
		while (Date.now() < paneGoneDeadline && !paneGone) {
			paneGone =
				(await rendererEvaluate(
					`Boolean(document.querySelector('[data-tour-tag="console-pane"]'))`,
				)) === false;
			if (!paneGone) await sleep(200);
		}
		const afterPaneClose = await rpcOk(state, "console_status", {
			surface: runningSurface,
		});
		check(
			"the pane's own Close console still closes the PANE, not the surface (design 6.4)",
			paneGone === true && afterPaneClose.running === true,
			{ paneGone, running: afterPaneClose.running },
		);
		await pressDom('[data-tour-tag="console-pane-trigger"]');
		await waitForConsolePane(bounded(null, 30_000));
		await sleep(300);
		const reading = await rowsReading();
		const runningRow = reading.find((row) => row.surface === runningSurface);
		check(
			"the strip's close control is on the row, named for its terminal (#754)",
			typeof runningRow?.label === "string" &&
				runningRow.label.startsWith("Close ") &&
				runningRow.width > 0 &&
				runningRow.height > 0,
			{ runningSurface, reading },
		);
		check(
			"the control is a real button, so a keyboard reaches it (tab order; Enter activates)",
			runningRow?.tag === "button" &&
				typeof runningRow.tabIndex === "number" &&
				runningRow.tabIndex >= 0,
			runningRow,
		);
		check(
			"the active row's control is revealed; an inactive row's waits for hover or focus",
			runningRow?.opacity === "1" &&
				reading.some(
					(row) => row.surface !== runningSurface && row.opacity === "0",
				),
			reading,
		);
		/*
		 * THE NAME IS UNIQUE ON THE STRIP THE RUN ACTUALLY HAS (UX round 1, U4): two shells
		 * made two "Close sh" before the position suffix. Every label is read live and the
		 * set asserted duplicate-free, each carrying its tab position.
		 */
		const labelSet = reading
			.map((row) => row.label)
			.filter((label) => typeof label === "string");
		check(
			"the close controls' accessible names are unique across the strip, each with its tab position (#754, UX round 1 U4)",
			labelSet.length === reading.length &&
				new Set(labelSet).size === labelSet.length &&
				labelSet.every((label) => CLOSE_LABEL_POSITION.test(label)),
			{ labels: labelSet },
		);
		await captureAppFrame("close-affordance.png");
		/*
		 * THE REVEAL'S TWO ARMS (design round 1, D2's unphotographed states), captured
		 * AFTER the affordance frame so the strip it photographs is the pristine one - a
		 * pointer parked on a row for these cells would leave its reveal in every frame
		 * that follows. The hover arm is attempted through Chromium's own input pipeline;
		 * the focus arm is the keyboard's own arrival: `focus({ focusVisible: true })`
		 * reveals the control through `focus-within` and draws the ring the design round
		 * asked to see - whose reach is then MEASURED against the strip's overflow clip,
		 * because a trimmed ring is exactly how the device chip's own D2 went.
		 */
		const inactiveRow = reading.find(
			(row) => row.surface !== runningSurface && typeof row.label === "string",
		);
		if (inactiveRow) {
			const hover = await hoverDom(closeSelectorFor(inactiveRow.surface));
			check(
				"an inactive row's hidden control reveals under the pointer (or the window does not receive pointer moves - the press path's own measured limit)",
				hover === null || hover.hovered === false || hover.opacity === "1",
				{ surface: inactiveRow.surface, hover },
			);
			if (hover?.hovered === true && hover.opacity === "1") {
				await captureAppFrame("close-hover-reveal.png");
			}
			await focusDom(closeSelectorFor(inactiveRow.surface));
			await sleep(150);
			const focusReading = await closeFocusReading(inactiveRow.surface);
			check(
				"focus reveals the hidden control with the ring drawn, and the ring fits inside the strip's clip (#754, design round 1 D2's focus state)",
				focusReading !== null &&
					focusReading.focused === true &&
					focusReading.focusVisible === true &&
					focusReading.opacity === "1" &&
					focusReading.fits === true,
				focusReading,
			);
			await captureAppFrame("close-focus-ring.png");
			await rendererEvaluate(
				"(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()",
			);
			/*
			 * AND THE POINTER IS PARKED OFF THE ROWS, with an assertion that the strip has
			 * gone back to its resting state - EVERY inactive control, not merely one of
			 * them (review round 2, F4: `.some` passes while the pointer still sits on a
			 * row, because three other inactive rows read 0 beside it), so every later
			 * frame in this set photographs a strip nobody is pointing at.
			 */
			await withRendererSession((call) =>
				call("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: 900,
					y: 400,
				}),
			);
			await sleep(220);
			const resting = await rowsReading();
			const restingInactive = resting.filter(
				(row) => row.surface !== runningSurface,
			);
			check(
				"the pointer is parked off the strip and EVERY inactive control waits again (#754's frames after this one hold a strip nobody points at)",
				restingInactive.length > 0 &&
					restingInactive.every((row) => row.opacity === "0"),
				resting,
			);
		}

		// 2. the question, and nothing dead before it is answered
		/*
		 * A DIFFERENT ROW IS SELECTED WHILE THE QUESTION IS ASKED, and it stays selected:
		 * the close control is a SIBLING of the tab (see the row's own note), and this is
		 * the cell that would catch it becoming a child - a press on it must not become a
		 * press on the row it lives beside.
		 */
		const otherSurface = reading.find(
			(row) => row.surface !== runningSurface,
		)?.surface;
		await pressDom(`[data-surface="${otherSurface}"] [role="tab"]`);
		await sleep(200);
		/*
		 * THE CLOSE IS DRIVEN AS A KEYBOARD'S OWN (design round 2, D6): the control is
		 * activated by a real Enter through Chromium's input pipeline - a key event DOES
		 * reach the never-shown window, unlike a press (measured, this round) - so the
		 * app's later handoff write carries the keyboard heuristic and the tab it lands on
		 * paints its ring without any device of the rig's.
		 */
		await focusDom(closeSelectorFor(runningSurface));
		await pressEnter();
		const question = await waitForQuestion();
		check(
			"a running surface's close asks first, in the shared dialog's own copy (#754)",
			typeof question?.text === "string" &&
				question.text.includes("Close this terminal?") &&
				question.text.includes(
					"This ends the program running here and removes its tab.",
				) &&
				/*
				 * AND THE CONDITIONAL REASSURANCE (UX round 1, U6): this surface is a USER's, its
				 * `retain` is on (design 7.2), so the question says the output is kept - the
				 * sentence an agent-owned row must NOT get (the render suite's own cell).
				 */
				question.text.includes("Its output is kept.") &&
				question.cancel === true &&
				question.confirm === true,
			question,
		);
		const statusWhileAsked = await rpcOk(state, "console_status", {
			surface: runningSurface,
		});
		check(
			"the question signals nothing: the surface still runs, and the other row stays selected",
			statusWhileAsked.running === true &&
				(await selectedSurface()) === otherSurface,
			{
				running: statusWhileAsked.running,
				live: statusWhileAsked.live,
				selected: await selectedSurface(),
			},
		);
		await captureAppFrame("close-question.png");

		// 3. Cancel changes nothing
		await pressDom("[data-cancel-action]");
		await sleep(400);
		const afterCancel = await questionReading();
		check(
			"the question's Cancel changes nothing: no dialog, still running, still listed",
			afterCancel === null &&
				(await rpcOk(state, "console_status", { surface: runningSurface }))
					.running === true &&
				(await surfacesOf(state)).some((row) => row.surface === runningSurface),
			{ afterCancel },
		);

		// 4. confirm kills it, and only then
		const historyLog = join(
			HISTORY_DIR,
			fileStemOf(SESSION),
			`${fileStemOf(runningSurface)}.log`,
		);
		check(
			"a retained user surface has history on disk before the close (the restart cell's discriminant)",
			existsSync(historyLog),
			{ historyLog },
		);
		await pressDom(`[data-surface="${runningSurface}"] [role="tab"]`);
		await sleep(200);
		await focusDom(closeSelectorFor(runningSurface));
		await pressEnter();
		const questionAgain = await waitForQuestion();
		check(
			"the question opens again after a cancel (the press is repeatable)",
			questionAgain !== null,
			questionAgain,
		);
		const confirmAt = Date.now();
		/* The confirm is activated the same way; this is the Enter the landing's ring hangs
		 * on - the platform's own activation of a focused button, not a synthetic click. */
		await focusDom("[data-confirm-action]");
		await pressEnter();
		let closedList = await surfacesOf(state);
		const closeDeadline = Date.now() + 20_000;
		while (
			closedList.some((row) => row.surface === runningSurface) &&
			Date.now() < closeDeadline
		) {
			await sleep(250);
			closedList = await surfacesOf(state);
		}
		const closedStatus = await rpc(state, "console_status", {
			surface: runningSurface,
		});
		check(
			"confirming the question kills the surface: gone from the listing, refused by name",
			closedList.every((row) => row.surface !== runningSurface) &&
				closedStatus.json?.error?.code === "surface_unavailable",
			{
				gone: closedList.every((row) => row.surface !== runningSurface),
				status: closedStatus.json,
				elapsedMs: Date.now() - confirmAt,
			},
		);
		/*
		 * THE DEAD LENS, #754's own acceptance clause: the surface that was SELECTED was the
		 * one just closed, so the pane must move to a neighbour - `pickActiveSurface`'s own
		 * fallback - rather than keep a selection that is no longer in the listing.
		 */
		const selectionDeadline = Date.now() + 10_000;
		let selectedAfterClose = await selectedSurface();
		while (
			(selectedAfterClose === null || selectedAfterClose === runningSurface) &&
			Date.now() < selectionDeadline
		) {
			await sleep(200);
			selectedAfterClose = await selectedSurface();
		}
		check(
			"the closed surface's selection moves to a neighbour, never a dead lens (#754)",
			selectedAfterClose !== null && selectedAfterClose !== runningSurface,
			{ closed: runningSurface, selectedAfterClose },
		);
		/*
		 * THE HANDOFF (UX round 1, U1): the dialog closed onto a REMOVED opener - the one
		 * arm the shared primitive cannot answer - so the pane hands the keyboard to the row
		 * that inherited the lens. `<body>` is the failure this cell exists for.
		 */
		let handedOff = null;
		const handoffDeadline = Date.now() + 10_000;
		while (Date.now() < handoffDeadline) {
			handedOff = await focusedSurface();
			if (handedOff === selectedAfterClose) break;
			await sleep(200);
		}
		check(
			"after the close the keyboard is in the lens's row, not on the document body (UX round 1, U1)",
			handedOff === selectedAfterClose,
			{ selectedAfterClose, handedOff },
		);
		/*
		 * THE LANDING'S RING, READ AND ASSERTED (design round 2, D6; QA round 2, Q-1). The
		 * close above was driven from the keyboard, so the app's own handoff write arrived
		 * under the keyboard heuristic and the successor tab's ring is on - `reach` read the
		 * way the sibling focus cell reads the control's. The tab carries no outline utility
		 * of its own, so index.css's global 2px-at-2px rule applies: its outer box sits
		 * flush at the strip's top (72 vs 72 - 0px of margin, nothing trimmed). A ring drawn
		 * flush is still drawn, and the frame says so.
		 */
		const landingRing = await tabRingReading(selectedAfterClose);
		check(
			"the keyboard's landing is armed and visible: the successor tab holds focus, `:focus-visible`, and its ring fits the strip's clip (design round 2, D6)",
			landingRing !== null &&
				landingRing.isTab === true &&
				landingRing.focusVisible === true &&
				landingRing.fits === true,
			landingRing,
		);
		await captureAppFrame("close-closed.png");
		await rendererEvaluate(
			"(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()",
		);
		check(
			"a close keeps a retained surface's history (the dismissal below is what removes it)",
			existsSync(historyLog),
			{ historyLog },
		);
		const afterClose = await questionReading();
		check(
			"the question is gone once it has been answered",
			afterClose === null,
			afterClose,
		);

		// 5. an ended surface dismisses outright, and its history goes with it
		const dismissedSurface = await createUserSurface(state);
		/*
		 * `exit 0` rather than a bare `exit`: THIS HOST's interactive zsh exits 1 on a
		 * typed `exit` with no prior command (measured: `printf 'exit\r' | script -q
		 * /dev/null /bin/zsh -i` answers 1 while /bin/sh answers 0), and the cell's claim
		 * is about the DISMISSAL, not about a shell's exit status. The explicit code is
		 * the one fact the cell needs to be about.
		 */
		await rpcOk(state, "console_input", {
			surface: dismissedSurface,
			text: "exit 0\r",
		});
		const ended = await waitForExit(state, dismissedSurface, 0);
		const dismissedLog = join(
			HISTORY_DIR,
			fileStemOf(SESSION),
			`${fileStemOf(dismissedSurface)}.log`,
		);
		const dismissLabelDeadline = Date.now() + 10_000;
		let dismissLabel = null;
		while (Date.now() < dismissLabelDeadline) {
			dismissLabel =
				(await rowsReading()).find((row) => row.surface === dismissedSurface)
					?.label ?? null;
			if (dismissLabel?.startsWith("Dismiss ")) break;
			await sleep(250);
		}
		check(
			"an ended row's control names the DISMISSAL, not the kill (#754's two states)",
			typeof dismissLabel === "string" && dismissLabel.startsWith("Dismiss "),
			{ dismissLabel, ended },
		);
		check(
			"the ended surface's retained history is on disk before the dismissal",
			existsSync(dismissedLog),
			{ dismissedLog },
		);
		await pressDom(`[data-surface="${dismissedSurface}"] [role="tab"]`);
		await sleep(200);
		/*
		 * The keyboard goes INTO the control first: a pointer press on macOS never moves it
		 * there, so a dismissal pressed that way has nothing to lose - and the handoff cell
		 * below is about the keyboard path, which starts from the control itself.
		 */
		/*
		 * The keyboard goes INTO the control first and ACTIVATES it: the Enter is the
		 * platform's own activation of a focused button (measured this round), so this
		 * dismissal walks the keyboard path end to end - which is also the path whose
		 * handoff cell below is about.
		 */
		await focusDom(closeSelectorFor(dismissedSurface));
		await pressEnter();
		const dismissQuestion = await questionReading();
		check(
			"a dismissal asks nothing (there is no process left to protect)",
			dismissQuestion === null,
			{ question: dismissQuestion },
		);
		let dismissedList = await surfacesOf(state);
		const dismissDeadline = Date.now() + 15_000;
		while (
			dismissedList.some((row) => row.surface === dismissedSurface) &&
			Date.now() < dismissDeadline
		) {
			await sleep(250);
			dismissedList = await surfacesOf(state);
		}
		check(
			"the dismissal removed the surface from the registry AND its history from disk",
			dismissedList.every((row) => row.surface !== dismissedSurface) &&
				!existsSync(dismissedLog),
			{
				gone: dismissedList.every((row) => row.surface !== dismissedSurface),
				historyRemoved: !existsSync(dismissedLog),
				dismissedLog,
			},
		);
		/*
		 * The same dead-lens clause for the OTHER act: a dismissed surface is removed from
		 * the listing too, so a selection still naming it would be the same defect wearing
		 * the dismissal's clothes.
		 */
		const dismissSelectionDeadline = Date.now() + 10_000;
		let selectedAfterDismiss = await selectedSurface();
		while (
			(selectedAfterDismiss === null ||
				selectedAfterDismiss === dismissedSurface) &&
			Date.now() < dismissSelectionDeadline
		) {
			await sleep(200);
			selectedAfterDismiss = await selectedSurface();
		}
		check(
			"the dismissed surface's selection moves to a neighbour too (#754)",
			selectedAfterDismiss !== null &&
				selectedAfterDismiss !== dismissedSurface,
			{ dismissed: dismissedSurface, selectedAfterDismiss },
		);
		/*
		 * The same handoff clause for the dismissal: the acting control is removed while the
		 * keyboard is in it, so the lens's row must take it (UX round 1, U1).
		 */
		let handedOffAfterDismiss = null;
		const dismissHandoffDeadline = Date.now() + 10_000;
		while (Date.now() < dismissHandoffDeadline) {
			handedOffAfterDismiss = await focusedSurface();
			if (handedOffAfterDismiss === selectedAfterDismiss) break;
			await sleep(200);
		}
		check(
			"after the dismissal the keyboard is handed on too, not dropped (UX round 1, U1)",
			handedOffAfterDismiss === selectedAfterDismiss,
			{ selectedAfterDismiss, handedOffAfterDismiss },
		);
		await captureAppFrame("close-dismissed.png");

		/*
		 * 6. THE QUESTION WITHDRAWS WHEN ITS SUBJECT EXITS UNDER IT (UX round 1, U2): an
		 * ended row STAYS listed, so the listing-only rule kept a question whose copy
		 * claimed to end something that had already ended. Nothing is confirmed - the
		 * surface's own shell ends itself through the bridge while the question stands -
		 * and the row must remain (withdrawn is not dismissed).
		 */
		const exitUnderQuestion = await createUserSurface(state);
		await pressDom(`[data-surface="${exitUnderQuestion}"] [role="tab"]`);
		await sleep(200);
		await focusDom(closeSelectorFor(exitUnderQuestion));
		await pressEnter();
		const standingQuestion = await waitForQuestion();
		await rpcOk(state, "console_input", {
			surface: exitUnderQuestion,
			text: "exit 0\r",
		});
		await waitForExit(state, exitUnderQuestion, 0);
		let withdrew = false;
		const withdrawDeadline = Date.now() + 10_000;
		while (Date.now() < withdrawDeadline) {
			withdrew = (await questionReading()) === null;
			if (withdrew) break;
			await sleep(200);
		}
		const exitRow = (await surfacesOf(state)).find(
			(row) => row.surface === exitUnderQuestion,
		);
		check(
			"the question withdraws when the surface exits under it - and the row is dismissed by nobody (still listed, ended) (#754, UX round 1 U2)",
			standingQuestion !== null &&
				withdrew === true &&
				exitRow !== undefined &&
				exitRow.running === false,
			{ standingQuestion, withdrew, exitRow: exitRow ?? null },
		);
		/*
		 * And the keyboard goes back to the row it came from: the question's opener (that
		 * row's own control) is still in the DOM, so the shared primitive's own restore is
		 * the mechanism - this cell is what would catch it regressing silently.
		 */
		let focusedAfterWithdraw = null;
		const withdrawFocusDeadline = Date.now() + 10_000;
		while (Date.now() < withdrawFocusDeadline) {
			focusedAfterWithdraw = await focusedSurface();
			if (focusedAfterWithdraw === exitUnderQuestion) break;
			await sleep(200);
		}
		check(
			"the withdrawn question returns the keyboard to the row it came from (UX round 1, U1's own restore case)",
			focusedAfterWithdraw === exitUnderQuestion,
			{ exitUnderQuestion, focusedAfterWithdraw },
		);

		closeCase = { running: runningSurface, dismissed: dismissedSurface };
	}

	/*
	 * With no pane on it, the frame is a RECONSTRUCTION from the record rather than a
	 * photograph (design 13.2's second row): the capture view replays this surface's
	 * bytes into a fresh terminal in a renderer nobody can see, photographs it with
	 * the DOM renderer pinned, and answers `rendered: "offscreen"` so a consumer can
	 * tell that difference rather than having to trust it.
	 *
	 * THE THREE MEASURED TRAPS ARE ASSERTED HERE, in the live app rather than in a
	 * unit test: the frame is not blank (the design's own 9,866 B stale frame against
	 * a 27,869 B settled one is what the floor discriminates), the renderer is the
	 * DOM one rather than a WebGL canvas whose pixels cannot be read back, and the
	 * grid is the record's. The retry is the capture view's own (§13.3); a run that
	 * needed one says so in its log line, which the rig reads for the `attempt` count.
	 */
	await rendererEvaluate("window.api.console.closePane()");
	const offscreen = await rpcOk(state, "console_screenshot", { surface });
	const offscreenPng = Buffer.from(offscreen.image_base64, "base64");
	const offscreenPath = join(
		OUT_DIR,
		`console-${surface.replace(/[^A-Za-z0-9_-]/g, "_")}-offscreen.png`,
	);
	writeFileSync(offscreenPath, offscreenPng);
	record("offscreen capture", {
		rendered: offscreen.rendered,
		renderer: offscreen.renderer,
		attempts: offscreen.attempts,
		cols: offscreen.cols,
		rows: offscreen.rows,
		bytes: offscreenPng.length,
		sha256: createHash("sha256").update(offscreenPng).digest("hex"),
		file: offscreenPath,
	});
	check(
		"a capture with no displayed pane is a DOM-rendered reconstruction from the record",
		offscreen.rendered === "offscreen" &&
			offscreen.renderer === "dom" &&
			/*
			 * THE RECONSTRUCTION IS AT THE RECORD'S GRID, which is what §13.2 claims, and it
			 * is asserted against the grid the DISPLAYED frame reported rather than against a
			 * number typed here: the old cell pinned 94x25, the size the rig's own synthetic
			 * rect produced, so it was asserting the rig's arithmetic rather than the app's.
			 * The pane now measures its own box, and both frames must agree about the grid
			 * they are pictures of.
			 */
			/*
			 * THE RECONSTRUCTION IS AT THE RECORD'S GRID, and when the pane could not be
			 * mounted (Q-10's precondition) there is no displayed frame to compare it
			 * against: the comparison is the record's own grid, stated as such rather than
			 * skipped silently.
			 */
			offscreen.cols > 0 &&
			offscreen.rows > 0 &&
			(shot === null ||
				(offscreen.cols === shot.cols && offscreen.rows === shot.rows)) &&
			offscreenPng.length > 2000,
		{
			rendered: offscreen.rendered,
			renderer: offscreen.renderer,
			attempts: offscreen.attempts,
			cols: offscreen.cols,
			rows: offscreen.rows,
			displayedGrid: shot ? { cols: shot.cols, rows: shot.rows } : null,
			bytes: offscreenPng.length,
		},
	);

	/*
	 * A FEED IS A FUNCTION OF ONE RECORD (Q-11), and this is the cell an agent's own
	 * evidence depends on: `console_screenshot` is how an agent looks at a TUI, so a frame
	 * that is a union of two surfaces — or the previous surface's content — is worse than
	 * no evidence at all.
	 *
	 * What the offscreen path did before this round: it fed `nonce: attempt` (`1` on the
	 * first attempt of every request), the page keyed the mirror on that number, so a second
	 * request never remounted it and the new bytes were written into the old terminal. QA
	 * measured the result — a 1-line surface captured after an 8-line one came back as both
	 * (212 rows = 192 + 20), a repeat capture appended again (232), and three different
	 * surfaces, one of them with an empty record, returned BYTE-IDENTICAL frames.
	 *
	 * Three surfaces, four captures: DIFFERENT records give different frames, the SAME
	 * record gives the SAME frame, and an empty record is its own frame rather than a copy
	 * of somebody else's.
	 */
	const surfaceWith = async (marker) => {
		const created = await rpcOk(state, "console_create", {
			session_id: SESSION,
			command: "/bin/sh",
			args: ["-c", marker ? `printf '${marker}\n'` : "sleep 0.3"],
			cols: 100,
			rows: 30,
			reveal: "none",
		});
		const surfaceId = created.surface;
		if (marker) await readUntil(state, surfaceId, marker, 20_000);
		else await sleep(600);
		return surfaceId;
	};
	const offscreenSha = async (surfaceId) => {
		const captured = await rpcOk(state, "console_screenshot", {
			surface: surfaceId,
		});
		const bytes = Buffer.from(captured.image_base64, "base64");
		return {
			sha: createHash("sha256").update(bytes).digest("hex"),
			bytes: bytes.length,
			rendered: captured.rendered,
			attempts: captured.attempts,
		};
	};
	const alphaSurface = await surfaceWith(`Q11-ALPHA-${process.pid}`);
	const betaSurface = await surfaceWith(`Q11-BETA-${process.pid}`);
	const emptySurface = await surfaceWith("");
	const alpha1 = await offscreenSha(alphaSurface);
	const beta = await offscreenSha(betaSurface);
	const alpha2 = await offscreenSha(alphaSurface);
	const empty = await offscreenSha(emptySurface);
	record("four captures across three surfaces (Q-11)", {
		alpha1,
		beta,
		alpha2,
		empty,
	});
	check(
		"two surfaces with different records give different frames (Q-11)",
		alpha1.sha !== beta.sha &&
			alpha1.rendered === "offscreen" &&
			beta.rendered === "offscreen",
		{ alpha1, beta },
	);
	check(
		"the SAME record captured twice gives the SAME frame (Q-11)",
		alpha2.sha === alpha1.sha && alpha2.bytes === alpha1.bytes,
		{ alpha1, alpha2 },
	);
	check(
		"an empty record is its own frame, not another surface's (Q-11)",
		empty.sha !== alpha1.sha && empty.sha !== beta.sha,
		{ empty, alphaBytes: alpha1.bytes, betaBytes: beta.bytes },
	);
	// Released before the next cell asks for a surface of its own: a session may run eight at
	// once (§6.3), and a rig that never closes what it opened meets that ceiling instead of its
	// own assertions — which is exactly how the large-record cell first failed.
	for (const spent of [alphaSurface, betaSurface, emptySurface]) {
		await rpcOk(state, "console_close", { surface: spent }).catch(() => {});
	}

	/*
	 * A LARGE RECORD, CAPTURED FIVE TIMES (QA round 4's Q-13).
	 *
	 * The blank-frame verdict used to be a TIMING proxy — "two animation frames after the write
	 * was called" — so a big record could be refused for a reason that had nothing to do with
	 * its content: measured by QA, 3.9-8 MB records came back blank on 1 of 5, 2 of 5 and 1 of 5
	 * back-to-back captures of the SAME surface. The settle is now xterm's own `write`
	 * callback, i.e. the parse rather than a frame count, and this cell is the measurement that
	 * would have caught the old behaviour: five captures of one surface, every one of them the
	 * same frame, none refused.
	 */
	/*
	 * THE ONE DELIBERATE LARGE-RECORD CELL, and its stimulus is a named byte count rather
	 * than a pipeline that runs until something stops it (memory-bounding round). 4 MB
	 * travels through `head | tr | fold | tail` — every stage streams, so the pipeline's own
	 * memory is constant — and the RECORD it leaves is 400 lines of 100 columns (~40 KB),
	 * which is what the capture is a frame of. A routine cell is capped at a few hundred KB;
	 * this one is the exception and says so.
	 */
	const BIG_RECORD_PIPE_BYTES = 4_000_000;
	const bigRecord = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: [
			"-c",
			`head -c ${BIG_RECORD_PIPE_BYTES} /dev/zero | tr '\\0' 'x' | fold -w 100 | tail -n 400`,
		],
		cols: 100,
		rows: 30,
		reveal: "none",
	});
	await readUntil(state, bigRecord.surface, "xxxxxxxxxx", 30_000);
	const bigShots = [];
	for (let i = 0; i < 5; i++) {
		try {
			bigShots.push(await offscreenSha(bigRecord.surface));
		} catch (error) {
			bigShots.push({ refused: String(error?.message ?? error).slice(0, 120) });
		}
	}
	/*
	 * AND THE GENERATOR IS REAPED BEFORE THE NEXT CELL, which is not tidiness: the flood cell
	 * below measures main's responsiveness, and a pty still pushing four megabytes through a
	 * pipeline is CPU the measurement would be paying for. Measured, once: the first version of
	 * this cell left it running and the flood cell's median moved from 4 ms to 116 ms against a
	 * 100 ms ceiling.
	 */
	for (let i = 0; i < 80; i++) {
		// `console_status` is per-SURFACE, and a surface that has been reaped answers with an
		// error rather than a listing — which is the same answer as `live: false` here.
		const entry = await rpcOk(state, "console_status", {
			surface: bigRecord.surface,
		}).catch(() => null);
		if (!entry || entry.live === false) break;
		await sleep(250);
	}
	await rpcOk(state, "console_close", { surface: bigRecord.surface }).catch(
		() => {},
	);
	record("five captures of one large record (Q-13)", bigShots);
	const bigShas = new Set(bigShots.map((shot) => shot.sha ?? shot.refused));
	check(
		"a large record is captured five times, none refused, all five the same frame (Q-13)",
		bigShots.every(
			(shot) => shot.rendered === "offscreen" && shot.bytes > 2000,
		) && bigShas.size === 1,
		bigShots,
	);

	// ---- the grid broadcast (§8.2 step 2(c)) -------------------------------
	/*
	 * A pane learned the grid only from its OWN `console-content-rect` reply, so a grid
	 * an AGENT changed reached no mounted pane at all and the mirror kept painting the
	 * old wrapping and cursor row until a remount. The listener here is the preload's
	 * own subscriber, so what is measured is the whole chain: main's `onChanged` →
	 * `console-state-changed` → a real renderer's listener → a re-read of the state
	 * main owns.
	 */
	await rendererEvaluate(
		`window.api.console.openPane(${JSON.stringify(surface)})`,
	);
	const armed = await rendererEvaluate(`
		(() => {
			window.__consoleStateChanges = 0;
			window.api.console.onStateChanged(() => { window.__consoleStateChanges += 1; });
			return 'armed';
		})()
	`);
	check(
		"the preload exposes a state-change subscriber",
		armed === "armed",
		armed,
	);
	const broadcastResize = await rpcOk(state, "console_resize", {
		surface,
		cols: 110,
		rows: 33,
	});
	await sleep(400);
	const frames = Number(
		await rendererEvaluate("String(window.__consoleStateChanges)"),
	);
	const paneState = await rendererEvaluate("window.api.console.state()");
	check(
		"an agent's resize reaches a mounted pane as a broadcast, not only as its own reply",
		broadcastResize.cols === 110 &&
			frames >= 1 &&
			paneState.surfaces.find((entry) => entry.surface === surface).cols ===
				110,
		{
			frames,
			resize: broadcastResize,
			paneGrid:
				paneState.surfaces.find((entry) => entry.surface === surface) ?? null,
		},
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

	// ---- and what the span must NOT do (§11.4.4) ---------------------------
	/*
	 * "bytes already retained are kept … otherwise turning the toggle on and off would
	 * be a way to erase the log, which is the opposite of what it is for". The live log
	 * and the durable file are asserted separately, because they were the two halves
	 * that disagreed: the switch emptied the log while the file kept the bytes.
	 */
	const locked = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		args: ["-c", "printf 'before-lock\\n'; sleep 30"],
		cols: 80,
		rows: 24,
		retain: true,
	});
	await readUntil(state, locked.surface, "before-lock");
	const lockedLog = join(
		HISTORY_DIR,
		SESSION,
		`${locked.surface.replace(/[^A-Za-z0-9_-]/g, "_")}.log`,
	);
	let beforeToggle = Buffer.alloc(0);
	for (let attempt = 0; attempt < 12; attempt += 1) {
		if (existsSync(lockedLog)) {
			const candidate = readFileSync(lockedLog);
			if (candidate.toString("utf8").includes("before-lock")) {
				beforeToggle = candidate;
				break;
			}
		}
		await sleep(250);
	}
	await rpcOk(state, "console_secure", { surface: locked.surface, on: true });
	const whileSecure = await rpcOk(state, "console_status", {
		surface: locked.surface,
	});
	await rpcOk(state, "console_secure", { surface: locked.surface, on: false });
	const reopened = await rpcOk(state, "console_read", {
		surface: locked.surface,
		mode: "viewport",
	});
	const afterToggle = existsSync(lockedLog)
		? readFileSync(lockedLog)
		: Buffer.alloc(0);
	check(
		"the secure span keeps the bytes already retained, live and on disk (§11.4.4)",
		beforeToggle.length > 0 &&
			whileSecure.truncated === false &&
			reopened.text.includes("before-lock") &&
			afterToggle.subarray(0, beforeToggle.length).equals(beforeToggle),
		{
			bytesBefore: beforeToggle.length,
			bytesAfter: afterToggle.length,
			truncatedWhileSecure: whileSecure.truncated,
			reopenedHoldsMarker: reopened.text.includes("before-lock"),
			file: lockedLog,
		},
	);
	await rpcOk(state, "console_close", { surface: locked.surface, kill: true });

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
		"a surface's process exit is observed once, with its code and its generation",
		exited.running === false &&
			exited.exit_code === 5 &&
			// §10.2 lists `exit_epoch` in `console_status`'s return shape and §7.3
			// makes the retention layer own it: a field the frozen table names but the
			// code never emits is exactly the class of defect this round caught.
			exited.exit_epoch === 1,
		exited,
	);
	// A live surface is generation 0: the counter is a count of EXITS, not a flag.
	const liveStatus = await rpcOk(state, "console_status", { surface });
	check(
		"a surface that has not exited reports generation 0",
		liveStatus.exit_epoch === 0,
		{ exit_epoch: liveStatus.exit_epoch, running: liveStatus.running },
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
	// The generation's DURABLE half: the sidecar is what makes it outlive the
	// process, and it is the file the notifier's §12.3 key is read from.
	const retainedSidecar = JSON.parse(
		readFileSync(
			`${join(HISTORY_DIR, SESSION, retained.surface.replace(/[^A-Za-z0-9_-]/g, "_"))}.json`,
			"utf8",
		),
	);
	check(
		"the exit generation is on disk in the sidecar (§7.3)",
		retainedSidecar.exit_epoch === 1,
		{
			exit_epoch: retainedSidecar.exit_epoch,
			exit_code: retainedSidecar.exit_code,
		},
	);
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

	// ---- P3: does a byte flood starve the main thread? ---------------------
	/*
	 * §19.1's P3, never run before this pass, and the probe §18.3's risk-3 names: `yes`
	 * into a surface for 30 s while main's responsiveness is sampled as the round trip
	 * of a call main has to serve (`console_status`), with the surface's dropped-byte
	 * count read from the record afterwards.
	 *
	 * RETAIN IS ON, which is the case that matters: §7.2 gives a user's surface retain
	 * by default, and a retained surface used to pay `appendFileSync` + `statSync` +
	 * chmods per pty chunk plus a staged sidecar rewrite — measured independently at
	 * ~6-7 ms per 8 KiB chunk on the thread that draws the app's windows.
	 */
	/*
	 * THE STIMULUS IS SIZED TO THE DEADLINE, NOT THE OTHER WAY AROUND (review round 3, B4).
	 *
	 * 8 MiB, because a pty is a slow pipe and the reviewer measured this one: 4 MiB ≈ 5.5 s
	 * and 8 MiB ≈ 11 s through the pty on this host (linear — 32 MiB took 43.4 s and was
	 * what made the previous revision fail a cell that requires the producer to EXIT). 8 MiB
	 * is still a genuine burst — ~2.6 M chunks of output under retention — with ~2.7x
	 * headroom under the deadline below, and the app's per-chunk work can only make it
	 * slower. Not re-measured this round: measuring it needs the app launched, which this
	 * round's rules put out of bounds; QA's bounded live run is where the number is confirmed.
	 */
	const FLOOD_BYTES = 8 * 1024 * 1024;
	/**
	 * The deadline for a stimulus that has ALREADY been told how big it is: the loop below
	 * ends on the producer's exit, and this is the bound that keeps a WEDGED SURFACE from
	 * holding the cell open — not the thing that decides the volume. It is sized above the
	 * stimulus's own measured cost (8 MiB ≈ 11 s) so a loaded host cannot turn the deadline
	 * into the reason a cell fails.
	 */
	const FLOOD_DEADLINE_MS = 30_000;
	/**
	 * How far the app TREE's RSS may rise above ITS OWN BASELINE during the flood — GROWTH,
	 * NOT AN ABSOLUTE. That distinction is the whole reason this number is small: this app's
	 * tree is **845 MiB at boot and 1.19-1.24 GiB in later runs** (QA round 8, measured on
	 * this branch), so a reader who took 256 MiB for a ceiling would write a cell that aborts
	 * on arrival. What is asserted is `rssPeak < rssBefore + FLOOD_RSS_CEILING_BYTES`, sampled
	 * per responsiveness sample by process GROUP, because Electron's tree — main, renderer,
	 * GPU, utilities — is where a pane's frames actually land.
	 *
	 * 256 MiB of growth is generous against what a bounded console costs — a 1 MiB live
	 * coalescing buffer, a 4 MiB log ring, a 5,000-line scrollback — and it is the guard that
	 * makes a future uncapped buffer fail this cell instead of the operator's machine. The
	 * measured growth across QA's three runs was +0 / +60 / +109 MB.
	 */
	const FLOOD_RSS_CEILING_BYTES = 256 * 1024 * 1024;
	const floodSurface = await rpcOk(state, "console_create", {
		session_id: SESSION,
		command: "/bin/sh",
		// A FIXED BYTE COUNT, NOT AN OPEN-ENDED `yes` (memory-bounding round). `yes` writes
		// as fast as the pty accepts, so the old cell's volume was whatever the host allowed
		// inside its wall-clock window — an unbounded producer inside a test instrument.
		// `head -c` makes the stimulus a number this file states; `yes` takes SIGPIPE when
		// `head` exits, so nothing outlives the count.
		args: ["-c", `yes | head -c ${FLOOD_BYTES}`],
		cols: 100,
		rows: 30,
		retain: true,
	});
	const sample = async () => {
		const startedAt = Date.now();
		await rpcOk(state, "console_status", { surface: floodSurface.surface });
		return Date.now() - startedAt;
	};
	/*
	 * A SUBSCRIBER IS ATTACHED FOR THE FLOOD (review round 3, B5). Without one `broadcast`
	 * returns before it touches `pending`, so the ceiling this round added is never
	 * consulted and the cell would be evidence for nothing about it. The subscription goes
	 * through the app's OWN renderer and the pane's own preload API — the same call the pane
	 * makes — so what runs is the shipped path rather than a test-only door.
	 *
	 * WHAT THIS CELL DOES AND DOES NOT PROVE, stated because the honest scope is narrower
	 * than "the ceiling is covered". It proves the live path is the one under load (frames
	 * are being coalesced and delivered to a real subscriber through the whole flood), that
	 * main answers every status call while it happens, and that the app tree stays under its
	 * RSS ceiling. It does NOT prove the drop path fires: a loop that keeps taking turns
	 * flushes `pending` every 16 ms, so at this rate the array never reaches 1 MiB, and the
	 * reviewer's own probe measured exactly that (largest frame 22,668 B, 2.2 % of the
	 * ceiling). The drop itself is pinned deterministically in `console-host.test.mjs`, which
	 * drives a 2.5 MiB backlog past the ceiling from a subscriber that never drains.
	 */
	const floodSubscription = await rendererEvaluate(
		`window.api.console.subscribe(${JSON.stringify(floodSurface.surface)}, 0)`,
	);
	const baseline = [];
	for (let index = 0; index < 10; index += 1) baseline.push(await sample());
	const rssBefore = appTreeRssBytes(app.child.pid);
	let rssPeak = rssBefore;
	const samples = [];
	let flooded = null;
	try {
		const floodStartedAt = Date.now();
		for (;;) {
			samples.push(await sample());
			const rss = appTreeRssBytes(app.child.pid);
			if (rss !== null && (rssPeak === null || rss > rssPeak)) rssPeak = rss;
			flooded = await rpcOk(state, "console_status", {
				surface: floodSurface.surface,
			});
			// THE STIMULUS ENDS THE SAMPLE, not the clock: `head -c` has taken its byte
			// count and the shell exits, so the cell cannot outlive what it started.
			if (flooded.running !== true) break;
			if (Date.now() - floodStartedAt >= FLOOD_DEADLINE_MS) break;
			await sleep(200);
		}
	} finally {
		/*
		 * THE PRODUCER IS REAPED ON EVERY PATH (memory-bounding round), not on the happy
		 * one. This cell is the loudest thing in the rig, and the path that leaves a `yes`
		 * running — an assertion throwing mid-flood — is how one test becomes a machine
		 * event. `console_close` with `kill: true` is main's own reap of the pty's process
		 * GROUP, by the pid only main holds: the pty's child is a child of the app, so the
		 * rig has no ppid for it and the surface is the handle it does have.
		 */
		try {
			await rendererEvaluate(
				`window.api.console.unsubscribe(${JSON.stringify(floodSurface.surface)})`,
			);
		} catch {
			/* the renderer is gone; its subscription went with it */
		}
		try {
			await rpcOk(state, "console_close", {
				surface: floodSurface.surface,
				kill: true,
			});
		} catch {
			/* the surface is already gone */
		}
	}
	const sorted = [...samples].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? null;
	const worst = sorted.at(-1) ?? null;

	/*
	 * WHAT THIS CELL ASSERTS, AND WHY IT NO LONGER ASSERTS A SINGLE MAXIMUM.
	 *
	 * QA round 1 (Q-3) measured this cell failing at 2,618 ms against a 2,500 ms bound
	 * while the console was answering perfectly: median 5 ms, p95 158 ms, n=67 — and
	 * two later runs on the same head measured 328 ms and 56 ms. A single wall-clock
	 * MAXIMUM on a host carrying ~20 sibling worktrees samples the machine's
	 * scheduler, not main's loop, which is the flake `AGENTS.md`'s timing section
	 * describes and why it says to prefer a structural fact and, where a number is
	 * unavoidable, not to sit it on a wall clock.
	 *
	 * SO THE ASSERTION IS STRUCTURAL FIRST: the flood ran its full window and main
	 * answered EVERY sample it was asked for. A starved loop does not answer slowly,
	 * it stops answering — an unanswered call is the shape this failure would take,
	 * and `rpcOk` throwing is what makes "every sample answered" a fact rather than an
	 * implication.
	 *
	 * THEN A DISTRIBUTION, NOT A MAXIMUM. The regression this probe exists for is a
	 * per-chunk synchronous write (`appendFileSync` + `statSync` + a staged sidecar
	 * rewrite — measured at ~6-7 ms per 8 KiB of pty output on the thread that draws
	 * the window), and that cost is paid on MOST chunks: it moves the median and the
	 * p95 rather than expressing itself as one outlier. The ceilings are calibrated
	 * from the numbers above with an order of magnitude of headroom — median < 100 ms
	 * against a measured 5 ms, p95 < 500 ms against a measured 158 ms — rather than a
	 * widening of the old 2,500 ms maximum, which would have kept sampling the host.
	 *
	 * WHY NOT A CPU-TIME BOUND. The property under test is RESPONSIVENESS — whether
	 * the loop can still serve a call — and CPU time cannot see it: a loop blocked in
	 * a synchronous write spends CPU, a loop the OS has not scheduled spends none, and
	 * the two are indistinguishable through `time.thread_time`-style accounting while
	 * only a served round trip separates them. The maximum is still REPORTED, so a
	 * reader sees the outlier and can judge it rather than having it hidden.
	 */
	const FLOOD_MEDIAN_CEILING_MS = 100;
	const FLOOD_P95_CEILING_MS = 500;
	check(
		`a ${FLOOD_BYTES / (1024 * 1024)} MiB flood with retention ON leaves main answering (§19.1 P3)`,
		flooded?.running === false &&
			flooded?.exit_code === 0 &&
			samples.length > 0 &&
			median !== undefined &&
			median < FLOOD_MEDIAN_CEILING_MS &&
			p95 !== null &&
			p95 < FLOOD_P95_CEILING_MS,
		{
			baselineMs: { max: Math.max(...baseline), median: baseline[0] },
			floodMs: {
				answered: samples.length,
				median,
				p95,
				max: worst,
			},
			ceilings: { median: FLOOD_MEDIAN_CEILING_MS, p95: FLOOD_P95_CEILING_MS },
			truncated: flooded?.truncated,
			exit_epoch: flooded?.exit_epoch,
			bytes: FLOOD_BYTES,
			producerExitCode: flooded?.exit_code,
			subscriberAttached: floodSubscription?.surface ?? null,
			replayBytesAtSubscribe: floodSubscription?.replay_base64?.length ?? null,
			surface: floodSurface.surface,
		},
	);
	/*
	 * THE MEMORY GUARD (memory-bounding round). A flood is the cell most likely to find an
	 * uncapped buffer, and this is the assertion that turns "we bounded it" into a fact a
	 * future change has to keep: the app tree's RSS, sampled beside every responsiveness
	 * sample, may not rise past its own baseline by more than the ceiling above.
	 */
	check(
		"the flood never grew the app tree past its RSS ceiling",
		rssBefore !== null &&
			rssPeak !== null &&
			rssPeak < rssBefore + FLOOD_RSS_CEILING_BYTES,
		{
			rssBeforeBytes: rssBefore,
			rssPeakBytes: rssPeak,
			ceilingBytes: FLOOD_RSS_CEILING_BYTES,
			growthBytes:
				rssBefore !== null && rssPeak !== null ? rssPeak - rssBefore : null,
		},
	);
	/*
	 * NO SECOND CLOSE HERE. The flood cell's own `finally` already reaped this surface, and
	 * closing it again answered `surface_unavailable` from a call that has no tolerance for
	 * one — which ended `main()` and took the caps and pane cells after it with it (QA round
	 * 8: three runs, three aborts at the old close on this line). A surface has one owner of
	 * its lifetime and it is the block that created it.
	 */

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

	// ---- #754: the restart the issue's repro is about ------------------------
	/*
	 * THE HALF A UNIT TEST CANNOT ANSWER, run on a real relaunch: a dismissed ended
	 * surface must NOT come back (#754's own repro - a retained surface is restored at
	 * launch, which is why dismissal has to remove the record rather than hide it), while
	 * a surface CLOSED WHILE RUNNING keeps its history and is restored as ended, because
	 * that is what the close reserved for it (design 7.3). Both assertions read the
	 * restarted app's own listing, and the app's own log line names the count it restored.
	 */
	if (closeCase) {
		await stopApp();
		await sleep(500);
		app = await launchApp();
		const restarted = await waitForState();
		const restoredList = await surfacesOf(restarted);
		const restoredRunning = restoredList.find(
			(row) => row.surface === closeCase.running,
		);
		check(
			"a surface closed while running is restored as ENDED after a relaunch (design 7.3)",
			restoredRunning !== undefined &&
				restoredRunning.running === false &&
				restoredRunning.live === false,
			{
				restored: restoredRunning ?? null,
				count: restoredList.length,
				surfaces: restoredList.map((row) => row.surface),
			},
		);
		check(
			"the dismissed ended surface does NOT come back (#754's restart repro)",
			restoredList.every((row) => row.surface !== closeCase.dismissed),
			{
				dismissed: closeCase.dismissed,
				present: restoredList.some(
					(row) => row.surface === closeCase.dismissed,
				),
			},
		);
		const restoredLog = appLogText();
		/*
		 * THE COUNT IS THE RUN'S OWN, not a number this cell predicts: later cells retain
		 * their own agent surfaces (§19.1's flood surfaces are retained deliberately), so
		 * "exactly one" was this cell counting its own subject and the app counting
		 * everything the run kept - measured 4 restored here (con:5 plus the flood and
		 * secure cells' surfaces). The claim that holds for any run is the log line, the
		 * listing and the design's "none of them is running" agreeing on the same set.
		 */
		const restoredCount = restoredList.length;
		check(
			"the relaunch restored every retained surface, in the app's own words, and none is running",
			restoredCount > 0 &&
				restoredList.every(
					(row) => row.running === false && row.live === false,
				) &&
				restoredLog.includes(
					`restored ${restoredCount} retained surface(s) from history`,
				),
			{
				count: restoredCount,
				lines: restoredLog
					.split("\n")
					.filter((line) => line.includes("restored"))
					.slice(-3),
			},
		);
		// The pane again, on the restarted app, so the restored row is a FRAME rather
		// than a listing: the mount path is the same one the pane cells use.
		await mountConversation(bounded(null, 30_000));
		await pressDom('[data-tour-tag="console-pane-trigger"]');
		const reopened = await waitForConsolePane(bounded(null, 15_000));
		const restoredRowDeadline = Date.now() + 15_000;
		let restoredRow = null;
		while (Date.now() < restoredRowDeadline) {
			restoredRow =
				(await rowsReading()).find(
					(row) => row.surface === closeCase.running,
				) ?? null;
			if (restoredRow) break;
			await sleep(250);
		}
		check(
			"the restored ended surface is a row in the strip after the relaunch, offering its Dismiss",
			reopened !== null &&
				reopened.failed !== true &&
				restoredRow !== null &&
				typeof restoredRow.label === "string" &&
				restoredRow.label.startsWith("Dismiss "),
			{ reopened, restoredRow },
		);
		await captureAppFrame("close-relaunch.png");

		/*
		 * THE EMPTY STATE AFTER THE LAST DISMISSAL (design round 1, D2's third frame):
		 * `surfaces.length > 0` gates the whole strip block, so the last dismissal removes
		 * the strip and the pane falls to ConsoleEmpty - an unphotographed transition into
		 * a different screen. Every restored row is ENDED, so each dismisses without a
		 * question; the LAST removal is also the handoff's empty arm (U1), whose target is
		 * the empty state's own New console.
		 */
		let remainingRows = await rowsReading();
		const dismissAllDeadline = Date.now() + 90_000;
		while (remainingRows.length > 0 && Date.now() < dismissAllDeadline) {
			const target = remainingRows[0];
			const last = remainingRows.length === 1;
			/*
			 * PRESS AND RE-PRESS: the press that opens an iteration can race the PREVIOUS
			 * dismissal's render - the control node is swapped under a focus that was just
			 * placed, and the Enter goes to a node the app has already replaced (measured in
			 * the first keyboard-driven re-shoot: every row took its second press, and the
			 * deadline then expired with the last row untouched). The re-press is the rig's
			 * settled shape, not a tolerance - the loop's exit condition below is the claim,
			 * and it is unchanged.
			 */
			const rowDeadline = Date.now() + 20_000;
			let dismissed = false;
			while (Date.now() < rowDeadline) {
				await focusDom(closeSelectorFor(target.surface));
				await pressEnter();
				await sleep(1_200);
				remainingRows = await rowsReading();
				dismissed = !remainingRows.some(
					(row) => row.surface === target.surface,
				);
				if (dismissed) break;
			}
			if (last && dismissed) {
				const empty = await rendererEvaluate(`(() => ({
					emptyText: (document.body.textContent || '').includes('No console in this session'),
					strip: Boolean(document.querySelector('[role="tablist"]')),
					plus: Boolean(document.querySelector('[data-tour-tag="console-new-surface"]')),
				}))()`);
				let focusedEmpty = null;
				const emptyFocusDeadline = Date.now() + 5_000;
				while (Date.now() < emptyFocusDeadline) {
					focusedEmpty = await rendererEvaluate(
						"(() => { const a = document.activeElement; return a ? (a.getAttribute && a.getAttribute('data-tour-tag')) || a.tagName.toLowerCase() : null; })()",
					);
					if (focusedEmpty === "console-new-surface") break;
					await sleep(150);
				}
				check(
					"dismissing the last surface removes the strip, shows the empty state, and the keyboard lands on its own New console (#754, UX round 1 U1's empty arm)",
					empty.emptyText === true &&
						empty.strip === false &&
						empty.plus === true &&
						focusedEmpty === "console-new-surface",
					{ empty, focusedEmpty },
				);
				await captureAppFrame("close-empty.png");
			}
		}
		check(
			"every restored surface was dismissible from the strip (the loop's own exit condition)",
			remainingRows.length === 0,
			{ remaining: remainingRows.map((row) => row.surface) },
		);
	}

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
		`Result: ${failures === 0 ? (blockedCells.length === 0 ? "every check passed" : `${checks} of ${checks} check(s) passed`) : `${failures} of ${checks} check(s) FAILED`}${blockedCells.length > 0 ? `, ${blockedCells.length} BLOCKED` : ""}`,
		...(blockedCells.length > 0
			? [
					"",
					`BLOCKED: ${blockedCells.length} cell(s) did not run, and this run is NOT a pass:`,
					...blockedCells.map((entry) => `  - ${entry.label}: ${entry.reason}`),
				]
			: []),
		`Reaped stray spawn-helper processes: ${reaped}`,
		"",
		transcript.join("\n"),
	].join("\n");
	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(join(OUT_DIR, "proof.md"), summary);
	say(`\ntranscript: ${join(OUT_DIR, "proof.md")}`);
	say(`frames: ${OUT_DIR}`);
	if (failures > 0 || blockedCells.length > 0) process.exitCode = 1;
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
		// Nor the daemon `--pair` started: it lives under this run's scratch tree and
		// is stopped by pid before that tree is removed.
		await stopDaemon();
		if (!KEEP && !PACKAGED) {
			// The scratch tree is this run's own, under the system temp dir: removing it
			// is the "do not leave a sandbox behind" rule, and nothing outside it is
			// touched.
			rmSync(SCRATCH, { recursive: true, force: true });
		} else {
			console.log(`kept: ${SCRATCH}`);
		}
	});
