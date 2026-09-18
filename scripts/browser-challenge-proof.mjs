#!/usr/bin/env node
/**
 * Proof for the two browser defects this branch fixes: a page inside a driven
 * tab that can never complete a challenge, and passkeys that never reach the OS.
 *
 * WHY IT IS A COMMITTED RIG rather than a pasted transcript: a transcript cannot
 * be re-run, and both claims here are about a RUNNING application. It boots a
 * BUILT app tree — parameterised with `--app-tree`, so the same file runs against
 * a BEFORE arm (origin/main in a second worktree) and an AFTER arm (this branch)
 * — drives the browser host over its own `/rpc`, and prints one machine-readable
 * line per sample.
 *
 * TWO ARMS, and why the deterministic one is the headline:
 *
 *   --arm local (default)  A caption-shaped local reproduction, no Cloudflare:
 *                          the top page is on origin A and reports COMPLETE only
 *                          when a cross-origin iframe on origin B posts back a
 *                          token. The navigation is made the way an agent makes
 *                          it (request_access -> the user's decision ->
 *                          await_access -> open), so the per-hop origin gate is
 *                          armed and only A is approved. Before the gate fix the
 *                          B document is failed with BlockedByClient and the
 *                          challenge never completes; after it, it completes.
 *                          Deterministic, so `--attempts` can honestly report
 *                          3/3 rather than "it passed once".
 *
 *   --arm ua               The SAME run as `--arm cloudflare`, under the name that
 *                          says what the two trees differ in for it: the app's user
 *                          agent is compiled into the host
 *                          (`src/main/browser/profile.ts`), so before/after IS
 *                          two trees — origin/main presents
 *                          `… Safari/537.36 LocalOperator/<version>` and this
 *                          branch presents Chrome's own string with no product
 *                          token. Every sample carries the UA the page ACTUALLY
 *                          presented, and the arm's own lines report it, because
 *                          an arm that sets a UA on a session the page is not in
 *                          reports Electron's default and passes a challenge the
 *                          real shape fails.
 *
 *   --arm cloudflare       The real site from the operator's report, as
 *                          CORROBORATION ONLY. Two honest limits travel with it:
 *                          Cloudflare's own decisions differ per request, so the
 *                          result is reported as a RATE over the attempts; and
 *                          this arm cannot distinguish "the gate refused the
 *                          widget" from "the tab was invisible and Cloudflare's
 *                          widget refuses to solve on a hidden page" — which is
 *                          why it runs `--window-mode=inactive` (a visible,
 *                          never-activated window) while the local arm runs
 *                          `headless`. That window is visible on the operator's
 *                          screen, so this arm is never the default.
 *
 * Isolation (every piece of it is load-bearing, see AGENTS.md):
 *   - `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` are both redirected, and so is
 *     `LOCAL_OPERATOR_LOG_DIR`, the one path HOME cannot move (the app's logger
 *     defaults to the OS account's home).
 *   - a scratch `--user-data-dir`, so the run cannot see or touch the operator's
 *     profile — and cannot leak its own state into it.
 *   - every `CMUX_*`/`LOP_*` variable is removed before the child is spawned: an
 *     inherited `CMUX_WORKSPACE_ID` has already renamed the operator's real cmux
 *     workspaces once.
 *   - `withNotificationsOff`: the app spawns a backend whose parked-gate
 *     announcement reaches macOS through `osascript`, i.e. a banner in the
 *     operator's real Notification Center.
 *   - the runtime binary is spawned, never `node_modules/.bin/electron` (that is
 *     a Node shim: killing it orphans the app, which keeps the single-instance
 *     lock and the debugging port), `detached: true`, and the tree is reaped by
 *     `app-tree-teardown.mjs` (group signal, then a `--user-data-dir` backstop).
 *
 * Usage:
 *   node scripts/browser-challenge-proof.mjs --app-tree <dir>
 *     [--arm local|cloudflare|ua|both|all]
 *     [--attempts N] [--url <url>] [--keep] [--out <dir>]
 */

