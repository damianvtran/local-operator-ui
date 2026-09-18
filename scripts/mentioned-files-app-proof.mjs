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
 * `LOCAL_OPERATOR_UI_WINDOW_MODE=headless` against a live backend, on scratch
 * `HOME`, config, log and user-data directories so nothing of the operator's is
 * read or written - his UI state, his caches, and his own log files included.
 * (The log directory is the piece a scratch HOME does not cover: the app's
 * logger defaults to Electron's `home`, the OS account's home rather than the
 * `HOME` variable, so this rig hands the app its own `LOCAL_OPERATOR_LOG_DIR`.
 * See `src/main/backend/log-dir.ts`.) Then it
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
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import {
	onInterrupted,
	reapOnExit,
	stopAppTree,
} from "./app-tree-teardown.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";

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
 * Several agents run this harness at once, and an inherited `CMUX_*` or `LOP_*`
 * variable names the operator's real workspace or this harness session: a headless
 * run that keeps one can rename or drive the windows somebody is using right now,
 * and an inherited `LOP_MOBILE_CHILD_PROVIDER`/`_MODEL` silently reroutes a cell.
 * Stripping them here is the same rule the QA matrix follows - and the same pair
 * every other rig in this directory strips - and it belongs in the spawn rather
 * than in whatever shell happened to launch this.
 */
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete childEnv[key];
}
/*
 * The kill switch goes on for the same reason the cmux variables come off — and
 * that strip is pre-existing context in this file, not something this change
 * adds: what is new here is only the line below. This rig boots the app, and a
 * backend announcing a parked gate ends at `osascript` on macOS, whose banner
 * lands in the operator's real Notification Center. See
 * `notifications-off.mjs`.
 */
withNotificationsOff(childEnv);

/*
 * THE APP ITSELF IS SPAWNED, NOT `node_modules/.bin/electron`, and this file was
 * the last one in `scripts/` still doing it the other way.
 *
 * THAT SHIM IS A NODE SCRIPT (`electron/cli.js`) whose child is the app, so the
 * pid a teardown holds belongs to the shim: signal it and the app is re-parented
 * to launchd, keeps its `--remote-debugging-port`, and keeps holding the app's
 * SINGLE-INSTANCE LOCK, which is PER `--user-data-dir` rather than machine-wide
 * (`renderer-driver.mjs` measures the same lock, and `docs/agent-driver.md` states
 * it: two boots on different profiles coexist). A run reads it as a global
 * exclusion only because it reuses one profile path, so the next run in this same
 * scratch tree dies with "Another instance is already running" and this rig reports
 * its own teardown as a failed measurement.
 * `require("electron")` is the package's own documented answer and returns the
 * executable path, which is what makes `app.pid` the app's main process - the
 * same resolution `browser-chrome-proof.mjs`, `browser-host-proof.mjs`,
 * `renderer-driver.mjs` and `session-cookie-restart-proof.mjs` already use.
 */
const ELECTRON_BIN = createRequire(join(process.cwd(), "package.json"))(
	"electron",
);
/* Spelled once: the spawn and the profile scan below must name the same profile. */
const USER_DATA = join(OUT, "user-data");
/*
 * Scratch HOME, config and log directories, beside the profile.
 *
 * The profile alone covers the UI's own storage and the single-instance lock; it
 * does not cover the cache and home-root paths that resolve from `HOME`, nor the
 * app's log directory, which is composed from Electron's `home` and therefore
 * ignores both `HOME` and `--user-data-dir`. Without the log override this rig
 * appended its lines to the operator's own
 * `~/Library/Application Support/Local Operator/logs/*.log`; see the header.
 */
const HOME_DIR = join(OUT, "home");
const CONFIG_DIR = join(OUT, "config");
const LOG_DIR = join(OUT, "logs");
for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR]) {
	mkdirSync(dir, { recursive: true });
}

