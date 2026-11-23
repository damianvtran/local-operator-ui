import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The send's scroll-to-tail motion, in memory (operator report, 2026-11-23:
 * "if you're scrolled up somewhere and you send a message, it properly smoothly
 * scrolls the user down to the sent message (faster if farther up) and anchors
 * them to the live streaming").
 *
 * `scroll-to-tail.ts` is written against a minimal element shape and injected
 * clocks precisely so these claims are decidable without a DOM: the duration
 * model, the snap/none/animate decision, that every frame lands on the
 * column-reverse tail (0) even while content grows, that a reader's gesture
 * cancels the flight, and that mid-flight writes are claimed by the paging
 * hook's sink while the landing is left for it to observe. That the composer
 * ASKS for the tail on an echoed send is pinned in `echo-delivery.test.mjs`.
 *
 * The paging policy is bundled beside it because the snap threshold must BE
 * the follow epsilon, not a number that happens to match today.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/shared/hooks/scroll-to-tail";',
			'export { TAIL_EPS_PX } from "./src/renderer/src/features/chat/canonical/scroll-paging";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const m = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A scroller in a column-reverse axis: offsets are <= 0, clamped like the browser. */
function fakeScroller(start, { minTop = -1e9 } = {}) {
	const listeners = new Map();
	let top = start;
	const el = {
		writes: [],
		get scrollTop() {
			return top;
		},
		set scrollTop(value) {
			top = Math.min(0, Math.max(minTop, value));
			el.writes.push(top);
		},
		addEventListener(type, fn) {
			listeners.set(type, fn);
		},
		removeEventListener(type, fn) {
			if (listeners.get(type) === fn) listeners.delete(type);
		},
		fire(type) {
			listeners.get(type)?.();
		},
		listening: () => [...listeners.keys()].sort(),
	};
	return el;
}

/** Frames advance only when the test says so; `step` runs one frame at +ms. */
function fakeEnv({ reducedMotion = false } = {}) {
	let clock = 1000;
	let queued = null;
	let next = 1;
	return {
		raf: (cb) => {
			queued = cb;
			return next++;
		},
		caf: () => {
			queued = null;
		},
		now: () => clock,
		reducedMotion: () => reducedMotion,
		step(ms = 16) {
			clock += ms;
			const cb = queued;
			queued = null;
			cb?.(clock);
			return cb !== null;
		},
		pending: () => queued !== null,
	};
}

function run(el, env) {
	const outcomes = [];
	const cancel = m.scrollToTail(el, env, (o) => outcomes.push(o));
	return { outcomes, cancel };
}

/* ------------------------------------------------------------ the model */

test("duration grows sublinearly with distance and is clamped", () => {
	const d = m.tailScrollDurationMs;
	assert.equal(d(0), 0);
	assert.equal(d(100), 180, "120 + 6*10 = 180");
	assert.equal(d(400), 240, "120 + 6*20");
	assert.equal(d(2500), 420, "120 + 6*50");
	assert.equal(d(10000), 600, "720 clamps to MAX");
	assert.equal(
		d(30),
		m.TAIL_SCROLL_MIN_MS,
		"a short hop never drops below MIN",
	);
	// "Faster if farther up": effective speed rises with distance.
	const speed = (px) => px / d(px);
	assert.ok(speed(400) < speed(2500));
	assert.ok(speed(2500) < speed(10000));
});

test("ease-out cubic starts at 0, ends at 1, and front-loads the motion", () => {
	assert.equal(m.easeOutCubic(0), 0);
	assert.equal(m.easeOutCubic(1), 1);
	assert.equal(m.easeOutCubic(2), 1, "a late frame past the duration lands");
	assert.ok(m.easeOutCubic(0.5) > 0.5);
});

test("the snap threshold is the transcript's follow epsilon", () => {
	assert.equal(m.TAIL_SNAP_PX, m.TAIL_EPS_PX);
});

test("plan: at the tail nothing, near it or under reduced motion a snap, else animate", () => {
	assert.equal(m.planTailScroll(0, false), "none");
	assert.equal(m.planTailScroll(-0.2, false), "none");
	assert.equal(m.planTailScroll(-10, false), "snap");
	assert.equal(m.planTailScroll(-5000, true), "snap");
	assert.equal(m.planTailScroll(-5000, false), "animate");
});

