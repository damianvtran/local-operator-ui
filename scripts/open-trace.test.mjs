import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The conversation-open trace (`src/renderer/src/features/chat/open-trace.ts`).
 *
 * Why these cases. The trace exists to answer "how long does a sidebar open
 * take" with a number per switch, read from the shipped app's log. Three things
 * would make that number lie, and each is pinned here against the shipped
 * TypeScript (bundled in memory, the `about-panel.test.mjs` pattern):
 *
 *   * stage ORDER and derivation: `painted` only ever comes from the frame after
 *     `content`, `settled` is the later of `painted` and `sendable`;
 *   * SUPERSESSION: an A->B burst ends A as `superseded`, and A's late stages
 *     can never be stamped onto B (nor onto a second A);
 *   * the NO-CONTENT guard: the line carries only the token, a shape-checked
 *     session id, a fixed entrance label, numbers and the outcome.
 *
 * Plus the wiring: the entrances that start a trace, and that each stage hook
 * is present at the site the comment in `open-trace.ts` names.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/features/chat/open-trace";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	createOpenTracer,
	watchSendable,
	afterNextPaint,
	formatOpenTraceLine,
	OPEN_TRACE_TIMEOUT_MS,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The paint cache, bundled separately: the trace's paint fields report what this
 * module measured (`bytes`) and why an id had nothing to paint (`paintMissReason`),
 * so its contract is part of what those fields claim.
 *
 * THE i18n STUBS ARE AN ENVIRONMENT WORKAROUND, NOT A SHORTCUT. `paint-cache`
 * imports `dropLiveRecords` from the transcript reducer, which imports
 * `src/i18n/messages.ts` and `bidi.ts`; those two import the DECLARED and LOCKED
 * `intl-messageformat` / `@formatjs/icu-messageformat-parser`, which are missing
 * from this checkout's `node_modules` (`scripts/seed-label-gap.test.mjs` fails to
 * build for exactly the same reason on this host). Nothing this test exercises
 * formats a message, so the boundary is stubbed rather than the cache being
 * re-implemented here.
 */
const i18nStub = {
	name: "i18n-boundary-stub",
	setup(builder) {
		builder.onResolve({ filter: /^intl-messageformat$|^@formatjs\// }, () => ({
			path: "i18n-boundary",
			namespace: "i18n-stub",
		}));
		builder.onLoad({ filter: /.*/, namespace: "i18n-stub" }, () => ({
			contents:
				'export class IntlMessageFormat { constructor() {} format() { return ""; } }\n' +
				"export const TYPE = { literal: 0, argument: 1, number: 2, date: 3, time: 4, select: 5, plural: 6, pound: 7, tag: 8 };\n",
			loader: "js",
		}));
	},
};

const paintBundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/shared/store/paint-cache";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [i18nStub],
});
const paintCache = await import(
	`data:text/javascript;base64,${Buffer.from(paintBundle.outputFiles[0].text).toString("base64")}`
);

/** A tracer on a fake clock, frame queue and timer list. */
function rig() {
	const clock = { now: 0 };
	const frames = [];
	const timers = new Map();
	let nextTimer = 1;
	const lines = [];
	const tracer = createOpenTracer({
		now: () => clock.now,
		nextFrame: (cb) => frames.push(cb),
		log: (line) => lines.push(line),
		setTimer: (cb, ms) => {
			const id = nextTimer++;
			timers.set(id, { cb, at: clock.now + ms });
			return id;
		},
		clearTimer: (id) => timers.delete(id),
	});
	return {
		tracer,
		lines,
		at(ms) {
			clock.now = ms;
		},
		flushFrames(ms) {
			if (ms !== undefined) clock.now = ms;
			for (const cb of frames.splice(0)) cb();
		},
		fireTimers(ms) {
			clock.now = ms;
			for (const [id, t] of [...timers]) {
				if (t.at <= ms) {
					timers.delete(id);
					t.cb();
				}
			}
		},
		timerCount: () => timers.size,
	};
}

/** Parses `key=value` pairs out of one trace line. */
function fields(line) {
	return Object.fromEntries(
		line
			.split(" ")
			.slice(1)
			.map((part) => part.split("=")),
	);
}

test("a full switch reports every stage in ms from the click and settles once", () => {
	const r = rig();
	r.at(1000);
	const beforeClickEpoch = performance.timeOrigin + performance.now();
	const t = r.tracer.begin("abc123", "sidebar");
	const afterClickEpoch = performance.timeOrigin + performance.now();
	r.at(1004);
	r.tracer.note("abc123", "routed");
	r.at(1800);
	r.tracer.note("abc123", "snapshot");
	r.at(1810);
	r.tracer.note("abc123", "sendable");
	r.at(1900);
	r.tracer.note("abc123", "content");
	assert.equal(
		r.lines.length,
		0,
		"content alone is not settled: paint pending",
	);
	r.flushFrames(1916);
	assert.equal(r.lines.length, 1);
	assert.equal(
		r.lines[0],
		`[open-trace] t=${t} clickEpochMs=${fields(r.lines[0]).clickEpochMs} session=abc123 via=sidebar outcome=settled store=- routed=4 request=- snapshot=800 content=900 painted=916 sendable=810 settled=916 paint=- paintAt=- paintRows=- paintBytes=- paintReason=- paintFills=-`,
	);
	assert.ok(Number(fields(r.lines[0]).clickEpochMs) >= beforeClickEpoch);
	assert.ok(Number(fields(r.lines[0]).clickEpochMs) <= afterClickEpoch);
	assert.equal(r.timerCount(), 0, "the timeout is cleared on settle");
	// Late stages after settle write nothing.
	r.tracer.note("abc123", "content");
	r.flushFrames(2000);
	assert.equal(r.lines.length, 1);
});

