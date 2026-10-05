import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE PEERS-INCLUSIVE ANSWER, LANDED IN THE CANONICAL CATALOGUE.
 *
 * WHAT THIS SUITE IS FOR, in one line: the sidebar's own poll must never carry
 * `include_peers` (it dials every peer's relay on the sidebar's timer), so the
 * federated answer arrives from its own ambient read and LANDS through
 * `settlePeerCatalogue` - and that action's rules are what this file executes:
 *
 *   1. remote rows upsert into the catalogue through the store's own merge
 *      (`mergeRow`), so the sidebar paints them like any other row;
 *   2. a placement fact the answer SPEAKS about settles to the wire's pair,
 *      with the request's currency (`beginAnswer`) so a create or a move that
 *      landed while the read was in flight is not undone by it;
 *   3. a held remote row is pruned ONLY against a read that can speak - another
 *      row from the same owner that the answer DID carry proves the owner
 *      answered, while an owner with no rows at all (the relay's silence) proves
 *      nothing and the cached row stays;
 *   4. an id that moved HOME stops wearing the remote mark in the same write.
 *
 * The store is bundled with esbuild and driven against a fake transport, the
 * same shape `chat-device-placement.test.mjs` uses for the same store; nothing
 * here needs React, a query client or a DOM.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/** Every request the store issued; `settlePeerCatalogue` itself issues none. */
const calls = [];
let answer = async () => ({ sessions: [], truncated: false });
globalThis.__canonicalRequest = async (request) => {
	calls.push(request);
	return answer(request);
};
globalThis.__canonicalEcho = () => {};

/* The fixture's filter regexes, at TOP LEVEL: the repository's lint contract for
 * `scripts/` treats an inline literal as a per-call allocation. */
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
			name: "peer-catalogue-fixture",
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
const { useCanonicalSessionsStore: store, placementHeldIds } = module;

/*
 * A SECOND BUNDLE, the read's own normaliser: `mesh-types.ts` imports the
 * store's row TYPE only, so it bundles with nothing behind it and its widening
 * (the fields the sidebar's row reads) is executable here too.
 */
const typesBundle = await build({
	stdin: {
		contents: 'export * from "./src/renderer/src/features/mesh/mesh-types";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const meshTypes = await import(
	`data:text/javascript;base64,${Buffer.from(typesBundle.outputFiles[0].text).toString("base64")}`
);

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

/** A canonical row, as the store holds it. */
const row = (id, over = {}) => ({
	session_id: id,
	title: `Chat ${id}`,
	updated_at: 1,
	...over,
});

/** A row as the federated (peers-inclusive) answer carries it. */
const remoteRow = (id, over = {}) =>
	row(id, {
		locality: "remote",
		owner_device: "d_node",
		owner_device_name: "cloud-node-1",
		reachable: true,
		unreachable_reason: "",
		status: { code: "idle", label: "Idle" },
		...over,
	});

const localRow = (id, over = {}) =>
	row(id, { locality: "local", owner_device: "", ...over });

/** Land one answer the way the ambient sync does. */
const land = (rows, requestedAt) =>
	store.getState().settlePeerCatalogue(rows, requestedAt);

const factOf = (id) => store.getState().placementFacts[id];
const ids = () => store.getState().sessions.map((item) => item.session_id);

test("a federated answer lists its remote rows beside the local ones", () => {
	reset();
	store.setState({ sessions: [row("aaaaaaaaaaaa")] });
	const stamp = store.getState().beginAnswer();
	land([localRow("aaaaaaaaaaaa"), remoteRow("bbbbbbbbbbbb")], stamp);

	assert.deepEqual(
		ids(),
		["aaaaaaaaaaaa", "bbbbbbbbbbbb"],
		"the remote row is appended in the answer's own order",
	);
	const remote = store.getState().sessions[1];
	assert.equal(remote.locality, "remote");
	assert.equal(remote.owner_device, "d_node");
	assert.equal(remote.owner_device_name, "cloud-node-1");
	assert.deepEqual(remote.status, { code: "idle", label: "Idle" });
	assert.equal(
		factOf("bbbbbbbbbbbb")?.locality,
		"remote",
		"the row is held by a fact, so a plain page cannot drop it",
	);
	assert.deepEqual(placementHeldIds(store.getState().placementFacts), [
		"bbbbbbbbbbbb",
	]);
});

test("a second answer refreshes the held row rather than duplicating it", () => {
	reset();
	const first = store.getState().beginAnswer();
	land([remoteRow("bbbbbbbbbbbb")], first);
	const second = store.getState().beginAnswer();
	land([remoteRow("bbbbbbbbbbbb", { title: "Renamed on the peer" })], second);
	assert.deepEqual(ids(), ["bbbbbbbbbbbb"], "one row, not two");
	assert.equal(store.getState().sessions[0].title, "Renamed on the peer");
});

test("a fact the answer speaks about settles to the wire's pair", () => {
	reset();
	store.setState({ sessions: [row("cccccccccccc")] });
	store.getState().settlePlacement("cccccccccccc", {
		locality: "remote",
		owner_device: "d_stale",
	});
	const stamp = store.getState().beginAnswer();
	land([remoteRow("cccccccccccc")], stamp);

	assert.equal(
		factOf("cccccccccccc")?.owner_device,
		"d_node",
		"the wire's own device replaced the stale pair",
	);
});

test("a fact written after the request started is left alone", () => {
	reset();
	store.setState({ sessions: [row("cccccccccccc")] });
	/*
	 * The request's own stamp first, THEN a write - which is exactly the create
	 * or move landing while the read is in flight: its fact is newer than the
	 * question and the answer must not undo it.
	 */
	const stamp = store.getState().beginAnswer();
	store.getState().settlePlacement("cccccccccccc", {
		locality: "remote",
		owner_device: "d_created",
	});
	land([localRow("cccccccccccc")], stamp);

	assert.equal(
		factOf("cccccccccccc")?.owner_device,
		"d_created",
		"the newer fact survives an answer whose question predates it",
	);
	assert.equal(factOf("cccccccccccc")?.locality, "remote");
});

test("an id that moved home stops wearing the mark in the same write", () => {
	reset();
	store.setState({ sessions: [row("dddddddddddd", { locality: "remote" })] });
	store.getState().settlePlacement("dddddddddddd", {
		locality: "remote",
		owner_device: "d_node",
	});
	const stamp = store.getState().beginAnswer();
	land([localRow("dddddddddddd")], stamp);

	assert.equal(
		store.getState().sessions[0].locality,
		"local",
		"the row merged the wire's own local pair",
	);
	assert.equal(factOf("dddddddddddd")?.locality, "local");
	assert.deepEqual(
		placementHeldIds(store.getState().placementFacts),
		[],
		"a local fact protects nothing, which is the drop rule",
	);
});

test("an owner that answered without the id drops the row", () => {
	reset();
	store.setState({
		sessions: [row("eeeeeeeeeeee", { locality: "remote" })],
	});
	store.getState().settlePlacement("eeeeeeeeeeee", {
		locality: "remote",
		owner_device: "d_node",
	});
	const stamp = store.getState().beginAnswer();
	/*
	 * The answer carries ANOTHER row from the same device and not this one: the
	 * device answered (its rows are only ever contributed by a reachable peer),
	 * so the absence is the owner's own statement that the conversation is gone.
	 */
	land([remoteRow("ffffffffffff")], stamp);

	assert.deepEqual(ids(), ["ffffffffffff"], "the deleted-on-peer row is gone");
	assert.equal(factOf("eeeeeeeeeeee"), undefined, "and its fact with it");
});

test("no prune against an owner that was silent", () => {
	reset();
	store.setState({
		sessions: [row("eeeeeeeeeeee", { locality: "remote" })],
	});
	store.getState().settlePlacement("eeeeeeeeeeee", {
		locality: "remote",
		owner_device: "d_node",
	});
	const stamp = store.getState().beginAnswer();
	/*
	 * A local row only: the relay contributes NO rows for a peer that did not
	 * answer, so this answer says nothing about `d_node` and the cached row
	 * stays - the switch-off case must not read as a deletion.
	 */
	land([localRow("aaaaaaaaaaaa")], stamp);

	assert.ok(
		ids().includes("eeeeeeeeeeee"),
		"a silent owner proves nothing about its rows",
	);
	assert.equal(factOf("eeeeeeeeeeee")?.locality, "remote");
});

test("an answer older than the fact never prunes it", () => {
	reset();
	store.setState({
		sessions: [
			row("eeeeeeeeeeee", { locality: "remote" }),
			row("ffffffffffff", { locality: "remote" }),
		],
	});
	const stale = store.getState().beginAnswer();
	store.getState().settlePlacement("eeeeeeeeeeee", {
		locality: "remote",
		owner_device: "d_node",
	});
	/*
	 * Now the answer whose question predates that write lands, carrying another
	 * `d_node` row and not this one: the fact is newer than the read, so the
	 * read's silence about the id is not evidence.
	 */
	land([remoteRow("ffffffffffff")], stale);
	assert.ok(
		ids().includes("eeeeeeeeeeee"),
		"a fact newer than the answer's request is never pruned",
	);
});

test("the normaliser carries the fields the sidebar's row reads", () => {
	const [remote] = meshTypes.sessionRows({
		sessions: [
			{
				id: "bbbbbbbbbbbb",
				name: "Remote: deployment notes",
				mtime: 1791223667.8,
				locality: "remote",
				owner_device: "d_node",
				owner_device_name: "cloud-node-1",
				reachable: false,
				unreachable_reason: "link down 4m ago",
				archived: false,
				pinned: false,
				created_at: 1791220000,
				status: { code: "approval", label: "Approval needed" },
				binding: { agent: null, team: "docs-pod" },
				opened_by: { agent: "coder", label: "Chat", session: "aaaa00000001" },
				subagents_running: 2,
				subagents_queued: null,
			},
		],
	});
	assert.equal(remote.locality, "remote");
	assert.equal(remote.reachable, false);
	assert.equal(remote.unreachable_reason, "link down 4m ago");
	assert.deepEqual(remote.status, {
		code: "approval",
		label: "Approval needed",
	});
	assert.deepEqual(remote.binding, { agent: null, team: "docs-pod" });
	assert.deepEqual(remote.opened_by, {
		agent: "coder",
		label: "Chat",
		session: "aaaa00000001",
	});
	assert.equal(remote.created_at, 1791220000);
	assert.equal(remote.subagents_running, 2);
	assert.equal(remote.subagents_queued, null);

	const canonical = meshTypes.toCatalogueRow(remote);
	assert.equal(canonical.session_id, "bbbbbbbbbbbb");
	assert.equal(canonical.title, "Remote: deployment notes");
	assert.equal(canonical.updated_at, 1791223667.8);
	assert.equal(canonical.locality, "remote");
	assert.deepEqual(canonical.status, remote.status);

	const sparse = meshTypes.sessionRows({
		sessions: [
			{
				id: "bbbbbbbbbbbb",
				name: "",
				mtime: 1,
				locality: "remote",
				status: "not-an-object",
			},
		],
	});
	assert.equal(
		"status" in sparse[0],
		false,
		"an object that did not arrive is omitted, not invented",
	);
	assert.equal("binding" in sparse[0], false);
});
