#!/usr/bin/env node
/**
 * Drive the app's own renderer, headless, and photograph what it paints.
 *
 *     node scripts/renderer-driver.mjs --scene states --out /tmp/frames
 *     node scripts/renderer-driver.mjs --gate-check
 *
 * ## What problem this solves, measured
 *
 * Two review rounds could not look at a real UI flow. The `browser` tool drives
 * the operator's own browser and cannot enter this app's renderer, and loading
 * the renderer under a bare Vite server dies at
 * `Cannot read properties of undefined (reading 'ipcRenderer')` because `App`
 * assumes the preload bridge (`src/renderer/src/app.tsx`). So the flow was read
 * in the source and never walked, and a UX round was recorded as blocked on
 * exactly that.
 *
 * This script is the supported way through, and it uses only the app's own
 * mechanisms:
 *
 * - the BUILT app, launched by its own Electron (`node_modules/.bin/electron
 *   <repo>`), in the documented `headless` window mode (`src/main/window-mode.ts`
 *   — a window that is never shown, so nothing can steal the operator's focus);
 * - the app's own gated dev-driver bridge (`src/main/dev-driver.ts`,
 *   `docs/agent-driver.md`) for the verbs, reached over CDP `Runtime.evaluate`
 *   on the app's OWN debugging port — the same channel AGENTS.md documents for
 *   `pnpm app:headless -- --remote-debugging-port=...`;
 * - `webContents.capturePage()` in main for the pixels, so the frames are the app
 *   photographing itself. No Playwright, no Puppeteer, no downloaded Chromium,
 *   and no `screencapture` (which photographs the frontmost window and would
 *   mean taking the focus this harness exists to avoid).
 *
 * ## Isolation, and why each piece is here
 *
 * This runs on the operator's desktop next to his real app, so every path that
 * could reach his state is redirected:
 *
 * - `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` are both scratch. The config dir alone
 *   is not enough: the app's cache and home roots follow `HOME`, and this repo
 *   has already written 612 rows into the operator's live analytics database
 *   from a run somebody believed was sandboxed.
 * - `--user-data-dir` is scratch, so the Electron profile (cookies, localStorage
 *   where the UI preferences persist) cannot see or touch the real one.
 * - The app is started with its **cwd outside the checkout**, and the scratch cwd
 *   holds its own `.env`. `src/main/backend/config.ts` loads `.env` from
 *   `process.cwd()` with dotenv `override: true`, so the repo's own `.env` is not
 *   read at all and the backend URL this run would use is one this script picked
 *   and verified to be dead. That is the difference between a run that shows a
 *   disconnected app and a run that writes into the operator's live backend.
 * - The frames then cannot contain real data: a scene captures an app that has no
 *   reachable backend. The run also asserts, with `lsof`, that the app process
 *   holds no TCP connection to the URL the RENDERER was built with (the renderer
 *   inlines `VITE_LOCAL_OPERATOR_API_URL`, and a few renderer-direct features —
 *   attachments, the canvas edit API, the updates panel — would use it).
 * - `CMUX_*` and `LOP_*` are removed from the child environment: an inherited
 *   workspace id has already renamed the operator's real cmux workspaces from a
 *   test run in this repository.
 *
 * ## The fail-closed gate, which `--gate-check` measures
 *
 * The bridge exists only when the launch opted in
 * (`LOCAL_OPERATOR_UI_DEV_DRIVER=1` **and** `LOCAL_OPERATOR_UI_DEV_DRIVER_OUT`)
 * and the window mode is not `normal`. `--gate-check` boots the app twice and
 * reports, from the real renderer: absent bridge, refused IPC channel and an
 * empty frames directory in the unarmed boot; a present bridge and a real PNG in
 * the armed one. Nothing about that is inferred from a flag this script read in
 * its own process.
 *
 * What this harness CANNOT show is in `docs/agent-driver.md`; the short version
 * is that it is not a substitute for the `browser` tool (a page's behaviour in a
 * real browser is a different question), it cannot answer an approval, and it
 * must not be used to claim a page works.
 *
 * Flags:
 *   --scene <states|none>  which built-in scene to run (default: states)
 *   --out <dir>            where frames go; copied out of the scratch tree when given
 *   --gate-check           measure the fail-closed gate on two real boots
 *   --window-size <WxH>    the window to request (default 1380x900)
 *   --keep                 keep the scratch directory even with --clean
 *   --clean                remove the scratch directory at the end; frames given
 *                          with --out live outside it and survive
 */

