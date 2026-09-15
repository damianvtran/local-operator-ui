#!/usr/bin/env node
/**
 * Frames from the REAL app for the daemon-attach work.
 *
 *     node scripts/attach-frame-evidence.mjs <out-dir> [--label name]
 *
 * WHY this exists beside `attach-robustness-evidence.mjs`. That rig drives the
 * app's main-process modules and prints what they observed. What it cannot show
 * is the surface the operator reported on: the renderer, in the window, saying
 * the server was unavailable while the server answered. So this launches the
 * built app in `headless` mode against a scratch daemon, reads the page over
 * CDP, and writes the frames - the renderer's own view of the connection.
 *
 * It is deliberately the cooperating case: the app attaches to the scratch
 * daemon, the sidebar loads the seeded conversation, and the frame is captured
 * before and after that daemon is killed. The kill is the honest-detach cell -
 * the banner must say the server stopped - and it is the control for the cell
 * that matters: a daemon that is SERVING must produce no banner at all.
 *
 * Everything is isolated: a throwaway HOME, config dir, `--user-data-dir` and
 * port range, an allowlisted environment, and `VITE_DISABLE_BACKEND_MANAGER=true`
 * so this app can never spawn a backend of its own. No window is shown (the
 * window mode is named on the command line, per this repository's rule), and
 * nothing touches the operator's `~/.local-operator`, sessions or app.
 *
 * `--no-notifications` is exported for every child: this runs on the operator's
 * desktop, and a native banner is not part of any evidence here.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = process.argv[2];
const labelIndex = process.argv.indexOf("--label");
const LABEL = labelIndex > 0 ? process.argv[labelIndex + 1] : "tree";
if (!OUT) {
	console.error("usage: attach-frame-evidence.mjs <out-dir> [--label name]");
	process.exit(1);
}
const WIDTH = Number(process.env.ATTACH_FRAME_WIDTH ?? 1380);
const HEIGHT = Number(process.env.ATTACH_FRAME_HEIGHT ?? 900);
const DAEMON_PORT = Number(process.env.ATTACH_FRAME_PORT ?? 45990);
const DEBUG_PORT = Number(process.env.ATTACH_FRAME_DEBUG_PORT ?? 45991);

const ROOT = mkdtempSync(join(tmpdir(), "lop-ui-frame-evidence-"));
const PROFILE = join(ROOT, "profile");
mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

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
const childEnv = {
	...baseEnv,
	HOME: ROOT,
	LOCAL_OPERATOR_CONFIG_DIR: ROOT,
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
	// The app's own configuration, read at runtime by the main process. Passed in
	// the environment rather than written to the repository's gitignored `.env`:
	// a `.env` left behind by a rig changes what every other suite's config
	// validation sees, which is a contaminated run rather than evidence.
	VITE_LOCAL_OPERATOR_API_URL: process.env.VITE_LOCAL_OPERATOR_API_URL,
	// `pnpm dev`'s own setting, and the reason this rig can never start a backend
	// of its own: the subject is the app's view of a daemon that is already there.
	VITE_DISABLE_BACKEND_MANAGER: "true",
};

const say = (text) => console.log(text);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const children = [];
function launch(command, args, options = {}) {
	const child = spawn(command, args, {
		cwd: REPO,
		env: { ...childEnv, ...(options.env ?? {}) },
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
	const child = entry?.child;
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

/**
 * The APP's page target, out of everything the debug port lists.
 *
 * `/json/list` is not one entry: Electron's own internals are listed beside the
 * window, and this rig's first run picked an `about:blank` one - a 0x0 viewport,
 * an empty body, and a screenshot that never came back, which reads exactly like
 * the app failing to paint. The window is the target whose URL is the app's own
 * document; anything else is not the surface this evidence is about.
 */
async function findPage() {
	const list = await (
		await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
	).json();
	const pages = list.filter(
		(target) => target.type === "page" && target.webSocketDebuggerUrl,
	);
	const page = pages.find(
		(target) => !/^(about:blank|devtools:|chrome:)/.test(target.url ?? ""),
	);
	if (!page)
		throw new Error(
			`no app page target on the debug port; saw ${JSON.stringify(
				pages.map((target) => target.url),
			)}`,
		);
	return page;
}

/** One CDP call over the page's own WebSocket, then close it. */
async function cdp(expression) {
	const page = await findPage();
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const result = await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("CDP call timed out")),
			20_000,
		);
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== 1) return;
			clearTimeout(timer);
			if (message.error) reject(new Error(JSON.stringify(message.error)));
			else resolve(message.result);
		});
		socket.send(
			JSON.stringify({
				id: 1,
				method: "Runtime.evaluate",
				params: {
					expression,
					returnByValue: true,
					awaitPromise: true,
				},
			}),
		);
	});
	socket.close();
	return result.result?.value;
}

async function screenshot(path) {
	const page = await findPage();
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	/*
	 * `Page.enable` first: the capture is a Page-domain request, and a target that
	 * has not been enabled for it answers nothing at all - which surfaces as a
	 * timeout rather than as an error. `fromSurface: true` is the default and is
	 * written out here because it is the reason a never-shown window still yields
	 * a complete frame.
	 */
	const data = await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("screenshot timed out")),
			30_000,
		);
		const send = (id, method, params) =>
			socket.send(JSON.stringify({ id, method, params }));
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id === 1) {
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
	socket.close();
	writeFileSync(path, Buffer.from(data, "base64"));
}

