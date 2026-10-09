#!/usr/bin/env node
/**
 * The #872 follow-up pair: one default width for the right slot's panes (Run,
 * Browser, Console; the canvas keeps its dock cap), and the divider contract
 * that makes the Browser/Console separators announce the width the row can
 * actually host.
 *
 *     node scripts/right-slot-one-default-evidence.mjs \
 *         --label before|after --origin http://localhost:<storybook-port>
 *
 * ONE RIG, RUN ONCE PER TREE. The label only decides which expectations the run
 * asserts and which folder it writes; the measuring and the shooting are the
 * same code on both trees, and it imports nothing the change deletes, which is
 * what makes the two folders a like-for-like comparison. `before` is run from a
 * Storybook served by the unmodified base commit (`origin/main` at this
 * branch's base); `after` from this branch's.
 *
 * WHAT THE RUN LOADS. The four shell arms the committed `shell-app-shell`
 * frames come from - `chat-dock-run-panel`, `chat-dock-browser`,
 * `chat-dock-console`, `chat-dock-files` - with `rightSlotWidth` as a story arg
 * (0 unless a cell says otherwise), which is exactly the fresh-profile arm the
 * issue is about: the width ANYONE WHO NEVER DRAGGED A DIVIDER sees.
 *
 * WHAT IT READS, AND WHAT IT ASSERTS (a wrong reading fails the run; it never
 * prints a table instead):
 *
 *   - for window widths 800, 900, 1024, 1180, 1280, 1380, 1440 and 1600 with
 *     the width UNSET: the row, the conversation column's width and the open
 *     pane's DRAWN width, per pane. `after` asserts the one-default relation -
 *     Run, Browser and Console draw the SAME width at every row (the slot's
 *     640, held to the row's leftover), and the conversation column moves
 *     between them by nothing - while the canvas draws its own dock cap
 *     `min(560, row - 480)`. `before` asserts each pane's own seed (420 / 640 /
 *     796 / 800), which is the defect the pair shows: the widths differ and the
 *     column re-wraps on every switch;
 *   - a STORED width of 350 and of 1000 at 1380: the per-pane floor lift (350
 *     lifts to 480 for the browser/console and to 400 for the canvas) and the
 *     shared-width equality (1000 draws 596 for the three, 560 for the canvas);
 *   - the Browser and Console separators' `aria-valuenow/min/max` at 800 and
 *     900 (rows 700 and 800: below both panes' 480 floor): `before` announces
 *     the PREFERENCE (640 / 796, min 480, max 1200) while the pane is drawn at
 *     220 / 320 - the D4 defect; `after` collapses onto the drawn width;
 *   - the Run separator at 1600 with a stored 1000, on BOTH trees: the pane
 *     draws 816 against its 640 contract ceiling and the separator announces
 *     valuenow=816 > valuemax=640. Found while implementing D4, recorded here
 *     and on the PR as found-not-fixed rather than silently reshaped (a clamp
 *     would announce a width the pane is not drawn at; lifting the ceiling
 *     would let a run-panel drag store past its design max).
 *
 * FRAMES (16 per tree): the four panes at 1380x900 and 1280x900, light and
 * dark, each through `assertFramePaints` before it is written.
 *
 * Raw CDP against ONE private headless Chrome (mock-keychain switch, a scratch
 * `--user-data-dir`, its own process group, reaped by exact pid), the launch
 * discipline of `chat-measure-handles-removed-evidence.mjs`. The readings are
 * written beside the frames as `readings.json`, which the folder's README
 * tabulates. Run under the pinned zone (`env TZ=America/New_York`) like the
 * rest of the set.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = join(ROOT, "docs", "evidence", "right-slot-one-default");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const argValue = (name) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? undefined : process.argv[at + 1];
};
const LABEL = argValue("--label");
const ORIGIN = argValue("--origin");
if (!["before", "after"].includes(LABEL) || !ORIGIN) {
	console.error(
		"usage: right-slot-one-default-evidence.mjs --label before|after --origin <storybook-origin>",
	);
	process.exit(2);
}
const OUT = join(OUT_ROOT, LABEL);

/** The conversation column's floor: the subtraction the row's capacity is. */
const CHAT_FLOOR = 480;
/** The canvas's dock cap and floor (`canvasDockWidth`, `CANVAS_PANE_MIN_PX`). */
const CANVAS_DOCK_MAX = 560;
const CANVAS_FLOOR = 400;

