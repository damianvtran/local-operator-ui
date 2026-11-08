import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
 * Round 2 moved the CAPABILITY half onto the answer the pane itself derives from
 * (`desktop-stream-capabilities.ts`): inheriting it from the last subscription
 * meant the FIRST click of every app session asked undeclared, was refused, and
 * dropped a live stream - the failure this PR's own native lane caught. The
 * first-click case, the producer pin and the decision log are here, so the class
 * is both fixed and diagnosable.
 *
 * The module is bundled in memory (the `open-trace.test.mjs` pattern) and the
 * two `window`-level facts it talks to - the desktop transport and the missing
 * EventSource - are stubbed here, so the SHIPPED adoption code runs.
 */
const bundle = await build({
	stdin: {
		contents:
			'export { prewarmSessionStream, prewarmedSessionStreamId, discardPrewarmedStream, subscribeDesktopStream } from "./src/renderer/src/shared/api/local-operator/desktop-api";\nexport { recordStreamCapabilityFlags, recordedStreamCapabilityFlags } from "./src/renderer/src/shared/api/local-operator/desktop-stream-capabilities";',
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
	recordStreamCapabilityFlags,
	recordedStreamCapabilityFlags,
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
	/*
	 * A FRESH APP, ON PURPOSE: no capabilities answer yet and no prewarm held.
	 *
	 * The capability flags are module state in the shipped code (`desktop-stream-
	 * capabilities.ts`), recorded by the capabilities read; a case that inherited
	 * the previous case's answer would pin whatever ran before it rather than the
	 * rule it names. `null` is the state before the app's first capability read,
	 * which is what most of these cases are about.
	 */
	recordStreamCapabilityFlags(null);
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

/**
 * The app's capabilities answer, as `useDesktopCapabilities` records it.
 *
 * Written through the shipped recorder, so a case pins the PREWARM's source of
 * truth rather than a value it handed the prewarm directly. The pane derives the
 * flags it subscribes with from the same answer (`chat-page.tsx`), which is why
 * these cases pass the pane the flags this answer implies and no others.
 */
const capabilities = ({
	openFrame = true,
	journalOrder = true,
	peerJournalSource = true,
} = {}) =>
	recordStreamCapabilityFlags({ openFrame, journalOrder, peerJournalSource });

/**
 * Capture the `[stream-prewarm]` decision lines the shipped code writes.
 *
 * The lines are the defect's diagnosability: `console.warn` from the renderer is
 * forwarded by main into the app's durable log (`src/main/index.ts`), so a switch
 * that refused its prewarm - and why - is readable after the fact instead of
 * being inferable only from two `/events` attempts in an access log. A case that
 * does not open this stays quiet, because `console.warn` still reaches the test
 * runner's stderr.
 */
function prewarmLog() {
	const lines = [];
	const original = console.warn;
	console.warn = (...args) => {
		const [line] = args;
		if (typeof line === "string" && line.startsWith("[stream-prewarm]"))
			lines.push(line);
	};
	return {
		lines,
		restore: () => {
			console.warn = original;
		},
	};
}

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

/*
 * THE FIRST CLICK AFTER APP START (agent review remediation round 2).
 *
 * This is the case PR #1783 shipped broken, and the case that cost the feature
 * its benefit: at app start NO subscription has run, so the negotiation the
 * prewarm used to inherit was all-`false`, while the pane derives `open_frame`
 * and `journal_order` from the capabilities answer. The two requests could not
 * match on the first click, `takePrewarmedStream` refused (correctly), the
 * connection was discarded and the pane opened a second one. CI proved it on the
 * PR's own native lane (run 42519743458, `model-uncertainty`): two click-time
 * `/events` attempts, the first abandoned with its snapshot unconsumed -
 * `released canonical-sse was dropped/unconsumed`.
 *
 * The case therefore states the capability answer and NO prior subscription, and
 * asserts the click's one connection is the one the pane uses.
 */
test("the first click after app start adopts the prewarm", async () => {
	const r = rig();
	// The capabilities read answered before the operator pressed anything - the
	// app's own shell mounts it at startup, and the pane derives its flags from it.
	capabilities();

	// NO subscription has run: this is exactly the state that used to lose the
	// connection, and the prewarm must still phrase the pane's request.
	prewarmSessionStream("first", { remoteOwned: false });
	assert.equal(r.calls.length, 1, "the click issued exactly one request");
	assert.equal(
		r.calls[0].openFrame,
		true,
		"it asks what the pane will ask for the answer it holds",
	);
	assert.equal(r.calls[0].journalOrder, true);

	const decisions = [];
	const seen = [];
	const log = prewarmLog();
	try {
		const dispose = subscribeDesktopStream(
			{ sessionId: "first", openFrame: true, journalOrder: true, orderIds: [] },
			(event) => seen.push(event.data ?? event.kind),
			(decision) => decisions.push(decision),
		);
		assert.deepEqual(
			decisions,
			["adopted"],
			"the click's stream is the pane's",
		);
		assert.equal(
			r.calls.length,
			1,
			"exactly one /events stream exists, not two",
		);
		r.emit(0, { kind: "data", data: "snapshot" });
		await flush();
		assert.deepEqual(seen, ["snapshot"], "and its frames reach the pane");
		assert.deepEqual(
			log.lines,
			["[stream-prewarm] session=first decision=adopted"],
			"the decision is written to the log channel the app keeps",
		);
		dispose();
		assert.equal(r.disposed[0], true);
	} finally {
		log.restore();
	}
});

/*
 * AND THE ANSWER REALLY IS THE ONE THE APP RECORDS (agent review remediation
 * round 2). The cases above state the capability answer through the shipped
 * recorder, so on their own they would still pass if nothing in the app ever
 * called it - which is the whole failure mode being fixed (a source nobody
 * feeds). This pins the producer: the capabilities query records the answer it
 * receives, through the one derivation the pane's own flags use.
 */
const CAPABILITIES_RECORDED =
	/const answer = await desktopResult<DesktopCapabilities>\(\{\s*op: "capabilities",\s*\}\);[\s\S]{0,2000}?recordStreamCapabilityFlags\(streamCapabilityFlags\(answer\)\);\s*return answer;/;
const FLAGS_DERIVED =
	/function streamCapabilityFlags\([\s\S]{0,600}?desktopFeatureEnabled\(capabilities, "open_frame"\)[\s\S]{0,300}?desktopFeatureEnabled\(\s*capabilities,\s*"journal_order",?\s*\)[\s\S]{0,300}?desktopFeatureEnabled\(\s*capabilities,\s*"peer_journal_source",?/;

test("the capabilities read records the flags the pane derives", () => {
	const hooks = readFileSync(
		"src/renderer/src/shared/api/local-operator/desktop-hooks.ts",
		"utf8",
	);
	assert.match(
		hooks,
		CAPABILITIES_RECORDED,
		"`useDesktopCapabilities` records the answer the prewarm reads",
	);
	assert.match(
		hooks,
		FLAGS_DERIVED,
		"and derives them with the same predicate the pane uses",
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
	// No capabilities answer has arrived, so the prewarm asks undeclared - which
	// is the fail-closed request. A pane that declares is asking for something
	// else, and the guard is correctness: it must refuse rather than serve it.
	prewarmSessionStream("s5");
	const log = prewarmLog();
	try {
		subscribeDesktopStream({ sessionId: "s5", openFrame: true }, () => {});
		assert.equal(r.calls.length, 2, "the pane opens its own connection");
		assert.equal(r.calls[1].openFrame, true);
		assert.equal(r.disposed[0], true, "the unusable prewarm is closed");
		assert.deepEqual(
			log.lines,
			[
				"[stream-prewarm] session=s5 decision=requested why=negotiation " +
					"asked=1,0,0 prewarm=0,0,0 caps=absent",
			],
			"the refusal says which rule fired and what each side asked",
		);
	} finally {
		log.restore();
	}
});

test("the prewarm's flags come from the capabilities answer, not the last request", () => {
	const r = rig();
	// The state every app session is in before its first click: one subscription
	// asking for nothing at all, and no capability answer yet.
	subscribeDesktopStream({ sessionId: "warmup" }, () => {});
	assert.equal(r.calls[0].openFrame, undefined);
	// The answer arrives - after that subscription, so inheriting its request
	// would still ask undeclared.
	capabilities();
	prewarmSessionStream("s6");
	assert.equal(r.calls.length, 2);
	assert.equal(
		r.calls[1].openFrame,
		true,
		"the capability is the answer's, not the last request's",
	);
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
	// The capability answer the pane derives its flags from; the prewarm phrases
	// the same request off it, so the first subscription has no part in it.
	capabilities();
	prewarmSessionStream("d1");
	const adopted = [];
	subscribeDesktopStream(
		{ sessionId: "d1", openFrame: true, journalOrder: true, orderIds: [] },
		() => {},
		(decision) => adopted.push(decision),
	);
	assert.deepEqual(adopted, ["adopted"], "the click's connection was used");
	assert.equal(r.calls.length, 1, "so no second connection was opened");

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
	assert.equal(r.calls.length, 3);
});

/*
 * THE DECLARATION IS THE TARGET'S, NOT THE DEPARTED PANE'S (agent review round 1,
 * MINOR 1). `peerJournalSource` is per-conversation, so a local target must send
 * nothing even when the conversation being left was a peer's.
 */
test("a local target's prewarm does not carry the departed peer's declaration", () => {
	const r = rig();
	// The peer-source capability is enabled in the answer, and the target is
	// LOCAL: the click must send the capability AND-ed with nothing, not the
	// capability alone.
	capabilities();
	prewarmSessionStream("local1", { remoteOwned: false });
	assert.equal(r.calls.length, 1);
	assert.equal(
		r.calls[0].peerJournalSource,
		undefined,
		"a local conversation never declares the complete contract",
	);
	subscribeDesktopStream(
		{ sessionId: "local1", openFrame: true, journalOrder: true, orderIds: [] },
		() => {},
	);
	assert.equal(
		r.calls.length,
		1,
		"and the local pane adopts that undeclared stream",
	);
});

test("a remote-owned target's prewarm declares the contract, and is adopted", () => {
	const r = rig();
	capabilities();
	prewarmSessionStream("peer2", { remoteOwned: true });
	assert.equal(
		r.calls[0].peerJournalSource,
		true,
		"this conversation is the peer's",
	);
	subscribeDesktopStream(
		{
			sessionId: "peer2",
			openFrame: true,
			journalOrder: true,
			orderIds: [],
			peerJournalSource: true,
		},
		() => {},
	);
	assert.equal(
		r.calls.length,
		1,
		"the declared prewarm is adopted, so no second connection exists",
	);
});

/*
 * THE FAIL-CLOSED HALF, AFTER THE SOURCE MOVED (agent review remediation round 2).
 *
 * `peerJournalSource` is the capability AND the target's placement. With no
 * capabilities answer yet, both the prewarm and the pane ask undeclared - so this
 * is the one case where a peer target is served by an undeclared prewarm, and the
 * click still must not INVENT the declaration to make adoption easier.
 */
test("a peer target prewarms undeclared before any capability answer, and is adopted", () => {
	const r = rig();
	assert.equal(recordedStreamCapabilityFlags(), null);
	prewarmSessionStream("peer3", { remoteOwned: true });
	assert.equal(
		r.calls[0].peerJournalSource,
		undefined,
		"nothing proven, nothing declared",
	);
	subscribeDesktopStream({ sessionId: "peer3" }, () => {});
	assert.equal(
		r.calls.length,
		1,
		"the pane, asking the same undeclared request, adopts it",
	);
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
