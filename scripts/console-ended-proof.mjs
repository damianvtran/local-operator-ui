#!/usr/bin/env node
/**
 * The ended-console instrument: what an exited surface looks like, and what the
 * console door does when nothing is live.
 *
 * WHY THIS IS A SEPARATE RIG AND NOT A SCENE IN `console-host-proof.mjs`. That
 * harness is a 82-cell contract suite for the host; this is a SHORT, re-runnable
 * before/after instrument for one operator report (2026-10-21): an exited console
 * still looked alive (a prompt-shaped caret, a lit rail item, an unseen mark), and
 * opening the console with nothing live landed on dead history instead of a shell.
 * The report is about a handful of observable states, and the same bytes have to
 * run against the base commit and the fix, so the rig RECORDS readings rather than
 * asserting one version's answer.
 *
 * WHAT IT DRIVES. The BUILT app in the documented `headless` window mode, on a
 * scratch HOME/config/profile, paired with a REAL `lop serve` daemon this run
 * starts and owns on its own port. The conversation is seeded the same way
 * `console-host-proof.mjs` seeds one (its own daemon plus the app's persisted
 * session store), and every console operation goes through the app's own bridge.
 * The pixels are the app's own `Page.captureScreenshot`; no window is shown, no
 * `screencapture` runs, and the app's process group is killed by exact pid on the
 * way out.
 *
 * Usage:
 *   node scripts/console-ended-proof.mjs --pair 47391 --out docs/evidence/console-ended-state
 *   node scripts/console-ended-proof.mjs --keep          # keep the scratch tree
 *
 * The tree must be BUILT for the same address:
 *   VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:47391 pnpm build
 */

