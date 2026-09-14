#!/usr/bin/env node
/*
 * Capture the read-only diagnostic panels from the REAL app.
 *
 * Why this exists. Every other frame under `docs/evidence/panels-*` renders a
 * story fixture, which is the only way to photograph a dead ledger, an
 * unwalked subtree or a backend that predates the op. What a fixture cannot
 * answer is whether the SHIPPED app really opens these panels — the slash
 * command has to be offered, the destination has to exist, the op has to be
 * reachable, and the panel has to render the wire shape rather than its own
 * fixtures.
 *
 * What it does: runs the BUILT app (`out/`, from `pnpm build` with
 * `VITE_DISABLE_BACKEND_MANAGER=true` and `VITE_LOCAL_OPERATOR_API_URL` pointed
 * at the backend under test) in an ISOLATED user-data-dir, with
 * `LOCAL_OPERATOR_UI_WINDOW_MODE=headless` so the operator's window is never
 * raised. It then drives the app over raw CDP — no dependency; Node's built-in
 * WebSocket is the transport — types the command into the composer, presses
 * Enter, waits for the panel, and photographs it.
 *
 * The token. This app did not start the backend, so it holds no bearer; without
 * one every control answers 503 and the panels render empty. The bearer is read
 * from the backend process's own environment (`ps eww`), used in memory, and
 * NEVER printed, logged or written to disk.
 *
 * Usage:
 *   node scripts/panel-views-live-evidence.mjs [--probe] [--panels=a,b]
 *     [--out=<dir>] [--width=1140] [--height=940]
 *
 * `--probe` drives the app and prints what it found instead of writing frames,
 * which is how a selector change is debugged without spending a capture.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints } from "./check-evidence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};
const PROBE = ARGS.includes("--probe");
const OUT = flag("out", join(ROOT, "docs", "evidence", "panels-live"));
const WIDTH = Number(flag("width", "1140"));
const HEIGHT = Number(flag("height", "940"));
const PORT = Number(flag("port", "9444"));
const BACKEND = flag("backend", "http://127.0.0.1:1111");
const THEMES = ["localOperatorDark", "localOperatorLight"];
const CHROME_UA_THEME_KEY = "ui-preferences-storage";

/**
 * The command each panel is opened with, and the text its dialog must carry.
 *
 * The title is the assertion: opening the wrong panel, or a dialog that never
 * arrived, must fail the run rather than commit a frame of the chat behind it.
 */
const PANELS = [
	{ id: "analytics", command: "/analytics", title: "Analytics" },
	{ id: "session", command: "/session", title: "Session" },
	{ id: "info", command: "/info", title: "Info" },
	{ id: "context", command: "/context", title: "Context" },
	{ id: "failovers", command: "/failovers", title: "Failovers" },
];

const requested = flag("panels", null);
const panels = requested
	? PANELS.filter((panel) => requested.split(",").includes(panel.id))
	: PANELS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The desktop bearer, read from the backend's own environment. Never printed. */
const desktopToken = () => {
	if (process.env.LO_LIVE_TOKEN) return process.env.LO_LIVE_TOKEN;
	const { port } = new URL(BACKEND);
	const pids = execFileSync("lsof", ["-ti", `tcp:${port}`])
		.toString()
		.trim()
		.split("\n")
		.filter(Boolean);
	for (const pid of pids) {
		let env = "";
		try {
			env = execFileSync("ps", ["eww", "-p", pid]).toString();
		} catch {
			continue;
		}
		const entry = env
			.split(/\s+/)
			.find((value) => value.startsWith("LOCAL_OPERATOR_DESKTOP_TOKEN="));
		if (entry) return entry.slice("LOCAL_OPERATOR_DESKTOP_TOKEN=".length);
	}
	return null;
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
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
	async evaluate(expression) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			throw new Error(
				`evaluate failed: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails)}`,
			);
		}
		return result.result.value;
	}
}

/*
 * CMUX_* is stripped from the child environment: several agents run on this
 * machine, an inherited CMUX_WORKSPACE_ID names the operator's real workspace,
 * and a headless run that keeps it can drive the windows somebody is using.
 */
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	if (key.startsWith("CMUX_")) delete childEnv[key];
}

const dataDir = join(tmpdir(), `lo-panels-live-${process.pid}`);
mkdirSync(dataDir, { recursive: true });