test("settled is the later of painted and sendable, in either order", () => {
	const r = rig();
	r.tracer.begin("s1", "open");
	r.at(100);
	r.tracer.note("s1", "content");
	r.flushFrames(110);
	assert.equal(r.lines.length, 0, "painted without sendable is not settled");
	r.at(450);
	r.tracer.note("s1", "sendable");
	const f = fields(r.lines[0]);
	assert.equal(f.outcome, "settled");
	assert.equal(f.painted, "110");
	assert.equal(f.settled, "450");
});

test("painted is only derived from content's next frame, never noted directly", () => {
	const r = rig();
	r.tracer.begin("s1", "open");
	r.at(5);
	r.tracer.note("s1", "painted");
	r.tracer.note("s1", "sendable");
	assert.equal(r.lines.length, 0);
	r.at(20);
	r.tracer.note("s1", "content");
	r.at(30);
	r.tracer.note("s1", "content"); // a second commit must not move content or queue a second frame
	r.flushFrames(36);
	const f = fields(r.lines[0]);
	assert.equal(f.content, "20");
	assert.equal(f.painted, "36");
});

test("first write wins for every stage", () => {
	const r = rig();
	r.tracer.begin("s1", "open");
	r.at(10);
	r.tracer.note("s1", "snapshot");
	r.at(500);
	r.tracer.note("s1", "snapshot");
	r.tracer.note("s1", "sendable");
	r.tracer.note("s1", "content");
	r.flushFrames(520);
	assert.equal(fields(r.lines[0]).snapshot, "10");
});

test("A->B before A paints: A is superseded, and its late frame never lands on B", () => {
	const r = rig();
	r.at(0);
	const a = r.tracer.begin("aaa", "sidebar");
	r.at(300);
	r.tracer.note("aaa", "snapshot");
	r.at(400);
	r.tracer.note("aaa", "content"); // A's paint frame is queued...
	r.at(450);
	const b = r.tracer.begin("bbb", "sidebar"); // ...and B starts before it runs
	assert.equal(r.lines.length, 1);
	const fa = fields(r.lines[0]);
	assert.equal(fa.outcome, "superseded");
	assert.equal(fa.t, String(a));
	assert.equal(fa.by, `t${b}`);
	assert.equal(fa.session, "aaa");
	assert.equal(fa.snapshot, "300");
	assert.equal(fa.painted, "-");
	assert.equal(fa.settled, "-");
	// A's frame runs now; B's stages for A's id are ignored too.
	r.flushFrames(460);
	r.tracer.note("aaa", "sendable");
	r.at(1450);
	r.tracer.note("bbb", "sendable");
	r.tracer.note("bbb", "content");
	r.flushFrames(1466);
	assert.equal(r.lines.length, 2);
	const fb = fields(r.lines[1]);
	assert.equal(fb.outcome, "settled");
	assert.equal(fb.t, String(b));
	assert.equal(fb.content, "1000", "B is timed from B's own click, not A's");
	assert.equal(fb.painted, "1016");
});

test("A->B->A: the first A's queued frame cannot stamp the second A", () => {
	const r = rig();
	r.tracer.begin("aaa", "open");
	r.at(10);
	r.tracer.note("aaa", "content");
	r.at(20);
	r.tracer.begin("bbb", "open");
	r.at(30);
	r.tracer.begin("aaa", "open");
	r.flushFrames(40); // the FIRST A's frame
	r.tracer.note("aaa", "sendable");
	assert.equal(r.lines.length, 2, "two superseded lines, second A still open");
	r.at(100);
	r.tracer.note("aaa", "content");
	r.flushFrames(116);
	const f = fields(r.lines[2]);
	assert.equal(f.outcome, "settled");
	assert.equal(f.content, "70");
	assert.equal(f.painted, "86");
});

test("an unsettled trace times out with what it reached", () => {
	const r = rig();
	r.tracer.begin("empty1", "open");
	r.at(50);
	r.tracer.note("empty1", "sendable");
	r.fireTimers(OPEN_TRACE_TIMEOUT_MS);
	const f = fields(r.lines[0]);
	assert.equal(f.outcome, "timeout");
	assert.equal(f.sendable, "50");
	assert.equal(f.content, "-");
	// A stale timer of a superseded trace must not end its successor.
	const r2 = rig();
	r2.tracer.begin("a", "open");
	r2.at(10);
	r2.tracer.begin("b", "open");
	r2.fireTimers(OPEN_TRACE_TIMEOUT_MS + 5);
	assert.equal(
		r2.lines.length,
		1,
		"only A's superseded line; B's own timer is not due",
	);
});

