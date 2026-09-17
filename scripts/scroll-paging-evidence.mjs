#!/usr/bin/env node
/**
 * Measure and photograph scroll-driven history paging in the REAL renderer.
 *
 *     node scripts/scroll-paging-evidence.mjs <cdp-port> <session-id> <out-dir> <mode>
 *
 * Modes: `before` and `after` NAME THE OUTPUT FILES AND THE REPORT's arm label.
 * They do NOT swap the code under test — this harness cannot, and pretending
 * otherwise cost a review round (R1-4): a reader who runs `before` on this
 * branch measures this branch and gets a report labelled `before`.
 *
 * To produce the before arm, take the two paging modules back to the revision
 * you mean and record the swap:
 *
 *     node scripts/paging-evidence-arms.mjs before <ref> -- <harness args>
 *
 * which prints the md5 pair it restored. `docs/evidence/transcript-scroll-paging/
 * README.md` carries the two-command recipe as well, for a reader who would
 * rather do it by hand.
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
import { withMockKeychain } from "./chrome-keychain.mjs";

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
/*
 * Hoisted out of the two closures that use them: `biome` refuses a regex literal
 * in a per-event or per-frame path, and both of these run once per Chrome log
 * chunk and once per recorded slot string.
 */
const DEBUG_WS_RE = /ws:\/\/[^\s]+/;
/** The windowed slot's own count of the rows it is holding back. */
const EARLIER_COUNT_RE = /(\d+)\s+earlier/;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dataDir = join(tmpdir(), `lo-paging-cdp-${process.pid}`);
mkdirSync(dataDir, { recursive: true });
const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		// Scrollbars are left ON: a scrollbar drag is one of the four input kinds
		// the behaviour under test must honour, and hiding them would remove it.
		"--window-size=1380,872",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]),
);
const browserWs = await new Promise((resolve, reject) => {
	let buf = "";
	const timer = setTimeout(
		() => reject(new Error("Chrome did not report a debug port")),
		30_000,
	);
	chrome.stderr.on("data", (chunk) => {
		buf += chunk.toString();
		const hit = buf.match(DEBUG_WS_RE);
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
await new Promise((resolve) => {
	ws.onopen = resolve;
});

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
    slotText: (() => {
      const hint = el.querySelector('#lo-older-history-hint');
      if (hint) return hint.textContent.trim().slice(0, 60);
      const button = el.querySelector('button');
      if (button) return button.textContent.trim().slice(0, 60);
      const start = [...el.querySelectorAll('span')].find((node) =>
        /Start of conversation/i.test(node.textContent ?? ''),
      );
      return start ? start.textContent.trim().slice(0, 60) : '';
    })(),
    /*
     * The windowed slot's OWN words, and the count in them. Separate from
     * slotText above rather than replacing it: that field's selector is what
     * the steps below this one already assert on, and a probe field whose
     * meaning changes quietly is how a comparison stops comparing anything.
     */
    hintText: (el.querySelector('#lo-older-history-hint')?.textContent ?? '').trim().slice(0, 70),
    topText: el.querySelector('[data-record-id]')?.textContent?.trim().slice(0, 40) ?? null,
  };
})()`;

/**
 * Wait for the transcript to mount, and report how long it took.
 *
 * Polled rather than slept (review round 1, Q1-4). The harness used a fixed
 * `sleep(9000)`, which is not enough on a cold vite module graph: the run died
 * with `transcript not mounted: no transcript` in ~21s, which reads like a fault
 * in the code under test rather than a warm-up, and the identical command run
 * again completed. Measured three times by QA, once per cold rig.
 */
async function awaitTranscriptMount({ attempts = 60, gapMs = 500 } = {}) {
	for (let i = 0; i < attempts; i++) {
		const state = await probe();
		if (state.ok && state.rows > 0)
			return { waitedMs: i * gapMs, attempts: i + 1 };
		await sleep(gapMs);
	}
	throw new Error(
		`transcript did not mount within ${(attempts * gapMs) / 1000}s of the reload — the rig is probably still warming; re-run and it will pass (see this function's comment)`,
	);
}

const probe = () =>
	evaluate(PROBE).then((state) => ({
		...state,
		hiddenRows: hiddenOf(state.hintText),
	}));

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
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      // The scrollbar gutter: the wheel steps above aim at the middle of the
      // transcript, and the drag below needs the last few pixels of it.
      right: Math.round(r.right) - 6,
    };
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

/*
 * A real trackpad flick, which `fling` cannot express.
 *
 * A flick has two phases: a short finger phase with large deltas, then a
 * MOMENTUM phase that keeps emitting after the fingers lift, with a decaying
 * delta. The operator's report is about exactly that second phase ("if I scroll
 * a bit too fast I get stuck"), and the state machine's own act boundary
 * (`GESTURE_GAP_MS`) is defined against it — so a train of equal notches is a
 * finger walking a wheel, not the gesture under test.
 *
 * The tail is bounded by TIME rather than by a notch count, and that is a
 * correction this file owes its own method note. A count-bounded decay spaced
 * its last, smallest notches 733ms apart in the diagnosis run — past
 * `GESTURE_GAP_MS`, i.e. a gap the harness invented and no hardware produces —
 * while a real trackpad's momentum keeps emitting at frame rate until it runs
 * out. Emitting for the requested duration at frame cadence, with the delta
 * decaying on the clock, is the shape that leaves no such gap.
 */
