#!/usr/bin/env node
/**
 * Measure and photograph scroll-driven history paging in the REAL renderer.
 *
 *     node scripts/scroll-paging-evidence.mjs <cdp-port> <session-id> <out-dir> <mode>
 *
 * Modes: `before` (main's click-only behaviour), `after` (this branch).
 *
 * Drives the app already running under `electron-vite dev` over raw CDP, the
 * same way `scripts/send-error-evidence.mjs` does: Node's built-in WebSocket
 * speaks the DevTools protocol directly, so there is no browser-automation
 * dependency in the repo and nothing is installed to take a picture.
 *
 * Why `Input.dispatchMouseEvent` rather than setting `scrollTop`. The whole
 * claim of this change is about which motion counts as a reader asking for
 * history. Writing `scrollTop` produces a `scroll` event and NO input event,
 * which is precisely the case the implementation is required to ignore — so a
 * harness that scrolled that way would either prove nothing or, worse, pass
 * against an implementation that had reintroduced the bug. `mouseWheel` events
 * dispatched through the browser's own input pipeline arrive at the renderer
 * indistinguishable from a trackpad's, which is the only dispatch that
 * exercises the path under test.
 *
 * What is measured, per reveal:
 *
 * - the anchor row's backend id and its offset from the scroller's top edge,
 *   sampled before the gesture and after the content settles (clause E);
 * - the largest frame-to-frame displacement of that row while no further input
 *   is being sent, sampled every animation frame through the settle (the
 *   jitter number: a reveal can end where it started and still have lurched);
 * - the number of `sessions.history` requests the main process issued, read
 *   from the CDP network log rather than from anything the page says about
 *   itself (clause B).
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = process.argv[2] ?? "http://localhost:5199";
const SESSION = process.argv[3];
const OUT = process.argv[4] ?? "docs/evidence/transcript-scroll-paging";
const MODE = process.argv[5] ?? "after";

if (!SESSION) {
	console.error(
		"usage: scroll-paging-evidence.mjs <app-origin> <session-id> <out> <mode>",
	);
	process.exit(1);
}

/*
 * A PRIVATE Chromium, launched here and killed on exit, exactly as
 * `scripts/capture-evidence.mjs` does for Storybook: a fresh user-data-dir
 * under /tmp, raw CDP over Node's built-in WebSocket, and no
 * browser-automation dependency added to the repo.
 *
 * Why the browser rather than the Electron window. This is the repo's
 * documented browser-development surface (docs/desktop-controls.md, "Browser
 * development"): the same shipped renderer bundle and the same typed desktop
 * vocabulary, served at same-origin `POST /__desktop` by `desktopProxyPlugin`
 * against a real `local-operator serve` backend. What it does NOT exercise is
 * the Electron main/preload IPC transport and the packaged build; the README
 * states that explicitly rather than implying coverage this does not have.
 */
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dataDir = join(tmpdir(), `lo-paging-cdp-${process.pid}`);
mkdirSync(dataDir, { recursive: true });
const chrome = spawn(CHROME, [
	"--headless=new",
	"--no-sandbox",
	"--disable-gpu",
	// Scrollbars are left ON: a scrollbar drag is one of the four input kinds
	// the behaviour under test must honour, and hiding them would remove it.
	`--window-size=1380,872`,
	`--user-data-dir=${dataDir}`,
	"--remote-debugging-port=0",
	"about:blank",
]);
const browserWs = await new Promise((resolve, reject) => {
	let buf = "";
	const timer = setTimeout(
		() => reject(new Error("Chrome did not report a debug port")),
		30_000,
	);
	chrome.stderr.on("data", (chunk) => {
		buf += chunk.toString();
		const hit = buf.match(/ws:\/\/[^\s]+/);
		if (hit) {
			clearTimeout(timer);
			resolve(hit[0]);
		}
	});
});
const cleanup = () => {
	try {
		chrome.kill();
	} catch {}
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {}
};
process.on("exit", cleanup);

