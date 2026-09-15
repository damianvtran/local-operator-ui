#!/usr/bin/env node
/**
 * Frames from the REAL app for the daemon-attach work.
 *
 *     node scripts/attach-frame-evidence.mjs --out <dir> --label <tree> [--scene <name>]
 *
 * WHY this exists beside `attach-robustness-evidence.mjs`. That rig drives the
 * app's main-process modules and prints what they observed. What it cannot show
 * is the surface the operator reported on: the renderer, in the window, saying
 * the server was unavailable while the server answered. So this boots the BUILT
 * app in the documented `headless` mode, drives it over CDP, and writes the
 * frames - the renderer's own view of the connection, at a labelled viewport.
 *
 * Three scenes, each one a symptom or a control:
 *
 *   1. `attached` - a real `lop serve` with a seeded conversation. Cell: the
 *      conversation list loads and nothing claims the server is away.
 *   2. `unattachable` - a Local Operator daemon answering the configured
 *      address that this app holds no credential for, with no serve record
 *      describing it. Cells: the honest copy (which the base tree does not say
 *      at all) and the app not starting a second daemon over it.
 *   3. `flap` - the same daemon, attached, whose `/health` then exceeds one
 *      probe's budget while its session reads keep answering. Cell: the
 *      conversation list holds. This is the operator's own condition, modelled.
 *
 * Everything is isolated: a throwaway HOME, config dir, `--user-data-dir` and
 * ports, an allowlisted environment, and `VITE_DISABLE_BACKEND_MANAGER=true` so
 * this app can never spawn a backend of its own on the operator's machine. The
 * window is never shown, and `LOCAL_OPERATOR_NO_NOTIFICATIONS=1` /
 * `LOCAL_OPERATOR_NO_TERMINAL_TITLE=1` go to every child: this runs on the
 * operator's desktop while they work.
 *
 * The first-run provider modal is stepped past by seeding the app's own
 * `onboarding-storage` in localStorage and reloading, which is the same key the
 * app's own store persists to. The alternative - configuring a provider in the
 * scratch daemon - is a bigger change to what these frames are about, and a
 * scene that cannot see the conversation list cannot say anything about it.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const argValue = (name, fallback = null) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};
const OUT = argValue("--out");
const LABEL = argValue("--label", "tree");
const ONLY = argValue("--scene", "all");
if (!OUT) {
	console.error(
		"usage: attach-frame-evidence.mjs --out <dir> --label <tree> [--scene attached|unattachable|flap|all]",
	);
	process.exit(1);
}
const WIDTH = Number(process.env.ATTACH_FRAME_WIDTH ?? 1380);
const HEIGHT = Number(process.env.ATTACH_FRAME_HEIGHT ?? 900);
mkdirSync(OUT, { recursive: true });

const ROOT = mkdtempSync(join(tmpdir(), "lop-ui-frame-evidence-"));
const SESSION_ID = "f".repeat(12);
const SESSION_TITLE = "Frame evidence conversation";
const CLAIM_KEY = "a".repeat(64);

const inherited = new Set([
	"PATH",
	"PATHEXT",
	"SystemRoot",
	"ComSpec",
	"TMPDIR",
	"TEMP",
	"TMP",
	"LANG",
	"LC_ALL",
	"TERM",
]);
const baseEnv = {};
for (const [name, value] of Object.entries(process.env)) {
	if (inherited.has(name)) baseEnv[name] = value;
}
const childEnv = (configDir, apiUrl, { manager = false } = {}) => ({
	...baseEnv,
	HOME: ROOT,
	LOCAL_OPERATOR_CONFIG_DIR: configDir,
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
	VITE_LOCAL_OPERATOR_API_URL: apiUrl,
	/*
	 * Off unless a scene is specifically about the spawn path.
	 *
	 * `attached` and `flap` attach to a daemon that is already there, and the app
	 * must not start one of its own on the operator's machine while they do it.
	 * `unattachable` is the exception and says so at its own call site: the state
	 * that scene is about is produced by the spawn gate, and a gate that is never
	 * reached produces nothing.
	 */
	VITE_DISABLE_BACKEND_MANAGER: manager ? "false" : "true",
});