import { spawn } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = process.cwd();

function argValue(name, fallback = null) {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

const SCENE = argValue("--scene", "states");
const OUT_ARG = argValue("--out", null);
const GATE_CHECK = process.argv.includes("--gate-check");
const KEEP = process.argv.includes("--keep");
const CLEAN = process.argv.includes("--clean");
const WINDOW_SIZE = argValue("--window-size", "1380x900");
const [WINDOW_WIDTH, WINDOW_HEIGHT] = WINDOW_SIZE.split("x").map((n) =>
	Number(n),
);

if (!/^\d+x\d+$/.test(WINDOW_SIZE)) {
	console.error(`--window-size expects WxH (got "${WINDOW_SIZE}")`);
	process.exit(2);
}

const SCRATCH = join(tmpdir(), `lo-renderer-driver-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
/** The app's cwd. Outside the checkout on purpose: this is where dotenv looks. */
const APP_CWD = join(SCRATCH, "cwd");
const FRAMES = OUT_ARG ? resolve(OUT_ARG) : join(SCRATCH, "frames");

const transcript = [];
let failures = 0;

function say(line) {
	console.log(line);
}

function record(label, body) {
	transcript.push(`### ${label}\n\n\`\`\`\n${body}\n\`\`\`\n`);
}

function check(label, ok, detail) {
	if (!ok) failures += 1;
	const status = ok ? "PASS" : "FAIL";
	say(
		`[${status}] ${label}${detail === undefined ? "" : `\n        ${detail}`}`,
	);
	record(label, `[${status}] ${detail ?? ""}`);
	return ok;
}

function note(label, detail) {
	say(`[note] ${label}${detail === undefined ? "" : `\n        ${detail}`}`);
	record(label, `[note] ${detail ?? ""}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- ports ------------------------------------------------------------------

/** A port nothing is listening on, by binding and immediately releasing it. */
async function pickFreePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolvePort(port));
		});
	});
}

/** Is something accepting connections on this port? The answer bounds what a run can reach. */
async function isListening(port, timeoutMs = 750) {
	return new Promise((resolveAnswer) => {
		const socket = connect({ host: "127.0.0.1", port });
		const done = (answer) => {
			socket.destroy();
			resolveAnswer(answer);
		};
		socket.setTimeout(timeoutMs);
		socket.on("connect", () => done(true));
		socket.on("timeout", () => done(false));
		socket.on("error", () => done(false));
	});
}

// ---- the app -----------------------------------------------------------------

let app = null;

/** Kill by exact pid, never a pattern: a `pkill` would take the operator's app too. */
async function stopApp() {
	const stopping = app;
	if (!stopping) return;
	app = null;
	stopping.flush();
	await new Promise((resolveStop) => {
		stopping.child.once("exit", resolveStop);
		stopping.child.kill("SIGTERM");
		setTimeout(() => {
			try {
				stopping.child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
			resolveStop();
		}, 5000);
	});
}

async function launchApp({ armed, apiUrl, logName, tag }) {
	const env = {
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		// No backend manager: this run must not install or start a Local Operator
		// backend in the scratch HOME.
		VITE_DISABLE_BACKEND_MANAGER: "true",
	};
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	if (armed) {
		env.LOCAL_OPERATOR_UI_DEV_DRIVER = "1";
		env.LOCAL_OPERATOR_UI_DEV_DRIVER_OUT = FRAMES;
	}

	const port = await pickFreePort();
	if (await isListening(port)) throw new Error(`picked port ${port} is in use`);

	const child = spawn(
		join(ROOT, "node_modules", ".bin", "electron"),
		[
			// The app directory as an argument rather than `.`: argv[1] is what
			// Electron loads, so the cwd can be the scratch directory that the
			// app's own dotenv reads.
			ROOT,
			// A profile directory PER LAUNCH, not one per run. The app takes a
			// single-instance lock (`app.requestSingleInstanceLock`) and the second
			// boot of a `--gate-check` run otherwise finds the first one's lock still
			// held, prints "Another instance is already running. Quitting this
			// instance." and exits without ever creating a window — which looks
			// exactly like a broken driver. Measured on the first two-boot run.
			`--user-data-dir=${USER_DATA}-${tag}`,
			`--remote-debugging-port=${port}`,
			"--window-mode=headless",
			`--window-size=${WINDOW_SIZE}`,
		],
		{ env, cwd: APP_CWD, stdio: ["ignore", "pipe", "pipe"] },
	);

	const logPath = join(SCRATCH, logName);
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
		port,
		pid: child.pid,
		logPath,
		stream,
		flush,
		apiUrl,
	};
}

async function readAppLog(handle) {
	handle.flush();
	try {
		return readFileSync(handle.logPath, "utf8");
	} catch {
		return "";
	}
}

// ---- the renderer, over the app's own CDP ------------------------------------

/**
 * Wait for the app's own debugging port to answer.
 *
 * The port is not there the moment Electron is spawned, and asking too early is
 * not a hypothetical: the first version of this script fetched `/json/list`
 * immediately and died with a bare `TypeError: fetch failed`, which says nothing
 * about whether the app failed to start or simply had not started. So the wait
 * is bounded, it names what it waited for, and it hands back the app log when
 * the timeout is the answer.
 */
async function waitForDevtools(handle, timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		try {
			const response = await fetch(`http://127.0.0.1:${handle.port}/json/version`);
			if (response.ok) return;
		} catch {
			/* not listening yet */
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`the app's debugging port ${handle.port} never answered in ${timeoutMs}ms\n` +
					(await readAppLog(handle)).split("\n").slice(-30).join("\n"),
			);
		}
		await wait(250);
	}
}

