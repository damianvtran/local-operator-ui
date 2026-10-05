import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE PLACEMENT STAMP, HELD AND SETTLED.
 *
 * WHAT THIS SUITE IS FOR, in one line: a conversation created on a picked peer
 * is absent from every PLAIN catalogue answer (the store's own `fetchSessions`
 * never asks for peers), so the page fired by the create's own answer used to
 * rebuild membership without it and drop the freshly-stamped row - and the
 * chat header's device control, which reads that row, fell through to
 * `On this device` over a session the peer had just minted (operator report,
 * 2026-09-30; reproduced on the two-daemon rig, 2026-10-05, 231 ms after the
 * send). `placementFacts` is the hold; a peers-inclusive answer that SPEAKS
 * about the id is the settle, recency-checked on `PinFact`'s currency.
 *
 * The transport is a fake backend that routes on `op` and on the paging
 * parameters, so a cell can drive the create and then the exact page shapes the
 * two readers send. The counter-probe for the first cell - revert the
 * `keepIds` extension, watch it redden - is recorded on the PR rather than kept
 * here, because it would pin a code shape this file should be free to outlive.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/** Every request the store issued, in order. */
const calls = [];
/** The fake backend's answer for the next request; a function of the request. */
let answer = async () => ({ sessions: [], truncated: false });
globalThis.__canonicalRequest = async (request) => {
	calls.push(request);
	return answer(request);
};
globalThis.__canonicalEcho = () => {};

/*
 * The fixture's filter regexes, at TOP LEVEL: the repository's lint contract for
 * `scripts/` treats an inline literal as a per-call allocation.
 */
const DESKTOP_API_IMPORT_RE = /@shared\/api\/local-operator\/desktop-api/;
const ECHO_HOOK_IMPORT_RE = /@shared\/hooks\/use-canonical-session/;
const CONVERSATION_INPUT_STORE_RE =
	/^@shared\/store\/conversation-input-store$/;