const app = spawn(
	ELECTRON_BIN,
	[
		".",
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${USER_DATA}`,
		// The app's own default, stated rather than inherited: the grid geometry
		// this run measures is the U1 regression check, and it is only meaningful
		// at the size the app opens at for a user who has never resized it.
		"--window-size=1380x900",
	],
	{
		env: {
			...childEnv,
			HOME: HOME_DIR,
			LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
			LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
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
		// Own the whole tree. Electron spawns helpers (GPU, renderer, utility), so a
		// signal to the direct child alone is not a stop: `detached` puts the app in
		// its own process group and `stopApp` below signals that group.
		detached: true,
	},
);
// The last resort, registered the moment there is a tree to lose: see
// `reapOnExit` for the paths neither the handlers nor the `finally` can reach.
reapOnExit({ pid: app.pid, userData: USER_DATA });
app.stdout.on("data", (d) => log.push(`[app] ${d}`));
app.stderr.on("data", (d) => log.push(`[app:err] ${d}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * The profile scan and the stop itself live in `app-tree-teardown.mjs`, shared with
 * the other rig that boots the app `detached`. The two copies had already drifted in
 * ways neither file showed: this one failed OPEN on an unreadable `ps` while the hop
 * rig failed closed, and it registered no interruption signals - so a Ctrl-C left
 * exactly the app this rig exists to stop. What stays here is the reporting, in this
 * file's voice, and the launch above.
 */

/**
 * The stop: the process GROUP first, and a reap by profile as the backstop.
 *
 * The group is what the normal case needs, and signalling it is the whole point
 * of spawning the binary detached - see the launch helper for why the shim made
 * this rig leak. The backstop covers the case the group cannot: an app
 * re-parented out of it answers to no pid this run holds, and only its command
 * line still names it. Kills there stay by EXACT PID, never a pattern pkill, and
 * the caller exits non-zero when this returns false, so a leak fails the run it
 * made rather than the next one. An unreadable `ps` is NOT clean either: the
 * backstop could not run, so nothing verified the tree is gone.
 */
async function stopApp() {
	const result = await stopAppTree({
		pid: app.pid,
		userData: USER_DATA,
		isExited: () => app.exitCode !== null || app.signalCode !== null,
	});
	if (result.profileUnreadable) {
		console.error(
			"teardown: `ps` could not be read, so the backstop did not run; the group signal is all this run has, and an unverified stop is reported as one",
		);
		return false;
	}
	for (const entry of result.reaped) {
		console.error(
			`teardown: ${entry.pid} outlived the group signal${
				entry.ppid === 1
					? " with ppid 1 (a root this run had already lost)"
					: ` (ppid ${entry.ppid})`
			}; reaping by exact pid`,
		);
	}
	if (result.survivors.length > 0) {
		console.error(
			`teardown: ${result.survivors.length} process(es) still name this run's profile (${result.survivors.map((entry) => entry.pid).join(", ")})`,
		);
	}
	return result.clean;
}

/*
 * ONE teardown, whichever path reaches it.
 *
 * `detached: true` in the launch above is what puts the app in a process group of
 * its own - which is what makes the group signal above a stop, and also why an
 * interruption aimed at this rig no longer reaches the app on its own: a group
 * signal (Ctrl-C, `killpg`, a harness that kills the group) used to arrive at the
 * app too and now stops here. So the interruption is handled here, and so is a
 * throw. `process.exit` does NOT run `finally` blocks, which is why every explicit
 * exit below calls this itself rather than relying on the wrapper.
 */
let stopping = null;
/** The stop, run once however many exit paths reach it. */
function teardown() {
	stopping ??= stopApp();
	return stopping;
}

/*
 * Stop the app, then report `code` - or 1 when the stop was not clean. An intended
 * code that is already a failure wins, so an early exit is not masked by a teardown
 * that failed too.
 */
const finish = (code) =>
	teardown().then((clean) => (code === 0 && !clean ? 1 : code));

/*
 * A run stopped by hand says so, because it is the one case where the app would
 * otherwise be left behind - and because "the handler ran" has to be readable in
 * the output rather than inferred from a process that happens to be gone.
 */
onInterrupted(async (signal) => {
	console.error(
		`teardown: ${signal} received; stopping the app this run booted`,
	);
	return finish(0);
});

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
	const file = join(
		homedir(),
		".local-operator",
		"sessions",
		SESSION,
		"transcript.jsonl",
	);
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
		paths: extractMentionedPaths(state.records, cwd ?? undefined).map(
			(m) => m.path,
		),
	};
}

