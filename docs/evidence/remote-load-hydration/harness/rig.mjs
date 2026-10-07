#!/usr/bin/env node
/**
 * Load-hydration rig for the remote transcript's cold-open fix
 * (`remote-load-hydration`).
 *
 * Launches the BUILT app from a worktree in the documented `headless` window
 * mode with a scratch profile, against the machine's real daemon (which
 * carries the mesh), and drives it over CDP. It is the `remote-turn-order`
 * rig's committed copy, brought over for this lane (that set's README and this
 * one's hold the provenance), with ONE addition: a `warm` op that POSTs the
 * daemon's `/v1/desktop/sessions/<id>/warm` with the operator app's own token -
 * the same call the pane makes on a first keystroke, which is how the cold to
 * warm flip is produced on demand in a headless window whose watch lease is
 * never visible (and therefore never warms anything).
 *
 * Safety notes:
 * - The app talks to 127.0.0.1:1111 via LOCAL_OPERATOR_DESKTOP_TOKEN read from
 *   the operator app's token file; the token is never printed (the `warm` op
 *   logs the STATUS and the receipt, and the receipt carries no secret).
 * - Scratch profile lives under the session scratchpad; no other profile is
 *   touched. Window mode `headless`: created, never shown.
 * - Teardown kills the exact pid and then reaps any process whose command line
 *   names this run's profile directory (detection by unique tag, kill by pid).
 *
 * Usage:
 *   LOCAL_OPERATOR_UI_WORKTREE=<repo worktree> \\
 *   LOCAL_OPERATOR_SCRATCHPAD=<scratch dir> \\
 *   [EVIDENCE_SESSION_ID=<session id, for plans that name $SESSION>] \\
 *   node rig.mjs --plan <plan.json> --out <dir> [--keep]
 * Plan: { steps: [ {op, ...}, ... ] } - see the three plans beside this file.
 *
 * READ-ONLY RULE FOR THE OPERATOR'S OWN SESSION: `plan-cold-open.json`
 * navigates to the operator's stored remote session and only reads (no send, no
 * warm); it is the BEFORE half's own session, so the pair stays apples-to-apples
 * on one conversation. Do not add a `send` or `warm` step to it.
 */
import { spawn, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
/*
 * THE SWITCH IS TAKEN FROM ITS ONE HOME, never typed: `chrome-keychain.test.mjs`
 * scans `scripts/`, `bin/` and every evidence harness for the literal, because a
 * rig that spells it by hand drifts the day the switch it needs is something
 * else. This rig launches Electron rather than Chrome, so it is not a launch
 * site the helper wraps — but it still passes the switch, and it passes the
 * constant (the `chat-device-live` rig's shape).
 */
import { MOCK_KEYCHAIN_SWITCH } from "../../../../scripts/chrome-keychain.mjs";

const WORKTREE = process.env.LOCAL_OPERATOR_UI_WORKTREE;
if (!WORKTREE) {
	console.error(
		"need LOCAL_OPERATOR_UI_WORKTREE=<the worktree whose out/ build the app boots",
	);
	process.exit(2);
}
const ELECTRON = join(
	WORKTREE,
	"node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
const SCRATCH = process.env.LOCAL_OPERATOR_SCRATCHPAD || process.cwd();
const TOKEN_FILE = join(
	process.env.HOME,
	"Library/Application Support/Local Operator/desktop-token",
);

function argValue(flag, fallback = undefined) {
	const at = process.argv.indexOf(flag);
	return at === -1 ? fallback : process.argv[at + 1];
}
const PLAN_PATH = argValue("--plan");
const OUT = argValue("--out", join(SCRATCH, "rig", "out"));
const KEEP = process.argv.includes("--keep");
if (!PLAN_PATH) {
	console.error("need --plan <plan.json>");
	process.exit(2);
}
const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));
/*
 * One substitution, for the plans that name a session created at run time (or
 * by another device): `$SESSION` in a `nav` path, and the default the `warm`
 * op falls back to. Absent, the plans that carry a literal id are unaffected.
 */
const SESSION_ID = process.env.EVIDENCE_SESSION_ID || null;
for (const step of plan.steps) {
	if (typeof step.path === "string")
		step.path = step.path.replaceAll("$SESSION", SESSION_ID ?? "");
}
mkdirSync(OUT, { recursive: true });
const RUN_TAG = `turnorder-rig-${process.pid}`;
const PROFILE = join(SCRATCH, "rig", `profile-${process.pid}`);
const ROWS_LOG = join(OUT, `rows-${process.pid}.jsonl`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pickFreePort() {
	return new Promise((resolvePort, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolvePort(port));
		});
		server.on("error", reject);
	});
}

