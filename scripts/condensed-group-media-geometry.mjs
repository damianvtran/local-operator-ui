#!/usr/bin/env node
/**
 * Measures the condensed action group's height, from the live DOM.
 *
 *     node scripts/condensed-group-media-geometry.mjs [storybook-origin] [--json]
 *
 * WHY THIS FILE EXISTS. The change it measures makes one trade and states it as
 * a number: a condensed group now shows the pictures its run produced, at the
 * smallest size this system draws a picture, instead of hiding them behind the
 * disclosure. "A thumbnail is small" is not a number, and a still cannot produce
 * one — a 64px tile and a 240px figure look equally plausible in a screenshot of
 * two different states. So the numbers come from `getBoundingClientRect` in the
 * same rendered state `docs/evidence/chat-trace-fold-*` are taken from, and this
 * file is the command that produces them: a reviewer re-runs it rather than
 * trusting a table in a pull request.
 *
 * The claim it is here to test, in the order the numbers read:
 *
 *  - a run with NO pictures is the height it was (the strip is not rendered at
 *    all, so the group is its header);
 *  - ONE picture costs the same as THREE, because the strip is a row of 64px
 *    tiles and a transcript's column holds four or more of them;
 *  - the thumbnail is at the frame's own 64px floor, never at the row's 240px
 *    ceiling, which is the ceiling the EXPANDED state draws its picture at — so
 *    the two heights either side of the reader's press are both in the table;
 *  - eight pictures are one capped row like any other: the fifth slot is the
 *    `+N more` count rather than a fifth picture (`FOLD_MEDIA_LIMIT`), so the
 *    height does not grow with the count - the earlier claim here ("where the
 *    row wraps") described the pre-cap strip, and the rig's `tileRows` reading
 *    is what refused it.
 *
 * Raw CDP against a private headless Chrome, deliberately the same approach as
 * `capture-evidence.mjs` and `chat-alignment-geometry.mjs` (fresh user-data-dir
 * under the machine's temp directory, killed on exit, routed through the shared
 * mock-keychain helper so a scratch profile never asks macOS for a login keychain, and no
 * browser-automation dependency added to the repo). Duplicating that driver here
 * rather than importing it is the smaller evil, for the reason
 * `chat-alignment-geometry.mjs` gives: the evidence sweep is the one script in
 * this repo that must stay boring.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";

/**
 * The palette under measurement. An argument rather than a constant because D2's
 * reading is a claim about BOTH brand palettes and the light one is the palette
 * the finding is about; the dark one is where nothing depends on the tile's edge.
 */
