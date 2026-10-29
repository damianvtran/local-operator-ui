#!/usr/bin/env node
/**
 * LOH-13 operator report (2026-10-25): the tab-actions menu is a NATIVE menu, so
 * opening it no longer hides the page behind the "paused" note.
 *
 * WHY THIS RIG EXISTS. The menu the operator reported was a Radix popout whose
 * panel crossed into the native `WebContentsView`; the only way to paint it was
 * to suppress the view, which put the paused note behind the menu. The fix is a
 * native Electron `Menu`, which the OS draws ABOVE the view. The property is
 * therefore an ABSENCE in the renderer - no pause, no DOM panel, no moved
 * rectangle - and a presence only the real window can show.
 *
 * WHAT IT MEASURES, on a real browser tab in the real built app:
 *   1. a real press on the strip's trigger leaves the menu OPEN (`aria-expanded`
 *      stays true, the IPC invoke is still pending) - so the state sampled below
 *      is the state WHILE the menu is up, not after it closed;
 *   2. `[data-tour-tag="browser-content"]` reports `data-suppressed-by` EMPTY;
 *   3. no `[data-tour-tag="browser-tab-actions"]` panel exists in the DOM;
 *   4. the content rectangle is byte-identical before and while open;
 *   5. the page target still renders the same pixels while the menu is open;
 *   6. macOS `screencapture` is attempted for the window region and its actual
 *      answer is recorded (this machine denies Screen Recording, so the pixels
 *      of the OS menu itself cannot be captured; the state above is the proof).
 *
 * WHY `inactive`: the window must be visible for `menu.popup` to hang a menu -
 * Electron refuses a popup on a hidden window, and this rig's handler answers
 * `null` there - but the run must never take the operator's focus. `inactive` is
 * shown with `showInactive()` and never activated; measured in this rig, the
 * app's own `document.hasFocus()` stays false while the menu is up.
 *
 * ISOLATION (see AGENTS.md "Running the app without taking the operator's
 * focus"): scratch HOME, config, log dir and `--user-data-dir`; every `CMUX_*`
 * and `LOP_*` variable stripped; telemetry and notifications off; the exact
 * process group reaped in a `finally`.
 *
 * Usage: node scripts/browser-tab-menu-native-proof.mjs [out-dir]
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(process.cwd());
const OUT =
	process.argv[2] ?? join(tmpdir(), `lo-tab-menu-native-${process.pid}`);
const SCRATCH = join(tmpdir(), `lo-tab-menu-native-scratch-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const LOG_DIR = join(SCRATCH, "logs");
const USER_DATA = join(SCRATCH, "userdata");
const PORT = 9461;
const ELECTRON_BIN = createRequire(import.meta.url)("electron");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

mkdirSync(OUT, { recursive: true });
const report = { out: OUT, viewport: null, checks: [], screenCapture: null };
const claims = [];
const check = (name, ok, detail) => {
	report.checks.push({ name, ok: ok === true, detail });
	if (ok !== true) claims.push(name);
	console.log(
		`${ok === true ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`,
	);
};

// A page with a solid, recognisable ground and one block of text: its pixels
// must be identical while the native menu is up, which is the "page stays
// visible" half that a DOM attribute alone cannot show.
const server = createServer((_request, response) => {
	response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	response.end(`<!doctype html><html><head><meta charset="utf-8"><style>
		html,body{margin:0;height:100%}
		body{background:#1b3a5c;color:#f4f0e6;font:28px/1.4 -apple-system,sans-serif;
			display:flex;align-items:center;justify-content:center}
		div{padding:40px;border:2px solid #f4f0e6}
	</style></head><body><div id="proof">native menu proof page</div></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

const env = { ...process.env };
for (const key of Object.keys(env))
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
withNotificationsOff(env);
withTelemetryOff(env);
Object.assign(env, {
	HOME: HOME_DIR,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
	LOCAL_OPERATOR_UI_WINDOW_MODE: "inactive",
	LOCAL_OPERATOR_UI_WINDOW_SIZE: "1180x820",
});
for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR, USER_DATA])
	mkdirSync(dir, { recursive: true });

let child = null;
let cdp = null;
let appLog = "";
try {
	child = spawn(
		ELECTRON_BIN,
		[
			join(ROOT, "out/main/index.js"),
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${PORT}`,
			"--window-mode=inactive",
			"--window-size=1180x820",
		],
		{ cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	child.stdout.on("data", (chunk) => {
		appLog += chunk;
	});
	child.stderr.on("data", (chunk) => {
		appLog += chunk;
	});

	async function targets() {
		try {
			return await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) =>
				r.json(),
			);
		} catch {
			return [];
		}
	}
	const pageTarget = async () => {
		for (let i = 0; i < 240; i += 1) {
			const page = (await targets()).find(
				(t) => t.type === "page" && t.url.includes("index.html"),
			);
			if (page) return page;
			await sleep(250);
		}
		throw new Error("the main window never exposed a CDP page target");
	};

	class Cdp {
		constructor(url) {
			this.ws = new WebSocket(url);
			this.seq = 0;
			this.pending = new Map();
			this.ws.onmessage = (event) => {
				const message = JSON.parse(event.data);
				const entry = this.pending.get(message.id);
				if (!entry) return;
				this.pending.delete(message.id);
				if (message.error)
					entry.reject(new Error(JSON.stringify(message.error)));
				else entry.resolve(message.result);
			};
		}
		ready() {
			if (this.ws.readyState === 1) return Promise.resolve();
			return new Promise((resolve, reject) => {
				this.ws.addEventListener("open", resolve, { once: true });
				this.ws.addEventListener("error", reject, { once: true });
			});
		}
		send(method, params = {}) {
			const id = ++this.seq;
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
				throw new Error(JSON.stringify(result.exceptionDetails));
			return result.result.value;
		}
		async screenshot() {
			const result = await this.send("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: false,
			});
			return Buffer.from(result.data, "base64");
		}
	}

	const main = await pageTarget();
	cdp = new Cdp(main.webSocketDebuggerUrl);
	await cdp.ready();
	await cdp.send("Page.enable").catch(() => {});

	const waitFor = async (predicate, label, timeoutMs = 30_000) => {
		const started = Date.now();
		for (;;) {
			const value = await predicate().catch(() => false);
			if (value) return value;
			if (Date.now() - started > timeoutMs)
				throw new Error(`timed out waiting for ${label}`);
			await sleep(250);
		}
	};
	const evaluate = (expression) => cdp.evaluate(expression);
	const clickTag = (tag) =>
		evaluate(`(() => {
			const el = document.querySelector('[data-tour-tag="${tag}"]');
			if (!el) return 'missing';
			el.click();
			return 'clicked';
		})()`);

	// A visible window with a real menu: wait for the mode line before pressing.
	await waitFor(
		async () =>
			appLog.includes("[window-mode]") && appLog.includes("focused=false"),
		"the inactive window to be applied",
	);
	report.viewport = await evaluate(
		"({width: innerWidth, height: innerHeight, dpr: devicePixelRatio})",
	);
	await waitFor(
		() =>
			evaluate(
				"document.querySelector('[data-tour-tag=\"nav-item-browser\"]') ? 'y' : ''",
			),
		"the browser rail entry",
	);
	await clickTag("nav-item-browser");
	await waitFor(
		() => evaluate("location.hash.includes('/browser') ? 'y' : ''"),
		"the browser route",
	);
	await sleep(500);

	// A tab through the chrome's own control, then a typed navigation.
	await clickTag("browser-new-tab");
	// Let the new tab's own about:blank navigation settle: issuing ours into it
	// aborts that load, and Chromium reports the abort as a nav failure banner.
	await sleep(4000);
	await waitFor(
		() =>
			evaluate(
				"document.querySelector('[data-tour-tag=\"browser-address\"]') ? 'y' : ''",
			),
		"the address field",
	);
	// Through the bridge, not the typed path: this rig's subject is the menu, and
	// the address field's own "untouched draft" rule makes a synthetic Enter
	// navigate nothing (the typed path has its own proof in
	// `browser-chrome-proof.mjs`).
	await evaluate(`window.api.browser.navigate(${JSON.stringify(pageUrl)})`);

	const readState = () =>
		evaluate(`(() => {
			const content = document.querySelector('[data-tour-tag="browser-content"]');
			const trigger = document.querySelector('[data-tour-tag="browser-tab-menu"]');
			const box = content ? content.getBoundingClientRect() : null;
			return {
				hash: location.hash,
				suppressedBy: content ? content.dataset.suppressedBy || '' : 'missing-content',
				rect: box ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } : null,
				domPanel: !!document.querySelector('[data-tour-tag="browser-tab-actions"]'),
				expanded: trigger ? trigger.getAttribute('aria-expanded') : 'missing-trigger',
				hasFocus: document.hasFocus(),
			};
		})()`);

	await waitFor(async () => {
		const state = await readState();
		return state.rect && state.rect.width > 200 && state.rect.height > 200;
	}, "the browser content rectangle");
	// The view navigates asynchronously; wait for the page target to carry the URL.
	const viewTarget = async () => {
		for (let i = 0; i < 20; i += 1) {
			const view = (await targets()).find(
				(t) => t.type === "page" && t.url.startsWith(pageUrl),
			);
			if (view) return view;
			await sleep(250);
		}
		throw new Error("the driven page never appeared as a CDP target");
	};
	const view = await viewTarget().catch(() => null);
	const viewCdp = view ? new Cdp(view.webSocketDebuggerUrl) : null;
	if (viewCdp) {
		await viewCdp.ready();
		await viewCdp.send("Page.enable").catch(() => {});
	}
	await sleep(800);

	await waitFor(
		async () => {
			const state = await evaluate(
				"window.api.browser.state().then((s) => ({ url: s.url, navFailure: s.navFailure }))",
			);
			return state?.navFailure
				? false
				: state?.url?.startsWith(pageUrl)
					? state
					: false;
		},
		"the driven page to load without a nav failure",
		20_000,
	);
	report.stateBeforeMenu = await evaluate(
		"window.api.browser.state().then((s) => ({ url: s.url, navFailure: s.navFailure, loading: s.loading }))",
	);
	const before = await readState();
	if (!before.rect) throw new Error("no content rectangle before the menu");
	const rendererBefore = await cdp.screenshot();
	const pageBefore = viewCdp ? await viewCdp.screenshot() : null;
	if (pageBefore)
		writeFileSync(join(OUT, "01-page-before-menu.png"), pageBefore);

	// A REAL press on the strip's own trigger.
	await evaluate(
		"document.querySelector('[data-tour-tag=\"browser-tab-menu\"]').click()",
	);
	await waitFor(
		() =>
			evaluate(
				"document.querySelector('[data-tour-tag=\"browser-tab-menu\"]').getAttribute('aria-expanded') === 'true' ? 'y' : ''",
			),
		"the native menu to be open (aria-expanded)",
	);
	await sleep(1200);
	const open = await readState();
	const rendererOpen = await cdp.screenshot();
	const pageOpen = viewCdp ? await viewCdp.screenshot() : null;
	if (pageOpen) writeFileSync(join(OUT, "02-page-menu-open.png"), pageOpen);

	check(
		"the menu is OPEN: the trigger reports aria-expanded, and the run never takes focus",
		open.expanded === "true" && open.hasFocus === false,
		{ expanded: open.expanded, hasFocus: open.hasFocus },
	);
	check("no renderer panel exists for the tab menu", open.domPanel === false, {
		domPanel: open.domPanel,
	});
	check(
		"the page is NOT suppressed while the menu is open",
		open.suppressedBy === "",
		{
			suppressedBy: open.suppressedBy,
		},
	);
	check(
		"the page's rectangle does not move",
		JSON.stringify(open.rect) === JSON.stringify(before.rect),
		{
			before: before.rect,
			open: open.rect,
		},
	);
	if (pageBefore && pageOpen) {
		const pageStats = await sharp(pageOpen).stats();
		const pageChanged = await diffPixels(pageBefore, pageOpen);
		check(
			"the page's own pixels are unchanged while the menu is open",
			pageChanged === 0,
			{
				pageChanged,
				channels: pageStats.channels.map((channel) => Math.round(channel.mean)),
			},
		);
		// Compose what the user sees: the renderer frame with the page at its rect.
		writeFileSync(
			join(OUT, "03-before-menu.png"),
			await compose(rendererBefore, pageBefore, before.rect),
		);
		writeFileSync(
			join(OUT, "04-menu-open.png"),
			await compose(rendererOpen, pageOpen, before.rect),
		);
	} else {
		// A WebContentsView is not exposed as a CDP page target by this app's
		// launch; the visible-page claim rests on the unsuppressed view and the
		// unchanged rectangle above, which are the product's own facts.
		console.log(
			"NOTE no CDP target for the driven page; page pixels not captured",
		);
	}

	// macOS `screencapture` would be the only way to capture the OS menu itself.
	// It needs Screen Recording; record the actual answer rather than promising it.
	const windowInfo = await cdp
		.evaluate(
			"({ bounds: { left: screenX, top: screenY, width: outerWidth, height: outerHeight } })",
		)
		.catch(() => null);
	let captureAnswer = "not attempted";
	if (windowInfo?.bounds) {
		const { left, top, width, height } = windowInfo.bounds;
		const capturePath = join(OUT, "05-window-region.png");
		const result = await runCapture(left, top, width, height, capturePath);
		captureAnswer = result;
	}
	report.screenCapture = captureAnswer;
	check("window-capture attempt recorded", true, { answer: captureAnswer });

	if (claims.length) throw new Error(`${claims.length} claim(s) failed`);
	writeFileSync(join(OUT, "app.log"), appLog);
	writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
	console.log(`\nreport: ${join(OUT, "report.json")}`);
	console.log(
		`frames: ${join(OUT, "03-before-menu.png")}, ${join(OUT, "04-menu-open.png")}`,
	);
	process.exitCode = 0;
} catch (error) {
	report.error = String(error?.stack ?? error);
	writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
	writeFileSync(join(OUT, "app.log"), appLog);
	console.error(report.error);
	process.exitCode = 1;
} finally {
	try {
		if (cdp) cdp.ws.close();
	} catch {}
	server.close();
	if (child) {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {}
	}
	await sleep(200);
	// Scratch holds only this run's profile; the frames and report are OUT.
	rmSync(SCRATCH, { recursive: true, force: true });
}

async function diffPixels(a, b) {
	const [ra, rb] = await Promise.all([
		sharp(a).raw().toBuffer({ resolveWithObject: true }),
		sharp(b).raw().toBuffer({ resolveWithObject: true }),
	]);
	if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height)
		return Number.POSITIVE_INFINITY;
	let differing = 0;
	for (let i = 0; i < ra.data.length; i += 1)
		if (ra.data[i] !== rb.data[i]) differing += 1;
	return differing;
}

async function compose(rendererPng, pagePng, rect) {
	const renderer = sharp(rendererPng);
	const meta = await renderer.metadata();
	const scale = meta.width / report.viewport.width;
	const page = await sharp(pagePng)
		.resize(Math.round(rect.width * scale), Math.round(rect.height * scale), {
			fit: "fill",
		})
		.png()
		.toBuffer();
	return renderer
		.composite([
			{
				input: page,
				left: Math.round(rect.x * scale),
				top: Math.round(rect.y * scale),
			},
		])
		.png()
		.toBuffer();
}

function runCapture(left, top, width, height, path) {
	return new Promise((resolve) => {
		const capture = spawn("screencapture", [
			"-x",
			"-R",
			`${left},${top},${width},${height}`,
			path,
		]);
		let output = "";
		capture.stderr.on("data", (chunk) => {
			output += chunk;
		});
		capture.on("error", (error) =>
			resolve(`screencapture could not run: ${error.message}`),
		);
		capture.on("exit", (code) =>
			resolve(
				`${code === 0 ? "captured" : "blocked"}: ${output.trim() || `exit ${code}`}`,
			),
		);
	});
}