// ---------------------------------------------------------------- CDP client

class Cdp {
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
	send(method, params = {}) {
		const id = this.nextId++;
		const promise = new Promise((resolve, reject) => {
			this.pending.set(id, (message) => {
				if (message.error)
					reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
				else resolve(message.result);
			});
		});
		this.socket.send(JSON.stringify({ id, method, params }));
		return promise;
	}
	async evaluate(expression, awaitPromise = true) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise,
			returnByValue: true,
		});
		if (result.exceptionDetails) {
			throw new Error(
				`evaluate threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
			);
		}
		return result.result?.value;
	}
	static async attach(port, timeoutMs = 90_000) {
		const started = Date.now();
		for (;;) {
			try {
				const list = await (
					await fetch(`http://127.0.0.1:${port}/json/list`)
				).json();
				const target = list.find(
					(e) => e.type === "page" && e.url.includes("index.html"),
				);
				if (target) {
					const socket = new WebSocket(target.webSocketDebuggerUrl);
					await new Promise((res, rej) => {
						socket.addEventListener("open", res, { once: true });
						socket.addEventListener("error", rej, { once: true });
					});
					const client = new Cdp(socket);
					await client.send("Runtime.enable");
					await client.send("Page.enable");
					return client;
				}
			} catch {
				/* not up yet */
			}
			if (Date.now() - started > timeoutMs) {
				throw new Error(
					`no renderer target on port ${port} after ${timeoutMs}ms`,
				);
			}
			await wait(300);
		}
	}
}

// ----------------------------------------------------------------- launcher

function operatorToken() {
	return readFileSync(TOKEN_FILE, "utf8").trim();
}

async function launch() {
	const port = await pickFreePort();
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	Object.assign(env, {
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		LOCAL_OPERATOR_DESKTOP_TOKEN: operatorToken(),
	});
	const child = spawn(
		ELECTRON,
		[
			WORKTREE,
			`--user-data-dir=${PROFILE}`,
			`--remote-debugging-port=${port}`,
			"--window-mode=headless",
			"--window-size=1380x900",
			MOCK_KEYCHAIN_SWITCH,
		],
		{ env, cwd: WORKTREE, stdio: ["ignore", "pipe", "pipe"] },
	);
	const logPath = join(OUT, `app-${process.pid}.log`);
	const chunks = [];
	child.stdout.on("data", (c) => chunks.push(c.toString()));
	child.stderr.on("data", (c) => chunks.push(c.toString()));
	const flush = () => {
		try {
			writeFileSync(logPath, chunks.join(""));
		} catch {}
	};
	const timer = setInterval(flush, 500);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});
	console.log(`launched pid=${child.pid} port=${port} profile=${PROFILE}`);
	return { child, port, logPath, flush };
}

function reap(handle) {
	try {
		handle.child.kill("SIGKILL");
	} catch {}
	handle.flush();
	// Detection: any process whose command line names this run's profile dir.
	const ps = spawnSync("ps", ["-eo", "pid,command"], { encoding: "utf8" });
	const needle = `profile-${process.pid}`;
	for (const line of String(ps.stdout ?? "").split("\n")) {
		if (!line.includes(needle)) continue;
		const m = line.trim().match(/^(\d+)/);
		if (!m) continue;
		const pid = Number(m[1]);
		if (pid === process.pid) continue;
		try {
			process.kill(pid, "SIGKILL");
			console.log(`reaped pid=${pid} (profile tag match)`);
		} catch {}
	}
}

// ------------------------------------------------------------------- steps