const token = desktopToken();
const app = spawn(
	"./node_modules/.bin/electron",
	[
		".",
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${dataDir}`,
		`--window-size=${WIDTH}x${HEIGHT}`,
	],
	{
		env: {
			...childEnv,
			LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
			VITE_DISABLE_BACKEND_MANAGER: "true",
			...(token ? { LOCAL_OPERATOR_DESKTOP_TOKEN: token } : {}),
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);
const log = [];
app.stdout.on("data", (d) => log.push(`[app] ${d}`));
app.stderr.on("data", (d) => log.push(`[app:err] ${d}`));

const teardown = () => {
	try {
		app.kill("SIGKILL");
	} catch {
		// already gone
	}
	rmSync(dataDir, { recursive: true, force: true });
};
process.on("exit", teardown);
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		teardown();
		process.exit(1);
	});
}

async function connect() {
	for (let attempt = 0; attempt < 120; attempt++) {
		try {
			const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) =>
				r.json(),
			);
			const target = list.find((t) => t.type === "page");
			if (target?.webSocketDebuggerUrl) {
				const ws = new WebSocket(target.webSocketDebuggerUrl);
				await new Promise((resolve, reject) => {
					ws.addEventListener("open", resolve, { once: true });
					ws.addEventListener("error", reject, { once: true });
				});
				return new Cdp(ws);
			}
		} catch {
			// the app is still starting
		}
		await sleep(500);
	}
	throw new Error("the app never exposed a debuggable page");
}

/** Type a command into the composer and press Enter, the way a user does. */
async function runCommand(cdp, command) {
	await cdp.evaluate(`
		(() => {
			const box = document.querySelector("textarea");
			if (!box) return false;
			box.focus();
			return document.activeElement === box;
		})()
	`);
	await cdp.send("Input.insertText", { text: command });
	await sleep(400);
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
			text: type === "keyDown" ? "\r" : undefined,
		});
	}
}

/** Wait for the panel's dialog, and hand back what it contains. */
async function waitForPanel(cdp, title) {
	for (let attempt = 0; attempt < 60; attempt++) {
		const found = await cdp.evaluate(`
			(() => {
				const dialog = document.querySelector('[role="dialog"]');
				if (!dialog) return null;
				return dialog.innerText.slice(0, 4000);
			})()
		`);
		if (found?.includes(title)) return found;
		await sleep(500);
	}
	return null;
}

async function closePanel(cdp) {
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
	}
	await sleep(600);
}

const main = async () => {
	if (!token && !PROBE) {
		console.log(
			"No desktop bearer found on the backend's environment; the panels would render empty. Pass LO_LIVE_TOKEN or run --probe.",
		);
	}
	const cdp = await connect();
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	// Let the app finish its first paint (the session list arrives from the
	// backend, and the composer only exists once the chat page has mounted).
	await sleep(8000);

	if (PROBE) {
		console.log(
			"textarea:",
			await cdp.evaluate("Boolean(document.querySelector('textarea'))"),
		);
		console.log(
			"session in view:",
			await cdp.evaluate(
				"document.querySelector('textarea')?.getAttribute('placeholder') ?? null",
			),
		);
		console.log(
			"body tail:",
			(await cdp.evaluate("document.body.innerText"))?.slice(-800),
		);
		return;
	}

	const written = [];
	for (const theme of THEMES) {
		// The theme rides the same persisted store the app reads, seeded before
		// any app script runs so the first paint is already the captured theme.
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
			source: `try { localStorage.setItem(${JSON.stringify(CHROME_UA_THEME_KEY)}, JSON.stringify({ state: { themeName: ${JSON.stringify(theme)} }, version: 0 })); } catch {}`,
		});
		await cdp.send("Page.reload", { ignoreCache: false });
		await sleep(9000);
		const applied = await cdp.evaluate(
			"document.documentElement.dataset.theme || ''",
		);
		if (applied !== theme) {
			throw new Error(
				`the app carries theme "${applied}" rather than "${theme}"; the frame would be named for a theme it is not showing`,
			);
		}
		for (const panel of panels) {
			await runCommand(cdp, panel.command);
			const text = await waitForPanel(cdp, panel.title);
			if (!text) {
				throw new Error(
					`${panel.command} did not open a "${panel.title}" panel; the run refuses to photograph the chat behind it`,
				);
			}
			const dir = join(OUT, panel.id);
			mkdirSync(dir, { recursive: true });
			const file = join(dir, `${theme}.webp`);
			const shot = await cdp.send("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: false,
			});
			const png = join(dataDir, `${panel.id}-${theme}.png`);
			writeFileSync(png, Buffer.from(shot.data, "base64"));
			execFileSync("magick", [png, "-quality", "82", file]);
			assertFramePaints(file, theme);
			written.push(file);
			console.log(
				`${panel.id} @ ${theme}: captured ${file}\n  panel text: ${text.replace(/\s+/g, " ").slice(0, 180)}`,
			);
			await closePanel(cdp);
		}
	}
	console.log(`Captured ${written.length} frames into ${OUT}`);
};

main().catch((error) => {
	console.log(String(error.message ?? error));
	for (const line of log.slice(-20)) console.log(line.trimEnd());
	teardown();
	process.exit(1);
});
