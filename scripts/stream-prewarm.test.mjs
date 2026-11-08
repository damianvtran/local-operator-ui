import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The session-stream PREWARM (`shared/api/local-operator/desktop-api.ts`).
 *
 * Why these cases. The prewarm exists because the pane opens its subscription
 * from a passive effect, whose flush was measured 0.2-16.6 s after the click on
 * the operator's app while the click's own commit landed in 38-400 ms. The fix
 * asks the desktop plane for the target's stream in the CLICK's task and lets
 * the pane adopt that connection. That turns a latency bug into a correctness
 * surface: an adopted connection is a stream whose frames reach a view that did
 * not ask for them if any of the matching rules are wrong. So every rule the
 * adoption depends on is pinned here:
 *
 *   * the click's request is issued once, and the pane's own subscription does
 *     not open a second one;
 *   * what arrived before the pane existed is REPLAYED, in order, and nothing
 *     before the adopter is listening;
 *   * a prewarm is never adopted for a different conversation, for a
 *     subscription that wants a reconnect cursor or journal order ids, or under
 *     a different capability negotiation - each of those opens its own
 *     connection instead;
 *   * a second click disposes the first prewarm rather than accumulating
 *     streams.
 *
 * The module is bundled in memory (the `open-trace.test.mjs` pattern) and the
 * two `window`-level facts it talks to - the desktop transport and the missing
 * EventSource - are stubbed here, so the SHIPPED adoption code runs.
 */
const bundle = await build({
	stdin: {
		contents:
			'export { prewarmSessionStream, subscribeDesktopStream } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".png": "dataurl", ".svg": "dataurl" },
});
const { prewarmSessionStream, subscribeDesktopStream } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/**
 * A desktop transport that records every subscription the renderer opens.
 *
 * `window` itself is stubbed rather than the module's imports: the shipped code
 * branches on `window.api?.desktop?.stream`, so a stub at that level is the same
 * seam Electron fills, and the adoption logic above it is untouched.
 */
function rig() {
	const calls = [];
	const handlers = [];
	const disposed = [];
	globalThis.window = {
		api: {
			desktop: {
				stream: {
					subscribe(args, onEvent) {
						calls.push(args);
						handlers.push(onEvent);
						const at = calls.length - 1;
						return {
							dispose() {
								disposed[at] = true;
							},
						};
					},
				},
			},
		},
	};
	return {
		calls,
		handlers,
		disposed,
		/** Deliver an event on the `at`th connection. */
		emit(at, event) {
			handlers[at](event);
		},
	};
}

/** Let the adoption's deferred replay run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the click's prewarm is adopted by the pane instead of a second connection", async () => {
	const r = rig();
	prewarmSessionStream("s1");
	assert.equal(r.calls.length, 1, "the click issued the request");
	assert.equal(r.calls[0].sessionId, "s1");

	// What the daemon sends while React is still busy.
	r.emit(0, { kind: "data", data: "open" });
	r.emit(0, { kind: "data", data: "snapshot" });

	const seen = [];
	const dispose = subscribeDesktopStream({ sessionId: "s1" }, (event) =>
		seen.push(event.data ?? event.kind),
	);
	assert.equal(r.calls.length, 1, "the pane opened no second connection");
	assert.deepEqual(seen, [], "nothing is delivered before the adopter asks");
	await flush();
	assert.deepEqual(seen, ["open", "snapshot"], "the buffer replays in order");

	r.emit(0, { kind: "data", data: "delta" });
	assert.deepEqual(seen, ["open", "snapshot", "delta"], "live frames go straight through");

	dispose();
	assert.equal(r.disposed[0], true, "the adopter's dispose closes the transport");
});

test("a prewarm is never adopted for a different conversation", async () => {
	const r = rig();
	prewarmSessionStream("s2");
	const seen = [];
	subscribeDesktopStream({ sessionId: "s3" }, (event) => seen.push(event.data));
	assert.equal(r.calls.length, 2, "s3 opens its own connection");
	assert.equal(r.calls[1].sessionId, "s3");
	r.emit(0, { kind: "data", data: "for-s2" });
	await flush();
	assert.deepEqual(seen, [], "s2's frames never reach s3's subscriber");
});

test("a resuming subscription refuses the prewarm and opens its own", () => {
	const r = rig();
	prewarmSessionStream("s4");
	subscribeDesktopStream({ sessionId: "s4", afterSeq: 12 }, () => {});
	assert.equal(r.calls.length, 2, "a cursor cannot be spoken by a prewarm");
	assert.equal(r.calls[1].afterSeq, 12);
	assert.equal(r.disposed[0], true, "the prewarm it could not use is closed");
});

test("a negotiation the prewarm did not ask for is refused", () => {
	const r = rig();
	// The app's first subscription is what records the negotiation; here that is
	// a plain one, so a prewarm would ask for no open frame.
	subscribeDesktopStream({ sessionId: "warmup" }, () => {});
	assert.equal(r.calls.length, 1);
	prewarmSessionStream("s5");
	subscribeDesktopStream({ sessionId: "s5", openFrame: true }, () => {});
	assert.equal(r.calls.length, 3, "the pane opens its own connection");
	assert.equal(r.calls[2].openFrame, true);
	assert.equal(r.disposed[1], true, "the unusable prewarm is closed");
});

test("a prewarm reuses the negotiation the last real subscription asked for", () => {
	const r = rig();
	subscribeDesktopStream(
		{ sessionId: "warmup", openFrame: true, journalOrder: true },
		() => {},
	);
	prewarmSessionStream("s6");
	assert.equal(r.calls.length, 2);
	assert.equal(r.calls[1].openFrame, true, "the capability is carried");
	assert.equal(r.calls[1].journalOrder, true);
	assert.equal(r.calls[1].epoch, undefined, "no per-visit cursor is invented");
	assert.equal(r.calls[1].orderIds, undefined, "no per-visit ids are invented");
	subscribeDesktopStream(
		{ sessionId: "s6", openFrame: true, journalOrder: true, orderIds: [] },
		() => {},
	);
	assert.equal(r.calls.length, 2, "and that is exactly what the pane adopts");
});

test("a second click disposes the first prewarm", () => {
	const r = rig();
	prewarmSessionStream("s7");
	prewarmSessionStream("s8");
	assert.equal(r.calls.length, 2);
	assert.equal(r.disposed[0], true, "one prewarm at a time");
	assert.equal(r.disposed[1], undefined);
});

test("re-prewarming the same conversation does not open a second stream", () => {
	const r = rig();
	prewarmSessionStream("s9");
	prewarmSessionStream("s9");
	assert.equal(r.calls.length, 1);
	assert.equal(r.disposed[0], undefined);
});
