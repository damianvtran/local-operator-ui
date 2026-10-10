#!/usr/bin/env node
/**
 * The chat out-of-credits guidance's numbers: the action row's insertion shift
 * while the account read is in flight (design round 1, D1) and the 420-wide
 * wrap readings for the longest copy (D2).
 *
 *     node scripts/radient-credits-geometry.mjs [storybook-origin] [--json]
 *
 * WHY A PROBE AND NOT A FRAME. The guidance box renders only once the account
 * read settles, and it is inserted ABOVE the action row - so the ghost action
 * ("Open Radient account") is displaced by an insertion the moment a slow read
 * lands: right by the CTA's width plus the row's gap, down by the box's height
 * plus the same gap. A single still cannot show a displacement, and an unpaired
 * pair shows two plausible layouts - the ask is "how far did the edge move",
 * which is a number. This probe holds the account read with a script installed
 * via `Page.addScriptToEvaluateOnNewDocument` (which runs before any page
 * script, so the story's own `window.api` assignment is WRAPPED rather than
 * raced), measures the pre-settle row, lets the held read land, and measures
 * the settled row in the SAME page - so the delta is one layout's two
 * geometries, not two runs'.
 *
 * D2's readings are the same `getBoundingClientRect` numbers the evidence
 * README's table records, at 420 wide: the two states with the longest copy
 * (`unverified-pending`, `unverified-expired`) plus `account-unreadable`, whose
 * committed numbers (box 316 wide, overflow 0) this run re-measures with the
 * same probe - a rig check beside the two new rows, not a new claim. Each
 * reading reports the box's width and per-paragraph line counts, every action
 * button's wrap point, and the overflow number for the box, the action row and
 * the document.
 *
 * Raw CDP against a private headless Chrome, deliberately the same approach as
 * `capture-evidence.mjs` and its sibling probes: a fresh user-data-dir under
 * the system temp dir (point TMPDIR at a scratch root to keep it out of the
 * shared `/tmp`), no browser-automation dependency added to the repo, and ONE
 * browser serves both phases - the rig's cost is per LAUNCH, not per story.
 *
 * The browser is killed by PROCESS GROUP first (it is spawned detached, so its
 * pid is the group's), then by exact pid, and its profile directory removed;
 * that ordering is the no-orphans rule this fleet measured the hard way.
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

/**
 * How long the account read is held, in ms.
 *
 * The pre-settle window runs from the guidance component's mount to the held
 * answer's arrival, so this is the room the first probe has to catch the
 * un-inserted row in - long enough that a cold story page under this fleet's
 * load paints with time to spare, short enough that the settled half follows
 * promptly. A miss (the box present when the pre reading runs) reloads once
 * with a fresh hold rather than recording a zero shift that never happened.
 */
const HOLD_MS = 12_000;

/**
 * The in-flight states, one per account answer the guidance can take. The
 * `non-radient-rate-limit` control is deliberately absent: it never renders
 * the guidance box, so there is no insertion to measure.
 */
const INFLIGHT_STATES = [
	"unverified-pending",
	"unverified-expired",
	"unverified-none",
	"verified-bonus-available",
	"verified-bonus-received",
	"verified-older-backend",
	"account-unreadable",
];

/**
 * The 420-wide states: the two longest copy blocks, and the one the README
 * already commits numbers for (this probe must reproduce them to be the same
 * rig that produced the new ones).
 */
const NARROW_STATES = [
	"unverified-pending",
	"unverified-expired",
	"account-unreadable",
];

/**
 * The wrapper that holds the account read, installed before any page script.
 *
 * It wraps `window.api`'s `desktop.request` at ASSIGNMENT time - first via the
 * `window.api` accessor, then via a `desktop` accessor on whatever object the
 * page assigns - because the story replaces `api.desktop` wholesale, and a
 * plain post-hoc patch would be dropped by that assignment. `request.control.
 * operation === "account"` is the one op held; capabilities and prices must
 * answer normally or the page never reaches its pre-settle layout at all.
 */
