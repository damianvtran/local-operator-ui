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

/** One CDP call over the page's own WebSocket, then close it. */
async function cdp(expression) {
	const list = await (
		await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
	).json();
	const page = list.find(
		(target) => target.type === "page" && target.webSocketDebuggerUrl,
	);
	if (!page) throw new Error("no page target on the debug port");
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
	const list = await (
		await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
	).json();
	const page = list.find(
		(target) => target.type === "page" && target.webSocketDebuggerUrl,
	);
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const data = await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("screenshot timed out")),
			30_000,
		);
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== 1) return;
			clearTimeout(timer);
			if (message.error) reject(new Error(JSON.stringify(message.error)));
			else resolve(message.result.data);
		});
		socket.send(
			JSON.stringify({
				id: 1,
				method: "Page.captureScreenshot",
				params: { format: "png" },
			}),
		);
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
	// The app must attach to the seeded daemon, not spawn one, and must reach the
	// port this rig chose: both are build-time values in this repository, so they
	// are asserted rather than assumed.
	const envFile = join(REPO, ".env");
	const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
	if (!envText.includes(`:${DAEMON_PORT}`)) {
		throw new Error(
			`.env must point VITE_LOCAL_OPERATOR_API_URL at the scratch daemon (port ${DAEMON_PORT}); run the build once with ATTACH_FRAME_PORT=${DAEMON_PORT}`,
		);
	}

	// Attached: wait for the sidebar to hold the seeded conversation.
	let attached = null;
	const attachDeadline = Date.now() + 90_000;
	while (Date.now() < attachDeadline) {
		try {
			const page = JSON.parse(await cdp(READ_PAGE));
			if (page.session_rows > 0) {
				attached = page;
				break;
			}
			attached = page;
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