async function flingWithMomentum({
	burstCount = 5,
	burstDelta = -400,
	burstGap = 8,
	tailMs = 600,
	tailStart = -320,
	frameMs = 16,
} = {}) {
	await fling(burstCount, burstDelta, burstGap);
	const started = Date.now();
	let emitted = 0;
	for (;;) {
		const elapsed = Date.now() - started;
		if (elapsed >= tailMs) break;
		const decay = 1 - elapsed / tailMs;
		await wheel(Math.round(tailStart * decay * decay));
		emitted++;
		await sleep(frameMs);
	}
	return emitted;
}

/*
 * The prefetch zone, restated here because the harness has to know it to say
 * whether a reveal happened INSIDE it. The formula is the policy's own
 * (`prefetchZonePx`: half the viewport, floored at 320, capped at 900); the
 * harness reads `clientHeight` from the page and never imports the module, so a
 * change to the policy's zone shows up here as a disagreement rather than as a
 * silent agreement with a copy that no longer matches.
 */
const ZONE_FRACTION = 0.5;
const ZONE_MIN_PX = 320;
const ZONE_MAX_PX = 900;
const zonePxFor = (clientHeight) =>
	Math.min(
		ZONE_MAX_PX,
		Math.max(ZONE_MIN_PX, Math.round(clientHeight * ZONE_FRACTION)),
	);

/**
 * Send notches, one at a time, until the page says the reader is where the
 * scenario needs them — or the cap is reached.
 *
 * A SETUP, never a measurement, and it exists so that a scenario's measured act
 * begins in the same place on both arms. The alternative (which this harness
 * shipped first) is a fixed number of notches in a gesture, whose end position
 * depends on how much the arm loaded on the way — measured: `resting-finger-at
 * -clamped-top` began at `d = 24` on one arm and `d = 7790` on the other, so the
 * row was comparing two different scenes (review round 1, R1-3 and D1-2).
 *
 * The cap is a refusal, not a timeout: a setup that cannot reach its state says
 * so in the report rather than measuring something else.
 */
async function notchUntil(
	where,
	{ deltaY = -200, gapMs = 40, maxNotches = 400 } = {},
) {
	for (let i = 0; i < maxNotches; i++) {
		const state = await probe();
		if (where(state)) return { notches: i, state, reached: true };
		await wheel(deltaY);
		await sleep(gapMs);
	}
	const state = await probe();
	return { notches: maxNotches, state, reached: false };
}

/**
 * The pinned-at-the-hard-top state the two freeze scenarios are about.
 *
 * Distance only, deliberately: adding "and nothing is loading" would make the
 * setup wait for the arm's own reveals and stop in a different place on each
 * arm, which is the defect this helper exists to remove. The reader is at the
 * wall the moment the wall says so, on both arms, whatever is in flight.
 */
const atTheWall = (state) => state.ok && state.distanceFromTop <= HARD_TOP_PX;

/**
 * Where a slow approach begins: close enough that the measured act reaches the
 * zone, far enough that it does not reach the wall.
 *
 * The act travels 900px (30 notches of 30px), so a start band of 580-700px
 * outside the zone leaves the reader inside it with a couple of hundred pixels
 * to go when the act ends — approaching, never arrived. The setup reaches the
 * band in two passes (a coarse one at 420px a notch, a fine one at 120px) so the
 * overshoot from a single coarse step cannot land the reader at the wall.
 */
const ZONE_BAND_PX = 700;
const justOutsideTheZone = (state) =>
	state.ok &&
	state.distanceFromTop > 0 &&
	state.distanceFromTop <= zonePxFor(state.clientHeight) + ZONE_BAND_PX;

/** The coarse half of the approach, before the fine notches take over. */
const approachingTheZone = (state) =>
	state.ok &&
	state.distanceFromTop > 0 &&
	state.distanceFromTop <= zonePxFor(state.clientHeight) + ZONE_BAND_PX + 600;

/**
 * Drive to a state, let the app finish answering, and check the reader is still
 * there — repeating until they are, or refusing to measure.
 *
 * The check after the quiet period is not belt-and-braces, it is the whole
 * helper. A landing inserts its rows ABOVE the reader and holds their view, so
 * the reader's distance from the top jumps by the inserted extent (measured: a
 * page's widen moved `d` from 1013 to 7190 while the reader's eyes did not
 * move). A setup that stops the instant the reader touches the top therefore
 * measures an act that begins thousands of pixels away — which is exactly the
 * defect round 1 found in these two scenarios (R1-3, D1-2), reproduced one
 * layer in. `reached: false` is reported rather than hidden: a scenario whose
 * start state could not be reached says so and its row is not quoted as if it
 * had been.
 */
async function driveTo(
	where,
	{ attempts = 4, settleMs = 1400, ...notchOpts } = {},
) {
	const tries = [];
	for (let i = 0; i < attempts; i++) {
		const pass = await notchUntil(where, notchOpts);
		await sleep(settleMs);
		const state = await probe();
		tries.push({
			notches: pass.notches,
			at: Math.round(pass.state.distanceFromTop),
			afterQuiet: Math.round(state.distanceFromTop),
			held: where(state),
		});
		if (where(state)) return { reached: true, tries, state };
	}
	return { reached: false, tries, state: await probe() };
}

