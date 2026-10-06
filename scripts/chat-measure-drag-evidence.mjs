#!/usr/bin/env node
/**
 * Drives the conversation column's drag handle with a real pointer, photographs
 * every state it has, and asserts what the reader's preference received.
 *
 *     node scripts/chat-measure-drag-evidence.mjs [storybook-origin] [--json]
 *
 * WHY A RIG AND NOT A SWEEP. Three of the states here are not story states at
 * all: `:hover` is browser state, a button held down is browser state, and
 * "the width came back after a relaunch" is a fact about a profile on disk. The
 * fourth reason is the one that decides the shape of this file: the claim is not
 * only what the column LOOKS like at a width, it is what the store RECEIVED -
 * that a press with no travel commits nothing, that a drag commits the width the
 * hand asked for rather than the one the window allowed, that the bounds hold,
 * and that the value outlives the process. A frame cannot carry any of those, so
 * the assertions and the frames come from the same run.
 *
 * THE RESTART IS A REAL ONE. Two Chrome processes are launched in sequence
 * against ONE `--user-data-dir`, so the second reads the profile the first
 * wrote: a new browser process, a fresh JavaScript context, and the same
 * `localStorage`. It is not a page reload, and the difference matters because a
 * reload keeps the in-memory store and a relaunch does not.
 *
 * Raw CDP against a private headless Chrome, the mock-keychain switch, killed by
 * pid on exit - the same launch discipline as `chat-measure-evidence.mjs` beside
 * it and `capture-evidence.mjs`. Every frame passes `assertFramePaints` before
 * it is written.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence", "chat-measure-drag");
const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const STORY = "chat-measure-drag--transcript";
const VIEWPORT = { width: 1060, height: 620 };
const THEMES = ["localOperatorDark", "localOperatorLight"];

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
 * What the rig reads out of the page, every time.
 *
 * `content` is the shared measure's own box - the thing the handle sizes - and
 * `maxWidth` is the resolved `max-width` on it, which is the CAP rather than the
 * width on screen: those two differ exactly when a window is too narrow to draw
 * the reader's choice, and telling them apart is the whole point of the store
 * assertions.
 *
 * `line`/`lineLeft` are the state line's two edges, read as RECTS rather than as
 * colours: the set's claim is geometric (the line sits ON the measure's edge, and
 * inside the band that grabs), so the rig compares each line's rect against
 * `content`'s and against the band's on the same reading instead of trusting a
 * screenshot to look right.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const content = document.querySelector("[data-lo-transcript-content]");
	const para = content ? content.querySelector(".lo-markdown p") : null;
	const box = content ? content.getBoundingClientRect() : null;
	let lines = null;
	let charsPerLine = null;
	if (para) {
		const range = document.createRange();
		range.selectNodeContents(para);
		const rects = [...range.getClientRects()].filter((r) => r.width > 1);
		lines = rects.length;
		charsPerLine = rects.length
			? round(para.innerText.length / rects.length)
			: null;
	}
	const persisted = (() => {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			try {
				const parsed = JSON.parse(localStorage.getItem(key));
				const value = parsed?.state?.chatMeasureWidth;
				if (value !== undefined) return value;
			} catch {
				/* not a JSON entry: not ours */
			}
		}
		return undefined;
	})();
	const handle = document.querySelector('[data-lo-chat-measure-handle="right"]');
	const line = document.querySelector('[data-lo-chat-measure-line="right"]');
	const lineLeft = document.querySelector('[data-lo-chat-measure-line="left"]');
	const handleLeft = document.querySelector('[data-lo-chat-measure-handle="left"]');
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: round(r.left), right: round(r.right), x: round(r.left + r.width / 2), y: round(r.top + r.height / 2), w: round(r.width), h: round(r.height) };
	};
	return {
		persisted,
		maxWidth: content ? getComputedStyle(content).maxWidth : null,
		width: box ? round(box.width) : null,
		lines,
		charsPerLine,
		overrideVar: getComputedStyle(document.documentElement)
			.getPropertyValue("--lo-chat-measure-override")
			.trim(),
		content: rect(content),
		handle: rect(handle),
		handleLeft: rect(handleLeft),
		line: rect(line),
		lineLeft: rect(lineLeft),
		lineOpacity: line ? getComputedStyle(line).opacity : null,
		lineLeftOpacity: lineLeft ? getComputedStyle(lineLeft).opacity : null,
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

const openStory = async (cdp, theme) => {
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		...VIEWPORT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.navigate", { url: "about:blank" });
	await sleep(120);
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=${STORY}&viewMode=story&args=theme:${theme}`,
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

const shoot = async (cdp, frame, theme) => {
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "webp",
		quality: 88,
	});
	const dir = join(OUT, frame);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${theme}.webp`);
	writeFileSync(file, Buffer.from(data, "base64"));
	await assertFramePaints(file, theme);
};

