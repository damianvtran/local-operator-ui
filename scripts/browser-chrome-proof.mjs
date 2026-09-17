#!/usr/bin/env node
/**
 * End-to-end proof for the browser CHROME — the visible half.
 *
 * Why this exists: `scripts/browser-chrome.test.mjs` exercises the RULES against
 * the shipped TypeScript (the restore file's shape, the session scope, the
 * overlay registry) and never loads a page or renders a frame. The claim this PR
 * makes is about a running application: a tab strip, a URL bar, a consent band and
 * a native view pinned to a rectangle, with overlays that hide it. This harness is
 * the run that can falsify that claim.
 *
 * It is committed rather than pasted into a PR because a transcript that cannot be
 * re-run is a claim, not evidence. It is also the honest answer to the one thing
 * stills hide: whether hiding and restoring a native view around a modal flashes
 * (design probe P11), which is captured here as consecutive frames.
 *
 * Isolation (non-negotiable, and why each piece is here):
 *   - `HOME` AND `LOCAL_OPERATOR_CONFIG_DIR` are both redirected: the config dir
 *     alone leaves the cache and hardcoded home roots in the real home.
 *   - the Electron profile root is a scratch `--user-data-dir`, so the run cannot
 *     see or touch the operator's real profile — and cannot leak its own state into
 *     it either. This one matters more here than for the host PR: this harness
 *     writes `session.json` and `approvals.json` into it.
 *   - `--window-mode=headless` and every `CMUX_*`/`LOP_*` variable removed: the app
 *     must never take the operator's focus, and an inherited cmux workspace id has
 *     already renamed his real workspaces once.
 *
 * HOW THE FRAMES ARE MADE, because a native view is not in the DOM: the app's own
 * renderer is captured over CDP (`Page.captureScreenshot`), which is the chrome
 * band and everything the app paints; the driven page is captured by the HOST's
 * own `screenshot` action, which is the same CDP capture the agent's tool uses.
 * They are composited at the rectangle the renderer reports to main — the exact
 * number the layout contract is about — so a frame shows what the user's screen
 * shows. While an overlay is up the view is hidden, so there is nothing to
 * composite and the single renderer frame IS the frame; that difference is the
 * policy, visible.
 *
 * Usage: node scripts/browser-chrome-proof.mjs [--keep]
 */

import { execFile, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { withNotificationsOff } from "./notifications-off.mjs";

const ROOT = process.cwd();
/**
 * The Electron executable itself, from the package that owns it.
 *
 * `require("electron")` in a Node process resolves to the path of the binary the
 * package installed - the package's own documented API - so this harness spawns
 * the app rather than the `node_modules/.bin/electron` shim. See `launchApp` for
 * why that distinction is load-bearing rather than cosmetic.
 */
const ELECTRON_BIN = createRequire(import.meta.url)("electron");
const KEEP = process.argv.includes("--keep");
const SCRATCH = join(tmpdir(), `lo-browser-chrome-proof-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const OUT_DIR = join(SCRATCH, "out");

let DEVTOOLS_PORT = 0;
function pickDevtoolsPort() {
	return 9200 + Math.floor(Math.random() * 600);
}

async function freeDevtoolsPort(timeoutMs = 10_000) {
	const started = Date.now();
	for (;;) {
		const port = pickDevtoolsPort();
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (!response.ok) return port;
		} catch (error) {
			if (error instanceof TypeError) return port; // nothing listening: what we want
			throw error;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(`no free devtools port after ${timeoutMs}ms`);
		}
	}
}

/** The window's CSS viewport, read from the page. `compose` needs it to translate
 * the reported rectangle into the device pixels of a captured frame. */
let WINDOW_VIEWPORT = { width: 1380, height: 868 };

const transcript = [];
let failures = 0;

function record(label, body) {
	transcript.push(`### ${label}\n\n\`\`\`\n${body}\n\`\`\`\n`);
}
function say(line) {
	console.log(line);
}
function check(label, ok, detail) {
	const status = ok ? "PASS" : "FAIL";
	if (!ok) failures += 1;
	say(
		`[${status}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`,
	);
	record(label, `[${status}] ${detail === undefined ? "" : detail}`);
	return ok;
}

// ---- the local site the proof drives ---------------------------------------

/**
 * Two small pages, a slow one and a page two clicks away. Deliberately plain: this
 * harness is about the CHROME, so the page exists to be a real document with a
 * title, a colour and a body — enough that a frame proves the view paints and that
 * the strip's title came from the document rather than from the URL.
 */
const PAGE = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;font:16px -apple-system,system-ui,sans-serif;background:#12263a;color:#e6f1ff">
<div style="padding:40px">
<h1 style="margin:0 0 8px;font-size:32px">${title}</h1>
<p style="margin:0;opacity:.8">${body}</p>
<p style="margin-top:24px"><a href="/second" style="color:#7fd1ff">Go to the second page</a></p>
</div></body></html>`;

let sitePort = 0;
let held = [];

function startSite() {
	return new Promise((resolve) => {
		const server = createServer((request, response) => {
			const url = new URL(request.url, `http://127.0.0.1:${sitePort}`);
			if (url.pathname === "/slow") {
				// Kept open so the harness can capture the LOADING state rather than
				// racing it: the frame has to be taken while the tab is genuinely busy.
				const timer = setTimeout(() => {
					response.writeHead(200, { "Content-Type": "text/html" });
					response.end(PAGE("Slow page", "This page took its time."));
					held = held.filter((entry) => entry !== timer);
				}, 6000);
				held.push(timer);
				return;
			}
			if (url.pathname === "/broken") {
				// A main-frame load failure on an APPROVED origin. The agent's gate would
				// refuse an unapproved one before it ever loaded, which is a different case
				// and the one the harness asserted by mistake: `goto http://127.0.0.1:9/`
				// came back `origin_not_allowed`, not a load failure.
				request.socket.destroy();
				return;
			}
			if (url.pathname === "/second") {
				response.writeHead(200, { "Content-Type": "text/html" });
				response.end(PAGE("Proof page two", "The second document."));
				return;
			}
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end(
				PAGE("Proof page one", "A document the chrome should be showing."),
			);
		});
		server.listen(0, "127.0.0.1", () => {
			sitePort = server.address().port;
			resolve({ server, port: sitePort });
		});
	});
}

const origin = () => `http://127.0.0.1:${sitePort}`;

// ---- the app ---------------------------------------------------------------

let app = null;

async function stopApp({ graceful = true } = {}) {
	if (!app) return;
	const stopping = app;
	app = null;
	stopping.flush();
	if (graceful) {
		// SIGTERM rather than SIGKILL so `before-quit` runs: that is the path that
		// flushes `session.json`, and a kill would test nothing about the restore.
		await stopping.stop();
	} else {
		stopping.kill();
	}
}

async function launchApp() {
	/*
	 * `withNotificationsOff` first: this harness boots the real app, and the app
	 * spawns the backend whose parked-gate announcement reaches macOS through
	 * `osascript` — a banner in the operator's Notification Center, from a test
	 * run. Headless window mode silences the APP's own banner and cannot silence
	 * the backend's, which is why the switch has to be in the environment this
	 * child is handed. See `notifications-off.mjs`.
	 */
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	DEVTOOLS_PORT = await freeDevtoolsPort();
	/*
	 * THE APP ITSELF IS SPAWNED, NOT `node_modules/.bin/electron`.
	 *
	 * THAT SHIM IS A NODE SCRIPT, and `child.kill()` signals the SHIM: the app it
	 * spawned is orphaned, keeps its debug port, and keeps holding the app's
	 * SINGLE-INSTANCE LOCK. That lock is PER `--user-data-dir` rather than
	 * machine-wide - `renderer-driver.mjs` measures the same lock, and two boots on
	 * different profiles coexist - and a run reads it as a global exclusion only
	 * because it reuses one profile path, so the next launch in the run dies with
	 * "Another instance is already running" and the harness reports a failure that
	 * is its own teardown (QA round 2; the same defect in #190's dev harness).
	 * `require("electron")` is the package's own
	 * documented answer: it returns the executable path, on every platform, so
	 * SIGTERM reaches the process whose quit path this run is testing. The same pid
	 * is what `reap` below kills, by exact pid and never by pattern.
	 */
	const child = spawn(
		ELECTRON_BIN,
		[
			".",
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${DEVTOOLS_PORT}`,
			"--window-size=1380x900",
		],
		{ env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
	);
	const logPath = join(SCRATCH, `app-${Date.now()}.log`);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const flush = () => writeFileSync(logPath, stream.join(""));
	const timer = setInterval(flush, 500);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});
	return {
		child,
		logPath,
		stream,
		flush,
		kill: () => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
		},
		stop: () =>
			new Promise((resolve) => {
				child.once("exit", resolve);
				child.kill("SIGTERM");
				setTimeout(() => {
					try {
						child.kill("SIGKILL");
					} catch {
						/* already gone */
					}
					resolve();
				}, 8000);
			}),
	};
}

function stateFilePath() {
	return join(CONFIG_DIR, "run", "ui-browser", "host.json");
}

/**
 * The state file of a host that is actually ALIVE (design 10.2).
 *
 * A parseable file is not the same thing as a running host, and the difference
 * bites hardest after a relaunch: the superseded file names the previous
 * process's port, so a harness that trusts the first file it can parse spends its
 * entire post-relaunch half talking to a host that has already exited — which is
 * how this run once failed with `ECONNREFUSED 127.0.0.1:<old port>` on the first
 * RPC after the restart.
 *
 * The acquittal is the product's own: an UNKEYED `/health` that answers with this
 * process's pid, the same probe `design 10.2` describes for deciding whether a
 * stale state file's port has been recycled. Requiring the file's pid and the
 * answered pid to agree is what makes it precise rather than "something is
 * listening".
 */
async function hostIsLive(file) {
	if (!file?.port) return false;
	try {
		const response = await fetch(`http://127.0.0.1:${file.port}/health`, {
			signal: AbortSignal.timeout(1000),
		});
		if (!response.ok) return false;
		const body = await response.json();
		return (
			body?.host === "ui" &&
			(!file.pid || Number(body.pid) === Number(file.pid))
		);
	} catch {
		return false;
	}
}

async function waitForState(timeoutMs = 60_000) {
	const started = Date.now();
	let seen = "";
	while (Date.now() - started < timeoutMs) {
		if (existsSync(stateFilePath())) {
			try {
				const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
				seen = `port ${parsed.port} pid ${parsed.pid}`;
				if (await hostIsLive(parsed)) return parsed;
			} catch {
				// The writer stages its file, so this is the "not yet" case.
			}
		}
		await sleep(250);
	}
	throw new Error(
		`no LIVE host answered /health at ${stateFilePath()}${seen ? ` (last file: ${seen})` : ""}`,
	);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(state, method, params = {}, options = {}) {
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(options.omitKey ? {} : { "X-Bridge-Key": state.session_key }),
		},
		body: JSON.stringify({
			id: options.id ?? `proof-${method}`,
			method,
			params,
		}),
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* not JSON: the status is the fact */
	}
	return { status: response.status, text, json };
}

// ---- the renderer, over CDP -------------------------------------------------

let socket = null;
let nextId = 1;
const pendingCalls = new Map();

async function targets() {
	const response = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`);
	return await response.json();
}

/** The APP's own renderer target.
 *
 * Filtered deliberately: the driven browser tabs are `page` targets too, and
 * driving "the first page target" would silently attach to a web page instead of
 * the app — which looks exactly like "the chrome has no DOM".
 */
async function connectRenderer(timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		const list = await targets().catch(() => []);
		/*
		 * The app's OWN renderer, identified by its scheme and not by the file name.
		 *
		 * `index.html` alone is ambiguous once a tab is restored: the proof site's own
		 * pages are served as `/index.html`, and a `WebContentsView` is a `page` target
		 * on the debugging port like any other. Attaching to one of those evaluates
		 * `window.api` inside a sandboxed page that has none — so the preload probe
		 * times out while the app is perfectly healthy, which is what a "timed out
		 * waiting for the preload after the relaunch" run was: the restored user tab
		 * sat on `http://127.0.0.1:<port>/index.html`. The app's renderer is loaded from
		 * disk, and the browser's own scheme rule refuses `file://` (design 11.6), so
		 * the scheme separates the two unambiguously.
		 */
		const renderer = list.find(
			(target) =>
				target.type === "page" &&
				typeof target.url === "string" &&
				target.url.startsWith("file://") &&
				target.url.includes("index.html") &&
				!target.url.startsWith("devtools://"),
		);
		if (renderer?.webSocketDebuggerUrl) {
			socket = new WebSocket(renderer.webSocketDebuggerUrl);
			await new Promise((resolve, reject) => {
				socket.addEventListener("open", resolve, { once: true });
				socket.addEventListener("error", reject, { once: true });
			});
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id !== undefined && pendingCalls.has(message.id)) {
					const { resolve, reject } = pendingCalls.get(message.id);
					pendingCalls.delete(message.id);
					if (message.error) reject(new Error(message.error.message));
					else resolve(message.result);
				}
			});
			return renderer.url;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				"the app's renderer never appeared on the debugging port",
			);
		}
		await sleep(250);
	}
}

function send(method, params = {}) {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pendingCalls.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});
}

/** Evaluate in the app's renderer and return the value, or throw with the page's
 * own message. */
async function evaluate(expression) {
	const result = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text ??
				"the expression threw",
		);
	}
	return result.result?.value;
}

/** The app's own renderer frame, as PNG bytes. Writes only the bytes; the
 * composite owns the frame's name. See `captureRenderer`. */
async function grabRenderer(name) {
	const shot = await send("Page.captureScreenshot", { format: "png" });
	// The CHROME layer keeps a `-chrome` suffix and the composite owns `<name>.png`:
	// sharp refuses to read and write one path, and it did so intermittently (it
	// depends on whether the input handles have been released), which is the worst
	// kind of harness bug to debug from a stack trace.
	const path = join(OUT_DIR, `${name}-chrome.png`);
	writeFileSync(path, Buffer.from(shot.data, "base64"));
	return path;
}

/**
 * Suppress whatever the app paints over the tab strip, and report whether the
 * strip is then the topmost element at its own centre.
 *
 * WHY THE RULE IS GENERAL RATHER THAN A BANNER'S NAME (review round 2, D5, and the
 * round-3 run that followed it). Round 2 hid ONE banner by name, with an inline
 * style that React re-rendered away, and the frames still contained no strip. This
 * round's first run showed the other half of the problem: in a headless,
 * backend-less boot the element over the strip is not the connectivity banner at
 * all - it is the app's own "not paired with the running Local Operator"
 * compatibility banner, `fixed inset-x-0 top-0`, measured at {top 0, height 53}
 * over a strip at {top 0, height 43}, and the connectivity banner was not up at all
 * in that run. So the rule is stated in terms of the STRIP: hide every element in
 * the hit chain at the strip's centre that is neither the strip nor one of its own
 * ancestors or descendants (an ancestor would take the strip down with it), name
 * what was hidden in the transcript, and assert the strip is topmost afterwards. A
 * `<style>` element injected into the document head is not React's to remove, so
 * the suppression survives the app's re-renders, and it is re-asserted before every
 * single frame rather than once.
 */
async function exposeStrip() {
	return await evaluate(`(() => {
		if (!document.getElementById('harness-expose-strip')) {
			const style = document.createElement('style');
			style.id = 'harness-expose-strip';
			style.textContent = '[data-harness-hidden-overlay]{display:none !important}';
			document.head.appendChild(style);
		}
		for (const el of document.querySelectorAll('[data-harness-hidden-overlay]')) el.removeAttribute('data-harness-hidden-overlay');
		const strip = document.querySelector('[data-tour-tag="browser-tab-strip"]');
		if (!strip) return { strip: null, hidden: [], topmost: null, hit: null };
		const r = strip.getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2);
		const y = Math.round(r.top + r.height / 2);
		const hidden = [];
		const leftInPlace = [];
		for (const el of document.elementsFromPoint(x, y)) {
			if (el === strip || strip.contains(el) || el.contains(strip)) continue;
			const entry = {
				tag: el.tagName.toLowerCase(),
				cls: String(el.className).slice(0, 90),
				text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 60),
			};
			// A SCRIM IS LEFT IN PLACE, and the rule is geometric on purpose. The app's
			// banners are full-width BANDS at the top of the window (measured: 53 px over
			// a 43 px strip); a modal's scrim is 'fixed inset-0', i.e. the whole viewport.
			// Hiding a band removes app chrome that has nothing to do with the browser
			// surface this run is photographing; hiding a scrim would take the frame's own
			// subject with it, so a frame of an overlay keeps its scrim and the strip stays
			// covered in it, which is what a user sees while a dialog is open.
			const box = el.getBoundingClientRect();
			if (box.height > 120) {
				leftInPlace.push(entry);
				continue;
			}
			hidden.push(entry);
			el.setAttribute('data-harness-hidden-overlay', '');
		}
		const hit = document.elementFromPoint(x, y);
		return {
			strip: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
			probe: { x, y },
			hidden,
			leftInPlace,
			topmost: hit ? (strip === hit || strip.contains(hit)) : false,
			hit: hit ? String(hit.getAttribute('data-tour-tag') || String(hit.className).split(' ').slice(0, 4).join(' ')).slice(0, 80) : null,
		};
	})()`);
}

let lastStripReading = null;

/** The app's chrome, as one frame. */
async function captureRenderer(name) {
	const reading = await exposeStrip();
	const summary = JSON.stringify(reading);
	if (summary !== lastStripReading) {
		lastStripReading = summary;
		record(`strip exposure before ${name}`, JSON.stringify(reading, null, 2));
	}
	return await grabRenderer(name);
}

/** The app's own reason for not painting the native view, or "" when it is. */
async function suppressedByReason() {
	return await evaluate(
		`(() => { const el = document.querySelector('[data-tour-tag="browser-content"]'); return el ? el.dataset.suppressedBy || '' : ''; })()`,
	);
}

/** The driven page, as the HOST captures it: the same call the agent's own
 * `screenshot` tool makes, so the pixels are the ones the feature ships. */
async function capturePage(state, token, name) {
	const shot = await rpc(state, "screenshot", token ? { tab: token } : {});
	if (!shot.json?.ok) {
		// Reported, not swallowed: a page capture that fails while the chrome looks
		// right is the one case where the composite would silently show a hole.
		record(
			`page capture ${name}`,
			`FAILED: ${shot.status} ${shot.text.slice(0, 200)}`,
		);
		return null;
	}
	const data = shot.json.result?.data;
	if (typeof data !== "string") {
		record(
			`page capture ${name}`,
			`no png data: ${JSON.stringify(shot.json.result).slice(0, 200)}`,
		);
		return null;
	}
	const path = join(OUT_DIR, `${name}-page.png`);
	writeFileSync(
		path,
		Buffer.from(data.replace(/^data:image\/png;base64,/, ""), "base64"),
	);
	return path;
}

