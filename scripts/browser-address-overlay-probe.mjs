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
 *
 * SUPERSEDED IN PART BY S4b (2026-10-21). The S2 `measure` action still reads
 * `data-address-dock-open`; S4b deleted the dock (there is no bar and no dock at
 * rest), so that field is permanently false here. Keep the reads that describe
 * the v1 child document; do not read this probe's chrome geometry as the shipped
 * one. The S4b rig is `browser-chrome-s4b-probe.mjs`.
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
import { loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
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
/** S3's handoff matrix: runs the S2 rows as the regression surface and adds the
 * focus/IME/AX rows. Headless only: the visible arm is `--s3-visible`. */
const S3 = process.argv.includes("--s3");
/** S3's operator-attended visible run. One process, one window, ≤120 s. */
const S3_VISIBLE = process.argv.includes("--s3-visible");
if (S3_VISIBLE && !process.argv.includes("--window-mode=inactive")) {
	fail(
		"--s3-visible must be invoked with --window-mode=inactive on ITS OWN command line, exactly as the design doc spells it: node scripts/browser-address-overlay-probe.mjs --s3-visible --window-mode=inactive --out <dir>. A probe launched without the mode it is about to reason over is a typo, not a run.",
	);
}
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
	// A second record for one id silently replaced the first receipt and let two
	// different claims share a row (QA round 1, Q-2). Ids are now unique per row;
	// a duplicate is a probe bug, not last-wins.
	if (row.at !== null) {
		throw new Error(`row ${id} was already recorded at ${row.at}`);
	}
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
	// QA round 1's Q-3: `gitHead` alone named the parent commit when the evidence
	// was built from a working tree. Record the DIRTY state and a hash of the
	// uncommitted diff so the metadata says exactly what produced these bytes.
	gitDirty:
		spawnSync("git", ["status", "--porcelain"], {
			cwd: ROOT,
			encoding: "utf8",
		}).stdout.trim() !== "",
	worktreeDiffSha256: createHash("sha256")
		.update(
			spawnSync("git", ["diff", "HEAD"], { cwd: ROOT, encoding: "utf8" })
				.stdout ?? "",
		)
		.digest("hex"),
	// Q-4: a shared host's load is part of a run's identity; a child readiness
	// timeout under load is BLOCKED evidence, not a matrix pass.
	hostLoad: loadavg()[0],
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

async function boot({
	s1,
	s2,
	s2Raw,
	driver,
	tag,
	visible,
	mode = "headless",
}) {
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
		LOCAL_OPERATOR_UI_WINDOW_MODE: mode,
		LOCAL_OPERATOR_UI_DEV_DRIVER: driver ? "1" : undefined,
		LOCAL_OPERATOR_UI_DEV_DRIVER_OUT: driver ? FRAMES : undefined,
		LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1: s1 ? "1" : undefined,
		LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2:
			s2Raw ?? (s2 ? "1" : undefined),
		LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_VISIBLE: visible
			? "1"
			: undefined,
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
			`--window-mode=${mode}`,
			"--window-size=1380x900",
			// The headless window is occluded; Chromium throttles the child's frame
			// loop and a WebContentsView resize can sit unapplied indefinitely (native
			// bounds 211, renderer viewport still 140). A VISIBLE window applies it on
			// the next frame. These switches keep the rig's frame behaviour closer to
			// the visible product path without making anything visible.
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			"--disable-background-timer-throttling",
			MOCK_KEYCHAIN_SWITCH,
		],
		{ env, cwd, stdio: ["ignore", "pipe", "pipe"] },
	);
	const logPath = join(OUT, "app.log");
	appendFileSync(
		logPath,
		`\n===== boot ${bootTag} (${tag}) s1=${s1 ? 1 : 0} s2=${s2 ? 1 : 0} driver=${driver ? 1 : 0} visible=${visible ? 1 : 0} mode=${mode} pid=${child.pid} =====\n`,
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
		const baseline = await evaluate(
			cdp,
			`(() => {
				const el = document.querySelector('[data-tour-tag="browser-address"]');
				return {
					hasFocus: document.hasFocus(),
					active: document.activeElement === el,
					selection: el ? [el.selectionStart, el.selectionEnd] : null,
					blur: window.__s3?.blur ?? -1,
				};
			})()`,
		);
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
		"G1b",
		"S2 off: typing in the real address field invokes the missing projection channel at most once (latch stops the loop)",
	],
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
		"R1-real",
		"under real input the child's own measurement reports a 28 header and 35.5 rows",
	],
	[
		"R1",
		"1/3/5 rows render with 35.5 row height and 28 header; rowCount equals the model",
	],
	["R2", "each notice kind renders at 104 DIP; loading-with-no-rows is hidden"],
	[
		"R3",
		"exactly one active row; its rect equals the parent's aria-activedescendant index (real input)",
	],
	[
		"R3-synthetic",
		"synthetic projection: exactly one active row and its rect at the documented offset (no parent ARIA)",
	],
	["R4", "hostile text is literal and capped; no img/script executes"],
	[
		"R5",
		"ru and ur header/notice (and ur rows, RTL) render with the catalogues' own strings (child pixels)",
	],
	[
		"R5b",
		"real-copy notice at a narrow field width stays inside the 104-DIP block (no clipping)",
	],
	["R6", "alpha theme is rejected and the opaque fallback is used"],
	[
		"C1",
		"synthetic mouse down/up on row 0 commits through the renderer's real navigate",
	],
	["C2", "down row i / up row j commits nothing"],
	["C3", "stale seq is refused without hiding the newer model"],
	[
		"C3b",
		"a probe click naming a row outside the applied model is refused and commits nothing",
	],
	["C4", "candidate set change between project and click is dropped (unit)"],
	[
		"K1",
		"ArrowDown/Enter/Escape/Tab drive the parent exactly as today and the mirror hides on each dismissal",
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

// The child shows only strings the renderer already localizes. Reading the
// catalogues here (rather than writing fixture copy) is what makes the frames
// real-copy evidence (design review D4).
const CATALOGUES = Object.fromEntries(
	["en", "ru", "ur"].map((locale) => [
		locale,
		JSON.parse(
			readFileSync(
				join(ROOT, "src/i18n/catalogues", locale, "ui.browser.json"),
				"utf8",
			),
		),
	]),
);
const copy = (locale, key) =>
	CATALOGUES[locale][`ui.browser.browser_url_bar.${key}`];

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
		label: copy("en", "address_suggestions_label"),
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
			// Three navigations, like P3: one page leaves no history to open the
			// list with, and the G1b claim is about a list that IS open.
			for (let index = 0; index < 3; index += 1) {
				await presentActivePage(cdp, pageServer);
				await sleep(120);
			}
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
			// G1b: the S2-off retry storm (QA Q-1). Type in the real field with the
			// list open for 3 s and count how many times the unregistered channel was
			// invoked. The latch must stop the loop after the first answer.
			// Baseline AFTER G1's own direct invoke has been logged: Electron's handler
			// error is written asynchronously, and reading a byte offset straight after
			// the await counted G1's line as a hook invoke (QA round 1's "2").
			const countUnregistered = () =>
				(
					readFileSync(join(OUT, "app.log"), "utf8").match(
						/No handler registered for 'dev-driver-address-overlay-project'/g,
					) ?? []
				).length;
			await sleep(500);
			const logBefore = countUnregistered();
			const geometry = await s2Geometry(cdp);
			const clickX = geometry.field.x + Math.round(geometry.field.width / 2);
			const clickY = geometry.field.y + Math.round(geometry.field.height / 2);
			for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
				await cdp.send("Input.dispatchMouseEvent", {
					type,
					x: clickX,
					y: clickY,
					button: "left",
					clickCount: 1,
				});
			}
			await sleep(200);
			const focused = await evaluate(
				cdp,
				`(() => {
					const el = document.querySelector('[data-tour-tag="browser-address"]');
					if (!el) return { ok: false };
					el.focus();
					el.select();
					return { ok: document.activeElement === el, active: document.activeElement?.tagName ?? null };
				})()`,
			);
			await cdp.send("Input.insertText", { text: "127.0.0.1" });
			await sleep(500);
			const afterType = await s2Geometry(cdp);
			await sleep(2_500);
			const invokes = countUnregistered() - logBefore;
			const typed = await s2Geometry(cdp);
			const targets = await cdp.send("Target.getTargets");
			const pages = (targets.targetInfos ?? [])
				.filter((target) => target.type === "page")
				.map((target) => target.url);
			record(
				"G1b",
				invokes <= 1 && afterType?.dockOpen === true && focused?.ok === true
					? "PASS"
					: invokes <= 1
						? "BLOCKED"
						: "FAIL",
				`focused=${JSON.stringify(focused)} afterType=${JSON.stringify(afterType)} end=${JSON.stringify(typed)} pages=${JSON.stringify(pages)} unregisteredProjectionErrors=${invokes} over 3s (pre-fix QA measured 386)`,
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
					const answer = await window.api.browser.addressHistory({ requestId: 993, expectedTabId: state.activeTabId, query: "", limit: 8 });
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

		// R1-real: the child's own measurements under real input. The 1/3/5
		// geometry sweep is the separate synthetic R1 row.
		const measured = await probe(cdp, "measure");
		const rowRects = measured.s2?.measured?.rowRects ?? [];
		const rowHeightsOk =
			rowRects.length === measured.s2.view.rowCount &&
			rowRects.every((row) => Math.abs(row.height - 35.5) <= 0.5);
		record(
			"R1-real",
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
		// Enter: re-open, select the first alternative, commit it; the page must
		// navigate and the mirror must hide. This is the in-flow commit path, now
		// driven WITH the child open (m3's narrowed K1).
		const press = async (key, keyCode) => {
			await cdp.send("Input.dispatchKeyEvent", {
				type: "keyDown",
				key,
				code: key,
				windowsVirtualKeyCode: keyCode,
				nativeVirtualKeyCode: keyCode,
			});
			await cdp.send("Input.dispatchKeyEvent", {
				type: "keyUp",
				key,
				code: key,
				windowsVirtualKeyCode: keyCode,
				nativeVirtualKeyCode: keyCode,
			});
		};
		await evaluate(
			cdp,
			`(() => {
				const el = document.querySelector('[data-tour-tag="browser-address"]');
				if (!el) return null;
				el.focus();
				el.select();
				return true;
			})()`,
		);
		await cdp.send("Input.insertText", { text: "127.0.0.1" });
		await sleep(400);
		await press("ArrowDown", 40);
		await sleep(250);
		const enterGeometry = await s2Geometry(cdp);
		const enterTarget = enterGeometry?.candidateUrls?.[0] ?? null;
		const enterOpened = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === true,
			3_000,
		);
		await press("Enter", 13);
		let enterUrl = null;
		const enterDeadline = Date.now() + 6_000;
		while (Date.now() < enterDeadline) {
			enterUrl = (await browserState(cdp))?.url ?? null;
			if (enterTarget !== null && enterUrl === enterTarget) break;
			await sleep(150);
		}
		const enterHidden = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === false,
			3_000,
		);

		// Tab: re-open, select a row, press Tab; focus moves and the mirror hides
		// without navigating (the input's own Tab semantics, unchanged).
		await evaluate(
			cdp,
			`(() => {
				const el = document.querySelector('[data-tour-tag="browser-address"]');
				if (!el) return null;
				el.focus();
				el.select();
				return true;
			})()`,
		);
		await cdp.send("Input.insertText", { text: "127.0.0.1" });
		await sleep(400);
		await press("ArrowDown", 40);
		await sleep(250);
		const tabOpened = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === true,
			3_000,
		);
		const beforeTabUrl = (await browserState(cdp))?.url ?? null;
		await press("Tab", 9);
		const tabHidden = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === false,
			3_000,
		);
		const afterTabUrl = (await browserState(cdp))?.url ?? null;
		record(
			"K1",
			reopened.child?.visible === true &&
				hidden.child?.visible === false &&
				enterOpened.child?.visible === true &&
				enterTarget !== null &&
				enterUrl === enterTarget &&
				enterHidden.child?.visible === false &&
				tabOpened.child?.visible === true &&
				tabHidden.child?.visible === false &&
				afterTabUrl === beforeTabUrl
				? "PASS"
				: "FAIL",
			`arrowReopened=${reopened.child?.visible} escapeHidden=${hidden.child?.visible} enterTarget=${JSON.stringify(enterTarget)} enterUrl=${JSON.stringify(enterUrl)} enterHidden=${enterHidden.child?.visible} tabOpened=${tabOpened.child?.visible} tabHidden=${tabHidden.child?.visible} tabUrl=${JSON.stringify(beforeTabUrl)}->${JSON.stringify(afterTabUrl)}`,
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
					"R1-real",
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
				visual: measured.s2.measured?.visualHeight,
				native: measured.child?.bounds ?? null,
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
		for (const kind of ["error", "empty", "no_match"]) {
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
			"R3-synthetic",
			activeProjection.value?.shown === true &&
				activeMeasured.s2.view.active === 1 &&
				activeRect !== null &&
				Math.abs(activeRect.top - (2 + 35.5)) <= 1 &&
				geometryOpen.activeIndex === -1
				? "PASS"
				: "FAIL",
			`active=${activeMeasured.s2.view.active} rect=${JSON.stringify(activeRect)} parentActiveIndex=${geometryOpen.activeIndex} (synthetic projection: the real-input R3 row is the ARIA agreement)`,
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

		// R5 + V1: the catalogues' own strings, RTL rows, and both notice shapes.
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
			text: copy("en", "address_suggestions_empty"),
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
			{
				kind: "notice",
				notice: "empty",
				text: copy("ru", "address_suggestions_empty"),
			},
			{ label: copy("ru", "address_suggestions_label"), dir: "ltr" },
		);
		shots.push({
			label: "child-ru",
			...(await captureChild(handle, "child-ru")),
		});
		const ruFacts = await probe(cdp, "measure");
		await project(
			{
				kind: "notice",
				notice: "no_match",
				text: copy("ur", "address_suggestions_no_match"),
			},
			{ label: copy("ur", "address_suggestions_label"), dir: "rtl" },
		);
		const urFacts = await probe(cdp, "measure");
		shots.push({
			label: "child-ur",
			...(await captureChild(handle, "child-ur")),
		});
		// D3: RTL ROWS with an active row — the fixture-only ur notice left the
		// bar side, row order and truncation side unseen.
		await project(
			{ kind: "rows", rows: s2Rows(3) },
			{ active: 1, label: copy("ur", "address_suggestions_label"), dir: "rtl" },
		);
		const urRowsFacts = await probe(cdp, "measure");
		shots.push({
			label: "child-ur-rows",
			...(await captureChild(handle, "child-ur-rows")),
		});
		// D4: real copy in the widest real state that can wrap, at the narrow field
		// width the design named (480 DIP). The 104-DIP block must contain it.
		await project(
			{
				kind: "notice",
				// `unavailable` is the renderer's ERROR notice kind; the copy is the
				// catalogue's unavailable string.
				notice: "error",
				text: copy("en", "address_suggestions_unavailable"),
			},
			{
				active: -1,
				field: { ...geometry.field, width: 480 },
				label: copy("en", "address_suggestions_label"),
			},
		);
		shots.push({
			label: "child-notice-narrow",
			...(await captureChild(handle, "child-notice-narrow")),
		});
		const narrowFacts = await probe(cdp, "measure");
		const { cdp: noticeChild } = await connectList(handle);
		let narrowBox;
		try {
			narrowBox = await childEvaluate(
				noticeChild,
				`(() => {
					const notice = document.getElementById('address-list-notice');
					const viewport = document.getElementById('address-list-viewport');
					const root = document.getElementById('address-list-root');
					if (!notice || !viewport || !root) return null;
					const n = notice.getBoundingClientRect();
					const v = viewport.getBoundingClientRect();
					const r = root.getBoundingClientRect();
					return {
						rootHeight: r.height,
						noticeBottom: n.bottom - r.top,
						viewportBottom: v.bottom - r.top,
						text: notice.textContent,
					};
				})()`,
			);
		} finally {
			noticeChild.close();
		}
		record(
			"R5",
			ruFacts.s2.measured?.rowCount === 0 &&
				urFacts.s2.measured?.rowCount === 0 &&
				urRowsFacts.s2.measured?.rowCount === 3 &&
				urRowsFacts.s2.measured?.activeRowRect !== null &&
				shots.every((shot) => shot.bytes > 1_000)
				? "PASS"
				: "FAIL",
			`shots=${JSON.stringify(shots)} urRowsActive=${JSON.stringify(urRowsFacts.s2.measured?.activeRowRect)}`,
		);
		record(
			"R5b",
			narrowFacts.s2.measured?.rowCount === 0 &&
				narrowBox !== null &&
				narrowBox.rootHeight === 104 &&
				narrowBox.noticeBottom <= narrowBox.viewportBottom + 1
				? "PASS"
				: "FAIL",
			`narrow=${JSON.stringify(narrowBox)}`,
		);
		record(
			"V1",
			shots.length === 8 && shots.every((shot) => shot.bytes > 1_000)
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
			`${JSON.stringify(staleAnswer)}; the newer shown model is not hidden`,
		);
		// C3b: an out-of-range index is refused by the probe's own validation, and
		// no commit is emitted. This replaces the old "by construction" clause.
		const beforeC3b = await probe(cdp, "facts");
		let outOfRangeError = null;
		try {
			await probe(cdp, "click", { row: 99 });
		} catch (error) {
			outOfRangeError = String(error?.message ?? error);
		}
		const afterC3b = await probe(cdp, "facts");
		record(
			"C3b",
			outOfRangeError !== null &&
				/rendered row index/.test(outOfRangeError) &&
				afterC3b.s2.commitsEmitted === beforeC3b.s2.commitsEmitted
				? "PASS"
				: "FAIL",
			`error=${JSON.stringify(outOfRangeError)} commits=${beforeC3b.s2.commitsEmitted}->${afterC3b.s2.commitsEmitted}`,
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
				[
					"R1",
					"R2",
					"R3-synthetic",
					"R4",
					"R5",
					"R5b",
					"R6",
					"C2",
					"C3",
					"C3b",
					"V1",
					"X1",
				].includes(row.id) &&
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

function closeS2Rows(s3 = false) {
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
	record(
		"V4",
		"BLOCKED",
		s3
			? "S2's own matrix ran no visible window; S3's I1/AX1 measured the CDP halves in this same run, and AX2 keeps VoiceOver unmeasured"
			: "no visible window, no IME, no AX tree in S2",
	);
}

// ---- S3: input/focus/IME/AX handoff ---------------------------------------

/*
 * WHAT THIS SECTION CAN AND CANNOT PROVE.
 *
 * The headless rows measure the DOM/native-focus contract through CDP: focus
 * emulation makes `document.hasFocus()` true in a window the OS never activated,
 * and `Input.*` events are synthetic. Every row says so in its own evidence text,
 * because the failure mode this section is built to avoid is a synthetic
 * measurement read as a native one. The visible run (`--s3-visible`) is the only
 * place an operator's eyes, clicks and real IME can appear, and its rows are
 * BLOCKED in every unattended run — not passes.
 *
 * Chromium's accessibility tree is not VoiceOver: AX1 proves the parent exposes a
 * combobox/listbox/option structure and that the child's own tree is inert, not
 * that a screen reader lands anywhere useful. AX2 keeps that gap visible.
 */

const S3_RULE = "-".repeat(78);
const S3_VISIBLE_ENV = "LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_VISIBLE";
const S3_S1_ENV = "LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1";
const S3_S2_ENV = "LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S2";
const S3_DRIVER_ENV = "LOCAL_OPERATOR_UI_DEV_DRIVER";
const VISIBLE_CAP_MS = 120_000;

const S3_ROWS = [
	[
		"G4a",
		"S3 visible env in a headless-labelled boot: printed 'not armed' naming headless; no window is shown",
	],
	[
		"G4b",
		"S3 visible env in a normal-labelled boot: printed 'not armed' naming normal (operator-attended run only)",
	],
	[
		"G4c",
		"S3 visible env in a packaged launch: refused by the pure gate (unit table, not a packaged boot)",
	],
	[
		"F1",
		"focus owner stays the parent through 20 hide/raise cycles; child focusEvents=0, childIsFocused=false (focus EMULATED)",
	],
	[
		"F2",
		"synthetic child mouse/keys move neither the parent's focus nor its selection (SYNTHETIC input)",
	],
	[
		"I1",
		"IME composition events reach the parent in order; the mirror is hidden while composing and returns after (CDP IME, NOT macOS IME)",
	],
	[
		"I2",
		"real macOS IME candidate window and marked text in the address field (operator-attended visible run)",
	],
	[
		"K3",
		"keys: the S2 K1/K2 receipts re-run on this same head (derived from those rows, not re-measured here)",
	],
	[
		"M1",
		"child mouse down/up commits once on the same row and drops a mismatch (derived from the S2 C1/C2 rows re-run here)",
	],
	[
		"AX1",
		"parent AX tree exposes a combobox + listbox with one option per mirror row; the child target's tree is all ignored (Chromium AX, NOT VoiceOver)",
	],
	[
		"AX2",
		"VoiceOver/NVDA and the child's native AXWebArea in the app's accessibility hierarchy",
	],
	[
		"V-ORDER",
		"child pixels sit above page pixels in the native composite (operator's eyes)",
	],
	[
		"V-HIT",
		"a click on a child row lands in the child and a click just below the list lands in the page (operator)",
	],
	[
		"V-FOCUS-SHOW",
		"showing the child in an inactive window does not make the app frontmost (lsappinfo front before/after)",
	],
	[
		"V-FOCUS-CLICK",
		"a real mouse-down on the child does not blur the parent input or drop the click (operator; the (b)-viability row)",
	],
	[
		"V-FIRSTMOUSE",
		"in the unfocused inactive window, click #1 vs #2 are recorded separately (acceptFirstMouse is not set)",
	],
	[
		"V-WHEEL",
		"a wheel over the child is swallowed and the page beneath does not scroll (operator)",
	],
	[
		"V-COMPOSITE-CAP",
		"owner-target CDP capture as a negative control: it must not contain the child, so composite pixels stay operator-only",
	],
	[
		"T1-visible",
		"the visible run exits 0 by SIGTERM before the cap, reaps its whole tree and leaves no window or survivor",
	],
	[
		"W1",
		"Windows/Linux focus, IME and hit routing (unmeasured on this machine)",
	],
];

function planS3Rows() {
	for (const [id, claim] of S3_ROWS) plan(id, claim);
}

/**
 * A page built to be TOLD APART from the child: a loud striped band, a marker
 * per band, and its own click/down/wheel counters. The child sits exactly over
 * the in-flow dock, so a plain page and a plain dock are pixel-identical at a
 * glance; the sentinel makes "I am looking at the page" and "I am looking at the
 * child" different pictures, and makes a click that leaked to the page countable.
 */
async function startSentinelPageServer() {
	const server = createHttpServer((request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(`<!doctype html><html><head><title>S3 sentinel page</title></head>
<body style="margin:0;background:#101418;color:#f5f7fa;font:16px/1.4 -apple-system,system-ui,sans-serif">
<script>
window.__s3page = { downs: 0, clicks: 0, wheels: 0, scrollTop: 0 };
for (const type of ['mousedown', 'click', 'wheel']) {
  window.addEventListener(type, () => { window.__s3page[type === 'mousedown' ? 'downs' : type === 'click' ? 'clicks' : 'wheels'] += 1; }, true);
}
window.addEventListener('scroll', () => { window.__s3page.scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0; }, true);
</script>
<div style="position:sticky;top:0;z-index:2;background:#ff2d55;color:#fff;padding:14px 20px;font-weight:700;letter-spacing:0.02em">
  S3 SENTINEL PAGE — if you can read this straight through, the overlay is NOT over this strip
</div>
${Array.from(
	{ length: 14 },
	(_, index) =>
		`<div style="height:64px;display:flex;align-items:center;padding:0 20px;background:${index % 2 === 0 ? "#ffd60a" : "#0a84ff"};color:#101418;font-weight:600">SENTINEL BAND ${index + 1}</div>`,
).join("\n")}
<div style="height:1400px;background:linear-gradient(#101418,#2b3440)"></div>
</body></html>`);
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}/`,
		close: () => new Promise((done) => server.close(done)),
	};
}

/** The sentinel page's own counters, read from the page target (not the app's). */
async function connectActivePage(handle, timeoutMs = 15_000) {
	if (!activePageUrl) throw new Error("no active page was presented");
	const prefix = activePageUrl;
	const target = await waitForTarget(
		handle.port,
		(entry) => entry.type === "page" && entry.url.startsWith(prefix),
		timeoutMs,
	);
	const cdp = await connect(target.webSocketDebuggerUrl);
	await cdp.send("Runtime.enable");
	return cdp;
}

async function pageCounters(pageCdp) {
	return evaluate(pageCdp, "window.__s3page");
}

/** One real press + a synchronous focus/selection snapshot installed first. */
async function s3FocusField(cdp) {
	const geometry = await s2Geometry(cdp);
	if (!geometry) throw new Error("the address field is not on screen");
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: geometry.field.x + Math.round(geometry.field.width / 2),
			y: geometry.field.y + Math.round(geometry.field.height / 2),
			button: "left",
			clickCount: 1,
		});
	}
	await sleep(200);
	const installed = await evaluate(
		cdp,
		`(() => {
			const el = document.querySelector('[data-tour-tag="browser-address"]');
			if (!el) return { ok: false };
			window.__s3 = window.__s3 ?? { blur: 0, ime: [], selection: null };
			window.__s3.blur = 0;
			window.__s3.ime = [];
			el.addEventListener('blur', () => { window.__s3.blur += 1; });
			for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input']) {
				el.addEventListener(type, (event) => { window.__s3.ime.push(type + (event.data ? ':' + event.data : '')); });
			}
			el.select();
			window.__s3.selection = [el.selectionStart, el.selectionEnd];
			return { ok: true, hasFocus: document.hasFocus(), active: document.activeElement === el, selection: window.__s3.selection };
		})()`,
	);
	return { geometry, installed };
}

