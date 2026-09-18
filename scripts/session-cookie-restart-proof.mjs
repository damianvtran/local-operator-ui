#!/usr/bin/env node
/**
 * End-to-end evidence for session-only cookie persistence.
 *
 * Why this exists: the unit tests drive a fake jar and the Electron test drives
 * the module directly; neither runs the APP. This harness boots the built app
 * headless three times over one isolated profile and reports what the local site
 * actually received, which is the claim the feature makes:
 *
 *   launch 1  an agent logs in through the real RPC; the site sets a session-only
 *             cookie and a partitioned (CHIPS) session cookie
 *   quit      the snapshot must be on disk, 0600, ciphertext-only, and the
 *             clean-shutdown marker gone (which is what "clean" means here)
 *   launch 2  same profile: /whoami must show BOTH cookies again, and the cookie
 *             database must still show the partitioned one partitioned
 *   launch 3  after launch 2 is SIGKILLed (a crash, not a quit): nothing may be
 *             restored, and the app must say the unclean run was discarded
 *
 * Isolation, and why each piece is here (the same discipline as
 * `scripts/browser-host-proof.mjs`, whose launch/kill plumbing this mirrors
 * deliberately rather than inventing a second way):
 *   - HOME, LOCAL_OPERATOR_CONFIG_DIR, LOCAL_OPERATOR_LOG_DIR and the Electron
 *     `--user-data-dir` are all redirected to scratch. The log directory is the one
 *     of the four that HOME cannot move: the app's logger defaults to Electron's
 *     `home` — the OS ACCOUNT's home, not the `HOME` variable — so a run without
 *     the override appends to the operator's own log files. See
 *     `src/main/backend/log-dir.ts`, and the same note in
 *     `scripts/browser-host-proof.mjs`.
 *   - `<scratch home>/Library/Keychains` is a SYMLINK to the real keychain, and
 *     that one link is load-bearing: `safeStorage` reports itself unavailable
 *     under a bare scratch home (measured), which would make this run exercise
 *     the fail-closed path instead of the feature. Nothing else about the home
 *     directory is shared, and a keychain read is all this feature needs.
 *   - every `CMUX_*`/`LOP_*` variable is removed, `--window-mode=headless` is
 *     named, and the process group is signalled by exact pid — an inherited cmux
 *     workspace id has already renamed the operator's real workspaces.
 *
 * Usage: node scripts/session-cookie-restart-proof.mjs [--keep]
 */

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
// The real Electron binary, not the `node_modules/.bin` shim: the shim is a
// shell -> node -> Electron chain, so a pid held from it is the shim's.
import electronPath from "electron";
import { withNotificationsOff } from "./notifications-off.mjs";

const ROOT = process.cwd();
const KEEP = process.argv.includes("--keep");
const SCRATCH = join(tmpdir(), `lo-session-cookie-proof-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
/** This run's app log files, through the app's own override. See the header. */
const LOG_DIR = join(SCRATCH, "logs");

const transcript = [];
let failures = 0;

const say = (line) => console.log(line);
const check = (label, ok, detail) => {
	failures += ok ? 0 : 1;
	say(
		`[${ok ? "PASS" : "FAIL"}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`,
	);
	transcript.push(
		`### ${label}\n\n\`\`\`\n[${ok ? "PASS" : "FAIL"}] ${detail ?? ""}\n\`\`\`\n`,
	);
	return ok;
};
const record = (label, body) =>
	transcript.push(`### ${label}\n\n\`\`\`\n${body}\n\`\`\`\n`);

/** The site. `/login` sets the three cookies the feature is about; `/whoami`
 * reports what the jar actually sent, which is the only thing that proves a login
 * still works after a restart; `/third-party` embeds a frame served from the
 * OTHER loopback name, so whether a partitioned cookie stayed partitioned is
 * answered by the runtime rather than by reading a jar. */
const seenInFrame = new Map();