/**
 * A drag: press on the handle, move in one step, hold, optionally shoot, release.
 *
 * The pointer is moved onto the handle FIRST, without a button, so the hover
 * intent timer has run and the state under the press is the state a reader is
 * in - a press that arrived before the line appeared would be measuring a
 * different gesture.
 */
const drag = async (cdp, { deltaX, shootAt, frame, theme }) => {
	const probe = await cdp.evaluate(PROBE);
	if (!probe.handle) throw new Error(`${theme}: no right handle to drag`);
	const { x, y } = probe.handle;
	await cdp.mouse("mouseMoved", x, y);
	await sleep(450);
	await cdp.mouse("mousePressed", x, y, {
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await sleep(60);
	await cdp.mouse("mouseMoved", x + deltaX, y, { button: "left", buttons: 1 });
	await sleep(120);
	/*
	 * The reading WITH THE BUTTON STILL DOWN, which is the state the drag frame
	 * is a picture of: the store has been written for some runs and not for
	 * others (nothing is committed until the release), so the two readings answer
	 * different questions and are both kept.
	 */
	const during = await cdp.evaluate(PROBE);
	if (shootAt) await shoot(cdp, frame, theme);
	await cdp.mouse("mouseReleased", x + deltaX, y, {
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await sleep(120);
	return { during, after: await cdp.evaluate(PROBE) };
};

/** A press and release with no travel: what a click on the handle is. */
const pressOnly = async (cdp) => {
	const probe = await cdp.evaluate(PROBE);
	const { x, y } = probe.handle;
	await cdp.mouse("mouseMoved", x, y);
	await sleep(450);
	await cdp.mouse("mousePressed", x, y, {
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await cdp.mouse("mouseReleased", x, y, {
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await sleep(120);
	return cdp.evaluate(PROBE);
};

/** The reset gesture: a double-click, which is `onDoubleClick` on the handle. */
const doubleClick = async (cdp) => {
	const probe = await cdp.evaluate(PROBE);
	const { x, y } = probe.handle;
	await cdp.mouse("mouseMoved", x, y);
	await sleep(450);
	await cdp.mouse("mousePressed", x, y, {
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await cdp.mouse("mouseReleased", x, y, {
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
	await cdp.mouse("mousePressed", x, y, {
		button: "left",
		buttons: 1,
		clickCount: 2,
	});
	await cdp.mouse("mouseReleased", x, y, {
		button: "left",
		buttons: 0,
		clickCount: 2,
	});
	await sleep(160);
	return cdp.evaluate(PROBE);
};

/**
 * Close Chrome the way a reader quits an app, and only then force it.
 *
 * `SIGKILL` was measured losing the last write: the relaunch read the width from
 * BEFORE the run's final drag. Chromium's `localStorage` is a batched LevelDB
 * write, so a process killed outright takes the tail of the batch with it - which
 * is exactly the "the preference did not survive the restart" defect this rig
 * exists to be able to see, produced by the rig instead of by the product. The
 * two-step below flushes; the `SIGKILL` is the fallback for a browser that will
 * not close.
 */
const closeChrome = async (cdp, chrome) => {
	try {
		await cdp.send("Browser.close");
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

const main = async () => {
	const profile = mkdtempSync(join(tmpdir(), "lo-measure-drag-"));
	const results = [];
	const record = (step, theme, value) => {
		results.push({ step, theme, ...value });
	};

	try {
		for (const theme of THEMES) {
			/* ---- the first process: every state, and one relaunch's worth of state */
			let { cdp, chrome } = await launch(profile);
			await openStory(cdp, theme);

			record("rest", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, "rest", theme);

			/* Hover: the pointer arrives and does not press. */
			const atRest = await cdp.evaluate(PROBE);
			await cdp.mouse("mouseMoved", atRest.handle.x, atRest.handle.y);
			await sleep(450);
			record("hover", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, "hover", theme);

			/*
			 * The LEFT edge gets the same hover, in the same run and at the same 450ms,
			 * so the pair is a like-for-like reading of one symmetric measure rather
			 * than a right-edge state and a guess about its mirror.
			 */
			const atLeft = await cdp.evaluate(PROBE);
			await cdp.mouse("mouseMoved", atLeft.handleLeft.x, atLeft.handleLeft.y);
			await sleep(450);
			record("hover-left", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, "hover-left", theme);

			/* Outward to the ceiling, photographed with the button still held. */
			const ceiling = await drag(cdp, {
				deltaX: 2000,
				shootAt: true,
				frame: "dragging",
				theme,
			});
			record("dragging", theme, ceiling.during);
			record("at-ceiling", theme, ceiling.after);
			await shoot(cdp, "at-ceiling", theme);

			/* Inward to the floor. */
			const floor = await drag(cdp, { deltaX: -2000 });
			record("at-floor", theme, floor.after);
			await shoot(cdp, "at-floor", theme);

			/* A press with no travel must commit nothing. */
			const pressed = await pressOnly(cdp);
			record("press-only", theme, pressed);

			/* The reset, which is the double-click. */
			const reset = await doubleClick(cdp);
			record("after-reset", theme, reset);
			await shoot(cdp, "after-reset", theme);

			/* A width a reader might actually keep, for the restart to bring back. */
			const kept = await drag(cdp, { deltaX: 60 });
			record("before-restart", theme, kept.after);

			await closeChrome(cdp, chrome);

			/* ---- the second process: one profile, one fresh JavaScript context */
			({ cdp, chrome } = await launch(profile));
			await openStory(cdp, theme);
			record("after-restart", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, "after-restart", theme);
			await doubleClick(cdp);
			await closeChrome(cdp, chrome);
		}
	} finally {
		rmSync(profile, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
	}

	/*
	 * THE ASSERTIONS. Every one of them is a sentence from the brief, turned
	 * into a comparison, and the run fails rather than printing a table nobody
	 * checks.
	 */
	const failures = [];
	const by = (step, theme) => {
		const hit = results.find((r) => r.step === step && r.theme === theme);
		if (!hit) {
			throw new Error(
				`no reading for ${step} @ ${theme}; recorded: ${results
					.map((r) => `${r.step}@${r.theme}`)
					.join(", ")}`,
			);
		}
		return hit;
	};
	for (const theme of THEMES) {
		const rest = by("rest", theme);
		const hover = by("hover", theme);
		const hoverLeft = by("hover-left", theme);
		const dragging = by("dragging", theme);
		const ceiling = by("at-ceiling", theme);
		const floor = by("at-floor", theme);
		const pressed = by("press-only", theme);
		const reset = by("after-reset", theme);
		const kept = by("before-restart", theme);
		const back = by("after-restart", theme);

		const shipped = Number.parseFloat(rest.maxWidth);
		if (!(rest.persisted === null || rest.persisted === undefined))
			failures.push(
				`${theme}: a fresh profile already carries ${rest.persisted}`,
			);
		if (Number(rest.lineOpacity) !== 0)
			failures.push(
				`${theme}: the line is visible at rest (opacity ${rest.lineOpacity})`,
			);
		if (Number(rest.lineLeftOpacity) !== 0)
			failures.push(
				`${theme}: the LEFT line is visible at rest (opacity ${rest.lineLeftOpacity})`,
			);
		if (!(Number(hover.lineOpacity) > 0))
			failures.push(
				`${theme}: the line did not appear on hover (${hover.lineOpacity})`,
			);
		if (!(Number(hoverLeft.lineLeftOpacity) > 0))
			failures.push(
				`${theme}: the LEFT line did not appear on its own hover (${hoverLeft.lineLeftOpacity})`,
			);
		/*
		 * The geometric claim, asked of the reading rather than of the eye: the line
		 * sits just OUTSIDE the measure's edge with its INNER edge ON it, so the
		 * right line's left edge and the left line's right edge agree with the
		 * content column's own edges to within a sub-pixel rounding step. The strip
		 * is still 24..34px out, which is why the line is read from its own box and
		 * not from the handle's.
		 */
		if (rest.line && Math.abs(rest.line.left - rest.content.right) > 1)
			failures.push(
				`${theme}: the right line starts at ${rest.line.left}, the column ends at ${rest.content.right}`,
			);
		if (rest.lineLeft && Math.abs(rest.lineLeft.right - rest.content.left) > 1)
			failures.push(
				`${theme}: the left line ends at ${rest.lineLeft.right}, the column starts at ${rest.content.left}`,
			);
		if (rest.line && rest.line.w !== 2)
			failures.push(`${theme}: the line is ${rest.line.w}px wide, not 2`);
		if (rest.line && Math.abs(rest.line.h - rest.content.h) > 1)
			failures.push(
				`${theme}: the line is ${rest.line.h}px tall, the column ${rest.content.h}`,
			);
		/*
		 * THE BAND HUGS THE MARK (UX round 1's U1). Its inner edge is the column's own
		 * edge - 0px out, not the 24px the offset used to put between the drawn rule
		 * and the only place that responded - and the line sits INSIDE the band, so a
		 * press on the thing that promises adjustability starts the drag the way every
		 * family divider's does.
		 */
		if (rest.handle && Math.abs(rest.handle.left - rest.content.right) > 1)
			failures.push(
				`${theme}: the band's inner edge is ${Math.round((rest.handle.left - rest.content.right) * 10) / 10}px out from the column's edge, not on it`,
			);
		if (
			rest.line &&
			rest.handle &&
			(rest.line.left < rest.handle.left - 1 ||
				rest.line.right > rest.handle.right + 1)
		)
			failures.push(
				`${theme}: the line ${rest.line.left}..${rest.line.right} is not inside the band ${rest.handle.left}..${rest.handle.right}`,
			);
		if (!(Number(dragging.lineOpacity) > 0))
			failures.push(
				`${theme}: the line did not stay lit while dragging (${dragging.lineOpacity})`,
			);
		if (!(ceiling.persisted === 1100))
			failures.push(
				`${theme}: the ceiling drag persisted ${ceiling.persisted}, not 1100`,
			);
		if (Number.parseFloat(ceiling.maxWidth) !== 1100)
			failures.push(
				`${theme}: the ceiling drag left max-width ${ceiling.maxWidth}`,
			);
		if (!(floor.persisted === 520))
			failures.push(
				`${theme}: the floor drag persisted ${floor.persisted}, not 520`,
			);
		/*
		 * The press-with-no-travel case is read against the width that was stored
		 * when it happened (the floor drag's), not against the reset: a press is
		 * not a reset either.
		 */
		if (pressed.persisted !== floor.persisted)
			failures.push(
				`${theme}: a press with no travel changed the stored width (${pressed.persisted} from ${floor.persisted})`,
			);
		if (!(reset.persisted === null || reset.persisted === undefined))
			failures.push(`${theme}: the reset left ${reset.persisted} stored`);
		if (Number.parseFloat(reset.maxWidth) !== shipped)
			failures.push(
				`${theme}: the reset left max-width ${reset.maxWidth}, not the shipped ${shipped}`,
			);
		if (reset.overrideVar !== "")
			failures.push(
				`${theme}: the reset left the property at "${reset.overrideVar}"`,
			);
		if (!(typeof kept.persisted === "number" && kept.persisted > 0))
			failures.push(`${theme}: the kept drag stored nothing`);
		if (back.persisted !== kept.persisted)
			failures.push(
				`${theme}: after a relaunch the store reads ${back.persisted}, the first process wrote ${kept.persisted}`,
			);
		if (Number.parseFloat(back.maxWidth) !== kept.persisted)
			failures.push(
				`${theme}: after a relaunch max-width is ${back.maxWidth}, not the kept ${kept.persisted}`,
			);
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results, failures }, null, 2));
	} else {
		for (const r of results) {
			console.log(
				`${r.step.padEnd(15)} ${r.theme.padEnd(18)} stored=${String(r.persisted)} maxWidth=${r.maxWidth} width=${r.width} lines=${r.lines} chars/line=${r.charsPerLine} line=${r.lineOpacity} lineLeft=${r.lineLeftOpacity}`,
			);
		}
		for (const f of failures) console.log(`FAIL ${f}`);
	}
	if (failures.length) {
		console.error(`${failures.length} assertion(s) failed`);
		process.exit(1);
	}
	console.log(`\nall ${results.length} readings held.`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
