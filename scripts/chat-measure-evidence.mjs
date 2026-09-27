#!/usr/bin/env node
/**
 * Photographs and measures the chat column's shared measure.
 *
 *     node scripts/chat-measure-evidence.mjs [storybook-origin] [--json]
 *
 * Why a purpose-built rig rather than `capture-evidence.mjs --only=...`. The
 * claim this set has to carry is a NUMBER, and half of it cannot be swept at
 * all: a frame of the previous value (900px) is not a frame of the tree at any
 * later head, so it cannot be re-taken by a sweep that reads the current
 * stylesheet. The pair is only a controlled comparison if both halves are taken
 * by the same rig, at the same viewport, from the same records, in the same run
 * - which is what this file is. The frames it writes are declared as a
 * `supplementary` set in `docs/evidence/manifest.json` for that reason, beside
 * the other sets a sweep cannot produce.
 *
 * Raw CDP against a private headless Chrome, the same approach and the same
 * launch discipline as `chat-alignment-geometry.mjs` and `capture-evidence.mjs`
 * (fresh user-data-dir, the mock-keychain switch, killed on exit). The Chrome
 * driver is duplicated rather than imported for the reason that file records:
 * threading a "measure as well as shoot" mode through the sweep's loop would
 * complicate the one script in this repo that must stay boring.
 *
 * Every frame is asserted to have painted (`assertFramePaints`, the same guard
 * the sweep uses) before it is written, so a story that mounted and then sat on
 * a loader cannot be filed as a picture of the app.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence", "chat-measure");
const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The frames this set carries, and what each one is for.
 *
 * `width`/`height` are the VIEWPORT. The stories draw their own pane inside it
 * at a fixed 1024px (`chat-measure.stories.tsx`), which is wider than the 868px
 * an 820px cap needs to bind AND wider than the 948 an 900px cap needs - so both
 * halves of the pair are at their cap in the same frame, and the difference
 * between them is the number rather than the pane.
 *
 * `narrow-pane` is the control, and it is the pair that answers "does the change
 * fight the responsive step". At a 700px pane the content box is 652px, so
 * neither cap can bind: the two frames must be IDENTICAL, and the run asserts
 * that numerically rather than leaving it to the eye. If they ever differ, the
 * 750px gate has started to bind, which is the one way this change could narrow
 * a column that has no room to spare.
 *
 * `composer-row` is the regression surface the measure is SHARED with: the
 * composer's readings row decides whether to sit inline from a container
 * (pane-width) threshold, and narrowing the content inside that row by 80px is
 * exactly the kind of change that moves a row from one line to two. Its frames
 * are the check, and the run prints the row's geometry beside them.
 */
const CASES = [
	{
		frame: "transcript-at-820",
		story: "chat-measure--transcript",
		width: 1024,
		height: 620,
	},
	{
		frame: "transcript-at-900",
		story: "chat-measure--previous-measure",
		width: 1024,
		height: 620,
	},
	{
		frame: "narrow-pane-at-820",
		story: "chat-measure--narrow-pane",
		width: 760,
		height: 520,
	},
	{
		frame: "narrow-pane-at-900",
		story: "chat-measure--narrow-pane-previous-measure",
		width: 760,
		height: 520,
	},
	/*
	 * The composer's readings row in the shipped measure's own story frame (a
	 * 900px container), with the measure forced to the previous value for its
	 * other half. Forcing the property is legitimate here and is the only place
	 * this rig does it: the subject is the ROW's own composition under two
	 * measures, not the mechanism that sets the property, and that mechanism has
	 * its own frames one branch over.
	 */
	{
		frame: "composer-row-at-820",
		story: "chat-composer-status-row--states",
		ready: '[class*="@container/chatcol"]',
		width: 996,
		height: 900,
		measure: 820,
		themes: ["localOperatorDark", "localOperatorLight"],
	},
	{
		frame: "composer-row-at-900",
		story: "chat-composer-status-row--states",
		ready: '[class*="@container/chatcol"]',
		width: 996,
		height: 900,
		measure: 900,
		themes: ["localOperatorDark", "localOperatorLight"],
	},
];

const THEMES = ["localOperatorDark", "localOperatorLight"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Hoisted rather than inline in the launch promise: a regex literal rebuilt on
   every data event is the shape the scripts lint refuses, and the pattern does
   not change between events. */
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

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
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}

let chrome = null;
let dataDir = null;

const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
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

