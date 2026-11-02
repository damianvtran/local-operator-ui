#!/usr/bin/env node
/**
 * End-to-end proof, and the measurement ladder, for the browser host's `hover`
 * method and chord-capable `press` (harness issue damianvtran/local-operator#3248).
 *
 * TWO LEGS, one booted app:
 *
 *   --ladder   MEASURES which raw-CDP mechanisms a HIDDEN agent view honours
 *              (the view is `setVisible(false)`; the file header of
 *              `src/main/browser/actions/input.ts` records that Chromium drops
 *              synthetic compositor input there). It asserts nothing: its rows
 *              are the comparison the mechanism in `input.ts` was chosen from,
 *              so the choice can be re-derived instead of trusted. Attaching a
 *              foreign CDP session detaches the app's own debugger attachment
 *              (see `cdp.ts`), and the app re-attaches on its next action, which
 *              is why the ladder runs on its own tab, before the shipped leg.
 *   (default)  drives the SHIPPED `hover` and `press` over the real loopback
 *              `/rpc` against `scripts/browser-hover-press-fixture.mjs`, prints
 *              the actual JSON of every response and the page's own reading
 *              before/after, and captures before/after screenshots through the
 *              host's own `screenshot` action.
 *
 * Isolation (copied from `browser-host-proof.mjs`, whose header gives each
 * reason): HOME + LOCAL_OPERATOR_CONFIG_DIR + LOCAL_OPERATOR_LOG_DIR are scratch,
 * a scratch --user-data-dir, `--window-mode=headless`, no CMUX_ or LOP_ vars, the
 * notification and telemetry kill switches, and the mock keychain. The app is
 * killed by exact process group on exit.
 *
 * Usage: node scripts/browser-hover-press-proof.mjs [--ladder] [--out <dir>]
 * Needs a built app (`out/main/index.js`): see the PR for the build env.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOVER_PRESS_PAGE } from "./browser-hover-press-fixture.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = process.cwd();
const ELECTRON_BIN = createRequire(import.meta.url)("electron");
const LADDER = process.argv.includes("--ladder");
/** `headless` (default) or `inactive`. The ladder is run under BOTH because a
 * headless window is never shown and its views can report `visibilityState:
 * visible` regardless of `setVisible(false)`; only `inactive` (shown with
 * `showInactive()`, never activated) makes the hidden-view condition real. */
const modeFlag = process.argv.indexOf("--window-mode");
const WINDOW_MODE = modeFlag > -1 ? process.argv[modeFlag + 1] : "headless";
const outFlag = process.argv.indexOf("--out");
const SCRATCH = join(tmpdir(), `lo-hover-press-proof-${process.pid}`);
const OUT_DIR = outFlag > -1 ? process.argv[outFlag + 1] : join(SCRATCH, "out");
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const LOG_DIR = join(SCRATCH, "logs");

let failures = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line) => console.log(line);
function check(label, ok, detail = "") {
	if (!ok) failures += 1;
	say(
		`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`,
	);
	return ok;
}

// ---- the app --------------------------------------------------------------

let app = null;
let devtoolsPort = 0;

async function freePort() {
	const { createServer: create } = await import("node:net");
	return await new Promise((resolve) => {
		const server = create();
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
	});
}

async function launchApp() {
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: WINDOW_MODE,
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	devtoolsPort = await freePort();
	const child = spawn(
		ELECTRON_BIN,
		withMockKeychain([
			".",
			`--user-data-dir=${USER_DATA}`,
			`--remote-debugging-port=${devtoolsPort}`,
			"--password-store=basic",
		]),
		{
			env,
			cwd: ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			// Its own process group, so the stop below reaps GPU/renderer/utility
			// helpers by exact group and not by pattern.
			detached: true,
		},
	);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	return {
		child,
		stream,
		stop: () =>
			new Promise((resolve) => {
				const killTree = (signal) => {
					try {
						process.kill(-child.pid, signal);
					} catch {
						/* group already gone */
					}
				};
				child.once("exit", resolve);
				killTree("SIGTERM");
				setTimeout(() => {
					killTree("SIGKILL");
					resolve();
				}, 5000);
			}),
	};
}

