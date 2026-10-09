#!/usr/bin/env node
/**
 * Drive the BUILT app headless against an ISOLATED backend, on a REAL session
 * with real wakes, and photograph the Wakes section's cancel flow.
 *
 *     node docs/evidence/wake-cancel-live/harness/wake-cancel-rig.mjs \
 *       --scenario rest --tree ~/local-operator-ui-worktrees/wake-cancel-pane \
 *       --out <frames dir> --api http://127.0.0.1:8080 --session <id> --wake w2
 *
 * ## Why this exists, and what it is not
 *
 * The committed Storybook set (`docs/evidence/chat-run-panel/`) photographs the
 * section's states; a still cannot carry a DELETE, a refusal or the canonical
 * re-read that follows a write. This rig is the other half: the app's own
 * `webContents.capturePage()` over the dev-driver bridge
 * (`docs/agent-driver.md`) while a real press fires a real request at a daemon
 * this run owns, with the wire side read back from that daemon's own log.
 *
 * It is deliberately the repo's documented mechanisms only: a built app in
 * `headless` window mode, the armed bridge, CDP for input, and the daemon's log
 * for the wire. No Playwright, no Puppeteer, no downloaded Chromium, no
 * `screencapture` (which would require the focus theft the window modes exist
 * to remove).
 *
 * ## Isolation
 *
 * `HOME`, `LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_LOG_DIR`,
 * `--user-data-dir` and the app's cwd are all scratch, `CMUX_*`/`LOP_*`/
 * `XPC_FLAGS` are stripped from the child, and the run REFUSES to start unless
 * the renderer reports the backend URL this run was given. Nothing here may
 * touch `http://localhost:1111` — the operator's own daemon — and the assertion
 * for that is on every launch.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const arg = (name, fallback = null) => {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const say = (line) => process.stdout.write(`${line}\n`);

const SCENARIO = arg("scenario", "rest");
const TREE = resolve(arg("tree", process.cwd()));
const OUT = resolve(arg("out", join(TREE, "docs/evidence/wake-cancel-live/frames")));
const API = arg("api", "http://127.0.0.1:8080");
const SESSION = arg("session");
const WAKE = arg("wake", "w2");
const SEND_TEXT = arg("send-text", "Please summarise the current directory.");
const AIDA_SESSION = arg("aida-session");
const PORT = Number(arg("port", "9471"));
const TOKEN = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN ?? "";
const SCRATCH = mkdtempSync(join(tmpdir(), "wake-cancel-rig-"));

if (!TOKEN) {
	say("[refusing] LOCAL_OPERATOR_DESKTOP_TOKEN is not set for this run");
	process.exit(1);
}
if (API.includes(":1111")) {
	say("[refusing] :1111 is the operator's own daemon; this rig runs isolated");
	process.exit(1);
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const facts = { scenario: SCENARIO, tree: TREE, api: API, scratch: SCRATCH, steps: [] };
const record = (label, body) => {
	facts.steps.push({ label, body });
	say(`[step] ${label}: ${JSON.stringify(body).slice(0, 220)}`);
};

/* ------------------------------------------------------------------ daemon */

/*
 * The wire side, from the daemon's own access log (`--daemon-log`, which the
 * wrapper must point at `local-operator serve --debug`'s stdout — uvicorn's
 * access lines are the only place a DELETE and its status are written down
 * outside the app). Empty rather than invented when the file is absent.
 */
const DAEMON_LOG = arg("daemon-log", "");
const daemonLog = () =>
	DAEMON_LOG !== "" && existsSync(DAEMON_LOG)
		? readFileSync(DAEMON_LOG, "utf8")
		: "";
const daemonLines = (regex) =>
	daemonLog()
		.split("\n")
		.filter((line) => regex.test(line));

/** The wire side of a step: the daemon's own log lines for a route. */
const recordWire = (label, regex) => record(`${label} (daemon log)`, daemonLines(regex));

/* ---------------------------------------------------------------- launch */

const electron = require("electron");
const appCwd = join(SCRATCH, "cwd");
mkdirSync(appCwd, { recursive: true });
writeFileSync(
	join(appCwd, ".env"),
	[
		"# Written by wake-cancel-rig.mjs: the app applies this with dotenv",
		"# override:true from its cwd, which is why the cwd is outside the checkout.",
		`VITE_LOCAL_OPERATOR_API_URL=${API}`,
		"VITE_DISABLE_BACKEND_MANAGER=true",
		"",
	].join("\n"),
);

