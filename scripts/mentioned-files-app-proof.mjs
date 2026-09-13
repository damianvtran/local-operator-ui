/*
 * Prove the Files panel's producer fires in the REAL app.
 *
 * Why this exists as a script rather than as a paragraph in a PR: the claim it
 * checks - "a file the agent mentioned now appears in the panel" - is a claim
 * about a running application. Unit tests cover the extractor and the grid's
 * view model, but nothing in `test:desktop` can show that a real transcript
 * becomes a real tile, and the panel's producer has a history of being dead in
 * exactly the way a green suite cannot see.
 *
 * What it does: runs the BUILT app (`out/`, from `pnpm build`) with
 * `LOCAL_OPERATOR_UI_WINDOW_MODE=headless` against a live backend, in an
 * ISOLATED user-data-dir so the operator's own UI state is untouched. Then it
 * drives the app over raw CDP - no dependency, the built-in WebSocket is the
 * transport - navigates to a real session, opens the canvas, switches to the
 * Files view, reads what the panel contains, clicks the PDF tile, and reads the
 * frame that appeared. Two screenshots land in the output directory.
 *
 * It never sends a turn and never writes to the backend: the run reads a
 * session's durable history and paints it.
 *
 * PAIRING, and the trap in it. A second instance of the app did not start the
 * backend, so it holds no bearer and every session control answers 503 - the
 * panel renders, empty, and a run that does not check for this reports zero
 * mentions as though that were a result. Hand it the bearer the running backend
 * was started with. The token lives in the BACKEND process, which is the one
 * listening on the port; the app process does not carry it, and asking the app
 * is how this recipe silently produced nothing the first time it was written:
 *
 *   export LO_PROOF_TOKEN=$(ps eww -p "$(lsof -nP -iTCP:1111 -sTCP:LISTEN -t | head -1)" \
 *     | tr ' ' '\n' | grep -m1 '^LOCAL_OPERATOR_DESKTOP_TOKEN=' | cut -d= -f2)
 *
 * The value is read from the environment and never printed, logged, or written
 * into the report - which is also why this script takes it as an env var rather
 * than as an argument that would land in a shell history.
 *
 * Usage: node scripts/mentioned-files-app-proof.mjs <session-id> [out-dir]
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const SESSION = process.argv[2] ?? "225326399eed";
const OUT = process.argv[3] ?? "/tmp/lo-producer-proof";
/* `--geometry` prints only the 1380x900 grid measurement and the tile count. */
const GEOMETRY_ONLY = process.argv.includes("--geometry");
const PORT = 9333;
const DEADLINE_MS = 90_000;

mkdirSync(OUT, { recursive: true });
const log = [];

/*
 * The child environment, with the operator's own session variables REMOVED.
 *
 * Several agents run this harness at once, and an inherited `CMUX_*` variable
 * names the operator's real workspace: a headless run that keeps it can rename
 * or drive the windows somebody is using right now. Stripping them here is the
 * same rule the QA matrix follows, and it belongs in the spawn rather than in
 * whatever shell happened to launch this.
 */
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	if (key.startsWith("CMUX_")) delete childEnv[key];
}

const app = spawn(
	"./node_modules/.bin/electron",
	[
		".",
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${OUT}/user-data`,
		// The app's own default, stated rather than inherited: the grid geometry
		// this run measures is the U1 regression check, and it is only meaningful
		// at the size the app opens at for a user who has never resized it.
		"--window-size=1380x900",
	],
	{
		env: {
			...childEnv,
			LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
			// The operator's backend is already live on :1111; this app must not
			// try to manage or spawn one.
			VITE_DISABLE_BACKEND_MANAGER: "true",
			// Pairing: this app did not start the backend, so it must be handed the
			// bearer the running one was started with. Passed in by the caller so
			// the value is never written down here.
			LOCAL_OPERATOR_DESKTOP_TOKEN: process.env.LO_PROOF_TOKEN ?? undefined,
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);
app.stdout.on("data", (d) => log.push(`[app] ${d}`));
app.stderr.on("data", (d) => log.push(`[app:err] ${d}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
	try {
		const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
		return await response.json();
	} catch {
		return [];
	}
}

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
}

/*
 * What the panel OUGHT to hold, computed from the session's own durable
 * transcript by the shipped extractor and the shipped reducer.
 *
 * This is the completeness check R1-1/U2 asked for: the panel used to list the
 * loaded tail (14 tiles for a session whose transcript names 160 files) and to
 * truncate the first 200 mentions of a long one. Comparing the panel's own store
 * against this number is what makes "the complete set" a measurement rather than
 * a claim.
 */