const stateFilePath = () => join(CONFIG_DIR, "run", "ui-browser", "host.json");

async function waitForState(timeoutMs = 120_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (existsSync(stateFilePath())) {
			try {
				const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
				const health = await fetch(`http://127.0.0.1:${parsed.port}/health`);
				if (health.ok && (await health.json()).pid === parsed.pid)
					return parsed;
			} catch {
				/* staged write or host not listening yet */
			}
		}
		await sleep(250);
	}
	throw new Error(`no live host at ${stateFilePath()}`);
}

async function rpc(state, method, params = {}) {
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Bridge-Key": state.session_key,
		},
		body: JSON.stringify({
			id: `proof-${method}-${Math.random()}`,
			method,
			params,
		}),
	});
	return {
		status: response.status,
		json: await response.json().catch(() => null),
	};
}

/** The result, or the typed error: a refusal is a reading here, not an exception. */
async function call(state, method, params) {
	const out = await rpc(state, method, params);
	return out.json?.ok
		? { ok: true, result: out.json.result }
		: { ok: false, error: out.json?.error ?? out };
}

async function callOk(state, method, params) {
	const out = await call(state, method, params);
	if (!out.ok)
		throw new Error(`${method} failed: ${JSON.stringify(out.error)}`);
	return out.result;
}

// ---- the app's renderer and the driven target, over CDP --------------------

async function targets() {
	return await (
		await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
	).json();
}

async function openSocket(target) {
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const incoming = JSON.parse(event.data);
		const settle = pending.get(incoming.id);
		if (settle) {
			pending.delete(incoming.id);
			settle(incoming);
		}
	});
	return {
		send: (method, params = {}, timeoutMs = 15_000) =>
			new Promise((resolve, reject) => {
				const id = ++nextId;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`${method}: no reply inside ${timeoutMs} ms`));
				}, timeoutMs);
				pending.set(id, (message) => {
					clearTimeout(timer);
					if (message.error)
						reject(new Error(`${method}: ${message.error.message}`));
					else resolve(message.result);
				});
				socket.send(JSON.stringify({ id, method, params }));
			}),
		close: () => socket.close(),
	};
}

async function rendererEvaluate(expression) {
	const page = (await targets()).find(
		(t) =>
			t.type === "page" &&
			t.url.startsWith("file:") &&
			t.url.includes("/renderer/index.html"),
	);
	if (!page) throw new Error("no renderer target");
	const session = await openSocket(page);
	try {
		const out = await session.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		return out?.result?.value;
	} finally {
		session.close();
	}
}

async function waitForRenderer() {
	for (let i = 0; i < 240; i += 1) {
		try {
			if (
				(await rendererEvaluate("typeof window.api?.browser?.state")) ===
				"function"
			)
				return;
		} catch {
			/* the renderer target is not up yet */
		}
		await sleep(250);
	}
	throw new Error("renderer never exposed window.api.browser");
}

/** Approve an origin the way the user does: through the app's own IPC. */
async function approve(state, origin) {
	const requested = await callOk(state, "request_access", {
		url: origin,
		requester: "session:proof",
	});
	if (requested.state !== "allowed") {
		const pending = JSON.parse(
			await rendererEvaluate(
				"window.api.browser.state().then((s) => JSON.stringify(s.pendingConsent))",
			),
		);
		const entry = pending.find((c) => c.origin === origin);
		if (!entry) throw new Error(`no pending consent for ${origin}`);
		await rendererEvaluate(
			`window.api.browser.respondToConsent(${JSON.stringify(entry.entryId)}, "site").then((s) => JSON.stringify(s))`,
		);
	}
	await callOk(state, "await_access", {
		url: origin,
		requester: "session:proof",
	});
}

// ---- the site --------------------------------------------------------------