/** A projection function that takes the live geometry, like the real hook. */
async function projectS3(cdp, opened, rowCount, overrides = {}) {
	const geometry = await s2Geometry(cdp);
	const payload = s2Projection(
		geometry,
		opened.page.bounds,
		opened.page.tabId,
		{ kind: "rows", rows: s2Rows(rowCount) },
		overrides,
	);
	return projectDirect(cdp, payload);
}

/**
 * G4a: the visible opt-in on a headless-labelled boot must print its refusal and
 * never create a window. Driven, not asserted: this is the one refusal that can
 * be spawned without putting anything on the operator's screen, and it is the
 * one a rig is most likely to get wrong.
 */
async function s3HeadlessVisibleRefusal() {
	const handle = await boot({
		s1: true,
		s2: true,
		driver: true,
		visible: true,
		tag: "s3-visible-headless-refusal",
	});
	let armed = false;
	let refusal = null;
	const deadline = Date.now() + 25_000;
	while (Date.now() < deadline) {
		const log = existsSync(handle.logPath)
			? readFileSync(handle.logPath, "utf8")
			: "";
		const armedLine = log.match(/\[address-overlay\] ARMED[^\n]*/);
		const refusedLine = log.match(/\[address-overlay\] not armed: ([^\n]*)/);
		if (armedLine) {
			armed = true;
			refusal = armedLine[0];
			break;
		}
		if (refusedLine) {
			refusal = refusedLine[1];
			break;
		}
		await sleep(200);
	}
	record(
		"G4a",
		!armed && typeof refusal === "string" && /headless/.test(refusal)
			? "PASS"
			: "FAIL",
		`armed=${armed} refusal=${JSON.stringify(refusal)} log=${handle.logPath}`,
	);
	await handle.stop("SIGTERM");
	const exit = await Promise.race([
		handle.exited,
		sleep(15_000).then(() => null),
	]);
	if (exit === null) reapTree(handle.child.pid);
}

