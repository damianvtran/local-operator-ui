import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The machine-wide feed, the renderer's merge of what it carries, and the paint
 * cache behind the click's first frame.
 *
 * Three claims, each of which fails silently if it fails at all:
 *
 *  1. **The capability gate holds in BOTH directions.** A backend without
 *     `features.desktop_feed` must produce no socket, no presence beat and no
 *     change of behaviour; a renderer with no feed must keep the poll it has
 *     today. Asserted against a `fetch` that throws, so an accidental open is a
 *     test failure rather than a wasted connection.
 *  2. **Silence is an error.** A half-open socket after sleep/wake delivers no
 *     data, no end and no exception: without a watchdog the app looks connected
 *     while nothing can reach it, which is worse than the timer this replaces.
 *  3. **A frame that omits `supported` must not clear it.** The catalogue's
 *     attention comes from `state_many`, which never sets the flag, while
 *     `useCompletionView` requires `supported === true` to acknowledge a read.
 *     Replacing wholesale silently disabled the read receipt for the
 *     conversation on screen.
 */
const feedBundle = await build({
	stdin: {
		contents: 'export * from "./src/main/desktop-feed";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { DesktopFeedRelay } = await import(
	`data:text/javascript;base64,${Buffer.from(feedBundle.outputFiles[0].text).toString("base64")}`
);

const cacheBundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/shared/store/paint-cache";',
		resolveDir: process.cwd(),
	},
	// The renderer's path aliases, which electron-vite supplies in the app and
	// esbuild does not: the cache imports the transcript reducer by alias because
	// everything in the renderer does.
	alias: {
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const cache = await import(
	`data:text/javascript;base64,${Buffer.from(cacheBundle.outputFiles[0].text).toString("base64")}`
);

// The store is bundled with the same fixtures `canonical-chat.test.mjs` uses:
// `desktopResult` is the network and is the only thing faked; the store's own
// persistence needs a `localStorage`.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
globalThis.__feedRequest = async () => ({});
const storeBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {mergeCompletionAttention} from "./src/shared/desktop-session-contract";',
		resolveDir: process.cwd(),
	},
	alias: {
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "store-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "store-fixture" }),
				);
				// Only `desktopResult` is faked - it is the network. The error
				// classes are re-exported from the real module, because the store's
				// copy rules depend on their actual behaviour.
				builder.onLoad({ filter: /.*/, namespace: "store-fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__feedRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				// The store's contract with the transcript hook is three calls, and
				// this file is not testing the echo. Same stub canonical-chat uses.
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const { useCanonicalSessionsStore: store, mergeCompletionAttention } = await import(
	`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "123456abcdef";
const OTHER = "ffffffffffff";
const TICK = 40;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A controllable SSE body, so a test decides when a frame (or silence) happens.
 *
 * It honours the abort signal, and that is not decoration: a real `fetch` ties
 * the response body to the signal, so aborting one tears down the other. A stub
 * that ignored the signal would let a watchdog that never ends the read pass —
 * the exact silent failure the watchdog exists for.
 */
function sseSource(signal) {
	let controller;
	const stream = new ReadableStream({
		start(next) {
			controller = next;
		},
	});
	signal?.addEventListener("abort", () => {
		try {
			controller.error(new Error("aborted"));
		} catch {
			// Already closed by the test, which is an ordinary race here.
		}
	});
	return {
		response: new Response(stream, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		}),
		push(frame) {
			controller.enqueue(
				new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`),
			);
		},
	};
}

function openFrame(overrides = {}) {
	return {
		epoch: "feed",
		seq: 1,
		type: "open",
		payload: {
			subscription_id: "abcd1234",
			heartbeat_seconds: 15,
			lease_seconds: 45,
			watch_ttl_seconds: 45,
			catalogue_revision: 10,
			...overrides,
		},
	};
}

function catalogueFrame(revision) {
	return { epoch: "feed", seq: 9, type: "catalogue", payload: { revision } };
}

function attentionFrame(sessionId, overrides = {}) {
	return {
		epoch: "feed",
		seq: 5,
		type: "attention",
		session_id: sessionId,
		payload: {
			conversation_id: `session/${sessionId}`,
			completion_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			anchor_id: "row-1",
			kind: "complete",
			unseen: true,
			revision: [4, 2],
			...overrides,
		},
	};
}

