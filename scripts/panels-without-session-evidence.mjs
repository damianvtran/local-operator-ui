#!/usr/bin/env node
/**
 * The panels-without-a-session frames: the SAME six gestures on two trees.
 *
 *     node scripts/panels-without-session-evidence.mjs \
 *       --out <dir> --label <tree> [--scene <name>|all] [--debug-port <n>]
 *
 * WHY A RIG AND NOT SIX HAND-TAKEN FRAMES. Every claim this change makes is a
 * claim about a GESTURE: typing `/analytics` on a pane with no conversation,
 * choosing Analytics from the palette while reading Settings, choosing Info
 * while the browser route is up. A still that was driven by hand cannot answer
 * "was that the same gesture the other tree refused?", and the before/after pair
 * is the whole evidence - so the gestures are written down here, run against
 * both trees with the same code, and recorded beside their own DOM reads.
 *
 * WHAT MAKES A PAIR HONEST. `--label` names the tree, and the rig never branches
 * on it: the same scene body runs against both, so a difference in the frames is
 * a difference in the app. The one thing the label decides is where the run
 * record is written.
 *
 * ISOLATION, and it is not optional: a throwaway HOME, config dir, user-data
 * profile, backend and debug port, an allowlisted environment, and
 * `VITE_DISABLE_BACKEND_MANAGER=true` so this app can never spawn a backend of
 * its own on the operator's machine. Other Local Operator sessions run on this
 * host; the backend here serves a config dir under `/tmp` and nothing else. The
 * window is never shown (`LOCAL_OPERATOR_UI_WINDOW_MODE=headless`), the port is
 * 8080 because the renderer's own CSP names only 1111 and 8080 and anywhere else
 * the fetch is refused by policy with no request sent.
 *
 * The app must have been BUILT against that same address -
 * `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build` - because the
 * renderer's copy of the address is inlined at build time, and the run refuses
 * to start if the build disagrees.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
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
const DEBUG_PORT = Number(argValue("--debug-port", "9463"));
if (!OUT) {
	console.error(
		"usage: panels-without-session-evidence.mjs --out <dir> --label <tree> [--scene <name>|all] [--debug-port <n>]",
	);
	process.exit(1);
}

const WIDTH = 1380;
const HEIGHT = 900;
const BACKEND_PORT = 8080;
const API_URL = `http://127.0.0.1:${BACKEND_PORT}`;
/*
 * A synthetic bearer, not a credential: it authenticates the app to a backend
 * this run starts, on a config dir under /tmp, and is written only into this
 * run's scratch profile.
 */
const TOKEN = "c".repeat(64);

