/*
 * Capture the `scratchpad://` evidence: the Files panel's scratch tiles, and the
 * markdown / CSV / text canvases they open.
 *
 * WHY THIS IS ITS OWN RIG rather than a scene in `scripts/renderer-driver.mjs`
 * or an option on `scripts/mentioned-files-app-proof.mjs`:
 *
 *  - the renderer driver owns the app-with-no-backend contract; this evidence is
 *    the opposite case, a real `local-operator serve` this run started, holding a
 *    real session whose transcript carries real `scratchpad://` tool results;
 *  - the files-panel rig is about a PDF's blob/`<iframe>` path and the grid's
 *    geometry, and its committed frame names are referenced elsewhere. Bending it
 *    to click three different tiles would either rename those or make one rig
 *    assert two unrelated contracts.
 *
 * What it does NOT do: it never sends a turn, never writes to the backend, and
 * never touches the operator's own config dir, backend or UI state. It reads a
 * session's durable history and paints it.
 *
 * Isolation, all of it enforced rather than intended:
 *  - scratch `HOME`, `LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_LOG_DIR` and
 *    `--user-data-dir` (the Electron profile is scratch, so the operator's own
 *    localStorage is untouchable);
 *  - the app's **cwd is outside the checkout** and holds a `.env` naming this
 *    run's backend, because `src/main/backend/config.ts` loads `.env` from
 *    `process.cwd()` with dotenv `override: true` - launched from the worktree
 *    the worktree's own `.env` would win and every request would land on the
 *    operator's live backend;
 *  - the app path is passed ABSOLUTELY for the same reason, with the scratch cwd
 *    as the working directory;
 *  - `CMUX_*` and `LOP_*` are stripped from the child environment (an inherited
 *    workspace id let an earlier rig in this repository rename the operator's
 *    real cmux workspaces);
 *  - `headless` window mode, asserted from the page, so nothing is ever shown
 *    or focused.
 *
 * Usage (see run-scratchpad-files.sh for the whole sequence):
 *   node out/evidence-harness/scratchpad-files-proof.mjs <out-dir> <session-id>
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onInterrupted, reapOnExit, stopAppTree } from "../../../../scripts/app-tree-teardown.mjs";
import { withNotificationsOff } from "../../../../scripts/notifications-off.mjs";

const OUT = process.argv[2] ?? "/tmp/lo-notes-frames";
const SESSION = process.argv[3];
if (!SESSION) {
	console.error("usage: node scratchpad-files-proof.mjs <out-dir> <session-id>");
	process.exit(2);
}

/*
 * The repository root, found rather than counted: this rig is archived beside
 * the frames it produced (`docs/evidence/scratchpad-files/harness/`), and a
 * `../../..` depth that is right today stops being right the moment the set is
 * renamed or moved — which is how a harness rots after the PR that shipped it.
 */
function findRepoRoot(start) {
	let directory = start;
	while (!existsSync(join(directory, "package.json"))) {
		const parent = dirname(directory);
		if (parent === directory) throw new Error("no package.json above this rig");
		directory = parent;
	}
	return directory;
}

const WORKTREE = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const SCRATCH = process.env.NOTES_EVIDENCE_SCRATCH;
if (!SCRATCH) {
	console.error(
		"NOTES_EVIDENCE_SCRATCH is unset; this rig refuses to guess where the scratch tree is",
	);
	process.exit(2);
}
const TOKEN = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN;
if (!TOKEN) {
	console.error("LOCAL_OPERATOR_DESKTOP_TOKEN is unset; the app would be unpaired");
	process.exit(2);
}

const PORT = 9455;
const USER_DATA = join(SCRATCH, "profile");
const APP_CWD = join(SCRATCH, "app-cwd");
const OUT_DIR = OUT;
mkdirSync(OUT_DIR, { recursive: true });

/*
 * The child environment. `CMUX_*`/`LOP_*` come off, the app's own log directory
 * is scratch, and the window mode is named rather than left to the default.
 */
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete childEnv[key];
}
withNotificationsOff(childEnv);

const ELECTRON_BIN = createRequire(join(WORKTREE, "package.json"))("electron");