// ------------------------------------------------------- the capability gate

test("with no desktop_feed capability no socket is opened and no presence is beaten", async () => {
	const original = globalThis.fetch;
	let fetches = 0;
	const beats = [];
	globalThis.fetch = async () => {
		fetches += 1;
		throw new Error("the feed must not open without the capability");
	};
	const states = [];
	const frames = [];
	const relay = new DesktopFeedRelay("http://127.0.0.1:9/", "token", {
		request: async () => ({ status: 200, body: { result: { features: {} } } }),
		beatPresence: async (subscriptionId) => {
			beats.push(subscriptionId);
			return { status: 200, body: null };
		},
	});
	relay.observe((frame) => frames.push(frame));
	relay.watchState((state) => states.push(state.connected));
	await relay.start();
	await sleep(TICK);

	assert.equal(fetches, 0, "an old backend costs no connection at all");
	assert.deepEqual(beats, []);
	assert.deepEqual(frames, []);
	assert.equal(relay.isConnected, false);
	assert.deepEqual(states, [false], "the subscriber is told, exactly once");

	// And an unreachable backend is NOT an answer about what it supports: the
	// capability read failing must leave the feed closed rather than open it on
	// an assumption.
	const unreachable = new DesktopFeedRelay("http://127.0.0.1:9/", "token", {
		request: async () => {
			throw new Error("connect ECONNREFUSED");
		},
		beatPresence: async () => ({ status: 200, body: null }),
	});
	await unreachable.start();
	assert.equal(unreachable.isConnected, false);
	assert.equal(fetches, 0);
	relay.stop();
	unreachable.stop();
	globalThis.fetch = original;
});

test("with the capability the feed delivers frames, beats presence, and closes clean", async () => {
	const original = globalThis.fetch;
	const source = sseSource();
	let fetches = 0;
	globalThis.fetch = async () => {
		fetches += 1;
		return source.response;
	};
	const beats = [];
	const frames = [];
	const states = [];
	const relay = new DesktopFeedRelay("http://127.0.0.1:9/", "token", {
		request: async () => ({
			status: 200,
			body: { result: { features: { desktop_feed: 1 } } },
		}),
		beatPresence: async (presence) => {
			beats.push(presence);
			return { status: 200, body: null };
		},
	});
	relay.observe((frame) => frames.push(frame));
	relay.watchState((state) => states.push(state.connected));

	await relay.start();
	await sleep(TICK);
	assert.equal(fetches, 1);
	assert.equal(relay.isConnected, true);

	source.push(openFrame());
	await sleep(TICK);
	// The presence lease is held against THIS subscription, so the beat must name
	// it — that is what lets the backend revoke the claim when the socket drops
	// instead of waiting out a stale TTL.
	// B1. The lease reads more than the subscription id: the kinds this app can
	// deliver, and the window it is displaying. Without `canNotifyKinds` the
	// backend's `delivers(kind)` is false for every completion, and without
	// `window` its `attended` is false - which together are the operator's
	// reported symptom rather than a weaker claim. No `presenceContext` is
	// supplied here, so this is also the windowless case (macOS, app alive in
	// the dock): it must still beat, and must name all-false with no session.
	assert.deepEqual(beats, [
		{
			subscriptionId: "abcd1234",
			canNotify: true,
			canNotifyKinds: ["complete", "error"],
			sessionId: "",
			window: {
				exists: false,
				focused: false,
				visible: false,
				minimized: false,
			},
		},
	]);

	source.push(attentionFrame(SESSION));
	source.push(catalogueFrame(11));
	await sleep(TICK);
	assert.deepEqual(
		frames.map((frame) => frame.type),
		["open", "attention", "catalogue"],
	);
	assert.equal(frames[2].payload.revision, 11, "the invalidation carries its revision");

	relay.stop();
	await sleep(TICK);
	assert.equal(relay.isConnected, false);
	assert.equal(states.at(-1), false);
	globalThis.fetch = original;
});

