#!/usr/bin/env node
/**
 * Browser tab menu vs a REAL running turn.
 *
 * The tab-actions menu used to be a modal Radix menu: it `aria-hidden` every
 * sibling and set `pointer-events: none` on the body, so a running turn was
 * neither readable nor stoppable until the menu was dismissed. This proof
 * starts a genuine `[bash:45]` turn against an isolated backend, opens that
 * menu, and measures the real app: the backend's own `streaming` flag, the
 * transcript's exposure, the body's pointer-events, one real press on the
 * actual Stop control, and the Escape path.
 *
 * Environment (the same recipe as `scripts/interrupt-esc-proof.mjs`):
 *
 *   1. an isolated backend with the mock provider, its own config dir and a
 *      bearer this run is given (`LO_PROOF_TOKEN`), listening at
 *      `LO_PROOF_BACKEND`;
 *   2. the worktree's `.env` must name that backend and the app must be rebuilt
 *      (`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port>` in `.env`, then
 *      `pnpm build`); main dotenv-loads `.env` with `override: true`, so a
 *      launch-only environment variable does NOT move it;
 *   3. `LO_PROOF_TOKEN=<bearer> LO_PROOF_BACKEND=http://127.0.0.1:<port> \
 *        node scripts/browser-tab-menu-turn-proof.mjs <out-dir>`
 *
 * `LO_PROOF_SESSION` reuses an existing session; `LO_PROOF_CDP_PORT` pins the
 * devtools port. `LO_PROOF_WIDTH`/`LO_PROOF_HEIGHT` (CSS px, default 1380x900)
 * and `LO_PROOF_THEME` (`dark`, `light`, or a theme id, default
 * `localOperatorDark`) run the same scene for the design matrix; the theme is
 * seeded into the profile's `ui-preferences-storage` before the boot, not
 * switched after first paint. The app is launched `--window-mode=headless`,
 * never shown, and the whole process group is reaped by its exact pid.
 *
 * This is a real turn, not a stand-in: the backend's `streaming` read is the
 * claim, and the turn stops in under a second only because it was interrupted
 * (the mock provider's `[bash:45]` runs the real bash tool with `sleep 45`).
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const OUT = process.argv[2] ?? join("/tmp", "lo-browser-tab-menu-turn");
const BACKEND = process.env.LO_PROOF_BACKEND ?? "http://127.0.0.1:1131";
const TOKEN = process.env.LO_PROOF_TOKEN ?? "";
const SLEEP_SECONDS = 45;
/* The design matrix runs this same proof at the app's own width and at the
 * narrow desktop width, in either theme. Widths are CSS px, as the real window. */
const WIDTH = Number(process.env.LO_PROOF_WIDTH ?? 1380);
const HEIGHT = Number(process.env.LO_PROOF_HEIGHT ?? 900);
const THEME = process.env.LO_PROOF_THEME ?? "localOperatorDark";
const THEME_ID =
	THEME === "dark"
		? "localOperatorDark"
		: THEME === "light"
			? "localOperatorLight"
			: THEME;

