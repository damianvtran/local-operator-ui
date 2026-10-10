#!/usr/bin/env node
/**
 * The quota notice's composer-geometry numbers: the pair that design round 1's
 * D1 (and the review's R1-M3, UX's U6) asked for.
 *
 *     node scripts/quota-notice-geometry.mjs [storybook-origin] [--json]
 *
 * WHY A PROBE AND NOT ONLY FRAMES. The defect was a NUMBER — the bottom-anchored
 * composer's top edge moves when the line mounted below it (measured by UX:
 * 682 -> 645 with a 37px line, 682 -> 628 with a 54px one, the arrival landing
 * ~2 s after first paint on a cold load). The same class of evidence decides the
 * fix: the line is now a band child ABOVE the foot, and the claim is that the
 * foot's top edge is identical with and without it. A pair of stills shows the
 * two states; only the rects show that nothing moved, so this probe measures
 * `[data-lo-composer-foot]`'s top in BOTH states, in the SAME page, for both
 * transitions (arrival and dismissal), on the REAL `MessageInput` story.
 *
 * HOW THE ARRIVAL IS CAUGHT. `quota.notice` is held for HOLD_MS by a script
 * installed through `Page.addScriptToEvaluateOnNewDocument` — which runs before
 * any page script, so the story's own `window.api` assignment is WRAPPED rather
 * than raced (the technique `radient-credits-geometry.mjs` states). That gives
 * a stable pre-line page to measure; the post-line reading is the same page
 * after the held answer lands.
 *
 * Raw CDP against a private headless Chrome, deliberately the same approach as
 * `capture-evidence.mjs` and its sibling probes: a fresh user-data-dir under the
 * system temp dir, no browser-automation dependency in the repo, ONE browser for
 * both phases, and the browser reaped by PROCESS GROUP first and exact pid
 * second (the no-orphans rule this fleet measured the hard way).
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

/** Chrome's own announcement of the debugging endpoint, read off its stderr. */
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

/** The theme both phases read in; the geometry is theme-independent. */
const THEME = "localOperatorLight";

/** The story under test: the real composer, notice fixture on. */
const STORY = "chat-message-input--quota-notice";

/** The viewport: the composer stories' own width, tall enough to dock. */
const WIDTH = 1024;
const HEIGHT = 820;

/**
 * How long the verdict is held, in ms.
 *
 * The pre-line window runs from first paint to the held answer's arrival: long
 * enough that the composer has settled (and a probe run has caught it), short
 * enough that the post arm follows promptly. A miss reloads once rather than
 * recording a delta that never happened.
 */
const HOLD_MS = 6000;

/** The wrapper that holds the verdict read, installed before any page script. */
const HOLD_SCRIPT = `(() => {
	const HOLD_MS = ${HOLD_MS};
	const isNoticeRead = (request) => !!request && request.op === "quota.notice";
	const wrap = (desktop) => {
		if (!desktop || typeof desktop.request !== "function") return desktop;
		if (desktop.__loHoldInstalled) return desktop;
		const original = desktop.request;
		const held = async (request) => {
			if (isNoticeRead(request))
				await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
			return original(request);
		};
		held.__loHoldInstalled = true;
		return { ...desktop, request: held };
	};
	let installed = null;
	const install = (api) => {
		if (!api || installed === api) return;
		installed = api;
		/*
		 * The CURRENT value is captured and wrapped too, not just later
		 * assignments: the composer stories build their api object with the
		 * desktop property in ONE literal, so the new object already carries its
		 * desktop when the setter fires — replacing the property without keeping
		 * that value would leave api.desktop undefined and every op in the page
		 * failing.
		 */
		let value = wrap(api.desktop);
		Object.defineProperty(api, "desktop", {
			configurable: true,
			get: () => value,
			set: (next) => {
				value = wrap(next);
			},
		});
	};
	let api;
	Object.defineProperty(window, "api", {
		configurable: true,
		get: () => api,
		set: (next) => {
			api = next;
			install(next);
		},
	});
})();`;