import { execFile, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import {
	onInterrupted,
	reapOnExit,
	stopAppTree,
} from "./app-tree-teardown.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";

const ELECTRON_BIN = createRequire(import.meta.url)("electron");

/** The URL from the operator's report: the page whose captcha never passed. */
const DEFAULT_CLOUDFLARE_URL =
	"https://muddyrivernews.com/community/quincy-beginnings-its-girl-power-era-with-its-new-mayor-leading-the-charge/20250505070339/";

function argValue(name, fallback = null) {
	const index = process.argv.indexOf(name);
	return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const APP_TREE = resolve(argValue("--app-tree", process.cwd()));
const ARM = argValue("--arm", "local");
const ATTEMPTS = Number(argValue("--attempts", "3"));
const CLOUDFLARE_URL = argValue("--url", DEFAULT_CLOUDFLARE_URL);
const KEEP = process.argv.includes("--keep");
const OUT_DIR = resolve(
	argValue(
		"--out",
		join(tmpdir(), `lo-browser-challenge-proof-${process.pid}`, "out"),
	),
);
const SCRATCH = join(tmpdir(), `lo-browser-challenge-proof-${process.pid}`);

const transcript = [];
let failures = 0;

function say(line) {
	console.log(line);
}

function record(label, body) {
	transcript.push(`### ${label}\n\n\`\`\`\n${body}\n\`\`\`\n`);
}

/**
 * One assertion, reported into the transcript as well as the console.
 *
 * WHY THE WEBAUTHN ARM NEEDS THIS AND THE NAVIGATION ARMS DO NOT: a challenge
 * arm's verdict is a rate over attempts, and its transcript is the samples. A
 * chooser arm makes a dozen claims of different shapes — a row fits its own box,
 * a sentence stays inside the panel, a callback carried a particular credential
 * id — and a claim that is only `say`-ed cannot fail the run.
 */
function check(label, ok, detail) {
	if (!ok) failures += 1;
	say(
		`[${ok ? "PASS" : "FAIL"}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`,
	);
	record(label, `[${ok ? "PASS" : "FAIL"}] ${detail ?? ""}`);
	return ok;
}

const sleep = (ms) => new Promise((resolveTick) => setTimeout(resolveTick, ms));

function pickPort() {
	return 9600 + Math.floor(Math.random() * 800);
}

// ---- the local challenge, on two origins ----------------------------------

/**
 * The pages, and why they need TWO origins.
 *
 * The defect is about a CROSS-origin iframe document being refused by a gate
 * that was only ever meant to decide navigation hops, so a same-origin frame
 * would not reproduce it. B's widget needs animation frames and a chain of
 * timers before it posts its token, which is also what a real challenge widget
 * needs — and what a throttled or frozen renderer cannot provide.
 */
const TOP_PAGE = (
	widgetUrl,
) => `<!doctype html><meta charset="utf-8"><title>challenge top</title>
<body style="font:14px system-ui;padding:16px">
<h1>Challenge top (origin A)</h1>
<p id="state">PENDING</p>
<iframe id="widget" src="${widgetUrl}" width="320" height="180"></iframe>
<script>
  window.__challenge = "PENDING";
  window.__widget = "none";
  window.__widgetRaf = null;
  window.__widgetStep = null;
  window.__raf = 0;
  (function tick() { window.__raf++; requestAnimationFrame(tick); })();
  addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "widget-ready") { window.__widget = "ready"; window.__widgetRaf = data.raf; return; }
    if (data.type === "progress") { window.__widgetStep = data.step; window.__widgetRaf = data.raf; return; }
    if (data.type === "token") {
      window.__widget = "token";
      window.__widgetRaf = data.raf;
      window.__challenge = "COMPLETE";
      document.getElementById("state").textContent = "COMPLETE";
    }
  });
  // A widget whose document was refused never reaches "ready" at all, which is
  // what the samples carry as widget=none (the refusal itself is in the app log).
</script>
</body>`;

/**
 * The widget, and WHY ITS PROOF OF WORK IS A TIMER CHAIN RATHER THAN FRAMES.
 *
 * The token depends on `setTimeout`, which is the machinery a challenge widget
 * needs and which a frozen page cannot provide. `requestAnimationFrame` is
 * COUNTED and REPORTED alongside it, never required: measured on this rig, a
 * cross-origin subframe's own rAF ticks can stay at 0 while its timers run, and
 * a proof that demanded frames would have failed for a reason that is not the
 * defect under test. So the completion criterion is the timer chain; the frame
 * count is evidence a reader can see.
 */
const WIDGET_PAGE = `<!doctype html><meta charset="utf-8"><title>challenge widget</title>
<body style="font:14px system-ui;padding:8px"><p id="w">widget running</p>
<script>
  window.__raf = 0;
  (function tick() { window.__raf++; requestAnimationFrame(tick); })();
  const report = (payload) => parent.postMessage({ raf: window.__raf, ...payload }, "*");
  report({ type: "widget-ready" });
  // ~20 timer steps before the token.
  (function chain(n) {
    if (n === 0) { report({ type: "token", token: "tok-" + Date.now() }); return; }
    setTimeout(() => {
      report({ type: "progress", step: 20 - n + 1 });
      chain(n - 1);
    }, 40);
  })(20);
</script>
</body>`;

function startServer(name, routes) {
	return new Promise((resolveListen) => {
		const server = createServer((request, response) => {
			const route = routes[request.url];
			if (!route) {
				response.writeHead(404, { "Content-Type": "text/plain" });
				response.end("no route");
				return;
			}
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end(route);
		});
		server.listen(0, "127.0.0.1", () => {
			say(`[rig] ${name} listening on 127.0.0.1:${server.address().port}`);
			resolveListen(server);
		});
	});
}

// ---- the app ---------------------------------------------------------------

let app = null;
let devtoolsPort = 0;

async function freeDevtoolsPort(timeoutMs = 10_000) {
	const started = Date.now();
	for (;;) {
		const port = pickPort();
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (!response.ok) return port;
		} catch (error) {
			if (error instanceof TypeError) return port;
			throw error;
		}
		if (Date.now() - started > timeoutMs)
			throw new Error("no free devtools port");
	}
}

/**
 * The MAIN-process inspector port, used by the WebAuthn arm only.
 *
 * WHY THE RIG NEEDS ONE AT ALL: a passkey request cannot be raised on this
 * machine from a page — the platform authenticator is inert on an unsigned build
 * (`src/main/webauthn.ts`'s gate), and Chromium answers a virtual authenticator
 * inside the renderer without ever routing account selection to the embedder
 * (QA round 1, Q2). So the one honest way to exercise the shipped listener, the
 * chooser, the renderer dialog and the answer back into Electron is to emit
 * `select-webauthn-account` on the real Session object from main, which is what
 * the arm does. Everything downstream of that emit is the app's own code; only
 * the trigger is synthetic, and the arm says so in its output.
 */
function launchApp(windowMode, { inspectPort = 0 } = {}) {
	const env = withNotificationsOff({
		...process.env,
		HOME: join(SCRATCH, "home"),
		LOCAL_OPERATOR_CONFIG_DIR: join(SCRATCH, "config"),
		LOCAL_OPERATOR_LOG_DIR: join(SCRATCH, "logs"),
		LOCAL_OPERATOR_UI_WINDOW_MODE: windowMode,
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	const userData = join(SCRATCH, "userdata");
	const child = spawn(
		ELECTRON_BIN,
		[
			// The inspector switch must come BEFORE the app path: Electron reads it as
			// a runtime flag, and a flag after the path belongs to the app's own argv.
			...(inspectPort ? [`--inspect=${inspectPort}`] : []),
			APP_TREE,
			`--user-data-dir=${userData}`,
			`--remote-debugging-port=${devtoolsPort}`,
			"--window-size=1380x900",
			`--window-mode=${windowMode}`,
		],
		{
			env,
			cwd: APP_TREE,
			// `detached` is what makes the group signal possible; the profile reap in
			// `stopAppTree` is the backstop for a process re-parented out of it.
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const logPath = join(SCRATCH, `app-${Date.now()}.log`);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const flush = () => writeFileSync(logPath, stream.join(""));
	const timer = setInterval(flush, 500);
	let exited = false;
	child.on("exit", () => {
		exited = true;
		clearInterval(timer);
		flush();
	});
	const handle = {
		child,
		userData,
		logPath,
		stream,
		flush,
		exited: () => exited,
	};
	reapOnExit({ pid: child.pid, userData });
	app = handle;
	return handle;
}

async function stopApp() {
	const stopping = app;
	app = null;
	if (!stopping) return null;
	stopping.flush();
	const result = await stopAppTree({
		pid: stopping.child.pid,
		userData: stopping.userData,
		isExited: () => stopping.exited(),
	});
	stopping.flush();
	say(
		`[rig] teardown clean=${result.clean} groupSignalled=${result.groupSignalled} escalated=${result.escalated} reaped=${result.reaped.length} survivors=${result.survivors.length}`,
	);
	return result;
}

// ---- the host, over its own state file and /rpc ----------------------------

function stateFilePath() {
	return join(SCRATCH, "config", "run", "ui-browser", "host.json");
}

async function hostIsLive(file) {
	if (!file?.port || !file?.pid) return false;
	try {
		const response = await fetch(`http://127.0.0.1:${file.port}/health`);
		if (!response.ok) return false;
		const body = await response.json();
		return body?.pid === file.pid;
	} catch {
		return false;
	}
}

async function waitForState(timeoutMs = 90_000) {
	const started = Date.now();
	let seen = "";
	while (Date.now() - started < timeoutMs) {
		if (existsSync(stateFilePath())) {
			try {
				const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
				seen = `port ${parsed.port} pid ${parsed.pid}`;
				if (await hostIsLive(parsed)) return parsed;
			} catch {
				// The writer stages its file; this is the "not yet" case.
			}
		}
		await sleep(250);
	}
	throw new Error(
		`no LIVE host answered /health at ${stateFilePath()} (${seen})`,
	);
}

async function rpc(state, method, params = {}, options = {}) {
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Bridge-Key": state.session_key,
		},
		body: JSON.stringify({ id: options.id ?? `rig-${method}`, method, params }),
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		// Not JSON: the status is the fact.
	}
	return { status: response.status, text, json };
}

// ---- the app's renderer, over CDP -----------------------------------------

let nextId = 1;
const pending = new Map();

/** Two patterns the rig matches on, hoisted so a loop does not rebuild them. */
const PNG_DATA_URL = /^data:image\/png;base64,/;
const CHALLENGE_TITLE = /just a moment|verifying you are human/i;

async function targets() {
	const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
	return await response.json();
}

async function connectTarget(match, label, timeoutMs = 60_000, listUrl = null) {
	const started = Date.now();
	for (;;) {
		const list = await (listUrl
			? fetch(listUrl).then((response) => response.json())
			: targets()
		).catch(() => []);
		const target = list.find(match);
		if (target?.webSocketDebuggerUrl) {
			const ws = new WebSocket(target.webSocketDebuggerUrl);
			await new Promise((resolveOpen, rejectOpen) => {
				ws.addEventListener("open", resolveOpen, { once: true });
				ws.addEventListener("error", rejectOpen, { once: true });
			});
			ws.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id === undefined) return;
				const entry = pending.get(message.id);
				if (!entry) return;
				pending.delete(message.id);
				if (message.error) entry.reject(new Error(message.error.message));
				else entry.resolve(message.result);
			});
			let id = nextId;
			return {
				label,
				target,
				send(method, params = {}) {
					const callId = ++id;
					nextId = Math.max(nextId, callId + 1);
					return new Promise((resolveSend, rejectSend) => {
						pending.set(callId, { resolve: resolveSend, reject: rejectSend });
						ws.send(JSON.stringify({ id: callId, method, params }));
					});
				},
				close() {
					try {
						ws.close();
					} catch {
						// Already closed.
					}
				},
			};
		}
		if (Date.now() - started > timeoutMs)
			throw new Error(`${label} never appeared`);
		await sleep(250);
	}
}