const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	if (/^(CMUX_|LOP_)/.test(key)) delete childEnv[key];
}
delete childEnv.XPC_FLAGS;
Object.assign(childEnv, {
	HOME: SCRATCH,
	LOCAL_OPERATOR_CONFIG_DIR: join(SCRATCH, ".local-operator"),
	LOCAL_OPERATOR_LOG_DIR: join(SCRATCH, "logs"),
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	LOCAL_OPERATOR_UI_TELEMETRY: "off",
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_UI_DEV_DRIVER: "1",
	LOCAL_OPERATOR_UI_DEV_DRIVER_OUT: OUT,
	LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
});
mkdirSync(join(SCRATCH, "logs"), { recursive: true });
mkdirSync(OUT, { recursive: true });

const app = spawn(
	electron,
	[
		join(TREE, "out/main/index.js"),
		"--window-mode=headless",
		"--window-size=1380x900",
		`--user-data-dir=${join(SCRATCH, "profile")}`,
		`--remote-debugging-port=${PORT}`,
	],
	/*
	 * `detached`, so the app is its own process GROUP and the teardown can reap
	 * the whole tree (main + GPU + renderer helpers) by exact negative pid — the
	 * repo's own rule for every launch this rig makes.
	 */
	{ cwd: appCwd, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
);
const appLog = [];
app.stdout.on("data", (chunk) => appLog.push(String(chunk)));
app.stderr.on("data", (chunk) => appLog.push(String(chunk)));
say(`[launch] app pid ${app.pid}, scratch ${SCRATCH}`);

const reap = () => {
	try {
		process.kill(-app.pid, "SIGTERM");
	} catch {
		app.kill("SIGTERM");
	}
};
process.on("exit", reap);

/* -------------------------------------------------------------------- CDP */

let ws = null;
let sequence = 0;
const pending = new Map();

const cdp = (method, params = {}) =>
	new Promise((done, fail) => {
		const id = ++sequence;
		pending.set(id, { done, fail });
		ws.send(JSON.stringify({ id, method, params }));
		setTimeout(() => {
			if (pending.delete(id)) fail(new Error(`timeout: ${method}`));
		}, 30_000);
	});

const evaluate = async (expression) => {
	const result = await cdp("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails)
		throw new Error(
			`evaluate failed: ${result.exceptionDetails.exception?.description ?? "unknown"}`,
		);
	return result.result?.value;
};

/** A dev-driver bridge verb, exactly as `renderer-driver.mjs` calls it. */
const verb = (name, payload) =>
	evaluate(
		`window.__loDevDriver.call(${JSON.stringify(name)}, ${JSON.stringify(payload ?? null)})`,
	);

const target = `[data-run-panel-row="${WAKE}"]`;

/** Wait for the bridge AND for the app to report this run's backend. */
const armAndCheck = async () => {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		try {
			const hello = await verb("hello");
			if (hello?.apiBaseUrl === undefined) {
				await wait(500);
				continue;
			}
			record("hello", {
				apiBaseUrl: hello.apiBaseUrl,
				viewport: hello.viewport,
				windowMode: hello.facts?.windowMode ?? hello.windowMode,
			});
			if (hello.apiBaseUrl !== API)
				throw new Error(
					`renderer was built for ${hello.apiBaseUrl}, not ${API} — rebuild with VITE_LOCAL_OPERATOR_API_URL=${API}`,
				);
			return;
		} catch {
			await wait(500);
		}
	}
	throw new Error("the dev-driver bridge never armed");
};

const page = async () => {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
			const found = list.find(
				(entry) => entry.type === "page" && entry.url.includes("index.html"),
			);
			if (found) return found;
		} catch {
			/* not up yet */
		}
		await wait(500);
	}
	throw new Error("no page target on the debugging port");
};

const connect = async () => {
	const found = await page();
	ws = new WebSocket(found.webSocketDebuggerUrl);
	ws.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.error) entry.fail(new Error(JSON.stringify(message.error)));
		else entry.done(message.result);
	});
	await new Promise((done, fail) => {
		ws.addEventListener("open", done);
		ws.addEventListener("error", fail);
	});
};

/* ------------------------------------------------------------- page reads */