/**
 * One real keystroke, at the focused element.
 *
 * The phase-1 run of this PR could not exercise the keyboard clause at all: the
 * app's listener is on the SCROLLER (`use-scroll-paging.ts`, `onKeyDown`), the
 * browser surface never focuses it on its own, and a keystroke delivered to
 * nothing is recorded as zero input events — which reads exactly like a clause
 * that never fires. So the scroller is focused first and the harness checks
 * afterwards that the page's own event log saw the key, which is the difference
 * between "proven" and "BLOCKED".
 */
async function key(k, { windowsVirtualKeyCode = 36 } = {}) {
	await send("Input.dispatchKeyEvent", {
		type: "rawKeyDown",
		key: k,
		code: k,
		windowsVirtualKeyCode,
	});
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k });
}

/** Re-read the focus after the key: a keystroke that moves focus would be invisible otherwise. */
const focusTranscriptAgain = async (before) =>
	`${before} -> ${await evaluate("(() => document.activeElement === document.querySelector('[data-lo-canonical-transcript]') ? 'still focused' : 'focus lost')()")}`;

/** Focus the transcript, and say whether it took. */
const focusTranscript = () =>
	evaluate(`(() => {
    const el = document.querySelector('[data-lo-canonical-transcript]');
    if (!el) return 'no transcript';
    el.focus();
    return document.activeElement === el ? 'focused' : 'not focusable';
  })()`);

/**
 * A real scrollbar journey: drag, look, drag again — in the direction that made
 * progress last time.
 *
 * Why a journey rather than one drag. This scenario shipped as a single drag
 * that ended 3555px from the top of a 5694px overflow, i.e. it never entered the
 * zone it names, and the PR declared the clause unproven on that basis. The
 * clause is reachable: on this surface four drags took the reader to `d = 560`
 * and the fourth spent a page (UX round 1, flow 5e), and this journeys to the
 * same place so the claim is reproduced here rather than quoted from another
 * agent's run. Every leg is reported, which is what makes the ending a
 * measurement instead of a hope.
 */
async function dragJourney({ maxLegs = 8 } = {}) {
	const legs = [];
	let direction = "up"; // "up" = toward older content, along the gutter
	for (let i = 0; i < maxLegs; i++) {
		const before = await probe();
		if (!before.ok) break;
		if (before.distanceFromTop <= HARD_TOP_PX) break;
		const from = direction === "up" ? AIM.bottom - 6 : AIM.top + 40;
		const to = direction === "up" ? AIM.top + 40 : AIM.bottom - 6;
		await dragScrollbar(from, to, 14);
		await sleep(700);
		const after = await probe();
		const travelled = Math.round(
			before.distanceFromTop - after.distanceFromTop,
		);
		legs.push({
			direction,
			from: Math.round(before.distanceFromTop),
			to: Math.round(after.distanceFromTop),
			travelled,
		});
		// A leg that moved the reader the wrong way is a leg pointed the wrong
		// way: the gutter's mapping is the app's (`column-reverse`), and this is
		// how the harness finds it instead of asserting it.
		if (travelled <= 0) direction = direction === "up" ? "down" : "up";
	}
	const end = await probe();
	return {
		legs: legs.length,
		journey: legs,
		endDistance: Math.round(end.distanceFromTop),
	};
}

/** A real scrollbar drag: press in the gutter, move, release. */
async function dragScrollbar(fromY, toY, steps = 14) {
	const x = Math.round(AIM.right);
	await send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y: fromY,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	for (let i = 1; i <= steps; i++) {
		const y = Math.round(fromY + ((toY - fromY) * i) / steps);
		await send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x,
			y,
			button: "left",
			buttons: 1,
		});
		await sleep(16);
	}
	await send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y: toY,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
}

/*
 * The page-side recorder: an OBSERVER, never instrumentation of the code under
 * test.
 *
 * What the shipped steps above cannot answer is the operator's question. "It
 * loads the next section but I still get stuck" is a claim about a TIMELINE —
 * how many notches arrived at the hard top, with a free reveal available, before
 * anything appeared — and a before/after pair of probes either side of a
 * gesture cannot see it: the reader arrives pinned either way. Two probes a
 * second apart report the same state whether the page took 0ms or 96ms, and
 * "96ms" is the whole difference between paging that feels continuous and a
 * dead stop at the wall.
 *
 * So this records two things, from the page's own perspective: every input event
 * the scroller's listeners could see, with the geometry at that instant, and the
 * geometry once per animation frame. Nothing under `src/` is touched and no
 * state is read out of React.
 */
