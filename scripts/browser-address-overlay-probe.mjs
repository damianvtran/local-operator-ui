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
/** S2's mirror matrix. Off by default so the S1 matrix stays the same-code
 * control and runs unchanged. */
const S2 = process.argv.includes("--s2");
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
	listDocument: join(ROOT, "out/renderer/browser-address-overlay-list.html"),
};
for (const [name, path] of Object.entries(emitted)) {
	if (!existsSync(path)) fail(`missing built artifact ${name}: ${path}`);
}
const overlayHtml = readFileSync(emitted.overlayDocument, "utf8");
const listHtml = existsSync(emitted.listDocument)
	? readFileSync(emitted.listDocument, "utf8")
	: "";
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
	listDocument: {
		present: listHtml !== "",
		csp: listHtml.match(
			/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
		)?.[1],
		assets: [...listHtml.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(
			(match) => match[1],
		),
	},
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

async function boot({ s1, s2, s2Raw, driver, tag }) {
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
		LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2:
			s2Raw ?? (s2 ? "1" : undefined),
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
		`\n===== boot ${bootTag} (${tag}) s1=${s1 ? 1 : 0} s2=${s2 ? 1 : 0} driver=${driver ? 1 : 0} pid=${child.pid} =====\n`,
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
async function probe(cdp, action, argument) {
	return evaluate(
		cdp,
		`(async () => {
			try {
				return { ok: true, value: await window.__loDevDriver.addressOverlay(${JSON.stringify(
					action,
				)}, ${JSON.stringify(argument ?? null)}) };
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

// ---- S2: the mirror list --------------------------------------------------

const S2_CSP =
	"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const S2_ROWS = [
	[
		"P1",
		"built S2 document exists with its script and stylesheet; its CSP equals the pinned one",
	],
	[
		"G1",
		"S2 off (S1 armed): the probe works and the projection channel is absent ('No handler')",
	],
	["G2a", "S2 env alone: printed refusal, no controller"],
	["G2b", "S1+S2 without the armed driver: printed refusal, no bridge"],
	["G2c", "S2=1 with a non-opt-in spelling: printed refusal"],
	[
		"P3",
		"real input drivability: CDP can focus and type into the real address field in a focusable:false window",
	],
	[
		"A1",
		"child x/width = field rect (±1 DIP), y = dock top, never over the field",
	],
	["A2", "page bounds and visibility identical before/open/after"],
	["A3", "child is last in contentView.children and visible"],
	[
		"A4",
		"window resize while open re-anchors to the new field/dock geometry; no stale frame",
	],
	["A5", "zoom != 1 hides with reason 'zoomed' (pure gate)"],
	["A6", "a projection for another tab is refused ('stale_tab') and hides"],
	[
		"A7",
		"out-of-range/NaN/huge/negative/inconsistent/extra-key/oversize projections are refused (unit)",
	],
	[
		"R1",
		"1/3/5 rows render with 35.5 row height and 28 header; rowCount equals the model",
	],
	["R2", "each notice kind renders at 104 DIP; loading-with-no-rows is hidden"],
	[
		"R3",
		"exactly one active row; its rect equals the parent's aria-activedescendant index",
	],
	["R4", "hostile text is literal and capped; no img/script executes"],
	["R5", "ru and ur header/notice render (child pixels)"],
	["R6", "alpha theme is rejected and the opaque fallback is used"],
	[
		"C1",
		"synthetic mouse down/up on row 0 commits through the renderer's real navigate",
	],
	["C2", "down row i / up row j commits nothing"],
	["C3", "stale seq is refused; an out-of-range index names no row"],
	["C4", "candidate set change between project and click is dropped (unit)"],
	[
		"K1",
		"ArrowDown/Enter/Escape/Tab behave as today; the mirror hides on dismissal",
	],
	[
		"K2",
		"keys sent into the child are prevented, counted, and navigate nothing",
	],
	[
		"X1",
		"child has no node/electron/require; inline script blocked; navigation refused",
	],
	["L1", "20 apply/hide cycles reuse one child; listener counts flat"],
	["L1-teardown", "the S2 matrix boot stops with exit 0 and no survivors"],
	[
		"V1",
		"child-only pixels captured and viewed (rows3, rows5-active, notice, hostile, ru, ur)",
	],
	["V2", "native-composite pixels (child over page)", "BLOCKED"],
	["V3", "native hit routing between sibling views", "BLOCKED"],
	["V4", "IME, AX tree, visible-window focus, theme contrast", "BLOCKED"],
];

function planS2Rows() {
	for (const [id, claim, mode] of S2_ROWS) {
		plan(id, claim, mode === "BLOCKED" ? "blocked" : "driven");
	}
}

let s2Seq = 1000;
const nextS2Seq = () => {
	s2Seq += 1;
	return s2Seq;
};

const isListTarget = (target) =>
	target.type === "page" &&
	target.url.endsWith("browser-address-overlay-list.html");

async function connectList(handle) {
	const target = await waitForTarget(handle.port, isListTarget, 20_000);
	const cdp = await connect(target.webSocketDebuggerUrl);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	return { cdp, target };
}

async function childEvaluate(cdp, expression) {
	const result = await cdp.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			`child exception: ${
				result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text
			}`,
		);
	}
	return result.result?.value;
}

async function s2Geometry(cdp) {
	return evaluate(
		cdp,
		`(() => {
			const field = document.querySelector('[data-tour-tag="browser-address"]');
			const dock = document.querySelector('[data-tour-tag="browser-address-suggestions"]');
			if (!field || !dock) return null;
			const f = field.getBoundingClientRect();
			const d = dock.getBoundingClientRect();
			const content = document.querySelector('[data-tour-tag="browser-content"]');
			const c = content ? content.getBoundingClientRect() : null;
			return {
				content: c ? { x: Math.round(c.left), y: Math.round(c.top), width: Math.round(c.width), height: Math.round(c.height) } : null,
				field: { x: Math.round(f.left), y: Math.round(f.top), width: Math.round(f.width), height: Math.round(f.height) },
				listTop: Math.round(d.top),
				dockOpen: dock.getAttribute('data-address-dock-open') === 'true',
				editing: field.getAttribute('data-address-editing'),
				value: field.value ?? null,
				candidates: Number(field.getAttribute('data-address-candidates') || '0'),
				activeDescendant: field.getAttribute('aria-activedescendant'),
				activeIndex: (() => {
					const id = field.getAttribute('aria-activedescendant');
					if (!id) return -1;
					const rows = [...document.querySelectorAll('[data-address-suggestion]')];
					return rows.findIndex((row) => row.id === id);
				})(),
				firstCandidateUrl: document.querySelector('[data-address-suggestion]')?.getAttribute('data-address-suggestion-url') ?? null,
				candidateUrls: [...document.querySelectorAll('[data-address-suggestion-url]')].map((row) => row.getAttribute('data-address-suggestion-url')),
			};
		})()`,
	);
}

async function projectDirect(cdp, payload) {
	const answer = await evaluate(
		cdp,
		`(async () => {
			try {
				return { ok: true, value: await window.__loDevDriver.addressOverlayProject(${JSON.stringify(payload)}) };
			} catch (error) {
				return { ok: false, error: String(error && error.message ? error.message : error) };
			}
		})()`,
	);
	appendEvent({
		event: "project",
		payload: { ...payload, view: payload.view?.kind },
		answer,
	});
	return answer;
}

async function waitForS2(cdp, predicate, timeoutMs = 8_000) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await probe(cdp, "facts");
		if (predicate(last)) return last;
		await sleep(120);
	}
	return last;
}

function s2Rows(n) {
	return Array.from({ length: n }, (_, index) => ({
		text: `example-${index + 1}.test/some/considerably/long/path/for/truncation`,
		title: `Example page ${index + 1}`,
	}));
}

function s2Projection(geometry, pageRect, tabId, view, overrides = {}) {
	return {
		v: 1,
		seq: nextS2Seq(),
		tabId,
		visible: true,
		pageRect,
		field: geometry.field,
		listTop: geometry.listTop,
		active: -1,
		view,
		label: "Suggestions",
		dir: "ltr",
		...overrides,
	};
}

async function captureChild(handle, label) {
	const { cdp } = await connectList(handle);
	try {
		const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
		const path = join(FRAMES, `${label}.png`);
		const buffer = Buffer.from(shot.data, "base64");
		writeFileSync(path, buffer);
		return { path, bytes: buffer.byteLength };
	} finally {
		cdp.close();
	}
}

/** P1 — run before any boot: the built S2 document and its bundle are real. */
function s2BuildRow() {
	const assets = (buildIdentity.listDocument.assets ?? []).map((asset) =>
		join(ROOT, "out/renderer", asset),
	);
	const present = assets.filter((asset) => existsSync(asset));
	record(
		"P1",
		buildIdentity.listDocument.present &&
			buildIdentity.listDocument.csp === S2_CSP &&
			assets.length === 2 &&
			present.length === 2
			? "PASS"
			: "FAIL",
		`document=${buildIdentity.listDocument.present} cspMatch=${buildIdentity.listDocument.csp === S2_CSP} assets=${JSON.stringify(buildIdentity.listDocument.assets)} present=${present.length}/${assets.length} htmlSha=${buildIdentity.artifacts.listDocument?.sha256?.slice(0, 12)}`,
	);
}

async function s2GateCases() {
	// G1: S2 off, S1 armed. The probe exists; the projection channel does not.
	{
		const handle = await boot({
			s1: true,
			s2: false,
			driver: true,
			tag: "s2-off",
		});
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
			const answer = await evaluate(
				cdp,
				`(async () => {
					try {
						await window.__loDevDriver.addressOverlayProject({});
						return { refused: false };
					} catch (error) {
						return { refused: true, error: String(error && error.message ? error.message : error) };
					}
				})()`,
			);
			record(
				"G1",
				shown.state === "shown" &&
					shown.s2.list === false &&
					answer.refused &&
					/No handler registered/.test(answer.error ?? "")
					? "PASS"
					: "FAIL",
				`state=${shown.state} s2.list=${shown.s2.list} projection=${JSON.stringify(answer)}`,
			);
			cdp.close();
		} finally {
			handle.stop("SIGTERM");
			await handle.exited;
		}
	}

	// G2a: S2 alone.
	{
		const handle = await boot({
			s1: false,
			s2: true,
			driver: true,
			tag: "s2-alone",
		});
		try {
			const { cdp } = await connectMain(handle);
			await waitForDriver(cdp);
			const bridge = await evaluate(cdp, "typeof window.__loDevDriver");
			await sleep(300);
			const log = readFileSync(join(OUT, "app.log"), "utf8");
			const line = log
				.split("\n")
				.filter((entry) =>
					/address-overlay\].*not armed: LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2/.test(
						entry,
					),
				)
				.pop();
			record(
				"G2a",
				bridge === "object" && Boolean(line) ? "PASS" : "FAIL",
				`bridge=${bridge} line=${line ?? "(none)"}`,
			);
			cdp.close();
		} finally {
			handle.stop("SIGTERM");
			await handle.exited;
		}
	}

	// G2b: S1+S2 without the armed driver.
	{
		const handle = await boot({
			s1: true,
			s2: true,
			driver: false,
			tag: "s2-no-driver",
		});
		try {
			const { cdp } = await connectMain(handle);
			const bridge = await evaluate(cdp, "typeof window.__loDevDriver");
			await sleep(300);
			const log = readFileSync(join(OUT, "app.log"), "utf8");
			const line = log
				.split("\n")
				.filter((entry) =>
					/address-overlay\].*not armed: the address overlay needs the armed renderer dev driver/.test(
						entry,
					),
				)
				.pop();
			record(
				"G2b",
				bridge === "undefined" && Boolean(line) ? "PASS" : "FAIL",
				`bridge=${bridge} line=${line ?? "(none)"}`,
			);
			cdp.close();
		} finally {
			handle.stop("SIGTERM");
			await handle.exited;
		}
	}

	// G2c: a non-opt-in S2 spelling.
	{
		const handle = await boot({
			s1: true,
			s2: false,
			s2Raw: "true",
			driver: true,
			tag: "s2-bad-value",
		});
		try {
			const { cdp } = await connectMain(handle);
			await waitForDriver(cdp);
			await sleep(300);
			const log = readFileSync(join(OUT, "app.log"), "utf8");
			const line = log
				.split("\n")
				.filter((entry) =>
					/address-overlay\].*not armed: LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2=true/.test(
						entry,
					),
				)
				.pop();
			record("G2c", line ? "PASS" : "FAIL", line ?? "(none)");
			cdp.close();
		} finally {
			handle.stop("SIGTERM");
			await handle.exited;
		}
	}
}

async function s2RealInputMatrix() {
	const handle = await boot({
		s1: true,
		s2: true,
		driver: true,
		tag: "s2-real",
	});
	let cdp = null;
	const factsLog = [];
	try {
		const main = await connectMain(handle);
		cdp = main.cdp;
		await waitForDriver(cdp);
		await navigate(cdp, "/browser");
		await waitForSurface(cdp);
		const pageServer = await startPageServer();
		pageServers.push(pageServer);
		await evaluate(cdp, "window.api.browser.newTab()");
		await waitForActiveTab(cdp);
		for (let index = 0; index < 3; index += 1) {
			await presentActivePage(cdp, pageServer);
			await sleep(120);
		}
		const initial = await probe(cdp, "facts");
		factsLog.push({ label: "initial", facts: initial });
		const geometryBefore = await s2Geometry(cdp);

		// P3: the unknown the brief named. Focus the REAL input the way a user does
		// — a mouse press inside it — and type. `el.focus()` alone was measured to
		// set activeElement while React's onFocus (and therefore the history
		// snapshot) did not run in this unfocused document; a real press does.
		const fieldBox = geometryBefore.field;
		const clickX = fieldBox.x + Math.round(fieldBox.width / 2);
		const clickY = fieldBox.y + Math.round(fieldBox.height / 2);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await cdp.send("Input.dispatchMouseEvent", {
				type,
				x: clickX,
				y: clickY,
				button: "left",
				clickCount: 1,
			});
		}
		await sleep(250);
		const focus = await evaluate(
			cdp,
			`(() => {
				const el = document.querySelector('[data-tour-tag="browser-address"]');
				if (!el) return { ok: false, why: 'no input' };
				return { ok: document.activeElement === el, active: document.activeElement?.tagName ?? null };
			})()`,
		);
		// The field keeps its live URL on focus; typing must REPLACE it, the way a
		// user types over the selected address. `Input.insertText` inserts at the
		// caret, so select the value first (the unfocused document would otherwise
		// leave the caret at the end and produce a string that prefix-matches nothing).
		await evaluate(
			cdp,
			`(() => {
				const el = document.querySelector('[data-tour-tag="browser-address"]');
				if (!el) return false;
				el.select();
				return el.selectionStart === 0 && el.selectionEnd === el.value.length;
			})()`,
		);
		await cdp.send("Input.insertText", { text: "127.0.0.1" });
		await sleep(1_200);
		const typed = await s2Geometry(cdp);
		const diagnostics = await evaluate(
			cdp,
			`(async () => {
				const notice = document.querySelector('[data-address-suggestions-notice]')?.textContent ?? null;
				try {
					const state = await window.api.browser.state();
					const answer = await window.api.browser.addressHistory({ requestId: 993, expectedTabId: state.activeTabId, scope: "all" });
					return { notice, entries: answer.entries.length, urls: answer.entries.map((entry) => entry.url), activeTabId: state.activeTabId };
				} catch (error) {
					return { notice, error: String(error && error.message ? error.message : error) };
				}
			})()`,
		);
		appendEvent({ event: "p3-diagnostics", diagnostics });
		const realInput =
			focus.ok &&
			typed !== null &&
			typed.editing === "true" &&
			typed.dockOpen === true &&
			typed.candidates > 0;
		record(
			"P3",
			realInput ? "PASS" : "BLOCKED",
			`focus=${JSON.stringify(focus)} afterType=${JSON.stringify(typed)} diagnostics=${JSON.stringify(diagnostics)}`,
		);

		if (!realInput) {
			for (const id of [
				"A1",
				"A2",
				"A3",
				"A4",
				"R1",
				"R3",
				"C1",
				"K1",
				"K2",
				"L1",
			]) {
				record(
					id,
					"BLOCKED",
					"real-input path not drivable in this headless window (P3); the synthetic-projection matrix is the measured substitute",
				);
			}
			return;
		}

		// The hook projects on its own. Wait for the child to be actually applied.
		const applied = await waitForS2(
			cdp,
			(facts) =>
				facts.s2?.view?.kind === "rows" &&
				facts.s2?.applyCount > 0 &&
				facts.child?.visible === true,
		);
		factsLog.push({ label: "applied", facts: applied });
		const geometryOpen = await s2Geometry(cdp);
		const expectedQuarter = Math.round(geometryOpen.field.x);
		const bounds = applied.child?.bounds ?? null;
		const anchorOk =
			bounds !== null &&
			Math.abs(bounds.x - geometryOpen.field.x) <= 1 &&
			Math.abs(bounds.width - geometryOpen.field.width) <= 1 &&
			Math.abs(bounds.y - geometryOpen.listTop) <= 1 &&
			bounds.y >= geometryOpen.field.y + geometryOpen.field.height;
		record(
			"A1",
			anchorOk ? "PASS" : "FAIL",
			`child=${JSON.stringify(bounds)} field=${JSON.stringify(geometryOpen.field)} listTop=${geometryOpen.listTop} expectedX=${expectedQuarter}`,
		);
		record(
			"A2",
			applied.page?.visible === true &&
				applied.page?.presented === true &&
				sameRect(applied.page.bounds, initial.page.bounds)
				? "PASS"
				: "FAIL",
			`before=${JSON.stringify(initial.page)} open=${JSON.stringify(applied.page)}`,
		);
		const childFacts = applied.child;
		record(
			"A3",
			childFacts !== null &&
				childFacts.visible === true &&
				childFacts.order === childFacts.childCount - 1
				? "PASS"
				: "FAIL",
			`child=${JSON.stringify(childFacts)}`,
		);

		// R1: the child's own measurements.
		const measured = await probe(cdp, "measure");
		const rowRects = measured.s2?.measured?.rowRects ?? [];
		const rowHeightsOk =
			rowRects.length === measured.s2.view.rowCount &&
			rowRects.every((row) => Math.abs(row.height - 35.5) <= 0.5);
		record(
			"R1",
			measured.s2.view.rowCount >= 1 &&
				measured.s2.view.rowCount <= 5 &&
				rowHeightsOk &&
				Math.abs((measured.s2.measured?.headerHeight ?? 0) - 28) <= 0.5
				? "PASS"
				: "FAIL",
			`rowCount=${measured.s2.view.rowCount} header=${measured.s2.measured?.headerHeight} rows=${JSON.stringify(rowRects)}`,
		);

		// R3: ArrowDown moves the parent's active row; the child must agree.
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "ArrowDown",
			code: "ArrowDown",
			windowsVirtualKeyCode: 40,
			nativeVirtualKeyCode: 40,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "ArrowDown",
			code: "ArrowDown",
			windowsVirtualKeyCode: 40,
			nativeVirtualKeyCode: 40,
		});
		await sleep(350);
		const afterArrow = await probe(cdp, "measure");
		const afterArrowGeometry = await s2Geometry(cdp);
		record(
			"R3",
			afterArrow.s2.view.active === 0 &&
				afterArrowGeometry.activeIndex === 0 &&
				afterArrow.s2.measured?.activeRowRect !== null
				? "PASS"
				: "FAIL",
			`active=${afterArrow.s2.view.active} ariaIndex=${afterArrowGeometry.activeIndex} activeRect=${JSON.stringify(afterArrow.s2.measured?.activeRowRect)}`,
		);

		// C1: the synthetic mouse path through the child, then the REAL navigate.
		const targetUrl = afterArrowGeometry.candidateUrls?.[0] ?? null;
		const beforeC1 = await probe(cdp, "facts");
		await probe(cdp, "click", { row: 0 });
		await sleep(900);
		const afterC1 = await probe(cdp, "facts");
		const state = await browserState(cdp);
		record(
			"C1",
			targetUrl !== null &&
				afterC1.s2.commitsEmitted === beforeC1.s2.commitsEmitted + 1 &&
				state?.url === targetUrl
				? "PASS"
				: "FAIL",
			`url=${JSON.stringify(targetUrl)} committed=${beforeC1.s2.commitsEmitted}->${afterC1.s2.commitsEmitted} activeUrl=${JSON.stringify(state?.url)}`,
		);

		// K2: a key sent through the CHILD's input pipeline is prevented and
		// counted. CDP-injected keys were measured NOT to reach before-input-event
		// (0/0), so the probe uses main's sendInputEvent through the gated channel.
		{
			const beforeKeys = (await probe(cdp, "facts")).s2.keysBlocked;
			const beforeUrl = (await browserState(cdp))?.url ?? null;
			const afterKeyFacts = await probe(cdp, "key", { keyCode: "A" });
			await sleep(250);
			const afterUrl = (await browserState(cdp))?.url ?? null;
			record(
				"K2",
				afterKeyFacts.s2.keysBlocked > beforeKeys && afterUrl === beforeUrl
					? "PASS"
					: "FAIL",
				`keysBlocked=${beforeKeys}->${afterKeyFacts.s2.keysBlocked} url=${JSON.stringify(beforeUrl)}->${JSON.stringify(afterUrl)}`,
			);
		}

		// K1: dismissal paths hide the mirror. Type again first: the commit in C1
		// cleared the draft and closed the list.
		await evaluate(
			cdp,
			"document.querySelector('[data-tour-tag=\"browser-address\"]').focus()",
		);
		await cdp.send("Input.insertText", { text: "127.0.0.1" });
		await sleep(350);
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "ArrowDown",
			code: "ArrowDown",
			windowsVirtualKeyCode: 40,
			nativeVirtualKeyCode: 40,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "ArrowDown",
			code: "ArrowDown",
			windowsVirtualKeyCode: 40,
			nativeVirtualKeyCode: 40,
		});
		await sleep(200);
		const reopened = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === true,
			3_000,
		);
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
		const hidden = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === false,
			3_000,
		);
		record(
			"K1",
			reopened.child?.visible === true && hidden.child?.visible === false
				? "PASS"
				: "FAIL",
			`reopened=${JSON.stringify(reopened.child)} afterEscape=${JSON.stringify(hidden.child)} hiddenReason=${hidden.hiddenReason}`,
		);

		// A4: resize while the list is open. Re-open, then shrink the window.
		await evaluate(
			cdp,
			"document.querySelector('[data-tour-tag=\"browser-address\"]').focus()",
		);
		await cdp.send("Input.insertText", { text: "127.0.0.1" });
		await sleep(400);
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "ArrowDown",
			code: "ArrowDown",
			windowsVirtualKeyCode: 40,
			nativeVirtualKeyCode: 40,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "ArrowDown",
			code: "ArrowDown",
			windowsVirtualKeyCode: 40,
			nativeVirtualKeyCode: 40,
		});
		const openAgain = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === true,
			3_000,
		);
		factsLog.push({ label: "before-resize", facts: openAgain });
		const version = await (
			await fetch(`http://127.0.0.1:${handle.port}/json/version`, {
				signal: AbortSignal.timeout(5_000),
			})
		).json();
		const browserCdp = await connect(version.webSocketDebuggerUrl);
		let resizedVia = "browser-cdp";
		try {
			await browserCdp.send("Browser.setWindowBounds", {
				windowId: openAgain.owner.windowId ?? 1,
				bounds: { width: 1180, height: 820 },
			});
		} catch (error) {
			resizedVia = `window.resizeTo (browser-cdp failed: ${String(error)})`;
			await evaluate(cdp, "window.resizeTo(1180, 820)");
		}
		browserCdp.close();
		await sleep(900);
		const geometryResized = await s2Geometry(cdp);
		const resizedFacts = await waitForS2(
			cdp,
			(facts) =>
				facts.child?.visible === true &&
				facts.child?.bounds !== null &&
				Math.abs(facts.child.bounds.width - geometryResized.field.width) <= 1,
			6_000,
		);
		factsLog.push({ label: "after-resize", facts: resizedFacts });
		const resizedOk =
			resizedFacts.child?.visible === true &&
			resizedFacts.child.bounds !== null &&
			Math.abs(resizedFacts.child.bounds.x - geometryResized.field.x) <= 1 &&
			Math.abs(resizedFacts.child.bounds.y - geometryResized.listTop) <= 1 &&
			geometryResized.content !== null &&
			sameRect(resizedFacts.page.bounds, geometryResized.content);
		record(
			"A4",
			resizedOk ? "PASS" : "FAIL",
			`via=${resizedVia} child=${JSON.stringify(resizedFacts.child)} field=${JSON.stringify(geometryResized?.field)} listTop=${geometryResized?.listTop} page=${JSON.stringify(resizedFacts.page?.bounds)} hides=${JSON.stringify(resizedFacts.s2.hideCounts)}`,
		);
		// Restore the window for the teardown row.
		const restore = await fetch(
			`http://127.0.0.1:${handle.port}/json/version`,
			{
				signal: AbortSignal.timeout(5_000),
			},
		).then((response) => response.json());
		const restoreCdp = await connect(restore.webSocketDebuggerUrl);
		try {
			await restoreCdp.send("Browser.setWindowBounds", {
				windowId: resizedFacts.owner.windowId ?? 1,
				bounds: { width: 1380, height: 900 },
			});
		} catch {
			await evaluate(cdp, "window.resizeTo(1380, 900)");
		}
		restoreCdp.close();

		// Close the renderer's own mirror before the probe takes over: its
		// projection is the newest, and a synthetic one must not race a per-frame
		// re-send from the hook.
		await projectDirect(cdp, {
			v: 1,
			seq: nextS2Seq(),
			tabId: applied.page.tabId,
			visible: false,
		});
		await sleep(200);

		// A6: a projection naming another tab is refused.
		const stale = await projectDirect(
			cdp,
			s2Projection(
				geometryResized,
				applied.page.bounds,
				(applied.page.tabId ?? 1) + 999,
				{ kind: "rows", rows: s2Rows(3) },
			),
		);
		record(
			"A6",
			stale.ok && stale.value?.reason === "stale_tab" ? "PASS" : "FAIL",
			JSON.stringify(stale),
		);

		// L1: reuse and a clean stop. Twenty apply/hide cycles on a hidden list.
		const cycleGeometry = await s2Geometry(cdp);
		const cyclePage = (await probe(cdp, "facts")).page;
		const beforeCycles = await probe(cdp, "facts");
		const childStarted = beforeCycles.child?.webContentsId ?? null;
		const listenersBefore = JSON.stringify(beforeCycles.listeners);
		for (let index = 0; index < 20; index += 1) {
			const shown = await projectDirect(
				cdp,
				s2Projection(cycleGeometry, cyclePage.bounds, cyclePage.tabId, {
					kind: "rows",
					rows: s2Rows(3),
				}),
			);
			if (!shown.ok || shown.value?.shown !== true) {
				record(
					"L1",
					"FAIL",
					`cycle ${index} did not show: ${JSON.stringify(shown)}`,
				);
				break;
			}
			await projectDirect(cdp, {
				v: 1,
				seq: nextS2Seq(),
				tabId: cyclePage.tabId,
				visible: false,
			});
		}
		const afterCycles = await probe(cdp, "facts");
		record(
			"L1",
			afterCycles.childCreatedCount === 1 &&
				afterCycles.child !== null &&
				afterCycles.child.webContentsId === childStarted &&
				JSON.stringify(afterCycles.listeners) === listenersBefore
				? "PASS"
				: "FAIL",
			`childCreatedCount=${afterCycles.childCreatedCount} childId=${childStarted}->${afterCycles.child?.webContentsId} listeners=${JSON.stringify(afterCycles.listeners)} hides=${JSON.stringify(afterCycles.s2.hideCounts)}`,
		);
	} catch (error) {
		for (const row of rows) {
			if (
				[
					"P3",
					"A1",
					"A2",
					"A3",
					"A4",
					"R1",
					"R3",
					"C1",
					"K1",
					"K2",
					"L1",
				].includes(row.id) &&
				row.at === null
			) {
				record(
					row.id,
					"BLOCKED",
					`real-input matrix aborted: ${String(error)}`,
				);
			}
		}
	} finally {
		if (cdp) cdp.close();
		const pid = handle.child.pid;
		handle.stop("SIGTERM");
		const result = await Promise.race([handle.exited, sleep(8_000)]);
		await sleep(500);
		const survivors = descendants(pid).filter(alive);
		writeFileSync(
			join(OUT, "teardown.json"),
			`${JSON.stringify({ result, survivors }, null, 2)}\n`,
		);
		reapTree(pid);
		appendEvent({ event: "teardown", result, survivors });
		record(
			"L1-teardown",
			result?.code === 0 && survivors.length === 0 ? "PASS" : "FAIL",
			`exit=${JSON.stringify(result)} survivors=${JSON.stringify(survivors)}`,
		);
	}
}