/**
 * The S2 rows are this section's regression surface: they ran first in the same
 * process, on the same built app. K3/M1 are DERIVED from those receipts rather
 * than re-measured, so one run cannot report two different answers for the same
 * click and still call both measurements.
 */
function deriveS3Rows() {
	const byId = (id) => rows.find((row) => row.id === id);
	const c1 = byId("C1");
	const c2 = byId("C2");
	const k1 = byId("K1");
	const k2 = byId("K2");
	record(
		"K3",
		k1?.status === "PASS" && k2?.status === "PASS" ? "PASS" : "FAIL",
		`derived from the S2 rows in this run: K1=${k1?.status ?? "missing"} K2=${k2?.status ?? "missing"}`,
	);
	record(
		"M1",
		c1?.status === "PASS" && c2?.status === "PASS" ? "PASS" : "FAIL",
		`derived from the S2 rows in this run: C1=${c1?.status ?? "missing"} C2=${c2?.status ?? "missing"}`,
	);
}

/** The headless half: F1, F2, I1, AX1 against the real built app. */
async function s3HeadlessMatrix() {
	const handle = await boot({
		s1: true,
		s2: true,
		driver: true,
		tag: "s3-headless",
	});
	const factsLog = [];
	try {
		const main = await connectMain(handle);
		const cdp = main.cdp;
		await waitForDriver(cdp);
		await navigate(cdp, "/browser");
		await waitForSurface(cdp);
		const pageServer = await startSentinelPageServer();
		pageServers.push(pageServer);
		await evaluate(cdp, "window.api.browser.newTab()");
		await waitForActiveTab(cdp);
		for (let index = 0; index < 3; index += 1) {
			await presentActivePage(cdp, pageServer);
			await sleep(120);
		}

		// The label is the evidence: without this switch the window is never active
		// and `document.hasFocus()` is false for a reason that has nothing to do
		// with the child.
		await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
		const focusSetup = await s3FocusField(cdp);
		await cdp.send("Input.insertText", { text: "127.0.0.1" });
		const opened = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === true,
			8_000,
		);
		if (!opened.child?.visible) {
			for (const id of ["F1", "F2", "I1", "AX1"]) {
				record(
					id,
					"BLOCKED",
					`the real input path did not open the mirror in this boot (P3-class failure): ${JSON.stringify(opened?.s2?.view ?? null)}`,
				);
			}
			return;
		}
		factsLog.push({ label: "opened", facts: opened });

		// Recaptured by F1 itself: the runs before it (IME, AX) move the caret and
		// the blur counter, so a snapshot taken at open time would not be the
		// baseline of the cycle it is compared with.
		let baseline = null;

		/*
		 * I1: CDP IME. `imeSetComposition` is Chromium's own composition pipeline,
		 * which is as close as a headless window can get to a real IME and is still
		 * NOT the macOS input method (I2 stays operator-only). The mirror must hide
		 * while composing (`listVisible` requires `!composing`) and come back once
		 * the composition ends and a matching query is typed.
		 */
		await evaluate(
			cdp,
			"(() => { const el = document.querySelector('[data-tour-tag=\"browser-address\"]'); el.focus(); el.select(); window.__s3.ime = []; return true; })()",
		);
		const composing = [];
		for (const text of ["に", "にほ", "日本"]) {
			await cdp.send("Input.imeSetComposition", {
				text,
				selectionStart: text.length,
				selectionEnd: text.length,
			});
			await sleep(150);
			composing.push(await probe(cdp, "facts"));
		}
		const hiddenDuringComposition = composing.every(
			(facts) => facts.child?.visible === false,
		);
		await cdp.send("Input.insertText", { text: "日本" });
		await sleep(400);
		// End the CDP IME session explicitly: without this the field ignores every
		// later `Input.insertText` in this document (measured: insertText was a
		// no-op for the rest of the boot), which would make "the list returns"
		// untestable for a reason that has nothing to do with the overlay.
		await cdp.send("Input.imeSetComposition", {
			text: "",
			selectionStart: 0,
			selectionEnd: 0,
		});
		await sleep(200);
		const imeEvents = await evaluate(cdp, "window.__s3.ime");
		const imeOk =
			Array.isArray(imeEvents) &&
			String(imeEvents[0]).startsWith("compositionstart") &&
			String(imeEvents[imeEvents.length - 1]).startsWith("compositionend") &&
			String(imeEvents[imeEvents.length - 1]).includes("日本") &&
			imeEvents.filter((entry) => entry.startsWith("compositionupdate"))
				.length >= 2 &&
			["に", "にほ"].every((expected) =>
				imeEvents.some((entry) => entry.endsWith(`:${expected}`)),
			);
		// A matching query after composition must bring the mirror back. Chromium
		// reverts a CDP composition's text on compositionend, so the query is typed
		// again; one retry covers the frame where the field is still settling.
		let reopened = null;
		let reopenValue = null;
		let reopenGeometry = null;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			// A REAL press, not `el.focus()`: measured in this same matrix (P3), a
			// programmatic focus sets activeElement without running React's onFocus,
			// and after a composition Chromium's session can swallow inserts aimed at
			// a merely-focused field.
			await s3FocusField(cdp);
			await cdp.send("Input.insertText", { text: "127.0.0.1" });
			await sleep(500);
			reopenValue = await evaluate(
				cdp,
				"document.querySelector('[data-tour-tag=\"browser-address\"]').value",
			);
			reopened = await waitForS2(
				cdp,
				(facts) => facts.child?.visible === true,
				2_500,
			);
			reopenGeometry = await s2Geometry(cdp);
			if (reopened.child?.visible === true) break;
		}
		record(
			"I1",
			hiddenDuringComposition && imeOk && reopened.child?.visible === true
				? "PASS"
				: "FAIL",
			`CDP IME, not macOS IME. events=${JSON.stringify(imeEvents)} hiddenWhileComposing=${hiddenDuringComposition} reopened=${reopened?.child?.visible} reopenValue=${JSON.stringify(reopenValue)} geometry=${JSON.stringify(reopenGeometry)} view=${JSON.stringify(reopened?.s2?.view ?? null)}`,
		);

		/*
		 * AX1: the parent's accessibility tree is the entity a screen reader reads;
		 * the child's document is `aria-hidden`, so its own tree must be inert. Option
		 * count is compared with the mirror's row count, not with the DOM's: the whole
		 * S2 claim is that the mirror equals the parent's list.
		 */
		// One real ArrowDown first: `aria-activedescendant` is only present while a
		// row is active, and an absent attribute would fail a claim that is really
		// about the row being there.
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
		const axGeometry = await s2Geometry(cdp);
		await cdp.send("Accessibility.enable");
		const parentAx = await cdp.send("Accessibility.getFullAXTree");
		const axFacts = await probe(cdp, "facts");
		const parentNodes = parentAx.nodes ?? [];
		const combobox = parentNodes.find(
			(node) => node.role?.value === "combobox",
		);
		const listbox = parentNodes.find((node) => node.role?.value === "listbox");
		const options = parentNodes.filter((node) => node.role?.value === "option");
		/*
		 * CDP sends an AXProperty's value as `{type, value}`; an idref may also
		 * arrive as related nodes. Read both shapes rather than assuming one: the
		 * first version read only `.value.value`, which is why `activedescendant`
		 * read false while the DOM carried `aria-activedescendant` (U4). The row
		 * does not depend on the property, but the evidence now says what CDP sent.
		 */
		const property = (node, name) => {
			const entry = node?.properties?.find((item) => item.name === name);
			if (!entry) return undefined;
			const value = entry.value?.value;
			if (value !== undefined) return value;
			const related = entry.value?.relatedNodes;
			return Array.isArray(related)
				? related.map((node) => node.id)
				: undefined;
		};
		const comboboxProperties = (combobox?.properties ?? []).map((entry) => ({
			name: entry.name,
			value: entry.value?.value ?? entry.value?.relatedNodes ?? null,
		}));
		let childAx = null;
		let childAxError = null;
		try {
			const { cdp: childCdp } = await connectList(handle);
			try {
				await childCdp.send("Accessibility.enable");
				childAx = await childCdp.send("Accessibility.getFullAXTree");
			} finally {
				childCdp.close();
			}
		} catch (error) {
			childAxError = String(error?.message ?? error);
		}
		const childNodes = childAx?.nodes ?? [];
		const childNonRoot = childNodes.filter(
			(node) => node.role?.value !== "RootWebArea",
		);
		const childInert =
			childAx !== null &&
			childNodes.length > 0 &&
			childNonRoot.every((node) => node.ignored === true);
		record(
			"AX1",
			combobox !== undefined &&
				listbox !== undefined &&
				property(combobox, "expanded") === true &&
				property(combobox, "controls") !== undefined &&
				options.length === axFacts.s2.view.rowCount &&
				childInert
				? "PASS"
				: "FAIL",
			`Chromium AX, not VoiceOver. combobox=${Boolean(combobox)} expanded=${JSON.stringify(property(combobox, "expanded"))} controls=${Boolean(property(combobox, "controls"))} activeDescendant=${Boolean(property(combobox, "activedescendant"))} options=${options.length} mirrorRows=${axFacts.s2.view.rowCount} mirrorActive=${axFacts.s2.view.active} axActiveDescendant=${Boolean(property(combobox, "activedescendant"))} domActiveDescendant=${JSON.stringify(axGeometry?.activeDescendant ?? null)} comboboxProperties=${JSON.stringify(comboboxProperties)} childNodes=${childNodes.length} childInert=${childInert} childError=${JSON.stringify(childAxError)}`,
		);

		/*
		 * F1: 20 hide/raise cycles. `probe hide` dismisses through the controller's
		 * own path; each raise is a fresh projection (the same path the renderer's
		 * hook uses) so the child is re-added last every time. The assertions are the
		 * four ways focus could leak: the DOM's idea of it, the app's focused
		 * webContents, the child's own focus events, and the child's isFocused.
		 */
		const cycleProblems = [];
		baseline = await evaluate(
			cdp,
			`(() => {
				const el = document.querySelector('[data-tour-tag="browser-address"]');
				return {
					hasFocus: document.hasFocus(),
					active: document.activeElement === el,
					selection: el ? [el.selectionStart, el.selectionEnd] : null,
					blur: window.__s3?.blur ?? -1,
				};
			})()`,
		);
		for (let cycle = 0; cycle < 20; cycle += 1) {
			await probe(cdp, "hide");
			const raised = await projectS3(cdp, opened, 3, { active: -1 });
			if (raised?.value?.shown !== true) {
				cycleProblems.push(`cycle ${cycle}: ${JSON.stringify(raised)}`);
				break;
			}
			const facts = await probe(cdp, "facts");
			if (facts.ownerFocusedContentsId === facts.child.webContentsId) {
				cycleProblems.push(`cycle ${cycle}: focused contents is the child`);
			}
			if (facts.child.focusEvents !== 0 || facts.child.isFocused !== false) {
				cycleProblems.push(
					`cycle ${cycle}: child focusEvents=${facts.child.focusEvents} isFocused=${facts.child.isFocused}`,
				);
			}
			if (facts.child.order !== facts.child.childCount - 1) {
				cycleProblems.push(
					`cycle ${cycle}: child order ${facts.child.order}/${facts.child.childCount}`,
				);
			}
		}
		const afterCycles = await probe(cdp, "facts");
		const afterCyclesDom = await evaluate(
			cdp,
			`(() => {
				const el = document.querySelector('[data-tour-tag="browser-address"]');
				return {
					hasFocus: document.hasFocus(),
					active: document.activeElement === el,
					selection: el ? [el.selectionStart, el.selectionEnd] : null,
					blur: window.__s3?.blur ?? -1,
				};
			})()`,
		);
		factsLog.push({ label: "after-20-cycles", facts: afterCycles });
		record(
			"F1",
			cycleProblems.length === 0 &&
				afterCyclesDom.hasFocus === true &&
				afterCyclesDom.active === true &&
				afterCyclesDom.blur === 0 &&
				afterCycles.child.focusEvents === 0 &&
				afterCycles.child.isFocused === false &&
				afterCycles.ownerFocusedContentsId !==
					afterCycles.child.webContentsId &&
				JSON.stringify(afterCyclesDom.selection) ===
					JSON.stringify(baseline.selection)
				? "PASS"
				: "FAIL",
			`EMULATED FOCUS. cycles=${20 - cycleProblems.length}/20 problems=${JSON.stringify(cycleProblems)} baseline=${JSON.stringify(baseline)} after=${JSON.stringify(afterCyclesDom)} child=${JSON.stringify(afterCycles.child)} focusedContents=${afterCycles.ownerFocusedContentsId} ownerWindowFocused=${afterCycles.ownerWindowFocused}`,
		);

		/*
		 * F2: the synthetic child path, exercised last because a row click commits
		 * and navigates. A key goes through the child's own input pipeline
		 * (`sendInputEvent`), then a down/up pair on a row; the parent's blur counter
		 * and selection must be untouched by both, and the child's key count must
		 * move (otherwise the input never arrived and "no blur" proves nothing).
		 */
		// A KNOWN applied model: the renderer's own projection is whatever the last
		// real query produced, and the click rows must not be guessed from it.
		await projectS3(cdp, opened, 3, { active: -1 });
		await sleep(250);
		// `probeClick` resolves the row against the child's own last measurement;
		// without this call it refuses ("no applied list to click") even though the
		// list is on screen.
		await probe(cdp, "measure");
		const beforeF2 = await probe(cdp, "facts");
		const keysAfter = await probe(cdp, "key", { keyCode: "A" });
		await sleep(200);
		await probe(cdp, "click", { row: 1 });
		await sleep(400);
		const afterF2 = await probe(cdp, "facts");
		const afterF2Dom = await evaluate(
			cdp,
			`(() => {
				const el = document.querySelector('[data-tour-tag="browser-address"]');
				return { hasFocus: document.hasFocus(), active: document.activeElement === el, blur: window.__s3?.blur ?? -1 };
			})()`,
		);
		record(
			"F2",
			keysAfter.s2.keysBlocked > beforeF2.s2.keysBlocked &&
				afterF2.child.focusEvents === 0 &&
				afterF2.child.isFocused === false &&
				afterF2Dom.hasFocus === true &&
				afterF2Dom.active === true &&
				afterF2Dom.blur === 0 &&
				afterF2.s2.commitsEmitted === beforeF2.s2.commitsEmitted + 1
				? "PASS"
				: "FAIL",
			`SYNTHETIC input. keysBlocked=${beforeF2.s2.keysBlocked}->${keysAfter.s2.keysBlocked} commits=${beforeF2.s2.commitsEmitted}->${afterF2.s2.commitsEmitted} dropped=${JSON.stringify(afterF2.s2.commitsDropped)} childFocusEvents=${afterF2.child.focusEvents} childIsFocused=${afterF2.child.isFocused} dom=${JSON.stringify(afterF2Dom)}`,
		);
	} finally {
		writeFileSync(
			join(OUT, "facts-s3-headless.json"),
			`${JSON.stringify(factsLog, null, 2)}\n`,
		);
		await handle.stop("SIGTERM");
		await Promise.race([handle.exited, sleep(15_000)]);
		if (handle.child.exitCode === null) reapTree(handle.child.pid);
	}
}

