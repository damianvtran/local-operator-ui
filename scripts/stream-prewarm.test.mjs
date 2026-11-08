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
 *     streams;
 *   * a prewarm is RETIRED where its stream dies, and when a switch abandons it,
 *     rather than being adopted, replayed or held beside the view on screen.
 *
 * Round 1 also pinned the DECLARATION: `peerJournalSource` is a fact about one
 * conversation (`remoteOwned`), never the departed pane's, so a local target's
 * request cannot declare a peer's contract.
 *
 * The module is bundled in memory (the `open-trace.test.mjs` pattern) and the
 * two `window`-level facts it talks to - the desktop transport and the missing
 * EventSource - are stubbed here, so the SHIPPED adoption code runs.
 */
const bundle = await build({
	stdin: {
		contents:
			'export { prewarmSessionStream, prewarmedSessionStreamId, discardPrewarmedStream, subscribeDesktopStream } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".png": "dataurl", ".svg": "dataurl" },
});
const {
	prewarmSessionStream,
	prewarmedSessionStreamId,
	discardPrewarmedStream,
	subscribeDesktopStream,
} = await import(
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
	assert.deepEqual(
		seen,
		["open", "snapshot", "delta"],
		"live frames go straight through",
	);

	dispose();
	assert.equal(
		r.disposed[0],
		true,
		"the adopter's dispose closes the transport",
	);
});