const app = spawn(
	ELECTRON_BIN,
	[
		WORKTREE,
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${USER_DATA}`,
		"--window-size=1380x900",
	],
	{
		cwd: APP_CWD,
		env: {
			...childEnv,
			HOME: join(SCRATCH, "home"),
			// The same config dir the run's own `local-operator serve` reads, so
			// the app and the backend cannot disagree about which store this is.
			LOCAL_OPERATOR_CONFIG_DIR:
				process.env.LOCAL_OPERATOR_CONFIG_DIR ??
				join(SCRATCH, "home", ".local-operator"),
			LOCAL_OPERATOR_LOG_DIR: join(SCRATCH, "logs"),
			LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
			LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
		},
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	},
);
reapOnExit({ pid: app.pid, userData: USER_DATA });
const log = [];
app.stdout.on("data", (d) => log.push(`[app] ${d}`));
app.stderr.on("data", (d) => log.push(`[app:err] ${d}`));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get the first-run setup out of the way, because it is a MODAL and it covers
 * the panel this run photographs.
 *
 * A fresh scratch Electron profile is a first-run profile, so the app opens its
 * onboarding wizard over the Files view - measured: `Step 1 of 6` covering the
 * left half of the frame with the grid's tiles behind it. Two steps, and both
 * are needed:
 *
 *  1. the completion flags are written into the app's own persisted store
 *     (`onboarding-storage`, the same keys the wizard writes), then the page
 *     reloads - `isTourComplete` matters as much as `isModalComplete`, because a
 *     completed modal with an incomplete tour starts the Shepherd tour, which
 *     spotlights the very surfaces this run is photographing;
 *  2. anything still on screen is walked with real presses of the wizard's own
 *     buttons, never removed from the DOM. If a future release stops honouring
 *     the flags, the frame fails loudly here instead of shipping a modal.
 */
async function dismissFirstRunSetup(cdp) {
	await cdp.evaluate(`(() => {
		localStorage.setItem("onboarding-storage", JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" },
			version: 0,
		}));
		return true;
	})()`);
	await cdp.send("Page.reload", { ignoreCache: false });
	await sleep(4000);

	for (let attempt = 0; attempt < 14; attempt += 1) {
		const state = await cdp.evaluate(`(() => {
			const dialogs = [...document.querySelectorAll('[role="dialog"]')];
			const dialog = dialogs.find((d) =>
				[...d.querySelectorAll("button")].some((b) =>
					["Next", "Skip", "Get started"].includes(b.innerText.trim()),
				),
			);
			if (!dialog) return { present: false };
			const buttons = [...dialog.querySelectorAll("button")];
			const byText = (label) => buttons.find((b) => b.innerText.trim() === label) ?? null;
			const next = byText("Next");
			return {
				present: true,
				hasGetStarted: Boolean(byText("Get started")),
				hasSkip: Boolean(byText("Skip")),
				nextDisabled: next ? next.disabled : null,
			};
		})()`);
		if (!state.present) return { dismissed: true, presses: attempt };
		const pressed = await cdp.evaluate(`(() => {
			const dialogs = [...document.querySelectorAll('[role="dialog"]')];
			const dialog = dialogs.find((d) =>
				[...d.querySelectorAll("button")].some((b) =>
					["Next", "Skip", "Get started"].includes(b.innerText.trim()),
				),
			);
			if (!dialog) return "gone";
			const buttons = [...dialog.querySelectorAll("button")];
			const byText = (label) => buttons.find((b) => b.innerText.trim() === label) ?? null;
			const target = byText("Get started") ?? byText("Skip") ?? byText("Next");
			if (target && !target.disabled) {
				target.click();
				return target.innerText.trim();
			}
			// A step that gates on validity (the wizard's agent step) cannot be left
			// with Next, so the progress track - its own real buttons - is used to jump
			// to the last step, which is the one that finishes.
			const track = buttons.filter((b) => !b.innerText.trim());
			const last = track[track.length - 1];
			if (!last) return "stuck";
			last.click();
			return "track-last";
		})()`);
		if (pressed === "gone") return { dismissed: true, presses: attempt };
		await sleep(500);
	}
	return { dismissed: false };
}

let stopping = null;
function teardown() {
	stopping ??= stopAppTree({
		pid: app.pid,
		userData: USER_DATA,
		isExited: () => app.exitCode !== null || app.signalCode !== null,
	});
	return stopping;
}
const finish = (code) =>
	teardown().then((result) => {
		if (result.survivors?.length)
			console.error(
				`teardown: ${result.survivors.length} process(es) still name this profile`,
			);
		return code === 0 && !result.clean ? 1 : code;
	});
onInterrupted(async (signal) => {
	console.error(`teardown: ${signal} received; stopping the app this run booted`);
	return finish(0);
});

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
				`evaluate failed: ${result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)}`,
			);
		return result.result.value;
	}
}

/** The canvas panel's own rect, so a frame carries the panel and not the app. */
const CONTAINER_RECT = `(() => {
	const panel = document.querySelector('[data-tour-tag="canvas-container"]');
	if (!panel) return null;
	const { x, y, width, height } = panel.getBoundingClientRect();
	return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
})()`;

/*
 * The app's OWN renderer target, not whichever page target answered first.
 *
 * A boot also opens the embedded browser's partition host (`about:blank` in its
 * own page target), and connecting there finds no preload bridge at all - which
 * reads exactly like an unpaired app. So every page target is tried, and the
 * one whose preload exposes `window.api.desktop.request` is the app's window.
 */
async function attachToRenderer(deadline) {
	let targets = [];
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
			targets = (await response.json()).filter(
				(target) => target.type === "page",
			);
		} catch {
			// The app has not opened its debugging port yet.
		}
		for (const target of targets) {
			let candidate = null;
			try {
				candidate = await openTarget(target.webSocketDebuggerUrl);
				const armed = await candidate.evaluate(
					`Boolean(window.api && window.api.desktop && window.api.desktop.request)`,
				);
				if (armed) return candidate;
			} catch {
				// Not the renderer, or not ready; try the next target.
			}
			candidate?.close();
		}
		await sleep(500);
	}
	return null;
}

async function openTarget(webSocketDebuggerUrl) {
	const ws = new WebSocket(webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve);
		ws.addEventListener("error", reject);
	});
	const cdp = new Cdp(ws);
	cdp.close = () => ws.close();
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	return cdp;
}

try {
	const deadline = Date.now() + 90_000;
	const cdp = await attachToRenderer(deadline);
	if (!cdp) {
		console.error(`no renderer target armed its preload bridge; log:\n${log.join("")}`);
		process.exit(await finish(1));
	}

	const report = { session: SESSION, out: OUT_DIR };

	/*
	 * Wait for the preload bridge before asking it anything. The page target
	 * exists before the preload has run, and `window.api.desktop` is undefined
	 * until it has - a reading taken too early says "not paired" about an app
	 * that is about to be.
	 */
	const bridgeDeadline = Date.now() + 30_000;
	let bridge = false;
	while (Date.now() < bridgeDeadline && !bridge) {
		bridge = await cdp.evaluate(
			`Boolean(window.api && window.api.desktop && window.api.desktop.request)`,
		).catch(() => false);
		if (!bridge) await sleep(500);
	}
	report.preloadBridge = bridge;
	if (!bridge) {
		console.error(`the preload bridge never armed; log:\n${log.join("")}`);
		cdp.close();
		process.exit(await finish(4));
	}

	// The pairing assertion, before anything else: an unpaired instance renders
	// an empty panel, which looks exactly like a producer that never fired.
	report.firstRunSetup = await dismissFirstRunSetup(cdp);
	if (!report.firstRunSetup.dismissed) {
		console.error("the first-run setup would not close; refusing to photograph behind it");
		cdp.close();
		process.exit(await finish(5));
	}

	const capabilities = await cdp.evaluate(
		`(async () => { try { const r = await window.api.desktop.request({ op: "capabilities" }); return JSON.stringify(r.body?.result ?? r); } catch (e) { return "THREW: " + e.message; } })()`,
	);
	if (!String(capabilities).includes('"desktop_available":true')) {
		console.error(`the app is not paired with the backend: ${capabilities}`);
		cdp.close();
		process.exit(await finish(3));
	}

	await cdp.evaluate(`location.hash = "#/chat/${SESSION}"; true`);

	// The canvas store is a persisted zustand store, so reading it proves the
	// producer ran rather than that a component mounted.
	let stored = null;
	const scanDeadline = Date.now() + 90_000;
	// Wait for the producer to have written the store, without naming the scheme
	// or its directory: the scheme's NAME is under review, and this loop should
	// not be a second place that has to change with it.
	while (Date.now() < scanDeadline) {
		stored = await cdp.evaluate(`localStorage.getItem("canvas-store")`);
		const found = stored
			? (JSON.parse(stored)?.state?.conversations?.[SESSION]?.mentionedFiles ?? [])
			: [];
		if (found.length > 0) break;
		await sleep(1000);
	}
	const conversation = stored
		? (JSON.parse(stored)?.state?.conversations?.[SESSION] ?? null)
		: null;
	report.mentionedFiles = (conversation?.mentionedFiles ?? []).map((doc) => ({
		path: doc.path,
		type: doc.type,
		availability: doc.availability ?? null,
	}));

	report.openedCanvas = await cdp.evaluate(`(() => {
		const button = document.querySelector('[data-tour-tag="open-canvas-button"]');
		if (!button) return false;
		button.click();
		return true;
	})()`);
	await sleep(700);
	report.switchedToFiles = await cdp.evaluate(`(() => {
		const button = document.querySelector('button[aria-label^="Files view"]');
		if (!button) return false;
		button.click();
		return true;
	})()`);

	// Wait for the panel's own scan to settle: three identical readings with no
	// "Searching" line left on the head.
	let previous = -1;
	let stable = 0;
	const samples = [];
	while (Date.now() < scanDeadline) {
		const sample = await cdp.evaluate(`(() => {
			const raw = localStorage.getItem("canvas-store");
			const conversation = raw ? JSON.parse(raw)?.state?.conversations?.[${JSON.stringify(SESSION)}] : null;
			const head = document.querySelector('[data-tour-tag="files-scanner-head"]');
			return { count: conversation?.mentionedFiles?.length ?? 0, head: head ? head.innerText.trim() : null };
		})()`);
		if (samples.length === 0 || sample.count !== samples[samples.length - 1].count) samples.push(sample);
		if (sample.count === previous) stable += 1;
		else stable = 0;
		previous = sample.count;
		if (stable >= 3 && !(sample.head ?? "").includes("Searching")) break;
		await sleep(1000);
	}
	report.panelCount = previous;
	report.panelHead = samples[samples.length - 1]?.head ?? null;
	report.scanSamples = samples;

	const shot = async (name) => {
		const clip = await cdp.evaluate(CONTAINER_RECT);
		if (!clip) throw new Error("the canvas container is not on screen");
		const image = await cdp.send("Page.captureScreenshot", {
			format: "png",
			clip: { ...clip, scale: 1 },
		});
		writeFileSync(join(OUT_DIR, name), Buffer.from(image.data, "base64"));
		return { name, ...clip };
	};

	report.pageState = await cdp.evaluate(`(() => {
		const el = document.querySelector('[data-tour-tag="canvas-container"]');
		return {
			visibilityState: document.visibilityState,
			hasFocus: document.hasFocus(),
			containerPresent: Boolean(el),
		};
	})()`);
	/*
	 * `document.visibilityState` is "visible" here ON PURPOSE and is not a claim
	 * that a window was shown: a `headless` launch keeps the page UNTHROTTLED
	 * while the window is never shown, unfocusable and invisible (see
	 * `src/main/window-mode.ts`). The window's own state therefore comes from the
	 * app's line in the log, which is the reading that matters.
	 */
	report.windowState =
		log.join("").match(/\[window-mode\] state: [^\n]*/)?.[0] ?? null;

	report.frames = [];
	report.frames.push(await shot("scratchpad-files-panel.png"));
	report.panelTiles = await cdp.evaluate(`(() => {
		const grid = document.querySelector('[data-tour-tag="files-grid"]');
		return grid ? [...grid.querySelectorAll("button")].map((b) => b.innerText.trim()) : [];
	})()`);

	/*
	 * One tile per format. Each click is a real pointer event from the page on the
	 * tile the panel actually rendered, and between clicks the run returns to the
	 * Files view - the grid is the entry point, so that is the path a user takes.
	 */
	const clickTile = async (needle) =>
		cdp.evaluate(`(() => {
			const button = document.querySelector('button[aria-label^="Files view"]');
			if (button) button.click();
			return true;
		})()`).then(() => sleep(400)).then(() =>
			cdp.evaluate(`(() => {
				const grid = document.querySelector('[data-tour-tag="files-grid"]');
				if (!grid) return "no-grid";
				const tile = [...grid.querySelectorAll("button")].find((b) => b.innerText.includes(${JSON.stringify(needle)}));
				if (!tile) return "no-tile";
				tile.click();
				return "clicked";
			})()`),
		);

	const viewerReadings = [];
	for (const [needle, name] of [
		["perf.md", "scratchpad-markdown-canvas.png"],
		["metrics.csv", "scratchpad-csv-canvas.png"],
		["session-log.txt", "scratchpad-text-canvas.png"],
	]) {
		const clicked = await clickTile(needle);
		await sleep(2600);
		const reading = await cdp.evaluate(`(() => {
			const panel = document.querySelector('[data-tour-tag="canvas-container"]');
			const tab = document.querySelector('[role="tab"][aria-selected="true"]');
			return {
				clicked: ${JSON.stringify(clicked)},
				activeTabLabel: tab ? tab.textContent.trim() : null,
				codeEditors: panel ? panel.querySelectorAll(".cm-editor").length : 0,
				gridRows: panel ? panel.querySelectorAll(".ag-row").length : 0,
				contentEditable: panel ? panel.querySelectorAll('[contenteditable="true"]').length : 0,
				text: panel ? panel.innerText.slice(0, 260) : null,
			};
		})()`);
		viewerReadings.push({ needle, ...reading, frame: await shot(name) });
	}
	report.viewerReadings = viewerReadings;

	report.appLogTail = log.slice(-10);
	writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	cdp.close();
	process.exit(await finish(0));
} finally {
	await teardown();
}