// ---- S3: the operator-attended visible run --------------------------------

function lsappinfoFront() {
	const result = spawnSync("lsappinfo", ["front"], { encoding: "utf8" });
	if (result.error || result.status !== 0) {
		return {
			available: false,
			value: null,
			error: String(result.error ?? result.status),
		};
	}
	return { available: true, value: result.stdout.trim(), error: null };
}

function askOperator(rl, question, seconds) {
	return new Promise((done) => {
		let settled = false;
		/*
		 * A REMOVABLE line listener, not `rl.question`: `question` leaves its
		 * callback queued on the interface, so an answer that arrives after the
		 * timeout would be delivered to the NEXT question — one operator typo
		 * silently answering the wrong row. The listener is removed on either end.
		 */
		const onLine = (answer) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			rl.off("line", onLine);
			done(answer);
		};
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			rl.off("line", onLine);
			done(null);
		}, seconds * 1000);
		console.log(
			`\n${S3_RULE}\n${question}\n(answering window: ${seconds}s — no answer is recorded BLOCKED, never guessed)\nType an answer and press Return.\n${S3_RULE}`,
		);
		rl.setPrompt("> ");
		rl.prompt();
		rl.on("line", onLine);
	});
}

const S3_VISIBLE_PROMPTS = [
	[
		"V-ORDER",
		"Find the Local Operator UI window on your screen: 1380x900, titled like the app, INACTIVE (its title bar is grey and it did not take focus). A local page with loud striped bands is loaded in it, and an overlay list — header plus 5 rows in accent colours — should sit ON TOP of those bands. Do you see the list above the page (not painted under it)? Answer 'yes' only if the list is above the page.",
	],
	[
		"V-FOCUS-CLICK",
		"Click row 2 of the overlay list once. (This is also the first-click row: the window is inactive, so click #1 may only activate it. If nothing happened, click once more and say 'second'.)",
	],
	[
		"V-HIT",
		"Now click the sentinel page strip just BELOW the list (the bright yellow/blue band immediately under it).",
	],
	[
		"V-WHEEL",
		"Move the pointer over the overlay list and scroll the wheel two or three notches. Does the sentinel page underneath stay still?",
	],
	[
		"I2",
		"Click the address field at the top and type 日本 with your real macOS IME (do not commit with Enter). Do you see a candidate window, and does the field show marked text?",
	],
];

