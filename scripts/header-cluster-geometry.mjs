#!/usr/bin/env node
/**
 * Measures the chat header's action cluster from the live DOM.
 *
 *     node scripts/header-cluster-geometry.mjs [storybook-origin] [--json]
 *
 * The operator's report - the gap between the browser button and the canvas
 * button is wider than the gap between the run trigger and the browser button -
 * is a claim about two numbers the eye cannot compare across two stills, and no
 * frame settles it: 8px against 12px reads as "slightly uneven" in a screenshot
 * and as an exact pair here. So the numbers come from `getBoundingClientRect` in
 * the same rendered state `docs/evidence/chat-header-cluster/` is taken from, and
 * this file is the command that produces them - a reviewer re-runs it rather than
 * trusting a table someone typed.
 *
 * Raw CDP against a private headless Chrome, deliberately the same approach as
 * `capture-evidence.mjs` and `chat-alignment-geometry.mjs` (fresh user-data-dir
 * under /tmp, killed on exit, no browser-automation dependency added to the repo,
 * a mock keychain so a rig's Chrome cannot reach the operator's login keychain).
 * The driver is duplicated rather than imported for the reason the alignment
 * probe gives: those files are built around writing one webp per theme per story,
 * and threading a measure mode through the evidence sweep would complicate the
 * one script in this repo that must stay boring.
 *
 * WHAT IT REPORTS, in CSS pixels at the stated viewport, per story:
 *
 *  - `trigger`, `browser`, `canvas`  the three controls' own boxes - 32px
 *    `ghost`/`icon` buttons whose whole box is a hover target.
 *  - `gapTriggerBrowser`, `gapBrowserCanvas`  the two numbers the report is
 *    about, each computed as `next.left - previous.right` (so a negative value
 *    would be an overlap).
 *  - `clusterGap`  the gap the CLUSTER's own computed style resolves to, which is
 *    the container's decision rather than a child's margin - and the field a
 *    reviewer reads to see that the spacing lives on the container.
 *  - `browserMarginRight`  the browser button's own computed right margin. This
 *    should be 0 in every state: a non-zero value is the component-owns-its-outer-
 *    margin anti-pattern `docs/branding.md` § 5 forbids.
 *  - `badge`, `badgeRingPx`, `badgeOuterRight`, `badgeClearance`  the badge's box,
 *    the width of its ring (read off the painted `box-shadow`, not assumed), the
 *    painted right edge (box + ring) and the distance from that edge to the canvas
 *    button's box. NEGATIVE `badgeClearance` means the ring is painted inside the
 *    neighbour's hover target, which is the case design round 1's D5 exists to
 *    prevent.
 *  - `badgeToGlyph`  the badge's left edge against the browser glyph's right edge.
 *    The badge is right-anchored, so a wider badge grows leftwards and this is the
 *    number that says whether it has started eating the glyph it sits beside.
 *  - `dot`, `dotOverhang`, `dotClearance`  the run trigger's own attention dot: how
 *    far it paints past its button's right edge and how much room is left before
 *    the browser button's box begins. It is measured because it is the OTHER
 *    control here that paints outside itself, and the answer to "does it do what
 *    the badge does" should be a number rather than a reading of the class list.
 *  - `transitions`  the cluster's and the browser button's computed
 *    `transition-property`. A spacing change is only a visible REFLOW if the
 *    property that carries it animates; if `gap` and `margin` are absent from both
 *    lists, the state change is one frame and a settled frame is the whole story.
 *
 * Viewports match `capture-evidence.mjs`'s entries for the same stories, so a
 * number here and a frame there describe one layout rather than two.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6017";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Chrome's own line naming the debugging endpoint, at the top level because
    `useTopLevelRegex` is a lint rule here and a literal built per call is the
    shape it exists to stop. */
const DEBUG_PORT = /DevTools listening on (ws:\/\/[^\s]+)/;

/**
 * The four states the cluster's spacing is judged in, at both brand palettes.
 *
 * The light pass is not padding: the gap is a layout fact and should be identical
 * in both, and a difference between them would mean something other than the
 * container is deciding the spacing - which is exactly the failure mode a fix on
 * the container is supposed to make impossible.
 */
