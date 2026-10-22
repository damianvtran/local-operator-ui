#!/usr/bin/env node
/**
 * Built-app evidence for the two claims unit tests cannot make:
 *
 *   H1  a page visited in one app run is suggested in the NEXT run, from the
 *       persistent store, with no tab open on it;
 *   H2  search intent shows the DuckDuckGo row FIRST and highlighted, and Enter
 *       commits that search URL on the active tab.
 *
 * WHY A SIBLING OF `browser-chrome-s4b-probe.mjs` rather than another arm in it:
 * that probe owns S4b's geometry gate and already carries its own plan and rows.
 * The two-run profile is a different lifecycle (boot, stop, boot again against
 * the same `--user-data-dir`), so keeping it separate means the geometry matrix
 * is not put at risk by a new boot shape. The boot/CDP scaffolding is copied
 * from that probe deliberately: it is the proven isolation recipe (scratch
 * HOME/config/log/cwd, headless window mode, mock keychain, stripped CMUX_/LOP_
 * prefixes, whole process group reaped).
 *
 * Usage: node scripts/browser-history-search-probe.mjs --out <evidence dir>
 * Exit 0 only when every row is PASS.
 */
import { spawn } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_KEYCHAIN_SWITCH } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(join(ROOT, "package.json"));
const ELECTRON_BIN = requireFromRepo("electron");
const OUT = process.argv[process.argv.indexOf("--out") + 1];
if (!OUT || OUT.startsWith("--")) {
	console.error("[history-probe] --out <evidence dir> is required");
	process.exit(2);
}
const RUN = join(OUT, `run-${Date.now()}`);
mkdirSync(join(RUN, "frames"), { recursive: true });
const INDEX_TARGET = /\/index\.html(?:[?#].*)?$/;
const GITHUB_SEARCH_ROW = /Search DuckDuckGo for "github"/;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const rows = [];
const events = join(OUT, "events.jsonl");
function plan(id, claim) {
	rows.push({ id, claim, status: "pending", evidence: null });
}
function record(id, status, evidence) {
	const row = rows.find((entry) => entry.id === id);
	if (!row) throw new Error(`unknown row ${id}`);
	row.status = status;
	row.evidence = evidence;
	appendFileSync(
		events,
		`${JSON.stringify({ at: new Date().toISOString(), event: "row", id, status, evidence })}\n`,
	);
}
function pass(id, evidence) {
	record(id, evidence.ok ? "PASS" : "FAIL", evidence);
}

// ---- CDP -------------------------------------------------------------------

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
	send(method, params = {}, timeoutMs = 20_000) {
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
async function waitForTarget(port, predicate, timeoutMs = 25_000) {
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
async function evaluate(cdp, expression) {
	const result = await cdp.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
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

// ---- fixture page ----------------------------------------------------------

let pageServer = null;
let fixtureUrl = "";
async function startFixturePage() {
	pageServer = createHttpServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(
			"<!doctype html><html><head><title>History fixture</title></head><body><h1>History fixture</h1></body></html>",
		);
	});
	await new Promise((done) => pageServer.listen(0, "127.0.0.1", done));
	const base = `http://127.0.0.1:${pageServer.address().port}`;
	fixtureUrl = `${base}/history-target`;
	return { fixtureUrl, host: `127.0.0.1:${pageServer.address().port}` };
}

// ---- boot ------------------------------------------------------------------

function freePort() {
	return new Promise((done, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port;
			server.close(() => done(port));
		});
	});
}

/**
 * One app run. `profile` is the SAME directory across both runs (that is the
 * cross-session claim); everything else is fresh per run so a stale singleton
 * lock or config cannot leak between them.
 */
async function boot({ profile, label }) {
	const home = join(RUN, label, "home");
	const config = join(RUN, label, "config");
	const logs = join(RUN, label, "logs");
	const cwd = join(RUN, label, "cwd");
	mkdirSync(profile, { recursive: true });
	for (const dir of [home, config, logs, cwd])
		mkdirSync(dir, { recursive: true });
	const deadPort = await freePort();
	writeFileSync(
		join(cwd, ".env"),
		`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${deadPort}\nVITE_DISABLE_BACKEND_MANAGER=true\n`,
	);
	const port = await freePort();
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
	const child = spawn(
		ELECTRON_BIN,
		[
			ROOT,
			`--user-data-dir=${profile}`,
			`--remote-debugging-port=${port}`,
			"--window-mode=headless",
			"--window-size=1380x900",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			"--disable-background-timer-throttling",
			MOCK_KEYCHAIN_SWITCH,
		],
		{ env, cwd, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	const logPath = join(RUN, `${label}.log`);
	const stream = [];
	const write = () => {
		if (stream.length === 0) return;
		appendFileSync(logPath, stream.join(""));
		stream.length = 0;
	};
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const timer = setInterval(write, 250);
	const exited = new Promise((done) => {
		child.once("exit", (code, signal) => {
			clearInterval(timer);
			write();
			done({ code, signal });
		});
	});
	return {
		port,
		child,
		exited,
		async stop() {
			if (child.exitCode !== null) {
				clearInterval(timer);
				write();
				return { code: child.exitCode };
			}
			try {
				process.kill(-child.pid, "SIGTERM");
			} catch {
				child.kill("SIGTERM");
			}
			const result = await Promise.race([
				exited,
				sleep(10_000).then(() => ({ timeout: true })),
			]);
			if (result.timeout) {
				// Exact-process-group reap, as the S4b probe does: a leaked Electron
				// is a visible window on the operator's desktop.
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					child.kill("SIGKILL");
				}
			}
			return result;
		},
	};
}

// ---- driving ---------------------------------------------------------------

async function owner(cdp) {
	await evaluate(cdp, `location.hash = "#/browser"`);
	const ready = await waitFor(
		cdp,
		`!!document.querySelector('[data-tour-tag="browser-tab-strip"]') && !!window.api?.browser`,
		35_000,
	);
	if (!ready) {
		throw new Error(
			`browser surface did not mount: ${JSON.stringify(
				await evaluate(
					cdp,
					"({ hash: location.hash, title: document.title, api: !!window.api?.browser, text: document.body.innerText.slice(0, 300) })",
				),
			)}`,
		);
	}
	// The chord door needs a DOM owner inside the surface.
	await evaluate(
		cdp,
		`(() => {
			const el = document.querySelector('[data-tour-tag="browser-address-trigger"]');
			if (el) el.focus({ preventScroll: true });
		})()`,
	);
}

const sendKey = (cdp, type, key, code, modifiers = 0) =>
	cdp.send("Input.dispatchKeyEvent", {
		type,
		key,
		code,
		modifiers,
		windowsVirtualKeyCode: key === "l" ? 76 : key === "a" ? 65 : 0,
		nativeVirtualKeyCode: key === "l" ? 76 : key === "a" ? 65 : 0,
	});

async function press(cdp, key, code, modifiers = 0) {
	await sendKey(cdp, "keyDown", key, code, modifiers);
	await sendKey(cdp, "keyUp", key, code, modifiers);
}

async function raise(cdp) {
	await press(cdp, "l", "KeyL", 4);
	return waitFor(
		cdp,
		`!!document.querySelector('[data-tour-tag="browser-address-popout"]')`,
		5_000,
	);
}

/**
 * Replace the field's text with a REAL input event.
 *
 * WHY NOT Cmd+A + Input.insertText: the app's chord router owns Cmd+A while the
 * popout is raised, so the selection never reached the input and the typed text
 * appended to the live URL (measured: `127.0.0.1:54102github`). React's
 * controlled input needs its own value property setter before the event, which
 * is exactly what a paste/typing dispatcher does.
 */
async function typeInField(cdp, text) {
	await evaluate(
		cdp,
		`(() => {
			const input = document.querySelector('[data-tour-tag="browser-address"]');
			if (!input) throw new Error('no address input');
			input.focus({ preventScroll: true });
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			).set;
			setter.call(input, ${JSON.stringify(text)});
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return input.value;
		})()`,
	);
}

function rowsFacts(cdp) {
	return evaluate(
		cdp,
		`(() => {
			const input = document.querySelector('[data-tour-tag="browser-address"]');
			const options = [...document.querySelectorAll('[data-address-suggestion]')];
			const active = input?.getAttribute('aria-activedescendant') ?? null;
			return {
				value: input?.value ?? null,
				active,
				rows: options.map((row) => ({
					id: row.id,
					text: row.textContent,
					url: row.getAttribute('data-address-suggestion-url'),
					search: row.getAttribute('data-address-suggestion-search') === 'true',
					selected: row.getAttribute('aria-selected') === 'true',
				})),
			};
		})()`,
	);
}

async function shot(cdp, name) {
	const result = await cdp.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(RUN, "frames", name), Buffer.from(result.data, "base64"));
}

// ---- plan ------------------------------------------------------------------

plan("H1", "a previous run's visit is suggested with no tab open on it");
plan("H2", 'typing "github" puts the Search DuckDuckGo row first and selected');
plan(
	"H3",
	'"what is a vpn" shows the search row and Enter commits its DuckDuckGo URL',
);
plan("H4", "the overlay child paints the same rows the owner listbox holds");

// ---- main ------------------------------------------------------------------

let first = null;
let second = null;
const profile = join(RUN, "profile");
try {
	const fixture = await startFixturePage();
	const runOne = await boot({ profile, label: "run-1" });
	first = runOne;
	const ownerOne = await waitForTarget(
		runOne.port,
		(t) => t.type === "page" && INDEX_TARGET.test(t.url),
	);
	const cdpOne = await connect(ownerOne.webSocketDebuggerUrl);
	await owner(cdpOne);
	// A fresh app's only tab is the START PAGE, which has its own field and no
	// popout by design. Open a real page first, through the user-facing API, so
	// the visit is recorded and run 2 has a real surface to raise.
	await evaluate(
		cdpOne,
		`(async () => {
			await window.api.browser.newTab();
			const state = await window.api.browser.state();
			await window.api.browser.navigate(${JSON.stringify(fixture.fixtureUrl)}, state.activeTabId);
		})()`,
	);
	const navigated = await waitFor(
		cdpOne,
		`(async () => {
			const state = await window.api.browser.state();
			const tab = state.tabs.find((entry) => entry.tabId === state.activeTabId);
			return tab?.url === ${JSON.stringify(fixture.fixtureUrl)} && !state.loading;
		})()`,
		20_000,
	);
	if (!navigated) throw new Error("run 1: fixture page did not commit");
	// Give the store's 500 ms debounce and the title event time to land; the
	// quit path also flushes, but this makes the second run independent of that.
	await sleep(1_500);
	// Close the tab so run 2 cannot offer it as an OPEN TAB. The history row is
	// then the only possible source.
	await evaluate(
		cdpOne,
		`(async () => {
			const state = await window.api.browser.state();
			const tabId = state.activeTabId;
			await window.api.browser.newTab();
			await window.api.browser.closeTab(tabId);
		})()`,
	);
	await sleep(500);
	const stoppedOne = await runOne.stop();
	first = null;
	cdpOne.close();

	const runTwo = await boot({ profile, label: "run-2" });
	second = runTwo;
	const ownerTwo = await waitForTarget(
		runTwo.port,
		(t) => t.type === "page" && INDEX_TARGET.test(t.url),
	);
	const cdpTwo = await connect(ownerTwo.webSocketDebuggerUrl);
	await owner(cdpTwo);
	// A DIFFERENT page on the same host keeps the popout available while leaving
	// the visited URL unopened, which is what makes H1 a history claim rather
	// than a live-tab claim.
	const otherUrl = `${fixture.fixtureUrl}-other`;
	await evaluate(
		cdpTwo,
		`(async () => {
			await window.api.browser.newTab();
			const state = await window.api.browser.state();
			await window.api.browser.navigate(${JSON.stringify(otherUrl)}, state.activeTabId);
		})()`,
	);
	await waitFor(
		cdpTwo,
		"(async () => !(await window.api.browser.state()).loading)()",
		15_000,
	);
	await sleep(300);
	const stateBefore = await evaluate(cdpTwo, "window.api.browser.state()");
	const openOnFixture = (stateBefore.tabs ?? []).some(
		(tab) => tab.url === fixture.fixtureUrl,
	);
	if (!(await raise(cdpTwo))) throw new Error("run 2: popout did not raise");

	// H1: a prefix of the host is a URL intent, so the history row is the first
	// candidate and there must be no search row.
	await typeInField(cdpTwo, fixture.host);
	await waitFor(
		cdpTwo,
		`document.querySelectorAll('[data-address-suggestion]').length > 0`,
		8_000,
	);
	const historyRows = await rowsFacts(cdpTwo);
	await shot(cdpTwo, "h1-history-row.png");
	pass("H1", {
		ok:
			!openOnFixture &&
			historyRows.rows.some(
				(row) => row.url === fixture.fixtureUrl && !row.search,
			),
		stoppedOne,
		openOnFixture,
		query: fixture.host,
		rows: historyRows,
	});

	// H2: single word, no dot -> search intent, search row first and selected.
	await typeInField(cdpTwo, "github");
	await waitFor(
		cdpTwo,
		`/Search DuckDuckGo/.test(document.querySelector('[data-address-suggestion]')?.textContent ?? '')`,
		8_000,
	);
	const searchRows = await rowsFacts(cdpTwo);
	await shot(cdpTwo, "h2-search-row.png");
	pass("H2", {
		ok:
			searchRows.rows[0]?.search === true &&
			/Search DuckDuckGo for "github"/.test(searchRows.rows[0]?.text ?? "") &&
			searchRows.active === searchRows.rows[0]?.id,
		rows: searchRows,
	});

	// H4: the native child paints the SAME row the owner's listbox holds. Taken
	// while the search row is current, so the claim is about these rows rather
	// than about the child being non-empty at some point.
	const childTarget = await waitForTarget(
		runTwo.port,
		(t) => t.url.endsWith("browser-address-overlay-list.html"),
		8_000,
	).catch(() => null);
	const childRows = childTarget
		? await (async () => {
				const childCdp = await connect(childTarget.webSocketDebuggerUrl);
				// The mirror is an IPC round trip behind the owner's render, so poll
				// the child for the CURRENT row rather than sampling the previous frame.
				const updated = await waitFor(
					childCdp,
					`/Search DuckDuckGo/.test(document.querySelector('#address-list-rows')?.textContent ?? '')`,
					5_000,
				);
				const facts = await evaluate(
					childCdp,
					`(() => ({
						updated: ${JSON.stringify(updated)},
						header: document.querySelector('#address-list-label')?.textContent ?? null,
						rows: [...document.querySelectorAll('#address-list-rows > *')].map((row) => row.textContent),
					}))()`,
				);
				await shot(childCdp, "h4-child-rows.png");
				childCdp.close();
				return facts;
			})()
		: null;
	pass("H4", {
		ok:
			childRows?.updated === true &&
			childRows.header === "From your history" &&
			childRows.rows.some((row) => GITHUB_SEARCH_ROW.test(row)),
		child: childRows,
	});

	// H3: the operator's wording, then Enter. The assertion is on the COMMITTED
	// URL, not the page body: the sandbox may have no network to DuckDuckGo.
	await typeInField(cdpTwo, "what is a vpn");
	await waitFor(
		cdpTwo,
		`/Search DuckDuckGo/.test(document.querySelector('[data-address-suggestion]')?.textContent ?? '')`,
		8_000,
	);
	const vpnRows = await rowsFacts(cdpTwo);
	await press(cdpTwo, "Enter", "Enter");
	const committed = await waitFor(
		cdpTwo,
		`(async () => {
			const state = await window.api.browser.state();
			const tab = state.tabs.find((entry) => entry.tabId === state.activeTabId);
			return (tab?.url ?? '').startsWith('https://duckduckgo.com/?q=');
		})()`,
		20_000,
	);
	const stateAfter = await evaluate(cdpTwo, "window.api.browser.state()");
	const activeUrl =
		stateAfter.tabs.find((tab) => tab.tabId === stateAfter.activeTabId)?.url ??
		null;
	await shot(cdpTwo, "h3-search-committed.png");
	pass("H3", {
		ok:
			committed &&
			activeUrl ===
				`https://duckduckgo.com/?q=${encodeURIComponent("what is a vpn")}`,
		rows: vpnRows,
		activeUrl,
	});

	cdpTwo.close();
} catch (error) {
	console.error(`[history-probe] ${String(error)}`);
	for (const row of rows) {
		if (row.status === "pending") record(row.id, "BLOCKED", String(error));
	}
} finally {
	if (first) await first.stop().catch(() => {});
	if (second) await second.stop().catch(() => {});
	if (pageServer) await new Promise((done) => pageServer.close(done));
	for (const row of rows) {
		if (row.status === "pending") record(row.id, "BLOCKED", "not reached");
	}
	writeFileSync(
		join(OUT, "history-search-rows.json"),
		`${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
	);
	const failed = rows.some((row) => row.status !== "PASS");
	console.log(
		rows.map((row) => `${row.status} ${row.id} ${row.claim}`).join("\n"),
	);
	console.log(
		`[history-probe] ${failed ? "FAIL" : "PASS"} — ${join(OUT, "history-search-rows.json")}`,
	);
	process.exitCode = failed ? 1 : 0;
}