const RECORDER = `(() => {
  if (window.__loPagingRecorder) return 'already installed';
  const rec = { events: [], samples: [], t0: performance.now(), targetSeen: false };
  window.__loPagingRecorder = rec;
  const hint = (el) => {
    const h = el.querySelector('#lo-older-history-hint');
    if (h) return h.textContent.trim();
    const b = el.querySelector('button');
    return b ? b.textContent.trim() : '';
  };
  const geometry = (el) => {
    /*
     * The row at the top of the viewport, and its offset from the scroller's top
     * edge. It is the same observation clause E is measured on in phase 1, taken
     * per FRAME here rather than once before and once after, because the number
     * that matters for a lurch is frame-to-frame and not the net drift: a reveal
     * can end exactly where it started and still have jumped twice on the way.
     */
    const scroller = el.getBoundingClientRect();
    const top = [...el.querySelectorAll('[data-record-id]')].find(
      (node) => node.getBoundingClientRect().bottom > scroller.top,
    );
    const rect = top ? top.getBoundingClientRect() : null;
    return {
      t: Math.round(performance.now() - rec.t0),
      d: Math.round(Math.max(0, el.scrollHeight - el.clientHeight - Math.abs(el.scrollTop))),
      rows: el.querySelectorAll('[data-record-id]').length,
      sh: el.scrollHeight,
      st: Math.round(el.scrollTop * 100) / 100,
      ch: el.clientHeight,
      anchorId: top ? top.getAttribute('data-record-id') : null,
      anchorOffset: rect ? Math.round((rect.top - scroller.top) * 100) / 100 : null,
      slot: hint(el).slice(0, 70),
    };
  };
  const attach = () => {
    const el = document.querySelector('[data-lo-canonical-transcript]');
    if (!el) { requestAnimationFrame(attach); return; }
    rec.targetSeen = true;
    const record = (kind) => (event) => {
      rec.events.push({
        ...geometry(el),
        kind,
        deltaY: typeof event.deltaY === 'number' ? Math.round(event.deltaY) : null,
        key: event.key ?? null,
      });
    };
    for (const kind of ['wheel', 'keydown', 'touchmove']) {
      el.addEventListener(kind, record(kind), { capture: true, passive: true });
    }
    el.addEventListener('pointerdown', record('pointerdown'), { capture: true, passive: true });
    window.addEventListener('pointerup', record('pointerup'), { capture: true, passive: true });
    const tick = () => { rec.samples.push(geometry(el)); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  attach();
  return 'installed';
})()`;

/** How many recorded events and frames exist so far (the per-step cursor). */
const recCursor = () =>
	evaluate(
		"(() => (window.__loPagingRecorder ? { events: window.__loPagingRecorder.events.length, samples: window.__loPagingRecorder.samples.length } : null))()",
	);

/** Everything recorded since that cursor. */
const recSince = async (cursor) => {
	if (!cursor) return { events: [], samples: [] };
	return {
		events: await evaluate(
			`window.__loPagingRecorder.events.slice(${cursor.events})`,
		),
		samples: await evaluate(
			`window.__loPagingRecorder.samples.slice(${cursor.samples})`,
		),
	};
};

/** The hard top the app itself clamps against, restated here independently. */
const HARD_TOP_PX = 2;

/** Rows the windowed slot is reporting as held back, out of its own words. */
const hiddenOf = (slot) => {
	const m = EARLIER_COUNT_RE.exec(slot ?? "");
	return m ? Number(m[1]) : 0;
};

/**
 * The numbers a gesture has to answer for.
 *
 * Four questions, and none of them is visible in a before/after probe pair:
 *
 * 1. HOW MANY reveals did this gesture buy, and were they local widens or
 *    durable pages? One page per act is rule 2; a chain is what round 1
 *    measured at four widens and two pages from one flick.
 * 2. WHERE was the reader when each reveal became visible — already pinned at
 *    the wall, or still travelling? "Already pinned, 96ms after arriving" is
 *    the dead stop; "while still approaching" is the fix.
 * 3. HOW LONG did the reader keep pushing at the wall with nothing appearing?
 *    The longest run of notches at the hard top with no reveal between them is
 *    the freeze, as a number the two runs can be compared on.
 * 4. What did the NETWORK do — counted from the CDP log, never from the page.
 */