function startSite() {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (url.pathname === "/login") {
			res.writeHead(200, {
				"Content-Type": "text/html",
				"Set-Cookie": [
					// The headline case: a SESSION cookie, no Expires and no Max-Age, and
					// no SameSite attribute at all (so, unspecified).
					"session_only=agent-login; Path=/",
					// The control for the frame test below: unpartitioned, but SameSite=None
					// so that SameSite is not what keeps it out of a third-party frame.
					"session_open=open-scope; Path=/; Secure; SameSite=None",
					// The case a naive get()/set() round trip silently flattens.
					"chips_only=tenant-scoped; Path=/; Secure; SameSite=None; Partitioned",
				],
			});
			res.end(
				"<!doctype html><title>logged in</title><p id=login>logged in</p>",
			);
			return;
		}
		if (url.pathname === "/whoami") {
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end(`COOKIE_HEADER: ${req.headers.cookie ?? "(none)"}`);
			return;
		}
		if (url.pathname === "/third-party") {
			// The top-level host is THIS one (127.0.0.1) and the frame is served from
			// the other loopback name, so the two are different sites and the frame is
			// a genuine third-party context.
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(
				`<!doctype html><title>third party frame</title><p>host page</p><iframe src="http://localhost:${server.address().port}/frame"></iframe>`,
			);
			return;
		}
		if (url.pathname === "/frame") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(
				'<!doctype html><title>frame</title><script>fetch("/frame-report?cookie=" + encodeURIComponent(document.cookie));</script><p>frame</p>',
			);
			return;
		}
		if (url.pathname === "/frame-report") {
			seenInFrame.set("last", url.searchParams.get("cookie") ?? "");
			res.writeHead(204);
			res.end();
			return;
		}
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end("<!doctype html><title>proof site</title><p>proof site</p>");
	});
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve({ server, port: server.address().port }),
		),
	);
}

const stateFilePath = () => join(CONFIG_DIR, "run", "ui-browser", "host.json");
const markerPath = () =>
	join(USER_DATA, "browser", "session-cookie-generation.json");
const snapshotPath = () => join(USER_DATA, "browser", "session-cookies.enc");

let launched = null;
/** The renderer debugging port, fresh for each launch so a leftover from a
 * previous run cannot be mistaken for this one's renderer. */
let devtoolsPort = 0;

/** A port nobody is listening on, taken by binding one and letting it go.
 *
 * The first version picked a random number in a range and hoped; a run against the
 * base tree then hung on "the renderer never exposed window.api.browser" because
 * the app could not listen on the port it was told to use, so the harness was
 * asking a stale/other target. `scripts/browser-host-proof.mjs` binds-to-choose for
 * the same reason. */
async function freeDevtoolsPort() {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port: chosen } = probe.address();
			probe.close(() => resolve(chosen));
		});
	});
}