test("fail ends only the matching trace", () => {
	const r = rig();
	r.tracer.begin("gone", "open");
	r.tracer.fail("other", "missing");
	assert.equal(r.lines.length, 0);
	r.at(700);
	r.tracer.fail("gone", "missing");
	assert.equal(fields(r.lines[0]).outcome, "missing");
	assert.equal(r.tracer.activeSessionId(), null);
});

test("no-content guard: the line is a fixed grammar of ids, labels and numbers", () => {
	const shape =
		/^\[open-trace\] t=\d+ clickEpochMs=(\d+(\.\d+)?|-) session=([A-Za-z0-9_-]{1,80}|\?) via=(sidebar|open|native) outcome=(settled|superseded|missing|left|timeout) store=(\d+|-) routed=(\d+|-) request=(\d+|-) snapshot=(\d+|-) content=(\d+|-) painted=(\d+|-) sendable=(\d+|-) settled=(\d+|-) paint=(cache|none|empty|-) paintAt=(\d+|-) paintRows=(\d+|-) paintBytes=(\d+|-) paintReason=(no-entry|empty-after-trim|evicted|-) paintFills=([01]|-)( by=t\d+)?$/;
	const line = formatOpenTraceLine(
		{
			token: 7,
			sessionId: "Quarterly board notes: Acme acquisition",
			entrance: "some title",
			start: 0,
			stages: { content: 12.6 },
		},
		"timeout",
	);
	assert.match(line, shape);
	assert.ok(
		!line.includes("Acme"),
		"free text in the id slot is never printed",
	);
	assert.ok(!line.includes("title"), "an unknown entrance is never printed");
	assert.equal(fields(line).session, "?");
	assert.equal(fields(line).content, "13");
	const r = rig();
	r.tracer.begin("0a824c0fc131", "native");
	r.tracer.begin("3f2b-uuid_like", "sidebar");
	for (const l of r.lines) assert.match(l, shape);
});