function analyse({ events, samples, historyRequests: history, extra = {} }) {
	const reveals = [];
	const slotTransitions = [];
	for (let i = 1; i < samples.length; i++) {
		const prev = samples[i - 1];
		const now = samples[i];
		/*
		 * A reveal is a change in what the reader can SEE: rows mounted, or rows
		 * the window is holding back. The slot's own words are recorded separately
		 * — they change on transitions that reveal nothing (an affordance becoming
		 * a hint), and counting those as reveals would double-count the very state
		 * this change is about.
		 */
		if (prev.slot !== now.slot)
			slotTransitions.push({
				t: now.t,
				from: prev.slot,
				to: now.slot,
				hiddenAfter: hiddenOf(now.slot),
			});
		if (prev.rows === now.rows && hiddenOf(prev.slot) === hiddenOf(now.slot))
			continue;
		reveals.push({
			t: now.t,
			clientHeight: now.ch,
			rowsBefore: prev.rows,
			rowsAfter: now.rows,
			hiddenBefore: hiddenOf(prev.slot),
			hiddenAfter: hiddenOf(now.slot),
			// One frame before the change: where the reader was when the growth
			// began to be visible to them.
			distanceBefore: prev.d,
			distanceAfter: now.d,
			slotAfter: now.slot,
			// Local widen or durable page: the slot only reports held-back rows,
			// so a fall in that number with no rise in `rows` is a widen, and rows
			// arriving is a page (or the page's own widen).
			kind:
				now.rows > prev.rows
					? "rows-mounted"
					: now.rows < prev.rows
						? "rows-unmounted"
						: "hidden-rows-changed",
		});
	}

	for (const r of reveals) {
		/*
		 * Was the reader already pinned at the hard top when this became visible?
		 * If so, how long had they been there — the number that decides whether a
		 * reveal was a response or a rescue. `null` means it arrived on the way.
		 */
		const arrival = samples.find((s) => s.t < r.t && s.d <= HARD_TOP_PX);
		r.msAfterArrival =
			arrival === undefined ? null : Math.round(r.t - arrival.t);
	}

	// The freeze, as a number: the longest run of notches that arrived at the
	// hard top with nothing revealed between them.
	const wheels = events.filter((e) => e.kind === "wheel");
	let longest = { notches: 0, ms: 0, hiddenRows: 0 };
	let streak = null;
	for (let i = 0; i < wheels.length; i++) {
		const e = wheels[i];
		const next =
			i + 1 < wheels.length ? wheels[i + 1].t : Number.POSITIVE_INFINITY;
		const revealed = reveals.some((r) => r.t > e.t && r.t <= next);
		if (e.d <= HARD_TOP_PX && !revealed) {
			if (!streak) streak = { notches: 0, start: e.t, end: e.t, hidden: 0 };
			streak.notches += 1;
			streak.end = e.t;
			streak.hidden = Math.max(streak.hidden, hiddenOf(e.slot));
			if (streak.notches > longest.notches)
				longest = {
					notches: streak.notches,
					ms: Math.round(streak.end - streak.start),
					hiddenRows: streak.hidden,
				};
		} else {
			streak = null;
		}
	}

	const waited = reveals
		.map((r) => r.msAfterArrival)
		.filter((ms) => ms !== null);

	/*
	 * The lurch, as the frame-to-frame number rather than the net drift.
	 *
	 * Risk 1 of this change: rule 3's mid-fling refusal existed because mounting
	 * rows while the viewport travels used to stutter, and the lead spends the page
	 * during exactly that travel. The number that settles it is the largest
	 * single-frame change of the HELD ROW's viewport offset — measured across the
	 * whole act, because the landing frame is not the only one that can move the
	 * reader.
	 *
	 * Only frames watching the SAME row are compared: a change of row means the
	 * anchor unmounted, and differencing across that compares two different things.
	 * (Phase 1's isolated trials sample the row by identity for the same reason.)
	 */
	/*
	 * Measured over the frames AFTER the last input, which is phase 1's own
	 * method and the only window in which the number means what it is quoted for.
	 * A row's viewport offset moves whenever the READER moves too, so a figure
	 * taken across the gesture measures their wheel as much as the app's
	 * correction — measured: the largest "lurch" in a whole momentum train was
	 * 136px on a frame where `scrollTop` moved 136px and no reveal was in flight.
	 * After the last notch, nothing but the app can move it.
	 */
	const lastInputAt = events.length > 0 ? events[events.length - 1].t : 0;
	const lastSample = samples.length > 0 ? samples[samples.length - 1] : null;
	let lurch = { px: 0, t: null, to: null, frames: 0 };
	for (let i = 1; i < samples.length; i++) {
		const prev = samples[i - 1];
		const now = samples[i];
		if (prev.t <= lastInputAt) continue;
		if (!prev.anchorId || prev.anchorId !== now.anchorId) continue;
		if (prev.anchorOffset === null || now.anchorOffset === null) continue;
		lurch.frames += 1;
		const delta = Math.abs(now.anchorOffset - prev.anchorOffset);
		if (delta > lurch.px)
			lurch = {
				...lurch,
				px: delta,
				t: now.t,
				to: Math.round(now.anchorOffset),
			};
	}

	// And the same frame-to-frame figure on the DISTANCE from the top, which is
	// what the reader sees move when content is inserted above them.
	let largestJump = { px: 0, t: null, from: null, to: null };
	for (let i = 1; i < samples.length; i++) {
		const prev = samples[i - 1];
		const now = samples[i];
		const delta = Math.abs(now.d - prev.d);
		if (delta > largestJump.px)
			largestJump = { px: delta, t: now.t, from: prev.d, to: now.d };
	}

	return {
		historyRequests: history,
		inputEvents: events.length,
		wheelNotches: wheels.length,
		notchesAtHardTop: wheels.filter((e) => e.d <= HARD_TOP_PX).length,
		// Every reveal, and the subset a reader can actually SEE. The two differ
		// because a landed durable page changes the slot without mounting a row
		// (`rows 100 -> 100`, `hidden 0 -> 100`), which is invisible and was
		// inflating the headline count (review round 1, R1-9). A scenario's claim
		// names which of the two it is about.
		reveals: reveals.length,
		revealsMountedRows: reveals.filter((r) => r.kind === "rows-mounted").length,
		/*
		 * The lead's own trigger, measured live: a reveal that arrived while the
		 * reader was still INSIDE the prefetch zone and still sending input. On the
		 * replaced module this is 0 for a moving reader — its only triggers are the
		 * settle debounce, which cannot elapse mid-train, and the hard top — so the
		 * number is the difference between the two arms in the terms the change is
		 * about (review round 1, R1-1).
		 */
		revealsInsideZoneBeforeLastInput: reveals.filter(
			(r) => r.t < lastInputAt && r.distanceBefore <= zonePxFor(r.clientHeight),
		).length,
		revealDetail: reveals,
		slotTransitions,
		// `null` rather than 0 on the approach: a reveal that arrived while the
		// reader was still moving is the fix, and reporting it as "0ms after
		// arrival" would read as a very fast rescue instead.
		revealsOnApproach: reveals.filter((r) => r.msAfterArrival === null).length,
		worstMsAfterArrival: waited.length === 0 ? null : Math.max(...waited),
		longestClampedStretchWithoutReveal: longest,
		/*
		 * The operator's end state, as a flag rather than something a reader has to
		 * work out from three numbers: the reader is AT the hard top, with rows the
		 * app has fetched (or already holds) and is not showing them. It is the state
		 * the report describes ("I get stuck ... I need to scroll jitter down a bit
		 * and back up").
		 */
		endsPinnedWithHiddenRows: lastSample
			? lastSample.d <= HARD_TOP_PX && hiddenOf(lastSample.slot) > 0
			: null,
		// Clause E, per frame rather than net: see `lurch` above.
		maxAnchorFrameDeltaPx: lurch.px,
		maxAnchorFrameDeltaAt: lurch,
		postInputFramesSampled: lurch.frames,
		maxDistanceFrameDeltaPx: largestJump.px,
		maxDistanceFrameDeltaAt: largestJump,
		framesSampled: samples.length,
		...extra,
	};
}