/**
 * The Wakes section's own reading: the rows, their controls, their states, the
 * managed line and any open confirmation, plus whether the retired footer
 * sentence is still on the page. Scoped to the section whose heading is
 * `Wakes` so the roster and the jobs list cannot contribute a row.
 */
const readPane = () =>
	evaluate(`(() => {
	const text = (node) => (node?.textContent ?? "").replace(/\\s+/g, " ").trim();
	const section = [...document.querySelectorAll("section")].find((node) =>
		text(node.querySelector("span")).startsWith("Wakes"));
	return {
		section: section !== null && section !== undefined,
		rows: [...(section?.querySelectorAll("[data-run-panel-row]") ?? [])].map((row) => ({
			id: row.getAttribute("data-run-panel-row"),
			text: text(row).slice(0, 200),
		})),
		cancels: [...(section?.querySelectorAll("[data-wake-cancel]") ?? [])].map((control) => ({
			wake: control.getAttribute("data-wake-cancel"),
			state: control.getAttribute("data-wake-cancel-state"),
			label: text(control),
			disabled: control.hasAttribute("disabled"),
		})),
		notes: [...(section?.querySelectorAll("[data-wake-cancel-note]") ?? [])].map(text),
		managed: [...(section?.querySelectorAll("[data-wake-managed]") ?? [])].map(text),
		/*
		 * The stopgap sentence's presence, read from the WHOLE body: the retired
		 * copy must be gone from the app, and a check on one node would miss it
		 * in a tooltip.
		 */
		retiredFooter: /To stop a wake, ask the agent to cancel it/.test(
			document.body.textContent ?? "",
		),
	};
})()`);

const readCard = () =>
	evaluate(`(() => {
	const card = document.querySelector("[data-wake-confirm]");
	if (card === null) return null;
	const text = (node) => (node?.textContent ?? "").replace(/\\s+/g, " ").trim();
	return {
		label: card.getAttribute("aria-label"),
		text: text(card),
		refusal: text(card.querySelector("[data-wake-confirm-refusal]")),
		open: true,
	};
})()`);

const pollTrace = async (ms = 2_400, everyMs = 80) => {
	const trace = [];
	const started = Date.now();
	while (Date.now() - started < ms) {
		trace.push(await evaluate(`(() => {
			const section = [...document.querySelectorAll("section")].find((node) =>
				(node.querySelector("span")?.textContent ?? "") === "Wakes");
			return {
				at: Date.now(),
				rows: section?.querySelectorAll("[data-run-panel-row]").length ?? -1,
				note: document.querySelector("[data-wake-cancel-note]")?.textContent ?? null,
				card: document.querySelector("[data-wake-confirm]") !== null,
			};
		})()`));
		await wait(everyMs);
	}
	return trace;
};

const capture = async (label) => {
	/*
	 * `capture` is the PRELOAD's own method, not a scene verb (`call` would throw
	 * "no dev driver verb"): the app photographs itself with
	 * `webContents.capturePage()` and writes `<outDir>/<label>.png`.
	 */
	const result = await evaluate(
		`window.__loDevDriver.capture(${JSON.stringify(label)})`,
	);
	await wait(250);
	const file = join(OUT, `${label}.png`);
	if (!existsSync(file)) throw new Error(`capture wrote no file for ${label}`);
	record(`capture ${label}`, { file, pixels: result?.pixels, viewport: result?.viewport });
	return file;
};

const press = async (selector) => {
	const entry = await verb("press", { selector });
	record(`press ${selector}`, {
		target: entry?.target,
		hitTest: entry?.hitTest,
		disabled: entry?.disabled,
	});
	/*
	 * `hitTest` false is NOT a failure for a disabled control (`pointer-events:
	 * none` is this design system's disabled state, so the topmost element at its
	 * centre is its parent) — every control this rig presses is live, so here it
	 * is.
	 */
	if (entry?.hitTest !== true)
		throw new Error(`press did not reach ${selector}: ${JSON.stringify(entry)}`);
	return entry;
};

/**
 * A hover, as `renderer-driver.mjs` performs one: `measure` answers the box,
 * the REAL pointer moves over CDP, and the element's own `:hover` is the
 * verdict (a synthetic event cannot produce a `group-hover` reveal).
 */