/** The APP's own renderer: identified by its `file://` scheme, because a driven
 * page is a `page` target too and attaching to one evaluates `window.api` inside
 * a sandboxed document that has none. */
const connectRenderer = () =>
	connectTarget(
		(target) =>
			target.type === "page" &&
			typeof target.url === "string" &&
			target.url.startsWith("file://") &&
			target.url.includes("index.html") &&
			!target.url.startsWith("devtools://"),
		"the app's own renderer",
	);

/** The driven page: matched by the origin the attempt navigated to. */
const connectDriven = (prefix) =>
	connectTarget(
		(target) =>
			target.type === "page" &&
			typeof target.url === "string" &&
			target.url.startsWith(prefix),
		`the driven page at ${prefix}`,
	);

async function evaluate(client, expression, timeoutMs = 6000) {
	return await Promise.race([
		client.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		}),
		new Promise((resolveTimeout) =>
			setTimeout(() => resolveTimeout({ timedOut: true }), timeoutMs),
		),
	]);
}

async function evaluateValue(client, expression, timeoutMs = 6000) {
	const result = await evaluate(client, expression, timeoutMs);
	if (result?.timedOut) return { hung: `no answer in ${timeoutMs}ms` };
	if (result?.exceptionDetails)
		return { error: result.exceptionDetails.text ?? "threw" };
	return result?.result?.value;
}

/** The app's browser route, opened the way a person opens it. */
async function openBrowserRoute(renderer) {
	return await waitFor(async () => {
		const present = await evaluateValue(
			renderer,
			`document.querySelector('[data-tour-tag="nav-item-browser"]') ? 'y' : ''`,
		);
		if (present !== "y") return false;
		await evaluateValue(
			renderer,
			`(() => { const el = document.querySelector('[data-tour-tag="nav-item-browser"]'); el.click(); return 'clicked'; })()`,
		);
		await sleep(400);
		const hash = await evaluateValue(renderer, "location.hash");
		return typeof hash === "string" && hash.includes("/browser") ? hash : false;
	}, "the browser route");
}

async function waitFor(predicate, label, timeoutMs = 30_000) {
	const started = Date.now();
	for (;;) {
		const value = await predicate();
		if (value) return value;
		if (Date.now() - started > timeoutMs)
			throw new Error(`timed out waiting for ${label}`);
		await sleep(250);
	}
}

async function contentRect(renderer) {
	return await evaluateValue(
		renderer,
		`(() => {
			const el = document.querySelector('[data-tour-tag="browser-content"]');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
		})()`,
	);
}

async function viewport(renderer) {
	return await evaluateValue(
		renderer,
		"({ width: window.innerWidth, height: window.innerHeight })",
	);
}

/**
 * The composite frame: the app's renderer over CDP (the chrome and everything
 * the app paints) plus the HOST's own `screenshot` action for the driven page,
 * at the rectangle the renderer reports. A native view is not in the DOM and the
 * page's own capture cannot see the chrome, so neither layer alone is a frame.
 */
async function captureFrame(name, { renderer, state, token, rect, view }) {
	const chrome = await renderer.send("Page.captureScreenshot", {
		format: "png",
	});
	const chromePath = join(OUT_DIR, `${name}-chrome.png`);
	writeFileSync(chromePath, Buffer.from(chrome.data, "base64"));
	if (!state || !token) return chromePath;
	const shot = await rpc(state, "screenshot", { tab: token });
	const data = shot.json?.result?.data;
	if (typeof data !== "string") {
		record(
			`page capture ${name}`,
			`FAILED: ${shot.status} ${shot.text.slice(0, 200)}`,
		);
		return chromePath;
	}
	const pagePath = join(OUT_DIR, `${name}-page.png`);
	writeFileSync(
		pagePath,
		Buffer.from(data.replace(PNG_DATA_URL, ""), "base64"),
	);
	if (!rect || !view) return chromePath;
	const meta = await sharp(chromePath).metadata();
	const scale = (meta.width ?? view.width) / view.width;
	const page = await sharp(pagePath)
		.resize(Math.round(rect.width * scale), Math.round(rect.height * scale), {
			fit: "fill",
		})
		.toBuffer();
	const path = join(OUT_DIR, `${name}.png`);
	await sharp(chromePath)
		.composite([
			{
				input: page,
				left: Math.round(rect.x * scale),
				top: Math.round(rect.y * scale),
			},
		])
		.png()
		.toFile(path);
	return path;
}

// ---- one attempt -----------------------------------------------------------

/** The page probe: everything that tells "the page is running" from "the page is
 * frozen", plus the challenge's own state. */
const PAGE_PROBE = `(() => {
  const frame = document.getElementById('widget');
  return {
    title: document.title,
    url: location.href,
    // The UA the page ACTUALLY presented, not the one the app asked for: an arm
    // that sets a UA on a session the page is not in reports Electron's default
    // and passes a challenge the real shape fails, which is the trap this field
    // exists to close.
    ua: navigator.userAgent,
    vis: document.visibilityState,
    raf: typeof window.__raf === 'number' ? window.__raf : null,
    status: window.__challenge ?? 'n/a',
    widget: window.__widget ?? 'n/a',
    widgetRaf: window.__widgetRaf ?? null,
    widgetStep: window.__widgetStep ?? null,
    frames: window.frames.length,
  };
})()`;