/**
 * The reading, taken in the page.
 *
 * `charsPerLine` is the length of the rendered paragraph divided by the number
 * of line boxes it occupies - an AVERAGE over the whole sample, which is the
 * form `markdown.css` already quotes and the only form that is comparable
 * between two widths without bisecting every line with a Range. The line count
 * is the number of `Range.getClientRects()` boxes, which is one per line box for
 * a paragraph that is a single text node, and the probe also reports the two
 * per-line extremes it can see (the narrowest and widest line box) so a reader
 * can tell a sample that wraps evenly from one that does not.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: round(r.left), right: round(r.right), width: round(r.width), top: round(r.top), height: round(r.height) };
	};
	const scroller = document.querySelector("[data-lo-canonical-transcript]");
	const container = scroller ? scroller.parentElement : null;
	const content = document.querySelector("[data-lo-transcript-content]");
	const prose = content ? content.querySelector(".lo-markdown") : null;
	const para = prose ? prose.querySelector("p") : null;
	let lines = null;
	let lineWidths = null;
	if (para) {
		const range = document.createRange();
		range.selectNodeContents(para);
		const rects = [...range.getClientRects()].filter((r) => r.width > 1);
		lines = rects.length;
		lineWidths = rects.length
			? { narrowest: round(Math.min(...rects.map((r) => r.width))), widest: round(Math.max(...rects.map((r) => r.width))) }
			: null;
	}
	const scrollerBox = box(scroller);
	const contentBox = box(content);
	const contentStyle = content ? getComputedStyle(content) : null;
	/*
	 * The composer's readings row: what the shared measure is shared WITH. The
	 * wrap test is the count of distinct top offsets among the row's direct
	 * children - one row of boxes has one top, two lines have two.
	 */
	/*
	 * The composer's readings row, or - because the row itself carries no
	 * stable attribute - the first child of its own container box, which is the
	 * row in every state the story draws.
	 */
	const statusRow = document.querySelector("[data-lo-composer-status-row]")
		?? document.querySelector('[class*="@container/chatcol"]')?.firstElementChild
		?? null;
	let status = null;
	if (statusRow) {
		const kids = [...statusRow.children].filter((el) => el.getBoundingClientRect().height > 0);
		const tops = new Set(kids.map((el) => Math.round(el.getBoundingClientRect().top)));
		status = {
			height: round(statusRow.getBoundingClientRect().height),
			children: kids.length,
			lines: tops.size,
			box: box(statusRow),
		};
	}
	return {
		container: box(container),
		scroller: scrollerBox,
		content: contentBox,
		contentMaxWidth: contentStyle ? contentStyle.maxWidth : null,
		contentPaddingLeft: contentStyle ? contentStyle.paddingLeft : null,
		/* The measure's own insets, which are what the cap has to sit inside. */
		insetLeft: scrollerBox && contentBox ? round(contentBox.left - scrollerBox.left) : null,
		insetRight: scrollerBox && contentBox ? round(scrollerBox.right - contentBox.right) : null,
		paraChars: para ? para.innerText.length : null,
		lines,
		lineWidths,
		charsPerLine: para && lines ? round(para.innerText.length / lines) : null,
		status,
	};
})()`;

const launch = async () => {
	dataDir = join(tmpdir(), `lo-chat-measure-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
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
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEVTOOLS_URL);
			if (m) {
				clearTimeout(t);
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
	return cdp;
};

const waitForStory = async (cdp, label, READY) => {
	for (let i = 0; i < 160; i++) {
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: `(() => {
				const busy = [...document.querySelectorAll(
					".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader, .sb-show-errordisplay",
				)].some((el) => el.getBoundingClientRect().height > 0);
				if (busy) return false;
				if (document.fonts.status !== "loaded") return false;
				return !!document.querySelector(${JSON.stringify(READY)});
			})()`,
		});
		if (result.value === true) return;
		await sleep(250);
	}
	throw new Error(`${label}: story never became measurable`);
};

const main = async () => {
	const cdp = await launch();
	const results = [];
	for (const entry of CASES) {
		const themes = entry.themes ?? THEMES;
		for (const theme of themes) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width: entry.width,
				height: entry.height,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(120);
			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${entry.story}&viewMode=story&args=theme:${theme}${entry.args ?? ""}`,
			});
			await waitForStory(
				cdp,
				`${entry.frame} @ ${theme}`,
				entry.ready ?? "[data-lo-canonical-transcript]",
			);
			if (entry.measure) {
				await cdp.send("Runtime.evaluate", {
					expression: `document.documentElement.style.setProperty("--lo-chat-measure", "${entry.measure}px")`,
				});
			}
			/* Two paint frames, so the shutter opens on the settled layout. */
			await cdp.send("Runtime.evaluate", {
				awaitPromise: true,
				expression:
					"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			});
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "webp",
				quality: 88,
			});
			const dir = join(OUT, entry.frame);
			mkdirSync(dir, { recursive: true });
			const file = join(dir, `${theme}.webp`);
			writeFileSync(file, Buffer.from(data, "base64"));
			/*
			 * The same paint guard the sweep uses, called with the PATH rather
			 * than the bytes (that is its contract - it reads the frame with its
			 * own decoder), and awaited: a story that mounted and then sat on a
			 * loader passes the DOM checks above and fails this one.
			 */
			await assertFramePaints(file, theme);
			results.push({ ...entry, theme, reading: result.value });
		}
	}

	/*
	 * The control assertion, taken rather than argued: at a 700px pane the two
	 * measures must render the same content box, because neither cap can bind
	 * there. A difference means the 750px gate has started to bind and the
	 * change is narrowing a column that has no room to spare.
	 */
	const narrow = results.filter((r) => r.frame.startsWith("narrow-pane"));
	const widths = new Set(narrow.map((r) => r.reading.content?.width));
	if (narrow.length === 4 && widths.size !== 1) {
		throw new Error(
			`the narrow-pane pair is not equal: content widths ${[...widths].join(", ")}`,
		);
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
		return;
	}
	for (const r of results) {
		const m = r.reading;
		console.log(
			`\n${r.frame}  [${r.theme}]  ${r.story} @ ${r.width}x${r.height}`,
		);
		console.log(
			`  container=${m.container?.width}  scroller=${m.scroller?.width}  content=${m.content?.width}  maxWidth=${m.contentMaxWidth}`,
		);
		console.log(`  insets  left=${m.insetLeft}  right=${m.insetRight}`);
		if (m.lines)
			console.log(
				`  prose   chars=${m.paraChars}  lines=${m.lines}  chars/line=${m.charsPerLine}  lines px ${JSON.stringify(m.lineWidths)}`,
			);
		if (m.status)
			console.log(
				`  composer row  height=${m.status.height}  children=${m.status.children}  lines=${m.status.lines}  width=${m.status.box?.width}`,
			);
	}
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