/**
 * The four panes, their story arms, and the numbers each tree opens them at.
 *
 * THE `seed` COLUMN IS THE WHOLE CHANGE, restated here because this file is
 * JavaScript and cannot import the store: `before` resolves an unset width to
 * each pane's own seed (420 / 640 / 796 / 800), `after` to the slot's one 640.
 * The canvas's and the browser's seeds already equal 640, which is why the
 * chosen default costs them nothing.
 */
const PANES = [
	{
		key: "run",
		story: "shell-app-shell--chat-dock-run-panel",
		tag: "run-panel-dock",
		divider: "Resize run details",
		floor: 320,
		max: 640,
		seed: { before: 420, after: 640 },
	},
	{
		key: "browser",
		story: "shell-app-shell--chat-dock-browser",
		tag: "browser-pane-slot",
		divider: "Resize browser",
		floor: 480,
		max: 1200,
		seed: { before: 640, after: 640 },
	},
	{
		key: "console",
		story: "shell-app-shell--chat-dock-console",
		tag: "console-pane-slot",
		divider: "Resize console",
		floor: 480,
		max: 1200,
		seed: { before: 796, after: 640 },
	},
	{
		key: "canvas",
		story: "shell-app-shell--chat-dock-files",
		tag: "canvas-dock",
		divider: "Resize canvas",
		floor: CANVAS_FLOOR,
		max: CANVAS_DOCK_MAX,
		seed: { before: 800, after: 640 },
	},
];

const READ_WIDTHS = [800, 900, 1024, 1180, 1280, 1380, 1440, 1600];
const HEIGHT = 900;
const STORED_CELLS = [
	{ width: 350, at: 1380 },
	{ width: 1000, at: 1380 },
];
/** The D4 cell: both separators at rows below the pane's floor. */
const D4_WIDTHS = [800, 900];
/** The run divider's found-not-fixed cell. */
const RUN_ANOMALY = { width: 1600, stored: 1000 };
const FRAME_SIZES = [
	{ width: 1380, height: 900 },
	{ width: 1280, height: 900 },
];
const THEMES = ["localOperatorLight", "localOperatorDark"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

const failures = [];
const check = (ok, message) => {
	if (!ok) failures.push(message);
};
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;
/*
 * THE BEFORE TREE'S CONSOLE DEFAULT IS MEASURED FROM THE SHIPPED FACE IN THE
 * BROWSER: the store computes `DEFAULT_CONSOLE_PANEL_WIDTH` from `measureCell()`
 * at module load, and the real face's advance is ~7.83px per cell there - 799 for
 * the design's 100 columns plus 16px of chrome - against the 796 the no-DOM ratio
 * (0.6em) computes and the tests pin. This one cell therefore allows the ratio to
 * differ by up to 5px, and `readings.json` carries the number actually read; the
 * after tree's 640 is a constant and is asserted exactly.
 */
const toleranceFor = (pane) =>
	LABEL === "before" && pane.key === "console" ? 5 : 1;

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			}
		});
	}

	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
	}

	async evaluate(expression) {
		const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
			returnByValue: true,
			awaitPromise: true,
			expression,
		});
		if (exceptionDetails) {
			throw new Error(`page threw: ${exceptionDetails.text}`);
		}
		return result.value;
	}
}

let chrome = null;
let dataDir = null;

/** Reaps the browser's whole process group by the pid this run created. */
const teardown = () => {
	if (chrome?.pid) {
		try {
			process.kill(-chrome.pid, "SIGKILL");
		} catch {
			/* already gone */
		}
		chrome = null;
	}
	if (dataDir) {
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

const launch = async () => {
	dataDir = mkdtempSync(join(tmpdir(), "lo-right-slot-one-default-"));
	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
		{ detached: true },
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEVTOOLS_URL);
			if (m) {
				clearTimeout(timer);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	/*
	 * EVERY CELL IS A FRESH PROFILE. The arms persist their open flags and the
	 * shared width through `ui-preferences-storage`, and a page navigation does
	 * not run the previous arm's cleanup - so without this the next arm loads
	 * with the PREVIOUS arm's flags still set, two panes claim the slot, and the
	 * resolver answers for whichever one wins precedence (measured: a canvas
	 * flag left by one cell made the next cell's run/browser panes draw at the
	 * canvas's dock width and the sidebar yield for them). The issue's subject
	 * is "the width anyone who never dragged a divider sees", which is exactly
	 * this state, so each load starts from an empty store.
	 */
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source: `try { if (location.origin === ${JSON.stringify(ORIGIN)}) localStorage.removeItem("ui-preferences-storage"); } catch {}`,
	});
	return cdp;
};

