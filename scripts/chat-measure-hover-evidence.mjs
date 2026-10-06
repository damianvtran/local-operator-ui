#!/usr/bin/env node
/**
 * The conversation column's resize cue, BEFORE and AFTER, at the hover.
 *
 *     node scripts/chat-measure-hover-evidence.mjs \
 *       --before http://localhost:6392 --after http://localhost:6391
 *
 * WHY A PAIR AND NOT A SWEEP. Two claims are made by this change and neither is
 * a state: the cue's ink went from a full-height rule back to a SHORT bar (the
 * reference's texture, re-homed onto the measure's edge), and the tooltip panel
 * stopped arriving under a hand merely sweeping past the gutter. Both are
 * comparisons against the tree this change started from, so this rig drives TWO
 * Storybooks in one run - the base tree's and this branch's - through the same
 * pointer, at the same viewport, in the same two palettes, and writes both halves
 * of every state. The base tree is unmodified `origin/main`, so the "before"
 * frames are the shipped rule rather than a reconstruction of it.
 *
 * WHAT IT ASSERTS. The frames carry the look; the readings carry the geometry,
 * and the run FAILS rather than printing a table if any of them is wrong:
 *
 *   - Rest: the cue is at `opacity: 0` on both edges, and no panel exists.
 *   - Hover, each edge: that edge's cue lights and the OTHER edge's does not -
 *     the two handles are one symmetric measure, not one control - and neither
 *     tree has opened its panel yet (the beat is under both dwells, so the pair
 *     is like-for-like).
 *   - The contested beat (520ms, the app's own 400ms tooltip delay + margin):
 *     the base tree's panel IS open and this branch's is NOT. That reading is
 *     the operator's complaint stated as behaviour, and it is taken without a
 *     frame because a frame of "no panel" and a frame of "the cue" are the same
 *     picture at this x.
 *   - Rested (1400ms): both trees have a panel, and it is inside the pane.
 *   - Dragging: the cue stays lit, and on this branch the core's Y is published
 *     (`--lo-chat-measure-cue-y`) and lands where the hand is.
 *   - After a reset: the cue is back at rest and the column is back to the
 *     shipped measure.
 *   - Keyboard focus: the panel is open on BOTH trees - the shortcut this
 *     change deliberately did not touch - and the cue is lit.
 *   - This branch only: the cue's ELEMENT is still the column's full height and
 *     2px wide (the attribute, the placement and the band's containment all read
 *     off that frame), while its INK is a small fraction of the column - never
 *     the full-height rule it replaced. The ink is read twice: off the painted
 *     gradient's own stops, and off the frames themselves (the rows of the cue's
 *     column that differ between `rest` and `hover-right`).
 *
 * Raw CDP against a private headless Chrome, the mock-keychain switch, one
 * browser per (half, palette) with its own scratch profile, killed by pid on
 * exit - the launch discipline `chat-measure-line-evidence.mjs` and
 * `chat-measure-drag-evidence.mjs` beside it both use. Every frame passes
 * `check-evidence.mjs`'s own `assertFramePaints` before it is written.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { assertFramePaints } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence", "chat-measure-hover");
const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const at = ARGS.indexOf(`--${name}`);
	return at === -1 ? fallback : ARGS[at + 1];
};
const BEFORE = flag("before", "http://localhost:6392");
const AFTER = flag("after", "http://localhost:6391");
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const STORY = "chat-measure-drag--transcript";
const VIEWPORT = { width: 1060, height: 620 };
const THEMES = ["localOperatorDark", "localOperatorLight"];

/*
 * The beats the pointer is rested for, and what each one is FOR.
 *
 * `CONTESTED_MS` is the app's own tooltip beat (`TOOLTIP_DELAY_MS`, 400) plus a
 * margin, and it is the beat where the two trees disagree: the base tree's panel
 * is parked over the prose and this branch's has not arrived. `RESTED_MS` is past
 * this branch's own dwell (`MEASURE_PANEL_DWELL_MS`, 1200), so both trees have
 * opened by then and the frame is about where the panel lands rather than whether
 * it arrives. Both are measured from the pointer's arrival at the band.
 *
 * `EARLY_MS` is the one that is NOT a reading: it is only used to let the page
 * settle after a pointer is parked off the band. The states that must be
 * panel-free - the hover frames - do not spend it, because the cue is fully lit at
 * ~320ms (a 200ms intent delay under a 120ms ease) and a fixed 300ms shot lands
 * mid-ease: those frames sat at `opacity 0.956..0.988` and did not reproduce
 * byte-for-byte between runs. They wait for the cue instead, which is also what
 * puts them safely under the base tree's 400ms dwell.
 */
const EARLY_MS = 300;
const CONTESTED_MS = 520;
const RESTED_MS = 1400;

/** Chrome's own quiet period after a navigation, before the story is asked for. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
		const { result } = await this.send("Runtime.evaluate", {
			returnByValue: true,
			awaitPromise: true,
			expression,
		});
		return result.value;
	}

	async mouse(type, x, y, extra = {}) {
		await this.send("Input.dispatchMouseEvent", {
			type,
			x: Math.round(x),
			y: Math.round(y),
			button: extra.button ?? "none",
			buttons: extra.buttons ?? 0,
			clickCount: extra.clickCount ?? 0,
			modifiers: 0,
			pointerType: "mouse",
		});
	}
}

/**
 * What the rig reads out of the page, on EITHER tree.
 *
 * The cue's INK is deliberately not its element's rect. This branch's cue keeps
 * the column's full height so the `data-lo-chat-measure-line` attribute, the
 * placement classes and the band's containment all stay on one frame - so its
 * rect answers "where is the cue's box", which is not the question the change is
 * about. The paint is a linear gradient and its stops carry the span, read here
 * as the px offsets of the gradient's `calc()` stops in order, `[-outer, -core,
 * +core, +outer]`: the ink is `outer * 2` and the solid core `core * 2`. On a
 * tree whose cue is a background COLOUR (the base tree) the list is empty and the
 * ink falls back to the element's own height, which for a full-height rule is
 * exactly right.
 */
/**
 * The cue's gradient stops, read off the element's computed `background-image`, as a
 * function SOURCE string.
 *
 * SHARED BY THE PROBE AND THE RELEASE TRACE, rather than written twice: the release
 * trace has to read the same four stops sixty times a second, and a second parser
 * beside this one is a second thing to keep in step with the browser's
 * serialisation.
 *
 * TWO SERIALISATIONS, and the second one cost a round. While the seat is a
 * percentage the browser keeps the `calc(<seat> - Npx)` form and the offsets are the
 * numbers after each sign; once a px seat is published the whole `calc()` folds to a
 * single length, so the stops come back as plain px positions. A parser that only
 * knew the first form read null exactly in the states that matter (the pointer's own
 * hover and the drag) - QA's "probe artifact" on their round - so both forms are
 * read, and both answer the same two lengths: the ink's span and the core's.
 */