/**
 * The operator's own opt-in, checked BEFORE any boot. A typo here must not open
 * the app's normal window on the way to finding out: the first version ran this
 * after the refusal boots, so a missing variable still flashed a product window.
 */
function checkVisibleOptIn() {
	const required = [
		[S3_S1_ENV, "1"],
		[S3_S2_ENV, "1"],
		[S3_VISIBLE_ENV, "1"],
		[S3_DRIVER_ENV, "1"],
	];
	const missing = required
		.filter(([key, value]) => process.env[key] !== value)
		.map(([key]) => `${key}=1`);
	if (missing.length > 0) {
		throw new Error(
			`--s3-visible needs its own environment opt-in (${missing.join(", ")}); export them on the command line, exactly as docs/agent-driver.md spells it.`,
		);
	}
	if (!process.stdin.isTTY) {
		throw new Error(
			"--s3-visible is operator-attended: it needs a TTY for its prompts. No unattended run may start a visible window on this rule.",
		);
	}
}

async function s3VisiblePreflight(handle) {
	const log = existsSync(handle.logPath)
		? readFileSync(handle.logPath, "utf8")
		: "";
	if (!/\[address-overlay\] ARMED \(S3 VISIBLE probe/.test(log)) {
		throw new Error(
			`the visible arm did not print its ARMED line; the app log tail is ${JSON.stringify(log.slice(-600))}`,
		);
	}
}

async function s3VisibleRun() {
	checkVisibleOptIn();
	console.log(
		"[probe] S3 VISIBLE: one operator-attended run. It will (1) prove two refusals, (2) open ONE inactive window for at most 120 s, (3) ask five questions, (4) reap by exact pid. Nothing is captured with screencapture or desktopCapturer.",
	);
	// (1a) headless + VISIBLE must refuse and must not show anything.
	{
		const refusalBoot = await boot({
			s1: true,
			s2: true,
			driver: true,
			visible: true,
			tag: "s3-visible-headless-refusal",
		});
		let refusal = null;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			const log = existsSync(refusalBoot.logPath)
				? readFileSync(refusalBoot.logPath, "utf8")
				: "";
			const match = log.match(/\[address-overlay\] not armed: ([^\n]*)/);
			if (match) {
				refusal = match[1];
				break;
			}
			await sleep(150);
		}
		record(
			"G4a",
			typeof refusal === "string" && /headless/.test(refusal) ? "PASS" : "FAIL",
			`headless-labelled refusal=${JSON.stringify(refusal)} (no window: headless never shows one)`,
		);
		await refusalBoot.stop("SIGTERM");
		await Promise.race([refusalBoot.exited, sleep(12_000)]);
		if (refusalBoot.child.exitCode === null) reapTree(refusalBoot.child.pid);
	}
	// (1b) normal + VISIBLE must refuse. This one DOES open the product's own
	// window for a few seconds — the operator is attending and has been told.
	{
		console.log(
			"[probe] next: a NORMAL-labelled boot proves the refusal. It opens the app's own window ONCE, focused, and closes it on its own within about 10 seconds (no input, no overlay, nothing to do). It is the only visible window before the probe; the probe window itself never takes focus. Ctrl-C now aborts.",
		);
		const refusalBoot = await boot({
			s1: true,
			s2: true,
			driver: true,
			visible: true,
			mode: "normal",
			tag: "s3-visible-normal-refusal",
		});
		let refusal = null;
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			const log = existsSync(refusalBoot.logPath)
				? readFileSync(refusalBoot.logPath, "utf8")
				: "";
			const match = log.match(/\[address-overlay\] not armed: ([^\n]*)/);
			if (match) {
				refusal = match[1];
				break;
			}
			await sleep(150);
		}
		record(
			"G4b",
			typeof refusal === "string" && /normal/.test(refusal) ? "PASS" : "FAIL",
			`normal-labelled refusal=${JSON.stringify(refusal)}; the mode's own window was opened by the boot and reaped`,
		);
		await refusalBoot.stop("SIGTERM");
		await Promise.race([refusalBoot.exited, sleep(12_000)]);
		if (refusalBoot.child.exitCode === null) reapTree(refusalBoot.child.pid);
	}

	const before = lsappinfoFront();
	const launchedAt = Date.now();
	const handle = await boot({
		s1: true,
		s2: true,
		driver: true,
		visible: true,
		mode: "inactive",
		tag: "s3-visible",
	});
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});
	let teardown = null;
	const factsLog = [];
	try {
		await s3VisiblePreflight(handle);
		const { cdp } = await connectMain(handle);
		await waitForDriver(cdp);
		await navigate(cdp, "/browser");
		await waitForSurface(cdp);
		const pageServer = await startSentinelPageServer();
		pageServers.push(pageServer);
		await evaluate(cdp, "window.api.browser.newTab()");
		await waitForActiveTab(cdp);
		for (let index = 0; index < 3; index += 1) {
			await presentActivePage(cdp, pageServer);
			await sleep(150);
		}
		const pageCdp = await connectActivePage(handle);
		const focusSetup = await s3FocusField(cdp);
		await cdp.send("Input.insertText", { text: "127.0.0.1" });
		const opened = await waitForS2(
			cdp,
			(facts) => facts.child?.visible === true,
			8_000,
		);
		if (!opened.child?.visible) {
			throw new Error(
				`the real input path never opened the mirror, so there is nothing to look at: ${JSON.stringify(opened?.s2?.view ?? null)}`,
			);
		}
		/*
		 * The sentinel projection: five rows, a loud accent theme and a label an
		 * operator can read back. It is the S2 hook's own payload shape posted through
		 * the same dev-driver channel — no new IPC, no new product path.
		 */
		await projectS3(cdp, opened, 5, {
			label: "S3 CHILD — visible probe",
			theme: {
				elevated: "#1b1f24",
				ink: "#ffffff",
				inkMuted: "#c7d0dc",
				accent: "#ff2d55",
				accentWash: "#3a1020",
				rowHover: "#2b3440",
				hairline: "#3a4552",
				control: "#0a84ff",
			},
		});
		await sleep(400);
		const shownFacts = await probe(cdp, "facts");
		const after = lsappinfoFront();
		factsLog.push({ label: "visible-shown", facts: shownFacts });
		const focusShowOk =
			before.available &&
			after.available &&
			before.value === after.value &&
			shownFacts.ownerWindowFocused === false;
		record(
			"V-FOCUS-SHOW",
			focusShowOk ? "PASS" : "FAIL",
			`lsappinfo front before=${JSON.stringify(before.value)} after=${JSON.stringify(after.value)} appFocused=${shownFacts.ownerWindowFocused} visibleMode=${shownFacts.visibleMode}`,
		);

		// V-COMPOSITE-CAP: the negative control. An owner-target capture must not
		// contain the child; if it does, the composite becomes machine-measurable
		// and the design note says so.
		const shownShot = await cdp.send("Page.captureScreenshot", {
			format: "png",
		});
		await probe(cdp, "hide");
		await sleep(350);
		const hiddenShot = await cdp.send("Page.captureScreenshot", {
			format: "png",
		});
		const shownBytes = Buffer.from(shownShot.data, "base64");
		const hiddenBytes = Buffer.from(hiddenShot.data, "base64");
		writeFileSync(join(FRAMES, "s3-owner-shown.png"), shownBytes);
		writeFileSync(join(FRAMES, "s3-owner-hidden.png"), hiddenBytes);
		const identical = shownBytes.equals(hiddenBytes);
		record(
			"V-COMPOSITE-CAP",
			identical ? "PASS" : "FAIL",
			`owner-target CDP captures shown=${shownBytes.length}B hidden=${hiddenBytes.length}B identical=${identical}; ${identical ? "the owner capture excludes the child, as the S2 spike found — composite pixels remain operator-only" : "the owner capture DIFFERS with the child shown: the composite became machine-measurable on this run and must be inspected"}`,
		);
		// Re-show for the prompts below.
		await projectS3(cdp, opened, 5, { label: "S3 CHILD — visible probe" });
		await sleep(300);
		await evaluate(
			cdp,
			"window.__s3.blur = 0; window.__s3.ime = []; window.__s3.clickOrigin = null;",
		);

		const results = {};
		for (const [rowId, question] of S3_VISIBLE_PROMPTS) {
			// Each row gets its own focus baseline: a blur counted by an earlier
			// click must not be attributed to this one.
			await evaluate(cdp, "window.__s3.blur = 0");
			const remaining = Math.max(
				8,
				Math.floor(
					(VISIBLE_CAP_MS - 25_000 - (Date.now() - launchedAt)) / 1000,
				),
			);
			const answer = await askOperator(rl, question, Math.min(15, remaining));
			const facts = await probe(cdp, "facts");
			const counters = await pageCounters(pageCdp);
			const dom = await evaluate(
				cdp,
				`(() => {
					const el = document.querySelector('[data-tour-tag="browser-address"]');
					return { blur: window.__s3.blur, ime: window.__s3.ime, hasFocus: document.hasFocus(), active: document.activeElement === el };
				})()`,
			);
			results[rowId] = { answer, facts, counters, dom };
			factsLog.push({ label: rowId, facts, counters, dom, answer });
		}

		const order = results["V-ORDER"];
		record(
			"V-ORDER",
			order?.answer == null
				? "BLOCKED"
				: /^y/i.test(order.answer.trim())
					? "PASS"
					: "FAIL",
			`operator answer=${JSON.stringify(order?.answer ?? null)} (their eyes only; no rig pixels)`,
		);
		const focusClick = results["V-FOCUS-CLICK"];
		record(
			"V-FOCUS-CLICK",
			focusClick?.answer == null
				? "BLOCKED"
				: focusClick.dom.blur === 0 &&
						focusClick.facts.child.focusEvents === 0 &&
						focusClick.facts.s2.commitsEmitted >= 1
					? "PASS"
					: "FAIL",
			`operator answer=${JSON.stringify(focusClick?.answer ?? null)} parentBlur=${focusClick?.dom.blur} childFocusEvents=${focusClick?.facts.child.focusEvents} mouseDowns=${focusClick?.facts.s2.mouseDowns} commits=${focusClick?.facts.s2.commitsEmitted} activeElementIsInput=${focusClick?.dom.active}`,
		);
		record(
			"V-FIRSTMOUSE",
			focusClick?.answer == null ? "BLOCKED" : "PASS",
			`click #1 in an unfocused inactive window: answer=${JSON.stringify(focusClick?.answer ?? null)}${/second/i.test(focusClick?.answer ?? "") ? " — the FIRST click did not land (acceptFirstMouse=false), the second did: recorded, not treated as a defect" : " — the first click landed"}`,
		);
		const hit = results["V-HIT"];
		record(
			"V-HIT",
			hit?.answer == null
				? "BLOCKED"
				: hit.counters.downs > 0
					? "PASS"
					: "FAIL",
			`operator answer=${JSON.stringify(hit?.answer ?? null)} pageCounters=${JSON.stringify(hit?.counters ?? null)} (the page's own listener: a click just below the list must reach it)`,
		);
		const wheel = results["V-WHEEL"];
		record(
			"V-WHEEL",
			wheel?.answer == null
				? "BLOCKED"
				: wheel.counters.wheels === 0 && wheel.counters.scrollTop === 0
					? "PASS"
					: "FAIL",
			`operator answer=${JSON.stringify(wheel?.answer ?? null)} pageWheels=${wheel?.counters.wheels} pageScrollTop=${wheel?.counters.scrollTop}`,
		);
		const ime = results.I2;
		const imeAffirmative =
			ime?.answer != null && /^(y|yes|はい|是)/i.test(ime.answer.trim());
		record(
			"I2",
			ime?.answer == null
				? "BLOCKED"
				: imeAffirmative && ime.dom.ime.length > 0
					? "PASS"
					: "FAIL",
			`operator answer=${JSON.stringify(ime?.answer ?? null)} compositionEventsSeenByTheField=${JSON.stringify(ime?.dom.ime ?? [])}`,
		);

		teardown = { launchedAt, pid: handle.child.pid, reason: "probe-finished" };
	} catch (error) {
		appendEvent({
			event: "s3-visible-failure",
			error: String(error?.stack ?? error),
		});
		throw error;
	} finally {
		rl.close();
		const stopAt = Date.now();
		await handle.stop("SIGTERM");
		const exit = await Promise.race([
			handle.exited,
			sleep(20_000).then(() => null),
		]);
		if (exit === null) reapTree(handle.child.pid);
		const aliveNow = alive(handle.child.pid);
		const survivors = descendants(handle.child.pid).map((pid) => pid);
		const teardownRecord = {
			pid: handle.child.pid,
			exitCode: handle.child.exitCode,
			exitSignal: handle.child.signalCode,
			stopMs: Date.now() - stopAt,
			processAlive: aliveNow,
			leftovers: survivors,
			capMs: VISIBLE_CAP_MS,
			ranFor: Date.now() - launchedAt,
			tag: "s3-visible",
		};
		writeFileSync(
			join(OUT, "teardown.json"),
			`${JSON.stringify(teardownRecord, null, 2)}\n`,
		);
		recordRowVisible(teardownRecord);
	}
}