function startSite() {
	const server = createServer((req, res) => {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		// `/navhover`: a page whose hover handler navigates the tab to an origin the
		// user never approved. `localhost` and `127.0.0.1` are different origins that
		// reach this same loopback server, so no second server is needed.
		if (req.url?.startsWith("/navhover")) {
			const port = req.headers.host?.split(":")[1] ?? "";
			res.end(
				`<!doctype html><title>nav on hover</title><div id="t" style="padding:40px">hover me</div><script>document.getElementById("t").addEventListener("mouseenter", () => { location.href = "http://localhost:${port}/landed"; });</script>`,
			);
			return;
		}
		if (req.url?.startsWith("/landed")) {
			res.end(
				"<!doctype html><title>landed</title><h1>unapproved landing</h1>",
			);
			return;
		}
		res.end(HOVER_PRESS_PAGE);
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () =>
			resolve({ server, port: server.address().port }),
		);
	});
}

/** The fixture's own reading of itself, taken from the page's MAIN world over the
 * debugging port. Attaching here detaches the app's debugger (cdp.ts), which the
 * app recovers on its next action, so a reading is taken between actions only. */
async function pageReading(pageUrlPart) {
	const target = (await targets()).find(
		(t) => t.type === "page" && t.url.includes(pageUrlPart),
	);
	if (!target) throw new Error(`no page target for ${pageUrlPart}`);
	const session = await openSocket(target);
	try {
		const out = await session.send("Runtime.evaluate", {
			expression: "window.__reading()",
			returnByValue: true,
		});
		return JSON.parse(out.result.value);
	} finally {
		session.close();
	}
}

// ---- the ladder: which raw mechanisms does a hidden view honour? -----------

/** Centre of an element in viewport px, from the page itself. */
const CENTER_OF = (selector) =>
	`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`;

