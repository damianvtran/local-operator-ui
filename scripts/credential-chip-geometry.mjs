#!/usr/bin/env node
/**
 * Measures the composer's credential chip against the marker run it covers.
 *
 *     node scripts/credential-chip-geometry.mjs [storybook-origin] [--json]
 *
 * THE CLAIM THIS EXISTS FOR is a claim about PIXELS, and the operator asked for
 * it in so many words: a chip that "must cover EXACTLY the marker run's box or it
 * will drift off the characters it sits under". A frame can show a chip in the
 * right place or the wrong one, but it cannot say by how much, and it cannot say
 * whether the chip's own CONTENT fits the box it was given — a box too narrow
 * clips its label silently, and a still of a clipped label looks exactly like a
 * still of a short one. So the numbers come from `getClientRects` in the same
 * rendered state the evidence frames are taken from, and this file is the command
 * that produces them: a reviewer re-runs it rather than trusting a table.
 *
 * WHAT IT REPORTS, per story and viewport, all in CSS pixels:
 *
 *  - `runs`   each painted run's box: the mirror's own spans (`[data-credential-run]`),
 *             which is the geometry the chip layer measures. `rects` is how many
 *             fragments the run reports — 1 means a chip is drawn, more means it
 *             WRAPS and keeps the wash (the documented fallback).
 *  - `chips`  each chip's box, from the chip layer's own children.
 *  - `fit`    `content` vs `box`: the chip's `scrollWidth` against its
 *             `clientWidth`, which is the difference between "the chip's words
 *             fit the run" and "the chip is clipping them". The chip is painted
 *             at the run's box by construction, so this is the only place the
 *             pair can be compared.
 *  - `deltas` run box against chip box: `left`, `top`, `width`, `height`. All
 *             four are zero when the chip covers the run exactly.
 *
 * Raw CDP against a private headless Chrome, the same approach as
 * `chat-alignment-geometry.mjs` and `capture-evidence.mjs` (fresh user-data-dir
 * under /tmp, `--use-mock-keychain` so no keychain prompt can reach the
 * operator's screen, killed on exit, no browser-automation dependency added to
 * the repo). Duplicating that driver rather than importing it is the smaller
 * evil for the reason the alignment rig states: the sweep's loop writes one webp
 * per theme per story, and threading a "measure instead of shoot" mode through it
 * would complicate the one script in this repo that must stay boring.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6018";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The two rungs the chip is painted at, with the viewports the evidence frames
 * use, so a number here and a frame there describe one layout rather than two.
 *
 * The views are ALSO as different as the rung gets: `pill-mid-prose` is a
 * reference in the middle of a sentence (a chip with text on both sides, which is
 * where an over-wide chip would cover its neighbour), `pill-at-line-start` puts
 * the marker at offset 0, and `pill-small-view` is the same mint at the compact
 * type step and padding, where the run box is narrower.
 */