/**
 * A CDP client for ONE target, over Node's built-in WebSocket.
 *
 * Requests are resolved by their own id, so a later call cannot read an earlier
 * call's reply — the bug `scripts/browser-host-proof.mjs` documents having hit
 * when it resolved on "the first message after sending".
 */
class CdpClient {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		this.console = [];
		socket.addEventListener("message", (event) => {
			let message = null;
			try {
				message = JSON.parse(event.data);
			} catch {
				return;
			}
			if (message.method === "Runtime.consoleAPICalled") {
				this.console.push(
					(message.params?.args ?? [])
						.map((a) => String(a.value ?? a.description ?? ""))
						.join(" "),
				);
			}
			if (message.id !== undefined && this.pending.has(message.id)) {
				this.pending.get(message.id)(message);
				this.pending.delete(message.id);
			}
		});
	}

	static async attach(port, targetUrlPart) {
		const list = await (
			await fetch(`http://127.0.0.1:${port}/json/list`)
		).json();
		const target = list.find(
			(entry) => entry.type === "page" && entry.url.includes(targetUrlPart),
		);
		if (!target) {
			throw new Error(
				`no renderer target for ${targetUrlPart} on port ${port}: ` +
					JSON.stringify(list.map((e) => ({ type: e.type, url: e.url }))),
			);
		}
		const socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((resolveOpen, rejectOpen) => {
			socket.addEventListener("open", resolveOpen, { once: true });
			socket.addEventListener("error", rejectOpen, { once: true });
		});
		const client = new CdpClient(socket);
		client.send("Runtime.enable").catch(() => {});
		client.send("Page.enable").catch(() => {});
		return client;
	}

	send(method, params = {}) {
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolveReply, rejectReply) => {
			this.pending.set(id, resolveReply);
			setTimeout(() => {
				if (this.pending.delete(id)) {
					rejectReply(new Error(`CDP ${method} timed out`));
				}
			}, 30_000);
		});
	}

	/**
	 * Evaluate in the app's renderer and return the value, or throw.
	 *
	 * A CDP-level error and a thrown exception in the page are both failures of
	 * the run: reading only `result.result.value` is how a torn-down context reads
	 * as `undefined` and a real refusal looks like a missing feature.
	 */
	async evaluate(expression) {
		const reply = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (reply.error) throw new Error(`CDP: ${reply.error.message}`);
		if (reply.result?.exceptionDetails) {
			throw new Error(
				reply.result.exceptionDetails.exception?.description ??
					reply.result.exceptionDetails.text ??
					"threw",
			);
		}
		return reply.result?.result?.value;
	}

	close() {
		try {
			this.socket.close();
		} catch {
			/* already closed */
		}
	}
}

