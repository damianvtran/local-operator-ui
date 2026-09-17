#!/usr/bin/env node
/**
 * The shell's two full-bleed bands, at every height they can take: frames from
 * the BUILT app, and the geometry those frames are a picture of.
 *
 *     node scripts/band-occlusion-evidence.mjs --out <dir> --label <tree>
 *
 * WHY THIS EXISTS. The bands are the only surfaces in this app that are pinned
 * to the top of the WINDOW rather than to the layout, and the defect D9 records
 * is that a pinned band makes the rows it covers ABSENT rather than displaced: on
 * `main` the chat pane's own title, the sidebar search field's top border and
 * rounded corners, and (daemon-absent) half of the placeholder's glyphs are not
 * moved when a band appears - they are gone. A frame shows that, and only a
 * frame does; the numbers below are what turn "looks right" into an assertion,
 * because the difference between an in-flow band and a reserving inset is a
 * HEIGHT, and a still cannot be measured by eye.
 *
 * WHAT IT DRIVES, and why the states are these four. Nothing in the app can
 * force a band on: the connectivity band is MAIN's daemon status and the
 * compatibility band is the backend's own capabilities answer, so a rig that
 * wants a band up has to BE the backend. This one is a stub daemon whose
 * `/health`, `/v1/capabilities` and serve record the app really reads, which is
 * the same instrument `docs/evidence/daemon-attach-live-app/` used for the
 * frames the D9 brief measures - and it is why the four states are reachable in
 * one boot, in this order:
 *
 *   1. `none`      attached, every required capability advertised -> no band at
 *                  all. The control: it is what proves an in-flow band costs the
 *                  layout nothing when it is not up.
 *   2. `one-line`  the same attached daemon withdraws six of the seven required
 *                  features -> the compatibility band alone (52 CSS px).
 *   3. `two-line`  the record goes and `/health` stops answering while the
 *                  capability answer stays complete -> the connectivity band
 *                  alone, with main's own second line (67 CSS px).
 *   4. `two-bands` the capability answer narrows too -> BOTH bands up at once,
 *                  which is the case a reserving inset would have to measure and
 *                  sum, and the case that decides this change's shape.
 *
 * EVERYTHING IS ISOLATED: a throwaway HOME, config dir, `--user-data-dir` and
 * ports, an allowlisted environment, and `VITE_DISABLE_BACKEND_MANAGER=true` so
 * this app can never spawn a backend of the operator's machine. The window is
 * never shown (`headless`), and the rig asserts the app's own `[window-mode]`
 * line rather than trusting the variable it set. Notifications are off through
 * the shared helper (`scripts/notifications-off.mjs`), and `CMUX_*`/`LOP_*` are
 * stripped: an inherited workspace id has already renamed the operator's real
 * cmux workspaces from a test run in this repository.
 *
 * WHAT IT CANNOT PROVE. It is a stub backend, so these frames are evidence about
 * the renderer and the shell they describe, not about main's daemon state machine
 * (`scripts/daemon-health-state.test.mjs` and `scripts/daemon-discovery-evidence.mjs`
 * own that half). `headless` is a never-shown window, so `:focus` and carets
 * render as they do for nobody (AGENTS.md, "headless is a full-fidelity rendering
 * path"); nothing here is about focus. And a frame is not a reflow: the
 * before/after pair is a still of a state, so what this cannot show is the
 * MOTION a band appearing causes - that is why each state's frame is paired with
 * its rects rather than judged on its own.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withNotificationsOff } from "./notifications-off.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const argValue = (name, fallback = null) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

const OUT = argValue("--out");
const LABEL = argValue("--label", "tree");
if (!OUT) {
	console.error(
		"usage: band-occlusion-evidence.mjs --out <dir> --label <tree> [--port <n>] [--window-size WxH]",
	);
	process.exit(1);
}
const WIDTH = Number(
	(argValue("--window-size", "1380x900") || "").split("x")[0],
);
const HEIGHT = Number(
	(argValue("--window-size", "1380x900") || "").split("x")[1],
);
if (!Number.isFinite(WIDTH) || !Number.isFinite(HEIGHT)) {
	console.error('--window-size expects WxH (got "no parse")');
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });

/** The stub daemon's own port, and the app's debug port. */
const PORT = Number(argValue("--port", "46211"));
const DEBUG_PORT = PORT + 1;