/** A minimal CDP client (the shape the sibling probes use). */
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
		/*
		 * Process group first: the browser is spawned detached, so its pid is
		 * the group's, and renderer/utility children die with it. The direct
		 * kill follows as a fallback; both are scoped to the pid this script
		 * created — never a name match.
		 */
		try {
			process.kill(-chrome.pid, "SIGKILL");
		} catch {
			/* the group may already be gone */
		}
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The measurement, evaluated in the page.
 *
 * The subject is `[data-lo-composer-foot]` — the docked composer's own node,
 * the one the band hands to the suggestion cap — so the number is about the
 * composer, not about the band. The splash's height rides along: it is the
 * space the line borrows, and the claim is that it (not the foot) pays.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { top: round(r.top), bottom: round(r.bottom), height: round(r.height) };
	};
	return {
		foot: rect(document.querySelector("[data-lo-composer-foot]")),
		splash: rect(document.querySelector("[data-lo-composer-splash]")),
		line: rect(document.querySelector("[data-quota-notice-line]")),
		lineText: (document.querySelector("[data-quota-notice-body]")?.textContent ?? "").trim().slice(0, 40),
	};
})()`;

const readProbe = async (cdp) =>
	(
		await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: PROBE,
		})
	).result.value;

/**
 * Poll an expression until it answers `true`, or give up.
 */
const waitFor = async (cdp, expression, attemptMs = 100, attempts = 600) => {
	for (let i = 0; i < attempts; i++) {
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression,
		});
		if (result.value === true) return true;
		await sleep(attemptMs);
	}
	return false;
};

/** One settled frame after layout, so the rects are post-reflow. */
const settleFrame = (cdp) =>
	cdp.send("Runtime.evaluate", {
		awaitPromise: true,
		expression:
			"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
	});

const PAGE_READY = `(() => {
	const loading = [...document.querySelectorAll(
		".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
	)].some((el) => el.getBoundingClientRect().height > 0);
	if (loading) return false;
	if (document.fonts.status !== "loaded") return false;
	return !!document.querySelector("[data-lo-composer-foot]");
})()`;

const LINE_PRESENT = `!!document.querySelector("[data-quota-notice-line]")`;
const LINE_GONE = `!document.querySelector("[data-quota-notice-line]")`;

const openStory = async (cdp, width, height) => {
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.navigate", { url: "about:blank" });
	await sleep(120);
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=${STORY}&viewMode=story&args=theme:${THEME}`,
	});
};

/**
 * Phase A: with the verdict held, measure the docked foot before the line
 * arrives and after. One reload is allowed when the hold is missed.
 */
const probeArrival = async (cdp, withHold) => {
	let holdIdentifier = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (withHold) {
			const installed = await cdp.send(
				"Page.addScriptToEvaluateOnNewDocument",
				{ source: HOLD_SCRIPT },
			);
			holdIdentifier = installed.identifier ?? holdIdentifier;
		}
		await openStory(cdp, WIDTH, HEIGHT);
		if (!(await waitFor(cdp, PAGE_READY))) continue;
		await settleFrame(cdp);
		const pre = await readProbe(cdp);
		if (pre.line) continue; // raced past the hold; reload and retry
		if (!(await waitFor(cdp, LINE_PRESENT))) {
			throw new Error(`${STORY}: the held verdict never arrived`);
		}
		await settleFrame(cdp);
		const post = await readProbe(cdp);
		return { pre, post, holdIdentifier };
	}
	throw new Error(
		`${STORY}: could not catch the pre-line page within two attempts`,
	);
};

/** Phase B: the line already there; press Dismiss and measure again. */
const probeDismissal = async (cdp) => {
	await openStory(cdp, WIDTH, HEIGHT);
	if (!(await waitFor(cdp, PAGE_READY)))
		throw new Error(`${STORY}: page never painted`);
	if (!(await waitFor(cdp, LINE_PRESENT)))
		throw new Error(`${STORY}: the line never appeared`);
	await settleFrame(cdp);
	const withLine = await readProbe(cdp);

	const { result } = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		expression: `(() => {
			const button = document.querySelector("[data-quota-notice-dismiss]");
			if (!button) return null;
			const r = button.getBoundingClientRect();
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`,
	});
	const point = result.value;
	if (!point) throw new Error(`${STORY}: the Dismiss control was not found`);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: point.x,
			y: point.y,
			button: "left",
			clickCount: 1,
		});
	}
	if (!(await waitFor(cdp, LINE_GONE))) {
		throw new Error(`${STORY}: Dismiss did not clear the line`);
	}
	await settleFrame(cdp);
	const withoutLine = await readProbe(cdp);
	return { withLine, withoutLine };
};

const shift = (a, b) =>
	a == null || b == null ? null : Math.round((b - a) * 10) / 10;
const fmtRect = (r) =>
	r ? `top=${r.top} bottom=${r.bottom} (h ${r.height})` : "absent";

