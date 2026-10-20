#!/usr/bin/env node
/**
 * Real-input proof for the address bar's local autocomplete.
 *
 * WHAT THIS RUNS: the BUILT app in `--window-mode=headless`, against a local
 * fixture site, with the operator's real profile untouched. It types into the
 * REAL React-controlled input with the native value setter and a real `input`
 * event (`inputType: "insertText"`), presses real keys, and reads the actual
 * `value`, `selectionStart`, `selectionEnd`, `document.activeElement`, the list's
 * DOM box and main's request count.
 *
 * WHAT IT DOES NOT CLAIM: a real window's z-order. The app is headless by
 * construction; the list is IN FLOW, and the geometric claim this proves is the
 * one the design rests on — the list's bottom is at or above the native page's
 * measured top. VoiceOver/native IME interaction also cannot be driven from here;
 * the script reports that limitation in its own report rather than implying it.
 *
 * USAGE:
 *   LO_PROOF_WIDTH=1380 LO_PROOF_HEIGHT=900 LO_PROOF_THEME=light \
 *     node scripts/browser-url-autocomplete-proof.mjs <out-dir>
 *
 *   LO_PROOF_PANE_WIDTH=480 runs the same scene with the browser VIEW at 480
 *   CSS px. The window cannot go below 800, so this emulates the CSS viewport
 *   at pane + the measured 56px icon rail; the window itself still launches at
 *   its 800px floor. The report records both the emulated viewport and the
 *   measured pane width.
 *
 * Isolation: scratch HOME, config, log and user-data dirs; CMUX_/LOP_ variables
 * stripped; mock keychain; notifications and telemetry off. The app is spawned by
 * absolute path, detached into its own process group, and the group is reaped by
 * its exact pid on every exit path.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(process.cwd());
const OUT = resolve(
	process.argv[2] ?? join(tmpdir(), `lo-url-autocomplete-proof-${process.pid}`),
);
const WIDTH_ARG = process.env.LO_PROOF_WIDTH
	? Number(process.env.LO_PROOF_WIDTH)
	: null;
const REQUESTED_WIDTH = WIDTH_ARG ?? 1380;
const PANE_WIDTH = process.env.LO_PROOF_PANE_WIDTH
	? Number(process.env.LO_PROOF_PANE_WIDTH)
	: null;
const WIDTH = PANE_WIDTH === null ? REQUESTED_WIDTH : PANE_WIDTH + 56;
const HEIGHT = Number(process.env.LO_PROOF_HEIGHT ?? 900);
const THEME =
	process.env.LO_PROOF_THEME === "light"
		? "localOperatorLight"
		: "localOperatorDark";
const ELECTRON_BIN = createRequire(import.meta.url)("electron");

mkdirSync(OUT, { recursive: true });
const report = {
	viewport: { width: WIDTH, height: HEIGHT },
	theme: THEME,
	steps: [],
	limitations: [
		"Headless run: this is renderer geometry and native-view bounds, not a real window's z-order.",
		"VoiceOver and native IME composition cannot be driven from CDP; composition is covered by the model tests and the input's own handlers.",
	],
};
const record = (step, value) => {
	report.steps.push({ step, ...value });
	console.log(`${step}: ${JSON.stringify(value)}`);
};
let failures = 0;
const check = (label, ok, detail) => {
	if (!ok) failures += 1;
	record(label, { ok, detail });
};
/**
 * THE INSET CLAIM, asked of every cell that shows the list.
 *
 * The row must sit on the address FIELD's horizontal bounds - not the pane's -
 * and be narrower than the toolbar it hangs from. It is asked cell by cell
 * because the field's edges come from the controls around it (the downloads
 * folder, the zoom reset, the Approvals label), so a fix that only holds at
 * one viewport with one set of controls has not fixed it. 1px is the tolerance
 * for the list's border and the reported sub-pixel boxes.
 */