test("the presence beat carries the window and the conversation it displays", async () => {
	// B1's other half. The claim is read per BEAT, not captured when the relay
	// was built: the relay is constructed when the backend becomes reachable,
	// and the window opens (or closes, or the user navigates) later. A captured
	// value would report the relay-construction state for the whole lease.
	const original = globalThis.fetch;
	const source = sseSource();
	globalThis.fetch = async () => source.response;
	const beats = [];
	let context = {
		sessionId: "AAAAAAAAAAAA",
		window: {
			exists: true,
			focused: true,
			visible: true,
			minimized: false,
		},
	};
	const relay = new DesktopFeedRelay("http://127.0.0.1:9/", "token", {
		request: async () => ({
			status: 200,
			body: { result: { features: { desktop_feed: 1 } } },
		}),
		beatPresence: async (presence) => {
			beats.push(presence);
			return { status: 200, body: null };
		},
		presenceContext: () => context,
		// The production cadence is three beats per the lease's 45 s TTL; a test
		// needs a second beat, not a 15 s wait.
		presenceIntervalMs: 60,
	});

	await relay.start();
	await sleep(TICK);
	source.push(openFrame());
	await sleep(TICK);
	assert.deepEqual(beats.at(-1), {
		subscriptionId: "abcd1234",
		canNotify: true,
		canNotifyKinds: ["complete", "error"],
		sessionId: "AAAAAAAAAAAA",
		window: { exists: true, focused: true, visible: true, minimized: false },
	});

	// The window closes while the same lease is live: the next beat must say so
	// rather than keep advertising a surface that cannot display anything.
	context = {
		sessionId: "",
		window: { exists: false, focused: false, visible: false, minimized: false },
	};
	await sleep(60 + TICK);
	assert.equal(beats.at(-1).window.exists, false);
	assert.equal(
		beats.at(-1).sessionId,
		"",
		"a windowless app displays nothing, so it must name no conversation",
	);

	relay.stop();
	await sleep(TICK);
	globalThis.fetch = original;
});

test("a silent socket is torn down and reconnected, not trusted", async () => {
	const original = globalThis.fetch;
	const sources = [];
	// 50 ms heartbeats, so the three-missed-beat bound is reachable in about a
	// second rather than in 45.
	globalThis.fetch = async (_url, init) => {
		const source = sseSource(init?.signal);
		sources.push(source);
		return source.response;
	};
	const relay = new DesktopFeedRelay("http://127.0.0.1:9/", "token", {
		request: async () => ({
			status: 200,
			body: { result: { features: { desktop_feed: 1 } } },
		}),
		beatPresence: async () => ({ status: 200, body: null }),
		// The production floor is 1 s, which would put the three-missed-beat
		// watchdog three seconds away and make this test a wait rather than a
		// check. Lowering the FLOOR (rather than skipping the clamp) keeps the
		// clamped path the one under test.
		heartbeatFloorSeconds: 0.05,
	});
	await relay.start();
	await sleep(TICK);
	sources[0].push(openFrame({ heartbeat_seconds: 0.05 }));
	await sleep(TICK);
	assert.equal(relay.isConnected, true);

	// Nothing more arrives on source 0 — a half-open socket. The watchdog has to
	// abort it: the reader would otherwise never return, and the app would look
	// connected while no completion could reach it.
	await sleep(2_500);
	assert.ok(
		sources.length >= 2,
		`the relay reconnected (attempts: ${String(sources.length)})`,
	);
	relay.stop();
	globalThis.fetch = original;
});

// --------------------------------------------------- the renderer's merge path