const CUE_STOPS = `(el) => {
	if (!el) return [];
	const bg = getComputedStyle(el).backgroundImage || "";
	const relative = [...bg.matchAll(/calc\\(.*?([+-])\\s*([\\d.]+)px\\s*\\)/g)].map(
		(m) => (m[1] === "-" ? -1 : 1) * Number.parseFloat(m[2]),
	);
	if (relative.length === 4) return relative;
	const absolute = [...bg.matchAll(/([\\d.]+)px/g)].map((m) =>
		Number.parseFloat(m[1]),
	);
	return absolute.length === 4 ? absolute : [];
}`;

/**
 * One sample per animation frame for ~400ms: the mark's core centre and its opacity.
 *
 * The window is deliberately longer than the `duration-fast` fade, so a trace taken
 * across a release covers the frame the gesture ends on, the fade, and one frame
 * after it. It is started BEFORE the mouseup and allowed to run past it, which is the
 * only way to see an intermediate frame at all.
 */
const TRACE = `(() => {
	const el = document.querySelector('[data-lo-chat-measure-line="right"]');
	const stops = ${CUE_STOPS};
	const out = [];
	const start = performance.now();
	return new Promise((resolve) => {
		const tick = () => {
			const s = stops(el);
			out.push({
				t: Math.round(performance.now() - start),
				centre: s.length === 4 ? (s[1] + s[2]) / 2 : null,
				op: Number(getComputedStyle(el).opacity),
			});
			if (performance.now() - start > 400) resolve(out);
			else requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
})()`;

const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), x: round(r.left + r.width / 2), y: round(r.top + r.height / 2), w: round(r.width), h: round(r.height) };
	};
	const pick = (sel) => document.querySelector(sel);
	const opacity = (el) => (el ? Number(getComputedStyle(el).opacity) : null);
	const handle = pick('[data-lo-chat-measure-handle="right"]');
	const handleLeft = pick('[data-lo-chat-measure-handle="left"]');
	const cue = pick('[data-lo-chat-measure-line="right"]');
	const cueLeft = pick('[data-lo-chat-measure-line="left"]');
	const scroller = pick("[data-lo-canonical-transcript]");
	const content = pick("[data-lo-transcript-content]");
	const panel = pick('[role="tooltip"]');
	const stops = ${CUE_STOPS};
	const cueStops = stops(cue);
	const persisted = (() => {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			try {
				const value = JSON.parse(localStorage.getItem(key))?.state?.chatMeasureWidth;
				if (value !== undefined) return value;
			} catch {
				/* not a JSON entry: not ours */
			}
		}
		return undefined;
	})();
	return {
		content: rect(content),
		pane: rect(scroller),
		panel: rect(panel),
		panelText: panel ? panel.textContent : null,
		persisted,
		maxWidth: content ? getComputedStyle(content).maxWidth : null,
		activeIsSeparator: !!handle && document.activeElement === handle,
		cueVar: handle && handle.parentElement
			? handle.parentElement.style.getPropertyValue("--lo-chat-measure-cue-y")
			: null,
		cueOpacity: opacity(cue),
		cueLeftOpacity: opacity(cueLeft),
		cueRect: rect(cue),
		cueLeftRect: rect(cueLeft),
		cueInk: cueStops.length === 4 ? round(cueStops[3] - cueStops[0]) : null,
		cueCore: cueStops.length === 4 ? round(cueStops[2] - cueStops[1]) : null,
		handle: rect(handle),
		handleLeft: rect(handleLeft),
		markInBand: (() => {
			if (!cue || !handle) return null;
			const r = cue.getBoundingClientRect();
			const el = document.elementFromPoint(
				r.left + r.width / 2,
				r.top + r.height / 2,
			);
			if (!el) return null;
			return el.closest("[data-lo-chat-measure-handle]") ? "band" : el.tagName;
		})(),
		insideEdgeHit: (() => {
			if (!content || !handle) return null;
			const r = content.getBoundingClientRect();
			const el = document.elementFromPoint(r.right - 6, r.top + 40);
			if (!el) return null;
			return el.closest("[data-lo-chat-measure-handle]") ? "band" : el.tagName;
		})(),
	};
})()`;

const launch = async (profileDir) => {
	const chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${profileDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(timer);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
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
	return { cdp, chrome };
};

const closeChrome = async (cdp, chrome) => {
	try {
		/*
		 * RACED, NOT AWAITED. Chrome usually drops the debugging socket as it goes
		 * down, so the reply to `Browser.close` may never arrive - and a promise that
		 * never settles in `main` is not a failed run but a run that exits 13 with an
		 * "unsettled top-level await" warning and no output at all (measured twice on
		 * this rig, once mid-round). The exit listener below is what actually decides
		 * the browser is gone; this call is only the polite request.
		 */
		await Promise.race([cdp.send("Browser.close"), sleep(2_000)]);
	} catch {
		/* The connection usually drops as the browser goes down with it. */
	}
	await new Promise((resolve) => {
		const timer = setTimeout(() => {
			chrome.kill("SIGKILL");
			resolve();
		}, 6_000);
		chrome.on("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
};

const openStory = async (cdp, origin, theme) => {
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		...VIEWPORT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.navigate", { url: "about:blank" });
	await sleep(120);
	await cdp.send("Page.navigate", {
		url: `${origin}/iframe.html?id=${STORY}&viewMode=story&args=theme:${theme}`,
	});
	for (let i = 0; i < 160; i++) {
		const ready = await cdp.evaluate(`(() => {
			const busy = [...document.querySelectorAll(
				".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
			)].some((el) => el.getBoundingClientRect().height > 0);
			if (busy) return false;
			if (document.fonts.status !== "loaded") return false;
			return !!document.querySelector('[data-lo-chat-measure-handle="right"]');
		})()`);
		if (ready === true) return;
		await sleep(250);
	}
	throw new Error(`${theme}: the story never became measurable`);
};

const shoot = async (cdp, half, frame, theme) => {
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "webp",
		quality: 88,
	});
	const dir = join(OUT, half, frame);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${theme}.webp`);
	writeFileSync(file, Buffer.from(data, "base64"));
	await assertFramePaints(file, theme);
};

const framePath = (half, frame, theme) =>
	join(OUT, half, frame, `${theme}.webp`);

