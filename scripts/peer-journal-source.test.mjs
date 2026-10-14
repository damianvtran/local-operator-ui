import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE COMPLETE PEER-SOURCE CONTRACT'S CONSUMER HALF, driven through the REAL
 * hook (the unified consumer): the `peer_journal_source` declaration's peer
 * scoping on the subscription and the reads, the facts-only
 * `source_read=metadata` lookup the cached-ID order repair takes, the typed
 * `source_read=payload` subset that admits the bodies those facts owed, and the
 * ONE coalesced authoritative session GET an owed reconcile settles through.
 *
 * HOW. The same harness `scripts/frontend-replace.test.mjs` uses: the shipped
 * hook, the shipped store and the shipped reducer, with a cell-based React
 * stand-in, a stubbed transport and a fake clock. Assertions are on the handle
 * the hook returns and on the requests the stub saw - never on a helper's
 * return value - so a declaration that went out and was then contradicted by
 * some later branch fails here.
 *
 * WHY THIS FILE exists beside `transcript-journal-order.test.mjs` (which pins
 * the reducer and the repair loop directly): the declaration's scoping is a
 * HOOK decision - capability AND catalogue placement AND the conversation's own
 * live subscription - and the demand rule that picks the authoritative read is
 * a closure inside the repair effect. Neither is reachable from the reducer
 * tests, and both are where a wrong reading of the contract would put a
 * request on the wire whose facts nobody could settle.
 *
 * The React stand-in does NOT model React's scheduler, batching or commit
 * timing. Nothing here asserts on a frame: it asserts what the view and the
 * wire hold once the sequence has been delivered and drained.
 */

// `zustand/middleware` reaches for localStorage at import time.
const store = new Map();
globalThis.localStorage = {
	getItem: (key) => store.get(key) ?? null,
	setItem: (key, value) => store.set(key, value),
	removeItem: (key) => store.delete(key),
};

/* ----------------------------------------------------------------- the clock */

