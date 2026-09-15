#!/usr/bin/env node
/**
 * Prove, in the REAL app and over the REAL desktop transport, that a press stops
 * the turn.
 *
 *     LO_PROOF_TOKEN=$(cat ...) node scripts/interrupt-esc-proof.mjs <out-dir>
 *
 * ## Why this is a committed script rather than a paragraph
 *
 * The reported defect was invisible to the test suite by construction: the
 * composer's Stop control posted `{op: "sessions.command", command: "stop"}`,
 * which the backend answers with a presentation form - HTTP 200 and a
 * `native_action` asking the client to open the session-stop picker - while the
 * turn kept streaming. A 200 and a resolved promise read exactly like a stop
 * that worked, so `test:desktop` could not see it and neither could a reviewer.
 * The claim this file checks is a claim about a running application: pressing
 * this control (or its Escape accelerator) ends THIS TURN, and leaves the
 * session alive.
 *
 * It is committed for the reason `scripts/click-proof.mjs` records about its own
 * predecessor: a rig that lives in `/tmp` cannot be re-run by the next reviewer,
 * so the frames it produced are evidence nobody can re-derive. Everything this
 * script needs is in its environment and its header.
 *
 * ## What it drives, and what it deliberately does not
 *
 * The app is the BUILT one (`out/`, from `pnpm build`), launched with
 * `LOCAL_OPERATOR_UI_WINDOW_MODE=headless`, in its own user-data-dir, against a
 * backend this run does NOT manage (`VITE_DISABLE_BACKEND_MANAGER=true`) and
 * paired by the bearer the backend was started with. Every press is dispatched
 * as a REAL input event over CDP - a hit-tested mouse click at the control's
 * painted centre, and `Input.dispatchKeyEvent` for Escape - so a control that is
 * painted but not hit-testable, or a key no listener receives, fails here.
 *
 * The TURN is scripted from outside (the desktop API) rather than typed into the
 * composer, on purpose: this file is about the interrupt, and a turn that
 * starts, streams for a known span and stops when told is the whole point. The
 * backend's own mock provider makes that deterministic - `[bash:N]` in the last
 * user message runs the REAL bash tool with `sleep N`, which is the one way to
 * make an assembled runtime genuinely busy for a known duration from outside
 * (`local_operator/providers/clients.py`, `MockClient`).
 *
 * ## What it asserts
 *
 * For each of the two paths (the Stop control, and Escape):
 *
 *   1. while the turn runs, the control is PRESENT and the backend reports
 *      `streaming: true` - read from the backend, not inferred from the UI, so
 *      the press below is answered against a real turn;
 *   2. after the press, the control is GONE and the backend reports
 *      `streaming: false` - and the turn ended because it was interrupted, not
 *      because `[bash:N]`'s sleep ran out (the script is sized so it cannot);
 *   3. the session is still ALIVE - the next turn it admits streams - which is
 *      what separates this rung from `POST /v1/desktop/stop`, the kill switch
 *      one keystroke away.
 *
 * And with NOTHING running: Escape changes nothing and the composer keeps its
 * draft, which is the TUI's hard rule ("do not clear the composer").
 *
 * Frames land in the output directory: `turn-running.png`, `after-stop.png`,
 * `after-escape.png`, `idle-escape.png`.
 */

import { execFileSync, spawn } from "node:child_process";

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withNotificationsOff } from "./notifications-off.mjs";

const OUT = process.argv[2] ?? "/tmp/lo-interrupt-proof";
const BACKEND = process.env.LO_PROOF_BACKEND ?? "http://127.0.0.1:1131";
const TOKEN = process.env.LO_PROOF_TOKEN ?? "";
const PORT = Number(process.env.LO_PROOF_CDP_PORT ?? 0);
/* The app's own default window: a live frame is only worth something at the
 * size the operator actually runs (src/main/index.ts). */
const WIDTH = 1380;
const HEIGHT = 900;
/* Long enough that a sleep cannot expire under the assertions, short enough
 * that a broken stop still ends the run. */