/*
 * Everything after the spawn runs inside this wrapper, so an exception reaches the
 * teardown the same way the normal path does: a throw out of `cdp.evaluate` or
 * `esbuild.build` used to exit with the app still running, which is the same leak
 * by a second route. `process.exit` below does not run a `finally` block, which is
 * why each explicit exit stops the app itself as well.
 */
try {
	const deadline = Date.now() + DEADLINE_MS;
	let page = null;
	while (Date.now() < deadline) {
		page = (await targets()).find((target) => target.type === "page");
		if (page) break;
		await sleep(500);
	}
	if (!page) {
		console.error(`no renderer target appeared; log:\n${log.join("")}`);
		// Stopped before exiting, the way every other exit in this file is: a boot
		// that failed to come up is exactly when an app is left running, and the
		// single-instance lock it holds is per profile, so this rig's own next run in
		// the same scratch tree would collide with it.
		await finish(1);
		process.exit(1);
	}

	if (!process.env.LO_PROOF_TOKEN) {
		// Fail here rather than reporting an empty panel as a finding. An unpaired
		// instance renders the Files view with nothing in it, which looks exactly
		// like a producer that did not fire.
		console.error(
			"LO_PROOF_TOKEN is unset, so this instance would hold no bearer and no session would load. See the header for how to read it from the running backend.",
		);
		await finish(2);
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
		await finish(3);
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
		if (
			samples.length === 0 ||
			sample.count !== samples[samples.length - 1].count
		)
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

	/*
	 * 5. What the panel actually renders, plus the geometry.
	 *
	 * TWO CLAIMS, and the second is why this block was extended.
	 *
	 * The HORIZONTAL read is the U1 check: nothing sticks out of the window's right
	 * edge, and the column count is the shape's own answer (a grid's tracks, or one
	 * for a list - which is what makes this half comparable across the two shapes
	 * rather than re-invented for one of them).
	 *
	 * The VERTICAL read is the clipped-last-rows defect, which was invisible to
	 * every other instrument here: the Files view's root was `h-full` inside a
	 * column that also held the 40px chrome bar, so the panel overflowed its own
	 * pane by exactly the bar's height and the dock's `overflow-hidden` cut that
	 * band off. The defect is only visible at the END of the list - the scroller
	 * reaches its own maximum with the last rows still under the clip and its own
	 * bottom padding unreachable - so the read scrolls to maximum first, measures,
	 * and puts the scroll position back where it found it.
	 *
	 * The reading is deliberately shape-agnostic: it walks the rows container's
	 * children and asks each one's rect, so the SAME numbers exist for a grid of
	 * tiles and a list of rows. That is what let the fix be measured against the
	 * code that shipped, rather than against a description of it.
	 */
	report.filesGrid = await cdp.evaluate(`(() => {
		const grid = document.querySelector('[data-tour-tag="files-grid"]');
		const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
		const dock = document.querySelector('[data-tour-tag="canvas-dock"]');
		const tiles = grid ? [...grid.querySelectorAll(":scope > *")] : [];
		const inner = window.innerWidth;

		/*
		 * At MAXIMUM SCROLL, which is where the defect lives. Both readings happen
		 * here rather than in two round trips: the horizontal positions do not move
		 * with vertical scroll, and a second evaluate would be a second chance for
		 * the page to change between them.
		 */
		let vertical = null;
		if (scroller && tiles.length > 0) {
			const resting = scroller.scrollTop;
			scroller.scrollTop = scroller.scrollHeight;
			const style = window.getComputedStyle(scroller);
			const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
			const scrollerRect = scroller.getBoundingClientRect();
			const rowRects = tiles.map((tile) => tile.getBoundingClientRect());
			const last = rowRects[rowRects.length - 1];
			const pastEdge = rowRects.filter(
				(rect) => rect.bottom > window.innerHeight + 0.5,
			).length;
			const visible = Math.max(
				0,
				Math.min(last.bottom, window.innerHeight) - Math.max(last.top, 0),
			);
			vertical = {
				scrollTop: Math.round(scroller.scrollTop),
				maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
				reachedMax:
					scroller.scrollTop + scroller.clientHeight >=
					scroller.scrollHeight - 1,
				/* The panel's own bottom against the window: the defect, in one number. */
				scrollerBottomPastWindow:
					Math.round((scrollerRect.bottom - window.innerHeight) * 100) / 100,
				scrollerPaddingBottom: paddingBottom,
				lastRowBottom: Math.round(last.bottom * 100) / 100,
				lastRowVisibleFraction: Math.round((visible / last.height) * 100) / 100,
				lastRowInsideWindow: last.bottom <= window.innerHeight + 0.5,
				rowsPastWindowEdge: pastEdge,
				/* What the scroller's own bottom padding is worth once the end is reached. */
				paddingBelowLastRow:
					Math.round((scrollerRect.bottom - paddingBottom - last.bottom) * 100) /
					100,
			};
			scroller.scrollTop = resting;
		}

		const rects = tiles
			.map((tile) => tile.getBoundingClientRect())
			.filter((rect) => rect.width > 0);
		const clipped = rects.filter((rect) => rect.right > inner + 0.5).length;
		const columns = new Set(rects.map((rect) => Math.round(rect.left))).size;
		return {
			/* One child per file, in either shape: a grid's tiles or a list's rows. */
			tileCount: tiles.length,
			vertical,
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

	/*
	 * The verdict, in the rig rather than in the reader's head.
	 *
	 * Each term is one half of the claim: nothing past the window's edge, the last
	 * row whole inside it, the panel's own bottom inside the window (that is the
	 * defect itself - the panel overflowed its pane by the chrome bar's height), and
	 * the scroller's own bottom padding ACTUALLY REACHED rather than sitting in the
	 * clipped band. The tolerances are sub-pixel: a rounded half-pixel is not a
	 * clipped row.
	 */
	const bottom = report.filesGrid?.vertical ?? null;
	report.bottomClip = bottom
		? {
				rowsPastWindowEdge: bottom.rowsPastWindowEdge === 0,
				lastRowInsideWindow: bottom.lastRowInsideWindow,
				lastRowFullyVisible: bottom.lastRowVisibleFraction >= 0.999,
				panelInsideWindow: bottom.scrollerBottomPastWindow <= 0.5,
				bottomPaddingReachable:
					bottom.paddingBelowLastRow >= bottom.scrollerPaddingBottom - 1,
				reachedMaxScroll: bottom.reachedMax,
			}
		: null;
	report.bottomClipPass = report.bottomClip
		? Object.values(report.bottomClip).every(Boolean)
		: null;

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
		writeFileSync(
			`${OUT}/report-geometry.json`,
			JSON.stringify(report, null, 2),
		);
		console.log(JSON.stringify(report, null, 2));
		/*
		 * The vertical claim is an ASSERTION, so a run that measures the defect FAILS
		 * rather than printing it: a number nobody reads is how the clipped band
		 * survived in the first place. The horizontal read stays reported-only, as it
		 * was - it measures a shape that changes, and the wrong edge there is a design
		 * question rather than a defect with a boolean.
		 */
		if (report.bottomClipPass === false) {
			console.error(
				`geometry: the panel's last rows are not reachable - ${JSON.stringify(report.bottomClip)}`,
			);
			ws.close();
			process.exit(await finish(1));
		}
		ws.close();
		process.exit(await finish(0));
	}

	await cdp.evaluate(
		`document.querySelector('[aria-label="Files view"]')?.scrollIntoView()`,
	);
	const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(`${OUT}/files-panel.png`, Buffer.from(shot.data, "base64"));

	// 5. Click the PDF tile and read the frame the viewer created. This is the
	//    "prove the producer fires AND the viewer opens it" half.
	report.pdfTileClicked = await cdp.evaluate(`(() => {
		/*
		 * The tour tag, not `
		.grid`: an unqualified class selector matches any other
		 * `
		.grid` on the page, and a selector that finds the wrong element reports a
		 * click that never happened.
		 */
		const grid = document.querySelector('[data-tour-tag="files-grid"]');
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
	process.exit(await finish(0));
} finally {
	await teardown();
}
