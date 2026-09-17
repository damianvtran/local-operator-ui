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

import { execFileSync, spawn, spawnSync } from "node:child_process";
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
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
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
/**
 * Which states to record, and what the tree under test is.
 *
 * `--expect uncovered` is the fixed tree: the run then ASSERTS the acceptance
 * claims (no anchor covered at any band height, the region keeping exactly the
 * window minus the bands, the bands stacked in order) and FAILS rather than
 * recording a `coveredByBand: true` for a reader to notice. The pre-fix tree
 * passes `--expect covered`, which asserts the opposite - a band up means a row
 * gone - so neither half is a mere reading (review round 1, B1/N4).
 */
const ONLY = (argValue("--only", "all") || "all")
	.split(",")
	.map((name) => name.trim());
const EXPECT = argValue("--expect", "uncovered");
if (!["uncovered", "covered"].includes(EXPECT)) {
	console.error(`--expect expects uncovered|covered (got "${EXPECT}")`);
	process.exit(2);
}
const wanted = (name) => ONLY.includes("all") || ONLY.includes(name);
/**
 * A committed no-band frame from the OTHER half of the pair, diffed against this
 * run's own no-band frame.
 *
 * The designer's must-not-move check, and the one claim the rest of this rig cannot
 * make: with no band up the restructure must cost the layout nothing, which is a
 * pixel fact about two trees rather than a rect fact about one. Pass the other
 * half's `*-none.png` and the run FAILS on any differing row.
 */