async function expectedPaths() {
	const bundle = await build({
		stdin: {
			contents: `
				export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
				export { extractMentionedPaths } from "./src/renderer/src/features/chat/canonical/mentioned-files";
			`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		alias: {
			"@features": "./src/renderer/src/features",
			"@shared": "./src/renderer/src/shared",
		},
	});
	const { EMPTY_TRANSCRIPT, applyHistoryPage, extractMentionedPaths } =
		await import(
			`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
		);
	const file = join(homedir(), ".local-operator", "sessions", SESSION, "transcript.jsonl");
	if (!existsSync(file)) return null;
	const rows = [];
	let cwd = null;
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line);
			if (!row?.id || !row?.payload) continue;
			rows.push(row);
			if (row.payload?.custom_type === "frontend_state_checkpoint_v1") {
				const value = row.payload?.details?.state?.cwd;
				if (typeof value === "string" && value.length > 0) cwd = value;
			}
		} catch {
			// A truncated final line is a session still being written.
		}
	}
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: rows,
		has_more: false,
		cursor_missing: false,
	});
	return {
		records: state.records.length,
		cwd,
		paths: extractMentionedPaths(state.records, cwd ?? undefined).map((m) => m.path),
	};
}

const deadline = Date.now() + DEADLINE_MS;
let page = null;
while (Date.now() < deadline) {
	page = (await targets()).find((target) => target.type === "page");
	if (page) break;
	await sleep(500);
}
if (!page) {
	console.error(`no renderer target appeared; log:\n${log.join("")}`);
	process.exit(1);
}

if (!process.env.LO_PROOF_TOKEN) {
	// Fail here rather than reporting an empty panel as a finding. An unpaired
	// instance renders the Files view with nothing in it, which looks exactly
	// like a producer that did not fire.
	console.error(
		"LO_PROOF_TOKEN is unset, so this instance would hold no bearer and no session would load. See the header for how to read it from the running backend.",
	);
	app.kill("SIGKILL");
	process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener("open", resolve);
	ws.addEventListener("error", reject);
});
const cdp = new Cdp(ws);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

const report = { session: SESSION, out: OUT };

// Assert the pairing before reading anything else: every claim below depends on
// the app having been allowed to talk to the backend.
const capabilities = await cdp.evaluate(
	`(async () => { try { const r = await window.api.desktop.request({ op: "capabilities" }); return JSON.stringify(r.body?.result ?? r); } catch (e) { return "THREW: " + e.message; } })()`,
);
report.capabilities = capabilities;
if (!String(capabilities).includes('"desktop_available":true')) {
	console.error(
		`the app is not paired with the backend (capabilities: ${capabilities}); nothing below would be meaningful`,
	);
	ws.close();
	app.kill("SIGKILL");
	process.exit(3);
}

// 0. Record any CSP violation the PDF path causes. The design's probe found
//    that the `<embed>` variant of a blob PDF is blocked by our own CSP, so the
//    frame must be an `<iframe>` and a violation here would be the regression.
await cdp.evaluate(`(() => {
	window.__cspViolations = [];
	document.addEventListener("securitypolicyviolation", (event) => {
		window.__cspViolations.push(event.violatedDirective + " " + event.blockedURI);
	});
	return true;
})()`);

// 1. Navigate to the real session. HashRouter, so the hash is the route.
await cdp.evaluate(`location.hash = "#/chat/${SESSION}"; true`);

// 2. Wait for the producer to have written the store. The canvas store is a
//    zustand `persist` store, so what the panel will render is exactly what
//    localStorage holds - and reading it proves the producer ran, not just that
//    a component mounted.
let stored = null;
while (Date.now() < deadline) {
	stored = await cdp.evaluate(`localStorage.getItem("canvas-store")`);
	if (stored?.includes(SESSION)) break;
	await sleep(1000);
}
const parsed = stored ? JSON.parse(stored) : null;
const conversation = parsed?.state?.conversations?.[SESSION] ?? null;
report.mentionedFilesWritten = conversation?.mentionedFiles?.length ?? 0;
report.mentionedFilesSample = (conversation?.mentionedFiles ?? [])
	.slice(0, 8)
	.map((document) => ({
		path: document.path,
		type: document.type,
		availability: document.availability ?? null,
		sizeBytes: document.sizeBytes ?? null,
		contentLength: document.content?.length ?? 0,
	}));

// 3. Open the canvas and switch to the Files view.
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

/*
 * 4. Wait for the scan to settle, sampling the store as it goes.
 *
 * The panel pages the conversation's own older history while it is open, so the
 * count is expected to CLIMB and then stop. Sampling it turns "the panel lists
 * the complete set" into two measurable claims: the final count matches the
 * extractor's answer over the whole durable transcript, and the head stopped
 * saying it was still searching.
 */
const samples = [];
let previousCount = -1;
let stableFor = 0;
const scanDeadline = Date.now() + 60_000;
while (Date.now() < scanDeadline) {
	const sample = await cdp.evaluate(`(() => {
		const raw = localStorage.getItem("canvas-store");
		const conversation = raw
			? JSON.parse(raw)?.state?.conversations?.[${JSON.stringify(SESSION)}]
			: null;
		const head = document.querySelector('[data-tour-tag="files-scanner-head"]');
		return {
			count: conversation?.mentionedFiles?.length ?? 0,
			head: head ? head.innerText.trim() : null,
		};
	})()`);
	if (samples.length === 0 || sample.count !== samples[samples.length - 1].count)
		samples.push(sample);
	if (sample.count === previousCount) stableFor += 1;
	else stableFor = 0;
	previousCount = sample.count;
	// Three consecutive identical readings with no "Searching" line left: done.
	if (stableFor >= 3 && !(sample.head ?? "").includes("Searching")) break;
	await sleep(1000);
}
report.scanSamples = samples;
report.panelCount = previousCount;
report.panelHead = samples[samples.length - 1]?.head ?? null;

/*
 * The comparison is on RESOLVED paths, which is the panel's own identity.
 *
 * The extractor reports the spellings the transcript used (`~/x` and
 * `/Users/you/x` are two), and the probe collapses them to one tile by the
 * resolved path — so counting spellings would report a difference that is the
 * feature working. Resolution here mirrors `resolveUserPath` in main: `~`
 * expands against the home directory and a relative candidate resolves against
 * the session's cwd.
 */
const resolve = (path, cwd) => {
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	if (path.startsWith("/")) return path;
	return cwd ? join(cwd, path) : path;
};
const expected = await expectedPaths();
const expectedResolved = expected
	? [...new Set(expected.paths.map((path) => resolve(path, expected.cwd)))]
	: [];
const panelPaths = await cdp.evaluate(`(() => {
	const raw = localStorage.getItem("canvas-store");
	const conversation = raw
		? JSON.parse(raw)?.state?.conversations?.[${JSON.stringify(SESSION)}]
		: null;
	return (conversation?.mentionedFiles ?? []).map((document) => document.path);
})()`);
const expectedSet = new Set(expectedResolved);
report.durable = expected
	? {
			records: expected.records,
			cwd: expected.cwd,
			distinctSpellings: expected.paths.length,
			distinctResolvedPaths: expectedResolved.length,
			panelTiles: panelPaths.length,
			matchesPanel:
				panelPaths.length === expectedResolved.length ? "exact" : "DIFFERENT",
			panelPathsNotInTranscript: panelPaths.filter(
				(path) => !expectedSet.has(path),
			).length,
			transcriptPathsNotInPanel: expectedResolved.filter(
				(path) => !panelPaths.includes(path),
			).length,
		}
	: null;

// 5. What the grid actually renders, plus the 1380x900 geometry (U1's check).
report.filesGrid = await cdp.evaluate(`(() => {
	const grid = document.querySelector('[data-tour-tag="files-grid"]');
	const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
	const dock = document.querySelector('[data-tour-tag="canvas-dock"]');
	const tiles = grid ? [...grid.querySelectorAll(":scope > *")] : [];
	const rects = tiles
		.map((tile) => tile.getBoundingClientRect())
		.filter((rect) => rect.width > 0);
	const inner = window.innerWidth;
	const clipped = rects.filter((rect) => rect.right > inner + 0.5).length;
	const columns = new Set(rects.map((rect) => Math.round(rect.left))).size;
	return {
		tileCount: tiles.length,
		windowInnerWidth: inner,
		windowInnerHeight: window.innerHeight,
		dock: dock
			? (({ x, width, right }) => ({
					x: Math.round(x),
					width: Math.round(width),
					right: Math.round(right),
				}))(dock.getBoundingClientRect())
			: null,
		grid: grid
			? (({ x, width, right }) => ({
					x: Math.round(x),
					width: Math.round(width),
					right: Math.round(right),
				}))(grid.getBoundingClientRect())
			: null,
		scroller: scroller
			? { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth }
			: null,
		columns,
		clippedTiles: clipped,
		tileRightEdges: rects.map((rect) => Math.round(rect.right)),
		documentScrollsHorizontally:
			document.documentElement.scrollWidth > inner + 0.5,
	};
})()`);

report.focusabilityOrder = await cdp.evaluate(`(() => {
	const card = document.querySelector('[data-tour-tag="files-grid"] > *');
	if (!card) return null;
	return [...card.querySelectorAll("button, [tabindex]")].map(
		(element) =>
			element.getAttribute("aria-label") ??
			element.innerText.trim().slice(0, 24),
	);
})()`);

if (GEOMETRY_ONLY) {
	report.tileTexts = await cdp.evaluate(`(() => {
		const grid = document.querySelector('[data-tour-tag="files-grid"]');
		return grid ? [...grid.querySelectorAll("button")].map((b) => b.innerText.trim()) : [];
	})()`);
	writeFileSync(`${OUT}/report-geometry.json`, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	ws.close();
	app.kill("SIGTERM");
	await sleep(1000);
	app.kill("SIGKILL");
	process.exit(0);
}

await cdp.evaluate(
	`document.querySelector('[aria-label="Files view"]')?.scrollIntoView()`,
);
const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/files-panel.png`, Buffer.from(shot.data, "base64"));

// 5. Click the PDF tile and read the frame the viewer created. This is the
//    "prove the producer fires AND the viewer opens it" half.
report.pdfTileClicked = await cdp.evaluate(`(() => {
	const grid = document.querySelector(".grid");
	if (!grid) return false;
	const tile = [...grid.querySelectorAll("button")].find((button) =>
		button.innerText.toLowerCase().includes(".pdf"),
	);
	if (!tile) return false;
	tile.click();
	return true;
})()`);
await sleep(2500);
report.pdfFrame = await cdp.evaluate(`(() => {
	const frame = document.querySelector('iframe[src^="blob:"]');
	const panel = document.querySelector('[data-tour-tag="canvas-container"]');
	const tab = document.querySelector('[role="tab"][aria-selected="true"]');
	const openInOs = panel
		? panel.querySelector('[aria-label="Open in default app"]')
		: null;
	return {
		framePresent: Boolean(frame),
		frameSrcScheme: frame ? frame.src.split(":")[0] : null,
		frameTitle: frame ? frame.getAttribute("title") : null,
		/*
		 * Where the document's name is printed, and where the way out to the OS
		 * is. The name used to be read out of the viewer bar; design round 1 (D3)
		 * dropped that copy because the tab above already carries it, so the
		 * reading follows the decision - the tab is the name, and the bar is its
		 * action.
		 */
		activeTabLabel: tab ? tab.textContent.trim() : null,
		openInOsControl: Boolean(openInOs),
		cspViolations: window.__cspViolations ?? null,
		panelReceipt: document.body.innerText.includes("No longer on disk"),
	};
})()`);
const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/pdf-viewer.png`, Buffer.from(shot2.data, "base64"));

/*
 * 6. The keyboard and announcement checks (U3, U4, U5).
 *
 * All three are about ORDER and FOCUS, which source cannot settle: the tile's
 * Tab stop depends on the DOM order React actually produced, and the focus
 * return depends on where the browser puts focus when the focused control
 * unmounts. Driven with real key events, and read from the page.
 */
report.filesSegmentLabel = await cdp.evaluate(`(() => {
	const segment = document.querySelector(
		'button[aria-label^="Files view"]',
	);
	return segment ? segment.getAttribute("aria-label") : null;
})()`);

/** One real Escape key press, dispatched the way a keyboard sends one. */
const pressEscape = async () => {
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
	}
};
await pressEscape();
await sleep(500);
report.escapeReturnsToFiles = await cdp.evaluate(`(() => {
	const raw = localStorage.getItem("canvas-store");
	return JSON.parse(raw)?.state?.conversations?.[${JSON.stringify(SESSION)}]?.viewMode ?? null;
})()`);

// Closing the canvas from inside it is what used to drop focus on `<body>`.
report.closedCanvas = await cdp.evaluate(`(() => {
	const button = document.querySelector('[aria-label="Close canvas"]');
	if (!button) return false;
	button.focus();
	button.click();
	return true;
})()`);
await sleep(500);
report.focusAfterClose = await cdp.evaluate(`(() => {
	const active = document.activeElement;
	return {
		tag: active ? active.tagName.toLowerCase() : null,
		label: active ? active.getAttribute("aria-label") : null,
		tourTag: active ? active.getAttribute("data-tour-tag") : null,
	};
})()`);
report.canvasButtonLabel = await cdp.evaluate(`(() => {
	const button = document.querySelector('[data-tour-tag="open-canvas-button"]');
	return button ? button.getAttribute("aria-label") : null;
})()`);

report.appLogTail = log.slice(-8);
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

ws.close();
app.kill("SIGTERM");
await sleep(1000);
app.kill("SIGKILL");
