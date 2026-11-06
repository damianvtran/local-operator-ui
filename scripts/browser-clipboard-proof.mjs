#!/usr/bin/env node
/**
 * End-to-end proof for the clipboard half of the browser host.
 *
 * Why this exists: the desktop suite drives the permission predicate and the
 * `copy` action against fakes, and this run is the thing that can falsify the
 * claim, because every layer below is the real one — a real built app, a real
 * request_access/consent round, real pages in real driven views, the real
 * Chromium permission stack and the REAL system clipboard.
 *
 * WHAT IT MEASURES, and each row is a page's own words or a `pbpaste` fingerprint:
 *   (a) a page-initiated `writeText` from a REAL click resolves and the OS
 *       clipboard holds the bytes — including from a tab that is NOT the active
 *       one, which is the focus question;
 *   (b) `readText()` still rejects, after the same click and on load, and
 *       `permissions.query({name:"clipboard-read"})` still answers "denied": the
 *       session keeps its default-deny policy, so the READ is impossible at the
 *       permission level rather than by a shim;
 *   (c) a same-process child frame's write is measured and reported;
 *   (c2) a page write with NO user gesture rejects rather than writing silently;
 *   (d) the `copy` action writes the element's bytes and answers a receipt that
 *       contains no text;
 *   (e) the page write survives a navigation and a tab re-attach.
 *
 * The write a page makes is served by the host (the injected `copy` page script in
 * src/main/browser/vendor is not used here: the shim in
 * `actions/clipboard-shim.ts` is), so the permission handlers stay default-deny.
 * The clipboard checks compare a SHA-256 of what `pbpaste` reads against the
 * receipt's own fingerprint, so the value never reaches this run's output. The
 * ONLY text this script writes to the system clipboard is the synthetic token
 * below (it clears it first rather than saving the operator's own content: a
 * harness run must not need to hold what a person had copied).
 *
 * Isolation is the same non-negotiable set `browser-host-proof.mjs` documents —
 * scratch `HOME`, `LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_LOG_DIR`, a
 * scratch Electron profile, `--window-mode=headless`, no inherited CMUX_/LOP_
 * — plus one difference: the scratch root is `$LOCAL_OPERATOR_SCRATCHPAD` when
 * the harness sets it, because a session's scratch under the OS temp root is
 * pruned underneath it.
 *
 * Usage: node scripts/browser-clipboard-proof.mjs   (after `pnpm build`)
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = process.cwd();
const SCRATCH = join(
	process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir(),
	`lo-clipboard-proof-${process.pid}`,
);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const OUT_DIR = join(SCRATCH, "out");
const LOG_DIR = join(SCRATCH, "logs");

/** SYNTHETIC. Not a credential, not a format any issuer uses, and the only text
 * this run ever puts on the clipboard. */
const TOKEN = "SYNTHETIC-clipboard-proof-token-7c1f0a";

let app = null;
let site = null;
let devtoolsPort = 0;
const findings = [];

function say(line) {
	process.stdout.write(`${line}\n`);
}

function check(label, ok, detail) {
	findings.push({ label, ok, detail });
	say(`${ok ? "PASS" : "FAIL"}  ${label}`);
	if (detail) say(`      ${detail}`);
}

/** A reading, not a verdict: it never decides the run's exit code. Used for the
 * page's own Copy button, whose refusal is this build's CORRECT behaviour under a
 * write-only grant — pretending it passes would be the dishonest report. */
function info(label, detail) {
	findings.push({ label, ok: true, info: true, detail });
	say(`INFO  ${label}`);
	if (detail) say(`      ${detail}`);
}

const sha16 = (text) =>
	createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

/** The REAL system clipboard, which is the only reason this rig is darwin-only:
 * `pbcopy`/`pbpaste` are the system's, not a re-implementation, and comparing
 * their bytes with the receipt's fingerprint is the proof that what the host
 * reports is what the machine now holds. */
/**
 * The app log's permission line: the permission, WHICH Electron handler asked and
 * the decision. Module scope because a per-call literal is the linter's
 * top-level-regex case (and there is no reason to compile it per reading).
 */
const PERMISSION_LINE =
	/\[browser\] (granted|denied) clipboard-(read|sanitized-write) \((request|check)\) from http/;