let rafQueue = [];
let rafSeq = 0;
let fallbackSeq = 0;
globalThis.requestAnimationFrame = (callback) => {
	rafQueue.push(callback);
	rafSeq += 1;
	return rafSeq;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.window = {
	// The hook only ever CLEARS this fallback; scheduling it for real would let a
	// wall-clock flush race the assertions.
	setTimeout: () => {
		fallbackSeq += 1;
		return fallbackSeq;
	},
	clearTimeout: () => {},
};

/* ------------------------------------------------------------- the transport */

const subscriptions = [];
const requests = [];

globalThis.__replaceSubscribe = (args, onEvent) => {
	const entry = { args, onEvent, disposed: false };
	subscriptions.push(entry);
	return () => {
		entry.disposed = true;
	};
};
globalThis.__replaceRequest = async (request) => {
	requests.push(request);
	if (request.op === "sessions.history")
		return globalThis.__replaceHistory(request);
	if (request.op === "sessions.get" && globalThis.__replaceSnapshot)
		return globalThis.__replaceSnapshot(request);
	return {};
};

const reactStandIn = `const R = () => globalThis.__reactRuntime;
export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useLayoutEffect = (...a) => R().useLayoutEffect(...a);
export const useInsertionEffect = () => {};
export const useRef = (...a) => R().useRef(...a);
export const useCallback = (...a) => R().useCallback(...a);
export const useMemo = (...a) => R().useMemo(...a);
export const useSyncExternalStore = (...a) => R().useSyncExternalStore(...a);
export const useDebugValue = () => {};
export const createElement = () => ({});
export const Fragment = Symbol("fragment");
export default { useState, useEffect, useLayoutEffect, useInsertionEffect, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment };`;

const bundle = await build({
	stdin: {
		contents: `
			export { useCanonicalSessionStream } from "./src/renderer/src/shared/hooks/use-canonical-session";
			export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
			export { desktopEndpoint } from "./src/shared/desktop-contract";`,
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
	plugins: [
		{
			name: "peer-journal-source-fixture",
			setup(builder) {
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "peer-source-fixture",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "peer-source-fixture" },
					() => ({
						contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__replaceRequest(request);
						export const subscribeDesktopStream = (args, onEvent) => globalThis.__replaceSubscribe(args, onEvent);`,
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "peer-source-react",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "peer-source-react" },
					() => ({
						contents: reactStandIn,
						loader: "js",
					}),
				);
			},
		},
	],
});
const {
	useCanonicalSessionStream,
	useCanonicalSessionsStore,
	desktopEndpoint,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "cccccccccccc";
const OWNER_EPOCH = "owner-epoch";
const BRIDGE_EPOCH = "bridge-epoch";
const ROW_EARLY = "row-early";
const ROW_LATER = "row-later";
const ROW_MISSED = "row-missed";

/* ---------------------------------------------------- the React stand-in (one cell per call) */

function makeRuntime() {
	const cells = [];
	let cursor = 0;
	let effects = [];
	const runtime = { render: () => null };
	const rerender = () => {
		cursor = 0;
		effects = [];
		const out = runtime.render();
		const flushed = effects;
		effects = [];
		for (const fn of flushed) fn?.();
		return out;
	};
	runtime.rerender = rerender;
	const slot = () => {
		const index = cursor++;
		if (!cells[index]) cells[index] = {};
		return cells[index];
	};
	const unchanged = (was, next) =>
		was !== undefined &&
		next !== undefined &&
		was.length === next.length &&
		was.every((value, index) => Object.is(value, next[index]));
	globalThis.__reactRuntime = {
		useState: (init) => {
			const cell = slot();
			if (!("state" in cell))
				cell.state = typeof init === "function" ? init() : init;
			return [
				cell.state,
				(value) => {
					const next = typeof value === "function" ? value(cell.state) : value;
					if (Object.is(next, cell.state)) return;
					cell.state = next;
					rerender();
				},
			];
		},
		useRef: (init) => {
			const cell = slot();
			if (!("ref" in cell)) cell.ref = { current: init };
			return cell.ref;
		},
		useCallback: (fn, deps) => {
			const cell = slot();
			if (!cell.fn || !unchanged(cell.deps, deps)) {
				cell.fn = fn;
				cell.deps = deps;
			}
			return cell.fn;
		},
		useMemo: (fn, deps) => {
			const cell = slot();
			if (!("value" in cell) || !unchanged(cell.deps, deps)) {
				cell.value = fn();
				cell.deps = deps;
			}
			return cell.value;
		},
		useEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
		useLayoutEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	};
	return runtime;
}

/* ------------------------------------------------------------------- the wire */

const messageRow = (id, text) => ({
	id,
	ts: 100,
	type: "message",
	payload: {
		kind: "message",
		role: "user",
		content: [{ text }],
	},
});

const page = (entries, generation, extra = {}) => ({
	entries,
	has_more: false,
	cursor_missing: false,
	journal_order_state: "ready",
	journal_generation: generation,
	...extra,
});

const frontendState = ({ cwd = "/tmp", sequence } = {}) => ({
	state_version: 1,
	session_id: SESSION,
	epoch: OWNER_EPOCH,
	sequence,
	cwd,
	conversation_title: "Conversation A",
	conversation_title_user_set: true,
	conversation_title_forked: false,
	goal: "",
	active_agent: "",
	active_team: "",
	selected_model: null,
	effective_model: null,
	streaming: false,
	generation: 4,
	pending_gate: null,
	history_cursor: ROW_LATER,
	live_events: [],
	queued_steering: [],
	jobs: [],
	todos: [],
	wakes: [],
	mcp_servers: [],
	model_catalogue: [],
});

const openFrame = (seq) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "open",
	payload: { subscription_id: `sub-${seq}`, gap: false, watch_ttl_seconds: 45 },
});

const snapshotFrame = (seq, history) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "snapshot",
	payload: {
		frontend: {
			state_version: 1,
			epoch: OWNER_EPOCH,
			sequence: 1,
			live_cursor: ROW_LATER,
			snapshot: frontendState({ sequence: 1 }),
		},
		history,
		cold: false,
	},
});

const readyWake = (seq) => ({
	session_id: SESSION,
	epoch: BRIDGE_EPOCH,
	seq,
	type: "event",
	payload: { type: "journal_order_ready", peer_source: true },
});

function deliver(frame) {
	const active = subscriptions.filter((entry) => !entry.disposed).at(-1);
	assert.ok(active, "no live subscription to deliver to");
	active.onEvent({ kind: "data", data: JSON.stringify(frame) });
}

const settle = async () => {
	for (let i = 0; i < 4; i++)
		await new Promise((resolve) => setImmediate(resolve));
};

async function pump() {
	for (let pass = 0; pass < 20 && rafQueue.length > 0; pass++) {
		const callbacks = rafQueue;
		rafQueue = [];
		for (const callback of callbacks) callback();
		await settle();
	}
	await settle();
}

/** The repair's own reads: the facts-only lookups and the order-carrying GETs. */
const repairReads = () =>
	requests.filter(
		(request) =>
			(request.op === "sessions.history" &&
				request.sourceRead === "metadata") ||
			(request.op === "sessions.get" && request.journalOrder === true),
	);

/**
 * Mount the shipped hook on SESSION, deliver the open frame and one snapshot,
 * and hand back the handle plus the request log reader.
 *
 * `placement` decides what the catalogue says about the conversation at mount:
 * `"remote"` seeds the placement fact (the sidebar's own evidence), `null`
 * leaves it unplaced (a deep-linked conversation the catalogue has not carried
 * yet), and both arms keep the capability on - the scoping is the difference.
 */
async function peerMount({
	placement = "remote",
	journalOrder = true,
	peerJournalSource = true,
	history,
	snapshotHandler,
	historyHandler,
} = {}) {
	subscriptions.length = 0;
	requests.length = 0;
	rafQueue = [];
	globalThis.__replaceHistory = async (request) => {
		if (historyHandler) return historyHandler(request);
		return { entries: [], has_more: false, cursor_missing: false };
	};
	globalThis.__replaceSnapshot = async (request) => {
		if (snapshotHandler) return snapshotHandler(request);
		return snapshotFrame(9, page([], "peer-A"));
	};
	const facts =
		placement === "remote"
			? { [SESSION]: { locality: "remote", owner_device: "d_peer", at: 1 } }
			: {};
	useCanonicalSessionsStore.setState({
		activeSessionId: null,
		drafts: {},
		sessions: [],
		placementFacts: facts,
	});
	const runtime = makeRuntime();
	let handle;
	runtime.render = () => {
		handle = useCanonicalSessionStream(SESSION, true, true, SESSION, {
			...(journalOrder ? { journalOrder: true } : {}),
			...(peerJournalSource ? { peerJournalSource: true } : {}),
		});
		return handle;
	};
	runtime.rerender();
	deliver(openFrame(1));
	deliver(
		snapshotFrame(
			2,
			history ?? page([messageRow(ROW_EARLY, "where am I?")], "peer-A"),
		),
	);
	await pump();
	return { get: () => handle };
}

test("the declaration rides a peer subscription; a local conversation's stays absent", async () => {
	await peerMount();
	assert.equal(subscriptions.at(-1).args.peerJournalSource, true);
	assert.equal(subscriptions.at(-1).args.journalOrder, true);

	await peerMount({ placement: null });
	assert.equal(subscriptions.at(-1).args.peerJournalSource, undefined);
	assert.equal(subscriptions.at(-1).args.journalOrder, true);

	await peerMount({ peerJournalSource: false });
	assert.equal(subscriptions.at(-1).args.peerJournalSource, undefined);
});

test("a peer conversation's cached IDs resolve through the facts-only lookup, then the typed payload subset, with the exact wire shape", async () => {
	const h = await peerMount({
		// One cached row the page could not attest: it drives the repair.
		history: page([messageRow(ROW_EARLY, "where am I?")], "peer-A"),
		historyHandler: async (request) => {
			if (request.sourceRead === "metadata")
				return {
					entries: [],
					has_more: false,
					cursor_missing: false,
					journal_order_state: "ready",
					journal_generation: "peer-A",
					journal_ordinals: { [ROW_EARLY]: 3 },
					journal_missing_ids: [],
				};
			if (request.sourceRead === "payload")
				return {
					entries: [{ ...messageRow(ROW_EARLY, "where am I?"), journal_seq: 3 }],
					has_more: false,
					cursor_missing: false,
					journal_order_state: "ready",
					journal_generation: "peer-A",
					source_present_ids: [ROW_EARLY],
				};
			return { entries: [], has_more: false, cursor_missing: false };
		},
	});
	const lookups = requests.filter(
		(request) => request.sourceRead === "metadata",
	);
	assert.ok(lookups.length >= 1, "the repair took the facts-only lookup");
	const lookup = lookups[0];
	assert.equal(lookup.op, "sessions.history");
	assert.equal(lookup.peerJournalSource, true);
	assert.equal(lookup.expectedJournalGeneration, "peer-A");
	assert.ok(lookup.orderIds.includes(ROW_EARLY));
	const built = desktopEndpoint(lookup).path;
	assert.ok(built.includes("source_read=metadata"), built);
	assert.ok(built.includes("peer_journal_source=1"), built);
	assert.ok(built.includes("expected_journal_generation=peer-A"), built);
	/*
	 * THE OTHER HALF OF THE CHAIN (the unified commit): the facts lookup proves
	 * the coordinate and OWES the body, and the typed payload subset is what
	 * admits it under the accepted generation with its own coordinate. The old
	 * S1 reading settled the row on the lookup's coordinate alone - which the
	 * complete contract forbids (a coordinate is not a body).
	 */
	const payload = requests.find(
		(request) => request.sourceRead === "payload",
	);
	assert.ok(payload, "the owed body took the typed payload subset");
	assert.equal(payload.peerJournalSource, true);
	assert.equal(payload.expectedJournalGeneration, "peer-A");
	assert.ok(payload.orderIds.includes(ROW_EARLY));
	const payloadPath = desktopEndpoint(payload).path;
	assert.ok(payloadPath.includes("source_read=payload"), payloadPath);
	assert.ok(payloadPath.includes("expected_journal_generation=peer-A"), payloadPath);
	// No order-carrying session GET was needed: the pair settled the sweep.
	assert.equal(
		requests.filter(
			(request) =>
				request.op === "sessions.get" && request.orderIds?.length > 0,
		).length,
		0,
	);
	const record = h.get().transcript.records.find((r) => r.id === ROW_EARLY);
	assert.equal(record.journalSeq, 3);
	assert.equal(record.journalGeneration, "peer-A");
});

test("a delta-born row's accepted family is admitted atomically at its owner-stamped ordinal (no supporting wake)", async () => {
	const h = await peerMount({
		history: page(
			[
				{ ...messageRow(ROW_EARLY, "where am I?"), journal_seq: 0 },
				{ ...messageRow(ROW_LATER, "in the old directory"), journal_seq: 1 },
			],
			"peer-A",
		),
		historyHandler: async (request) => {
			if (request.sourceRead === "metadata")
				return {
					entries: [],
					has_more: false,
					cursor_missing: false,
					journal_order_state: "ready",
					journal_generation: "peer-A",
					journal_ordinals: Object.fromEntries(
						request.orderIds.map((id) => [id, 0]),
					),
				};
			return { entries: [], has_more: false, cursor_missing: false };
		},
	});
	const before = repairReads().length;
	/*
	 * A recovery delta carrying a row this viewer never streamed, WITH the
	 * complete contract's family keys beside it, exactly as a declared
	 * subscriber receives them. The unified consumer admits the row ATOMICALLY
	 * on its accepted domain: the family's owner-stamped ordinal is the
	 * coordinate, and no lookup, wake or token is needed to settle it. The old
	 * S1 expectation ("consumes only the lookup's coordinate, not the family's
	 * 41") belonged to the stage that ignored the family.
	 */
	deliver({
		session_id: SESSION,
		epoch: BRIDGE_EPOCH,
		seq: 5,
		type: "event",
		payload: {
			type: "history_delta",
			messages: [
				{
					id: ROW_MISSED,
					role: "user",
					content: [{ type: "text", text: "missed while away" }],
				},
			],
			journal_generation: "peer-A",
			journal_ordinals: { [ROW_MISSED]: 41 },
			entry_times: { [ROW_MISSED]: 1700000100 },
		},
	});
	await pump();
	assert.equal(
		repairReads().length,
		before,
		"the accepted family self-settled: no lookup, no supporting wake",
	);
	const row = h.get().transcript.records.find((r) => r.id === ROW_MISSED);
	assert.ok(row, "the delta row is painted");
	assert.equal(row.journalSeq, 41, "the family's own ordinal admits the row");
	assert.equal(row.journalGeneration, "peer-A");
	assert.equal(h.get().transcript.journalGeneration, "peer-A");
});

test("a rebuilt source never installs from the lookup; the owed reconcile settles through ONE declared session GET", async () => {
	const h = await peerMount({
		history: page([messageRow(ROW_EARLY, "where am I?")], "peer-A"),
		historyHandler: async (request) => {
			if (request.sourceRead === "metadata")
				// The rebuilt source: facts belong to another domain, and the
				// answer is a correction, never an authority to install.
				return {
					entries: [],
					has_more: false,
					cursor_missing: false,
					journal_order_state: "unavailable",
					journal_generation: "peer-B",
					reconcile: true,
				};
			return { entries: [], has_more: false, cursor_missing: false };
		},
		snapshotHandler: async () =>
			snapshotFrame(
				9,
				page(
					[{ ...messageRow(ROW_EARLY, "where am I?"), journal_seq: 0 }],
					"peer-B",
				),
			),
		historyHandler: async (request) => {
			if (request.sourceRead === "metadata")
				// The rebuilt source: facts belong to another domain, and the
				// answer is a correction, never an authority to install.
				return {
					entries: [],
					has_more: false,
					cursor_missing: false,
					journal_order_state: "unavailable",
					journal_generation: "peer-B",
					reconcile: true,
				};
			if (request.sourceRead === "payload")
				return {
					entries: [{ ...messageRow(ROW_EARLY, "where am I?"), journal_seq: 0 }],
					has_more: false,
					cursor_missing: false,
					journal_order_state: "ready",
					journal_generation: "peer-B",
					source_present_ids: [ROW_EARLY],
				};
			return { entries: [], has_more: false, cursor_missing: false };
		},
	});
	const reads = repairReads();
	assert.ok(reads.length >= 3, "lookup, authority, then payload");
	assert.equal(reads[0].op, "sessions.history");
	assert.equal(reads[0].sourceRead, "metadata");
	assert.equal(reads[0].expectedJournalGeneration, "peer-A");
	const authority = reads.find((request) => request.op === "sessions.get");
	assert.ok(authority, "the owed reconcile took the session GET");
	assert.equal(authority.peerJournalSource, true);
	assert.equal(authority.orderIds.length, 1);
	assert.equal(h.get().transcript.journalGeneration, "peer-B");
	assert.equal(h.get().transcript.orderNeedsReconcile, false);
	assert.equal(
		h.get().transcript.records.find((r) => r.id === ROW_EARLY).journalSeq,
		0,
	);
});

test("a peer ready wake settles through one declared authority read", async () => {
	const h = await peerMount({
		history: page(
			[{ ...messageRow(ROW_EARLY, "where am I?"), journal_seq: 0 }],
			"peer-A",
		),
	});
	const before = repairReads().length;
	// The availability lane's metadata-only ready wake: a cause to re-read,
	// never generation authority of its own.
	deliver(readyWake(3));
	await pump();
	const reads = repairReads();
	assert.equal(reads.length, before + 1);
	const authority = reads.at(-1);
	assert.equal(authority.op, "sessions.get");
	assert.equal(authority.peerJournalSource, true);
	assert.equal(h.get().transcript.orderNeedsReconcile, false);
	assert.equal(h.get().transcript.journalGeneration, "peer-A");
});

test("a catalogue fact that lands after the connection adopts exactly one declared rebind", async () => {
	const h = await peerMount({
		placement: null,
		history: page([messageRow(ROW_EARLY, "where am I?")], "peer-A"),
		historyHandler: async (request) => {
			if (request.sourceRead === "metadata")
				return {
					entries: [],
					has_more: false,
					cursor_missing: false,
					journal_order_state: "ready",
					journal_generation: "peer-A",
					journal_ordinals: { [ROW_EARLY]: 3 },
				};
			return { entries: [], has_more: false, cursor_missing: false };
		},
		snapshotHandler: async () =>
			snapshotFrame(
				9,
				page(
					[{ ...messageRow(ROW_EARLY, "where am I?"), journal_seq: 3 }],
					"peer-A",
				),
			),
	});
	// Undeclared at connect: the repair's read is the legacy order-carrying
	// GET, exactly the shape this renderer has always sent.
	const first = repairReads().find((request) => request.op === "sessions.get");
	assert.ok(first, "the repair took the legacy read");
	assert.equal(first.peerJournalSource, undefined);
	/*
	 * THE LATE CATALOGUE FACT NOW ADOPTS THE CONVERSATION (the unified
	 * consumer's one declared rebind): a placement that lands on an otherwise
	 * healthy undeclared stream closes it and opens ONE declared subscription,
	 * so the complete contract is actually consumed rather than waiting for an
	 * unrelated reconnect. The old expectation ("the reads stay legacy until the
	 * next connect") was the S1 gap the assessment recorded as finding 3.
	 */
	useCanonicalSessionsStore.setState({
		placementFacts: {
			[SESSION]: { locality: "remote", owner_device: "d_peer", at: 2 },
		},
	});
	await pump();
	const declared = subscriptions.filter((entry) => !entry.disposed).at(-1);
	assert.equal(declared.args.peerJournalSource, true, "one declared rebind");
	// And a later wake's authority read now declares through that subscription.
	deliver(readyWake(4));
	await pump();
	const next = repairReads().at(-1);
	assert.equal(next.op, "sessions.get");
	assert.equal(next.peerJournalSource, true);
	assert.equal(h.get().transcript.journalGeneration, "peer-A");
});