test("an attention frame reaches its row, and a stale one cannot un-read it", () => {
	store.setState({
		sessions: [
			{
				session_id: SESSION,
				title: "Quarterly revenue model",
				attention: {
					conversation_id: `session/${SESSION}`,
					completion_token: null,
					anchor_id: null,
					kind: null,
					unseen: false,
					revision: [1, 1],
					supported: true,
				},
			},
		],
	});
	store.getState().applyAttention(SESSION, attentionFrame(SESSION).payload);
	assert.equal(store.getState().sessions[0].attention.unseen, true);

	// A frame for a session the catalogue does not know is DROPPED: membership is
	// the catalogue's business (`sessions.list`), and inserting here would make a
	// sidebar row with no title, no binding and no status.
	store.getState().applyAttention(OTHER, attentionFrame(OTHER).payload);
	assert.deepEqual(
		store.getState().sessions.map((row) => row.session_id),
		[SESSION],
	);

	// An older revision must not un-read a row the user has seen. This is the
	// revision guard the catalogue merge already had; the feed is a second
	// producer of the same shape and inherits it rather than restating it.
	store.setState({
		sessions: [
			{
				session_id: SESSION,
				attention: {
					conversation_id: `session/${SESSION}`,
					completion_token: null,
					anchor_id: null,
					kind: "complete",
					unseen: false,
					revision: [4, 9],
					supported: true,
				},
			},
		],
	});
	store.getState().applyAttention(SESSION, attentionFrame(SESSION).payload);
	assert.equal(store.getState().sessions[0].attention.unseen, false);
	assert.deepEqual(store.getState().sessions[0].attention.revision, [4, 9]);
});

test("a frame that omits `supported` inherits it, and an explicit one wins", () => {
	const current = {
		conversation_id: `session/${SESSION}`,
		completion_token: null,
		anchor_id: null,
		kind: "complete",
		unseen: false,
		revision: [1, 1],
		supported: true,
	};
	// The catalogue's own shape: same revision, no `supported` key at all. This
	// is the case that used to delete the flag and disable the read receipt for
	// the conversation on screen.
	const withoutFlag = { ...current };
	delete withoutFlag.supported;
	assert.equal(
		mergeCompletionAttention(current, withoutFlag, SESSION).supported,
		true,
	);
	// A producer that answers explicitly is not overruled — including a `false`,
	// which is the whole reason the field is sent at all.
	assert.equal(
		mergeCompletionAttention(current, { ...withoutFlag, supported: false }, SESSION)
			.supported,
		false,
	);
	assert.equal(
		mergeCompletionAttention(undefined, withoutFlag, SESSION).supported,
		undefined,
		"nothing to inherit from is still nothing",
	);
});

// ------------------------------------------------------------- the paint cache

function durableRow(id, bytes) {
	return {
		kind: "assistant",
		id,
		ts: 1,
		text: "x".repeat(bytes),
		streaming: false,
		stopReason: null,
		error: false,
	};
}

function transcriptOf(records) {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		oldestId: records[0]?.id ?? null,
		hasMore: true,
		argsByCall: new Map(),
	};
}

function measuredBytes(records) {
	return new TextEncoder().encode(JSON.stringify(records)).length;
}

test("the paint cache never holds an in-flight row", () => {
	cache.__resetPaintCache();
	cache.writePaint(SESSION, {
		transcript: transcriptOf([
			durableRow("a", 10),
			durableRow("b", 10),
			// A streaming assistant row and a running tool row: both are lines
			// that can never advance from a cache, because the deltas that would
			// advance them were consumed by the previous mount.
			{ ...durableRow("c", 10), streaming: true },
			{
				kind: "tool",
				id: "d",
				ts: 1,
				toolCallId: "call-1",
				toolName: "bash",
				intent: null,
				args: null,
				phase: "running",
				argumentBytes: 0,
				output: null,
				isError: false,
				durationS: null,
				startedAt: 1,
				images: [],
				added: 0,
				removed: 0,
				diff: null,
			},
		]),
	});
	const paint = cache.readPaint(SESSION);
	assert.deepEqual(
		paint.transcript.records.map((record) => record.id),
		["a", "b"],
	);
});

