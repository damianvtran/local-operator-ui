#!/usr/bin/env node
/**
 * S6d capture and real-host proof for the approvals corner popup.
 *
 * Boots the BUILT app headless (`--window-mode=headless`: never shown, never
 * focused) with a scratch HOME, config, log and Electron profile, drives the real
 * `/browser` route through CDP and the real host through its RPC, and writes:
 *   - app frames (renderer `Page.captureScreenshot`): the toolbar with its badge,
 *     the Approvals dialog populated and empty, and the page-menu result;
 *   - `s6d-<mode>.json`: every measured row, with the grants list before and
 *     after each action so the side effects are on the record.
 *
 * WHAT A HEADLESS CAPTURE CAN AND CANNOT CLAIM. A headless window does not
 * present the page view, so the native card child never auto-presents here and a
 * renderer capture never contains a native child. The card's own frames come
 * from the card document capture in `browser-approvals-s6b-probe.mjs --frames`.
 * The composite (card over a live page), ring hit routing and VoiceOver are
 * BLOCKED and not claimed.
 *
 * Modes: (default) the product build, card on; `--kill` the kill switch;
 * `--before --app-root <origin/main build>` origin/main with its S6A opt-in.
 *
 * Usage: node scripts/browser-approvals-s6d-capture.mjs --out <dir> [--kill|--before --app-root <dir>]
 */
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(join(ROOT, "package.json"));
const electron = requireFromRepo("electron");
// `--app-root <dir>` boots another build of the app (the BEFORE frames use a build
// of origin/main) while this tree keeps the rig. Launch modes: default = the
// product (card on); `--kill` = the S6d kill switch (dock/band fallback);
// `--before` = origin/main, whose card exists only under its S6A opt-in.
const argAt = (flag) => {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : null;
};
const APP_ROOT = resolve(argAt("--app-root") ?? ROOT);
const BEFORE = process.argv.includes("--before");
const KILL = process.argv.includes("--kill");
const OUT = (() => {
	const index = process.argv.indexOf("--out");
	const value = index >= 0 ? process.argv[index + 1] : "";
	if (!value || value.startsWith("--")) throw new Error("--out is required");
	return resolve(value);
})();
const SCRATCH = mkdtempSync(
	join(process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir(), "s6d-capture-"),
);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const LOG_DIR = join(SCRATCH, "logs");
const USER_DATA = join(SCRATCH, "userdata");
const SITE_PORT = Number(argAt("--site-port") ?? 45873);
const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT}`;
mkdirSync(OUT, { recursive: true });
mkdirSync(HOME_DIR, { recursive: true });
mkdirSync(CONFIG_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(USER_DATA, { recursive: true });

const sleep = (ms) =>
	new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const owned = [];
let app = null;
let devtoolsPort = 0;
let inspectPort = 0;
let siteServer = null;

function say(line) {
	console.log(line);
}
function record(id, pass, detail, blocked = false) {
	return { id, status: blocked ? "BLOCKED" : pass ? "PASS" : "FAIL", detail };
}

async function freePort(start) {
	for (let port = start; port < start + 200; port += 1) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (response.ok) continue;
		} catch {
			return port;
		}
	}
	throw new Error("no free debugging port");
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.n = 0;
		this.p = new Map();
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id && this.p.has(message.id)) {
				const { resolve: ok, reject } = this.p.get(message.id);
				this.p.delete(message.id);
				if (message.error) reject(new Error(message.error.message));
				else ok(message.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.n;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((ok, reject) => this.p.set(id, { resolve: ok, reject }));
	}
	async eval(expression) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			throw new Error(
				result.exceptionDetails.exception?.description ??
					result.exceptionDetails.text ??
					"evaluate threw",
			);
		}
		return result.result?.value;
	}
	close() {
		try {
			this.ws.close();
		} catch {
			/* already closed */
		}
	}
}

async function attach(port, pick, timeoutMs = 60000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${port}/json/list`)
			).json();
			const target = list.find(pick);
			if (target) {
				const ws = new WebSocket(target.webSocketDebuggerUrl);
				await new Promise((ok, reject) => {
					ws.addEventListener("open", ok, { once: true });
					ws.addEventListener("error", reject, { once: true });
				});
				return new Cdp(ws);
			}
		} catch {
			/* not up yet */
		}
		await sleep(250);
	}
	throw new Error(`no target on ${port}`);
}