/** A probe that first awaits a 2 s timer: a throttled or frozen renderer never
 * answers it at all, which is the mechanism behind "the captcha never passes". */
const TIMER_PROBE = `(async () => {
  const before = Date.now();
  await new Promise((r) => setTimeout(r, 2000));
  return JSON.stringify({ waited: Date.now() - before, ...(${PAGE_PROBE}) });
})()`;

async function samplePage(client, attempt, index) {
	const value = await evaluateValue(client, TIMER_PROBE, 8000);
	const line = normaliseSample(value);
	say(`SAMPLE attempt=${attempt} n=${index} ${JSON.stringify(line)}`);
	record(`sample ${attempt}.${index}`, JSON.stringify(line));
	return value;
}

/** A sample is either the page's own JSON string, an error object, or the
 * "no answer" object a frozen renderer produces. One shape for the reader. */
function normaliseSample(value) {
	if (typeof value === "string") {
		try {
			return JSON.parse(value);
		} catch {
			return { raw: value };
		}
	}
	if (value && typeof value === "object") return value;
	return { no: "answer" };
}

/** The app's own log for the current boot, as lines. Read while the app is still
 * up: the gate's refusal line is the direct evidence that a subframe document
 * was failed, and it exists only in that file. */
function readAppLog() {
	if (!app?.logPath || !existsSync(app.logPath)) return [];
	return readFileSync(app.logPath, "utf8").split("\n");
}

async function cookieNames(client) {
	try {
		const cookies = await client.send("Storage.getCookies", {});
		return (cookies?.cookies ?? []).map((cookie) => cookie.name);
	} catch {
		return [];
	}
}

/**
 * Approve ONE origin the way the operator does, then navigate with the agent's own
 * gated path. Shared by both arms so the two cannot drift into different flows:
 * ask (`request_access`), answer in the app's own chrome (`respondToConsent`),
 * wait for the decision (`await_access`), then `open`.
 *
 * Only the TOP-LEVEL origin is ever approved. That is the whole experiment: the
 * page's own cross-origin iframe document is not approved and must still run,
 * because a subframe document is not a navigation hop.
 */
async function approveAndOpen({ state, renderer, url, origin, attempt }) {
	const requested = await rpc(state, "request_access", {
		url: origin,
		requester: "session:proof-rig",
	});
	let answered = null;
	if (requested.json?.result?.state !== "allowed") {
		const pending = await evaluateValue(
			renderer,
			"window.api.browser.state().then((s) => JSON.stringify(s.pendingConsent))",
		);
		const entries = JSON.parse(pending ?? "[]");
		const entry = entries.find((candidate) => candidate.origin === origin);
		if (!entry) {
			throw new Error(
				`no pending consent for ${origin}: ${JSON.stringify(pending)}`,
			);
		}
		answered = await evaluateValue(
			renderer,
			`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, "site").then(() => "ok").catch((e) => "err:" + e.message)`,
		);
	}
	const awaited = await rpc(state, "await_access", {
		url: origin,
		requester: "session:proof-rig",
	});
	record(
		`the gate's entry for ${origin}`,
		`request_access -> ${requested.text.slice(0, 300)}\nrespondToConsent -> ${JSON.stringify(answered)}\nawait_access -> ${awaited.text.slice(0, 300)}`,
	);

	const opened = await rpc(state, "open", {
		url,
		requester: "session:proof-rig",
	});
	const token = opened.json?.result?.tab ?? null;
	// The app's own log lines, so a refusal names itself in the evidence rather
	// than only in the RPC reply.
	const browserLog = readAppLog()
		.filter((line) => line.includes("[browser]"))
		.slice(-6)
		.join("\n");
	record(
		`open ${url}`,
		`${opened.status} ${opened.text.slice(0, 600)}\n${browserLog}`,
	);
	say(
		`OPEN attempt=${attempt} status=${opened.status} ok=${Boolean(opened.json?.ok)} token=${Boolean(token)} result=${opened.text.slice(0, 300)}`,
	);
	return { opened, token };
}

async function runLocalAttempt({ attempt, servers }) {
	const originA = `http://127.0.0.1:${servers.a.address().port}`;
	const url = `${originA}/top.html`;
	const state = await waitForState();
	const renderer = await connectRenderer();
	await renderer.send("Runtime.enable").catch(() => {});
	await openBrowserRoute(renderer);
	const { token } = await approveAndOpen({
		state,
		renderer,
		url,
		origin: originA,
		attempt,
	});

	// A driven page is a target only once it exists, so this waits for it rather
	// than assuming the load finished inside the RPC's own reply.
	const driven = await connectDriven(`${originA}/`);
	await driven.send("Runtime.enable").catch(() => {});
	const samples = [];
	for (let index = 0; index < 6; index++) {
		samples.push(await samplePage(driven, attempt, index));
		await sleep(2000);
	}
	const cookies = await cookieNames(driven);
	const last = normaliseSample(samples.at(-1));
	const outcome = last.status === "COMPLETE" ? "PASS" : "FAIL";
	const refusals = readAppLog().filter((line) =>
		line.includes("refused a navigation hop"),
	).length;
	say(
		`RESULT arm=local attempt=${attempt} outcome=${outcome} status=${last.status} widget=${last.widget} raf=${last.raf} vis=${last.vis} refusals=${refusals} cookies=${JSON.stringify(cookies)}`,
	);
	record(
		`local attempt ${attempt}`,
		`outcome ${outcome}\nlast sample ${JSON.stringify(last)}\nrefusals of a navigation hop in the app log: ${refusals}\ncookies ${JSON.stringify(cookies)}`,
	);
	const rect = await contentRect(renderer);
	const view = await viewport(renderer);
	const frame = await captureFrame(`local-attempt${attempt}`, {
		renderer,
		state,
		token,
		rect,
		view,
	});
	say(`FRAME attempt=${attempt} ${frame}`);
	renderer.close();
	driven.close();
	return outcome === "PASS";
}