/** Wait until the app's own renderer has loaded and mounted its root. */
async function waitForPage(cdp, timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		const state = await cdp
			.evaluate(
				"({ ready: document.readyState, mounted: Boolean(document.getElementById('app')?.childElementCount), title: document.title })",
			)
			.catch(() => null);
		if (state?.ready === "complete" && state.mounted) return state;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`the renderer never painted: ${JSON.stringify(state)}`);
		}
		await wait(250);
	}
}

async function waitForBridge(cdp, timeoutMs = 90_000) {
	const started = Date.now();
	for (;;) {
		const verbs = await cdp
			.evaluate(
				"typeof window.__loDevDriver?.verbs === 'function' ? window.__loDevDriver.verbs() : null",
			)
			.catch(() => null);
		if (Array.isArray(verbs) && verbs.includes("hello")) return verbs;
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`the renderer never registered the dev driver verbs (last: ${JSON.stringify(verbs)})`,
			);
		}
		await wait(250);
	}
}

/** Call a registered scene verb. */
function verb(cdp, name, payload) {
	return cdp.evaluate(
		`window.__loDevDriver.call(${JSON.stringify(name)}, ${JSON.stringify(payload ?? null)})`,
	);
}

/** Capture a frame through the app's own `capturePage()`. */
function capture(cdp, label) {
	return cdp.evaluate(`window.__loDevDriver.capture(${JSON.stringify(label)})`);
}

/**
 * The bridge's own methods, which are NOT scene verbs: `facts()` (window facts
 * from main) and `capture()` live on `window.__loDevDriver` itself, while the
 * verbs the app registers are reached through `call(name)`. The two surfaces are
 * deliberately separate — `capture` and `facts` are main's, and the verbs are the
 * app's — which is also why a scene verb table is enumerable: calling one that
 * does not exist answers with what does.
 */
function factsOf(cdp) {
	return cdp.evaluate("window.__loDevDriver.facts()");
}

// ---- isolation probes --------------------------------------------------------

/**
 * Does the app process hold a connection to the URL the renderer was built with?
 *
 * `lsof` is asked per pid, so this cannot report some other process's traffic as
 * this run's. When `lsof` is unavailable the probe says so rather than answering
 * "no connections" — an unmeasured isolation claim is the failure mode here.
 */