const isDarwin = process.platform === "darwin";

const pbcopy = (text) =>
	execFileSync("pbcopy", [], { input: text, timeout: 5000 });

const pbpaste = () =>
	execFileSync("pbpaste", [], { timeout: 5000, encoding: "utf8" });

// ---- the page under test ---------------------------------------------------

/**
 * One document, both halves of requirement 1: the page copies on LOAD and on a
 * real click, and it REPORTS the outcome into `#result`, so the rig reads the
 * answer through the host's own `read` rather than driving the page from
 * outside. A page that cannot copy shows Chromium's error name and message,
 * which is exactly the sentence the operator saw.
 */
function page() {
	return `<!doctype html><html><head><meta charset="utf-8">
<title>Clipboard proof</title></head><body>
<h1>Create application</h1>
<p>Store application key</p>
<code id="app-key">  ${TOKEN}  </code>
<form><input id="key-field" name="applicationKey" value="${TOKEN}"></form>
<p id="empty">   </p>
<div class="row-item">first row</div>
<div class="row-item">second row</div>
<button id="copy-again">Copy key</button>
<button id="paste-again">Paste</button>
<button id="copy-without-gesture">Copy later</button>
<button id="copy-after-window">Copy in 3s</button>
<button id="frame-probe">Ask the frame to copy</button>
<a id="navigate" href="/next">next page</a>
<iframe id="same-site-frame" src="/frame"></iframe>
<p id="shim">unknown</p>
<p id="result">idle</p>
<p id="read-result">idle</p>
<p id="gesture-result">idle</p>
<p id="frame-result">idle</p>
<script>
  const key = document.getElementById("app-key").textContent.trim();
  const report = (id, text) => { document.getElementById(id).textContent = text; };
  // Every attempt is NUMBERED: a paragraph read after the fact must never let a
  // previous phase's success pass for this phase's answer.
  var attempts = 0;
  report("shim", window.__localOperatorClipboardShim ? "shimmed" : "native");
  // Kept LIVE: the host arms a document when its execution context appears, which is
  // after the page's own first script ran — so the reading that matters is the one at
  // the moment of the click, not the one taken during parse.
  setInterval(function () {
    report("shim", window.__localOperatorClipboardShim ? "shimmed" : "native");
  }, 200);
  function attempt(label) {
    var n = ++attempts;
    return navigator.clipboard.writeText(key).then(
      function () { report("result", label + ":ok#" + n); },
      function (error) { report("result", label + ":refused#" + n + ":" + (error && error.name) + ":" + (error && error.message)); }
    );
  }
  document.getElementById("copy-again").addEventListener("click", function () { attempt("click"); });
  document.getElementById("paste-again").addEventListener("click", function () {
    navigator.clipboard.readText().then(
      function (text) { report("read-result", "read:ok:" + text.length); },
      function (error) { report("read-result", "read:refused:" + (error && error.name)); }
    );
    navigator.permissions.query({ name: "clipboard-read" }).then(function (status) {
      report("read-result", document.getElementById("read-result").textContent + ":query:" + status.state);
    }, function () { /* a browser without the name */ });
  });
  // NO user gesture: a timer, which is what a drive-by copy would look like.
  document.getElementById("copy-without-gesture").addEventListener("click", function () {
    setTimeout(function () { attempt("nogesture"); }, 0);
  });
  // A copy scheduled PAST the host arm's window, from a click that has already
  // returned: the shape a page would use to ride a permission it should not have.
  document.getElementById("copy-after-window").addEventListener("click", function () {
    setTimeout(function () { attempt("later"); }, 3000);
  });
  // The child frame writes only when ASKED. An automatic write here landed inside
  // another row's clipboard measurement (measured: it overwrote the fingerprint
  // that row was reading, which read as that row failing), so the probe is explicit.
  if (window.parent !== window) {
    window.addEventListener("message", function (event) {
      if (event.data !== "write") return;
      navigator.clipboard.writeText("frame-text").then(
        function () { window.parent.postMessage("frame:ok", "*"); },
        function (error) { window.parent.postMessage("frame:refused:" + (error && error.name) + ":" + (error && error.message), "*"); }
      );
    });
  } else {
    document.getElementById("frame-probe").addEventListener("click", function () {
      document.getElementById("same-site-frame").contentWindow.postMessage("write", "*");
    });
  }
  window.addEventListener("message", function (event) {
    if (typeof event.data === "string" && event.data.indexOf("frame:") === 0) {
      report("frame-result", event.data);
    }
  });
  attempt("load");
</script>
</body></html>`;
}