/**
 * The page-side reading. Everything is measured from the live DOM - boxes by
 * `getBoundingClientRect`, the separator by its own aria attributes - so the
 * same expression is valid on both trees; only the EXPECTED numbers differ,
 * and those live in `PANES` and the checks below rather than here.
 */
const READ = (pane) => `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: round(r.x), width: round(r.width), right: round(r.right) };
	};
	const row = rect(document.querySelector('[data-tour-tag="pane-row"]'));
	const chat = rect(document.querySelector('[data-tour-tag="chat-column"]'));
	const paneEl = document.querySelector('[data-tour-tag="${pane.tag}"]');
	const paneRect = rect(paneEl);
	const sep = document.querySelector('[aria-label^="${pane.divider}"]');
	const divider = sep
		? {
				present: true,
				value: Number(sep.getAttribute("aria-valuenow")),
				min: Number(sep.getAttribute("aria-valuemin")),
				max: Number(sep.getAttribute("aria-valuemax")),
			}
		: { present: false };
	return { row, chat, pane: paneRect, divider };
})()`;

const openStory = async (cdp, story, size, theme, storedWidth) => {
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		...size,
		deviceScaleFactor: 1,
		mobile: false,
	});
	const args = `theme:${theme};rightSlotWidth:${storedWidth ?? 0}`;
	await cdp.send("Page.navigate", { url: "about:blank" });
	await sleep(120);
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=${args}`,
	});
	for (let i = 0; i < 160; i++) {
		const ready = await cdp
			.evaluate(`(() => {
				const busy = [...document.querySelectorAll(
					".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader, .sb-show-errordisplay",
				)].some((el) => el.getBoundingClientRect().height > 0);
				if (busy) return false;
				if (document.fonts.status !== "loaded") return false;
				if (document.documentElement.dataset.capturePending) return false;
				if (document.documentElement.dataset.captureFailed) return false;
				return !!document.querySelector('[data-tour-tag="pane-row"]');
			})()`)
			.catch(() => false);
		if (ready === true) break;
		if (i === 159) throw new Error(`${story} @ ${theme}: never became ready`);
		await sleep(250);
	}
	/*
	 * Layout settled: the row's rect is unchanged across two paint frames. The
	 * pane wrapper carries `transition-[width] duration-base`, so a reading taken
	 * before the slide ends describes a layout that never existed on screen.
	 */
	let last = null;
	for (let i = 0; i < 40; i++) {
		const now = await cdp.evaluate(
			`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(JSON.stringify(document.querySelector('[data-tour-tag="pane-row"]').getBoundingClientRect())))))`,
		);
		if (now === last) return;
		last = now;
		await sleep(100);
	}
	throw new Error(`${story} @ ${theme}: the row never settled`);
};

const shoot = async (cdp, paneKey, size, theme) => {
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "webp",
		quality: 88,
	});
	/*
	 * THE EVIDENCE LAYOUT: `<state>/<palette>.webp`, the one every set in
	 * `docs/evidence` uses and the one `check-evidence.mjs` walks - the palette
	 * is the FILE NAME, the state is the directory. A flat
	 * `<pane>-<size>-<palette>.webp` fails the walk, which reads the stem as a
	 * palette id and finds none.
	 */
	const dir = join(OUT, `${paneKey}-${size.width}x${size.height}`);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${theme}.webp`);
	writeFileSync(file, Buffer.from(data, "base64"));
	await assertFramePaints(file, theme);
};

/** What the tree's resolver would draw for `pane`, given the measured row. */
const expectedDrawn = (pane, rowWidth, storedWidth) => {
	const capacity = Math.max(0, rowWidth - CHAT_FLOOR);
	const seed = storedWidth ?? pane.seed[LABEL];
	if (pane.key === "canvas") {
		return Math.min(
			Math.max(CANVAS_FLOOR, seed),
			Math.min(CANVAS_DOCK_MAX, capacity),
		);
	}
	return Math.min(Math.max(pane.floor, seed), capacity);
};