const SLEEP_SECONDS = 45;
const DEADLINE_MS = 90_000;

if (!TOKEN) {
	console.error(
		"LO_PROOF_TOKEN is unset: an app that did not start the backend holds no bearer, and every session control would answer 503 - which reads exactly like an interrupt that did nothing.",
	);
	process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const report = { backend: BACKEND, out: OUT, steps: [] };
const record = (step, value) => {
	report.steps.push({ step, ...value });
	console.log(`${step}: ${JSON.stringify(value)}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, body) => {
	const response = await fetch(`${BACKEND}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return {
		status: response.status,
		body: await response.json().catch(() => null),
	};
};

const uuid = () => crypto.randomUUID();
const result = (envelope) => envelope?.body?.result ?? null;

const sessionState = async (sessionId) => {
	const snapshot = result(
		await api("GET", `/v1/desktop/sessions/${sessionId}`),
	);
	return snapshot?.payload?.frontend?.snapshot ?? null;
};

/** Start one turn that will stay busy for `SLEEP_SECONDS`. */
const startTurn = async (sessionId) => {
	const admitted = await api(
		"POST",
		`/v1/desktop/sessions/${sessionId}/messages`,
		{
			request_id: uuid(),
			text: `rig turn [bash:${SLEEP_SECONDS}]`,
			mode: "prompt",
		},
	);
	return { status: admitted.status, detail: result(admitted)?.detail ?? null };
};

/* ---------------------------------------------------------------- the rig */

/*
 * ISOLATION, and why HOME rather than only `--user-data-dir`.
 *
 * The app takes `app.requestSingleInstanceLock()`, which Electron keys on
 * `app.getPath("userData")` - and that is NOT the Chromium `--user-data-dir`
 * switch, so a run that passes only the switch still resolves to the OPERATOR'S
 * own profile: it fights the app the operator is using for the lock (this run
 * logs "Another instance is already running" and exits) and, when it wins, it
 * reads and writes their real state. Redirecting HOME moves `userData` (and
 * `appData`) into the scratch tree, which is the pattern
 * `scripts/browser-host-proof.mjs` established for the same reason, together
 * with a scratch `LOCAL_OPERATOR_CONFIG_DIR` so no session, credential or
 * agent registry outside this run is read either.
 */
const HOME_DIR = join(OUT, "home");
const CONFIG_DIR = join(OUT, "config");
const USER_DATA = join(OUT, "user-data");
/* Fresh per run: a leftover profile from a killed run holds the single-instance
 * lock, and the app would then refuse to start against the previous run's
 * state. */
for (const dir of [HOME_DIR, CONFIG_DIR, USER_DATA])
	rmSync(dir, { recursive: true, force: true });
mkdirSync(HOME_DIR, { recursive: true });
mkdirSync(CONFIG_DIR, { recursive: true });

const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	// The operator's own workspace variables must never reach a child of this
	// run: an inherited `CMUX_WORKSPACE_ID` addresses the REAL workspace through
	// a channel no config dir covers, and an inherited one has renamed real
	// workspaces in this project before.
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete childEnv[key];
}

/**
 * A devtools port nobody is listening on, checked immediately before the
 * spawn. A fixed port is how a rig ends up driving another session's Electron:
 * the earlier form of this file connected to whatever answered on its port and
 * reported a missing bridge, because the app it reached was somebody else's.
 */
const freePort = async () => {
	const { createServer } = await import("node:net");
	for (;;) {
		const port = 9500 + Math.floor(Math.random() * 400);
		const free = await new Promise((resolve) => {
			const probe = createServer();
			probe.on("error", () => resolve(false));
			probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
		});
		if (free) return port;
	}
};
const port = Number(process.env.LO_PROOF_CDP_PORT) || (await freePort());

/*
 * The child's environment, built by the merged guard helper (#206) rather than by
 * restating the kill switch here. `notification-spawn-sites.test.mjs` enumerates
 * every Electron spawn site in `scripts/` and requires each one to be named with
 * how it is guarded, because a rig is the site most likely to hand the app an
 * environment that banners the operator - this rig forces the switch for the same
 * reason `run-desktop-tests.mjs` does it for every child it spawns.
 */
const spawnEnv = withNotificationsOff({
	...childEnv,
	HOME: HOME_DIR,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	// This run's backend is already listening; the app must not spawn or kill one -
	// and in a scratch HOME it would otherwise try to install and start one.
	VITE_DISABLE_BACKEND_MANAGER: "true",
	// Read at RUNTIME by `src/main/backend/config.ts` (it dotenv-loads and
	// validates `process.env`), so the app can be pointed at this run's backend
	// without rebuilding it.
	VITE_LOCAL_OPERATOR_API_URL: BACKEND,
	LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
});

const app = spawn(
	"./node_modules/.bin/electron",
	[
		".",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${USER_DATA}`,
		`--window-size=${WIDTH}x${HEIGHT}`,
		/*
		 * Named explicitly rather than only through the env var, the way every
		 * agent-driven launch in this repo names its mode: a rig that relies on the
		 * default is one argv edit away from taking the operator's focus, and the
		 * repo's `window-mode.test.mjs` asserts this switch rather than the variable.
		 */
		"--window-mode=headless",
	],
	{
		env: spawnEnv,
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
		// Own the whole tree: Electron spawns helpers (GPU, renderer, utility), so a
		// signal to the direct child alone is not a stop. This run signals the
		// GROUP it led for the same reason `scripts/browser-host-proof.mjs` does.
		detached: true,
	},
);
const appLog = [];
app.stdout.on("data", (d) => appLog.push(`${d}`));
app.stderr.on("data", (d) => appLog.push(`${d}`));

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== undefined && this.pending.has(message.id)) {
				const { resolve, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				message.error
					? reject(new Error(message.error.message))
					: resolve(message.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
	async evaluate(expression) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(
				`evaluate failed: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails)}`,
			);
		return result.result.value;
	}
	async shot(name) {
		const { data } = await this.send("Page.captureScreenshot", {
			format: "png",
		});
		writeFileSync(join(OUT, name), Buffer.from(data, "base64"));
	}
}

const finish = async (cdp) => {
	if (cdp) {
		// The viewport is read from the PAGE and recorded, so a frame cannot be
		// labelled with a size the window never had.
		report.viewport = await cdp
			.evaluate(
				"JSON.stringify({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})",
			)
			.catch(() => null);
		cdp.ws.close();
	}
	writeFileSync(
		join(OUT, "interrupt-proof.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	/*
	 * The whole process GROUP, not just the child: Electron's helpers (GPU,
	 * renderer, utility) are separate processes, so signalling only the direct
	 * child leaves orphans holding the profile - and a rig that leaks one app per
	 * step leaves a host that is already busy with a pile of them. The group kill
	 * is the first half; the second is the `pkill` below, which catches a child
	 * that reparented out of the group (the shape a killed `npx` shim leaves).
	 */
	try {
		process.kill(-app.pid, "SIGKILL");
	} catch {
		app.kill("SIGKILL");
	}
	try {
		execFileSync("pkill", ["-f", `user-data-dir=${USER_DATA}`], {
			stdio: "ignore",
		});
	} catch {
		// No match is the good case, and pkill says so with a non-zero status.
	}
};

/*
 * The APP's page, not just the first page target.
 *
 * This instance has several web contents - the browser host's own tab is one,
 * and it is reachable at `about:blank` - and `list.find(type === "page")` picked
 * THAT one, where `window.api` does not exist. The run then reported a missing
 * preload bridge for an app whose bridge was fine, which is the class of
 * false-negative this rig exists to avoid.
 */
const target = async () => {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/list`);
		const list = await response.json();
		const pages = list.filter(
			(entry) => entry.type === "page" && entry.url !== "about:blank",
		);
		return (
			pages.find((entry) => entry.url.endsWith("renderer/index.html")) ??
			pages[0] ??
			null
		);
	} catch {
		return null;
	}
};

