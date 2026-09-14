#!/usr/bin/env node
/**
 * End-to-end proof for the browser host.
 *
 * Why this exists: the desktop suite's browser tests exercise the RULES with fake
 * views (no page is ever loaded), and the PR's claim is about a real Chromium
 * surface driven over a real loopback RPC by the code that ships. This harness is
 * the run that can falsify that claim — it boots the BUILT app headless, talks to
 * its real `/rpc`, drives a real page, and prints what came back.
 *
 * It is committed rather than pasted into a PR because a transcript that cannot be
 * re-run is a claim, not evidence.
 *
 * Isolation (non-negotiable, and why each piece is here):
 *   - `HOME` AND `LOCAL_OPERATOR_CONFIG_DIR` are both redirected: the config dir
 *     alone leaves the cache and hardcoded home roots in the real home, and this
 *     repo has already written 612 rows into the operator's live analytics database
 *     from a "sandboxed" run.
 *   - the Electron profile root is a scratch `--user-data-dir`, so the run cannot
 *     see or touch the operator's real Local Operator profile — and cannot leak its
 *     own state into it either.
 *   - `--window-mode=headless` and every `CMUX_*`/`LOP_*` variable removed: the app
 *     must never take the operator's focus, and an inherited cmux workspace id has
 *     already renamed his real workspaces once.
 *
 * Usage: node scripts/browser-host-proof.mjs [--keep]
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRATCH = join(tmpdir(), `lo-browser-proof-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const OUT_DIR = join(SCRATCH, "out");
/**
 * The renderer debugging port, chosen FRESH FOR EACH LAUNCH.
 *
 * Randomised rather than fixed: a fixed port is how an earlier failed run's
 * leftover app answered this run's CDP calls, which looked exactly like "the IPC
 * handler is missing" — the wrongest possible reading of a stale process. And
 * chosen per launch rather than once per run, because this harness launches the
 * app twice: reusing one number meant the second launch raced the first app's
 * teardown for it, Chromium reported `bind() failed: Address already in use (48)`
 * / `Cannot start http server for devtools`, and the harness's next CDP call went
 * to the dying app's socket and died with "other side closed". Measured, not
 * inferred: the app log carries both lines, and the run before this change
 * failed there with 36 checks already green.
 */
let DEVTOOLS_PORT = 0;

function pickDevtoolsPort() {
	return 9200 + Math.floor(Math.random() * 600);
}

/** Wait until nothing is listening on `port`, then return it. Bounded: a port
 * held by a process this run cannot see is a reason to pick another number, not
 * to hang. */
async function freeDevtoolsPort(timeoutMs = 10_000) {
	const started = Date.now();
	for (;;) {
		const port = pickDevtoolsPort();
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (!response.ok) return port;
		} catch (error) {
			if (error instanceof TypeError) return port; // nothing listening: what we want
			throw error;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`no free devtools port: three random draws in ${timeoutMs}ms were all in use`,
			);
		}
	}
}

const transcript = [];
let failures = 0;

function record(label, body) {
	transcript.push(`### ${label}\n\n\`\`\`\n${body}\n\`\`\`\n`);
}

function say(line) {
	console.log(line);
}

function check(label, ok, detail) {
	const status = ok ? "PASS" : "FAIL";
	if (!ok) failures += 1;
	say(`[${status}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`);
	record(label, `[${status}] ${detail === undefined ? "" : detail}`);
	return ok;
}

// ---- the local site the proof drives ---------------------------------------

/**
 * The page, deliberately small and hostile-free, but exercising exactly the
 * surfaces the capability matrix assigns to this host: a clickable control, a
 * text field, a long enough body to scroll, console output at three levels, an
 * uncaught exception, a permission request, a popup attempt, a same-origin link
 * so a click can be seen to navigate, and a probe written by the PAGE's own
 * script reporting which globals its world actually has (the isolation claim,
 * measured rather than read off the view's creation options).
 */
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser host proof page</title>
<style>body{font:14px system-ui;margin:0;padding:24px}#tall{height:1600px;background:linear-gradient(#eef,#fff)}</style>
</head><body>
<h1>Browser host proof page</h1>
<p id="lede">A page for the local-operator browser host evidence run.</p>
<label for="name">Name</label>
<input id="name" type="text" />
<button id="go" type="button">Go</button>
<button id="nav" type="button">Next page</button>
<p id="result"></p>
<p id="geo">geolocation: not asked</p>
<p id="popup">popup: not asked</p>
<p id="isolation">isolation: unmeasured</p>
<div id="tall"></div>
<script>
  console.log("proof: log line");
  console.warn("proof: warning line");
  console.error("proof: error line");
  document.getElementById("go").addEventListener("click", () => {
    const value = document.getElementById("name").value;
    document.getElementById("result").textContent = "clicked with " + value;
    console.log("proof: clicked with [" + value + "]");
  });
  document.getElementById("nav").addEventListener("click", () => {
    window.location.href = "/page2";
  });
  // The isolation probe, run by the PAGE script in the PAGE's own world.
  // No backticks in this comment: it lives inside a template literal.
  // This is the measurement the PR body previously did not have: the view is
  // created with no preload and sandbox: true, so nothing named api may exist
  // here even if a future refactor adds an IPC channel, and a probe run from the
  // host's side (the isolated world, or a code read) cannot show it.
  document.getElementById("isolation").textContent =
    "isolation: api=" + (typeof window.api) +
    " require=" + (typeof require) +
    " process=" + (typeof process) +
    " electron=" + (typeof window.electron);
  try { navigator.geolocation.getCurrentPosition(
    () => { document.getElementById("geo").textContent = "geolocation: GRANTED"; },
    (error) => { document.getElementById("geo").textContent = "geolocation: denied (" + error.code + ")"; });
  } catch (error) {
    document.getElementById("geo").textContent = "geolocation: threw " + error;
  }
  try {
    const opened = window.open("/popup-target", "_blank");
    document.getElementById("popup").textContent = "popup: " + (opened ? "opened" : "blocked");
  } catch (error) {
    document.getElementById("popup").textContent = "popup: threw " + error;
  }
  setTimeout(() => { throw new Error("proof: uncaught exception"); }, 0);
