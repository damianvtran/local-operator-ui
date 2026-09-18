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
 *   node scripts/browser-challenge-proof.mjs --app-tree <dir> [--arm local|cloudflare|both]
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

function launchApp(windowMode) {
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

async function connectTarget(match, label, timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		const list = await targets().catch(() => []);
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

async function runCloudflareAttempt({ attempt }) {
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
		`RESULT arm=cloudflare attempt=${attempt} outcome=${passed ? "PASS" : "FAIL"} cookies=${JSON.stringify(cookies)} title=${JSON.stringify(last.title)} raf=${last.raf} vis=${last.vis} refusals=${refusalLines.length} refused=${JSON.stringify(refusedOrigins)}`,
	);
	record(
		`cloudflare attempt ${attempt}`,
		`cookies ${JSON.stringify(cookies)}\nlast sample ${JSON.stringify(last)}\nrefused hops ${refusalLines.length}: ${JSON.stringify(refusedOrigins)}`,
	);
	const rect = await contentRect(renderer);
	const view = await viewport(renderer);
	const frame = await captureFrame(`cloudflare-attempt${attempt}`, {
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
	if (ARM !== "cloudflare") {
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
	const modes = { local: "headless", cloudflare: "inactive" };
	const arms = ARM === "both" ? ["local", "cloudflare"] : [ARM];
	try {
		for (const arm of arms) {
			let passed = 0;
			for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
				devtoolsPort = await freeDevtoolsPort();
				const windowMode = modes[arm];
				say(
					`[rig] ${arm} attempt ${attempt}/${ATTEMPTS} window-mode=${windowMode}`,
				);
				launchApp(windowMode);
				try {
					const ok =
						arm === "local"
							? await runLocalAttempt({ attempt, servers })
							: await runCloudflareAttempt({ attempt });
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