test("a prewarm is never adopted for a different conversation", async () => {
	const r = rig();
	prewarmSessionStream("s2");
	const seen = [];
	subscribeDesktopStream({ sessionId: "s3" }, (event) => seen.push(event.data));
	assert.equal(r.calls.length, 2, "s3 opens its own connection");
	assert.equal(r.calls[1].sessionId, "s3");
	assert.equal(
		r.disposed[0],
		true,
		"the abandoned prewarm is retired rather than held beside the view",
	);
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
/*
 * WHICH OF THE TWO THINGS THE CALL DID (agent review round 1, MAJOR 1). The open
 * trace's `request` stage is the click's number only when the pane ADOPTED the
 * connection the click asked for; a refused prewarm means the pane asked, and the
 * pane can only know that from this decision.
 */
test("the decision reports adoption, and reports the pane's own request when refused", () => {
	const r = rig();
	// A plain subscription first, so the prewarm asks for the same negotiation the
	// pane will (the file's earlier cases leave capabilities enabled).
	subscribeDesktopStream({ sessionId: "warm-decision" }, () => {});
	prewarmSessionStream("d1");
	const adopted = [];
	subscribeDesktopStream(
		{ sessionId: "d1" },
		() => {},
		(decision) => adopted.push(decision),
	);
	assert.deepEqual(adopted, ["adopted"], "the click's connection was used");
	assert.equal(r.calls.length, 2, "so no second connection was opened");

	// A cursor the prewarm could not have spoken: the pane has to ask itself.
	prewarmSessionStream("d2");
	const refused = [];
	subscribeDesktopStream(
		{ sessionId: "d2", afterSeq: 3 },
		() => {},
		(decision) => refused.push(decision),
	);
	assert.deepEqual(
		refused,
		["requested"],
		"a refused prewarm is the pane's own request, not the click's",
	);
	assert.equal(r.calls.length, 4);
});

/*
 * THE DECLARATION IS THE TARGET'S, NOT THE DEPARTED PANE'S (agent review round 1,
 * MINOR 1). `peerJournalSource` is per-conversation, so a local target must send
 * nothing even when the conversation being left was a peer's.
 */
test("a local target's prewarm does not carry the departed peer's declaration", () => {
	const r = rig();
	// A remote conversation's subscription is what puts the capability in play.
	subscribeDesktopStream(
		{ sessionId: "peer1", peerJournalSource: true },
		() => {},
	);
	prewarmSessionStream("local1", { remoteOwned: false });
	assert.equal(r.calls.length, 2);
	assert.equal(
		r.calls[1].peerJournalSource,
		undefined,
		"a local conversation never declares the complete contract",
	);
	subscribeDesktopStream({ sessionId: "local1" }, () => {});
	assert.equal(
		r.calls.length,
		2,
		"and the local pane adopts that undeclared stream",
	);
});

test("a remote-owned target's prewarm declares the contract, and is adopted", () => {
	const r = rig();
	subscribeDesktopStream(
		{ sessionId: "peer1", peerJournalSource: true },
		() => {},
	);
	prewarmSessionStream("peer2", { remoteOwned: true });
	assert.equal(
		r.calls[1].peerJournalSource,
		true,
		"this conversation is the peer's",
	);
	subscribeDesktopStream(
		{ sessionId: "peer2", peerJournalSource: true },
		() => {},
	);
	assert.equal(r.calls.length, 2, "the declared prewarm is adopted");
});

test("a local-to-peer switch prewarms undeclared, so the peer pane refuses it", () => {
	const r = rig();
	// The click path's only capability read is the last subscription's, and a local
	// conversation's is "no": the prewarm must not invent the contract.
	subscribeDesktopStream({ sessionId: "local0" }, () => {});
	prewarmSessionStream("peer3", { remoteOwned: true });
	assert.equal(
		r.calls[1].peerJournalSource,
		undefined,
		"nothing proven, nothing declared",
	);
	subscribeDesktopStream(
		{ sessionId: "peer3", peerJournalSource: true },
		() => {},
	);
	assert.equal(r.calls.length, 3, "the pane opens its own declared connection");
	assert.equal(r.calls[2].peerJournalSource, true);
	assert.equal(r.disposed[1], true, "and closes the one it cannot use");
});

/*
 * A DEAD STREAM IS NOT A PREWARM (agent review round 1, MINOR 2): a repeat click
 * must subscribe normally rather than adopt a connection that already failed and
 * replay the failure into the new pane.
 */
test("a prewarm whose stream errored is retired where it died", async () => {
	const r = rig();
	subscribeDesktopStream({ sessionId: "warm-dead" }, () => {});
	prewarmSessionStream("dead1");
	assert.equal(
		r.disposed[1],
		undefined,
		"the prewarm is live while its stream is",
	);
	r.emit(1, { kind: "error", status: 404 });
	assert.equal(r.disposed[1], true, "the failure closes the connection");
	assert.equal(prewarmedSessionStreamId(), null, "and retires the record");
	const seen = [];
	subscribeDesktopStream({ sessionId: "dead1" }, (event) =>
		seen.push(event.kind),
	);
	assert.equal(r.calls.length, 3, "the repeat click asks for itself");
	await flush();
	assert.deepEqual(seen, [], "the old failure is not replayed into it");
});

test("a prewarm whose stream ended is retired too", () => {
	const r = rig();
	subscribeDesktopStream({ sessionId: "warm-end" }, () => {});
	prewarmSessionStream("ended1");
	r.emit(1, { kind: "end" });
	assert.equal(r.disposed[1], true);
	assert.equal(prewarmedSessionStreamId(), null);
});

/*
 * ABANDONMENT (agent review round 1, NIT 1): the click path's route watch retires
 * the prewarm the navigation walked away from, and it must be scoped to that id so
 * a late report cannot close a newer click's connection.
 */
test("an abandoned prewarm is discarded by its own id, and only that id", () => {
	const r = rig();
	subscribeDesktopStream({ sessionId: "warm-route" }, () => {});
	prewarmSessionStream("route1");
	assert.equal(prewarmedSessionStreamId(), "route1");
	discardPrewarmedStream("route2");
	assert.equal(
		prewarmedSessionStreamId(),
		"route1",
		"a report about another conversation leaves it alone",
	);
	assert.equal(r.disposed[1], undefined);
	discardPrewarmedStream("route1");
	assert.equal(prewarmedSessionStreamId(), null);
	assert.equal(r.disposed[1], true, "the abandoned connection is closed");
});
