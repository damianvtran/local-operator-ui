#!/usr/bin/env node
/**
 * Proof rig for the browser tab's presented identity — what a third-party page
 * (and the request it sends) can read about the browser it is talking to.
 *
 * WHY IT EXISTS: Google sign-in refused the app's browser tab with "Couldn't sign
 * you in — This browser or app may not be secure", while the tab's UA string was
 * already Chrome-shaped. The UA string is only one of the surfaces such a check
 * reads: the `Sec-CH-UA*` request headers and `navigator.userAgentData` are the
 * others, and the defect was that they DISAGREED with the string (measured:
 * no client-hint headers at all, and JS brands without "Google Chrome"). A rig
 * that reads `navigator.userAgent` alone cannot see that, so this one reads the
 * whole set, on a page the rig itself serves, for each tab path the product has.
 *
 * It boots a BUILT app tree (`--app-tree`, so the same file runs against a
 * before and an after tree) on a scratch profile, and opens a URL through one of
 * the product's two real tab paths:
 *
 *   --mode agent   request_access -> the user's answer in the app's own chrome ->
 *                  await_access -> open, over the host's `/rpc`: the path a lop
 *                  session takes, which attaches the host's debugger.
 *   --mode human   window.api.browser.newTab() + navigate(): the path the address
 *                  bar takes, with no agent attachment.
 *
 * The page's own facts are reported by the page to whatever collector the URL
 * names (the operator-supplied probe server); this rig never attaches CDP to the
 * driven PAGE, because an extra debugger client is itself a variable under test.
 * It attaches only to the app's OWN renderer (to answer consent and to open the
 * browser route).
 *
 * `--experiment-cdp-ua <url>` is the measurement behind `client-hints.ts`'s
 * brand choice: it opens <url>, has an EXTRA CDP client set
 * `Emulation.setUserAgentOverride` with "Google Chrome" metadata on that page,
 * then navigates to `--url`. Measured on Electron 45.1.0: JS brands and
 * subresource headers change, document requests still carry no `Sec-CH-UA`.
 *
 * `--google <identifier>` types that identifier into Google's account chooser and
 * presses Enter — NEVER a password — and reports where the flow landed
 * (`/signin/rejected` = refused; a password/passkey/SSO step = accepted).
 *
 * Isolation is the same as `browser-challenge-proof.mjs` (scratch HOME, config,
 * log dir and --user-data-dir; CMUX_/LOP_ stripped; notifications and telemetry
 * off; runtime binary spawned detached and reaped by `app-tree-teardown.mjs`).
 *
 * Usage:
 *   node scripts/browser-identity-proof.mjs --app-tree <dir> --scratch <dir>
 *     --url <url> [--mode agent|human] [--hold-ms N] [--google <identifier>]
 *     [--then <url>] [--shot <png>] [--window-mode headless|inactive]
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import {
	onInterrupted,
	reapOnExit,
	stopAppTree,
} from "./app-tree-teardown.mjs";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ELECTRON_BIN = createRequire(import.meta.url)("electron");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, fallback = null) {
	const index = process.argv.indexOf(`--${name}`);
	return index > 0 ? process.argv[index + 1] : fallback;
}

const APP_TREE = resolve(arg("app-tree", "."));
const SCRATCH = resolve(arg("scratch") ?? "");
const URL_TO_OPEN = arg("url");
const MODE = arg("mode", "agent");
const HOLD_MS = Number(arg("hold-ms", "6000"));
const GOOGLE_ID = arg("google");
const SHOT = arg("shot");
const EXPERIMENT_UA = arg("experiment-cdp-ua");
const THEN_URL = arg("then");
const WINDOW_MODE = arg("window-mode", "headless");
if (!arg("scratch") || !URL_TO_OPEN) {
	console.error("--scratch and --url are required");
	process.exit(2);
}
const say = (line) => console.log(line);

const freePort = () =>
	new Promise((r) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => r(port));
		});
	});

let app = null;
async function launch() {
	const devtoolsPort = await freePort();
	const env = withNotificationsOff({
		...process.env,
		HOME: join(SCRATCH, "home"),
		LOCAL_OPERATOR_CONFIG_DIR: join(SCRATCH, "config"),
		LOCAL_OPERATOR_LOG_DIR: join(SCRATCH, "logs"),
		LOCAL_OPERATOR_UI_WINDOW_MODE: WINDOW_MODE,
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	mkdirSync(join(SCRATCH, "home"), { recursive: true });
	const userData = join(SCRATCH, "userdata");
	const child = spawn(
		ELECTRON_BIN,
		[
			APP_TREE,
			`--user-data-dir=${userData}`,
			`--remote-debugging-port=${devtoolsPort}`,
			"--window-size=1380x900",
			`--window-mode=${WINDOW_MODE}`,
			// HOME is redirected to a scratch dir with no login keychain: without this
			// the run raises macOS's "Keychain Not Found" prompt on the operator's
			// screen and the scratch cookie store cannot encrypt (chrome-keychain.mjs).
			MOCK_KEYCHAIN_SWITCH,
		],
		{ env, cwd: APP_TREE, detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	const log = [];
	child.stdout.on("data", (c) => log.push(c.toString()));
	child.stderr.on("data", (c) => log.push(c.toString()));
	let exited = false;
	child.on("exit", () => {
		exited = true;
	});
	reapOnExit({ pid: child.pid, userData });
	app = { child, userData, log, devtoolsPort, exited: () => exited };
	say(`[rig] launched pid=${child.pid} tree=${APP_TREE} mode=${WINDOW_MODE}`);
	return app;
}

async function stop() {
	if (!app) return;
	const stopping = app;
	app = null;
	writeFileSync(join(SCRATCH, "app.log"), stopping.log.join(""));
	const result = await stopAppTree({
		pid: stopping.child.pid,
		userData: stopping.userData,
		isExited: () => stopping.exited(),
	});
	say(
		`[rig] teardown clean=${result.clean} reaped=${result.reaped.length} survivors=${result.survivors.length}`,
	);
}
onInterrupted(stop);

async function waitFor(fn, label, ms = 60_000) {
	const started = Date.now();
	for (;;) {
		const value = await fn().catch(() => null);
		if (value) return value;
		if (Date.now() - started > ms) throw new Error(`timed out: ${label}`);
		await sleep(300);
	}
}

async function hostState() {
	const file = join(SCRATCH, "config", "run", "ui-browser", "host.json");
	return waitFor(async () => {
		if (!existsSync(file)) return null;
		const state = JSON.parse(readFileSync(file, "utf8"));
		const health = await fetch(`http://127.0.0.1:${state.port}/health`);
		return health.ok && (await health.json())?.pid === state.pid ? state : null;
	}, "the browser host's /health");
}

async function rpc(state, method, params = {}) {
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Bridge-Key": state.session_key,
		},
		body: JSON.stringify({ id: `identity-${method}`, method, params }),
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {}
	return { status: response.status, text, json };
}

const connectRenderer = () =>
	connectTarget(
		(t) =>
			t.type === "page" &&
			String(t.url).startsWith("file://") &&
			String(t.url).includes("index.html"),
		"the app renderer target",
	);

async function connectTarget(match, label) {
	const target = await waitFor(async () => {
		const list = await (
			await fetch(`http://127.0.0.1:${app.devtoolsPort}/json/list`)
		).json();
		return list.find(match);
	}, label);
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r, j) => {
		ws.addEventListener("open", r, { once: true });
		ws.addEventListener("error", j, { once: true });
	});
	let id = 0;
	const pending = new Map();
	ws.addEventListener("message", (e) => {
		const m = JSON.parse(e.data);
		const p = pending.get(m.id);
		if (!p) return;
		pending.delete(m.id);
		m.error ? p.j(new Error(m.error.message)) : p.r(m.result);
	});
	const send = (method, params = {}) =>
		new Promise((r, j) => {
			const callId = ++id;
			pending.set(callId, { r, j });
			ws.send(JSON.stringify({ id: callId, method, params }));
		});
	const evaluate = async (expression) =>
		(
			await send("Runtime.evaluate", {
				expression,
				awaitPromise: true,
				returnByValue: true,
			})
		)?.result?.value;
	return { evaluate, send, close: () => ws.close() };
}

async function openBrowserRoute(renderer) {
	await waitFor(async () => {
		const ok = await renderer.evaluate(
			`(() => { const el = document.querySelector('[data-tour-tag="nav-item-browser"]'); if (!el) return ''; el.click(); return 'y'; })()`,
		);
		if (ok !== "y") return null;
		await sleep(400);
		return String(await renderer.evaluate("location.hash")).includes(
			"/browser",
		);
	}, "the browser route");
}

async function openAgent(state, renderer, url) {
	await approve(state, renderer, url);
	const requester = "session:identity-rig";
	const opened = await rpc(state, "open", { url, requester });
	const token = opened.json?.result?.tab ?? null;
	say(`[rig] open status=${opened.status} token=${Boolean(token)}`);
	if (!token) say(`[rig] open reply ${opened.text.slice(0, 400)}`);
	return token;
}

/** The per-origin gate, answered the way the user answers it (the app's chrome). */
async function approve(state, renderer, url) {
	const origin = new URL(url).origin;
	const requester = "session:identity-rig";
	const asked = await rpc(state, "request_access", { url: origin, requester });
	if (asked.json?.result?.state !== "allowed") {
		const entry = await waitFor(async () => {
			const pending = JSON.parse(
				(await renderer.evaluate(
					"window.api.browser.state().then((s) => JSON.stringify(s.pendingConsent))",
				)) ?? "[]",
			);
			return pending.find((p) => p.origin === origin);
		}, `a pending consent for ${origin}`);
		await renderer.evaluate(
			`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, "site").then(() => "ok")`,
		);
	}
	await rpc(state, "await_access", { url: origin, requester });
}