async function s2SyntheticMatrix() {
	const handle = await boot({
		s1: true,
		s2: true,
		driver: true,
		tag: "s2-synthetic",
	});
	let cdp = null;
	try {
		const main = await connectMain(handle);
		cdp = main.cdp;
		await waitForDriver(cdp);
		await navigate(cdp, "/browser");
		await waitForSurface(cdp);
		const pageServer = await startPageServer();
		pageServers.push(pageServer);
		await evaluate(cdp, "window.api.browser.newTab()");
		await waitForActiveTab(cdp);
		await presentActivePage(cdp, pageServer);
		const facts = await probe(cdp, "facts");
		const geometry = await s2Geometry(cdp);
		const pageRect = facts.page.bounds;
		const tabId = facts.page.tabId;

		const project = (view, overrides = {}) =>
			projectDirect(
				cdp,
				s2Projection(geometry, pageRect, tabId, view, overrides),
			);

		// R1: 1, 3 and 5 rows.
		const counts = [];
		for (const n of [1, 3, 5]) {
			const answer = await project({ kind: "rows", rows: s2Rows(n) });
			const measured = await probe(cdp, "measure");
			counts.push({
				n,
				shown: answer.value?.shown === true,
				rowCount: measured.s2.measured?.rowCount,
				header: measured.s2.measured?.headerHeight,
				heights: measured.s2.measured?.rowRects?.map((row) => row.height),
				bounds: answer.value?.bounds ?? null,
				viewport: measured.s2.measured?.viewportHeight,
				scroll: measured.s2.measured?.scrollHeight,
				inner: measured.s2.measured?.innerHeight,
			});
		}
		const r1Ok = counts.every(
			(count) =>
				count.shown &&
				count.rowCount === count.n &&
				Math.abs((count.header ?? 0) - 28) <= 0.5 &&
				(count.heights ?? []).every((height) => Math.abs(height - 35.5) <= 0.5),
		);
		record("R1", r1Ok ? "PASS" : "FAIL", JSON.stringify(counts));

		// R2: each notice kind at the dock's 104.
		const notices = [];
		for (const kind of ["error", "hint", "empty", "no_match"]) {
			const answer = await project({
				kind: "notice",
				notice: kind,
				text: `notice-${kind}`,
			});
			const measured = await probe(cdp, "measure");
			notices.push({
				kind,
				shown: answer.value?.shown === true,
				height: answer.value?.bounds?.height,
				rowCount: measured.s2.measured?.rowCount,
			});
		}
		record(
			"R2",
			notices.every(
				(entry) => entry.shown && entry.height === 104 && entry.rowCount === 0,
			)
				? "PASS"
				: "FAIL",
			`${JSON.stringify(notices)}; loading-with-no-rows is hidden by the renderer's listVisible rule (projection visible:false is the same path: ${JSON.stringify((await projectDirect(cdp, { v: 1, seq: nextS2Seq(), tabId, visible: false })).value)})`,
		);

		// R3: one active row, matching index.
		const activeProjection = await project(
			{ kind: "rows", rows: s2Rows(3) },
			{ active: 1 },
		);
		const activeMeasured = await probe(cdp, "measure");
		const activeRect = activeMeasured.s2.measured?.activeRowRect;
		const geometryOpen = await s2Geometry(cdp);
		record(
			"R3",
			activeProjection.value?.shown === true &&
				activeMeasured.s2.view.active === 1 &&
				activeRect !== null &&
				Math.abs(activeRect.top - (2 + 35.5)) <= 1 &&
				geometryOpen.activeIndex === -1
				? "PASS"
				: "FAIL",
			`active=${activeMeasured.s2.view.active} rect=${JSON.stringify(activeRect)} (parent aria index is -1 here: no real input; the dock path covers that)`,
		);

		// R4: hostile text.
		const hostile = `<img src=x onerror="window.__pwned=1">\u202E\u202A\u0000${"A".repeat(
			10_000,
		)}`;
		await project({
			kind: "rows",
			rows: [{ text: hostile, title: "<script>window.__pwned2=1</script>" }],
		});
		const { cdp: child } = await connectList(handle);
		let hostileFacts;
		try {
			hostileFacts = await childEvaluate(
				child,
				`(() => {
					const row = document.querySelector('.lo-row-text');
					const title = document.querySelector('.lo-row-title');
					return {
						textLength: row ? row.textContent.length : -1,
						titleLength: title ? title.textContent.length : -1,
						imgs: document.querySelectorAll('img').length,
						scripts: document.querySelectorAll('script').length,
						pwned: window.__pwned ?? null,
						pwned2: window.__pwned2 ?? null,
						text: row ? row.textContent.slice(0, 40) : null,
					};
				})()`,
			);
		} finally {
			child.close();
		}
		record(
			"R4",
			// One <script> is the document's own module entry; an injected second
			// one would make this > 1.
			hostileFacts.imgs === 0 &&
				hostileFacts.scripts <= 1 &&
				hostileFacts.pwned === null &&
				hostileFacts.pwned2 === null &&
				hostileFacts.textLength === 512 &&
				hostileFacts.titleLength <= 256 &&
				hostileFacts.text?.startsWith("<img src=x")
				? "PASS"
				: "FAIL",
			JSON.stringify(hostileFacts),
		);

		// R5 + V1: ru and ur frames, plus the standard states.
		const shots = [];
		await project({ kind: "rows", rows: s2Rows(3) });
		shots.push({
			label: "child-rows3",
			...(await captureChild(handle, "child-rows3")),
		});
		await project({ kind: "rows", rows: s2Rows(5) }, { active: 4 });
		shots.push({
			label: "child-rows5-active",
			...(await captureChild(handle, "child-rows5-active")),
		});
		await project({
			kind: "notice",
			notice: "empty",
			text: "Nothing here yet.",
		});
		shots.push({
			label: "child-notice",
			...(await captureChild(handle, "child-notice")),
		});
		await project({
			kind: "rows",
			rows: [{ text: hostile.slice(0, 200), title: "hostile" }],
		});
		shots.push({
			label: "child-hostile",
			...(await captureChild(handle, "child-hostile")),
		});
		await project(
			{ kind: "notice", notice: "empty", text: "Здесь пока ничего нет." },
			{ label: "Подсказки", dir: "ltr" },
		);
		shots.push({
			label: "child-ru",
			...(await captureChild(handle, "child-ru")),
		});
		const ruFacts = await probe(cdp, "measure");
		await project(
			{ kind: "notice", notice: "hint", text: "یہاں ابھی کچھ نہیں ہے۔" },
			{ label: "تجاویز", dir: "rtl" },
		);
		const urFacts = await probe(cdp, "measure");
		shots.push({
			label: "child-ur",
			...(await captureChild(handle, "child-ur")),
		});
		record(
			"R5",
			ruFacts.s2.measured?.rowCount === 0 &&
				urFacts.s2.measured?.rowCount === 0 &&
				shots.every((shot) => shot.bytes > 1_000)
				? "PASS"
				: "FAIL",
			`shots=${JSON.stringify(shots)}`,
		);
		record(
			"V1",
			shots.length === 6 && shots.every((shot) => shot.bytes > 1_000)
				? "PASS"
				: "FAIL",
			`child-only CDP captures, viewed: ${shots.map((shot) => `${shot.label}=${shot.bytes}B`).join(" ")}`,
		);

		// R6: an alpha theme is rejected.
		const alpha = await project(
			{ kind: "rows", rows: s2Rows(2) },
			{
				theme: {
					elevated: "rgba(20,24,30,0.5)",
					ink: "#ffffff",
					inkMuted: "#ffffff",
					accent: "#ffffff",
					accentWash: "#ffffff",
					rowHover: "#ffffff",
					hairline: "#ffffff",
					control: "#ffffff",
				},
			},
		);
		const alphaFacts = await probe(cdp, "facts");
		record(
			"R6",
			alpha.value?.shown === true && alphaFacts.s2.theme === "fallback"
				? "PASS"
				: "FAIL",
			`project=${JSON.stringify(alpha.value)} themeFact=${alphaFacts.s2.theme} theme=${JSON.stringify(alphaFacts.s2.view)}`,
		);

		// C2: down row 0, up row 1.
		await project({ kind: "rows", rows: s2Rows(3) }, { active: 0 });
		const beforeC2 = await probe(cdp, "facts");
		await probe(cdp, "click", { row: 0, upRow: 1 });
		const afterC2 = await probe(cdp, "facts");
		record(
			"C2",
			afterC2.s2.commitsEmitted === beforeC2.s2.commitsEmitted &&
				(afterC2.s2.commitsDropped.mouse_mismatch ?? 0) >= 1
				? "PASS"
				: "FAIL",
			`commits=${beforeC2.s2.commitsEmitted}->${afterC2.s2.commitsEmitted} dropped=${JSON.stringify(afterC2.s2.commitsDropped)}`,
		);

		// C3: a stale seq is refused without hiding the newer model.
		const staleAnswer = await projectDirect(cdp, {
			...s2Projection(geometry, pageRect, tabId, {
				kind: "rows",
				rows: s2Rows(2),
			}),
			seq: 5,
		});
		record(
			"C3",
			staleAnswer.ok && staleAnswer.value?.reason === "stale_seq"
				? "PASS"
				: "FAIL",
			`${JSON.stringify(staleAnswer)}; an index beyond rowCount names no row by construction (rowAt bounds-checks the row array)`,
		);

		// X1: the child's capability surface.
		const { cdp: xchild } = await connectList(handle);
		let xFacts;
		let navRefused;
		try {
			xFacts = await childEvaluate(
				xchild,
				`(() => ({
					electron: typeof window.electron,
					process: typeof window.process,
					require: typeof window.require,
					ipc: typeof window.ipcRenderer,
					api: typeof window.api,
					rootAriaHidden: document.getElementById('address-list-root')?.getAttribute('aria-hidden'),
					roles: document.querySelectorAll('[role]').length,
					focusables: document.querySelectorAll('[tabindex],input,button,a[href]').length,
				}))()`,
			);
			const beforeUrl =
				(await targets(handle.port)).find(isListTarget)?.url ?? "";
			await childEvaluate(
				xchild,
				`location.href = "https://example.com/"`,
			).catch(() => {});
			await sleep(600);
			await childEvaluate(
				xchild,
				`(() => {
					const script = document.createElement('script');
					script.textContent = 'window.__pwned3 = 1';
					document.body.append(script);
					return window.__pwned3 ?? null;
				})()`,
			);
			await sleep(200);
			const afterUrl =
				(await targets(handle.port)).find(isListTarget)?.url ?? "";
			const pwned3 = await childEvaluate(xchild, "window.__pwned3 ?? null");
			navRefused = { beforeUrl, afterUrl, pwned3 };
		} finally {
			xchild.close();
		}
		record(
			"X1",
			xFacts.electron === "undefined" &&
				xFacts.process === "undefined" &&
				xFacts.require === "undefined" &&
				xFacts.ipc === "undefined" &&
				xFacts.api === "undefined" &&
				xFacts.rootAriaHidden === "true" &&
				xFacts.roles === 0 &&
				xFacts.focusables === 0 &&
				navRefused.beforeUrl === navRefused.afterUrl &&
				navRefused.pwned3 === null
				? "PASS"
				: "FAIL",
			`${JSON.stringify(xFacts)} nav=${JSON.stringify(navRefused)}`,
		);
	} catch (error) {
		for (const row of rows) {
			if (
				["R1", "R2", "R3", "R4", "R5", "R6", "C2", "C3", "V1", "X1"].includes(
					row.id,
				) &&
				row.at === null
			) {
				record(row.id, "BLOCKED", `synthetic matrix aborted: ${String(error)}`);
			}
		}
	} finally {
		if (cdp) cdp.close();
		const pid = handle.child.pid;
		handle.stop("SIGTERM");
		const result = await Promise.race([handle.exited, sleep(8_000)]);
		appendEvent({
			event: "synthetic-teardown",
			result,
			survivors: descendants(pid).filter(alive),
		});
		reapTree(pid);
	}
}