if (!TOKEN) {
	console.error(
		"LO_PROOF_TOKEN is unset: the app and this proof share the isolated backend's bearer; without it every session control answers 503, which reads exactly like an interrupt that did nothing.",
	);
	process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const report = {
	backend: BACKEND,
	out: OUT,
	viewport: { width: WIDTH, height: HEIGHT },
	theme: THEME_ID,
	steps: [],
};
const record = (step, value) => {
	report.steps.push({ step, ...value });
	console.log(`${step}: ${JSON.stringify(value)}`);
};
const claims = [];
const verify = (step, hold, detail) => {
	record(step, { ok: hold === true, ...detail });
	if (hold !== true) claims.push({ step, ...detail });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, body) => {
	const response = await fetch(`${BACKEND}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return {
		status: response.status,
		body: await response.json().catch(() => null),
	};
};
const uuid = () => crypto.randomUUID();
const result = (envelope) => envelope?.body?.result ?? null;
const sessionState = async (sessionId) => {
	const snapshot = result(
		await api("GET", `/v1/desktop/sessions/${sessionId}`),
	);
	return snapshot?.payload?.frontend?.snapshot ?? null;
};
const startTurn = async (sessionId, text) => {
	/*
	 * THE OWNER HANDSHAKE IS ASYNCHRONOUS. The app's `/watch` stream establishes
	 * the session owner; a message posted in the first moments after navigation
	 * can answer 503 `runtime_unreachable` ("Session owner is unavailable") even
	 * though the app is healthy - measured on the second run of this proof. Retry
	 * that typed refusal for a bounded window; every other status is returned
	 * immediately.
	 */
	let last = null;
	for (let waited = 0; waited <= 20_000; waited += 500) {
		last = await api("POST", `/v1/desktop/sessions/${sessionId}/messages`, {
			request_id: uuid(),
			text,
			mode: "prompt",
		});
		if (last.status !== 503) return last;
		await sleep(500);
	}
	return last;
};
const waitForStreaming = async (sessionId, wanted, budgetMs = 30_000) => {
	const until = Date.now() + budgetMs;
	while (Date.now() < until) {
		const state = await sessionState(sessionId);
		if (state?.streaming === wanted) return state.streaming;
		await sleep(250);
	}
	return !wanted;
};

/* ---------------------------------------------------------------- the app */

const HOME_DIR = join(OUT, "home");
const CONFIG_DIR = join(OUT, "config");
const USER_DATA = join(OUT, "user-data");
const LOG_DIR = join(OUT, "logs");
for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA, LOG_DIR])
	rmSync(dir, { recursive: true, force: true });
for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR])
	mkdirSync(dir, { recursive: true });

const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete childEnv[key];
}
const freePort = async () => {
	const { createServer } = await import("node:net");
	for (;;) {
		const port = 9500 + Math.floor(Math.random() * 400);
		const free = await new Promise((resolve) => {
			const probe = createServer();
			probe.on("error", () => resolve(false));
			probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
		});
		if (free) return port;
	}
};
const port = Number(process.env.LO_PROOF_CDP_PORT) || (await freePort());
const spawnEnv = withNotificationsOff({
	...childEnv,
	HOME: HOME_DIR,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	VITE_DISABLE_BACKEND_MANAGER: "true",
	VITE_LOCAL_OPERATOR_API_URL: BACKEND,
	LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
});
withTelemetryOff(spawnEnv);

const app = spawn(
	"./node_modules/.bin/electron",
	[
		".",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${USER_DATA}`,
		`--window-size=${WIDTH}x${HEIGHT}`,
		"--window-mode=headless",
	],
	{
		env: spawnEnv,
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	},
);
const appLog = [];
app.stdout.on("data", (d) => appLog.push(`${d}`));
app.stderr.on("data", (d) => appLog.push(`${d}`));
const reap = async () => {
	if (app.exitCode !== null) return;
	try {
		process.kill(-app.pid, "SIGTERM");
	} catch {
		try {
			app.kill("SIGTERM");
		} catch {}
	}
	await Promise.race([new Promise((r) => app.once("exit", r)), sleep(4000)]);
	try {
		process.kill(-app.pid, "SIGKILL");
	} catch {}
	writeFileSync(join(OUT, "app.log"), appLog.join(""));
};

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== undefined && this.pending.has(message.id)) {
				const { resolve, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				message.error
					? reject(new Error(message.error.message))
					: resolve(message.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}
	async evaluate(expression) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(
				result.exceptionDetails.exception?.description ??
					result.exceptionDetails.text ??
					"the expression threw",
			);
		return result.result?.value;
	}
	async shot(name) {
		const shot = await this.send("Page.captureScreenshot", { format: "png" });
		const path = join(OUT, `${name}.png`);
		writeFileSync(path, Buffer.from(shot.data, "base64"));
		console.log(`frame: ${path}`);
		return path;
	}
}