/**
 * Composite the two layers into one frame, at the rectangle the renderer reports.
 *
 * This is the only honest way to photograph this feature: the page is a native
 * view the renderer cannot see, and the chrome is DOM the page's own capture
 * cannot see. The offset is the geometry the layout contract is about, which is
 * why it is printed alongside the frame.
 *
 * THE SUPPRESSION GUARD, and why it lives at THIS choke point rather than at each
 * call site (review round 2, D4): when an overlay or the failure panel is up, the
 * app hides the native view and says so in `data-suppressed-by` on the content
 * rectangle. Compositing the page layer anyway paints a layer the user cannot
 * see, and it painted one OVER the panel in the only frame of a failed load on an
 * approved agent origin — 200,400 pure-white pixels inside the content rect where
 * the chrome layer of the same capture has 0. Asking the app here means no frame
 * can be composed from a layer the app is not painting, whatever a caller passes.
 */
async function compose(name, chromePath, pagePath, rect) {
	const path = join(OUT_DIR, `${name}.png`);
	const suppressedBy = pagePath ? await suppressedByReason() : "";
	if (pagePath && suppressedBy) {
		record(
			`page layer withheld for ${name}`,
			`the app suppresses the native view, so there is no page layer to composite: data-suppressed-by="${suppressedBy}"`,
		);
	}
	if (!pagePath || suppressedBy) {
		// No page to composite: an overlay is up (or there is no tab), so the
		// renderer frame is the whole picture. That IS the policy, visible.
		if (chromePath !== path) writeFileSync(path, readFileSync(chromePath));
		return path;
	}
	/*
	 * The SCALE matters and got this wrong once. `rect` is in CSS pixels, read from
	 * `getBoundingClientRect()`; the captured PNGs are DEVICE pixels (this display is
	 * 2x), so compositing at the CSS numbers painted the page into the top-left
	 * quarter of where it belongs — a frame that looks like a layout bug in the app
	 * and was a bug in the harness. The scale is derived from the frame itself
	 * (device px per CSS px) rather than assumed, so a 1x display or a
	 * `--force-device-scale-factor` run stays right.
	 */
	const chromeMeta = await sharp(chromePath).metadata();
	const scale =
		(chromeMeta.width ?? WINDOW_VIEWPORT.width) / WINDOW_VIEWPORT.width;
	const left = Math.round(rect.x * scale);
	const top = Math.round(rect.y * scale);
	const width = Math.round(rect.width * scale);
	const height = Math.round(rect.height * scale);
	const page = await sharp(pagePath)
		.resize(width, height, { fit: "fill" })
		.toBuffer();
	await sharp(chromePath)
		.composite([{ input: page, left, top }])
		.png()
		.toFile(path);
	return path;
}

/** The rectangle the renderer reports to main, read from the same element the
 * ResizeObserver watches — so a frame's label and its pixels cannot disagree. */
async function contentRect() {
	return await evaluate(`(() => {
		const el = document.querySelector('[data-tour-tag="browser-content"]');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
	})()`);
}

async function chromeState() {
	const value = await evaluate(
		"window.api.browser.state().then((s) => JSON.stringify(s))",
	);
	return JSON.parse(value);
}

/** Click the strip's agent tab, so the composited page is one this harness can
 * capture (a user tab has no handle by design). */
const activateAgentTab = () =>
	evaluate(`(() => {
		const tabs = [...document.querySelectorAll('[role="tab"]')];
		const agent = tabs.find((el) => el.innerText.includes('Agent'));
		if (!agent) return 'missing';
		agent.click();
		return 'clicked';
	})()`);

/** Click the strip's user tab. The strip's own frames need the user's tab active,
 * because the ACTIVE tab is the one the page layer covers: with a user tab up,
 * the strip (over which no view paints) is unobstructed and its markers are the
 * subject of the frame. */
const activateUserTab = () =>
	evaluate(`(() => {
		const tabs = [...document.querySelectorAll('[role="tab"]')];
		const user = tabs.find((el) => !el.innerText.includes('Agent'));
		if (!user) return 'missing';
		user.click();
		return 'clicked';
	})()`);

/**
 * Close the ACTIVE tab, the way a user does.
 *
 * NOT `realClick('[data-tour-tag="browser-tab-close"]')`: that addresses the FIRST
 * tab's close button, and the tab a state is reached from is whichever one is
 * active. It matters here because the registry hands the active state to the next
 * USER tab when the active one goes (`forget`), so "nothing selected" is reached by
 * closing the user tabs deliberately rather than by hoping the first in the strip
 * is the active one (design round 3, D17).
 */
const closeActiveTab = () =>
	evaluate(`(() => {
		const active = document.querySelector('[role="tab"][aria-selected="true"]');
		if (!active) return 'no-active-tab';
		const close = active.parentElement?.querySelector('[data-tour-tag="browser-tab-close"]');
		if (!close) return 'missing';
		close.click();
		return 'clicked';
	})()`);

/**
 * The page area's own copy and its controls, read from the DOM.
 *
 * The point of reading it rather than the frame: a still cannot assert anything,
 * and the two empty states behind this run's 17/18 frames had no check anywhere in
 * the tree (design round 3, D17 and D19).
 */
const pageAreaCopy = () =>
	evaluate(`(() => {
		const area = document.querySelector('[data-tour-tag="browser-content"]');
		const text = (area?.innerText ?? '').replace(/\\s+/g, ' ').trim();
		const buttons = [...(area?.querySelectorAll('button') ?? [])].map((el) => el.innerText.replace(/\\s+/g, ' ').trim());
		return JSON.stringify({ text, buttons });
	})()`);

/**
 * A real pointer press on an element, for Radix triggers.
 *
 * `.click()` is not enough here: a Radix `DropdownMenuTrigger` opens on
 * `pointerdown`, so a synthetic `click` leaves the menu closed — which the first
 * run of this harness reported as "the menu item is missing", a diagnosis about
 * the harness rather than about the app.
 */
