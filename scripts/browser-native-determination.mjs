#!/usr/bin/env node
/**
 * Native determination for S5's permanent address row: does the DOM row paint
 * above the driven page, and can a click reach it?
 *
 * WHY THIS RIG EXISTS. The S4b matrix (`docs/evidence/browser-chrome-s4b`) is a
 * renderer-side measurement: it reads DOM rects and a child viewport, and its own
 * BL1 row says native composite pixels and native hit routing are unmeasured. The
 * claim "the popout paints above the page" cannot be closed from the renderer,
 * because the page is a native `WebContentsView` sibling that paints outside the
 * page's DOM. This script boots the BUILT app headless with the Electron
 * MAIN-process inspector enabled, so it can read the window's actual view tree:
 * `contentView.children` (Electron's view of AppKit's `subviews`), each view's own
 * `getBounds()` / `getVisible()`, and each view's own `webContents.capturePage()`.
 *
 * WHAT IS MEASURED, AND WHAT IS NOT:
 * - MEASURED: the native view list and order before/open/after; every view's
 *   bounds and visibility; the popout's DOM rect and the page's native rect at
 *   the same instant; per-view captures (with the repo's blank-frame test); a
 *   constructed composite from those captures at the measured bounds/order;
 *   targeted input delivery with per-view main-process counters; focus ownership
 *   readings; the dismissal matrix; and teardown.
 * - NOT MEASURED: an OS-level click (that needs Accessibility permission, which
 *   this repository forbids for rigs) or a real macOS IME session, VoiceOver/AX,
 *   Windows or Linux. The paint ORDER and the click TARGET are inferred from
 *   AppKit's documented subview rules (the array is back-to-front; hit testing
 *   starts at the last subview and works backwards), applied to the measured
 *   order and rectangles. The doc labels that split rather than folding the
 *   inference into the measurement.
 * - `sendInputEvent` is NOT native hit routing: it addresses one webContents
 *   directly. The run includes a negative control that demonstrates exactly that
 *   (a click sent to the owner at a point the page view covers still lands in the
 *   owner), so the counters cannot be misread as routing proof.
 *
 * WHY THE MAIN INSPECTOR. It is the only in-process surface that can read the
 * native view tree without a product change. `process.mainModule.require
 * ("electron")` is the route: a bare `require` is not defined in the inspector
 * context on Electron 44.3.0 (measured here), and `process.mainModule` does not
 * exist for the first ~1s of startup, so every poll fails soft.
 *
 * ISOLATION is the repository's, not this script's invention: scratch HOME,
 * config, log dir, profile and cwd; the cwd's `.env` points the backend at a dead
 * port and disables the backend manager; notifications and telemetry are off;
 * `CMUX_*`/`LOP_*` are stripped; the mock-keychain switch keeps a scratch HOME
 * from asking macOS to create a login keychain. The window is `headless` (created,
 * never shown, unfocusable). The process group is reaped by exact pid, and the
 * run is bounded.
 *
 * USAGE:
 *   node scripts/browser-native-determination.mjs --out <evidence dir>
 *
 * Outputs: build-identity.json, native-views.json, matrix.md, facts.json,
 * events.jsonl, frames.md, frames/*.png (ignored pixels), app.log, teardown.json.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(join(ROOT, "package.json"));
const ELECTRON_BIN = requireFromRepo("electron");
const OUT_ARG = process.argv[process.argv.indexOf("--out") + 1];
if (!OUT_ARG || OUT_ARG.startsWith("--")) {
	console.error("[native] --out <evidence dir> is required");
	process.exit(2);
}
// RESOLVE, because every path below is handed to the app as HOME/config/log/profile
// and a relative one is not a scratch path: the app rejects a relative
// LOCAL_OPERATOR_LOG_DIR and falls back to the operator's real log directory, and a
// relative HOME resolves against the launch cwd. The review of this rig measured
// exactly that (2026-10-22), so the expansion is a correctness requirement rather
// than tidiness. `RUN` inherits absoluteness from `OUT`.
const OUT = resolve(OUT_ARG);
const RUN = join(OUT, "run", `${Date.now()}`);
const FRAMES = join(OUT, "frames");
mkdirSync(RUN, { recursive: true });
mkdirSync(FRAMES, { recursive: true });
const EVENTS = join(OUT, "events.jsonl");
const T0 = Date.now();
const at = () => new Date().toISOString();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const log = (...parts) => console.log("[native]", ...parts);

// ---- plan / records ---------------------------------------------------------

const rows = [];
function plan(id, claim, mode = "driven") {
	rows.push({ id, claim, mode, status: "pending", evidence: "", at: null });
}
function event(payload) {
	appendFileSync(EVENTS, `${JSON.stringify({ at: at(), ...payload })}\n`);
}
function record(id, status, evidence) {
	const row = rows.find((entry) => entry.id === id);
	if (!row) throw new Error(`unknown row ${id}`);
	if (row.at !== null) throw new Error(`row ${id} already recorded`);
	row.status = status;
	row.evidence =
		typeof evidence === "string" ? evidence : JSON.stringify(evidence);
	row.at = at();
	event({ event: "row", id, status, evidence: row.evidence });
	log(
		id,
		status,
		row.evidence.length > 240 ? `${row.evidence.slice(0, 240)}…` : row.evidence,
	);
	return row;
}
function writeJson(name, value) {
	writeFileSync(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
}

// ---- CDP --------------------------------------------------------------------

class Cdp {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		socket.addEventListener("message", (message) => {
			const payload = JSON.parse(message.data);
			if (payload.id && this.pending.has(payload.id)) {
				const { resolve: done, reject } = this.pending.get(payload.id);
				this.pending.delete(payload.id);
				if (payload.error) reject(new Error(JSON.stringify(payload.error)));
				else done(payload.result);
			}
		});
	}
	send(method, params = {}, timeoutMs = 45_000) {
		const id = this.nextId++;
		return new Promise((done, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} timed out`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					done(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}
	close() {
		try {
			this.socket.close();
		} catch {
			// already closed
		}
	}
}
async function connect(url) {
	const socket = new WebSocket(url);
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
async function waitForTarget(port, predicate, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	let last = [];
	while (Date.now() < deadline) {
		try {
			last = await targets(port);
			const match = last.find(predicate);
			if (match) return match;
		} catch {
			// not listening yet
		}
		await sleep(120);
	}
	throw new Error(
		`no target matched; last ${JSON.stringify(last.map((t) => ({ type: t.type, url: t.url })))}`,
	);
}
async function evaluate(cdp, expression, timeoutMs = 45_000) {
	const result = await cdp.send(
		"Runtime.evaluate",
		{ expression, awaitPromise: true, returnByValue: true },
		timeoutMs,
	);
	if (result.exceptionDetails) {
		throw new Error(
			`evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
		);
	}
	return result.result?.value;
}
async function waitFor(cdp, expression, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await evaluate(cdp, expression)) return true;
		await sleep(120);
	}
	return false;
}

// ---- fixture page -----------------------------------------------------------

let pageServer = null;
let pageBase = "";
async function startFixturePage() {
	pageServer = createHttpServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(`<!doctype html><html><head><title>native-determination fixture</title>
<style>body{margin:0;font:16px/1.5 sans-serif;background:#f4f1ea;color:#222}
section{height:240px;border-bottom:1px solid #d5d0c4}
#marker{position:absolute;top:1500px;left:8px;background:#b3261e;color:#fff;padding:4px 8px}</style></head>
<body><h1>native-determination fixture</h1><div id="marker">marker</div>
${Array.from({ length: 12 }, (_, i) => `<section>section ${i}</section>`).join("")}
</body></html>`);
	});
	await new Promise((done) => pageServer.listen(0, "127.0.0.1", done));
	pageBase = `http://127.0.0.1:${pageServer.address().port}`;
	return `${pageBase}/fixture`;
}

// ---- boot -------------------------------------------------------------------

const rawLog = [];
let logPath = "";
function flushLog() {
	if (rawLog.length === 0) return;
	appendFileSync(logPath, rawLog.join(""));
	rawLog.length = 0;
}
function logText() {
	try {
		return readFileSync(logPath, "utf8") + rawLog.join("");
	} catch {
		return rawLog.join("");
	}
}
async function waitForLog(pattern, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const match = pattern.exec(logText());
		if (match) return match;
		await sleep(100);
	}
	throw new Error(`log never matched ${pattern}`);
}

/**
 * The operator's real state, read only to prove this launch did not touch it.
 *
 * The previous version of this rig passed a relative `--out` into HOME/config/log/
 * profile; the app rejected the relative log dir and wrote its log into the real
 * `~/Library/Application Support/Local Operator/logs`. That is a defect of the
 * rig, not of the app, and the fix is not just absolute paths: the run also has
 * to be able to say whether the real paths changed. Stats are recorded, never
 * contents; the only content read is a membership test for this run's unique
 * launcher-pid token, so a hit cannot be confused with the operator's own app
 * writing a normal line.
 */
const REAL_HOME = homedir();
const REAL_LOGS_DIR = join(
	REAL_HOME,
	"Library/Application Support/Local Operator/logs",
);
const REAL_CONFIG = join(REAL_HOME, ".local-operator/config.yml");
const REAL_PROFILE = join(
	REAL_HOME,
	"Library/Application Support/Local Operator/Partitions/local-operator-browser",
);

function statOf(path) {
	try {
		const stat = statSync(path);
		return {
			exists: true,
			isDirectory: stat.isDirectory(),
			size: stat.isDirectory() ? null : stat.size,
			mtimeMs: stat.mtimeMs,
		};
	} catch {
		return { exists: false };
	}
}

function realState() {
	return {
		logsDir: statOf(REAL_LOGS_DIR),
		config: statOf(REAL_CONFIG),
		profile: statOf(REAL_PROFILE),
	};
}