/** A minimal store double: state + subscribe, the zustand shape the watcher uses. */
function store(initial) {
	let state = initial;
	const listeners = new Set();
	return {
		read: () => state,
		subscribe: (l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		set(patch) {
			state = { ...state, ...patch };
			for (const l of [...listeners]) l();
		},
		listenerCount: () => listeners.size,
	};
}

test("sendable waits for the switch's validation window to close (openSession path)", () => {
	const r = rig();
	const s = store({ activeSessionId: "old", validatingSessionId: null });
	const id = r.tracer.begin("new1", "sidebar");
	watchSendable(r.tracer, id, s.read, s.subscribe);
	// Before the commit the store is on the old session with no window: not sendable.
	r.at(5);
	s.set({ activeSessionId: "new1", validatingSessionId: "new1" });
	r.at(900);
	s.set({ validatingSessionId: null });
	r.tracer.note("new1", "content");
	assert.equal(s.listenerCount(), 1, "still watching until the trace ends");
	r.flushFrames(916);
	assert.equal(fields(r.lines[0]).sendable, "900");
	/*
	 * The store's commit is its own stage, stamped where the store's own
	 * subscriber first sees the target - NOT where `sendable` lands, which waits
	 * for the validation window and is hundreds of milliseconds later. The two
	 * numbers are the difference between "the write happened" and "the composer
	 * would accept a send", and collapsing them is what made the old line unable
	 * to say which part of the click was slow.
	 */
	assert.equal(fields(r.lines[0]).store, "5");
	// N1: the watcher detaches the moment its trace ends, not on a later write.
	assert.equal(s.listenerCount(), 0);
});

test("sendable on commit for the native path, which opens no window", () => {
	const r = rig();
	const s = store({ activeSessionId: "old", validatingSessionId: null });
	const id = r.tracer.begin("n1", "native");
	watchSendable(r.tracer, id, s.read, s.subscribe);
	r.at(3);
	s.set({ activeSessionId: "n1" });
	r.tracer.note("n1", "content");
	r.flushFrames(19);
	assert.equal(fields(r.lines[0]).sendable, "3");
});

test("leaving the target without a new open ends the trace as left", () => {
	const r = rig();
	const s = store({ activeSessionId: "old", validatingSessionId: null });
	const id = r.tracer.begin("x1", "sidebar");
	watchSendable(r.tracer, id, s.read, s.subscribe);
	s.set({ activeSessionId: "x1", validatingSessionId: "x1" });
	r.at(200);
	s.set({ activeSessionId: null, validatingSessionId: null }); // New chat
	assert.equal(fields(r.lines[0]).outcome, "left");
	assert.equal(fields(r.lines[0]).sendable, "-");
});

test("a superseded trace's watcher does not stamp the newer trace", () => {
	const r = rig();
	const s = store({ activeSessionId: "old", validatingSessionId: null });
	const a = r.tracer.begin("a1", "sidebar");
	watchSendable(r.tracer, a, s.read, s.subscribe);
	s.set({ activeSessionId: "a1", validatingSessionId: "a1" });
	const b = r.tracer.begin("b1", "sidebar");
	watchSendable(r.tracer, b, s.read, s.subscribe);
	r.at(40);
	s.set({ activeSessionId: "b1", validatingSessionId: "b1" });
	assert.equal(
		r.lines.length,
		1,
		"A's watcher did not report B's move as A having left",
	);
	r.at(600);
	s.set({ validatingSessionId: null });
	r.tracer.note("b1", "content");
	r.flushFrames(616);
	assert.equal(fields(r.lines[1]).sendable, "600");
	// Both watchers detached when their traces ended (A superseded, B settled).
	assert.equal(s.listenerCount(), 0);
});

/*
 * A store fake that mirrors the REAL field writes of `canonical-sessions-store.ts`
 * (R3): `openSession` (no-op arm when already on the id with no draft; else
 * sets the id, clears the draft key and opens the validation window in one
 * write), `stageDraft` (sets `activeDraftKey`, closes the window, LEAVES
 * `activeSessionId`), and the validation clear. `open` mirrors
 * `beginOpenTrace` + `openConversation`: the guard, `begin` before the store
 * write, the watcher. Driving this is what catches a watcher that reads only
 * `activeSessionId` (R1).
 */
function sessionsStore(tracer, initial) {
	const s = store({
		activeSessionId: null,
		activeDraftKey: null,
		validatingSessionId: null,
		...initial,
	});
	return {
		...s,
		openSession(id) {
			const st = s.read();
			if (st.activeSessionId === id && !st.activeDraftKey) return;
			s.set({
				activeSessionId: id,
				activeDraftKey: null,
				validatingSessionId: id,
			});
		},
		stageDraft(key = "new:1") {
			s.set({ activeDraftKey: key, validatingSessionId: null });
		},
		validated() {
			s.set({ validatingSessionId: null });
		},
		open(id, entrance = "sidebar") {
			const st = s.read();
			if (!(st.activeSessionId === id && !st.activeDraftKey)) {
				const token = tracer.begin(id, entrance);
				watchSendable(tracer, token, s.read, s.subscribe);
			}
			this.openSession(id);
		},
	};
}

test("R1: New chat over A, then click A: no false sendable before A's validation window", () => {
	const r = rig();
	const s = sessionsStore(r.tracer, { activeSessionId: "aaa" });
	s.stageDraft(); // New chat: activeSessionId stays "aaa"
	r.at(0);
	s.open("aaa");
	assert.equal(r.tracer.activeSessionId(), "aaa", "a trace started");
	r.at(1000);
	r.tracer.note("aaa", "content");
	r.flushFrames(1016);
	assert.equal(r.lines.length, 0, "not settled: validation still open");
	r.at(1200);
	s.validated();
	const f = fields(r.lines[0]);
	assert.equal(f.outcome, "settled");
	assert.equal(f.sendable, "1200", "the real window close, not 0");
	assert.equal(f.settled, "1200");
});

test("R1: click B, then New chat while B loads: the trace ends as left, never sendable", () => {
	const r = rig();
	const s = sessionsStore(r.tracer, { activeSessionId: "aaa" });
	r.at(0);
	s.open("bbb");
	r.at(200);
	s.stageDraft(); // clears validatingSessionId while activeSessionId is still bbb
	assert.equal(r.lines.length, 1);
	const f = fields(r.lines[0]);
	assert.equal(f.outcome, "left");
	assert.equal(f.sendable, "-");
	assert.equal(s.listenerCount(), 0, "the watcher detached on left");
	assert.equal(r.tracer.activeSessionId(), null);
});

test("R3: realistic store, plain switch settles on the validation clear; reselect starts nothing", () => {
	const r = rig();
	const s = sessionsStore(r.tracer, { activeSessionId: "aaa" });
	s.open("aaa"); // reselect of the row on screen
	assert.equal(r.tracer.activeSessionId(), null);
	r.at(0);
	s.open("bbb");
	r.at(5);
	r.tracer.note("bbb", "routed");
	r.at(700);
	s.validated();
	r.at(800);
	r.tracer.note("bbb", "content");
	r.flushFrames(820);
	const f = fields(r.lines[0]);
	assert.equal(f.outcome, "settled");
	assert.equal(f.sendable, "700");
	assert.equal(f.painted, "820");
	assert.equal(s.listenerCount(), 0);
});

test("R2: painted lands in the task after the frame, not in the rAF callback", () => {
	const order = [];
	const frames = [];
	const tasks = [];
	afterNextPaint(
		() => order.push("painted"),
		(cb) => frames.push(cb),
		(cb) => tasks.push(cb),
	);
	assert.deepEqual(order, []);
	// The rendering update: rAF callbacks, then style/layout/paint.
	for (const cb of frames.splice(0)) cb();
	order.push("style-layout-paint");
	assert.deepEqual(
		order,
		["style-layout-paint"],
		"not inside the rAF callback",
	);
	for (const cb of tasks.splice(0)) cb();
	assert.deepEqual(order, ["style-layout-paint", "painted"]);
});

test("R2: the shipped nextFrame posts a message from inside rAF", () => {
	const src = readFileSync(
		join(process.cwd(), "src/renderer/src/features/chat/open-trace.ts"),
		"utf8",
	);
	assert.match(
		src,
		/afterNextPaint\(\s*callback,\s*\(cb\) => requestAnimationFrame\(\(\) => cb\(\)\),\s*postMessageTask,?\s*\)/,
	);
	assert.match(src, /channel\.port2\.postMessage\(null\)/);
});

test("snapshot from a connection opened under an earlier trace cannot stamp A->B->A's second A", () => {
	const r = rig();
	const first = r.tracer.begin("aaa", "open");
	const firstConnection = r.tracer.currentToken(); // the first A's stream connects
	assert.equal(firstConnection, first);
	r.at(10);
	r.tracer.begin("bbb", "open");
	r.at(20);
	r.tracer.begin("aaa", "open");
	const secondConnection = r.tracer.currentToken();
	r.at(50);
	r.tracer.note("aaa", "snapshot", firstConnection); // late, from the first A
	r.at(300);
	r.tracer.note("aaa", "snapshot", secondConnection);
	r.tracer.note("aaa", "sendable");
	r.tracer.note("aaa", "content");
	r.flushFrames(316);
	assert.equal(fields(r.lines[2]).snapshot, "280");
	// A connection opened with no trace live never stamps one either.
	const r2 = rig();
	r2.tracer.begin("ccc", "open");
	r2.tracer.note("ccc", "snapshot", null);
	r2.tracer.note("ccc", "sendable");
	r2.tracer.note("ccc", "content");
	r2.flushFrames(16);
	assert.equal(fields(r2.lines[0]).snapshot, "-");
});

test("onEnd: runs once on the trace's end, at once for an ended token", () => {
	const r = rig();
	let calls = 0;
	const t = r.tracer.begin("aaa", "open");
	r.tracer.onEnd(t, () => calls++);
	assert.equal(calls, 0);
	r.tracer.begin("bbb", "open");
	assert.equal(calls, 1);
	r.tracer.onEnd(t, () => calls++);
	assert.equal(
		calls,
		2,
		"an already-ended token runs the listener immediately",
	);
});

/*
 * THE `request` STAGE'S TWO WRITERS (agent review round 1, MAJOR 1). The click
 * stamps where it asked for the stream; the pane stamps only when it had to ask
 * itself. The click's stamp is a FALLBACK, so the pane's real stamp replaces it
 * and the fallback stands when the pane adopted the click's connection - which is
 * what makes the line honest in BOTH outcomes rather than only in the one where
 * the fix applied.
 */
test("a real stamp replaces a fallback", () => {
	const r = rig();
	r.at(1000);
	const t = r.tracer.begin("abc123", "sidebar");
	r.at(1002);
	r.tracer.note("abc123", "request", t, { fallback: true });
	r.at(1200);
	r.tracer.note("abc123", "request", t);
	r.at(1300);
	r.tracer.note("abc123", "sendable");
	r.at(1400);
	r.tracer.note("abc123", "content");
	r.flushFrames(1416);
	assert.equal(r.lines.length, 1);
	assert.equal(
		fields(r.lines[0]).request,
		"200",
		"the pane's own ask is the request, not the click's guess",
	);
});

test("a fallback fills the stage when nothing better arrives", () => {
	const r = rig();
	r.at(1000);
	r.tracer.begin("abc123", "sidebar");
	r.at(1003);
	r.tracer.note("abc123", "request", 1, { fallback: true });
	r.at(1300);
	r.tracer.note("abc123", "sendable");
	r.at(1400);
	r.tracer.note("abc123", "content");
	r.flushFrames(1416);
	assert.equal(
		fields(r.lines[0]).request,
		"3",
		"the click's ask stands when the pane adopted it",
	);
});

test("a fallback never displaces a real stamp, and never overwrites another", () => {
	const r = rig();
	r.at(500);
	const t = r.tracer.begin("abc123", "sidebar");
	r.at(510);
	r.tracer.note("abc123", "request", t);
	r.at(520);
	r.tracer.note("abc123", "request", t, { fallback: true });
	r.at(590);
	r.tracer.note("abc123", "sendable");
	r.at(600);
	r.tracer.note("abc123", "content");
	r.flushFrames(620);
	assert.equal(fields(r.lines[0]).request, "10", "the real stamp holds");
});

/*
 * THE PAINT FIELDS (`paint=`, `paintAt=`, `paintRows=`, `paintBytes=`,
 * `paintReason=`, `paintFills=`). Every stage above is keyed on
 * `frontend?.session_id`, which is null until the snapshot - and a cached paint
 * is exactly the case whose rows are on screen while it is still null. These are
 * keyed on the trace's own target instead, which is what lets a shipped-app log
 * say whether the click painted from the cache and where its time went.
 */
test("a seeded paint reports its rows, bytes and fill, timed from the click", () => {
	const r = rig();
	r.at(1000);
	const t = r.tracer.begin("abc123", "sidebar");
	r.at(1006);
	r.tracer.notePaint("abc123", t, {
		kind: "seed",
		source: "cache",
		rows: 100,
		bytes: 241232,
	});
	r.tracer.notePaint("abc123", t, { kind: "fills", fills: true });
	r.at(1900);
	r.tracer.note("abc123", "content");
	r.tracer.note("abc123", "sendable");
	r.flushFrames(1916);
	const f = fields(r.lines[0]);
	assert.equal(f.outcome, "settled");
	assert.equal(f.paint, "cache");
	assert.equal(f.paintAt, "6", "the seed's commit, ms from the click");
	assert.equal(f.paintRows, "100");
	assert.equal(f.paintBytes, "241232");
	assert.equal(f.paintReason, "-", "a hit has no reason to explain");
	assert.equal(f.paintFills, "1");
});

test("a cold pane says none and a dropped entry says empty, each with why", () => {
	const cold = rig();
	cold.tracer.begin("cold1", "sidebar");
	cold.at(4);
	cold.tracer.notePaint("cold1", null, {
		kind: "seed",
		source: "none",
		rows: 0,
		bytes: 0,
		reason: "no-entry",
	});
	cold.fireTimers(OPEN_TRACE_TIMEOUT_MS);
	const fc = fields(cold.lines[0]);
	assert.equal(fc.paint, "none");
	assert.equal(fc.paintAt, "4");
	assert.equal(fc.paintRows, "0");
	assert.equal(fc.paintBytes, "0");
	assert.equal(fc.paintReason, "no-entry");
	assert.equal(
		fc.paintFills,
		"-",
		"nothing was seeded, so there is no painted height this field could be about",
	);

	// An entry that existed and was trimmed to nothing, and one evicted: the two
	// are different answers about the same click, so both the kind and the reason
	// have to survive the round trip.
	const trimmed = rig();
	trimmed.tracer.begin("trim1", "sidebar");
	trimmed.tracer.notePaint("trim1", null, {
		kind: "seed",
		source: "empty",
		rows: 0,
		bytes: 0,
	});
	trimmed.fireTimers(OPEN_TRACE_TIMEOUT_MS);
	assert.equal(fields(trimmed.lines[0]).paint, "empty");
	assert.equal(
		fields(trimmed.lines[0]).paintReason,
		"empty-after-trim",
		"a stamp with no reason defaults by its kind",
	);

	const evicted = rig();
	evicted.tracer.begin("evict1", "sidebar");
	evicted.tracer.notePaint("evict1", null, {
		kind: "seed",
		source: "empty",
		rows: 0,
		bytes: 0,
		reason: "evicted",
	});
	evicted.fireTimers(OPEN_TRACE_TIMEOUT_MS);
	assert.equal(fields(evicted.lines[0]).paintReason, "evicted");
});

test("the paint stage is stamped once and refused for another id or a stale token", () => {
	const r = rig();
	r.at(1000);
	const t = r.tracer.begin("abc123", "sidebar");
	// Another conversation's pane, and a null id: neither may stamp this trace.
	r.at(1002);
	r.tracer.notePaint("other", t, {
		kind: "seed",
		source: "cache",
		rows: 5,
		bytes: 10,
	});
	r.tracer.notePaint(null, t, {
		kind: "seed",
		source: "cache",
		rows: 5,
		bytes: 10,
	});
	r.at(1020);
	r.tracer.notePaint("abc123", t, {
		kind: "seed",
		source: "cache",
		rows: 100,
		bytes: 241232,
	});
	// A later mount for the same conversation inside this trace cannot move it.
	r.at(9000);
	r.tracer.notePaint("abc123", t, {
		kind: "seed",
		source: "none",
		rows: 0,
		bytes: 0,
	});
	// The clock is past 60 s by now, so the timeout is due at its own instant.
	r.fireTimers(OPEN_TRACE_TIMEOUT_MS + 20_000);
	const f = fields(r.lines[0]);
	assert.equal(f.paint, "cache", "the first seed holds");
	assert.equal(f.paintAt, "20");
	assert.equal(f.paintRows, "100");
});

test("the pane's fill and the hook's seed may arrive in either order", () => {
	const r = rig();
	const t = r.tracer.begin("s1", "open");
	// A child layout effect runs before its parent's, so the measured height can
	// be the first of the two writers.
	r.at(3);
	r.tracer.notePaint("s1", t, { kind: "fills", fills: false });
	r.at(9);
	r.tracer.notePaint("s1", t, {
		kind: "seed",
		source: "cache",
		rows: 3,
		bytes: 42,
	});
	r.fireTimers(OPEN_TRACE_TIMEOUT_MS);
	const f = fields(r.lines[0]);
	assert.equal(f.paint, "cache");
	assert.equal(f.paintAt, "9", "only the seed stamps the stage");
	assert.equal(f.paintFills, "0", "the earlier reading is not overwritten");
});

test("A->B: A keeps its own paint and B is never stamped by A's pane", () => {
	const r = rig();
	r.at(0);
	const a = r.tracer.begin("aaa", "sidebar");
	r.at(7);
	r.tracer.notePaint("aaa", a, {
		kind: "seed",
		source: "cache",
		rows: 12,
		bytes: 2048,
	});
	r.tracer.notePaint("aaa", a, { kind: "fills", fills: false });
	r.at(40);
	const b = r.tracer.begin("bbb", "sidebar");
	const fa = fields(r.lines[0]);
	assert.equal(fa.outcome, "superseded");
	assert.equal(fa.paint, "cache");
	assert.equal(fa.paintRows, "12");
	assert.equal(fa.paintFills, "0");
	// A's token is no longer the open one: a late stamp from its pane is refused.
	r.tracer.notePaint("bbb", a, {
		kind: "seed",
		source: "cache",
		rows: 12,
		bytes: 2048,
	});
	assert.equal(r.tracer.currentToken(), b);
	r.at(200);
	r.tracer.notePaint("bbb", b, {
		kind: "seed",
		source: "none",
		rows: 0,
		bytes: 0,
	});
	r.fireTimers(OPEN_TRACE_TIMEOUT_MS + 20_000);
	const fb = fields(r.lines[1]);
	assert.equal(fb.paint, "none", "B reports what B's own pane found");
	assert.equal(fb.paintAt, "160", "ms from B's click, not from A's");
});

test("paint fields are counts and a fixed vocabulary, never text", () => {
	const line = formatOpenTraceLine(
		{
			token: 1,
			sessionId: "abc123",
			entrance: "sidebar",
			start: 0,
			stages: {},
			paint: { at: 2.4, source: "cache", rows: 3.6, bytes: 99.2, fills: true },
		},
		"timeout",
	);
	assert.match(
		line,
		/ paint=cache paintAt=2 paintRows=4 paintBytes=99 paintReason=- paintFills=1$/,
	);
	const f = fields(line);
	for (const key of [
		"paintAt",
		"paintRows",
		"paintBytes",
		"paintReason",
		"paintFills",
	]) {
		assert.match(f[key], /^(\d+|no-entry|empty-after-trim|evicted|-)$/);
	}
	assert.match(f.paint, /^(cache|none|empty|-)$/);
});

/*
 * The cache side of those fields: the byte count is the one the bound was
 * measured in (so the trace cannot disagree with it), and a miss says why when
 * this window can still tell (a cache that keeps nothing and one never asked
 * look identical in a hit rate).
 */
function stateOf(records) {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		oldestId: null,
		oldestTs: 0,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const row = (id, length) => ({
	id,
	kind: "user",
	ts: 1,
	text: "x".repeat(length),
});

test("readPaint reports the bytes the cache's bound is stated in", () => {
	paintCache.__resetPaintCache();
	paintCache.writePaint("bytes1", {
		transcript: stateOf([row("a", 100), row("b", 50)]),
	});
	const paint = paintCache.readPaint("bytes1");
	assert.equal(paint.transcript.records.length, 2);
	assert.equal(
		paint.bytes,
		new TextEncoder().encode(JSON.stringify(paint.transcript.records)).length,
		"the same UTF-8 measurement, not a second opinion",
	);
});

test("a paint trimmed to nothing, and one evicted, each leave their reason", () => {
	paintCache.__resetPaintCache();
	// Every row in flight: nothing durable to keep.
	paintCache.writePaint("gone", {
		transcript: stateOf([{ id: "live", kind: "assistant", streaming: true }]),
	});
	assert.equal(paintCache.readPaint("gone"), null);
	assert.equal(paintCache.paintMissReason("gone"), "empty-after-trim");
	// A stored paint answers the question, so the note goes.
	paintCache.writePaint("gone", { transcript: stateOf([row("a", 10)]) });
	assert.equal(paintCache.paintMissReason("gone"), null);
	assert.notEqual(paintCache.readPaint("gone"), null);
	// The byte bound evicts the oldest, and says which.
	paintCache.__resetPaintCache();
	paintCache.writePaint("oldest", { transcript: stateOf([row("a", 900_000)]) });
	for (let index = 0; index < 4; index += 1) {
		paintCache.writePaint(`newer-${String(index)}`, {
			transcript: stateOf([row("a", 900_000)]),
		});
	}
	assert.equal(paintCache.readPaint("oldest"), null);
	assert.equal(paintCache.paintMissReason("oldest"), "evicted");
	// An id this window never painted has nothing to explain.
	assert.equal(paintCache.paintMissReason("never"), null);
});

test("wiring: the pane stamps the paint fields on the trace's own target", () => {
	const transcript = read("features/chat/canonical/canonical-transcript.tsx");
	/*
	 * The trace's OWN target, not `frontend?.session_id`: a cached paint's rows are
	 * on screen while `frontend` is still null, which is the blind spot these
	 * fields exist to close. The cache read uses the same id, so "an entry is
	 * present" is the same claim as "the hook seeded from one" (`paintSeed` IS
	 * `readPaint`).
	 */
	assert.match(
		transcript,
		/const target = openTrace\.activeSessionId\(\);[\s\S]{0,1200}?const cached = readPaint\(target\);/,
	);
	assert.match(
		transcript,
		/kind: "seed",[\s\S]{0,400}?rows: cached\.transcript\.records\.length,\s*bytes: cached\.bytes,/,
	);
	// The miss path carries the cache's own reason rather than inventing one.
	assert.match(transcript, /const miss = paintMissReason\(target\);/);
	/*
	 * The fill is measured on the CONTENT column against the scroller's inner box:
	 * a scroller's `scrollHeight` is never below its `clientHeight`, so that
	 * comparison cannot fail and would report every pane - including an empty one -
	 * as filled.
	 */
	assert.match(
		transcript,
		/fills: content\.getBoundingClientRect\(\)\.height >= inner,/,
	);
	assert.doesNotMatch(transcript, /scrollHeight\s*>=\s*\w+\.clientHeight/);
});

/*
 * Wiring, asserted against the source like `window-mode.test.mjs` does: these
 * are facts about call sites, not about the tracer.
 */
const SRC = join(process.cwd(), "src", "renderer", "src");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");

test("wiring: every stage has its one hook and the entrances start traces", () => {
	const open = read("features/chat/open-conversation.ts");
	const hook = read("shared/hooks/use-canonical-session.ts");
	assert.match(
		open,
		/*
		 * The click's order, pinned: the trace starts, the `request` stage is noted as a
		 * FALLBACK, and only then does the guarded prewarm ask the desktop plane for the
		 * stream - still before the store write. The prewarm between them is the fix
		 * (`prewarmSessionStream`): a request issued after the store write is a request
		 * that waits for React's passive effect, which is the 0.2-16.6 s queue the
		 * operator's trace measured. The `try` is the guard: the optimisation must never
		 * be able to eat the click (agent review round 1, MINOR 3).
		 */
		/const traceId = beginOpenTrace\(sessionId, entrance\);\s*if \(traceId !== null\) \{[\s\S]{0,2400}?openTrace\.note\(sessionId, "request", traceId, \{ fallback: true \}\);[\s\S]{0,600}?try \{\s*prewarmSessionStream\(sessionId, \{[\s\S]{0,600}?\} catch \{[\s\S]{0,200}?\}\s*\}\s*const store = useCanonicalSessionsStore\.getState\(\);/,
	);
	assert.match(
		open,
		/activeSessionId === sessionId && !state\.activeDraftKey\) return null;/,
	);
	assert.match(
		read("shared/components/navigation/sidebar-navigation.tsx"),
		/openConversation\(navigate, id, "sidebar"\)/,
	);
	const app = read("app.tsx");
	assert.equal((app.match(/beginOpenTrace\(/g) ?? []).length, 1);
	assert.match(app, /beginOpenTrace\(sessionId, "native"\)/);
	const transcript = read("features/chat/canonical/canonical-transcript.tsx");
	assert.match(transcript, /openTrace\.note\(sessionId, "routed"\)/);
	assert.match(
		transcript,
		/performance\.mark\("lop:open:first-row"\);[\s\S]{0,200}openTrace\.note\(sessionId, "content"\)/,
	);
	assert.match(
		read("shared/hooks/use-canonical-session.ts"),
		// The optional receipt log now precedes this note; runtime receipt tests
		// cover its actual callbacks and clocks, not just this wiring guard.
		/if \(frame\.type === "snapshot"\) \{[\s\S]{0,600}openTrace\.note\(sessionId, "snapshot", openTraceToken\)/,
	);
	/*
	 * The REQUEST stage: the pane stamps it from the subscription's DECISION, and
	 * only when it opened a connection of its own. A stamp beside the transport call
	 * would report the commit on the adopted path - the click asked, the pane merely
	 * picked the connection up - so that shape is asserted GONE, and the stamp is
	 * pinned inside the `requested` arm.
	 */
	assert.doesNotMatch(
		hook,
		/openTrace\.note\(sessionId, "request", openTraceToken\);\s*dispose = subscribeDesktopStream\(/,
		"a stamp beside the call reports the commit on the adopted path",
	);
	assert.match(
		hook,
		/\(decision\) => \{[\s\S]{0,1200}?if \(decision === "requested"\)\s*openTrace\.note\(sessionId, "request", openTraceToken\);/,
	);
	// The token is captured per connection, at connect time.
	assert.match(
		read("shared/hooks/use-canonical-session.ts"),
		/const connect = \(\) => \{[\s\S]{0,400}const openTraceToken = openTrace\.currentToken\(\);/,
	);
	assert.match(
		read("features/chat/components/chat-page.tsx"),
		/openTrace\.fail\(sessionId, "missing"\);\s*store\.confirmSessionMissing\(sessionId\);/,
	);
});