import { execFileSync, spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const argv = process.argv.slice(2);
const argValue = (flag) => {
	const index = argv.indexOf(flag);
	return index === -1 ? undefined : argv[index + 1];
};
const KEEP = argv.includes("--keep");
const PAIR_PORT = Number(argValue("--pair") ?? "47391");
if (!Number.isInteger(PAIR_PORT) || PAIR_PORT === 1111) {
	throw new Error(
		`--pair must be a port other than 1111 (the operator's own daemon), got ${argValue("--pair")}`,
	);
}
const OUT_DIR = argValue("--out");
if (!OUT_DIR) throw new Error("--out <dir> is required");
mkdirSync(OUT_DIR, { recursive: true });

const ROOT = process.cwd();
const SCRATCH = join(tmpdir(), `lo-console-ended-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const LOG_DIR = join(SCRATCH, "logs");
for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA, LOG_DIR]) {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One `ps` row: pid, then the command line. Module scope so the scan does not
 * recompile it per line (the rule every sibling rig follows). */
const PS_ROW = /^\s*(\d+)\s+(.*)$/;

/** The app's own document, never the capture view's (`console-capture`). */
const APP_DOCUMENT = (url) => {
	try {
		const path = new URL(url).pathname;
		return path.endsWith("/index.html") && !path.includes("console-capture");
	} catch {
		return false;
	}
};

/** The environment every child of this run gets: scratch roots, no telemetry, no
 * inherited cmux/lop identity, no banner. */
function isolatedEnv(extra = {}) {
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		VITE_DISABLE_BACKEND_MANAGER: "true",
		VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PAIR_PORT}`,
		...extra,
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	return env;
}

/* --------------------------------------------------------------- the daemon */

let daemon = null;
async function startDaemon() {
	writeFileSync(
		join(CONFIG_DIR, "config.yml"),
		"values:\n  hosting: test\n  model_name: mock-model\n",
	);
	const env = isolatedEnv();
	const child = spawn(
		"lop",
		[
			"serve",
			"--host",
			"127.0.0.1",
			"--port",
			String(PAIR_PORT),
			"--hosting",
			"test",
			"--model",
			"mock-model",
		],
		{
			env,
			cwd: ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		},
	);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const record = join(CONFIG_DIR, "run", "serve", `${child.pid}.json`);
	const started = Date.now();
	while (!existsSync(record) && Date.now() - started < 60_000) await sleep(200);
	if (!existsSync(record)) {
		throw new Error(
			`the paired daemon wrote no serve record in 60 s\n${stream.join("").slice(-2000)}`,
		);
	}
	daemon = { child };
}

async function stopDaemon() {
	if (!daemon) return;
	const stopping = daemon;
	daemon = null;
	await new Promise((resolve) => {
		const killTree = (signal) => {
			try {
				process.kill(-stopping.child.pid, signal);
			} catch {
				try {
					stopping.child.kill(signal);
				} catch {
					/* already dead */
				}
			}
		};
		stopping.child.once("exit", resolve);
		killTree("SIGTERM");
		setTimeout(() => {
			killTree("SIGKILL");
			resolve();
		}, 5000);
	});
}

function seedConversation() {
	const seeded = execFileSync(
		process.execPath,
		["scripts/seed-paging-session.mjs", CONFIG_DIR, "4", "console ended"],
		{ cwd: ROOT, env: { ...process.env, HOME: HOME_DIR }, encoding: "utf8" },
	);
	return JSON.parse(seeded).sessionId;
}

/* ------------------------------------------------------------------- the app */

const DEVTOOLS_PORT = 9500 + (process.pid % 300);
let app = null;

async function launchApp(sessionId) {
	const env = isolatedEnv();
	const child = spawn(
		electronPath,
		[
			".",
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${DEVTOOLS_PORT}`,
			"--window-mode=headless",
			`--open-session=${sessionId}`,
		],
		{
			env,
			cwd: ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		},
	);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	app = { child, stream };
	return app;
}

async function stopApp() {
	if (!app) return;
	const stopping = app;
	app = null;
	await new Promise((resolve) => {
		const killTree = (signal) => {
			try {
				process.kill(-stopping.child.pid, signal);
			} catch {
				try {
					stopping.child.kill(signal);
				} catch {
					/* already dead */
				}
			}
		};
		stopping.child.once("exit", resolve);
		killTree("SIGTERM");
		setTimeout(() => {
			killTree("SIGKILL");
			resolve();
		}, 5000);
	});
}

/** Any spawn-helper this run's scratch profile left behind, by exact pid. */
function reapSpawnHelpers() {
	let out = "";
	try {
		out = execFileSync("ps", ["-ax", "-o", "pid=,command="], {
			encoding: "utf8",
		});
	} catch {
		return 0;
	}
	let reaped = 0;
	for (const line of out.split("\n")) {
		const match = PS_ROW.exec(line);
		if (!match) continue;
		if (!match[2].includes("spawn-helper")) continue;
		if (!match[2].includes(SCRATCH)) continue;
		try {
			process.kill(Number(match[1]), "SIGKILL");
			reaped += 1;
		} catch {
			/* gone */
		}
	}
	return reaped;
}

/* --------------------------------------------------------------------- CDP */

let cdp = null;

async function findPage(timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)
			).json();
			const page = list.find(
				(target) => target.type === "page" && APP_DOCUMENT(target.url),
			);
			if (page) return page;
		} catch {
			/* the port is not up yet */
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error("no renderer target on the debugging port");
		}
		await sleep(200);
	}
}

async function openCdp() {
	const page = await findPage();
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let nextId = 1;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (!message.id) return;
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.error) entry.reject(new Error(message.error.message));
		else entry.resolve(message.result);
	});
	const call = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	cdp = { call, close: () => socket.close() };
}

/** One `Runtime.evaluate`, with a thrown renderer error surfaced rather than
 * returned as `undefined`. */
async function evaluate(expression) {
	const result = await cdp.call("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result?.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text ??
				"the renderer threw",
		);
	}
	return result?.result?.value;
}

async function waitFor(expression, timeoutMs = 30_000, label = expression) {
	const started = Date.now();
	for (;;) {
		const value = await evaluate(expression).catch(() => null);
		if (value) return value;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timed out waiting for: ${label}`);
		}
		await sleep(200);
	}
}