</script>
</body></html>`;

const PAGE2 = `<!doctype html><html><head><meta charset="utf-8"><title>Proof page two</title></head>
<body><h1>Second page</h1><p id="second">This is the second proof page.</p></body></html>`;

/** Responses still held open by the `/slow` route, destroyed at the end of the
 * run so a deliberately hung request cannot keep this process alive. */
const held = [];

function startSite() {
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (url.pathname === "/slow") {
			// Accepts the connection and never answers — the input QA round 1 used to
			// find the typed `nav_timeout` unreachable. Headers are sent so the client
			// knows the server is alive; the body never arrives and the request never
			// completes.
			held.push(res);
			res.writeHead(200, { "Content-Type": "text/html" });
			res.write("<!doctype html><title>slow</title><p>never finishes");
			return;
		}
		if (url.pathname === "/echo") {
			res.writeHead(200, { "Content-Type": "text/plain" });
			res.end(`COOKIE_HEADER: ${req.headers.cookie ?? "(none)"}`);
			return;
		}
		if (url.pathname === "/set") {
			// A SESSION cookie (no Expires/Max-Age: Chromium keeps it in memory and
			// drops it with the process) and a PERSISTENT one, so the restart probe
			// measures both in one visit.
			res.writeHead(200, {
				"Content-Type": "text/html",
				"Set-Cookie": [
					"session_only=1; Path=/",
					"persistent=1; Path=/; Max-Age=86400",
				],
			});
			res.end("<!doctype html><title>cookie set</title><p id=cookies>cookies set</p>");
			return;
		}
		if (url.pathname === "/page2") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(PAGE2);
			return;
		}
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(PAGE);
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
	});
}

// ---- the app ---------------------------------------------------------------

/** The app this run started, so a failure anywhere still stops it. */
let app = null;

async function stopApp() {
	if (!app) return;
	const stopping = app;
	app = null;
	stopping.flush();
	await stopping.stop();
}

async function launchApp() {
	const env = {
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		// The app would otherwise try to install and start a Local Operator backend
		// in this scratch HOME — a pip install, a dialog and a quit path that have
		// nothing to do with the browser host. The same switch the repo's other
		// app-proof harness uses.
		VITE_DISABLE_BACKEND_MANAGER: "true",
	};
	// Every inherited cmux/lop variable is removed rather than overwritten: this
	// process is driven by a session that has them set, and an inherited workspace
	// id has already renamed the operator's real workspaces in this project.
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	// A port nobody is listening on, checked immediately before the spawn: the
	// check that used to run once per run is now per launch, which is where the
	// collision actually happened.
	DEVTOOLS_PORT = await freeDevtoolsPort();
	const child = spawn(
		join(ROOT, "node_modules", ".bin", "electron"),
		[".", `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${DEVTOOLS_PORT}`],
		{ env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
	);
	const logPath = join(SCRATCH, "app.log");
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const flush = () => writeFileSync(logPath, stream.join(""));
	const timer = setInterval(flush, 500);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});
	return { child, logPath, stream, flush, stop: () => new Promise((resolve) => {
		child.once("exit", resolve);
		child.kill("SIGTERM");
		setTimeout(() => {
			try { child.kill("SIGKILL"); } catch { /* already gone */ }
			resolve();
		}, 5000);
	}) };
}

function stateFilePath() {
	return join(CONFIG_DIR, "run", "ui-browser", "host.json");
}

async function waitForState(timeoutMs = 60_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (existsSync(stateFilePath())) {
			const raw = readFileSync(stateFilePath(), "utf8");
			try {
				const parsed = JSON.parse(raw);
				if (parsed.port) return parsed;
			} catch {
				// A reader can catch the file mid-write only if the writer is not
				// staging; it stages, so this is the "not yet" case.
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
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
		body: typeof options.rawBody === "string"
			? options.rawBody
			: JSON.stringify({ id: options.id ?? `proof-${method}`, method, params }),
	});
	const text = await response.text();
	let json = null;
	try { json = JSON.parse(text); } catch { /* not JSON: the status is the fact */ }
	return { status: response.status, headers: response.headers, text, json };
}

/** Call the RPC and require `ok: true`, returning the result. A refusal here is a
 * failure of the run, not a result to interpret. */
async function rpcOk(state, method, params = {}) {
	const out = await rpc(state, method, params);
	if (out.status !== 200 || !out.json?.ok) {
		throw new Error(`${method} failed: ${out.status} ${out.text}`);
	}
	return out.json.result;
}

// ---- the renderer, over CDP -------------------------------------------------

/**
 * Evaluate an expression in the app's own renderer.
 *
 * A CDP error response (a context being torn down between navigate and evaluate,
 * which happens whenever this runs while the page is still loading) is surfaced
 * as an error rather than as `undefined`. That distinction cost a whole debugging
 * round: the first version read only `message.result`, so an early call reported
 * "the IPC handler is missing" while the handler was registered and working.
 */
async function rendererEvaluate(expression, options = {}) {
	const list = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)).json();
	const page = list.find((target) => target.type === "page" && target.url.startsWith("file:"));
	if (!page) throw new Error("no renderer target on the debugging port");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const logged = [];
	// The evaluate gets an id of its own and is resolved on THAT id: with
	// `collectLogs` the enabling calls also consume ids, and resolving on "the first
	// response" read the log-enable reply and reported the expression as `undefined`.
	const EVALUATE_ID = 100;
	const message = await new Promise((resolve, reject) => {
		let nextId = 0;
		const request = (method, params, id = ++nextId) => {
			socket.send(JSON.stringify({ id, method, params }));
		};
		socket.addEventListener("message", (event) => {
			const incoming = JSON.parse(event.data);
			if (incoming.method === "Log.entryAdded" && incoming.params?.entry) {
				logged.push(String(incoming.params.entry.text ?? ""));
			}
			if (incoming.method === "Runtime.consoleAPICalled") {
				const args = (incoming.params?.args ?? []).map((a) => String(a.value ?? a.description ?? ""));
				logged.push(args.join(" "));
			}
			if (incoming.id === EVALUATE_ID) resolve(incoming);
		});
		socket.addEventListener("error", reject, { once: true });
		if (options.collectLogs) {
			// The browser's OWN sentence for a blocked fetch is the evidence: "Failed
			// to fetch" alone does not say whether CORS, a private-network check or a
			// dead server refused it.
			request("Log.enable", {});
			request("Runtime.enable", {});
		}
		request(
			"Runtime.evaluate",
			{ expression, awaitPromise: true, returnByValue: true },
			EVALUATE_ID,
		);
	});
	// The blocked-request report arrives after the evaluate settles, so give the log
	// channel a moment before closing the socket.
	if (options.collectLogs) await new Promise((resolve) => setTimeout(resolve, 1500));
	socket.close();
	if (message.error) return { error: `CDP: ${message.error.message}` };
	if (message.result?.exceptionDetails) {
		return {
			error:
				message.result.exceptionDetails.exception?.description ??
				message.result.exceptionDetails.text ??
				"threw",
		};
	}
	return { value: message.result?.result?.value, logged };
}

/** Wait until the renderer's page has loaded AND its preload has exposed the
 * browser namespace: the state file appears before the window's first paint, so
 * everything the renderer does has to wait for it. */
async function waitForRenderer(timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		const ready = await rendererEvaluate(
			"typeof window.api?.browser?.state === 'function' ? 'ready' : 'waiting'",
		);
		if (ready.value === "ready") return;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`the renderer never exposed window.api.browser (${JSON.stringify(ready)})`);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

// ---- the run ----------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function approve(state, origin, decision, kind = "async") {
	const requested = await rpcOk(state, "request_access", { url: origin, requester: "session:proof" });
	if (requested.state === "allowed") return { requested, answered: null, awaited: { state: "allowed" } };
	const pending = await rendererEvaluate(
		"window.api.browser.state().then((s) => JSON.stringify(s.pendingConsent))",
	);
	const entry = JSON.parse(pending.value ?? "[]").find((candidate) => candidate.origin === origin);
	if (!entry) throw new Error(`no pending consent for ${origin}: ${JSON.stringify(pending)}`);
	const answered = await rendererEvaluate(
		`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, ${JSON.stringify(decision)}).then((s) => JSON.stringify(s))`,
	);
	const awaited = await rpcOk(state, "await_access", { url: origin, requester: "session:proof" });
	return { requested, answered, awaited, kind };
}

/** Fail fast if something else already owns the debugging port: see the comment
 * on `DEVTOOLS_PORT`. `freeDevtoolsPort()` performs the same check per launch;
 * this one runs once up front so a machine-wide leftover is named before the
 * first app starts. */
async function assertDevtoolsPortFree() {
	const port = DEVTOOLS_PORT || pickDevtoolsPort();
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`);
		if (response.ok) {
			say(
				`[note] port ${port} already serves a debugger (another run's app); this run will pick a different one`,
			);
		}
	} catch (error) {
		if (error instanceof TypeError) return; // nothing listening: what we want
		throw error;
	}
}