const HOLD_SCRIPT = `(() => {
	const HOLD_MS = ${HOLD_MS};
	const isAccountRead = (request) =>
		!!request && !!request.control && request.control.operation === "account";
	const wrap = (desktop) => {
		if (!desktop || typeof desktop.request !== "function") return desktop;
		if (desktop.__loHoldInstalled) return desktop;
		const original = desktop.request;
		const held = async (request) => {
			if (isAccountRead(request))
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
		let value;
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
		 * created - never a name match.
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
		/* `maxRetries`: SIGKILL returns before the kernel reaps, and the
		   profile keeps being written for a few ms (sibling probes' note). */
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
 * `ghost` is the "Open Radient account" link the guidance always renders (its
 * action prop), selected by its route rather than a data attribute - there is
 * none on the row, and the route is the action's own contract. The box carries
 * `data-radient-credits-state` (the component's own hook for the capture's
 * shutter). Overflow numbers are `scrollWidth - clientWidth`, the spelling the
 * README's claims use. A paragraph's line count is its text range's client
 * rects - one rect per rendered line, which is what "wrapped over N lines"
 * means.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {
			left: round(r.left),
			top: round(r.top),
			right: round(r.right),
			bottom: round(r.bottom),
			width: round(r.width),
			height: round(r.height),
		};
	};
	const overflow = (el) => (el ? el.scrollWidth - el.clientWidth : null);
	const ghost = document.querySelector('a[href*="section=radient"]');
	const box = document.querySelector("[data-radient-credits-state]");
	const actions = ghost ? ghost.parentElement : null;
	return {
		ghost: rect(ghost),
		actionsRow: rect(actions),
		box: rect(box),
		boxState: box ? box.getAttribute("data-radient-credits-state") : null,
		boxOverflow: overflow(box),
		actionsOverflow: overflow(actions),
		documentOverflow:
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
		paragraphs: box
			? [...box.querySelectorAll("p")].map((p) => {
					const range = document.createRange();
					range.selectNodeContents(p);
					return {
						text: (p.textContent ?? "").trim().slice(0, 48),
						lines: range.getClientRects().length,
						height: round(p.getBoundingClientRect().height),
					};
				})
			: [],
		buttons: actions
			? [...actions.children].map((el) => ({
					text: (el.textContent ?? "").trim(),
					...rect(el),
				}))
			: [],
	};
})()`;

/*
 * The two row states the poll waits for, each self-contained: the story page
 * is ready (Storybook's loader gone; fonts resolved, because `ch` was the
 * measure the layout used until the loaded face arrives) AND the row is in the
 * state asked about - the pre-settle row has the ghost action and no box; the
 * settled row has the box.
 */
const PRE_SETTLE_ROW = `(() => {
	const loading = [...document.querySelectorAll(
		".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
	)].some((el) => el.getBoundingClientRect().height > 0);
	if (loading) return false;
	if (document.fonts.status !== "loaded") return false;
	const ghost = document.querySelector('a[href*="section=radient"]');
	const box = document.querySelector("[data-radient-credits-state]");
	return !!ghost && !box;
})()`;
const SETTLED_ROW = `(() => {
	const loading = [...document.querySelectorAll(
		".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
	)].some((el) => el.getBoundingClientRect().height > 0);
	if (loading) return false;
	if (document.fonts.status !== "loaded") return false;
	return !!document.querySelector("[data-radient-credits-state]");
})()`;

/**
 * Poll an expression until it answers `true`, or give up.
 *
 * Polled rather than slept on: a fixed delay long enough for a cold start on a
 * loaded machine is paid by every story, and one short enough to be cheap is
 * the intermittency the sibling probes document.
 */
const waitFor = async (cdp, expression, attemptMs = 100, attempts = 450) => {
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

const openStory = async (cdp, story, width, height) => {
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
};

const readProbe = async (cdp) =>
	(
		await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: PROBE,
		})
	).result.value;

/**
 * The in-flight pair: catch the pre-settle row, then the same page's settled
 * row. One reload is allowed when the hold is missed (the box already present
 * at the first reading would silently record a shift of zero that never
 * happened); a second miss is an error rather than a number.
 */
const probeInflight = async (cdp, state) => {
	const story = `chat-radient-out-of-credits--${state}`;
	for (let attempt = 0; attempt < 2; attempt++) {
		await openStory(cdp, story, 1280, 260);
		if (!(await waitFor(cdp, PRE_SETTLE_ROW))) continue;
		await settleFrame(cdp);
		const pre = await readProbe(cdp);
		if (pre.box) continue; // raced past the hold; reload and retry
		if (!(await waitFor(cdp, SETTLED_ROW))) {
			throw new Error(`${story}: the held read never settled`);
		}
		await settleFrame(cdp);
		const post = await readProbe(cdp);
		return { story, state, viewport: "1280x260", pre, post };
	}
	throw new Error(
		`${story}: could not catch the pre-settle row within two attempts`,
	);
};