const STORIES = [
	["chat-message-input--credential-pill-mid-prose", 1024, 300],
	["chat-message-input--credential-pill-at-line-start", 1024, 300],
	["chat-message-input--credential-pill-unbacked", 1024, 300],
	["chat-message-input--credential-pill-small-view", 440, 300],
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
		// Retried: `SIGKILL` returns before the kernel reaps the process and
		// Chrome's profile keeps being written for a few milliseconds after it,
		// which turns a successful measurement into an ENOTEMPTY out of the
		// `finally` — a complete run that reads as a failed one.
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
 * A string handed to `Runtime.evaluate` rather than a function serialised
 * across, so what runs in the browser is exactly what is read here. No backticks
 * below: the whole thing is a template literal.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 100) / 100;
	const box = (el) => {
		const r = el.getBoundingClientRect();
		return { left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height) };
	};
	const layer = document.querySelector("[data-credential-chips]");
	const mirror = [...document.querySelectorAll("div[aria-hidden='true']")]
		.find((el) => el.classList.contains("-z-10"));
	if (!mirror) return { error: "no mirror" };
	const runs = [...mirror.querySelectorAll("[data-credential-run]")].map((span) => ({
		planIndex: Number(span.dataset.credentialRun),
		text: span.textContent,
		rects: [...span.getClientRects()].map((r) => ({ width: round(r.width), height: round(r.height) })),
		box: box(span),
	}));
	const chips = layer
		? [...layer.children].map((el) => ({
				label: el.textContent,
				box: box(el),
				content: el.scrollWidth,
				client: el.clientWidth,
				clipped: el.scrollWidth > el.clientWidth,
			}))
		: [];
	const deltas = chips.map((chip, i) => {
		const run = runs[i];
		if (!run) return null;
		return {
			left: round(chip.box.left - run.box.left),
			top: round(chip.box.top - run.box.top),
			width: round(chip.box.width - run.box.width),
			height: round(chip.box.height - run.box.height),
		};
	});
	const field = document.querySelector("textarea");
	return {
		value: field ? field.value : null,
		runs,
		chips,
		deltas,
		wrapped: runs.filter((run) => run.rects.length !== 1).length,
	};
})()`;

const main = async () => {
	dataDir = join(tmpdir(), `lo-chip-geometry-${process.pid}`);
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
		 * one: Storybook's own loader has to be gone, the fonts have to have
		 * resolved (a chip measured against the fallback face is a number about
		 * this machine), and the story's own play function has to have finished —
		 * the credential stories type their state and hold the shutter until they
		 * do, so a measurement taken while `capturePending` is set is a
		 * measurement of a half-typed composer. Polled rather than slept on, for
		 * the reason the alignment rig gives: a delay long enough for a cold start
		 * is paid by every story, and one short enough to be cheap is the one that
		 * reports "no chip" for a story that renders one.
		 */
		let ready = false;
		for (let i = 0; i < 160 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const loading = [...document.querySelectorAll(
						".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
					)].some((el) => el.getBoundingClientRect().height > 0);
					if (loading) return false;
					if (document.documentElement.dataset.capturePending) return false;
					if (document.fonts.status !== "loaded") return false;
					return !!document.querySelector("[data-credential-chips]")
						|| !!document.querySelector("[data-credential-run]");
				})()`,
			});
			ready = result.value === true;
			if (!ready) await sleep(250);
		}
		if (!ready) {
			throw new Error(
				`${story} @ ${width}x${height}: neither a run nor a chip ever rendered`,
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
		if (result.value?.error) {
			throw new Error(`${story} @ ${width}x${height}: ${result.value.error}`);
		}
		results.push({
			story,
			viewport: `${width}x${height}`,
			...result.value,
		});
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
		return;
	}
	for (const entry of results) {
		console.log(`\n${entry.story}  @ ${entry.viewport}  (${ORIGIN})`);
		console.log(`  buffer           ${JSON.stringify(entry.value)}`);
		entry.runs.forEach((run, i) => {
			const chip = entry.chips[i];
			const delta = entry.deltas[i];
			console.log(
				`  run ${i}            ${JSON.stringify(run.text)} rects=${run.rects.length}` +
					` box=${JSON.stringify(run.box)}`,
			);
			if (!chip) {
				console.log("    no chip at this run (a wrapped run keeps the wash)");
				return;
			}
			console.log(
				`    chip           box=${JSON.stringify(chip.box)} content=${chip.content} client=${chip.client} clipped=${chip.clipped}`,
			);
			console.log(`    delta          ${JSON.stringify(delta)}`);
		});
		if (entry.wrapped > 0) {
			console.log(
				`  wrapped runs     ${entry.wrapped} (no chip: documented fallback)`,
			);
		}
	}
};

main()
	.then(() => {
		teardown();
	})
	.catch((error) => {
		teardown();
		console.error(error.message);
		process.exit(1);
	});