/**
 * How many real log files contain this run's unique launcher token.
 *
 * The headless app writes `headless run launched by pid <probe pid>` on start, so
 * a file containing that exact string was written by THIS run. Reading is a
 * membership test only; the content is never recorded.
 */
function realLogTokenHits(token) {
	let files = 0;
	let hits = 0;
	try {
		for (const name of readdirSync(REAL_LOGS_DIR)) {
			if (!name.endsWith(".log")) continue;
			files += 1;
			try {
				if (readFileSync(join(REAL_LOGS_DIR, name), "utf8").includes(token))
					hits += 1;
			} catch {
				// An unreadable log cannot be claimed either way; the count stays.
			}
		}
	} catch {
		return { files: null, hits: null };
	}
	return { files, hits };
}

async function boot() {
	const home = join(RUN, "home");
	const config = join(RUN, "config");
	const logs = join(RUN, "logs");
	const profile = join(RUN, "profile");
	const cwd = join(RUN, "cwd");
	const scratch = { home, config, logs, profile, cwd };
	// A relative path here is the defect the rig was reviewed for: the app treats
	// LOCAL_OPERATOR_LOG_DIR as an absolute path only and silently falls back to
	// the operator's real logs otherwise. Fail loudly instead of measuring.
	for (const [name, dir] of Object.entries(scratch)) {
		if (!isAbsolute(dir)) {
			throw new Error(
				`[native] scratch ${name} is not absolute: ${dir}; pass an absolute --out`,
			);
		}
	}
	for (const dir of [home, config, logs, profile, cwd])
		mkdirSync(dir, { recursive: true });
	// A dead port in the scratch cwd's `.env`: the app's own dotenv load must not
	// reach the operator's backend. Port 9 is the discard port and is never ours.
	writeFileSync(
		join(cwd, ".env"),
		"VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:9\nVITE_DISABLE_BACKEND_MANAGER=true\n",
	);
	const env = withNotificationsOff({
		...process.env,
		HOME: home,
		LOCAL_OPERATOR_CONFIG_DIR: config,
		LOCAL_OPERATOR_LOG_DIR: logs,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	logPath = join(OUT, "app.log");
	writeFileSync(logPath, "");
	const child = spawn(
		ELECTRON_BIN,
		[
			ROOT,
			// Both ports are chosen by the OS and printed on stderr. A port this
			// script picked could be taken between the probe and the launch.
			"--inspect=0",
			"--remote-debugging-port=0",
			"--window-mode=headless",
			"--window-size=1380x900",
			`--user-data-dir=${profile}`,
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			"--disable-background-timer-throttling",
			MOCK_KEYCHAIN_SWITCH,
		],
		{ env, cwd, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	child.stdout.on("data", (chunk) => rawLog.push(chunk.toString()));
	child.stderr.on("data", (chunk) => rawLog.push(chunk.toString()));
	const timer = setInterval(flushLog, 100);
	const exited = new Promise((done) => {
		child.once("exit", (code, signal) => {
			clearInterval(timer);
			flushLog();
			done({ code, signal });
		});
	});
	return {
		child,
		paths: scratch,
		mainPort: null,
		renderPort: null,
		exited,
		async stop() {
			if (child.exitCode !== null) return { code: child.exitCode };
			try {
				process.kill(-child.pid, "SIGTERM");
			} catch {
				child.kill("SIGTERM");
			}
			return Promise.race([
				exited,
				sleep(12_000).then(() => ({ timeout: true })),
			]);
		},
		async kill() {
			if (child.exitCode !== null) return { code: child.exitCode };
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
			return Promise.race([
				exited,
				sleep(5_000).then(() => ({ timeout: true })),
			]);
		},
	};
}
function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
function groupMembers(pgid) {
	try {
		return execFileSync("ps", ["-o", "pid=", "-g", String(pgid)], {
			encoding: "utf8",
		})
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

// ---- main-process reads -----------------------------------------------------

/**
 * One read of everything the window's native tree says.
 *
 * `contentView.children` is Electron's `View.children`, documented as the child
 * views of this view; on macOS that is backed by `NSView.subviews`. The owner
 * renderer is NOT in that array: the window's own webContents is the contentView
 * root's surface, so every child is above the owner page. The read records that
 * explicitly (`contentViewCtor`, `ownerWcId`) instead of assuming it, and the doc
 * states which of the two shapes the run measured.
 */
const NATIVE_READ = `(() => {
	const E = process.mainModule.require("electron");
	const w = E.BrowserWindow.getAllWindows()[0];
	if (!w) return { error: "no window" };
	const view = (v, i) => {
		let webContentsId = null, url = null, type = null, title = null, focused = null;
		try {
			const c = v.webContents;
			webContentsId = c.id;
			url = c.getURL();
			type = c.getType();
			title = c.getTitle();
			focused = c.isFocused();
		} catch (error) {
			url = "ERR " + String(error);
		}
		return {
			index: i,
			ctor: v.constructor ? v.constructor.name : null,
			bounds: v.getBounds(),
			visible: v.getVisible(),
			webContentsId, url, type, title, focused,
			isWebContentsView: typeof v.webContents === "object" && v.webContents !== null,
		};
	};
	const focused = E.webContents.getFocusedWebContents();
	return {
		at: new Date().toISOString(),
		window: {
			id: w.id,
			visible: w.isVisible(),
			focused: w.isFocused(),
			focusable: w.isFocusable(),
			bounds: w.getBounds(),
			contentBounds: w.getContentBounds(),
		},
		ownerWcId: w.webContents.id,
		contentView: {
			ctor: w.contentView.constructor ? w.contentView.constructor.name : null,
			bounds: w.contentView.getBounds(),
			visible: w.contentView.getVisible(),
			isWebContentsView: typeof w.contentView.webContents === "object" && w.contentView.webContents !== null,
		},
		focusedWebContentsId: focused ? focused.id : null,
		zoom: w.webContents.getZoomFactor(),
		children: w.contentView.children.map(view),
		allWebContents: E.webContents.getAllWebContents().map((c) => {
			try {
				return { id: c.id, type: c.getType(), url: c.getURL(), title: c.getTitle(), focused: c.isFocused() };
			} catch (error) {
				return { id: c.id, error: String(error) };
			}
		}),
	};
})()`;

async function nativeRead(mainCdp) {
	return evaluate(mainCdp, NATIVE_READ);
}

/**
 * Capture one webContents through its own `capturePage()`, retrying the two
 * measured hidden-window failure modes: the first capture can be a uniform
 * blank, and under load it can throw `UnknownVizError` from a compositor that is
 * not ready. The blank definition is the repository's (fewer than 8 distinct
 * colours or fewer than 32 pixels off the first pixel's ground), not a byte
 * floor: a byte floor measures how well the PNG compressed, not whether a frame
 * painted. Returns base64 so the probe can write the pixels itself.
 */
async function capture(mainCdp, webContentsId, label) {
	const result = await evaluate(
		mainCdp,
		`(async () => {
			const E = process.mainModule.require("electron");
			const contents = E.webContents.fromId(${Number(webContentsId)});
			if (!contents) return { ok: false, attempts: [{ error: "no webContents " + ${JSON.stringify(String(webContentsId))} }] };
			const attempts = [];
			for (let i = 0; i < 4; i += 1) {
				try {
					await new Promise((done) => setTimeout(done, 700 * (i + 1)));
					const image = await contents.capturePage();
					const bitmap = image.toBitmap();
					const ground = [bitmap[0], bitmap[1], bitmap[2]];
					const colours = new Set();
					let offGround = 0;
					for (let j = 0; j + 3 < bitmap.length; j += 4) {
						colours.add(bitmap[j] + "," + bitmap[j + 1] + "," + bitmap[j + 2]);
						if (bitmap[j] !== ground[0] || bitmap[j + 1] !== ground[1] || bitmap[j + 2] !== ground[2]) offGround += 1;
					}
					const stats = { colours: colours.size, offGround, pixels: bitmap.length / 4 };
					attempts.push({ ok: true, size: image.getSize(), stats });
					if (colours.size >= 8 && offGround >= 32) {
						return { ok: true, size: image.getSize(), stats, attempts, png: image.toPNG().toString("base64") };
					}
				} catch (error) {
					attempts.push({ ok: false, error: String(error) });
				}
			}
			return { ok: false, attempts };
		})()`,
		120_000,
	);
	event({
		event: "capture",
		label,
		webContentsId,
		ok: result?.ok ?? false,
		attempts: result?.attempts ?? [],
	});
	return result;
}

// ---- owner renderer drive ---------------------------------------------------

const INDEX_TARGET = /\/index\.html(?:[?#].*)?$/;
/** A page view is an http(s) document; the child documents are `file:` URLs. */
const HTTP_URL = /^https?:/;
/** The browser host's startup line, whose `profile` path proves the scratch partition. */
const BROWSER_PROFILE_LINE = /\[browser\] host on [^\n]*?profile (\S+?),/;

async function ownerMeasure(cdp) {
	return evaluate(
		cdp,
		`(() => {
			const rect = (el) => {
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { x: r.left, y: r.top, width: r.width, height: r.height };
			};
			const content = document.querySelector('[data-tour-tag="browser-content"]');
			const strip = document.querySelector('[data-tour-tag="browser-tab-strip"]');
			const row = document.querySelector('[data-tour-tag="browser-url-bar"]');
			const address = document.querySelector('[data-tour-tag="browser-address"]');
			return {
				content: rect(content),
				strip: rect(strip),
				row: rect(row),
				input: rect(document.querySelector('[data-tour-tag="browser-address"]')),
				address: rect(address),
				rowPresent: !!row,
				focusedRow:
					document.activeElement ===
					document.querySelector('[data-tour-tag="browser-address"]'),
				barCount: document.querySelectorAll('[data-tour-tag="browser-url-bar"]').length,
				dockCount: document.querySelectorAll('[data-address-dock-height]').length,
				hash: location.hash,
				innerWidth: window.innerWidth,
				innerHeight: window.innerHeight,
				devicePixelRatio: window.devicePixelRatio,
				activeElement: document.activeElement?.getAttribute?.('data-tour-tag') ?? document.activeElement?.tagName ?? null,
			};
		})()`,
	);
}

async function openPopout(ownerCdp) {
	await evaluate(
		ownerCdp,
		`(() => {
			const el = document.querySelector('[data-tour-tag="browser-tab"]');
			if (el) el.focus({ preventScroll: true });
			return document.activeElement?.getAttribute("data-tour-tag") ?? null;
		})()`,
	);
	await ownerCdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "l",
		code: "KeyL",
		modifiers: 4,
		windowsVirtualKeyCode: 76,
		nativeVirtualKeyCode: 76,
	});
	await ownerCdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "l",
		code: "KeyL",
		modifiers: 4,
		windowsVirtualKeyCode: 76,
		nativeVirtualKeyCode: 76,
	});
	const raised = await waitFor(
		ownerCdp,
		`document.activeElement === document.querySelector('[data-tour-tag="browser-address"]')`,
		8_000,
	);
	if (!raised) throw new Error("the address row never took focus");
}

async function pressEscape(ownerCdp) {
	await ownerCdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
		nativeVirtualKeyCode: 27,
	});
	await ownerCdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
		nativeVirtualKeyCode: 27,
	});
}

