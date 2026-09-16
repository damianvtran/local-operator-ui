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
 *   2. `absent` - the configured address answers nothing. Cell: the honest copy
 *      (which the base tree does not say at all). The `unattachable` state the
 *      spawn gate produces is NOT photographable in this stub environment; the
 *      scene's own comment says why and what covers it instead.
 *   3. `flap` - the same daemon, attached, whose `/health` then exceeds one
 *      probe's budget while its session reads keep answering. Cell: the
 *      conversation list holds. This is the operator's own condition, modelled.
 *   4. `withdrawn` - the same shape one layer up: an attached backend whose
 *      capability answer stops opening the catalogue. Cell: the list stays
 *      mounted with the reason beside it, and the app re-asks on its own. This
 *      is the renderer half of "all the active chats and teams disappear".
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
import { dirname, join } from "node:path";
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
		"usage: attach-frame-evidence.mjs --out <dir> --label <tree> [--scene attached|absent|flap|withdrawn|all]",
	);
	process.exit(1);
}
const WIDTH = Number(process.env.ATTACH_FRAME_WIDTH ?? 1380);
const HEIGHT = Number(process.env.ATTACH_FRAME_HEIGHT ?? 900);
/**
 * The sidebar saying the catalogue gate is closed, in either tree's words.
 *
 * Deliberately a fact about the SURFACE rather than one tree's copy: the before
 * half of this pair says "Update the backend to use canonical chats" and the head
 * says which of the two causes it observed, and both are only renderable after
 * the renderer has re-read the capabilities answer. Neither can appear while the
 * gate is open, which is what makes this a detector for "the withdrawal reached
 * the window" rather than for a particular sentence.
 */
mkdirSync(OUT, { recursive: true });

const ROOT = mkdtempSync(join(tmpdir(), "lop-ui-frame-evidence-"));
const SESSION_ID = "f".repeat(12);
const SESSION_TITLE = "Frame evidence conversation";
/*
 * The rest of a healthy backend's answer, so a scene's frames show the app
 * talking to a server it can use rather than a wall of 404s the stub never
 * served. Every shape below is the client's own (`profile-hooks.ts`,
 * `shell.stories.tsx`'s CONFIG): a stub that answered with a body the app could
 * not parse would make a scene photograph the stub's shortcomings.
 */