const ROOT = mkdtempSync(join(tmpdir(), "lo-band-occlusion-"));
const CONFIG_DIR = join(ROOT, "config");
const RUN_DIR = join(CONFIG_DIR, "run", "serve");
mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
const PROFILE = join(ROOT, "profile");
const FRAMES = OUT;

/**
 * The seven features `BackendCompatibilityBanner` requires before it stands
 * down. Spelled out here rather than imported: the rig is deliberately a fact
 * about the SURFACE (this is what the app asked for, on the wire) rather than a
 * second reader of the component's own constant, and a run that imports the
 * constant would answer its own question.
 */
const COMPLETE_FEATURES = {
	auth: 1,
	settings: 1,
	commands: 1,
	catalogues: 1,
	lifecycle: 1,
	mcp: 1,
	radient: 1,
};
/**
 * The catalogue gate's own three, as the attach work's frames advertise them:
 * enough for the desktop plane to look half-negotiated, which is the state the
 * compatibility band exists to describe.
 */
const PARTIAL_FEATURES = {
	session_catalogue: 2,
	profile_catalogue: 1,
	team_catalogue: 1,
};
const CLAIM_KEY = "a".repeat(64);
/**
 * The credential a managed launch persists. Without it `requestDesktop` forces
 * `desktop_available: false` on the capabilities answer whatever the daemon
 * says, and the compatibility band becomes unavoidable - which is how a rig
 * photographs a state it cannot reach (see `attach-frame-evidence.mjs`'s own
 * account of QA's Q-3).
 */
const DESKTOP_TOKEN = "b".repeat(64);

/**
 * The rest of a healthy answer, so a scene shows an app talking to a server it
 * can use rather than a wall of 404s: `profile-hooks.ts` and the shell's own
 * stories fix these shapes.
 */
const STUB_CONFIG = {
	version: "0.12.8",
	metadata: {
		created_at: "2025-06-18T11:02:00Z",
		last_modified: "2026-09-15T00:00:00Z",
		description: "Band-occlusion frame rig",
	},
	values: {
		conversation_length: 100,
		detail_length: 15,
		max_learnings_history: 50,
		hosting: "openrouter",
		model_name: "anthropic/claude-sonnet-4",
		auto_save_conversation: true,
	},
};

