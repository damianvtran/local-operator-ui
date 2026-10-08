#!/usr/bin/env node
/**
 * One self-contained real-app capture of a panel-rail tooltip over the NATIVE
 * browser view (#872, design round 1, D1).
 *
 *     node capture.mjs --out <dir> --label <name> [--hover console|canvas|run|browser]
 *
 * WHY THIS EXISTS. A native `WebContentsView` paints above ALL DOM
 * (`src/renderer/src/shared/browser-view-policy.ts`), so whether a rail tooltip -
 * which opens LEFT, into the pane - is visible with the Browser pane open is a
 * RENDERING fact: Storybook has no native view, and `capturePage()` photographs the
 * renderer without it. The only instrument that sees the compositor's answer is a
 * screenshot of the real window, which is `screencapture -x -l <windowid>`: the
 * window-ID form, so it needs no focus and takes none.
 *
 * WHAT IT DOES, in one command, and reaps everything before it returns:
 *   1. serves a bright local page (the native view's content), starts the
 *      session-archive stub daemon (the repo's committed stand-in; port 8080,
 *      because the page's CSP allows only 1111 and 8080, and 1111 is the
 *      operator's own daemon);
 *   2. launches the BUILT app `--window-mode=inactive` (visible, never activated)
 *      on a scratch profile with a mock keychain, every `CMUX_*`/`LOP_*` variable
 *      removed, the app's own notifications and telemetry off;
 *   3. opens a conversation and the Browser pane, opens a tab on the local page,
 *      moves a real pointer over the rail item, waits for the tooltip, and
 *      screenshots the window;
 *   4. kills the Electron process GROUP and the two helpers by exact pid.
 *
 * The app must have been built against the stub's address:
 *   VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 LOCAL_OPERATOR_UI_NO_BYTECODE=true \
 *     pnpm exec electron-vite build        (plus the four VITE_*_CLIENT/TENANT ids)
 *
 * NOT covered: Windows/Linux, and anything the OS compositor does that differs by
 * display; the frame is this host's.
 */
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.APP_ROOT
	? resolve(process.env.APP_ROOT)
	: resolve(HERE, "../../../../..");
const arg = (name, fallback = null) => {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};
const OUT = resolve(arg("out", "."));
const LABEL = arg("label", "frame");
const HOVER = arg("hover", "console");
const WIDTH = Number(arg("width", "1280"));
const HEIGHT = Number(arg("height", "900"));
/* `--simulate-run-slot`: the stub serves no run-detail frames, so its conversation has no Run details
   item and the rail's items sit 36px (one item + gap) higher than in a real session. This pads the
   rail's top by that amount so a lower item's tooltip lands where it does in a real conversation.
   It is a SIMULATION of position, labelled as such in every frame name and in the README. */