const children = [];
function launch(command, args, env) {
	const child = spawn(command, args, {
		cwd: REPO,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	let output = "";
	child.stdout.on("data", (data) => {
		output += data;
	});
	child.stderr.on("data", (data) => {
		output += data;
	});
	return { child, text: () => output };
}

async function stop(entry) {
	const child = entry?.child ?? entry;
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await new Promise((resolve) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			resolve();
		}, 5_000);
		child.on("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The APP's page target, out of everything the debug port lists.
 *
 * `/json/list` is not one entry: Electron's own internals are listed beside the
 * window, and this rig's first run picked an `about:blank` one - a 0x0 viewport,
 * an empty body and a capture that never came back, which reads exactly like the
 * app failing to paint.
 */
async function findPage(debugPort) {
	const list = await (
		await fetch(`http://127.0.0.1:${debugPort}/json/list`)
	).json();
	const pages = list.filter(
		(target) => target.type === "page" && target.webSocketDebuggerUrl,
	);
	const page = pages.find(
		(target) => !/^(about:blank|devtools:|chrome:)/.test(target.url ?? ""),
	);
	if (!page)
		throw new Error(
			`no app page target; saw ${JSON.stringify(pages.map((t) => t.url))}`,
		);
	return page;
}

/** One CDP request over the page's own socket, then close it. */
async function withPage(debugPort, call) {
	const page = await findPage(debugPort);
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	try {
		return await call(socket);
	} finally {
		socket.close();
	}
}

async function evaluate(debugPort, expression) {
	return withPage(debugPort, (socket) => {
		const result = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("evaluate timed out")), 20_000);
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id !== 1) return;
				clearTimeout(timer);
				if (message.error) reject(new Error(JSON.stringify(message.error)));
				else if (message.result?.result?.value === undefined)
					/*
					 * An expression evaluated against a navigation still in flight answers
					 * nothing at all - there is no page context to answer with yet. That is
					 * the same fact as an error, so it is raised the same way and the
					 * callers' own waits retry it: returning undefined silently is what
					 * made this rig's first scene fail on `JSON.parse("undefined")`.
					 */
					reject(new Error("the page answered nothing: no context yet"));
				else resolve(message.result.result.value);
			});
		});
		socket.send(
			JSON.stringify({
				id: 1,
				method: "Runtime.evaluate",
				params: { expression, returnByValue: true, awaitPromise: true },
			}),
		);
		return result;
	});
}

/**
 * Photograph the window, retrying the attempt a reload can swallow.
 *
 * A capture issued while the page is navigating answers nothing and surfaces as
 * a timeout - measured on this rig's flap scene, whose capture follows the
 * onboarding reload. Retried rather than waited out, because the second attempt
 * is one the page can answer.
 */
async function capture(debugPort, path, attempts = 3) {
	let last = null;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await captureOnce(debugPort, path);
		} catch (error) {
			last = error;
			await wait(2_000);
		}
	}
	throw last;
}

async function captureOnce(debugPort, path) {
	const data = await withPage(debugPort, (socket) => {
		const result = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("capture timed out")), 15_000);
			const send = (id, method, params) =>
				socket.send(JSON.stringify({ id, method, params }));
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id === 1) {
					// `fromSurface` is the default and is written out because it is the
					// reason a never-shown window still yields a complete frame.
					send(2, "Page.captureScreenshot", {
						format: "png",
						fromSurface: true,
						captureBeyondViewport: false,
					});
					return;
				}
				if (message.id !== 2) return;
				clearTimeout(timer);
				if (message.error) reject(new Error(JSON.stringify(message.error)));
				else resolve(message.result.data);
			});
			send(1, "Page.enable", {});
		});
		return result;
	});
	writeFileSync(path, Buffer.from(data, "base64"));
}