/**
 * The cue's PAINTED extent, read out of the frames themselves.
 *
 * `rest` and `hover-right` are the same tree, the same profile, the same
 * viewport and the same palette, and at the cue's own column the only difference
 * between them is the cue: the column sits in the gutter, outboard of every
 * glyph, so nothing else there changes between the two states. The rows that
 * differ ARE the ink. The window is 3px wide and centred on the cue because the
 * committed webp is lossy and a 2px bar is exactly the width webp's chroma
 * subsampling smears; a wider window would start catching the transcript.
 */
const paintedRows = async (restFile, hoverFile, x) => {
	const read = async (file) => {
		const { data, info } = await sharp(file)
			.raw()
			.toBuffer({ resolveWithObject: true });
		return { data, info };
	};
	const a = await read(restFile);
	const b = await read(hoverFile);
	if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
		return null;
	}
	const channels = a.info.channels;
	const at = (img, px, py) => {
		const o = (py * img.info.width + px) * channels;
		return [img.data[o], img.data[o + 1], img.data[o + 2]];
	};
	let first = null;
	let last = null;
	let rows = 0;
	for (let py = 0; py < a.info.height; py++) {
		let hit = false;
		for (let dx = -1; dx <= 1 && !hit; dx++) {
			const px = x + dx;
			if (px < 0 || px >= a.info.width) continue;
			const p = at(a, px, py);
			const q = at(b, px, py);
			if (
				Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) >
				24
			) {
				hit = true;
			}
		}
		if (hit) {
			if (first === null) first = py;
			last = py;
			rows += 1;
		}
	}
	return first === null
		? { rows: 0, first: null, last: null }
		: { first, last, rows };
};

/**
 * How many pixels a frame changes OUTSIDE the cue's own column.
 *
 * WHY A FRAME READING RATHER THAN THE PROBE (agent round 2's R2-3). The claim these
 * frames carry is about the PICTURE - that a state which is supposed to be the cue
 * alone is not a picture of a panel - and on the base tree the tooltip opens 400ms
 * after the pointer arrives while the cue lights at ~320ms: an ~80ms window. A
 * probe taken BEFORE the capture passes while the capture may land after the panel
 * has opened, and one taken AFTER it fails frames that are clean but old by the
 * encoder's own latency (measured once on this rig, in the light base half).
 * Neither reads the frame. This does: the only thing a panel-free state may change
 * is the cue's 2px column, and a panel changes ~11,000 pixels across a 256x45 box,
 * so the two are three orders of magnitude apart rather than 80ms apart.
 *
 * THE 3000-PIXEL MARGIN IS MEASURED, not guessed: the six panel-free cells of this
 * set read 114-474 changed pixels outside the cue's column on this host, and the
 * largest columns in that scatter (713:5, 306:4, 217:4) are single digits spread
 * down the frame - the encoder's own noise on re-rendered text, which no state
 * change produced. 3000 is ~6x above that floor and ~4x under a panel.
 */
const changedOutside = async (restFile, frameFile, x, margin = 4) => {
	const read = async (file) => {
		const { data, info } = await sharp(file)
			.raw()
			.toBuffer({ resolveWithObject: true });
		return { data, info };
	};
	const a = await read(restFile);
	const b = await read(frameFile);
	if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
		return null;
	}
	const channels = a.info.channels;
	let changed = 0;
	for (let py = 0; py < a.info.height; py++) {
		for (let px = 0; px < a.info.width; px++) {
			if (px >= x - margin && px <= x + margin) continue;
			const o = (py * a.info.width + px) * channels;
			if (
				Math.abs(a.data[o] - b.data[o]) +
					Math.abs(a.data[o + 1] - b.data[o + 1]) +
					Math.abs(a.data[o + 2] - b.data[o + 2]) >
				24
			) {
				changed += 1;
			}
		}
	}
	return changed;
};

/**
 * One half's states, in one browser per palette.
 *
 * ONE SCRATCH PROFILE PER (half, palette): the drag below COMMITS a width, and a
 * profile shared between runs is a store shared between them - the sibling rigs
 * record the defect that produced (the second palette opening at the first one's
 * stored width and reading as a column the cap had stopped binding on). Nothing
 * here tests persistence, so every run starts empty.
 */