async function runRealSiteAttempt({ attempt, arm }) {
	const state = await waitForState();
	const renderer = await connectRenderer();
	await renderer.send("Runtime.enable").catch(() => {});
	await openBrowserRoute(renderer);
	const origin = new URL(CLOUDFLARE_URL).origin;
	const { token } = await approveAndOpen({
		state,
		renderer,
		url: CLOUDFLARE_URL,
		origin,
		attempt,
	});
	// Cloudflare's interstitial decides for itself how long to take: six samples
	// over ~40 s, which is the window the operator's own report covers.
	let driven = null;
	try {
		driven = await connectDriven("https://");
		await driven.send("Runtime.enable").catch(() => {});
	} catch (error) {
		record(
			`cloudflare attempt ${attempt}`,
			`no driven target: ${String(error)}`,
		);
	}
	const samples = [];
	for (let index = 0; index < 6; index++) {
		if (!driven) break;
		samples.push(await samplePage(driven, attempt, index));
		await sleep(6000);
	}
	const cookies = driven ? await cookieNames(driven) : [];
	const cleared = cookies.includes("cf_clearance");
	const last = normaliseSample(samples.at(-1));
	const passed = cleared && !CHALLENGE_TITLE.test(last.title ?? "");
	/*
	 * THE DECISIVE READING OF THIS ARM, and the one that does not depend on
	 * Cloudflare's mood: the gate's own refusal lines. A Cloudflare interstitial
	 * runs its Turnstile widget in a CROSS-ORIGIN iframe
	 * (`challenges.cloudflare.com`), so before the fix that widget's DOCUMENT is
	 * one of the hops the gate refuses — measured, and visible here as a refused
	 * origin no human click can rescue. Whether the challenge then completes is a
	 * separate, rate-only question this arm cannot answer without a person: a rig
	 * never solves the captcha, and a headless tab never could.
	 */
	const refusalLines = readAppLog().filter((line) =>
		line.includes("refused a navigation hop"),
	);
	const refusedOrigins = refusalLines.map(
		(line) => line.split(": ").at(-1) ?? line,
	);
	say(
		`RESULT arm=${arm} attempt=${attempt} outcome=${passed ? "PASS" : "FAIL"} cookies=${JSON.stringify(cookies)} title=${JSON.stringify(last.title)} ua=${JSON.stringify(last.ua)} vis=${last.vis} refusals=${refusalLines.length} refused=${JSON.stringify(refusedOrigins)}`,
	);
	record(
		`${arm} attempt ${attempt}`,
		`cookies ${JSON.stringify(cookies)}\nlast sample ${JSON.stringify(last)}\nuser agent presented: ${last.ua}\nrefused hops ${refusalLines.length}: ${JSON.stringify(refusedOrigins)}`,
	);
	const rect = await contentRect(renderer);
	const view = await viewport(renderer);
	const frame = await captureFrame(`${arm}-attempt${attempt}`, {
		renderer,
		state,
		token,
		rect,
		view,
	});
	say(`FRAME attempt=${attempt} ${frame}`);
	renderer.close();
	driven?.close();
	return passed;
}

// ---- the WebAuthn arm: the chooser, driven through the app's own listener ----

/**
 * The MAIN process inspector.
 *
 * The passkey arm's trigger lives here (see `launchApp`), because the one thing a
 * page cannot do on this machine is raise the request: the platform authenticator
 * is inert without a signed, entitled bundle, and Chromium services a virtual
 * authenticator inside the renderer without routing account selection to the
 * embedder. So the emitted event is synthetic and everything it reaches is not.
 */
const connectMainInspector = (port) =>
	connectTarget(
		(target) => typeof target.webSocketDebuggerUrl === "string",
		"the main process inspector",
		60_000,
		`http://127.0.0.1:${port}/json/list`,
	);

/**
 * Raise one `select-webauthn-account` on the app's real browser Session.
 *
 * WHY IT IS EMITTED RATHER THAN FETCHED: the event is what Electron fires at a
 * live `credentials.get()`; there is no API to replay it, and no page here can
 * trigger it. The arm records this as a limit of the evidence, and everything
 * downstream — `WebauthnChooser`, the IPC push, the preload's validation, the
 * shell's dialog, the answer travelling back into Electron's callback — is the
 * shipped code.
 */
async function emitChooser(client, { requestId, relyingPartyId, accounts }) {
	const expression = `(async () => {
		// HOW ELECTRON IS REACHED FROM THE INSPECTOR, measured (2026-09-18): the app's
		// main process is an ES module, so there is no ambient "require"; a dynamic
		// import fails with "A dynamic import callback was not specified", because the
		// inspector's Runtime.evaluate is a script context with no module loader. A
		// require built by "node:module" resolves Electron's builtin through the same
		// CJS loader the app's own dependencies use, and it is the one that works.
		const { createRequire } = process.getBuiltinModule("node:module");
		const { session } = createRequire(process.cwd() + "/probe.js")("electron");
		const browser = session.fromPartition("persist:local-operator-browser");
		globalThis.__webauthnAnswers ||= [];
		globalThis.__webauthnEmitted ||= {};
		const key = ${JSON.stringify(requestId)};
		try {
			// THE EVENT ARGUMENT IS PART OF THE CONTRACT, and leaving it out is
			// measured rather than theorised: Electron's listener signature is
			// "(event, details, callback)", so an emit that passes only (details,
			// callback) reaches the app's listener as (_event = details, details =
			// callback, callback = undefined) and the chooser throws on the missing
			// callback. The first version of this arm did exactly that.
			browser.emit(
				"select-webauthn-account",
				{},
				{ relyingPartyId: ${JSON.stringify(relyingPartyId)}, accounts: ${JSON.stringify(accounts)}, frame: null },
				(value) => { globalThis.__webauthnAnswers.push({ key, value: value ?? null, at: Date.now() }); },
			);
		} catch (error) {
			return { emitError: String(error), stack: (error && error.stack) || null };
		}
		globalThis.__webauthnEmitted[key] = Date.now();
		return { listeners: browser.listenerCount("select-webauthn-account") };
	})()`;
	const result = await evaluateValue(client, expression, 10_000);
	// The listener count is the lifetime evidence: it must be exactly one however
	// many times this arm emits, and it is what a second host start would break.
	return result;
}

/** What Electron's callbacks have received, in order. */
async function readAnswers(client) {
	return await evaluateValue(
		client,
		"JSON.stringify(globalThis.__webauthnAnswers ?? [])",
		5_000,
	);
}

/** The chooser's own DOM state, as a few numbers and strings rather than a
 * picture's worth of pixels. */
const CHOOSER_STATE = `(() => {
	const panel = document.querySelector('[data-tour-tag="browser-webauthn-dialog"]');
	const dialog = document.querySelector('[role="dialog"]');
	const rows = [...document.querySelectorAll('[data-tour-tag="browser-webauthn-account"]')];
	const title = document.querySelector('[role="dialog"] h2, [role="dialog"] [id^="radix"]');
	const paragraphs = [...document.querySelectorAll('[role="dialog"] p')].map((p) => p.textContent.trim());
	const rect = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) }; };
	return {
		open: Boolean(dialog),
		title: title ? title.textContent.trim() : null,
		paragraphs,
		rows: rows.map((row) => {
			const box = rect(row);
			const spans = [...row.querySelectorAll("span")];
			const span = spans[0] ?? null;
			const detail = spans[1] ?? null;
			const line = span ? rect(span) : null;
			return {
				label: span ? span.textContent.trim() : null,
				detail: detail ? detail.textContent.trim() : null,
				clientWidth: row.clientWidth,
				scrollWidth: row.scrollWidth,
				overflowing: row.scrollWidth > row.clientWidth + 1,
				box,
				labelRight: line ? line.right : null,
				labelClipped: line && span ? span.scrollWidth > span.clientWidth + 1 : false,
			};
		}),
		panel: panel ? rect(panel) : null,
		// The Touch ID sentence lives in the dialog's footer; whether it is inside
		// the panel's visible box is the whole D8 question.
		// The note lives in the dialog's FOOTER, and "data-tour-tag" sits on the
		// SCROLLING BODY inside the panel — so the comparison has to be against the
		// dialog, not against the tagged box. Measured wrong once in this arm, which
		// reported the pinned sentence as missing while it was on screen.
		notePinned: (() => {
			const el = [...document.querySelectorAll('[role="dialog"] p')].find((p) => p.textContent.includes("Touch ID"));
			if (!el) return null;
			const box = rect(el);
			const outer = rect(el.closest('[role="dialog"]'));
			return box.top >= outer.top && box.bottom <= outer.bottom;
		})(),
		activeElement: document.activeElement ? (document.activeElement.getAttribute("data-tour-tag") ?? document.activeElement.tagName) : null,
		hash: window.location.hash,
	};
})()`;