function recordRowVisible(teardown) {
	record(
		"T1-visible",
		teardown.exitCode === 0 &&
			teardown.processAlive === false &&
			teardown.leftovers.length === 0 &&
			teardown.ranFor < teardown.capMs
			? "PASS"
			: "FAIL",
		`exit=${teardown.exitCode} signal=${teardown.exitSignal} stopMs=${teardown.stopMs} alive=${teardown.processAlive} leftovers=${JSON.stringify(teardown.leftovers)} ranFor=${teardown.ranFor}ms`,
	);
}

/** Rows that only an attending operator can produce: BLOCKED, never passes. */
function recordS3UnattendedRows() {
	for (const id of [
		"G4b",
		"I2",
		"AX2",
		"V-ORDER",
		"V-HIT",
		"V-FOCUS-SHOW",
		"V-FOCUS-CLICK",
		"V-FIRSTMOUSE",
		"V-WHEEL",
		"V-COMPOSITE-CAP",
		"T1-visible",
		"W1",
	]) {
		// A visible run may already have recorded this row; only the gaps are BLOCKED.
		if (rows.find((row) => row.id === id)?.at != null) continue;
		record(
			id,
			"BLOCKED",
			`operator-attended --s3-visible was NOT run in this pass; ${id === "W1" ? "Windows/Linux was not measured" : "this row needs eyes, a real click, a real wheel or a real macOS IME"}`,
		);
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
let matrixError = null;
try {
	if (S3_VISIBLE) {
		/*
		 * One operator-attended run. Its rows are planned first so a crash still
		 * leaves a matrix that says which claims were never reached, and the
		 * refusals it can prove are proven BEFORE the visible window opens.
		 */
		rows.length = 0;
		planS3Rows();
		await s3VisibleRun();
		record(
			"G4c",
			"asserted-only",
			"the packaged refusal is pinned by scripts/browser-address-overlay.test.mjs's S3 table; a packaged build cannot be spawned from this checkout",
		);
		recordS3UnattendedRows();
	} else if (S3) {
		/*
		 * S3 is an increment on S2, so the S2 rows are re-run ON THIS HEAD as the
		 * regression surface and K3/M1 are derived from those receipts rather than
		 * re-measured. No S1-only rows: S1's matrix is unchanged and runs with no
		 * flag.
		 */
		rows.length = 0;
		planS2Rows();
		planS3Rows();
		s2BuildRow();
		await s3HeadlessVisibleRefusal();
		await s2GateCases();
		await s2RealInputMatrix();
		await s2SyntheticMatrix();
		deriveS3Rows();
		await s3HeadlessMatrix();
		record(
			"G4c",
			"asserted-only",
			"the packaged refusal is pinned by scripts/browser-address-overlay.test.mjs's S3 table; a packaged build cannot be spawned from this checkout",
		);
		recordS3UnattendedRows();
	} else if (S2) {
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
	// Recorded in the finally, AFTER the asserted/blocked close-out rows: those
	// ids are owned by closeS2Rows/closeAssertedRows and recording them twice is
	// a probe bug (the first S3 run died exactly there).
	matrixError = error;
	console.error(`[probe] matrix failed: ${String(error?.stack ?? error)}`);
	appendEvent({ event: "failure", error: String(error?.stack ?? error) });
} finally {
	// A visible run plans ONLY S3 rows: the S1/S2 close-out rows belong to the
	// matrices that were not run, and recording them would be "unknown row".
	if (S2 || S3) closeS2Rows(S3);
	else if (!S3_VISIBLE) closeAssertedRows();
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
	/*
	 * The teardown receipt, written after every boot was stopped and reaped: one
	 * entry per launch, by exact pid, so "no survivors" is a file a reviewer can
	 * read rather than a line a run printed. The visible run writes its own
	 * detailed `teardown.json` inside `s3VisibleRun`, so this aggregate leaves it
	 * alone.
	 */
	if (!S3_VISIBLE) {
		const teardown = {
			at: at(),
			boots: boots.map((entry) => ({
				tag: entry.tag,
				pid: entry.child.pid,
				exitCode: entry.child.exitCode,
				exitSignal: entry.child.signalCode,
				alive: alive(entry.child.pid),
				leftovers: descendants(entry.child.pid).filter(alive),
			})),
		};
		writeFileSync(
			join(OUT, "teardown.json"),
			`${JSON.stringify(teardown, null, 2)}\n`,
		);
	}
	const unresolved = rows.filter((row) => row.at === null);
	for (const row of unresolved) {
		record(
			row.id,
			matrixError === null ? "BLOCKED" : "FAIL",
			matrixError === null
				? "not reached by this run"
				: `matrix aborted: ${String(matrixError)}`,
		);
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
