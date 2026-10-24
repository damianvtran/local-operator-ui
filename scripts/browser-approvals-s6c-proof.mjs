#!/usr/bin/env node
/**
 * S6c enabled-path proof and frames.
 *
 * The probe rigs prove the CONTROLLER; this boots the BUILT app with the card
 * enabled (the product default) and drives the real browser route, so the
 * enabled path is measured where it now presents: the shield/menu route, the
 * page view's bounds/presentation, and the page's own focus and typing.
 *
 * It is deliberately small and isolated:
 *   - scratch HOME, config, log and Electron profile (the app's logger does not
 *     follow HOME, hence its own LOG_DIR);
 *   - no CMUX_/LOP_ variables inherited, telemetry and notifications off, mock keychain;
 *   - a private devtools port and a private main-process inspector port;
 *   - every process started here is reaped by exact process group on exit.
 *
 * Usage:
 *   node scripts/browser-approvals-s6c-proof.mjs --out <dir>
 *   node scripts/browser-approvals-s6c-proof.mjs --out <dir> --frames
 *
 * The enabled proof runs in `--window-mode=inactive`: a headless window does
 * not present the page view, so the card cannot auto-present there. The window
 * is visible but never focused, and the run reaps before returning.
 *
 * `--frames` also captures the enabled build's real documents: the app's
 * `/browser` route and the card child, at 264/900 content widths in dark and
 * light. The native COMPOSITE (card over the live page) needs macOS Screen
 * Recording; `screencapture -l` refuses on this host with "could not create
 * image from window", so that row is recorded BLOCKED rather than claimed.
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
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(join(ROOT, "package.json"));
const electron = requireFromRepo("electron");
const OUT = (() => {
	const index = process.argv.indexOf("--out");
	const value = index >= 0 ? process.argv[index + 1] : "";
	if (!value || value.startsWith("--")) throw new Error("--out is required");
	return resolve(value);
})();
const FRAMES = process.argv.includes("--frames");
const SCRATCH = mkdtempSync(
	join(process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir(), "s6c-proof-"),
);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const LOG_DIR = join(SCRATCH, "logs");
const USER_DATA = join(SCRATCH, "userdata");
const SITE_PORT = 45871;
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
	// The card is the default; a stale variable from a caller would silently
	// test the fallback instead.
	Reflect.deleteProperty(
		env,
		"LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_DISABLE",
	);
	app = spawn(
		electron,
		[
			".",
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${devtoolsPort}`,
			`--inspect=${inspectPort}`,
			`--window-mode=${mode}`,
			"--use-mock-keychain",
			...(mode === "inactive" ? ["--window-size=600x900"] : []),
		],
		{
			env,
			cwd: ROOT,
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
</head><body><h1>S6c enabled-path page</h1><label for="name">Name</label>
<input id="name" type="text" value="" /><p id="typed"></p></body></html>`;
	siteServer = createServer((request, response) => {
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

async function runProof() {
	const state = await waitForHostState();
	await sleep(1500);
	const renderer = await attach(
		devtoolsPort,
		(target) => target.type === "page" && target.url.includes("index.html"),
	);
	await waitFor(
		() =>
			renderer.eval(
				"typeof window.api?.browser?.state === 'function' ? true : false",
			),
		"renderer bridge",
	);
	await renderer.eval("location.hash = '#/browser'; 'ok'");
	await waitFor(
		() =>
			renderer.eval(
				"Boolean(document.querySelector('[data-tour-tag=\"browser-content\"]'))",
			),
		"browser route",
	);
	await sleep(800);

	// Approve the page origin, then open a real page so the tab is presented.
	const first = await rpcOk(state, "request_access", {
		url: SITE_ORIGIN,
		requester: "session:s6c-proof",
	});
	const pending = JSON.parse(await rendererState(renderer)).pendingConsent;
	const entry = pending.find((candidate) => candidate.origin === SITE_ORIGIN);
	if (!entry) throw new Error("the first consent request did not appear");
	await renderer.eval(
		`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, "site").then((s) => JSON.stringify(s))`,
	);
	await rpcOk(state, "await_access", {
		url: SITE_ORIGIN,
		requester: "session:s6c-proof",
	});
	const opened = await rpcOk(state, "open", {
		url: `${SITE_ORIGIN}/`,
		requester: "session:s6c-proof",
	});
	// An agent tab is created INACTIVE (registry.create). The card auto-presents
	// from the presented page, so this real-app run activates the tab the way the
	// renderer's own tab strip does.
	const tabId = await waitFor(async () => {
		const projection = JSON.parse(await rendererState(renderer));
		return projection.tabs.find((tab) => tab.url.startsWith(SITE_ORIGIN))
			?.tabId;
	}, "the opened tab in the projection");
	await renderer.eval(
		`window.api.browser.activateTab(${Number(tabId)}).then((s) => JSON.stringify(s))`,
	);
	await waitFor(async () => {
		const projection = JSON.parse(await rendererState(renderer));
		return projection.activeTabId === Number(tabId);
	}, "the opened tab to be active");
	const page = await attach(
		devtoolsPort,
		(target) => target.type === "page" && target.url.startsWith(SITE_ORIGIN),
	);
	await waitFor(
		() => page.eval("document.readyState === 'complete'"),
		"page load",
	);
	const pageBaseline = await page.eval(`(() => {
		window.__s6c = { focus: 0, blur: 0, keys: 0 };
		window.addEventListener("focus", () => { window.__s6c.focus += 1; });
		window.addEventListener("blur", () => { window.__s6c.blur += 1; });
		document.addEventListener("keydown", () => { window.__s6c.keys += 1; });
		const input = document.getElementById("name");
		input.focus();
		input.value = "";
		return JSON.stringify({
			active: document.activeElement?.id ?? null,
			focus: window.__s6c.focus,
			blur: window.__s6c.blur,
			keys: window.__s6c.keys,
			innerWidth,
			innerHeight,
			visibility: document.visibilityState,
			hasFocus: document.hasFocus(),
		});
	})()`);
	const mainBaseline = await attach(
		inspectPort,
		(target) => target.type === "node",
	).then((main) =>
		main.eval(`(() => {
			const { BrowserWindow, webContents } = process.mainModule.require("electron");
			const win = BrowserWindow.getAllWindows()[0];
			return JSON.stringify({
				id: win.getMediaSourceId(),
				visible: win.isVisible(),
				focused: win.isFocused(),
				bounds: win.getContentBounds(),
				focusedContents: webContents.getFocusedWebContents()?.getURL() ?? null,
				views: win.contentView.children.map((view) => ({
					url: view.webContents.getURL(),
					bounds: view.getBounds(),
					visible: view.getVisible(),
					focused: view.webContents.isFocused(),
				})),
			});
		})()`),
	);
	const baseline = JSON.parse(mainBaseline);

	// A second pending request from another session: the card auto-presents.
	await rpcOk(state, "request_access", {
		url: "https://pending.example",
		requester: "session:s6c-other",
	});
	let shown;
	try {
		shown = await waitFor(async () => {
			const projection = JSON.parse(await rendererState(renderer));
			return projection.approvalsCard?.available &&
				projection.approvalsCard.visible
				? projection
				: null;
		}, "the native card to auto-present");
	} catch (error) {
		const projection = await rendererState(renderer);
		const debugMain = await attach(
			inspectPort,
			(target) => target.type === "node",
		).then((mainDebug) =>
			mainDebug.eval(`(() => {
					const { BrowserWindow } = process.mainModule.require("electron");
					const win = BrowserWindow.getAllWindows()[0];
					return JSON.stringify({
						bounds: win.getContentBounds(),
						children: win.contentView.children.map((view) => ({
							url: view.webContents.getURL(),
							bounds: view.getBounds(),
							visible: view.getVisible(),
						})),
					});
				})()`),
		);
		throw new Error(
			`${error.message}: projection=${projection} main=${debugMain}`,
		);
	}
	const dom = JSON.parse(
		await renderer.eval(`JSON.stringify({
			dock: Boolean(document.querySelector('[data-tour-tag="browser-approvals-dock"]')),
			band: Boolean(document.querySelector('[data-tour-tag="browser-consent-bar"]')),
			shieldExpanded: document.querySelector('[data-tour-tag="browser-approvals"]')?.getAttribute("aria-expanded") ?? null,
			content: (() => { const element = document.querySelector('[data-tour-tag="browser-content"]'); if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
			hash: location.hash,
		})`),
	);
	const pageMetrics = JSON.parse(
		await page.eval(
			"JSON.stringify({ active: document.activeElement?.id ?? null, focus: window.__s6c.focus, blur: window.__s6c.blur, keys: window.__s6c.keys, innerWidth, innerHeight, visibility: document.visibilityState, hasFocus: document.hasFocus() })",
		),
	);
	const main = await attach(inspectPort, (target) => target.type === "node");
	const mainAfter = JSON.parse(
		await main.eval(`(() => {
			const { BrowserWindow, webContents } = process.mainModule.require("electron");
			const win = BrowserWindow.getAllWindows()[0];
			return JSON.stringify({
				id: win.getMediaSourceId(),
				visible: win.isVisible(),
				focused: win.isFocused(),
				bounds: win.getContentBounds(),
				focusedContents: webContents.getFocusedWebContents()?.getURL() ?? null,
				views: win.contentView.children.map((view) => ({
					url: view.webContents.getURL(),
					bounds: view.getBounds(),
					visible: view.getVisible(),
					focused: view.webContents.isFocused(),
				})),
			});
		})()`),
	);
	const cardTarget = await attach(
		devtoolsPort,
		(target) =>
			target.type === "page" &&
			target.url.includes("browser-approvals-overlay.html"),
	);
	await waitFor(
		() => cardTarget.eval("Boolean(document.documentElement)"),
		"the card document",
	);
	const cardDom = JSON.parse(
		await cardTarget.eval(`JSON.stringify({
			lang: document.documentElement.lang,
			dir: document.documentElement.dir,
			theme: document.documentElement.dataset.theme ?? null,
			hasFocus: document.hasFocus(),
			active: document.activeElement?.id ?? null,
			requester: document.getElementById("approvals-requester")?.textContent ?? null,
			origin: document.getElementById("approvals-origin")?.textContent ?? null,
		})`),
	);

	// The Approvals route the dock used to serve: the shield and the page-menu
	// item must open the native card, not a hidden dock.
	const rectOf = async (selector) =>
		JSON.parse(
			await renderer.eval(`(() => {
				const element = document.querySelector(${JSON.stringify(selector)});
				if (!element) return "null";
				const r = element.getBoundingClientRect();
				return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
			})()`),
		);
	const clickAt = async (point) => {
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
	};
	const shieldPoint = await rectOf('[data-tour-tag="browser-approvals"]');
	if (shieldPoint) await clickAt(shieldPoint);
	const shieldRoute = await waitFor(async () => {
		const projection = JSON.parse(await rendererState(renderer));
		return projection.approvalsCard?.open === true ? projection : null;
	}, "the shield to open the native card");
	const shieldExpanded = await renderer.eval(
		`document.querySelector('[data-tour-tag="browser-approvals"]')?.getAttribute("aria-expanded") ?? null`,
	);
	if (shieldPoint) await clickAt(shieldPoint);
	await waitFor(async () => {
		const projection = JSON.parse(await rendererState(renderer));
		return projection.approvalsCard?.open === false;
	}, "the shield to close the native card");

	const menuPoint = await rectOf('[data-tour-tag="browser-page-menu"]');
	if (menuPoint) await clickAt(menuPoint);
	const menuItemPoint = await waitFor(async () => {
		const point = await rectOf(
			'[role="menu"] [data-tour-tag="browser-approvals"]',
		);
		return point ?? null;
	}, "the page menu's Approvals item");
	await renderer.eval(
		`document.querySelector('[role="menu"] [data-tour-tag="browser-approvals"]')?.click(); "clicked"`,
	);
	const menuRoute = await waitFor(async () => {
		const projection = JSON.parse(await rendererState(renderer));
		return projection.approvalsCard?.open === true ? projection : null;
	}, "the page menu to open the native card");
	await renderer.eval(
		"window.api.browser.closeApprovalsCard().then((s) => JSON.stringify(s))",
	);

	// The page keeps the keyboard: type after the card is up.
	await page.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "a",
		code: "KeyA",
		text: "a",
		unmodifiedText: "a",
	});
	await page.send("Input.dispatchKeyEvent", {
		type: "char",
		text: "a",
		key: "a",
	});
	await page.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "a",
		code: "KeyA",
	});
	await sleep(200);
	const pageTyped = JSON.parse(
		await page.eval(
			"JSON.stringify({ value: document.getElementById('name').value, active: document.activeElement?.id ?? null, keys: window.__s6c.keys })",
		),
	);

	// Explicit open, then Escape: the request must stay pending.
	await renderer.eval(
		`window.api.browser.openApprovalsCard({ locale: "en", dir: "ltr" }).then((s) => JSON.stringify(s))`,
	);
	await waitFor(async () => {
		const projection = JSON.parse(await rendererState(renderer));
		return projection.approvalsCard?.open === true;
	}, "explicit open");
	await cardTarget.eval(
		`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); "ok"`,
	);
	await sleep(500);
	const afterEscape = JSON.parse(await rendererState(renderer));
	await renderer.eval(
		`window.api.browser.openApprovalsCard({ locale: "en", dir: "ltr" }).then((s) => JSON.stringify(s))`,
	);
	await waitFor(async () => {
		const projection = JSON.parse(await rendererState(renderer));
		return projection.approvalsCard?.open === true;
	}, "explicit reopen");
	await renderer.eval(
		"window.api.browser.closeApprovalsCard().then((s) => JSON.stringify(s))",
	);
	await sleep(500);
	const afterClose = JSON.parse(await rendererState(renderer));

	const firstPageView = (mainAfter?.views ?? []).find((view) =>
		view.url.startsWith(SITE_ORIGIN),
	);
	const baselinePageView = (baseline?.views ?? []).find((view) =>
		view.url.startsWith(SITE_ORIGIN),
	);
	const rows = [
		record(
			"A1-enabled-auto-present",
			Boolean(shown.approvalsCard?.available && shown.approvalsCard.visible),
			{ card: shown.approvalsCard, dom, cardDom },
		),
		record(
			"D1-dock-absent",
			dom.dock === false &&
				dom.band === false &&
				shown.approvalsCard?.visible === true,
			{
				dock: dom.dock,
				band: dom.band,
				shieldExpanded: dom.shieldExpanded,
				card: shown.approvalsCard,
				hash: dom.hash,
			},
		),
		record(
			"A2-page-focus-unchanged",
			JSON.parse(pageBaseline).active === pageMetrics.active &&
				JSON.parse(pageBaseline).focus === pageMetrics.focus &&
				JSON.parse(pageBaseline).blur === pageMetrics.blur &&
				cardDom.hasFocus === false,
			{ baseline: JSON.parse(pageBaseline), after: pageMetrics, card: cardDom },
		),
		record(
			"A3-typing-continues",
			pageTyped.value.includes("a") &&
				pageTyped.keys > JSON.parse(pageBaseline).keys,
			{ baseline: JSON.parse(pageBaseline), typed: pageTyped },
		),
		record(
			"A4-bounds-and-presented",
			JSON.stringify(firstPageView?.bounds) ===
				JSON.stringify(baselinePageView?.bounds) &&
				firstPageView?.visible === baselinePageView?.visible &&
				JSON.parse(pageBaseline).innerWidth === pageMetrics.innerWidth &&
				JSON.parse(pageBaseline).innerHeight === pageMetrics.innerHeight &&
				JSON.parse(pageBaseline).visibility === pageMetrics.visibility &&
				mainAfter.focusedContents === baseline.focusedContents,
			{ baseline, after: mainAfter, page: pageMetrics },
		),
		record(
			"R1-shield-route",
			Boolean(shieldRoute?.approvalsCard?.open) && shieldExpanded === "true",
			{ card: shieldRoute?.approvalsCard, shieldExpanded },
		),
		record(
			"R2-menu-route",
			Boolean(menuRoute?.approvalsCard?.open) && dom.dock === false,
			{ card: menuRoute?.approvalsCard, dock: dom.dock },
		),
		record(
			"I4-escape-pending",
			afterEscape.pendingConsent.some(
				(candidate) => candidate.origin === "https://pending.example",
			),
			{ pending: afterEscape.pendingConsent, card: afterEscape.approvalsCard },
		),
		record(
			"I6-close-pending",
			afterClose.pendingConsent.some(
				(candidate) => candidate.origin === "https://pending.example",
			),
			{ pending: afterClose.pendingConsent, card: afterClose.approvalsCard },
		),
		record(
			"P1-built-app",
			existsSync(join(ROOT, "out/renderer/browser-approvals-overlay.html")),
			{ build: "out/renderer/browser-approvals-overlay.html" },
		),
	];
	return {
		rows,
		state,
		renderer,
		page,
		main,
		shown,
		dom,
		cardDom,
		mainBaseline,
		mainAfter,
	};
}

async function captureDocuments(proof) {
	const main = await attach(inspectPort, (target) => target.type === "node");
	const dir = join(OUT, "frames");
	mkdirSync(dir, { recursive: true });
	const states = [
		{ label: "264-dark", width: 264, theme: "localOperatorDark" },
		{ label: "264-light", width: 264, theme: "localOperatorLight" },
		{ label: "900-dark", width: 1160, theme: "localOperatorDark" },
		{ label: "900-light", width: 1160, theme: "localOperatorLight" },
	];
	for (const state of states) {
		await main.eval(`(() => {
			const { BrowserWindow } = process.mainModule.require("electron");
			const win = BrowserWindow.getAllWindows()[0];
			win.setMinimumSize(200, 400);
			win.setContentSize(${state.width}, 900);
			return "resized";
		})()`);
		await proof.renderer.eval(
			`localStorage.setItem("ui-preferences-storage", JSON.stringify({ state: { themeName: ${JSON.stringify(state.theme)} }, version: 0 })); "ok"`,
		);
		await proof.renderer.send("Page.reload", { ignoreCache: true });
		await waitFor(
			() =>
				proof.renderer.eval(
					"typeof window.api?.browser?.state === 'function' ? true : false",
				),
			"renderer after reload",
		);
		await proof.renderer.eval("location.hash = '#/browser'; 'ok'");
		await waitFor(
			() =>
				proof.renderer.eval(
					"Boolean(document.querySelector('[data-tour-tag=\"browser-content\"]'))",
				),
			"browser route after reload",
		);
		await sleep(800);
		await proof.renderer.eval(
			`window.api.browser.openApprovalsCard({ locale: "en", dir: "ltr" }).then((s) => JSON.stringify(s))`,
		);
		await waitFor(async () => {
			const projection = JSON.parse(await rendererState(proof.renderer));
			return (
				projection.approvalsCard?.available && projection.approvalsCard.visible
			);
		}, "card after reload");
		const content = JSON.parse(
			await proof.renderer.eval(
				`JSON.stringify((() => { const element = document.querySelector('[data-tour-tag="browser-content"]'); const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; })())`,
			),
		);
		const theme = await proof.renderer.eval(
			"document.documentElement.dataset.theme ?? null",
		);
		const appPng = await proof.renderer.send("Page.captureScreenshot", {
			format: "png",
		});
		const appPath = join(dir, `app-${state.label}.png`);
		writeFileSync(appPath, Buffer.from(appPng.data, "base64"));
		const card = await attach(
			devtoolsPort,
			(target) =>
				target.type === "page" &&
				target.url.includes("browser-approvals-overlay.html"),
		);
		await waitFor(
			() => card.eval("Boolean(document.documentElement)"),
			"card document after reload",
		);
		const cardPng = await card.send("Page.captureScreenshot", {
			format: "png",
		});
		const cardPath = join(dir, `card-${state.label}.png`);
		writeFileSync(cardPath, Buffer.from(cardPng.data, "base64"));
		const cardTheme = await card.eval(
			"document.documentElement.dataset.theme ?? null",
		);
		result.frames ??= [];
		result.frames.push({
			label: state.label,
			app: { path: appPath, content, theme },
			card: { path: cardPath, theme: cardTheme },
		});
		await writeFileSync(
			join(OUT, "s6c-proof.json"),
			JSON.stringify(result, null, 2),
		);
		say(
			`FRAME\t${state.label}\tcontent=${content.width}x${content.height} appTheme=${theme} cardTheme=${cardTheme}`,
		);
	}
	// The native composite is the one row a document capture cannot answer.
	// Attempt it on this run, with the card visible, and record what the OS
	// actually did rather than restating an earlier observation.
	const windowInfo = JSON.parse(
		await main.eval(`(() => {
			const { BrowserWindow } = process.mainModule.require("electron");
			const win = BrowserWindow.getAllWindows()[0];
			return JSON.stringify({ id: win.getMediaSourceId(), bounds: win.getContentBounds(), visible: win.isVisible(), focused: win.isFocused() });
		})()`),
	);
	const cgid = Number(String(windowInfo.id).split(":")[1]);
	const compositePath = join(dir, "native-composite.png");
	let composite = { pass: false, detail: {} };
	try {
		execFileSync(
			"screencapture",
			["-x", "-o", "-l", String(cgid), compositePath],
			{
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const dims = execFileSync(
			"sips",
			["-g", "pixelWidth", "-g", "pixelHeight", compositePath],
			{
				encoding: "utf8",
			},
		)
			.split("\n")
			.filter((line) => line.includes("pixel"))
			.join(" ");
		composite = {
			pass: true,
			detail: {
				command: `screencapture -x -o -l ${cgid}`,
				window: windowInfo,
				path: compositePath,
				dims,
			},
		};
		result.frames.push({
			label: "native-composite",
			path: compositePath,
			window: windowInfo,
			dims,
		});
	} catch (error) {
		composite = {
			pass: false,
			detail: {
				command: `screencapture -x -o -l ${cgid}`,
				window: windowInfo,
				observed: String(error?.stderr ?? error?.message ?? error).trim(),
			},
		};
	}
	result.rows.push(
		record(
			"F-native-composite",
			composite.pass,
			composite.detail,
			!composite.pass,
		),
	);
}

const result = {
	at: new Date().toISOString(),
	head: "",
	scratch: SCRATCH,
	rows: [],
};
try {
	devtoolsPort = await freePort(13100);
	inspectPort = await freePort(devtoolsPort + 300);
	await serveSite();
	launchApp("inactive");
	const proof = await runProof();
	result.rows = proof.rows;
	result.head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: ROOT,
		encoding: "utf8",
	}).trim();
	result.mode = "inactive";
	if (FRAMES) {
		await captureDocuments(proof);
	}
	writeFileSync(join(OUT, "s6c-proof.json"), JSON.stringify(result, null, 2));
	for (const row of result.rows) say(`${row.status}\t${row.id}`);
	say(`head ${result.head}`);
} catch (error) {
	result.error = String(error?.stack ?? error);
	writeFileSync(join(OUT, "s6c-proof.json"), JSON.stringify(result, null, 2));
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