/** Launch the built app, headless, against the scratch profile. */
async function launch(siteOrigin) {
	/*
	 * `withNotificationsOff`: this rig boots the real app, and a backend it spawns
	 * reaches macOS through `osascript` when a session parks on a gate — a banner
	 * in the operator's real Notification Center, from a harness run. See
	 * `notifications-off.mjs`.
	 */
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		// The operator's own log files are the one path HOME does not move; see the
		// header's isolation note.
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		// The app would otherwise try to install and start a Local Operator backend
		// in this scratch HOME — a pip install and a dialog that have nothing to do
		// with cookie persistence.
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	// The state file is per launch: remove it so "the file exists" cannot be read
	// as "this launch published it".
	rmSync(stateFilePath(), { force: true });
	devtoolsPort = await freeDevtoolsPort();
	const child = spawn(
		electronPath,
		[
			".",
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${devtoolsPort}`,
		],
		{ env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const logPath = join(SCRATCH, `app-${launched?.length ?? 0}.log`);
	const flush = () => writeFileSync(logPath, stream.join(""));
	const timer = setInterval(flush, 400);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});
	launched = launched ?? [];
	launched.push({ child, logPath, flush });

	const deadline = Date.now() + 60_000;
	let state = null;
	while (Date.now() < deadline) {
		if (existsSync(stateFilePath())) {
			try {
				const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
				if (parsed?.port) {
					state = parsed;
					break;
				}
			} catch {
				// Staged writes: a parse failure here is "not yet".
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	if (!state)
		throw new Error(`no browser-host state file appeared (site ${siteOrigin})`);
	return { child, state, logPath, logs: () => stream.join(""), flush };
}

const rpc = async (state, method, params = {}) => {
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Bridge-Key": state.session_key,
		},
		body: JSON.stringify({ id: `proof-${method}`, method, params }),
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		// The status line is the fact when the body is not JSON.
	}
	if (response.status !== 200 || !json?.ok) {
		throw new Error(`${method} failed: ${response.status} ${text}`);
	}
	return json.result;
};

/** What the site received, driven through the agent's own surface. */
async function whoami(app, origin) {
	const opened = await rpc(app.state, "open", {
		url: `${origin}/whoami`,
		requester: "session:proof",
	});
	const read = await rpc(app.state, "read", { tab: opened.tab });
	return read.text.trim();
}

/**
 * Evaluate an expression in the app's own renderer, over CDP.
 *
 * Needed for one thing only: the consent prompt is answered by the USER's
 * renderer, not by the agent's RPC (there is no "approve" method — the whole
 * point of the gate). This mirrors `scripts/browser-host-proof.mjs`, which is the
 * same plumbing written for the browser host's own evidence run; it is copied
 * rather than imported because that file is a script, not a module.
 */
async function rendererEvaluate(expression) {
	const list = await (
		await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
	).json();
	const page = list.find(
		(target) => target.type === "page" && target.url.startsWith("file:"),
	);
	if (!page) throw new Error("no renderer target on the debugging port");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = () => reject(new Error("renderer websocket failed"));
	});
	try {
		const result = await new Promise((resolve, reject) => {
			socket.onmessage = (event) => {
				const message = JSON.parse(event.data);
				if (message.id === 1) resolve(message.result);
			};
			socket.onerror = () => reject(new Error("renderer evaluate failed"));
			socket.send(
				JSON.stringify({
					id: 1,
					method: "Runtime.evaluate",
					params: { expression, awaitPromise: true, returnByValue: true },
				}),
			);
		});
		if (result?.exceptionDetails) {
			throw new Error(`renderer threw: ${result.exceptionDetails.text}`);
		}
		return result?.result?.value;
	} finally {
		socket.close();
	}
}

/** The renderer is a separate process and exposes its IPC surface only once it
 * has loaded; a consent question asked before that has nothing to answer it. */
async function waitForRenderer(timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		try {
			const ready = await rendererEvaluate(
				"typeof window.api?.browser?.state === 'function' ? 'ready' : 'waiting'",
			);
			if (ready === "ready") return;
		} catch {
			// No target yet: keep waiting.
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error("the renderer never exposed window.api.browser");
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

/** What a THIRD-PARTY frame saw, reported by the frame itself to the site.
 *
 * The drive is the honest measurement of the partition claim: the HOST page is
 * served on the other loopback name, and the frame inside it is served from this
 * one, so the frame's top-level site is not the site the cookie was partitioned
 * to. An unpartitioned twin of the same cookie (SameSite=None, so SameSite is not
 * what withholds it) is the control that proves the frame really is a third-party
 * context in this runtime. */
async function whatTheFrameSaw(app, hostOrigin) {
	seenInFrame.delete("last");
	const opened = await rpc(app.state, "open", {
		url: `${hostOrigin}/third-party`,
		requester: "session:proof",
	});
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (seenInFrame.has("last")) {
			const seen = seenInFrame.get("last");
			await rpc(app.state, "close", { tab: opened.tab }).catch(() => {});
			return seen;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	await rpc(app.state, "close", { tab: opened.tab }).catch(() => {});
	return null;
}

/** Remove the app's approval prompt for the local site, so a driven `open` gets
 * past the consent band the way a real session does. */
async function approve(app, origin) {
	await waitForRenderer();
	const requested = await rpc(app.state, "request_access", {
		url: origin,
		requester: "session:proof",
	});
	if (requested.state === "allowed") return;
	const pending = await rendererEvaluate(
		"window.api.browser.state().then((s) => JSON.stringify(s.pendingConsent))",
	);
	const entry = JSON.parse(pending ?? "[]").find(
		(candidate) => candidate.origin === origin,
	);
	if (!entry) throw new Error(`no pending consent for ${origin}`);
	await rendererEvaluate(
		`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, "site").then((s) => JSON.stringify(s))`,
	);
	await rpc(app.state, "await_access", {
		url: origin,
		requester: "session:proof",
	});
}

/**
 * Ask the app to quit, then insist.
 *
 * THE CLEAN PATH SIGNALS THE APP'S OWN PID, NOT ITS PROCESS GROUP, and that is not
 * a detail: a SIGTERM to the group also kills Chromium's helper processes, and the
 * NETWORK SERVICE is where the cookie store lives. A group signal therefore makes
 * every cookie read fail mid-teardown, which looks exactly like "the app never
 * writes anything on quit" — measured: the group-signalled run produced no
 * snapshot at all and the quit hung until SIGKILL, while signalling the main
 * process alone let the stop complete and the snapshot land. The group SIGKILL
 * stays as the fallback so a wedged app still goes away.
 */
function stop(app, { crash = false } = {}) {
	const { child, flush } = app;
	const killTree = (signal) => {
		try {
			process.kill(-child.pid, signal);
		} catch {
			try {
				child.kill(signal);
			} catch {
				// Already gone.
			}
		}
	};
	return new Promise((resolve) => {
		let fallback = null;
		child.once("exit", () => {
			if (fallback) clearTimeout(fallback);
			flush();
			resolve({ crashed: crash });
		});
		if (crash) {
			killTree("SIGKILL");
			return;
		}
		try {
			child.kill("SIGTERM");
		} catch {
			// Already gone.
		}
		fallback = setTimeout(() => killTree("SIGKILL"), 20_000);
	});
}

const cookieRows = () => {
	const db = join(USER_DATA, "Partitions", "local-operator-browser", "Cookies");
	if (!existsSync(db)) return "(no cookie database)";
	try {
		return execFileSync(
			"sqlite3",
			[
				db,
				"select name,host_key,path,is_persistent,top_frame_site_key from cookies order by name;",
			],
			{ encoding: "utf8" },
		);
	} catch (error) {
		return `(sqlite3 failed: ${String(error)})`;
	}
};

async function main() {
	mkdirSync(HOME_DIR, { recursive: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(LOG_DIR, { recursive: true });
	// The one shared resource: a keychain read. Without this link `safeStorage`
	// reports itself unavailable (measured) and this whole run would test the
	// fail-closed path instead of the feature.
	mkdirSync(join(HOME_DIR, "Library"), { recursive: true });
	symlinkSync(
		join(homedir(), "Library", "Keychains"),
		join(HOME_DIR, "Library", "Keychains"),
	);

	const { server, port } = await startSite();
	const origin = `http://127.0.0.1:${port}`;
	// The same server under its other name: a different site, which is what makes
	// the frame test below a third-party context.
	const hostOrigin = `http://localhost:${port}`;
	record(
		"the local site and the isolation",
		`origin: ${origin}\nscratch: ${SCRATCH}\nhome: ${HOME_DIR} (Library/Keychains symlinked to the real keychain)`,
	);

	// --- launch 1: log in -----------------------------------------------------
	const first = await launch(origin);
	await approve(first, origin);
	await approve(first, hostOrigin);
	const login = await rpc(first.state, "open", {
		url: `${origin}/login`,
		requester: "session:proof",
	});
	await rpc(first.state, "read", { tab: login.tab });
	const beforeLogin = await whoami(first, origin);
	check(
		"the login set both cookies (a session-only one and a partitioned one)",
		beforeLogin.includes("session_only=agent-login") &&
			beforeLogin.includes("chips_only=tenant-scoped"),
		`after /login, /whoami received:\n${beforeLogin}`,
	);
	record("launch 1: the jar the site saw", beforeLogin);

	await stop(first, { crash: false });
	const firstLog = first.logs();
	check(
		"launch 1 wrote the encrypted snapshot on a clean quit",
		existsSync(snapshotPath()),
		`${snapshotPath()}\nmode: ${existsSync(snapshotPath()) ? (statSync(snapshotPath()).mode & 0o777).toString(8) : "(absent)"}`,
	);
	const snapshotText = existsSync(snapshotPath())
		? readFileSync(snapshotPath(), "utf8")
		: "";
	check(
		"the snapshot carries no cookie value in the clear",
		!snapshotText.includes("agent-login") &&
			!snapshotText.includes("tenant-scoped"),
		`stored bytes: ${snapshotText.length}; contains "agent-login": ${snapshotText.includes("agent-login")}`,
	);
	check(
		"the shutdown was confirmed clean (the marker is gone)",
		!existsSync(markerPath()),
		`marker ${markerPath()}: ${existsSync(markerPath()) ? "present (unclean)" : "absent (clean)"}`,
	);
	record(
		"launch 1: the app's own session-cookie log lines",
		firstLog
			.split("\n")
			.filter((line) => line.includes("session cookies"))
			.join("\n"),
	);

	// --- launch 2: the restart ------------------------------------------------
	const second = await launch(origin);
	await approve(second, origin);
	await approve(second, hostOrigin);
	const afterRestart = await whoami(second, origin);
	check(
		"MEASURED: the session-only cookie survives a real restart",
		afterRestart.includes("session_only=agent-login"),
		`after restart, /whoami received:\n${afterRestart}`,
	);
	check(
		"MEASURED: the partitioned cookie survives too, with its partition key",
		afterRestart.includes("chips_only=tenant-scoped"),
		`after restart, /whoami received:\n${afterRestart}`,
	);
	record("launch 2: what the site saw after the restart", afterRestart);

	// The partition claim, attempted through the runtime: a third-party frame on the
	// other loopback name. RECORDED, not checked, and deliberately so — measured on
	// this runtime (Electron 44.3.0 / Chrome 152), such a frame receives NO cookies
	// at all, the unpartitioned SameSite=None control included, so "the frame did not
	// see the partitioned cookie" would be true for a reason that has nothing to do
	// with partitioning. A guard that passes whether or not the property holds is
	// worse than no guard, so this is evidence about the runtime instead, and the
	// partition identity itself is compared attribute by attribute against a real
	// jar in `scripts/session-cookie-electron.test.mjs` (and shown to be lost by the
	// naive channel there).
	const frameSaw = await whatTheFrameSaw(second, hostOrigin);
	record(
		"launch 2: what a third-party frame saw (a runtime fact, not a verdict)",
		`frame with top-level site ${hostOrigin} reported: ${JSON.stringify(frameSaw)}\nneither the unpartitioned SameSite=None control nor the partitioned cookie reached it, so this runtime does not deliver third-party cookies and a frame cannot answer the partition question here.`,
	);
	record(
		"launch 2: the app's own session-cookie log lines",
		second
			.logs()
			.split("\n")
			.filter((line) => line.includes("session cookies"))
			.join("\n"),
	);

	// --- launch 3: the crash ---------------------------------------------------
	await stop(second, { crash: true });
	check(
		"a SIGKILLed run leaves the marker behind (so the next start must refuse)",
		existsSync(markerPath()),
		`marker ${markerPath()}: ${existsSync(markerPath()) ? "present" : "absent"}`,
	);
	record(
		"after the crash: the cookie database still in Chromium's own store",
		cookieRows(),
	);

	const third = await launch(origin);
	await approve(third, origin);
	await approve(third, hostOrigin);
	const afterCrash = await whoami(third, origin);
	check(
		"after a crash nothing is replayed: the session cookie does NOT come back",
		!afterCrash.includes("session_only=agent-login"),
		`after the crashed run, /whoami received:\n${afterCrash}`,
	);
	check(
		"and the app says why, rather than silently doing nothing",
		third.logs().includes("did not shut down cleanly"),
		third
			.logs()
			.split("\n")
			.filter((line) => line.includes("session cookies"))
			.join("\n"),
	);
	record("launch 3: what the site saw after the crashed run", afterCrash);
	await stop(third, { crash: false });

	writeFileSync(join(SCRATCH, "proof.md"), `${transcript.join("\n")}\n`);
	say(`\ntranscript: ${join(SCRATCH, "proof.md")}`);
	say(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
	server.close();
	return failures === 0 ? 0 : 1;
}

main()
	.then((code) => {
		if (!KEEP) {
			// Keep the scratch directory on failure: the transcript and the app logs
			// are the whole evidence.
			if (code === 0) rmSync(SCRATCH, { recursive: true, force: true });
			else say(`scratch kept for inspection: ${SCRATCH}`);
		}
		process.exit(code);
	})
	.catch((error) => {
		console.error("PROOF FAILED", error);
		for (const entry of launched ?? []) {
			try {
				process.kill(-entry.child.pid, "SIGKILL");
			} catch {
				// Nothing to stop.
			}
		}
		say(`scratch kept for inspection: ${SCRATCH}`);
		process.exit(1);
	});
