#!/usr/bin/env node
/**
 * S1's real-built-app matrix: the inert address-overlay child, driven through the
 * app's own gated dev-driver bridge.
 *
 * WHAT THIS IS, AND WHY IT IS NOT A MOCK. The controller's unit suite
 * (`browser-address-overlay.test.mjs`) proves ordering and state against a
 * recording stub. It cannot prove that the BUILT app creates a native child, that
 * the child is topmost over the real page, that the page's native bounds and
 * visibility do not move, that a tab close releases the child, or that the host's
 * own stop path exits cleanly. This script boots the built app in the documented
 * `headless` mode and operates the actual host through
 * `window.__loDevDriver.addressOverlay(...)` — a probe that exists only in an
 * armed headless launch whose overlay gate also passed.
 *
 * WHAT IT DOES NOT CLAIM (matrix rows say this in their own words):
 * - native-composite pixels and genuine native mouse/hit routing are NOT measured;
 *   a child-only `capturePage()` frame would be child pixels, not composite order;
 * - the `inactive`/`normal` refusals, foreign-window/subframe sender rejection,
 *   startup rollback and the host-restart-dedup path are asserted in source/unit
 *   tests only, never driven here (a visible window is not launched);
 * - Windows/Linux behaviour is unmeasured.
 *
 * Isolation is `renderer-driver.mjs`'s, for the same reasons and with the same
 * pieces: scratch HOME/config/log/profile, the app directory as an absolute
 * argument with a scratch cwd whose `.env` names a dead backend, notifications
 * and telemetry off, `CMUX_*`/`LOP_*` stripped, and the mock-keychain switch so a
 * scratch home cannot ask macOS to create a login keychain.
 *
 * Usage:
 *   node scripts/browser-address-overlay-probe.mjs --out <evidence dir>
 *
 * Evidence written into <out>: plan.json, build-identity.json, matrix.md,
 * events.jsonl, facts.json, app.log, teardown.json.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(join(ROOT, "package.json"));

function fail(message) {
	console.error(`[probe] ${message}`);
	process.exit(2);
}

function arg(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const OUT = arg("--out");
if (!OUT) fail("--out <evidence dir> is required");
const RUN = join(OUT, "run");
const FRAMES = join(RUN, "frames");
mkdirSync(FRAMES, { recursive: true });
mkdirSync(join(RUN, "cwd"), { recursive: true });

const ELECTRON_BIN = requireFromRepo("electron");
if (typeof ELECTRON_BIN !== "string" || !existsSync(ELECTRON_BIN)) {
	fail(`the Electron runtime is not on disk at ${String(ELECTRON_BIN)}`);
}
const ELECTRON_VERSION = requireFromRepo("electron/package.json").version;

const at = () => new Date().toISOString();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Every planned row, in order. A row starts as asserted-only until an
 * observation replaces it; nothing is ever PASS because it was expected. */
const rows = [];
function plan(id, claim, mode = "driven") {
	rows.push({ id, claim, mode, status: "pending", evidence: "", at: null });
}
function record(id, status, evidence) {
	const row = rows.find((entry) => entry.id === id);
	if (!row) throw new Error(`unknown row ${id}`);
	row.status = status;
	row.evidence = evidence;
	row.at = at();
	appendEvent({ event: "row", id, status, evidence });
	return row;
}

const eventsFile = join(OUT, "events.jsonl");
function appendEvent(payload) {
	appendFileSync(eventsFile, `${JSON.stringify({ at: at(), ...payload })}\n`);
}

// ---- build identity --------------------------------------------------------

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const emitted = {
	main: join(ROOT, "out/main/index.js"),
	preload: join(ROOT, "out/preload/index.js"),
	renderer: join(ROOT, "out/renderer/index.html"),
	overlayDocument: join(ROOT, "out/renderer/browser-address-overlay.html"),
};
for (const [name, path] of Object.entries(emitted)) {
	if (!existsSync(path)) fail(`missing built artifact ${name}: ${path}`);
}
const overlayHtml = readFileSync(emitted.overlayDocument, "utf8");
const csp = overlayHtml.match(
	/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)?.[1];
const buildIdentity = {
	at: at(),
	gitHead: spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: ROOT,
		encoding: "utf8",
	}).stdout.trim(),
	gitBranch: spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		cwd: ROOT,
		encoding: "utf8",
	}).stdout.trim(),
	node: process.version,
	electron: ELECTRON_VERSION,
	artifacts: Object.fromEntries(
		Object.entries(emitted).map(([name, path]) => [
			name,
			{ path, sha256: sha256(path), bytes: readFileSync(path).byteLength },
		]),
	),
	overlayDocument: {
		csp,
		hasScriptTag: /<script\b/i.test(overlayHtml),
		hasAutofocus: /autofocus/i.test(overlayHtml),
		hasUnsafeInline: /unsafe-inline/i.test(overlayHtml),
	},
};
writeFileSync(
	join(OUT, "build-identity.json"),
	`${JSON.stringify(buildIdentity, null, 2)}\n`,
);
if (buildIdentity.overlayDocument.hasScriptTag) {
	fail("the emitted overlay document contains a script tag");
}
if (buildIdentity.overlayDocument.hasUnsafeInline) {
	fail("the emitted overlay document allows unsafe-inline styles");
}

// ---- plan ------------------------------------------------------------------