function launchApp(mode) {
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: mode,
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	// Every other variant of either variable is removed first so a stale export
	// from the caller cannot pick the mode for this launch.
	Reflect.deleteProperty(
		env,
		"LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_DISABLE",
	);
	Reflect.deleteProperty(
		env,
		"LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_S6A",
	);
	if (KILL) env.LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_DISABLE = "1";
	if (BEFORE) env.LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_S6A = "1";
	app = spawn(
		electron,
		withMockKeychain([
			".",
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${devtoolsPort}`,
			`--inspect=${inspectPort}`,
			`--window-mode=${mode}`,
			...(mode === "inactive" ? ["--window-size=600x900"] : []),
		]),
		{
			env,
			cwd: APP_ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		},
	);
	owned.push({ pid: app.pid, group: true });
	const chunks = [];
	app.stdout.on("data", (chunk) => chunks.push(String(chunk)));
	app.stderr.on("data", (chunk) => chunks.push(String(chunk)));
	app.on("exit", () => {
		try {
			writeFileSync(join(SCRATCH, "app.log"), chunks.join(""));
		} catch {
			/* best effort */
		}
	});
	return { chunks };
}

function stop() {
	for (const entry of owned.reverse()) {
		try {
			process.kill(-entry.pid, "SIGTERM");
		} catch {
			try {
				entry.pid && process.kill(entry.pid, "SIGTERM");
			} catch {
				/* gone */
			}
		}
	}
	setTimeout(() => {
		for (const entry of owned) {
			try {
				process.kill(-entry.pid, "SIGKILL");
			} catch {
				/* gone */
			}
		}
	}, 3000).unref();
}

function hostStatePath() {
	return join(CONFIG_DIR, "run", "ui-browser", "host.json");
}

async function waitForHostState(timeoutMs = 90000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (existsSync(hostStatePath())) {
			try {
				const parsed = JSON.parse(readFileSync(hostStatePath(), "utf8"));
				if (parsed.port) return parsed;
			} catch {
				/* mid-write */
			}
		}
		await sleep(250);
	}
	throw new Error("the browser host state file never appeared");
}

async function rpc(state, method, params = {}) {
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Bridge-Key": state.session_key,
		},
		body: JSON.stringify({ id: `s6c-${method}`, method, params }),
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* the status is the fact */
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

function serveSite() {
	const page = `<!doctype html><html><head><meta charset="utf-8"><title>S6c page</title>
<style>body{font:14px system-ui;margin:0;padding:28px;background:#f4f5f8}h1{font-size:20px}input{font-size:16px;padding:8px;width:240px}</style>
</head><body><h1>Narrow-panel fixture page</h1><label for="name">Name</label>
<input id="name" type="text" value="" /><p id="typed"></p></body></html>`;
	siteServer = createServer((_request, response) => {
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		response.end(page);
	});
	return new Promise((ok) => {
		siteServer.listen(SITE_PORT, "127.0.0.1", () => ok());
	});
}

async function rendererState(renderer) {
	return await renderer.eval(
		"window.api.browser.state().then((state) => JSON.stringify(state))",
	);
}

async function waitFor(check, label, timeoutMs = 30000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const value = await check();
			if (value) return value;
		} catch {
			/* not yet */
		}
		await sleep(150);
	}
	throw new Error(`timed out waiting for ${label}`);
}

async function setWindowWidth(main, width) {
	await main.eval(`(() => {
		const { BrowserWindow } = process.mainModule.require("electron");
		const win = BrowserWindow.getAllWindows()[0];
		win.setMinimumSize(200, 400);
		win.setContentSize(${width}, 900);
		return "resized";
	})()`);
}

async function waitContentWidth(renderer, width) {
	await sleep(800);
	const measured = JSON.parse(
		await renderer.eval(`(() => {
			const element = document.querySelector('[data-tour-tag="browser-content"]');
			if (!element) return "null";
			return JSON.stringify({
				width: element.getBoundingClientRect().width,
				innerWidth: window.innerWidth,
				rowWidth: element.parentElement?.getBoundingClientRect().width ?? null,
			});
		})()`),
	);
	say(`WIDTH target=${width} actual=${JSON.stringify(measured)}`);
	return measured.width;
}

async function rectOf(renderer, selector) {
	const value = await renderer.eval(`(() => {
		const element = document.querySelector(${JSON.stringify(selector)});
		if (!element) return "null";
		const r = element.getBoundingClientRect();
		return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
	})()`);
	return value === "null" ? null : JSON.parse(value);
}

async function clickAt(renderer, point) {
	await renderer.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: point.x,
		y: point.y,
		button: "left",
		clickCount: 1,
	});
	await renderer.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: point.x,
		y: point.y,
		button: "left",
		clickCount: 1,
	});
}

async function setTheme(renderer, themeName) {
	await renderer.eval(
		`localStorage.setItem("ui-preferences-storage", JSON.stringify({ state: { themeName: ${JSON.stringify(themeName)} }, version: 0 })); "ok"`,
	);
	await renderer.send("Page.reload", { ignoreCache: true });
	await waitFor(
		() =>
			renderer.eval(
				"typeof window.api?.browser?.state === 'function' ? true : false",
			),
		"renderer after theme reload",
	);
	await renderer.eval("location.hash = '#/browser'; 'ok'");
	await waitFor(
		() =>
			renderer.eval(
				`Boolean(document.querySelector('[data-tour-tag="browser-content"]'))`,
			),
		"browser route after theme reload",
	);
	await sleep(500);
}

/* ------------------------------------------------------------------------- */
/* The S6d run                                                                 */
/* ------------------------------------------------------------------------- */

const MODE = BEFORE ? "before" : KILL ? "kill" : "default";
const FRAMES_DIR = join(OUT, "frames");
mkdirSync(FRAMES_DIR, { recursive: true });
const rows = [];
const trace = [];
const note = (label, value) => {
	trace.push({ label, value });
	say(`${label}\t${typeof value === "string" ? value : JSON.stringify(value)}`);
};

async function shoot(renderer, label, clipAround = null) {
	const params = { format: "png" };
	if (clipAround) {
		const rect = JSON.parse(
			await renderer.eval(`(() => {
				const el = document.querySelector(${JSON.stringify(clipAround)});
				if (!el) return "null";
				const r = el.getBoundingClientRect();
				return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth });
			})()`),
		);
		if (rect) {
			params.clip = {
				x: 0,
				y: Math.max(0, rect.y - 46),
				width: rect.iw,
				height: 100,
				scale: 2,
			};
		}
	}
	const shot = await renderer.send("Page.captureScreenshot", params);
	const path = join(FRAMES_DIR, `${label}.png`);
	writeFileSync(path, Buffer.from(shot.data, "base64"));
	note("FRAME", label);
	return path;
}

const projection = async (renderer) =>
	JSON.parse(await rendererState(renderer));
const grantsOf = async (renderer) =>
	(await projection(renderer)).approvals
		.map((row) => `${row.scope}:${row.origin}`)
		.sort();
const countTags = (renderer, tags) =>
	renderer.eval(
		`JSON.stringify(Object.fromEntries(${JSON.stringify(tags)}.map((tag) => [tag, document.querySelectorAll('[data-tour-tag="' + tag + '"]').length])))`,
	);
const dockSelectors = (renderer) =>
	renderer.eval(`JSON.stringify({
		dataDockLayout: document.querySelectorAll('[data-dock-layout]').length,
		dockTitle: document.querySelectorAll('[data-tour-tag="browser-approvals-dock-title"]').length,
		consentBar: document.querySelectorAll('[data-tour-tag="browser-consent-bar"]').length,
		dialog: document.querySelectorAll('[data-tour-tag="browser-approvals-dialog"]').length,
	})`);
const contentRect = async (renderer) =>
	JSON.parse(
		await renderer.eval(`(() => {
			const r = document.querySelector('[data-tour-tag="browser-content"]').getBoundingClientRect();
			return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
		})()`),
	);

async function click(renderer, selector) {
	const point = await rectOf(renderer, selector);
	if (!point) throw new Error(`missing ${selector}`);
	await clickAt(renderer, point);
	await sleep(350);
}
/** The button whose text includes `needle`, inside the dialog. */
async function clickDialogButton(renderer, needle) {
	const point = JSON.parse(
		await renderer.eval(`(() => {
			const root = document.querySelector('[data-tour-tag="browser-approvals-dialog"]');
			const button = [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').includes(${JSON.stringify(needle)}));
			if (!button) return "null";
			button.scrollIntoView({ block: "center" });
			const r = button.getBoundingClientRect();
			return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
		})()`),
	);
	if (!point) throw new Error(`no dialog button "${needle}"`);
	await clickAt(renderer, point);
	await sleep(500);
}
async function closeDialog(renderer) {
	await renderer.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await renderer.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await waitFor(
		() =>
			renderer.eval(
				`!document.querySelector('[data-tour-tag="browser-approvals-dialog"]')`,
			),
		"the Approvals dialog to close",
	);
}
/** The Approvals entry, the way a person reaches it at this width: the toolbar
 * control when the row shows it, the page menu below 300px. */
async function openApprovalsRoute(renderer) {
	const toolbar = await rectOf(
		renderer,
		'button[data-tour-tag="browser-approvals"]',
	);
	if (toolbar) {
		await clickAt(renderer, toolbar);
		return "toolbar";
	}
	await click(renderer, '[data-tour-tag="browser-page-menu"]');
	await waitFor(
		() =>
			renderer.eval(
				`Boolean(document.querySelector('[role="menu"] [data-tour-tag="browser-approvals"]'))`,
			),
		"the page menu's Approvals item",
	);
	await renderer.eval(
		`document.querySelector('[role="menu"] [data-tour-tag="browser-approvals"]').click(); "clicked"`,
	);
	return "menu";
}
async function askAndAnswer(state, renderer, origin, requester, decision) {
	await rpcOk(state, "request_access", { url: origin, requester });
	const entry = await waitFor(
		async () =>
			(await projection(renderer)).pendingConsent.find(
				(candidate) => candidate.origin === origin,
			),
		`the pending request for ${origin}`,
	);
	await renderer.eval(
		`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, ${JSON.stringify(decision)}).then((s) => JSON.stringify(s))`,
	);
	await waitFor(
		async () =>
			!(await projection(renderer)).pendingConsent.some(
				(c) => c.entryId === entry.entryId,
			),
		"the answered request to leave the queue",
	);
}
async function cookieNames(main) {
	return JSON.parse(
		await main.eval(`(async () => {
			const { session } = process.mainModule.require("electron");
			const cookies = await session.fromPartition("persist:local-operator-browser").cookies.get({});
			return JSON.stringify(cookies.map((c) => c.name + "@" + c.domain).sort());
		})()`),
	);
}

async function cell(proof, label, width, theme) {
	const { renderer, main, state } = proof;
	await setTheme(renderer, theme);
	await setWindowWidth(main, width);
	await waitContentWidth(renderer, width);
	await sleep(600);
	const out = { label, width, theme };

	// 1. Nothing pending, no grants: the toolbar and (card builds) the empty dialog.
	out.emptyGrants = await grantsOf(renderer);
	await shoot(
		renderer,
		`${label}-toolbar-empty`,
		'[data-tour-tag="browser-page-menu"]',
	);
	const route = await openApprovalsRoute(renderer);
	out.route = route;
	await sleep(700);
	out.afterEmptyOpen = JSON.parse(await dockSelectors(renderer));
	await shoot(renderer, `${label}-approvals-empty`);
	if (out.afterEmptyOpen.dialog) await closeDialog(renderer);
	else if (out.afterEmptyOpen.dataDockLayout) {
		await renderer.eval(
			`document.querySelector('[data-tour-tag="browser-approvals-dock-close"]')?.click(); "ok"`,
		);
		await sleep(300);
	}

	// 2. Three standing decisions: one per scope the dialog lists.
	const tag = `${label}-${Date.now()}`;
	await askAndAnswer(
		state,
		renderer,
		"https://granted-once.example",
		`session:${tag}-a`,
		"site",
	);
	await askAndAnswer(
		state,
		renderer,
		"https://granted-session.example",
		`session:${tag}-b`,
		"session",
	);
	await askAndAnswer(
		state,
		renderer,
		"https://denied.example",
		`session:${tag}-c`,
		"deny",
	);
	out.populatedGrants = await grantsOf(renderer);
	await openApprovalsRoute(renderer);
	await sleep(700);
	out.afterPopulatedOpen = JSON.parse(await dockSelectors(renderer));
	await shoot(renderer, `${label}-approvals-populated`);
	if (out.afterPopulatedOpen.dialog) await closeDialog(renderer);
	else if (out.afterPopulatedOpen.dataDockLayout) {
		await renderer.eval(
			`document.querySelector('[data-tour-tag="browser-approvals-dock-close"]')?.click(); "ok"`,
		);
		await sleep(300);
	}

	// 3. Two requests pending: the badge, and the proof that nothing pushes.
	const before = await contentRect(renderer);
	await rpcOk(state, "request_access", {
		url: "https://pending-one.example",
		requester: `session:${tag}-p1`,
	});
	await rpcOk(state, "request_access", {
		url: "https://pending-two.example",
		requester: `session:${tag}-p2`,
	});
	await waitFor(
		async () => (await projection(renderer)).pendingConsent.length >= 2,
		"two pending requests",
	);
	await sleep(900);
	const after = await contentRect(renderer);
	out.contentBeforePending = before;
	out.contentAfterPending = after;
	out.pendingSelectors = JSON.parse(await dockSelectors(renderer));
	out.badge = await renderer.eval(
		`JSON.stringify({ toolbar: document.querySelector('[data-tour-tag="browser-approvals-badge"]')?.textContent ?? null, folded: document.querySelector('[data-tour-tag="browser-approvals-folded-badge"]')?.textContent ?? null })`,
	);
	const projected = await projection(renderer);
	out.approvalsCard = projected.approvalsCard ?? null;
	await shoot(
		renderer,
		`${label}-toolbar-badge`,
		'[data-tour-tag="browser-page-menu"]',
	);
	await shoot(renderer, `${label}-page-with-pending`);

	// 4. Reach the entry with requests pending.
	out.routePending = await openApprovalsRoute(renderer);
	await sleep(700);
	out.afterPendingOpen = JSON.parse(await dockSelectors(renderer));
	out.cardAfterPendingOpen = (await projection(renderer)).approvalsCard ?? null;
	await shoot(renderer, `${label}-after-approvals-click-pending`);
	if (out.afterPendingOpen.dialog) await closeDialog(renderer);
	else if (out.afterPendingOpen.dataDockLayout) {
		await renderer.eval(
			`document.querySelector('[data-tour-tag="browser-approvals-dock-close"]')?.click(); "ok"`,
		);
		await sleep(300);
	}
	// Close an explicitly opened card so the next cell starts clean.
	await renderer
		.eval(`window.api.browser.closeApprovalsCard?.().then(() => "ok")`)
		.catch(() => {});

	// 5. Reset: answer the pending, then revoke everything, so the next cell is empty.
	for (const entry of (await projection(renderer)).pendingConsent) {
		await renderer.eval(
			`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, "once").then((s) => "ok")`,
		);
	}
	await renderer.eval(
		`window.api.browser.revokeAllApprovals().then(() => "ok")`,
	);
	await waitFor(
		async () => (await grantsOf(renderer)).length === 0,
		"grants to clear between cells",
	);
	return out;
}

/** Side effects through the dialog's real buttons against the real host. */
async function actions(proof) {
	const { renderer, main, state } = proof;
	await setTheme(renderer, "localOperatorDark");
	await setWindowWidth(main, 1160);
	await waitContentWidth(renderer, 1160);
	await sleep(600);
	const out = {};
	const tag = `act-${Date.now()}`;
	await askAndAnswer(state, renderer, SITE_ORIGIN, `session:${tag}-a`, "site");
	await askAndAnswer(
		state,
		renderer,
		"https://second.example",
		`session:${tag}-b`,
		"session",
	);
	// A third grant, so Revoke all still has something to drop after the single
	// Revoke and the Forget have each removed one.
	await askAndAnswer(
		state,
		renderer,
		"https://third.example",
		`session:${tag}-d`,
		"session",
	);
	await askAndAnswer(
		state,
		renderer,
		"https://denied.example",
		`session:${tag}-c`,
		"deny",
	);
	await rpcOk(state, "open", {
		url: `${SITE_ORIGIN}/`,
		requester: `session:${tag}-a`,
	});
	const tabId = await waitFor(
		async () =>
			(await projection(renderer)).tabs.find((tab) =>
				tab.url.startsWith(SITE_ORIGIN),
			)?.tabId,
		"the site tab",
	);
	await renderer.eval(
		`window.api.browser.activateTab(${Number(tabId)}).then(() => "ok")`,
	);
	await waitFor(
		async () => (await projection(renderer)).activeTabId === Number(tabId),
		"the site tab to be active",
	);
	const page = await attach(
		devtoolsPort,
		(target) => target.type === "page" && target.url.startsWith(SITE_ORIGIN),
	);
	await waitFor(
		() => page.eval("document.readyState === 'complete'"),
		"page load",
	);
	await sleep(400);

	await openApprovalsRoute(renderer);
	await waitFor(
		() =>
			renderer.eval(
				`Boolean(document.querySelector('[data-tour-tag="browser-approvals-dialog"]'))`,
			),
		"the Approvals dialog",
	);
	await sleep(500);
	out.grantsStart = await grantsOf(renderer);

	// Forget this site: the approval for the ACTIVE tab's origin AND its cookies go.
	await page.eval(`document.cookie = "s6d_probe=1; path=/"; document.cookie`);
	out.cookiesBeforeForget = await cookieNames(main);
	await clickDialogButton(renderer, "Forget this site");
	out.afterForget = await grantsOf(renderer);
	out.cookiesAfterForget = await cookieNames(main);

	// Revoke one granted site (the first row's Revoke button).
	await clickDialogButton(renderer, "Revoke");
	out.afterRevokeOne = await grantsOf(renderer);

	// Clear cookies and site data: cookies go, approvals stay.
	await page.eval(`document.cookie = "s6d_probe2=1; path=/"; document.cookie`);
	out.cookiesBeforeClear = await cookieNames(main);
	out.grantsBeforeClear = await grantsOf(renderer);
	await clickDialogButton(renderer, "Clear cookies and site data");
	out.cookiesAfterClear = await cookieNames(main);
	out.grantsAfterClear = await grantsOf(renderer);

	// Revoke all.
	await clickDialogButton(renderer, "Revoke all site approvals");
	out.afterRevokeAll = await grantsOf(renderer);
	await shoot(renderer, "actions-after-revoke-all");
	await closeDialog(renderer);
	page.close();
	return out;
}

async function runProof() {
	const renderer = await attach(
		devtoolsPort,
		(target) => target.type === "page" && target.url.includes("index.html"),
	);
	await renderer.eval("location.hash = '#/browser'; 'ok'");
	const main = await attach(inspectPort, (target) => target.type === "node");
	const state = await waitForHostState();
	await waitFor(
		() => renderer.eval("typeof window.api?.browser?.state === 'function'"),
		"renderer bridge",
	);
	await waitFor(
		() =>
			renderer.eval(
				`Boolean(document.querySelector('[data-tour-tag="browser-content"]'))`,
			),
		"browser route",
	);
	await sleep(1200);
	const proof = { renderer, main, state };
	const cells = [];
	for (const [label, width, theme] of [
		["w1160-dark", 1160, "localOperatorDark"],
		["w1160-light", 1160, "localOperatorLight"],
		["w264-dark", 264, "localOperatorDark"],
		["w264-light", 264, "localOperatorLight"],
	]) {
		cells.push(await cell(proof, label, width, theme));
	}
	const act = MODE === "before" ? null : await actions(proof);
	return { cells, act };
}

const result = {
	at: new Date().toISOString(),
	mode: MODE,
	appRoot: APP_ROOT,
	scratch: SCRATCH,
};
try {
	devtoolsPort = await freePort(13400);
	inspectPort = await freePort(devtoolsPort + 300);
	await serveSite();
	launchApp("headless");
	const proof = await runProof();
	result.head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: APP_ROOT,
		encoding: "utf8",
	}).trim();
	result.cells = proof.cells;
	result.actions = proof.act;
	result.trace = trace;
	writeFileSync(join(OUT, `s6d-${MODE}.json`), JSON.stringify(result, null, 2));
	say(`DONE ${MODE} head ${result.head}`);
} catch (error) {
	result.error = String(error?.stack ?? error);
	result.trace = trace;
	writeFileSync(join(OUT, `s6d-${MODE}.json`), JSON.stringify(result, null, 2));
	say(`ERROR ${result.error}`);
	process.exitCode = 1;
} finally {
	try {
		app?.stdout?.destroy();
	} catch {
		/* ignore */
	}
	siteServer?.close();
	stop();
	setTimeout(() => process.exit(process.exitCode ?? 0), 3500).unref();
}