/** A Local Operator daemon answering at `port`, on the wire the app really reads. */
function stubDaemon(port, state) {
	const server = createServer((request, response) => {
		const path = (request.url ?? "").split("?")[0];
		state.requests.push({ path, at: Date.now() });
		const json = (status, body) => {
			response.writeHead(status, { "Content-Type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (path === "/health") {
			json(200, {
				status: 200,
				result: {
					version: "0.55.6",
					instance_id: "band-occlusion-stub",
					pid: process.pid,
					prefix: "/tmp/band-occlusion-prefix",
					install_kind: "uv-tool",
				},
			});
			return;
		}
		if (path === "/v1/capabilities") {
			json(200, {
				status: 200,
				result: { desktop_available: true, features: state.features },
			});
			return;
		}
		if (path === "/v1/desktop/claim") {
			json(200, { status: 200 });
			return;
		}
		if (path === "/v1/config") {
			json(200, { status: 200, result: STUB_CONFIG });
			return;
		}
		if (path === "/v1/desktop/profiles") {
			json(200, { status: 200, result: { profiles: [] } });
			return;
		}
		if (path === "/v1/desktop/teams") {
			json(200, { status: 200, result: { teams: [] } });
			return;
		}
		if (path === "/v1/desktop/sessions") {
			json(200, {
				status: 200,
				message: "Desktop session result.",
				result: { sessions: [], truncated: false, limit: 500 },
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

/** The serve record a daemon publishes for itself; the app reads it to attach. */
function writeRecord(pid) {
	const file = join(RUN_DIR, `${pid}.json`);
	const now = Date.now() / 1000;
	writeFileSync(
		file,
		JSON.stringify({
			pid,
			host: "127.0.0.1",
			port: PORT,
			instance_id: "band-occlusion-stub",
			version: "0.55.6",
			source_ref: "",
			prefix: "/tmp/band-occlusion-prefix",
			install_kind: "uv-tool",
			desktop: false,
			claim_key: CLAIM_KEY,
			started_at: now - 10,
			heartbeat_at: now,
		}),
		{ mode: 0o600 },
	);
	return file;
}

/** `--user-data-dir` IS `app.getPath("userData")`, so the token belongs beside it. */
function seedDesktopToken() {
	mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
	writeFileSync(join(PROFILE, "desktop-token"), DESKTOP_TOKEN, { mode: 0o600 });
}

/**
 * The environment the app is launched with: nothing but what it needs, and every
 * path the app could write through redirected into this run's scratch tree.
 */
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
const appEnv = withNotificationsOff({
	...baseEnv,
	HOME: ROOT,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: join(ROOT, "logs"),
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
	VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PORT}`,
	/*
	 * The app must not start a daemon of its own on the operator's machine: this
	 * rig IS the daemon, and a second one would be a backend nobody asked for.
	 */
	VITE_DISABLE_BACKEND_MANAGER: "true",
});
for (const key of Object.keys(appEnv)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete appEnv[key];
}

const children = [];
/**
 * Launch the app the way the app is launched, in its own process group.
 *
 * `node_modules/.bin/electron` is a node SHIM whose CHILD is the real app, so a
 * signal to the pid this rig holds would kill the shim and leave the app running,
 * reparented to launchd, holding its debug port and this run's profile. `detached`
 * gives the shim its own group, which its children inherit, and the teardown
 * signals the GROUP.
 */
function launch() {
	const child = spawn(
		"node_modules/.bin/electron",
		[
			".",
			`--remote-debugging-port=${DEBUG_PORT}`,
			`--user-data-dir=${PROFILE}`,
			`--window-size=${WIDTH}x${HEIGHT}`,
		],
		{
			cwd: REPO,
			env: appEnv,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		},
	);
	let output = "";
	child.stdout.on("data", (data) => {
		output += data;
	});
	child.stderr.on("data", (data) => {
		output += data;
	});
	children.push(child);
	return { child, text: () => output };
}

async function stop(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	const killTree = (signal) => {
		try {
			process.kill(-child.pid, signal);
		} catch {
			try {
				child.kill(signal);
			} catch {
				/* already gone */
			}
		}
	};
	killTree("SIGTERM");
	await new Promise((resolve) => {
		const timer = setTimeout(() => {
			killTree("SIGKILL");
			resolve();
		}, 5_000);
		child.on("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

/**
 * The net under `stop`: reap anything still holding THIS run's scratch profile.
 *
 * The pattern is this run's own `mkdtemp` path, so it cannot match a process
 * anybody else owns - which is the property a `pkill -f electron` would need and
 * does not have (it takes the operator's own app with it).
 */
function reapScratchProfiles() {
	if (process.platform === "win32") return;
	try {
		const literal = ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		spawnSync("pkill", ["-f", `user-data-dir=${literal}`], { stdio: "ignore" });
	} catch {
		/* no pkill here, or nothing matched: the group kill already ran */
	}
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The page targets an Electron debug port lists that are NOT the app's own window:
 * Electron's internals sit beside the window, and a rig that picked one of them
 * reads a 0x0 viewport and an empty body (`attach-frame-evidence.mjs` records the
 * first run that did). Hoisted because `useTopLevelRegex` asks for it and because
 * this is asked on every CDP call.
 */
const NOT_APP_PAGE = /^(about:blank|devtools:|chrome:)/;
/** The APP's page target, out of everything the debug port lists. */
async function findPage() {
	const list = await (
		await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
	).json();
	const pages = list.filter(
		(target) => target.type === "page" && target.webSocketDebuggerUrl,
	);
	const page = pages.find((target) => !NOT_APP_PAGE.test(target.url ?? ""));
	if (!page)
		throw new Error(
			`no app page target; saw ${JSON.stringify(pages.map((t) => t.url))}`,
		);
	return page;
}

/** One CDP request over the page's own socket, then close it. */
async function withPage(call) {
	const page = await findPage();
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

async function evaluate(expression) {
	return withPage((socket) => {
		const result = new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("evaluate timed out")),
				20_000,
			);
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id !== 1) return;
				clearTimeout(timer);
				if (message.error) reject(new Error(JSON.stringify(message.error)));
				else if (message.result?.result?.value === undefined)
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

/** Photograph the window, through the app's own compositor. */
async function capture(path) {
	const data = await withPage((socket) => {
		const result = new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("capture timed out")),
				15_000,
			);
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
 * What the layout is, read from the page rather than from the pixels.
 *
 * The band is found STRUCTURALLY - a child of the shell that paints at the very
 * top of the window - rather than by a selector naming one CSS spelling, because
 * the change this rig photographs is precisely a change of that spelling
 * (`fixed inset-x-0 top-0` against an in-flow child). What it reports for each
 * one is the box, where it is anchored (`position`, `z-index`) and its text, so
 * a reader can see which band is up rather than infer it.
 *
 * `covered` is an INTERSECTION TEST against the anchors a reader would name - the
 * sidebar's search control and the pane's own first row - which is what turns
 * "the title is gone" from a pixel judgement into an inequality. Device pixels
 * are CSS ones times the device pixel ratio, the unit the D9 brief measures in.
 */
const MEASURE = `(() => {
	const round = (value) => Math.round(value * 100) / 100;
	const box = (el) => {
		const r = el.getBoundingClientRect();
		return {
			x: round(r.x),
			y: round(r.y),
			w: round(r.width),
			h: round(r.height),
			top: round(r.top),
			bottom: round(r.bottom),
		};
	};
	const device = (b) => ({
		top: Math.round(b.top * window.devicePixelRatio),
		bottom: Math.round(b.bottom * window.devicePixelRatio),
	});
	const text = (el) => (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 90);
	const main = document.querySelector("main");
	const region = main ? main.parentElement : null;
	const outer = region ? region.parentElement : null;
	/*
	 * A band is a child of the shell that paints at the top of the window. The
	 * DOM order is the z order here, so the LAST match is the one a reader sees
	 * where two overlap.
	 */
	/*
	 * The band wrappers are children of the element that holds the app's own
	 * layout, and WHICH element that is depends on the shape under test: before
	 * this change the bands are children of main's own parent, after it they are
	 * siblings of the wrapper that holds main. Both levels are read rather than
	 * one being named, because a rig that assumed either depth reported "no band"
	 * over a window carrying one - which is what its first run did.
	 */
	const levels = [region, outer].filter(Boolean);
	const seen = new Set();
	const candidates = [];
	for (const level of levels) {
		for (const el of level.children) {
			if (seen.has(el)) continue;
			seen.add(el);
			candidates.push(el);
		}
	}
	const bands = candidates
		.map((el) => ({ el, style: getComputedStyle(el), b: box(el) }))
		/*
		 * A strip at the top of the window, and NOT the app's own region: the region
		 * contains main and is the whole window tall, which is the one thing a band
		 * never is.
		 */
		.filter(
			(entry) =>
				entry.b.h > 16 &&
				entry.b.h <= 200 &&
				entry.b.top <= 8 &&
				text(entry.el) &&
				!(main && entry.el.contains(main)),
		)
		.map((entry) => ({
			text: text(entry.el),
			position: entry.style.position,
			zIndex: entry.style.zIndex,
			rect: entry.b,
			device: device(entry.b),
		}));
	const search = document.querySelector('[aria-label^="Search"]');
	const anchors = {};
	if (search) {
		const b = box(search);
		anchors.search = {
			rect: b,
			device: device(b),
			coveredByBand: bands.some((band) => band.rect.bottom > b.top && band.rect.top < b.bottom),
		};
	}
	const paneFirst = main ? main.querySelector("h1, h2, h3, p") : null;
	if (paneFirst) {
		const b = box(paneFirst);
		anchors.paneFirst = {
			text: text(paneFirst),
			rect: b,
			device: device(b),
			coveredByBand: bands.some((band) => band.rect.bottom > b.top && band.rect.top < b.bottom),
		};
	}
	const fixed = [...document.querySelectorAll("*")].filter(
		(el) => getComputedStyle(el).position === "fixed" && el.getBoundingClientRect().height > 0,
	);
	return JSON.stringify({
		viewport: {
			w: window.innerWidth,
			h: window.innerHeight,
			dpr: window.devicePixelRatio,
		},
		bandCount: bands.length,
		bands,
		bandTotal: bands.reduce((sum, band) => sum + band.rect.h, 0),
		region: region ? { cls: String(region.className || "").slice(0, 60), rect: box(region), scrollHeight: region.scrollHeight, clientHeight: region.clientHeight } : null,
		outer: outer ? { cls: String(outer.className || "").slice(0, 60), rect: box(outer), scrollHeight: outer.scrollHeight, clientHeight: outer.clientHeight } : null,
		/*
		 * Every child of the shell, and every alert, with its class, box and copy.
		 *
		 * WHY this is here rather than only the detected bands: when a rig waits for a
		 * band that never comes, the question is "is it not rendered, or is it
		 * rendered somewhere this detector does not look", and the two have opposite
		 * answers. This is the read that separates them - it is how the first run
		 * found its own detector looking one level too high.
		 */
		levels: levels.map((el) => ({
			cls: String(el.className || "").slice(0, 56),
			rect: box(el),
			children: [...el.children].map((child) => ({
				cls: String(child.className || "").slice(0, 56),
				position: getComputedStyle(child).position,
				h: round(child.getBoundingClientRect().height),
				text: text(child).slice(0, 40),
			})),
		})),
		alerts: [...document.querySelectorAll('[role="alert"]')].map((el) =>
			text(el).slice(0, 80),
		),
		anchors,
		fixedCount: fixed.length,
		documentScroll: {
			scrollHeight: document.documentElement.scrollHeight,
			clientHeight: document.documentElement.clientHeight,
			overflowY: getComputedStyle(document.documentElement).overflowY,
		},
	});
})()`;

async function measure() {
	return JSON.parse(await evaluate(MEASURE));
}

/**
 * Wait for the layout to hold the state a frame is about, and say which one it
 * was waiting for when it does not.
 *
 * Three consecutive samples rather than one: every state here is reached by a
 * poll the app performs on its own cadence (capabilities every 30 s while the
 * plane is open, main's probes faster than that), so a single sample can catch a
 * frame mid-transition and commit it as the state.
 */
async function holdFor(label, predicate, timeoutMs = 180_000) {
	const deadline = Date.now() + timeoutMs;
	let streak = 0;
	let last = null;
	let tick = 0;
	while (Date.now() < deadline) {
		last = await measure();
		streak = predicate(last) ? streak + 1 : 0;
		if (streak >= 3) return last;
		if (tick % 10 === 0)
			console.log(
				`#   waiting for ${label}: bands=${last.bandCount} asked=${JSON.stringify(requestCounts())}`,
			);
		tick += 1;
		await wait(1_000);
	}
	throw new Error(
		`${label}: never settled; last read ${JSON.stringify(last, null, 1).slice(0, 4_000)}`,
	);
}

const oneBand = (m) => m.bandCount === 1;
const noBand = (m) => m.bandCount === 0;
const twoBands = (m) => m.bandCount === 2;

const summary = { label: LABEL, viewport: null, states: {} };
const state = { features: COMPLETE_FEATURES, requests: [] };

/** Every path this stub was asked for, and how often - the app's own account of itself. */
function requestCounts() {
	const counts = {};
	for (const entry of state.requests) {
		counts[entry.path] = (counts[entry.path] ?? 0) + 1;
	}
	return counts;
}

async function record(name, m) {
	const file = join(FRAMES, `${LABEL}-${name}.png`);
	await capture(file);
	summary.states[name] = {
		frame: file,
		requests: requestCounts(),
		bandCount: m.bandCount,
		bandTotal: m.bandTotal,
		bands: m.bands,
		anchors: m.anchors,
		region: m.region,
		outer: m.outer,
		fixedCount: m.fixedCount,
		documentScroll: m.documentScroll,
	};
	console.log(
		`# ${name}: bands=${m.bandCount} total=${m.bandTotal} css px, region height=${m.region?.rect.h}, asked=${JSON.stringify(
			requestCounts(),
		)}, covered=${JSON.stringify(
			Object.fromEntries(
				Object.entries(m.anchors).map(([k, v]) => [k, v.coveredByBand]),
			),
		)}`,
	);
}

/** Every stub this run started, oldest first: a phase closes the one in force. */
const stubServers = [];
const startStub = () => {
	const started = stubDaemon(PORT, state);
	stubServers.push(started);
	return started;
};
const server = startStub();
let recordFile = null;
let heartbeat = null;
/*
 * A writer that arms a timer around itself is a rig that saturates itself - see
 * `attach-frame-evidence.mjs`'s account of the 290,382 pending timers it left -
 * and a timer that fires after the scratch tree is gone is a crash after a
 * finished run. So the callback checks the flag the teardown clears.
 */
let heartbeatArmed = false;

try {
	seedDesktopToken();
	recordFile = writeRecord(process.pid);
	heartbeatArmed = true;
	heartbeat = setInterval(() => {
		if (heartbeatArmed) writeRecord(process.pid);
	}, 5_000);
	const app = launch();
	console.log(`# ${LABEL}: app frames, scratch ${ROOT}, stub on ${PORT}`);

	/*
	 * Wait for the app's own page, and keep its stdout: the `[window-mode]` line is
	 * the app's own statement that it is headless, and this rig asserts it rather
	 * than trusting the variable it set (`src/main/window-mode.ts` prints it for
	 * every mode but `normal`).
	 */
	const pageDeadline = Date.now() + 90_000;
	for (;;) {
		try {
			await findPage();
			break;
		} catch (error) {
			if (Date.now() > pageDeadline) throw error;
			await wait(1_000);
		}
	}
	await wait(3_000);
	const modeLine = app
		.text()
		.split("\n")
		.find((line) => line.includes("[window-mode]"));
	if (!modeLine) {
		throw new Error(
			`the app printed no [window-mode] line, so this rig cannot say which mode it launched in. Output so far:\n${app.text().slice(-2_000)}`,
		);
	}
	if (!/headless/.test(modeLine)) {
		throw new Error(
			`the app launched in a mode this rig does not allow: ${modeLine}`,
		);
	}
	console.log(`# window mode: ${modeLine.trim()}`);

	// 1. Attached, every required capability advertised: no band at all.
	const none = await holdFor("none", noBand);
	summary.viewport = none.viewport;
	await record("none", none);

	// 2. Six of the seven withdrawn: the compatibility band alone.
	state.features = PARTIAL_FEATURES;
	await record("one-line", await holdFor("one-line", oneBand));

	/*
	 * 3. The address goes quiet while the narrowed capability answer is still the
	 * last one the app holds, so BOTH bands are up at once: the daemon status
	 * detaches (a two-line band) and the compatibility band's own reason is still
	 * on screen. This is the case a reserving inset would have to measure and sum,
	 * and the case that decides this change's shape.
	 *
	 * WHY the answer survives the address going away: React Query keeps the last
	 * data across a failed refetch, which this rig relies on and measures - the
	 * reproduction would be a rig that restarted the daemon instead, and a daemon
	 * that ANSWERS /health re-attaches the app, taking the connectivity band with
	 * it (measured: one 180 s wait for two bands that ended with the compatibility
	 * band alone).
	 */
	clearInterval(heartbeat);
	heartbeatArmed = false;
	heartbeat = null;
	rmSync(recordFile, { force: true });
	server.close();
	await record("two-bands", await holdFor("two-bands", twoBands));

	/*
	 * 4. And a daemon that can be attached to answers completely again: both bands
	 * clear, and then the address goes quiet one more time - so the connectivity
	 * band is photographed ALONE, with the capability answer complete and no
	 * compatibility band beside it. That state is the one the D9 brief measures as
	 * "daemon-absent", and it is reachable only from an attachment: a fresh boot
	 * against a dead address carries the compatibility band too (see phase 3).
	 */
	state.features = COMPLETE_FEATURES;
	startStub();
	recordFile = writeRecord(process.pid);
	heartbeatArmed = true;
	heartbeat = setInterval(() => {
		if (heartbeatArmed) writeRecord(process.pid);
	}, 5_000);
	await holdFor("re-attached", noBand);
	clearInterval(heartbeat);
	heartbeatArmed = false;
	heartbeat = null;
	rmSync(recordFile, { force: true });
	const second = stubServers.at(-1);
	if (second?.listening) second.close();
	await record("two-line", await holdFor("two-line", oneBand));
} finally {
	heartbeatArmed = false;
	if (heartbeat) clearInterval(heartbeat);
	for (const started of stubServers) if (started.listening) started.close();
	for (const child of children) await stop(child);
	reapScratchProfiles();
	writeFileSync(
		join(FRAMES, `${LABEL}-geometry.json`),
		`${JSON.stringify(summary, null, 2)}\n`,
	);
	const logFile = join(PROFILE, "logs", "backend-service.log");
	if (existsSync(logFile)) {
		writeFileSync(
			join(FRAMES, `${LABEL}-backend-service.log`),
			readFileSync(logFile),
		);
	}
	rmSync(ROOT, { recursive: true, force: true });
	console.log(`# states written to ${FRAMES}/${LABEL}-geometry.json`);
}