async function clickAt(cdp, selector) {
	const rect = await cdp.evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return null;
		el.scrollIntoView({ block: "center", behavior: "instant" });
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`);
	if (!rect) throw new Error(`clickAt: no element for ${selector}`);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: rect.x,
			y: rect.y,
			button: "left",
			clickCount: 1,
		});
	}
}

async function pressEnter(cdp) {
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
		});
	}
}

const ROW_DUMP = `(() => {
	const rows = [...document.querySelectorAll('[data-record-id]')].map((el) => ({
		id: el.getAttribute('data-record-id'),
		kind: el.getAttribute('data-record-kind'),
		cls: String(el.className).slice(0, 90),
		text: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 140),
	}));
	// The composer band's own controls, to see stop vs send.
	const stop = Boolean(document.querySelector('[aria-label="Stop"], [aria-label="Stop agent"]'));
	const working = [...document.querySelectorAll('*')]
		.filter((el) => el.children.length === 0 && /working|Thinking|Running/.test(el.textContent || ''))
		.slice(0, 3)
		.map((el) => (el.textContent || '').slice(0, 60));
	return { rows, stop, working, hash: location.hash };
})()`;

async function sampleRows(cdp, note = "") {
	const dump = await cdp.evaluate(ROW_DUMP);
	const at = Date.now();
	appendFileSync(
		ROWS_LOG,
		JSON.stringify({
			t: at,
			note,
			rows: dump.rows,
			stop: dump.stop,
			working: dump.working,
		}) + "\n",
	);
	return dump;
}

async function shot(cdp, name) {
	const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${name}.png`);
	writeFileSync(file, Buffer.from(data, "base64"));
	console.log(`frame ${file}`);
	return file;
}

async function waitForCondition(cdp, expression, timeoutMs) {
	const started = Date.now();
	for (;;) {
		const ok = await cdp.evaluate(`Boolean(${expression})`).catch(() => false);
		if (ok) return true;
		if (Date.now() - started > timeoutMs) return false;
		await wait(400);
	}
}