let page = null;
const deadline = Date.now() + DEADLINE_MS;
while (Date.now() < deadline && !page) {
	page = await target();
	await sleep(500);
}
if (!page) {
	console.error(`no renderer target appeared:\n${appLog.join("")}`);
	app.kill("SIGKILL");
	process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener("open", resolve);
	ws.addEventListener("error", reject);
});
const cdp = new Cdp(ws);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

/* Pairing first: every statement below is meaningless without it. */
/*
 * Wait for the PRELOAD to have attached before asking it anything: the page
 * target exists before the renderer's own script has run, and reading
 * `window.api` too early reports a missing bridge rather than an unpaired app.
 */
const bridgeDeadline = Date.now() + 30_000;
let bridged = false;
while (Date.now() < bridgeDeadline && !bridged) {
	bridged = await cdp
		.evaluate(`typeof window.api?.desktop?.request === "function"`)
		.catch(() => false);
	if (!bridged) await sleep(500);
}
if (!bridged) {
	record("bridge", { present: false });
	report.appLog = appLog.join("").slice(-4000);
	await finish(cdp);
	console.error(`the preload bridge never appeared:\n${appLog.join("")}`);
	process.exit(5);
}
record("bridge", { present: true });

/*
 * Pin the first-run flag, UNCONDITIONALLY, and reload.
 *
 * This rig runs against a backend whose only provider is the mock one, and the
 * app's first-run rule (`shared/hooks/first-time-user.ts`) reads "no non-local
 * provider is connected" as a first run - so it opens "Connect a provider" over
 * the composer, behind a full-screen `bg-scrim` that swallows every pointer
 * press. Measured here: all 25 probes inside the Stop control's rect resolved
 * to `div.fixed inset-0 z-50 bg-scrim`, and the control itself computed
 * `pointer-events: none`, so the click was refused rather than dropping.
 *
 * The flag is written WITHOUT first asking whether the modal is on screen. That
 * question is a race - the decision runs when the provider census answers, a few
 * seconds after the bridge appears - and asking it made this rig pass or fail
 * depending on which landed first. Pinning the store is the supported way to say
 * "this user has already been through setup" (`shared/store/onboarding-store.ts`,
 * `onboarding-storage`), and it is deterministic on every run; what the rig goes
 * on to assert is the OUTCOME it needs, that nothing is over the composer when
 * it presses.
 */