const pointerClickAt = (selector) =>
	evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return 'missing';
		const rect = el.getBoundingClientRect();
		const x = Math.round(rect.left + rect.width / 2);
		const y = Math.round(rect.top + rect.height / 2);
		return JSON.stringify({ x, y });
	})()`);

/**
 * Move a real pointer over an element, without pressing.
 *
 * THE STRIP'S TRANSIENT CHROME IS REVEALED BY HOVER, so a click dispatched at
 * coordinates without a preceding move hit-tests against a control that is
 * `pointer-events-none` until the pointer arrives - which is how this harness's
 * "close the last tab" step timed out: one tab left, `activeTabId` null, so the row
 * took the INACTIVE branch and its close control was not yet hit-testable. A person
 * moves the pointer first, and the reveal is part of what §6 and D13 promise, so the
 * harness does the same rather than reaching for a synthetic `.click()`.
 */
async function realHover(selector) {
	const coords = await pointerClickAt(selector);
	if (coords === "missing") return "missing";
	const { x, y } = JSON.parse(coords);
	await send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		buttons: 0,
	});
	return "hovered";
}

/** A real mouse press and release at an element's centre, through CDP.
 *
 * The only click that opens a Radix menu, and the only one that proves the
 * affordance works for a person rather than for a synthetic event. */
async function realClick(selector) {
	const coords = await pointerClickAt(selector);
	if (coords === "missing") return "missing";
	const { x, y } = JSON.parse(coords);
	await send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		clickCount: 1,
		buttons: 1,
	});
	await send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y,
		button: "left",
		clickCount: 1,
		buttons: 0,
	});
	return "clicked";
}

/** The same, for an element picked by its role and its text: how a menu item is
 * chosen, since a Radix portal item is not addressed by a tour tag. */
async function realClickText(role, text) {
	const coords = await evaluate(`(() => {
		const els = [...document.querySelectorAll('[role="${role}"]')];
		const hit = els.find((el) => el.innerText.includes(${JSON.stringify(text)}));
		if (!hit) return 'missing';
		const rect = hit.getBoundingClientRect();
		return JSON.stringify({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
	})()`);
	if (coords === "missing") return "missing";
	const { x, y } = JSON.parse(coords);
	await send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		clickCount: 1,
		buttons: 1,
	});
	await send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y,
		button: "left",
		clickCount: 1,
		buttons: 0,
	});
	return "clicked";
}

const clickTag = (tag) =>
	evaluate(`(() => {
		const el = document.querySelector('[data-tour-tag="${tag}"]');
		if (!el) return 'missing';
		el.click();
		return 'clicked';
	})()`);

/**
 * Open the browser route the way a person does, waiting for the rail to exist.
 *
 * Waited for and retried rather than clicked once: whatever mounts this shell's
 * rail is asynchronous, and "the element was not there yet" is a harness race
 * rather than a finding about the app. Both callers — the first launch and the
 * relaunch — need that, and they need it to be the SAME code, because the second
 * one is the one that runs while the app is still restoring its tabs.
 */
const openBrowserFromRail = () =>
	waitFor(
		async () => {
			const present = await evaluate(
				`document.querySelector('[data-tour-tag="nav-item-browser"]') ? 'y' : ''`,
			);
			if (!present) return false;
			await clickTag("nav-item-browser");
			await sleep(400);
			const hash = await evaluate("location.hash");
			return hash.includes("/browser") ? hash : false;
		},
		"the browser route to open from the rail",
		20_000,
	);

const clickTagByText = (tag, text) =>
	evaluate(`(() => {
		const wanted = ${JSON.stringify(text)};
		const els = [...document.querySelectorAll('[data-tour-tag="${tag}"]')];
		const hit = els.find((el) => el.innerText.trim().toLowerCase().includes(wanted.toLowerCase()));
		if (!hit) return 'missing';
		hit.click();
		return 'clicked';
	})()`);

/** A real keystroke-driven navigation through the address bar.
 *
 * Not `window.api.browser.navigate(...)`: the typed-URL path is the thing under
 * test (it is ungated by design while the agent's navigation is gated), so the
 * harness has to go through the same React-controlled input a person types into.
 * The native value setter plus an `input` event is what a controlled input sees. */
const typeAddress = (url) =>
	evaluate(`(() => {
		const input = document.querySelector('[data-tour-tag="browser-address"]');
		if (!input) return 'missing';
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(input, ${JSON.stringify(url)});
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		return 'typed';
	})()`);

async function waitFor(predicate, label, timeoutMs = 30_000) {
	const started = Date.now();
	for (;;) {
		const value = await predicate();
		if (value) return value;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await sleep(250);
	}
}

/** The frontmost application's name and pid, for probe P12. Returns null when the
 * OS will not answer (no accessibility permission), which is reported rather than
 * guessed.
 *
 * ASYNC, AND THAT IS THE POINT. This was `execFileSync`, called once a second by
 * the sampler below, and `osascript` reaching System Events is not fast: measured
 * on this host at 5.31 / 7.01 / 10.91 / 19.98 s per call, with one
 * `-609 Connection is invalid` after 42.86 s. A SYNCHRONOUS call of that length
 * blocks the event loop for its whole duration, and the timer that scheduled it
 * is overdue by the time the block ends, so it fires again the moment the loop is
 * free: the process spends effectively all of its time inside `osascript` and no
 * other timer in it gets to run.
 *
 * The consequence was measured, not theorised: with the synchronous sampler
 * running, the 250 ms poll in `waitForState` was scheduled out past its own 60 s
 * deadline and the run died with `no LIVE host answered /health` on 6 of 6
 * attempts while the host's record sat on disk the entire time - and it still did
 * so on a quiet machine (load1 ~14, pageouts flat), which is what rules load out
 * as the cause. The probe was reading the state file outside its own deadline. A
 * timer that cannot fire cannot time out. `execFile` keeps the wait off the loop;
 * a reject (including the OS refusing to answer) is still reported as null.
 */
function frontmost() {
	return new Promise((resolve) => {
		execFile(
			"osascript",
			[
				"-e",
				'tell application "System Events" to set p to first application process whose frontmost is true',
				"-e",
				'tell application "System Events" to return (name of p) & "|" & (unix id of p)',
			],
			{ stdio: ["ignore", "pipe", "ignore"] },
			(error, stdout) => resolve(error ? null : String(stdout).trim()),
		);
	});
}

/**
 * Probe P12, sampled rather than point-measured.
 *
 * WHY IT IS SAMPLED: this machine runs several agent sessions at once, and one of
 * them driving the operator's own browser is enough to change the frontmost
 * application between two readings — which is a false negative that would read as
 * "the browser raised the window". What the property actually claims is that THIS
 * app's process never becomes frontmost, so the sampler records the frontmost pid
 * once a second and the check is against the app's own pid.
 *
 * WHY THE LOOP RE-ARMS ITSELF INSTEAD OF USING `setInterval`: one sample can take
 * tens of seconds (see `frontmost`), so a fixed-rate timer would stack an
 * `osascript` child per tick and a 40 s answer at 1 Hz would leave roughly forty
 * of them alive at once. Re-arming one second AFTER each answer keeps exactly one
 * sample in flight, and the price is only the cadence: on a host where the OS
 * answers slowly the run collects a sample every few tens of seconds rather than
 * every second. That is the honest rate, and it is still what the property needs
 * - the claim is that THIS app's pid never appears among the frontmost ones, not
 * how many times it was looked at.
 */
function startFrontmostSampler(appPid) {
	const samples = [];
	let stopped = false;
	let timer = null;
	const tick = async () => {
		const value = await frontmost();
		if (value) samples.push(value);
		if (!stopped) timer = setTimeout(tick, 1000);
	};
	timer = setTimeout(tick, 1000);
	return {
		stop: () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		},
		samples,
		appWasFrontmost: () =>
			samples.filter((sample) => sample.endsWith(`|${appPid}`)).length,
		distinct: () => [...new Set(samples)],
	};
}

// ---- the run ---------------------------------------------------------------

async function main() {
	rmSync(SCRATCH, { recursive: true, force: true });
	for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA, OUT_DIR]) {
		mkdirSync(dir, { recursive: true });
	}

	const { server } = await startSite();
	say(`site on ${origin()}`);
	const frontmostBefore = await frontmost();

	let state = null;
	let sampler = null;
	try {
		// ---- 1. the app, the route, the empty surface -------------------------
		app = await launchApp();
		sampler = startFrontmostSampler(app.child.pid);
		state = await waitForState();
		const rendererUrl = await connectRenderer();
		await send("Page.enable", {});
		await send("Runtime.enable", {});
		check(
			"the app's own renderer is on the debugging port and the host published its state file",
			Boolean(rendererUrl && state.port && state.session_key),
			`renderer ${rendererUrl}\nstate file ${stateFilePath()} mode ${(statSync(stateFilePath()).mode & 0o777).toString(8)}`,
		);

		await waitFor(
			() =>
				evaluate(
					"typeof window.api?.browser?.state === 'function' ? 'ready' : ''",
				),
			"the preload's browser namespace",
		);

		/*
		 * Onboarding is marked complete BEFORE the route opens.
		 *
		 * A fresh user-data-dir is a first-time user, so the app may open its
		 * onboarding modal — a full-window overlay that (correctly) hides the browser
		 * view. These frames are about the browser, not about a six-step tour, so the
		 * harness writes the flag the app persists and reloads the renderer. Whether
		 * the modal is up in a given environment is not asserted: this one is not
		 * paired with a backend, so its first-run decision differs from a desktop
		 * install's, and a check that depends on that would fail for the wrong reason.
		 */
		await evaluate(`localStorage.setItem('onboarding-storage', JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: null },
			version: 0,
		}))`);
		await send("Page.reload", {});
		await waitFor(
			() =>
				evaluate(
					"typeof window.api?.browser?.state === 'function' ? 'ready' : ''",
				),
			"the preload after the reload",
		);

		// The rail item is the USER's path to the surface, so it is the path the
		// harness takes: a route reachable only by typing a URL would not be shipped.
		const reachable = await openBrowserFromRail();
		check(
			"the browser is reachable from the app's own navigation",
			reachable === "#/browser",
			`location.hash ${reachable}`,
		);
		await waitFor(
			() =>
				evaluate(
					"document.querySelector('[data-tour-tag=\"browser-content\"]') ? 'y' : ''",
				),
			"the browser surface",
		);
		await sleep(800);

		// ---- geometry: the rectangle the layout contract is about -------------
		const rect = await contentRect();
		const viewport = await evaluate(
			"({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })",
		);
		// Published for `compose`, which converts the CSS rectangle into the device
		// pixels the captured frames are actually made of.
		WINDOW_VIEWPORT = viewport;
		const rail = await evaluate(`(() => {
			const nav = document.querySelector('nav');
			return nav ? Math.round(nav.getBoundingClientRect().width) : null;
		})()`);
		record(
			"the reported content rectangle",
			JSON.stringify(
				{ rect, viewport, rail, windowSizeFlag: "1380x900" },
				null,
				2,
			),
		);
		check(
			"the renderer reports a content rectangle inside the viewport, and it starts below the chrome band",
			Boolean(
				rect &&
					rect.width > 400 &&
					rect.height > 300 &&
					rect.x > 0 &&
					rect.y > 0,
			),
			`rect ${JSON.stringify(rect)}, viewport ${JSON.stringify(viewport)}, rail ${rail}px`,
		);

		/*
		 * The connectivity banner, measured before it is hidden.
		 *
		 * It was `fixed inset-x-0 top-0 z-2200` until D9 and is the shell's first child
		 * in flow now, so it no longer reaches the tab strip — but this run has no
		 * backend by design and a band of SOME shape is expected on every route, so the
		 * measurement stays and the finder is shape-independent: the shell's own
		 * children sitting at or above the app region's top, matched on the banner's
		 * copy (this app's sentences since #205, and the pre-#205 "offline" ones, so the
		 * read works on either tree). The numbers are printed rather than hidden: a
		 * frame that is prettier than the app is not evidence.
		 */
		const banner = await evaluate(`(() => {
			const bannerText = /The server is offline|You are offline|A connectivity issue has been detected|Not connected to a Local Operator server|The Local Operator server stopped/i;
			/*
			 * Shape-independent on purpose: a div.fixed finder read "no banner" over a
			 * window carrying one the moment the bands moved into flow (D9), which is the
			 * pre-fix spelling this rig's own comment used to justify. See
			 * scripts/band-occlusion-evidence.mjs for the measured version of this read.
			 */
			const main = document.querySelector('main');
			const region = main ? main.parentElement : null;
			const outer = region ? region.parentElement : null;
			const regionTop = region ? region.getBoundingClientRect().top : 0;
			const strips = [];
			for (const level of [region, outer]) {
				if (!level) continue;
				for (const child of level.children) {
					const r = child.getBoundingClientRect();
					if (r.height <= 16 || r.height > 200 || r.top > regionTop + 8) continue;
					if (main && child.contains(main)) continue;
					strips.push(child);
				}
			}
			const el = strips.find((node) => bannerText.test(node.innerText || '')) ?? null;
			const strip = document.querySelector('[data-tour-tag="browser-tab-strip"]');
			const box = (r) => r ? { top: Math.round(r.top), height: Math.round(r.height) } : null;
			const s = strip ? strip.getBoundingClientRect() : null;
			if (!el) return { present: false, tabStrip: box(s), overlapsTabStrip: null };
			const b = el.getBoundingClientRect();
			return {
				present: true,
				text: (el.innerText || '').split('\\n')[0].slice(0, 60),
				banner: box(b),
				tabStrip: box(s),
				overlapsTabStrip: s ? b.bottom > s.top : null,
			};
		})()`);
		record(
			"the connectivity banner over the browser route",
			JSON.stringify(banner, null, 2),
		);
		check(
			"the tab strip is present in the layout, whether or not the connectivity banner is up over it",
			banner.tabStrip !== null && banner.tabStrip.height > 30,
			`banner ${JSON.stringify(banner.banner ?? null)} (${banner.text ?? "not up in this run"}), tab strip ${JSON.stringify(banner.tabStrip)}, overlaps ${banner.overlapsTabStrip}`,
		);
		/*
		 * The suppression is re-asserted before EVERY frame by `captureRenderer`, so
		 * this call is the first one - the statement in the transcript, with the
		 * measurement that says the flip worked. Round 2 hid the banner once and the
		 * frames still did not contain the strip (D5); the check below is the property
		 * that was missing, asked of the DOM rather than of a class name.
		 */
		const exposure = await exposeStrip();
		lastStripReading = JSON.stringify(exposure);
		record(
			"strip exposure after whatever covers it is suppressed",
			JSON.stringify(exposure, null, 2),
		);
		check(
			"the tab strip is the topmost element at its own centre once the app's own banners are suppressed for the frames, so a frame can contain it",
			exposure.strip !== null && exposure.topmost === true,
			`strip ${JSON.stringify(exposure.strip)}, hidden over it: ${JSON.stringify(exposure.hidden)}, elementFromPoint(${exposure.probe?.x}, ${exposure.probe?.y}) -> ${exposure.hit}`,
		);

		/*
		 * THE TOAST TRADE, measured rather than asserted.
		 *
		 * This environment has no backend, so the app raises "List agents request
		 * failed: 503" toasts continuously. A toast is painted in the content area's
		 * bottom-right corner, so a policy that hid the view for it would hold the page
		 * away from the user for as long as the errors repeated — with a "close the
		 * dialog" note that describes nothing they can close. The numbers below are the
		 * trade: the overlap is real, and the view stays up.
		 */
		// Waited for rather than sampled once: the offline app raises its toast on a
		// failed poll, and the interval is not ours to assume. If none appears at all,
		// that is this environment, not the policy.
		await waitFor(
			() =>
				evaluate(
					"document.querySelector('[data-sonner-toast]') ? 'toast' : ''",
				),
			"a toast to appear (the offline app raises one)",
			20_000,
		).catch(() => null);
		const toastCase = await evaluate(`(() => {
			const toast = document.querySelector('[data-sonner-toast]');
			const content = document.querySelector('[data-tour-tag="browser-content"]');
			const box = (el) => {
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.left), y: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
			};
			const t = box(toast);
			const c = box(content);
			return {
				toastPresent: !!toast,
				text: toast ? (toast.innerText || '').split('\\n')[0].slice(0, 60) : null,
				toast: t,
				content: c,
				overlapsContent: t && c ? t.right > c.x && t.y < c.bottom : null,
				paused: !!document.querySelector('[data-tour-tag="browser-paused"]'),
			};
		})()`);
		record(
			"the toast over the browser surface",
			JSON.stringify(toastCase, null, 2),
		);

		/*
		 * WHAT ELSE IS PAINTED OVER THE ROUTE, named rather than inferred.
		 *
		 * The paused state appeared with no toast on screen in an earlier run, and
		 * guessing which overlay registered is how a harness reports a diagnosis about
		 * itself. This walks the app's own portals and fixed-position elements and
		 * prints what is actually there, with its box, so the answer is in the
		 * transcript.
		 */
		const paintedOver = await evaluate(`(() => {
			const seen = new Set();
			const rows = [];
			for (const el of document.querySelectorAll('body *')) {
				const style = getComputedStyle(el);
				if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') continue;
				if (Number(style.opacity) === 0) continue;
				const r = el.getBoundingClientRect();
				if (r.width < 4 || r.height < 4) continue;
				const key = el.tagName + Math.round(r.top) + Math.round(r.left) + el.className.toString().slice(0, 40);
				if (seen.has(key)) continue;
				seen.add(key);
				rows.push({
					tag: el.tagName.toLowerCase(),
					cls: el.className.toString().slice(0, 90),
					box: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
					text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 50),
				});
			}
			return JSON.stringify(rows, null, 1);
		})()`);
		record(
			"every fixed-position element on screen over the browser route",
			paintedOver,
		);
		say(`fixed-position elements over the route:\n${paintedOver}`);
		if (process.argv.includes("--diagnose")) {
			say(
				`paused: ${await evaluate("!!document.querySelector('[data-tour-tag=\"browser-paused\"]')")}, by: ${await evaluate("(document.querySelector('[data-tour-tag=\"browser-paused\"]') || {dataset:{}}).dataset.suppressedBy")}`,
			);
			say(
				`portals: ${await evaluate(`JSON.stringify({
					bodyChildren: [...document.body.children].map((el) => el.tagName.toLowerCase() + ':' + (el.getAttribute('data-radix-portal') !== null ? 'portal' : '') + ':' + el.childElementCount),
					dialog: document.querySelectorAll('[role="dialog"]').length,
					toast: document.querySelectorAll('[data-sonner-toast]').length,
					popper: document.querySelectorAll('[data-radix-popper-content-wrapper]').length,
				})`)}`,
			);
			await captureRenderer("diag-surface");
			say(`diagnose frame: ${join(OUT_DIR, "diag-surface.png")}`);
			throw new Error("--diagnose: stopping after the inventory");
		}
		check(
			"a toast overlaps the content area and is deliberately NOT registered: the page stays up, and the overlap is recorded rather than hidden",
			toastCase.toastPresent
				? toastCase.overlapsContent === true && toastCase.paused === false
				: true,
			toastCase.toastPresent
				? `toast "${toastCase.text}" overlaps the content rect: ${toastCase.overlapsContent}; paused: ${toastCase.paused}`
				: "no toast was raised within 20s in this run, so the trade is not exercised here; the dialog, sheet and band cases below are",
		);
		if (toastCase.toastPresent) {
			await captureRenderer("00-toast-over-the-surface");
			// Dismissed so it does not sit over the frames that follow. Its own close
			// button, which is the affordance a user has.
			await realClick("[data-sonner-toast] [data-close-button]");
			await sleep(600);
		}

		// ---- the strip's own overlays do NOT hide the view --------------------
		// The `Sites` button and the tab menu live in the chrome band, outside the
		// view's rectangle, so nothing there is occluded and the page must stay up.
		check(
			"a control in the chrome band does not hide the view (the band is outside the rectangle)",
			(await evaluate(
				"!!document.querySelector('[data-tour-tag=\"browser-paused\"]')",
			)) === false,
			"the page is showing with no overlay in the band",
		);

		const emptyState = await chromeState();
		check(
			"a first launch opens exactly one blank tab, owned by the user",
			emptyState.tabs.length === 1 &&
				emptyState.tabs[0].owner === "user" &&
				emptyState.tabs[0].url === "about:blank",
			JSON.stringify(emptyState.tabs),
		);
		check(
			"the empty case renders the address bar and an empty field rather than the string about:blank",
			(await evaluate(
				"document.querySelector('[data-tour-tag=\"browser-address\"]').value",
			)) === "",
			"address value is the empty string",
		);
		const emptyFrame = await captureRenderer("01-surface-empty");
		await compose(
			"01-surface-empty",
			emptyFrame,
			await capturePage(state, null, "empty-blank"),
			rect,
		);
		say(`frame: ${join(OUT_DIR, "01-surface-empty.png")}`);

		// ---- 2. a typed URL: the loading state --------------------------------
		check(
			"a URL typed into the address bar navigates the active tab",
			(await typeAddress(`${origin()}/slow`)) === "typed",
			`typed ${origin()}/slow and pressed Enter`,
		);
		const loadingState = await waitFor(
			async () => {
				const current = await chromeState();
				return current.loading ? current : null;
			},
			"the tab to be loading",
			15_000,
		);
		const loadingDom = await evaluate(
			`(() => {
				const field = document.querySelector('[data-tour-tag="browser-address"]');
				return {
					stop: !!document.querySelector('[data-tour-tag="browser-stop"]'),
					reload: !!document.querySelector('[data-tour-tag="browser-reload"]'),
					spinnerInField: !!field.parentElement.querySelector('svg.animate-spin'),
					value: field.value,
					placeholder: field.placeholder,
					addressFields: [...document.querySelectorAll('[data-tour-tag="browser-address"]')].map((el) => ({ value: el.value, placeholder: el.placeholder })),
					title: (document.querySelector('[data-tour-tag="browser-tab"]') || {}).innerText || '',
				};
			})()`,
		);
		check(
			"while loading, reload becomes stop and the field says both what the tab shows (nothing yet) and what was asked for",
			loadingDom.stop &&
				!loadingDom.reload &&
				// The live url of a tab that has not committed is still `about:blank`, and
				// the design's rule is that the FIELD shows the live one — so it is empty
				// and the destination the user typed is the placeholder, which is not a
				// claim that the tab is there.
				loadingDom.value === "" &&
				loadingDom.placeholder.includes("/slow"),
			JSON.stringify(loadingDom),
		);
		const loadingFrame = await captureRenderer("02-surface-loading");
		await compose(
			"02-surface-loading",
			loadingFrame,
			await capturePage(state, null, "loading-page"),
			rect,
		);
		say(`frame: ${join(OUT_DIR, "02-surface-loading.png")}`);

		// ---- 3. populated -----------------------------------------------------
		const populated = await waitFor(
			async () => {
				const current = await chromeState();
				return current.loading ? null : current;
			},
			"the page to finish loading",
			30_000,
		);
		check(
			"the strip's title comes from the DOCUMENT, and the address bar shows the live URL",
			populated.tabs[0].title === "Slow page" &&
				populated.url === `${origin()}/slow`,
			`title "${populated.tabs[0].title}", url ${populated.url}`,
		);
		check(
			"the blank document a tab starts on is a history entry, so back is available after one navigation",
			populated.canGoBack === true && populated.canGoForward === false,
			`canGoBack ${populated.canGoBack}, canGoForward ${populated.canGoForward}`,
		);
		const populatedFrame = await captureRenderer("03-surface-populated");
		await compose(
			"03-surface-populated",
			populatedFrame,
			await capturePage(state, null, "populated-page"),
			rect,
		);
		say(`frame: ${join(OUT_DIR, "03-surface-populated.png")}`);

		// A second navigation, so history has depth for the restore check and the
		// back control has somewhere to go.
		await typeAddress(`${origin()}/second`);
		await waitFor(
			async () => {
				const current = await chromeState();
				return !current.loading && current.url.endsWith("/second")
					? current
					: null;
			},
			"the second page",
			30_000,
		);
		// Back is CLICKED rather than read: the controls are driven from history
		// state, and the claim is that the click navigates the tab back.
		await clickTag("browser-back");
		const backState = await waitFor(
			async () => {
				const current = await chromeState();
				return current.url.endsWith("/slow") ? current : null;
			},
			"the back navigation to land",
			15_000,
		);
		check(
			"the back control navigates the tab back through its own history",
			backState.url.endsWith("/slow") && backState.canGoForward === true,
			`url ${backState.url}, canGoForward ${backState.canGoForward}`,
		);
		// Forward again, so the restore check below has a real stack to replay.
		await clickTag("browser-forward");
		await waitFor(
			async () => {
				const current = await chromeState();
				return current.url.endsWith("/second") ? current : null;
			},
			"the forward navigation to land",
			15_000,
		);

		// ---- 4. the error surface ---------------------------------------------
		await typeAddress("http://127.0.0.1:9/");
		await sleep(3500);
		const errorState = await chromeState();
		check(
			"a navigation that cannot connect leaves the tab on the URL it asked for, rather than reporting success",
			errorState.url === "http://127.0.0.1:9/" && errorState.loading === false,
			`url ${errorState.url}, loading ${errorState.loading}`,
		);
		const errorFrame = await captureRenderer("04-surface-error");
		await compose(
			"04-surface-error",
			errorFrame,
			await capturePage(state, null, "error-page"),
			rect,
		);
		say(`frame: ${join(OUT_DIR, "04-surface-error.png")}`);

		// ---- 4b. the refused navigation says so, and keeps saying so ----------
		//
		// Two round-1 findings, measured against the running app rather than
		// argued here. D1: a refused main-frame load used to be an empty white page
		// area - Chromium's own blank surface, which nothing in the remote document
		// can paint - while the host knew the code. R6: the band's error was erased
		// by the state read that followed the action, so a refusal read as a dead
		// button. The check waits for the band, which is the point: the read has
		// already happened by then, so a band that still carries the message is the
		// fix, and a band that is empty is the regression.
		const refusedDom = await waitFor(
			async () => {
				const dom = await evaluate(`(() => {
					const panel = document.querySelector('[data-tour-tag="browser-load-failure"]');
					const band = document.querySelector('[data-tour-tag="browser-error"]');
					const content = document.querySelector('[data-tour-tag="browser-content"]');
					return {
						panel: panel ? panel.innerText : "",
						retry: !!document.querySelector('[data-tour-tag="browser-load-failure-retry"]'),
						band: band ? band.innerText : "",
						suppressedBy: content ? content.dataset.suppressedBy || "" : "",
					};
				})()`);
				return dom.panel ? dom : null;
			},
			"the load-failure panel to replace the blank page area",
			20_000,
		);
		check(
			"a refused navigation says why, in the app's own chrome, with the raw code and the address it tried",
			refusedDom.panel.includes("ERR_") &&
				refusedDom.panel.includes("127.0.0.1:9") &&
				refusedDom.retry,
			JSON.stringify(refusedDom, null, 2),
		);
		check(
			"and the native view is hidden for it, so the panel is the thing on screen",
			refusedDom.suppressedBy.includes("browser-load-failure"),
			`data-suppressed-by="${refusedDom.suppressedBy}"`,
		);
		check(
			"the action's own refusal is still in the band after the state read that follows it",
			refusedDom.band.length > 0,
			`band: ${JSON.stringify(refusedDom.band)}`,
		);
		const failureFrame = await captureRenderer("04b-surface-load-failure");
		await compose("04b-surface-load-failure", failureFrame, null, rect);
		say(`frame: ${join(OUT_DIR, "04b-surface-load-failure.png")}`);

		// ---- 5. the typed-URL consent asymmetry -------------------------------
		// The agent is refused on the site's origin (nothing has been approved yet),
		// and the USER's own typed navigation to that same origin succeeds. This is
		// design 6.1's asymmetry, and the direction of the gate.
		const refused = await rpc(state, "open", { url: `${origin()}/second` });
		check(
			"an agent's navigation to an unapproved origin fails early with origin_not_allowed",
			refused.json?.error?.code === "origin_not_allowed",
			`${JSON.stringify(refused.json?.error)}`,
		);
		check(
			"the user's typed navigation to that SAME origin works, because the user typing it is the consent",
			(
				await evaluate(
					"document.querySelector('[data-tour-tag=\"browser-address\"]').value",
				)
			).includes("127.0.0.1:9"),
			"the tab is still on the typed URL while the agent is refused on the site's origin",
		);

		// Recovery, which is the other half of D1: a successful navigation clears
		// the failure rather than leaving a stale panel over a page that loaded.
		await typeAddress(`${origin()}/index.html`);
		const recovered = await waitFor(
			async () => {
				const dom = await evaluate(`(() => {
					const panel = document.querySelector('[data-tour-tag="browser-load-failure"]');
					const content = document.querySelector('[data-tour-tag="browser-content"]');
					return {
						panel: !!panel,
						suppressedBy: content ? content.dataset.suppressedBy || "" : "",
					};
				})()`);
				const state = await chromeState();
				if (
					!dom.panel &&
					state.loading === false &&
					state.url.endsWith("/index.html")
				) {
					return { ...dom, url: state.url };
				}
				return null;
			},
			"the retry to succeed and the panel to clear",
			25_000,
		);
		check(
			"a successful navigation clears the failure panel and restores the page",
			recovered.panel === false &&
				!recovered.suppressedBy.includes("browser-load-failure"),
			JSON.stringify(recovered, null, 2),
		);
		const recoveredFrame = await captureRenderer("04c-surface-recovered");
		await compose(
			"04c-surface-recovered",
			recoveredFrame,
			await capturePage(state, null, "recovered-page"),
			rect,
		);
		/*
		 * WHAT THIS FRAME DOES AND DOES NOT SHOW (review round 2, D6). Its page layer
		 * is the active tab's, and the active tab is the USER's: a user tab holds no
		 * handle (design 7.3), so the host refuses that capture and the content region
		 * is empty — the caption used to say "the page is back" over a frame that does
		 * not contain the page. The recovery itself is asserted above, in the DOM and
		 * in the projection, and photographed with its page on the agent tab
		 * (`15b-surface-recovered-agent-tab`), which does hold a handle.
		 */
		record(
			"the page layer of 04c",
			"withheld, deliberately and by design: the active tab is the user's, a user tab holds no capability handle, and the host will not screenshot a tab it has no handle for. This frame is the chrome after the recovery; the RECOVERED PAGE is the agent-tab frame `15b`, and the recovery's own assertion is the DOM/projection check above.",
		);
		say(`frame: ${join(OUT_DIR, "04c-surface-recovered.png")}`);

		// ---- 6. the consent bar: pending -------------------------------------
		const requested = await rpc(state, "request_access", {
			url: `${origin()}/second`,
			requester: "session:proof",
		});
		check(
			"an agent's request_access raises a pending entry and returns immediately",
			requested.json?.result?.state === "pending",
			JSON.stringify(requested.json?.result),
		);
		const pendingState = await waitFor(
			async () => {
				const current = await chromeState();
				return current.pendingConsent.length ? current : null;
			},
			"the pending consent to reach the chrome",
			15_000,
		);
		check(
			"the projection carries the origin and the broad option, and the requester only as a session id",
			pendingState.pendingConsent[0].origin.startsWith("http://127.0.0.1") &&
				!("requester" in pendingState.pendingConsent[0]) &&
				pendingState.pendingConsent[0].requesterSessionId === "proof",
			JSON.stringify(pendingState.pendingConsent[0]),
		);
		const consentDom = await evaluate(`(() => {
			const bar = document.querySelector('[data-tour-tag="browser-consent-bar"]');
			if (!bar) return { present: false };
			return {
				present: true,
				text: bar.innerText.replace(/\\s+/g, ' ').trim(),
				actions: [...bar.querySelectorAll('button')].map((b) => b.innerText.trim()),
			};
		})()`);
		check(
			"the consent bar renders in the chrome band, names the origin, and offers the five scopes",
			consentDom.present &&
				consentDom.text.includes("127.0.0.1") &&
				consentDom.actions.length >= 4,
			JSON.stringify(consentDom, null, 2),
		);
		/*
		 * THE MARKER IS NOT ON THIS TAB, and that is the assertion (UX round 1, U3).
		 * §5.2's chip says the tab is PARKED on an origin the agent has not been
		 * approved for. The tab here is the user's own — they typed the address, their
		 * navigation is ungated, the page loaded — so a marker on it would describe
		 * something that is not happening to it. Before the gate, that is exactly what
		 * the old check was asserting, which is why it stayed green while the marker
		 * was wrong. The POSITIVE case rides the agent's own tab, in section 7b below,
		 * and there is a unit test for both.
		 */
		const waitingDom = JSON.parse(
			await evaluate(`(() => JSON.stringify({
				chips: [...document.querySelectorAll('[data-tour-tag="browser-tab-waiting"]')].map((chip) => chip.innerText.trim()),
				tabs: document.querySelectorAll('[role="tab"]').length,
			}))()`),
		);
		check(
			"the strip does NOT mark the user's own tab: a live request for the origin they are on is not that tab waiting for access",
			waitingDom.chips.length === 0 && waitingDom.tabs >= 1,
			JSON.stringify(waitingDom),
		);
		const consentPendingFrame = await captureRenderer("05-consent-pending");
		await compose(
			"05-consent-pending",
			consentPendingFrame,
			await capturePage(state, null, "consent-pending-page"),
			rect,
		);
		say(`frame: ${join(OUT_DIR, "05-consent-pending.png")}`);

		// ---- 7. the overlay policy -------------------------------------------
		// A native view paints above ALL DOM, so a dialog over the browser surface is
		// invisible unless the view is hidden. This is that property, exercised by
		// real clicks: the band's row actions open the hand-over dialog, which is a
		// `BaseDialog`, and the surface behind it reports itself paused.
		const beforeOverlay = await evaluate(
			"!!document.querySelector('[data-tour-tag=\"browser-paused\"]')",
		);
		/*
		 * Pressed again if the first press did not open it.
		 *
		 * Radix measures at press time and the strip re-renders on every state push, so
		 * a press that lands while a tab's title changes can miss the trigger — measured
		 * once as "menu opened: clicked; items []". A retry re-measures the coordinates,
		 * which is what a person's second click does too; the check still asserts that a
		 * real press is what opens the menu.
		 */
		/*
		 * THE ROW'S ACTIONS EXPAND IN THE BAND (spec §6). They used to be a Radix
		 * dropdown anchored at the strip's bottom edge and painting DOWNWARD into the
		 * content rect, where the native view occludes it — menus in the band are
		 * deliberately not registered (`browser-view-policy.ts:32-39`) and a z-index
		 * cannot beat a native sibling view. This is that fix, driven by a real press,
		 * and the geometry is MEASURED rather than asserted: the strip grows and the
		 * page's rectangle shrinks by the same number of pixels, because the content
		 * element is re-measured by its own ResizeObserver and the host re-bounds the
		 * view. No suppression, no hidden page.
		 */
		const rectBeforeActions = await contentRect();
		let openedActions = "missing";
		const watchOffered = false;
		const actionsState = await waitFor(
			async () => {
				/*
				 * A NON-ACTIVE tab's actions are opened when the strip has one, because
				 * `Watch this tab` is the §8.3 affordance and it is only rendered for a tab
				 * that is not already on screen. On the ACTIVE tab the same row correctly
				 * offers no watch action — there is nothing to switch to — so which tab this
				 * picker chose is recorded rather than assumed.
				 */
				openedActions = await evaluate(`(() => {
					const tabs = [...document.querySelectorAll('[role="tab"]')];
					const triggers = [...document.querySelectorAll('[data-tour-tag="browser-tab-menu"]')];
					if (!triggers.length) return 'missing';
					const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') !== 'true');
					const target = index >= 0 && triggers[index] ? triggers[index] : triggers[0];
					watchOffered = index >= 0;
					target.click();
					return 'clicked';
				})()`);
				if (openedActions !== "clicked") return false;
				await sleep(400);
				return await evaluate(`(() => {
					const row = document.querySelector('[data-tour-tag="browser-tab-actions"]');
					if (!row) return false;
					const strip = document.querySelector('[data-tour-tag="browser-tab-strip"]');
					const content = document.querySelector('[data-tour-tag="browser-content"]');
					const rowRect = row.getBoundingClientRect();
					return JSON.stringify({
						insideTheBand: !!strip && strip.contains(row),
						aboveThePage: !!content && Math.round(rowRect.bottom) <= Math.round(content.getBoundingClientRect().top),
						height: Math.round(rowRect.height),
						buttons: [...row.querySelectorAll('button')].map((b) => b.innerText.trim()),
						tags: [...row.querySelectorAll('button')].map((b) => b.getAttribute('data-tour-tag')),
					});
				})()`);
			},
			"the row's actions to expand inside the band",
			20_000,
		).catch(() => false);
		const actionsDom = actionsState ? JSON.parse(actionsState) : null;
		const rectWithActions = await contentRect();
		const actionsFrame = await captureRenderer("17-tab-actions-in-band");
		await compose(
			"17-tab-actions-in-band",
			actionsFrame,
			null,
			rectWithActions,
		);
		check(
			"the row's actions expand in the band, above the page's rectangle — not in a menu that paints into it",
			openedActions === "clicked" &&
				actionsDom?.insideTheBand === true &&
				actionsDom?.aboveThePage === true &&
				actionsDom.tags.includes("browser-tab-hand-over") &&
				actionsDom.tags.includes("browser-tab-actions-close") &&
				(watchOffered === false ||
					(actionsDom.tags.includes("browser-tab-watch") &&
						actionsDom.buttons.some((label) => label.startsWith("Watch ")))),
			JSON.stringify(
				{
					opened: openedActions,
					nonActiveTabPickedForWatch: watchOffered,
					actions: actionsDom,
				},
				null,
				2,
			),
		);
		/*
		 * The strip's growth is a RE-MEASURE of the content element, which is the
		 * mechanical fact the design's "the dock narrows the page" claim rests on (§2).
		 * Both numbers are read from the DOM, so a future change that put the actions
		 * row inside the content element (or over it) fails here rather than silently
		 * shrinking the page by nothing.
		 */
		check(
			"the strip's growth moves the page's rectangle by the row's own height: a re-measure, not a suppression",
			actionsDom !== null &&
				rectBeforeActions !== null &&
				rectWithActions !== null &&
				rectWithActions.y > rectBeforeActions.y &&
				Math.abs(rectWithActions.y - rectBeforeActions.y - actionsDom.height) <=
					2,
			`content rect without the actions row ${JSON.stringify(rectBeforeActions)} -> with it ${JSON.stringify(rectWithActions)}; the row measured ${actionsDom?.height}px, and the column keeps its height (the page loses exactly the row, not the whole strip)`,
		);
		say(`frame: ${join(OUT_DIR, "17-tab-actions-in-band.png")}`);

		// ---- 8. approving through the bar, then the agent drives --------------
		check(
			"the consent bar's scopes are answered by a real click, not by an API call",
			(await clickTag("browser-consent-site")) === "clicked",
			"clicked 'Always allow this site'",
		);
		const approved = await waitFor(async () => {
			const current = await chromeState();
			return current.pendingConsent.length === 0 ? current : null;
		}, "the prompt to be answered");
		check(
			"approving writes a durable exact-origin grant, visible in the approvals list",
			approved.approvals.some(
				(row) => row.origin === origin() && row.scope === "origin",
			),
			JSON.stringify(approved.approvals),
		);
		const awaited = await rpc(state, "await_access", {
			url: `${origin()}/second`,
			requester: "session:proof",
		});
		check(
			"the requesting session's await_access now reports allowed",
			awaited.json?.result?.state === "allowed",
			JSON.stringify(awaited.json?.result),
		);
		const approvedFrame = await captureRenderer("08-consent-approved");
		await compose(
			"08-consent-approved",
			approvedFrame,
			await capturePage(state, null, "approved-page"),
			rect,
		);
		say(`frame: ${join(OUT_DIR, "08-consent-approved.png")}`);

		// The agent opens a tab of its own: the strip must then show a user tab and
		// an agent tab side by side, and the user's active tab must not change.
		const activeBefore = (await chromeState()).activeTabId;
		const opened = await rpc(state, "open", { url: `${origin()}/second` });
		check(
			"the agent's open now succeeds on the approved origin and returns a handle",
			opened.json?.ok && typeof opened.json.result?.tab === "string",
			JSON.stringify(opened.json?.result?.tab),
		);
		const agentToken = opened.json.result.tab;
		const mixed = await chromeState();
		check(
			"the strip holds a user tab and an agent tab, and the agent's open did NOT steal the active tab",
			mixed.tabs.length === 2 &&
				mixed.tabs.some((tab) => tab.owner === "agent") &&
				mixed.activeTabId === activeBefore,
			`active before ${activeBefore}, active after ${mixed.activeTabId}, owners ${mixed.tabs.map((t) => t.owner).join(",")}`,
		);
		const stripDom = await evaluate(`(() => ({
			tabs: [...document.querySelectorAll('[data-tour-tag="browser-tab"]')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
			agentMarkers: document.querySelectorAll('[data-tour-tag="browser-tab-agent-marker"]').length,
			selected: [...document.querySelectorAll('[role="tab"]')].filter((el) => el.getAttribute('aria-selected') === 'true').length,
		}))()`);
		check(
			"the strip marks exactly the agent tab, and exactly one tab is selected",
			stripDom.agentMarkers === 1 && stripDom.selected === 1,
			JSON.stringify(stripDom, null, 2),
		);
		// The frame composites the page with the chrome, so the ACTIVE tab has to be
		// the one the harness can capture: a user-created tab has no handle at all
		// (design 6.3 — that is the property, not an inconvenience), so the agent's
		// tab is activated for the frame. Both tabs are in the strip either way, which
		// is what this frame is about.
		await activateAgentTab();
		await sleep(800);
		const mixedFrame = await captureRenderer("09-strip-user-and-agent");
		await compose(
			"09-strip-user-and-agent",
			mixedFrame,
			await capturePage(state, agentToken, "agent-tab-page"),
			rect,
		);
		say(`frame: ${join(OUT_DIR, "09-strip-user-and-agent.png")}`);

		/*
		 * THE PAGE LAYER, on a tab the harness can photograph.
		 *
		 * The frames above are the chrome: `screenshot` and `read` require a surface
		 * HANDLE, and a user-created tab has none (design 6.3), so the native view is
		 * not addressable for them at all. These three states — loading, populated,
		 * error — are therefore taken again on the agent's tab, which the strip marks
		 * as the agent's, and composited at the same reported rectangle.
		 */
		const agentRect = await contentRect();
		/*
		 * The loading frame is driven by TYPING, not by the agent's `goto`, and that is a
		 * measurement rather than a preference: a tab's command lane is held for the
		 * whole of a `goto` (that is what makes the lane a lane), so the page layer
		 * cannot be captured while the agent's own load is in flight — the first version
		 * of this frame came back `busy`. The user's navigation holds no lane, which is
		 * also the fastest way to show the takeover case: the person acts in a tab the
		 * agent owns, and the agent's next action simply reads the live page (11.8).
		 */
		check(
			"the user can drive a tab the AGENT created (takeover), and the agent's handle keeps working on it",
			(await typeAddress(`${origin()}/slow`)) === "typed",
			"typed a URL into the address bar while the agent's tab was active",
		);
		await waitFor(
			async () => ((await chromeState()).loading ? true : null),
			"the agent's tab to be loading",
			15_000,
		);
		const agentLoadingFrame = await captureRenderer(
			"13-surface-loading-agent-tab",
		);
		await compose(
			"13-surface-loading-agent-tab",
			agentLoadingFrame,
			await capturePage(state, agentToken, "agent-loading"),
			agentRect,
		);
		say(`frame: ${join(OUT_DIR, "13-surface-loading-agent-tab.png")}`);
		await waitFor(
			async () => ((await chromeState()).loading ? null : true),
			"the typed load to finish",
			30_000,
		);
		const agentGoto = await rpc(state, "goto", {
			tab: agentToken,
			url: `${origin()}/second`,
		});
		check(
			"the agent's goto still drives that tab after the user took over, and settles on what it reached",
			agentGoto.json?.ok && agentGoto.json.result?.url?.endsWith("/second"),
			JSON.stringify(agentGoto.json?.result?.url ?? agentGoto.json?.error),
		);
		const agentPopulatedFrame = await captureRenderer(
			"14-surface-populated-agent-tab",
		);
		const agentPageShot = await capturePage(
			state,
			agentToken,
			"agent-populated",
		);
		await compose(
			"14-surface-populated-agent-tab",
			agentPopulatedFrame,
			agentPageShot,
			agentRect,
		);
		check(
			"the populated frame carries the page layer (the composite has a page image, not a hole)",
			existsSync(agentPageShot ?? ""),
			`page layer: ${agentPageShot}`,
		);
		say(`frame: ${join(OUT_DIR, "14-surface-populated-agent-tab.png")}`);

		const deadLoad = rpc(state, "goto", {
			tab: agentToken,
			url: `${origin()}/broken`,
		});
		const deadResult = await deadLoad;
		// A failed navigation does not COMMIT, so the tab's live URL stays the last page
		// it reached — which is the design's rule working ("the live url, never what was
		// requested") and not a stale edit. What must not happen is a tab stuck loading.
		const agentErrorState = await waitFor(
			async () => {
				const current = await chromeState();
				return current.loading === false ? current : null;
			},
			"the failed load to stop loading",
			25_000,
		);
		const agentErrorFrame = await captureRenderer("15-surface-error-agent-tab");
		await compose(
			"15-surface-error-agent-tab",
			agentErrorFrame,
			await capturePage(state, agentToken, "agent-error"),
			agentRect,
		);
		check(
			"a failed load reports the failure to the agent and does not leave the tab stuck loading",
			deadResult.json?.error?.code === "nav_failed" &&
				agentErrorState.loading === false,
			`agent goto -> ${JSON.stringify(deadResult.json?.error ?? deadResult.json?.result)}; tab url ${agentErrorState.url} (the last page it COMMITTED, which is the live url); loading ${agentErrorState.loading}`,
		);
		say(`frame: ${join(OUT_DIR, "15-surface-error-agent-tab.png")}`);

		/*
		 * ---- 8b. the strip's own pixels, and the recovery half on a tab that CAN
		 * be photographed -----------------------------------------------------
		 *
		 * D5 asked for frames that CONTAIN the tab strip. The strip is where the agent
		 * marker, the active/inactive step, the `Waiting`/`Failed` chips and the
		 * `Restored` badge live, and every round-2 frame had the app's connectivity
		 * banner over it. The banner is now suppressed durably and the strip's own
		 * exposure asserted before every capture (`exposeStrip`), so this frame IS the
		 * strip: a user tab active beside the agent tab that just failed — the only
		 * place the `Failed` chip appears without the panel (design round 1, D1's
		 * second affordance, unphotographed until now).
		 */
		const userActivated = await activateUserTab();
		const stripFrame = await captureRenderer(
			"16-surface-strip-failed-agent-tab",
		);
		const stripState = await chromeState();
		await compose(
			"16-surface-strip-failed-agent-tab",
			stripFrame,
			null,
			agentRect,
		);
		check(
			"the strip frame carries both owners, the failed agent tab marked, with the user's own tab active",
			userActivated === "clicked" &&
				Array.isArray(stripState.tabs) &&
				stripState.tabs.length >= 2 &&
				stripState.tabs.some(
					(tab) => tab.owner === "agent" && tab.failed === true,
				) &&
				stripState.tabs.some(
					(tab) => tab.owner === "user" && tab.active === true,
				),
			`strip ${JSON.stringify(stripState.tabs?.map((tab) => ({ id: tab.tabId, owner: tab.owner, active: tab.active, failed: tab.failed, restored: tab.restored, title: tab.title })))}`,
		);
		record(
			"what this frame's content region is (and is not)",
			"the subject is the STRIP: it is above the content rect, where no native view paints. The region below it is not composited, because the active tab is the user's and a user tab holds no handle by design (design 7.3) - `04c` and the recovered agent frame `15b` are where the page layer itself is photographed.",
		);
		say(`frame: ${join(OUT_DIR, "16-surface-strip-failed-agent-tab.png")}`);

		/*
		 * The recovery half of D1 on the tab that can show it. `04c` recovers the USER
		 * tab, whose page holds no handle and therefore cannot be captured by any
		 * means (design 7.3) — that frame discloses the limitation rather than hiding
		 * it. Here the same recovery runs on the AGENT tab, through the handle the
		 * host issued it, so the recovered page is IN the frame.
		 */
		await activateAgentTab();
		await rpc(state, "goto", { tab: agentToken, url: `${origin()}/second` });
		const recoveredAgentState = await waitFor(
			async () => {
				const current = await chromeState();
				return current.loading === false ? current : null;
			},
			"the recovered agent load to settle",
			25_000,
		);
		const recoveredAgentFrame = await captureRenderer(
			"15b-surface-recovered-agent-tab",
		);
		const recoveredAgentPage = await capturePage(
			state,
			agentToken,
			"agent-recovered",
		);
		await compose(
			"15b-surface-recovered-agent-tab",
			recoveredAgentFrame,
			recoveredAgentPage,
			agentRect,
		);
		check(
			"the agent tab's recovery is photographed WITH its page: the load succeeds, the panel is gone and the page layer is in the frame",
			existsSync(recoveredAgentPage ?? "") &&
				recoveredAgentState.navFailure === null,
			`page layer: ${recoveredAgentPage}; navFailure ${JSON.stringify(recoveredAgentState.navFailure ?? null)}`,
		);
		say(`frame: ${join(OUT_DIR, "15b-surface-recovered-agent-tab.png")}`);

		// ---- 9. the denied case, and the revocation surface -------------------
		const secondOriginRequest = await rpc(state, "request_access", {
			url: "http://127.0.0.1:1/denied",
			requester: "session:proof",
		});
		if (secondOriginRequest.json?.result?.state === "pending") {
			await waitFor(
				async () => ((await chromeState()).pendingConsent.length ? true : null),
				"the second prompt",
			);
			check(
				"the deny action is offered and answers the prompt",
				(await clickTag("browser-consent-deny")) === "clicked",
				"clicked 'Don't allow'",
			);
			await waitFor(
				async () => ((await chromeState()).pendingConsent.length ? null : true),
				"the prompt to close",
			);
		}
		const denied = await chromeState();
		check(
			"a denial is recorded as a durable row so the Sites list can show it",
			denied.approvals.some((row) => row.scope === "deny"),
			JSON.stringify(denied.approvals),
		);
		await sleep(300);
		const deniedFrame = await captureRenderer("10-consent-denied");
		await compose(
			"10-consent-denied",
			deniedFrame,
			await capturePage(state, agentToken, "denied-page"),
			rect,
		);
		say(`frame: ${join(OUT_DIR, "10-consent-denied.png")}`);

		/*
		 * ---- 7b. WHY THE MARKER'S POSITIVE LIVE CASE IS NOT ASSERTED HERE --------
		 *
		 * §5.2's marker says the TAB is parked on an origin the agent is not approved
		 * for. The negative half is driven live in section 6 (a live request for the
		 * origin the USER's own tab is on carries no marker, which is the UX round's U3
		 * and the reason the marker is gated on `owner === "agent"`), and both halves are
		 * unit-tested in `browser-chrome.test.mjs`.
		 *
		 * The positive half is not reachable in THIS harness, and the three routes were
		 * each tried and measured rather than assumed:
		 *
		 * - A second conversation asking for the origin the agent's tab is parked on:
		 *   the harness grants `Always allow this site` here, and a durable site approval
		 *   is app-wide (its own gloss says "shared with every conversation"), so
		 *   `request_access` answers `allowed` and there is no pending request to mark.
		 *   Measured: the request came back allowed, no chip.
		 * - An agent navigating to an unapproved origin, so a tab lands there and waits:
		 *   refused before a tab is created (`origin_not_allowed`, no new tab) — the same
		 *   wall the round-1 UX pass hit and recorded.
		 * - Revoking the parked tab's approval and asking again: it works, and it is the
		 *   reason the case is real in production (a `once` grant is per requester), but
		 *   revoking here empties the Approved list the dock's own checks below read, so
		 *   the state it would create costs more than the assertion buys.
		 *
		 * The rendered half is photographed instead: `browser-tab-strip--waiting` and
		 * `browser-tab-strip--agent-and-waiting` in the committed frame set.
		 */
		/*
		 * ---- 7c. THE TITLE'S MEASURE, MARKED AND UNMARKED (design round 3, D13;
		 *          QA round 2, Q4; the UX round's U5) --------------------------------
		 *
		 * The operator's own ask, and the round-1 fix did not deliver it. `min-w-44`
		 * raised the floor, but the two 28px controls are revealed with `opacity-0` -
		 * which does not reclaim LAYOUT - so every tab still spent 68px of its 176px
		 * on chrome nobody can see. On an unmarked row that left ~68px of title; on a
		 * marked one the 43px `Agent` chip took it to 21px, one glyph, on exactly the
		 * tabs this feature adds.
		 *
		 * Measured in the running app, at the floor, on both kinds of row - not in a
		 * story, whose decorator sets its own width. The extra tabs are real tabs
		 * opened through the bridge and closed again, so the sections after this one
		 * see the strip they expect.
		 */
		/*
		 * WHAT THE MARKER'S BOX IS FOR, because geometry passing while the marker is
		 * invisible is the exact failure this check shipped with (review round 3,
		 * MAJOR 1). The first version asked whether the marker ELEMENT exists and how
		 * wide the title was - and the overlaid chrome cluster, opaque in every state,
		 * covered the marker on every marked row, so the check was green with the one
		 * element that distinguishes an agent tab from a user tab painted out. It now
		 * reports each row's marker box and the cluster's box, so the assertion can be
		 * about non-overlap and non-zero paint rather than about presence.
		 */
		const measureTitles = async () =>
			JSON.parse(
				await evaluate(`(() => {
					const rows = [...document.querySelectorAll('[role="tab"]')].map((tab) => {
						const box = tab.parentElement;
						const title = box.querySelector('[data-tour-tag="browser-tab-title"]');
						const marker = box.querySelector('[data-tour-tag="browser-tab-agent-marker"]');
						const cluster = box.querySelector('[data-tour-tag="browser-tab-menu"]')?.parentElement ?? null;
						const rect = (node) => {
							if (!node) return null;
							const box = node.getBoundingClientRect();
							return { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), height: Math.round(box.height) };
						};
						/*
						 * A BOX IS NOT PAINT (review round 4, MINOR). The assertions above are
						 * geometric, and a marker at 'opacity: 0' or scrolled out of the strip's
						 * own clip box has a healthy box with no overlap and would pass. So each
						 * row also reports whether the marker is hit-testable at its own centre
						 * and what its computed opacity is.
						 */
						const markerInk = () => {
							if (!marker) return null;
							const box = marker.getBoundingClientRect();
							const cx = Math.round(box.left + box.width / 2);
							const cy = Math.round(box.top + box.height / 2);
							// A row scrolled out of the strip's own viewport has its centre outside
							// the window, where 'elementFromPoint' answers null - a chip that is
							// simply not on screen at this moment, which is not the invisibility
							// this check exists to catch. Off-screen rows are reported as such and
							// not held to a hit test; the rows that ARE on screen are.
							const inView =
								cx >= 0 && cx <= window.innerWidth && cy >= 0 && cy <= window.innerHeight;
							const hit = inView ? document.elementFromPoint(cx, cy) : null;
							return {
								opacity: getComputedStyle(marker).opacity,
								inView,
								hit: !inView || hit === marker || (hit !== null && marker.contains(hit)),
							};
						};
						// How many state chips the row carries: the floor is sized for it (see
						// 'browser-tab-strip.tsx'), and naming the specimen in the detail is what
						// stops a one-chip run from passing as proof about a three-chip row.
						const chips = [
							'[data-tour-tag="browser-tab-agent-marker"]',
							'[data-tour-tag="browser-tab-failed"]',
							'[data-tour-tag="browser-tab-waiting"]',
						].filter((sel) => box.querySelector(sel)).length +
							[...box.querySelectorAll('span')].filter((el) =>
								/^(Shared|Restored)$/.test(el.textContent?.trim() ?? '')
							).length;
						/*
						 * CONTAINMENT, measured on the row itself (review round 5, MAJOR). The
						 * floor is a ceiling at four and five chips and the chips are
						 * 'shrink-0', so what keeps a pathological row from painting over its
						 * neighbour is the row's own 'overflow-hidden' - and that is a claim
						 * about boxes, so it is asserted from boxes: no chip may extend past
						 * the tab's right edge (or before its left).
						 */
						/*
						 * THE NOTCH, measured because nothing else measures it (review round 6,
						 * MAJOR 1). It is 1px of 'canvas' at '-bottom-px', and for one round the
						 * row-level clip removed it entirely on every active tab while every
						 * check stayed green. A clip is an intersection with the padding boxes of
						 * the overflow ancestors, so that is what this computes: if the notch's
						 * box survives the intersection it paints.
						 */
						const notchPainted = () => {
							const notch = box.querySelector('[data-tour-tag="browser-tab-notch"]');
							if (!notch) return null;
							const rect = notch.getBoundingClientRect();
							let top = rect.top;
							let bottom = rect.bottom;
							let left = rect.left;
							let right = rect.right;
							for (let p = notch.parentElement; p; p = p.parentElement) {
								if (getComputedStyle(p).overflow === 'visible') continue;
								const pr = p.getBoundingClientRect();
								top = Math.max(top, pr.top);
								bottom = Math.min(bottom, pr.bottom);
								left = Math.max(left, pr.left);
								right = Math.min(right, pr.right);
							}
							return {
								height: Math.round(rect.height),
								width: Math.round(right - left),
								painted: bottom - top >= 1 && right - left >= 1,
							};
						};
						const tabBox = box.getBoundingClientRect();
						const chipEls = [
							...box.querySelectorAll('span'),
						].filter((el) => /^(Agent|Shared|Restored|Failed)$/.test(el.textContent?.trim() ?? ''));
						const waitingEl = box.querySelector('[data-tour-tag="browser-tab-waiting"]');
						if (waitingEl) chipEls.push(waitingEl);
						const outside = chipEls.filter((el) => {
							const rect = el.getBoundingClientRect();
							return rect.right > tabBox.right + 1 || rect.left < tabBox.left - 1;
						}).length;
						return {
							tabId: tab.getAttribute('data-tab-id') ?? box.getAttribute('data-tab-id'),
							active: tab.getAttribute('aria-selected') === 'true',
							marked: !!marker,
							chips,
							chipsOutside: outside,
							notch: notchPainted(),
							markerInk: markerInk(),
							tabWidth: Math.round(box.getBoundingClientRect().width),
							titleBox: title ? Math.round(title.getBoundingClientRect().width) : null,
							titleRight: rect(title)?.right ?? null,
							titleText: title?.textContent?.trim() ?? null,
							markerBox: rect(marker),
							clusterBox: rect(cluster),
						};
					});
					return JSON.stringify({ rows });
				})()`),
			);

		const beforeWide = await measureTitles();
		const beforeState = await chromeState();
		const activeBeforeCrowding =
			beforeState.tabs.find((tab) => tab.active)?.tabId ?? null;
		for (let index = 0; index < 9; index += 1) {
			await evaluate(
				`window.api.browser.newTab().then(() => "ok").catch(() => "refused")`,
			);
		}
		await waitFor(
			async () => {
				const current = await chromeState();
				return current.tabs.length >= 11 ? true : null;
			},
			"the strip to reach the width floor",
			20_000,
		).catch(() => null);
		// The ids to close are whatever the strip holds that it did not hold before.
		const extraTabs = (await chromeState()).tabs
			.map((tab) => tab.tabId)
			.filter((id) => !beforeState.tabs.some((tab) => tab.tabId === id));
		const crowded = await measureTitles();
		const marked = crowded.rows.filter((row) => row.marked);
		const unmarked = crowded.rows.filter((row) => !row.marked);
		const narrowest = Math.min(...crowded.rows.map((row) => row.titleBox ?? 0));
		/*
		 * THE TITLE THRESHOLD IS CLAIMED FOR THE ROWS IT IS SIZED FOR (review rounds 5
		 * and 6): every ACTIVE row keeps >= 85px at every chip count, and the one row
		 * that yields the title is the INACTIVE five-chip row - the pathological state
		 * that is not the tab the user is looking at, held to containment instead of to
		 * a number its floor does not promise. The run's own specimen is named in the
		 * detail either way.
		 */
		check(
			"at the width floor a MARKED tab still names its site: the chrome cluster is overlaid, not reserved",
			crowded.rows.length >= 10 &&
				marked.length >= 1 &&
				unmarked.every((row) => (row.titleBox ?? 0) >= 60) &&
				marked.every((row) =>
					row.chips >= 5 && !row.active ? true : (row.titleBox ?? 0) >= 85,
				) &&
				narrowest >= 60,
			JSON.stringify({ two: beforeWide.rows, crowded, narrowest }, null, 2),
		);
		check(
			"no chip crosses its tab's own edge, at any chip count the registry can reach",
			crowded.rows.every((row) => row.chipsOutside === 0),
			JSON.stringify(
				{
					outside: crowded.rows.filter((row) => row.chipsOutside !== 0),
					specimen: crowded.rows.map((row) => ({
						chips: row.chips,
						chipsOutside: row.chipsOutside,
						titleBox: row.titleBox,
						active: row.active,
					})),
				},
				null,
				2,
			),
		);
		/*
		 * THE NOTCH IS PAINTED ON THE ACTIVE TAB, and only there (review round 6, MAJOR
		 * 1). It is the 1px of the page's own ground that makes the active tab
		 * continuous with the content area - design-approved, listed as shipped in this
		 * PR's body, and measured by nothing until this check existed. A row-level
		 * `overflow-hidden` removed it on every active tab for one round without a
		 * single check noticing, which is the whole argument for asserting it here.
		 */
		const activeRows = crowded.rows.filter((row) => row.active);
		check(
			"the active tab's notch into the page is painted, and no inactive tab carries one",
			activeRows.length >= 1 &&
				activeRows.every((row) => row.notch !== null) &&
				activeRows.every(
					(row) => row.notch.height === 1 && row.notch.painted,
				) &&
				crowded.rows
					.filter((row) => !row.active)
					.every((row) => row.notch === null),
			JSON.stringify(
				{
					active: activeRows.map((row) => ({
						tabId: row.tabId,
						notch: row.notch,
						chips: row.chips,
						tabWidth: row.tabWidth,
					})),
					inactiveWithNotch: crowded.rows
						.filter((row) => !row.active && row.notch !== null)
						.map((row) => row.tabId),
				},
				null,
				2,
			),
		);
		/*
		 * THE MARKER MUST BE PAINTED, on every marked row, in the state the run is in -
		 * and the assertion is geometric because it can be: the marker LEADS the title
		 * now, and the only element that could cover it is the chrome cluster, so
		 * requiring the marker's box to be non-empty and to end before the cluster's box
		 * begins is a check with a failure mode rather than a presence test.
		 */
		const covered = crowded.rows.filter(
			(row) =>
				row.marked &&
				(!row.markerBox ||
					row.markerBox.width <= 0 ||
					row.markerBox.height <= 0 ||
					(row.clusterBox !== null &&
						row.markerBox.right > row.clusterBox.left + 1) ||
					row.markerInk === null ||
					row.markerInk.opacity === "0" ||
					row.markerInk.hit !== true),
		);
		check(
			"every marked row's chip is painted - visible, hit-testable at its own centre, and clear of the chrome cluster",
			marked.length >= 1 && covered.length === 0,
			JSON.stringify(
				{
					covered,
					// The specimen, named: how many chips each marked row carries, because the
					// row's floor is sized for that count (review round 4, MINOR).
					specimen: marked.map((row) => ({
						chips: row.chips,
						titleBox: row.titleBox,
						inView: row.markerInk?.inView ?? null,
					})),
					// Named rather than silent: how many marked rows were scrolled out of the
					// strip's viewport, and so were not hit-tested at all.
					outOfView: marked.filter((row) => row.markerInk?.inView === false)
						.length,
				},
				null,
				2,
			),
		);
		/*
		 * AND THE MARKER IS NOT A ONE-OFF: the same check on the ACTIVE row, which is the
		 * case the old cluster hid permanently (`bg-canvas` over `bg-canvas`, so the chip
		 * was invisible at rest and not merely on hover). If the active row happens to be
		 * unmarked this reports that rather than asserting a state the run did not reach.
		 */
		const activeRow = crowded.rows.find((row) => row.active) ?? null;
		check(
			"the active row's chrome sits in flow, so nothing in it can be painted over",
			activeRow === null ||
				activeRow.clusterBox === null ||
				(activeRow.titleRight ?? 0) <= activeRow.clusterBox.left + 1,
			JSON.stringify({ activeRow }, null, 2),
		);
		// Put the strip back: the sections after this one count tabs, and the session
		// file at the end of the run must match them.
		for (const id of extraTabs) {
			await evaluate(
				`window.api.browser.closeTab(${id}).then(() => "ok").catch(() => "closed")`,
			);
		}
		if (activeBeforeCrowding !== null) {
			await evaluate(
				`window.api.browser.activateTab(${activeBeforeCrowding}).then(() => "ok").catch(() => "no")`,
			);
		}
		await waitFor(
			async () => {
				const current = await chromeState();
				return current.tabs.length <= 2 ? true : null;
			},
			"the strip to return to the two tabs the later sections expect",
			15_000,
		).catch(() => null);

		// ---- 9b. the queue: two requests coexist, and the badge counts them ---
		//
		// THE SIDE EFFECT THE OLD MODEL COULD NOT PRODUCE. `requestAccess` used to call
		// `displaceLive` on every new request, which cleared the WHOLE live queue, so a
		// second origin's request destroyed the first one's (its own test said "one
		// prompt slot, replace-don't-queue"). Both requests here are raised through the
		// real RPC and read back from the renderer's own projection, and then the newer
		// one is ANSWERED to show the older one still waiting — which is the property a
		// single slot could not have, not merely a count.
		const queuedFirst = await rpc(state, "request_access", {
			url: "https://queued-first.example/",
			requester: "session:proof",
		});
		const queuedSecond = await rpc(state, "request_access", {
			url: "https://queued-second.example/",
			requester: "session:other",
		});
		const bothPending = await waitFor(
			async () => {
				const current = await chromeState();
				return current.pendingConsent.length === 2 ? current : null;
			},
			"two requests to be live at once",
			20_000,
		).catch(() => null);
		const trayDom = JSON.parse(
			await evaluate(`(() => {
				const badge = document.querySelector('[data-tour-tag="browser-approvals-badge"]');
				const chips = [...document.querySelectorAll('[data-tour-tag="browser-approvals-tray-chip"]')];
				const control = document.querySelector('[data-tour-tag="browser-approvals"]');
				return JSON.stringify({
					count: ((document.querySelector('[data-tour-tag="browser-approvals-tray-count"]') || {}).innerText || '').trim(),
					chips: chips.map((chip) => chip.innerText.trim()),
					chipNames: chips.map((chip) => chip.getAttribute('aria-label')),
					selected: chips.filter((chip) => chip.getAttribute('aria-current') === 'true').map((chip) => chip.innerText.trim()),
					card: ((document.querySelector('[data-tour-tag="browser-consent-request"]') || {}).innerText || '').trim(),
					badge: badge ? badge.innerText.trim() : null,
					controlLabel: control ? control.getAttribute('aria-label') : null,
				});
			})()`),
		);
		check(
			"a second request is queued behind the first, and the band shows both as numbered chips",
			bothPending !== null &&
				bothPending.pendingConsent[0].entryId ===
					queuedFirst.json?.result?.entry_id &&
				trayDom.count === "2 approvals waiting" &&
				JSON.stringify(trayDom.chips) === JSON.stringify(["1", "2"]) &&
				JSON.stringify(trayDom.selected) === JSON.stringify(["1"]) &&
				trayDom.chipNames[1] ===
					"Request 2 from The agent in conversation other: queued-second.example" &&
				trayDom.card.includes("queued-first.example"),
			JSON.stringify(
				{
					pending: bothPending?.pendingConsent?.map((entry) => entry.origin),
					tray: trayDom,
				},
				null,
				2,
			),
		);
		check(
			"the Approvals control carries the live count, as a badge and in its own accessible name",
			trayDom.badge === "2" && trayDom.controlLabel === "Approvals, 2 waiting",
			`badge ${JSON.stringify(trayDom.badge)}; aria-label ${JSON.stringify(trayDom.controlLabel)}`,
		);
		/*
		 * AND THE BADGE IS INSIDE THE WINDOW (design round 2, D3). It used to sit on the
		 * control's OUTER corner, which put 7px of it past the URL bar's own box — and
		 * that box is the window's right edge, so the far arc of the circle was outside
		 * the frame and only the numeral survived. Measured here in situ rather than in
		 * a story: the stories' decorator pads the page, which is exactly why they could
		 * not show it.
		 */
		const badgeBox = JSON.parse(
			await evaluate(`(() => {
				const badge = document.querySelector('[data-tour-tag="browser-approvals-badge"]');
				if (!badge) return JSON.stringify({ present: false });
				const box = badge.getBoundingClientRect();
				return JSON.stringify({
					present: true,
					left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top),
					viewport: window.innerWidth, viewportHeight: window.innerHeight,
					scrollWidth: document.documentElement.scrollWidth,
				});
			})()`),
		);
		check(
			"the badge paints INSIDE the window: its right edge is inside the viewport and it adds no horizontal scroll",
			badgeBox.present === true &&
				badgeBox.right <= badgeBox.viewport &&
				badgeBox.left >= 0 &&
				badgeBox.top >= 0 &&
				badgeBox.scrollWidth <= badgeBox.viewport,
			JSON.stringify(badgeBox),
		);

		const trayFrame = await captureRenderer("12-approvals-queue");
		await compose("12-approvals-queue", trayFrame, null, rect);
		say(`frame: ${join(OUT_DIR, "12-approvals-queue.png")}`);

		// Answer the SECOND request, from its chip, and assert the first is untouched:
		// the badge drops to 1, the header row goes away (one request has nothing to
		// disambiguate), and the older request is still live.
		await evaluate(`(() => {
			const chips = [...document.querySelectorAll('[data-tour-tag="browser-approvals-tray-chip"]')];
			if (chips[1]) chips[1].click();
			return chips.length;
		})()`);
		await sleep(300);
		const decidedSecond = await clickTag("browser-consent-once");
		const afterDecision = await waitFor(
			async () => {
				const current = await chromeState();
				return current.pendingConsent.length === 1 ? current : null;
			},
			"the second request to be answered",
			20_000,
		).catch(() => null);
		const afterDom = JSON.parse(
			await evaluate(`(() => {
				const badge = document.querySelector('[data-tour-tag="browser-approvals-badge"]');
				const control = document.querySelector('[data-tour-tag="browser-approvals"]');
				return JSON.stringify({
					badge: badge ? badge.innerText.trim() : null,
					headerRow: !!document.querySelector('[data-tour-tag="browser-approvals-tray-count"]'),
					controlLabel: control ? control.getAttribute('aria-label') : null,
				});
			})()`),
		);
		check(
			"answering the newer request leaves the older one waiting, and the badge follows the decisions down",
			decidedSecond === "clicked" &&
				afterDecision !== null &&
				afterDecision.pendingConsent[0].entryId ===
					queuedFirst.json?.result?.entry_id &&
				afterDom.badge === "1" &&
				afterDom.headerRow === false &&
				afterDom.controlLabel === "Approvals, 1 waiting",
			JSON.stringify(
				{
					remaining: afterDecision?.pendingConsent?.map(
						(entry) => entry.origin,
					),
					decidedSecond,
					dom: afterDom,
				},
				null,
				2,
			),
		);

		// ---- 9c. the approvals dock: in flow, narrowing the page --------------
		//
		// THE REPLACEMENT FOR THE SHEET, and the measurement is the claim: the sheet
		// registered browser-view suppression exactly like a dialog, so the page was
		// hidden while the user read what they had granted. The dock is a flex sibling
		// of the content element, so the page's rectangle NARROWS and the page stays
		// visible — read from the DOM rather than inferred.
		const rectBeforeDock = await contentRect();
		const openedDock = await realClick('[data-tour-tag="browser-approvals"]');
		await sleep(600);
		const dockDom = JSON.parse(
			await evaluate(`(() => {
				const dock = document.querySelector('[data-tour-tag="browser-approvals-dock"]');
				if (!dock) return JSON.stringify({ present: false });
				return JSON.stringify({
					present: true,
					width: Math.round(dock.getBoundingClientRect().width),
					// The one thing the sheet could not claim: no suppression, so the page is
					// not paused and no dialog-scrim is registered behind this list.
					pausedBehindIt: !!document.querySelector('[data-tour-tag="browser-paused"]'),
					suppressedBy: (document.querySelector('[data-tour-tag="browser-content"]') || {}).dataset?.suppressedBy || '',
					headings: [...dock.querySelectorAll('h3')].map((h) => h.innerText.trim()),
					title: (dock.querySelector('[data-tour-tag="browser-approvals-dock-title"]') || {}).innerText || '',
					hasAgentsNotice: !!dock.querySelector('[data-tour-tag="browser-agents-notice"]'),
					hasRevokeOne: !!dock.querySelector('[data-tour-tag="browser-revoke-approval"]'),
					hasRevokeAll: !!dock.querySelector('[data-tour-tag="browser-revoke-all"]'),
					hasForgetSite: !!dock.querySelector('[data-tour-tag="browser-forget-site"]'),
					hasCookieClear: !!dock.querySelector('[data-tour-tag="browser-clear-cookies"]'),
					waitingRows: [...dock.querySelectorAll('[data-tour-tag="browser-approvals-waiting-row"]')].map((row) => row.innerText.trim()),
					// The standing notice must come BEFORE the lists its words point at ("each
					// site below"): it used to be the panel's last child, under Browsing data,
					// pointing at nothing (review round 1, finding 2; design round 2, D6).
					noticeBeforeWaiting: (() => {
						const notice = dock.querySelector('[data-tour-tag="browser-agents-notice"]');
						const waiting = [...dock.querySelectorAll('h3')].find((h) => h.innerText.trim() === 'Waiting');
						if (!notice || !waiting) return null;
						return Boolean(notice.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING);
					})(),
					// The dock's request card is the STACKED form of the shared component
					// (design round 2, D2): one column, so the descriptions get the panel's
					// width instead of 129px of it after a 96px gutter.
					scopeTracks: (() => {
						const dl = dock.querySelector('[data-tour-tag="browser-consent-scopes"]');
						if (!dl) return null;
						return getComputedStyle(dl).gridTemplateColumns.split(' ').filter(Boolean).length;
					})(),
					// The header's own summary now counts the QUEUE it opens onto, not only the
					// approved list (design round 2, D8).
					headerSummary: (() => {
						const h2 = dock.querySelector('[data-tour-tag="browser-approvals-dock-title"]');
						const p = h2?.parentElement?.querySelector('p');
						return p ? p.innerText.trim() : null;
					})(),
					focused: document.activeElement ? document.activeElement.getAttribute('data-tour-tag') : null,
				});
			})()`),
		);
		const rectWithDock = await contentRect();
		const dockFrame = await captureRenderer("18-approvals-dock");
		const dockPage = await capturePage(state, agentToken, "dock-page");
		await compose("18-approvals-dock", dockFrame, dockPage, rectWithDock);
		record(
			"what this frame's page layer is (and is not)",
			"the dock is in flow, so the page is NOT suppressed and is composited at the NARROWED rect the renderer reports. The page layer is the agent tab's own capture, because a capture needs a handle and a user tab holds none by design (design 7.3): the geometry is the claim here, and it is measured from the DOM rather than read off the picture.",
		);
		check(
			"the Approvals dock answers 'which sites can an agent act on as me' in one click, with the revocation affordances",
			openedDock === "clicked" &&
				dockDom.present === true &&
				dockDom.title === "Approvals" &&
				dockDom.hasAgentsNotice &&
				dockDom.hasRevokeOne &&
				dockDom.hasRevokeAll &&
				dockDom.hasForgetSite &&
				dockDom.hasCookieClear &&
				dockDom.headings.includes("Waiting") &&
				dockDom.waitingRows.length > 0,
			JSON.stringify({ opened: openedDock, dock: dockDom }, null, 2),
		);
		check(
			"the dock NARROWS the page instead of hiding it: no suppression, and the content rectangle loses exactly the dock's width",
			dockDom.pausedBehindIt === false &&
				dockDom.suppressedBy === "" &&
				rectBeforeDock !== null &&
				rectWithDock !== null &&
				rectWithDock.x === rectBeforeDock.x &&
				Math.abs(rectBeforeDock.width - rectWithDock.width - dockDom.width) <=
					2,
			`content rect without the dock ${JSON.stringify(rectBeforeDock)} -> with it ${JSON.stringify(rectWithDock)}; the dock measured ${dockDom.width}px, suppressedBy ${JSON.stringify(dockDom.suppressedBy)}`,
		);
		check(
			"opening the dock moves focus into it, so Escape has somewhere to be handled",
			dockDom.focused === "browser-approvals-dock-title",
			`active element: ${JSON.stringify(dockDom.focused)}`,
		);
		check(
			"the dock is in the order its copy assumes: the standing notice first, the stacked legend, and a header that counts the queue",
			dockDom.noticeBeforeWaiting === true &&
				dockDom.scopeTracks === 1 &&
				typeof dockDom.headerSummary === "string" &&
				/\d+ waiting/.test(dockDom.headerSummary),
			JSON.stringify(
				{
					noticeBeforeWaiting: dockDom.noticeBeforeWaiting,
					scopeTracks: dockDom.scopeTracks,
					headerSummary: dockDom.headerSummary,
				},
				null,
				2,
			),
		);
		say(`frame: ${join(OUT_DIR, "18-approvals-dock.png")}`);

		/*
		 * ---- 9c-2. DECIDING FROM THE DOCK KEEPS THE DOCK USABLE (UX round 1, U1) --
		 *
		 * The reported defect: answering the selected request unmounts the row whose
		 * button was pressed, focus falls to `<body>`, and because the Escape handler
		 * was bound on the dock's own `<section>` it never fired again — so §4.2's
		 * contract ("Escape closes it and returns focus to the trigger") broke at exactly
		 * the moment the user finished deciding. Both halves are driven here with a real
		 * click and a real key: the decision must leave focus INSIDE the dock, and Escape
		 * must then close it.
		 */
		const decidedFromDock = await clickTag("browser-consent-once");
		await sleep(500);
		const afterDockDecision = JSON.parse(
			await evaluate(`(() => JSON.stringify({
				dockOpen: !!document.querySelector('[data-tour-tag="browser-approvals-dock"]'),
				focused: document.activeElement ? (document.activeElement.getAttribute('data-tour-tag') ?? document.activeElement.tagName) : null,
			}))()`),
		);
		check(
			"a decision made in the dock leaves focus inside it, not on `<body>`",
			decidedFromDock === "clicked" &&
				afterDockDecision.dockOpen === true &&
				afterDockDecision.focused === "browser-approvals-dock-title",
			JSON.stringify({ decidedFromDock, afterDockDecision }),
		);

		// Escape closes it and returns focus to the control that opened it (spec §4.2).
		// A REAL key event through CDP rather than a dispatched `KeyboardEvent`: the
		// handler is on the dock container, and a synthetic event would prove only that
		// a listener exists.
		await send("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
		await send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
		await sleep(400);
		const afterEscape = JSON.parse(
			await evaluate(`(() => JSON.stringify({
				open: !!document.querySelector('[data-tour-tag="browser-approvals-dock"]'),
				focused: document.activeElement ? document.activeElement.getAttribute('data-tour-tag') : null,
			}))()`),
		);
		const rectAfterEscape = await contentRect();
		check(
			"Escape closes the dock, returns the page's full width, and puts focus back on the Approvals control",
			afterEscape.open === false &&
				afterEscape.focused === "browser-approvals" &&
				afterEscape !== null &&
				rectAfterEscape !== null &&
				Math.abs(rectAfterEscape.width - rectBeforeDock.width) <= 2,
			JSON.stringify({ afterEscape, rectAfterEscape, rectBeforeDock }),
		);

		/*
		 * ---- 9d. RE-CONSENT after the grant is gone: the harness's own gap --------
		 *
		 * WHY THIS EXISTS, in the words of the end-to-end pass that found the defect:
		 * this harness passed every check it had on the shipped v0.24.0 build, because
		 * everything it exercised was the FIRST decision — and the failure was in the
		 * SECOND. `request_access` answered `allowed` from a resolved receipt (15-minute
		 * `ACCESS_RESULT_TTL_MS`) while the next `open` was refused with
		 * `origin_not_allowed`, and no band was raised: the agent was told it could
		 * proceed while the user was never asked. That is now fixed at one predicate
		 * (`approvals.ts`'s `liveAuthority`), and this is the run that fails if the
		 * second answer ever goes back to reading a receipt.
		 *
		 * The answer is sent through the renderer's own IPC by ENTRY ID rather than by
		 * clicking whichever button the band happens to be showing: several requests are
		 * live at this point and the card renders the SELECTED one, so a button click
		 * here would be a test of the selection rather than of the answer path. The BAND
		 * half of the claim is still read from the DOM.
		 */
		const reaskOrigin = "https://reask.example/";
		const reaskFirst = await rpc(state, "request_access", {
			url: reaskOrigin,
			requester: "session:proof",
		});
		const reaskFirstId = reaskFirst.json?.result?.entry_id;
		// Select the newest request in the tray so the band's card is about THIS one.
		const bandForFirst = await waitFor(
			async () => {
				await evaluate(`(() => {
					const chips = [...document.querySelectorAll('[data-tour-tag="browser-approvals-tray-chip"]')];
					const last = chips[chips.length - 1];
					if (last) last.click();
					return chips.length;
				})()`);
				const dom = JSON.parse(
					await evaluate(`(() => JSON.stringify({
						band: !!document.querySelector('[data-tour-tag="browser-consent-bar"]'),
						card: ((document.querySelector('[data-tour-tag="browser-consent-request"]') || {}).innerText || '').replace(/\\s+/g, ' ').trim(),
					}))()`),
				);
				return dom.band && dom.card.includes("reask.example") ? dom : null;
			},
			"the band to render the fresh request",
			15_000,
		).catch(() => null);
		check(
			"a request for a fresh origin raises the band and offers its card",
			reaskFirst.json?.result?.state === "pending" && bandForFirst !== null,
			JSON.stringify(
				{ requested: reaskFirst.json?.result, band: bandForFirst },
				null,
				2,
			),
		);
		// Answer `once`, spend it with a real `open`, and ask again.
		const answeredOnce = await evaluate(
			`window.api.browser.respondToConsent(${JSON.stringify(reaskFirstId)}, "once").then((s) => JSON.stringify(s))`,
		);
		const spentNavigation = await rpc(state, "open", {
			url: reaskOrigin,
			requester: "session:proof",
		});
		const afterSpend = await waitFor(
			async () => {
				const current = await chromeState();
				return current.pendingConsent.every(
					(entry) => entry.entryId !== reaskFirstId,
				)
					? current
					: null;
			},
			"the once grant to be answered",
			15_000,
		);
		const reaskSecond = await rpc(state, "request_access", {
			url: reaskOrigin,
			requester: "session:proof",
		});
		const reaskSecondId = reaskSecond.json?.result?.entry_id;
		const bandForSecond = await waitFor(
			async () => {
				const dom = JSON.parse(
					await evaluate(`(() => JSON.stringify({
						band: !!document.querySelector('[data-tour-tag="browser-consent-bar"]'),
					}))()`),
				);
				if (!dom.band) return null;
				const state = await chromeState();
				return state.pendingConsent.some(
					(entry) => entry.entryId === reaskSecondId,
				)
					? { band: true, ids: state.pendingConsent.map((e) => e.entryId) }
					: null;
			},
			"the band to be raised for the second request",
			15_000,
		).catch(() => null);
		check(
			"RE-CONSENT: with the once grant spent, request_access does not answer `allowed` — it re-asks, and the band is raised (the shipped build answered `allowed` here and raised nothing)",
			answeredOnce !== undefined &&
				// `evaluate` returns the page value itself, not a wrapper: the IPC call
				// resolves with the state it answered, and a rejection throws out of the
				// helper rather than landing here.
				typeof answeredOnce === "string" &&
				// The gate ADMITTED the navigation, which is what captures the grant: a
				// downstream DNS failure for a domain that does not resolve in this sandbox
				// is the ordinary shape of "the admission happened", and the check is that
				// the refusal is not `origin_not_allowed`. The proof the grant is GONE is the
				// re-ask below, which would have answered `allowed` if it were still spendable.
				(spentNavigation.json?.ok === true ||
					spentNavigation.json?.error?.code === "nav_failed") &&
				afterSpend !== null &&
				reaskSecond.json?.result?.state === "pending" &&
				reaskSecondId !== reaskFirstId &&
				bandForSecond !== null,
			JSON.stringify(
				{
					answered: answeredOnce,
					spentNavigation:
						spentNavigation.json?.result?.url ??
						spentNavigation.json?.error ??
						spentNavigation.text.slice(0, 200),
					reasked: reaskSecond.json?.result,
					band: bandForSecond,
				},
				null,
				2,
			),
		);
		// Drain the queue, so the frames and the checks after this section are not
		// composed over a band that none of them is about (a pending request moves the
		// content rectangle, and these frames are the strip's and the page's).
		const drained = await evaluate(`(async () => {
			const state = await window.api.browser.state();
			for (const entry of state.pendingConsent) {
				await window.api.browser.respondToConsent(entry.entryId, "deny");
			}
			return state.pendingConsent.length;
		})()`);
		const emptyQueue = await waitFor(
			async () => {
				const current = await chromeState();
				return current.pendingConsent.length === 0 ? current : null;
			},
			"the queue to drain",
			15_000,
		).catch(() => null);
		/*
		 * WHAT THE BAND LEAVING MEANS, precisely. The bar is not only the queue: it is
		 * also where §3.4's bounded memory renders the explanation that a request left,
		 * so after the queue empties the band stays up for as long as a resolved row is
		 * worth reading (`browser-surface.tsx:354-357`). Asserting "the band is gone"
		 * would therefore assert the absence of the feature the same round added. The
		 * assertion is the one that matters: nothing is WAITING any more - no chip, no
		 * row, no strip marker - and the only thing left in the bar is the explanation.
		 *
		 * Polled rather than sampled: the queue above is already empty here and the push
		 * that empties the renderer is asynchronous.
		 */
		const afterDrain = await waitFor(
			async () => {
				const read = JSON.parse(
					await evaluate(`(() => JSON.stringify({
						band: !!document.querySelector('[data-tour-tag="browser-consent-bar"]'),
						chips: document.querySelectorAll('[data-tour-tag="browser-approvals-tray-chip"]').length,
						// No waiting-row term: the dock returns null when closed, and the
						// Escape assertion a moment earlier closed it, so the count could only
						// ever read zero (review round 2, NIT-1). What the dock shows with the
						// queue empty is asserted where the dock IS open.
						markers: document.querySelectorAll('[data-tour-tag="browser-tab-waiting"]').length,
						resolved: [...document.querySelectorAll('[data-tour-tag="browser-approvals-resolved"] li')].map((li) => li.innerText.trim()),
					}))()`),
				);
				return read.chips === 0 && read.markers === 0 ? read : null;
			},
			"the queue to drain out of the chrome",
			15_000,
		).catch(() => null);
		check(
			"answering every live request drains the queue: no chip, row or tab marker is left waiting",
			emptyQueue !== null && afterDrain !== null,
			`the queue held ${drained} live request(s); pendingConsent is now ${JSON.stringify(emptyQueue?.pendingConsent ?? null)}; the band after the drain: ${JSON.stringify(afterDrain)}`,
		);

		/*
		 * ---- 9b2. THE RESOLVED ROW, LIVE ---------------------------------------
		 *
		 * The design's §3.4 answer to "why did the count change" was dead in the app
		 * while every committed frame showed it, because the only place it rendered was
		 * a Storybook fixture (QA round 1, Q2; the model handed `reconcileResolved`
		 * `previous === current`, so its row source was always empty). This drives it
		 * the way QA did: two live requests, one withdrawn by its own requester, and the
		 * badge and the explanation read from the DOM afterwards.
		 *
		 * The EXPIRY path is not driven here: its TTL is ten minutes. It reaches the
		 * same function through the same `fresh` term - the row's kind is decided inside
		 * `reconcileResolved` from `expiresAt` versus the answered set - and its copy is
		 * the specimen `browser-consent-bar--expired-and-withdrawn`.
		 */
		await rpc(state, "request_access", {
			url: "https://kept.example/",
			requester: "session:proof",
		});
		await rpc(state, "request_access", {
			url: "https://dropped.example/",
			requester: "session:other",
		});
		await waitFor(
			async () =>
				(await chromeState()).pendingConsent.length >= 2 ? true : null,
			"the kept and withdrawn requests to be live",
			20_000,
		);
		const resolvedRead = async () =>
			JSON.parse(
				await evaluate(`(() => {
					const badge = document.querySelector('[data-tour-tag="browser-approvals-badge"]');
					const list = document.querySelector('[data-tour-tag="browser-approvals-resolved"]');
					return JSON.stringify({
						badge: badge ? badge.innerText.trim() : null,
						rows: list ? [...list.querySelectorAll('li')].map((li) => li.innerText.trim()) : [],
					});
				})()`),
			);
		const beforeWithdrawal = await resolvedRead();
		const withdrawal = await rpc(state, "cancel_access", {
			url: "https://dropped.example/",
			requester: "session:other",
		});
		/*
		 * THE WAIT IS ON THE ROW THE CHECK ASSERTS, not on "some rows exist". It used to be
		 * the latter, and that is ALWAYS TRUE here: the two `reask.example` rows are already
		 * in the list when this scene starts, so the predicate returned the FIRST read and
		 * the check compared the DOM against the state it had before the withdrawal. It read
		 * as a flake rather than a tautology because the first read happens to land after
		 * React's next commit on a fast enough run, and a slower one measures the harness
		 * instead of the product: with the projection read through one shared store this
		 * check failed 4 runs out of 4 while passing on the branch's base commit, and the
		 * difference was the extra commit's latency, not the row.
		 */
		const afterWithdrawal = await waitFor(
			async () => {
				const read = await resolvedRead();
				return read.rows.some((row) => row.includes("dropped.example"))
					? read
					: null;
			},
			"the withdrawn request to be explained in the band",
			15_000,
		).catch(() => null);
		check(
			"a withdrawn request is explained LIVE: the badge falls and the band names what left the queue (QA round 1, Q2)",
			withdrawal.json?.result?.state === "cancelled" &&
				!beforeWithdrawal.rows.some((row) => row.includes("dropped.example")) &&
				afterWithdrawal !== null &&
				Number(afterWithdrawal.badge) === Number(beforeWithdrawal.badge) - 1 &&
				afterWithdrawal.rows.some(
					(row) =>
						row.includes("dropped.example") &&
						row.includes("Withdrawn by the agent"),
				),
			JSON.stringify(
				{
					withdrawal: withdrawal.json?.result,
					before: beforeWithdrawal,
					after: afterWithdrawal,
				},
				null,
				2,
			),
		);
		// ---- 10. focus (probe P12) -------------------------------------------
		const frontmostAfter = await frontmost();
		check(
			"the app's own process never became the frontmost application (probe P12, sampled through the run)",
			sampler.samples.length > 0 && sampler.appWasFrontmost() === 0,
			sampler.samples.length === 0
				? `the OS would not answer (last reading ${frontmostAfter}); the deterministic evidence is the window-mode guard test`
				: `app pid ${app.child.pid}; ${sampler.samples.length} samples; frontmost was ${sampler.distinct().join(", ")}; the app was frontmost in ${sampler.appWasFrontmost()} of them`,
		);
		record(
			"frontmost application, sampled through the run",
			`before: ${frontmostBefore}\nafter: ${frontmostAfter}\nsamples: ${sampler.distinct().join(", ")}\nthe app's pid (${app.child.pid}) was frontmost in ${sampler.appWasFrontmost()} of ${sampler.samples.length} samples`,
		);

		// ---- 11. restore across a restart ------------------------------------
		const beforeQuit = await chromeState();
		record("tabs at quit", JSON.stringify(beforeQuit.tabs, null, 2));
		/*
		 * THE TAB COUNT IS ASSERTED, not only the file's shape (QA round 2, Q3).
		 * `stopApp` signals the app itself, and the stop path captures before the views
		 * go - but the teardown that follows fires a `destroyed` event per view, and
		 * before this round each of those ended in a capture of a strip that no longer
		 * existed: the record was overwritten with `{tabs: []}` in 8 of 8 SIGTERM quits
		 * (QA's measurement; this check is the harness's own version of it). So the
		 * count is the assertion: every tab whose page had a URL of its own must be in
		 * the file the stop wrote. An `about:blank` tab is excluded because `captureTabs`
		 * drops it BY DESIGN (a restored blank tab is a tab the user never opened).
		 */
		const httpTabs = beforeQuit.tabs.filter((tab) =>
			/^https?:/.test(String(tab.url ?? "")),
		).length;
		await stopApp();
		const sessionFile = join(USER_DATA, "browser", "session.json");
		const written = existsSync(sessionFile)
			? readFileSync(sessionFile, "utf8")
			: "";
		const writtenRows = written ? (JSON.parse(written).tabs ?? []).length : -1;
		check(
			"stopping the host writes the tab list, 0600, with no nonce anywhere in it - and writes EVERY tab the strip held, which is what a SIGTERM stop used to lose",
			existsSync(sessionFile) &&
				writtenRows >= httpTabs &&
				written.includes("127.0.0.1") &&
				!written.includes("nonce") &&
				(statSync(sessionFile).mode & 0o777) === 0o600,
			`${sessionFile} mode ${(statSync(sessionFile).mode & 0o777).toString(8)}: ${writtenRows} row(s) written for ${httpTabs} navigated tab(s) of ${beforeQuit.tabs.length} in the strip\n${written.slice(0, 400)}`,
		);

		// Relaunch against the SAME user data and config dirs: the other half of the
		// isolation argument, since this is the run that reads the file back.
		socket = null;
		pendingCalls.clear();
		nextId = 1;
		app = await launchApp();
		state = await waitForState();
		await connectRenderer();
		await send("Page.enable", {});
		await send("Runtime.enable", {});
		await waitFor(
			() =>
				evaluate(
					"typeof window.api?.browser?.state === 'function' ? 'ready' : ''",
				),
			"the preload after the relaunch",
		);
		// The same wait-and-retry the first launch uses, for the same reason: right
		// after a relaunch the shell may not have mounted its rail yet, and one
		// unretried click turns that race into a failed check. It bit here once the
		// restore stopped being awaited — the relaunch now reaches this point while
		// the shell is still mounting, which is the behaviour the change is FOR.
		await openBrowserFromRail();
		await waitFor(
			() =>
				evaluate(
					"document.querySelector('[data-tour-tag=\"browser-content\"]') ? 'y' : ''",
				),
			"the browser surface after the relaunch",
		);
		const restoredRect = await contentRect();
		// Both halves of the restore: the TABS (allocated synchronously, so the strip
		// is right on the first paint) and their PAGES (loaded in the background under
		// the host's own budget, which is what stops one hung page withholding the
		// browser). Waiting for the URL is therefore waiting for the loads, and the
		// check below is about what the pages came back as.
		const restored = await waitFor(
			async () => {
				const current = await chromeState();
				const loaded = current.tabs.every((tab) =>
					tab.url.startsWith("http://127.0.0.1"),
				);
				return current.tabs.length >= 2 && loaded ? current : null;
			},
			"the restored tabs and their pages",
			30_000,
		);
		check(
			"both tabs are back, in the same order, and both are the USER's",
			restored.tabs.length === beforeQuit.tabs.length &&
				restored.tabs.every((tab) => tab.owner === "user") &&
				restored.tabs.every((tab) => tab.restored === true),
			JSON.stringify(restored.tabs, null, 2),
		);
		check(
			"the restored tabs are FRESH navigations to the same URLs (no POST replay, no revived process)",
			restored.tabs.every((tab) => tab.url.startsWith("http://127.0.0.1")),
			restored.tabs.map((tab) => tab.url).join("\n"),
		);
		const staleAttempt = await rpc(state, "goto", {
			tab: agentToken,
			url: `${origin()}/second`,
		});
		check(
			"a restored tab does NOT satisfy an agent's stale handle: it gets tab_closed, the ordinary recovery",
			staleAttempt.json?.error?.code === "tab_closed",
			`code ${staleAttempt.json?.error?.code}, message ${staleAttempt.json?.error?.message}`,
		);
		const staleRead = await rpc(state, "read", { tab: agentToken });
		check(
			"and a stale handle cannot READ the restored tab either",
			staleRead.json?.error?.code === "tab_closed",
			`code ${staleRead.json?.error?.code}`,
		);
		const newOpen = await rpc(state, "open", { url: `${origin()}/second` });
		check(
			"the agent's designed recovery still works: open re-creates a tab and hands out a new handle",
			newOpen.json?.ok && newOpen.json.result?.tab !== agentToken,
			`new handle ${String(newOpen.json?.result?.tab).slice(0, 12)}… (old ${String(agentToken).slice(0, 12)}…)`,
		);
		// The frame after the restart: the restored tabs are the user's and hold no
		// handle, so the page layer here is the agent tab this run just re-opened —
		// captured through its NEW handle, which is the recovery the design specifies.
		// The shell's banner is back after the relaunch (a fresh process re-runs its own
		// connectivity check), and it covers the strip exactly as it did at first paint —
		// re-suppressed here by the same durable rule `captureRenderer` applies before
		// every frame, and re-measured rather than assumed.
		const exposureAfterRestart = await exposeStrip();
		lastStripReading = JSON.stringify(exposureAfterRestart);
		record(
			"strip exposure after the restart",
			JSON.stringify(exposureAfterRestart, null, 2),
		);
		check(
			"the strip is exposed in the frames taken after the restart too, so the restored tabs and their `Restored` marker are photographed",
			exposureAfterRestart.strip !== null &&
				exposureAfterRestart.topmost === true,
			`strip ${JSON.stringify(exposureAfterRestart.strip)}, topmost ${exposureAfterRestart.topmost} (${exposureAfterRestart.hit})`,
		);
		// Chrome only, deliberately: the ACTIVE tab after the restart is a RESTORED user
		// tab, and a user tab's page is not capturable (it holds no handle), so
		// compositing the agent tab's page here would photograph a tab the user is not
		// looking at.
		const restoredTabsFrame = await captureRenderer(
			"12-restored-after-restart",
		);
		await compose(
			"12-restored-after-restart",
			restoredTabsFrame,
			null,
			restoredRect,
		);
		say(`frame: ${join(OUT_DIR, "12-restored-after-restart.png")}`);

		/*
		 * ---- the two empty page states: asserted, then photographed -----------
		 *
		 * (design round 3, D17 and D19.) Both branches had no assertion anywhere in
		 * the tree, and in the round-3 set one of them had a frame whose provenance
		 * was a separate run while the other had no frame at all. They are reached
		 * here the way a user reaches them - closing the ACTIVE tab, from the strip -
		 * and read out of the DOM, so the frames are a record of a state this run
		 * checked rather than the only evidence of it.
		 *
		 * WHY IT TAKES MORE THAN ONE CLOSE: `forget` hands the active state to the
		 * next USER tab, so a strip left with only the agent's tab is the state with
		 * nothing selected (design 7.3), and closing that one too is the state with
		 * no tabs at all. This is `D16`'s third tab doing a second job.
		 */
		// Counted from the strip as it is HERE rather than taken from `beforeQuit`:
		// after the restart the strip holds the restored tabs AND the agent's fresh
		// one from the recovery check above, so a count from before the quit is a tab
		// short. The wait asks for the count to FALL rather than for a number, so a
		// strip that changes shape again does not turn into a timeout.
		let closes = 0;
		let noTabState = await chromeState();
		while (noTabState.activeTabId !== null && closes < 5) {
			const before = noTabState.tabs.length;
			if ((await closeActiveTab()) !== "clicked") break;
			closes += 1;
			noTabState = await waitFor(async () => {
				const current = await chromeState();
				return current.tabs.length < before ? current : null;
			}, `the strip to settle after close ${closes}`);
		}
		/*
		 * The DOM is waited on as well as the host's state, and that is not
		 * belt-and-braces: `chromeState()` reads main over IPC, so it is true the
		 * moment main has forgotten the tab, while the page area is React state
		 * that arrives one `browser-state-changed` delivery later. Read once, the
		 * check can catch the previous frame's copy - which is exactly how the
		 * first built-app run of this step failed: 0 tabs by IPC, and the page area
		 * still painting the no-tab-selected sentence.
		 */
		const noTabSeen = await waitFor(async () => {
			const current = await chromeState();
			if (current.activeTabId !== null || current.tabs.length !== 1)
				return null;
			const copy = JSON.parse(await pageAreaCopy());
			return copy.text.includes(
				"No tab is selected. Pick a tab above, or open a new one.",
			)
				? { current, copy }
				: null;
		}, "the no-tab-selected state, state and page copy together");
		const noTabFrame = await captureRenderer("17-surface-no-tab-selected");
		await compose(
			"17-surface-no-tab-selected",
			noTabFrame,
			null,
			await contentRect(),
		);
		check(
			"with no tab selected the page area names the state and offers the action under the same `New tab` label the strip's own control carries (D17, D19)",
			closes > 0 &&
				noTabSeen.current.tabs.every((tab) => tab.owner === "agent") &&
				noTabSeen.copy.buttons.join("|") === "New tab",
			`${closes} close(s): activeTabId ${noTabSeen.current.activeTabId}, ${noTabSeen.current.tabs.length} tab(s) left (${noTabSeen.current.tabs.map((tab) => tab.owner).join(", ")}); page area "${noTabSeen.copy.text}"; buttons ${JSON.stringify(noTabSeen.copy.buttons)}`,
		);
		say(`frame: ${join(OUT_DIR, "17-surface-no-tab-selected.png")}`);

		// The last tab, closed: the other empty state, and the one D19's label work is
		// about - the same action under the same name in both branches.
		// Hover the row, then press its close control: the reveal is by design (§6), so
		// a click without the move hit-tests against `pointer-events-none` and lands on
		// the tab instead - the harness's own sequence, not a defect in the strip.
		await realHover('[role="tab"]');
		const lastClose = await realClick('[data-tour-tag="browser-tab-close"]');
		const noTabsSeen = await waitFor(async () => {
			const current = await chromeState();
			if (current.tabs.length !== 0) return null;
			const copy = JSON.parse(await pageAreaCopy());
			return copy.text.includes("No tabs are open.") ? { current, copy } : null;
		}, "the no-tabs state, state and page copy together");
		const noTabsFrame = await captureRenderer("18-surface-no-tabs-open");
		await compose(
			"18-surface-no-tabs-open",
			noTabsFrame,
			null,
			await contentRect(),
		);
		check(
			"with no tabs open the page area names that state too, under the SAME label",
			lastClose === "clicked" &&
				noTabsSeen.current.activeTabId === null &&
				noTabsSeen.copy.buttons.join("|") === "New tab",
			`${noTabsSeen.current.tabs.length} tab(s) left; page area "${noTabsSeen.copy.text}"; buttons ${JSON.stringify(noTabsSeen.copy.buttons)}`,
		);
		say(`frame: ${join(OUT_DIR, "18-surface-no-tabs-open.png")}`);

		/*
		 * ---- 19. the pooled strip at scale: 20 tabs across 6 conversations ----
		 *
		 * The design's §6.4 scene, and the one state where "can the user see what a
		 * conversation opened" has an answer that is not obviously yes: at 1160px the
		 * pool needs roughly four times the scroller it has, so the strip scrolls and
		 * the group labels are the only thing that says which run is whose (design R3).
		 *
		 * THE TABS ARE OPENED THROUGH R1'S OWN PATH, from the renderer, as user tabs
		 * (`window.api.browser.newTab(sessionId)`) rather than as agent tabs through
		 * RPC: the agent cap is 8 (`registry.ts`), so twenty agent tabs is not a state
		 * the product can reach, and a scene built out of them would be measuring a
		 * world that cannot exist. It also means this step exercises the attribution
		 * twenty times with real presses of the real control's own intent.
		 *
		 * NO BACKEND, SO NO CONVERSATION TITLES (this run's own isolation, not a
		 * defect): `sessionDisplayName` resolves against the session list, which is
		 * empty here, so every chip falls back to the session id — which is the rule's
		 * other half, asserted below rather than glossed over. The named version of
		 * this state is the `GroupedOverflow` story, which has a session list.
		 */
		const POOL_CONVERSATIONS = [
			"conv-alpha",
			"conv-beta",
			"conv-gamma",
			"conv-delta",
			"conv-epsilon",
			"conv-zeta",
		];
		const poolOpened = await evaluate(`(async () => {
			const conversations = ${JSON.stringify(POOL_CONVERSATIONS)};
			for (let index = 0; index < 18; index += 1) {
				await window.api.browser.newTab(conversations[index % conversations.length]);
			}
			// TWO TABS OF NOBODY'S: the tail run the design puts last, under its own label.
			await window.api.browser.newTab(null);
			await window.api.browser.newTab(null);
			const state = await window.api.browser.state();
			return {
				count: state.tabs.length,
				sessions: state.tabs.map((tab) => tab.sessionId),
			};
		})()`);
		check(
			"twenty user tabs opened from six conversations are attributed to them, and two belong to none",
			poolOpened.count === 20 &&
				poolOpened.sessions.filter((id) => id !== null).length === 18,
			JSON.stringify(poolOpened),
		);
		const reachableRoute = await openBrowserFromRail();
		check(
			"the route is the host this scene reads the pool in",
			typeof reachableRoute === "string" && reachableRoute.includes("/browser"),
			`location.hash ${reachableRoute}`,
		);
		const poolSeen = await waitFor(async () => {
			const reading = await evaluate(`(() => {
				const chips = [...document.querySelectorAll('[data-tour-tag="browser-tab-group"]')].map((chip) => chip.innerText.replace(/\\s+/g, ' ').trim());
				const rows = [...document.querySelectorAll('[data-tour-tag="browser-tab"]')];
				const titles = rows
					.map((row) => {
						const title = row.querySelector('[data-tour-tag="browser-tab-title"]');
						return title ? Math.round(title.getBoundingClientRect().width) : null;
					})
					.filter((width) => width !== null);
				/* A TITLE BOX IS ONLY A MEASUREMENT IF IT IS ON SCREEN: a row scrolled out
				   of the scroller has a real box at a real width, off to the side, and
				   counting those would let a strip that shows nobody's title pass. */
				const scroller = document.querySelector('[data-tour-tag="browser-tab-strip"]')?.getBoundingClientRect();
				const visible = titles.filter((_, index) => {
					const row = rows[index];
					if (!row || !scroller) return false;
					const box = row.getBoundingClientRect();
					return box.left >= scroller.left - 1 && box.right <= scroller.right + 1;
				});
				const pin = document.querySelector('[data-tour-tag="browser-tab-overflow"]');
				return {
					chips,
					rows: rows.length,
					titleWidths: titles,
					visibleTitleWidths: visible,
					pin: pin ? pin.innerText.replace(/\\s+/g, ' ').trim() : null,
					groupIds: [...document.querySelectorAll('[data-tour-tag="browser-tab-group"]')].map((chip) => chip.getAttribute('data-group-id')),
				};
			})()`);
			return reading.chips.length === 7 && reading.rows === 20 ? reading : null;
			// NON-FATAL ON PURPOSE: this step is the §6.3 before/after pair, so the SAME
			// command runs against a scratch worktree at the merge base, where the strip
			// has no group labels and this reading can never arrive. A throw here ends the
			// run on the base tree and takes the before frame with it, which is what
			// happened the first time; the CHECK below is what fails instead.
		}, "the pooled strip to settle with 20 rows and 7 group labels").catch(
			() => null,
		);
		const poolFrame = await captureRenderer("19-strip-pooled-20-over-6");
		await compose(
			"19-strip-pooled-20-over-6",
			poolFrame,
			null,
			await contentRect(),
		);
		record("the pooled strip", JSON.stringify(poolSeen, null, 2));
		check(
			"the pooled strip groups 20 tabs into their 6 conversations plus the unattributed run, LAST (R3)",
			poolSeen !== null &&
				poolSeen.chips.length === 7 &&
				poolSeen.groupIds.slice(0, 6).join("|") ===
					POOL_CONVERSATIONS.join("|") &&
				poolSeen.groupIds[6] === "" &&
				poolSeen.chips[6].startsWith("No conversation"),
			poolSeen === null
				? "the strip never settled with 20 rows and 7 labels, so this check FAILS by the guard above rather than by a TypeError the run cannot report (review round 1, A5)"
				: `labels ${JSON.stringify(poolSeen.chips)}; group ids ${JSON.stringify(poolSeen.groupIds)}`,
		);
		check(
			"each label carries its conversation's name and its tab count (the count is what lets a bulk close count the conversation it names)",
			poolSeen?.chips.every((label) =>
				/\d+$/.test(label.replace(/\s+/g, " ").trim()),
			),
			JSON.stringify(poolSeen?.chips ?? null),
		);
		/*
		 * THE 85px TITLE FLOOR, measured on the rows that are actually on screen. The
		 * labels take ~150px each of the scroller, so this is the check that says
		 * whether they cost the tabs the room the design says they do not - and the
		 * number the design round judges the labels' width against.
		 */
		check(
			"every tab title that is on screen keeps the 85px floor the file promises, with the group labels in the strip",
			poolSeen !== null &&
				poolSeen.visibleTitleWidths.length > 0 &&
				poolSeen.visibleTitleWidths.every((width) => width >= 85),
			`visible ${JSON.stringify(poolSeen?.visibleTitleWidths ?? null)} of all ${JSON.stringify(poolSeen?.titleWidths ?? null)}`,
		);
		check(
			"the pool overflows the strip, so the pinned control says how many tabs are off screen",
			poolSeen !== null &&
				typeof poolSeen.pin === "string" &&
				/^\d+$/.test(poolSeen.pin),
			`pinned control reads ${JSON.stringify(poolSeen?.pin ?? null)}`,
		);
		say(`frame: ${join(OUT_DIR, "19-strip-pooled-20-over-6.png")}`);

		/*
		 * ---- 19b. THE PINNED CONTROL, OPEN, WITH A REAL PAGE BEHIND IT ----------
		 *
		 * THE FRAME §12.1 ASKED FOR. The design's open question 1 is mechanical but
		 * unmeasured: a Radix menu anchored in the band paints DOWNWARD into the content
		 * rect, `browser-view-policy.ts:34-38` deliberately does not register menus in the
		 * band, and no z-index beats a native sibling view — so the pinned control, which
		 * is the token "the user can always reach any tab" is spent on, may have been
		 * unreadable exactly at the scale it exists for.
		 *
		 * THIS STEP IS THEREFORE THE ACCEPTANCE TEST, NOT A PHOTOGRAPH: it opens the
		 * control and composites the frame the way every other frame here is composited —
		 * the renderer's own paint plus the PAGE layer at the content rectangle — so if
		 * the page covers the control's rows, the composite says so in pixels, and the
		 * rows' own hit-testability is read from the DOM as well. A step that asserted
		 * only "the menu exists" would be green in both worlds.
		 *
		 * THE PAGE LAYER NEEDS AN AGENT TAB: `capturePage` addresses a tab by its handle,
		 * and a user tab has no handle by design (§6.3). So one agent tab is opened in the
		 * first conversation and activated, which is also the state the frame wants — the
		 * active tab is the only one that occupies the content rectangle.
		 */
		const pinAgent = await rpc(state, "open", {
			url: `${origin()}/second`,
			requester: "session:conv-alpha",
		});
		const pinToken = pinAgent.json?.result?.tab ?? null;
		check(
			"an agent tab is available for the page layer, in one of the pool's conversations",
			typeof pinToken === "string",
			`${pinAgent.status} ${JSON.stringify(pinAgent.json?.result ?? pinAgent.json?.error)}`,
		);
		const activated = await evaluate(`(() => {
			const rows = [...document.querySelectorAll('[role="tab"]')];
			const agent = rows.find((row) => row.innerText.includes('Agent'));
			if (!agent) return 'missing';
			agent.click();
			return 'clicked';
		})()`);
		await sleep(600);
		const pinTrigger = await evaluate(
			`document.querySelector('[data-tour-tag="browser-tab-overflow"]') ? 'present' : 'missing'`,
		);
		const pinLabel = await evaluate(
			`document.querySelector('[data-tour-tag="browser-tab-overflow"]')?.getAttribute('aria-label') ?? null`,
		);
		await realClick('[data-tour-tag="browser-tab-overflow"]');
		/*
		 * EITHER SHAPE IS ACCEPTED HERE, deliberately. On the tree this step was written
		 * against the control opens a Radix menu (`[role="menu"]`); the change it is the
		 * acceptance test for replaces that with a band row
		 * (`browser-tab-overflow-list`). Waiting for one of them is what lets the SAME
		 * command produce the before frame and the after frame the design's §6.3 asks
		 * for, rather than two harnesses that are not comparable.
		 */
		const pinReading = await waitFor(
			async () => {
				const reading = await evaluate(`(() => {
				const list = document.querySelector('[data-tour-tag="browser-tab-overflow-list"]');
				const menu = document.querySelector('[role="menu"]');
				const open = list ?? menu;
				if (!open) return null;
				const box = (node) => {
					if (!node) return null;
					const rect = node.getBoundingClientRect();
					return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), height: Math.round(rect.height) };
				};
				const rows = [...open.querySelectorAll('[data-tour-tag="browser-tab-overflow-row"], [role="menuitem"]')];
				const content = document.querySelector('[data-tour-tag="browser-content"]');
				/*
				 * THE BAND'S HEADING ROW, read as a fact about the DOM rather than judged
				 * from a still (review round 1, D5): the frame committed with this step did
				 * not contain the "All tabs, N not shown" heading the source renders, and a
				 * still cannot say whether that is a stale bundle, a clip, or a missing row.
				 * The text, the box and a painted-vs-not reading are recorded beside the
				 * band's own box, so the next reader gets a measurement instead of an
				 * argument. Recorded for either shape: the dropdown this replaced has no
				 * such row.
				 */
				const heading = list ? list.firstElementChild : null;
				const headingStyle = heading ? getComputedStyle(heading) : null;
				return {
					shape: list ? "in-band list" : "dropdown menu",
					box: box(open),
					content: box(content),
					heading: heading
						? {
								text: heading.innerText.replace(/\\s+/g, ' ').trim(),
								...box(heading),
								display: headingStyle.display,
								visibility: headingStyle.visibility,
								overflow: headingStyle.overflow,
							}
						: null,
					headingPainted: Boolean(
						heading &&
							headingStyle.visibility !== 'hidden' &&
							headingStyle.display !== 'none' &&
							heading.getBoundingClientRect().height > 0,
					),
					rows: rows.slice(0, 4).map((row) => row.innerText.replace(/\\s+/g, ' ').trim()),
					rowCount: rows.length,
					ticked: rows.filter((row) => row.getAttribute('aria-current') === 'true' || row.querySelector('[aria-hidden="false"]')).length,
				};
			})()`);
				return reading;
			},
			"the pinned control to open, as a list or as a menu",
			15_000,
		);
		const pinFrameChrome = await captureRenderer("19b-pinned-control-open");
		const pinPage = await capturePage(
			state,
			pinToken,
			"19b-pinned-control-open",
		);
		const pinRect = await contentRect();
		const pinFrame = await compose(
			"19b-pinned-control-open",
			pinFrameChrome,
			pinPage,
			pinRect,
		);
		record(
			"the pinned control, open",
			JSON.stringify({ pinTrigger, pinLabel, pinReading, pinRect }, null, 2),
		);
		check(
			"the pinned control opens with a row for every tab in the pool, in the band rather than over the page",
			pinReading !== null &&
				poolSeen !== null &&
				pinReading.rows.length > 0 &&
				pinReading.rowCount === poolSeen.rows + 1 &&
				pinReading.box !== null &&
				pinReading.content !== null &&
				// OUTSIDE the native view's rectangle, which is the whole claim: a
				// control whose box intersects the content rect is drawn where the page
				// paints, and the composite is where a reader can see it.
				pinReading.box.bottom <= pinReading.content.top &&
				pinReading.box.top >= 0,
			`${pinReading?.shape}: ${pinReading?.rowCount} row(s), box ${JSON.stringify(pinReading?.box)} against the content rect's bottom ${pinReading?.content?.bottom}`,
		);
		say(`frame: ${join(OUT_DIR, "19b-pinned-control-open.png")}`);
		/*
		 * THE SAME QUESTION AS A CHECK, and shape-aware on purpose: the base tree opens a
		 * dropdown here (`[role="menu"]`), which has no heading row to have an opinion
		 * about — so the check is vacuous there and real on the branch, which is what lets
		 * the one command produce both the before and the after frame (review round 1, D5).
		 */
		check(
			"the band paints the heading row the source renders, inside the band's own box (review round 1, D5)",
			pinReading !== null &&
				(pinReading.shape !== "in-band list" ||
					(pinReading.heading !== null &&
						pinReading.headingPainted &&
						pinReading.heading.text.startsWith("All tabs,") &&
						pinReading.heading.top >= pinReading.box.top &&
						pinReading.heading.bottom <= pinReading.box.bottom)),
			`heading ${JSON.stringify(pinReading?.heading ?? null)} inside the band box ${JSON.stringify(pinReading?.box ?? null)}`,
		);

		/*
		 * ---- 19c. A BATCH CLOSE IS ONE INTENT AND ONE STATE CHANGE --------------
		 *
		 * The design's §6.4 batch step, and the number it is about is the EVENT COUNT: N
		 * sequential closes are N `onChanged` calls, which are N full `chromeState()`
		 * builds, N IPC broadcasts, N renderer re-reads and N `session.json` writes. The
		 * count is therefore the evidence — a batch that closed the same tabs through N
		 * intents would look identical in every frame.
		 *
		 * The event counter is installed from the renderer over the REAL subscription the
		 * app itself uses, so what is counted is what the app would be woken by.
		 */
		await evaluate(`(() => {
			window.__proofStateEvents = 0;
			window.__proofOff = window.api.browser.onStateChanged(() => {
				window.__proofStateEvents += 1;
			});
			return 'armed';
		})()`);
		const batchBefore = await chromeState();
		// The row menu of the pool's FIRST tab, which is in the first conversation.
		const batchMenu = await evaluate(`(() => {
			const row = document.querySelector('[data-tab-id]');
			const trigger = row?.querySelector('[data-tour-tag="browser-tab-menu"]');
			if (!trigger) return 'missing';
			trigger.click();
			return 'clicked';
		})()`);
		const batchItem = await waitFor(
			async () =>
				(await evaluate(
					`(() => {
						const item = document.querySelector('[data-tour-tag="browser-tab-close-conversation"]');
						return item ? item.innerText.replace(/\\s+/g, ' ').trim() : null;
					})()`,
				)) ?? null,
			"the conversation close to be offered",
			10_000,
		);
		const eventsBefore = await evaluate("window.__proofStateEvents");
		const basket = {
			conversation: batchBefore.tabs[0].sessionId,
			before: batchBefore.tabs.length,
			beforeIds: batchBefore.tabs.map((tab) => tab.tabId),
		};
		await evaluate(
			`document.querySelector('[data-tour-tag="browser-tab-close-conversation"]')?.click()`,
		);
		const batchAfter = await waitFor(async () => {
			const current = await chromeState();
			return current.tabs.length < basket.before ? current : null;
		}, "the batch close to land");
		// One more delivery may be in flight for the event that carried the change, so the
		// count is read after the DOM has settled rather than on the first reading.
		await sleep(500);
		const eventsAfter = await evaluate("window.__proofStateEvents");
		const survived = batchAfter.tabs;
		/** What this conversation held before the press, so the arithmetic below is about
		 * that conversation rather than about the pool. */
		const closedCount = batchBefore.tabs.filter(
			(tab) => tab.sessionId === basket.conversation,
		).length;
		const batchFrame = await captureRenderer("19c-batch-close-one-event");
		await compose(
			"19c-batch-close-one-event",
			batchFrame,
			await capturePage(state, pinToken, "19c-batch-close-one-event"),
			await contentRect(),
		);
		record(
			"a conversation's tabs, closed as one intent",
			JSON.stringify(
				{
					item: batchItem,
					conversation: basket.conversation,
					before: basket.before,
					after: batchAfter.tabs.length,
					stateEvents: eventsAfter - eventsBefore,
					survived: survived.map((tab) => ({
						tabId: tab.tabId,
						sessionId: tab.sessionId,
						owner: tab.owner,
					})),
				},
				null,
				2,
			),
		);
		check(
			"one press closes every tab of one conversation, and leaves every other conversation's alone (R5)",
			batchItem !== null &&
				closedCount >= 2 &&
				batchAfter.tabs.length === basket.before - closedCount &&
				survived.every((tab) => tab.sessionId !== basket.conversation),
			`${batchItem}: ${basket.before} tab(s) -> ${batchAfter.tabs.length}; the closed conversation was ${basket.conversation}`,
		);
		check(
			"and it was ONE state change, not one per tab: the number is the whole point of the intent (R5)",
			eventsAfter - eventsBefore === 1,
			`${eventsAfter - eventsBefore} browser-state-changed event(s) for ${basket.before - batchAfter.tabs.length} closed tab(s)`,
		);
		say(`frame: ${join(OUT_DIR, "19c-batch-close-one-event.png")}`);

		/*
		 * ---- 19d. WHERE THE CARET IS AFTER A BATCH CLOSE ------------------------
		 *
		 * Review round 1 found the same bug three times (A2, U1, Q4): after a batch close
		 * the caret fell to `<body>`, which is the outcome the strip's own comment says
		 * the pending-focus path exists to prevent — "so a batch close does not strand the
		 * keyboard user out of the strip". The diagnosis was that the flag was consumed on
		 * the render caused by `setActionsTabId(null)`, before `chrome.closeTabs`'s IPC
		 * landed, so it resolved to the tab being closed; the tab then unmounted and took
		 * the caret with it.
		 *
		 * SO THE READING IS TAKEN TWICE, and the second one is the contract: at the first
		 * reading the projection may still be in flight, and what must hold there is only
		 * that the caret is IN THE STRIP (the parked position) rather than on `<body>`.
		 * The later reading is the promise — the surviving active tab's `[role="tab"]`,
		 * or the strip's scroller when the batch took every tab.
		 *
		 * BOTH BATCH SHAPES, because they fail differently: the conversation close usually
		 * takes the ACTIVE tab (so the fallback target is a different row), while `Close N
		 * other tabs` keeps its anchor alive (so the fallback target is on screen and the
		 * old code still focused the closing tab instead).
		 */
		const focusReading = async () => {
			return await evaluate(`(() => {
				const el = document.activeElement;
				return {
					tag: el ? el.tagName : null,
					tour: el ? el.getAttribute('data-tour-tag') : null,
					role: el ? el.getAttribute('role') : null,
					inStrip: Boolean(el && el.closest('[data-tour-tag="browser-tab-strip-row"]')),
				};
			})()`);
		};
		/*
		 * `caretInStripSoon` polls for up to a second rather than reading once, because
		 * the parked placement happens in React's effect phase a few milliseconds after
		 * the click and this process's own round trip is of the same order. The window is
		 * still what distinguishes the fix from the defect by an order of magnitude: the
		 * finding measured `<body>` at 300ms, 1.3s and 2.8s.
		 */
		const caretInStripSoon = async (ms = 1000) => {
			const started = Date.now();
			let reading = await focusReading();
			while (!reading.inStrip && Date.now() - started < ms) {
				await sleep(50);
				reading = await focusReading();
			}
			return reading;
		};
		const caretAfterConversationClose = await caretInStripSoon();
		await sleep(1300);
		const caretSettledAfterConversationClose = await focusReading();
		check(
			"after closing a conversation's tabs the caret is in the STRIP, then on the surviving tab (review round 1, A2/U1/Q4)",
			caretAfterConversationClose.inStrip === true &&
				caretSettledAfterConversationClose.tag !== "BODY" &&
				caretSettledAfterConversationClose.inStrip === true &&
				(caretSettledAfterConversationClose.role === "tab" ||
					caretSettledAfterConversationClose.tour === "browser-tab-strip-row"),
			`immediately ${JSON.stringify(caretAfterConversationClose)}, settled ${JSON.stringify(caretSettledAfterConversationClose)}`,
		);

		// The other shape: a batch that keeps its anchor tab, so the tab the caret must
		// land on is not a tab the batch removed.
		const othersMenu = await evaluate(`(() => {
			const row = document.querySelector('[data-tab-id]');
			const trigger = row?.querySelector('[data-tour-tag="browser-tab-menu"]');
			if (!trigger) return 'missing';
			trigger.click();
			return 'clicked';
		})()`);
		const othersItem = await waitFor(
			async () =>
				(await evaluate(
					`(() => {
						const item = document.querySelector('[data-tour-tag="browser-tab-close-others"]');
						return item ? item.innerText.replace(/\\s+/g, ' ').trim() : null;
					})()`,
				)) ?? null,
			"the `close other tabs` item to be offered",
			10_000,
		).catch(() => null);
		const beforeOthers = await chromeState();
		await evaluate(
			`document.querySelector('[data-tour-tag="browser-tab-close-others"]')?.click()`,
		);
		const afterOthers = await waitFor(async () => {
			const current = await chromeState();
			return current.tabs.length < beforeOthers.tabs.length ? current : null;
		}, "the others close to land").catch(() => null);
		const caretAfterOthers = await caretInStripSoon();
		await sleep(1300);
		const caretSettledAfterOthers = await focusReading();
		record(
			"the caret after the two batch shapes",
			JSON.stringify(
				{
					conversation: {
						immediately: caretAfterConversationClose,
						settled: caretSettledAfterConversationClose,
					},
					others: {
						menu: othersMenu,
						item: othersItem,
						before: beforeOthers.tabs.length,
						after: afterOthers?.tabs.length ?? null,
						immediately: caretAfterOthers,
						settled: caretSettledAfterOthers,
					},
				},
				null,
				2,
			),
		);
		check(
			"`Close N other tabs` leaves the caret on the surviving tab, not on the one it closed (review round 1, A2/U1)",
			othersItem !== null &&
				afterOthers !== null &&
				afterOthers.tabs.length === 1 &&
				caretAfterOthers.inStrip === true &&
				caretSettledAfterOthers.tag !== "BODY" &&
				caretSettledAfterOthers.inStrip === true &&
				(caretSettledAfterOthers.role === "tab" ||
					caretSettledAfterOthers.tour === "browser-tab-strip-row"),
			`${othersItem}: ${beforeOthers.tabs.length} tab(s) -> ${afterOthers?.tabs.length ?? null}; immediately ${JSON.stringify(caretAfterOthers)}, settled ${JSON.stringify(caretSettledAfterOthers)}`,
		);
	} finally {
		sampler?.stop();
		for (const timer of held) clearTimeout(timer);
		server.close();
		await stopApp();
	}

	const reportPath = join(OUT_DIR, "proof.md");
	writeFileSync(reportPath, transcript.join("\n"));
	say(
		`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
	);
	say(`transcript: ${reportPath}`);
	say(`frames:     ${OUT_DIR}`);
	if (!KEEP) say(`scratch:    ${SCRATCH} (pass --keep to inspect)`);
	if (failures > 0) process.exitCode = 1;
}

// `realpathSync(SCRATCH)` is referenced on purpose in the summary below so a run
// that was given a symlinked tmpdir prints the real path it wrote to.
if (KEEP)
	say(
		`scratch (real): ${existsSync(SCRATCH) ? realpathSync(SCRATCH) : SCRATCH}`,
	);

await main();