// ---- geometry ---------------------------------------------------------------

function overlap(a, b) {
	if (!a || !b) return null;
	const left = Math.max(a.x, b.x);
	const top = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	const width = Math.max(0, right - left);
	const height = Math.max(0, bottom - top);
	return { x: left, y: top, width, height, area: width * height };
}
const roundRect = (r) =>
	r === null
		? null
		: {
				x: Math.round(r.x * 100) / 100,
				y: Math.round(r.y * 100) / 100,
				width: Math.round(r.width * 100) / 100,
				height: Math.round(r.height * 100) / 100,
			};

function identify(native) {
	const text = (v) => `${v.url ?? ""} ${v.title ?? ""}`;
	const page = native.children.find(
		(v) => v.visible && HTTP_URL.test(v.url ?? ""),
	);
	const list = native.children.find((v) =>
		text(v).includes("browser-address-overlay-list.html"),
	);
	const otherVisible = native.children.filter(
		(v) => v.visible && v !== page && v !== list,
	);
	return { page, list, otherVisible };
}

// ---- composite --------------------------------------------------------------

/**
 * Compose the per-view captures at their measured DIP bounds and order.
 *
 * THIS IS NOT A SCREENSHOT of the window: no in-process API returns the AppKit
 * composite of sibling `WebContentsView`s (the owner's capturePage returns the
 * owner's own surface, and each child's returns its own). What this artifact
 * shows is what those surfaces WOULD look like stacked in the measured order at
 * the measured rectangles: the owner at the contentView origin, then each
 * visible child in `children` order. It is a constructed illustration and is
 * labelled that way everywhere it is referenced.
 */
async function composite({ native, captures, name, background = "#202020" }) {
	const ownerCapture = captures.owner;
	if (!ownerCapture?.ok) throw new Error("no owner capture to composite");
	const ownerBounds = native.contentView.bounds;
	const scale = ownerCapture.size.width / ownerBounds.width;
	const width = Math.round(native.contentView.bounds.width * scale);
	const height = Math.round(native.contentView.bounds.height * scale);
	const layers = [];
	const placed = [];
	const push = async (captureValue, bounds, label, order) => {
		if (!captureValue?.ok) return;
		const expectedWidth = Math.max(1, Math.round(bounds.width * scale));
		const expectedHeight = Math.max(1, Math.round(bounds.height * scale));
		let input = Buffer.from(captureValue.png, "base64");
		const meta = await sharp(input).metadata();
		if (
			Math.abs((meta.width ?? 0) - expectedWidth) > 1 ||
			Math.abs((meta.height ?? 0) - expectedHeight) > 1
		) {
			input = await sharp(input)
				.resize(expectedWidth, expectedHeight, { fit: "fill" })
				.png()
				.toBuffer();
		}
		layers.push({
			input,
			left: Math.round(bounds.x * scale),
			top: Math.round(bounds.y * scale),
		});
		placed.push({
			label,
			order,
			bounds: roundRect(bounds),
			pixels: { width: expectedWidth, height: expectedHeight },
		});
	};
	// The owner renderer is the contentView's own surface: it is the ground.
	await push(captures.owner, ownerBounds, "owner", 0);
	let order = 1;
	for (const child of native.children) {
		if (!child.visible) continue;
		const captureKey =
			child === captures.pageView
				? "page"
				: child === captures.listView
					? "list"
					: null;
		if (captureKey === null) continue;
		await push(
			captures[captureKey],
			child.bounds,
			captureKey === "page" ? "page" : "list",
			order,
		);
		order += 1;
	}
	const out = join(FRAMES, name);
	await sharp({ create: { width, height, channels: 4, background } })
		.composite(layers)
		.png()
		.toFile(out);
	const artifact = {
		path: `frames/${name}`,
		kind: "constructed composite — NOT an OS screenshot",
		method:
			"per-view webContents.capturePage() at measured DIP bounds and measured children order",
		scale,
		canvas: { width, height },
		layers: placed,
	};
	event({ event: "composite", artifact });
	return artifact;
}

// ---- plan -------------------------------------------------------------------

plan(
	"B1",
	"the launched app is the built tree at the recorded product source commit",
	"source+boot",
);
plan(
	"B2",
	"every path the app writes through resolves inside the scratch run, and the logger took the absolute LOG_DIR",
	"driven",
);
plan(
	"B3",
	"this run wrote nothing into the operator's real log, config or browser profile",
	"driven",
);
plan(
	"W1",
	"the window is headless: created, never shown, not focusable",
	"driven",
);
plan(
	"N1",
	"the owner's webContents is not in contentView.children; contentView is a plain View at the window's content size",
	"driven",
);
plan(
	"N2",
	"at rest the page view's native rect is the reported content rect and no visible list child is present",
	"driven",
);
plan(
	"N3",
	"at focus the row's DOM rect and the page's native rect are measured on the same stable layout (page rect unchanged before/open/after)",
	"driven",
);
plan(
	"N4",
	"the suggestion list is a native child view, visible, last in children, with native bounds",
	"driven",
);
plan(
	"N5",
	"the row rect and the page rect do not overlap; the list rect does",
	"derived",
);
plan(
	"N6",
	"each view captures non-blank pixels with its own capturePage()",
	"driven",
);
plan(
	"N7",
	"a composite built from those captures at measured bounds/order is written and labelled constructed",
	"constructed",
);
plan(
	"N8",
	"targeted mouse and key delivery is counted by each view's own main-process observer",
	"driven",
);
plan(
	"N9",
	"negative control: sendInputEvent to the owner still lands with the page view covering the point",
	"driven",
);
plan(
	"N8b",
	"a targeted click on the list's first row commits through the controller",
	"driven",
);
plan(
	"N10",
	"focus ownership is read before and after programmatic focus moves",
	"driven",
);
plan(
	"D1",
	"Escape abandons the draft, returns focus and hides the native list",
	"driven",
);
plan(
	"D2",
	"a page focus event dismisses the native list (the row stays)",
	"driven",
);
plan(
	"D3",
	"a main-frame navigation dismisses the native list (the row stays)",
	"driven",
);
plan(
	"D4",
	"opening another tab dismisses the list; the next focus raises it above the new page",
	"driven",
);
plan(
	"D4b",
	"after a later page view is added, the reopened list is last in the view order",
	"driven",
);
plan(
	"T1",
	"the launch is reaped by exact process group and the app exits",
	"driven",
);
plan(
	"I1",
	"paint order follows AppKit's addSubview rule (a subview is displayed above its siblings)",
	"inferred",
);
plan(
	"I2",
	"click target follows AppKit's last-subview-first hitTest rule",
	"inferred",
);
plan(
	"BL1",
	"native OS click routing, real IME, AX, Windows and Linux remain unmeasured",
	"blocked",
);

// ---- main -------------------------------------------------------------------

let bootHandle = null;
const facts = {
	generatedAt: at(),
	durationMs: null,
	source: "node scripts/browser-native-determination.mjs",
	platform: {
		platform: process.platform,
		arch: process.arch,
		release: process.getSystemVersion?.() ?? null,
	},
	identity: null,
	states: {},
	captures: {},
	composites: [],
	input: {},
	focus: {},
	dismissals: [],
	teardown: null,
};
const captures = {};