const seedDeadline = Date.now() + 20_000;
while (Date.now() < seedDeadline) {
	const ready = await cdp
		.evaluate(`typeof window.api?.desktop?.request === "function"`)
		.catch(() => false);
	if (ready) break;
	await sleep(500);
}
record("firstRun.dialogBefore", {
	present: await cdp.evaluate(`!!document.querySelector('[role="dialog"]')`),
});
await cdp.evaluate(`(() => {
	localStorage.setItem(
		"onboarding-storage",
		JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: 0 },
			version: 0,
		}),
	);
	return true;
})()`);
record("firstRun.seeded", {
	stored: await cdp.evaluate(`localStorage.getItem("onboarding-storage")`),
});
await cdp.send("Page.reload", { ignoreCache: false });
/*
 * A fixed pause first, because the page is being torn down and rebuilt: an
 * evaluate issued into a destroyed context resolves as a failure, and a poll
 * that starts immediately therefore spends its budget on a page that does not
 * exist yet. The poll below then waits on the OUTCOME - the composer, with no
 * dialog - rather than on a clock.
 */
await sleep(4000);
const clearedDeadline = Date.now() + 40_000;
let cleared = false;
while (Date.now() < clearedDeadline && !cleared) {
	cleared = await cdp
		.evaluate(
			`typeof window.api?.desktop?.request === "function" && !document.querySelector('[role="dialog"]')`,
		)
		.catch(() => false);
	if (!cleared) await sleep(500);
}
record("firstRun.settled", {
	cleared,
	stored: await cdp
		.evaluate(`localStorage.getItem("onboarding-storage")`)
		.catch(() => null),
});
if (!cleared) {
	report.appLog = appLog.join("").slice(-3000);
	await finish(cdp);
	throw new Error("first-run setup never cleared off the composer");
}