const COMPARE_AGAINST = argValue("--compare-against", null);
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
const env = withNotificationsOff({
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
for (const key of Object.keys(env)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
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
			env,
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
	const regionTop = region ? box(region).top : 0;
	/*
	 * A BAND IS A LAYOUT SIBLING OF THE APP'S REGION, not a strip at the top of the
	 * WINDOW. That distinction is the whole of review round 1's B1: the first
	 * version filtered on "top <= 8", which is the PRE-FIX shape written into the
	 * tool - on the fixed tree the second band's top is the first band's bottom (68
	 * or 53), so it was dropped, a two-band state was unreachable, and the case that
	 * decided this change's shape could not be photographed at all.
	 *
	 * The candidate set is the shell's own children at both levels that hold them
	 * (before the fix the bands are children of main's parent, after it they are
	 * siblings of the wrapper that holds main), with the region excluded by
	 * contains(main) and anything region-sized excluded by the height window. Where
	 * a band sits is then relative to the REGION's top, which is true of a fixed
	 * strip at y 0 and of the column's first children alike.
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
		.filter(
			(entry) =>
				entry.b.h > 16 &&
				entry.b.h <= 200 &&
				entry.b.top <= regionTop + 8 &&
				text(entry.el) &&
				!(main && entry.el.contains(main)),
		)
		.sort((a, b) => a.b.top - b.b.top)
		.map((entry) => ({
			text: text(entry.el),
			position: entry.style.position,
			zIndex: entry.style.zIndex,
			rect: entry.b,
			device: device(entry.b),
		}));
	/*
	 * THE ANCHORS ARE NAMED, and each match is asserted unique. querySelector picks
	 * the first match in document order, so a selector that happens to match two
	 * controls reads whichever the DOM puts first - which is how the first version of
	 * this file measured the chat list's filter while its comment called it the
	 * rail's search, and how a probe can silently drift onto a control no band can
	 * reach and read "not covered" as a pass (review round 1, M1).
	 *
	 * relativeToRegion is the drift guard: an anchor a band at the top of the region
	 * can cover starts within 200 CSS px of the region's top in EVERY state, because
	 * the region itself translates by the band height. The rail's search control is
	 * recorded as the opposite control - it sits at the rail's foot, so no top band
	 * can reach it - and the run fails if it is ever covered, which would mean the
	 * band is not a strip.
	 */
	const anchors = {};
	const coveredBy = (b) =>
		bands.filter((band) => band.rect.bottom > b.top && band.rect.top < b.bottom);
	const at = (selector, where = document) => {
		const found = [...where.querySelectorAll(selector)];
		return { el: found.length === 1 ? found[0] : null, matches: found.length };
	};
	const record1 = (name, el, selector, bandReachable) => {
		if (!el) {
			anchors[name] = {
				selector,
				error: "matched 0 element(s), expected exactly 1",
			};
			return;
		}
		const b = box(el);
		anchors[name] = {
			selector,
			text: text(el).slice(0, 60),
			rect: b,
			device: device(b),
			relativeToRegion: region ? round(b.top - regionTop) : null,
			bandReachable,
			coveredByBand: coveredBy(b).length > 0,
			coveredBy: coveredBy(b).map((band) => band.text.slice(0, 40)),
		};
	};
	const anchor = (name, selector, bandReachable) => {
		const probe = at(selector);
		record1(
			name,
			probe.el,
			probe.matches === 1
				? selector
				: selector + " (" + probe.matches + " matches)",
			bandReachable,
		);
	};
	anchor("chatSearch", 'input[aria-label="Search chats and agents"]', true);
	anchor("chatListHeader", 'nav[aria-label="Chats"] h2', true);
	/*
	 * The CONVERSATION PANE's own first row, which is not one selector: a draft
	 * shows its own h1, a live session shows its header row, and the app's first
	 * heading is the CHAT LIST's "Chats" (named above) rather than the pane's. So the
	 * scope is the app's own region element - main, which holds BOTH columns - and
	 * the first text row OUTSIDE the chat list is taken: the pane's own first row.
	 *
	 * WHY main, AND NOT THE CHAT LIST'S PARENT, which is what this used to be:
	 * measured on the rebased tree, nav[aria-label="Chats"] is wrapped in a
	 * sidebar-column div that holds the nav and NOTHING else, so the chat list's
	 * parent IS that column, the only row it has is the chat list itself, the filter
	 * leaves nothing, and the probe resolved to 0 elements in every state - which is
	 * the drift the run then failed on. main is the element that holds the chat list
	 * column and the pane column both, so the same filter reads the pane.
	 */
	const chatList = document.querySelector('nav[aria-label="Chats"]');
	const pane = main;
	const paneRows = pane
		? [...pane.querySelectorAll("h1, h2, h3, p")].filter(
				(el) => !(chatList && chatList.contains(el)),
			)
		: [];
	record1(
		"paneFirstRow",
		paneRows[0] ?? null,
		/*
		 * The description carries NO quote that needs escaping, and that is a
		 * constraint rather than a style: this whole function is ONE template literal
		 * delivered to the app through Runtime.evaluate, so an escape written for the
		 * SOURCE is rewritten on the way out - a backslash before an apostrophe loses
		 * that backslash, and a description containing a bare apostrophe then closes
		 * its own string. Measured, and it is what this description used to be: the
		 * app answered every read with SyntaxError: missing ) after argument list,
		 * the rig could only report "the page answered nothing", and the run died at
		 * its FIRST state after the full 180 s wait with a perfectly healthy app
		 * behind it. The attribute is spelled unquoted - a valid selector spelling -
		 * and the parse of the delivered expression is asserted below this literal.
		 */
		"the pane's first h1/h2/h3/p outside nav[aria-label=Chats]",
		true,
	);
	anchor("railSearch", "[data-command-palette-trigger]", false);
	/*
	 * The element use-browser-chrome measures on /browser, reported so the native
	 * view's bounds can be read either side of a band rather than reasoned about
	 * (review round 1, M2). Its class string is the selector because the component
	 * gives the element no hook; it must match exactly once or the state reports an
	 * error, so a rename fails the run loudly instead of reading nothing.
	 */
	if (location.hash.startsWith("#/browser")) {
		anchor("browserContent", ".relative.min-h-0.min-w-0.grow.bg-canvas", true);
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
		route: location.hash || "#/",
		bandCount: bands.length,
		bands,
		bandTotal: round(bands.reduce((sum, band) => sum + band.rect.h, 0)),
		region: region ? { cls: String(region.className || "").slice(0, 60), rect: box(region), scrollHeight: region.scrollHeight, clientHeight: region.clientHeight } : null,
		outer: outer ? { cls: String(outer.className || "").slice(0, 60), rect: box(outer), scrollHeight: outer.scrollHeight, clientHeight: outer.clientHeight } : null,
		/*
		 * Every child of each level, with its class, box, position and copy.
		 *
		 * WHY this is here rather than only the detected bands: when a rig waits for a
		 * band that never comes, the question is "is it not rendered, or is it rendered
		 * somewhere this detector does not look", and the two have opposite answers.
		 * This is the read that separates them.
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
		/*
		 * Whether the first-run wizard is up. It is portaled to document.body, so it
		 * is invisible to every read scoped to the shell - which is why the scrim
		 * state waited 120 s for a predicate it could never satisfy.
		 */
		onboardingVisible: Boolean(
			[...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find((el) =>
				/Connect a provider|Choose your provider|Welcome to Local Operator/i.test(
					el.innerText || "",
				),
			),
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

/*
 * The delivered expression must be a parsable PROGRAM, and this is asserted here
 * rather than discovered by the app.
 *
 * WHY it can fail at all: the function above is one template literal, so any
 * escape written for the SOURCE is rewritten on the way out - a `\'` loses its
 * backslash and a description containing an apostrophe closes its own string. The
 * app then answers every read with `SyntaxError: missing ) after argument list`,
 * the rig's own error reads as "the page answered nothing: no context yet", and
 * the only symptom is a 180 s wait at the first state with a healthy app behind
 * it. That is a boot cycle to find and a boot cycle to re-find; parsing it here
 * fails in a millisecond, names the expression, and points at the line.
 */
try {
	new Function(MEASURE);
} catch (error) {
	console.error(
		`MEASURE does not parse as a program: ${error.message}. An escape in the template literal has been rewritten on the way out (a \`\\'\` delivers a bare \`'\`), so check the descriptions inside it for an unescaped quote.`,
	);
	process.exit(2);
}

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
		try {
			last = await measure();
		} catch (error) {
			/*
			 * A read that lands while the page is mid-navigation, or while a boot under
			 * load is still painting, answers nothing at all - the same fact as "this
			 * state is not here yet", so it is waited out rather than thrown. Measured:
			 * a host-hold retry died on the FIRST read of a boot that was still painting,
			 * which is the one failure here that is not a statement about the app.
			 */
			streak = 0;
			if (tick % 10 === 0)
				console.log(`#   waiting for ${label}: read failed (${error.message})`);
			tick += 1;
			await wait(1_000);
			continue;
		}
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

/**
 * The tree a path has IN THE WORKTREE, which is not always `HEAD:path`.
 *
 * `HEAD:src` answers "what does this commit ship", which is what the manifest's
 * `srcTree` means - and it is the wrong answer for a record of a run. The before half
 * checks `src/` out of the fix's PARENT (the recipe in
 * docs/evidence/band-occlusion/README.md), so during that run the worktree's `src/` is
 * not HEAD's, and a record carrying `HEAD:src` would name a tree its frames are not
 * pictures of. Written through a scratch index so the run's own index is never touched:
 * `git add` against the real one would stage a half-built tree under the operator.
 */
const worktreeTree = (path) => {
	const index = join(tmpdir(), `band-occlusion-index-${process.pid}`);
	const env = { ...process.env, GIT_INDEX_FILE: index };
	try {
		execFileSync("git", ["read-tree", "HEAD"], { cwd: REPO, env });
		execFileSync("git", ["add", "-A", "--", path], { cwd: REPO, env });
		const root = execFileSync("git", ["write-tree"], { cwd: REPO, env })
			.toString()
			.trim();
		return execFileSync("git", ["rev-parse", `${root}:${path}`], { cwd: REPO })
			.toString()
			.trim();
	} finally {
		rmSync(index, { force: true });
	}
};

const summary = {
	label: LABEL,
	/*
	 * The direction every state below is asserted in, and the tree it was taken on
	 * (review round 2, F3). Both were missing, and neither can be recovered from the
	 * rest of the record: `--expect covered` asserts the OPPOSITE direction from
	 * `--expect uncovered`, so without this field a `coveredByBand: true` is ambiguous
	 * between a defect and a passing pre-fix claim - and a record that does not say which
	 * tree it is a picture of cannot be told from one taken on the folded head, which is
	 * the distinction the whole stamped-versus-re-captured argument rests on.
	 */
	expect: EXPECT,
	takenOn: {
		srcTree: worktreeTree("src"),
		scriptsTree: worktreeTree("scripts"),
	},
	viewport: null,
	states: {},
};
const state = { features: COMPLETE_FEATURES, requests: [] };

/** Every path this stub was asked for, and how often - the app's own account of itself. */
function requestCounts() {
	const counts = {};
	for (const entry of state.requests) {
		counts[entry.path] = (counts[entry.path] ?? 0) + 1;
	}
	return counts;
}

/**
 * A PNG's rows, so a claim about pixels can be made about pixels.
 *
 * WHY this is here rather than in a shell command: the acceptance list asks for
 * one check the rects cannot make - that everything above the region is band
 * paint, so the app's own first painted row starts exactly at the bands' device
 * height - and a still that "looks right" is not that check. PNG's filters are
 * implemented rather than pulled in: this repository has no image dependency, and
 * Electron writes an RGBA8 surface for every capture of this window (Page.
 * captureScreenshot of a `show: false` window, measured; the reader accepts 0/2/4/6
 * colour types and refuses anything else by name).
 */
function pngRows(file) {
	const buf = readFileSync(file);
	let pos = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	const idat = [];
	while (pos + 8 <= buf.length) {
		const length = buf.readUInt32BE(pos);
		const type = buf.toString("ascii", pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + length);
		if (type === "IHDR") {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
		} else if (type === "IDAT") idat.push(data);
		else if (type === "IEND") break;
		pos += 12 + length;
	}
	if (bitDepth !== 8)
		throw new Error(
			`${file}: bit depth ${bitDepth} is not what this reader handles`,
		);
	const channels =
		colorType === 6
			? 4
			: colorType === 2
				? 3
				: colorType === 4
					? 2
					: colorType === 0
						? 1
						: 0;
	if (!channels)
		throw new Error(
			`${file}: colour type ${colorType} is not what this reader handles`,
		);
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const rows = [];
	let previous = Buffer.alloc(stride);
	let offset = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[offset++];
		const line = Buffer.from(raw.subarray(offset, offset + stride));
		offset += stride;
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? line[x - channels] : 0;
			const b = previous[x];
			const c = x >= channels ? previous[x - channels] : 0;
			let value = line[x];
			if (filter === 1) value += a;
			else if (filter === 2) value += b;
			else if (filter === 3) value += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			line[x] = value & 0xff;
		}
		rows.push(line);
		previous = line;
	}
	return { width, height, channels, rows };
}

/** Whether two device rows carry the same RGB. */
function sameRow(a, b, channels) {
	if (a.length !== b.length) return false;
	for (let x = 0; x < a.length; x += channels) {
		if (a[x] !== b[x] || a[x + 1] !== b[x + 1] || a[x + 2] !== b[x + 2])
			return false;
	}
	return true;
}

/**
 * The pixel half of the acceptance list, measured against the no-band frame of the
 * SAME run, so the comparison cannot be about the tree, the theme or the window -
 * only about the bands.
 *
 * `rowsBelowShiftEqual` walks down from the bands' own device height and reports how
 * far the frame equals the no-band frame translated by exactly that many device
 * rows. `firstDivergentRow` is where the frame stops matching.
 *
 * WHY THIS IS REPORTED AND NOT ASSERTED, which is what it used to be: measured, the
 * app's own CONTENT differs between the no-band state and the band states - a band is
 * a signal that the backend state changed, so the pane paints a different notice
 * under it (`no band` paints the chat pane's own first row; a detached daemon paints
 * the daemon-absent notice above it) - and it differs in the region's first ~30 CSS
 * px. An equality assertion over those rows therefore fails for a reason that is not
 * the defect it means to catch, on the tree that fixes it. The pixel claim that DOES
 * survive is `bandPaint` below, which is about the rows the bands own rather than
 * about the app's content.
 */
function compareWithNone(file, noneFile, shift) {
	const frame = pngRows(file);
	const none = pngRows(noneFile);
	if (frame.width !== none.width || frame.height !== none.height)
		return {
			error: `frame is ${frame.width}x${frame.height}, none is ${none.width}x${none.height}`,
		};
	let equal = 0;
	let firstDivergentRow = null;
	for (let y = shift; y < frame.height; y++) {
		if (sameRow(frame.rows[y], none.rows[y - shift], frame.channels))
			equal += 1;
		else if (firstDivergentRow === null) firstDivergentRow = y;
	}
	return {
		shiftRows: shift,
		rowsCompared: frame.height - shift,
		rowsBelowShiftEqual: equal,
		firstDivergentRow,
		firstRowsBelowShiftEqual:
			firstDivergentRow === null || firstDivergentRow >= shift + 100,
	};
}

/**
 * The designer's pixel claim, as a fact about the pixels: every device row the bands
 * DECLARE is the bands' own paint, and the app's first painted row is the first row
 * that is not.
 *
 * WHAT IT CHECKS, per state, from the committed frame alone: for every device row in
 * `0 .. bandTotal*dpr-1` the row's dominant colour is one of the bands' grounds or one
 * of their own 1px bottom rules, AND both of the row's window-edge pixels carry that
 * same colour - so the band is opaque and full-bleed for the whole height it
 * declares. The row at `bandTotal*dpr` must NOT be band paint: that is "the app's
 * first painted row starts exactly at the bands' device height", and it is the same
 * claim as the rect assertion above, made about the picture instead of the box.
 *
 * WHY THE GROUNDS ARE READ FROM THE FRAME rather than from the palette: the rig has
 * no theme and must not keep one in step with `shared/themes` - this is a claim about
 * what was PAINTED, so the colour is taken from the band's own middle row and the
 * check is that the rest of the band's rows are that colour. A theme change moves
 * both sides together, which is what makes it a test of the geometry.
 *
 * WHY THIS REPLACES a shifted comparison against the no-band frame (see
 * `compareWithNone`): that one is confounded by the app's own content changing under a
 * band, and this one is not - it asks only what the bands painted.
 */
function bandPaint(file, bands, dpr) {
	const frame = pngRows(file);
	const shift = Math.round(
		bands.reduce((sum, band) => sum + band.rect.h, 0) * dpr,
	);
	if (shift <= 0 || shift >= frame.height)
		return {
			error: `the bands declare ${shift} device rows of ${frame.height}`,
		};
	const colourAt = (row, x) => {
		const at = x * frame.channels;
		return (row[at] << 16) | (row[at + 1] << 8) | row[at + 2];
	};
	/** The colour most of a device row is, and how many colours it carries at all. */
	const modeOf = (y) => {
		const counts = new Map();
		const row = frame.rows[y];
		for (let x = 0; x < frame.width; x += 1) {
			const colour = colourAt(row, x);
			counts.set(colour, (counts.get(colour) ?? 0) + 1);
		}
		let colour = -1;
		let most = -1;
		for (const [value, count] of counts)
			if (count > most) {
				most = count;
				colour = value;
			}
		return { colour, colours: counts.size };
	};
	const hex = (value) => `#${value.toString(16).padStart(6, "0")}`;
	/*
	 * Each band's ground is the dominant colour of its own middle row, and its rule is
	 * the colour of the row directly above its bottom edge - the bottom border the two
	 * band components carry (`border-t-0 border-b` after the D9 change).
	 */
	const grounds = new Set();
	const rules = new Set();
	for (const band of bands) {
		const middle = Math.round((band.rect.top + band.rect.h / 2) * dpr);
		const bottom = Math.round(band.rect.bottom * dpr);
		grounds.add(modeOf(middle).colour);
		if (bottom - 1 >= 0 && bottom - 1 < frame.height)
			rules.add(modeOf(bottom - 1).colour);
	}
	const paint = (y) => {
		const mode = modeOf(y);
		return (
			(grounds.has(mode.colour) || rules.has(mode.colour)) &&
			colourAt(frame.rows[y], 0) === mode.colour &&
			colourAt(frame.rows[y], frame.width - 1) === mode.colour
		);
	};
	const notPaint = [];
	for (let y = 0; y < shift; y += 1) if (!paint(y)) notPaint.push(y);
	return {
		grounds: [...grounds].map(hex),
		rules: [...rules].map(hex),
		shiftRows: shift,
		rowsChecked: shift,
		rowsNotBandPaint: notPaint.length,
		firstRowNotBandPaint: notPaint[0] ?? null,
		firstRowPastBandsIsBandPaint: paint(shift),
		appFirstPaintedRow: paint(shift) ? null : shift,
	};
}

/** Compare two frames of the same viewport pixel for pixel (the before/after control). */
function diffFrames(fileA, fileB) {
	const a = pngRows(fileA);
	const b = pngRows(fileB);
	if (a.width !== b.width || a.height !== b.height)
		return { error: `${a.width}x${a.height} against ${b.width}x${b.height}` };
	let differing = 0;
	for (let y = 0; y < a.height; y++)
		if (!sameRow(a.rows[y], b.rows[y], a.channels)) differing += 1;
	return {
		rows: a.height,
		differingRows: differing,
		identical: differing === 0,
	};
}

/** The checks this run makes, so a state that violates one fails rather than reports. */
const failures = [];
function check(what, ok, detail) {
	console.log(
		`# ${ok ? "PASS" : "FAIL"} ${what}${detail === undefined ? "" : ` - ${detail}`}`,
	);
	if (!ok)
		failures.push(`${what}${detail === undefined ? "" : ` (${detail})`}`);
}

async function record(name, m) {
	const file = join(FRAMES, `${LABEL}-${name}.png`);
	await capture(file);
	/*
	 * The COMMITTED name when the run writes inside the repository, so a reader can
	 * map a state to a frame without knowing the scratch `--out` of the run that
	 * produced it (review round 1, N3).
	 */
	const inside = relative(REPO, file);
	const entry = {
		frame: inside.startsWith("..") ? file : inside,
		out: FRAMES,
		route: m.route,
		requests: requestCounts(),
		bandCount: m.bandCount,
		bandTotal: m.bandTotal,
		bands: m.bands,
		anchors: m.anchors,
		region: m.region,
		outer: m.outer,
		fixedCount: m.fixedCount,
		documentScroll: m.documentScroll,
		viewport: m.viewport,
	};
	if (noneFrame && m.bandCount > 0)
		entry.pixels = compareWithNone(
			file,
			noneFrame,
			Math.round(m.bandTotal * m.viewport.dpr),
		);
	/*
	 * The bands' own pixels. The result is parked on the MEASUREMENT as well as on the
	 * record entry, because `assertState` is handed the measurement: an assertion wired
	 * only to a field the record adds is an assertion that never runs, which is what the
	 * shifted comparison's used to be (review round 1, N4's failure mode surviving one
	 * round).
	 */
	if (m.bandCount > 0) {
		entry.paint = bandPaint(file, m.bands, m.viewport.dpr);
		m.paint = entry.paint;
	}
	summary.states[name] = entry;
	console.log(
		`# ${name}: route=${m.route} bands=${m.bandCount} total=${m.bandTotal} css px, region=${JSON.stringify(
			m.region?.rect,
		)}, covered=${JSON.stringify(
			Object.fromEntries(
				Object.entries(m.anchors).map(([key, value]) => [
					key,
					value.coveredByBand,
				]),
			),
		)}`,
	);
	if (entry.pixels && !entry.pixels.error)
		console.log(
			`# ${name}: pixels - ${entry.pixels.rowsBelowShiftEqual}/${entry.pixels.rowsCompared} rows equal to the no-band frame shifted ${entry.pixels.shiftRows} device rows, first divergent row ${entry.pixels.firstDivergentRow}`,
		);
	return entry;
}

/** Where the no-band frame of this run lives, once one has been taken. */
let noneFrame = null;
/** Whether this tree is the fixed one, which decides the direction of every assertion. */
const expectUncovered = EXPECT === "uncovered";
/** The anchor offsets a band may not move: measured on the pre-fix tree, in CSS px. */
const CHAT_SEARCH_TOP = 48;
const CHAT_LIST_HEADER_TOP = 14.25;
/**
 * The anchors whose offset the SHELL pins, so a moved one is a drifted probe.
 *
 * `browserContent` is in here because `use-browser-chrome` reports it from the
 * region's own content element, which the shell's row places; `paneFirstRow` is NOT,
 * because where the pane's first row sits is a property of the pane's copy (see the
 * anchor loop in `assertState`).
 */
const PINNED_ANCHORS = new Set([
	"chatSearch",
	"chatListHeader",
	"browserContent",
]);
const pinnedAnchor = (name) => PINNED_ANCHORS.has(name);
/**
 * How far below the region's top a band could still cover a row, in CSS px.
 *
 * 200 against the tallest band this app can paint (121 CSS px with both up): the
 * margin is for a band's copy growing, and the point of the constant is that a row
 * below it is out of every band's reach rather than that the number is tight.
 */
const BAND_REACH_TOP_OFFSET = 200;

/**
 * The acceptance claims, asserted per state, in the direction the tree under test
 * should satisfy them.
 *
 * `--expect uncovered` is the fixed tree: nothing may be covered at any band
 * height, the region must be exactly the window minus the bands, the anchors must
 * keep their offsets (the region translates; the contents do not reflow), the bands
 * must stack in order and the app's first painted row must start at the bands'
 * device height. `--expect covered` is the pre-fix tree, whose defect is the first
 * of those, so it asserts that a band up means the rows are gone.
 */
function assertState(name, m) {
	check(
		`${name}: nothing scrolls above the region`,
		m.documentScroll.scrollHeight === m.documentScroll.clientHeight,
		`${m.documentScroll.scrollHeight}/${m.documentScroll.clientHeight} ${m.documentScroll.overflowY}`,
	);
	/*
	 * Direction-aware, like every claim here: the pre-fix tree's fixed bands take
	 * NO height from the layout, so its region is the whole window while a band is up
	 * - which is exactly the defect - and the fixed tree's region is the window minus
	 * the bands. Both are asserted, in their own direction, so neither half can be
	 * read as the other's evidence.
	 */
	check(
		expectUncovered
			? `${name}: region is the window minus the bands`
			: `${name}: region is the whole window (a fixed band takes no height)`,
		Math.abs(
			m.region.rect.h -
				(expectUncovered ? m.viewport.h - m.bandTotal : m.viewport.h),
		) <= 0.5,
		`region ${m.region.rect.h}, viewport ${m.viewport.h}, bandTotal ${m.bandTotal}`,
	);
	for (const [anchor, value] of Object.entries(m.anchors)) {
		if (value.error) {
			check(
				`${name}: anchor ${anchor} resolves exactly once`,
				false,
				value.error,
			);
			continue;
		}
		const reachable = value.bandReachable;
		/*
		 * WHERE the drift guard applies, and why it is now two rules rather than one.
		 *
		 * Its purpose is to stop a vacuous "not covered": a probe parked far below the
		 * region's top cannot be reached by a band at the top, so reading
		 * `coveredByBand: false` off it is a pass with nothing behind it (review round 1,
		 * M1). That argument needs the probe to be one the SHELL pins - and the two
		 * anchors the shell pins (`chatSearch` at 48 CSS px and `chatListHeader` at 14.25,
		 * both measured in every state of both runs) keep that offset by layout.
		 *
		 * The pane's own first row is NOT one of those. It is wherever the pane's CONTENT
		 * puts it, and measured in two runs of the fixed tree it sits at 0 CSS px below
		 * the region's top in the states where the pane paints a notice and at 374.3 and
		 * 408.3 in the states where it has nothing else to say and CENTRES its statement.
		 * So the guard's question ("did this probe drift?") has no answer for it: the same
		 * probe moved 408 px between two states of one run without anything drifting.
		 *
		 * What replaces the guard for that anchor is `inReach`: a band is at most 121 CSS
		 * px tall, so a row further down than BAND_REACH cannot be covered by one and
		 * nothing is read off it; where it IS in reach, it is asserted like any other
		 * anchor, in both directions. Its offset stays recorded per state either way.
		 */
		const inReach = Math.abs(value.relativeToRegion) <= BAND_REACH_TOP_OFFSET;
		if (reachable && pinnedAnchor(anchor) && m.bandCount > 0)
			check(
				`${name}: anchor ${anchor} keeps its offset (not a drifted probe)`,
				inReach,
				`${value.relativeToRegion} CSS px below the region's top`,
			);
		if (expectUncovered && reachable && inReach)
			check(
				`${name}: anchor ${anchor} is not covered`,
				!value.coveredByBand,
				value.coveredByBand
					? `covered by ${JSON.stringify(value.coveredBy)}`
					: "clear",
			);
		if (!expectUncovered && m.bandCount > 0 && reachable && inReach)
			check(
				`${name}: anchor ${anchor} is covered (pre-fix tree)`,
				value.coveredByBand,
			);
		if (!reachable)
			check(
				`${name}: the rail's own control is never covered (a band is a strip)`,
				!value.coveredByBand,
				`rect ${JSON.stringify(value.rect)}`,
			);
	}
	if (expectUncovered) {
		check(
			`${name}: the chat list's filter keeps its offset`,
			Math.abs(
				(m.anchors.chatSearch?.relativeToRegion ?? -1) - CHAT_SEARCH_TOP,
			) <= 0.5,
			`${m.anchors.chatSearch?.relativeToRegion} against ${CHAT_SEARCH_TOP}`,
		);
		check(
			`${name}: the chat list's header keeps its offset`,
			Math.abs(
				(m.anchors.chatListHeader?.relativeToRegion ?? -1) -
					CHAT_LIST_HEADER_TOP,
			) <= 0.5,
			`${m.anchors.chatListHeader?.relativeToRegion} against ${CHAT_LIST_HEADER_TOP}`,
		);
	}
	/*
	 * The CAUSE, asserted rather than only its consequence (review round 2, F4). Every
	 * state already records each band's own `position` and `zIndex`, and every claim
	 * above reads what that placement DOES - nothing covered, region = window - bands -
	 * and never the placement itself, so a band that took its height some other way (an
	 * absolutely positioned strip INSIDE the region, say) could satisfy the geometry
	 * while being a different shape from the one this change argues for. Reading the
	 * recorded position closes that gap in each tree's own direction: in flow on the
	 * fixed tree, positioned out of flow on the pre-fix tree.
	 */
	if (m.bandCount > 0)
		check(
			expectUncovered
				? `${name}: every band is in flow (none is positioned)`
				: `${name}: every band is positioned out of flow (the pre-fix shape)`,
			m.bands.every((band) =>
				expectUncovered
					? band.position === "static"
					: band.position === "fixed",
			),
			m.bands
				.map(
					(band) =>
						`${band.position}${band.zIndex && band.zIndex !== "auto" ? ` z ${band.zIndex}` : ""}`,
				)
				.join(", "),
		);
	if (m.bandCount === 2) {
		const [first, second] = m.bands;
		check(
			expectUncovered
				? `${name}: the two bands stack in order`
				: `${name}: the two bands overlap at the window's top (the pre-fix shape)`,
			expectUncovered
				? Math.abs(second.rect.top - first.rect.bottom) <= 0.5
				: Math.abs(second.rect.top - first.rect.top) <= 0.5,
			`${first.rect.top}+${first.rect.h} then ${second.rect.top}`,
		);
		check(
			`${name}: bandTotal is the sum of the two`,
			Math.abs(m.bandTotal - (first.rect.h + second.rect.h)) <= 0.5,
			`${m.bandTotal}`,
		);
	}
	/*
	 * The designer's pixel claim, in the direction the tree under test should satisfy
	 * it: the rows the bands declare are the bands' paint, edge to edge, and the app's
	 * first painted row is the row after them.
	 */
	if (expectUncovered && m.bandCount > 0 && m.paint && !m.paint.error)
		check(
			`${name}: the bands' declared rows are all band paint, and the app's first painted row is the row after them`,
			m.paint.rowsNotBandPaint === 0 &&
				m.paint.firstRowPastBandsIsBandPaint === false,
			`${m.paint.rowsNotBandPaint} of ${m.paint.rowsChecked} rows are not band paint` +
				`; first row past the bands is band paint: ${m.paint.firstRowPastBandsIsBandPaint}` +
				`; grounds ${m.paint.grounds.join(",")}, rules ${m.paint.rules.join(",")}`,
		);
}

/** Go to a route and wait for the page under test to be the one on screen. */
async function goto(route, expectPresent, timeoutMs = 60_000) {
	await evaluate(
		`(() => { location.hash = ${JSON.stringify(route)}; return location.hash; })()`,
	);
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const m = await measure();
			if (m.route.startsWith(route) && expectPresent(m)) return m;
		} catch {
			/* mid-navigation */
		}
		if (Date.now() > deadline) throw new Error(`never reached ${route}`);
		await wait(1_000);
	}
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
 * `attach-frame-evidence.mjs`'s account of the 290,382 pending timers it left - and
 * a timer that fires after the scratch tree is gone is a crash after a finished
 * run. So the callback checks the flag the teardown clears.
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
	console.log(
		`# ${LABEL}: app frames, scratch ${ROOT}, stub on ${PORT}, expect ${EXPECT}, only ${ONLY.join(",")}`,
	);

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
	if (!modeLine)
		throw new Error(
			`the app printed no [window-mode] line, so this rig cannot say which mode it launched in. Output so far:\n${app.text().slice(-2_000)}`,
		);
	if (!/headless/.test(modeLine))
		throw new Error(
			`the app launched in a mode this rig does not allow: ${modeLine}`,
		);
	console.log(`# window mode: ${modeLine.trim()}`);
	summary.windowMode = modeLine.trim();

	/*
	 * The first-run wizard is a modal over the whole window and one of the two
	 * baseline `fixed` elements, so leaving it up on one half and seeding it away on
	 * the other makes the halves incomparable (review round 1, M4). It is seeded away
	 * here, on every half, and the reload is waited out before anything is measured.
	 * The `scrim` state at the end puts it back on purpose.
	 */
	await evaluate(`(() => {
		localStorage.setItem("onboarding-storage", JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" },
			version: 0,
		}));
		localStorage.setItem("chat-sidebar-disclosures", JSON.stringify({ previous: true }));
		location.reload();
		return "seeded";
	})()`).catch(() => {});
	await wait(4_000);

	// 1. Attached, every required capability advertised: no band at all.
	const none = await holdFor("none", noBand);
	summary.viewport = none.viewport;
	if (wanted("none")) {
		await record("none", none);
		assertState("none", none);
		noneFrame = join(FRAMES, `${LABEL}-none.png`);
		if (COMPARE_AGAINST) {
			const diff = diffFrames(noneFrame, COMPARE_AGAINST);
			summary.noneFrameDiff = diff;
			check(
				`none: the no-band frame is pixel-identical to ${COMPARE_AGAINST}`,
				diff.identical === true,
				diff.error ??
					`${diff.differingRows} of ${diff.rows} device rows differ`,
			);
		}
	}
	if (wanted("browser")) {
		const browserNone = await goto("#/browser", (m) =>
			Boolean(m.anchors.browserContent?.rect),
		);
		await record("browser-none", browserNone);
		await evaluate(`(() => { location.hash = "#/chat"; return "back"; })()`);
		await wait(2_000);
	}

	// 2. Six of the seven withdrawn: the compatibility band alone.
	state.features = PARTIAL_FEATURES;
	const one = await holdFor("one-line", oneBand);
	if (wanted("one-line")) {
		await record("one-line", one);
		assertState("one-line", one);
	}
	if (wanted("browser")) {
		const browserOne = await goto("#/browser", (m) =>
			Boolean(m.anchors.browserContent?.rect),
		);
		await record("browser-one-line", browserOne);
		await evaluate(`(() => { location.hash = "#/chat"; return "back"; })()`);
		await wait(2_000);
	}

	/*
	 * 3. The address goes quiet while the narrowed capability answer is still the
	 * last one the app holds, so BOTH bands are up at once: the daemon status
	 * detaches (a two-line band) and the compatibility band's own reason is still on
	 * screen. This is the case a reserving inset would have to measure and sum, and
	 * the case that decides this change's shape.
	 *
	 * WHY the answer survives the address going away: React Query keeps the last data
	 * across a failed refetch, which this rig relies on and measures - the
	 * reproduction would be a rig that restarted the daemon instead, and a daemon
	 * that ANSWERS /health re-attaches the app, taking the connectivity band with it
	 * (measured: one 180 s wait for two bands that ended with the compatibility band
	 * alone).
	 */
	clearInterval(heartbeat);
	heartbeatArmed = false;
	heartbeat = null;
	rmSync(recordFile, { force: true });
	server.close();
	const two = await holdFor("two-bands", twoBands);
	if (wanted("two-bands")) {
		await record("two-bands", two);
		assertState("two-bands", two);
	}
	if (wanted("browser")) {
		const browserTwo = await goto("#/browser", (m) =>
			Boolean(m.anchors.browserContent?.rect),
		);
		await record("browser-two-bands", browserTwo);
		await evaluate(`(() => { location.hash = "#/chat"; return "back"; })()`);
		await wait(2_000);
	}

	/*
	 * 4. The danger variant of the connectivity band, stacked over the compatibility
	 * band. `detached` carries TWO copies: the app's own "reconnecting on its own"
	 * warning while it is still working, and "the server stopped" once it has given
	 * up (about 90 s, `serverBannerCopy`). The designer asked for the pair seen
	 * together, and this is the only state in which the danger variant and a second
	 * band are both up.
	 */
	if (wanted("two-bands-danger")) {
		const danger = await holdFor(
			"two-bands-danger",
			(m) =>
				m.bandCount === 2 &&
				m.bands.some((band) => band.text.includes("server stopped")),
			240_000,
		);
		await record("two-bands-danger", danger);
		assertState("two-bands-danger", danger);
	}

	/*
	 * 5. A daemon that can be attached to answers completely again: both bands clear,
	 * and then the address goes quiet one more time - so the connectivity band is
	 * photographed ALONE, with the capability answer complete and no compatibility
	 * band beside it. That state is the one the D9 brief measures as
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
	const reattached = await holdFor("re-attached", noBand);
	if (wanted("none")) {
		await record("none-reattached", reattached);
		assertState("none-reattached", reattached);
	}
	clearInterval(heartbeat);
	heartbeatArmed = false;
	heartbeat = null;
	rmSync(recordFile, { force: true });
	const second = stubServers.at(-1);
	if (second?.listening) second.close();
	if (wanted("two-line")) {
		const twoLine = await holdFor("two-line", oneBand);
		await record("two-line", twoLine);
		assertState("two-line", twoLine);
	}

	/*
	 * 6. The band under the first-run wizard's scrim, which is the one overlay that
	 * covers the whole window on a first launch. Cheap here (the app is already
	 * driven) and it answers the "with the wizard up" half: the band is IN FLOW now,
	 * so the scrim dims it like everything else rather than the band painting over
	 * the scrim.
	 *
	 * WHY THE DAEMON COMES BACK, WITH ONE CAPABILITY CENSUS LEFT IN: the wizard is not
	 * a stored preference - `useCheckFirstTimeUser` decides it from the backend's
	 * provider CENSUS, and the store's completion flag only says the user has seen it
	 * before. Un-seeding the store at this point in the run (the daemon is DOWN here -
	 * that is what the connectivity band is) leaves the app unable to decide anything:
	 * no capabilities means no census, and the legacy fallback reads a route the
	 * desktop bearer 503s, so the decision stays "pending" and no wizard ever opens.
	 * Measured: the state waited its full 150 s with `onboardingVisible: false` and
	 * killed the run. So the stub is started again - answering `/v1/auth/providers`
	 * with an empty census, which is "first_time" - while the feature set stays
	 * NARROWED, which keeps the compatibility band up. That is the pair this state is
	 * about: a band, and the scrim over it. `auth` is the one capability the narrowed
	 * set keeps, because without it the census is not even asked for.
	 */
	if (wanted("scrim")) {
		state.features = { ...PARTIAL_FEATURES, auth: 1 };
		startStub();
		recordFile = writeRecord(process.pid);
		heartbeatArmed = true;
		heartbeat = setInterval(() => {
			if (heartbeatArmed) writeRecord(process.pid);
		}, 5_000);
		await evaluate(`(() => {
			localStorage.removeItem("onboarding-storage");
			location.reload();
			return "unseeded";
		})()`).catch(() => {});
		await wait(6_000);
		const scrim = await holdFor(
			"scrim",
			(m) => m.onboardingVisible === true && m.bandCount >= 1,
			150_000,
		);
		await record("scrim", scrim);
	}
	/*
	 * A state that violated an acceptance claim fails the RUN, so the exit status
	 * carries the verdict: a rig whose only throws are state timers and window mode
	 * leaves a `coveredByBand: true` in the JSON for a reader to notice (review
	 * round 1, N4). Raised here rather than in the `finally` below, where a throw
	 * would mask whatever the teardown was doing.
	 */
	if (failures.length)
		throw new Error(
			`${failures.length} acceptance check(s) failed on ${LABEL}`,
		);
} finally {
	heartbeatArmed = false;
	if (heartbeat) clearInterval(heartbeat);
	for (const started of stubServers) if (started.listening) started.close();
	for (const child of children) await stop(child);
	reapScratchProfiles();
	const logFile = join(PROFILE, "logs", "backend-service.log");
	if (existsSync(logFile))
		writeFileSync(
			join(FRAMES, `${LABEL}-backend-service.log`),
			readFileSync(logFile),
		);
	rmSync(ROOT, { recursive: true, force: true });
	if (failures.length) {
		console.log(`# FAILURES (${failures.length})`);
		for (const failure of failures) console.log(`#   ${failure}`);
	}
	summary.failures = failures;
	writeFileSync(
		join(FRAMES, `${LABEL}-geometry.json`),
		`${JSON.stringify(summary, null, 2)}\n`,
	);
	console.log(`# states written to ${FRAMES}/${LABEL}-geometry.json`);
}