async function ladder(siteOrigin) {
	const tab = await callOk(state, "open", {
		url: `${siteOrigin}/ladder`,
		requester: "session:proof",
	});
	say(`ladder tab ${tab.tab}`);
	const target = (await targets()).find(
		(t) => t.type === "page" && t.url.includes("/ladder"),
	);
	const session = await openSocket(target);
	const evalPage = async (expression) =>
		(
			await session.send("Runtime.evaluate", {
				expression,
				returnByValue: true,
			})
		)?.result?.value;
	const reading = async () => JSON.parse(await evalPage("window.__reading()"));
	const rows = [];
	const row = (label, detail) => {
		const line = `[LADDER] ${label}\n        ${detail}`;
		say(line);
		rows.push(line);
	};
	// Is the view REALLY the unpresented one? The host's own account of the tab,
	// before any foreign session attaches, so the ladder cannot be measuring a tab
	// that quietly became the presented surface.
	const listed = await callOk(state, "tabs", { requester: "session:proof" });
	row(
		"the host's account of this tab (tabs)",
		JSON.stringify(listed.tabs.find((t) => t.tab === tab.tab) ?? listed),
	);
	const vis = await evalPage(
		"JSON.stringify({ visibility: document.visibilityState, hidden: document.hidden, hasFocus: document.hasFocus(), w: innerWidth, h: innerHeight })",
	);
	row("the driven view as the page sees it", vis);

	const pt = JSON.parse(await evalPage(CENTER_OF("#row-1")));
	const away = { x: 900, y: 600 };
	const summary = (r) =>
		`hover=${r.hoverRow1} menuDisplay=${r.menu1Display} tip=${JSON.stringify(r.tip)} events=${JSON.stringify(r.events)}`;

	// A. the compositor path: Input.dispatchMouseEvent mouseMoved.
	await session.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: away.x,
		y: away.y,
	});
	await evalPage("window.__events.length = 0");
	await session.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: pt.x,
		y: pt.y,
	});
	await sleep(300);
	row(
		"A. Input.dispatchMouseEvent mouseMoved, nothing else",
		summary(await reading()),
	);

	// B. the same, with focus emulation on (Chromium then treats the page as focused).
	await session.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: away.x,
		y: away.y,
	});
	await evalPage("window.__events.length = 0");
	await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
	await session.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: pt.x,
		y: pt.y,
	});
	await sleep(300);
	row(
		"B. mouseMoved with Emulation.setFocusEmulationEnabled",
		summary(await reading()),
	);
	await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
	await session.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: away.x,
		y: away.y,
	});

	// C. CSS.forcePseudoState alone: style invalidation, no events.
	await evalPage("window.__events.length = 0");
	await session.send("DOM.enable");
	await session.send("CSS.enable");
	const doc = await session.send("DOM.getDocument", { depth: 0 });
	const found = await session.send("DOM.querySelector", {
		nodeId: doc.root.nodeId,
		selector: "#row-1",
	});
	await session.send("CSS.forcePseudoState", {
		nodeId: found.nodeId,
		forcedPseudoClasses: ["hover"],
	});
	await sleep(300);
	row("C. CSS.forcePseudoState hover only", summary(await reading()));
	await session.send("CSS.forcePseudoState", {
		nodeId: found.nodeId,
		forcedPseudoClasses: [],
	});

	// D. synthetic page events only (what the click path does): handlers, no :hover.
	await evalPage("window.__events.length = 0");
	await evalPage(
		`(() => { const el = document.getElementById('row-1'); for (const t of ['pointerover','pointerenter','mouseover','mouseenter','pointermove','mousemove']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: !/enter/.test(t), view: window, clientX: ${pt.x}, clientY: ${pt.y} })); })()`,
	);
	await sleep(300);
	row("D. dispatched pointer/mouse events only", summary(await reading()));

	// E. keyboard: a raw keyDown on the hidden view.
	await evalPage(
		"window.__keys.length = 0; document.getElementById('item').focus()",
	);
	await session.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "e",
		code: "KeyE",
		windowsVirtualKeyCode: 69,
		text: "e",
		unmodifiedText: "e",
	});
	await session.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "e",
		code: "KeyE",
		windowsVirtualKeyCode: 69,
	});
	await sleep(300);
	let r = await reading();
	row(
		"E. Input.dispatchKeyEvent 'e' on a focused non-editable li",
		`keys=${JSON.stringify(r.keys)} editing=${r.editing} active=${r.active}`,
	);
	await evalPage("window.__keys.length = 0");
	await session.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "k",
		code: "KeyK",
		windowsVirtualKeyCode: 75,
		modifiers: 2,
	});
	await session.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "k",
		code: "KeyK",
		windowsVirtualKeyCode: 75,
		modifiers: 2,
	});
	await sleep(300);
	r = await reading();
	row(
		"F. Input.dispatchKeyEvent Control+K",
		`keys=${JSON.stringify(r.keys)} palette=${r.palette}`,
	);

	// G. NEGATIVE CONTROL for A-F: turn focus emulation OFF from this session and
	// repeat the real mouseMoved. The app's own attach (cdp.ts) enables it, so
	// rows A-F ran with the page believing it is focused. If row G still hovers,
	// emulation is not what makes real input land on this detached view; if it
	// does not, the shipped mechanism depends on cdp.ts's attach and must say so.
	await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
	await session.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: away.x,
		y: away.y,
	});
	await sleep(200);
	await evalPage("window.__events.length = 0");
	const gVis = await evalPage(
		"JSON.stringify({ visibility: document.visibilityState, hasFocus: document.hasFocus() })",
	);
	await session.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: pt.x,
		y: pt.y,
	});
	await sleep(300);
	row(
		"G. control: real mouseMoved with focus emulation OFF in this session",
		`${gVis} ${summary(await reading())}`,
	);
	await session.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: away.x,
		y: away.y,
	});
	await evalPage(
		"window.__keys.length = 0; document.getElementById('editing').style.display='none'; document.getElementById('item').focus()",
	);
	await session.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "e",
		code: "KeyE",
		windowsVirtualKeyCode: 69,
		text: "e",
		unmodifiedText: "e",
	});
	await session.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "e",
		code: "KeyE",
		windowsVirtualKeyCode: 69,
	});
	await sleep(300);
	r = await reading();
	row(
		"H. control: key 'e' with focus emulation OFF in this session",
		`keys=${JSON.stringify(r.keys)} editing=${r.editing}`,
	);
	session.close();
	return rows;
}

