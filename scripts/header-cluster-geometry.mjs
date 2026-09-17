#!/usr/bin/env node
/**
 * Measures the chat header's action cluster from the live DOM.
 *
 *     node scripts/header-cluster-geometry.mjs [storybook-origin] [--json] [--badge-text=<text>]
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
 * AND IT JUDGES, IT DOES NOT ONLY PRINT. Every state is checked against `CONTRACT`
 * below - the cluster's own gap, both box gaps, whether a badge is drawn, and the
 * badge's clearance to its neighbour's box - and a state that violates it is
 * reported as FAIL and makes the run exit 1. A probe that only prints is the
 * instrument that let a 12px-against-12px badge-free cluster and a negative badge
 * clearance pass review: both are the exact geometry this change exists to forbid,
 * and both exit 0 from a table nobody compares against anything. The universal
 * half of the contract is checked on every state too: `browserMarginRight` must be
 * `0px` (a non-zero value is the component-owns-its-outer-margin anti-pattern
 * `docs/branding.md` section 5 forbids) and the two brand palettes must agree field
 * for field, because a gap is a layout fact and a palette difference would mean
 * something other than the container is deciding the spacing.
 *
 * IT ALSO PRINTS THE CROSS-STATE DELTA - `MOVEMENT`, badge-free against badge
 * drawn, in the same run and the same theme. That is the quantity round 1's prose
 * got wrong (the cluster grows 8px, both gaps widen, the trigger absorbs both and
 * the browser button moves 4px), and it is the number a reviewer should not have to
 * subtract out of two box rows by hand.
 *
 * `--badge-text=<text>` writes that text into the drawn badge before measuring, so
 * the unreachable three-glyph counterfactual is a command a reader can re-run
 * rather than a snippet that lived in a pull-request body.
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
/* `--badge-text=100`: measure the badge as if it carried this text. The app caps
   its glyph run at `9+`, so the three-glyph case is reachable only by writing the
   text into the rendered page - which is fine for a measurement of the badge's own
   `absolute` box, and is the one row of the D5 table that cannot be a story. */
const BADGE_TEXT =
	ARGS.find((a) => a.startsWith("--badge-text="))?.slice(
		"--badge-text=".length,
	) ?? null;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Chrome's own line naming the debugging endpoint, at the top level because
    `useTopLevelRegex` is a lint rule here and a literal built per call is the
    shape it exists to stop. */
const DEBUG_PORT = /DevTools listening on (ws:\/\/[^\s]+)/;

/**
 * THE CONTRACT, so a reviewer re-running this reads a VERDICT rather than a table.
 *
 *  - `clusterGap`   the value the cluster's own computed `gap` must resolve to, in
 *    CSS pixels. This is the container's decision, and the field that says the
 *    spacing left the component.
 *  - `gaps`         the two box gaps in order (`trigger -> browser`,
 *    `browser -> canvas`), `null` where the neighbour is not rendered.
 *  - `badge`        whether a badge must be drawn in that state.
 *  - `clearanceAtLeast`  the minimum room the badge's painted ring must keep before
 *    the canvas button's box. `0` means the ring may MEET the box and never enter
 *    it, which is design round 1's D5 floor; a negative reading is a ring painted
 *    inside a 32px control's hover target and is the one number this contract
 *    exists to refuse.
 *
 * The five states and why each is judged as it is:
 *
 *  - `no-approval` and `trigger-dot` are badge-free, so the cluster owes nothing
 *    and must sit at the ramp's within-a-component step on BOTH sides. The dot
 *    state is the counter-example that proves the rule: an object painting 2px
 *    past its box earns no room, because the ordinary gap still clears it.
 *  - `one-approval` and `at-cap` are the badge drawn, which is what the 12px is
 *    for. `at-cap` is the widest the app can reach (`9+` is the badge's own
 *    grammar), so these two bound the state.
 *  - `canvas-open-badge` is the badge drawn with the canvas button UNMOUNTED: the
 *    room is owed for that button's box, so with no box there is nothing to clear
 *    and the cluster must fall back to 8px rather than pay 12 for a neighbour that
 *    is not rendered.
 */