const STUB_CONFIG = {
	version: "0.12.8",
	metadata: {
		created_at: "2025-06-18T11:02:00Z",
		last_modified: "2026-09-15T00:00:00Z",
		description: "Frame-evidence configuration",
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
const STUB_PROFILE = {
	name: "frame-agent",
	kind: "role",
	source: "builtin",
	agent_id: null,
	description: "The frame rig's own agent",
	tools: null,
	effort: null,
	delegate: false,
};
const STUB_TEAM = {
	id: "frame-team",
	name: "frame-team",
	description: "The frame rig's own team",
	manager: "frame-agent",
	members: [],
};
const CLAIM_KEY = "a".repeat(64);
/**
 * The credential a managed launch would have persisted, for the scenes that
 * attach to a STUB backend.
 *
 * WHY the scenes need one at all. `requestDesktop` forces
 * `desktop_available: false` on a capabilities answer when this app holds no
 * token, and `desktopFeatureEnabled` then fails closed - so without a credential
 * the catalogue gate never opens, the sidebar renders no list, and a scene
 * documents a cell it does not photograph. That is exactly QA round 1's Q-3 on
 * the flap scene, and it was invisible until the stub's own answers were read
 * back. Seeding it is also the honest model: the state these scenes are about is
 * an app that CAN drive the daemon it is talking to.
 */
const DESKTOP_TOKEN = "b".repeat(64);

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
/** Every profile this run booted, so the teardown can read each one's own log. */
const bootedProfiles = [];
function launch(command, args, env) {
	const child = spawn(command, args, {
		cwd: REPO,
		env,
		stdio: ["ignore", "pipe", "pipe"],
		/*
		 * Own the whole tree, not just the pid we are handed.
		 *
		 * WHY (rig hygiene, 2026-09-15): `node_modules/.bin/electron` is a node
		 * SHIM that spawns the real `Electron.app` as its CHILD. Killing the shim
		 * leaves the app running, reparented to launchd, holding its devtools port
		 * and a Dock entry - measured on this machine as leftover trees rooted at
		 * `Electron.app/Contents/MacOS/Electron` with `ppid=1`, several accumulated
		 * across scenes before they were reaped by hand. That is also what made a
		 * later scene on the same port answer "port N already has a devtools
		 * endpoint", which reads like a slow launch rather than a collision.
		 * `detached` puts the shim in its own process group, which Electron's
		 * children inherit, and `stop` below signals the GROUP. Same rule as
		 * `scripts/browser-host-proof.mjs`.
		 */
		detached: true,
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
	/*
	 * Signal the process GROUP first, falling back to the pid only when there is no
	 * group to signal (it has already gone away). This is what actually stops the
	 * app rather than its shim.
	 */
	const killTree = (signal) => {
		try {
			process.kill(-child.pid, signal);
		} catch {
			try {
				child.kill(signal);
			} catch {
				/* already dead */
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
 * The net under `stop`: reap anything still running against THIS run's scratch
 * profiles, by the profile each launch named on its own command line.
 *
 * WHY both mechanisms rather than either one. The group kill is structural and
 * covers the shim/app split, but a process can leave its group (a Chromium helper
 * that re-execs under a new session, or an app relaunched by its own crash
 * handler), and the failure mode of missing one is the operator's Dock filling
 * with apps this rig left behind. The profile path is unique to this run - a fresh
 * `mkdtemp` under the system temp dir - so this cannot match a process anybody
 * else owns, which is the property `pkill` would otherwise need a much narrower
 * pattern for.
 */
function reapScratchProfiles() {
	if (process.platform === "win32") return;
	try {
		/*
		 * Escaped, because `pkill -f` reads the pattern as an extended regex: a
		 * `TMPDIR` containing a metacharacter would widen a match that is supposed to
		 * name exactly one run's scratch path. The unique `mkdtemp` suffix is what
		 * keeps this off other processes; escaping is what keeps that property from
		 * depending on where the host puts its temp files.
		 */
		const literal = ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		spawnSync("pkill", ["-f", `user-data-dir=${literal}`], {
			stdio: "ignore",
		});
	} catch {
		/* No pkill on this host, or nothing matched: the group kill already ran. */
	}
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
 * The app's view of the connection, read from the page.
 *
 * The banner is read by ROLE, not by class: it is the app's own alert surface,
 * and a selector this rig invented would be a claim about the DOM rather than
 * about what a reader sees.
 */
const READ_PAGE = `(async () => {
	/*
	 * The first alert that actually SAYS something: a bare querySelector for a
	 * role=alert element picks whichever empty live region the app mounted first,
	 * which read as "no banner" over a window that was carrying one.
	 */
	const banner =
		[...document.querySelectorAll('[role="alert"]')]
			.map((node) => node.innerText.replace(/\\s+/g, " ").trim())
			.filter(Boolean)[0] ?? null;
	/*
	 * The seeded conversation as the sidebar actually renders it. TWO markers,
	 * because two kinds of scene seed a catalogue: the live attached scene starts
	 * a real conversation whose first transcript row is a numbered row marker, and the stub
	 * scenes fabricate a row titled "Frame evidence conversation". Reading only the
	 * first made every stub scene report "no sessions" over a sidebar that was
	 * showing one - which is how a frame that was correct got reported as a list
	 * that had vanished. This reads the app's own text rather than a selector this
	 * rig invented: a data-session-id attribute was the first attempt and reads
	 * zero on a sidebar that is fully populated - no row carries one.
	 */
	const text = document.body.innerText;
	const seededRow =
		/\[row 0000\]/.test(text) || text.includes("Frame evidence conversation");
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
		banner,
		seeded_row_visible: seededRow,
		composer_present: Boolean(composer),
		snapshot: snapshot && typeof snapshot === "object"
			? { state: snapshot.state, reachable: undefined, url: snapshot.url, pid: snapshot.pid, owned: snapshot.owned, unanswered: snapshot.unanswered, detail: snapshot.detail }
			: snapshot,
		/*
		 * The chat sidebar's own register, read by the app's OWN landmark: it is
		 * a nav with the aria-label "Chats", while the app rail is a second nav beside
		 * it, so a bare querySelector("nav") read the rail and reported an empty
		 * sidebar over a panel full of rows.
		 *
		 * It is what the withdrawal scene is about - the list is either still on
		 * screen with a sentence beside it, or gone with nothing said.
		 */
		sidebar: (document.querySelector('nav[aria-label="Chats"]')?.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 600),
		/*
		 * D2's probe: the content pane beside the sidebar, and WHY it is blank.
		 *
		 * The design round measured the pane as a single flat colour in the same
		 * frames the sidebar paints, with the designed sentence present in the DOM.
		 * "Present in the DOM but not painted" has two shapes and the pixels cannot
		 * tell them apart: the node is hidden or clipped inside its own subtree, or
		 * the branch that should hold it is not the one taken. So this reads the
		 * deepest element carrying one of the pane's sentences and walks its
		 * ancestors, with the geometry that decides it - the size each one actually
		 * got, its display/overflow/height, and checkVisibility(), which is the
		 * engine's own answer to "would a reader see this".
		 */
		pane: (() => {
			const wanted = [
				"Update the backend to use canonical chats",
				"cannot use the backend's desktop controls",
				"Choose an agent or team",
				"Start a chat",
				"Connecting to the backend",
			];
			const hits = [...document.querySelectorAll("p, div, section, h1")].filter((el) =>
				wanted.some((w) => (el.textContent || "").includes(w)),
			);
			if (hits.length === 0) return { sentence: null, chain: [] };
			const node = hits[hits.length - 1];
			const chain = [];
			for (let el = node; el && el !== document.documentElement; el = el.parentElement) {
				const r = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				chain.push({
					tag: el.tagName.toLowerCase(),
					cls: String(el.className || "").slice(0, 48),
					w: Math.round(r.width),
					h: Math.round(r.height),
					y: Math.round(r.top),
					display: style.display,
					overflow: style.overflow,
					height: style.height,
					minHeight: style.minHeight,
					visible:
						typeof el.checkVisibility === "function"
							? el.checkVisibility()
							: null,
				});
			}
			return {
				sentence: wanted.find((w) => (node.textContent || "").includes(w)) || null,
				chain,
			};
		})(),
		/*
		 * The full-bleed band at the top of the window. It has NO role of its own -
		 * the compatibility banner is a setup state and deliberately does not
		 * announce itself assertively - so the only honest read is the position both
		 * banners share. Without it this rig reported "no banner" over a window
		 * carrying one, which is how a frame that was correct got reported as missing
		 * the statement it was showing.
		 */
		band: ([...document.querySelectorAll(".fixed.inset-x-0.top-0")]
			.map((node) => node.innerText.replace(/\\s+/g, " ").trim())
			.filter(Boolean)[0] ?? null),
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
	bootedProfiles.push(name);
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
	const first = await waitForPage(debugPort); // The seed lands after the first paint and reloads, so the second read is the
	// app as a returning user rather than the onboarding one.
	if (
		!first.composer_present ||
		first.first_lines.includes("Connect a provider")
	)
		await seedOnboarding(debugPort);
	// The reload has to finish painting before anything reads the page again.
	await wait(3_000);
	return app;
}

/**
 * Write the token a managed launch persists, into the userData directory the
 * app will actually read.
 *
 * Which directory that is was MEASURED rather than assumed: `--user-data-dir`
 * sets `app.getPath("userData")` (probe: `USERDATA=/private/tmp/probe-ud/profile`
 * for a launch passed `--user-data-dir=/tmp/probe-ud/profile`), so the file
 * belongs beside the profile this scene boots with - not under the scratch HOME,
 * which is where the rig used to look for the app's own log and never found it.
 */
function seedDesktopToken(profileName) {
	const file = join(ROOT, `profile-${profileName}`, "desktop-token");
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	writeFileSync(file, DESKTOP_TOKEN, { mode: 0o600 });
}

/** A Local Operator daemon answering at `port`, without a serve record. */
function stubDaemon(port, state) {
	const server = createServer((request, response) => {
		const path = (request.url ?? "").split("?")[0];
		/*
		 * Every path this stub was asked for, when the caller keeps the list: what the
		 * app asked, and WHEN it asked it, is evidence that a recovery was the app's
		 * own doing rather than the operator's (the withdrawal scene's whole cell).
		 */
		state.requests?.push({ path, at: Date.now() });
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
			/*
			 * `withdrawn` is the operator's reported condition: the app reaches a
			 * backend that answers, and the answer no longer opens the desktop plane
			 * (a daemon it holds no token for reports `desktop_available: false`). The
			 * default response is unchanged, byte for byte, so the scenes that predate
			 * this switch keep the frames they were committed with.
			 */
			json(200, {
				status: 200,
				result: state.withdrawn
					? { desktop_available: false }
					: { desktop_available: true, features: state.features },
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
			json(200, { status: 200, result: { profiles: [STUB_PROFILE] } });
			return;
		}
		if (path === "/v1/desktop/teams") {
			json(200, { status: 200, result: { teams: [STUB_TEAM] } });
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
					/*
					 * The reads this daemon could not answer, additive and optional
					 * (local-operator #1170). Absent for every other scene, so the
					 * default rendering stays the one the other frames photograph;
					 * the flap scene sets it to `liveness` because a daemon under a
					 * probe it cannot meet is exactly the machine that cannot read
					 * which chats are running (design round 2, D11 - the state had no
					 * frame at all until this scene carried it).
					 */
					...(state.degradedReads?.length
						? { degraded: state.degradedReads }
						: {}),
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

/**
 * Keep a hand-written record fresh: a stale heartbeat reads as `wedged`.
 *
 * This WRITES and returns nothing. Arming the refresh is the caller's job
 * (`armHeartbeat` below) and that split is the fix for the rig's worst defect:
 * this function used to end `return setInterval(() => writeRecord(...), 5000)`,
 * whose callback called this function again and armed another interval every
 * firing. Measured by QA on this rig: 290,382 pending `Timeout` resources growing
 * at +488/s, the main thread pinned in `node::fs::Open`, and the rig's OWN stub
 * daemon starved until it stopped answering `/health` - so the app under test read
 * its backend as stopped and every scene produced one frame and then nothing for
 * five minutes. A writer that arms a timer around itself is a rig that saturates
 * itself, and it looked exactly like a machine-lease failure.
 */
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
	/*
	 * The periodic half is `armHeartbeat`, at the call site: this function is called
	 * by a timer and must never arm one.
	 */
}

/**
 * Write the record now, then keep it fresh on a cadence, and hand back the one
 * handle the scene clears at the end of its own scene.
 */
function armHeartbeat(runDir, port, pid) {
	writeRecord(runDir, port, pid);
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
	const recordFile = join(
		configDir,
		"run",
		"serve",
		`${daemon.child.pid}.json`,
	);
	const deadline = Date.now() + 60_000;
	while (!existsSync(recordFile) && Date.now() < deadline) await wait(250);
	if (!existsSync(recordFile))
		throw new Error(`no serve record: ${daemon.text()}`);
	await bootApp("attached", `http://127.0.0.1:${port}`, configDir, 46111);
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
	const state = {
		slowHealth: false,
		healthDelayMs: 3_500,
		reads: [],
		requests: [],
	};
	const server = stubDaemon(port, state);
	// Its own config root with NO record: the address answers, and nothing
	// describes it - the 09:17 shape.
	const configDir = join(ROOT, "config-absent");
	mkdirSync(configDir, { recursive: true });
	/*
	 * What this scene can photograph here, and what it cannot.
	 *
	 * With the backend manager ENABLED the app reaches the spawn gate, which is
	 * the path the `unattachable` state is produced by - and in this stub
	 * environment it also leaves the renderer in its error boundary (`Cannot read
	 * properties of undefined (reading hosting)`), because the stub serves no
	 * `/v1/config`. Measured: the same error appears on the BASE tree against the
	 * same stub, so it is pre-existing and not this branch's, but it makes the
	 * manager-enabled scene unscreenshotable rather than evidence. The manager is
	 * therefore off, and the frame this scene writes is the ADDRESS-WITH-NOTHING
	 * state - "No Local Operator daemon was found and this app is configured not
	 * to start one" - which is the copy a reader sees when the configured address
	 * is empty. The unattachable copy itself is covered by the Storybook pair and
	 * by the manager-level rig's cell 3.
	 */
	await bootApp("absent", `http://127.0.0.1:${port}`, configDir, 46121, {
		manager: false,
	});
	// Let main run its discovery pass and settle the state it publishes.
	let page = null;
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		page = await readPage(46121);
		if (page.banner) break;
		await wait(1_000);
	}
	await capture(46121, join(OUT, `${LABEL}-absent.png`));
	summary.scenes.absent = page;
	server.close();
	return page;
}

async function sceneFlap() {
	const port = 46130;
	const configDir = join(ROOT, "config-flap");
	const runDir = join(configDir, "run", "serve");
	mkdirSync(runDir, { recursive: true });
	const state = {
		slowHealth: false,
		healthDelayMs: 3_500,
		reads: [],
		requests: [],
		/*
		 * The features the catalogue gate needs to OPEN, which this scene did without
		 * and could not: its documented cell is "the conversation list holds through
		 * the flap", and with no advertised capability the gate never opens, so the
		 * frame showed no list at all and only "Update the backend to use canonical
		 * chats" - the opposite of the cell (QA round 1, Q-3). The flap is a change in
		 * what a PROBE can read on a connection whose reads still answer; a shut gate
		 * is not part of the scene.
		 */
		features: { session_catalogue: 2, profile_catalogue: 1, team_catalogue: 1 },
		/*
		 * And the marker #1170 added, so the Active section's own sentence is in
		 * the frame: the flap is a daemon that cannot answer a probe, which is the
		 * same condition as a liveness read that did not answer, and the sidebar
		 * has to say so rather than claim nothing is running over rows it holds
		 * (design round 2, D11).
		 */
		degradedReads: ["liveness"],
	};
	const server = stubDaemon(port, state);
	// A record this time, so the app ATTACHES to the stub: the flap is a change in
	// what the probes can read on a connection that is otherwise fine.
	seedDesktopToken("flap");
	const heartbeat = armHeartbeat(runDir, port, process.pid);
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

async function sceneWithdrawn() {
	const port = 46140;
	const configDir = join(ROOT, "config-withdrawn");
	const runDir = join(configDir, "run", "serve");
	mkdirSync(runDir, { recursive: true });
	const state = {
		slowHealth: false,
		healthDelayMs: 3_500,
		reads: [],
		requests: [],
		/*
		 * The features the catalogue gate needs to OPEN. Without them the sidebar
		 * would start shut, and a gate that was never open cannot be withdrawn - the
		 * scene would then photograph the first-load state and say nothing about the
		 * report.
		 */
		features: { session_catalogue: 2, profile_catalogue: 1, team_catalogue: 1 },
		withdrawn: false,
	};
	const server = stubDaemon(port, state);
	// A record, so the app ATTACHES to the stub rather than declining it: the
	// withdrawal is a change in what a connected backend advertises. The credential
	// is what makes the gate OPENABLE in the first place - see `DESKTOP_TOKEN`.
	seedDesktopToken("withdrawn");
	const heartbeat = armHeartbeat(runDir, port, process.pid);
	await bootApp("withdrawn", `http://127.0.0.1:${port}`, configDir, 46141);

	let page = null;
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		page = await readPage(46141);
		if (page.seeded_row_visible) break;
		await wait(1_000);
	}
	const before = page;
	const askedBefore = capabilitiesAsked(state);
	await capture(46141, join(OUT, `${LABEL}-gate-open.png`));

	state.withdrawn = true;
	const withdrawnAt = Date.now();
	/*
	 * THE CELL: nobody touches anything. The measurement is the app's OWN
	 * re-negotiation - the capabilities ask count going up with no input at all -
	 * because that is the mechanism the report is about ("it needs a refresh").
	 *
	 * WHY not the sentence: on this head the withdrawal is stated ONCE, by the
	 * full-bleed compatibility banner, and the sidebar deliberately does not repeat
	 * it (design round 1, D3). Waiting for the sidebar's own sentence here would
	 * time out on a tree that is behaving correctly, which is exactly the kind of
	 * assertion this rig exists to avoid.
	 */
	let after = before;
	const selfDeadline = withdrawnAt + 70_000;
	while (Date.now() < selfDeadline) {
		after = await readPage(46141);
		if (capabilitiesAsked(state) > askedBefore) break;
		await wait(1_000);
	}
	const noticedOnItsOwn = capabilitiesAsked(state) > askedBefore;
	await wait(2_000);
	after = await readPage(46141);
	await capture(46141, join(OUT, `${LABEL}-gate-withdrawn.png`));
	const askedAtWithdrawal = capabilitiesAsked(state);

	/*
	 * Then the gesture the report describes: the operator coming back to the
	 * window. It is the ONLY path the before half has, and it is the falsification
	 * of the fix - a head that healed only when poked would show the same picture
	 * here as in the frame above.
	 *
	 * The event is `visibilitychange`, and that is measured rather than assumed:
	 * React Query 5.73.3's `focusManager` subscribes to `window`'s
	 * `visibilitychange` alone (`query-core/build/modern/focusManager.js`), so the
	 * `focus` event this scene used to dispatch was heard by nobody - which is why
	 * the three frames came back byte-identical (QA round 1, Q-2). The wait below
	 * is what makes it work on the BEFORE tree: `refetchOnWindowFocus` refetches a
	 * STALE query, and that tree's capabilities `staleTime` is 60 s with nothing
	 * else re-asking, so the poke has to land after it.
	 */
	const pokeAfter = withdrawnAt + 65_000;
	while (Date.now() < pokeAfter) await wait(1_000);
	const askedBeforePoke = capabilitiesAsked(state);
	await evaluate(
		46141,
		'window.dispatchEvent(new Event("visibilitychange")), "poked"',
	);
	await wait(6_000);
	const poked = await readPage(46141);
	await capture(46141, join(OUT, `${LABEL}-gate-poked.png`));

	summary.scenes.withdrawn = {
		before,
		after,
		poked,
		noticed_on_its_own: noticedOnItsOwn,
		withdrawal_observed_after_ms: Date.now() - withdrawnAt,
		/*
		 * Every path the app asked this stub for, with a count, so a scene that
		 * photographs the wrong thing says so in its own summary rather than only in
		 * the picture. This is how the missing token above was found: the app's reads
		 * never reached /v1/desktop/sessions at all.
		 */
		asked: requestCounts(state),
		/*
		 * Capability asks, at four points. The pair that matters is
		 * `..._before` -> `..._before_poke`: they are read either side of the
		 * withdrawal with NO interaction in between, so on this head that number grows
		 * entirely on the app's own cadence. `..._at_end` is the poke's own account of
		 * itself on each tree.
		 */
		capabilities_asked_before: askedBefore,
		capabilities_asked_at_withdrawal: askedAtWithdrawal,
		capabilities_asked_before_poke: askedBeforePoke,
		capabilities_asked_at_end: capabilitiesAsked(state),
	};
	clearInterval(heartbeat);
	server.close();
}

/** How many times the app asked the stub what it can do. */
function capabilitiesAsked(state) {
	return state.requests.filter((entry) => entry.path === "/v1/capabilities")
		.length;
}

/** Every path this stub served, and how often. */
function requestCounts(state) {
	const counts = {};
	for (const entry of state.requests) {
		counts[entry.path] = (counts[entry.path] ?? 0) + 1;
	}
	return counts;
}

const scenes = {
	attached: sceneAttached,
	absent: sceneUnattachable,
	flap: sceneFlap,
	withdrawn: sceneWithdrawn,
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
	reapScratchProfiles();
	writeFileSync(
		join(OUT, `${LABEL}-frames.json`),
		JSON.stringify(summary, null, 2),
	);
	/*
	 * The app's own backend log, per booted profile. `--user-data-dir` IS the
	 * userData path (measured), so the log lives beside the profile rather than under
	 * the scratch HOME - where this rig used to look, which is why a broken scene
	 * produced frames and no diagnostics at all.
	 */
	for (const name of bootedProfiles) {
		const logFile = join(
			ROOT,
			`profile-${name}`,
			"logs",
			"backend-service.log",
		);
		if (existsSync(logFile)) {
			writeFileSync(
				join(OUT, `${LABEL}-${name}-backend-service.log`),
				readFileSync(logFile),
			);
		}
	}
	rmSync(ROOT, { recursive: true, force: true });
}