/** The navigation target: the same shim has to be installed on a NEW document. */
function nextPage() {
	return `<!doctype html><html><head><meta charset="utf-8">
<title>Clipboard proof next</title></head><body>
<code id="app-key">  ${TOKEN}  </code>
<button id="copy-again">Copy key</button>
<p id="shim">unknown</p>
<p id="result">idle</p>
<script>
  const key = document.getElementById("app-key").textContent.trim();
  document.getElementById("shim").textContent = window.__localOperatorClipboardShim ? "shimmed" : "native";
  setInterval(function () {
    document.getElementById("shim").textContent = window.__localOperatorClipboardShim ? "shimmed" : "native";
  }, 200);
  document.getElementById("copy-again").addEventListener("click", function () {
    navigator.clipboard.writeText(key).then(
      function () { document.getElementById("result").textContent = "click:ok"; },
      function (error) { document.getElementById("result").textContent = "click:refused:" + (error && error.name) + ":" + (error && error.message); }
    );
  });
</script>
</body></html>`;
}

function startSite() {
	return new Promise((resolve) => {
		const server = createServer((request, response) => {
			const path = (request.url || "/").split("?")[0];
			response.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
			});
			response.end(path.startsWith("/next") ? nextPage() : page());
		});
		server.listen(0, "127.0.0.1", () =>
			resolve({ server, port: server.address().port }),
		);
	});
}

// ---- the app ---------------------------------------------------------------

function pickDevtoolsPort() {
	return 9451 + (process.pid % 500);
}