/* ------------------------------------------------------------ the driver */

test("a scrolled-up reader is animated to the tail over the modelled duration", () => {
	const el = fakeScroller(-2500);
	const env = fakeEnv();
	const { outcomes } = run(el, env);
	assert.equal(el.writes.length, 0, "nothing moves before the first frame");
	let frames = 0;
	while (env.pending() && frames < 200) {
		env.step(16);
		frames++;
	}
	assert.deepEqual(outcomes, ["landed"]);
	assert.equal(el.scrollTop, 0);
	// 420 ms at 16 ms frames; the first frame starts the clock.
	assert.equal(frames, Math.ceil(420 / 16) + 1);
	for (let i = 1; i < el.writes.length; i++)
		assert.ok(el.writes[i] >= el.writes[i - 1], "monotonic toward the tail");
	assert.deepEqual(el.listening(), [], "cancel listeners are removed");
});

test("already at the tail: no write, no listeners, settles 'none'", () => {
	const el = fakeScroller(0);
	const env = fakeEnv();
	const { outcomes } = run(el, env);
	assert.deepEqual(outcomes, ["none"]);
	assert.deepEqual(el.writes, []);
	assert.equal(env.pending(), false);
});

test("reduced motion snaps to the tail in one synchronous write", () => {
	const el = fakeScroller(-8000);
	const env = fakeEnv({ reducedMotion: true });
	const { outcomes } = run(el, env);
	assert.deepEqual(outcomes, ["snapped"]);
	assert.deepEqual(el.writes, [0]);
	assert.equal(env.pending(), false);
});

for (const gesture of ["wheel", "touchstart", "pointerdown", "keydown"]) {
	test(`a ${gesture} during the flight cancels it and leaves the reader in control`, () => {
		const el = fakeScroller(-3000);
		const env = fakeEnv();
		const { outcomes } = run(el, env);
		env.step(16);
		env.step(16);
		const where = el.scrollTop;
		assert.ok(where < 0 && where > -3000, "mid-flight");
		el.fire(gesture);
		assert.deepEqual(outcomes, ["cancelled"]);
		assert.equal(env.pending(), false, "no further frame is queued");
		el.scrollTop = -2900; // the reader's own scroll
		env.step(16);
		assert.equal(el.scrollTop, -2900, "the flight never writes again");
		assert.deepEqual(el.listening(), []);
	});
}

test("content growing during the flight cannot strand it short of the tail", () => {
	/*
	 * Streaming growth ABOVE a reader in a column-reverse scroller is absorbed by
	 * the browser's scroll anchoring, which shifts `scrollTop` away from the tail
	 * by the grown height - on every frame a token lands. A driver that stepped
	 * relatively (`scrollTop += step`) would carry every shift and land short;
	 * this one writes the absolute eased offset each frame, so each write must
	 * equal the model's value for that frame whatever the anchoring did, and the
	 * landing must be exactly 0 and STAY 0 (agent review round 1, R1-3).
	 */
	const el = fakeScroller(-1200);
	const env = fakeEnv();
	const { outcomes } = run(el, env);
	const duration = m.tailScrollDurationMs(1200);
	env.step(16); // the first frame reads start and starts the clock
	let elapsed = 0;
	let frames = 0;
	while (env.pending() && frames < 200) {
		el.scrollTop = el.scrollTop - 40; // the anchoring shift of one token
		env.step(16);
		elapsed += 16;
		frames++;
		assert.equal(
			el.scrollTop,
			m.tailOffsetAt(-1200, elapsed, duration),
			`frame ${frames} is the absolute eased offset, not a step from the shifted one`,
		);
	}
	assert.deepEqual(outcomes, ["landed"]);
	assert.equal(el.scrollTop, 0);
	const writes = el.writes.length;
	env.step(16);
	assert.equal(el.scrollTop, 0, "the landing holds: no frame is left queued");
	assert.equal(el.writes.length, writes, "and nothing writes after it");
});