const chooserState = (renderer) =>
	evaluateValue(renderer, CHOOSER_STATE, 8_000);

/** Click the nth account row, or the dialog's own Cancel/Close control. */
async function pressChooser(renderer, what) {
	const expression =
		what === "cancel"
			? `(() => {
				const button = [...document.querySelectorAll('[role="dialog"] button')].find((b) => ["Cancel", "Close"].includes(b.textContent.trim()));
				if (!button) return false;
				button.click();
				return true;
			})()`
			: `(() => {
				const rows = [...document.querySelectorAll('[data-tour-tag="browser-webauthn-account"]')];
				const row = rows[${Number(what)}];
				if (!row) return false;
				row.click();
				return true;
			})()`;
	return await evaluateValue(renderer, expression, 8_000);
}

/** Navigate the app's own router, the way a rail click does. */
async function goRoute(renderer, hash) {
	return await evaluateValue(
		renderer,
		`(() => { window.location.hash = ${JSON.stringify(hash)}; return window.location.hash; })()`,
		8_000,
	);
}

const NAMED = [
	{
		credentialId: "Y3JlZC1h",
		displayName: "Ada Lovelace",
		name: "ada@example.com",
	},
	{
		credentialId: "Y3JlZC1i",
		displayName: "Grace Hopper",
		name: "grace@example.com",
	},
];
const NAMELESS = [
	{ credentialId: "Y3JlZC1uMQ", displayName: null, name: null },
	{ credentialId: "Y3JlZC1uMg", displayName: "  ", name: "" },
	{ credentialId: "Y3JlZC1uMw", displayName: null, name: null },
];
const LONG_NAMES = [
	{
		credentialId: "Y3JlZC1sMQ",
		displayName: "Alexandra Featherstonehaugh-Wallington the Third (Personal)",
		name: "alexandra.featherstonehaugh-wallington+personal@very-long-corporate-domain.example.com",
	},
	{
		credentialId: "Y3JlZC1sMg",
		displayName: null,
		name: "a.much.longer.login.with.a.plus.tag+work@another-long-domain.example.com",
	},
];
const MANY = Array.from({ length: 12 }, (_, index) => ({
	credentialId: `Y3JlZC1t${index + 1}`,
	displayName: `Account ${index + 1}`,
	name: `account.${index + 1}@example.com`,
}));