const connect = async () => {
	const until = Date.now() + 60_000;
	while (Date.now() < until) {
		const list = await fetch(`http://127.0.0.1:${port}/json/list`)
			.then((r) => r.json())
			.catch(() => []);
		const target = list.find(
			(t) =>
				t.type === "page" &&
				typeof t.url === "string" &&
				t.url.startsWith("file://") &&
				t.url.includes("index.html"),
		);
		if (target?.webSocketDebuggerUrl) {
			const ws = new WebSocket(target.webSocketDebuggerUrl);
			await new Promise((resolve, reject) => {
				ws.addEventListener("open", resolve, { once: true });
				ws.addEventListener("error", reject, { once: true });
			});
			return new Cdp(ws);
		}
		await sleep(250);
	}
	throw new Error("the app renderer never appeared on the debugging port");
};

const waitFor = async (cdp, expression, label, budgetMs = 30_000) => {
	const until = Date.now() + budgetMs;
	while (Date.now() < until) {
		const value = await cdp.evaluate(expression).catch(() => null);
		if (value) return value;
		await sleep(150);
	}
	throw new Error(`timed out: ${label}`);
};

const press = async (cdp, selector) => {
	const box = await cdp.evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		if (r.width < 1 || r.height < 1) return null;
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	})()`);
	if (!box) throw new Error(`no pressable element for ${selector}`);
	for (const type of ["mousePressed", "mouseReleased"])
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: box.x,
			y: box.y,
			button: "left",
			clickCount: 1,
		});
	return box;
};

const pressEscape = async (cdp) => {
	for (const type of ["rawKeyDown", "keyUp"])
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 53,
		});
};

const menuOpen = () =>
	`!!document.querySelector('[data-tour-tag="browser-tab-actions"]')`;
const stopSelector = '[aria-label="Stop"]';

let cdp = null;
let sessionId = null;

try {
	cdp = await connect();
	await waitFor(
		cdp,
		"typeof window.api?.browser?.state === 'function' ? 'ready' : ''",
		"the preload",
	);
	await cdp.evaluate(`(() => {
		localStorage.setItem('onboarding-storage', JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: null }, version: 0,
		}));
		// The store's own persisted key and field; seeding it makes the app BOOT
		// into the theme rather than switching after the first paint.
		const key = 'ui-preferences-storage';
		const raw = localStorage.getItem(key);
		const parsed = raw === null ? { state: {}, version: 2 } : JSON.parse(raw);
		parsed.state = { ...(parsed.state ?? {}), themeName: ${JSON.stringify(THEME_ID)} };
		localStorage.setItem(key, JSON.stringify(parsed));
		return { theme: ${JSON.stringify(THEME_ID)}, viewport: { w: innerWidth, h: innerHeight } };
	})()`);
	await cdp.send("Page.reload", {});
	await sleep(1500);
	await waitFor(
		cdp,
		"typeof window.api?.browser?.state === 'function' ? 'ready' : ''",
		"the preload after reload",
	);

	sessionId =
		process.env.LO_PROOF_SESSION ??
		result(
			await api("POST", "/v1/desktop/sessions", {
				request_id: uuid(),
				cwd: OUT,
			}),
		)?.session_id;
	if (!sessionId) throw new Error("no session could be created");
	record("session", {
		id: sessionId,
		backendStatus: (await api("GET", `/v1/desktop/sessions/${sessionId}`))
			.status,
	});

	await cdp.evaluate(`location.hash = "#/chat/${sessionId}"; true`);
	await waitFor(
		cdp,
		"document.querySelector('[data-tour-tag=\"chat-column\"]') ? 'ready' : ''",
		"the chat",
		45_000,
	);
	await sleep(800);

	// The conversation's own browser pane, opened the user's way.
	await waitFor(
		cdp,
		"document.querySelector('[data-tour-tag=\"browser-pane-trigger\"]') ? 'ready' : ''",
		"the panel rail",
	);
	await press(cdp, '[data-tour-tag="browser-pane-trigger"]');
	await waitFor(
		cdp,
		"document.querySelector('[data-tour-tag=\"browser-pane-surface\"]') ? 'ready' : ''",
		"the browser pane",
	);
	const newTab =
		(await cdp.evaluate(
			"document.querySelector('[data-tour-tag=\"browser-new-tab\"]') ? 'strip' : (document.querySelector('[data-tour-tag=\"browser-surface-new-tab\"]') ? 'empty' : '')",
		)) || "";
	if (newTab === "strip") await press(cdp, '[data-tour-tag="browser-new-tab"]');
	else if (newTab === "empty")
		await press(cdp, '[data-tour-tag="browser-surface-new-tab"]');
	await waitFor(
		cdp,
		"document.querySelector('[data-tour-tag=\"browser-tab-menu\"]') ? 'ready' : ''",
		"a tab row",
		45_000,
	);

	/* ------------------------------------------------ 1. a real running turn */
	record("turn1.admit", {
		status: (await startTurn(sessionId, `rig turn [bash:${SLEEP_SECONDS}]`))
			.status,
	});
	verify(
		"turn1.streaming",
		(await waitForStreaming(sessionId, true)) === true,
		{ what: "the backend must report a live turn before the menu is opened" },
	);
	await waitFor(
		cdp,
		`document.querySelector(${JSON.stringify(stopSelector)}) ? 'ready' : ''`,
		"the Stop control",
		45_000,
	);
	await sleep(400);

	// Approve the mock provider's bash ask so the turn is EXECUTING `[bash:45]`
	// when the menu is opened, not merely parked at the approval gate. The option
	// is the client's own `button[data-ask-option]`; its label is checked rather
	// than assuming ordinal 1.
	const ask = await cdp.evaluate(`(() => {
		const button = document.querySelector('button[data-ask-option]');
		if (!button) return null;
		const r = button.getBoundingClientRect();
		return { label: (button.textContent || '').trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 };
	})()`);
	record("turn1.ask", ask ?? { present: false });
	if (ask && /approve/i.test(ask.label)) {
		for (const type of ["mousePressed", "mouseReleased"])
			await cdp.send("Input.dispatchMouseEvent", {
				type,
				x: ask.x,
				y: ask.y,
				button: "left",
				clickCount: 1,
			});
		await sleep(1200);
	}
	verify(
		"turn1.executing",
		(await sessionState(sessionId))?.streaming === true,
		{ what: "the turn must still be live after the approval" },
	);

	// Open the tab-actions menu with a real pointer press on the tab's own control.
	await press(cdp, '[data-tour-tag="browser-tab-menu"]');
	await waitFor(cdp, menuOpen(), "the tab-actions menu");
	await sleep(400);

	const exposed = await cdp.evaluate(`(() => {
		const menu = document.querySelector('[data-tour-tag="browser-tab-actions"]');
		const stop = document.querySelector(${JSON.stringify(stopSelector)});
		const transcript = document.querySelector('[data-tour-tag="chat-column"]');
		const r = stop ? stop.getBoundingClientRect() : null;
		const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
		const boxOf = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
		};
		return {
			window: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
			menu: !!menu,
			menuBox: boxOf(menu),
			stopBox: boxOf(stop),
			bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
			stopPresent: !!stop,
			stopHidden: stop ? !!stop.closest('[aria-hidden="true"]') : null,
			stopHit: hit ? (hit === stop || stop.contains(hit)) : null,
			stopPointerEvents: stop ? getComputedStyle(stop).pointerEvents : null,
			transcriptPresent: !!transcript,
			transcriptHidden: transcript ? !!transcript.closest('[aria-hidden="true"]') : null,
			transcriptBox: transcript ? { w: Math.round(transcript.getBoundingClientRect().width), h: Math.round(transcript.getBoundingClientRect().height) } : null,
			streaming: null,
		};
	})()`);
	exposed.streaming = await sessionState(sessionId);
	record("menu.exposure", exposed);
	verify("menu.body-pointer-events", exposed.bodyPointerEvents !== "none", {
		bodyPointerEvents: exposed.bodyPointerEvents,
	});
	verify(
		"menu.transcript-visible",
		exposed.transcriptPresent === true &&
			exposed.transcriptHidden === false &&
			(exposed.transcriptBox?.w ?? 0) > 0 &&
			(exposed.transcriptBox?.h ?? 0) > 0,
		{
			transcript: {
				present: exposed.transcriptPresent,
				hidden: exposed.transcriptHidden,
				box: exposed.transcriptBox,
			},
		},
	);
	verify(
		"menu.stop-exposed",
		exposed.stopPresent === true &&
			exposed.stopHidden === false &&
			exposed.stopHit === true &&
			exposed.stopPointerEvents !== "none",
		{
			stop: {
				present: exposed.stopPresent,
				hidden: exposed.stopHidden,
				hit: exposed.stopHit,
				pointerEvents: exposed.stopPointerEvents,
			},
		},
	);
	verify("menu.turn-streaming", exposed.streaming?.streaming === true, {
		streaming: exposed.streaming?.streaming,
	});
	await cdp.shot("turn-running-menu-open");

	// ONE REAL PRESS ON THE ACTUAL STOP CONTROL. The menu is open above it; the
	// press must both dismiss the menu and interrupt the turn.
	await press(cdp, stopSelector);
	const stopped = await waitForStreaming(sessionId, false);
	await sleep(400);
	const afterStop = await cdp.evaluate(`({
		menuOpen: ${menuOpen()},
		stopPresent: !!document.querySelector(${JSON.stringify(stopSelector)}),
	})`);
	const alive = await api("GET", `/v1/desktop/sessions/${sessionId}`);
	record("stop.pressed", { stopped, afterStop, sessionStatus: alive.status });
	verify(
		"stop.press-stops-turn-and-dismisses-menu",
		stopped === false && afterStop.menuOpen === false,
		{ streaming: stopped, menuOpen: afterStop.menuOpen },
	);
	verify("stop.session-alive", alive.status === 200, { status: alive.status });
	await cdp.shot("after-stop-press");

	/* ------------------------------------------------ 2. the Escape path */
	record("turn2.admit", {
		status: (await startTurn(sessionId, `rig turn [bash:${SLEEP_SECONDS}]`))
			.status,
	});
	verify(
		"turn2.streaming",
		(await waitForStreaming(sessionId, true)) === true,
		{ what: "the second turn must be live before Escape is sent" },
	);
	await waitFor(
		cdp,
		`document.querySelector(${JSON.stringify(stopSelector)}) ? 'ready' : ''`,
		"the second Stop control",
		45_000,
	);
	await press(cdp, '[data-tour-tag="browser-tab-menu"]');
	await waitFor(cdp, menuOpen(), "the second tab-actions menu");
	await pressEscape(cdp);
	await sleep(500);
	const escapeResult = await cdp.evaluate(`({
		menuOpen: ${menuOpen()},
		stopPresent: !!document.querySelector(${JSON.stringify(stopSelector)}),
	})`);
	const stillStreaming = await waitForStreaming(sessionId, true, 4000);
	record("escape", { ...escapeResult, streaming: stillStreaming });
	verify(
		"escape.closes-menu-without-stopping-turn",
		escapeResult.menuOpen === false && stillStreaming === true,
		{ menuOpen: escapeResult.menuOpen, streaming: stillStreaming },
	);
	await cdp.shot("escape-closes-menu");

	// Clean up the second turn through the menu-closed Stop control.
	await press(cdp, stopSelector);
	verify(
		"turn2.stopped",
		(await waitForStreaming(sessionId, false)) === false,
		{ what: "the rig's second turn must not outlive the run" },
	);
} catch (error) {
	record("abort", { error: String(error?.stack ?? error) });
	claims.push({ step: "abort", error: String(error?.stack ?? error) });
} finally {
	if (sessionId) {
		const state = await sessionState(sessionId).catch(() => null);
		if (state?.streaming) {
			await api("POST", `/v1/desktop/sessions/${sessionId}/interrupt`, {
				request_id: uuid(),
			}).catch(() => {});
		}
	}
	await reap();
	const headless = appLog.join("").includes("headless");
	verify("window.headless", headless, {
		what: "the run's own [window-mode] line must name headless",
	});
	writeFileSync(
		join(OUT, "browser-tab-menu-turn-proof.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(`report: ${join(OUT, "browser-tab-menu-turn-proof.json")}`);
	if (claims.length > 0) {
		console.error(
			`FAILED ${claims.length} claim(s): ${JSON.stringify(claims)}`,
		);
		process.exit(1);
	}
	console.log(`PASS: ${report.steps.length} steps against a real turn`);
}