test("the cache is bounded in BYTES, per session and in total", () => {
	cache.__resetPaintCache();
	// One heavy conversation: 400 rows of 4 KB is ~1.6 MB, well past the
	// per-session ceiling. A row count would let this through; the byte bound is
	// what stops one transcript holding tens of megabytes.
	cache.writePaint(SESSION, {
		transcript: transcriptOf(
			Array.from({ length: 400 }, (_, index) =>
				durableRow(`heavy-${String(index)}`, 4_000),
			),
		),
	});
	const heavy = cache.readPaint(SESSION);
	assert.ok(
		heavy.transcript.records.length < 400,
		"the heavy conversation was trimmed",
	);
	assert.ok(
		measuredBytes(heavy.transcript.records) <= cache.PAINT_CACHE_SESSION_BYTES,
		"and it fits the per-session ceiling",
	);
	assert.ok(heavy.transcript.records.length <= cache.PAINT_CACHE_MAX_ROWS);

	// Many conversations: the total must hold, and eviction must actually happen.
	for (let index = 0; index < 12; index += 1) {
		cache.writePaint(`session-${String(index).padStart(12, "0")}`, {
			transcript: transcriptOf(
				Array.from({ length: 120 }, (_, row) =>
					durableRow(`row-${String(row)}`, 4_000),
				),
			),
		});
	}
	const stats = cache.__paintCacheStats();
	assert.ok(
		stats.bytes <= cache.PAINT_CACHE_TOTAL_BYTES,
		`total bytes ${String(stats.bytes)} within the budget`,
	);
	assert.ok(stats.sessions < 13, "older conversations were evicted");

	// The oldest goes first, and the newest write survives — the conversation the
	// user is about to click is the one that must have a paint.
	assert.ok(cache.readPaint("session-000000000011") !== null);
});

test("a paint is stored without the paging cursor it cannot honour", () => {
	cache.__resetPaintCache();
	cache.writePaint(SESSION, {
		transcript: {
			...transcriptOf([durableRow("a", 10)]),
			oldestId: "a",
			hasMore: true,
		},
	});
	const paint = cache.readPaint(SESSION);
	// `oldestId`/`hasMore` describe the backend's page boundaries for the rows
	// this cache happens to hold. A trimmed set makes them wrong in a way that is
	// worse than absent: scrolling up during the stale window would splice the
	// wrong range.
	assert.equal(paint.transcript.oldestId, null);
	assert.equal(paint.transcript.hasMore, false);
	cache.dropPaint(SESSION);
	assert.equal(cache.readPaint(SESSION), null);
});

test("the sidebar's 5 s poll is gone, and the feed is what replaced it", () => {
	/*
	 * A source assertion, in the shape `window-mode.test.mjs` uses for the
	 * window-raise monopoly: the claim is about what the file does NOT contain,
	 * and rendering the sidebar to prove it would need a DOM, effects and a
	 * mounted store for a fact that is visible in the source. What is pinned is
	 * the defect itself — a timer that re-read every transcript tail every five
	 * seconds, gated on visibility — plus the two replacements existing.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	const intervals = source
		.split("\n")
		.filter((line) => line.includes("setInterval"));
	assert.equal(
		intervals.length,
		2,
		`expected the two branches (legacy poll, safety poll) and nothing else:\n${intervals.join("\n")}`,
	);
	// The legacy branch still exists — an old backend keeps the poll it had — but
	// the literal it used is named now, and nothing polls `sessions.list` on a 5 s
	// clock once the feed is available.
	assert.ok(source.includes("LEGACY_CATALOGUE_POLL_MS"));
	assert.ok(
		source.includes("}, CATALOGUE_SAFETY_POLL_MS)"),
		"the event-driven branch polls on the safety clock",
	);
	assert.ok(
		source.includes("feed.catalogueRevision"),
		"and the effect is keyed on the invalidation, which is one refetch per frame",
	);
	// The visibility-gated poll survives in exactly ONE place — inside the branch
	// an old backend takes. Scoped to that branch rather than counted in the file,
	// because the comment above the feed path also names `document.visibilityState`
	// when it explains why the event path does not gate on it.
	const legacyBranch = source.slice(
		source.indexOf("if (!feed.available) {"),
		source.indexOf("}, LEGACY_CATALOGUE_POLL_MS)"),
	);
	assert.ok(
		legacyBranch.includes('document.visibilityState === "visible"'),
		"the legacy branch is the one that keeps the gated poll",
	);
	assert.ok(
		!source
			.slice(source.indexOf("}, LEGACY_CATALOGUE_POLL_MS)"))
			.includes('document.visibilityState === "visible"'),
		"and nothing on the feed path gates a poll on visibility",
	);
	// The disconnected line's pinned sentence, so a re-word shows up here.
	assert.ok(
		source.includes("Not connected to the backend — showing the last known state."),
	);
	// And the unseen mark is no longer a weight change on the title.
	assert.ok(
		!source.includes('row.attention?.unseen && "font-semibold"'),
		"the unread mark must not reflow the row",
	);
});