const STORIES = [
	["chat-header-cluster--no-approval", 560, 84, "localOperatorDark"],
	["chat-header-cluster--one-approval", 560, 84, "localOperatorDark"],
	["chat-header-cluster--at-cap", 560, 84, "localOperatorDark"],
	["chat-header-cluster--trigger-dot", 560, 84, "localOperatorDark"],
	["chat-header-cluster--no-approval", 560, 84, "localOperatorLight"],
	["chat-header-cluster--one-approval", 560, 84, "localOperatorLight"],
	["chat-header-cluster--at-cap", 560, 84, "localOperatorLight"],
	["chat-header-cluster--trigger-dot", 560, 84, "localOperatorLight"],
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
		/*
		 * `maxRetries` for the reason `chat-alignment-geometry.mjs` states: SIGKILL
		 * returns before the kernel has reaped the process, and Chrome writes into
		 * its profile for a few milliseconds after that, so a plain recursive
		 * remove loses the race and throws ENOTEMPTY - turning a successful
		 * measurement into a non-zero exit.
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
 * Handed to `Runtime.evaluate` as a string so what runs in the browser is exactly
 * what is read here. No backticks below: the whole thing is a template literal.
 * Every selector is one the product itself writes for a rig to find - the tour
 * tags and the trigger's own inert hooks - rather than a class list, so a styling
 * change cannot silently turn this probe into a measurement of nothing.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {
			left: round(r.left),
			right: round(r.right),
			top: round(r.top),
			bottom: round(r.bottom),
			width: round(r.width),
			height: round(r.height),
		};
	};
	/* The painted spread of a box-shadow ring, read from the computed value: the
	   badge's ring is a Tailwind utility today, and a probe that assumed "2" would
	   keep reporting 2 after somebody changed it. */
	const ringPx = (el) => {
		if (!el) return 0;
		const shadow = getComputedStyle(el).boxShadow;
		if (!shadow || shadow === "none") return 0;
		const lengths = [...shadow.matchAll(/(-?[\\d.]+)px/g)].map((m) => Math.abs(Number(m[1])));
		return lengths.length ? Math.max(...lengths) : 0;
	};

	const header = document.querySelector('[data-tour-tag="chat-header"]');
	if (!header) return { error: "no chat header on the page" };
	/* The cluster is the header's own child that holds the canvas button, and it is
	   identified by what it HOLDS rather than by a class list, so a change to the
	   cluster's own utilities cannot make this probe measure the wrong element. */
	const cluster = [...header.children].find((el) =>
		el.querySelector('[data-tour-tag="open-canvas-button"]'),
	);
	if (!cluster) return { error: "no action cluster in the header" };

	const trigger = header.querySelector("[data-run-panel-trigger]");
	const browser = header.querySelector('[data-tour-tag="browser-pane-trigger"]');
	const canvas = header.querySelector('[data-tour-tag="open-canvas-button"]');
	const badge = header.querySelector('[data-tour-tag="browser-pane-badge"]');
	const dot = header.querySelector("[data-run-panel-dot]");
	const globe = browser ? browser.querySelector("svg") : null;
	const fileGlyph = canvas ? canvas.querySelector("svg") : null;

	const t = box(trigger);
	const b = box(browser);
	const c = box(canvas);
	const bd = box(badge);
	const dt = box(dot);
	const ring = ringPx(badge);

	const clusterStyle = getComputedStyle(cluster);
	return {
		clusterGap: clusterStyle.gap || clusterStyle.columnGap || "normal",
		clusterClass: cluster.className,
		browserMarginRight: browser
			? getComputedStyle(browser).marginRight
			: null,
		trigger: t,
		browser: b,
		canvas: c,
		triggerGlyph: box(trigger ? trigger.querySelector("svg") : null),
		browserGlyph: box(globe),
		canvasGlyph: box(fileGlyph),
		gapTriggerBrowser: t && b ? round(b.left - t.right) : null,
		gapBrowserCanvas: b && c ? round(c.left - b.right) : null,
		/* The cluster's own inner span, which is what moves when the badge appears. */
		clusterLeft: round(cluster.getBoundingClientRect().left),
		clusterWidth: round(cluster.getBoundingClientRect().width),
		badge: bd,
		badgeRingPx: ring,
		badgeOuterRight: bd ? round(bd.right + ring) : null,
		badgeClearance: bd && c ? round(c.left - (bd.right + ring)) : null,
		badgeToGlyph: bd && globe ? round(bd.left - box(globe).right) : null,
		badgeGlyphRight: globe ? round(box(globe).right) : null,
		/* Vertical overlap of the badge's box (ring included) with the glyph's box,
		   which is the other half of D5: the offset moved OUTWARD to clear the 16px
		   glyph, and a negative x-gap alone does not say whether any ink can meet. */
		badgeGlyphBoxOverlapY:
			bd && globe
				? round(
						Math.min(bd.bottom + ring, box(globe).bottom) -
							Math.max(bd.top - ring, box(globe).top),
					)
				: null,
		dot: dt,
		dotOverhang: dt && t ? round(dt.right - t.right) : null,
		dotClearance: dt && b ? round(b.left - dt.right) : null,
		dotToGlyph: dt && trigger ? round(dt.left - box(trigger.querySelector("svg")).right) : null,
		transitions: {
			cluster: clusterStyle.transitionProperty,
			clusterDuration: clusterStyle.transitionDuration,
			browser: browser ? getComputedStyle(browser).transitionProperty : null,
			browserDuration: browser ? getComputedStyle(browser).transitionDuration : null,
		},
	};
})()`;

const main = async () => {
	dataDir = join(tmpdir(), `lo-header-cluster-${process.pid}`);
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
			const m = buf.match(DEBUG_PORT);
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
	for (const [story, width, height, theme] of STORIES) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`,
		});
		/*
		 * Ready means three things and not one, for the reason the alignment probe
		 * gives: Storybook's "preparing" wrapper can sit inside an otherwise-ready
		 * document, fonts decide what the glyphs measure, and the header itself has
		 * to be in the DOM. Polled rather than slept on, because a delay long enough
		 * for a cold start is paid by every story and a cheap one reports "no header
		 * rendered" for a story that renders perfectly well.
		 */
		let ready = false;
		for (let i = 0; i < 120 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const loading = [...document.querySelectorAll(
						".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
					)].some((el) => el.getBoundingClientRect().height > 0);
					if (loading) return false;
					if (document.fonts.status !== "loaded") return false;
					return !!document.querySelector('[data-tour-tag="open-canvas-button"]');
				})()`,
			});
			ready = result.value === true;
			if (!ready) await sleep(250);
		}
		if (!ready) {
			throw new Error(`${story}: story never became measurable`);
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
			throw new Error(`${story}: ${result.value.error}`);
		}
		results.push({
			story,
			theme,
			viewport: `${width}x${height}`,
			measured: result.value,
		});
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
		return;
	}
	for (const { story, theme, viewport, measured: m } of results) {
		console.log(`\n${story}  @ ${viewport}  ${theme}`);
		console.log(
			`  cluster gap   ${m.clusterGap}   browser margin-right ${m.browserMarginRight}`,
		);
		console.log(
			`  trigger box   left=${m.trigger?.left}  right=${m.trigger?.right}`,
		);
		console.log(
			`  browser box   left=${m.browser?.left}  right=${m.browser?.right}`,
		);
		console.log(
			`  canvas  box   left=${m.canvas?.left}  right=${m.canvas?.right}`,
		);
		console.log(
			`  GAPS          trigger->browser ${m.gapTriggerBrowser}   browser->canvas ${m.gapBrowserCanvas}`,
		);
		console.log(
			`  cluster       left=${m.clusterLeft}  width=${m.clusterWidth}`,
		);
		console.log(
			`  badge         ${m.badge ? `left=${m.badge.left}  right=${m.badge.right}  width=${m.badge.width}  ring=${m.badgeRingPx}  outerRight=${m.badgeOuterRight}  clearance=${m.badgeClearance}  toGlyph=${m.badgeToGlyph}  glyphOverlapY=${m.badgeGlyphBoxOverlapY}` : "none"}`,
		);
		console.log(
			`  dot           ${m.dot ? `left=${m.dot.left}  right=${m.dot.right}  overhang=${m.dotOverhang}  clearance=${m.dotClearance}  toGlyph=${m.dotToGlyph}` : "none"}`,
		);
		console.log(
			`  transitions   cluster=[${m.transitions.cluster}] ${m.transitions.clusterDuration}  browser=[${m.transitions.browser}] ${m.transitions.browserDuration}`,
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