async function runWebauthnAttempt() {
	const inspectPort = await freeDevtoolsPort();
	const launched = launchApp("headless", { inspectPort });
	const renderer = await connectRenderer();
	const main = await connectMainInspector(inspectPort);

	await openBrowserRoute(renderer);
	// Focus has to START somewhere real, or "focus came back" is a claim about
	// body-to-body, which the first version of this arm made and which proved
	// nothing. The rail's own row is the app's most reliable focusable control.
	const seeded = await evaluateValue(
		renderer,
		"(() => { const el = document.querySelector('[data-tour-tag=\"nav-item-chat\"]') ?? document.querySelector('a[href=\"#/chat\"]'); if (!el) return null; el.focus(); return document.activeElement === el; })()",
		8_000,
	);
	const focusedBefore = await evaluateValue(
		renderer,
		"document.activeElement ? (document.activeElement.getAttribute('data-tour-tag') ?? document.activeElement.tagName) : null",
		8_000,
	);

	// An independent view of the settle push: the arm subscribes the way the app
	// does, so the notice it waits for at the end can be told apart from "the push
	// never arrived" and from "the push arrived and the surface did nothing".
	const settleProbe = await evaluateValue(
		renderer,
		"(() => { window.__settles = []; if (!window.api?.browser?.onWebauthnSettled) return 'missing'; window.api.browser.onWebauthnSettled((p) => window.__settles.push(p)); return 'subscribed'; })()",
		8_000,
	);
	say(`[webauthn] settle probe ${JSON.stringify(settleProbe)}`);

	const mainProbe = await evaluateValue(
		main,
		`(() => {
			const out = {};
			try { out.getBuiltinModule = typeof process.getBuiltinModule; } catch (error) { out.e1 = String(error); }
			try {
				const el = process.getBuiltinModule("electron");
				out.electronSession = typeof el?.session;
			} catch (error) { out.e2 = String(error); }
			try {
				const { createRequire } = process.getBuiltinModule("node:module");
				const req = createRequire(process.cwd() + "/probe.js");
				const el = req("electron");
				out.createRequireSession = typeof el?.session;
				const browser = el.session.fromPartition("persist:local-operator-browser");
				out.listeners = browser.listenerCount("select-webauthn-account");
			} catch (error) { out.e3 = String(error); }
			return out;
		})()`,
		10_000,
	);
	say(`[webauthn] main probe ${JSON.stringify(mainProbe)}`);
	if (mainProbe?.error || mainProbe?.createRequireSession !== "object") {
		record(
			"the main-process inspector could not reach Electron",
			JSON.stringify(mainProbe),
		);
		return false;
	}
	let listenerCount = await emitChooser(main, {
		requestId: "webauthn-arm-1",
		relyingPartyId: "accounts.example.com",
		accounts: NAMED,
	});
	say(`[webauthn] emit returned ${JSON.stringify(listenerCount)}`);
	await waitFor(
		async () => (await chooserState(renderer))?.open,
		"the chooser",
		20_000,
	);
	const several = await chooserState(renderer);
	await captureFrame("chooser-several-named", { renderer });
	say(
		`[webauthn] several-named rows=${several.rows.length} panel=${several.panel?.width}px listenerCount=${JSON.stringify(listenerCount)}`,
	);
	check(
		"the chooser names the site and both accounts",
		several.open &&
			several.rows.length === 2 &&
			several.paragraphs.some((p) => p.includes("accounts.example.com")),
		`title=${several.title} rows=${several.rows.map((row) => row.label).join(", ")}`,
	);
	check(
		"both rows fit their own box (design round 1, D1)",
		several.rows.every((row) => !row.overflowing && !row.labelClipped),
		several.rows
			.map(
				(row) =>
					`${row.label}: client=${row.clientWidth} scroll=${row.scrollWidth} labelRight=${row.labelRight} panelRight=${several.panel?.right}`,
			)
			.join(" | "),
	);
	check(
		"the Touch ID sentence is inside the panel's visible box (design round 1, D8)",
		several.notePinned === true,
		`notePinned=${several.notePinned}`,
	);

	// Answer with the second row and read back what Electron received.
	await pressChooser(renderer, "1");
	await waitFor(
		async () => !(await chooserState(renderer))?.open,
		"the chooser to close",
		15_000,
	);
	await captureFrame("chooser-answered", { renderer });
	const afterAnswer = await readAnswers(main);
	say(`[webauthn] answers=${afterAnswer}`);
	check(
		"the chosen credential reached Electron's callback",
		String(afterAnswer).includes("Y3JlZC1i"),
		String(afterAnswer),
	);
	const focusedAfter = await evaluateValue(
		renderer,
		"document.activeElement ? (document.activeElement.getAttribute('data-tour-tag') ?? document.activeElement.tagName) : null",
		8_000,
	);
	check(
		"focus comes back rather than landing on body (UX round 1, U5)",
		focusedAfter !== null && focusedAfter !== "BODY",
		`before=${focusedBefore} after=${focusedAfter} seeded=${seeded}`,
	);

	// The nameless case: three rows, and the copy has to say what the choice means.
	await emitChooser(main, {
		requestId: "webauthn-arm-2",
		relyingPartyId: "accounts.example.com",
		accounts: NAMELESS,
	});
	await waitFor(
		async () => (await chooserState(renderer))?.open,
		"the nameless chooser",
		20_000,
	);
	const nameless = await chooserState(renderer);
	await captureFrame("chooser-nameless", { renderer });
	check(
		"a nameless chooser explains the choice instead of offering ordinals (UX round 1, U1)",
		nameless.paragraphs.some((p) => p.includes("did not give their names")) &&
			nameless.paragraphs.some((p) =>
				p.includes("the account you sign in as"),
			) &&
			nameless.rows.every((row) =>
				(row.detail ?? "").includes("stored no name"),
			),
		nameless.paragraphs.join(" / "),
	);
	check(
		"every nameless row says so rather than leaving a blank line (design round 1, D9)",
		nameless.rows.every((row) => (row.label ?? "").startsWith("Passkey")),
		nameless.rows.map((row) => row.label).join(", "),
	);
	await pressChooser(renderer, "cancel");
	await waitFor(
		async () => !(await chooserState(renderer))?.open,
		"the chooser to close",
		15_000,
	);

	// Long names: the D1 measurement, on the surface the finding was filed against.
	await emitChooser(main, {
		requestId: "webauthn-arm-3",
		relyingPartyId: "identity.very-long-corporate-domain.example.com",
		accounts: LONG_NAMES,
	});
	await waitFor(
		async () => (await chooserState(renderer))?.open,
		"the long-name chooser",
		20_000,
	);
	const longNames = await chooserState(renderer);
	await captureFrame("chooser-long-names", { renderer });
	say(
		`[webauthn] long-names ${longNames.rows
			.map(
				(row) =>
					`client=${row.clientWidth} scroll=${row.scrollWidth} overflowing=${row.overflowing} panel=${longNames.panel?.width}`,
			)
			.join(" | ")}`,
	);
	check(
		"a long login wraps or ellipsises instead of being cut at the panel edge (design round 1, D1)",
		longNames.rows.every((row) => !row.overflowing),
		longNames.rows
			.map((row) => `client=${row.clientWidth} scroll=${row.scrollWidth}`)
			.join(" | "),
	);
	await pressChooser(renderer, "cancel");
	await waitFor(
		async () => !(await chooserState(renderer))?.open,
		"the chooser to close",
		15_000,
	);

	// Twelve accounts: the list has to scroll and the sentence has to stay put.
	await emitChooser(main, {
		requestId: "webauthn-arm-4",
		relyingPartyId: "accounts.example.com",
		accounts: MANY,
	});
	await waitFor(
		async () => (await chooserState(renderer))?.open,
		"the many-account chooser",
		20_000,
	);
	const many = await chooserState(renderer);
	await captureFrame("chooser-many-accounts", { renderer });
	check(
		"a twelve-account list can scroll without the Touch ID sentence following it away",
		many.rows.length === 12 && many.notePinned === true,
		`rows=${many.rows.length} notePinned=${many.notePinned}`,
	);
	await pressChooser(renderer, "cancel");
	await waitFor(
		async () => !(await chooserState(renderer))?.open,
		"the chooser to close",
		15_000,
	);

	// Two requests at once: the second is NAMED as waiting, not silently swapped in
	// (reviewer round 1, finding 7).
	await emitChooser(main, {
		requestId: "webauthn-arm-5a",
		relyingPartyId: "first.example.com",
		accounts: NAMED,
	});
	await waitFor(
		async () => (await chooserState(renderer))?.open,
		"the first chooser",
		20_000,
	);
	await emitChooser(main, {
		requestId: "webauthn-arm-5b",
		relyingPartyId: "second.example.com",
		accounts: NAMED,
	});
	await sleep(600);
	const queued = await chooserState(renderer);
	await captureFrame("chooser-queued", { renderer });
	check(
		"a second request is named as waiting rather than replacing the first (finding 7)",
		queued.paragraphs.some((p) => p.includes("One more site is waiting")) &&
			queued.paragraphs.some((p) => p.includes("first.example.com")),
		queued.paragraphs.join(" / "),
	);
	await pressChooser(renderer, "cancel");
	await sleep(600);
	await pressChooser(renderer, "cancel");
	await sleep(600);

	// THE FLOW THE REVIEW FOUND UNREACHABLE (agent review round 1 finding 1, UX
	// round 1 U2): raise the request with the browser surface NOT mounted.
	await goRoute(renderer, "#/chat");
	await sleep(900);
	const onChat = await evaluateValue(
		renderer,
		"({ hash: window.location.hash, surface: Boolean(document.querySelector('[data-tour-tag=\"browser-content\"]')) })",
		8_000,
	);
	await emitChooser(main, {
		requestId: "webauthn-arm-6",
		relyingPartyId: "accounts.example.com",
		accounts: NAMED,
	});
	const reached = await waitFor(
		async () => {
			const state = await chooserState(renderer);
			return state?.open ? state : null;
		},
		"the chooser raised off the browser route",
		20_000,
	);
	await captureFrame("chooser-on-chat-route", { renderer });
	say(
		`[webauthn] off-route hash=${onChat?.hash} surface-mounted=${onChat?.surface} open=${reached.open} rows=${reached.rows.length}`,
	);
	check(
		"a request raised while the browser surface is not mounted is still answerable (finding 1 / U2)",
		reached.open && reached.rows.length === 2,
		`hash=${onChat?.hash} surface=${onChat?.surface} open=${reached.open}`,
	);
	check(
		"the native view is not mounted, so the dialog is the only surface",
		onChat?.surface === false,
		`surface=${onChat?.surface}`,
	);

	// Walking back to the surface must not lose it either.
	await goRoute(renderer, "#/browser");
	await sleep(900);
	const afterReturn = await chooserState(renderer);
	await captureFrame("chooser-after-return", { renderer });
	check(
		"returning to the surface still shows the same request (U2)",
		afterReturn?.open === true && afterReturn.rows.length === 2,
		JSON.stringify(afterReturn?.paragraphs ?? []),
	);
	await pressChooser(renderer, "0");
	await sleep(600);

	// The expiry, which used to be a silent death with a live-looking dialog (D2).
	const expiryStart = Date.now();
	await emitChooser(main, {
		requestId: "webauthn-arm-7",
		relyingPartyId: "slow.example.com",
		accounts: NAMED,
	});
	await waitFor(
		async () => (await chooserState(renderer))?.open,
		"the expiring chooser",
		20_000,
	);
	let notice = null;
	const expiryDeadline = Date.now() + 95_000;
	let lastTrace = 0;
	while (Date.now() < expiryDeadline) {
		const state = await chooserState(renderer);
		const settles = await evaluateValue(
			renderer,
			"JSON.stringify(window.__settles ?? [])",
			5_000,
		);
		// A trace every 15 s, because the failure this loop exists to catch is
		// "the dialog is still up and nothing arrived" — which a silent poll reports
		// as a bare timeout.
		if (Date.now() - lastTrace > 15_000) {
			say(
				`[webauthn] waiting: open=${state?.open} rows=${state?.rows.length ?? "-"} settles=${settles}`,
			);
			lastTrace = Date.now();
		}
		const said = [state?.title ?? "", ...(state?.paragraphs ?? [])].join(" ");
		if (state?.open && state.rows.length === 0 && /expired/i.test(said)) {
			notice = state;
			break;
		}
		await sleep(2_500);
	}
	if (!notice) throw new Error("timed out waiting for the expiry notice");
	await captureFrame("chooser-expired", { renderer });
	const elapsed = Date.now() - expiryStart;
	say(
		`[webauthn] expiry settled after ${elapsed}ms; notice="${notice.title}: ${notice.paragraphs[0]}"`,
	);
	check(
		"an expired request says so instead of leaving a live-looking dialog (design round 1, D2)",
		// The word is in the settled panel's TITLE and its body names the minute, so
		// both are searched: the first version of this check looked at paragraphs
		// only and failed a notice that was on screen.
		notice.rows.length === 0 &&
			/expired/i.test([notice.title ?? "", ...notice.paragraphs].join(" ")),
		`${elapsed}ms; ${[notice.title, ...notice.paragraphs].join(" / ")}`,
	);
	const settles = await evaluateValue(
		renderer,
		"JSON.stringify(window.__settles ?? [])",
		8_000,
	);
	say(`[webauthn] settle events seen in the renderer: ${settles}`);
	const finalAnswers = await readAnswers(main);
	check(
		"the expired request settled Electron's callback with nothing",
		String(finalAnswers).includes('"value":null'),
		String(finalAnswers),
	);
	await pressChooser(renderer, "cancel");

	// The listener lifetime: one session, several emits, still exactly one listener
	// (reviewer round 1, finding 2).
	listenerCount = await evaluateValue(
		main,
		`(() => {
			const { createRequire } = process.getBuiltinModule("node:module");
			const { session } = createRequire(process.cwd() + "/probe.js")("electron");
			return session.fromPartition("persist:local-operator-browser").listenerCount("select-webauthn-account");
		})()`,
		8_000,
	);
	check(
		"one Session carries exactly one chooser listener after nine requests",
		listenerCount === 1,
		`listenerCount=${listenerCount}`,
	);

	const log = readAppLog().filter((line) => line.includes("[webauthn]"));
	record("the app's own webauthn log lines", log.join("\n"));
	say(`[webauthn] log lines=${log.length}`);
	for (const line of log.slice(0, 4)) say(`[webauthn] ${line.trim()}`);

	return failures === 0 && !launched.exited();
}