const browserId = new URL(browserWs).pathname.split("/").pop();
const list = await (
	await fetch(`http://127.0.0.1:${new URL(browserWs).port}/json/list`)
).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no page target in the private Chromium");
void browserId;

let nextId = 1;
const pending = new Map();
/** Every `sessions.history` op the renderer issued, in order. See clause B. */
const historyRequests = [];
/** Every desktop op, so a zero above can be told apart from a dead counter. */
const desktopOps = [];
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.method === "Network.requestWillBeSent") {
		/*
		 * Count the op out of the POST BODY, not out of the URL.
		 *
		 * Every desktop op posts to the same same-origin `/__desktop` endpoint
		 * with the op name in the JSON body (`desktop-api.ts`), so no request URL
		 * on this surface ever contains "/history". The previous predicate
		 * (`url.includes("/history")`) could therefore never match, and would have
		 * reported 0 for any behaviour whatsoever -- including a fling that issued
		 * forty pages -- while reading as proof of coalescing. A counter that
		 * cannot fire is worse than no counter, because it produces a number.
		 *
		 * `desktopOps` exists as the positive control: if it is 0 too, the harness
		 * saw no traffic at all and the history count means nothing.
		 */
		const url = msg.params?.request?.url ?? "";
		if (url.includes("/__desktop")) {
			let op = null;
			try {
				op = JSON.parse(msg.params.request.postData ?? "{}").op ?? null;
			} catch {
				// A body we cannot parse is still traffic; record it as unknown so
				// it cannot masquerade as silence.
				op = "<unparsed>";
			}
			desktopOps.push({ op, at: Date.now() });
			if (op === "sessions.history")
				historyRequests.push({ op, at: Date.now() });
		}
	}
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error
			? reject(new Error(JSON.stringify(msg.error)))
			: resolve(msg.result);
	}
};
await new Promise((r) => (ws.onopen = r));

const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});

async function evaluate(expression) {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails)
		throw new Error(
			JSON.stringify(
				res.exceptionDetails.exception?.description ?? res.exceptionDetails,
			),
		);
	return res.result.value;
}

/*
 * WebP, because `check-evidence.mjs` only sweeps `.webp`.
 *
 * Round 1 committed PNGs here, which meant the guard never enumerated them:
 * they were never ΔE-tested and never uniformity-tested, while the PR quoted
 * the guard's frame count as though they had cleared it. A frame outside the
 * guard is a frame nobody checks, so the format is the guard's, and Chromium
 * encodes it directly rather than needing a conversion step.
 */