const ROOT = mkdtempSync(join(tmpdir(), "lop-ui-panels-evidence-"));
const CONFIG_DIR = join(ROOT, "config");
const HOME = join(ROOT, "home");
mkdirSync(CONFIG_DIR, { recursive: true });
mkdirSync(HOME, { recursive: true });
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const children = [];
/** The most recent launch, kept so a failed boot can report the app's own log. */
let lastLaunch = null;
function launch(command, args, env) {
	const child = spawn(command, args, {
		cwd: REPO,
		env,
		stdio: ["ignore", "pipe", "pipe"],
		/*
		 * Own the whole tree: `node_modules/.bin/electron` is a shim that spawns
		 * the real `Electron.app` as its child, so killing the shim leaves the app
		 * reparented to launchd, holding its debug port and a Dock entry.
		 */
		detached: true,
	});
	children.push(child);
	lastLaunch = { child, text: () => output };
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

/* ------------------------------- the backend ------------------------------- */

async function startBackend() {
	const backend = launch(
		"local-operator",
		[
			"serve",
			"--host",
			"127.0.0.1",
			"--port",
			String(BACKEND_PORT),
			/*
			 * The mock provider: these scenes are about what the SHELL does with a
			 * destination, not about a model's answer, and a real provider would put
			 * an API key and a bill in the path of a UI frame.
			 */
			"--hosting",
			"test",
			"--model",
			"mock-model",
		],
		{
			...baseEnv,
			HOME,
			LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
			LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
			LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
			LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
		},
	);
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${API_URL}/v1/capabilities`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
			});
			if (response.ok) return backend;
		} catch {
			/* not up yet */
		}
		await wait(500);
	}
	throw new Error(`the backend never answered: ${backend.text().slice(-400)}`);
}

/* --------------------------------- the app --------------------------------- */

function appEnv() {
	return {
		...baseEnv,
		HOME,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
		/*
		 * The build must be pointed at this run's backend, because the renderer
		 * inlines the address and the CSP allows only 1111 and 8080. Asserted rather
		 * than assumed: a tree built for the default would leave the renderer talking
		 * to the operator's own backend while this run believes otherwise.
		 */
		VITE_LOCAL_OPERATOR_API_URL: API_URL,
		VITE_DISABLE_BACKEND_MANAGER: "true",
	};
}

function assertBuiltForThisBackend() {
	const assets = join(REPO, "out", "renderer", "assets");
	if (!existsSync(assets)) {
		throw new Error("no built renderer found; run `pnpm build` first");
	}
	/*
	 * The BUNDLE, not `index.html`: the document's CSP also names
	 * `127.0.0.1:8080`, so a check against the HTML passes on every build ever made
	 * and certifies nothing. The renderer's copy of the address lives in the
	 * bundled module, which is the artefact this run actually depends on.
	 */
	const naming = readdirSync(assets)
		.filter((name) => name.endsWith(".js"))
		.some((name) => readFileSync(join(assets, name), "utf8").includes(API_URL));
	if (naming) return;
	throw new Error(
		`the built renderer does not name ${API_URL}; rebuild with VITE_LOCAL_OPERATOR_API_URL=${API_URL} pnpm build`,
	);
}

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

/** One CDP call, awaited by its own id. */
async function call(debugPort, method, params = {}) {
	return withPage(debugPort, (socket) => {
		const result = new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`${method} timed out`)),
				25_000,
			);
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id !== 1) return;
				clearTimeout(timer);
				if (message.error) reject(new Error(JSON.stringify(message.error)));
				else resolve(message.result);
			});
			socket.send(JSON.stringify({ id: 1, method, params }));
		});
		return result;
	});
}

async function evaluate(debugPort, expression) {
	const result = await call(debugPort, "Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	if (result?.result?.value === undefined)
		throw new Error("the page answered nothing");
	return result.result.value;
}

const READ_PAGE = `(() => {
	const dialog = document.querySelector('[role="dialog"]');
	const title = dialog
		? (dialog.querySelector('[id$="-title"]')?.textContent
			?? dialog.getAttribute('aria-label')
			?? '')
		: null;
	const body = document.body.innerText || '';
	const browserContent = document.querySelector('[data-tour-tag="browser-content"]');
	return {
		/* The HASH: this app routes with HashRouter, so pathname is the built
		   file's own path and the user's route is in the fragment. Reported the
		   way useLocation reports it (no leading hash). */
		route: location.hash.replace(/^#/, "") || "/",
		composer: Boolean(document.querySelector('[data-tour-tag="chat-input-textarea"]')),
		dialog_title: title,
		regions: [...document.querySelectorAll('[role="region"][aria-label]')]
			.map((node) => node.getAttribute('aria-label')),
		refusal: /needs an open conversation/i.test(body),
		conversation_section: /This conversation/.test(body),
		session_scope: /This session only/.test(body),
		all_sessions: /all sessions/.test(body),
		empty_notice: /Nothing to report here\\./.test(body),
		suppressed_by: browserContent
			? browserContent.getAttribute('data-suppressed-by')
			: null,
		paused_note: Boolean(document.querySelector('[data-tour-tag="browser-paused"]')),
		text: body.replace(/\\s+/g, ' ').trim().slice(0, 600),
	};
})()`;

/** The last failure a page read produced, so a stuck wait can say why. */
let lastReadError = null;

async function read(debugPort) {
	try {
		/*
		 * The object itself, not `JSON.parse` of it: `returnByValue` hands the
		 * evaluated value back as a value, so parsing it reads "[object Object]" and
		 * fails on every read while the app is perfectly healthy - which is how the
		 * first run of this rig reported "the page never settled" against a live
		 * window.
		 */
		const value = await evaluate(debugPort, READ_PAGE);
		lastReadError = null;
		return value;
	} catch (error) {
		lastReadError = String(error);
		throw error;
	}
}

/**
 * The stable PROJECTION of a page read, for the settle comparison.
 *
 * Not the whole read: `text` carries the transcript, a spinner's own label and
 * anything animating, so a page holding a spinner never compares equal and the
 * wait always times out. The fields below are the ones every scene is a claim
 * about, and the text is still recorded in the run record.
 */
const settleKey = (page) =>
	JSON.stringify({
		route: page.route,
		composer: page.composer,
		dialog_title: page.dialog_title,
		regions: page.regions,
		refusal: page.refusal,
		conversation_section: page.conversation_section,
		session_scope: page.session_scope,
		all_sessions: page.all_sessions,
		suppressed_by: page.suppressed_by,
		paused_note: page.paused_note,
	});

/** Wait for the page to answer at all, then for its shape to stop changing. */
async function settle(debugPort, { timeoutMs = 60_000, quietMs = 2_500 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	let lastChange = Date.now();
	while (Date.now() < deadline) {
		let snapshot = null;
		try {
			snapshot = await read(debugPort);
		} catch {
			/* no page context yet */
		}
		if (snapshot) {
			const key = settleKey(snapshot);
			if (key !== last) {
				last = key;
				lastChange = Date.now();
			} else if (Date.now() - lastChange >= quietMs) {
				return snapshot;
			}
		}
		await wait(400);
	}
	throw new Error(`the page never settled; last read ${last}`);
}

async function shot(debugPort, name) {
	const { data } = await call(debugPort, "Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		captureBeyondViewport: false,
	});
	const path = join(OUT, `${name}.png`);
	writeFileSync(path, Buffer.from(data, "base64"));
	return path;
}

/**
 * A key press, as the composer sees a real one.
 *
 * The triplet (`rawKeyDown`, `char`, `keyUp`) is not decoration: the composer's
 * keydown handler ignores a lone `keyDown`-only dispatch, which is how an
 * earlier rig pressed Enter twice and sent nothing.
 */
async function press(debugPort, key, { code, vk, modifiers = 0, text = "" }) {
	for (const type of ["rawKeyDown", "char", "keyUp"]) {
		await call(debugPort, "Input.dispatchKeyEvent", {
			type,
			key,
			code,
			modifiers,
			windowsVirtualKeyCode: vk,
			nativeVirtualKeyCode: vk,
			...(type === "char" && text ? { text, unmodifiedText: text } : {}),
		});
		await wait(60);
	}
}

async function type(debugPort, value) {
	await call(debugPort, "Input.insertText", { text: value });
	await wait(500);
}

/**
 * Click the first control whose own label is `text`.
 *
 * A text match rather than a selector this rig invents: the sidebar's rows, the
 * composer's buttons and the palette's own rows are the app's labelled
 * affordances, and a class name or a `data-` hook written here would be this
 * file's claim about the DOM rather than the app's about itself.
 */
async function clickByText(debugPort, text) {
	return evaluate(
		debugPort,
		`(() => {
			const wanted = ${JSON.stringify(text)};
			const nodes = [...document.querySelectorAll('button, a, [role="option"], [role="menuitem"], [role="tab"]')];
			const hit = nodes.find((node) =>
				(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim() === wanted
				&& !node.disabled);
			if (!hit) return 'no ' + wanted;
			hit.click();
			return 'clicked ' + wanted;
		})()`,
	);
}

/** Stage a draft pane: the composer only exists once a chat is being started. */
async function stageDraftPane(debugPort) {
	for (let attempt = 0; attempt < 30; attempt++) {
		const page = await read(debugPort);
		if (page.composer) return page;
		await clickByText(debugPort, "New chat");
		await wait(1_500);
	}
	throw new Error("the draft pane never staged a composer");
}

/**
 * Pick the palette's ACTIVE row with a real pointer, through CDP's own input
 * pipeline.
 *
 * Not `element.click()`: a synthesised DOM click is this rig's claim about the
 * handler rather than a gesture, and the palette's own contract is about what a
 * POINTER does to a row. The coordinates are real, the press and release are
 * real, and the row is identified the way the app identifies it
 * (`#command-palette-results [role="option"]`, the first one - which is the row
 * the palette paints under the query it was just given).
 *
 * WHY A CLICK RATHER THAN ENTER: `Input.dispatchKeyEvent`'s Enter triplet drives
 * the composer (the slash popup and the send both answer it) and is INERT on the
 * palette's search input, measured here - the palette stayed open with its row
 * painted and "Open ↵" on it through every variant of the event. Rather than
 * ship a scene that silently proves nothing, the gesture is the one the palette
 * does answer, and this note is why.
 */
async function clickFirstRow(debugPort, selector) {
	const rect = await evaluate(
		debugPort,
		`(() => {
			const node = document.querySelector(${JSON.stringify(selector)});
			if (!node) return null;
			const box = node.getBoundingClientRect();
			return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		})()`,
	);
	if (!rect) throw new Error(`no row for ${selector}`);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await call(debugPort, "Input.dispatchMouseEvent", {
			type,
			x: rect.x,
			y: rect.y,
			button: "left",
			clickCount: 1,
		});
		await wait(80);
	}
}

async function focusComposer(debugPort) {
	await evaluate(
		debugPort,
		`(() => {
			const field = document.querySelector('[data-tour-tag="chat-input-textarea"]');
			if (!field) return "no composer";
			field.focus();
			return "focused";
		})()`,
	);
	await wait(300);
}

const ENTER = { code: "Enter", vk: 13, text: "\r" };
const CMD_K = { code: "KeyK", vk: 75, modifiers: 4 };

/** Seed the app's own first-run state, the way the app's stores persist it. */
async function seedAppState(debugPort) {
	await evaluate(
		debugPort,
		`(() => {
			localStorage.setItem("onboarding-storage", JSON.stringify({
				state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" },
				version: 0,
			}));
			localStorage.setItem("chat-sidebar-disclosures", JSON.stringify({ previous: true }));
			location.reload();
			return "seeded";
		})()`,
	);
	await wait(3_000);
}

async function bootApp(profile) {
	const app = launch(
		"node_modules/.bin/electron",
		[
			".",
			`--remote-debugging-port=${DEBUG_PORT}`,
			`--user-data-dir=${join(ROOT, `profile-${profile}`)}`,
			`--window-size=${WIDTH}x${HEIGHT}`,
		],
		appEnv(),
	);
	await settle(DEBUG_PORT, { timeoutMs: 120_000 });
	await seedAppState(DEBUG_PORT);
	return app;
}

/* --------------------------------- scenes ---------------------------------- */

/**
 * Scene bodies: a gesture, then the read and the frame it produces.
 *
 * The first two type `/analytics` and `/info` into the composer of a pane with no
 * conversation, which is the gesture the before tree refuses; the last two are
 * the same palette gesture from two routes that are not chat, with a draft pane
 * staged so the before tree offers the row at all.
 *
 * THE TWO LIVE-CONVERSATION SCENES OF THE DESIGN (its § 11.5 and § 11.6) ARE NOT
 * IN THIS SET, and that is a gap rather than a decision: both need a
 * conversation whose first turn was actually sent, and this rig could not land
 * one against the scratch backend it starts - the composer accepted the message
 * and the pane stayed on `/chat` with its draft through the 90 s wait, with and
 * without the model chosen from the pane's own chip first. What those two frames
 * would show is covered instead by `panels-analytics--populated` and
 * `panels-info--populated` in the story set (the same production components,
 * with a session id and a frontend snapshot) and by the QA pass against a live
 * backend.
 */
const SCENES = {
	"draft-analytics": async (debugPort) => {
		await stageDraftPane(debugPort);
		await focusComposer(debugPort);
		await type(debugPort, "/analytics");
		await press(debugPort, ENTER.key, ENTER);
		await wait(1_500);
		await press(debugPort, ENTER.key, ENTER);
	},
	"draft-info": async (debugPort) => {
		await stageDraftPane(debugPort);
		await focusComposer(debugPort);
		await type(debugPort, "/info");
		await press(debugPort, ENTER.key, ENTER);
		await wait(1_500);
		await press(debugPort, ENTER.key, ENTER);
	},
	/*
	 * The palette pair, and why a DRAFT pane is staged first.
	 *
	 * The row this scene picks is `Info`, and on the BEFORE tree no panel row is
	 * offered until the chat pane has something to present - a session or a draft
	 * (`paneCanPresent`). Staging a draft is therefore the precondition that makes
	 * the gesture possible AT ALL on the old tree, and the pair then differs in
	 * exactly one thing: where the panel ends up. An `Analytics` row would need a
	 * live session on that tree, which would put a sent turn and a model choice in
	 * front of the claim this scene is about.
	 */
	"palette-settings": async (debugPort) => {
		await stageDraftPane(debugPort);
		await evaluate(debugPort, 'location.hash = "#/settings"');
		await wait(2_000);
		await press(debugPort, "k", CMD_K);
		await wait(1_500);
		await type(debugPort, "info");
		await wait(1_200);
		await clickFirstRow(debugPort, '#command-palette-results [role="option"]');
		await wait(1_500);
	},
	"palette-browser": async (debugPort) => {
		await stageDraftPane(debugPort);
		await evaluate(debugPort, 'location.hash = "#/browser"');
		await wait(3_000);
		await press(debugPort, "k", CMD_K);
		await wait(1_500);
		await type(debugPort, "info");
		await wait(1_200);
		await clickFirstRow(debugPort, '#command-palette-results [role="option"]');
		await wait(1_500);
	},
};

const NAMES = Object.keys(SCENES);

async function main() {
	assertBuiltForThisBackend();
	const backend = await startBackend();
	const records = [];
	for (const name of NAMES) {
		if (ONLY !== "all" && ONLY !== name) continue;
		let app = null;
		let record;
		try {
			app = await bootApp(name);
			await SCENES[name](DEBUG_PORT);
			const page = await settle(DEBUG_PORT);
			const frame = await shot(DEBUG_PORT, `${name}`);
			record = { scene: name, label: LABEL, frame, page };
		} catch (error) {
			record = {
				scene: name,
				label: LABEL,
				error: String(error),
				app_log: (app ?? lastLaunch)?.text().slice(-2_000) ?? "(no launch)",
				read_error: `${lastReadError}`,
			};
		} finally {
			await stop(app);
		}
		records.push(record);
		console.log(JSON.stringify(record, null, 2));
	}
	await stop(backend);
	/*
	 * The rig's own hash, in the run record.
	 *
	 * The pair is only evidence if the SAME gestures ran against both trees: the
	 * script lives in the tree under test (so `REPO` resolves to it), and a copy of
	 * it is run in the other tree. Recording the bytes is what turns "the same
	 * rig" from a claim into something a reader can check.
	 */
	const rig = createHash("sha256")
		.update(readFileSync(fileURLToPath(import.meta.url)))
		.digest("hex");
	writeFileSync(
		join(OUT, `run-${LABEL}.json`),
		`${JSON.stringify(
			{ label: LABEL, rig_sha256: rig, at: new Date().toISOString(), records },
			null,
			2,
		)}\n`,
	);
	/*
	 * Any scene that failed is a failure of the run, not a scene to skip: a pair
	 * with one half missing is a pair nobody can read.
	 */
	if (records.some((record) => record.error)) process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		for (const child of children) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				/* already gone */
			}
		}
		spawnSync("pkill", ["-f", `user-data-dir=${ROOT}`], { stdio: "ignore" });
		process.exit(1);
	});
}

await main();
for (const child of children) await stop(child);