const main = async () => {
	dataDir = join(tmpdir(), `lo-quota-geometry-${process.pid}`);
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
		{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
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

	const arrival = await probeArrival(cdp, true);
	/*
	 * The hold script is armed per document, so it would slow phase B's
	 * navigation too — remove it now that the arrival pair is captured.
	 */
	if (arrival.holdIdentifier) {
		try {
			await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
				identifier: arrival.holdIdentifier,
			});
		} catch {
			/* Already gone (a retry's re-arm); harmless. */
		}
	}
	const dismissal = await probeDismissal(cdp);

	const arrivalShift = shift(arrival.pre.foot?.top, arrival.post.foot?.top);
	const dismissalShift = shift(
		dismissal.withLine.foot?.top,
		dismissal.withoutLine.foot?.top,
	);
	/*
	 * THE CLEARANCE (design D6): the bottom margin between the line's action row
	 * and the composer box, i.e. foot.top minus line.bottom in the with-line
	 * readings. Zero was the finding; 8 is `mb-2`; the floor checked below is
	 * the claim that a visible gap exists rather than a pixel budget.
	 */
	const arrivalClearance = arrival.post.line
		? shift(arrival.post.line.bottom, arrival.post.foot?.top)
		: null;
	const dismissalClearance = dismissal.withLine.line
		? shift(dismissal.withLine.line.bottom, dismissal.withLine.foot?.top)
		: null;
	const result = {
		story: STORY,
		viewport: `${WIDTH}x${HEIGHT}`,
		theme: THEME,
		arrival: {
			preFoot: arrival.pre.foot,
			postFoot: arrival.post.foot,
			preSplash: arrival.pre.splash,
			postSplash: arrival.post.splash,
			postLine: arrival.post.line,
			footTopShift: arrivalShift,
			clearance: arrivalClearance,
		},
		dismissal: {
			withLineFoot: dismissal.withLine.foot,
			withoutLineFoot: dismissal.withoutLine.foot,
			withLineSplash: dismissal.withLine.splash,
			withoutLineSplash: dismissal.withoutLine.splash,
			withLineLine: dismissal.withLine.line,
			footTopShift: dismissalShift,
			clearance: dismissalClearance,
		},
	};

	if (AS_JSON) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`\n${STORY}  @ ${result.viewport}  (${ORIGIN}, ${THEME})`);
		console.log(
			`  arrival     foot ${fmtRect(arrival.pre.foot)}  ->  ${fmtRect(arrival.post.foot)}`,
		);
		console.log(
			`              splash h ${arrival.pre.splash?.height} -> ${arrival.post.splash?.height}  (the space the line took)`,
		);
		console.log(`              FOOT TOP SHIFT ${arrivalShift}`);
		console.log(
			`              line bottom ${arrival.post.line?.bottom} -> foot top ${arrival.post.foot?.top}  CLEARANCE ${arrivalClearance}`,
		);
		console.log(
			`  dismissal   foot ${fmtRect(dismissal.withLine.foot)}  ->  ${fmtRect(dismissal.withoutLine.foot)}`,
		);
		console.log(
			`              splash h ${dismissal.withLine.splash?.height} -> ${dismissal.withoutLine.splash?.height}`,
		);
		console.log(`              FOOT TOP SHIFT ${dismissalShift}`);
		console.log(
			`              line bottom ${dismissal.withLine.line?.bottom} -> foot top ${dismissal.withLine.foot?.top}  CLEARANCE ${dismissalClearance}`,
		);
	}

	const moved = [arrivalShift, dismissalShift].some(
		(value) => value === null || Math.abs(value) > 1,
	);
	if (moved) {
		console.error(
			"\nFAIL: the composer moved. The line must be a band child above the foot so the splash yields; a shift here means it is back inside the form, or the splash cannot shrink (give it min-h-0).",
		);
		process.exitCode = 1;
	}
	/*
	 * A present line must have a visible gap above the composer (D6): clearance 0
	 * is the flush-on-the-border defect and a negative one is an overlap.
	 */
	const cramped = [arrivalClearance, dismissalClearance].some(
		(value) => value === null || value < 4,
	);
	if (cramped) {
		console.error(
			`\nFAIL: the line's action row has no clearance above the composer (arrival ${arrivalClearance} / dismissal ${dismissalClearance} px; need >= 4 from the wrapper's mb-2).`,
		);
		process.exitCode = 1;
	}
};

try {
	await main();
} finally {
	teardown();
}