const capabilities = await cdp.evaluate(
	`(async () => {
		const r = await window.api.desktop.request({ op: "capabilities" });
		return JSON.stringify(r.body?.result ?? r);
	})()`,
);
record("capabilities", { value: capabilities });
if (!String(capabilities).includes('"desktop_available":true')) {
	console.error(
		"the app is not paired with the backend; nothing below would be meaningful",
	);
	await finish(cdp);
	process.exit(3);
}
if (!String(capabilities).includes('"session_interrupt":1')) {
	console.error(
		"the backend does not advertise session_interrupt, so this app renders no Stop control at all",
	);
	await finish(cdp);
	process.exit(4);
}

/** The painter the composer's Stop control is found by, and the only handle
 * this rig has on `busy`: the same condition the control is gated on. */
const STOP = '[aria-label="Stop"]';
const composer = 'textarea[aria-label="Message"]';

const controlPresent = () =>
	cdp.evaluate(`!!document.querySelector(${JSON.stringify(STOP)})`);
const draftValue = () =>
	cdp.evaluate(
		`document.querySelector(${JSON.stringify(composer)})?.value ?? null`,
	);

/**
 * Press the control at its PAINTED pixels: a control that is painted but not
 * reachable by pointer fails here rather than passing as an `element.click()`.
 *
 * The aim point is FOUND rather than assumed to be the centre. This app is
 * mostly scroll containers, and a control's rect can extend past an ancestor's
 * `overflow: hidden` - the same clipping `docs/branding.md` names for focus
 * rings - so the centre of the box is not always a painted pixel. A grid inside
 * the rect is probed instead, and the first point that hit-tests to this very
 * control is the one clicked. If no point does, the control is genuinely
 * unreachable by a pointer, and the run fails with what was found there.
 */
