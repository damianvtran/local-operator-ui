#!/usr/bin/env node
/**
 * Measures the composer band's empty-chat geometry from the live DOM.
 *
 *     node scripts/composer-band-geometry.mjs [storybook-origin] [--json]
 *
 * WHY THIS EXISTS RATHER THAN A TABLE IN THE EVIDENCE README. The change this
 * measures is almost entirely a change in what is NOT drawn: the chip's 1px
 * `border-control` edge goes, which is 2px of box height and one 3:1 boundary
 * per chip, and a still frame cannot show an absent border or a box the CSS
 * never paints. The design record states its numbers as falsifiable
 * predictions (docs/design/composer-suggestions.md § 7) and the review is
 * asked to check them on the frames; a chip whose boundary is gone has no box
 * edge to read off a screenshot, so the numbers have to come from
 * `getBoundingClientRect` in the same rendered state the frames are taken
 * from, and this file is the command that produces them - a reviewer re-runs
 * it rather than trusting a table someone typed.
 *
 * Raw CDP against a private headless Chrome, deliberately the same approach as
 * `capture-evidence.mjs` and `chat-alignment-geometry.mjs` (fresh user-data-dir
 * under /tmp, killed on exit, no browser-automation dependency added to the
 * repo). Duplicating that driver a third time rather than importing it is the
 * same smaller evil the second file argues: `capture-evidence.mjs`'s loop is
 * built around writing one webp per theme per story, and threading a "measure
 * instead of shoot" mode through the evidence sweep - the one script in this
 * repo that must stay boring - for the benefit of one probe is the worse
 * trade.
 *
 * What it reports per story, in CSS pixels at that story's own viewport (the
 * same viewports `capture-evidence.mjs` captures the frames at, so a number
 * here and a frame there describe ONE layout):
 *
 *  - `band`      the composer band's own box, which is what the two numbers
 *                about the cap are relative to.
 *  - `splash`    the node `MeasuredSuggestionStack` measures its `fixed`
 *                budget against, and `fixed` as it computes it.
 *  - `composer`  the composer BOX - the band's one remaining structural edge,
 *                and the left edge the tip row and the chips must share.
 *  - `tip`       the tip row's box, its sentence's rendered width against its
 *                own clipped width (the truncation question), and the SENTENCE
 *                it is showing, which is what makes a captured frame's tip
 *                checkable rather than merely asserted.
 *  - `chips`     every chip's box plus the rows they resolve to, so the box
 *                height (prediction: 27.5), the row pitch (35.5) and the
 *                wrap count are all read rather than derived.
 *  - `cap`       the inline `max-height` the cap actually applied, and the
 *                allowance it was computed against. `null` maxHeight with the
 *                stack's own bottom inside the allowance is the whole of
 *                prediction 2: the cap no longer binds.
 *
 * `reason` explains an empty result rather than leaving a reader to guess
 * whether the module changed or the story never mounted.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The stories, at the viewports their evidence frames are captured at.
 *
 * `column-floor` and `small-view` are the two the design record's prediction 2
 * is about (the column floor, the whole prompt present and then absent) - the
 * floor is the narrowest window whose chat column is still 550px, which is NOT
 * the app's own minimum window (`WINDOW_MIN_WIDTH` is 800, where the column is
 * 300px and the prompt is absent); `empty-chat` is the app's default layout,
 * where prediction 1 - whether the opening four take one row - is decided.
 */