const SIMULATE_RUN_SLOT = process.argv.includes("--simulate-run-slot");
const PORT = 8080;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page = null;
const owned = []; // [{pid, group}] every process this run starts, reaped by exact pid
const scratch = mkdtempSync(join(tmpdir(), "lo-rail-tooltip-"));
let reaped = false;
const reap = () => {
	if (reaped) return;
	reaped = true;
	try {
		page.close();
		page.closeAllConnections?.();
	} catch {
		/* not started */
	}
	for (const { pid, group } of owned.reverse()) {
		try {
			process.kill(group ? -pid : pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
	try {
		rmSync(scratch, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
	} catch {
		/* best effort */
	}
};
process.on("exit", reap);
for (const sig of ["SIGINT", "SIGTERM"])
	process.on(sig, () => {
		reap();
		process.exit(130);
	});

if (!existsSync(join(ROOT, "out", "main", "index.js"))) {
	console.error(
		`no built app at ${ROOT}/out (see the header for the build command)`,
	);
	process.exit(2);
}
if (
	(() => {
		try {
			execFileSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN"], {
				stdio: "pipe",
			});
			return true;
		} catch {
			return false;
		}
	})()
) {
	console.error(`port ${PORT} is already in use; refusing to start`);
	process.exit(2);
}

/* 1. the page the native view shows, and the stub daemon */
page = createServer((_, res) => {
	res.writeHead(200, { "content-type": "text/html" });
	res.end(
		'<!doctype html><body style="margin:0;background:#e8590c;color:#fff;font:700 28px system-ui;display:grid;place-items:center;height:100vh">NATIVE BROWSER VIEW (this page is outside the DOM)</body>',
	);
});
await new Promise((r) => page.listen(0, "127.0.0.1", r));
const PAGE_URL = `http://127.0.0.1:${page.address().port}/`;
/* the page server lives in this process: closed in `reap`, never signalled by pid */

const records = join(scratch, "records");
const stub = spawn(
	process.execPath,
	[
		join(HERE, "../../../session-archive/harness/stub-daemon.mjs"),
		"--port",
		String(PORT),
		"--records",
		records,
	],
	{ stdio: "ignore", detached: true },
);
owned.push({ pid: stub.pid, group: true });
for (let i = 0; i < 40; i++) {
	try {
		if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break;
	} catch {
		/* not yet */
	}
	await sleep(250);
}

/* 2. the app, on a scratch profile, inactive */
const home = join(scratch, "home");
const config = join(scratch, "config");
const logs = join(scratch, "logs");
const cwd = join(scratch, "cwd");
const userData = join(scratch, "userdata");
for (const d of [home, config, logs, cwd, userData])
	mkdirSync(d, { recursive: true });
mkdirSync(join(config, "run"), { recursive: true });
symlinkSync(records, join(config, "run", "serve"));
writeFileSync(
	join(cwd, ".env"),
	`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${PORT}\nVITE_DISABLE_BACKEND_MANAGER=true\n`,
);
const env = {
	...process.env,
	HOME: home,
	LOCAL_OPERATOR_CONFIG_DIR: config,
	LOCAL_OPERATOR_LOG_DIR: logs,
	VITE_DISABLE_BACKEND_MANAGER: "true",
	LOCAL_OPERATOR_DESKTOP_TOKEN: "scratch-token",
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	TZ: "America/New_York",
};
for (const k of Object.keys(env))
	if (k.startsWith("CMUX_") || k.startsWith("LOP_")) delete env[k];
const electron = createRequire(join(ROOT, "package.json"))("electron");
const debugPort = 9300 + Math.floor(Math.random() * 400);
const inspectPort = debugPort + 500;
const app = spawn(
	electron,
	[
		ROOT,
		`--user-data-dir=${userData}`,
		`--remote-debugging-port=${debugPort}`,
		`--inspect=${inspectPort}`,
		"--window-mode=inactive",
		`--window-size=${WIDTH}x${HEIGHT}`,
		"--use-mock-keychain",
	],
	{ env, cwd, stdio: "ignore", detached: true },
);
owned.push({ pid: app.pid, group: true });

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.n = 0;
		this.p = new Map();
		ws.addEventListener("message", (e) => {
			const m = JSON.parse(e.data);
			if (m.id && this.p.has(m.id)) {
				const { res, rej } = this.p.get(m.id);
				this.p.delete(m.id);
				m.error ? rej(new Error(m.error.message)) : res(m.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.n;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((res, rej) => this.p.set(id, { res, rej }));
	}
	async eval(expression) {
		const r = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (r.exceptionDetails)
			throw new Error(r.exceptionDetails.exception?.description ?? "threw");
		return r.result.value;
	}
}
const attach = async (port, pick) => {
	for (let i = 0; i < 120; i++) {
		try {
			const t = (
				await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
			).find(pick);
			if (t) {
				const ws = new WebSocket(t.webSocketDebuggerUrl);
				await new Promise((r, j) => {
					ws.addEventListener("open", r, { once: true });
					ws.addEventListener("error", j, { once: true });
				});
				return new Cdp(ws);
			}
		} catch {
			/* not yet */
		}
		await sleep(250);
	}
	throw new Error(`no target on ${port}`);
};

const result = {
	label: LABEL,
	hover: HOVER,
	simulatedRunSlot: SIMULATE_RUN_SLOT,
};
try {
	const main = await attach(inspectPort, (t) => t.type === "node");
	const page_ = await attach(
		debugPort,
		(t) => t.type === "page" && t.url.includes("index.html"),
	);
	globalThis.__page = page_;
	await page_.send("Page.enable");
	await page_.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'try{localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}))}catch(e){}',
	});
	await page_.send("Page.reload");
	await sleep(2500);
	const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
	const waitFor = async (sel, ms = 20000) => {
		const t = Date.now();
		while (Date.now() - t < ms) {
			if (await page_.eval(`Boolean(${q(sel)})`)) return true;
			await sleep(250);
		}
		throw new Error(`never appeared: ${sel}`);
	};
	const click = (sel) =>
		page_.eval(
			`(()=>{const e=${q(sel)};if(!e)return false;e.click();return true})()`,
		);

	await page_.eval(`location.hash = "#/chat"`);
	await sleep(1500);
	await waitFor('[data-tour-tag="chat-session-row"]');
	await click('[data-tour-tag="chat-session-row"]');
	await waitFor('[data-panel-rail-item="browser"]');
	await click('[data-panel-rail-item="browser"]');
	await waitFor('[data-tour-tag="browser-pane-slot"]');
	await sleep(800);
	/* a tab on the local page, so the native view has something to paint */
	const sessionId = await page_.eval(
		`(()=>{const r=document.querySelector("[data-session-row]");return r?.getAttribute("data-session-row")??null})()`,
	);
	result.sessionId = sessionId;
	await page_.eval(
		`(async()=>{await window.api.browser.newTab(${JSON.stringify(sessionId)});await window.api.browser.navigate(${JSON.stringify(PAGE_URL)});})()`,
	);
	await sleep(2500);

	const winId = await main.eval(
		`(()=>{const e=process.mainModule.require("electron");const w=e.BrowserWindow.getAllWindows()[0];return {id:w.getMediaSourceId(),visible:w.isVisible(),focused:w.isFocused(),bounds:w.getContentBounds()}})()`,
	);
	result.window = winId;
	const cgid = Number(String(winId.id).split(":")[1]);

	if (SIMULATE_RUN_SLOT) {
		await page_.eval(
			`(()=>{const r=document.querySelector("[data-panel-rail]");r.style.paddingTop="calc(" + getComputedStyle(r).paddingTop + " + 36px)";})()`,
		);
		await sleep(300);
	}
	const rect = await page_.eval(
		`(()=>{const e=${q(`[data-panel-rail-item="${HOVER}"]`)};if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`,
	);
	if (!rect) throw new Error(`no rail item ${HOVER}`);
	await page_.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: rect.x - 30,
		y: rect.y,
	});
	await page_.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: rect.x,
		y: rect.y,
	});
	let tip = null;
	for (let i = 0; i < 24 && !tip; i++) {
		await sleep(250);
		tip = await page_.eval(
			`(()=>{const t=document.querySelector('[role="tooltip"]');if(!t)return null;const b=t.getBoundingClientRect();return {text:t.textContent.trim(),x:b.x,y:b.y,w:b.width,h:b.height}})()`,
		);
	}
	result.tooltip = tip;
	/* the rect the native view is told to paint (CSS px): a tooltip is occluded exactly where it overlaps this */
	result.viewRect = await page_.eval(
		`(()=>{const e=document.querySelector('[data-tour-tag="browser-pane-dock"]');if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}})()`,
	);
	result.suppressedBy = await page_.eval(
		`(document.querySelector("[data-suppressed-by]")?.getAttribute("data-suppressed-by"))??null`,
	);
	await sleep(700);
	mkdirSync(OUT, { recursive: true });
	const png = join(OUT, `${LABEL}.png`);
	execFileSync("screencapture", ["-x", "-o", "-l", String(cgid), png]);
	result.file = png;
	await page_.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: 5,
		y: 5,
	});
} catch (error) {
	result.error = String(error?.message ?? error);
	/* what the page WAS showing, so a refused boot reads as a state and not as a missing element */
	try {
		result.page = await Promise.race([
			globalThis.__page?.eval(
				`({hash:location.hash,text:document.body.innerText.slice(0,500),tags:[...document.querySelectorAll("[data-tour-tag]")].slice(0,25).map(e=>e.getAttribute("data-tour-tag"))})`,
			),
			sleep(3000),
		]);
	} catch {
		/* page gone */
	}
	process.exitCode = 1;
} finally {
	reap();
}
console.log(JSON.stringify(result, null, 1));