const pressStop = async () => {
	const aim = await cdp.evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(STOP)});
		if (!el) return null;
		const describe = (node) => {
			if (!node) return "none";
			const label = node.getAttribute("aria-label");
			return node.tagName.toLowerCase() + (label ? "[aria-label=" + JSON.stringify(label) + "]" : "");
		};
		const r = el.getBoundingClientRect();
		const rect = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
		const target = describe(el);
		const inset = 2;
		const fractions = [0.5, 0.25, 0.75, 0.1, 0.9];
		const attempts = [];
		for (const fy of fractions) {
			for (const fx of fractions) {
				const x = r.left + inset + (r.width - 2 * inset) * fx;
				const y = r.top + inset + (r.height - 2 * inset) * fy;
				const owner = document.elementFromPoint(x, y);
				const hit = owner === el || owner?.closest("button") === el;
				attempts.push({ x: Math.round(x), y: Math.round(y), owner: describe(owner), hit });
				if (hit) return { x, y, rect, target, attempts };
			}
		}
		return { rect, target, attempts };
	})()`);
	if (!aim) throw new Error("the Stop control is not on screen");
	if (aim.x === undefined)
		throw new Error(
			`no painted pixel of ${aim.target} hit-tests to it; rect ${JSON.stringify(aim.rect)}, probes ${JSON.stringify(aim.attempts)}`,
		);
	for (const type of ["mousePressed", "mouseReleased"])
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: aim.x,
			y: aim.y,
			button: "left",
			clickCount: 1,
		});
	return aim;
};

/** A REAL Escape, at the level the window listener sees it. */
const pressEscape = async () => {
	for (const type of ["keyDown", "keyUp"])
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
};

/**
 * The point the press just landed in, pressed AGAIN once the turn has settled.
 *
 * This is the round's MAJOR, measured rather than described. QA and UX both found
 * it independently: the dictation control slides into the Stop's box, so a reflex
 * second press at the same coordinates starts a MICROPHONE RECORDING
 * (`recording_started: true` in QA's record) instead of doing nothing. The fix
 * reserves the slot, and this asserts the reservation in the real app: what owns
 * the point, and whether pressing it starts anything.
 */
const probeSlot = async (point) => {
	const owner = await cdp.evaluate(`(() => {
		const el = document.elementFromPoint(${point.x}, ${point.y});
		if (!el) return "none";
		const button = el.closest("button");
		return (button?.getAttribute("aria-label") ?? el.tagName.toLowerCase()) + "|" + (el.hasAttribute("data-interrupt-slot") ? "reserved" : "not-reserved");
	})()`);
	for (const type of ["mousePressed", "mouseReleased"])
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: point.x,
			y: point.y,
			button: "left",
			clickCount: 1,
		});
	await sleep(700);
	const after = await cdp.evaluate(`JSON.stringify({
		recording: !!document.querySelector('[aria-label="Cancel recording"], [aria-label="Confirm recording"]'),
		mic: !!document.querySelector('[aria-label="Start recording"]'),
	})`);
	return { point, owner, after: JSON.parse(after) };
};

/** The composer's right-hand cluster, as boxes, so a frame and a record agree. */
const clusterBoxes = async () =>
	JSON.parse(
		await cdp.evaluate(`JSON.stringify(
			[...document.querySelectorAll('[aria-label="Start recording"], [aria-label="Stop"], [aria-label="Send message"], [data-interrupt-slot]')]
				.map((el) => {
					const r = el.getBoundingClientRect();
					return {
						label: el.getAttribute("aria-label") ?? "reserved-slot",
						x: Math.round(r.left),
						w: Math.round(r.width),
						centre: Math.round(r.left + r.width / 2),
					};
				})
				.sort((a, b) => a.x - b.x),
		)`),
	);

/** Open the run details pane from its own trigger, as a user does. */
const openRunPane = async () => {
	const box = await cdp.evaluate(`(() => {
		const el = document.querySelector("[data-run-panel-trigger]");
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	})()`);
	if (!box) return false;
	for (const type of ["mousePressed", "mouseReleased"])
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: box.x,
			y: box.y,
			button: "left",
			clickCount: 1,
		});
	return true;
};

const waitForStreaming = async (sessionId, wanted, budgetMs = 20_000) => {
	const until = Date.now() + budgetMs;
	while (Date.now() < until) {
		const state = await sessionState(sessionId);
		if (state?.streaming === wanted)
			return { streaming: state.streaming, outcome: state.last_turn_outcome };
		await sleep(250);
	}
	return { streaming: !wanted, outcome: "budget expired" };
};

try {
	const sessionId =
		process.env.LO_PROOF_SESSION ??
		result(
			await api("POST", "/v1/desktop/sessions", {
				request_id: uuid(),
				cwd: OUT,
			}),
		)?.session_id;
	if (!sessionId) throw new Error("no session could be created");
	report.session = sessionId;

	// The real session, by the route the app uses for one.
	await cdp.evaluate(`location.hash = "#/chat/${sessionId}"; true`);
	await sleep(1500);
	await cdp.evaluate("window.focus(); document.body.focus(); true");

	/* ------------------------------------------------ 1. the Stop control */
	record("turn1.admit", await startTurn(sessionId));
	record("turn1.streaming", await waitForStreaming(sessionId, true));
	record("turn1.control", { present: await controlPresent() });
	await cdp.shot("turn-running.png");

	const box = await pressStop();
	record("turn1.pressed", box);
	record("turn1.settled", await waitForStreaming(sessionId, false));
	record("turn1.controlAfter", { present: await controlPresent() });
	await cdp.shot("after-stop.png");

	/*
	 * THE HAZARD, at the point the press landed in: the cluster's own boxes, then
	 * a second press at the Stop's centre once nothing is running.
	 */
	record("slot.clusterIdle", { boxes: await clusterBoxes() });
	record("slot.repress", await probeSlot({ x: box.x, y: box.y }));
	record("slot.clusterAfterRepress", { boxes: await clusterBoxes() });

	/* ------------------------------------------------------- 2. Escape */
	record("turn2.admit", await startTurn(sessionId));
	record("turn2.streaming", await waitForStreaming(sessionId, true));
	record("turn2.control", { present: await controlPresent() });
	await pressEscape();
	record("turn2.settled", await waitForStreaming(sessionId, false));
	record("turn2.controlAfter", { present: await controlPresent() });
	await cdp.shot("after-escape.png");

	/* ------------------------------- 3. the session survived both presses */
	record("session.survived", await startTurn(sessionId));
	record("session.survivedStreaming", await waitForStreaming(sessionId, true));
	const stop = await api(
		"POST",
		`/v1/desktop/sessions/${sessionId}/interrupt`,
		{ request_id: uuid() },
	);
	record("session.cleanup", { status: stop.status, body: stop.body });

	/* ------------- 4. the run pane claims the press while a turn is running */
	record("pane.opened", { opened: await openRunPane() });
	await sleep(600);
	record("pane.turn", await startTurn(sessionId));
	record("pane.streaming", await waitForStreaming(sessionId, true));
	const paneBefore = await cdp.evaluate(
		`!!document.querySelector('[aria-label="Run details"]')`,
	);
	// Focus the composer, which is where a press that the pane must still answer
	// comes from (QA round 1's Q2: this is the case that used to interrupt).
	await cdp.evaluate(
		`document.querySelector('textarea[aria-label="Message"]')?.focus(); true`,
	);
	await pressEscape();
	const paneAfter = await cdp.evaluate(
		`!!document.querySelector('[aria-label="Run details"]')`,
	);
	record("pane.escape", {
		openBefore: paneBefore,
		openAfter: paneAfter,
		// The turn must still be running: the pane's claim is HIGHER than the
		// interrupt's, so a press it answers must not also stop the turn.
		streamingAfter: await sessionState(sessionId).then(
			(state) => state?.streaming ?? null,
		),
	});
	await cdp.shot("pane-escape.png");
	record(
		"pane.cleanup",
		await api("POST", `/v1/desktop/sessions/${sessionId}/interrupt`, {
			request_id: uuid(),
		}),
	);

	/* --------------------------- 5. nothing running: Escape does nothing */
	record("idle.streaming", await waitForStreaming(sessionId, false));
	record("idle.control", { present: await controlPresent() });
	const typed = "a draft the interrupt must not clear";
	await cdp.evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(composer)});
		el.focus();
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(el, ${JSON.stringify(typed)});
		el.dispatchEvent(new Event("input", { bubbles: true }));
		return el.value;
	})()`);
	const before = await draftValue();
	await pressEscape();
	await sleep(1000);
	const after = await draftValue();
	record("idle.escape", {
		draftBefore: before,
		draftAfter: after,
		untouched: before === after && after === typed,
		/*
		 * The notice, counted by its own sentence rather than by the element: this
		 * app has other `<output>` elements, so a tag count would be a statement
		 * about the page rather than about the interrupt. A stopped turn with
		 * nothing left under it renders NOTHING (`interruptNotice`), which is the
		 * property being read here.
		 */
		noticeElements: await cdp.evaluate(
			`[...document.querySelectorAll("output")].filter((node) =>
				(node.textContent ?? "").includes("Stopped this turn"),
			).length`,
		),
	});
	await cdp.shot("idle-escape.png");
} catch (error) {
	record("ERROR", { message: String(error?.message ?? error) });
	report.appLog = appLog.join("").slice(-4000);
	await finish(cdp);
	console.error(String(error?.stack ?? error));
	process.exit(1);
}

await finish(cdp);
console.log(`\nwrote ${join(OUT, "interrupt-proof.json")}`);