/**
 * The app's view of the connection, read from the page.
 *
 * The banner is read by ROLE, not by class: it is the app's own alert surface,
 * and a selector this rig invented would be a claim about the DOM rather than
 * about what a reader sees.
 */
const READ_PAGE = `(async () => {
	const banner = document.querySelector('[role="alert"]');
	/*
	 * The seeded conversation as the sidebar actually renders it: its row title
	 * is derived from the transcript's own first row, so this reads the app's own
	 * text rather than a selector this rig invented. A data-session-id attribute
	 * was the first attempt and reads zero on a sidebar that is fully populated -
	 * no row carries one - which is how this rig first reported "no sessions"
	 * over a daemon that was serving one.
	 */
	const seededRow = /\\[row 0000\\]/.test(document.body.innerText);
	const text = document.body.innerText;
	const composer = document.querySelector('textarea, [contenteditable="true"]');
	/*
	 * Main's own answer, read through the app's preload bridge. It is here because
	 * it is the whole question this evidence turns on - "what does the app believe
	 * about the connection" - and reading the renderer's copy of it is the only
	 * way to show the two agreeing rather than assume it.
	 */
	let snapshot = null;
	try {
		snapshot = await window.api?.backend?.getStatus?.();
	} catch (error) {
		snapshot = String(error);
	}
	return JSON.stringify({
		viewport: window.innerWidth + "x" + window.innerHeight,
		dpr: window.devicePixelRatio,
		banner: banner ? banner.innerText.replace(/\\s+/g, " ").trim() : null,
		seeded_row_visible: seededRow,
		composer_present: Boolean(composer),
		snapshot: snapshot && typeof snapshot === "object"
			? { state: snapshot.state, reachable: undefined, url: snapshot.url, pid: snapshot.pid, owned: snapshot.owned, unanswered: snapshot.unanswered, detail: snapshot.detail }
			: snapshot,
		first_lines: text.split("\\n").filter(Boolean).slice(0, 14),
	});
})()`;

/** Read the page, retrying a read that lands in the middle of a reload. */
async function readPage(debugPort, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			return JSON.parse(await evaluate(debugPort, READ_PAGE));
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await wait(500);
		}
	}
}

/** Step past the first-run provider modal, the way the app's own store does. */
async function seedOnboarding(debugPort) {
	const seed = `(() => {
		localStorage.setItem("onboarding-storage", JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" },
			version: 0,
		}));
		/*
		 * The sidebar's own disclosure persistence, written the way the sidebar
		 * writes it, because "Previous chats" is COLLAPSED by default: a scene that
		 * leaves it closed photographs a header and cannot say anything about a
		 * conversation list, which is exactly how this rig's first run reported "no
		 * sessions" over a daemon that was serving them.
		 */
		localStorage.setItem("chat-sidebar-disclosures", JSON.stringify({ previous: true }));
		location.reload();
		return "seeded";
	})()`;
	await evaluate(debugPort, seed);
}

/** Wait until the app's page answers, or fail rather than hang. */
async function waitForPage(debugPort, timeoutMs = 90_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			return JSON.parse(await evaluate(debugPort, READ_PAGE));
		} catch {
			/* the debugger or the app is not up yet */
		}
		await wait(1_000);
	}
	throw new Error("the app's page never became readable over CDP");
}

/** Boot the app against a URL and return its debug port once it has painted. */
async function bootApp(name, apiUrl, configDir, debugPort, options) {
	const app = launch(
		"node_modules/.bin/electron",
		[
			".",
			`--remote-debugging-port=${debugPort}`,
			`--user-data-dir=${join(ROOT, `profile-${name}`)}`,
			`--window-size=${WIDTH}x${HEIGHT}`,
		],
		childEnv(configDir, apiUrl, options),
	);
	const first = await waitForPage(debugPort);	// The seed lands after the first paint and reloads, so the second read is the
	// app as a returning user rather than the onboarding one.
	if (!first.composer_present || first.first_lines.includes("Connect a provider"))
		await seedOnboarding(debugPort);
	// The reload has to finish painting before anything reads the page again.
	await wait(3_000);
	return app;
}