async function main() {
	await launch();
	const state = await hostState();
	const renderer = await connectRenderer();
	await openBrowserRoute(renderer);
	let token = null;
	if (MODE === "human") {
		await renderer.evaluate("window.api.browser.newTab().then(() => 'ok')");
		await sleep(800);
		const r = await renderer.evaluate(
			`window.api.browser.navigate(${JSON.stringify(URL_TO_OPEN)}).then(() => 'ok', (e) => 'err:' + e.message)`,
		);
		say(`[rig] human navigate -> ${r}`);
	} else {
		token = await openAgent(
			state,
			renderer,
			EXPERIMENT_UA ? EXPERIMENT_UA : URL_TO_OPEN,
		);
	}
	if (EXPERIMENT_UA && token) {
		// EXPERIMENT ONLY: an external CDP client sets UA + metadata on the page
		// target, then the product navigates — measures which surfaces the CDP
		// override reaches in this runtime.
		const page = await connectTarget(
			(t) => t.type === "page" && String(t.url).startsWith(EXPERIMENT_UA),
			"the driven page target",
		);
		const ua = await page.evaluate("navigator.userAgent");
		// The runtime's own Chromium build, read from the page before the override.
		const full = await page.evaluate(
			`navigator.userAgentData.getHighEntropyValues(["fullVersionList"]).then((v) => v.fullVersionList.find((b) => b.brand === "Chromium").version)`,
		);
		const major = full.split(".")[0];
		const r = await page.send("Emulation.setUserAgentOverride", {
			userAgent: ua,
			userAgentMetadata: {
				brands: [
					{ brand: "Not:A-Brand", version: "8" },
					{ brand: "Chromium", version: major },
					{ brand: "Google Chrome", version: major },
				],
				fullVersionList: [
					{ brand: "Not:A-Brand", version: "8.0.0.0" },
					{ brand: "Chromium", version: full },
					{ brand: "Google Chrome", version: full },
				],
				fullVersion: full,
				platform: "macOS",
				platformVersion: "27.2.0",
				architecture: "arm",
				model: "",
				mobile: false,
				bitness: "64",
				wow64: false,
				formFactors: ["Desktop"],
			},
		});
		say(`[rig] experiment override -> ${JSON.stringify(r)}`);
		const g = await rpc(state, "goto", { tab: token, url: URL_TO_OPEN });
		say(`[rig] goto status=${g.status}`);
	}
	await sleep(HOLD_MS);
	if (THEN_URL && token) {
		// A second document in the same tab: what it carries depends on what the
		// first one's responses opted in (or failed to).
		await approve(state, renderer, THEN_URL);
		const g = await rpc(state, "goto", { tab: token, url: THEN_URL });
		say(`[rig] then goto ${g.text.slice(0, 160)}`);
		await sleep(HOLD_MS);
	}
	if (GOOGLE_ID && token) {
		// Accounts.google.com's identifier field; the identifier only, never a secret.
		const typed = await rpc(state, "type", {
			tab: token,
			selector: "#identifierId",
			text: GOOGLE_ID,
		});
		say(`[rig] google type status=${typed.status} ${typed.text.slice(0, 160)}`);
		const pressed = await rpc(state, "press", { tab: token, key: "Enter" });
		say(`[rig] google press status=${pressed.status}`);
		await sleep(9000);
	}
	if (token) {
		const status = await rpc(state, "status", { tab: token });
		const surfaces = status.json?.result?.surfaces ?? [];
		// The open reply's token is the surface handle; a restored/blank human tab
		// may sit beside it, so match rather than take the first.
		const result =
			surfaces.find((s) => s.tab === token) ??
			surfaces.find((s) => s.url && s.url !== "about:blank") ??
			{};
		say(
			`[rig] surfaces ${JSON.stringify(surfaces.map((s) => [String(s.tab).slice(0, 8), s.url]))}`,
		);
		say(
			`RESULT url=${JSON.stringify(result.url ?? null)} title=${JSON.stringify(result.title ?? null)}`,
		);
		if (GOOGLE_ID) {
			const text = await rpc(state, "read", { tab: token });
			const body = String(
				text.json?.result?.text ?? text.json?.result?.content ?? text.text,
			);
			say(`RESULT text=${JSON.stringify(body.slice(0, 500))}`);
		}
		if (SHOT) {
			const shot = await rpc(state, "screenshot", { tab: token });
			const data = shot.json?.result?.data ?? shot.json?.result?.png ?? null;
			if (data) {
				writeFileSync(SHOT, Buffer.from(data, "base64"));
				say(`[rig] shot ${SHOT}`);
			} else say(`[rig] shot failed ${shot.text.slice(0, 200)}`);
		}
	}
	renderer.close();
}

main()
	.catch((error) => {
		say(`[rig] FAILED ${error?.stack ?? error}`);
		process.exitCode = 1;
	})
	.finally(stop);
