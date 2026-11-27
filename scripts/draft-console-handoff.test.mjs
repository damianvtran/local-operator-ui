/**
 * WHICH SEND HANDS A DRAFT'S CONSOLE OVER, AND WHICH MUST NOT.
 *
 * A New Conversation's console pane runs real shells under `DRAFT_CONSOLE_OWNER`
 * (`src/shared/console-owner.ts`), and the conversation the draft's FIRST accepted
 * message created takes them over in place (`ConsoleHost.adoptPendingConsole`).
 * Agent review round 1 (R1, R3) and QA round 1 (Q1) each found a send that was not
 * that one still reaching the bridge: an ordinary send into an existing
 * conversation adopted every pending surface onto it, and a first send to a
 * peer-placed conversation adopted locally. The gate is
 * `draftConsoleHandoffTarget`, and these are its controls, driven through the
 * SHIPPED store.
 *
 * WHY THIS IS ITS OWN FILE rather than a case in `canonical-chat.test.mjs`: the
 * store's send path needs the transport fixture below (real store, stubbed
 * network), and that file carries its own copy of it. This one bundles the same
 * shipped store with the three stubs the store's imports need and nothing else, so
 * the cases here read as the handoff question alone.
 *
 * WHAT IS SUBSTITUTED AND WHAT THAT COSTS: the bridge (`window.api.console.
 * adoptPending`) is a recorder, because main's own contract — the same handle, the
 * same pty, the bytes on disk — is pinned against real files in
 * `console-host.test.mjs`. What this file proves is which sends reach for it and
 * how often; it proves nothing about a process.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The literals these cases use, hoisted: `useTopLevelRegex` charges a literal
 * constructed inside a function, and `scripts/` is outside `pnpm lint`'s path
 * list, so this tree's own gate (`pnpm lint:scripts`) is the only thing that
 * would say so.
 */
const RE_PROVIDER_UNAVAILABLE = /provider unavailable/;
/** The three module filters the store's bundle substitutes, and esbuild's any-name
 * filter beside them. */
const RE_DESKTOP_API = /@shared\/api\/local-operator\/desktop-api/;
const RE_CANONICAL_HOOKS = /@shared\/hooks\/use-canonical-session/;
const RE_DESKTOP_HOOKS = /@shared\/api\/local-operator\/desktop-hooks/;
const RE_LOOSE = /.*/;

// The store's persistence middleware writes through `localStorage` on every set.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