async function shot(name) {
	mkdirSync(OUT, { recursive: true });
	const { data } = await send("Page.captureScreenshot", {
		format: "webp",
		quality: 90,
	});
	const path = join(OUT, `${name}.webp`);
	writeFileSync(path, Buffer.from(data, "base64"));
	return path;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Network.enable");
await send("Runtime.enable");
await send("Page.enable");

/* The scroller, and the row at the top of the viewport with its offset. The
   same identity the implementation anchors on, read independently here. */
const PROBE = `(() => {
  const el = document.querySelector('[data-lo-canonical-transcript]');
  if (!el) return { ok: false, reason: 'no transcript' };
  const top = el.getBoundingClientRect().top;
  let anchor = null;
  for (const row of el.querySelectorAll('[data-record-id]')) {
    const r = row.getBoundingClientRect();
    if (r.bottom > top) { anchor = { id: row.dataset.recordId, offset: r.top - top }; break; }
  }
  const slot = el.querySelector('[data-lo-canonical-transcript] > div > div');
  return {
    ok: true,
    anchor,
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    distanceFromTop: Math.max(0, el.scrollHeight - el.clientHeight - Math.abs(el.scrollTop)),
    rows: el.querySelectorAll('[data-record-id]').length,
    slotText: (el.querySelector('button, [data-lo-canonical-transcript] span')?.textContent ?? '').trim().slice(0, 60),
    topText: el.querySelector('[data-record-id]')?.textContent?.trim().slice(0, 40) ?? null,
  };
})()`;

const probe = () => evaluate(PROBE);

/**
 * Sample the anchor row every animation frame for `ms`, with NO input being
 * sent, and report the largest frame-to-frame displacement.
 *
 * This is the jitter measurement, and it is deliberately separate from the
 * before/after offsets: a reveal that ends exactly where it started has a
 * perfect delta and may still have lurched a hundred pixels and snapped back
 * across three painted frames. Only consecutive frames can tell.
 */
const watchJitter = (id, ms) =>
	evaluate(`(async () => {
  const el = document.querySelector('[data-lo-canonical-transcript]');
  const top = () => el.getBoundingClientRect().top;
  const read = () => {
    const row = el.querySelector('[data-record-id="' + CSS.escape(${JSON.stringify(id)}) + '"]');
    return row ? row.getBoundingClientRect().top - top() : null;
  };
  const samples = [];
  const until = performance.now() + ${ms};
  await new Promise((done) => {
    const tick = () => {
      const v = read();
      if (v !== null) samples.push(v);
      if (performance.now() < until) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  let max = 0;
  for (let i = 1; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i] - samples[i - 1]));
  return { frames: samples.length, maxFrameDelta: max, first: samples[0] ?? null, last: samples.at(-1) ?? null };
})()`);

/**
 * Sample ONE identified row per frame, with the extent alongside it.
 *
 * Distinct from `watchJitter` in what it reports rather than how it samples:
 * this keeps the null frames (a row that unmounted is a fact, not a gap to
 * skip), counts how many frames actually displaced rather than only the worst,
 * and records the extent so a trace with no growth can be told apart from one
 * that held its anchor across real growth. A clause E number is only worth
 * anything if the reveal it spans provably happened.
 */
const watchHeldRow = (id, ms) =>
	evaluate(`(async () => {
  const el = document.querySelector('[data-lo-canonical-transcript]');
  const top = () => el.getBoundingClientRect().top;
  const read = () => {
    const row = el.querySelector('[data-record-id="' + CSS.escape(${JSON.stringify(id)}) + '"]');
    return row ? Number((row.getBoundingClientRect().top - top()).toFixed(2)) : null;
  };
  const samples = [];
  const extents = [];
  const times = [];
  const until = performance.now() + ${ms};
  await new Promise((done) => {
    const tick = () => {
      samples.push(read());
      extents.push(el.scrollHeight);
      times.push(performance.now());
      if (performance.now() < until) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  let max = 0;
  let displaced = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] === null || samples[i - 1] === null) continue;
    const delta = Math.abs(samples[i] - samples[i - 1]);
    if (delta > max) max = delta;
    // 1px, not 0: sub-pixel layout noise is not the reader being moved.
    if (delta > 1) displaced++;
  }
  // The reader's own notch lands in the first frames of this window, and a row
  // moving because the READER scrolled is not the defect clause E describes.
  // window.__loPagingInputEndedAt is stamped by the harness the moment it
  // stops sending input; everything after it is the app acting alone.
  const stopAt = window.__loPagingInputEndedAt ?? 0;
  let maxQuiet = 0;
  let displacedQuiet = 0;
  for (let i = 1; i < samples.length; i++) {
    if (times[i] < stopAt) continue;
    if (samples[i] === null || samples[i - 1] === null) continue;
    const delta = Math.abs(samples[i] - samples[i - 1]);
    if (delta > maxQuiet) maxQuiet = delta;
    if (delta > 1) displacedQuiet++;
  }
  return {
    frames: samples.length,
    maxFrameDelta: Number(max.toFixed(2)),
    displacedFrames: displaced,
    /* The clause E numbers: input provably stopped. */
    maxFrameDeltaAfterInput: Number(maxQuiet.toFixed(2)),
    displacedFramesAfterInput: displacedQuiet,
    framesAfterInput: times.filter((t) => t >= stopAt).length,
    unmountedFrames: samples.filter((v) => v === null).length,
    first: samples[0] ?? null,
    last: samples.at(-1) ?? null,
    netDrift: Number((((samples.at(-1) ?? 0) - (samples[0] ?? 0))).toFixed(2)),
    extentGrewBy: extents.at(-1) - extents[0],
  };
})()`);

/*
 * Where the wheel is aimed.
 *
 * Chromium routes a synthesized wheel to whatever is under the point, so a
 * hardcoded coordinate is a silent no-op the moment the layout moves (measured:
 * a 1380x872 window put the transcript's centre at x=940,y=348, and a wheel at
 * y=400 in a 489px-tall viewport still landed outside it). Reading the
 * scroller's own rect before the first notch keeps the harness honest about
 * driving the element under test.
 */
let AIM = null;
async function aim() {
	AIM = await evaluate(`(() => {
    const el = document.querySelector('[data-lo-canonical-transcript]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
	if (!AIM) throw new Error("no transcript to aim at");
	return AIM;
}

/** One real wheel notch through the browser's own input pipeline. */
async function wheel(deltaY, { x = AIM?.x ?? 900, y = AIM?.y ?? 400 } = {}) {
	// `modifiers` and `clickCount` are not optional for this event in every
	// Chromium build: omitting them produced "mandatory field missing" from the
	// bindings layer, which surfaces as a rejected CDP call rather than as a
	// missed scroll, so a harness that ignored the rejection would report zero
	// requests and call it coalescing.
	await send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x,
		y,
		button: "none",
		buttons: 0,
		clickCount: 0,
		modifiers: 0,
		deltaX: 0,
		deltaY,
		pointerType: "mouse",
	});
}

/** A fling: `count` notches at `gapMs`, the cadence of a real trackpad flick. */
async function fling(count, deltaY, gapMs = 10) {
	for (let i = 0; i < count; i++) {
		await wheel(deltaY);
		await sleep(gapMs);
	}
}

// ------------------------------------------------------------------ run

const report = { mode: MODE, session: SESSION, steps: [] };

// Open the seeded conversation by its route, so nothing depends on the sidebar
// having rendered a particular row order.
/*
 * `window.electron` is injected by the Electron preload, and the browser
 * development surface has no preload. Two members are touched during mount
 * (a command-palette IPC subscription and the platform string), and without
 * them the app's error boundary catches a TypeError before anything renders.
 *
 * This shim is HARNESS scaffolding, installed from the evidence script and
 * never from shipped code: the transcript, its reducer and the desktop
 * transport it talks to are the real ones, and none of them reads
 * `window.electron`. It is declared here rather than hidden so a reader can
 * see exactly how far the substitution goes - one no-op subscription.
 */
const ELECTRON_SHIM = `(() => {
  if (window.electron && window.api) return 'present';
  // The preload's shapes, DERIVED from the app's own naming convention rather
  // than transcribed member by member.
  //
  // The list used to be written out by hand, and it went stale exactly the way
  // a hand-copied interface does: #107 added \`onBackendUpdateManualRequired\`
  // (and seven siblings) to the preload, the shim did not grow them, and
  // re-running this script on any head containing #107 threw
  // "window.api.updater.onBackendUpdateManualRequired is not a function"
  // before the chat page mounted. That breaks the reproducibility this PR's
  // evidence rests on -- the numbers below are only worth something if the
  // script that produced them still runs.
  //
  // A BLANKET catch-all proxy was tried in an earlier round and is genuinely
  // the wrong tool: the preload mixes promise-returning calls,
  // subscribe-returning-unsubscribe, and plain fields, and one uniform return
  // value fails whichever shape it is not. The fix is to key the shape off the
  // NAME, which is the same convention the real preload follows:
  //
  //   on*          -> a subscription, returns its own unsubscribe
  //   remove*      -> a detach, returns undefined
  //   everything else -> an async call, resolves null
  //
  // So a member added upstream is satisfied by the rule that names it, and a
  // member that breaks the convention fails loudly here instead of silently
  // substituting the wrong shape. Nothing on the path under test reads any of
  // it: the transcript, the reducer and the desktop transport touch none of
  // this. The updater is simply the first thing the shell mounts, and its
  // error boundary stops the app before the chat page renders.
  const promise = (value) => Promise.resolve(value);
  const subscribe = () => () => undefined;
  const byConvention = (overrides) =>
    new Proxy(overrides || {}, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string') return undefined;
        if (prop.startsWith('on')) return subscribe;
        if (prop.startsWith('remove')) return () => undefined;
        // \`quitAndInstall\` and friends are fire-and-forget; returning a promise
        // is harmless for those and correct for the rest.
        return () => promise(null);
      },
      // A \`prop in obj\` guard in the app must agree with what \`get\` will hand
      // back, or a component skips a member this proxy would have served.
      has: () => true,
    });
  window.electron = {
    ipcRenderer: byConvention({
      on: subscribe,
      once: subscribe,
      off: () => undefined,
      send: () => undefined,
      sendSync: () => null,
      invoke: () => promise(null),
      addListener: subscribe,
      removeListener: () => undefined,
      removeAllListeners: () => undefined,
    }),
    process: { platform: 'darwin' },
  };
  window.api = {
    systemInfo: byConvention({
      // Named because they must resolve to REAL-shaped values, not null: the
      // shell renders the version string and branches on the platform.
      getAppVersion: () => promise('0.0.0-evidence'),
      getPlatform: () => promise('darwin'),
      getArch: () => promise('arm64'),
      getPlatformInfo: () => promise({ platform: 'darwin', arch: 'arm64' }),
    }),
    updater: byConvention({
      // \`getLastInstallAttempt\` is read for its FIELDS, so a bare null would
      // throw on the property access rather than render nothing.
      getLastInstallAttempt: () => promise(null),
    }),
  };
  return 'shimmed';
})()`;

/*
 * The onboarding modal, and why getting this wrong voids every measurement.
 *
 * A first-run profile opens "Connect a provider", which is a Radix dialog. Radix
 * locks page scroll through `react-remove-scroll`, and that lock is a DOCUMENT
 * handler that calls `preventDefault()` on every wheel event before it reaches
 * the transcript. The scroller then does not move, the paging policy never sees
 * an upward gesture, and the harness records zero history ops -- which reads
 * exactly like perfect coalescing and is in fact a locked page.
 *
 * Round 1 of this PR reported "headless Chromium cannot synthesize wheel
 * events" on the strength of that zero. That conclusion was wrong: the wheel
 * pipeline was fine and the page was locked. Two harness bugs caused it, and
 * both are fixed below --
 *
 *   1. the bypass wrote the legacy `isComplete` key while the store persists
 *      `isModalComplete` (`shared/store/onboarding-store.ts`), so the modal
 *      opened anyway;
 *   2. the app was reached by a HASH-only navigation, which is a same-document
 *      navigation -- zustand had already hydrated from an empty key at first
 *      load and never re-read what we wrote.
 *
 * Hence: write both keys, then force a real document load. The assertion after
 * it turns a recurrence into a loud failure instead of a plausible zero.
 */
await send("Page.addScriptToEvaluateOnNewDocument", { source: ELECTRON_SHIM });
await send("Page.navigate", { url: `${APP}/#/chat` });
// `about:blank` has an opaque origin with no localStorage, so the navigation
// has to have COMMITTED before the onboarding state can be written. Poll the
// document's own origin rather than guessing a sleep.
for (let i = 0; i < 60; i++) {
	await sleep(500);
	const res = await send("Runtime.evaluate", {
		expression:
			"(() => { try { return location.origin.startsWith('http') && Boolean(window.localStorage); } catch { return false; } })()",
		returnByValue: true,
	});
	// Deliberately NOT through `evaluate`: that helper throws on a page
	// exception, and "localStorage is not readable yet" is exactly the
	// condition being polled for rather than a failure.
	if (res.result?.value === true) break;
}
await sleep(3000);
await evaluate(
	// Both keys: the current one the store actually persists, and the legacy one
	// so its migration path is exercised rather than bypassed.
	`(() => { localStorage.setItem('onboarding-storage', JSON.stringify({state:{isComplete:true,isModalComplete:true,isTourComplete:true,currentStep:'complete'},version:0})); return true; })()`,
);
await send("Page.navigate", { url: `${APP}/#/chat/${SESSION}` });
await sleep(500);
// A real document load, so the store re-hydrates from what was just written.
await send("Page.reload", { ignoreCache: false });
await sleep(9000);

// Refuse to measure a locked page. `data-scroll-locked` is what
// react-remove-scroll sets on the body; an open dialog is the other half of the
// same condition. Failing here costs a run, whereas measuring through a lock
// costs a review round and a false claim in the evidence.
const lock = JSON.parse(
	await evaluate(
		`JSON.stringify({ locked: document.body.getAttribute('data-scroll-locked'), dialogs: document.querySelectorAll('[role=dialog][data-state=open]').length })`,
	),
);
if (lock.locked || lock.dialogs > 0) {
	throw new Error(
		`scroll is locked by an open layer, measurements would be void: ${JSON.stringify(lock)}`,
	);
}

const state = await probe();
if (!state.ok) {
	const dump = await evaluate(`(() => ({
		href: location.href,
		bodyText: document.body.innerText.slice(0, 400),
		markers: [...document.querySelectorAll('[data-lo-canonical-transcript],[data-tour-tag]')].map(e=>e.tagName+':'+(e.dataset.tourTag??'transcript')).slice(0,10),
	}))()`);
	console.error(JSON.stringify(dump, null, 2));
	throw new Error(`transcript not mounted: ${state.reason}`);
}
report.steps.push({ step: "opened", ...state, aim: await aim() });

// Scroll to the top of what is rendered: a long run of notches, paced so the
// implementation sees a continuous gesture rather than one burst.
await fling(60, -400, 12);
await sleep(900);
report.steps.push({ step: "at-top-after-first-fling", ...(await probe()) });
await shot(`${MODE}-01-at-top`);

const beforeFling = await probe();
const historyBeforeFling = historyRequests.length;

// THE FLING under test: 40 notches in 400ms against the top of the content.
// One gesture. Clause B says one page.
const jitterPromise = beforeFling.anchor
	? watchJitter(beforeFling.anchor.id, 2600)
	: null;
await fling(40, -400, 10);
await sleep(2400);
const jitter = jitterPromise ? await jitterPromise : null;
const afterFling = await probe();

report.steps.push({
	step: "fling",
	anchorBefore: beforeFling.anchor,
	anchorAfter: afterFling.anchor
		? {
				id: afterFling.anchor.id,
				offset: afterFling.anchor.offset,
			}
		: null,
	// Re-read the SAME row rather than whatever is at the top now: the anchor
	// claim is about one identified row, and comparing two different rows'
	// offsets would be a number with no meaning.
	anchorRowOffsetAfter: beforeFling.anchor
		? await evaluate(`(() => {
        const el = document.querySelector('[data-lo-canonical-transcript]');
        const row = el.querySelector('[data-record-id="' + CSS.escape(${JSON.stringify(beforeFling.anchor.id)}) + '"]');
        return row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
      })()`)
		: null,
	rowsBefore: beforeFling.rows,
	rowsAfter: afterFling.rows,
	historyRequestsDuringFling: historyRequests.length - historyBeforeFling,
	jitter,
});
await shot(`${MODE}-02-after-fling`);

// Clamp: keep wheeling against the top with nothing left to move. Clause D says
// this must not issue a request per notch.
const historyBeforeClamp = historyRequests.length;
await fling(50, -400, 10);
await sleep(1500);
report.steps.push({
	step: "clamped-at-top",
	historyRequestsDuringClamp: historyRequests.length - historyBeforeClamp,
	...(await probe()),
});
await shot(`${MODE}-03-clamped`);

/*
 * Clause E, isolated — the only window in which it is falsifiable.
 *
 * The fling steps above cannot settle it: the reader's own notches move rows
 * legitimately, so a displacement measured across them conflates "the app moved
 * me" with "I scrolled". Here the reveal is triggered by ONE notch delivered
 * inside an already-open watch window, and everything after the first frames is
 * the app acting alone. Any displacement of the held row in that stretch is the
 * reader being dragged, which is what the clause forbids.
 */
// Reload first: the fling and clamp steps above deliberately drive the
// transcript to the end of its history, and a fully-mounted transcript has no
// reveal left to isolate. A fresh document restores the arrival state a reader
// actually starts from, which is the state this measurement is about.
await send("Page.reload", { ignoreCache: false });
for (let i = 0; i < 45; i++) {
	await sleep(1000);
	const mounted = await evaluate(
		`Boolean(document.querySelector('[data-record-id]'))`,
	);
	if (mounted === true) break;
}
await sleep(3000);
// Re-aim: a reload rebuilds the layout, and a wheel at a stale coordinate is a
// silent no-op.
await aim();

const isolated = [];
for (let trial = 0; trial < 5; trial++) {
	// Approach from OUTSIDE the prefetch zone so the demand is armed but unspent.
	let here = await probe();
	let guard = 0;
	while (here.distanceFromTop > 420 && guard++ < 600) {
		await wheel(-400);
		await sleep(12);
		here = await probe();
	}
	const before = await probe();
	if (!before.anchor) break;
	const historyBefore = historyRequests.length;
	const trace = watchHeldRow(before.anchor.id, 3000);
	// The notch that carries them into the zone, inside the watch window. The
	// stamp afterwards is what lets the trace separate the reader's own motion
	// from the app's.
	await wheel(-400);
	await evaluate(
		`(() => { window.__loPagingInputEndedAt = performance.now(); return true; })()`,
	);
	const result = await trace;
	const after = await probe();
	isolated.push({
		trial: trial + 1,
		rowsBefore: before.rows,
		rowsAfter: after.rows,
		extentGrewBy: result.extentGrewBy,
		historyRequests: historyRequests.length - historyBefore,
		anchorId: before.anchor.id,
		...result,
	});
	// The slot's own words are the end-of-history signal a reader gets, and the
	// one this harness can observe without reaching into React state.
	if (/Start of conversation/i.test(after.slotText ?? "")) break;
}
const reveals = isolated.filter((entry) => entry.extentGrewBy > 0);
report.steps.push({
	step: "isolated-reveals",
	trials: isolated.length,
	revealsObserved: reveals.length,
	// The headline numbers for clause E.
	worstMaxFrameDelta: Math.max(0, ...reveals.map((r) => r.maxFrameDelta)),
	worstNetDrift: Math.max(0, ...reveals.map((r) => Math.abs(r.netDrift))),
	totalDisplacedFrames: reveals.reduce((a, r) => a + r.displacedFrames, 0),
	totalFramesSampled: reveals.reduce((a, r) => a + r.frames, 0),
	detail: isolated,
});
await shot(`${MODE}-04-after-isolated-reveals`);

report.historyRequestsTotal = historyRequests.length;
// The positive control: if this is 0 the harness saw no traffic at all and
// every history count above is meaningless rather than reassuring.
report.desktopOpsTotal = desktopOps.length;
report.desktopOpsByName = desktopOps.reduce((acc, entry) => {
	acc[entry.op ?? "<null>"] = (acc[entry.op ?? "<null>"] ?? 0) + 1;
	return acc;
}, {});
mkdirSync(OUT, { recursive: true });
writeFileSync(
	join(OUT, `${MODE}-measurements.json`),
	JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
ws.close();
cleanup();