function closeS2Rows() {
	record(
		"A5",
		"asserted-only",
		"resolveAddressOverlayGate/projectOnce read getZoomFactor and hide at |z-1|>1e-3; the headless probe has no zoom verb, so no built-app observation",
	);
	record(
		"A7",
		"asserted-only",
		"unit tests drive sanitizeProjection/addressListBoundsFor with NaN, negative, oversize, extra-key, inconsistent-gap inputs",
	);
	record(
		"C4",
		"asserted-only",
		"renderer hook drops a commit whose seq or candidate key no longer matches; covered by source contract, not driven here",
	);
	record(
		"V2",
		"BLOCKED",
		"owner capture returns no child pixels; screen capture permission is denied (S1 spike)",
	);
	record(
		"V3",
		"BLOCKED",
		"sendInputEvent exercises the child, not macOS NSView hit-testing",
	);
	record("V4", "BLOCKED", "no visible window, no IME, no AX tree in S2");
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
	if (S2) {
		// The S1 rows were planned at module load; an S2 run reports only S2 rows.
		rows.length = 0;
		planS2Rows();
		s2BuildRow();
		await s2GateCases();
		await s2RealInputMatrix();
		await s2SyntheticMatrix();
	} else {
		await gateOffCase();
		await s1WithoutDriverCase();
		await drivenMatrix();
		await windowCloseCase();
	}
} catch (error) {
	console.error(`[probe] matrix failed: ${String(error?.stack ?? error)}`);
	appendEvent({ event: "failure", error: String(error?.stack ?? error) });
	for (const row of rows) {
		if (row.at === null)
			record(row.id, "FAIL", `matrix aborted: ${String(error)}`);
	}
} finally {
	if (S2) closeS2Rows();
	else closeAssertedRows();
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
	// facts.json is the run's own probe receipts, in order. Derived from the
	// append-only events file so nothing here can be edited after the fact.
	const facts = readFileSync(eventsFile, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((entry) => entry.event === "probe")
		.map((entry) => ({
			at: entry.at,
			action: entry.action,
			facts: entry.value,
		}));
	writeFileSync(join(OUT, "facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
	appendEvent({ event: "finish", counts });
	console.log(`[probe] ${JSON.stringify(counts)}`);
	console.log(`[probe] matrix: ${join(OUT, "matrix.md")}`);
	const failures = rows.filter((row) => row.status === "FAIL");
	process.exit(failures.length > 0 ? 1 : 0);
}