async function main() {
	rmSync(SCRATCH, { recursive: true, force: true });
	for (const dir of [
		join(SCRATCH, "home"),
		join(SCRATCH, "config"),
		join(SCRATCH, "logs"),
		join(SCRATCH, "userdata"),
		OUT_DIR,
	]) {
		mkdirSync(dir, { recursive: true });
	}
	say(`[rig] app tree ${APP_TREE} arm=${ARM} attempts=${ATTEMPTS}`);
	say(`[rig] scratch ${SCRATCH}`);

	let servers = null;
	if (ARM !== "cloudflare" && ARM !== "webauthn") {
		// B first: A's page embeds an iframe whose src needs B's port.
		const b = await startServer("origin B (the widget)", {
			"/widget.html": WIDGET_PAGE,
		});
		const a = await startServer("origin A (the page)", {
			"/top.html": TOP_PAGE(`http://127.0.0.1:${b.address().port}/widget.html`),
		});
		servers = { a, b };
	}

	const results = [];
	/*
	 * The window mode per arm, and why the real-site arms differ from the local
	 * one: a captcha can only be solved - and, for this app, only completed - in a
	 * page whose window is on screen at all (the frozen-tab limit in the design
	 * doc). `--arm ua` is the SAME run as `--arm cloudflare` under a name that says
	 * what the two trees differ in: the app's user agent, which is compiled in, so
	 * the two arms ARE the two built trees.
	 */
	const modes = {
		local: "headless",
		cloudflare: "inactive",
		ua: "inactive",
		// The passkey arm needs no page and no visible window: what it drives is the
		// APP's own surfaces, and a headless boot renders them at full fidelity.
		webauthn: "headless",
	};
	const arms =
		ARM === "both"
			? ["local", "cloudflare"]
			: ARM === "all"
				? ["local", "cloudflare", "ua"]
				: [ARM];
	try {
		for (const arm of arms) {
			let passed = 0;
			for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
				devtoolsPort = await freeDevtoolsPort();
				const windowMode = modes[arm];
				say(
					`[rig] ${arm} attempt ${attempt}/${ATTEMPTS} window-mode=${windowMode}`,
				);
				if (arm !== "webauthn") launchApp(windowMode);
				try {
					const ok =
						arm === "webauthn"
							? await runWebauthnAttempt()
							: arm === "local"
								? await runLocalAttempt({ attempt, servers })
								: await runRealSiteAttempt({ attempt, arm });
					if (ok) passed += 1;
				} catch (error) {
					say(`ERROR arm=${arm} attempt=${attempt} ${String(error)}`);
					record(
						`arm ${arm} attempt ${attempt} error`,
						String(error?.stack ?? error),
					);
				} finally {
					const teardown = await stopApp();
					if (teardown && !teardown.clean) {
						failures += 1;
						say(`ERROR teardown attempt=${attempt} left processes behind`);
					}
				}
				await sleep(1500);
			}
			results.push({ arm, passed, attempts: ATTEMPTS });
			say(`SUMMARY arm=${arm} pass=${passed}/${ATTEMPTS}`);
			if (passed !== ATTEMPTS) failures += 1;
		}
	} finally {
		servers?.a.close();
		servers?.b.close();
	}

	const reportPath = join(OUT_DIR, "proof.md");
	writeFileSync(reportPath, transcript.join("\n"));
	say(`transcript: ${reportPath}`);
	say(`frames:     ${OUT_DIR}`);
	if (!KEEP) say(`scratch:    ${SCRATCH} (pass --keep to inspect)`);
	for (const result of results) {
		say(
			`RATE arm=${result.arm} ${result.passed}/${result.attempts} ${result.passed === result.attempts ? "all passed" : "NOT all passed"}`,
		);
	}
	if (failures > 0) {
		say(`${failures} failure(s)`);
		process.exitCode = 1;
	}
}

onInterrupted(async () => {
	await stopApp();
	return 1;
});

await main();