const THEME =
	process.argv.find((arg) => arg.startsWith("--theme="))?.slice(8) ??
	"localOperatorDark";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* Top-level (biome's `useTopLevelRegex`): Chrome's own readiness line, matched
   once per boot and never against page content. */
const DEVTOOLS_LINE = /DevTools listening on (ws:\/\/[^\s]+)/;

/**
 * The states, with the viewport each is judged at — the same ids and widths
 * `capture-evidence.mjs` sweeps for this surface, so a number here and a frame
 * there describe one layout rather than two.
 *
 * `press` is the state that only exists after a reader acts: the expanded frame
 * is REACHED by pressing the fold's own trigger, never by a story that hand-opens
 * it, because the press is the thing being priced against the strip.
 */
const STORIES = [
	["chat-trace-fold--finished", 1280, 200],
	["chat-trace-fold--image-hidden", 1280, 200],
	["chat-trace-fold--image-shown", 1280, 200],
	["chat-trace-fold--images-three", 1280, 200],
	["chat-trace-fold--images-many", 1280, 200],
	["chat-trace-fold--image-live", 1280, 200],
	/* Round 1's states: the similar pair, a real screenshot, the page-toned
	   canvases and the compact receipt. */
	["chat-trace-fold--image-similar", 1280, 200],
	["chat-trace-fold--image-screenshot", 1280, 200],
	["chat-trace-fold--image-tones", 1280, 200],
	["chat-trace-fold--image-unavailable", 1280, 200],
	/* The narrow column, where the CAP is the thing that has to hold: six tiles
	   and their five 8px gutters are 628px (not the 638px the pre-`gap-2`
	   arithmetic said), past this rig's own 576px narrow column - that is the
	   sum the limit is derived from. */
	["chat-trace-fold--images-many", 640, 200],
	["chat-trace-fold--images-three", 640, 200],
	[
		"chat-trace-fold--image-expanded",
		1280,
		420,
		'[data-fold-ids] button[aria-expanded="false"]',
	],
];

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
		/* `maxRetries` for the reason `chat-alignment-geometry.mjs` states: SIGKILL
		   returns before the profile has stopped being written to, so a plain
		   recursive remove loses the race and throws ENOTEMPTY over a run that
		   measured perfectly well. */
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
	/* WCAG 2.x relative luminance, so the boundary reading is the standard's
	   number rather than a hue comparison. */
	const luminance = (rgb) => {
		const [r, g, b] = rgb.match(/[\\d.]+/g).slice(0, 3).map(Number).map((c) => {
			const v = c / 255;
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const contrast = (a, b) => {
		const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
		return round((hi + 0.05) / (lo + 0.05));
	};
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { top: round(r.top), height: round(r.height), width: round(r.width) };
	};

	const fold = document.querySelector("[data-fold-ids]");
	if (!fold) return null;
	/* The disclosure's own trigger, which is the fold's header row. */
	const header = fold.querySelector("button");
	const media = fold.querySelector("[data-fold-media]");
	const tiles = media ? [...media.querySelectorAll("li")] : [];
	const pictures = media ? [...media.querySelectorAll("img")] : [];
	/* The rows the fold is holding OPEN. Zero in every condensed state, and the
	   count is what says the expanded frame really is expanded. */
	const rows = fold.querySelectorAll('[data-testid="tool-row"], [class*="toolrow"]');

	/*
	 * One row of tiles or several: top is what decides it, not a width
	 * threshold. The strip's own height is compared against a single tile's, so
	 * the number is a fact about the render rather than a re-derivation of the
	 * wrap rule.
	 */
	const topLines = new Set(tiles.map((tile) => round(tile.getBoundingClientRect().top)));

	return {
		fold: box(fold),
		header: box(header),
		media: box(media),
		tileCount: tiles.length,
		/*
		 * Rows by HEIGHT, not by counting distinct tops: the strip aligns its items
		 * with items-center, so the +N more slot's top differs from the tiles' by
		 * design and a top-set would report one row as two. The strip is a whole
		 * number of tile rows tall, and that is the fact the budget is about.
		 */
		tileRows:
			media && tiles[0]
				? Math.max(
						1,
						Math.round(
							media.getBoundingClientRect().height /
								Math.max(tiles[0].getBoundingClientRect().height, 1),
						),
					)
				: 0,
		tile: box(tiles[0]),
		/* The tallest picture, which on a mixed-aspect strip is the tall capture. */
		pictureMaxHeight: pictures.length
			? round(Math.max(...pictures.map((p) => p.getBoundingClientRect().height)))
			: null,
		/*
		 * The three boxes a tile is made of, because the CEILING is the claim and
		 * the tile's own height is the consequence: the picture is capped at the
		 * frame's 64px floor, the frame adds its border, and the strip is the row.
		 * A number that only reported the list item could be 6px wrong about the
		 * picture and still look plausible.
		 */
		picture: box(pictures[0]),
		/* Decoded AND painted are two different facts: a picture whose load event
		   never fired keeps its reserved box and paints nothing, which a frame of
		   an empty tile is the evidence of. */
		pictureState: pictures[0]
			? {
					complete: pictures[0].complete,
					naturalWidth: pictures[0].naturalWidth,
					opacity: getComputedStyle(pictures[0]).opacity,
				}
			: null,
		frame: box(media ? media.querySelector('[class*="min-h-16"]') : null),
		/* The item's display, because the gap between the frame and the item IS
		   the line box's leading and this is the property that removes it. */
		tileDisplay: tiles[0] ? getComputedStyle(tiles[0]).display : null,
		/* The tile's OWN class string, because the slot's contract is a rule about
		   classes and a 2px difference between two states of it is what a class
		   assertion catches and a box measurement can round away. */
		frameClass: tiles[0]?.querySelector('[class*="min-h-16"], [class*="h-16"]')
			? tiles[0]
					.querySelector('[class*="min-h-16"], [class*="h-16"]')
					.getAttribute("class")
			: null,
		tileChild: box(tiles[0] && tiles[0].firstElementChild),
		tileGrandchild: box(
			tiles[0] && tiles[0].firstElementChild && tiles[0].firstElementChild.firstElementChild,
		),
		openRows: rows.length,
		headerText: header ? header.innerText.replace(/\\s+/g, " ").trim() : null,
		/*
		 * D2's reading, taken off the RENDER rather than off the tokens: the tile's
		 * own boundary colour against the ground it sits on, as WCAG's non-text
		 * ratio. The palette rows in contrast-contract.mjs prove the PAIR is legal
		 * on every ground; this is the shipped pixels agreeing with them, which is
		 * what the design round asked for and what a still cannot state.
		 */
		boundary: media && tiles[0]
			? (() => {
					const tileFrame = tiles[0].querySelector('[class*="min-h-16"]');
					if (!tileFrame) return null;
					const border = getComputedStyle(tileFrame).borderTopColor;
					const ground = getComputedStyle(document.body).backgroundColor;
					return { border, ground, ratio: contrast(border, ground) };
				})()
			: null,
	};
})()`;

const main = async () => {
	dataDir = join(tmpdir(), `lo-fold-geometry-${process.pid}`);
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
			const m = buf.match(DEVTOOLS_LINE);
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
	for (const [story, width, height, press] of STORIES) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${THEME}`,
		});
		/*
		 * Measurable is three conditions, not one: Storybook's own loader gone,
		 * fonts resolved (a height measured against the fallback face is a number
		 * about this machine), and the fold itself in the DOM. Polled rather than
		 * slept on, for the reason the sibling rig states.
		 */
		let ready = false;
		for (let i = 0; i < 240 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const loading = [...document.querySelectorAll(
						".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
					)].some((el) => el.getBoundingClientRect().height > 0);
					if (loading) return false;
					if (document.fonts.status !== "loaded") return false;
					return !!document.querySelector("[data-fold-ids]");
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
		if (press) {
			/*
			 * The reader's press, delivered to the fold's own control — the same
			 * element `capture-evidence.mjs` presses for this frame, so the measured
			 * state and the photographed one are reached the same way.
			 */
			const pressed = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const el = document.querySelector(${JSON.stringify(press)});
					if (!el) return false;
					el.click();
					return true;
				})()`,
			});
			if (pressed.result.value !== true) {
				throw new Error(`${story}: nothing to press at ${press}`);
			}
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
		if (!result.value) {
			throw new Error(
				`${story} @ ${width}x${height}: no fold rendered ${JSON.stringify(result)}`,
			);
		}
		results.push({ story, viewport: `${width}x${height}`, ...result.value });
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
		return;
	}
	for (const r of results) {
		console.log(`\n${r.story}  @ ${r.viewport}  (${THEME})`);
		console.log(`  header         "${r.headerText}"`);
		console.log(
			`  fold height    ${r.fold.height}   (header ${r.header.height} + media ${r.media ? r.media.height : 0})`,
		);
		console.log(
			`  strip          tiles=${r.tileCount}  rows=${r.tileRows}  tile=${r.tile ? `${r.tile.width}x${r.tile.height}` : "none"}`,
		);
		console.log(
			`  tallest picture ${r.pictureMaxHeight === null ? "none" : `${r.pictureMaxHeight}px`}   rows mounted open=${r.openRows}`,
		);
		if (r.frameClass) {
			console.log(`  tile frame   ${r.frameClass}`);
		}
		if (r.boundary) {
			console.log(
				`  boundary     ${r.boundary.border} on ${r.boundary.ground} = ${r.boundary.ratio}:1`,
			);
		}
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