function connectionsTo(pid, url) {
	let host = null;
	let port = null;
	try {
		const parsed = new URL(url);
		host = parsed.hostname;
		port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
	} catch {
		return { measured: false, detail: `cannot parse ${url}` };
	}
	return new Promise((resolveProbe) => {
		const probe = spawn(
			"/usr/sbin/lsof",
			["-a", "-p", String(pid), "-i", "-n", "-P"],
			{
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		if (probe.error) {
			resolveProbe({ measured: false, detail: "lsof unavailable" });
			return;
		}
		const out = [];
		probe.stdout.on("data", (chunk) => out.push(chunk.toString()));
		probe.on("error", () =>
			resolveProbe({ measured: false, detail: "lsof unavailable" }),
		);
		probe.on("exit", () => {
			const text = out.join("");
			const matches = text
				.split("\n")
				.filter((line) => line.includes(`:${port}`) && line.includes(host));
			resolveProbe({ measured: true, matches, text });
		});
	});
}

// ---- scenes ------------------------------------------------------------------

/**
 * `states`: the before/after pair this harness exists to produce, plus a second
 * surface. The theme change is made by PRESSING the settings control (the same
 * element a user presses), not by writing the store, and the frames either side
 * of it are the same screen — which is the shape a visual-change review needs.
 */
async function sceneStates(cdp) {
	const hello = await verb(cdp, "hello");
	note("hello", JSON.stringify(hello, null, 2));
	check(
		"the renderer reports this run's frames directory",
		hello.outDir === FRAMES,
		`${hello.outDir} (expected ${FRAMES})`,
	);
	check(
		"the renderer sees the built app, not a bare Vite page",
		/Electron/i.test(hello.userAgent),
		hello.userAgent,
	);

	const facts = await factsOf(cdp);
	note("facts (from main)", JSON.stringify(facts, null, 2));
	check(
		"window mode is headless",
		facts.windowMode === "headless",
		facts.windowMode,
	);
	check(
		"the window is never shown",
		facts.visible === false,
		`visible=${facts.visible} focused=${facts.focused} minimized=${facts.minimized}`,
	);
	check(
		"the window never has focus",
		facts.focused === false,
		`focused=${facts.focused}`,
	);
	check(
		"the requested window size is the size that exists",
		facts.windowSize.width === WINDOW_WIDTH &&
			facts.windowSize.height === WINDOW_HEIGHT,
		`${JSON.stringify(facts.windowSize)} for a requested ${WINDOW_SIZE}`,
	);
	check(
		"the content area is smaller than the window by the platform's chrome only",
		facts.contentBounds.width === facts.windowSize.width &&
			facts.contentBounds.height < facts.windowSize.height &&
			facts.windowSize.height - facts.contentBounds.height <= 40,
		`window ${JSON.stringify(facts.windowSize)} content ${JSON.stringify(facts.contentBounds)}`,
	);

	/*
	 * The surfaces are chosen to need no backend, because a driver run has none
	 * (see the isolation notes at the top). What is deliberately NOT captured
	 * here is any route whose content is backend-gated — `settings`, `agents`,
	 * `agent-hub` and `schedules` are lazy routes that sit on a spinner until
	 * React Query gives up — because a frame of a spinner is a real frame of a
	 * real state and not one a reviewer can judge a layout by. The run says so
	 * rather than presenting one as evidence; a driver whose backend IS up gets
	 * those screens normally.
	 */

	// 1. The chat screen in the default (dark) palette.
	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", "localOperatorDark");
	const before = await verb(cdp, "state");
	note("state before", JSON.stringify(before));
	const beforeFrame = await capture(cdp, "chat-dark");
	note("frame", JSON.stringify(beforeFrame));

	// 2. The same screen in another palette: the before/after pair a visual
	// change is reviewed against. Driven by the app's own theme action (the one
	// the settings picker and the `/theme` picker call), not by writing the DOM.
	await verb(cdp, "setTheme", "localOperatorLight");
	const after = await verb(cdp, "state");
	check(
		"the theme action changed the app's own theme state",
		after.theme === "localOperatorLight",
		`theme ${before.theme} -> ${after.theme}`,
	);
	const afterFrame = await capture(cdp, "chat-light");
	note("frame", JSON.stringify(afterFrame));
	check(
		"the before/after pair is the same screen at the same size",
		beforeFrame.viewport.width === afterFrame.viewport.width &&
			beforeFrame.viewport.height === afterFrame.viewport.height &&
			before.route === after.route,
		`${before.route} ${JSON.stringify(beforeFrame.viewport)} vs ${after.route} ${JSON.stringify(afterFrame.viewport)}`,
	);

	// 3. Real controls, to prove the driver reaches the app's own handlers and
	// not only its stores: press the rail's Agent hub button (the selector the
	// onboarding tour clicks) and then the Chat button, and watch the route move
	// both ways. No frame is captured from either destination: `agent-hub` is one
	// of the backend-gated routes above, and capturing the spinner would say less
	// than this assertion does.
	const hubPress = await verb(
		cdp,
		"press",
		'[data-tour-tag="nav-item-agent-hub"]',
	);
	note("press", JSON.stringify(hubPress));
	check(
		"the pressed control received the point (hit test)",
		hubPress.hitTest === true,
		JSON.stringify({
			hitTest: hubPress.hitTest,
			hit: hubPress.hit,
			target: hubPress.target,
		}),
	);
	const hubState = await verb(cdp, "state");
	check(
		"pressing the rail's Agent hub button navigated the app",
		hubState.route === "/agent-hub",
		JSON.stringify(hubState),
	);
	const chatPress = await verb(cdp, "press", '[data-tour-tag="nav-item-chat"]');
	const chatState = await verb(cdp, "state");
	check(
		"pressing the rail's Chat button navigated back, and the theme survived",
		chatPress.hitTest === true &&
			chatState.route === "/chat" &&
			chatState.theme === "localOperatorLight",
		JSON.stringify(chatState),
	);
	const backFrame = await capture(cdp, "chat-light-returned");
	note("frame", JSON.stringify(backFrame));

	const frames = [beforeFrame, afterFrame, backFrame];
	check(
		"every capture wrote a PNG of the requested size",
		frames.every(
			(frame) =>
				frame.bytes > 1000 &&
				frame.pixels.width ===
					frame.viewport.width * frame.viewport.devicePixelRatio &&
				frame.pixels.height ===
					frame.viewport.height * frame.viewport.devicePixelRatio,
		),
		frames
			.map(
				(f) => `${f.label}: ${f.pixels.width}x${f.pixels.height}, ${f.bytes}B`,
			)
			.join(" | "),
	);
	return frames;
}

// ---- gate-check --------------------------------------------------------------

/**
 * The fail-closed proof, on two real boots: an unarmed launch must be
 * indistinguishable from the app as it was — no bridge, no channel, no frames —
 * and an armed one must produce all three.
 */
async function gateCheck() {
	const results = [];

	// --- 1. unarmed ---
	let handle = await launchApp({
		armed: false,
		logName: "app-unarmed.log",
		tag: "unarmed",
	});
	let cdp = null;
	try {
		await waitForDevtools(handle);
		cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
		/*
		 * The unarmed launch must be a NORMAL app, not merely one with the bridge
		 * missing: the first cut of the gate used an `ipcRenderer.sendSync`
		 * handshake, which never answers on a channel with no listener, so an
		 * ordinary launch hung in the preload and never painted. "The bridge is
		 * absent" would have passed while the app was broken, which is why the
		 * paint assertion comes first here.
		 */
		const page = await waitForPage(cdp);
		results.push(
			check(
				"unarmed: the app loaded and painted normally",
				page.mounted === true && page.title === "Local Operator",
				JSON.stringify(page),
			),
		);
		const bridgeType = await cdp.evaluate("typeof window.__loDevDriver");
		results.push(
			check(
				"unarmed: the renderer has no dev-driver bridge",
				bridgeType === "undefined",
				`typeof window.__loDevDriver === ${bridgeType}`,
			),
		);
		const refused = await cdp.evaluate(`(async () => {
			try {
				await window.electron.ipcRenderer.invoke("dev-driver-capture", "gate-check-probe");
				return "resolved";
			} catch (error) { return String(error?.message ?? error); }
		})()`);
		results.push(
			check(
				"unarmed: main refuses the capture channel",
				/no handler registered/i.test(refused),
				refused,
			),
		);
		const framesBefore = readdirSync(FRAMES).filter((f) => f.endsWith(".png"));
		results.push(
			check(
				"unarmed: no frame was written",
				framesBefore.length === 0,
				`${framesBefore.length} PNG(s) in ${FRAMES}`,
			),
		);
		const log = await readAppLog(handle);
		results.push(
			check(
				"unarmed: the launch printed no dev-driver banner",
				!/\[dev-driver\]/.test(log),
				log
					.split("\n")
					.filter((l) => l.includes("[dev-driver]"))
					.join(" / ") || "no [dev-driver] line",
			),
		);
	} finally {
		cdp?.close();
		await stopApp();
	}

	// --- 2. armed ---
	handle = await launchApp({ armed: true, logName: "app-armed.log", tag: "armed" });
	try {
		await waitForDevtools(handle);
		cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
		const verbs = await waitForBridge(cdp);
		results.push(
			check(
				"armed: the renderer has the bridge and its verbs",
				Array.isArray(verbs) && verbs.length > 0,
				JSON.stringify(verbs),
			),
		);
		const frame = await capture(cdp, "gate-check-armed");
		results.push(
			check(
				"armed: capture wrote a real PNG",
				frame.bytes > 1000 && frame.path.endsWith("gate-check-armed.png"),
				JSON.stringify(frame),
			),
		);
		const log = await readAppLog(handle);
		results.push(
			check(
				"armed: the launch said so on stdout",
				/\[dev-driver\] ARMED/.test(log),
				log
					.split("\n")
					.filter((l) => l.includes("[dev-driver]"))
					.join(" / ") || "no [dev-driver] line",
			),
		);
	} finally {
		cdp?.close();
		await stopApp();
	}

	return results;
}

// ---- main --------------------------------------------------------------------

async function main() {
	mkdirSync(HOME_DIR, { recursive: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(APP_CWD, { recursive: true });
	mkdirSync(FRAMES, { recursive: true });

	// The scratch `.env` at the app's cwd: this is what keeps the run off the
	// operator's backend, because main loads `.env` from cwd with `override: true`.
	const deadApiPort = await pickFreePort();
	const apiUrl = `http://127.0.0.1:${deadApiPort}`;
	writeFileSync(
		join(APP_CWD, ".env"),
		[
			`# Written by scripts/renderer-driver.mjs. The app loads this with dotenv`,
			`# override:true from its cwd, which is why the harness runs with a cwd`,
			`# outside the checkout: a repo .env would win otherwise.`,
			`VITE_LOCAL_OPERATOR_API_URL=${apiUrl}`,
			`VITE_DISABLE_BACKEND_MANAGER=true`,
			"",
		].join("\n"),
	);

	say("local-operator-ui renderer driver");
	say(`  repo          ${ROOT}`);
	say(`  scratch       ${SCRATCH}`);
	say(`  frames        ${FRAMES}`);
	say(`  app cwd       ${APP_CWD}   (scratch: the repo's .env is not read)`);
	say(
		`  backend url   ${apiUrl}   (dead port; the run cannot reach a backend)`,
	);

	const dead = await isListening(deadApiPort);
	check(
		"the scratch backend port is dead",
		dead === false,
		`127.0.0.1:${deadApiPort} listening=${dead}`,
	);
	const defaultBackend = await isListening(1111);
	note(
		"the app's default backend port (127.0.0.1:1111)",
		defaultBackend
			? "a listener is up: this run's main process points elsewhere, and the check below proves the app holds no connection to the URL the RENDERER was built with"
			: "nothing listening",
	);

	if (GATE_CHECK) {
		say(
			"\n[gate-check] two real boots: unarmed must be inert, armed must work\n",
		);
		await gateCheck();
	} else {
		const handle = await launchApp({
			armed: true,
			logName: "app-scene.log",
			tag: "scene",
		});
		app = handle;
		let cdp = null;
		try {
			await waitForDevtools(handle);
		cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
			const verbs = await waitForBridge(cdp);
			note("verbs registered by the renderer", JSON.stringify(verbs));
			check(
				"the armed launch said so on stdout",
				/\[dev-driver\] ARMED/.test(await readAppLog(handle)),
				(await readAppLog(handle))
					.split("\n")
					.filter((line) => line.includes("[dev-driver]"))
					.join(" / "),
			);
			const hello = await verb(cdp, "hello");
			const probe = await connectionsTo(handle.pid, hello.apiBaseUrl);
			if (probe.measured) {
				check(
					`the app holds no connection to the renderer's built API URL (${hello.apiBaseUrl})`,
					probe.matches.length === 0,
					probe.matches.join("\n") || "no connection",
				);
			} else {
				note("isolation probe unavailable", probe.detail);
			}
			if (SCENE === "states") await sceneStates(cdp);
			else if (SCENE !== "none") throw new Error(`unknown scene "${SCENE}"`);
			for (const line of cdp.console.slice(-20)) say(`  [renderer] ${line}`);
		} finally {
			if (cdp) cdp.close();
		}
	}

	// One teardown for both branches, by exact pid (never a pattern: a `pkill`
	// would take the operator's own running app with it).
	if (app) {
		const handle = app;
		const log = await readAppLog(handle);
		await stopApp();
		if (failures > 0) {
			say("\n---- app log (tail) ----");
			say(log.split("\n").slice(-40).join("\n"));
		}
	}

	const frames = readdirSync(FRAMES)
		.filter((f) => f.endsWith(".png"))
		.sort();
	say(`\nframes: ${frames.length === 0 ? "(none)" : frames.join(", ")}`);
	say(`frames directory: ${FRAMES}`);
	say(`app log: ${join(SCRATCH, GATE_CHECK ? "app-armed.log" : "app-scene.log")}`);

	/*
	 * Two flags, one decision, and the frames are never the casualty: `--out`
	 * writes them outside the scratch tree, so `--clean` can remove the tree
	 * without removing the evidence. `--keep` is for an agent debugging a run that
	 * wants the profile, the app log and the scratch `.env` to still be there.
	 */
	if (CLEAN && !KEEP) {
		rmSync(SCRATCH, { recursive: true, force: true });
		say("scratch removed (--clean)");
	} else {
		say(
			`scratch kept: ${SCRATCH}${OUT_ARG ? " (the frames are also in --out)" : ""}`,
		);
	}

	say(
		`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`,
	);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
	say(`\n[FAIL] the run threw: ${error?.stack ?? error}`);
	const handle = app;
	if (handle) {
		const log = await readAppLog(handle);
		await stopApp();
		say("\n---- app log (tail) ----");
		say(log.split("\n").slice(-40).join("\n"));
	}
	process.exit(1);
});