// ---- the run ---------------------------------------------------------------

let state = null;

async function main() {
	rmSync(SCRATCH, { recursive: true, force: true });
	for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA, LOG_DIR, OUT_DIR])
		mkdirSync(dir, { recursive: true });
	const site = await startSite();
	const siteOrigin = `http://127.0.0.1:${site.port}`;
	say(`scratch: ${SCRATCH}\nsite: ${siteOrigin}\nwindow mode: ${WINDOW_MODE}`);
	app = await launchApp();
	try {
		state = await waitForState();
		await waitForRenderer();
		await rendererEvaluate(
			"window.api.browser.setContentRect({ x: 0, y: 0, width: 1280, height: 800 }).then((s) => JSON.stringify(s))",
		);
		await approve(state, siteOrigin);
		if (LADDER) await ladder(siteOrigin);
		else await shipped(siteOrigin);
	} finally {
		site.server.close();
	}
}

/** Print one response exactly as the wire carried it: the evidence is the JSON. */
function show(label, value) {
	say(`    ${label}: ${JSON.stringify(value)}`);
}

async function shipped(siteOrigin) {
	const opened = await callOk(state, "open", {
		url: `${siteOrigin}/shipped`,
		requester: "session:proof",
	});
	const tab = opened.tab;
	const shot = async (name) => {
		const out = await callOk(state, "screenshot", { tab });
		const file = join(OUT_DIR, `${name}.png`);
		writeFileSync(file, Buffer.from(out.data, "base64"));
		say(`    screenshot: ${file}`);
	};
	const tabIsBackground = async () => {
		const listed = await callOk(state, "tabs", { requester: "session:proof" });
		return listed.tabs.find((t) => t.tab === tab)?.active === false;
	};
	const reading = () => pageReading("/shipped");

	check(
		"the agent tab is not the active tab before anything is driven",
		await tabIsBackground(),
	);

	say("--- hover: a :hover-revealed row action and a JS mouseenter tooltip");
	const before = await reading();
	show("page before", before);
	check(
		"NEGATIVE CONTROL: before any hover the row action has no box and no handler has fired",
		before.menu1Display === "none" &&
			before.menu1Box === false &&
			before.events.length === 0 &&
			before.tip === "",
	);
	await shot("1-before-hover");

	const hoverRow = await call(state, "hover", { tab, selector: "#row-1" });
	show("hover #row-1 ->", hoverRow);
	const afterRow = await reading();
	show("page after", afterRow);
	check(
		"hover by selector returns x, y, the hit_test descriptor and url",
		hoverRow.ok &&
			typeof hoverRow.result.x === "number" &&
			hoverRow.result.hit?.count >= 1 &&
			typeof hoverRow.result.url === "string",
	);
	check(
		"hover reports hovered:true (the honest :hover verdict)",
		hoverRow.result?.hovered === true,
	);
	check(
		"the CSS :hover rule applied: the display:none row action now has a box",
		afterRow.hoverRow1 === true &&
			afterRow.menu1Display !== "none" &&
			afterRow.menu1Box === true,
	);
	check(
		"the JS handlers fired: pointerenter, mouseenter, tooltip text",
		afterRow.events.includes("pointerenter:row-1") &&
			afterRow.events.includes("mouseenter:row-1") &&
			afterRow.tip === "tip for row-1",
	);
	await shot("2-after-hover");
	check(
		"the row action revealed by hover is now clickable through the host",
		await (async () => {
			const clicked = await call(state, "click", { tab, selector: "#menu-1" });
			show("click #menu-1 ->", { ok: clicked.ok, error: clicked.error });
			return clicked.ok;
		})(),
	);

	say(
		"--- hover: moving to another element leaves the first (stateful, like a real pointer)",
	);
	const hoverNav = await call(state, "hover", { tab, selector: "#nav" });
	show("hover #nav ->", hoverNav);
	const afterNav = await reading();
	check(
		"the mouseenter-opened dropdown is open and the previous row closed",
		afterNav.navOpen === true &&
			afterNav.navMenuDisplay === "block" &&
			afterNav.hoverRow1 === false &&
			afterNav.menu1Display === "none" &&
			afterNav.events.includes("mouseleave:row-1"),
	);

	say("--- hover: by position, and a target below the fold");
	const rect = await callOk(state, "styles", { tab, selector: "#row-2" });
	const r2 = rect.matches[0].rect;
	const byPoint = await call(state, "hover", {
		tab,
		x: r2.x + r2.width / 2,
		y: r2.y + r2.height / 2,
	});
	show("hover by x,y ->", byPoint);
	check(
		"hover by position lands on the element under the point",
		byPoint.ok &&
			byPoint.result.hit.elements.some((e) => e.id === "row-2") &&
			(await reading()).events.includes("mouseenter:row-2"),
	);
	const far = await call(state, "hover", { tab, selector: "#far-row" });
	show("hover #far-row (below the fold) ->", far);
	const afterFar = await reading();
	check(
		"a below-the-fold target is scrolled into view first and then hovered",
		far.ok && afterFar.scrollY > 0 && far.result.hovered === true,
	);

	say("--- hover: refusals touch nothing");
	const eventsBefore = (await reading()).events.length;
	for (const params of [{ selector: "#row-1", x: 5, y: 5 }, { x: 5 }, {}]) {
		const out = await call(state, "hover", { tab, ...params });
		show(`hover ${JSON.stringify(params)} ->`, out);
		check(
			`hover ${JSON.stringify(params)} is refused as invalid_arguments`,
			!out.ok && out.error.data?.reason === "invalid_arguments",
		);
	}
	const missing = await call(state, "hover", {
		tab,
		selector: "#no-such-element",
	});
	show("hover #no-such-element ->", missing);
	check(
		"a selector that matches nothing is element_not_found",
		!missing.ok && missing.error.code === "element_not_found",
	);
	check(
		"no refusal moved the pointer or fired a page event",
		(await reading()).events.length === eventsBefore,
	);

	say("--- hover: a handler that navigates the tab to an UNAPPROVED origin");
	const navTab = await callOk(state, "open", {
		url: `${siteOrigin}/navhover`,
		requester: "session:proof",
	});
	const navHover = await call(state, "hover", {
		tab: navTab.tab,
		selector: "#t",
	});
	show("hover #t (handler navigates to localhost) ->", navHover);
	await sleep(1500);
	const navTabs = await callOk(state, "tabs", { requester: "session:proof" });
	const navUrl = navTabs.tabs.find((t) => t.tab === navTab.tab)?.url ?? "";
	show("the tab's url afterwards", navUrl);
	check(
		"a hover that navigates to an unapproved origin is refused as origin_not_allowed",
		!navHover.ok && navHover.error?.code === "origin_not_allowed",
		JSON.stringify(navHover.ok ? navHover.result : navHover.error),
	);
	check(
		"and the tab is put back on the approved document, not left on the unapproved one",
		navUrl.startsWith(siteOrigin) && !navUrl.includes("localhost"),
		navUrl,
	);

	say("--- press: a shortcut on a focused NON-editable element, and chords");
	// Reset the fixture's observable state through the page itself.
	const reset = async () => {
		const target = (await targets()).find(
			(t) => t.type === "page" && t.url.includes("/shipped"),
		);
		const sess = await openSocket(target);
		await sess.send("Runtime.evaluate", {
			expression:
				"window.__keys.length = 0; document.getElementById('editing').style.display='none'; document.getElementById('palette').classList.remove('open'); document.activeElement.blur()",
		});
		sess.close();
	};
	await reset();
	const noFocus = await call(state, "press", { tab, key: "e" });
	show("press e (nothing focused) ->", noFocus);
	check(
		"NEGATIVE CONTROL: 'e' with nothing focused does not trigger the li's handler",
		noFocus.ok && (await reading()).editing === false,
	);
	const pressE = await call(state, "press", {
		tab,
		key: "e",
		selector: "#item",
	});
	show("press e on #item ->", pressE);
	const afterE = await reading();
	show("page keys", afterE.keys);
	check(
		"press e with a selector focuses the li and reaches its keydown listener",
		pressE.ok &&
			afterE.editing === true &&
			afterE.active === "item" &&
			afterE.keys.some((k) => k.startsWith("down:e|KeyE|-|-|-|-")),
	);
	check(
		"a plain character fires keypress too (text is set)",
		afterE.keys.includes("press:e"),
	);

	await reset();
	const ctrlK = await call(state, "press", { tab, key: "Ctrl+K" });
	show("press Ctrl+K ->", ctrlK);
	let k = await reading();
	show("page keys", k.keys);
	check(
		"Ctrl+K arrives with ctrlKey and key 'k' and opens the palette",
		ctrlK.ok &&
			ctrlK.result.key === "Control+K" &&
			k.palette === true &&
			k.keys.includes("down:k|KeyK|C|-|-|-"),
	);
	check(
		"a shortcut carries no text: no keypress was fired",
		!k.keys.some((x) => x.startsWith("press:")),
	);
	const metaK = await call(state, "press", { tab, key: "cmd+k" });
	show("press cmd+k ->", metaK);
	k = await reading();
	check(
		"cmd+k canonicalises to Meta+k, arrives with metaKey and toggles the palette closed",
		metaK.ok &&
			metaK.result.key === "Meta+k" &&
			k.palette === false &&
			k.keys.includes("down:k|KeyK|-|M|-|-"),
	);
	const combo = await call(state, "press", {
		tab,
		key: "Control+Shift+Alt+Meta+F5",
	});
	show("press Control+Shift+Alt+Meta+F5 ->", combo);
	k = await reading();
	check(
		"all four modifiers arrive on one event",
		combo.ok && k.keys.includes("down:F5|F5|C|M|S|A"),
	);

	say(
		"--- press: the original eight spellings still work, and refusals send nothing",
	);
	for (const key of [
		"Tab",
		"Shift+Tab",
		"Enter",
		"Escape",
		"ArrowUp",
		"ArrowDown",
		"ArrowLeft",
		"ArrowRight",
	]) {
		const out = await call(state, "press", { tab, key });
		check(
			`press ${key} succeeds and echoes the key unchanged`,
			out.ok && out.result.key === key,
			JSON.stringify(out.ok ? { key: out.result.key } : out.error),
		);
	}
	const keysBefore = (await reading()).keys.length;
	for (const key of [
		"Ctrl+Nope",
		"hello",
		"tab",
		"Shift",
		"Super+k",
		"hunter2-hunter2",
	]) {
		const out = await call(state, "press", { tab, key });
		show(`press ${JSON.stringify(key)} ->`, out);
		check(
			`press ${JSON.stringify(key)} is refused as unsupported_key`,
			!out.ok && out.error.code === "unsupported_key",
		);
	}
	check(
		"no refused chord reached the page",
		(await reading()).keys.length === keysBefore,
	);

	check(
		"the agent tab was never made active by any of it",
		await tabIsBackground(),
	);
	const capabilities = await (
		await fetch(`http://127.0.0.1:${state.port}/health`)
	).json();
	check(
		"/health advertises press_chord and hover beside press",
		capabilities.capabilities.includes("hover") &&
			capabilities.capabilities.includes("press_chord") &&
			capabilities.capabilities.includes("press"),
		JSON.stringify(capabilities.capabilities),
	);
	say(`artifacts: ${OUT_DIR}`);
}

main()
	.catch((error) => {
		console.error("proof run failed:", error);
		failures += 1;
	})
	.finally(async () => {
		await app?.stop();
		if (failures > 0) process.exitCode = 1;
	});