const CONTRACT = {
	"chat-header-cluster--no-approval": {
		clusterGap: 8,
		gaps: [8, 8],
		badge: false,
	},
	"chat-header-cluster--one-approval": {
		clusterGap: 12,
		gaps: [12, 12],
		badge: true,
		clearanceAtLeast: 0,
	},
	"chat-header-cluster--at-cap": {
		clusterGap: 12,
		gaps: [12, 12],
		badge: true,
		clearanceAtLeast: 0,
	},
	"chat-header-cluster--trigger-dot": {
		clusterGap: 8,
		gaps: [8, 8],
		badge: false,
	},
	"chat-header-cluster--canvas-open-badge": {
		clusterGap: 8,
		gaps: [8, null],
		badge: true,
	},
};

/**
 * The badge-free/badge-drawn pair `MOVEMENT` is derived from. They must be the same
 * viewport and the same theme, which is why the pairing is by story name and the
 * run walks a theme at a time.
 */
const MOVEMENT_PAIR = [
	"chat-header-cluster--no-approval",
	"chat-header-cluster--one-approval",
];

/**
 * THE CROSS-STATE MOVEMENT THE FIX PROMISES, judged rather than printed.
 *
 * This is the quantity round 1's prose stated wrongly - "the cluster grows 4px and
 * the run trigger's left edge moves 4px", with the browser button said not to move
 * at all - so the script that produces the numbers is the right place to pin them.
 * Both of the cluster's two gaps ARE the one `gap` property, so an 8 -> 12 change
 * widens each of them by 4px, and the run trigger - which sits left of both -
 * absorbs both. Numbers are deltas from the badge-free state, in CSS pixels.
 *
 * The browser button's `-4` is not bookkeeping: its right edge moves 504 -> 500,
 * and 500 plus the badge's 12px painted ring ends exactly on the canvas button's
 * box at 512. That is the mechanism that holds design round 1's D5 clearance at the
 * 0px floor while the badge is drawn, so a future change that stops the browser
 * button moving has stopped paying for the badge.
 */
const MOVEMENT_CONTRACT = {
	clusterWidth: 8,
	triggerLeft: -8,
	browserLeft: -4,
	canvasLeft: 0,
	gapTriggerBrowser: 4,
	gapBrowserCanvas: 4,
};

/**
 * The cluster's spacing is judged in these states, at both brand palettes.
 *
 * The light pass is not padding: the gap is a layout fact and must be identical
 * in both, and a difference between them would mean something other than the
 * container is deciding the spacing - which is exactly the failure mode a fix on
 * the container is supposed to make impossible. It is part of the contract rather
 * than a reading, so the script fails on it.
 */