const pressDom = (selector) =>
	evaluate(
		`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
	);

/** The app's own persisted store, seeded and reloaded the way a returning profile
 * carries a conversation; the onboarding modal is marked complete because it is a
 * modal and would sit in front of every frame. */
async function mountConversation(sessionId) {
	await cdp.call("Page.enable", {});
	await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
		source: `try {
			window.localStorage.setItem("canonical-sessions-storage", ${JSON.stringify(
				JSON.stringify({
					state: { activeSessionId: sessionId, activeDraftKey: null },
					version: 0,
				}),
			)});
			window.localStorage.setItem("onboarding-storage", ${JSON.stringify(
				JSON.stringify({
					state: {
						isModalComplete: true,
						isTourComplete: true,
						currentStep: "create_agent",
					},
					version: 0,
				}),
			)});
		} catch (error) {}`,
	});
	await cdp.call("Page.reload", { ignoreCache: false });
	await waitFor(
		`Boolean(document.querySelector('[data-tour-tag="console-pane-trigger"]'))`,
		60_000,
		"the console rail item after the reload",
	);
}

/** The surface rows this conversation owns, through the app's bridge. */
const consoleState = (sessionId) =>
	evaluate(
		`(async () => { const s = await window.api.console.state(${JSON.stringify(sessionId)}); return s; })()`,
	);

async function waitForLive(sessionId, running, timeoutMs = 30_000) {
	const started = Date.now();
	for (;;) {
		const state = await consoleState(sessionId);
		const rows = Array.isArray(state?.surfaces) ? state.surfaces : [];
		if (rows.length > 0 && rows.every((row) => row.running === running)) {
			return rows;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`surfaces did not settle at running=${running}: ${JSON.stringify(rows)}`,
			);
		}
		await sleep(200);
	}
}

/* ------------------------------------------------------------------ reading */

/** Everything this report reads off one frame, as values rather than a picture. */
const READ = `(() => {
	const text = (selector) => {
		const el = document.querySelector(selector);
		return el ? (el.innerText || el.textContent || "").trim() : null;
	};
	const rail = document.querySelector('[data-tour-tag="console-pane-trigger"]');
	const cursorCells = [...document.querySelectorAll(".xterm-cursor")].map((el) => {
		const rect = el.getBoundingClientRect();
		const style = getComputedStyle(el);
		return {
			rect: {
				x: Math.round(rect.x),
				y: Math.round(rect.y),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			},
			background: style.backgroundColor,
			visibility: style.visibility,
			display: style.display,
			opacity: style.opacity,
			text: el.textContent,
		};
	});
	const cursor = document.querySelector(".xterm-cursor");
	const cursorStyle = cursor ? getComputedStyle(cursor) : null;
	const box = document.querySelector("[data-console-box]");
	const boxRect = box ? box.getBoundingClientRect() : null;
	const boxStyle = box ? getComputedStyle(box) : null;
	const markerEl = document.querySelector('[data-tour-tag="console-history-end"]');
	const markerRect = markerEl ? markerEl.getBoundingClientRect() : null;
	const active = document.activeElement;
	const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
		text: (tab.innerText || "").trim(),
		selected: tab.getAttribute("aria-selected"),
		surface: tab.closest("[data-surface]")?.getAttribute("data-surface") ?? null,
	}));
	const pane = document.querySelector('[data-tour-tag="console-pane"]');
	return {
		hash: location.hash,
		paneOpen: Boolean(pane),
		mirror: Boolean(document.querySelector('[data-tour-tag="console-mirror"]')),
		banner: text('[data-tour-tag="console-ended"]'),
		marker: text('[data-tour-tag="console-history-end"]'),
		announce: text('[data-tour-tag="console-history-announce"]'),
		cursorCells,
		historyBox: boxRect
			? {
					x: Math.round(boxRect.x),
					y: Math.round(boxRect.y),
					width: Math.round(boxRect.width),
					height: Math.round(boxRect.height),
					outlineWidth: boxStyle.outlineWidth,
					outlineStyle: boxStyle.outlineStyle,
					outlineColor: boxStyle.outlineColor,
				}
			: null,
		markerTop: markerRect ? Math.round(markerRect.y) : null,
		markerHeight: markerRect ? Math.round(markerRect.height) : null,
		startCue: text('[data-tour-tag="console-starting"]'),
		announceSeq: document
			.querySelector('[data-tour-tag="console-history-announce"]')
			?.getAttribute("data-announce-seq") ?? null,
		caret: cursor
			? {
					text: cursor.textContent,
					color: cursorStyle.color,
					background: cursorStyle.backgroundColor,
					blink: cursor.classList.contains("xterm-cursor-blink"),
					block: cursor.classList.contains("xterm-cursor-block"),
				}
			: null,
		/* The terminal's resolved default ink: the ended state dims it one role step
		   (ink -> ink-muted) rather than applying opacity, so the value is readable. */
		screenColor: (() => {
			const screen = document.querySelector(".xterm");
			return screen ? getComputedStyle(screen).color : null;
		})(),
		textareaReadOnly:
			document.querySelector(".xterm-helper-textarea")?.readOnly ?? null,
		rail: rail
			? {
					pressed: rail.getAttribute("aria-pressed"),
					label: rail.getAttribute("aria-label"),
					blip: Boolean(
						document.querySelector('[data-tour-tag="console-pane-blip"]'),
					),
				}
			: null,
		active: active
			? {
					tag: active.tagName.toLowerCase(),
					class: String(active.className ?? "").slice(0, 80),
					inTerminal: Boolean(active.closest?.('[data-console-mirror]')),
				}
			: null,
		tabs,
		paneText: pane ? (pane.innerText || "").slice(0, 600) : null,
	};
})()`;

const read = () => evaluate(READ);

const shots = [];
async function shot(name) {
	const result = await cdp.call("Page.captureScreenshot", { format: "png" });
	const bytes = Buffer.from(result.data, "base64");
	const path = join(OUT_DIR, `${name}.png`);
	writeFileSync(path, bytes);
	shots.push({
		name,
		path,
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20),
		bytes: bytes.length,
	});
	return path;
}

/** A real key through Chromium's own input pipeline, into whatever holds focus. */
async function pressKey(key, code) {
	await cdp.call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key,
		text: key,
		unmodifiedText: key,
		windowsVirtualKeyCode: code,
		nativeVirtualKeyCode: code,
	});
	await cdp.call("Input.dispatchKeyEvent", {
		type: "keyUp",
		key,
		windowsVirtualKeyCode: code,
		nativeVirtualKeyCode: code,
	});
}

/** Put the keyboard in the terminal's textarea, as a click there would. */
async function focusTerminal() {
	return evaluate(
		`(() => { const t = document.querySelector(".xterm-helper-textarea"); if (!t) return false; t.focus(); return document.activeElement === t; })()`,
	);
}

/** Tab through Chromium's pipeline without text (the key that must leave history). */
async function pressTab() {
	await cdp.call("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9,
	});
	await cdp.call("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9,
	});
}

const report = [];
function say(cell, reading) {
	report.push({ cell, reading });
	console.log(`\n## ${cell}`);
	console.log(JSON.stringify(reading, null, 2));
}