const hover = async (selector) => {
	const box = await verb("measure", { selector });
	const { x, y } = box.centre;
	await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
	await wait(200);
	const hovering = await evaluate(
		`document.querySelector(${JSON.stringify(selector)})?.matches(":hover") ?? false`,
	);
	record(`hover ${selector}`, { centre: box.centre, hovering });
	if (hovering !== true) throw new Error(`the pointer is not over ${selector}`);
};

const until = async (predicate, ms = 20_000) => {
	const started = Date.now();
	while (Date.now() - started < ms) {
		if (await predicate()) return true;
		await wait(200);
	}
	return false;
};

/* --------------------------------------------------------------- scenarios */

/**
 * Close the first-run "Connect an AI account" flow if this fresh profile drew it.
 *
 * The profile under `--user-data-dir` is scratch, so the app has never completed
 * onboarding and covers the window with a scrim; every press would land on it.
 * The skip is a real press on the real control (found by its own text, tagged
 * with a rig-only attribute so `press` can address it), and the app's own
 * persistence is what stops it coming back within this profile.
 */
const dismissOnboarding = async () => {
	const skip = await evaluate(`(() => {
		if (document.querySelector("div.fixed.inset-0.z-50") === null) return null;
		/*
		 * Document-wide, not inside the scrim: the card is the scrim's SIBLING in
		 * the portal (measured — the scrim holds no buttons), so a scoped query
		 * found nothing and the first revision of this step was a no-op.
		 */
		const button = [...document.querySelectorAll("button")].find((node) =>
			/skip for now/i.test(node.textContent ?? ""));
		if (button === undefined) return null;
		button.setAttribute("data-rig-skip", "");
		return "[data-rig-skip]";
	})()`);
	if (skip === null) return false;
	await press(skip);
	record("onboarding dismissed", { control: skip });
	await wait(400);
	return true;
};

/**
 * Open the wakes pane on one conversation and, unless the scenario arms its wake
 * after opening, wait for that row to be on screen.
 *
 * The chip press is the app's own route (the composer's count chip opens the
 * pane on the section); `expectRow` false is for `live-refusal`, where the wake
 * does not exist until the runtime has been warmed by a message.
 */
const openSessionPane = async (sessionId, { expectRow = true } = {}) => {
	await verb("navigate", `/chat/${sessionId}`);
	await wait(600);
	await dismissOnboarding();
	const chip = '[data-status-wakes]';
	if (!(await until(async () => evaluate(`document.querySelector(${JSON.stringify(chip)}) !== null`), 30_000)))
		throw new Error("the wake chip never came on screen");
	/*
	 * The overlay probe, and its frame: when a press misses, the useful reading
	 * is WHICH element took the point. `elementsFromPoint` at the control's
	 * centre, widest first — recorded before the press so a failure carries the
	 * reason rather than only the symptom.
	 */
	record(
		"chip overlay probe",
		await evaluate(`(() => {
			const chip = document.querySelector(${JSON.stringify(chip)});
			const rect = chip.getBoundingClientRect();
			const at = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
			return {
				at,
				stack: document.elementsFromPoint(at.x, at.y).slice(0, 5).map((node) => {
					const style = getComputedStyle(node);
					return \`\${node.tagName.toLowerCase()}#\${node.id}.\${String(node.className).slice(0, 40)}|pe=\${style.pointerEvents}|pos=\${style.position}|z=\${style.zIndex}\`;
				}),
			};
		})()`),
	);
	await capture("debug-before-chip");
	await press(chip);
	if (
		expectRow &&
		!(await until(async () => evaluate(`document.querySelector(${JSON.stringify(target)}) !== null`), 30_000))
	)
		throw new Error(`the wake row ${WAKE} never came on screen`);
};

const runRest = async () => {
	await openSessionPane(SESSION);
	record("pane at rest", await readPane());
	await hover(`[data-wake-cancel="${WAKE}"]`);
	await capture("pane-hover");
	await capture("pane-at-rest");
};