const STORIES = [
	["chat-header-cluster--no-approval", 560, 84, "localOperatorDark"],
	["chat-header-cluster--one-approval", 560, 84, "localOperatorDark"],
	["chat-header-cluster--at-cap", 560, 84, "localOperatorDark"],
	["chat-header-cluster--trigger-dot", 560, 84, "localOperatorDark"],
	["chat-header-cluster--canvas-open-badge", 560, 84, "localOperatorDark"],
	["chat-header-cluster--no-approval", 560, 84, "localOperatorLight"],
	["chat-header-cluster--one-approval", 560, 84, "localOperatorLight"],
	["chat-header-cluster--at-cap", 560, 84, "localOperatorLight"],
	["chat-header-cluster--trigger-dot", 560, 84, "localOperatorLight"],
	["chat-header-cluster--canvas-open-badge", 560, 84, "localOperatorLight"],
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
	/* The cluster is the header's own child that holds a CONTROL, and it is
	   identified by what it HOLDS rather than by a class list, so a change to the
	   cluster's own utilities cannot make this probe measure the wrong element. Any
	   of the three controls identifies it rather than the canvas button alone: the
	   badge drawn with the canvas OPEN is exactly the arrangement where that button
	   is unmounted, and keying this on it would make the probe report "no action
	   cluster" for a state this file exists to judge. */
	const cluster = [...header.children].find((el) =>
		el.querySelector('[data-run-panel-trigger], [data-tour-tag="browser-pane-trigger"], [data-tour-tag="open-canvas-button"]'),
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
		badgeText: badge ? badge.textContent : null,
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
					const header = document.querySelector('[data-tour-tag="chat-header"]');
					if (!header) return false;
					return [...header.children].some((el) =>
						el.querySelector('[data-run-panel-trigger], [data-tour-tag="browser-pane-trigger"], [data-tour-tag="open-canvas-button"]'),
					);
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
		let badgeTextOverridden = false;
		if (BADGE_TEXT !== null) {
			/*
			 * THE THREE-GLYPH COUNTERFACTUAL, as a command rather than a snippet in a
			 * pull-request body: the app caps its own glyph run at `9+`, so the widest
			 * badge is unreachable by any story and the only way to measure it is to
			 * write the text into the rendered page. The badge is `absolute`, so nothing
			 * about the cluster's layout depends on its own size - which is exactly what
			 * makes this a pure measurement of the glyph run and the D5 question a fair
			 * one to ask of it. A state that draws no badge is left alone, and says so: a
			 * run that asked for the override and silently measured a badge-free state
			 * would be the same class of claim as the prose this replaces.
			 */
			const { result: applied } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const badge = document.querySelector('[data-tour-tag="browser-pane-badge"]');
					if (!badge) return false;
					badge.textContent = ${JSON.stringify(BADGE_TEXT)};
					return true;
				})()`,
			});
			await cdp.send("Runtime.evaluate", {
				awaitPromise: true,
				expression:
					"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			});
			badgeTextOverridden = applied.value === true;
		}
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
			badgeTextOverridden,
			measured: result.value,
		});
	}

	/*
	 * THE VERDICT IS COMPUTED BEFORE ANYTHING IS PRINTED, so the exit code answers
	 * "is this the geometry the change promises" rather than "did the probe run".
	 * The three failures a printing-only instrument let through in round 1 are the
	 * three this refuses: a badge-free cluster that is not uniform on both sides, a
	 * badge whose ring is painted inside its neighbour's box, and a `margin-right`
	 * that has crept back onto the component.
	 */
	const problems = [];
	const check = (story, theme, label, actual, expected) => {
		if (actual !== expected) {
			problems.push(
				`${story} @ ${theme}: ${label} is ${actual}, contract says ${expected}`,
			);
		}
	};

	for (const { story, theme, measured: m, badgeTextOverridden } of results) {
		const contract = CONTRACT[story];
		if (!contract) {
			problems.push(`${story}: no contract declares this story's geometry`);
			continue;
		}
		check(story, theme, "clusterGap", m.clusterGap, `${contract.clusterGap}px`);
		/*
		 * The two gaps are compared against `null` where the neighbour is unmounted, so
		 * a state that quietly grew or lost a child cannot pass by measuring a box it
		 * was never supposed to have.
		 */
		check(
			story,
			theme,
			"gap trigger->browser",
			m.gapTriggerBrowser,
			contract.gaps[0],
		);
		check(
			story,
			theme,
			"gap browser->canvas",
			m.gapBrowserCanvas,
			contract.gaps[1],
		);
		check(story, theme, "badge drawn", Boolean(m.badge), contract.badge);
		if (contract.clearanceAtLeast !== undefined && m.badgeClearance !== null) {
			if (m.badgeClearance < contract.clearanceAtLeast) {
				problems.push(
					`${story} @ ${theme}: badgeClearance is ${m.badgeClearance}, contract says >= ${contract.clearanceAtLeast} (the ring must not be painted inside the canvas button's box)`,
				);
			}
		}
		/* The anti-pattern's own trace, in every state: a component that owns its
		 * outer margin shows up here and nowhere else. */
		check(story, theme, "browserMarginRight", m.browserMarginRight, "0px");
		if (BADGE_TEXT !== null && contract.badge && !badgeTextOverridden) {
			problems.push(
				`${story} @ ${theme}: --badge-text=${BADGE_TEXT} was asked for but no badge was on the page to write it into`,
			);
		}
	}

	/*
	 * PALETTE AGREEMENT is part of the contract rather than a reading: a gap is a
	 * layout fact, so the two brand palettes must produce identical boxes. A
	 * difference would mean something other than the container is deciding the
	 * spacing - the failure a fix on the container exists to make impossible.
	 */
	const byStory = new Map();
	for (const r of results) {
		byStory.set(r.story, [...(byStory.get(r.story) ?? []), r]);
	}
	for (const [story, rows] of byStory) {
		const [first, ...rest] = rows;
		for (const other of rest) {
			if (JSON.stringify(first.measured) !== JSON.stringify(other.measured)) {
				problems.push(
					`${story}: ${first.theme} and ${other.theme} disagree - a spacing fact must be palette-independent`,
				);
			}
		}
	}

	/*
	 * THE MOVEMENT, judged and printed. This is the number round 1 got wrong, and a
	 * reviewer should be able to read it here rather than subtract it out of two box
	 * rows by hand.
	 */
	const movement = [];
	for (const theme of [...new Set(results.map((r) => r.theme))]) {
		const from = results.find(
			(r) => r.story === MOVEMENT_PAIR[0] && r.theme === theme,
		);
		const to = results.find(
			(r) => r.story === MOVEMENT_PAIR[1] && r.theme === theme,
		);
		if (!from || !to) continue;
		const rows = [
			["cluster width", from.measured.clusterWidth, to.measured.clusterWidth],
			["trigger left", from.measured.trigger.left, to.measured.trigger.left],
			["browser left", from.measured.browser.left, to.measured.browser.left],
			["canvas left", from.measured.canvas.left, to.measured.canvas.left],
			[
				"gap t->b",
				from.measured.gapTriggerBrowser,
				to.measured.gapTriggerBrowser,
			],
			[
				"gap b->c",
				from.measured.gapBrowserCanvas,
				to.measured.gapBrowserCanvas,
			],
		];
		const deltas = {
			clusterWidth: to.measured.clusterWidth - from.measured.clusterWidth,
			triggerLeft: to.measured.trigger.left - from.measured.trigger.left,
			browserLeft: to.measured.browser.left - from.measured.browser.left,
			canvasLeft: to.measured.canvas.left - from.measured.canvas.left,
			gapTriggerBrowser:
				to.measured.gapTriggerBrowser - from.measured.gapTriggerBrowser,
			gapBrowserCanvas:
				to.measured.gapBrowserCanvas - from.measured.gapBrowserCanvas,
		};
		/*
		 * The cross-state delta is compared per theme rather than once, because a
		 * palettes-disagree finding above already says the two trees differ - and
		 * movement is exactly the arithmetic a reader cannot check by eye across two
		 * stills, which is why this file exists at all.
		 */
		for (const [field, expected] of Object.entries(MOVEMENT_CONTRACT)) {
			if (deltas[field] !== expected) {
				problems.push(
					`MOVEMENT @ ${theme}: ${field} moves ${deltas[field]}px, contract says ${expected}px`,
				);
			}
		}
		const signed = (n) => `${n >= 0 ? "+" : ""}${Math.round(n * 10) / 10}`;
		movement.push(`  ${theme}`);
		for (const [label, a, b] of rows) {
			movement.push(
				`  ${label.padEnd(15)} ${a} -> ${b}  (${signed(Math.round((b - a) * 10) / 10)})`,
			);
		}
		movement.push(
			`  ${"badge clearance".padEnd(15)} ${from.measured.badgeClearance} -> ${to.measured.badgeClearance}`,
		);
	}

	if (AS_JSON) {
		console.log(
			JSON.stringify(
				{ origin: ORIGIN, badgeText: BADGE_TEXT, problems, results },
				null,
				2,
			),
		);
		if (problems.length) process.exitCode = 1;
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
			`  badge         ${m.badge ? `text=${JSON.stringify(m.badgeText)}  left=${m.badge.left}  right=${m.badge.right}  width=${m.badge.width}  ring=${m.badgeRingPx}  outerRight=${m.badgeOuterRight}  clearance=${m.badgeClearance}  toGlyph=${m.badgeToGlyph}  glyphOverlapY=${m.badgeGlyphBoxOverlapY}` : "none"}`,
		);
		console.log(
			`  dot           ${m.dot ? `left=${m.dot.left}  right=${m.dot.right}  overhang=${m.dotOverhang}  clearance=${m.dotClearance}  toGlyph=${m.dotToGlyph}` : "none"}`,
		);
		console.log(
			`  transitions   cluster=[${m.transitions.cluster}] ${m.transitions.clusterDuration}  browser=[${m.transitions.browser}] ${m.transitions.browserDuration}`,
		);
		const rowProblems = problems.filter((p) =>
			p.startsWith(`${story} @ ${theme}:`),
		);
		console.log(`  VERDICT       ${rowProblems.length ? "FAIL" : "PASS"}`);
		for (const p of rowProblems) {
			console.log(`    - ${p.slice(`${story} @ ${theme}: `.length)}`);
		}
	}

	if (movement.length) {
		console.log(`\nMOVEMENT  ${MOVEMENT_PAIR[0]} -> ${MOVEMENT_PAIR[1]}`);
		console.log(movement.join("\n"));
	}

	console.log(
		`\nVERDICT: ${results.length} states checked, ${problems.length ? `${problems.length} contract violation${problems.length === 1 ? "" : "s"}` : "all match the contract"}`,
	);
	if (problems.length) {
		for (const p of problems) console.log(`  - ${p}`);
		console.log(
			"This is not the geometry the change promises - see CONTRACT and MOVEMENT_CONTRACT in this file.",
		);
		process.exitCode = 1;
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