async function runPlan(cdp) {
	for (const [index, step] of plan.steps.entries()) {
		const label = `[${index}] ${step.op}`;
		try {
			switch (step.op) {
				case "nav": {
					await cdp.evaluate(
						`(() => { window.location.hash = ${JSON.stringify("#" + step.path)}; return true; })()`,
					);
					console.log(`${label} -> ${step.path}`);
					break;
				}
				case "wait": {
					await wait(step.ms);
					console.log(`${label} waited ${step.ms}ms`);
					break;
				}
				case "waitText": {
					const ok = await waitForCondition(
						cdp,
						`document.body.innerText.includes(${JSON.stringify(step.text)})`,
						step.timeoutMs ?? 30_000,
					);
					console.log(
						`${label} text ${JSON.stringify(step.text).slice(0, 60)} ok=${ok}`,
					);
					if (!ok && step.required !== false)
						throw new Error(`waitText timed out`);
					break;
				}
				case "waitFor": {
					const ok = await waitForCondition(
						cdp,
						`document.querySelector(${JSON.stringify(step.selector)}) !== null`,
						step.timeoutMs ?? 30_000,
					);
					console.log(`${label} selector ${step.selector} ok=${ok}`);
					if (!ok && step.required !== false)
						throw new Error(`waitFor timed out`);
					break;
				}
				case "waitRows": {
					const ok = await waitForCondition(
						cdp,
						`document.querySelectorAll('[data-record-id]').length >= ${step.min}`,
						step.timeoutMs ?? 30_000,
					);
					console.log(`${label} rows>=${step.min} ok=${ok}`);
					if (!ok && step.required !== false)
						throw new Error(`waitRows timed out`);
					break;
				}
				case "shot": {
					await shot(cdp, step.name);
					break;
				}
				case "rows": {
					const dump = await sampleRows(cdp, step.note ?? label);
					console.log(
						`${label} stop=${dump.stop} rows=${dump.rows.map((r) => `${r.kind}:${r.id.slice(0, 10)}`).join(" | ")}`,
					);
					break;
				}
				case "send": {
					await clickAt(
						cdp,
						step.selector ?? '[data-tour-tag="chat-input-textarea"] textarea',
					);
					await cdp.send("Input.insertText", { text: step.text });
					await wait(150);
					await pressEnter(cdp);
					console.log(
						`${label} sent ${JSON.stringify(step.text).slice(0, 60)}`,
					);
					break;
				}
				case "click": {
					await clickAt(cdp, step.selector);
					console.log(`${label} clicked ${step.selector}`);
					break;
				}
				case "eval": {
					const value = await cdp.evaluate(step.js, step.awaitPromise ?? true);
					const serialized = JSON.stringify(value);
					writeFileSync(join(OUT, `eval-${index}.json`), serialized ?? "null");
					console.log(
						`${label} => [${serialized?.length ?? 0} chars] ${serialized?.slice(0, 300)}`,
					);
					break;
				}
				case "frames": {
					// Capture a frame + row sample on an interval.
					const started = Date.now();
					let n = 0;
					while (Date.now() - started < step.totalMs) {
						await sampleRows(cdp, `${step.prefix}-${n}`);
						await shot(cdp, `${step.prefix}-${String(n).padStart(2, "0")}`);
						n += 1;
						await wait(step.everyMs ?? 700);
					}
					console.log(`${label} captured ${n} frame(s)`);
					break;
				}
				case "watch": {
					// Dense rows-only sampling with flip detection. A screenshot is taken
					// on the first inverted sample and every `shotEveryMs`.
					const started = Date.now();
					let n = 0;
					let lastShot = 0;
					let flipSeen = false;
					while (Date.now() - started < step.totalMs) {
						const dump = await sampleRows(cdp, `${step.prefix}-${n}`);
						const kinds = dump.rows.map((r) => r.kind || "?");
						const ui = kinds.indexOf("user");
						const ai = kinds.indexOf("assistant");
						const inverted = ai !== -1 && ui !== -1 && ai < ui;
						const firstFlip = inverted && !flipSeen;
						if (firstFlip) {
							flipSeen = true;
							console.log(
								`${label} FLIP at ${step.prefix}-${n}: ${JSON.stringify(kinds)}`,
							);
						}
						const takeShot =
							firstFlip ||
							(step.shotEveryMs && Date.now() - lastShot >= step.shotEveryMs);
						if (takeShot) {
							await shot(
								cdp,
								firstFlip ? `${step.prefix}-flip-${n}` : `${step.prefix}-s${n}`,
							);
							lastShot = Date.now();
						}
						n += 1;
						await wait(step.everyMs ?? 300);
					}
					console.log(`${label} watched ${n} sample(s); flip=${flipSeen}`);
					break;
				}
				case "framesUntilQuiet": {
					// Capture until the row set stops changing for quietMs, bounded by totalMs.
					const started = Date.now();
					let last = "";
					let quietSince = Date.now();
					let n = 0;
					while (Date.now() - started < step.totalMs) {
						const dump = await sampleRows(cdp, `${step.prefix}-${n}`);
						const signature =
							JSON.stringify(dump.rows.map((r) => r.id)) + dump.stop;
						await shot(cdp, `${step.prefix}-${String(n).padStart(2, "0")}`);
						n += 1;
						if (signature !== last) {
							last = signature;
							quietSince = Date.now();
						} else if (Date.now() - quietSince > (step.quietMs ?? 6000)) {
							break;
						}
						await wait(step.everyMs ?? 700);
					}
					console.log(`${label} captured ${n} frame(s) until quiet`);
					break;
				}
				case "warm": {
					/*
					 * The one addition to the turn-order rig (see this file's header): the
					 * daemon's own warm route, with the operator app's token. The receipt
					 * (a `WarmReceipt`) carries no secret, so it is safe to log - the token
					 * itself never enters stdout.
					 */
					const sessionId = step.sessionId ?? SESSION_ID;
					if (!sessionId) throw new Error("warm: no sessionId");
					const response = await fetch(
						`http://127.0.0.1:1111/v1/desktop/sessions/${sessionId}/warm`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: `Bearer ${operatorToken()}`,
							},
							body: "{}",
							signal: AbortSignal.timeout(30_000),
						},
					);
					const receipt = await response.text();
					console.log(
						`${label} warm -> ${response.status} ${receipt.slice(0, 200)}`,
					);
					break;
				}
				default:
					throw new Error(`unknown step op ${step.op}`);
			}
		} catch (error) {
			console.error(`${label} FAILED: ${error.message}`);
			await shot(cdp, `failure-${index}`).catch(() => {});
			throw error;
		}
	}
}

// -------------------------------------------------------------------- main

let handle = null;
try {
	handle = await launch();
	await wait(1000);
	let cdp = null;
	for (let attempt = 0; attempt < 3 && !cdp; attempt++) {
		try {
			cdp = await Cdp.attach(handle.port, 90_000);
		} catch (error) {
			console.error(`attach attempt ${attempt + 1} failed: ${error.message}`);
			handle.flush();
		}
	}
	if (!cdp) throw new Error("could not attach to the renderer");
	console.log("attached");
	await runPlan(cdp);
	console.log("plan complete");
	writeFileSync(
		join(OUT, "app-final.log"),
		(() => {
			handle.flush();
			return readFileSync(handle.logPath, "utf8");
		})(),
	);
} finally {
	if (handle && !KEEP) reap(handle);
	if (handle && KEEP)
		console.log(`--keep: app left running, pid=${handle.child.pid}`);
}
process.exit(0);