async function main() {
	rmSync(SCRATCH, { recursive: true, force: true });
	mkdirSync(HOME_DIR, { recursive: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(USER_DATA, { recursive: true });
	mkdirSync(OUT_DIR, { recursive: true });

	const site = await startSite();
	const siteOrigin = `http://127.0.0.1:${site.port}`;
	say(`scratch: ${SCRATCH}`);
	say(`local site: ${siteOrigin}`);

	await assertDevtoolsPortFree();
	app = await launchApp();
	let state = await waitForState();
	say(`state file: ${stateFilePath()}`);
	say(app.stream.join("").split("\n").filter((line) => line.includes("[browser]")).join("\n"));

	await waitForRenderer();
	// The renderer owns layout (design 11.2): the chrome measures its content area
	// and reports it, and main applies it to the active tab. The route that does
	// this is PR 4, so this run reports the rect itself — through the real IPC
	// channel, which is also the proof that the renderer namespace works.
	const rect = await rendererEvaluate(
		"window.api.browser.setContentRect({ x: 0, y: 0, width: 1280, height: 800 }).then((s) => JSON.stringify(s))",
	);
	check(
		"the renderer can report its content rect over the browser IPC namespace",
		typeof rect.value === "string" && rect.value.includes('"activeTabId"'),
		`window.api.browser.setContentRect({x:0,y:0,width:1280,height:800}) -> ${rect.value ?? rect.error}`,
	);
	const ipcState = await rendererEvaluate(
		"window.api.browser.state().then((s) => JSON.stringify(s))",
	);
	check(
		"the renderer's projection carries tab ids and no surface token",
		typeof ipcState.value === "string" &&
			ipcState.value.includes("activeTabId") &&
			!ipcState.value.includes("ui:"),
		`window.api.browser.state() -> ${ipcState.value ?? ipcState.error}`,
	);

	// --- 1. the state file on disk ------------------------------------------
	const stat = statSync(stateFilePath());
	const dirStat = statSync(join(CONFIG_DIR, "run", "ui-browser"));
	check(
		"the state file exists with the permissions the design requires",
		(stat.mode & 0o777) === 0o600 && (dirStat.mode & 0o777) === 0o700,
		`${stateFilePath()} mode ${(stat.mode & 0o777).toString(8)}; directory mode ${(dirStat.mode & 0o777).toString(8)}; ${JSON.stringify(state)}`,
	);
	check(
		"the record names a live ui host with a protocol version",
		state.host === "ui" && state.proto === 1 && typeof state.session_key === "string" && state.session_key.length >= 32,
		`host=${state.host} proto=${state.proto} key length=${state.session_key.length} pid=${state.pid}`,
	);

	// --- 2. the loopback RPC -------------------------------------------------
	const health = await fetch(`http://127.0.0.1:${state.port}/health`);
	const healthBody = await health.json();
	check(
		"/health identifies this process",
		health.status === 200 && healthBody.host === "ui" && healthBody.pid === state.pid,
		`GET /health -> ${health.status} ${JSON.stringify(healthBody)}`,
	);
	const noKey = await rpc(state, "status", {}, { omitKey: true });
	check("a request without the key is refused", noKey.status === 401, `-> ${noKey.status} ${noKey.text}`);
	const wrongKey = await rpc(state, "status", {}, { key: `${state.session_key}x` });
	check("a request with the wrong key is refused", wrongKey.status === 401, `-> ${wrongKey.status} ${wrongKey.text}`);
	const unknownMethod = await rpc(state, "teleport", {});
	check("an unknown method is refused at the boundary", unknownMethod.status === 422, `-> ${unknownMethod.status} ${unknownMethod.text}`);
	const malformed = await rpc(state, "status", {}, { rawBody: "{not json" });
	check("a malformed body is refused", malformed.status === 422, `-> ${malformed.status} ${malformed.text}`);
	const extraField = await rpc(state, "status", {}, { rawBody: JSON.stringify({ id: "x", method: "status", params: {}, extra: 1 }) });
	check("an unknown envelope field is refused", extraField.status === 422, `-> ${extraField.status} ${extraField.text}`);
	const unauthorised = await rpc(state, "read", { tab: "ui:1:deadbeef" });
	check(
		"an unauthorised surface handle is refused with the tool's own code",
		unauthorised.status === 200 && unauthorised.json?.ok === false && unauthorised.json.error.code === "tab_closed",
		`-> ${unauthorised.text}`,
	);
	// --- 2b. the bind address, and what the rest of this machine's LAN can do --
	const hostLine = app.stream
		.join("")
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.includes("[browser] host on"));
	check(
		"the host publishes the loopback address it bound, naming the state file's port",
		Boolean(hostLine) && hostLine.includes(`127.0.0.1:${state.port}`),
		`${hostLine || "(no '[browser] host on' line in the log)"}\nstate file port=${state.port}`,
	);
	const lan = Object.values(networkInterfaces())
		.flat()
		.find((entry) => entry && entry.family === "IPv4" && !entry.internal);
	if (!lan) {
		say(
			"[SKIPPED] no non-loopback IPv4 on this machine: the off-host refusal could not be measured here",
		);
		record(
			"the off-host refusal (design 11.7 rule 1)",
			"[SKIPPED] this machine has no non-loopback IPv4 interface",
		);
	} else {
		const refused = await new Promise((resolve) => {
			const socket = connect({ host: lan.address, port: state.port, timeout: 2000 });
			socket.once("connect", () => {
				socket.destroy();
				resolve("CONNECTED");
			});
			socket.once("error", (error) => resolve(error.code ?? String(error)));
			socket.once("timeout", () => {
				socket.destroy();
				resolve("TIMEOUT");
			});
		});
		check(
			"a connection to this machine's non-loopback address is refused",
			refused !== "CONNECTED",
			`net.connect({host: "${lan.address}", port: ${state.port}}) -> ${refused}`,
		);
	}

	const statusCall = await rpc(state, "status", {});
	check(
		"a valid call answers the envelope the Python client expects",
		statusCall.status === 200 && statusCall.json?.id === "proof-status" && statusCall.json.ok === true,
		`-> ${statusCall.text.slice(0, 400)}`,
	);
	record("status", JSON.stringify(statusCall.json.result, null, 2));

	// --- 3. the origin gate --------------------------------------------------
	const unapproved = await rpc(state, "open", { url: `${siteOrigin}/`, requester: "session:proof" });
	check(
		"an agent open on an unapproved origin fails early, before any prompt",
		unapproved.status === 200 && unapproved.json?.error?.code === "origin_not_allowed",
		`-> ${unapproved.text}`,
	);

	// --- 4. the consent flow, answered through the app's own IPC -------------
	const approved = await approve(state, siteOrigin, "site");
	check(
		"request_access raises a prompt the app's chrome can answer, and await_access sees the decision",
		approved.requested.state === "pending" && approved.awaited.state === "allowed",
		`request_access -> ${JSON.stringify(approved.requested)}\nrespondToConsent (via window.api.browser) -> ${approved.answered?.value ?? approved.answered?.error}\nawait_access -> ${JSON.stringify(approved.awaited)}`,
	);

	// --- 5. a real page, driven ---------------------------------------------
	const opened = await rpcOk(state, "open", { url: `${siteOrigin}/`, requester: "session:proof" });
	const handle = opened.tab;
	say(`opened ${handle} -> ${opened.url} "${opened.title}"`);
	const read = await rpcOk(state, "read", { tab: handle });
	check(
		"read returns the page's text from the isolated world",
		read.text.includes("Browser host proof page") && read.url === `${siteOrigin}/`,
		`read.text starts: ${JSON.stringify(read.text.slice(0, 120))}... url=${read.url}`,
	);
	const isolation = await rpcOk(state, "read", {
		tab: handle,
		selector: "#isolation",
	});
	check(
		"the driven page's own script finds no bridge surface (no preload, sandboxed)",
		/isolation: api=undefined/.test(isolation.text) &&
			/ require=undefined/.test(isolation.text) &&
			/ process=undefined/.test(isolation.text) &&
			/ electron=undefined/.test(isolation.text),
		`the page reported back: ${JSON.stringify(isolation.text)}`,
	);
	const snapshot1 = await rpcOk(state, "snapshot", { tab: handle });
	check(
		"snapshot returns a pruned AX tree with refs",
		snapshot1.refs > 0 && snapshot1.snapshot.includes("[e"),
		`refs=${snapshot1.refs} epoch=${snapshot1.epoch}\n${snapshot1.snapshot.split("\n").slice(0, 12).join("\n")}`,
	);
	// The ref for the name field and the Go button, taken from the snapshot the
	// agent would have read.
	const nameRef = /- textbox "Name" \[(e\d+)\]/.exec(snapshot1.snapshot)?.[1];
	const goRef = /- button "Go" \[(e\d+)\]/.exec(snapshot1.snapshot)?.[1];
	check("the snapshot exposes the controls by ref", Boolean(nameRef && goRef), `name=${nameRef} go=${goRef}`);
	const typed = await rpcOk(state, "type", { tab: handle, ref: nameRef, text: "Ada Lovelace" });
	check(
		"type lands in the field and reads back",
		typed.value === "Ada Lovelace",
		`type -> ${JSON.stringify(typed)}`,
	);
	const clicked = await rpcOk(state, "click", { tab: handle, ref: goRef });
	const readAfter = await rpcOk(state, "read", { tab: handle });
	check(
		"click fires the page's handler (the click reads back as the page wrote it)",
		readAfter.text.includes("clicked with Ada Lovelace") && clicked.navigated === false,
		`click -> ${JSON.stringify(clicked)}\nread after click: ${JSON.stringify(readAfter.text.slice(0, 160))}`,
	);
	// Taken BEFORE the scroll below: the frame should be the page the agent just
	// read, and a capture after scrolling to the bottom is a gradient and a
	// scrollbar (which is what the first version of this harness produced).
	const shot = await rpcOk(state, "screenshot", { tab: handle });
	const shotPath = join(OUT_DIR, "proof-page.png");
	const bytes = Buffer.from(shot.data, "base64");
	writeFileSync(shotPath, bytes);
	check(
		"screenshot returns a PNG, written here and magic-checked",
		bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes.length > 10_000,
		`${shotPath}: ${bytes.length} bytes, magic ${bytes.subarray(0, 8).toString("hex")}, url=${shot.url}, title=${JSON.stringify(shot.title)}`,
	);

	const scrolled = await rpcOk(state, "scroll", { tab: handle, direction: "bottom" });
	check(
		"scroll moves the page and reports whether more remains",
		scrolled.scrollY > 0 && scrolled.moreBelow === false,
		`scroll -> ${JSON.stringify(scrolled)}`,
	);
	const logs = await rpcOk(state, "logs", { tab: handle });
	const levels = new Set(logs.entries.map((entry) => entry.level));
	check(
		"logs carry console output and the uncaught exception",
		logs.entries.length >= 4 && levels.has("error") && levels.has("warning") && levels.has("log"),
		`${logs.entries.length} entries\n${logs.entries.map((entry) => `  ${entry.level} [${entry.source}] ${entry.text.replace(/\n/g, " ").slice(0, 90)}`).join("\n")}`,
	);
	// The page records the permission outcome asynchronously, so poll for it rather
	// than racing it.
	let geoText = await rpcOk(state, "read", { tab: handle, selector: "#geo" });
	for (let attempt = 0; attempt < 20 && geoText.text.includes("not asked"); attempt += 1) {
		await sleep(250);
		geoText = await rpcOk(state, "read", { tab: handle, selector: "#geo" });
	}
	check(
		"a permission request is denied by default",
		geoText.text.includes("denied"),
		`geolocation result on the page: ${JSON.stringify(geoText.text)}`,
	);
	const popupText = await rpcOk(state, "read", { tab: handle, selector: "#popup" });
	const tabsAfterPopup = await rpcOk(state, "tabs", { requester: "session:proof" });
	check(
		"a popup is blocked and creates no tab",
		popupText.text.includes("blocked") && tabsAfterPopup.tabs.length === 1,
		`popup result on the page: ${JSON.stringify(popupText.text)}; tabs now ${tabsAfterPopup.tabs.length}`,
	);
	// --- 6. a navigation, and the epoch it invalidates ----------------------
	const staleClick = await rpc(state, "click", { tab: handle, ref: goRef });
	const navigated = await rpcOk(state, "goto", { tab: handle, url: `${siteOrigin}/page2`, requester: "session:proof" });
	const afterNav = await rpc(state, "click", { tab: handle, ref: goRef });
	check(
		"a goto re-reports the page that arrived, and a pre-navigation ref is refused",
		navigated.url === `${siteOrigin}/page2` && afterNav.json?.error?.code === "element_not_found",
		`goto -> ${JSON.stringify(navigated)}\nclick with the pre-navigation ref -> ${afterNav.text}`,
	);
	check(
		"the ref was valid before the navigation",
		staleClick.json?.ok === true,
		`same ref before the navigation -> ${staleClick.text.slice(0, 200)}`,
	);

	// --- 6b. a page that never answers: the typed timeout, inside the budget ---
	//
	// The published budget is `COMMAND_TIMEOUTS_S.goto` = 30 s, and the session
	// client gives up at that plus its own 5 s slack. The settle's ceiling is the
	// budget, so the typed code has to arrive inside it — which is exactly what
	// did NOT happen while `loadURL` was awaited first under a 35 s deadline.
	const hungStarted = Date.now();
	const hung = await rpc(state, "goto", {
		tab: handle,
		url: `${siteOrigin}/slow`,
		requester: "session:proof",
	});
	const hungElapsed = Date.now() - hungStarted;
	check(
		"a hung navigation ends as the typed nav_timeout, inside the published budget",
		hung.json?.ok === false &&
			hung.json?.error?.code === "nav_timeout" &&
			hungElapsed < 35_000,
		`goto ${siteOrigin}/slow -> ${hung.text}\nelapsed ${hungElapsed}ms against the 30 s budget (the client's deadline is 35 s)`,
	);

	// The lane must be free again and the tab usable: a timed-out navigation that
	// left the tab wedged for the rest of its life would be a worse bug than the
	// untyped timeout it replaced.
	const afterHung = await rpc(state, "goto", {
		tab: handle,
		url: `${siteOrigin}/page2`,
		requester: "session:proof",
	});
	check(
		"the tab is usable again after a timed-out navigation",
		afterHung.json?.ok === true && afterHung.json.result.url === `${siteOrigin}/page2`,
		`goto ${siteOrigin}/page2 after the timeout -> ${afterHung.text}`,
	);

	// --- 7. the renderer cannot reach the RPC --------------------------------
	const rendererReach = await rendererEvaluate(
		`(async () => {
			try {
				const response = await fetch("http://127.0.0.1:${state.port}/rpc", {
					method: "POST",
					headers: { "Content-Type": "application/json", "X-Bridge-Key": "whatever" },
					body: JSON.stringify({ id: "x", method: "status", params: {} })
				});
				const body = await response.text();
				return "REACHED IT: " + response.status + " " + body.slice(0, 80);
			} catch (error) {
				return "blocked: " + String(error);
			}
		})()`,
		{ collectLogs: true },
	);
	check(
		"the app's own renderer cannot use the agent's RPC",
		String(rendererReach.value).startsWith("blocked:"),
		`from the renderer: ${rendererReach.value ?? rendererReach.error}\nchromium's own reason: ${(rendererReach.logged ?? []).filter((line) => /CORS|blocked|fetch|Access-Control/i.test(line)).slice(-3).join(" | ") || "(no console line captured)"}`,
	);
	const rendererNoCors = await rendererEvaluate(
		`(async () => {
			try {
				const response = await fetch("http://127.0.0.1:${state.port}/rpc", {
					method: "POST", mode: "no-cors",
					headers: { "Content-Type": "text/plain" },
					body: "{}"
				});
				return "status " + response.status + ", type " + response.type + ", readable: " + JSON.stringify(await response.text());
			} catch (error) {
				return "blocked: " + String(error);
			}
		})()`,
		{ collectLogs: true },
	);
	check(
		"a no-cors attempt yields nothing readable either",
		typeof rendererNoCors.value === "string" &&
			(rendererNoCors.value.startsWith("blocked:") ||
				(rendererNoCors.value.includes("type opaque") && rendererNoCors.value.includes('readable: ""'))),
		`from the renderer: ${rendererNoCors.value ?? rendererNoCors.error}\nchromium's own reason: ${(rendererNoCors.logged ?? []).filter((line) => /CORS|blocked|fetch|Access-Control|private/i.test(line)).slice(-3).join(" | ") || "(no console line captured)"}`,
	);

	// --- 8. where the jar lives, and what is in it ---------------------------
	const profileDir = statusCall.json.result.profile_dir;
	// Compared against the REAL path: on macOS Electron's `getStoragePath()` returns
	// `/private/var/...` where the scratch dir was created as `/var/...`, and a
	// string prefix check would fail for a correct answer.
	const realUserData = realpathSync(USER_DATA);
	check(
		"the host publishes the resolved storage path of the persistent partition",
		typeof profileDir === "string" &&
			profileDir.startsWith(realUserData) &&
			profileDir.includes("Partitions"),
		`profile_dir=${profileDir} (persistent=${statusCall.json.result.profile_persistent}, user_agent=${statusCall.json.result.user_agent})`,
	);
	// The cookie store is read with a tool that is not this app, AFTER the app has
	// quit (see the restart step below): Chromium keeps cookies in memory and writes
	// them lazily, so a read against a running app reports an empty table and would
	// have "measured" the wrong thing.
	await rpcOk(state, "open", { url: `${siteOrigin}/set`, requester: "session:proof" });
	const echoBefore = await rpcOk(state, "goto", { tab: handle, url: `${siteOrigin}/echo`, requester: "session:proof" });
	const echoBeforeRead = await rpcOk(state, "read", { tab: handle });
	record("cookies the jar sent before restart", echoBeforeRead.text);
	say(`before restart, /echo received: ${echoBeforeRead.text.trim()}`);

	// --- 9. restart: what survives -------------------------------------------
	const logPath = app.logPath;
	await stopApp();
	const logBefore = readFileSync(logPath, "utf8");
	// Chromium's own cookie store, read now that the app has written and released it.
	const cookieDb = join(profileDir, "Cookies");
	const cookieQuery = await run("/usr/bin/sqlite3", [
		cookieDb,
		"select host_key,name,is_persistent,has_expires from cookies order by name;",
	]);
	const cookieRows = cookieQuery.stdout.trim();
	check(
		"the persistent cookie is in Chromium's own store, with the flags to match",
		cookieRows.split("\n").some((row) => row.includes("persistent") && row.includes("|1|1")),
		`sqlite3 ${cookieDb} "select host_key,name,is_persistent,has_expires from cookies order by name"\n${cookieRows || "(no rows)"}\nstderr: ${cookieQuery.stderr.trim() || "(none)"}`,
	);
	record(
		"what the cookie store held after a clean quit",
		cookieRows ||
			"(no rows: Chromium had not written any cookie to disk, which is itself the measurement)",
	);
	await sleep(1500);
	app = await launchApp();
	state = await waitForState();
	say(`restarted: new port ${state.port}, same profile ${state.profile_dir}`);
	const persistedApproval = await rpcOk(state, "open", { url: `${siteOrigin}/echo`, requester: "session:proof" });
	const echoAfter = await rpcOk(state, "read", { tab: persistedApproval.tab });
	check(
		"an approved origin stays approved across a restart (the grant is durable)",
		typeof persistedApproval.tab === "string" && persistedApproval.tab.startsWith("ui:"),
		`open after restart -> ${JSON.stringify({ tab: persistedApproval.tab, url: persistedApproval.url })}`,
	);
	record("cookies the jar sent after restart", echoAfter.text);
	say(`after restart, /echo received: ${echoAfter.text.trim()}`);
	const sessionSurvived = echoAfter.text.includes("session_only=1");
	const persistentSurvived = echoAfter.text.includes("persistent=1");
	check(
		"MEASURED: a persistent cookie survives the restart",
		persistentSurvived,
		`after restart /echo saw: ${echoAfter.text.trim()}`,
	);
	say(
		`[MEASURED] session cookie across a clean restart: ${sessionSurvived ? "SURVIVED" : "DID NOT SURVIVE"} (the design predicted it would not — P2)`,
	);
	record(
		"session-cookie-across-restart (probe P2)",
		`before restart: ${echoBeforeRead.text.trim()}\nafter restart:  ${echoAfter.text.trim()}\nsession cookie survived: ${sessionSurvived}\npersistent cookie survived: ${persistentSurvived}\nnote: this is a clean SIGTERM quit; the design's P2 asks for the SIGKILL case as well.`,
	);

	// --- 9b. clearing browsing data, and what it does NOT touch --------------
	const cleared = await rendererEvaluate(
		'window.api.browser.clearData("cookies").then((s) => JSON.stringify(s))',
	);
	await sleep(1000);
	const afterClear = await rpcOk(state, "goto", {
		tab: persistedApproval.tab,
		url: `${siteOrigin}/echo`,
		requester: "session:proof",
	});
	const afterClearRead = await rpcOk(state, "read", { tab: persistedApproval.tab });
	const afterClearStatus = await rpcOk(state, "status", {});
	check(
		"clearing cookies empties the jar over the app's own IPC",
		cleared.value?.includes("cookies") === true && afterClearRead.text.includes("(none)"),
		`window.api.browser.clearData("cookies") -> ${cleared.value ?? cleared.error}\nafter clearing, /echo saw: ${afterClearRead.text.trim()}`,
	);
	check(
		"clearing cookies does NOT revoke the agent's approvals (they are policy, not data)",
		afterClearStatus.approvals.allowed_origins >= 1 || afterClearStatus.approvals.broad_grants >= 1,
		`status.approvals after the clear: ${JSON.stringify(afterClearStatus.approvals)}`,
	);
	void afterClear;

	// --- 10. the host's own log ---------------------------------------------
	const finalLogPath = app.logPath;
	await stopApp();
	const logAfter = readFileSync(finalLogPath, "utf8");
	const browserLines = (logAfter + logBefore).split("\n").filter((line) => line.includes("[browser]"));
	check(
		"the host logged its denials and its decisions",
		browserLines.some((line) => line.includes("denied a geolocation")) && browserLines.some((line) => line.includes("blocked a popup")),
		browserLines.slice(0, 40).join("\n"),
	);
	record("app log lines from the browser host", browserLines.slice(0, 60).join("\n"));

	const summary = [
		"# Browser host end-to-end proof",
		"",
		`Scratch: \`${SCRATCH}\``,
		`Runs: two (a clean quit, then a restart against the same profile)`,
		`Result: ${failures === 0 ? "every check passed" : `${failures} check(s) FAILED`}`,
		"",
		transcript.join("\n"),
	].join("\n");
	writeFileSync(join(OUT_DIR, "proof.md"), summary);
	say(`\ntranscript: ${join(OUT_DIR, "proof.md")}`);
	say(`screenshots: ${OUT_DIR}`);
	if (failures > 0) process.exitCode = 1;
	for (const response of held) response.destroy();
	await site.server.close();
}

function run(command, args) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
		child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

main()
	.catch(async (error) => {
		console.error("proof run failed:", error);
		writeFileSync(
			join(OUT_DIR, "proof.md"),
			`# Browser host end-to-end proof\n\nFAILED: ${error?.stack ?? error}\n\n${transcript.join("\n")}`,
		);
		process.exitCode = 1;
	})
	.finally(async () => {
		// A failed run must not leave an app behind holding the scraping port and a
		// state file — the leftover is what made the previous failure so confusing.
		await stopApp();
	});