plan(
	"G1",
	"off gate (driver armed, S1 env absent): the bridge exists, the overlay probe channel does not, and no child is created",
);
plan(
	"G2",
	"off gate: the browser route still mounts its real address input (the in-flow path is untouched in source; this row proves it also renders)",
);
plan(
	"G3",
	"S1 env without an armed driver: no dev bridge exists, so the probe is unreachable and the app log shows no overlay controller",
);
plan(
	"S1",
	"armed: facts start absent with no child and a presented page; show creates exactly one child after readiness, hidden until ready",
);
plan(
	"S2a",
	"first show: child created lazily, visible and topmost after readiness, with the documented 160-DIP top-strip geometry",
);
plan(
	"S2b",
	"first show: page native bounds and page visibility are identical before and during the overlay",
);
plan(
	"S2c",
	"first hide: the child is hidden but retained with the same webContents id",
);
plan(
	"S3",
	"20 show/hide cycles: one child, one webContents id, one load, no listener/timer/child-count growth",
);
plan(
	"S4",
	"a background agent page created while shown: the child is re-added last, stays visible, and the active page does not move",
);
plan("S5a", "tab switch hides the child");
plan("S5b", "returning to the bound tab still requires an explicit show");
plan(
	"S5c",
	"closing the bound tab destroys the child; a later show lazily creates exactly one replacement",
);
plan(
	"S6",
	"window resize invalidates old geometry, hides the child, and a fresh show is recomputed inside the new content rect",
);
plan(
	"S7",
	"route loss (null content rect) hides the child without destroying it; returning and showing works",
);
plan("S8", "page suppression hides the child");
plan("S8b", "restoring page visibility still requires an explicit show");
plan(
	"S9",
	"hide while a fresh child is still loading cancels the show; late readiness cannot make it visible",
);
plan(
	"S10",
	"active-page renderer crash releases the bound child and a new tab can show a new one",
);
plan(
	"S11",
	"child renderer crash latches the overlay off for this host lifetime (no restart loop)",
);
plan(
	"S12",
	"focus/window/resource accounting: the headless window is never raised or focused; child webContents ids disappear on disposal",
);
plan(
	"G1-teardown",
	"the off-gate boot stops cleanly (the S1 hook adds no teardown path when the gate is off)",
);
plan(
	"G3-log",
	"S1 without an armed driver: the gate refusal line is printed and no overlay controller line exists",
);
plan(
	"T1a",
	"app quit (SIGTERM, the documented headless stop): exit 0, overlay disposed before pages, no destroyed-object callback exception, survivors=[] leftovers=0",
);
plan(
	"T1b",
	"window close (CDP Browser.close): clean exit 0, host stopped, overlay disposed, no destroyed-object callback exception",
);
plan(
	"A1",
	"non-headless refusal (inactive/normal) is asserted in the pure gate and unit tests; this probe deliberately launches no visible window",
	"asserted-only",
);
plan(
	"A2",
	"foreign window / driven page / subframe sender rejection is the existing owner-main-frame guard, asserted by source and the unit suite",
	"asserted-only",
);
plan(
	"A3",
	"startup rollback orders overlay disposal before page destruction; asserted by source order and the unit suite, not by a forced failed startup",
	"asserted-only",
);
plan(
	"A4",
	"normal preload and browser API are unchanged; only the new dev-driver method exists behind the armed bridge",
	"asserted-only",
);
plan(
	"A5",
	"native-composite pixel order and native mouse/hit routing are NOT measured by this probe",
	"asserted-only",
);

// ---- CDP ------------------------------------------------------------------

class Cdp {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		this.listeners = new Map();
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id && this.pending.has(message.id)) {
				const { resolve: done, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				if (message.error) reject(new Error(JSON.stringify(message.error)));
				else done(message.result);
				return;
			}
			const list = this.listeners.get(message.method) ?? [];
			for (const listener of list) listener(message.params);
		});
	}
	send(method, params = {}, timeoutMs = 30_000) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}
	on(method, listener) {
		const list = this.listeners.get(method) ?? [];
		list.push(listener);
		this.listeners.set(method, list);
	}
	close() {
		try {
			this.socket.close();
		} catch {
			// Already closed.
		}
	}
}