const calls = [];
globalThis.__canonicalRequest = async (request) => {
	calls.push(request);
	return {};
};
const echoes = [];
globalThis.__canonicalEcho = (event) => {
	echoes.push({ ...event, callsAtTime: calls.length });
};

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@shared/i18n": "./src/i18n",
	},
	plugins: [
		{
			name: "console-handoff-fixtures",
			setup(builder) {
				// The network. The error classes are re-exported from the real module
				// because the store's copy rules read their actual behaviour.
				builder.onResolve({ filter: RE_DESKTOP_API }, () => ({
					path: "transport",
					namespace: "fixture",
				}));
				builder.onLoad({ filter: RE_LOOSE, namespace: "fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__canonicalRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				// The optimistic echo seam: React and a live EventSource, of which the
				// store uses only these calls. Recorded, never asserted here.
				builder.onResolve({ filter: RE_CANONICAL_HOOKS }, () => ({
					path: "echo",
					namespace: "echo-fixture",
				}));
				builder.onLoad({ filter: RE_LOOSE, namespace: "echo-fixture" }, () => ({
					contents: `export const paintPendingSend = (identity, send) =>
	globalThis.__canonicalEcho({ kind: "echo", identity, id: send.id, text: send.text });
export const movePendingSendIdentity = (from, to) =>
	globalThis.__canonicalEcho({ kind: "move", from, to });
export const replacePendingSendText = (identity, id, text) =>
	globalThis.__canonicalEcho({ kind: "replace", identity, id, text });
export const discardPendingSends = (identity) =>
	globalThis.__canonicalEcho({ kind: "discard", sessionId: identity });
export const pendingSendForView = () => null;
export const settlePendingSend = (identity, id) =>
	globalThis.__canonicalEcho({ kind: "settle", identity, id });
export const hasPendingSend = () => false;
export const retractPendingUser = (sessionId, id) =>
	globalThis.__canonicalEcho({ kind: "retract", sessionId, id });
export const retractLocalEcho = (sessionId, id) => {
	globalThis.__canonicalEcho({ kind: "retract-local", sessionId, id });
	return "retracted";
};
export const peekLocalEcho = (sessionId, id) => {
	globalThis.__canonicalEcho({ kind: "peek-local", sessionId, id });
	return "local";
};
export const discardPendingEchoes = (sessionId) =>
	globalThis.__canonicalEcho({ kind: "discard", sessionId });`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				// The capability probe: absent client, the fail-closed direction.
				builder.onResolve({ filter: RE_DESKTOP_HOOKS }, () => ({
					path: "capabilities",
					namespace: "capability-fixture",
				}));
				builder.onLoad(
					{ filter: RE_LOOSE, namespace: "capability-fixture" },
					() => ({
						contents:
							'export const desktopFeatureEnabled = () => false;\nexport const desktopKeys = { capabilities: ["desktop", "capabilities"] };',
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});
const module_ = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	useCanonicalSessionsStore: store,
	admitChatDraft,
	adoptPendingConsole,
	draftConsoleHandoffTarget,
} = module_;

function reset() {
	calls.length = 0;
	echoes.length = 0;
	store.setState({
		sessions: [],
		statusUnavailable: [],
		activeSessionId: "111111111111",
		activeDraftKey: null,
		drafts: {},
		validatingSessionId: null,
		error: null,
	});
}

const input = {
	text: "Review this",
	attachments: [],
	images: [],
	mode: "prompt",
	cwd: "/tmp",
};

/* ------------------------------------------- the pending local console's handoff */

/*
 * THE PENDING LOCAL CONSOLE MOVES ON EXACTLY ONE EVENT: a staged draft's first
 * message being ACCEPTED. Everything else leaves it alone.
 *
 * These are the negative controls agent review round 1 (R1) and QA round 1 (Q1)
 * asked for, driven through the shipped store with the transport fixture below.
 * The adoption bridge is the only thing stubbed — main's own contract is pinned in
 * `console-host.test.mjs` — so what is asserted here is which sends reach for it,
 * in what order, and how many times.
 */

/** Install the adoption bridge for one test and record every call. */
function consoleBridge() {
	const adopted = [];
	globalThis.window = {
		api: {
			console: { adoptPending: async (sessionId) => adopted.push(sessionId) },
		},
	};
	return adopted;
}

test("a refused first send moves nothing, and the accepted retry hands the console over once", async () => {
	const adopted = consoleBridge();
	try {
		reset();
		let attempts = 0;
		globalThis.__canonicalRequest = async (request) => {
			calls.push(request);
			if (request.op === "sessions.create")
				return {
					session_id: "444444444444",
					binding: { agent: "reviewer", team: null },
				};
			if (request.op === "sessions.list")
				return { sessions: [], truncated: false };
			if (++attempts === 1) throw new Error("provider unavailable");
			return { status: "admitted" };
		};
		const key = store
			.getState()
			.stageDraft({ kind: "agent", name: "reviewer" });
		await assert.rejects(admitChatDraft(key, input), RE_PROVIDER_UNAVAILABLE);
		assert.equal(
			store.getState().drafts[key].sessionId,
			"444444444444",
			"the create's id is on the row, which is why the pane must not read it as its console owner",
		);
		assert.deepEqual(adopted, [], "a refused send adopts nothing");

		// The retry is the draft's first ACCEPTED send: same row, same conversation,
		// same shells on main's side — so this is the call that moves them.
		await admitChatDraft(key, input);
		assert.deepEqual(
			adopted,
			["444444444444"],
			"the accepted retry adopts once",
		);
		assert.equal(store.getState().drafts[key], undefined, "the row retired");
	} finally {
		globalThis.window = undefined;
	}
});

test("an ordinary send into an existing conversation never takes the pending console", async () => {
	const adopted = consoleBridge();
	try {
		reset();
		globalThis.__canonicalRequest = async (request) => {
			calls.push(request);
			if (request.op === "sessions.message") return { status: "admitted" };
			if (request.op === "sessions.list")
				return { sessions: [], truncated: false };
			throw new Error(`unexpected ${request.op}`);
		};
		await admitChatDraft("send:111111111111", input, "111111111111");
		assert.deepEqual(
			adopted,
			[],
			"a send:<id> row is a send INTO a conversation, not a new conversation's first",
		);
	} finally {
		globalThis.window = undefined;
	}
});

test("a first send whose conversation was created on a peer is not adopted locally", async () => {
	const adopted = consoleBridge();
	try {
		reset();
		globalThis.__canonicalRequest = async (request) => {
			calls.push(request);
			if (request.op === "sessions.create")
				return {
					session_id: "555555555555",
					binding: { agent: "reviewer", team: null },
				};
			if (request.op === "sessions.list")
				return { sessions: [], truncated: false };
			if (request.op === "sessions.message") return { status: "admitted" };
			throw new Error(`unexpected ${request.op}`);
		};
		const key = store
			.getState()
			.stageDraft({ kind: "agent", name: "reviewer" });
		store.getState().updateDraft(key, { peer: "review-peer" });
		await admitChatDraft(key, input);
		assert.deepEqual(
			adopted,
			[],
			"the conversation is another device's; this host's shells have nowhere to go",
		);
	} finally {
		globalThis.window = undefined;
	}
});

test("the handoff predicate refuses remote placement, retired drafts and foreign keys", () => {
	const live = (sessionId, extra = {}) => ({
		key: "draft:aaaa",
		sessionId,
		...extra,
	});
	// The genuine case: a live staged draft row pointing at the conversation the
	// message landed on, placed locally.
	assert.equal(
		draftConsoleHandoffTarget(
			{
				sessions: [],
				placementFacts: {},
				drafts: { "draft:aaaa": live("local-1") },
			},
			"draft:aaaa",
			"local-1",
		),
		true,
	);
	// Remote by placement fact (the late-reconcile shape: the catalogue learned it
	// after the create answered).
	assert.equal(
		draftConsoleHandoffTarget(
			{
				sessions: [],
				placementFacts: { "remote-1": { locality: "remote" } },
				drafts: { "draft:aaaa": live("remote-1") },
			},
			"draft:aaaa",
			"remote-1",
		),
		false,
	);
	// Remote by the row's own locality.
	assert.equal(
		draftConsoleHandoffTarget(
			{
				sessions: [{ session_id: "remote-2", locality: "remote" }],
				placementFacts: {},
				drafts: { "draft:aaaa": live("remote-2") },
			},
			"draft:aaaa",
			"remote-2",
		),
		false,
	);
	// A retired draft has no row: a late reconcile for a conversation that was
	// adopted once cannot claim whatever a LATER draft opened.
	assert.equal(
		draftConsoleHandoffTarget(
			{ sessions: [], placementFacts: {}, drafts: {} },
			"draft:aaaa",
			"local-1",
		),
		false,
	);
	// And the two key shapes that are not a staged draft at all.
	assert.equal(
		draftConsoleHandoffTarget(
			{ sessions: [], placementFacts: {}, drafts: {} },
			"send:local-1",
			"local-1",
		),
		false,
	);
	assert.equal(
		draftConsoleHandoffTarget(
			{ sessions: [], placementFacts: {}, drafts: {} },
			null,
			"local-1",
		),
		false,
	);
});

test("the handoff is one-shot, so a second call for the same conversation moves nothing", async () => {
	const adopted = consoleBridge();
	try {
		reset();
		store.setState({
			drafts: {
				"draft:oneshot": {
					key: "draft:oneshot",
					sessionId: "666666666666",
					createRequestId: "create-oneshot",
					admissionRequestId: "admit-oneshot",
				},
			},
		});
		await adoptPendingConsole("draft:oneshot", "666666666666");
		await adoptPendingConsole("draft:oneshot", "666666666666");
		assert.deepEqual(
			adopted,
			["666666666666"],
			"one acceptance is one move: the second call cannot hand a later draft's shells to this conversation",
		);
	} finally {
		globalThis.window = undefined;
	}
});
