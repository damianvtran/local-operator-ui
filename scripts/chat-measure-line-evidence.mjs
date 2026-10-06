#!/usr/bin/env node
/**
 * The conversation column's resize cue, BEFORE and AFTER, side by side.
 *
 *     node scripts/chat-measure-line-evidence.mjs \
 *       --before http://localhost:6392 --after http://localhost:6391
 *
 * WHY A PAIR AND NOT A SWEEP. The claim this change makes is a COMPARISON, not
 * a state: the cue used to be a 72px bar floating in the transcript's empty
 * margin (issue #848's report - it "reads as a mistake") and is now the same
 * full-height 2px state line the five panel dividers draw, sitting on the
 * measure's real edge. `docs/evidence` is mostly one tree photographed at one
 * head; a before/after pair cannot be, so this rig drives TWO Storybooks in one
 * run - the base tree's and this branch's - through the same pointer, at the
 * same viewport, in the same two palettes, and writes both halves of every
 * state. The base tree is unmodified `origin/main`, so the "before" frames are
 * not a reconstruction: they are the shipped bar.
 *
 * WHAT IT ASSERTS. The frames carry the look; the readings carry the geometry,
 * and the run fails rather than printing a table if any of them is wrong:
 *
 *   - Rest: whichever cue the tree has is at `opacity: 0`, in both palettes.
 *   - Hover, each edge: that edge's cue lights up (and the OTHER edge's does
 *     not - the two handles are one symmetric measure, not one control).
 *   - Dragging: the cue stays lit while the button is down.
 *   - After only: the line is 2px wide, its height is the column's height, and
 *     its INNER edge sits on the column's own edge to within a rounding step.
 *     The strip that carries the pointer is still 24px out from that edge, which
 *     is the geometric reason it cannot swallow a click meant for the text
 *     (design round 1's D2) - read here rather than assumed.
 *   - Before only: the bar is 72px tall and floats ~28px inside the column's
 *     edge, which is exactly the geometry the issue reports as reading wrong.
 *
 * Raw CDP against a private headless Chrome, the mock-keychain switch, one
 * browser per half, killed by pid on exit - the same launch discipline as
 * `chat-measure-drag-evidence.mjs` beside it. Every frame passes
 * `check-evidence.mjs`'s own `assertFramePaints` before it is written.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence", "chat-measure-line");
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
 * The selector for the cue differs by half on purpose - `bar`/`barLeft` are the
 * base tree's 72px mark, `line`/`lineLeft` are this branch's state line - and
 * each is null on the tree that does not have it, which is how one probe reads
 * both and how the assertions below can say WHICH half they are talking about.
 * Rects rather than colours, because the claim is geometric.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), x: round(r.left + r.width / 2), y: round(r.top + r.height / 2), w: round(r.width), h: round(r.height) };
	};
	const pick = (sel) => document.querySelector(sel);
	const opacity = (el) => (el ? getComputedStyle(el).opacity : null);
	const handle = pick('[data-lo-chat-measure-handle="right"]');
	const handleLeft = pick('[data-lo-chat-measure-handle="left"]');
	const bar = pick('[data-lo-chat-measure-cue="right"]');
	const barLeft = pick('[data-lo-chat-measure-cue="left"]');
	const line = pick('[data-lo-chat-measure-line="right"]');
	const lineLeft = pick('[data-lo-chat-measure-line="left"]');
	const scroller = pick("[data-lo-canonical-transcript]");
	const panel = pick('[role="tooltip"]');
	/*
	 * What a press ON THE DRAWN MARK would hit (UX round 1's U1, as a reading): one
	 * elementFromPoint at the mark's own centre, reported as the band, or the tag
	 * that got there instead. The base tree's bar is inside its strip; the head's
	 * line must be inside its band - that equality is the fix.
	 */
	const mark = line || bar;
	return {
		content: rect(pick("[data-lo-transcript-content]")),
		pane: rect(scroller),
		scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
		panel: rect(panel),
		panelText: panel ? panel.textContent : null,
		markInBand: (() => {
			if (!mark || !handle) return null;
			const r = mark.getBoundingClientRect();
			const el = document.elementFromPoint(
				r.left + r.width / 2,
				r.top + r.height / 2,
			);
			if (!el) return null;
			return el.closest("[data-lo-chat-measure-handle]") ? "band" : el.tagName;
		})(),
		handle: rect(handle),
		handleLeft: rect(handleLeft),
		bar: rect(bar),
		barLeft: rect(barLeft),
		line: rect(line),
		lineLeft: rect(lineLeft),
		barOpacity: opacity(bar),
		barLeftOpacity: opacity(barLeft),
		lineOpacity: opacity(line),
		lineLeftOpacity: opacity(lineLeft),
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

/**
 * One half's four states, in one browser per palette.
 *
 * The pointer is moved WITHOUT a button and the intent delay (200ms for the
 * line, 400ms for the tooltip) is waited out, so a hovered frame is the state a
 * reader is actually in - `:hover` is browser state and cannot be a story.
 */
const captureHalf = async (half, origin, record) => {
	for (const theme of THEMES) {
		/*
		 * ONE SCRATCH PROFILE PER (half, palette). A profile shared between runs is
		 * a store shared between them, and the drag below COMMITS a width: measured
		 * on the first cut of this rig, the second palette opened at the first one's
		 * stored 1100, rendered at the pane's 992 and read as a column the 810px cap
		 * had stopped binding on - a defect in the rig that looked exactly like a
		 * defect in the product. Nothing here tests persistence (the sibling rig
		 * does, deliberately, on one profile), so every run starts empty.
		 */
		const profile = mkdtempSync(join(tmpdir(), `lo-measure-line-${half}-`));
		const { cdp, chrome } = await launch(profile);
		try {
			await openStory(cdp, origin, theme);

			record(half, "rest", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, half, "rest", theme);

			const atRest = await cdp.evaluate(PROBE);
			await cdp.mouse("mouseMoved", atRest.handleLeft.x, atRest.handleLeft.y);
			await sleep(450);
			record(half, "hover-left", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, half, "hover-left", theme);

			await cdp.mouse("mouseMoved", atRest.handle.x, atRest.handle.y);
			await sleep(450);
			record(half, "hover-right", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, half, "hover-right", theme);

			/*
			 * Mid-gesture, button still held: press, travel outward in one step,
			 * shoot, then release. The departure is far enough to reach the ceiling,
			 * so the frame shows the line at a column that has actually moved.
			 */
			await cdp.mouse("mousePressed", atRest.handle.x, atRest.handle.y, {
				button: "left",
				buttons: 1,
				clickCount: 1,
			});
			await sleep(60);
			await cdp.mouse("mouseMoved", atRest.handle.x + 2000, atRest.handle.y, {
				button: "left",
				buttons: 1,
			});
			await sleep(160);
			record(half, "dragging", theme, await cdp.evaluate(PROBE));
			await shoot(cdp, half, "dragging", theme);
			await cdp.mouse(
				"mouseReleased",
				atRest.handle.x + 2000,
				atRest.handle.y,
				{
					button: "left",
					buttons: 0,
					clickCount: 1,
				},
			);
			/*
			 * THE SCROLLED CASE (agent review round 1's M1).
			 *
			 * The story's transcript fits its pane, which is the ONE shape where a
			 * content-height anchor still puts the panel somewhere visible; the
			 * reviewer's arithmetic said a scrolling transcript is where it goes off
			 * screen, and it could not be measured without a pane shorter than the
			 * column. So: clone the rendered prose block inside the content column
			 * (real rendered markup, not a fixture) and clip the scroller, which makes
			 * the column taller than the pane - the exact shape. The panel's rect is
			 * then read against the pane's at the top, the middle and the bottom, with
			 * the pointer parked at the pane's own middle.
			 */
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
				const s = document.querySelector("[data-lo-canonical-transcript]");
				s.style.height = "240px";
				s.style.maxHeight = "240px";
				s.style.flex = "none";
				return document.querySelectorAll("[data-probe-clone]").length;
			})()`);
			await sleep(700);
			for (const [at, fraction] of [
				["top", 0],
				["mid", 0.5],
				["bottom", 1],
			]) {
				await cdp.evaluate(`(() => {
					const s = document.querySelector("[data-lo-canonical-transcript]");
					s.scrollTop = -Math.round((s.scrollHeight - s.clientHeight) * ${fraction});
					return s.scrollTop;
				})()`);
				await sleep(250);
				const atScroll = await cdp.evaluate(PROBE);
				await cdp.mouse(
					"mouseMoved",
					atScroll.handle.x,
					(atScroll.pane.top + atScroll.pane.bottom) / 2,
				);
				await sleep(700);
				record(half, `scrolled-${at}`, theme, await cdp.evaluate(PROBE));
				if (at === "mid") await shoot(cdp, half, "hover-scrolled", theme);
				await cdp.mouse("mouseMoved", 5, 5);
				await sleep(250);
			}
			/*
			 * The release committed a width - this profile is discarded with the
			 * browser (see the per-run scratch profile above), so nothing downstream
			 * inherits it.
			 */
		} finally {
			await closeChrome(cdp, chrome);
			rmSync(profile, {
				// `maxRetries` because Chrome's teardown can still hold the directory
				// for a moment after `exit`; the sibling rig states the same reason.
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

	for (const theme of THEMES) {
		for (const half of ["before", "after"]) {
			const rest = by(half, "rest", theme);
			const hoverLeft = by(half, "hover-left", theme);
			const hoverRight = by(half, "hover-right", theme);
			const dragging = by(half, "dragging", theme);
			const bar = half === "before";
			const rightOpacity = (reading) =>
				bar ? reading.barOpacity : reading.lineOpacity;
			const leftOpacity = (reading) =>
				bar ? reading.barLeftOpacity : reading.lineLeftOpacity;

			if (Number(rightOpacity(rest)) !== 0)
				failures.push(
					`${half}/${theme}: the cue is visible at rest (${rightOpacity(rest)})`,
				);
			if (Number(leftOpacity(rest)) !== 0)
				failures.push(
					`${half}/${theme}: the LEFT cue is visible at rest (${leftOpacity(rest)})`,
				);
			if (!(Number(rightOpacity(hoverRight)) > 0))
				failures.push(
					`${half}/${theme}: the right cue did not appear on hover (${rightOpacity(hoverRight)})`,
				);
			if (!(Number(leftOpacity(hoverLeft)) > 0))
				failures.push(
					`${half}/${theme}: the left cue did not appear on its own hover (${leftOpacity(hoverLeft)})`,
				);
			if (!(Number(rightOpacity(dragging)) > 0))
				failures.push(
					`${half}/${theme}: the right cue did not stay lit while dragging (${rightOpacity(dragging)})`,
				);

			const content = rest.content;
			/*
			 * THE MARK IS THE TARGET, on both trees (UX round 1's U1). One
			 * `elementFromPoint` at the drawn mark's own centre: the base tree's bar
			 * sits inside its strip and the head's line must sit inside its band, so
			 * "point at the rule, grab it" holds on both - which is what the previous
			 * head's 24px offset broke (measured there: the element at the mark's x was
			 * the transcript DIV, cursor `auto`, and a press moved no width).
			 */
			if (rest.markInBand !== "band")
				failures.push(
					`${half}/${theme}: a press on the mark's own x would hit ${rest.markInBand ?? "nothing"}, not the band`,
				);
			/*
			 * THE REST IS THE HEAD'S. The base tree's band is still the old 24px-out
			 * strip and its mark is a floating bar, so these are statements about THIS
			 * branch's geometry; the base half is described by the `bar` branch below.
			 *
			 * The band's inner edge is on the column's own edge - never inward of it,
			 * which is design round 1's D2 kept - and the line is inside it, which is
			 * UX round 1's U1 fixed.
			 */
			if (bar) {
				/*
				 * The base tree's bar: 2px wide, 72px tall, floating 28px OUT in the
				 * margin past the column's edge - the geometry the issue reports as
				 * reading like a stray mark rather than a boundary. Its strip is 24px
				 * out, so the base's own band geometry is asserted here and not with
				 * the head's.
				 */
				if (!rest.bar) {
					failures.push(`${half}/${theme}: the base tree has no bar`);
					continue;
				}
				if (rest.bar.h !== 72)
					failures.push(
						`${half}/${theme}: the bar is ${rest.bar.h}px tall, not 72`,
					);
				if (rest.bar.w !== 2)
					failures.push(`${half}/${theme}: the bar is ${rest.bar.w}px wide`);
				if (!near(rest.bar.left - content.right, 28, 1))
					failures.push(
						`${half}/${theme}: the bar's near edge is ${Math.round((rest.bar.left - content.right) * 10) / 10}px past the column's right edge, not 28`,
					);
				if (!near(rest.handle.left - content.right, 24, 1))
					failures.push(
						`${half}/${theme}: the base strip's inner edge is ${Math.round((rest.handle.left - content.right) * 10) / 10}px out, not 24`,
					);
				if (!(rest.bar.h < content.h / 2))
					failures.push(
						`${half}/${theme}: the bar is ${rest.bar.h}px of the column's ${content.h}px`,
					);
				continue;
			}

			if (!near(rest.handle.left - content.right, 0, 1))
				failures.push(
					`${half}/${theme}: the band's inner edge is ${Math.round((rest.handle.left - content.right) * 10) / 10}px out from the column's edge, not on it`,
				);
			if (
				rest.line &&
				rest.handle &&
				(rest.line.left < rest.handle.left - 1 ||
					rest.line.right > rest.handle.right + 1)
			)
				failures.push(
					`${half}/${theme}: the line ${rest.line.left}..${rest.line.right} is not inside the band ${rest.handle.left}..${rest.handle.right}`,
				);
			/*
			 * M1's reading: the panel is inside the pane at every scroll position. The
			 * pane is 240px here (the step above clips it) and the pointer sits at its
			 * middle, so a panel that lands against the content column's own edge
			 * instead of the hand's is what this catches.
			 */
			for (const at of ["top", "mid", "bottom"]) {
				const scr = by(half, `scrolled-${at}`, theme);
				if (!scr.panel) {
					failures.push(
						`${half}/${theme}: no panel at the ${at} scroll position (scrolled)`,
					);
					continue;
				}
				if (
					scr.panel.top < scr.pane.top - 1 ||
					scr.panel.bottom > scr.pane.bottom + 1
				)
					failures.push(
						`${half}/${theme}: at the ${at} scroll position the panel ${scr.panel.top}..${scr.panel.bottom} is outside the pane ${scr.pane.top}..${scr.pane.bottom}`,
					);
			}

			/*
			 * This branch's line: 2px, the column's full height, and its inner edge
			 * ON the column's edge - just outside it, so it never crosses the text.
			 */
			if (!rest.line || !rest.lineLeft) {
				failures.push(`${half}/${theme}: the state line is not rendered`);
				continue;
			}
			if (rest.line.w !== 2)
				failures.push(`${half}/${theme}: the line is ${rest.line.w}px wide`);
			if (!near(rest.line.left, content.right, 1))
				failures.push(
					`${half}/${theme}: the right line starts at ${rest.line.left}, the column ends at ${content.right}`,
				);
			if (!near(rest.lineLeft.right, content.left, 1))
				failures.push(
					`${half}/${theme}: the left line ends at ${rest.lineLeft.right}, the column starts at ${content.left}`,
				);
			if (!near(rest.line.h, content.h, 1))
				failures.push(
					`${half}/${theme}: the line is ${rest.line.h}px tall, the column ${content.h}`,
				);
		}
	}

	if (AS_JSON) {
		console.log(
			JSON.stringify(
				{ before: BEFORE, after: AFTER, results, failures },
				null,
				2,
			),
		);
	} else {
		for (const r of results) {
			const cue =
				r.half === "before"
					? `bar=${r.barOpacity}/${r.barLeftOpacity}`
					: `line=${r.lineOpacity}/${r.lineLeftOpacity}`;
			console.log(
				`${r.half.padEnd(7)} ${r.step.padEnd(11)} ${r.theme.padEnd(18)} ${cue}`,
			);
		}
		for (const f of failures) console.log(`FAIL ${f}`);
		console.log(
			failures.length
				? `${failures.length} assertion(s) failed`
				: "all readings held",
		);
	}
	process.exitCode = failures.length ? 1 : 0;
};

await main();