async function launchApp() {
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		// No backend install in a scratch HOME: it has nothing to do with the
		// clipboard and turns the run into a first-run provisioning path.
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	devtoolsPort = pickDevtoolsPort();
	const child = spawn(
		electronPath,
		[
			".",
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${devtoolsPort}`,
			"--window-size=1380x900",
		],
		{
			env,
			cwd: ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			// Own the whole tree: Electron spawns helpers, and a signal to the direct
			// child alone leaves them running.
			detached: true,
		},
	);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const logPath = join(SCRATCH, "app.log");
	const flush = () => writeFileSync(logPath, stream.join(""));
	const timer = setInterval(flush, 500);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});
	return {
		child,
		stream,
		logPath,
		stop: () =>
			new Promise((resolve) => {
				const killTree = (signal) => {
					try {
						process.kill(-child.pid, signal);
					} catch {
						try {
							child.kill(signal);
						} catch {
							/* already gone */
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

function stateFilePath() {
	return join(CONFIG_DIR, "run", "ui-browser", "host.json");
}

async function waitForState(timeoutMs = 90_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (existsSync(stateFilePath())) {
			try {
				const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
				if (parsed.port) return parsed;
			} catch {
				/* staged write: not yet */
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`no state file appeared at ${stateFilePath()}`);
}

async function rpc(state, method, params = {}, id = `proof-${method}`) {
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Bridge-Key": state.session_key,
		},
		body: JSON.stringify({ id, method, params }),
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

/** The refusal an RPC answers, which is evidence too: the typed code, never text. */
async function rpcError(state, method, params = {}) {
	const out = await rpc(state, method, params);
	if (out.json?.ok !== false) {
		throw new Error(`${method} answered ok where a refusal was expected`);
	}
	return out.json.error;
}

// ---- the renderer, for the consent round only -------------------------------

async function rendererEvaluate(expression) {
	const list = await (
		await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
	).json();
	const target = list.find(
		(candidate) =>
			candidate.type === "page" &&
			candidate.url.startsWith("file:") &&
			candidate.url.includes("/renderer/index.html"),
	);
	if (!target) throw new Error("no renderer target on the debugging port");
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const reply = await new Promise((resolve, reject) => {
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
	if (reply.result?.exceptionDetails)
		return { error: reply.result.exceptionDetails.text ?? "threw" };
	return { value: reply.result?.result?.value };
}

/**
 * A TRUSTED pointer click on a driven view's page, over CDP.
 *
 * WHY THE RIG NEEDS ONE: the host's own `click` action dispatches IN THE PAGE
 * (`Runtime.callFunctionOn`, `CLICK_FUNCTION`), which is not user activation — so
 * a page's copy handler fired by it sees `navigator.userActivation.isActive` false.
 * A person clicking the same button in the same tab IS a trusted input, and that
 * is the case requirement 1 is about, so this helper sends the real
 * `Input.dispatchMouseEvent` pair a human's press produces.
 */
async function pointerClick(urlMatch, selector) {
	const list = await (
		await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
	).json();
	const target = list.find(
		(candidate) =>
			candidate.type === "page" && candidate.url.endsWith(urlMatch),
	);
	if (!target) throw new Error(`no driven target matching ${urlMatch}`);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const incoming = JSON.parse(event.data);
		if (incoming.id && pending.has(incoming.id)) {
			pending.get(incoming.id)(incoming);
			pending.delete(incoming.id);
		}
	});
	const send = (method, params = {}) =>
		new Promise((resolve) => {
			const id = ++nextId;
			pending.set(id, resolve);
			socket.send(JSON.stringify({ id, method, params }));
		});
	const box = await send("Runtime.evaluate", {
		expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
		returnByValue: true,
	});
	const point = box.result?.result?.value;
	if (!point) {
		socket.close();
		throw new Error(`selector ${selector} has no box on ${urlMatch}`);
	}
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: point.x,
			y: point.y,
			button: "left",
			clickCount: 1,
		});
	}
	socket.close();
}

async function waitForRenderer(timeoutMs = 90_000) {
	const started = Date.now();
	for (;;) {
		const ready = await rendererEvaluate(
			"typeof window.api?.browser?.state === 'function' ? 'ready' : 'waiting'",
		).catch(() => ({ value: "error" }));
		if (ready.value === "ready") return;
		if (Date.now() - started > timeoutMs)
			throw new Error("the renderer never exposed window.api.browser");
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

/** Approve one origin through the app's OWN consent path: `request_access`
 * raises the prompt, the chrome answers it over IPC, `await_access` reads the
 * decision. Answering it any other way would test a path the app does not have. */
async function approve(state, origin) {
	const requested = await rpcOk(state, "request_access", {
		url: origin,
		requester: "session:clipboard-proof",
	});
	if (requested.state === "allowed") return requested;
	const pending = await rendererEvaluate(
		"window.api.browser.state().then((s) => JSON.stringify(s.pendingConsent))",
	);
	const entry = JSON.parse(pending.value ?? "[]").find(
		(candidate) => candidate.origin === origin,
	);
	if (!entry) throw new Error(`no pending consent for ${origin}`);
	await rendererEvaluate(
		`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, "site").then((s) => JSON.stringify(s))`,
	);
	const awaited = await rpcOk(state, "await_access", {
		url: origin,
		requester: "session:clipboard-proof",
	});
	if (awaited.state !== "allowed")
		throw new Error(`consent for ${origin} was not granted: ${awaited.state}`);
	return awaited;
}

// ---- the run ----------------------------------------------------------------

async function main() {
	if (!isDarwin)
		throw new Error(
			"this rig compares the host's write against the REAL system clipboard (pbcopy/pbpaste), which this platform does not have",
		);
	rmSync(SCRATCH, { recursive: true, force: true });
	for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA, OUT_DIR, LOG_DIR])
		mkdirSync(dir, { recursive: true });
	say(`scratch: ${SCRATCH}`);

	site = await startSite();
	const origin = `http://127.0.0.1:${site.port}`;
	say(`local site: ${origin}`);

	app = await launchApp();
	const state = await waitForState();
	say(`state file: ${stateFilePath()} (port ${state.port})`);
	await waitForRenderer();
	await rendererEvaluate(
		"window.api.browser.setContentRect({ x: 0, y: 0, width: 1280, height: 800 }).then((s) => JSON.stringify(s))",
	);
	await approve(state, origin);
	say(`consent: ${origin} allowed`);

	const firstOpen = await rpcOk(state, "open", {
		url: `${origin}/`,
		requester: "session:clipboard-proof",
	});
	const firstTab = firstOpen.tab;

	// The page attempts a write on LOAD, with no user gesture: the same thing a
	// drive-by copy would look like, and one of the two rows the shim must refuse.
	const loaded = await pollRead(state, firstTab, "#result", "idle");
	check(
		"(c2) a page write with NO user gesture rejects instead of writing silently",
		String(loaded.text ?? "").startsWith("load:refused#"),
		`read #result -> ${JSON.stringify(loaded.text)}`,
	);
	info(
		"the shim is the code that refused it (a page's own words, not an inference)",
		`read #shim -> ${JSON.stringify((await rpcOk(state, "read", { tab: firstTab, selector: "#shim" })).text)}`,
	);

	// --- (a) the page's own write, from a trusted pointer press ------------
	await pbcopy("clipboard-proof-cleared");
	await pointerClick("/", "#copy-again");
	await new Promise((resolve) => setTimeout(resolve, 700));
	const clicked = await rpcOk(state, "read", {
		tab: firstTab,
		selector: "#result",
	});
	const landedByPage = pbpaste();
	check(
		"(a) a page's own writeText resolves from a TRUSTED click, and the OS clipboard holds its bytes",
		String(clicked.text ?? "").startsWith("click:ok") && landedByPage === TOKEN,
		`read #result -> ${JSON.stringify(clicked.text)} · pbpaste sha256[0..16] = ${sha16(landedByPage)} · expected ${sha16(TOKEN)}`,
	);

	// --- (a2) the AGENT path: the host's own click ------------------------
	// The host's `click` dispatches in-page, so it carries no user activation. It
	// mints a single-use arm before the dispatch (see `armHostClipboardWrite`), which
	// is what makes an agent clicking a page's Copy button behave like a person's
	// click instead of showing the page's failure toast.
	await pbcopy("clipboard-proof-cleared");
	await rpcOk(state, "click", { tab: firstTab, selector: "#copy-again" });
	// Polled on the CLIPBOARD rather than on `#result`: the paragraph still holds the
	// previous phase's "click:ok", so reading it first would report a stale success.
	let agentFingerprint = pbpaste();
	for (let attempt = 0; attempt < 24 && agentFingerprint !== TOKEN; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		agentFingerprint = pbpaste();
	}
	const agentResult = (
		await rpcOk(state, "read", { tab: firstTab, selector: "#result" })
	).text;
	check(
		"(a) a host-driven click on the page's copy button writes: the page reports success and the clipboard holds it",
		String(agentResult ?? "").startsWith("click:ok") &&
			agentFingerprint === TOKEN,
		`host click -> page says ${JSON.stringify(agentResult)} · pbpaste sha256[0..16] = ${sha16(agentFingerprint)} · expected ${sha16(TOKEN)}`,
	);

	// --- (a3) the arm does not outlive the click --------------------------
	// A copy the page schedules THREE seconds after a click whose action has returned:
	// past the arm window and past the click's own clear.
	await pbcopy("clipboard-proof-cleared");
	await rpcOk(state, "click", {
		tab: firstTab,
		selector: "#copy-after-window",
	});
	// Polled to the page's own "later:" reading rather than sampled after a fixed
	// wait: the phase before this one left "click:ok" in the same paragraph, so a
	// fixed sleep either reads a stale success or races the timer.
	let afterArm = { text: "click:ok" };
	for (let attempt = 0; attempt < 32; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		afterArm = await rpcOk(state, "read", {
			tab: firstTab,
			selector: "#result",
		});
		if (String(afterArm.text ?? "").startsWith("later:")) break;
	}
	const lateRefused =
		String(afterArm.text ?? "").startsWith("later:refused#") &&
		pbpaste() === "clipboard-proof-cleared";
	check(
		"(a) the arm is single-use and short-lived: a copy the page schedules past the click is refused",
		lateRefused,
		`read #result -> ${JSON.stringify(afterArm.text)} · pbpaste -> ${pbpaste() === "clipboard-proof-cleared" ? "unchanged" : "CHANGED"}`,
	);

	// --- (b) the READ stays impossible ------------------------------------
	await pbcopy("clipboard-proof-canary");
	await pointerClick("/", "#paste-again");
	await new Promise((resolve) => setTimeout(resolve, 700));
	const readAttempt = await rpcOk(state, "read", {
		tab: firstTab,
		selector: "#read-result",
	});
	check(
		"(b) readText() still rejects and clipboard-read still answers denied",
		String(readAttempt.text ?? "").includes("read:refused:NotAllowedError") &&
			String(readAttempt.text ?? "").includes("query:denied"),
		`read #read-result -> ${JSON.stringify(readAttempt.text)}`,
	);
	check(
		"(b) the canary the page tried to read is still the clipboard's content",
		pbpaste() === "clipboard-proof-canary",
		`pbpaste -> ${pbpaste() === "clipboard-proof-canary" ? "unchanged" : "CHANGED"}`,
	);

	// --- (c) a same-process child frame ------------------------------------
	await rpcOk(state, "click", { tab: firstTab, selector: "#frame-probe" });
	const frameAttempt = await pollRead(
		state,
		firstTab,
		"#frame-result",
		"idle",
		24,
	);
	info(
		"(c) a same-process child frame's writeText (reported, not gated; OOPIFs are not covered)",
		`read #frame-result -> ${JSON.stringify(frameAttempt.text)}`,
	);

	// --- (d) the harness path: `copy`, and its refusals --------------------
	await pbcopy("clipboard-proof-cleared");
	await rpcOk(state, "copy", { tab: firstTab, selector: "#app-key" });
	const landed = pbpaste();
	check(
		"(d) the copy action puts the element's bytes on the system clipboard",
		sha16(landed) === sha16(TOKEN),
		`pbpaste sha256[0..16] = ${sha16(landed)} · expected ${sha16(TOKEN)} · chars ${landed.length}`,
	);

	await pbcopy("clipboard-proof-cleared");
	const fieldReceipt = await rpcOk(state, "copy", {
		tab: firstTab,
		selector: "#key-field",
	});
	check(
		"(d) a form field copies its value, and the receipt carries no text",
		fieldReceipt.sha256 === sha16(TOKEN) &&
			fieldReceipt.verified === true &&
			fieldReceipt.chars === TOKEN.length &&
			fieldReceipt.element?.tag === "input" &&
			fieldReceipt.element?.name === "applicationKey" &&
			!JSON.stringify(fieldReceipt).includes(TOKEN),
		`copy #key-field -> ${JSON.stringify(fieldReceipt)}`,
	);

	const emptyError = await rpcError(state, "copy", {
		tab: firstTab,
		selector: "#empty",
	});
	check(
		"(d) an element with no text is its own typed refusal",
		emptyError.code === "empty_element_text",
		`copy #empty -> ${JSON.stringify(emptyError)}`,
	);
	const ambiguousError = await rpcError(state, "copy", {
		tab: firstTab,
		selector: ".row-item",
	});
	check(
		"(d) an ambiguous selector is a typed refusal that names what matched",
		ambiguousError.code === "element_not_found" &&
			ambiguousError.data?.reason === "ambiguous_selector" &&
			ambiguousError.data?.count === 2,
		`copy .row-item -> ${JSON.stringify(ambiguousError)}`,
	);
	const missingError = await rpcError(state, "copy", {
		tab: firstTab,
		selector: "#nope",
	});
	check(
		"(d) a selector that matches nothing keeps the existing element_not_found",
		missingError.code === "element_not_found",
		`copy #nope -> ${JSON.stringify(missingError)}`,
	);

	// --- (a, inactive tab) the same press while another tab is active ------
	await pbcopy("clipboard-proof-cleared");
	const secondOpen = await rpcOk(state, "open", {
		url: `${origin}/next?two`,
		requester: "session:clipboard-proof",
	});
	const secondTab = secondOpen.tab;
	await new Promise((resolve) => setTimeout(resolve, 1200));
	const chrome = await rpcOk(state, "status", {
		requester: "session:clipboard-proof",
	});
	await pointerClick("/", "#copy-again");
	await new Promise((resolve) => setTimeout(resolve, 700));
	const inactiveWrite = await rpcOk(state, "read", {
		tab: firstTab,
		selector: "#result",
	});
	check(
		`(a) the same press on the INACTIVE tab resolves too (host active tab count ${JSON.stringify(chrome.tabs)}; pressed ${firstTab}, active view is ${secondTab})`,
		String(inactiveWrite.text ?? "").startsWith("click:ok") &&
			pbpaste() === TOKEN,
		`read #result -> ${JSON.stringify(inactiveWrite.text)} · pbpaste sha256[0..16] = ${sha16(pbpaste())}`,
	);

	// --- (e) navigation ---------------------------------------------------
	await pbcopy("clipboard-proof-cleared");
	await pointerClick("/", "#navigate");
	await new Promise((resolve) => setTimeout(resolve, 1500));
	await pointerClick("/next", "#copy-again");
	await new Promise((resolve) => setTimeout(resolve, 700));
	const afterNavigation = await rpcOk(state, "read", {
		tab: firstTab,
		selector: "#result",
	});
	const navigatedShim = await rpcOk(state, "read", {
		tab: firstTab,
		selector: "#shim",
	});
	check(
		"(e) the page's write survives a NAVIGATION (the shim is installed on the new document)",
		String(afterNavigation.text ?? "").startsWith("click:ok") &&
			pbpaste() === TOKEN,
		`after navigation on ${firstTab}: url ${JSON.stringify(afterNavigation.url)} · read #shim -> ${JSON.stringify(navigatedShim.text)} · read #result -> ${JSON.stringify(afterNavigation.text)} · pbpaste sha256[0..16] = ${sha16(pbpaste())}`,
	);

	// --- (e) a freshly opened view (a new attach) -------------------------
	await pbcopy("clipboard-proof-cleared");
	const thirdOpen = await rpcOk(state, "open", {
		url: `${origin}/next?three`,
		requester: "session:clipboard-proof",
	});
	await new Promise((resolve) => setTimeout(resolve, 1500));
	await pointerClick("/next?three", "#copy-again");
	await new Promise((resolve) => setTimeout(resolve, 700));
	const afterReattach = await rpcOk(state, "read", {
		tab: thirdOpen.tab,
		selector: "#result",
	});
	check(
		"(e) a freshly opened view's write works (a new WebContents, a new install)",
		String(afterReattach.text ?? "").startsWith("click:ok") &&
			pbpaste() === TOKEN,
		`read #result -> ${JSON.stringify(afterReattach.text)} · pbpaste sha256[0..16] = ${sha16(pbpaste())}`,
	);

	// --- the log tells the truth about the policy -------------------------
	const browserLines = app.stream
		.join("")
		.split("\n")
		.filter((line) => line.includes("[browser]"));
	const permissionLines = browserLines.filter(
		(line) => line.includes("clipboard") || line.includes("permission"),
	);
	check(
		"the app log names the permission, the asking handler and the decision",
		permissionLines.some((line) => PERMISSION_LINE.test(line)),
		permissionLines.slice(0, 8).join("\n      ") || "(no permission lines)",
	);
	check(
		"nothing in the log, the receipts or the transcript prints the copied value",
		!app.stream.join("").includes(TOKEN) &&
			!JSON.stringify([fieldReceipt]).includes(TOKEN),
		"searched the app's own output and the receipt for the synthetic token",
	);

	say(
		`\n${findings.filter((f) => f.ok).length}/${findings.length} checks passed`,
	);
	writeFileSync(
		join(OUT_DIR, "proof.md"),
		findings
			.map(
				(f) =>
					`- ${f.info ? "INFO" : f.ok ? "PASS" : "FAIL"} ${f.label}\n  - ${f.detail}`,
			)
			.join("\n"),
	);
	if (findings.some((f) => !f.ok)) process.exitCode = 1;
}

/** Read a selector until it stops saying `idle` (or the budget runs out). */
async function pollRead(state, tab, selector, idle = "idle", attempts = 40) {
	let reading = { text: idle };
	for (let i = 0; i < attempts && String(reading.text ?? "") === idle; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		reading = await rpcOk(state, "read", { tab, selector });
	}
	return reading;
}

try {
	await main();
} catch (error) {
	say(`\nRIG FAILURE: ${error?.stack ?? error}`);
	process.exitCode = 1;
} finally {
	if (app) {
		const stopping = app;
		app = null;
		stopping.stop().catch(() => undefined);
	}
	if (site) site.server.close();
	say(`app log: ${join(SCRATCH, "app.log")}`);
}