const OPTIONAL_QUERY_CLIENT_RE = /^@shared\/hooks\/use-optional-query-client$/;
const ANY_MODULE_RE = /.*/;

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
	plugins: [
		{
			name: "placement-fixture",
			setup(builder) {
				builder.onResolve({ filter: DESKTOP_API_IMPORT_RE }, () => ({
					path: "transport",
					namespace: "fixture",
				}));
				builder.onResolve({ filter: ECHO_HOOK_IMPORT_RE }, () => ({
					path: "echo",
					namespace: "echo-fixture",
				}));
				builder.onResolve({ filter: CONVERSATION_INPUT_STORE_RE }, () => ({
					path: `${process.cwd()}/src/renderer/src/shared/store/conversation-input-store.ts`,
				}));
				builder.onResolve({ filter: OPTIONAL_QUERY_CLIENT_RE }, () => ({
					path: `${process.cwd()}/src/renderer/src/shared/hooks/use-optional-query-client.ts`,
				}));
				builder.onLoad(
					{ filter: ANY_MODULE_RE, namespace: "echo-fixture" },
					() => ({
						contents:
							"export const echoPendingUser = () => {};\nexport const retractPendingUser = () => {};\nexport const retractLocalEcho = () => 'retracted';\nexport const peekLocalEcho = () => 'unseen';\nexport const paintPendingSend = () => undefined;\nexport const settlePendingSend = () => undefined;\nexport const hasPendingSend = () => false;\nexport const movePendingSendIdentity = () => undefined;\nexport const replacePendingSendText = () => undefined;\nexport const discardPendingSends = () => undefined;\nexport const pendingSendForView = () => null;\nexport const discardPendingEchoes = () => {};",
						loader: "js",
					}),
				);
				builder.onLoad({ filter: ANY_MODULE_RE, namespace: "fixture" }, () => ({
					contents: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
						`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
					)}
export const desktopResult = request => globalThis.__canonicalRequest(request);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	useCanonicalSessionsStore: store,
	CATALOGUE_HEAD_PAGE,
	placementHeldIds,
} = module;

function reset() {
	calls.length = 0;
	answer = async () => ({ sessions: [], truncated: false });
	store.setState({
		sessions: [],
		drafts: {},
		scopes: {},
		head: {
			pageIds: [],
			tailIds: [],
			nextCursor: null,
			tailCursor: null,
			tailStarted: false,
			complete: false,
			loading: false,
			error: null,
			at: 0,
		},
		pinFacts: {},
		archiveFacts: {},
		placementFacts: {},
		forgotten: {},
		activeSessionId: null,
		answerSeq: 0,
		loading: false,
		truncated: false,
		error: null,
	});
}

/** A wire row, as `sessions.list` would send it. */
const wire = (id, over = {}) => ({ id, name: `Chat ${id}`, mtime: 1, ...over });

/** A canonical row, as this store holds it. */
const row = (id, over = {}) => ({
	session_id: id,
	title: `Chat ${id}`,
	updated_at: 1,
	...over,
});

/** A create answer, and a catalogue that stays silent about the new id. */
const creatingOn = (id) => async (request) =>
	request.op === "sessions.create"
		? { session_id: id, binding: { agent: null, team: null } }
		: { sessions: [], truncated: false };

const ids = () => store.getState().sessions.map((item) => item.session_id);
const factOf = (id) => store.getState().placementFacts[id];

test("only remote facts hold rows, and the helper says so", () => {
	assert.deepEqual(
		placementHeldIds({
			a: { locality: "remote", owner_device: "d_build", at: 1 },
			b: { locality: "local", owner_device: "", at: 2 },
		}),
		["a"],
		"a local fact protects nothing: its absence from a plain page is the drop rule",
	);
	assert.deepEqual(placementHeldIds({}), [], "and no facts hold nothing");
});

test("a create that named a peer keeps its row against a plain page answer", async () => {
	reset();
	answer = creatingOn("aaaaaaaaaaaa");
	await store
		.getState()
		.createSession("~", undefined, undefined, undefined, undefined, "d_build");

	const created = store.getState().sessions[0];
	assert.equal(created.session_id, "aaaaaaaaaaaa");
	assert.equal(
		created.locality,
		"remote",
		"the row carries the wire's own pair",
	);
	assert.equal(created.owner_device, "d_build");
	assert.equal(
		factOf("aaaaaaaaaaaa")?.locality,
		"remote",
		"and the fact behind the row is the create-stamp",
	);

	/*
	 * THE SEND'S OWN RE-READ: the plain answer cannot speak about the id, and
	 * this is the exact page that used to eat the row (and with it the chip).
	 */
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.deepEqual(
		ids(),
		["aaaaaaaaaaaa"],
		"a plain page that cannot carry the id does not drop the peer-created row",
	);
	assert.equal(
		store.getState().sessions[0].locality,
		"remote",
		"and the row still says where the conversation lives",
	);
});

test("a local create writes no placement fact, and no row field", async () => {
	reset();
	answer = async (request) =>
		request.op === "sessions.create"
			? { session_id: "bbbbbbbbbbbb", binding: { agent: null, team: null } }
			: { sessions: [], truncated: false };
	await store.getState().createSession("~");

	const created = store.getState().sessions[0];
	assert.equal(created.session_id, "bbbbbbbbbbbb");
	assert.equal(
		"locality" in created,
		false,
		"a local create's row is byte-for-byte what it was before the field existed",
	);
	assert.deepEqual(
		store.getState().placementFacts,
		{},
		"and no fact is written at all",
	);
});

test("a peers answer that speaks about the id settles the fact with the wire's pair", async () => {
	reset();
	answer = creatingOn("cccccccccccc");
	await store
		.getState()
		.createSession("~", undefined, undefined, undefined, undefined, "d_build");
	assert.equal(factOf("cccccccccccc")?.owner_device, "d_build");

	/*
	 * A PEERS-INCLUSIVE ANSWER: it carries the id, and the pair it states is the
	 * daemon's own ("locality"/"owner_device", the fields a peer listing
	 * publishes). It is the one kind of read that can correct a create's stamp.
	 */
	answer = async () => ({
		sessions: [
			wire("cccccccccccc", {
				locality: "remote",
				owner_device: "d_moved",
				owner_device_name: "other-box",
			}),
		],
		truncated: false,
	});
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.equal(
		factOf("cccccccccccc")?.owner_device,
		"d_moved",
		"the newer answer settles the fact - here or on another surface",
	);
});

test("an answer requested before the fact cannot clobber it (recency)", async () => {
	reset();
	/*
	 * The race the currency exists for, in miniature: a read is IN FLIGHT when
	 * the create lands, and its answer - which began before the fact existed -
	 * still carries the id. The fact the create wrote is newer than the answer's
	 * own request stamp, so the answer must leave it alone.
	 */
	let release;
	answer = async (request) => {
		if (request.op === "sessions.create")
			return {
				session_id: "dddddddddddd",
				binding: { agent: null, team: null },
			};
		return new Promise((resolve) => {
			release = () =>
				resolve({
					sessions: [
						wire("dddddddddddd", {
							locality: "remote",
							owner_device: "d_stale",
						}),
					],
					truncated: false,
				});
		});
	};
	const inFlight = store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	await store
		.getState()
		.createSession("~", undefined, undefined, undefined, undefined, "d_fresh");
	release();
	await inFlight;
	assert.equal(
		factOf("dddddddddddd")?.owner_device,
		"d_fresh",
		"a fact written after the request started is left alone, exactly as `PinFact` is",
	);
});

test("a move's receipt settles the row and the fact, and a recall home stops protecting", async () => {
	reset();
	store.setState({
		sessions: [
			row("eeeeeeeeeeee", { locality: "remote", owner_device: "d_a" }),
		],
	});
	store.getState().settlePlacement("eeeeeeeeeeee", {
		locality: "remote",
		owner_device: "d_b",
	});
	assert.equal(
		store.getState().sessions[0].owner_device,
		"d_b",
		"the receipt settles the row, as it always did",
	);
	assert.equal(
		factOf("eeeeeeeeeeee")?.owner_device,
		"d_b",
		"and the fact moves with it, from the one writer",
	);

	// The silent page: the moved row's fact holds it exactly as a create's does.
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.deepEqual(ids(), ["eeeeeeeeeeee"]);

	// A recall home: the pair goes local, and protection stops with it.
	store.getState().settlePlacement("eeeeeeeeeeee", {
		locality: "local",
		owner_device: "local",
	});
	assert.equal(factOf("eeeeeeeeeeee")?.locality, "local");
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.deepEqual(
		ids(),
		[],
		"a local fact protects nothing: the drop rule is byte-for-byte today's",
	);
});

test("a local row with no fact drops exactly as before", async () => {
	reset();
	store.setState({ sessions: [row("ffffffffffff")] });
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.deepEqual(ids(), [], "no fact, today's rule");
});

test("forgetSession takes the fact with the row", async () => {
	reset();
	answer = creatingOn("999999999999");
	await store
		.getState()
		.createSession("~", undefined, undefined, undefined, undefined, "d_build");
	assert.ok(factOf("999999999999"), "held before the delete");

	answer = async (request) =>
		request.op === "sessions.delete"
			? { session_id: "999999999999", deleted: true }
			: { sessions: [], truncated: false };
	const outcome = await store.getState().deleteSession("999999999999");
	assert.equal(outcome.ok, true);
	assert.deepEqual(ids(), [], "the row is gone");
	assert.equal(
		factOf("999999999999"),
		undefined,
		"and so is anything this client remembered about placing it",
	);
});