test("the start is read on the first frame, so a shift before it is not a jump (Q-1)", () => {
	/*
	 * A send asks at the echo's paint; the echo then lands and the browser's
	 * anchoring moves the reader one row farther away before the first frame.
	 * The first frame must start from THAT position (a no-op write), not snap
	 * back to the call-time offset, and the trip is timed from it.
	 */
	const el = fakeScroller(-3020);
	const env = fakeEnv();
	run(el, env);
	el.scrollTop = -3130; // the echo's anchoring shift, after the call
	el.writes.length = 0;
	env.step(16);
	assert.deepEqual(
		el.writes,
		[-3130],
		"the first frame writes where the reader is",
	);
	let frames = 1;
	while (env.pending() && frames < 200) {
		env.step(16);
		frames++;
	}
	assert.equal(el.scrollTop, 0);
	assert.equal(
		frames,
		Math.ceil(m.tailScrollDurationMs(3130) / 16) + 1,
		"timed from the post-shift distance",
	);
});

test("mid-flight writes are claimed by the paging sink; the landing is left to be observed", () => {
	const el = fakeScroller(-2000);
	const env = fakeEnv();
	const acks = [];
	let released = 0;
	const flight = [];
	const unregister = m.registerScrollerWriteSink(el, {
		acknowledge: (before, after) => acks.push([before, after]),
		releaseHold: () => {
			released++;
		},
		setFlight: (active) => flight.push(active),
	});
	run(el, env);
	assert.equal(released, 1, "the reader-hold is dropped as the flight starts");
	assert.deepEqual(
		flight,
		[true],
		"the pager is told a flight owns the offset",
	);
	while (env.pending()) env.step(16);
	assert.equal(el.scrollTop, 0);
	assert.deepEqual(flight, [true, false], "and told when it ends");
	assert.equal(
		acks.length,
		el.writes.length - 1,
		"every write but the landing is acknowledged",
	);
	for (const [i, [before, after]] of acks.entries()) {
		assert.equal(
			after,
			el.writes[i],
			"the acknowledged offset is the one written",
		);
		assert.ok(before <= after);
	}
	unregister();
});

test("unregister only removes its own sink, not a newer one on the same scroller", () => {
	/*
	 * The transcript can remount under a mounted scroller: the new hook registers
	 * before the old one's cleanup runs. The stale cleanup must leave the new
	 * sink in place, or the next flight's frames go unclaimed.
	 */
	const el = fakeScroller(-2000);
	const older = [];
	const newer = [];
	const unregisterOlder = m.registerScrollerWriteSink(el, {
		acknowledge: (b, a) => older.push([b, a]),
		releaseHold() {},
	});
	const unregisterNewer = m.registerScrollerWriteSink(el, {
		acknowledge: (b, a) => newer.push([b, a]),
		releaseHold() {},
	});
	unregisterOlder();
	const env = fakeEnv();
	run(el, env);
	env.step(16);
	env.step(16);
	assert.ok(newer.length > 0, "the newer sink still receives acknowledgements");
	assert.equal(older.length, 0);
	unregisterNewer();
	const after = newer.length;
	env.step(16);
	assert.equal(newer.length, after, "its own unregister does remove it");
});

test("a cancelled flight also tells the pager it is over", () => {
	const el = fakeScroller(-2000);
	const flight = [];
	const unregister = m.registerScrollerWriteSink(el, {
		acknowledge() {},
		releaseHold() {},
		setFlight: (active) => flight.push(active),
	});
	const env = fakeEnv();
	run(el, env);
	env.step(16);
	el.fire("wheel");
	assert.deepEqual(flight, [true, false]);
	unregister();
});

test("a scroller with no paging sink (another host) still animates", () => {
	const el = fakeScroller(-900);
	const env = fakeEnv();
	const { outcomes } = run(el, env);
	while (env.pending()) env.step(16);
	assert.deepEqual(outcomes, ["landed"]);
	assert.equal(el.scrollTop, 0);
});

test("cancel() is idempotent and settles once", () => {
	const el = fakeScroller(-900);
	const env = fakeEnv();
	const { outcomes, cancel } = run(el, env);
	env.step(16);
	cancel();
	cancel();
	assert.deepEqual(outcomes, ["cancelled"]);
	assert.equal(env.pending(), false);
});