const main = async () => {
	const cdp = await launch();
	const readings = {
		label: LABEL,
		origin: ORIGIN,
		widths: {},
		stored: {},
		d4: {},
		runAnomaly: {},
	};
	mkdirSync(OUT, { recursive: true });

	/*
	 * (a) THE UNSET ARM, every width x pane. Each cell reads the row, the column
	 * and the pane; the assertions are the relations below, per tree.
	 */
	for (const width of READ_WIDTHS) {
		const size = { width, height: HEIGHT };
		readings.widths[width] = {};
		const drawn = {};
		for (const pane of PANES) {
			await openStory(cdp, pane.story, size, "localOperatorDark", null);
			const r = await cdp.evaluate(READ(pane));
			check(r?.row && r?.chat && r?.pane, `${width} ${pane.key}: no reading`);
			if (!r?.row || !r?.chat || !r?.pane) continue;
			readings.widths[width][pane.key] = r;
			drawn[pane.key] = r.pane.width;

			const want = expectedDrawn(pane, r.row.width, null);
			check(
				near(r.pane.width, want, toleranceFor(pane)),
				`${width} ${pane.key}: drawn ${r.pane.width}, expected ${want} (row ${r.row.width})`,
			);
			check(
				near(r.chat.width, r.row.width - r.pane.width),
				`${width} ${pane.key}: the row does not tile (row ${r.row.width} = chat ${r.chat.width} + pane ${r.pane.width})`,
			);
			check(
				r.chat.width >= CHAT_FLOOR - 1,
				`${width} ${pane.key}: the conversation column is below its floor (${r.chat.width})`,
			);
		}
		/*
		 * THE ONE-DEFAULT RELATION, this change's whole point, asserted on the
		 * `after` tree only: Run, Browser and Console draw the SAME width at this
		 * row, and the canvas draws its own dock cap.
		 */
		if (LABEL === "after") {
			const runCell = readings.widths[width].run;
			const canvasCell = readings.widths[width].canvas;
			if (runCell) {
				const want = expectedDrawn(PANES[0], runCell.row.width, null);
				for (const key of ["run", "browser", "console"]) {
					check(
						drawn[key] !== undefined && near(drawn[key], want),
						`${width} ${key}: ${drawn[key]} breaks the one default (${want})`,
					);
				}
				// The column does not move between the three panes.
				const chatRun = runCell.chat.width;
				for (const key of ["browser", "console"]) {
					const cell = readings.widths[width][key];
					if (!cell) continue;
					check(
						near(cell.chat.width, chatRun),
						`${width} ${key}: the column moved on a pane switch (${cell.chat.width} vs ${chatRun})`,
					);
				}
			}
			if (canvasCell) {
				/*
				 * THE CANVAS IS COMPARED ON ITS OWN ROW: at 1024-1183 the shell
				 * YIELDS the sidebar to the canvas (`sidebarYieldsToCanvas`), so
				 * its row is wider than the other three panes' - a comparison
				 * against their row would be the second arithmetic this rig
				 * exists to avoid.
				 */
				const canvasWant = expectedDrawn(PANES[3], canvasCell.row.width, null);
				check(
					near(canvasCell.pane.width, canvasWant),
					`${width} canvas: ${canvasCell.pane.width}, expected its dock cap ${canvasWant}`,
				);
				if (runCell && near(canvasCell.row.width, runCell.row.width)) {
					const cap = Math.max(0, runCell.row.width - CHAT_FLOOR);
					const canvasChat = canvasCell.chat.width;
					if (cap <= CANVAS_DOCK_MAX) {
						check(
							near(canvasChat, runCell.chat.width),
							`${width} canvas: the cap does not bind here, so the column must not move (${canvasChat} vs ${runCell.chat.width})`,
						);
					} else {
						check(
							near(canvasChat, runCell.row.width - CANVAS_DOCK_MAX),
							`${width} canvas: the column moves by the dock cap only (${canvasChat} vs ${runCell.row.width - CANVAS_DOCK_MAX})`,
						);
					}
				}
			}
		}
	}

	/*
	 * (b) THE STORED ARM, 350 and 1000 at 1380. The floor lift and the shared
	 * width are documentation; they must read as documented on BOTH trees (this
	 * change explicitly does not touch either).
	 */
	for (const cell of STORED_CELLS) {
		const size = { width: cell.at, height: HEIGHT };
		readings.stored[cell.width] = {};
		for (const pane of PANES) {
			await openStory(cdp, pane.story, size, "localOperatorDark", cell.width);
			const r = await cdp.evaluate(READ(pane));
			check(
				r?.row && r?.pane,
				`${cell.width}@${cell.at} ${pane.key}: no reading`,
			);
			if (!r?.row || !r?.pane) continue;
			readings.stored[cell.width][pane.key] = r;
			const want = expectedDrawn(pane, r.row.width, cell.width);
			check(
				near(r.pane.width, want, toleranceFor(pane)),
				`${cell.width}@${cell.at} ${pane.key}: drawn ${r.pane.width}, expected ${want}`,
			);
			check(
				near(r.chat.width, r.row.width - r.pane.width),
				`${cell.width}@${cell.at} ${pane.key}: the row does not tile`,
			);
		}
	}

	/*
	 * (c) THE D4 CELLS: the Browser and Console separators at rows below both
	 * panes' 480 floor. `after` must collapse onto the drawn width; `before`
	 * announces the preference, which is the defect.
	 */
	for (const width of D4_WIDTHS) {
		const size = { width, height: HEIGHT };
		readings.d4[width] = {};
		for (const pane of PANES.filter(
			(p) => p.key === "browser" || p.key === "console",
		)) {
			await openStory(cdp, pane.story, size, "localOperatorDark", null);
			const r = await cdp.evaluate(READ(pane));
			check(r?.pane && r?.divider?.present, `${width} ${pane.key}: no reading`);
			if (!r?.pane || !r?.divider?.present) continue;
			readings.d4[width][pane.key] = { pane: r.pane, divider: r.divider };
			const capacity = Math.max(0, r.row.width - CHAT_FLOOR);
			if (LABEL === "after") {
				check(
					r.divider.value === Math.round(r.pane.width),
					`${width} ${pane.key}: the separator announces ${r.divider.value} while the pane draws ${r.pane.width}`,
				);
				check(
					r.divider.value === r.divider.min && r.divider.max === r.divider.min,
					`${width} ${pane.key}: the range did not collapse onto the drawn width (${r.divider.min}..${r.divider.max})`,
				);
				check(
					capacity < pane.floor,
					`${width} ${pane.key}: this cell is only meaningful below the pane's floor`,
				);
			} else {
				check(
					near(r.divider.value, pane.seed.before, toleranceFor(pane)) &&
						r.divider.min === 480 &&
						r.divider.max === 1200,
					`${width} ${pane.key}: before tree divider is ${r.divider.value}/${r.divider.min}/${r.divider.max}, expected ${pane.seed.before}/480/1200`,
				);
				check(
					r.pane.width < r.divider.value,
					`${width} ${pane.key}: the before defect is that the pane draws less than announced (${r.pane.width} vs ${r.divider.value})`,
				);
			}
		}
	}

	/*
	 * (d) THE RUN DIVIDER'S FOUND-NOT-FIXED CELL, both trees: a stored 1000 at
	 * 1600 draws 816 against the pane's 640 ceiling, and the separator's value
	 * sits above its own max. Recorded, not reshaped - see the docblock.
	 */
	{
		const size = { width: RUN_ANOMALY.width, height: HEIGHT };
		for (const pane of PANES.filter((p) => p.key === "run")) {
			await openStory(
				cdp,
				pane.story,
				size,
				"localOperatorDark",
				RUN_ANOMALY.stored,
			);
			const r = await cdp.evaluate(READ(pane));
			check(r?.pane && r?.divider?.present, "run anomaly: no reading");
			if (!r?.pane || !r?.divider?.present) continue;
			readings.runAnomaly = { pane: r.pane, divider: r.divider };
			check(
				r.divider.value === Math.round(r.pane.width),
				`run anomaly: the separator announces ${r.divider.value} while the pane draws ${r.pane.width}`,
			);
			check(
				r.divider.max === 640,
				`run anomaly: the ceiling is ${r.divider.max}, expected the pane's 640`,
			);
			check(
				r.divider.value > r.divider.max,
				`run anomaly: value ${r.divider.value} is not above max ${r.divider.max}; if this changed, the PR's found-not-fixed record needs re-reading`,
			);
		}
	}

	/*
	 * (e) THE FRAMES: four panes, two sizes, two palettes, all at the UNSET
	 * width - the arm this change moves.
	 */
	for (const size of FRAME_SIZES) {
		for (const pane of PANES) {
			for (const theme of THEMES) {
				await openStory(cdp, pane.story, size, theme, null);
				await shoot(cdp, pane.key, size, theme);
			}
		}
	}

	writeFileSync(
		join(OUT, "readings.json"),
		`${JSON.stringify(readings, null, "\t")}\n`,
	);
	console.log(JSON.stringify(readings, null, 2));

	if (failures.length) {
		console.error(`\n${failures.length} reading(s) FAILED:`);
		for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
		throw new Error("readings failed");
	}
	console.log(`\nall readings hold on the ${LABEL} tree`);
};

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		teardown();
		process.exit(1);
	});
}

main()
	.then(() => teardown())
	.catch((error) => {
		teardown();
		console.error(error);
		process.exit(1);
	});