/**
 * One measured act: probe, gesture, settle, probe, and the timeline between.
 *
 * `settleMs` is the quiet window after the gesture in which the reveal the
 * gesture bought has to appear; it is the reveal budget plus a wide margin, not
 * a timeout the numbers depend on.
 */
async function scenario(
	name,
	run,
	{ settleMs = 1600, note = null, beforeSettle = null } = {},
) {
	const before = await probe();
	const historyBefore = historyRequests.length;
	const cursor = await recCursor();
	const out = await run();
	/*
	 * The state the act itself left behind, captured BEFORE the settle sleep.
	 * Design round 1 (D1-1): every `after` frame used to be taken after the
	 * settle, i.e. after the reveal that unpins the reader, so no `after` frame
	 * showed the transcript at the top — which is the only place the freeze and
	 * its fix both happen. The shutter fires here instead.
	 */
	if (beforeSettle) await beforeSettle(out);
	await sleep(settleMs);
	const after = await probe();
	const { events, samples } = await recSince(cursor);
	const measured = {
		step: name,
		note,
		...analyse({
			events,
			samples,
			historyRequests: historyRequests.length - historyBefore,
			extra: out && typeof out === "object" ? out : {},
		}),
	};
	report.steps.push({
		step: name,
		note,
		rowsBefore: before.rows,
		rowsAfter: after.rows,
		hiddenRowsBefore: before.hiddenRows,
		hiddenRowsAfter: after.hiddenRows,
		distanceBefore: Math.round(before.distanceFromTop),
		distanceAfter: Math.round(after.distanceFromTop),
		slotBefore: before.slotText,
		slotAfter: after.slotText,
		...measured,
	});
	return { before, after, events, samples, measured };
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
report.mount = await awaitTranscriptMount();
await sleep(2500);

// Refuse to measure a locked page. `data-scroll-locked` is what
// react-remove-scroll sets on the body; an open dialog is the other half of the
// same condition. Failing here costs a run, whereas measuring through a lock
// costs a review round and a false claim in the evidence.
/*
 * The guard reports WHAT is locking, not just that something is (round 1 fix #4).
 * "locked: 1, dialogs: 1" cost this round a run and a guess about which layer had
 * opened; the title and the first line of body copy name it.
 */
const lock = JSON.parse(
	await evaluate(
		`JSON.stringify({
			locked: document.body.getAttribute('data-scroll-locked'),
			dialogs: document.querySelectorAll('[role=dialog][data-state=open]').length,
			layer: [...document.querySelectorAll('[role=dialog][data-state=open]')].map((d) => (d.innerText || '').split('\\n').slice(0, 3).join(' | ')).join(' ;; '),
		})`,
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
		"(() => { window.__loPagingInputEndedAt = performance.now(); return true; })()",
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

/* ---------------------------------------------------------------------------
 * PHASE 2 — the gestures this change is about.
 *
 * Phase 1 drives the transcript to the end of its history, which is why this
 * phase starts from a reload: the same seeded fixture, the same arrival state,
 * and three durable pages behind it for the gestures that need history
 * remaining. The diagnosis run measured its scrollbar drag AFTER history was
 * exhausted and its `Home` keystroke against an unfocused scroller, so both
 * clauses came back void or blocked; the reload and the focus below exist to
 * give them something to say rather than to re-run the same nothing.
 *
 * The recorder is registered as a new-document script here, so it re-installs
 * itself on that reload and every reload after it. Everything it records is
 * read from the page and never from the app's own state.
 * ------------------------------------------------------------------------- */
await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
await send("Page.reload", { ignoreCache: false });
report.recorderMount = await awaitTranscriptMount();
await sleep(2500);
{
	const lock = JSON.parse(
		await evaluate(
			`JSON.stringify({ locked: document.body.getAttribute('data-scroll-locked'), dialogs: document.querySelectorAll('[role=dialog][data-state=open]').length, recorder: Boolean(window.__loPagingRecorder), target: window.__loPagingRecorder ? window.__loPagingRecorder.targetSeen : false })`,
		),
	);
	if (lock.locked || lock.dialogs > 0)
		throw new Error(
			`scroll is locked by an open layer: ${JSON.stringify(lock)}`,
		);
	if (!lock.recorder || !lock.target)
		throw new Error(
			`the page-side recorder did not attach to the transcript: ${JSON.stringify(lock)}`,
		);
	report.recorder = lock;
}
await aim();

/**
 * Reload to the arrival state and wait for the transcript to mount again.
 *
 * Every scenario that needs history starts here, because a scenario that begins
 * where the last one ended is a scenario whose numbers depend on the ones above
 * it: the diagnosis run drove the transcript to `hiddenRows = 0` and then
 * measured a scrollbar drag against a scroller with nothing left to load, which
 * is a void rather than a pass.
 */
async function freshArrival() {
	await send("Page.reload", { ignoreCache: false });
	await awaitTranscriptMount();
	await sleep(2500);
	await aim();
	report.reloads = (report.reloads ?? 0) + 1;
	return probe();
}

/**
 * One scenario: a fresh arrival, an optional SETUP the measurement does not
 * include, and then the gesture under test.
 *
 * The setup is outside the measurement on purpose. "A reader parked at the top
 * who keeps pushing" is a state, not a gesture, and rolling the approach that
 * reaches it into the act being measured would credit the approach's reveals to
 * the gesture and hide the very thing the scenario is about.
 */
async function arrivalScenario(
	name,
	{ setup = null, gesture, settleMs = 1800, note = null, beforeSettle = null },
) {
	const arrival = await freshArrival();
	if (setup) await setup();
	await sleep(800);
	// `beforeSettle` is FORWARDED, not swallowed: it is the act-end shutter (D1-1),
	// and a scenario that asks for one and silently gets it nowhere is how the
	// first cut of this shipped five `after` frames still taken after the settle.
	const result = await scenario(name, gesture, {
		settleMs,
		note,
		beforeSettle,
	});
	const last = report.steps[report.steps.length - 1];
	last.arrival = {
		rows: arrival.rows,
		hiddenRows: arrival.hiddenRows,
		distanceFromTop: Math.round(arrival.distanceFromTop),
		slot: arrival.slotText,
	};
	last.expectation = note;
	return result;
}

const phase2 = [];
phase2.push(
	await arrivalScenario("fast-fling-to-top", {
		gesture: () =>
			flingWithMomentum({
				burstCount: 8,
				burstDelta: -600,
				burstGap: 8,
				tailMs: 1000,
				tailStart: -700,
			}),
		settleMs: 2200,
		// The frame that shows the state this whole PR is about: the reader at the
		// hard top with the slot painted, taken at ACT END rather than after the
		// settle (design round 1, D1-1).
		beforeSettle: () => shot(`${MODE}-05-fast-fling-to-top-at-act-end`),
		note: "one flick with a real momentum tail, from the arrival state: the page must be spent on the way to the wall, not at it",
	}),
);
await shot(`${MODE}-05-fast-fling-to-top`);

/*
 * A flick that crosses two walls inside ONE act: twelve loud notches plus 1.6s
 * of momentum tail. This is the shape that left the diagnosis run pinned with
 * rows hidden and 62 further notches producing nothing at all.
 */
phase2.push(
	await arrivalScenario("fling-crossing-two-walls", {
		gesture: () =>
			flingWithMomentum({
				burstCount: 12,
				burstDelta: -600,
				burstGap: 8,
				tailMs: 1600,
				tailStart: -800,
			}),
		settleMs: 2400,
		beforeSettle: () => shot(`${MODE}-06-fling-crossing-two-walls-at-act-end`),
		note: "one act, two walls: at least two reveals, and no stretch at the hard top longer than the lead",
	}),
);
await shot(`${MODE}-06-fling-crossing-two-walls`);

/*
 * THE FREEZE, and the copy the reader reads while it happens.
 *
 * From the ARRIVAL state — the one state the fixture guarantees identically on
 * both arms — the reader arrives at the wall and keeps pushing. Round 1 drove
 * this from a setup that reached "the wall" by measurement and inherited
 * leftovers, so the arms measured different scenes (`d = 24` against
 * `d = 7790`): a landing inserts its rows ABOVE the reader and moves them off
 * the wall by the inserted extent, which is the app answering them. There is no
 * setup here, so there is nothing for the arms to diverge in at the start.
 *
 * What the row is FOR is the copy timeline (`slotTransitions`) and the landing:
 * on the replaced module a reader pinned at the top is told to "scroll up to
 * load" while the app is finishing exactly that load, and repainted 105ms later
 * with a different count (design round 1, D1-3; UX round 1, U1-2). On this
 * branch: one statement per act.
 */
phase2.push(
	await arrivalScenario("page-lands-with-rows-hidden", {
		gesture: async () => {
			await fling(40, -420, 10);
			await sleep(400);
			await fling(120, -80, 10);
		},
		settleMs: 2200,
		beforeSettle: () =>
			shot(`${MODE}-07-page-lands-with-rows-hidden-at-act-end`),
		note: "arrive at the wall, then keep pushing: one statement per act, and a page that lands with its rows held back gets the widen that shows it",
	}),
);
await shot(`${MODE}-07-page-lands-with-rows-hidden`);

/*
 * The bound rule 4 exists for, on the real surface: 200 notches from the arrival
 * state, which is the same start on both arms.
 *
 * The claim is about the PAGE COUNT per act, not about where the reader ends up:
 * on the replaced module the finger reaches the wall and stays there for the
 * rest of the act with the conversation unloaded (the freeze), and on this
 * branch the app answers and the reader travels into what it answered. Counting
 * pages per act keeps the two arms comparable without pretending they end in the
 * same place — they end in different places BECAUSE of the change, which is the
 * reading the README states in those words.
 */
phase2.push(
	await arrivalScenario("resting-finger-at-clamped-top", {
		gesture: () => fling(200, -80, 10),
		settleMs: 2400,
		beforeSettle: () =>
			shot(`${MODE}-08-resting-finger-at-clamped-top-at-act-end`),
		note: "200 notches at the clamp from the arrival state: the page count must not grow with the notch count",
	}),
);
await shot(`${MODE}-08-resting-finger-at-clamped-top`);

/*
 * A DELIBERATE SLOW APPROACH INTO THE ZONE — the scenario the review asked for
 * (R1-1, R1-2): the same start state on both arms, and the one gesture that
 * separates the two modules' triggers.
 *
 * The reader is placed just outside the prefetch zone by measurement, then moves
 * at 0.3px/ms (a deliberate scroll) in a single act — the notches are 100ms
 * apart, inside `SETTLE_MS`, so the debounce never elapses while they move. On
 * the replaced module the only triggers are that debounce and the hard top, so
 * nothing is spent until the train stops; on this branch the demand is spent as
 * the reader reaches the threshold, while they are still moving, with about a
 * second of travel left before the wall.
 *
 * The number that reads it out is `revealsInsideZoneBeforeLastInput`.
 */
/*
 * The setup's own outcome, handed to `analyse` through the gesture's return
 * value. It is a module-scope `let` because the setup runs in a different
 * closure from the gesture: `scenario` reports `extra` from the GESTURE's
 * return, and the setup's report has to ride along with it. (Order matters —
 * the declaration must precede the `await arrivalScenario(...)` below, which is
 * a module-level statement, or the read is a temporal-dead-zone throw.)
 */
let slowSetupResult = null;

phase2.push(
	await arrivalScenario("slow-approach-into-zone", {
		setup: async () => {
			const coarse = await notchUntil(approachingTheZone, {
				deltaY: -420,
				gapMs: 24,
			});
			const fine = await driveTo(justOutsideTheZone, {
				deltaY: -120,
				gapMs: 40,
				maxNotches: 220,
			});
			slowSetupResult = {
				coarseNotches: coarse.notches,
				reached: fine.reached,
				tries: fine.tries,
				distance: Math.round(fine.state.distanceFromTop),
				zonePx: zonePxFor(fine.state.clientHeight),
			};
			await sleep(1200);
		},
		gesture: async () => {
			for (let i = 0; i < 30; i++) {
				await wheel(-30);
				await sleep(100);
			}
			return { setupToZone: slowSetupResult };
		},
		settleMs: 2000,
		note: "0.3px/ms into the zone from a measured start: detected motion, spent while the reader is still moving",
	}),
);

/*
 * A train that stops well outside every window. THE NEGATIVE CONTROL for the
 * lead: 4 viewports is 1956px on this fixture and the row is about a train that
 * ends 2000px+ away, so the fixed behaviour here is ZERO requests — a lead that
 * spent from there would be arming a page for a reader with screens to go.
 */
phase2.push(
	await arrivalScenario("continuous-train-beyond-the-lead", {
		gesture: () => fling(6, -200, 12),
		settleMs: 1600,
		note: "800px of travel that neither settles in the zone nor reaches the wall, and stays beyond the lead: nothing may be spent",
	}),
);

/*
 * The keyboard clause, which the diagnosis run could not reach at all. The
 * scroller is focused first (the app's listener is on it, not on the document)
 * and the recorded event count is reported, so a zero here says which half
 * refused rather than reading as a clause that never fires.
 */
let focused = "not attempted";
phase2.push(
	await arrivalScenario("keyboard-home", {
		setup: async () => {
			focused = await focusTranscript();
		},
		gesture: async () => {
			await key("Home");
			// Returned rather than closed over: the focus result is only known
			// after `setup` has run, and `extra` is read from what the gesture
			// returns.
			return { focus: await focusTranscriptAgain(focused) };
		},
		settleMs: 2000,
		note: "one Home keystroke on the transcript, focused after the reload: one reveal, and a page only if one was already owed",
	}),
);
await shot(`${MODE}-09-keyboard-home`);

/*
 * A real scrollbar JOURNEY, from a state that still has history: dragging until
 * the reader is near the top, because a single drag cannot reach the clause it
 * is named for (review round 1, Q1-2; UX round 1 flow 5e took four drags to
 * `d = 560` and spent the fourth).
 */
const dragArrival = await freshArrival();
phase2.push(
	await scenario("scrollbar-drag-to-top", () => dragJourney(), {
		settleMs: 2000,
		note: `dragging the gutter until the reader is near the top, from ${Math.round(dragArrival.distanceFromTop)}px of overflow`,
		startDistance: Math.round(dragArrival.distanceFromTop),
	}),
);
await shot(`${MODE}-10-scrollbar-drag-to-top`);

report.scenarios = report.steps.filter(
	(step) => step.expectation !== undefined || step.note !== undefined,
);
/*
 * The full per-frame timeline of every scenario, beside the summary above.
 *
 * Why the raw timeline is committed into the JSON rather than only summarised:
 * the summary is where the reader looks, and the timeline is what makes the
 * summary falsifiable. A clamp verdict is exactly the kind the object being
 * measured can produce, and a reader who wants to check "no reveal for 866ms at
 * the hard top" against the frames rather than against my arithmetic needs the
 * frames.
 */
report.phase2Timeline = phase2.map((entry) => ({
	name: entry.measured.step,
	events: entry.events,
	samples: entry.samples.slice(-1400),
}));

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