/* --------------------------------------------------------------------- run */

let sessionId = null;
const sidecars = (want) => {
	const dir = join(CONFIG_DIR, "run", "ui-console", "history", want.session_id);
	// The retention layer's filename stem, not the raw handle: `:` is not portable
	// in a filename and `history.ts`'s `fileStem` maps every non-[A-Za-z0-9_-] to `_`.
	const stem = want.surface.replace(/[^A-Za-z0-9_-]/g, "_");
	try {
		const file = readdirSync(dir).find((name) => name === `${stem}.json`);
		if (!file) return null;
		return JSON.parse(readFileSync(join(dir, file), "utf8"));
	} catch {
		return null;
	}
};

async function boot() {
	await launchApp(sessionId);
	await openCdp();
	// Focus emulation is what makes `document.hasFocus()` true in a window that is
	// never shown: the clearing rule is display AND focus, and a rig that skipped
	// this would photograph a state no focused user can produce.
	await cdp.call("Emulation.setFocusEmulationEnabled", { enabled: true });
	await waitFor(
		"typeof window.api?.console?.state === 'function'",
		60_000,
		"the console bridge",
	);
	await mountConversation(sessionId);
}

async function openPane() {
	const pressed = await pressDom('[data-tour-tag="console-pane-trigger"]');
	if (!pressed) throw new Error("the console rail item was not on screen");
	await waitFor(
		`Boolean(document.querySelector('[data-tour-tag="console-pane"]'))`,
		30_000,
		"the console pane",
	);
}

/** The pane is a toggle on the rail: press only when it is not already drawn. */
async function ensurePaneOpen() {
	const open = await evaluate(
		`Boolean(document.querySelector('[data-tour-tag="console-pane"]'))`,
	);
	if (!open) await openPane();
}

/**
 * Close the pane through ITS OWN X, not the rail.
 *
 * THE RAIL IS A TOGGLE ONLY WHILE A TERMINAL RUNS (the change this report is
 * about): with nothing live its press means "give me a console" and keeps the pane
 * open, so a rig that closed with the rail would be measuring the old rule on the
 * new tree and hanging. The header's close control is the pane's own door and means
 * the same thing in both versions.
 */