/** The 420-wide single reading, once the box has settled. */
const probeNarrow = async (cdp, state) => {
	const story = `chat-radient-out-of-credits--${state}`;
	await openStory(cdp, story, 420, 620);
	if (!(await waitFor(cdp, SETTLED_ROW))) {
		throw new Error(`${story} @ 420x620: the box never appeared`);
	}
	await settleFrame(cdp);
	const reading = await readProbe(cdp);
	return { story, state, viewport: "420x620", reading };
};

const fmtRect = (r) =>
	r
		? `left=${r.left} top=${r.top} right=${r.right} (${r.width}x${r.height})`
		: "absent";
const shift = (a, b) =>
	a == null || b == null ? null : Math.round((b - a) * 10) / 10;

const reportInflight = (row) => {
	console.log(`\n${row.story}  @ ${row.viewport}  (${ORIGIN}, ${THEME})`);
	console.log(
		`  pre   box=absent  ghost=${fmtRect(row.pre.ghost)}  actions=${fmtRect(row.pre.actionsRow)}`,
	);
	console.log(
		`  post  box=${fmtRect(row.post.box)} state=${row.post.boxState}  ghost=${fmtRect(row.post.ghost)}`,
	);
	console.log(
		`  SHIFT ghost right=${shift(row.pre.ghost?.left, row.post.ghost?.left)}  down=${shift(row.pre.ghost?.top, row.post.ghost?.top)}`,
	);
};

const reportNarrow = (row) => {
	const { reading } = row;
	console.log(`\n${row.story}  @ ${row.viewport}  (${ORIGIN}, ${THEME})`);
	console.log(
		`  box         ${fmtRect(reading.box)} state=${reading.boxState} overflow=${reading.boxOverflow}`,
	);
	for (const [i, p] of reading.paragraphs.entries()) {
		console.log(
			`  paragraph ${i} lines=${p.lines} height=${p.height} "${p.text}"`,
		);
	}
	for (const [i, b] of reading.buttons.entries()) {
		console.log(
			`  button ${i}    "${b.text}" left=${b.left} top=${b.top} right=${b.right} (${b.width}x${b.height})`,
		);
	}
	console.log(
		`  overflow    actions=${reading.actionsOverflow}  document=${reading.documentOverflow}`,
	);
};

const main = async () => {
	dataDir = join(tmpdir(), `lo-radient-geometry-${process.pid}`);
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

	/*
	 * Phase 1 with the hold installed; phase 2 without it (the hold exists to
	 * make the pre-settle moment measureable, and the narrow readings are
	 * settled-state numbers that should not pay twelve seconds each for it).
	 */
	const { identifier } = await cdp.send(
		"Page.addScriptToEvaluateOnNewDocument",
		{ source: HOLD_SCRIPT },
	);
	const inflight = [];
	for (const state of INFLIGHT_STATES) {
		inflight.push(await probeInflight(cdp, state));
	}
	await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });

	const narrow = [];
	for (const state of NARROW_STATES) {
		narrow.push(await probeNarrow(cdp, state));
	}

	if (AS_JSON) {
		console.log(
			JSON.stringify(
				{ origin: ORIGIN, theme: THEME, inflight, narrow },
				null,
				2,
			),
		);
		return;
	}
	for (const row of inflight) reportInflight(row);
	for (const row of narrow) reportNarrow(row);
};

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		teardown();
		process.exit(1);
	});
}

main()
	.then(() => {
		teardown();
		/*
		 * Exit explicitly: the CDP WebSocket can keep this process alive after
		 * the browser it points at is gone - measured on the first run of this
		 * rig, where the report printed, the browser and its profile were reaped,
		 * and the event loop still held the socket. The numbers are on stdout by
		 * now; a reviewer running this rig gets a prompt return rather than a
		 * Ctrl-C.
		 */
		process.exit(0);
	})
	.catch((error) => {
		teardown();
		console.error(error);
		process.exit(1);
	});