const STORIES = [
	["chat-composer-band--empty-chat", 1380, 872],
	["chat-composer-band--column-floor", 830, 572],
	["chat-composer-band--small-view", 830, 572],
	["chat-composer-band--long-labels", 900, 572],
	["chat-composer-band--draft-held", 1380, 872],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * The tip pool, bundled out of the shipped TypeScript rather than restated
 * here.
 *
 * The measurement below asks whether EVERY entry fits the narrowest column the
 * row renders in, and a hand-copied list in this file would go stale the first
 * time a tip was reworded - which is the same drift the TUI's own
 * `TIP_MIN_WIDTH` comment records having been bitten by when it was
 * hand-picked rather than derived from the pool. Importing the module makes the
 * answer a function of the product.
 */
const tipsBundle = await build({
	stdin: {
		contents: `export { COMPOSER_TIPS } from "./src/renderer/src/features/chat/components/composer-tips";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	write: false,
});
const tipsPath = new URL("./_composer-band-tips.mjs", import.meta.url);
await writeFile(tipsPath, tipsBundle.outputFiles[0].text);
const { COMPOSER_TIPS } = await import(tipsPath.href);
await unlink(tipsPath);

/** The pool as a JS literal, for the probe below. */
const TIP_POOL = JSON.stringify(COMPOSER_TIPS);

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
		/*
		 * `maxRetries` because SIGKILL returns before the kernel has finished
		 * reaping the process, and Chrome's profile keeps being written to for a
		 * few milliseconds after that - long enough that a plain recursive remove
		 * loses the race and throws ENOTEMPTY, turning a successful measurement
		 * into a non-zero exit.
		 */
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
 * The measurement, evaluated in the page.
 *
 * Written as a string handed to `Runtime.evaluate` rather than as a function
 * serialised across, so what runs in the browser is exactly what is read here.
 * No backticks below: the whole thing is a template literal.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {
			top: round(r.top), bottom: round(r.bottom), height: round(r.height),
			left: round(r.left), right: round(r.right), width: round(r.width),
		};
	};
	const parsePx = (value) => {
		const n = Number.parseFloat(value);
		return Number.isFinite(n) ? n : 0;
	};

	const band = document.querySelector("[data-lo-composer-band]");
	if (!band) return { reason: "no [data-lo-composer-band] in the document" };
	const stack = band.querySelector("[data-lo-suggestion-stack]");
	const composerEl = band.querySelector('[data-tour-tag="chat-input-textarea"]');
	const tip = band.querySelector("[data-lo-composer-tip]");
	const tipText = tip ? tip.querySelector("span") : null;

	const bandStyle = getComputedStyle(band);
	const bandRect = band.getBoundingClientRect();
	const splashEl = band.firstElementChild;
	const splashRect = splashEl ? splashEl.getBoundingClientRect() : null;
	const stackRect = stack ? stack.getBoundingClientRect() : null;
	const stackStyle = stack ? getComputedStyle(stack) : null;

	const chips = stack
		? [...stack.children].map((el) => ({
				label: (el.textContent || "").trim(),
				...box(el),
			}))
		: [];
	/* A row is the set of chips sharing a top edge - the stack's own row model
	   (suggestion-stack.ts), read back from the layout rather than restated. */
	const rowTops = [...new Set(chips.map((c) => c.top))].sort((a, b) => a - b);

	const allowance = stackRect && splashRect
		? round(
				window.innerHeight -
					bandRect.top -
					parsePx(bandStyle.paddingTop) -
					parsePx(bandStyle.paddingBottom) -
					(splashRect.height - stackRect.height),
			)
		: null;

	return {
		viewport: { width: window.innerWidth, height: window.innerHeight },
		band: { ...box(band), paddingTop: parsePx(bandStyle.paddingTop), paddingBottom: parsePx(bandStyle.paddingBottom) },
		splash: splashRect ? { height: round(splashRect.height) } : null,
		composer: box(composerEl),
		tip: tip
			? {
					...box(tip),
					sentence: (tipText && tipText.textContent) || "",
					sentenceWidth: tipText
						? round(tipText.getBoundingClientRect().width)
						: null,
					/* scrollWidth against clientWidth on the CLIPPED element: a
					   truncated sentence is the one place these two disagree. */
					clipped: tipText
						? round(tipText.scrollWidth) > round(tipText.clientWidth)
						: null,
				}
			: null,
		chips,
		rows: rowTops.length,
		rowTops,
		/*
		 * Whether EVERY entry fits the column, measured in the row's own element.
		 *
		 * A frame can only show the entry the clock happens to be on, so a still
		 * answers this for one tip and no others - and the product's rule is the
		 * opposite of per-entry: the row is present for the whole pool or not at
		 * all, which is only sound while every entry fits. A CLONE of the real span
		 * is what is measured, so the classes, the font and the metrics are the
		 * product's; the clone is removed in the same tick, and the row it is
		 * temporarily a sibling of is not a control and holds no state that a
		 * transient child could disturb.
		 */
		tipPool: tipText
			? (() => {
					const rowEl = tipText.parentElement;
					const rows = ${TIP_POOL}.map((sentence) => {
						const clone = tipText.cloneNode(false);
						clone.textContent = sentence;
						rowEl.appendChild(clone);
						const width = round(clone.scrollWidth);
						clone.remove();
						return { sentence, width };
					});
					const worst = rows.reduce((a, b) => (b.width > a.width ? b : a));
					/* The row's own content box less the glyph and the gap: 12px of the
					   Info mark and the 6px gap-1.5, which are the row's constants. */
					const available = round(rowEl.clientWidth - 12 - 6);
					return {
						pool: rows.length,
						available,
						worstSentence: worst.sentence,
						worstWidth: worst.width,
						fits: worst.width <= available,
						slack: round(available - worst.width),
					};
				})()
			: null,
		cap: {
			maxHeight: stackStyle ? stackStyle.maxHeight : null,
			inlineMaxHeight: stack ? stack.style.maxHeight || null : null,
			clipping: stackStyle ? stackStyle.overflow : null,
			stackHeight: stackRect ? round(stackRect.height) : null,
			allowance,
			binds: Boolean(stack && stack.style.maxHeight),
		},
	};
})()`;

const main = async () => {
	dataDir = join(tmpdir(), `lo-composer-band-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	chrome = spawn(CHROME, [
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]);

	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(t);
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

	const results = [];
	for (const [story, width, height] of STORIES) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:localOperatorDark`,
		});
		/*
		 * Wait for the story to be MEASURABLE, which is three conditions and not
		 * one: Storybook's own "preparing" wrapper has to be gone (it renders
		 * inside an otherwise-ready document), fonts have to have resolved (every
		 * number below is text-driven), and the composer band has to be in the
		 * DOM. Polled rather than slept on, for the reason the sibling rig gives:
		 * a delay long enough for a cold start is paid by every story, and a short
		 * one intermittently reports "no band rendered" for a story that renders
		 * perfectly well.
		 */
		let ready = false;
		for (let i = 0; i < 200 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const loading = [...document.querySelectorAll(
						".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
					)].some((el) => el.getBoundingClientRect().height > 0);
					if (loading) return false;
					if (document.fonts.status !== "loaded") return false;
					return !!document.querySelector("[data-lo-composer-band]");
				})()`,
			});
			ready = result.value === true;
			if (!ready) await sleep(250);
		}
		if (!ready) {
			throw new Error(
				`${story} @ ${width}x${height}: story never became measurable`,
			);
		}
		/* One settled frame after layout, so the rects are post-reflow. */
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression:
				"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
		});
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: PROBE,
		});
		const value = result.value;
		if (!value || value.reason) {
			throw new Error(
				`${story} @ ${width}x${height}: ${value?.reason ?? `empty probe result ${JSON.stringify(result)}`}`,
			);
		}
		results.push({ story, requested: `${width}x${height}`, ...value });
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
		return;
	}

	for (const r of results) {
		console.log(`\n${r.story}  requested ${r.requested}`);
		console.log(`  viewport      ${r.viewport.width}x${r.viewport.height}`);
		console.log(
			`  band          top=${r.band.top} bottom=${r.band.bottom} height=${r.band.height}`,
		);
		console.log(
			`  splash        height=${r.splash ? r.splash.height : "none"}`,
		);
		console.log(
			`  composer box  left=${r.composer ? r.composer.left : "none"} width=${r.composer ? r.composer.width : "none"} height=${r.composer ? r.composer.height : "none"}`,
		);
		if (r.tip) {
			console.log(
				`  tip row       left=${r.tip.left} height=${r.tip.height} width=${r.tip.width}`,
			);
			console.log(
				`  tip sentence  width=${r.tip.sentenceWidth} clipped=${r.tip.clipped}`,
			);
			console.log(`  tip showing   "${r.tip.sentence}"`);
		} else {
			console.log("  tip row       absent");
		}
		if (r.tipPool) {
			console.log(
				`  tip pool      n=${r.tipPool.pool} worst=${r.tipPool.worstWidth}px available=${r.tipPool.available}px fits=${r.tipPool.fits} slack=${r.tipPool.slack}px`,
			);
			console.log(`  tip worst     "${r.tipPool.worstSentence}"`);
		}
		console.log(
			`  chips         n=${r.chips.length} rows=${r.rows} tops=[${r.rowTops.join(", ")}]`,
		);
		for (const c of r.chips) {
			console.log(
				`    - left=${c.left} width=${c.width} top=${c.top} height=${c.height}  "${c.label}"`,
			);
		}
		console.log(
			`  cap           binds=${r.cap.binds} inlineMaxHeight=${r.cap.inlineMaxHeight} stackHeight=${r.cap.stackHeight} allowance=${r.cap.allowance}`,
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
