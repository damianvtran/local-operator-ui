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
	console.error("usage: scroll-paging-evidence.mjs <app-origin> <session-id> <out> <mode>");
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
	const timer = setTimeout(() => reject(new Error("Chrome did not report a debug port")), 30_000);
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
const list = await (await fetch(`http://127.0.0.1:${new URL(browserWs).port}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no page target in the private Chromium");
void browserId;

let nextId = 1;
const pending = new Map();
/** Every `sessions.history` request main issued, in order. See clause B. */
const historyRequests = [];
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.method === "Network.requestWillBeSent") {
		const url = msg.params?.request?.url ?? "";
		if (url.includes("/history")) historyRequests.push({ url, at: Date.now() });
	}
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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
		throw new Error(JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
	return res.result.value;
}

async function shot(name) {
	mkdirSync(OUT, { recursive: true });
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	const path = join(OUT, `${name}.png`);
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
  // The preload's own shapes, modelled where the app actually depends on them.
  //
  // A generic catch-all proxy was tried first and is the wrong tool: the real
  // preload mixes async getters, subscribe-returning-unsubscribe, and plain
  // fields, and a proxy that satisfies one shape fails the next component that
  // uses another (three rounds of TypeError, each in a DIFFERENT member of
  // update-notification.tsx). Naming the shapes is shorter and honest about
  // what is substituted.
  //
  // None of this is on the path under test: the transcript, the reducer and
  // the desktop transport read none of it. The updater is simply the first
  // thing the shell mounts, and its error boundary stops the app before the
  // chat page renders.
  const promise = (value) => Promise.resolve(value);
  const subscribe = () => () => undefined;
  window.electron = {
    ipcRenderer: {
      on: subscribe,
      once: subscribe,
      off: () => undefined,
      send: () => undefined,
      sendSync: () => null,
      invoke: () => promise(null),
      addListener: subscribe,
      removeListener: () => undefined,
      removeAllListeners: () => undefined,
    },
    process: { platform: 'darwin' },
  };
  window.api = {
    systemInfo: {
      getAppVersion: () => promise('0.0.0-evidence'),
      getPlatform: () => promise('darwin'),
      getArch: () => promise('arm64'),
    },
    updater: {
      checkForUpdates: () => promise(null),
      checkForBackendUpdates: () => promise(null),
      downloadUpdate: () => promise(null),
      quitAndInstall: () => undefined,
      updateBackend: () => promise(null),
      onUpdateAvailable: subscribe,
      onUpdateNotAvailable: subscribe,
      onUpdateDownloaded: subscribe,
      onUpdateError: subscribe,
      onUpdateProgress: subscribe,
      onBackendUpdateAvailable: subscribe,
      onBackendUpdateNotAvailable: subscribe,
      onBackendUpdateCompleted: subscribe,
      onBackendUpdateError: subscribe,
      onBeforeQuitForUpdate: subscribe,
      removeUpdateAvailableListener: () => undefined,
      removeUpdateNotAvailableListener: () => undefined,
      removeUpdateDownloadedListener: () => undefined,
      removeUpdateErrorListener: () => undefined,
      removeUpdateProgressListener: () => undefined,
      removeBackendUpdateAvailableListener: () => undefined,
      removeBackendUpdateNotAvailableListener: () => undefined,
      removeBackendUpdateCompletedListener: () => undefined,
      removeBackendUpdateErrorListener: () => undefined,
      removeBeforeQuitForUpdateListener: () => undefined,
    },
  };
  return 'shimmed';
})()`;

// The onboarding modal is a focus trap over the whole app and would swallow
// every wheel event; a first-run profile always shows it. Completing it in
// localStorage is the same state a returning user has.
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
	`(() => { localStorage.setItem('onboarding-storage', JSON.stringify({state:{isComplete:true,isTourComplete:true,currentStep:'complete'},version:0})); return true; })()`,
);
await send("Page.navigate", { url: `${APP}/#/chat/${SESSION}` });
await sleep(9000);

let state = await probe();
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
const jitterPromise = beforeFling.anchor ? watchJitter(beforeFling.anchor.id, 2600) : null;
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

report.historyRequestsTotal = historyRequests.length;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${MODE}-measurements.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();
cleanup();