/*
 * What the renderer is saying about the connection, read from the page rather
 * than from a log: the connectivity banner's own text, the conversation rows the
 * sidebar rendered, and whether the composer is enabled.
 */
const READ_PAGE = `(() => {
	const banner = document.querySelector('[role="alert"]');
	const rows = Array.from(document.querySelectorAll('[data-session-id], [data-testid="session-row"]'));
	const text = document.body.innerText;
	return JSON.stringify({
		viewport: window.innerWidth + "x" + window.innerHeight,
		banner: banner ? banner.innerText.replace(/\\s+/g, " ").trim() : null,
		session_rows: rows.length,
		/*
		 * The seeded transcript's own first row, read out of the page: the sidebar
		 * shows a title derived from the conversation, so this is what proves the
		 * app loaded the CONTENT rather than painting an empty state. Deliberately
		 * not keyed on a class name - a selector this rig invented would be a claim
		 * about the app's DOM rather than about what a reader sees.
		 */
		has_seeded_row: /row 0000/.test(text),
		says_offline: /Server is offline|not connected|stopped/i.test(text),
		first_lines: text.split("\\n").filter(Boolean).slice(0, 12),
	});
})()`;

let daemon;
let app;
const summary = { label: LABEL, viewport: null, cells: {} };
try {
	say(`# ${LABEL}: app frame evidence, root ${ROOT}`);

	// The conversation the sidebar must render. Seeded into the ISOLATED config
	// dir with the repository's own seeder, so the frame shows the app's real
	// transcript path rather than a fixture drawn for this rig.
	const seeded = launch(process.execPath, [
		"scripts/seed-paging-session.mjs",
		ROOT,
		"40",
	]);
	await new Promise((resolve) => seeded.child.on("exit", resolve));

	say(
		`# starting lop serve on ${DAEMON_PORT} (scratch config, no desktop token)`,
	);
	daemon = launch("lop", ["serve", "--port", String(DAEMON_PORT)], {
		env: { LOCAL_OPERATOR_CONFIG_DIR: ROOT },
	});
	const recordFile = join(ROOT, "run", "serve", `${daemon.child.pid}.json`);
	const deadline = Date.now() + 60_000;
	while (!existsSync(recordFile) && Date.now() < deadline) await wait(250);
	if (!existsSync(recordFile))
		throw new Error(`no serve record: ${daemon.text()}`);
	const record = JSON.parse(readFileSync(recordFile, "utf8"));
	const recordCwd = join(ROOT, "userData", "desktop-token");
	say(
		`# daemon ready: pid ${record.pid} port ${record.port} v${record.version} claim_key ${record.claim_key ? "published" : "empty"}`,
	);
	if (existsSync(recordCwd)) rmSync(recordCwd, { force: true });

	say("# launching the app in headless mode over CDP");
	app = launch("node_modules/.bin/electron", [
		".",
			`--remote-debugging-port=${DEBUG_PORT}`,
			`--user-data-dir=${PROFILE}`,
			`--window-size=${WIDTH}x${HEIGHT}`,
	]);
	/*
	 * The app must attach to the seeded daemon and never spawn one of its own. The
	 * API URL reaches the main process through the environment (this repository's
	 * `.env` is a developer file and is NOT created by this rig - a stray one
	 * changes what other suites' config validation sees, which is exactly the
	 * contamination this comment exists to prevent), so the value is passed to the
	 * child below and asserted here rather than assumed.
	 */
	if (
		!Object.values(childEnv).includes(`http://127.0.0.1:${DAEMON_PORT}`) &&
		process.env.VITE_LOCAL_OPERATOR_API_URL !==
			`http://127.0.0.1:${DAEMON_PORT}`
	)
		throw new Error(
			`set VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${DAEMON_PORT} for this run (and rebuild with it unset: the URL is read at runtime)`,
		);

	// Attached: wait for the sidebar to hold the seeded conversation.
	let attached = null;
	const attachDeadline = Date.now() + 90_000;
	while (Date.now() < attachDeadline) {
		try {
			const page = JSON.parse(await cdp(READ_PAGE));
			attached = page;
			if (page.session_rows > 0 || page.has_seeded_row) break;
		} catch {
			/* the debugger is not up yet */
		}
		await wait(1_000);
	}
	if (!attached)
		throw new Error("the app's page never became readable over CDP");
	summary.viewport = attached.viewport;
	summary.cells.attached = attached;
	await screenshot(join(OUT, `${LABEL}-attached.png`));
	say(`# attached frame: ${JSON.stringify(attached)}`);

	// The honest-detach control: this daemon really goes away.
	say("# killing the daemon");
	await stop(daemon);
	daemon = null;
	let detached = null;
	const detachDeadline = Date.now() + 90_000;
	while (Date.now() < detachDeadline) {
		detached = JSON.parse(await cdp(READ_PAGE));
		if (detached.banner) break;
		await wait(1_000);
	}
	summary.cells.daemon_killed = detached;
	await screenshot(join(OUT, `${LABEL}-daemon-killed.png`));
	say(`# daemon-killed frame: ${JSON.stringify(detached)}`);
} finally {
	if (app) await stop(app);
	if (daemon) await stop(daemon);
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
		writeFileSync(
			join(OUT, `${LABEL}-backend-service.log`),
			readFileSync(logFile),
		);
	}
	rmSync(ROOT, { recursive: true, force: true });
}