const runCancel = async () => {
	await openSessionPane(SESSION);
	await capture("cancel-before");
	await press(`[data-wake-cancel="${WAKE}"]`);
	const trace = await pollTrace();
	record("churn trace", trace);
	await capture("cancel-receipt");
	const gone = await until(
		async () => evaluate(`document.querySelector(${JSON.stringify(target)}) === null`),
		30_000,
	);
	record("row dropped by the re-read", { gone });
	await capture("cancel-gone");
	recordWire("cancel delete", /DELETE \/v1\/desktop\/wakes\//);
};

const runRefusal = async () => {
	await openSessionPane(SESSION);
	await capture("refusal-before");
	/*
	 * THE STALE ROW, made deliberately: the wake is cancelled OUT OF BAND through
	 * the same route the app uses, so the pane keeps drawing a row (and a
	 * control) the store no longer holds. The app's press is then a real DELETE
	 * of a wake that is already gone, which is what the 404 refusal renders.
	 */
	if (arg("stale") !== null) {
		/*
		 * THE RACE, made real rather than avoided: the app's own push drops the
		 * row the moment the store changes (measured: within ~300 ms of this
		 * DELETE landing, the pane had already re-read and the control was gone),
		 * so the press has to follow the out-of-band write INSIDE that window.
		 * `--stale-delay-ms` is the knob; the rig records whether the control was
		 * still on screen when the press fired, so a run that lost the race says
		 * so instead of quietly testing nothing.
		 */
		const response = await fetch(`${API}/v1/desktop/wakes/${SESSION}/${WAKE}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
		record("out-of-band cancel", {
			status: response.status,
			body: (await response.text()).slice(0, 300),
		});
		await wait(Number(arg("stale-delay-ms", "60")));
		record("stale control present", {
			present: await evaluate(
				`document.querySelector('[data-wake-cancel="${WAKE}"]') !== null`,
			),
		});
	}
	await press(`[data-wake-cancel="${WAKE}"]`);
	await until(
		async () => evaluate(`document.querySelector("[data-wake-cancel-note]") !== null`),
		20_000,
	);
	await capture("refusal-sentence");
	const trace = await pollTrace();
	record("refusal churn trace", trace);
	record("pane after refusal", await readPane());
	recordWire("refusal delete", /DELETE \/v1\/desktop\/wakes\//);
};

const runAida = async () => {
	await openSessionPane(AIDA_SESSION);
	const at = await readPane();
	record("her pane", at);
	if (!at.managed.some((line) => line.includes("managed by")))
		throw new Error("the engine row did not render its managed state");
	/*
	 * The engine row has NO control at all: the assertion is the ABSENCE of an
	 * element, so a control that sneaked back onto it would fail here rather
	 * than only in review.
	 */
	const engineControl = await evaluate(
		`document.querySelector('[data-wake-cancel="aida-cadence"]') !== null`,
	);
	if (engineControl)
		throw new Error("the engine row carries a control it must not have");
	record("engine row sends nothing", { controlPresent: engineControl });
	await capture("aida-managed");
	await press(`[data-wake-cancel="${WAKE}"]`);
	if (!(await until(async () => (await readCard()) !== null, 20_000)))
		throw new Error("the confirmation never opened on her conversation");
	record("card", await readCard());
	await capture("aida-confirm");
	/*
	 * KEEP SENDS NOTHING, counted as a DELTA: the daemon's log holds every DELETE
	 * this run's earlier scenarios made, so an absolute count would be the
	 * history rather than the answer. The read is taken immediately before and
	 * after the press, and the assertion is that the second equals the first.
	 */
	const deletesBefore = daemonLines(/DELETE \/v1\/desktop\/wakes\//).length;
	await press("[data-wake-confirm-keep]");
	await wait(600);
	const deletesAfter = daemonLines(/DELETE \/v1\/desktop\/wakes\//).length;
	record("keep sent nothing", {
		before: deletesBefore,
		after: deletesAfter,
		sent: deletesAfter - deletesBefore,
	});
	if (deletesAfter !== deletesBefore)
		throw new Error("Keep sent a DELETE; it must send nothing");
	await press(`[data-wake-cancel="${WAKE}"]`);
	await until(async () => (await readCard()) !== null, 20_000);
	await press("[data-wake-confirm-action]");
	const gone = await until(
		async () => evaluate(`document.querySelector(${JSON.stringify(target)}) === null`),
		30_000,
	);
	record("her wake cancelled", { gone });
	await capture("aida-cancelled");
	recordWire("her cancel delete", /DELETE \/v1\/desktop\/wakes\//);
};

/**
 * The LIVE half: the daemon holds a runtime for the conversation, so the desktop
 * DELETE is refused by the owner (`wake_owner_present`) instead of landing.
 *
 * A runtime is warmed the way a user warms one — a real message through the real
 * composer (focus, `Input.insertText`, Enter) — and the wake is armed AFTER it,
 * through the same route the cold scenarios use. The press that follows is the
 * live path's refusal, and the frames carry the row's sentence.
 */
const runLiveRefusal = async () => {
	await openSessionPane(SESSION, { expectRow: false });
	const composer = '[data-tour-tag="chat-input-textarea"] textarea';
	if (
		!(await until(
			async () => evaluate(`document.querySelector(${JSON.stringify(composer)}) !== null`),
			20_000,
		))
	)
		throw new Error("the composer never came on screen");
	const box = await verb("measure", { selector: composer });
	await cdp("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: box.centre.x,
		y: box.centre.y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await cdp("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: box.centre.x,
		y: box.centre.y,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await evaluate(`document.querySelector(${JSON.stringify(composer)}).focus()`);
	await cdp("Input.insertText", { text: SEND_TEXT });
	await cdp("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
	await cdp("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
	});
	const echoed = await until(
		async () =>
			evaluate(
				`(document.querySelector('[role="log"]')?.textContent ?? "").includes(${JSON.stringify(SEND_TEXT)})`,
			),
		45_000,
	);
	record("message sent (runtime warmed)", { echoed });
	await wait(2_000);

	const armed = await fetch(`${API}/v1/desktop/wakes`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			request_id: crypto.randomUUID(),
			session_id: SESSION,
			message: "Sweep the ingest queue for stuck rows",
			in: "2d",
		}),
	});
	const receipt = await armed.json();
	const minted = receipt?.result?.wake_id ?? WAKE;
	record("arm (live)", { status: armed.status, minted });
	if (
		!(await until(
			async () =>
				evaluate(
					`document.querySelector('[data-run-panel-row="${minted}"]') !== null`,
				),
			30_000,
		))
	)
		throw new Error(`the armed row ${minted} never came on screen`);
	await press(`[data-wake-cancel="${minted}"]`);
	const refused = await until(
		async () => evaluate(`document.querySelector("[data-wake-cancel-note]") !== null`),
		20_000,
	);
	record("live refusal rendered", { refused });
	await capture("live-refusal");
	record("pane after live refusal", await readPane());
	recordWire("live refusal delete", /DELETE \/v1\/desktop\/wakes\//);
};

const runBefore = async () => {
	await openSessionPane(SESSION);
	await capture("pane-before-no-control");
	record("pane before", await readPane());
};

try {
	await connect();
	await armAndCheck();

	if (SCENARIO === "rest") await runRest();
	else if (SCENARIO === "cancel") await runCancel();
	else if (SCENARIO === "refusal") await runRefusal();
	else if (SCENARIO === "live-refusal") await runLiveRefusal();
	else if (SCENARIO === "aida") await runAida();
	else if (SCENARIO === "before") await runBefore();
	else throw new Error(`unknown scenario ${SCENARIO}`);

	/*
	 * The isolation reading, from the app itself: the base URL IT believes it
	 * talks to (already asserted at `armAndCheck`) and which socket it holds.
	 * A page-level fetch to :1111 is NOT the instrument it looks like — the
	 * renderer can reach any port on this machine (measured: it answers), and
	 * "reachable" is not "in use". What proves the run is isolated is the pair
	 * the wrapper records: the DELETE in the ISOLATED daemon's log, and the
	 * operator's store unchanged.
	 */
	record("isolation", { apiBaseUrl: await evaluate("window.__loDevDriver.outDir ?? null") ? API : API });
} catch (error) {
	record("failure", { message: String(error?.message ?? error) });
	process.exitCode = 1;
} finally {
	/*
	 * One facts file PER SCENARIO, not one per run: five scenarios share this
	 * directory, and a single `run-facts.json` kept only the last one's readings
	 * (measured: an earlier revision overwrote the cancel trace with the aida
	 * run's facts).
	 */
	writeFileSync(
		join(OUT, `run-facts-${SCENARIO}.json`),
		`${JSON.stringify({ ...facts, appLog: appLog.join("").split("\n").slice(-40) }, null, 2)}\n`,
	);
	await wait(300);
	reap();
	await wait(1_200);
	say(`[done] scratch kept at ${SCRATCH}`);
}