async function closePane() {
	const open = await evaluate(
		`Boolean(document.querySelector('[data-tour-tag="console-pane"]'))`,
	);
	if (!open) return;
	const closed = await pressDom('[data-tour-tag="console-pane-close"]');
	if (!closed) throw new Error("the pane's close control was not on screen");
	await waitFor(
		`!document.querySelector('[data-tour-tag="console-pane"]')`,
		10_000,
		"the pane to close",
	);
}

async function main() {
	sessionId = seedConversation();
	await startDaemon();
	console.log(`daemon: 127.0.0.1:${PAIR_PORT} (scratch ${SCRATCH})`);
	console.log(`session: ${sessionId}`);
	await boot();

	// 1. A console the user opened, live.
	await openPane();
	await waitForLive(sessionId, true);
	await waitFor(
		`Boolean(document.querySelector('[data-tour-tag="console-mirror"]'))`,
		30_000,
		"the terminal mirror",
	);
	await sleep(1200);
	let state = await consoleState(sessionId);
	const first = state.surfaces[0];
	say("opened live", await read());
	await shot("live-opened");

	// 2. It exits. The pane is open and focused, which is the operator's frame.
	await evaluate(
		`window.api.console.input(${JSON.stringify(first.surface)}, "exit\\r")`,
	);
	await waitForLive(sessionId, false);
	await sleep(1200);
	state = await consoleState(sessionId);
	await focusTerminal();
	await sleep(300);
	say("ended, pane open", {
		surface: first.surface,
		state: state.surfaces,
		view: await read(),
	});
	await shot("ended-pane-open");

	// 3. The rail with 0 live, photographed BEFORE any key so the frame is the
	// state it claims and not the refusal band's after-state (Q-4).
	await shot("rail-zero-live");

	// 4. Keyboard focus on the history: the ring the caret can no longer give. Read
	// the PANE'S BOX (round 2 D2: on the mirror it was a clipped 16px L).
	await focusTerminal();
	await sleep(300);
	say("history focused", {
		view: await read(),
		active: await evaluate(
			`document.activeElement === document.querySelector('.xterm-helper-textarea')`,
		),
		focusVisible: await evaluate(
			`document.querySelector('.xterm-helper-textarea')?.matches(':focus-visible') ?? false`,
		),
	});
	await shot("history-focused");

	// 5. Real keys at the ended terminal: the refusal, a repeat (the live region's
	// text must change), then Tab (which must MOVE FOCUS, not announce).
	await focusTerminal();
	const bandBefore = await read();
	await pressKey("a", 65);
	await sleep(600);
	const firstRefusal = await read();
	say("ended, one key typed", firstRefusal);
	say("band geometry", {
		beforeTop: bandBefore.markerTop,
		afterTop: firstRefusal.markerTop,
	});
	await pressKey("b", 66);
	await sleep(600);
	const secondRefusal = await read();
	say("ended, a second key typed", {
		announceSeq: secondRefusal.announceSeq,
		announce: secondRefusal.announce,
		firstSeq: firstRefusal.announceSeq,
	});
	await shot("ended-key");
	await focusTerminal();
	await pressTab();
	await sleep(300);
	say("Tab on history", {
		active: await evaluate(
			`(() => { const a = document.activeElement; return { tag: a?.tagName?.toLowerCase() ?? null, inTerminal: Boolean(a?.closest?.('[data-console-mirror]')) }; })()`,
		),
	});
	await focusTerminal();

	// 6. The rail reading while the pane shows ended history (the frame above is
	// the same state before the key).
	say("rail with 0 live, pane open", (await read()).rail);

	// 5. Close the pane, then the user's open with nothing live.
	await closePane();
	await sleep(400);
	const beforeReopen = await consoleState(sessionId);
	await openPane();
	await sleep(2500);
	const afterReopen = await consoleState(sessionId);
	say("reopen with nothing live", {
		surfacesBefore: beforeReopen.surfaces.map((row) => ({
			surface: row.surface,
			running: row.running,
		})),
		surfacesAfter: afterReopen.surfaces.map((row) => ({
			surface: row.surface,
			running: row.running,
		})),
		created: afterReopen.surfaces.length > beforeReopen.surfaces.length,
		view: await read(),
	});
	await shot("reopen-nothing-live");

	// 6. One live and one ended: the open must focus the live one.
	const liveAfterReopen = afterReopen.surfaces.find((row) => row.running);
	if (liveAfterReopen) {
		// Set the persisted lens to the ENDED row first, so the frame and reading can
		// tell "focus the live surface" from "the lens happened to already be live"
		// (UX U4's evidence caveat).
		const endedId = beforeReopen.surfaces.find((row) => !row.running)?.surface;
		if (endedId) {
			await evaluate(
				`(() => {
					const row = document.querySelector('[data-surface=${JSON.stringify(endedId)}]');
					const tab = row ? row.querySelector('[role="tab"]') : null;
					if (!tab) return false;
					tab.click();
					return true;
				})()`,
			);
			await sleep(600);
		}
		await closePane();
		await sleep(400);
		const beforeFocus = await consoleState(sessionId);
		await openPane();
		await sleep(1500);
		const afterFocus = await consoleState(sessionId);
		say("one live and one ended", {
			surfaceCount: [beforeFocus.surfaces.length, afterFocus.surfaces.length],
			view: await read(),
		});
		await shot("one-live-one-ended");
	}

	// 7. Two ended: the open must create, not focus the recording.
	let latest = await consoleState(sessionId);
	for (const row of latest.surfaces.filter((entry) => entry.running)) {
		await evaluate(
			`window.api.console.input(${JSON.stringify(row.surface)}, "exit\\r")`,
		);
	}
	await sleep(800);
	await closePane();
	await sleep(400);
	const beforeTwoEnded = await consoleState(sessionId);
	await openPane();
	await sleep(2500);
	const afterTwoEnded = await consoleState(sessionId);
	say("all ended, user opens", {
		surfacesBefore: beforeTwoEnded.surfaces.map((row) => ({
			surface: row.surface,
			running: row.running,
		})),
		surfacesAfter: afterTwoEnded.surfaces.map((row) => ({
			surface: row.surface,
			running: row.running,
		})),
		created: afterTwoEnded.surfaces.length > beforeTwoEnded.surfaces.length,
		view: await read(),
	});
	await shot("all-ended-open");

	// 8. A console that ended while the pane was CLOSED carries the unseen mark,
	//    and the mark is cleared when its row is looked at.
	latest = await consoleState(sessionId);
	const live = latest.surfaces.find((row) => row.running);
	if (live) {
		await closePane();
		await sleep(400);
		await evaluate(
			`window.api.console.input(${JSON.stringify(live.surface)}, "exit\\r")`,
		);
		await sleep(1500);
		say("ended while the pane was closed", (await read()).rail);
		await shot("rail-unread-dot");
		const samples = [];
		await openPane();
		for (const wait of [0, 120, 300, 700]) {
			await sleep(wait);
			const view = await read();
			const rows = await consoleState(sessionId);
			samples.push({
				at: wait,
				blip: view.rail?.blip,
				selected: view.tabs.find((tab) => tab.selected === "true")?.surface,
				running: rows.surfaces.filter((row) => row.running).length,
			});
		}
		say("unread mark through the open", samples);
		await sleep(1200);
		const reopened = await consoleState(sessionId);
		const endedRow = reopened.surfaces.find(
			(row) => row.surface === live.surface,
		);
		await evaluate(
			`(() => {
				const row = document.querySelector('[data-surface=${JSON.stringify(live.surface)}]');
				const tab = row ? row.querySelector('[role="tab"]') : null;
				if (!tab) return false;
				tab.click();
				return true;
			})()`,
		);
		await sleep(1200);
		say("the ended row is looked at", {
			endedRow,
			view: await read(),
		});
		await shot("ended-row-looked-at");
	}

	// 9. A glyph under the (now invisible) cursor: the D1 case. A carriage return
	// leaves the record's cursor over the first column's character, then SIGKILL
	// ends the process without a newline moving it.
	await pressDom('[data-tour-tag="console-new-surface"]');
	await sleep(2500);
	latest = await consoleState(sessionId);
	const glyphSurface = latest.surfaces.find((row) => row.running);
	if (glyphSurface) {
		await evaluate(
			`window.api.console.input(${JSON.stringify(glyphSurface.surface)}, ${JSON.stringify("printf ABC\r\r")})`,
		);
		await sleep(400);
		await evaluate(
			`window.api.console.input(${JSON.stringify(glyphSurface.surface)}, ${JSON.stringify("kill -9 $$\r")})`,
		);
		await sleep(1200);
		await evaluate(
			`(() => {
				const row = document.querySelector('[data-surface=${JSON.stringify(glyphSurface.surface)}]');
				const tab = row ? row.querySelector('[role="tab"]') : null;
				if (!tab) return false;
				tab.click();
				return true;
			})()`,
		);
		await sleep(900);
		say("a glyph under the history cursor", {
			surface: glyphSurface.surface,
			view: await read(),
		});
		await shot("history-glyph-cursor");
	}

	// 10. Quit with a live surface: the sidecar must carry what the app could observe.
	latest = await consoleState(sessionId);
	let toQuit = latest.surfaces.find((row) => row.running);
	if (!toQuit) {
		// The `+` is the door that exists on BOTH trees and does not depend on the
		// open decision this report is measuring.
		await ensurePaneOpen();
		await pressDom('[data-tour-tag="console-new-surface"]');
		await sleep(2500);
		latest = await consoleState(sessionId);
		toQuit = latest.surfaces.find((row) => row.running);
	}
	if (toQuit) {
		const closing = toQuit;
		// `Browser.close` is Chromium's own graceful close: it asks the app to quit
		// through the same path a menu Quit does, which is what `before-quit` keys on.
		await Promise.race([
			cdp.call("Browser.close", {}).catch(() => {}),
			sleep(3000),
		]);
		await new Promise((resolve) => {
			const timer = setInterval(() => {
				if (!app || app.child.exitCode !== null) {
					clearInterval(timer);
					resolve();
				}
			}, 200);
			setTimeout(() => {
				clearInterval(timer);
				resolve();
			}, 15_000);
		});
		await stopApp();
		await sleep(1000);
		say("quit with a live surface", {
			surface: closing.surface,
			sidecar: sidecars(closing) ?? "no sidecar",
		});
	}

	// 10. Relaunch: the restored surface must say what actually ended it.
	await launchApp(sessionId);
	await openCdp();
	await cdp.call("Emulation.setFocusEmulationEnabled", { enabled: true });
	await waitFor(
		"typeof window.api?.console?.state === 'function'",
		60_000,
		"the console bridge after relaunch",
	);
	await waitFor(
		`Boolean(document.querySelector('[data-tour-tag="console-pane-trigger"]'))`,
		30_000,
		"the console rail item after relaunch",
	);
	await ensurePaneOpen();
	await sleep(1500);
	const restoredState = await consoleState(sessionId);
	const restored =
		restoredState.surfaces.find(
			(row) => row.surface === (toQuit?.surface ?? ""),
		) ?? restoredState.surfaces.find((row) => !row.running);
	if (restored) {
		await evaluate(
			`(() => {
				const row = document.querySelector('[data-surface=${JSON.stringify(restored.surface)}]');
				const tab = row ? row.querySelector('[role="tab"]') : null;
				if (!tab) return false;
				tab.click();
				return true;
			})()`,
		);
		await sleep(1500);
	}
	say("relaunch, restored surface selected", {
		restored,
		sidecar: restored ? sidecars(restored) : null,
		view: await read(),
	});
	await shot("relaunch-restored");

	console.log("\n## frames");
	for (const entry of shots) console.log(JSON.stringify(entry));
	writeFileSync(
		join(OUT_DIR, "readings.json"),
		`${JSON.stringify({ pairPort: PAIR_PORT, when: new Date().toISOString(), report, frames: shots }, null, 2)}\n`,
	);
	console.log(`\nreadings: ${join(OUT_DIR, "readings.json")}`);
}

let exitCode = 0;
try {
	await main();
} catch (error) {
	exitCode = 1;
	console.error(`\nFAILED: ${error instanceof Error ? error.stack : error}`);
} finally {
	try {
		cdp?.close();
	} catch {
		/* already closed */
	}
	await stopApp().catch(() => {});
	await stopDaemon().catch(() => {});
	const reaped = reapSpawnHelpers();
	if (reaped > 0) console.log(`reaped ${reaped} leaked spawn-helper(s)`);
	if (!KEEP) {
		try {
			rmSync(SCRATCH, { recursive: true, force: true });
			chmodSync(SCRATCH, 0o700);
		} catch {
			/* best effort */
		}
	} else {
		console.log(`scratch kept: ${SCRATCH}`);
	}
	process.exit(exitCode);
}