async function connect(webSocketDebuggerUrl) {
	const socket = new WebSocket(webSocketDebuggerUrl);
	await new Promise((done, reject) => {
		socket.addEventListener("open", done, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	return new Cdp(socket);
}

async function targets(port) {
	const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
		signal: AbortSignal.timeout(5_000),
	});
	return response.json();
}

async function waitForTarget(port, predicate, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	let last = [];
	while (Date.now() < deadline) {
		try {
			last = await targets(port);
			const match = last.find(predicate);
			if (match) return match;
		} catch {
			// The port is not listening yet.
		}
		await sleep(150);
	}
	throw new Error(
		`no target matched within ${timeoutMs}ms; last list: ${JSON.stringify(
			last.map((target) => ({ type: target.type, url: target.url })),
		)}`,
	);
}

const isMainTarget = (target) =>
	target.type === "page" &&
	(/\/index\.html(?:[?#].*)?$/.test(target.url) ||
		target.url === "http://localhost:5173/");
const isOverlayTarget = (target) =>
	target.type === "page" && target.url.endsWith("browser-address-overlay.html");
const isAboutBlank = (target) =>
	target.type === "page" && target.url === "about:blank";

// ---- boot -----------------------------------------------------------------

const boots = [];
const pageServers = [];
let bootTag = 0;

async function boot({ s1, driver, tag }) {
	bootTag += 1;
	const home = join(RUN, `home-${bootTag}`);
	const config = join(RUN, `config-${bootTag}`);
	const logs = join(RUN, `logs-${bootTag}`);
	const profile = join(RUN, `profile-${bootTag}`);
	for (const dir of [home, config, logs, profile])
		mkdirSync(dir, { recursive: true });
	const cwd = join(RUN, "cwd");
	const deadPort = await freePort();
	// The app's dotenv load is `override: true`, so this file (not the checkout's)
	// decides the backend URL. It is a dead loopback port: the run can start, and it
	// cannot write into the operator's backend.
	writeFileSync(
		join(cwd, ".env"),
		`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${deadPort}\nVITE_DISABLE_BACKEND_MANAGER=true\n`,
	);
	const port = await freePort();
	const env = withNotificationsOff({
		...process.env,
		HOME: home,
		LOCAL_OPERATOR_CONFIG_DIR: config,
		LOCAL_OPERATOR_LOG_DIR: logs,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		LOCAL_OPERATOR_UI_DEV_DRIVER: driver ? "1" : undefined,
		LOCAL_OPERATOR_UI_DEV_DRIVER_OUT: driver ? FRAMES : undefined,
		LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1: s1 ? "1" : undefined,
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	const child = spawn(
		ELECTRON_BIN,
		[
			ROOT,
			`--user-data-dir=${profile}`,
			`--remote-debugging-port=${port}`,
			"--window-mode=headless",
			"--window-size=1380x900",
			MOCK_KEYCHAIN_SWITCH,
		],
		{ env, cwd, stdio: ["ignore", "pipe", "pipe"] },
	);
	const logPath = join(OUT, "app.log");
	appendFileSync(
		logPath,
		`\n===== boot ${bootTag} (${tag}) s1=${s1 ? 1 : 0} driver=${driver ? 1 : 0} pid=${child.pid} =====\n`,
	);
	const stream = [];
	const write = () => {
		if (stream.length === 0) return;
		appendFileSync(logPath, stream.join(""));
		stream.length = 0;
	};
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const flushTimer = setInterval(write, 300);
	const exited = new Promise((done) => {
		child.once("exit", (code, signal) => {
			clearInterval(flushTimer);
			write();
			done({ code, signal });
		});
	});
	const handle = {
		tag,
		child,
		port,
		home,
		config,
		profile,
		logs,
		logPath,
		exited,
		flush: write,
		async stop(signal = "SIGTERM") {
			if (child.exitCode !== null) return;
			child.kill(signal);
		},
	};
	boots.push(handle);
	appendEvent({ event: "boot", tag, s1, driver, pid: child.pid, port });
	return handle;
}

/**
 * A local page for the driven tab.
 *
 * WHY THIS IS REQUIRED: a fresh tab sits on `about:blank`, and the product
 * deliberately paints its own start surface over that state
 * (`browser-surface.tsx`, `onStartPage`) — so a native page is NOT presented and
 * the overlay correctly refuses "no_layout". The probe must put the tab on a real
 * document before "the page stays visible under the child" is a claim about a
 * presented page at all.
 */
async function startPageServer() {
	const server = createHttpServer((request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(
			'<!doctype html><html><head><title>overlay probe page</title></head><body style="margin:0;background:#f4f1ea"><h1>overlay probe page</h1></body></html>',
		);
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}/`,
		close: () => new Promise((done) => server.close(done)),
	};
}

/** Poll until the registry presents the active page (start page gone). */
async function waitForPresented(cdp, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await probe(cdp, "facts");
		if (last.page?.presented === true && last.page?.visible === true)
			return last;
		await sleep(200);
	}
	throw new Error(`the page never presented: ${JSON.stringify(last?.page)}`);
}

/**
 * Put the active tab on a UNIQUE local page and wait until the registry presents
 * that document. The unique query is what makes the active page's CDP target
 * identifiable later: several tabs in this matrix end up on the same origin, and
 * `targets()` exposes URLs, not tab ids.
 */
let activePageUrl = null;
let pageSequence = 0;
async function presentActivePage(cdp, pageServer) {
	const pageUrl = `${pageServer.url}?page=${++pageSequence}`;
	await evaluate(
		cdp,
		`window.api.browser.navigate(${JSON.stringify(pageUrl)})`,
	);
	const facts = await waitForPresented(cdp);
	activePageUrl = pageUrl;
	return facts;
}

async function freePort() {
	const server = createServer();
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	await new Promise((done) => server.close(done));
	return port;
}

async function connectMain(handle) {
	const target = await waitForTarget(handle.port, isMainTarget, 30_000);
	const cdp = await connect(target.webSocketDebuggerUrl);
	await cdp.send("Runtime.enable");
	return { cdp, target };
}

/** Evaluate in the page and unwrap the value, surfacing page exceptions. */
async function evaluate(cdp, expression) {
	const result = await cdp.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
		userGesture: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			`page exception: ${
				result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text
			}`,
		);
	}
	return result.result?.value;
}

/** The gated probe, or a thrown refusal — never a fabricated answer. */
async function probe(cdp, action) {
	return evaluate(
		cdp,
		`(async () => {
			try {
				return { ok: true, value: await window.__loDevDriver.addressOverlay(${JSON.stringify(
					action,
				)}) };
			} catch (error) {
				return { ok: false, error: String(error && error.message ? error.message : error) };
			}
		})()`,
	).then((answer) => {
		if (!answer || answer.ok !== true) {
			throw new Error(answer?.error ?? "the probe returned no answer");
		}
		appendEvent({ event: "probe", action, value: answer.value });
		return answer.value;
	});
}

/** The renderer installs its verbs after mount; the bridge exists earlier. */
async function waitForDriver(cdp, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await evaluate(
			cdp,
			"window.__loDevDriver && typeof window.__loDevDriver.verbs === 'function' ? window.__loDevDriver.verbs() : null",
		);
		if (Array.isArray(last) && last.includes("navigate")) return last;
		await sleep(200);
	}
	throw new Error(
		`the dev driver never installed its verbs: ${JSON.stringify(last)}`,
	);
}

async function driverFacts(cdp) {
	return evaluate(cdp, "window.__loDevDriver.facts()");
}

async function browserState(cdp) {
	return evaluate(cdp, "window.api.browser.state()");
}

async function navigate(cdp, route) {
	await evaluate(
		cdp,
		`window.__loDevDriver.call("navigate", ${JSON.stringify(route)})`,
	);
}

/** Wait for the browser surface to exist AND report a non-empty measured rect. */
async function waitForSurface(cdp, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await evaluate(
			cdp,
			`(() => {
				const node = document.querySelector('[data-tour-tag="browser-content"]');
				if (!node) return { present: false, rect: null };
				const box = node.getBoundingClientRect();
				return {
					present: true,
					rect: {
						x: Math.round(box.x),
						y: Math.round(box.y),
						width: Math.round(box.width),
						height: Math.round(box.height),
					},
				};
			})()`,
		);
		if (
			last?.present &&
			last.rect &&
			last.rect.width > 0 &&
			last.rect.height > 0
		) {
			return last.rect;
		}
		await sleep(150);
	}
	throw new Error(
		`the browser surface never reported a rect: ${JSON.stringify(last)}`,
	);
}

async function waitForActiveTab(cdp, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await browserState(cdp);
		if (last && typeof last.activeTabId === "number") return last;
		await sleep(150);
	}
	throw new Error(`no active browser tab: ${JSON.stringify(last)}`);
}

async function rpc(handle, body) {
	const statePath = join(handle.config, "run/ui-browser/host.json");
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (existsSync(statePath)) break;
		await sleep(150);
	}
	if (!existsSync(statePath))
		throw new Error("the browser host state file never appeared");
	const state = JSON.parse(readFileSync(statePath, "utf8"));
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		signal: AbortSignal.timeout(20_000),
		headers: {
			"content-type": "application/json",
			"X-Bridge-Key": state.session_key,
			"X-Bridge-Instance": state.instance_id ?? "",
		},
		body: JSON.stringify(body),
	});
	const answer = await response.json();
	if (answer.ok === false) throw new Error(JSON.stringify(answer.error));
	return answer.result ?? answer;
}

const sameRect = (a, b) =>
	a &&
	b &&
	a.x === b.x &&
	a.y === b.y &&
	a.width === b.width &&
	a.height === b.height;
const topStrip = (rect) => {
	const height = Math.min(160, rect.height);
	return { x: rect.x, y: rect.y, width: rect.width, height };
};

function descendants(pid) {
	const result = spawnSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" });
	const children = new Map();
	for (const line of result.stdout.trim().split("\n")) {
		const [child, parent] = line.trim().split(/\s+/).map(Number);
		if (!Number.isFinite(child) || !Number.isFinite(parent)) continue;
		const list = children.get(parent) ?? [];
		list.push(child);
		children.set(parent, list);
	}
	const found = [];
	const walk = (parent) => {
		for (const child of children.get(parent) ?? []) {
			found.push(child);
			walk(child);
		}
	};
	walk(pid);
	return found;
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function reapTree(pid) {
	const pids = descendants(pid);
	for (const candidate of pids.reverse()) {
		try {
			process.kill(candidate, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already gone.
	}
}

// ---- gate: off, and S1 without a driver ------------------------------------

async function gateOffCase() {
	const handle = await boot({ s1: false, driver: true, tag: "gate-off" });
	try {
		const { cdp } = await connectMain(handle);
		const verbs = await waitForDriver(cdp);
		const bridge = await evaluate(cdp, "typeof window.__loDevDriver");
		const answer = await evaluate(
			cdp,
			`(async () => {
				try {
					await window.__loDevDriver.addressOverlay("facts");
					return { refused: false, error: null };
				} catch (error) {
					return { refused: true, error: String(error && error.message ? error.message : error) };
				}
			})()`,
		);
		record(
			"G1",
			bridge === "object" &&
				answer.refused &&
				/No handler registered/.test(answer.error ?? "")
				? "PASS"
				: "FAIL",
			`bridge=${bridge}; probe=${JSON.stringify(answer)}`,
		);
		await navigate(cdp, "/browser");
		const input = await evaluate(
			cdp,
			`(() => {
				const node = document.querySelector('[data-tour-tag="browser-address"]');
				return node
					? { present: true, tag: node.tagName, editable: !node.disabled && !node.readOnly }
					: { present: false };
			})()`,
		);
		record(
			"G2",
			input?.present && input.editable ? "PASS" : "FAIL",
			JSON.stringify(input),
		);
		cdp.close();
	} finally {
		handle.stop("SIGTERM");
		const result = await handle.exited;
		record(
			"G1-teardown",
			result.code === 0 ? "PASS" : "FAIL",
			`off-gate boot exited code=${result.code} signal=${result.signal}`,
		);
	}
}

async function s1WithoutDriverCase() {
	const before = existsSync(join(OUT, "app.log"))
		? readFileSync(join(OUT, "app.log"), "utf8").length
		: 0;
	const handle = await boot({ s1: true, driver: false, tag: "s1-no-driver" });
	try {
		const { cdp } = await connectMain(handle);
		const bridge = await evaluate(cdp, "typeof window.__loDevDriver");
		const apiKeys = await evaluate(
			cdp,
			"Object.keys(window.api && window.api.browser ? window.api.browser : {}).length",
		);
		record(
			"G3",
			bridge === "undefined" && apiKeys > 0 ? "PASS" : "FAIL",
			`bridge=${bridge}; browserApiMethods=${apiKeys}`,
		);
		cdp.close();
	} finally {
		handle.stop("SIGTERM");
		await handle.exited;
		const log = readFileSync(join(OUT, "app.log"), "utf8").slice(before);
		record(
			"G3-log",
			/\[address-overlay\] not armed: the address overlay needs the armed renderer dev driver/.test(
				log,
			) && !/\[browser\] address overlay/.test(log)
				? "PASS"
				: "FAIL",
			"gate refusal line present; no overlay controller line",
		);
	}
}

// ---- the driven matrix ----------------------------------------------------

async function drivenMatrix() {
	const handle = await boot({ s1: true, driver: true, tag: "matrix" });
	const factsLog = [];
	let cdp = null;
	let cleanupDone = false;
	try {
		const main = await connectMain(handle);
		cdp = main.cdp;
		await waitForDriver(cdp);
		const armedLine = await evaluate(
			cdp,
			"typeof window.__loDevDriver.addressOverlay",
		);
		if (armedLine !== "function")
			fail("the armed bridge has no addressOverlay method");
		await navigate(cdp, "/browser");
		await waitForSurface(cdp);
		const pageServer = await startPageServer();
		pageServers.push(pageServer);
		await evaluate(cdp, "window.api.browser.newTab()");
		await waitForActiveTab(cdp);
		await evaluate(
			cdp,
			`window.api.browser.navigate(${JSON.stringify(pageServer.url)})`,
		);
		const initial = await waitForPresented(cdp);
		factsLog.push({ label: "initial", facts: initial });
		record(
			"S1",
			initial.state === "absent" &&
				initial.child === null &&
				initial.page &&
				initial.page.presented === true &&
				initial.page.visible === true
				? "PASS"
				: "FAIL",
			`state=${initial.state} child=${JSON.stringify(initial.child)} page=${JSON.stringify(initial.page)}`,
		);

		const driverBefore = await driverFacts(cdp);
		const shown = await probe(cdp, "show");
		factsLog.push({ label: "first-show", facts: shown });
		const strip = topStrip(shown.page.bounds);
		const showOk =
			shown.state === "shown" &&
			shown.child !== null &&
			shown.child.visible === true &&
			shown.child.order === shown.child.childCount - 1 &&
			sameRect(shown.child.bounds, strip) &&
			shown.readiness.domReady === true &&
			shown.readiness.finished === true &&
			shown.readiness.loadMs !== null;
		const pageStill =
			shown.page.presented === true &&
			shown.page.visible === true &&
			sameRect(shown.page.bounds, initial.page.bounds);
		record(
			"S2a",
			showOk ? "PASS" : "FAIL",
			`child=${JSON.stringify(shown.child)} expected=${JSON.stringify(strip)} readiness=${JSON.stringify(shown.readiness)}`,
		);
		record(
			"S2b",
			pageStill ? "PASS" : "FAIL",
			`page before=${JSON.stringify(initial.page)} during=${JSON.stringify(shown.page)}`,
		);

		const childId = shown.child.webContentsId;
		const hidden = await probe(cdp, "hide");
		factsLog.push({ label: "first-hide", facts: hidden });
		record(
			"S2c",
			hidden.state === "ready" &&
				hidden.child?.visible === false &&
				hidden.child?.webContentsId === childId
				? "PASS"
				: "FAIL",
			`state=${hidden.state} child=${JSON.stringify(hidden.child)}`,
		);

		// 20 cycles.
		let reused = true;
		let stale = null;
		const listenerBaseline = hidden.listeners;
		for (let cycle = 0; cycle < 20; cycle += 1) {
			const one = await probe(cdp, "show");
			const two = await probe(cdp, "hide");
			if (
				one.child?.webContentsId !== childId ||
				two.child?.webContentsId !== childId ||
				two.child?.visible !== false ||
				one.child?.order !== one.child?.childCount - 1
			) {
				reused = false;
				stale = { cycle, one, two };
				break;
			}
		}
		const afterCycles = await probe(cdp, "facts");
		factsLog.push({ label: "after-20-cycles", facts: afterCycles });
		record(
			"S3",
			reused &&
				afterCycles.childCreatedCount === 1 &&
				afterCycles.listeners.owner === listenerBaseline.owner &&
				afterCycles.listeners.child === listenerBaseline.child &&
				afterCycles.child?.childCount === hidden.child.childCount &&
				afterCycles.readinessTimer === false &&
				afterCycles.pendingShow === false
				? "PASS"
				: "FAIL",
			reused
				? `created=${afterCycles.childCreatedCount} listeners=${JSON.stringify(afterCycles.listeners)} childCount=${afterCycles.child?.childCount}`
				: JSON.stringify(stale),
		);

		// Background agent page while shown: RPC `open` with no URL (a real agent tab,
		// never activated), then the child must be re-added last.
		const shownAgain = await probe(cdp, "show");
		const tabsBefore = await browserState(cdp);
		const opened = await rpc(handle, {
			id: `probe-${Date.now()}`,
			method: "open",
			params: { requester: "session:address-overlay-probe" },
		});
		await sleep(400);
		const afterBackground = await probe(cdp, "facts");
		factsLog.push({ label: "after-background-page", facts: afterBackground });
		const tabsAfter = await browserState(cdp);
		const backgroundOk =
			afterBackground.child !== null &&
			afterBackground.child.visible === true &&
			afterBackground.child.order === afterBackground.child.childCount - 1 &&
			sameRect(afterBackground.page.bounds, shownAgain.page.bounds) &&
			tabsAfter.tabs.length === tabsBefore.tabs.length + 1;
		record(
			"S4",
			backgroundOk ? "PASS" : "FAIL",
			`child=${JSON.stringify(afterBackground.child)} tabs ${tabsBefore.tabs.length}->${tabsAfter.tabs.length} agentTab=${opened?.tab ?? "none"}`,
		);

		// Switch away and back; close the bound tab.
		const boundTab = afterBackground.layout.activeTabId;
		await evaluate(cdp, "window.api.browser.newTab()");
		await sleep(500);
		const switched = await probe(cdp, "facts");
		factsLog.push({ label: "after-tab-switch", facts: switched });
		record(
			"S5a",
			switched.layout.activeTabId !== boundTab &&
				switched.child?.visible === false
				? "PASS"
				: "FAIL",
			`active ${boundTab}->${switched.layout.activeTabId}; child=${JSON.stringify(switched.child)}`,
		);
		await evaluate(cdp, `window.api.browser.activateTab(${boundTab})`);
		await sleep(500);
		const back = await probe(cdp, "facts");
		record(
			"S5b",
			back.layout.activeTabId === boundTab && back.child?.visible === false
				? "PASS"
				: "FAIL",
			`child hidden after return: ${JSON.stringify(back.child)}`,
		);
		await evaluate(cdp, `window.api.browser.closeTab(${boundTab})`);
		await sleep(700);
		const afterClose = await probe(cdp, "facts");
		factsLog.push({ label: "after-bound-tab-close", facts: afterClose });
		const newActive = (await browserState(cdp)).activeTabId;
		if (typeof newActive !== "number") {
			throw new Error("closing the bound tab left no active tab to show on");
		}
		// The surviving tab is on about:blank, where the PRODUCT paints its start
		// page instead of presenting the native view. Give it a real document before
		// "a later show creates a replacement" is a claim about a presented page.
		await presentActivePage(cdp, pageServer);
		const replacement = await probe(cdp, "show");
		factsLog.push({ label: "replacement-show", facts: replacement });
		record(
			"S5c",
			afterClose.child === null &&
				afterClose.childCreatedCount === 1 &&
				replacement.child !== null &&
				replacement.child.webContentsId !== childId &&
				afterClose.childCreatedCount + 1 === replacement.childCreatedCount
				? "PASS"
				: "FAIL",
			`afterClose=${JSON.stringify(afterClose.child)} created=${afterClose.childCreatedCount}; replacement=${JSON.stringify(replacement.child)} created=${replacement.childCreatedCount}`,
		);

		// Resize through CDP's browser domain; the renderer's own ResizeObserver
		// reports the new rect, and the overlay must invalidate first.
		try {
			/*
			 * The Browser domain lives on the BROWSER target, not the page target
			 * (measured: `Browser.getWindowForTarget` is -32601 on the page socket).
			 * The fallback is the renderer's own `window.resizeTo`, which is a real
			 * window resize in Electron, not a viewport override.
			 */
			const version = await (
				await fetch(`http://127.0.0.1:${handle.port}/json/version`, {
					signal: AbortSignal.timeout(5_000),
				})
			).json();
			let resizedVia = "browser-cdp";
			try {
				const browserCdp = await connect(version.webSocketDebuggerUrl);
				const windowInfo = await browserCdp.send("Browser.getWindowForTarget", {
					targetId: main.target.id,
				});
				await browserCdp.send("Browser.setWindowBounds", {
					windowId: windowInfo.windowId,
					bounds: { width: 1200, height: 800 },
				});
				browserCdp.close();
				await sleep(1_200);
			} catch (error) {
				resizedVia = `window.resizeTo (browser-cdp failed: ${String(error)})`;
				await evaluate(cdp, "window.resizeTo(1200, 800)");
				await sleep(1_500);
			}
			const resized = await probe(cdp, "facts");
			factsLog.push({ label: "after-resize", facts: resized });
			const resizedShown = await probe(cdp, "show");
			factsLog.push({ label: "after-resize-show", facts: resizedShown });
			record(
				"S6",
				resized.child?.visible === false &&
					resizedShown.child?.visible === true &&
					sameRect(
						resizedShown.child.bounds,
						topStrip(resizedShown.page.bounds),
					) &&
					resizedShown.page.bounds.width < shown.page.bounds.width
					? "PASS"
					: "FAIL",
				`via=${resizedVia}; hidden=${JSON.stringify(resized.child)} shown=${JSON.stringify(resizedShown.child)} page=${JSON.stringify(resizedShown.page.bounds)}`,
			);
			if (!resizedVia.startsWith("window.resizeTo")) {
				const browserCdp = await connect(version.webSocketDebuggerUrl);
				const windowInfo = await browserCdp.send("Browser.getWindowForTarget", {
					targetId: main.target.id,
				});
				await browserCdp.send("Browser.setWindowBounds", {
					windowId: windowInfo.windowId,
					bounds: { width: 1380, height: 900 },
				});
				browserCdp.close();
			} else {
				await evaluate(cdp, "window.resizeTo(1380, 900)");
			}
			await sleep(800);
		} catch (error) {
			record(
				"S6",
				"BLOCKED",
				`Browser.setWindowBounds failed: ${String(error)}`,
			);
		}

		// Route loss: the surface unmounts and reports null.
		await probe(cdp, "show");
		await navigate(cdp, "/chat");
		await sleep(700);
		const routedAway = await probe(cdp, "facts");
		factsLog.push({ label: "route-away", facts: routedAway });
		await navigate(cdp, "/browser");
		await waitForSurface(cdp);
		await sleep(400);
		const routedBack = await probe(cdp, "show");
		record(
			"S7",
			routedAway.layout.contentRect === null &&
				routedAway.child?.visible === false &&
				routedBack.child?.visible === true
				? "PASS"
				: "FAIL",
			`away layout=${JSON.stringify(routedAway.layout)} child=${JSON.stringify(routedAway.child)}; back=${routedBack.state}`,
		);

		// Suppression is the product's own dialog path.
		await evaluate(cdp, "window.api.browser.setViewVisible(false)");
		await sleep(500);
		const suppressed = await probe(cdp, "facts");
		await evaluate(cdp, "window.api.browser.setViewVisible(true)");
		await sleep(500);
		const restored = await probe(cdp, "facts");
		record(
			"S8",
			suppressed.layout.presented === false &&
				suppressed.child?.visible === false &&
				restored.child?.visible === false
				? "PASS"
				: "FAIL",
			`suppressed presented=${suppressed.layout.presented} child=${JSON.stringify(suppressed.child)}; restored child=${JSON.stringify(restored.child)}`,
		);
		const shownAfterRestore = await probe(cdp, "show");
		record(
			"S8b",
			shownAfterRestore.child?.visible === true ? "PASS" : "FAIL",
			`explicit show after restore: ${JSON.stringify(shownAfterRestore.child)}`,
		);

		// Pending load: destroy the child (tab close), make a fresh tab, then issue
		// show and hide without awaiting between them.
		const beforePending = await probe(cdp, "facts");
		await evaluate(
			cdp,
			`window.api.browser.closeTab(${beforePending.layout.activeTabId})`,
		);
		await sleep(500);
		await evaluate(cdp, "window.api.browser.newTab()");
		await sleep(500);
		await presentActivePage(cdp, pageServer);
		const raced = await evaluate(
			cdp,
			`(async () => {
				const showing = window.__loDevDriver.addressOverlay("show");
				const hiding = window.__loDevDriver.addressOverlay("hide");
				const [show, hide] = await Promise.all([showing, hiding]);
				return { show, hide };
			})()`,
		);
		await sleep(400);
		const afterRace = await probe(cdp, "facts");
		factsLog.push({ label: "pending-hide-race", facts: afterRace });
		const raceShown = await probe(cdp, "show");
		record(
			"S9",
			raced.show?.shown !== true &&
				afterRace.child?.visible === false &&
				raceShown.child?.visible === true
				? "PASS"
				: "FAIL",
			`race=${JSON.stringify(raced)} after=${afterRace.state} visible=${afterRace.child?.visible}; later show=${raceShown.state}`,
		);

		// Page renderer crash: release the bound child, then a new tab can show one.
		const pageTarget = (await targets(handle.port)).find(
			(target) => target.type === "page" && target.url === activePageUrl,
		);
		if (pageTarget) {
			const activeBefore = await probe(cdp, "facts");
			try {
				const pageCdp = await connect(pageTarget.webSocketDebuggerUrl);
				await Promise.race([
					pageCdp.send("Page.crash", {}, 2_000),
					sleep(2_000),
				]).catch(() => {});
				pageCdp.close();
				await sleep(1_500);
				const afterPageCrash = await probe(cdp, "facts");
				factsLog.push({ label: "after-page-crash", facts: afterPageCrash });
				await evaluate(cdp, "window.api.browser.newTab()");
				await sleep(600);
				await presentActivePage(cdp, pageServer);
				const recovered = await probe(cdp, "show");
				record(
					"S10",
					afterPageCrash.child === null && recovered.child?.visible === true
						? "PASS"
						: "FAIL",
					`boundTab=${activeBefore.layout.activeTabId}; after crash child=${JSON.stringify(afterPageCrash.child)} state=${afterPageCrash.state}; new show=${recovered.state}`,
				);
			} catch (error) {
				record("S10", "BLOCKED", `Page.crash could not run: ${String(error)}`);
			}
		} else {
			record(
				"S10",
				"BLOCKED",
				"no about:blank page target was exposed over CDP",
			);
		}

		// Child renderer crash latches off.
		const beforeCrash = await probe(cdp, "show");
		const overlayTarget = (await targets(handle.port)).find(isOverlayTarget);
		if (overlayTarget) {
			try {
				const childCdp = await connect(overlayTarget.webSocketDebuggerUrl);
				await Promise.race([
					childCdp.send("Page.crash", {}, 2_000),
					sleep(2_000),
				]).catch(() => {});
				childCdp.close();
				await sleep(1_500);
				const crashed = await probe(cdp, "facts");
				const refused = await probe(cdp, "show");
				factsLog.push({ label: "after-child-crash", facts: crashed });
				record(
					"S11",
					crashed.state === "failed" &&
						crashed.child === null &&
						/crash|destroyed/.test(crashed.failedReason ?? "") &&
						refused.state === "failed"
						? "PASS"
						: "FAIL",
					`state=${crashed.state} failedReason=${crashed.failedReason} child=${JSON.stringify(crashed.child)}; subsequent show state=${refused.state}`,
				);
			} catch (error) {
				record(
					"S11",
					"BLOCKED",
					`Page.crash on the child failed: ${String(error)}`,
				);
			}
		} else {
			record(
				"S11",
				"BLOCKED",
				`no overlay target was exposed over CDP (shown=${beforeCrash.state})`,
			);
		}

		// Focus/window/resources.
		const driverAfter = await driverFacts(cdp);
		const finalFacts = await probe(cdp, "facts");
		factsLog.push({ label: "final", facts: finalFacts });
		const windowStable =
			driverBefore.visible === driverAfter.visible &&
			driverBefore.focused === driverAfter.focused &&
			driverBefore.minimized === driverAfter.minimized &&
			driverBefore.windowSize.width === driverAfter.windowSize.width &&
			driverBefore.windowSize.height === driverAfter.windowSize.height;
		const childGone = finalFacts.child === null;
		record(
			"S12",
			windowStable && childGone && driverAfter.visible === false
				? "PASS"
				: "FAIL",
			`window before=${JSON.stringify({
				visible: driverBefore.visible,
				focused: driverBefore.focused,
				minimized: driverBefore.minimized,
				size: driverBefore.windowSize,
			})} after=${JSON.stringify({
				visible: driverAfter.visible,
				focused: driverAfter.focused,
				minimized: driverAfter.minimized,
				size: driverAfter.windowSize,
			})}; child=${JSON.stringify(finalFacts.child)}`,
		);
		writeFileSync(
			join(OUT, "facts.json"),
			`${JSON.stringify(factsLog, null, 2)}\n`,
		);

		// App quit is the documented headless stop (`endHeadlessRun`): SIGTERM is
		// turned into a bounded exit by `src/main/index.ts`, and every earlier boot
		// in this run exits 0 through it. `window.close()` is deliberately NOT used:
		// a script cannot close a window it did not open (measured: the app stayed
		// alive 15 s), and macOS keeps a windowless app up in any case — the window
		// close has its own row and boot below.
		const pid = handle.child.pid;
		const treeBefore = descendants(pid);
		handle.stop("SIGTERM");
		const exit = await Promise.race([
			handle.exited,
			sleep(30_000).then(() => null),
		]);
		cleanupDone = exit !== null;
		const log = readFileSync(join(OUT, "app.log"), "utf8");
		const leftover = [pid, ...treeBefore].filter((candidate) =>
			alive(candidate),
		);
		for (const candidate of leftover) {
			try {
				process.kill(candidate, "SIGKILL");
			} catch {
				// Already gone.
			}
		}
		const teardown = {
			at: at(),
			boot: "matrix",
			pid,
			descendantsBeforeClose: treeBefore,
			exit,
			overlayDisposed:
				/\[browser\] address overlay disposed: (host-stop|window_closed|owner_destroyed)/.test(
					log,
				),
			hostStopped: /\[browser\] host stopped/.test(log),
			destroyedObjectCallbacks: (log.match(/Object has been destroyed/g) ?? [])
				.length,
			survivors: leftover.length === 0 ? [] : leftover,
			leftovers: leftover.length,
		};
		writeFileSync(
			join(OUT, "teardown.json"),
			`${JSON.stringify(teardown, null, 2)}\n`,
		);
		record(
			"T1a",
			exit !== null &&
				exit.code === 0 &&
				teardown.overlayDisposed &&
				teardown.hostStopped &&
				teardown.destroyedObjectCallbacks === 0 &&
				teardown.leftovers === 0
				? "PASS"
				: "FAIL",
			JSON.stringify(
				exit
					? {
							code: exit.code,
							signal: exit.signal,
							overlayDisposed: teardown.overlayDisposed,
							hostStopped: teardown.hostStopped,
							destroyedObjectCallbacks: teardown.destroyedObjectCallbacks,
							survivors: teardown.survivors,
							leftovers: teardown.leftovers,
						}
					: { timeout: true, survivors: teardown.survivors },
			),
		);
	} finally {
		if (!cleanupDone) {
			handle.stop("SIGTERM");
			const exit = await Promise.race([
				handle.exited,
				sleep(10_000).then(() => null),
			]);
			const leftover = [
				handle.child.pid,
				...descendants(handle.child.pid),
			].filter(alive);
			reapTree(handle.child.pid);
			writeFileSync(
				join(OUT, "teardown.json"),
				`${JSON.stringify(
					{
						at: at(),
						boot: "matrix",
						exit,
						survivors: leftover,
						leftovers: leftover.length,
					},
					null,
					2,
				)}\n`,
			);
			if (!rows.find((entry) => entry.id === "T1a")?.at) {
				record(
					"T1a",
					"FAIL",
					`the matrix exited early; teardown=${JSON.stringify({ exit, leftover })}`,
				);
			}
		}
		if (cdp) cdp.close();
		for (const server of pageServers.splice(0)) {
			await server.close().catch(() => {});
		}
		if (existsSync(join(OUT, "app.log"))) {
			// Keep the evidence file complete even on an early failure.
			handle.flush();
		}
	}
}

// ---- window close ----------------------------------------------------------

async function windowCloseCase() {
	const handle = await boot({ s1: true, driver: true, tag: "window-close" });
	let browserCdp = null;
	try {
		const { cdp } = await connectMain(handle);
		await waitForDriver(cdp);
		await navigate(cdp, "/browser");
		await waitForSurface(cdp);
		const pageServer = await startPageServer();
		pageServers.push(pageServer);
		await evaluate(cdp, "window.api.browser.newTab()");
		await waitForActiveTab(cdp);
		await presentActivePage(cdp, pageServer);
		const shown = await probe(cdp, "show");
		if (shown.state !== "shown") {
			throw new Error(
				`the child was not shown before the close: ${shown.state}`,
			);
		}
		const before = readFileSync(join(OUT, "app.log"), "utf8").length;
		const version = await (
			await fetch(`http://127.0.0.1:${handle.port}/json/version`, {
				signal: AbortSignal.timeout(5_000),
			})
		).json();
		browserCdp = await connect(version.webSocketDebuggerUrl);
		await Promise.race([
			browserCdp.send("Browser.close", {}, 5_000).catch(() => {}),
			sleep(5_000),
		]);
		browserCdp.close();
		browserCdp = null;
		await sleep(5_000);
		const slice = readFileSync(join(OUT, "app.log"), "utf8").slice(before);
		const hostStopped = /\[browser\] host stopped/.test(slice);
		const overlayDisposed =
			/\[browser\] address overlay disposed: (owner_destroyed|window_closed|host-stop)/.test(
				slice,
			);
		const destroyed = (slice.match(/Object has been destroyed/g) ?? []).length;
		const exitCode = handle.child.exitCode;
		record(
			"T1b",
			hostStopped && overlayDisposed && destroyed === 0 && exitCode === 0
				? "PASS"
				: "FAIL",
			`exit=${exitCode} hostStopped=${hostStopped} overlayDisposed=${overlayDisposed} destroyedObjectCallbacks=${destroyed}`,
		);
	} catch (error) {
		record("T1b", "BLOCKED", `the window-close boot failed: ${String(error)}`);
	} finally {
		if (browserCdp) browserCdp.close();
		handle.stop("SIGTERM");
		await Promise.race([handle.exited, sleep(5_000)]);
		reapTree(handle.child.pid);
	}
}

// ---- asserted-only rows ----------------------------------------------------

function closeAssertedRows() {
	record(
		"A1",
		"asserted-only",
		"resolveAddressOverlayGate refuses inactive/normal in unit tests; no visible window was launched by this probe",
	);
	record(
		"A2",
		"asserted-only",
		"browser/ipc.ts authorizeSender is the existing owner/main-frame/trusted-URL guard; unit tests cover the action vocabulary, not a foreign sender",
	);
	record(
		"A3",
		"asserted-only",
		"host rollback registers overlay disposal after the registry entry (reverse order runs it first); unit tests assert idempotent disposal, not a forced failed startup",
	);
	record(
		"A4",
		"asserted-only",
		"normal preload/index.d.ts and the browser API are untouched; the only renderer change is the new inert HTML",
	);
	record(
		"A5",
		"asserted-only",
		"no native-composite capture or native hit routing was attempted; a child-only frame would not prove either",
	);
}

// ---- run ------------------------------------------------------------------

console.log(`[probe] evidence: ${OUT}`);
appendEvent({ event: "start", out: OUT, build: buildIdentity });
try {
	await gateOffCase();
	await s1WithoutDriverCase();
	await drivenMatrix();
	await windowCloseCase();
} catch (error) {
	console.error(`[probe] matrix failed: ${String(error?.stack ?? error)}`);
	appendEvent({ event: "failure", error: String(error?.stack ?? error) });
	for (const row of rows) {
		if (row.at === null)
			record(row.id, "FAIL", `matrix aborted: ${String(error)}`);
	}
} finally {
	closeAssertedRows();
	for (const bootHandle of boots) {
		if (bootHandle.child.exitCode === null) {
			reapTree(bootHandle.child.pid);
			try {
				bootHandle.child.kill("SIGKILL");
			} catch {
				// Already gone.
			}
		}
	}
	const unresolved = rows.filter((row) => row.at === null);
	for (const row of unresolved) {
		record(row.id, "BLOCKED", "not reached by this run");
	}
	writeFileSync(join(OUT, "plan.json"), `${JSON.stringify(rows, null, 2)}\n`);
	const counts = {};
	for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
	const table = [
		"| Row | Claim | Status | Actual evidence |",
		"| --- | --- | --- | --- |",
		...rows.map(
			(row) =>
				`| ${row.id} | ${row.claim.replace(/\|/g, "\\|")} | ${row.status} | ${row.evidence.replace(/\|/g, "\\|")} |`,
		),
		"",
		`Counts: ${JSON.stringify(counts)}`,
		"",
		"`asserted-only` rows are source/unit assertions, not built-app observations.",
		"`BLOCKED` rows were not driven and are not passes.",
		"",
	].join("\n");
	writeFileSync(join(OUT, "matrix.md"), table);
	appendEvent({ event: "finish", counts });
	console.log(`[probe] ${JSON.stringify(counts)}`);
	console.log(`[probe] matrix: ${join(OUT, "matrix.md")}`);
	const failures = rows.filter((row) => row.status === "FAIL");
	process.exit(failures.length > 0 ? 1 : 0);
}