try {
	// ---- build identity -----------------------------------------------------
	let checkedOut = "unknown";
	let branch = "unknown";
	let dirty = "unknown";
	let productSourceCommit = "unknown";
	let productSourceClean = false;
	try {
		checkedOut = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: ROOT,
			encoding: "utf8",
		}).trim();
		branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd: ROOT,
			encoding: "utf8",
		}).trim();
		// TRACKED MODIFICATIONS ONLY, and only the paths that feed the build. The
		// probe's own files are untracked while the run happens, and `out/` is the
		// artifact itself; neither is a source change. A tracked edit to any of
		// these inputs would make the recorded hashes describe a tree that is not
		// the commit they name.
		// `scripts/` is deliberately NOT a build input: the probe and the other rigs
		// are not bundled into the app, and the probe is normally edited in the same
		// working tree that runs it. The build is the product tree below; the app
		// the evidence describes is named by the commit that last changed it, not by
		// the docs/scripts commit the probe happened to be checked out at.
		const productPaths = [
			"src",
			"resources",
			"build",
			"electron.vite.config.js",
			"package.json",
			"pnpm-lock.yaml",
		];
		dirty = execFileSync(
			"git",
			["status", "--porcelain", "--untracked-files=no", "--", ...productPaths],
			{ cwd: ROOT, encoding: "utf8" },
		).trim();
		productSourceCommit = execFileSync(
			"git",
			["log", "-1", "--format=%H", "--", ...productPaths],
			{ cwd: ROOT, encoding: "utf8" },
		).trim();
		productSourceClean =
			execFileSync(
				"git",
				[
					"status",
					"--porcelain",
					"--untracked-files=no",
					"--",
					...productPaths,
				],
				{ cwd: ROOT, encoding: "utf8" },
			).trim() === "";
	} catch (error) {
		event({ event: "identity-error", error: String(error) });
	}
	const sha = (path) =>
		createHash("sha256")
			.update(readFileSync(join(ROOT, path)))
			.digest("hex");
	const identity = {
		checkedOut,
		productSourceCommit,
		productSourceClean,
		branch,
		dirtySource: dirty,
		electron: null,
		appVersion: null,
		sha256: {
			mainIndexJs: sha("out/main/index.js"),
			mainIndexJsc: sha("out/main/index.jsc"),
			rendererIndexHtml: sha("out/renderer/index.html"),
			overlayListHtml: sha("out/renderer/browser-address-overlay-list.html"),
		},
	};
	facts.identity = identity;

	// Snapshot the operator's real state BEFORE the launch, so B3 can compare it
	// after teardown. This is a stat-only read plus a membership test for the
	// run's own launcher token.
	const realBefore = realState();
	const fixtureUrl = await startFixturePage();
	// The fixture URL carries this run's random port and appears in the app log
	// (`tab N navigated to …`), so finding it in the operator's real log would be
	// this run writing there. The launcher-pid line is a second, weaker token.
	const isolationToken = fixtureUrl;
	const launcherToken = `headless run launched by pid ${process.pid}`;
	bootHandle = await boot();
	const mainPortMatch = await waitForLog(
		/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//,
	);
	const renderPortMatch = await waitForLog(
		/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//,
	);
	bootHandle.mainPort = Number(mainPortMatch[1]);
	bootHandle.renderPort = Number(renderPortMatch[1]);

	const mainTarget = await waitForTarget(
		bootHandle.mainPort,
		(t) => t.type === "node",
	);
	const mainCdp = await connect(mainTarget.webSocketDebuggerUrl);
	// The inspector can be attached before the app's main module exists; every
	// poll fails soft so an early attach is a wait, not a failed run.
	let ready = null;
	for (let i = 0; i < 160; i += 1) {
		ready = await evaluate(
			mainCdp,
			`(() => { try { const E = process.mainModule && process.mainModule.require ? process.mainModule.require("electron") : null; const w = E ? E.BrowserWindow.getAllWindows()[0] : null; return { mainModule: !!process.mainModule, windows: E ? E.BrowserWindow.getAllWindows().length : 0, url: w ? w.webContents.getURL() : null }; } catch (error) { return { error: String(error) }; } })()`,
		).catch((error) => ({ error: String(error) }));
		if (ready && ready.windows > 0 && /index\.html/.test(ready.url ?? ""))
			break;
		await sleep(250);
	}
	if (!ready || ready.windows === 0)
		throw new Error(`the app never created a window: ${JSON.stringify(ready)}`);
	identity.electron = await evaluate(mainCdp, "process.versions.electron");
	identity.appVersion = await evaluate(
		mainCdp,
		`(() => { const E = process.mainModule.require("electron"); return { app: E.app.getVersion(), chrome: process.versions.chrome, node: process.versions.node }; })()`,
	);
	facts.platform.release = await evaluate(
		mainCdp,
		"process.mainModule.require('node:os').release()",
	);
	// The product arm logs its one line at startup; read it before B1 rather than
	// racing the logger.
	const armedMatch = await waitForLog(
		/\[address-overlay\] product chrome armed \(darwin\)/,
		20_000,
	).catch(() => null);
	const armed = armedMatch !== null;
	writeJson("build-identity.json", identity);
	record(
		"B1",
		armed && identity.dirtySource === "" && identity.productSourceClean
			? "PASS"
			: "FAIL",
		{
			checkedOut: identity.checkedOut,
			productSourceCommit: identity.productSourceCommit,
			productSourceClean: identity.productSourceClean,
			branch: identity.branch,
			dirtySource: identity.dirtySource,
			electron: identity.electron,
			appVersion: identity.appVersion,
			productChromeArmed: armed,
			sha256: identity.sha256,
		},
	);

	// The app's own answer for where it writes, plus the logger's resolved path.
	// `app.getPath("logs")` is Electron's default and is not the app's override;
	// the logger line is the authoritative one for LOCAL_OPERATOR_LOG_DIR.
	const appPaths = await evaluate(
		mainCdp,
		`(() => {
			const E = process.mainModule.require("electron");
			return {
				home: E.app.getPath("home"),
				userData: E.app.getPath("userData"),
				sessionData: E.app.getPath("sessionData"),
				electronLogs: E.app.getPath("logs"),
				env: {
					HOME: process.env.HOME,
					config: process.env.LOCAL_OPERATOR_CONFIG_DIR,
					logs: process.env.LOCAL_OPERATOR_LOG_DIR,
				},
			};
		})()`,
	);
	const underRun = (path) =>
		typeof path === "string" && (path === RUN || path.startsWith(`${RUN}/`));
	// WAIT for both lines instead of reading the log once. Measured on this rig:
	// the browser host's `profile` line lands up to ~1.2 s after logger init, and
	// a single read at ~1.1 s made B2 PASS/FAIL on launch timing (4 runs: -65 ms
	// to +265 ms). `waitForLog` exists for exactly this and is already used by the
	// boot ports and the product-arm line.
	const b2WaitStart = Date.now();
	const logWait = waitForLog(/Log path: (.+)/, 20_000).catch(() => null);
	const profileWait = (async () => {
		const started = Date.now();
		const match = await waitForLog(BROWSER_PROFILE_LINE, 20_000).catch(
			() => null,
		);
		return { match, ms: Date.now() - started };
	})();
	const [logLineMatch, profileResult] = await Promise.all([
		logWait,
		profileWait,
	]);
	const profileMatch = profileResult.match;
	const b2WaitMs = Date.now() - b2WaitStart;
	const profileLineWaitMs = profileResult.ms;
	const isolationText = logText();
	const logLine = logLineMatch ? logLineMatch[0] : null;
	const noFallback = !isolationText.includes("is not an absolute path");
	// The browser host names its partition profile on startup. That line is the
	// direct proof the Chromium profile is the scratch one; the real profile's
	// mtime is not gated because the operator's own app may write it concurrently.
	const browserProfilePath = profileMatch ? profileMatch[1] : null;
	const browserProfileLine = profileMatch ? profileMatch[0] : null;
	const browserProfileUnderRun = underRun(browserProfilePath);
	const pathsUnderRun = {
		// `app.getPath("home")` is the OS account home and is not redirected by
		// HOME; it is recorded, not gated. Every path the app writes through is
		// gated: Electron's userData/sessionData and the three overrides.
		userData: underRun(appPaths.userData),
		sessionData: underRun(appPaths.sessionData),
		envHome: underRun(appPaths.env.HOME),
		envConfig: underRun(appPaths.env.config),
		envLogs: underRun(appPaths.env.logs),
	};
	facts.isolation = {
		before: realBefore,
		token: isolationToken,
		appPaths,
		osHome: appPaths.home,
		pathsUnderRun,
		logLine,
		noFallback,
		browserProfileLine,
		browserProfilePath,
		browserProfileUnderRun,
		b2WaitMs,
		profileLineWaitMs,
		electronLogsNote:
			"Electron's default app.getPath('logs'); the app's logger override is the writer (Log path above), so this value is recorded but outside RUN and not gated",
	};
	record(
		"B2",
		Object.values(pathsUnderRun).every(Boolean) &&
			noFallback &&
			browserProfileUnderRun &&
			typeof logLine === "string" &&
			logLine.includes(bootHandle.paths.logs)
			? "PASS"
			: "FAIL",
		facts.isolation,
	);

	const ownerTarget = await waitForTarget(
		bootHandle.renderPort,
		(t) => t.type === "page" && INDEX_TARGET.test(t.url),
		30_000,
	);
	const ownerCdp = await connect(ownerTarget.webSocketDebuggerUrl);
	await ownerCdp.send("Runtime.enable");
	const ownerSocket = ownerCdp;

	let native = await nativeRead(mainCdp);
	record(
		"W1",
		native.window.visible === false && native.window.focusable === false
			? "PASS"
			: "FAIL",
		{
			window: native.window,
			contentView: native.contentView,
			ownerWcId: native.ownerWcId,
		},
	);

	// ---- drive the product browser ----------------------------------------
	// The browser surface mounts on its route, so the route comes FIRST; waiting
	// for its strip before the hash is a wait for a selector the chat route does
	// not render.
	await evaluate(ownerSocket, `location.hash = "#/browser"`);
	const browserReady = await waitFor(
		ownerSocket,
		`!!document.querySelector('[data-tour-tag="browser-tab-strip"]') && !!window.api?.browser`,
		40_000,
	);
	if (!browserReady) {
		throw new Error(
			`browser surface did not mount: ${JSON.stringify(
				await evaluate(
					ownerSocket,
					"({ hash: location.hash, text: document.body.innerText.slice(0, 300) })",
				),
			)}`,
		);
	}
	await evaluate(
		ownerSocket,
		`(async () => {
			await window.api.browser.newTab(null);
			let state = null;
			for (let i = 0; i < 100; i += 1) {
				state = await window.api.browser.state();
				if (state.tabs.length > 0 && state.activeTabId != null) break;
				await new Promise((r) => setTimeout(r, 100));
			}
			const visit = async (url) => {
				await window.api.browser.navigate(url, state.activeTabId);
				for (let i = 0; i < 120; i += 1) {
					state = await window.api.browser.state();
					if (state.url === url && !state.loading) return state;
					await new Promise((r) => setTimeout(r, 100));
				}
				throw new Error("page never settled: " + JSON.stringify(state));
			};
			// Seed the session's address history with more than one entry, then come
			// back to the fixture: the popout's list is the session's links, and a
			// one-entry history renders the empty notice instead of a row we can
			// click. The fixture stays the active page, so its rect is the one the
			// popout projects against.
			await visit(${JSON.stringify(fixtureUrl)});
			await visit(${JSON.stringify(`${pageBase}/seed-1`)});
			await visit(${JSON.stringify(`${pageBase}/seed-2`)});
			return await visit(${JSON.stringify(fixtureUrl)});
		})()`,
	);
	const pageTarget = await waitForTarget(
		bootHandle.renderPort,
		(t) => t.type === "page" && t.url.startsWith(pageBase),
		20_000,
	);
	const pageCdp = await connect(pageTarget.webSocketDebuggerUrl);
	await evaluate(pageCdp, "window.scrollTo(0, 1200)");
	await sleep(600);

	// ---- rest ----------------------------------------------------------------
	native = await nativeRead(mainCdp);
	const restOwner = await ownerMeasure(ownerSocket);
	const rest = { native, owner: restOwner, ids: identify(native) };
	facts.states.rest = rest;
	const pageViewRest = rest.ids.page;
	record(
		"N1",
		native.contentView.ctor === "View" &&
			native.contentView.isWebContentsView === false &&
			!native.children.some((v) => v.webContentsId === native.ownerWcId)
			? "PASS"
			: "FAIL",
		{
			contentView: native.contentView,
			ownerWcId: native.ownerWcId,
			ownerInChildren: native.children.some(
				(v) => v.webContentsId === native.ownerWcId,
			),
			childrenCount: native.children.length,
			note: "the owner renderer is the contentView's own surface; children are sibling views above it",
		},
	);
	record(
		"N2",
		restOwner.rowPresent === true &&
			pageViewRest &&
			Math.abs(pageViewRest.bounds.x - restOwner.content.x) <= 1 &&
			Math.abs(pageViewRest.bounds.y - restOwner.content.y) <= 1 &&
			Math.abs(pageViewRest.bounds.width - restOwner.content.width) <= 1 &&
			Math.abs(pageViewRest.bounds.height - restOwner.content.height) <= 1 &&
			!rest.ids.list?.visible
			? "PASS"
			: "FAIL",
		{
			rowPresent: restOwner.rowPresent,
			content: roundRect(restOwner.content),
			pageView: pageViewRest
				? {
						bounds: pageViewRest.bounds,
						visible: pageViewRest.visible,
						order: pageViewRest.index,
					}
				: null,
			children: native.children.map((v) => ({
				index: v.index,
				url: v.url,
				bounds: v.bounds,
				visible: v.visible,
			})),
		},
	);
	captures.owner = await capture(mainCdp, native.ownerWcId, "owner-rest");
	captures.pageView = pageViewRest;
	captures.page = pageViewRest
		? await capture(mainCdp, pageViewRest.webContentsId, "page-rest")
		: null;
	facts.captures.rest = {
		owner: captures.owner && {
			ok: captures.owner.ok,
			size: captures.owner.size,
			stats: captures.owner.stats,
			attempts: captures.owner.attempts?.length,
		},
		page: captures.page && {
			ok: captures.page.ok,
			size: captures.page.size,
			stats: captures.page.stats,
			attempts: captures.page.attempts?.length,
		},
	};
	const restComposite = await composite({
		native,
		captures: {
			owner: captures.owner,
			page: captures.page,
			pageView: captures.pageView,
		},
		name: "composite-rest.png",
	});
	facts.composites.push(restComposite);

	// ---- open ---------------------------------------------------------------
	await openPopout(ownerSocket);
	// The child is created lazily on the first show; wait for the view rather
	// than sleeping a guessed interval.
	let openNative = null;
	let openOwner = null;
	let openIds = null;
	let childPresent = false;
	for (let i = 0; i < 100; i += 1) {
		openNative = await nativeRead(mainCdp);
		openOwner = await ownerMeasure(ownerSocket);
		openIds = identify(openNative);
		childPresent = !!openIds.list?.visible && openOwner.rowPresent;
		if (childPresent) break;
		await sleep(150);
	}
	const open = { native: openNative, owner: openOwner, ids: openIds };
	facts.states.open = open;
	if (!childPresent)
		throw new Error(
			"the popout opened but no visible native list child appeared",
		);
	const pageMoved =
		pageViewRest && openIds.page
			? Math.abs(pageViewRest.bounds.x - openIds.page.bounds.x) > 1 ||
				Math.abs(pageViewRest.bounds.y - openIds.page.bounds.y) > 1 ||
				Math.abs(pageViewRest.bounds.width - openIds.page.bounds.width) > 1 ||
				Math.abs(pageViewRest.bounds.height - openIds.page.bounds.height) > 1
			: true;
	record(
		"N3",
		openOwner.rowPresent &&
			openOwner.row !== null &&
			openIds.page !== undefined &&
			openIds.page !== null &&
			pageMoved === false
			? "PASS"
			: "FAIL",
		{
			row: roundRect(openOwner.row),
			strip: roundRect(openOwner.strip),
			content: roundRect(openOwner.content),
			pageView: {
				bounds: openIds.page?.bounds ?? null,
				order: openIds.page?.index ?? null,
			},
			rowPresent: openOwner.rowPresent,
			pageMoved,
			restPageBounds: pageViewRest?.bounds ?? null,
			openPageBounds: openIds.page?.bounds ?? null,
			readMode:
				"sequential CDP reads on a stable layout; the page rect is identical before/open/after",
		},
	);
	const listAtEnd =
		openNative.children.length > 0 &&
		openNative.children[openNative.children.length - 1] === openIds.list;
	// The controller's v2 rectangle is the intersection of the strip band with
	// the page rect, starting at the page's top edge. Recomputing it from the DOM
	// strip and the measured page rect is the independent check: if main applied
	// anything else, this is where the native bounds and the projected geometry
	// disagree.
	const listAnchor =
		openOwner.strip && openIds.page
			? {
					x: Math.max(openOwner.strip.x, openIds.page.bounds.x),
					y: openIds.page.bounds.y,
					width:
						Math.min(
							openOwner.strip.x + openOwner.strip.width,
							openIds.page.bounds.x + openIds.page.bounds.width,
						) - Math.max(openOwner.strip.x, openIds.page.bounds.x),
				}
			: null;
	const listSpanMatches =
		listAnchor && openIds.list
			? Math.abs(listAnchor.x - openIds.list.bounds.x) <= 1 &&
				Math.abs(listAnchor.y - openIds.list.bounds.y) <= 1 &&
				Math.abs(listAnchor.width - openIds.list.bounds.width) <= 1
			: false;
	record(
		"N4",
		openIds.list?.visible === true && listAtEnd && listSpanMatches
			? "PASS"
			: "FAIL",
		{
			child: openIds.list
				? {
						webContentsId: openIds.list.webContentsId,
						url: openIds.list.url,
						bounds: openIds.list.bounds,
						visible: openIds.list.visible,
						order: openIds.list.index,
						visibleChildren: openNative.children
							.filter((v) => v.visible)
							.map((v) => ({ index: v.index, url: v.url })),
						childCount: openNative.children.length,
					}
				: null,
			pageMoved,
			pageBounds: openIds.page?.bounds ?? null,
			restPageBounds: pageViewRest?.bounds ?? null,
			lastVisible: listAtEnd,
			spanCheck: {
				listAnchor,
				listBounds: openIds.list?.bounds ?? null,
				listSpanMatches,
			},
		},
	);
	const popoutOverlap = overlap(openOwner.popout, openIds.page?.bounds ?? null);
	const listOverlap = overlap(
		openIds.list?.bounds ?? null,
		openIds.page?.bounds ?? null,
	);
	record(
		"N5",
		popoutOverlap &&
			popoutOverlap.area === 0 &&
			listOverlap &&
			listOverlap.area > 0
			? "PASS"
			: "FAIL",
		{
			row: roundRect(openOwner.row),
			page: openIds.page?.bounds ?? null,
			list: openIds.list?.bounds ?? null,
			popoutOverlapPage: popoutOverlap,
			listOverlapPage: listOverlap,
			stripBottom: openOwner.strip
				? openOwner.strip.y + openOwner.strip.height
				: null,
			pageTop: openIds.page?.bounds?.y ?? null,
			bandPx:
				openOwner.strip && openIds.page
					? Math.round(
							(openIds.page.bounds.y -
								(openOwner.strip.y + openOwner.strip.height)) *
								100,
						) / 100
					: null,
		},
	);

	captures.ownerOpen = await capture(
		mainCdp,
		openNative.ownerWcId,
		"owner-open",
	);
	captures.pageOpen = openIds.page
		? await capture(mainCdp, openIds.page.webContentsId, "page-open")
		: null;
	captures.listOpen = openIds.list
		? await capture(mainCdp, openIds.list.webContentsId, "list-open")
		: null;
	facts.captures.open = {
		owner: captures.ownerOpen && {
			ok: captures.ownerOpen.ok,
			size: captures.ownerOpen.size,
			stats: captures.ownerOpen.stats,
			attempts: captures.ownerOpen.attempts?.length,
		},
		page: captures.pageOpen && {
			ok: captures.pageOpen.ok,
			size: captures.pageOpen.size,
			stats: captures.pageOpen.stats,
			attempts: captures.pageOpen.attempts?.length,
		},
		list: captures.listOpen && {
			ok: captures.listOpen.ok,
			size: captures.listOpen.size,
			stats: captures.listOpen.stats,
			attempts: captures.listOpen.attempts?.length,
		},
	};
	const openComposite = await composite({
		native: openNative,
		captures: {
			owner: captures.ownerOpen,
			page: captures.pageOpen,
			pageView: openIds.page,
			list: captures.listOpen,
			listView: openIds.list,
		},
		name: "composite-open.png",
	});
	facts.composites.push(openComposite);
	const capturesOk = [
		captures.owner,
		captures.page,
		captures.ownerOpen,
		captures.pageOpen,
		captures.listOpen,
	].every((value) => value?.ok === true);
	record("N6", capturesOk && facts.composites.length === 2 ? "PASS" : "FAIL", {
		rest: facts.captures.rest,
		open: facts.captures.open,
		rule: "non-blank = >=8 distinct colours and >=32 pixels off the ground pixel; each capture is the view's own webContents.capturePage(), never a composite",
	});
	record(
		"N7",
		openComposite.layers.length >= 3 ? "PASS" : "FAIL",
		openComposite,
	);

	// ---- input delivery ------------------------------------------------------
	/**
	 * Per-view observers in the main process, then `sendInputEvent` to ONE view.
	 * This is a pipeline test, not a routing test: the target is named, so the
	 * counters say "this view receives input when addressed", never "a click at
	 * this point would choose this view". N9 measures the negative control that
	 * makes the difference explicit.
	 */
	const idsToWatch = [
		openNative.ownerWcId,
		openIds.page?.webContentsId,
		openIds.list?.webContentsId,
	].filter(Number.isInteger);
	await evaluate(
		mainCdp,
		`(() => {
			const E = process.mainModule.require("electron");
			globalThis.__nativeDetermination = { counters: {}, dom: {} };
			for (const id of ${JSON.stringify(idsToWatch)}) {
				const contents = E.webContents.fromId(id);
				if (!contents) continue;
				const counter = { mouse: 0, key: 0, mouseTypes: {}, keyTypes: {}, lastMouse: null };
				globalThis.__nativeDetermination.counters[id] = counter;
				contents.on("before-mouse-event", (_event, mouse) => {
					counter.mouse += 1;
					const type = mouse && mouse.type ? mouse.type : "?";
					counter.mouseTypes[type] = (counter.mouseTypes[type] || 0) + 1;
					counter.lastMouse = { type, x: mouse?.x ?? null, y: mouse?.y ?? null };
				});
				contents.on("before-input-event", (_event, input) => {
					counter.key += 1;
					const type = input && input.type ? input.type : "?";
					counter.keyTypes[type] = (counter.keyTypes[type] || 0) + 1;
				});
			}
			return Object.keys(globalThis.__nativeDetermination.counters).map(Number);
		})()`,
	);
	const deliver = async (webContentsId, point, keyCode = "A") => {
		await evaluate(
			mainCdp,
			`(() => {
				const E = process.mainModule.require("electron");
				const contents = E.webContents.fromId(${webContentsId});
				if (!contents) return { error: "no contents" };
				contents.sendInputEvent({ type: "mouseMove", x: ${Math.round(point.x)}, y: ${Math.round(point.y)} });
				contents.sendInputEvent({ type: "mouseDown", x: ${Math.round(point.x)}, y: ${Math.round(point.y)}, button: "left", clickCount: 1 });
				contents.sendInputEvent({ type: "mouseUp", x: ${Math.round(point.x)}, y: ${Math.round(point.y)}, button: "left", clickCount: 1 });
				contents.sendInputEvent({ type: "keyDown", keyCode: ${JSON.stringify(keyCode)} });
				contents.sendInputEvent({ type: "keyUp", keyCode: ${JSON.stringify(keyCode)} });
				return { sent: true };
			})()`,
		);
		await sleep(250);
	};
	const counters = () =>
		evaluate(
			mainCdp,
			"JSON.parse(JSON.stringify(globalThis.__nativeDetermination.counters))",
		);
	const popoutPoint = openOwner.address
		? {
				x: openOwner.address.x + openOwner.address.width / 2,
				y: openOwner.address.y + openOwner.address.height / 2,
			}
		: openOwner.popout
			? {
					x: openOwner.popout.x + 40,
					y: openOwner.popout.y + openOwner.popout.height / 2,
				}
			: { x: 300, y: 50 };
	const pagePoint = openIds.page
		? { x: openIds.page.bounds.x + 200, y: openIds.page.bounds.y + 200 }
		: { x: 500, y: 300 };
	const listPoint = openIds.list
		? { x: openIds.list.bounds.x + 80, y: openIds.list.bounds.y + 10 }
		: { x: 300, y: 80 };
	// Renderer-side counters and a DOM target read, in addition to the main-process
	// observers above. The DOM counters answer "did the surface that would receive
	// an AppKit-routed click actually process the event"; the element reads show
	// what the OWNER's DOM believes is at each point (it cannot see native
	// siblings, which is the whole reason native hit testing decides).
	const installDomCounters = (cdp) =>
		evaluate(
			cdp,
			`(() => {
				window.__nativeDom = { mousedown: 0, mouseup: 0, keydown: 0 };
				for (const type of ["mousedown", "mouseup", "keydown"]) {
					document.addEventListener(type, () => { window.__nativeDom[type] += 1; }, true);
				}
				return true;
			})()`,
		);
	await installDomCounters(ownerSocket);
	await installDomCounters(pageCdp);
	const before = await counters();
	await deliver(openNative.ownerWcId, popoutPoint);
	const afterOwner = await counters();
	await deliver(openIds.page.webContentsId, { x: 200, y: 200 });
	const afterPage = await counters();
	await deliver(openIds.list.webContentsId, { x: 80, y: 10 });
	const afterList = await counters();
	const ownerDom = await evaluate(ownerSocket, "(() => window.__nativeDom)()");
	const pageDom = await evaluate(pageCdp, "(() => window.__nativeDom)()");
	const ownerElements = await evaluate(
		ownerSocket,
		`(() => {
			const at = (point) => {
				const el = document.elementFromPoint(point.x, point.y);
				if (!el) return null;
				const tagged = el.closest("[data-tour-tag]");
				return { tag: el.tagName.toLowerCase(), tour: tagged ? tagged.getAttribute("data-tour-tag") : null };
			};
			return {
				popout: at(${JSON.stringify(popoutPoint)}),
				page: at(${JSON.stringify(pagePoint)}),
				list: at(${JSON.stringify(listPoint)}),
			};
		})()`,
	);
	const pageElement = await evaluate(
		pageCdp,
		`(() => { const el = document.elementFromPoint(200, 200); return el ? { tag: el.tagName.toLowerCase(), text: (el.textContent || "").slice(0, 40) } : null; })()`,
	);
	const domFacts = {
		owner: ownerDom,
		page: pageDom,
		ownerElements,
		pageElement,
	};
	// Negative control: address the OWNER at a point the page view covers. If the
	// owner's counter moves, the probe is bypassing native routing, which is the
	// whole reason I2 is an inference.
	await deliver(openNative.ownerWcId, pagePoint, "B");
	const afterOverlap = await counters();
	facts.input = {
		points: {
			popout: popoutPoint,
			pageInside: pagePoint,
			listHeader: listPoint,
		},
		ids: {
			owner: openNative.ownerWcId,
			page: openIds.page?.webContentsId ?? null,
			list: openIds.list?.webContentsId ?? null,
		},
		counters: {
			before,
			afterOwner,
			afterPage,
			afterList,
			afterOwnerAtPagePoint: afterOverlap,
		},
	};
	const delta = (from, to, id) => ({
		mouse: (to[id]?.mouse ?? 0) - (from[id]?.mouse ?? 0),
		key: (to[id]?.key ?? 0) - (from[id]?.key ?? 0),
	});
	const ownerDelta = delta(before, afterOwner, openNative.ownerWcId);
	const pageDelta = delta(afterOwner, afterPage, openIds.page?.webContentsId);
	const listDelta = delta(afterPage, afterList, openIds.list?.webContentsId);
	const overlapDelta = delta(afterList, afterOverlap, openNative.ownerWcId);
	record(
		"N8",
		ownerDelta.mouse >= 1 &&
			ownerDelta.key >= 1 &&
			pageDelta.mouse >= 1 &&
			pageDelta.key >= 1 &&
			listDelta.mouse >= 1 &&
			listDelta.key >= 1 &&
			ownerDom.mousedown >= 1 &&
			ownerDom.keydown >= 1 &&
			pageDom.mousedown >= 1 &&
			pageDom.keydown >= 1
			? "PASS"
			: "FAIL",
		{
			owner: ownerDelta,
			page: pageDelta,
			list: listDelta,
			ownerDom,
			pageDom,
			ownerElements,
			pageElement,
			dom: domFacts,
			note: "targeted sendInputEvent per view; main-process before-mouse/before-input observations plus the renderer DOM counters",
		},
	);
	record("N9", overlapDelta.mouse >= 1 ? "PASS" : "FAIL", {
		ownerAtPointInsidePage: overlapDelta,
		pageCounterUnchanged: delta(
			afterList,
			afterOverlap,
			openIds.page?.webContentsId,
		),
		note: "the owner accepted a click at a point the page view covers, so sendInputEvent addresses a webContents and does not exercise AppKit hit testing",
	});

	// A CLICK THAT DOES SOMETHING, not just a counter. Filter the list to the
	// seeded history first (`/seed` matches the two seed URLs), select the draft,
	// and type the query the way a user would; the full live URL happens to match
	// nothing in the suggestion model, which is the empty notice S4b's V5 covers.
	// The row's own document rect is the point, not arithmetic over the header
	// constants: the child is the only thing that knows where its rows rendered.
	// `before-mouse-event` coordinates are document-relative (the controller's own
	// probeClick comment carries that measurement), so no origin correction is
	// applied.
	await openPopout(ownerSocket);
	await ownerSocket.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "a",
		code: "KeyA",
		modifiers: 4,
		windowsVirtualKeyCode: 65,
		nativeVirtualKeyCode: 65,
	});
	await ownerSocket.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "a",
		code: "KeyA",
		modifiers: 4,
		windowsVirtualKeyCode: 65,
		nativeVirtualKeyCode: 65,
	});
	await ownerSocket.send("Input.insertText", { text: `${pageBase}/seed` });
	await sleep(800);
	const candidateCount = await evaluate(
		ownerSocket,
		`Number(document.querySelector('[data-tour-tag="browser-address"]')?.getAttribute('data-address-candidates') ?? -1)`,
	);
	const rowRect = await evaluate(
		mainCdp,
		`(async () => {
			const E = process.mainModule.require("electron");
			const contents = E.webContents.fromId(${openIds.list.webContentsId});
			if (!contents) return null;
			return await contents.executeJavaScript("(() => { const host = document.getElementById('address-list-rows'); const rows = host ? [...host.children] : []; const r = rows[0] ? rows[0].getBoundingClientRect() : null; const root = document.getElementById('address-list-root'); const notice = document.getElementById('address-list-notice'); return { x: r ? r.x : null, y: r ? r.y : null, width: r ? r.width : null, height: r ? r.height : null, count: rows.length, view: root ? root.dataset.view ?? null : null, url: rows[0] ? (rows[0].querySelector('.lo-row-text')?.textContent ?? null) : null, notice: notice ? notice.textContent : null, body: document.body.innerText.slice(0, 200), htmlLength: host ? host.innerHTML.length : null }; })()");
		})()`,
	);
	const rowPoint =
		rowRect && rowRect.width > 0
			? {
					x: Math.round(rowRect.x + rowRect.width / 2),
					y: Math.round(rowRect.y + rowRect.height / 2),
				}
			: { x: 80, y: 48 };
	await deliver(openIds.list.webContentsId, rowPoint);
	await sleep(1_500);
	const afterCommit = await evaluate(
		ownerSocket,
		`(async () => ({ state: await window.api.browser.state(), rowPresent: !!document.querySelector('[data-tour-tag="browser-url-bar"]'), focusedRow: document.activeElement === document.querySelector('[data-tour-tag="browser-address"]') }))()`,
	);
	const afterCommitNative = identify(await nativeRead(mainCdp));
	const listCounter = (await counters())[String(openIds.list.webContentsId)];
	const rowUrl = rowRect?.url ?? null;
	facts.rowCommit = {
		candidateCount,
		rowRect,
		rowUrl,
		point: rowPoint,
		lastMouse: listCounter?.lastMouse ?? null,
		rowPresent: afterCommit.rowPresent,
		focusedRow: afterCommit.focusedRow,
		listVisible: afterCommitNative.list?.visible ?? false,
		url: afterCommit.state?.url ?? null,
		loading: afterCommit.state?.loading ?? null,
	};
	record(
		"N8b",
		rowUrl !== null &&
			afterCommit.state?.url === rowUrl &&
			afterCommit.focusedRow === false &&
			!(afterCommitNative.list?.visible ?? false)
			? "PASS"
			: "FAIL",
		facts.rowCommit,
	);

	const focusRead = () =>
		evaluate(
			mainCdp,
			`(() => {
				const E = process.mainModule.require("electron");
				const w = E.BrowserWindow.getAllWindows()[0];
				return {
					windowFocused: w.isFocused(),
					focusedWindow: E.BrowserWindow.getFocusedWindow() ? E.BrowserWindow.getFocusedWindow().id : null,
					focusedWebContents: E.webContents.getFocusedWebContents() ? E.webContents.getFocusedWebContents().id : null,
					views: w.contentView.children.map((v) => {
						try { return { id: v.webContents.id, isFocused: v.webContents.isFocused(), url: v.webContents.getURL() }; }
						catch (error) { return { error: String(error) }; }
					}),
					ownerFocused: w.webContents.isFocused(),
				};
			})()`,
		);
	const focus = { atRest: await focusRead() };
	await evaluate(
		mainCdp,
		`(() => { const E = process.mainModule.require("electron"); const w = E.BrowserWindow.getAllWindows()[0]; w.webContents.focus(); return true; })()`,
	);
	await sleep(300);
	focus.afterOwnerFocus = await focusRead();
	await evaluate(
		mainCdp,
		`(() => { const E = process.mainModule.require("electron"); const ids = ${JSON.stringify(idsToWatch)}; const w = E.BrowserWindow.getAllWindows()[0]; const target = w.contentView.children.find((v) => v.webContents && v.webContents.id === ${openIds.page.webContentsId}); if (target) target.webContents.focus(); return !!target; })()`,
	);
	await sleep(400);
	focus.afterPageFocus = await focusRead();
	await evaluate(
		mainCdp,
		`(() => { const E = process.mainModule.require("electron"); const w = E.BrowserWindow.getAllWindows()[0]; w.webContents.focus(); return true; })()`,
	);
	await sleep(250);
	facts.focus = focus;
	record("N10", "MEASURED", {
		windowFocused: focus.atRest.windowFocused,
		headlessNote:
			"the window is not key, so native focus ownership cannot be exercised by an OS click here",
		atRest: focus.atRest,
		afterOwnerFocus: focus.afterOwnerFocus,
		afterPageFocus: focus.afterPageFocus,
	});

	// ---- dismissal matrix ----------------------------------------------------
	const stateAfter = async (label, action) => {
		await openPopout(ownerSocket);
		// Wait for the native child to be visible before the dismissal, so the
		// post-state is a transition and not a no-op.
		let beforeDismiss = null;
		for (let i = 0; i < 80; i += 1) {
			beforeDismiss = await nativeRead(mainCdp);
			const ids = identify(beforeDismiss);
			if (ids.list?.visible) break;
			await sleep(120);
		}
		const beforeOwner = await ownerMeasure(ownerSocket);
		await action();
		await sleep(800);
		const afterNative = await nativeRead(mainCdp);
		const afterOwner = await ownerMeasure(ownerSocket);
		const afterIds = identify(afterNative);
		const entry = {
			label,
			before: {
				rowPresent: beforeOwner.rowPresent,
				focusedRow: beforeOwner.focusedRow,
				listVisible: identify(beforeDismiss).list?.visible ?? false,
				listOrder: identify(beforeDismiss).list?.index ?? null,
			},
			after: {
				rowPresent: afterOwner.rowPresent,
				focusedRow: afterOwner.focusedRow,
				listVisible: afterIds.list?.visible ?? false,
				pageBounds: afterIds.page?.bounds ?? null,
			},
			focusReturned: beforeOwner.focusedRow && !afterOwner.focusedRow,
			childHidden: !(afterIds.list?.visible ?? false),
			pageUnmoved:
				pageViewRest && afterIds.page
					? Math.abs(pageViewRest.bounds.x - afterIds.page.bounds.x) <= 1 &&
						Math.abs(pageViewRest.bounds.y - afterIds.page.bounds.y) <= 1 &&
						Math.abs(pageViewRest.bounds.width - afterIds.page.bounds.width) <=
							1 &&
						Math.abs(
							pageViewRest.bounds.height - afterIds.page.bounds.height,
						) <= 1
					: null,
		};
		// Reopen cleanly for the next row; Escape is the documented dismissal.
		if (afterOwner.focusedRow) {
			await pressEscape(ownerSocket);
			await sleep(400);
		}
		return entry;
	};
	const dismissals = [];
	dismissals.push(
		await stateAfter("Escape", async () => {
			await pressEscape(ownerSocket);
		}),
	);
	record(
		"D1",
		dismissals[0].focusReturned &&
			dismissals[0].childHidden &&
			dismissals[0].pageUnmoved !== false
			? "PASS"
			: "FAIL",
		dismissals[0],
	);
	dismissals.push(
		await stateAfter("page_focus", async () => {
			await evaluate(
				mainCdp,
				`(() => { const E = process.mainModule.require("electron"); const w = E.BrowserWindow.getAllWindows()[0]; const target = w.contentView.children.find((v) => v.webContents && v.webContents.id === ${openIds.page.webContentsId}); if (!target) return false; target.webContents.focus(); return true; })()`,
			);
		}),
	);
	const d2 = dismissals[1];
	const d2Measured =
		d2.focusReturned && d2.childHidden && d2.pageUnmoved !== false;
	record("D2", d2.focusReturned ? (d2Measured ? "PASS" : "FAIL") : "BLOCKED", {
		...d2,
		blockedReason: d2.focusReturned
			? null
			: "headless/unfocused window: the page view's native focus event did not fire, so the page-focus dismissal has no native trigger here",
	});
	dismissals.push(
		await stateAfter("navigation", async () => {
			await evaluate(
				ownerSocket,
				`(async () => {
					const state = await window.api.browser.state();
					await window.api.browser.navigate(${JSON.stringify(`${pageBase}/next`)}, state.activeTabId);
					for (let i = 0; i < 80; i += 1) {
						const next = await window.api.browser.state();
						if (next.url.startsWith(${JSON.stringify(`${pageBase}/next`)}) && !next.loading) return next;
						await new Promise((r) => setTimeout(r, 100));
					}
					return null;
				})()`,
			);
		}),
	);
	record(
		"D3",
		dismissals[2].focusReturned && dismissals[2].childHidden ? "PASS" : "FAIL",
		dismissals[2],
	);
	dismissals.push(
		await stateAfter("new_tab", async () => {
			await evaluate(ownerSocket, "window.api.browser.newTab(null)");
			await sleep(500);
		}),
	);
	record(
		"D4",
		dismissals[3].focusReturned && dismissals[3].childHidden ? "PASS" : "FAIL",
		dismissals[3],
	);
	facts.dismissals = dismissals;

	// A new tab is a later child of the content view, so it sits above the overlay
	// list until the controller re-adds the list on the next show. Give that tab a
	// real page first: the start page hides the native view, and a popout with no
	// page rect has nothing to project over.
	await evaluate(
		ownerSocket,
		`(async () => {
			const state = await window.api.browser.state();
			await window.api.browser.navigate(${JSON.stringify(`${pageBase}/after-new-tab`)}, state.activeTabId);
			for (let i = 0; i < 100; i += 1) {
				const next = await window.api.browser.state();
				if (next.url.startsWith(${JSON.stringify(`${pageBase}/after-new-tab`)}) && !next.loading) return next;
				await new Promise((r) => setTimeout(r, 100));
			}
			return null;
		})()`,
	);
	await sleep(400);

	// The next open after a page view was created later must raise the list above
	// the new page, which is the controller's `addChildView` re-add.
	await openPopout(ownerSocket);
	let reRaised = null;
	for (let i = 0; i < 100; i += 1) {
		const read = await nativeRead(mainCdp);
		const ids = identify(read);
		if (ids.list?.visible && ids.page) {
			const visibleIndices = read.children
				.map((v, index) => (v.visible ? index : -1))
				.filter((index) => index >= 0);
			reRaised = {
				listOrder: ids.list.index,
				visibleIndices,
				lastVisible: Math.max(...visibleIndices),
				pageOrder: ids.page.index,
				listBounds: ids.list.bounds,
				pageBounds: ids.page.bounds,
			};
			break;
		}
		await sleep(150);
	}
	facts.reRaised = reRaised;
	record(
		"D4b",
		reRaised &&
			reRaised.listOrder === reRaised.lastVisible &&
			reRaised.listOrder > reRaised.pageOrder
			? "PASS"
			: "FAIL",
		reRaised ?? { error: "the popout did not reopen over the later page" },
	);
	await pressEscape(ownerSocket);
	await sleep(300);

	// ---- teardown ------------------------------------------------------------
	// Quit through the app's own path first. The Node inspector is a live client:
	// an attached socket keeps the main process alive after `app.quit()`
	// ("Waiting for the debugger to disconnect..."), so both sockets are closed
	// BEFORE the exit is awaited. SIGTERM is the fallback, SIGKILL the last resort.
	const quit = await evaluate(
		mainCdp,
		`(() => { process.mainModule.require("electron").app.quit(); return "quit requested"; })()`,
	).catch((error) => `quit failed: ${String(error)}`);
	ownerSocket.close();
	mainCdp.close();
	const natural = await Promise.race([
		bootHandle.exited.then((value) => ({ exited: value })),
		sleep(8_000).then(() => ({ timeout: true })),
	]);
	facts.teardown = {
		quitRequested: quit,
		natural,
		pid: bootHandle.child.pid,
		groupAfterQuit: groupMembers(bootHandle.child.pid),
	};
	if (natural.timeout) {
		const exit = await bootHandle.stop();
		facts.teardown.stop = exit;
		facts.teardown.groupAfterStop = groupMembers(bootHandle.child.pid);
		if (exit?.timeout) {
			const killed = await bootHandle.kill();
			facts.teardown.kill = killed;
			facts.teardown.groupAfterKill = groupMembers(bootHandle.child.pid);
		}
	}
	facts.teardown.aliveAfter = pidAlive(bootHandle.child.pid);
	facts.teardown.groupAliveAfter = groupMembers(bootHandle.child.pid).length;
	writeJson("teardown.json", facts.teardown);
	record(
		"T1",
		facts.teardown.aliveAfter === false && facts.teardown.groupAliveAfter === 0
			? "PASS"
			: "FAIL",
		facts.teardown,
	);

	// ---- real-state control --------------------------------------------------
	// The re-run's proof is two independent readings: the app's logger took the
	// absolute scratch LOG_DIR (B2), and no file under the real log dir carries
	// this run's unique launcher token. The stat comparison is recorded too, but
	// it is not gated on the logs dir: the operator's own app may write there
	// concurrently, and that is not this run's write.
	const realAfter = realState();
	const tokenHits = realLogTokenHits(isolationToken);
	const launcherHits = realLogTokenHits(launcherToken);
	const unchanged = {
		logsDir:
			JSON.stringify(facts.isolation.before.logsDir) ===
			JSON.stringify(realAfter.logsDir),
		config:
			JSON.stringify(facts.isolation.before.config) ===
			JSON.stringify(realAfter.config),
		profile:
			JSON.stringify(facts.isolation.before.profile) ===
			JSON.stringify(realAfter.profile),
	};
	facts.isolation = {
		...facts.isolation,
		after: realAfter,
		unchanged,
		tokenHits,
		launcherHits,
	};
	writeJson("isolation.json", facts.isolation);
	const b3Ok =
		tokenHits.hits === 0 &&
		(launcherHits.hits ?? 0) === 0 &&
		unchanged.config &&
		facts.isolation.browserProfileUnderRun;
	// `unchanged.profile` is recorded but not gated: the operator's own app may
	// write the real Chromium profile while this run is in flight. The scratch
	// profile is proved by the app's own `[browser] host ... profile` line (B2).
	record(
		"B3",
		tokenHits.hits === null ? "BLOCKED" : b3Ok ? "PASS" : "FAIL",
		facts.isolation,
	);

	// ---- conclusions, recorded as the plan's own rows -----------------------
	record("I1", "INFERRED", {
		rule: 'AppKit NSView.addSubview(_:): a subview is "displayed above its siblings"; the measured order puts the list after the page',
		measuredInputs: {
			row: roundRect(openOwner.row),
			pageBounds: openIds.page?.bounds ?? null,
			listBounds: openIds.list?.bounds ?? null,
			children: openNative.children.map((v) => ({
				index: v.index,
				url: v.url,
				bounds: v.bounds,
				visible: v.visible,
			})),
		},
		whyNotMeasured:
			"no in-process API returns the composited window pixels; capturePage() returns each surface alone",
	});
	record("I2", "INFERRED", {
		rule: "AppKit hitTest: the farthest descendant containing the point wins; hit testing starts at the last subview and works backwards; hidden views are ignored",
		points: {
			fieldRow: popoutPoint,
			listHeader: listPoint,
			page: pagePoint,
		},
		predictedTargets: {
			fieldRow:
				"owner renderer (the page view starts at the strip's bottom edge)",
			listHeader:
				"overlay list child (last visible subview; its bounds contain the point)",
			page: "page view",
		},
		whyNotMeasured:
			"synthesising an OS click needs Accessibility permission, which the repository forbids; sendInputEvent addresses one webContents and the N9 control proves it bypasses sibling hit testing",
	});
	record(
		"BL1",
		"BLOCKED",
		"native OS click routing, real macOS IME, VoiceOver/AX, Windows and Linux are unmeasured; a silent non-composite (F7) cannot be observed from inside the app",
	);

	facts.durationMs = Date.now() - T0;
	facts.rows = rows;
	writeJson("native-views.json", {
		identity,
		rest: facts.states.rest?.native ?? null,
		open: facts.states.open?.native ?? null,
		owner: {
			rest: facts.states.rest?.owner ?? null,
			open: facts.states.open?.owner ?? null,
		},
		reRaised,
	});
	writeJson("facts.json", facts);
	const header = [
		"| Row | Claim | Mode | Status | Actual evidence |",
		"| --- | --- | --- | --- | --- |",
	];
	const body = rows.map(
		(row) =>
			`| ${row.id} | ${row.claim} | ${row.mode} | ${row.status} | ${row.evidence.replace(/\|/g, "\\|")} |`,
	);
	writeFileSync(
		join(OUT, "matrix.md"),
		`${header.concat(body).join("\n")}\n\nAt least one driven row passed; read FAIL and BLOCKED rows before claiming the slice.\n\nLimitation: the native click routing, composite pixels, real IME, AX and non-darwin rows are not measured; see the determination doc.\n`,
	);
	// raw pixels, for a reader who wants to inspect the surfaces themselves
	for (const [key, value] of Object.entries({
		"owner-rest.png": captures.owner,
		"page-rest.png": captures.page,
		"owner-open.png": captures.ownerOpen,
		"page-open.png": captures.pageOpen,
		"list-open.png": captures.listOpen,
	})) {
		if (value?.ok)
			writeFileSync(join(FRAMES, key), Buffer.from(value.png, "base64"));
	}
	const frameLines = [
		"# Frames",
		"",
		"Pixels are ignored by git (`.gitignore` rule for `docs/evidence/**/*.png`) and are",
		"regenerated by the probe. They are NOT an OS screenshot: each is one view's own",
		"`webContents.capturePage()`; `composite-*.png` is constructed from those captures at the",
		"measured DIP bounds and measured child order. See the composite records in `facts.json`.",
		"",
	];
	for (const file of [
		"owner-rest.png",
		"page-rest.png",
		"owner-open.png",
		"page-open.png",
		"list-open.png",
		"composite-rest.png",
		"composite-open.png",
	]) {
		if (existsSync(join(FRAMES, file))) frameLines.push(`- frames/${file}`);
	}
	writeFileSync(join(OUT, "frames.md"), `${frameLines.join("\n")}\n`);

	log("done", `${facts.durationMs}ms`);
} catch (error) {
	event({ event: "fatal", error: String(error) });
	facts.fatal = String(error);
	facts.rows = rows;
	facts.durationMs = Date.now() - T0;
	writeJson("facts.json", facts);
	console.error("[native] FATAL", error);
	process.exitCode = 1;
} finally {
	flushLog();
	if (
		bootHandle &&
		bootHandle.child.exitCode === null &&
		facts.teardown?.aliveAfter !== false
	) {
		const result = await bootHandle.stop();
		if (facts.teardown) facts.teardown.stop = result;
		if (result?.timeout) await bootHandle.kill();
	}
	if (pageServer) pageServer.close();
}