/** A Local Operator daemon answering at `port`, without a serve record. */
function stubDaemon(port, state) {
	const server = createServer((request, response) => {
		const path = (request.url ?? "").split("?")[0];
		const json = (status, body) => {
			response.writeHead(status, { "Content-Type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (path === "/health") {
			const answer = () =>
				json(200, {
					status: 200,
					result: {
						version: "0.55.6",
						instance_id: "frame-evidence-stub",
						pid: process.pid,
						prefix: "/tmp/frame-evidence-prefix",
						install_kind: "uv-tool",
					},
				});
			// THE flap: the probe's 2 s budget expires while everything else answers.
			if (state.slowHealth) setTimeout(answer, state.healthDelayMs);
			else answer();
			return;
		}
		if (path === "/v1/capabilities") {
			json(200, { status: 200, result: { desktop_available: true } });
			return;
		}
		if (path === "/v1/desktop/claim") {
			json(200, { status: 200 });
			return;
		}
		if (path === "/v1/desktop/sessions") {
			state.reads.push(Date.now());
			json(200, {
				status: 200,
				message: "Desktop session result.",
				result: {
					sessions: [
						{
							id: SESSION_ID,
							name: SESSION_TITLE,
							mtime: Math.floor(Date.now() / 1000) - 60,
							cwd: "~",
						},
					],
					truncated: false,
					limit: 500,
				},
			});
			return;
		}
		if (path.endsWith("/events")) {
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			response.end();
			return;
		}
		if (path === "/v1/auth/providers" || path === "/v1/auth/status") {
			json(200, { status: 200, result: { providers: [], accounts: [] } });
			return;
		}
		json(404, { detail: "not part of this rig" });
	});
	server.listen(port, "127.0.0.1");
	return server;
}

/** Keep a hand-written record fresh: a stale heartbeat reads as `wedged`. */
function writeRecord(runDir, port, pid) {
	const file = join(runDir, `${pid}.json`);
	const now = Date.now() / 1000;
	let started = now - 10;
	try {
		started = JSON.parse(readFileSync(file, "utf8")).started_at;
	} catch {
		/* first write */
	}
	writeFileSync(
		file,
		JSON.stringify({
			pid,
			host: "127.0.0.1",
			port,
			instance_id: "frame-evidence-stub",
			version: "0.55.6",
			source_ref: "",
			prefix: "/tmp/frame-evidence-prefix",
			install_kind: "uv-tool",
			desktop: false,
			claim_key: CLAIM_KEY,
			started_at: started,
			heartbeat_at: now,
		}),
		{ mode: 0o600 },
	);
	return setInterval(() => writeRecord(runDir, port, pid), 5_000);
}

const summary = { label: LABEL, scenes: {} };

async function sceneAttached() {
	const configDir = join(ROOT, "config-attached");
	mkdirSync(configDir, { recursive: true });
	// A real conversation for the sidebar, written by the repository's own seeder.
	const seeder = launch(
		process.execPath,
		["scripts/seed-paging-session.mjs", configDir, "40"],
		baseEnv,
	);
	await new Promise((resolve) => seeder.child.on("exit", resolve));

	const port = 46110;
	const daemon = launch(
		"lop",
		["serve", "--port", String(port)],
		childEnv(configDir, `http://127.0.0.1:${port}`),
	);
	const recordFile = join(configDir, "run", "serve", `${daemon.child.pid}.json`);
	const deadline = Date.now() + 60_000;
	while (!existsSync(recordFile) && Date.now() < deadline) await wait(250);
	if (!existsSync(recordFile)) throw new Error(`no serve record: ${daemon.text()}`);
	await bootApp(
		"attached",
		`http://127.0.0.1:${port}`,
		configDir,
		46111,
	);
	// The list is fed by the app's own poll; wait for the row it must render.
	let page = null;
	const attachedDeadline = Date.now() + 60_000;
	while (Date.now() < attachedDeadline) {
		page = await readPage(46111);
		if (page.seeded_row_visible) break;
		await wait(1_000);
	}
	await capture(46111, join(OUT, `${LABEL}-attached.png`));
	summary.scenes.attached = page;
	await stop(daemon);
	return page;
}

async function sceneUnattachable() {
	const port = 46120;
	const state = { slowHealth: false, healthDelayMs: 3_500, reads: [], requests: [] };
	const server = stubDaemon(port, state);
	// Its own config root with NO record: the address answers, and nothing
	// describes it - the 09:17 shape.
	const configDir = join(ROOT, "config-unattachable");
	mkdirSync(configDir, { recursive: true });
	await bootApp(
		"unattachable",
		`http://127.0.0.1:${port}`,
		configDir,
		46121,
		{ manager: true },
	);
	// Let main run its discovery pass and settle the state it publishes.
	let page = null;
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		page = await readPage(46121);
		if (page.banner) break;
		await wait(1_000);
	}
	await capture(46121, join(OUT, `${LABEL}-unattachable.png`));
	summary.scenes.unattachable = page;
	server.close();
	return page;
}

async function sceneFlap() {
	const port = 46130;
	const configDir = join(ROOT, "config-flap");
	const runDir = join(configDir, "run", "serve");
	mkdirSync(runDir, { recursive: true });
	const state = { slowHealth: false, healthDelayMs: 3_500, reads: [], requests: [] };
	const server = stubDaemon(port, state);
	// A record this time, so the app ATTACHES to the stub: the flap is a change in
	// what the probes can read on a connection that is otherwise fine.
	const heartbeat = writeRecord(runDir, port, process.pid);
	await bootApp("flap", `http://127.0.0.1:${port}`, configDir, 46131);

	let page = null;
	const attachedDeadline = Date.now() + 60_000;
	while (Date.now() < attachedDeadline) {
		page = await readPage(46131);
		if (page.seeded_row_visible) break;
		await wait(1_000);
	}
	await capture(46131, join(OUT, `${LABEL}-flap-before.png`));
	const before = page;

	// The daemon goes busy: every probe now expires, every read still answers.
	state.slowHealth = true;
	state.reads.length = 0;
	// Four probe intervals at the app's own cadence, so the base tree's third
	// tick is inside this window and the head tree's counter is exercised too.
	await wait(32_000);
	const during = await readPage(46131);
	await capture(46131, join(OUT, `${LABEL}-flap-during.png`));
	summary.scenes.flap = {
		before,
		during,
		reads_answered: state.reads.length,
	};
	clearInterval(heartbeat);
	server.close();
}

const scenes = {
	attached: sceneAttached,
	unattachable: sceneUnattachable,
	flap: sceneFlap,
};

try {
	console.log(`# ${LABEL}: app frames, root ${ROOT}`);
	for (const [name, run] of Object.entries(scenes)) {
		if (ONLY !== "all" && ONLY !== name) continue;
		console.log(`# scene ${name}`);
		try {
			await run();
			console.log(`# scene ${name} done`);
		} catch (error) {
			// A scene that fails keeps what the others produced and says so: this
			// rig's frame evidence is read scene by scene, and losing three scenes
			// because the fourth threw is how a run reports nothing at all.
			summary.scenes[name] = { error: String(error) };
			console.log(`# scene ${name} FAILED: ${error}`);
		}
	}
} finally {
	for (const child of children) await stop(child);
	writeFileSync(
		join(OUT, `${LABEL}-frames.json`),
		JSON.stringify(summary, null, 2),
	);
	const logFile = join(
		ROOT,
		"Library",
		"Application Support",
		"Local Operator",
		"logs",
		"backend-service.log",
	);
	if (existsSync(logFile)) {
		writeFileSync(join(OUT, `${LABEL}-backend-service.log`), readFileSync(logFile));
	}
	rmSync(ROOT, { recursive: true, force: true });
}