const checkInset = (label, state) => {
	const listBox = state?.list?.rect ?? null;
	const fieldBox = state?.inputRect ?? null;
	const barBox = state?.bar ?? null;
	if (!listBox || !fieldBox || !barBox) return;
	const left = Math.abs(listBox.left - fieldBox.left);
	const right = Math.abs(listBox.right - fieldBox.right);
	check(
		`${label}: the list is inset to the field's bounds, narrower than the bar`,
		left <= 1 && right <= 1 && listBox.width < barBox.width - 1,
		`list=${listBox.left.toFixed(1)}..${listBox.right.toFixed(1)} w=${listBox.width.toFixed(1)} field=${fieldBox.left.toFixed(1)}..${fieldBox.right.toFixed(1)} bar=${barBox.left.toFixed(1)}..${barBox.right.toFixed(1)} w=${barBox.width.toFixed(1)} dLeft=${left.toFixed(1)} dRight=${right.toFixed(1)}`,
	);
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** A URL's trailing slash is not a different destination for this comparison. */
const TRAILING_SLASH = /\/$/;

// ---- the fixture site ------------------------------------------------------

const PAGE = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;font:16px -apple-system,system-ui,sans-serif;background:#12263a;color:#e6f1ff">
<div style="padding:40px"><h1 style="margin:0 0 8px;font-size:32px">${title}</h1>
<p style="margin:0;opacity:.8">${body}</p>
<p style="margin-top:24px"><a href="/second" style="color:#7fd1ff">Second page</a></p>
</div></body></html>`;

const routes = {
	"/": PAGE("Suggestion Alpha", "The first page in this session."),
	"/account": PAGE(
		"Account settings",
		"A page whose URL is a prefix of another.",
	),
	"/account/profile": PAGE(
		"Profile page",
		"The current page for the inline case.",
	),
	"/second": PAGE("Proof page two", "The second document."),
	"/unicode/道": PAGE("Unicode path", "A path outside ASCII."),
	"/fragment": PAGE("Fragment page", "A page with a fragment."),
};

const navigations = [];
const server = await new Promise((done) => {
	const instance = createServer((request, response) => {
		const path = request.url?.split("?")[0] ?? "/";
		if (path !== "/favicon.ico") navigations.push(request.url);
		const body = routes[path];
		response.writeHead(body ? 200 : 404, {
			"Content-Type": "text/html; charset=utf-8",
		});
		response.end(body ?? PAGE("Not found", "Missing fixture route."));
	});
	instance.listen(0, "127.0.0.1", () => done(instance));
});
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const originPath = (path) => `127.0.0.1:${PORT}${path}`;
record("fixture", { origin: ORIGIN, routes: Object.keys(routes) });

// ---- the app ---------------------------------------------------------------

const SCRATCH = join(OUT, "scratch");
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const LOG_DIR = join(SCRATCH, "logs");
const USER_DATA = join(SCRATCH, "user-data");
for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR, USER_DATA])
	mkdirSync(dir, { recursive: true });

function freePort() {
	return new Promise((done) => {
		const probe = createServer();
		probe.on("error", () => done(freePort()));
		probe.listen(0, "127.0.0.1", () => {
			const port = probe.address().port;
			probe.close(() => done(port));
		});
	});
}
const CDP_PORT = await freePort();

const env = withTelemetryOff(
	withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		VITE_DISABLE_BACKEND_MANAGER: "true",
	}),
);
for (const key of Object.keys(env)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
}
// Mock keychain: a scratch HOME must never create a login keychain prompt on the
// operator's screen. Same switch the repo's other rigs use.
env.ELECTRON_ENABLE_LOGGING = "0";

const app = spawn(
	ELECTRON_BIN,
	withMockKeychain([
		ROOT,
		`--user-data-dir=${USER_DATA}`,
		`--remote-debugging-port=${CDP_PORT}`,
		`--window-size=${PANE_WIDTH !== null ? (WIDTH_ARG ?? 800) : REQUESTED_WIDTH}x${HEIGHT}`,
		"--window-mode=headless",
	]),
	{
		cwd: ROOT,
		env,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	},
);
let child = app;
const log = [];
app.stdout.on("data", (chunk) => log.push(chunk.toString()));
app.stderr.on("data", (chunk) => log.push(chunk.toString()));

function reap() {
	if (!child) return;
	const pid = child.pid;
	child = null;
	for (const signal of ["SIGTERM", "SIGKILL"]) {
		try {
			process.kill(-pid, signal);
		} catch {
			/* group gone */
		}
		try {
			process.kill(pid, signal);
		} catch {
			/* already gone */
		}
	}
}
process.on("exit", reap);
process.on("SIGINT", () => {
	reap();
	process.exit(130);
});

// ---- CDP -------------------------------------------------------------------

let socket = null;
let nextId = 1;
const pending = new Map();
const targets = async () => {
	const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
	return await response.json();
};
async function connectRenderer() {
	for (let waited = 0; waited < 60_000; waited += 250) {
		const list = await targets().catch(() => []);
		const renderer = list.find(
			(target) =>
				target.type === "page" &&
				typeof target.url === "string" &&
				target.url.startsWith("file://") &&
				target.url.includes("index.html"),
		);
		if (renderer?.webSocketDebuggerUrl) {
			socket = new WebSocket(renderer.webSocketDebuggerUrl);
			await new Promise((done, fail) => {
				socket.addEventListener("open", done, { once: true });
				socket.addEventListener("error", fail, { once: true });
			});
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id !== undefined && pending.has(message.id)) {
					const { done, fail } = pending.get(message.id);
					pending.delete(message.id);
					if (message.error) fail(new Error(message.error.message));
					else done(message.result);
				}
			});
			return renderer.url;
		}
		await sleep(250);
	}
	throw new Error("the app's renderer never appeared on the debugging port");
}
function send(method, params = {}) {
	const id = nextId++;
	return new Promise((done, fail) => {
		pending.set(id, { done, fail });
		socket.send(JSON.stringify({ id, method, params }));
	});
}
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
async function waitFor(expression, label, timeout = 30_000) {
	for (let waited = 0; waited < timeout; waited += 100) {
		try {
			if (await evaluate(expression)) return true;
		} catch {
			/* page not ready */
		}
		await sleep(100);
	}
	throw new Error(`timed out waiting for ${label}`);
}
/** A harness-side bound: a wedged invoke must not hang the whole run. */
async function evaluateTimed(expression, label, timeoutMs = 12_000) {
	let timer;
	try {
		return await Promise.race([
			evaluate(expression),
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`timed out: ${label}`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function shot(name) {
	const image = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(OUT, `${name}.png`), Buffer.from(image.data, "base64"));
	record("frame", { name: `${name}.png` });
}

/** Type a full value through the REAL controlled input. */
const typeValue = (value) =>
	evaluate(`(() => {
		const input = document.querySelector('[data-tour-tag="browser-address"]');
		if (!input) return { error: 'missing input' };
		input.focus();
		// A programmatic focus in a headless, never-shown window does not dispatch
		// focus/focusin in this Electron build (measured). The browser sends focusin
		// when a person clicks; dispatch the SAME event React listens for so the
		// field enters its real focused path.
		input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(input, ${JSON.stringify(value)});
		input.dispatchEvent(new InputEvent('input', {
			bubbles: true,
			inputType: 'insertText',
			data: ${JSON.stringify(value)},
		}));
		return { value: input.value, start: input.selectionStart, end: input.selectionEnd };
	})()`);

const clearValue = () =>
	evaluate(`(() => {
		const input = document.querySelector('[data-tour-tag="browser-address"]');
		if (!input) return { error: 'missing input' };
		input.focus();
		input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(input, '');
		input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
		return { value: input.value, start: input.selectionStart, end: input.selectionEnd };
	})()`);

const key = (keyValue, modifiers = {}) =>
	evaluate(`(() => {
		const input = document.querySelector('[data-tour-tag="browser-address"]');
		if (!input) return { error: 'missing input' };
		const event = new KeyboardEvent('keydown', {
			key: ${JSON.stringify(keyValue)},
			bubbles: true,
			cancelable: true,
			metaKey: ${Boolean(modifiers.meta)},
			ctrlKey: ${Boolean(modifiers.ctrl)},
			shiftKey: ${Boolean(modifiers.shift)},
			altKey: ${Boolean(modifiers.alt)},
		});
		input.dispatchEvent(event);
		return { prevented: event.defaultPrevented };
	})()`);

const readInput = () =>
	evaluate(`(() => {
		const input = document.querySelector('[data-tour-tag="browser-address"]');
		if (!input) return { error: 'missing input' };
		const list = document.querySelector('[data-tour-tag="browser-address-suggestions"]');
		const bar = document.querySelector('[data-tour-tag="browser-url-bar"]');
		const content = document.querySelector('[data-tour-tag="browser-content"]');
		const options = [...document.querySelectorAll('[data-address-suggestion]')];
		const rect = (element) => {
			if (!element) return null;
			const box = element.getBoundingClientRect();
			return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
		};
		return {
			count: document.querySelectorAll('[data-tour-tag="browser-address"]').length,
			value: input.value,
			start: input.selectionStart,
			end: input.selectionEnd,
			active: document.activeElement === input,
			activeDescendant: input.getAttribute('aria-activedescendant'),
			expanded: input.getAttribute('aria-expanded'),
			role: input.getAttribute('role'),
			editing: input.getAttribute('data-address-editing'),
			loading: input.getAttribute('data-address-loading'),
			suppressed: input.getAttribute('data-address-suppressed'),
			candidateCount: input.getAttribute('data-address-candidates'),
			autoComplete: input.getAttribute('aria-autocomplete'),
			list: list ? {
				text: list.innerText.replace(/\\s+/g, ' ').trim(),
				rect: rect(list),
			} : null,
			content: rect(content),
			bar: rect(bar),
			options: options.map((option) => ({
				text: option.innerText.replace(/\\s+/g, ' ').trim(),
				selected: option.getAttribute('aria-selected'),
				url: option.getAttribute('data-address-suggestion-url'),
				id: option.id,
			})),
			inputRect: rect(input),
			viewport: { width: innerWidth, height: innerHeight },
		};
	})()`);

const waitForUrl = async (path) => {
	let last = null;
	for (let waited = 0; waited < 20_000; waited += 100) {
		const state = await evaluate("window.api.browser.state()");
		last = state;
		const wanted = `${ORIGIN}${path}`.replace(TRAILING_SLASH, "");
		if (
			typeof state?.url === "string" &&
			state.url.replace(TRAILING_SLASH, "") === wanted &&
			state.loading !== true
		)
			return { ok: true, state };
		await sleep(100);
	}
	return { ok: false, last };
};

const nav = async (path) => {
	// A FULL scheme on the typed path: the host prepends HTTPS to a scheme-less
	// address (the existing typed-navigation policy), and this fixture is HTTP.
	// Scheme-less COMPLETION is proved separately: its `targetUrl` is the exact
	// canonical HTTP destination even though the field shows the bare host.
	await typeValue(`${ORIGIN}${path}`);
	// A person's keystroke reaches a committed draft; give React's discrete
	// event a turn before the next key, or the Enter can read the previous
	// (empty) draft and load nothing.
	await sleep(120);
	await key("Enter");
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const result = await waitForUrl(path);
		if (result.ok) return true;
		// The first navigation can queue behind the app's own initial
		// `about:blank` hydration in a headless boot. Dismiss the draft, wait for
		// that load to settle, and type the same address again.
		await key("Escape");
		await sleep(750);
		await typeValue(`${ORIGIN}${path}`);
		await sleep(120);
		await key("Enter");
	}
	return false;
};

try {
	await connectRenderer();
	if (PANE_WIDTH !== null) {
		// The window floor is 800; the browser VIEW floor is 480. Emulate the CSS
		// viewport so the pane is exactly PANE_WIDTH while the native window keeps
		// its own floor and the native view bounds follow the measured rect.
		await send("Emulation.setDeviceMetricsOverride", {
			width: WIDTH,
			height: HEIGHT,
			deviceScaleFactor: 1,
			mobile: false,
		});
	}
	await send("Page.enable", {});
	await send("Runtime.enable", {});
	await waitFor(
		"typeof window.api?.browser?.state === 'function' ? 'ready' : ''",
		"the browser preload",
	);
	await evaluate(`localStorage.setItem('onboarding-storage', JSON.stringify({
		state: { isModalComplete: true, isTourComplete: true, currentStep: null }, version: 0,
	}))`);
	await evaluate(`(() => {
		const key = 'ui-preferences-storage';
		const raw = localStorage.getItem(key);
		const parsed = raw === null ? { state: {}, version: 2 } : JSON.parse(raw);
		parsed.state = { ...(parsed.state ?? {}), themeName: ${JSON.stringify(THEME)} };
		localStorage.setItem(key, JSON.stringify(parsed));
	})()`);
	await send("Page.reload", {});
	await waitFor(
		"typeof window.api?.browser?.state === 'function' ? 'ready' : ''",
		"the preload after the reload",
	);
	const loaded = await evaluate(`(() => ({
		viewport: { width: innerWidth, height: innerHeight },
		theme: JSON.parse(localStorage.getItem('ui-preferences-storage') || '{}')?.state?.themeName ?? null,
	}))()`);
	record("boot", loaded);
	check(
		"the run is at the requested viewport",
		loaded.viewport.width === WIDTH,
		`${loaded.viewport.width}x${loaded.viewport.height}`,
	);
	check("the requested theme booted", loaded.theme === THEME, loaded.theme);

	// The rail is the user's path to the surface.
	for (let waited = 0; waited < 20_000; waited += 200) {
		const clicked = await evaluate(`(() => {
			const item = document.querySelector('[data-tour-tag="nav-item-browser"]');
			if (!item) return false;
			item.click();
			return true;
		})()`);
		if (clicked) break;
		await sleep(200);
	}
	await waitFor("location.hash.includes('/browser')", "the browser route");
	record("route", { hash: await evaluate("location.hash") });

	// ---- populate real history -------------------------------------------
	// The app's own first blank tab is hydrated in the background; a typed
	// navigation queued behind that load is a harness race, not a feature read.
	try {
		await waitFor(
			"window.api.browser.state().then((s) => (s.loading === false ? 'ready' : ''))",
			"the initial blank tab to settle",
			30_000,
		);
	} catch (error) {
		record("initial tab still loading", {
			message: String(error?.message ?? error),
		});
	}
	// Nav is SETUP for this proof, not the claim: `browser-chrome-proof.mjs` is
	// the typed-navigation evidence. A headless boot occasionally takes a long
	// time to settle its first about:blank load; record that rather than
	// failing the autocomplete claim for it.
	record("fixture navigation /", { ok: await nav("/") });
	record("fixture navigation /account", { ok: await nav("/account") });
	record("fixture navigation /account/profile", {
		ok: await nav("/account/profile"),
	});
	// The raw snapshot, before any UI inference: this is what main actually read.
	const activeState = await evaluate("window.api.browser.state()");
	const rawHistory = await evaluate(`window.api.browser.addressHistory({
		requestId: 1,
		expectedTabId: ${activeState.activeTabId},
		scope: 'all',
	}).catch((error) => ({ error: String(error?.message ?? error) }))`);
	record("raw history", rawHistory);
	check(
		"the fixture populated real history for this run",
		Array.isArray(rawHistory.entries) && rawHistory.entries.length >= 2,
		`${rawHistory.entries?.length ?? 0} entries`,
	);
	const beforeTyping = navigations.length;
	record("navigation baseline", { requests: beforeTyping });

	// ---- populated list on focus, empty query ----------------------------
	// Re-focus deliberately: the field was focused before the fixture history
	// existed, so this is the "what does a fresh focus see" read the proposal
	// specifies. (The invalidation path is separately observed by the fact that
	// the snapshot below changes without a reload.)
	await evaluate(`(() => {
		const input = document.querySelector('[data-tour-tag="browser-address"]');
		input.blur();
		input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		input.focus();
		input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
	})()`);
	await sleep(500);
	await clearValue();
	await sleep(500);
	const emptyFocus = await readInput();
	if (PANE_WIDTH !== null && emptyFocus.content) {
		check(
			"the browser pane is at the requested floor",
			Math.abs(emptyFocus.content.width - PANE_WIDTH) <= 1,
			`pane.width=${emptyFocus.content.width} requested=${PANE_WIDTH}`,
		);
	}
	record("focused empty field", emptyFocus);
	checkInset("empty field", emptyFocus);
	check(
		"focus with an empty query shows the session's own entries",
		Boolean(emptyFocus.list) && emptyFocus.options.length > 0,
		`${emptyFocus.options.length} options`,
	);
	check(
		"the list label is the session claim",
		emptyFocus.list?.text.startsWith("From this browser session"),
		emptyFocus.list?.text,
	);
	await shot("01-empty-field");

	// ---- inline completion ------------------------------------------------
	await clearValue();
	const prefix = originPath("/acc");
	await typeValue(prefix);
	await sleep(250);
	const inline = await readInput();
	record("inline completion", inline);
	checkInset("inline completion", inline);
	check(
		"the real input shows the raw prefix plus a generated suffix",
		inline.value === originPath("/account/profile") &&
			inline.start === prefix.length &&
			inline.end === inline.value.length,
		`value=${inline.value} selection=${inline.start}-${inline.end}`,
	);
	check(
		"the inline suffix is selected, not merely painted",
		inline.value.startsWith(prefix) && inline.end > inline.start,
		`raw=${prefix}`,
	);
	check(
		"typing causes no navigation",
		navigations.length === beforeTyping,
		`requests ${navigations.length} vs ${beforeTyping}`,
	);
	check(
		"the field's geometry is unchanged by the completion",
		inline.inputRect?.top === emptyFocus.inputRect?.top &&
			inline.inputRect?.height === emptyFocus.inputRect?.height,
		`${JSON.stringify(inline.inputRect)} vs ${JSON.stringify(emptyFocus.inputRect)}`,
	);
	if (inline.list && inline.content) {
		check(
			"the in-flow list ends at or above the native page's top",
			inline.list.rect.bottom <= inline.content.top + 1,
			`list.bottom=${inline.list.rect.bottom} content.top=${inline.content.top}`,
		);
	}
	await shot("02a-inline");
	await shot("02b-inline-next-frame");

	// ---- Right accepts without navigating --------------------------------
	await key("ArrowRight");
	await sleep(150);
	const accepted = await readInput();
	record("right accepts", accepted);
	checkInset("right accepts", accepted);
	check(
		"Right accepts the suffix, collapses the caret and does not navigate",
		accepted.value === originPath("/account/profile") &&
			accepted.start === accepted.end &&
			accepted.start === accepted.value.length &&
			navigations.length === beforeTyping,
		`value=${accepted.value} selection=${accepted.start}-${accepted.end} requests=${navigations.length}`,
	);

	// The path the old proof missed: Right accepts, then Enter navigates. The
	// canonical target must stay HTTP; an HTTPS upgrade would never reach this
	// fixture server, so both the request count and the live URL are checked.
	const beforeRightEnter = navigations.length;
	await key("Enter");
	await sleep(500);
	const rightEnter = await readInput();
	record("right then enter", rightEnter);
	checkInset("right then enter", rightEnter);
	check(
		"Right then Enter navigates exactly once",
		navigations.length === beforeRightEnter + 1,
		`requests ${navigations.length} vs ${beforeRightEnter + 1}`,
	);
	check(
		"Right then Enter keeps the accepted HTTP target",
		rightEnter.value === `${ORIGIN}/account/profile`,
		rightEnter.value,
	);

	// Escape dismisses the list but must not discard the accepted target; the
	// next Enter navigates the same canonical HTTP destination.
	await clearValue();
	await typeValue(prefix);
	await sleep(200);
	await key("ArrowRight");
	await key("Escape");
	const beforeEscapedEnter = navigations.length;
	await key("Enter");
	await sleep(400);
	const escapedEnter = await readInput();
	record("escape then enter", escapedEnter);
	check(
		"Escape after accepting keeps the canonical target",
		navigations.length === beforeEscapedEnter + 1 &&
			escapedEnter.value === `${ORIGIN}/account/profile`,
		`requests ${navigations.length} vs ${beforeEscapedEnter + 1}; ${escapedEnter.value}`,
	);

	// ---- ArrowDown + Enter commits one candidate -------------------------
	await clearValue();
	await typeValue(prefix);
	await sleep(200);
	await key("ArrowDown");
	await sleep(100);
	const down = await readInput();
	record("arrow down", down);
	checkInset("arrow down", down);
	check(
		"Down moves the active option without taking focus from the input",
		down.active &&
			down.options.some((option) => option.selected === "true") &&
			down.activeDescendant ===
				down.options.find((option) => option.selected === "true")?.id,
		`activeDescendant=${down.activeDescendant}`,
	);
	const beforeEnter = navigations.length;
	await key("Enter");
	await sleep(500);
	const afterEnter = await readInput();
	record("enter commits", afterEnter);
	check(
		"Enter navigates exactly once, to the selected alternative",
		navigations.length === beforeEnter + 1,
		`requests ${navigations.length} vs ${beforeEnter + 1}`,
	);
	check(
		"the committed destination is the selected row's canonical URL",
		afterEnter.value === `${ORIGIN}/account`,
		afterEnter.value,
	);

	// ---- blur never navigates -------------------------------------------
	await typeValue(prefix);
	await sleep(150);
	const beforeBlur = navigations.length;
	const blurred = await evaluate(`(() => {
		const input = document.querySelector('[data-tour-tag="browser-address"]');
		input.blur();
		input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		return true;
	})()`);
	await sleep(300);
	const afterBlur = await readInput();
	record("blur", {
		blurred,
		value: afterBlur.value,
		requests: navigations.length,
	});
	check(
		"blur dismisses the edit and never navigates",
		navigations.length === beforeBlur,
		`requests ${navigations.length} vs ${beforeBlur}`,
	);
	check(
		"blur returns the field to the live URL",
		afterBlur.value === `${ORIGIN}/account`,
		afterBlur.value,
	);

	// ---- Escape, twice ---------------------------------------------------
	await typeValue(prefix);
	await sleep(150);
	await key("Escape");
	await sleep(150);
	const escaped = await readInput();
	record("escape once", escaped);
	check(
		"the first Escape dismisses the suggestions and restores the raw draft",
		escaped.value === prefix && escaped.list === null,
		`value=${escaped.value} list=${Boolean(escaped.list)}`,
	);
	await key("Escape");
	await sleep(150);
	const abandoned = await readInput();
	check(
		"the second Escape abandons the edit and returns to the live URL",
		abandoned.value === `${ORIGIN}/account`,
		abandoned.value,
	);

	// ---- search intent is a hint, never a request ------------------------
	await typeValue("hello world");
	await sleep(150);
	await key("Enter");
	await sleep(200);
	const searchAfter = await readInput();
	record("search intent", searchAfter);
	checkInset("search intent", searchAfter);
	check(
		"natural language shows the localized address hint and does not navigate",
		searchAfter.list?.text.includes("Enter a web address") &&
			navigations.length === beforeBlur,
		`${searchAfter.list?.text} requests=${navigations.length}`,
	);
	await key("Escape");
	await sleep(100);

	// ---- stale expected tab is refused -----------------------------------
	const stateBefore = await evaluate("window.api.browser.state()");
	const oldTabId = stateBefore.activeTabId;
	let tabSwitchError = null;
	try {
		await evaluateTimed("window.api.browser.newTab(null)", "new tab");
	} catch (error) {
		tabSwitchError = String(error?.message ?? error);
	}
	await sleep(400);
	const stateAfter = await evaluate("window.api.browser.state()");
	if (tabSwitchError) {
		check("the stale/no-history section ran", false, tabSwitchError);
	}
	record("tab switch", {
		oldTabId,
		newTabId: stateAfter.activeTabId,
	});
	check(
		"a new tab became active before the stale check",
		stateAfter.activeTabId !== oldTabId,
		`${oldTabId} -> ${stateAfter.activeTabId}`,
	);
	if (!tabSwitchError) {
		const staleHistory = await evaluate(`window.api.browser.addressHistory({
		requestId: 9001,
		expectedTabId: ${oldTabId},
		scope: 'all',
	}).then(() => ({ ok: true })).catch((error) => ({ ok: false, message: String(error?.message ?? error) }))`);
		record("stale history", staleHistory);
		check(
			"main refuses a history request for a tab that is no longer active",
			staleHistory.ok === false,
			staleHistory.message,
		);
		const staleNavigate = await evaluate(`window.api.browser.navigate(
		${JSON.stringify(`${ORIGIN}/second`)},
		${oldTabId},
	).then(() => ({ ok: true })).catch((error) => ({ ok: false, message: String(error?.message ?? error) }))`);
		record("stale navigate", staleNavigate);
		check(
			"main refuses a navigation whose expected tab is no longer active",
			staleNavigate.ok === false,
			staleNavigate.message,
		);
		check(
			"the refused stale navigation loaded nothing",
			!navigations.some((url) => url === "/second"),
			navigations.slice(-3),
		);

		// ---- no-history / empty state on a fresh tab -------------------------
		// Close the populated tab first: scope `all` would otherwise still offer its
		// history, and the empty state would be tested against the wrong world.
		for (const tab of stateAfter.tabs) {
			if (tab.tabId !== stateAfter.activeTabId) {
				await evaluate(`window.api.browser.closeTab(${tab.tabId})`);
			}
		}
		await sleep(400);
		await evaluate(
			`(() => {
			const input = document.querySelector('[data-tour-tag="browser-address"]');
			input.blur();
			input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
			input.focus();
			input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		})()`,
		);
		await sleep(400);
		const fresh = await readInput();
		record("fresh tab", fresh);
		checkInset("fresh tab", fresh);
		check(
			"a tab with no HTTP(S) history says so quietly",
			fresh.list?.text.includes("No links from these tabs yet"),
			fresh.list?.text,
		);
		await shot("03-empty-history");
	} // end stale/fresh section

	// ---- the unavailable state (best effort: the bridge may be frozen) --
	const patched = await evaluate(`(() => {
		const api = window.api?.browser;
		if (!api || typeof api.addressHistory !== 'function') return { patched: false, reason: 'no bridge' };
		const original = api.addressHistory;
		try {
			Object.defineProperty(api, 'addressHistory', {
				configurable: true,
				value: () => Promise.reject(new Error('proof: history unavailable')),
			});
		} catch (error) {
			return { patched: false, reason: String(error?.message ?? error) };
		}
		window.__proofRestoreAddressHistory = () => {
			Object.defineProperty(api, 'addressHistory', { configurable: true, value: original });
		};
		return { patched: true };
	})()`);
	record("error injection", patched);
	if (patched.patched) {
		await evaluate(`(() => {
			const input = document.querySelector('[data-tour-tag="browser-address"]');
			input.blur();
			input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
			input.focus();
			input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		})()`);
		await sleep(500);
		const errored = await readInput();
		record("unavailable state", errored);
		checkInset("unavailable state", errored);
		check(
			"a failed history read says suggestions are unavailable while the field still types",
			errored.list?.text.includes("Address suggestions are unavailable"),
			errored.list?.text,
		);
		await shot("04-unavailable");
		await evaluate("window.__proofRestoreAddressHistory?.()");
	}

	// ---- geometry: the list ends above the native page -------------------
	const geometry = await readInput();
	checkInset("final read", geometry);
	if (geometry.list && geometry.content) {
		check(
			"the in-flow list ends at or above the native page's top",
			geometry.list.rect.bottom <= geometry.content.top + 1,
			`list.bottom=${geometry.list.rect.bottom} content.top=${geometry.content.top}`,
		);
	} else {
		record("geometry", { skipped: "no list at the final read" });
	}

	report.result = failures === 0 ? "PASS" : "FAIL";
} catch (error) {
	failures += 1;
	report.result = "FAIL";
	report.error = String(error?.stack ?? error);
	console.error(`proof failed: ${error?.stack ?? error}`);
} finally {
	try {
		writeFileSync(join(OUT, "app.log"), log.join(""));
	} catch {
		/* best effort */
	}
	report.navigations = navigations;
	writeFileSync(
		join(OUT, "report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	reap();
	try {
		server.close();
	} catch {
		/* already closed */
	}
}

console.log(
	JSON.stringify({
		result: report.result,
		steps: report.steps.length,
		out: OUT,
	}),
);
process.exit(failures === 0 ? 0 : 1);