const captureHalf = async (half, origin, record) => {
	for (const theme of THEMES) {
		const profile = mkdtempSync(join(tmpdir(), `lo-measure-hover-${half}-`));
		const { cdp, chrome } = await launch(profile);
		/**
		 * Poll the page until an expression is true, then return; throw if it never is.
		 *
		 * WHY NOT A SLEEP. Most states below are transitions (a 200ms intent delay
		 * under a 150ms opacity ease, a panel that mounts on a timer), so a fixed wait
		 * is a bet on how loaded this host is. The house rule is to wait on the event:
		 * the beats this rig still spends a fixed time on (`EARLY_MS`,
		 * `CONTESTED_MS`, `RESTED_MS`) are measuring the DWELL itself, where the beat
		 * IS the subject; everywhere else waits for the thing it is about to photograph.
		 */
		const waitFor = async (expression, label) => {
			for (let i = 0; i < 200; i++) {
				if ((await cdp.evaluate(expression)) === true) return;
				await sleep(10);
			}
			throw new Error(`${half}/${origin}: ${label} never settled`);
		};
		try {
			await openStory(cdp, origin, theme);

			record(half, "rest", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, half, "rest", theme);

			/*
			 * The panel-free hover BOTH trees share, and why it waits for the cue
			 * rather than for a beat. The cue is fully lit at ~320ms (a 200ms intent
			 * delay under a 120ms ease) and the base tree's panel opens at 400ms, so a
			 * fixed beat in between is a picture of a HALF-LIT cue - the frames this
			 * step first committed sat at `opacity 0.956..0.988` and did not reproduce
			 * byte-for-byte between runs, because the shot landed somewhere on the
			 * ease. Waiting for the cue to arrive puts the frame on the state it is a
			 * picture of, with ~80ms of margin under the base tree's dwell.
			 */
			const atRest = await cdp.evaluate(PROBE);
			const litRight = `Number(getComputedStyle(document.querySelector('[data-lo-chat-measure-line="right"]')).opacity) >= 0.999`;
			const litLeft = `Number(getComputedStyle(document.querySelector('[data-lo-chat-measure-line="left"]')).opacity) >= 0.999`;
			await cdp.mouse("mouseMoved", atRest.handleLeft.x, atRest.handleLeft.y);
			await waitFor(litLeft, "the left cue to light");
			/*
			 * SHOT FIRST, THEN READ (agent round 2's R2-3). The panel assertions below are
			 * about the PICTURE, and reading before the capture left a window for a panel to
			 * arrive between the two: the cue lights at ~320ms and the base tree's panel
			 * opens at `TOOLTIP_DELAY_MS` (400), so a slow `shoot` could have committed a
			 * panel-bearing "panel-free" frame while the earlier reading passed. Every
			 * panel-free step is read after its own shot for the same reason.
			 */
			await shoot(cdp, half, "hover-left", theme);
			record(half, "hover-left", theme, await cdp.evaluate(PROBE));

			const arrivedAt = Date.now();
			await cdp.mouse("mouseMoved", atRest.handle.x, atRest.handle.y);
			await waitFor(litRight, "the right cue to light");
			await shoot(cdp, half, "hover-right", theme);
			record(half, "hover-right", theme, await cdp.evaluate(PROBE));

			/*
			 * THE CONTESTED BEAT, as a reading rather than as a frame: at the app's
			 * own tooltip delay the base tree's panel is already parked over the
			 * prose and this branch's has not arrived. No frame - "no panel" and "a
			 * panel two thirds of the way down the column" cannot both be a picture
			 * of one cue column, and the READING is the claim. The beat is measured
			 * from the pointer's arrival at the band, not from the frame above, so a
			 * slower host does not silently move it.
			 */
			const toContested = CONTESTED_MS - (Date.now() - arrivedAt);
			if (toContested > 0) await sleep(toContested);
			record(half, "hover-contested", theme, await cdp.evaluate(PROBE));

			/* Rested past THIS branch's dwell: both trees have opened by now. */
			await sleep(RESTED_MS - CONTESTED_MS);
			record(half, "hover-rested", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, half, "hover-with-panel", theme);

			/*
			 * Mid-gesture, button still held: press, travel DOWN and outward in one
			 * step, shoot, then release. The travel is on both axes because the cue's
			 * core is supposed to follow the hand's Y as well as the column's width.
			 */
			const handY = atRest.handle.y + 90;
			await cdp.mouse("mousePressed", atRest.handle.x, atRest.handle.y, {
				button: "left",
				buttons: 1,
				clickCount: 1,
			});
			await sleep(60);
			await cdp.mouse("mouseMoved", atRest.handle.x + 2000, handY, {
				button: "left",
				buttons: 1,
			});
			await sleep(160);
			record(half, "dragging", theme, {
				...((await cdp.evaluate(PROBE)) ?? {}),
				handY,
			});
			await shoot(cdp, half, "dragging", theme);
			/*
			 * THE RELEASE TRACE (UX round 2's U6), started before the mouseup and read
			 * after it: one sample per animation frame across the release, which is the
			 * only instrument that can see a single-frame intermediate at all. The
			 * assertion below is the invariant the finding names - the mark must not move
			 * between two frames it is LIT for.
			 */
			const pendingTrace = cdp.evaluate(TRACE);
			/*
			 * A beat before the release, so the trace holds the frames BEFORE it as well as
			 * the ones the release produces. Without it the first sample lands ~10ms after
			 * the mouseup, already at `opacity 0.54` - which is past the state the finding is
			 * about, and the assertion below would then be a reading of the fade rather than
			 * of the hand-off (the first cut of this trace did exactly that, on four cells).
			 */
			await sleep(60);
			await cdp.mouse("mouseReleased", atRest.handle.x + 2000, handY, {
				button: "left",
				buttons: 0,
				clickCount: 1,
			});
			const trace = await pendingTrace;
			record(half, "release-trace", theme, { samples: trace });
			await sleep(160);
			record(half, "released", theme, await cdp.evaluate(PROBE));

			/* Double-click on the handle: the reset the panel has been naming. */
			const atCeiling = await cdp.evaluate(PROBE);
			for (const detail of [1, 2]) {
				await cdp.mouse(
					"mousePressed",
					atCeiling.handle.x,
					atCeiling.handle.y,
					{
						button: "left",
						buttons: 1,
						clickCount: detail,
					},
				);
				await cdp.mouse(
					"mouseReleased",
					atCeiling.handle.x,
					atCeiling.handle.y,
					{
						button: "left",
						buttons: 0,
						clickCount: detail,
					},
				);
			}
			await sleep(200);
			/*
			 * Away, then back. A synthetic `mousemove` that lands where the pointer
			 * already is does not fire `mouseenter`, and the hover intent is armed by
			 * `mouseenter` - so the first cut of this rig read "the cue is not lit"
			 * out of its own pointer handling rather than out of the product. The
			 * width may also have moved the handle, hence the re-probe.
			 */
			await cdp.mouse("mouseMoved", 4, 4);
			await sleep(150);
			const resetAt = await cdp.evaluate(PROBE);
			await cdp.mouse("mouseMoved", resetAt.handle.x, resetAt.handle.y);
			await waitFor(litRight, "the cue to light again after the reset");
			await shoot(cdp, half, "after-reset", theme);
			record(half, "after-reset", theme, await cdp.evaluate(PROBE));

			/*
			 * Keyboard focus, which this change deliberately leaves alone: it opens
			 * the panel at once on both trees, because a keyboard reader has no
			 * double-click with which to find the reset.
			 */
			await cdp.mouse("mouseMoved", 4, 4);
			await sleep(EARLY_MS);
			await cdp.evaluate(`(() => {
				const handle = document.querySelector('[data-lo-chat-measure-handle="right"]');
				if (handle) handle.focus();
				return document.activeElement === handle;
			})()`);
			await waitFor(litRight, "the cue to light under focus");
			await shoot(cdp, half, "keyboard-focus", theme);
			record(half, "keyboard-focus", theme, await cdp.evaluate(PROBE));

			/*
			 * THE TALL-CONTENT STATE - the cell round 1's blocker was found in, and the
			 * one this pair could not show (design D1-2, and the reading both the design
			 * round and the UX round had to leave the committed frames to make).
			 *
			 * The story's own pane never scrolls (`clientHeight == scrollHeight`), so the
			 * column's middle and the visible middle are the same point and a cue
			 * resting on either reads identically; the reviewers grew real content past a
			 * pinned pane to tell them apart. The fix has to be photographed in THAT
			 * state or the pair only ever shows the case that cannot fail.
			 *
			 * The clone is the story's own rendered prose (real markup, not a fixture)
			 * and the scroller is clipped to 240px - the sibling `chat-measure-line`
			 * rig's method, for the same reason. `tall-rest` is the diff reference for
			 * `tall-hover` (same layout, cue at `opacity: 0`), so the ink reading stays a
			 * pixel reading over committed frames rather than arithmetic on the gradient.
			 *
			 * TWO STATES ARE PARKED FIRST, and that is not tidiness. The step above is
			 * `keyboard-focus`, which leaves the separator FOCUSED and the cue LIT -
			 * `hovering` is set by focus and only `onBlur` clears it - so the first cut
			 * of this step photographed a reference frame with the cue already showing and
			 * the diff came back empty on one tree and panel-contaminated on the other.
			 * Drop the focus, take the pointer off the band, and WAIT for the cue to
			 * actually go dark: a fixed sleep here would be a race against a transition,
			 * which is what the repo's own rule about waiting on the event is about.
			 */
			await cdp.evaluate(
				"document.activeElement instanceof HTMLElement && document.activeElement.blur()",
			);
			await cdp.mouse("mouseMoved", 4, 4);
			await waitFor(
				`Number(getComputedStyle(document.querySelector('[data-lo-chat-measure-line="right"]')).opacity) === 0`,
				"the cue to go dark once focus and the pointer are both off it",
			);
			await cdp.evaluate(`(() => {
				const content = document.querySelector("[data-lo-transcript-content]");
				const block = content && content.querySelector(".lo-markdown");
				if (!block) return 0;
				const parent = block.parentElement;
				for (let i = 0; i < 12; i++) {
					const clone = block.cloneNode(true);
					clone.setAttribute("data-probe-clone", String(i));
					parent.appendChild(clone);
				}
				const scroller = document.querySelector("[data-lo-canonical-transcript]");
				scroller.style.height = "240px";
				scroller.style.maxHeight = "240px";
				scroller.style.flex = "none";
				return document.querySelectorAll("[data-probe-clone]").length;
			})()`);
			await sleep(600);
			const tall = await cdp.evaluate(PROBE);
			record(half, "tall-rest", theme, tall);
			await shoot(cdp, half, "tall-rest", theme);
			await cdp.mouse(
				"mouseMoved",
				tall.handle.x,
				(tall.pane.top + tall.pane.bottom) / 2,
			);
			await waitFor(
				`Number(getComputedStyle(document.querySelector('[data-lo-chat-measure-line="right"]')).opacity) >= 0.99`,
				"the cue to light on the tall pane",
			);
			await shoot(cdp, half, "tall-hover", theme);
			record(half, "tall-hover", theme, await cdp.evaluate(PROBE));

			/*
			 * THE EDGE-ENTRY CELL (design round 2's D2-1), the cell that shows the seat clamp
			 * doing something. Entering the gutter 6px below the pane's top is ordinary use -
			 * it is the edge beside the first message - and it painted 80 of the mark's 160
			 * rows, "a bar sliced off at the pane's boundary with no upper fade". The seat is
			 * held `CUE_BAR_PX / 2` clear of the band now, so the whole mark reads.
			 * `tall-rest` is the diff reference, the same layout with the cue dark.
			 */
			await cdp.mouse("mouseMoved", 4, 4);
			await waitFor(
				`Number(getComputedStyle(document.querySelector('[data-lo-chat-measure-line="right"]')).opacity) === 0`,
				"the cue to go dark before the edge entry",
			);
			await cdp.mouse("mouseMoved", tall.handle.x, tall.pane.top + 6);
			await waitFor(litRight, "the cue to light at the pane's top edge");
			await shoot(cdp, half, "top-entry", theme);
			record(half, "top-entry", theme, await cdp.evaluate(PROBE));

			/*
			 * THE DRAG-OUT CELL (agent round 2's R2-5), which is the choice R2-5 asked to be
			 * made explicit: the publication is held inside the VISIBLE band as well as
			 * inside the element, so a hand that leaves the pane mid-gesture leaves the mark
			 * on the pane's edge rather than behind its clip. The travel is VERTICAL only, so
			 * the gesture previews and commits the width it started with and this frame is
			 * the same layout as `tall-rest` - the diff is the mark's ink and nothing else.
			 */
			const gripY = (tall.pane.top + tall.pane.bottom) / 2;
			await cdp.mouse("mousePressed", tall.handle.x, gripY, {
				button: "left",
				buttons: 1,
				clickCount: 1,
			});
			const outY = Math.round(tall.pane.top - 120);
			await cdp.mouse("mouseMoved", tall.handle.x, outY, {
				button: "left",
				buttons: 1,
			});
			await sleep(160);
			await shoot(cdp, half, "drag-out", theme);
			record(half, "drag-out", theme, {
				...((await cdp.evaluate(PROBE)) ?? {}),
				handY: outY,
			});
			await cdp.mouse("mouseReleased", tall.handle.x, outY, {
				button: "left",
				buttons: 0,
				clickCount: 1,
			});
			await sleep(200);
		} finally {
			await closeChrome(cdp, chrome);
			rmSync(profile, {
				// `maxRetries` because Chrome's teardown can still hold the directory
				// for a moment after `exit`; the sibling rigs state the same reason.
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
		}
	}
};

const main = async () => {
	const results = [];
	const record = (half, step, theme, value) => {
		results.push({ half, step, theme, ...value });
	};

	await captureHalf("before", BEFORE, record);
	await captureHalf("after", AFTER, record);

	const failures = [];
	const by = (half, step, theme) => {
		const hit = results.find(
			(r) => r.half === half && r.step === step && r.theme === theme,
		);
		if (!hit) throw new Error(`no reading for ${half}/${step} @ ${theme}`);
		return hit;
	};
	const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
	const fail = (message) => failures.push(message);

	/*
	 * The frames' own reading of the cue's ink, computed once per (half, palette)
	 * from the committed files rather than from a second capture, so the numbers
	 * below describe the artifacts a reader opens.
	 */
	const painted = {};
	for (const theme of THEMES) {
		for (const half of ["before", "after"]) {
			const rest = by(half, "rest", theme);
			painted[`${half}/${theme}`] = await paintedRows(
				framePath(half, "rest", theme),
				framePath(half, "hover-right", theme),
				Math.round(rest.cueRect?.x ?? 0),
			);
			/*
			 * And the same reading in the TALL-content state, where the cue's own
			 * column extends far past the pane. Its two frames are one layout with the
			 * cue lit and unlit, so the diff is the cue and nothing else - which is what
			 * makes this the reading that catches round 1's blocker.
			 */
			const tallRest = by(half, "tall-rest", theme);
			painted[`tall/${half}/${theme}`] = await paintedRows(
				framePath(half, "tall-rest", theme),
				framePath(half, "tall-hover", theme),
				Math.round(tallRest.cueRect?.x ?? 0),
			);
			/*
			 * The two ROUND-2 cells, both diffed against `tall-rest` for the same reason: one
			 * layout, cue lit against cue dark. `edge` is the entry the seat clamp is about
			 * (design D2-1) and `out` is the drag that leaves the pane (agent R2-5).
			 */
			for (const [key, step] of [
				["edge", "top-entry"],
				["out", "drag-out"],
			])
				painted[`${key}/${half}/${theme}`] = await paintedRows(
					framePath(half, "tall-rest", theme),
					framePath(half, step, theme),
					Math.round(tallRest.cueRect?.x ?? 0),
				);
		}
	}

	for (const theme of THEMES) {
		for (const half of ["before", "after"]) {
			const rest = by(half, "rest", theme);
			const hoverLeft = by(half, "hover-left", theme);
			const hoverRight = by(half, "hover-right", theme);
			const contested = by(half, "hover-contested", theme);
			const rested = by(half, "hover-rested", theme);
			const dragging = by(half, "dragging", theme);
			const reset = by(half, "after-reset", theme);
			const focus = by(half, "keyboard-focus", theme);
			const released = by(half, "released", theme);
			const releaseTrace = by(half, "release-trace", theme)?.samples ?? [];
			const tallHover = by(half, "tall-hover", theme);
			const ink = painted[`${half}/${theme}`];
			const tallInk = painted[`tall/${half}/${theme}`];

			/* 1. Rest: nothing drawn, nothing opened. */
			if (Number(rest.cueOpacity) !== 0)
				fail(
					`${half}/${theme}: the cue is visible at rest (${rest.cueOpacity})`,
				);
			if (Number(rest.cueLeftOpacity) !== 0)
				fail(
					`${half}/${theme}: the LEFT cue is visible at rest (${rest.cueLeftOpacity})`,
				);
			if (rest.panel) fail(`${half}/${theme}: a panel is open at rest`);

			/* 2. Hover, per edge - the cue and nothing else. */
			if (!(Number(hoverRight.cueOpacity) > 0))
				fail(
					`${half}/${theme}: the right cue did not appear on hover (${hoverRight.cueOpacity})`,
				);
			/*
			 * FULLY lit, not merely present: the step waits for the cue before it
			 * photographs, so a half-lit frame (the first version of this rig's frames sat
			 * at `opacity 0.956..0.988` and did not reproduce byte-for-byte) is a failure
			 * here rather than a silent one.
			 */
			for (const [step, lit, edge] of [
				["hover-right", hoverRight.cueOpacity, "right"],
				["hover-left", hoverLeft.cueLeftOpacity, "left"],
				["after-reset", reset.cueOpacity, "right"],
				["keyboard-focus", focus.cueOpacity, "right"],
			])
				if (Number(lit) < 0.999)
					fail(
						`${half}/${theme}: at ${step} the ${edge} cue is only ${lit} lit - the frame is a picture of the ease, not of the state`,
					);
			if (Number(hoverRight.cueLeftOpacity) !== 0)
				fail(`${half}/${theme}: hovering the right edge lit the LEFT cue too`);
			if (Number(hoverLeft.cueOpacity) !== 0)
				fail(`${half}/${theme}: hovering the left edge lit the RIGHT cue too`);
			/*
			 * AND THE FRAME IS A PICTURE OF THE CUE ALONE (agent round 2's R2-3, which asked
			 * for the panel reading to describe the frame rather than a moment before it).
			 * Read off the pixels: the cue's own column is the only place these states may
			 * differ from their reference. A panel would put ~11,000 changed pixels where
			 * the margin below allows 60.
			 */
			for (const [step, x] of [
				["hover-right", hoverRight.cueRect?.x],
				["hover-left", hoverLeft.cueLeftRect?.x],
				["after-reset", reset.cueRect?.x],
			]) {
				const outside = await changedOutside(
					framePath(half, "rest", theme),
					framePath(half, step, theme),
					Math.round(x ?? 0),
				);
				if (outside !== null && outside > 3000)
					fail(
						`${half}/${theme}: ${step} changes ${outside} pixels outside the cue's column - the frame is not a picture of the cue alone`,
					);
			}

			/*
			 * 3. THE CONTESTED BEAT. On the base tree the app's 400ms tooltip beat
			 * has put the panel over the prose; on this branch the dwell has not
			 * elapsed and the gutter is still a cursor. This single pair of readings
			 * is the operator's complaint and the fix, side by side.
			 */
			if (half === "before" && !contested.panel)
				fail(
					`${half}/${theme}: the base tree had no panel at ${CONTESTED_MS}ms - the reading this pass exists to make`,
				);
			if (half === "after" && contested.panel)
				fail(
					`${half}/${theme}: a panel is already open at ${CONTESTED_MS}ms, inside the dwell`,
				);

			/* 4. Rested: both trees have opened, and the panel is inside the pane. */
			if (!rested.panel)
				fail(`${half}/${theme}: no panel after ${RESTED_MS}ms of resting`);
			if (
				rested.panel &&
				rested.pane &&
				(rested.panel.top < rested.pane.top - 1 ||
					rested.panel.bottom > rested.pane.bottom + 1)
			)
				fail(
					`${half}/${theme}: the rested panel ${rested.panel.top}..${rested.panel.bottom} is outside the pane ${rested.pane.top}..${rested.pane.bottom}`,
				);

			/* 5. Dragging: lit, and on this branch the core is at the hand. */
			if (!(Number(dragging.cueOpacity) > 0))
				fail(
					`${half}/${theme}: the cue did not stay lit while dragging (${dragging.cueOpacity})`,
				);
			if (half === "after") {
				const published = Number.parseFloat(String(dragging.cueVar));
				if (!Number.isFinite(published))
					fail(
						`${half}/${theme}: the drag published no cue Y (--lo-chat-measure-cue-y = ${JSON.stringify(dragging.cueVar)})`,
					);
				else {
					const expected = dragging.handY - (dragging.content?.top ?? 0);
					if (!near(published, expected, 2))
						fail(
							`${half}/${theme}: the core is at ${published}px but the hand is at ${Math.round(expected)}px`,
						);
				}
			}

			/*
			 * 5b. THE RELEASE LETS GO OF ITS PUBLICATION (agent round 2's R2-2). The set's
			 * README claimed this run asserted it and nothing read the step: the gesture's
			 * seat is a value for the LENGTH of the gesture, and a mark left on it after the
			 * hand has gone reports a hand that is not there. The step is read 160ms after
			 * the mouseup - past the `duration-fast` fade - so this also reads that the mark
			 * is dark again rather than merely unseated.
			 */
			if (released.cueVar !== "")
				fail(
					`${half}/${theme}: the release left the gesture's seat published (--lo-chat-measure-cue-y = ${JSON.stringify(released.cueVar)})`,
				);
			if (Number(released.cueOpacity) !== 0)
				fail(
					`${half}/${theme}: the cue is still ${released.cueOpacity} lit a fade after the release`,
				);
			/*
			 * AND IT DOES NOT MOVE WHILE IT IS LIT (UX round 2's U6). The release used to hand
			 * the seat back to the ENTRY Y, and on a drag that travelled that is a different
			 * Y: one frame fully lit at a seat the hand had left, the next frame back at the
			 * hand's (measured by the UX round at 60fps as core 282 -> 112 -> 282). A seat
			 * change under a fade is fine; a seat change between two frames above 0.9 is not.
			 * This half only: the base tree's cue is a solid rule with no gradient to read a
			 * centre from.
			 */
			if (half === "after") {
				let previous = null;
				let witnessed = 0;
				for (const sample of releaseTrace) {
					if (sample.centre === null) continue;
					witnessed += 1;
					if (
						previous &&
						previous.op >= 0.9 &&
						sample.op >= 0.9 &&
						Math.abs(sample.centre - previous.centre) > 2
					)
						fail(
							`${half}/${theme}: the mark moves ${Math.round(Math.abs(sample.centre - previous.centre))}px between two frames it is lit for (${Math.round(previous.centre)} -> ${Math.round(sample.centre)} at opacity ${sample.op.toFixed(3)})`,
						);
					previous = sample;
				}
				if (witnessed < 10)
					fail(
						`${half}/${theme}: the release trace read only ${witnessed} frames - it did not cover the release`,
					);
				/*
				 * And it has to have seen the mark LIT, or the invariant above was never tested:
				 * a trace that opens on the fade cannot tell a hand-off from a seat that was
				 * already there.
				 */
				if (!releaseTrace.some((sample) => sample.op >= 0.99))
					fail(
						`${half}/${theme}: the release trace never sampled the mark lit - it cannot speak for the hand-off`,
					);
			}

			/*
			 * 6. After the reset. The pointer is back on the handle, so the cue is lit
			 * again - that is the state the frame is a picture of. The claim here is the
			 * WIDTH: a gesture that ended anywhere on the column is undone by the
			 * reset, which is the only thing that makes the shipped measure reachable
			 * once a drag has stored one.
			 */
			if (!(Number(reset.cueOpacity) > 0))
				fail(
					`${half}/${theme}: the cue is not lit with the pointer back on it`,
				);
			/* The panel reading is recorded, not asserted: it is taken after the shot, so
			 * on the base half it can see the tree's own 400ms tooltip. What is asserted
			 * about that frame is its pixels, in the block above. */
			if (reset.maxWidth !== rest.maxWidth)
				fail(
					`${half}/${theme}: the reset left the column at ${reset.maxWidth}, not the shipped ${rest.maxWidth}`,
				);

			/* 7. Keyboard focus: the panel and the cue, on BOTH trees. */
			if (!focus.activeIsSeparator)
				fail(`${half}/${theme}: the separator did not take focus`);
			if (!focus.panel)
				fail(
					`${half}/${theme}: focus did not open the panel - the keyboard channel this change keeps instant`,
				);
			if (!(Number(focus.cueOpacity) > 0))
				fail(`${half}/${theme}: the cue is not lit under focus`);

			/* 8. The band and the mark, which this change must not have moved. */
			if (rest.markInBand !== "band")
				fail(
					`${half}/${theme}: a press on the drawn cue reaches ${rest.markInBand}, not the band`,
				);
			if (rest.insideEdgeHit === "band")
				fail(
					`${half}/${theme}: a press 6px INSIDE the text edge reaches the band - the target has crossed into the column`,
				);
			if (!near(rest.handle.left - rest.content.right, 0, 1))
				fail(
					`${half}/${theme}: the band's inner edge is ${Math.round((rest.handle.left - rest.content.right) * 10) / 10}px out from the column's edge, not on it`,
				);

			/*
			 * 10. THE TALL-CONTENT STATE - round 1's blocker, as a reading.
			 *
			 * The pane is clipped to 240px and the column grown past it, which is the
			 * ordinary shape of a real conversation and the one this story cannot show.
			 * Whatever the cue is, it has to be where the reader can see it: the base
			 * half's rule covers the pane by construction, and this head's bar must be
			 * INSIDE it. The first cut of this change failed this reading - the bar
			 * painted at the column's middle, hundreds of pixels above the pane, while
			 * `opacity` read 1 (design D1-1, UX U1).
			 *
			 * It sits here, before the per-half geometry split below, because BOTH halves
			 * have a claim to make in this state and the `continue` in that split would
			 * otherwise skip the base half's.
			 */
			if (tallInk && tallInk.rows === 0)
				fail(
					`${half}/${theme}: the cue paints NOTHING on tall content - the pane is clipped and the column is not`,
				);
			else if (!tallHover.pane)
				fail(`${half}/${theme}: no pane to read the tall-state ink against`);
			else if (half === "before") {
				/*
				 * The retired rule IS the column, so it fills the pane - bounded by the
				 * COLUMN's visible box rather than by the scroller's own, which is why the
				 * bar under it reads `2..223` against a pane of `0..240`: the scroller's
				 * box keeps its padding below the content, and the rule stops with the
				 * column. `pane.h * 0.8` states "this is the rule" without pretending the
				 * two boxes are the same, and a bar (62% of this pane) cannot satisfy it.
				 */
				if (tallInk.rows < tallHover.pane.h * 0.8)
					fail(
						`${half}/${theme}: the rule paints only ${tallInk.rows} rows of the ${Math.round(tallHover.pane.h)}px pane - it is the column's rule and should fill it`,
					);
			} else if (
				tallInk.first < tallHover.pane.top - 1 ||
				tallInk.last > tallHover.pane.bottom + 1
			)
				fail(
					`${half}/${theme}: on tall content the cue paints at ${tallInk.first}..${tallInk.last}, outside the pane ${Math.round(tallHover.pane.top)}..${Math.round(tallHover.pane.bottom)} - the resting seat is not the pane's`,
				);

			/*
			 * 11. THE EDGE ENTRY AND THE DRAG THAT LEAVES THE PANE - round 2's two new
			 * cells, both read off the frames rather than off arithmetic.
			 *
			 * The edge entry is the reading design D2-1 asked for: a reader who enters the
			 * gutter 6px below the pane's top gets the whole mark, because the seat is held
			 * `CUE_BAR_PX / 2` clear of the band. The base half's rule fills the pane there
			 * and always did, so only this head's has a claim about the mark's LENGTH.
			 *
			 * The drag-out is the R2-5 clamp, and its failure mode is the one the assertion
			 * names: the hand is 120px ABOVE the pane, so an unheld publication paints
			 * nothing at all - the mark sits behind the clip while `dragging` reads 1.
			 */
			{
				const edgeInk = painted[`edge/${half}/${theme}`];
				const outInk = painted[`out/${half}/${theme}`];
				const topEntry = by(half, "top-entry", theme);
				const dragOut = by(half, "drag-out", theme);
				if (edgeInk && topEntry.pane) {
					if (
						edgeInk.first < topEntry.pane.top - 1 ||
						edgeInk.last > topEntry.pane.bottom + 1
					)
						fail(
							`${half}/${theme}: the edge entry paints at ${edgeInk.first}..${edgeInk.last}, outside the pane ${Math.round(topEntry.pane.top)}..${Math.round(topEntry.pane.bottom)}`,
						);
					else if (half === "after" && edgeInk.rows < tallInk.rows - 16)
						fail(
							`${half}/${theme}: the edge entry paints ${edgeInk.rows} rows against the mark's own ${tallInk.rows} - the seat is not being held clear of the pane's edge`,
						);
				}
				if (half === "after") {
					if (!(Number(dragOut.cueOpacity) > 0))
						fail(
							`${half}/${theme}: the drag-out frame is not a drag (opacity ${dragOut.cueOpacity})`,
						);
					if (outInk && dragOut.pane) {
						if (outInk.rows === 0)
							fail(
								`${half}/${theme}: the drag paints NOTHING with the hand outside the pane - the mark is behind the clip`,
							);
						else if (
							outInk.first < dragOut.pane.top - 1 ||
							outInk.last > dragOut.pane.bottom + 1
						)
							fail(
								`${half}/${theme}: the drag paints at ${outInk.first}..${outInk.last}, outside the pane ${Math.round(dragOut.pane.top)}..${Math.round(dragOut.pane.bottom)}`,
							);
					}
				}
			}

			/*
			 * 9. THE CUE'S OWN GEOMETRY, per half - the half of the pair that IS the
			 * change.
			 *
			 * The base tree's cue is the full-height rule: its element's height IS
			 * its ink, and it is the column's height. This branch's cue is the same
			 * full-height ELEMENT carrying a short gradient - so the assertion is not
			 * "the cue is short" (its box is not) but "the ink is a fraction of the
			 * column, and the frames agree with the paint".
			 */
			if (!rest.cueRect)
				fail(`${half}/${theme}: no cue element on the right edge`);
			if (rest.cueRect && rest.cueRect.w !== 2)
				fail(`${half}/${theme}: the cue is ${rest.cueRect.w}px wide, not 2`);
			if (rest.cueRect && !near(rest.cueRect.h, rest.content.h, 1.5))
				fail(
					`${half}/${theme}: the cue element is ${rest.cueRect.h}px of the column's ${rest.content.h}px - the element must stay the full height so the attribute, the placement and the band keep one frame`,
				);

			if (half === "before") {
				if (rest.cueInk !== null)
					fail(
						`${half}/${theme}: the base tree's cue carries a gradient (ink ${rest.cueInk}) - it is the full-height rule`,
					);
				if (ink && !near(ink.rows, rest.cueRect.h, 6))
					fail(
						`${half}/${theme}: the rule's painted rows (${ink.rows}) do not match its element's height (${rest.cueRect.h})`,
					);
				continue;
			}

			if (rest.cueInk === null)
				fail(`${half}/${theme}: this branch's cue painted no gradient stops`);
			else {
				if (!(rest.cueInk > 0 && rest.cueInk < rest.content.h * 0.6))
					fail(
						`${half}/${theme}: the cue's ink is ${rest.cueInk}px of the column's ${rest.content.h}px - that is a rule, not a bar`,
					);
				if (!(rest.cueCore > 0 && rest.cueCore < rest.cueInk))
					fail(
						`${half}/${theme}: the core (${rest.cueCore}px) is not inside the ink (${rest.cueInk}px)`,
					);
				/*
				 * The texture does not change with the state: hover and drag move the SEAT,
				 * not the bar. Read off the gradient in each state - the frame diff can only
				 * be taken where the layout holds still, and these two states are the ones
				 * where a `calc()` folding to a single length used to make the reading
				 * `null`.
				 */
				for (const [step, reading] of [
					["hover-right", hoverRight],
					["dragging", dragging],
				])
					if (
						reading.cueInk !== rest.cueInk ||
						reading.cueCore !== rest.cueCore
					)
						fail(
							`${half}/${theme}: at ${step} the cue reads ink ${reading.cueInk} / core ${reading.cueCore}, not ${rest.cueInk} / ${rest.cueCore} - the texture must not change with the seat`,
						);
				/*
				 * The frame's own reading, against the paint's declaration. The outermost
				 * stops are `transparent`, so the last row that DIFFERS from the rest
				 * frame sits INSIDE the declared span; the tolerance is that soft edge
				 * plus what the committed webp's compression does to a 2px bar, and it is
				 * stated once here rather than tuned per palette.
				 */
				if (ink && !(ink.rows <= rest.cueInk && ink.rows >= rest.cueInk - 14))
					fail(
						`${half}/${theme}: the frame paints ${ink.rows} rows of cue against a declared ${rest.cueInk}px - outside the fade's own soft edge`,
					);
				/*
				 * WHERE THE RESTING BAR SITS. NOT the element's middle: the seat is the
				 * one the panel anchors to, which on the pointer's path is the hand's own
				 * Y. Round 1's blocker was exactly this arithmetic done against the wrong
				 * box (`50%` of a column taller than the pane is off-screen), and the
				 * frames' own centre is the reading that says so - not the CSS string.
				 * Read off the frame, so a hover frame taken while a stale publication was
				 * still set could not pass.
				 */
				if (ink && ink.first !== null) {
					const inkCentre = (ink.first + ink.last) / 2;
					if (!near(inkCentre, rest.handle.y, 8))
						fail(
							`${half}/${theme}: the resting ink is centred at ${Math.round(inkCentre)} but the hand is at ${rest.handle.y} - the bar does not rest on the panel's own seat`,
						);
				}
			}
		}
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ results, painted, failures }, null, 2));
	} else {
		for (const failure of failures) console.log(`FAIL ${failure}`);
		console.log(
			`\n${results.length} readings, ${failures.length} failures, ${Object.keys(painted).length} frame-diff readings`,
		);
		for (const [key, value] of Object.entries(painted)) {
			console.log(`  ink ${key}: ${value ? `${value.rows} rows` : "n/a"}`);
		}
	}
	if (failures.length > 0) process.exit(1);
};

await main();
