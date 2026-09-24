import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE PAGED CATALOGUE, driven through the shipped store and the shipped
 * decisions.
 *
 * WHAT THIS SUITE IS FOR, in one line: the operator's "no chats are showing up"
 * was two mechanisms (a whole-catalogue read refired on every catalogue frame,
 * and an empty sentence chosen by a count of the rows in hand), and both are
 * reachable again from a one-line change. So the assertions here are about
 * MEMBERSHIP (which rows an answer may replace), about the WIRE (what a request
 * carries, and what it must not carry against a daemon that cannot page), and
 * about the SENTENCES (the invariant that a group the census says holds chats can
 * never read "No chats yet").
 *
 * The transport is a fake backend that routes on `op` and on the paging
 * parameters, because the thing under test IS the request's shape: a fixture that
 * ignored the parameters could not tell a scoped read from an unscoped one, which
 * is the whole compatibility claim.
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

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store"; export {desktopRequestSchema, desktopEndpoint} from "./src/shared/desktop-contract"; export {desktopFeatureEnabled} from "./src/renderer/src/shared/api/local-operator/desktop-hooks"; export {groupChatsView, groupBadgeCount, scopeCensusTotal, catalogueTailView, tailExtendDue} from "./src/renderer/src/features/chat/sidebar-scope-paging";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "paged-catalogue-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "fixture" }),
				);
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents:
						"export const echoPendingUser = () => {};\nexport const retractPendingUser = () => {};\nexport const discardPendingEchoes = () => {};",
					loader: "js",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
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
	CATALOGUE_GROUP_PAGE,
	LEGACY_CATALOGUE_PAGE,
	catalogueScopeKey,
	catalogueCountsFrom,
	headHeldRows,
	headAnswerRows,
	scopeAnswerRows,
	replaceSessionRows,
	desktopRequestSchema,
	desktopEndpoint,
	groupChatsView,
	groupBadgeCount,
	scopeCensusTotal,
	catalogueTailView,
	tailExtendDue,
} = module;

const EMPTY_HEAD = {
	tailIds: [],
	nextCursor: null,
	complete: false,
	loading: false,
	error: null,
	at: 0,
};

function reset() {
	calls.length = 0;
	answer = async () => ({ sessions: [], truncated: false });
	store.setState({
		sessions: [],
		scopes: {},
		counts: null,
		head: { ...EMPTY_HEAD },
		pinFacts: {},
		archiveFacts: {},
		forgotten: {},
		loading: false,
		truncated: false,
		error: null,
		answerSeq: 0,
	});
}

/** A wire row, as `sessions.list` would send it. */
const wire = (id, over = {}) => ({ id, name: `Chat ${id}`, mtime: 1, ...over });

/** A catalogue row, as this store holds it. */
const row = (id, over = {}) => ({
	session_id: id,
	title: `Chat ${id}`,
	updated_at: 1,
	...over,
});

const ids = () => store.getState().sessions.map((item) => item.session_id);
const scopeOf = (kind, name) =>
	store.getState().scopes[catalogueScopeKey(kind, name)];

/*
 * ---------------------------------------------------------------------------
 * THE WIRE: what a paged request carries, and what the withdrawn one cannot.
 * ---------------------------------------------------------------------------
 */

test("the paging parameters are optional on the request, and unknown ones are refused", () => {
	const plain = desktopRequestSchema.safeParse({
		op: "sessions.list",
		limit: 500,
		include_archived: true,
	});
	assert.equal(plain.success, true, "today's request still parses");
	const scoped = desktopRequestSchema.safeParse({
		op: "sessions.list",
		limit: 25,
		scope_kind: "team",
		scope_name: "lopdev",
		cursor: "abc",
		with_counts: true,
	});
	assert.equal(scoped.success, true);
	for (const bad of [
		{ op: "sessions.list", scope_kind: "org", scope_name: "x" },
		{ op: "sessions.list", scope_name: "x".repeat(65) },
		{ op: "sessions.list", cursor: "x".repeat(257) },
	]) {
		assert.equal(
			desktopRequestSchema.safeParse(bad).success,
			false,
			`${JSON.stringify(bad)} is refused by name rather than at the route`,
		);
	}
});

test("a request that names none of the paging parameters serialises to today's bytes", () => {
	assert.equal(
		desktopEndpoint({
			op: "sessions.list",
			limit: LEGACY_CATALOGUE_PAGE,
			include_archived: true,
		}).path,
		"/v1/desktop/sessions?limit=500&include_archived=true",
	);
	assert.equal(
		desktopEndpoint({ op: "sessions.list" }).path,
		"/v1/desktop/sessions?limit=100",
		"the two parameters this request has always carried are first and unconditional",
	);
});

test("a scoped request names its scope and omits the flags it did not ask for", () => {
	const { path } = desktopEndpoint({
		op: "sessions.list",
		limit: 25,
		scope_kind: "team",
		scope_name: "op dev",
		cursor: "cur+1",
	});
	const url = new URL(`http://x${path}`);
	assert.equal(url.searchParams.get("scope_kind"), "team");
	assert.equal(url.searchParams.get("scope_name"), "op dev");
	assert.equal(url.searchParams.get("cursor"), "cur+1");
	assert.equal(
		url.searchParams.get("include_archived"),
		null,
		"a scope read does not ask for the archived set",
	);
	assert.equal(url.searchParams.get("with_counts"), null);
});

/*
 * ---------------------------------------------------------------------------
 * THE HEAD ANSWER: it paints, it replaces only what it owns, and it settles.
 * ---------------------------------------------------------------------------
 */

test("the head answer paints its rows immediately, and a tail never replaces them", async () => {
	reset();
	answer = async (request) =>
		request.cursor === undefined
			? {
					sessions: [wire("a"), wire("b")],
					truncated: true,
					next_cursor: "page2",
					counts: { total: 3, active: 1, unbound: 0, scopes: [] },
				}
			: { sessions: [wire("c")], truncated: false, next_cursor: null };

	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.deepEqual(
		ids(),
		["a", "b"],
		"the first page is on screen before any tail",
	);
	assert.equal(store.getState().counts.total, 3);
	assert.equal(store.getState().head.nextCursor, "page2");

	await store.getState().fetchCatalogueTail();
	assert.deepEqual(ids(), ["a", "b", "c"], "the tail appends");
	assert.equal(store.getState().head.nextCursor, null);
	assert.equal(store.getState().head.complete, true);
	assert.equal(calls[1].limit, CATALOGUE_HEAD_PAGE);
	assert.equal(calls[1].cursor, "page2");
});

test("a head refresh keeps the rows an extension fetched, and still drops the ones it denies", async () => {
	reset();
	answer = async (request) =>
		request.cursor === undefined
			? { sessions: [wire("a"), wire("b")], truncated: true, next_cursor: "p2" }
			: {
					sessions: [wire("c"), wire("d")],
					truncated: false,
					next_cursor: null,
				};
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	await store.getState().fetchCatalogueTail();
	assert.deepEqual(ids(), ["a", "b", "c", "d"]);

	// The 30 s poll re-reads the head. `b` has gone; `c`/`d` were fetched by rank
	// and the top-two answer says nothing about them. The answer still has a
	// cursor, so it is not a claim that the catalogue is complete.
	answer = async () => ({
		sessions: [wire("a")],
		truncated: true,
		next_cursor: "p2",
	});
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.deepEqual(
		ids().sort(),
		["a", "c", "d"],
		"the answer settles the top of the catalogue and leaves the tail alone",
	);
	assert.deepEqual(
		store.getState().head.tailIds.slice().sort(),
		["c", "d"],
		"the tail it did not carry is still the tail",
	);
});

test("an answer that says it is the whole catalogue discards the tail it denies", async () => {
	reset();
	answer = async (request) =>
		request.cursor === undefined
			? { sessions: [wire("a"), wire("b")], truncated: true, next_cursor: "p2" }
			: { sessions: [wire("c")], truncated: false, next_cursor: null };
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	await store.getState().fetchCatalogueTail();
	assert.deepEqual(ids(), ["a", "b", "c"]);
	// A `complete` answer (no cursor, nothing truncated) IS the catalogue, so the
	// rows an extension had fetched are either in it or gone.
	answer = async () => ({
		sessions: [wire("a")],
		truncated: false,
		next_cursor: null,
	});
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.deepEqual(
		ids(),
		["a"],
		"the tail is not held against a complete answer",
	);
	assert.deepEqual(store.getState().head.tailIds, []);
});

test("an answer that says it is the whole catalogue replaces membership outright", async () => {
	reset();
	store.setState({ sessions: [row("stale")] });
	answer = async () => ({
		sessions: [wire("a")],
		truncated: false,
		next_cursor: null,
	});
	await store.getState().fetchSessions(LEGACY_CATALOGUE_PAGE, false);
	assert.deepEqual(
		ids(),
		["a"],
		"with no cursor there is no tail, so this is the pre-paging rule exactly",
	);
});

test("headHeldRows is the guard that keeps a scope answer from deleting the list", () => {
	const sessions = [row("head"), row("team-row")];
	const owned = headHeldRows(sessions, new Set(["team-row"]));
	assert.deepEqual(
		owned.map((item) => item.session_id),
		["head"],
		"a scope's rows belong to the scope, and a head answer must not speak for them",
	);
	assert.equal(
		headHeldRows(sessions, new Set()).length,
		2,
		"with nothing expanded there is nothing to hold back",
	);
});

test("a scope answer appends and a head answer replaces only its own rows", async () => {
	reset();
	answer = async (request) =>
		request.scope_kind === "team"
			? { sessions: [wire("t1")], truncated: false, next_cursor: null }
			: { sessions: [wire("h1")], truncated: false, next_cursor: null };
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	await store.getState().fetchScopePage("team", "lopdev");

	const rows = store.getState().sessions;
	assert.deepEqual(
		ids(),
		["h1", "t1"],
		"the scope's row is in the one row store, after the head's",
	);
	assert.deepEqual(scopeOf("team", "lopdev").ids, ["t1"]);

	// A head refresh that carries neither row must not delete the scope's row.
	// (`h1` is denied by the answer; `t1` is not the answer's to deny.)
	answer = async () => ({
		sessions: [wire("h2")],
		truncated: false,
		next_cursor: null,
	});
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.deepEqual(
		ids().sort(),
		["h2", "t1"],
		"the expanded group's row survives the poll",
	);
	assert.equal(rows.length, 2);
});

test("the pure merge keeps a scope's rows out of a head answer's rewrite", () => {
	const merged = headAnswerRows({
		sessions: [row("head"), row("scoped")],
		scopeIds: new Set(["scoped"]),
		tailIds: [],
		page: [row("fresh")],
		merge: replaceSessionRows,
	});
	assert.deepEqual(
		merged.rows.map((item) => item.session_id),
		["fresh", "scoped"],
		"the head answer rewrites its own membership and keeps the scope's row",
	);
	// The same call with nothing scoped is the PRE-PAGING rule exactly, which is
	// what the withdrawn path relies on.
	const replaced = headAnswerRows({
		sessions: [row("head"), row("stale")],
		scopeIds: new Set(),
		tailIds: [],
		page: [row("fresh")],
		merge: replaceSessionRows,
	});
	assert.deepEqual(
		replaced.rows.map((item) => item.session_id),
		["fresh"],
		"with no scope and no tail, every row the page omits is gone",
	);
});

test("scopeAnswerRows unions, keeps the server's order, and collapses a re-sent id", () => {
	const first = scopeAnswerRows({
		sessions: [row("head")],
		previousIds: [],
		page: [row("b"), row("a")],
		merge: (current, incoming) => ({ ...current, ...incoming }),
	});
	assert.deepEqual(first.ids, ["b", "a"], "the order is the server's");
	assert.deepEqual(
		first.rows.map((item) => item.session_id),
		["head", "b", "a"],
		"rows the store did not hold are appended; nothing outside the scope is touched",
	);
	const second = scopeAnswerRows({
		sessions: first.rows,
		previousIds: first.ids,
		page: [row("b"), row("c")],
		merge: (current, incoming) => ({ ...current, ...incoming }),
	});
	assert.deepEqual(
		second.ids,
		["b", "a", "c"],
		"a re-sent row collapses rather than moving",
	);
	assert.deepEqual(
		second.rows.map((item) => item.session_id),
		["head", "b", "a", "c"],
	);
});

test("a scope's page is asked for its own rows, with archived rows left out", async () => {
	reset();
	answer = async () => ({
		sessions: [wire("t1")],
		truncated: true,
		next_cursor: "next",
	});
	await store.getState().fetchScopePage("team", "lopdev");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].scope_kind, "team");
	assert.equal(calls[0].scope_name, "lopdev");
	assert.equal(calls[0].limit, CATALOGUE_GROUP_PAGE);
	assert.equal(
		calls[0].include_archived,
		false,
		"only a head answer may settle archive facts, so a scope does not ask",
	);
	assert.equal(
		calls[0].cursor,
		undefined,
		"the first page sends no cursor at all rather than an empty one",
	);

	// Show more: the next page, from the scope's own cursor.
	await store
		.getState()
		.fetchScopePage("team", "lopdev", scopeOf("team", "lopdev").nextCursor);
	assert.equal(calls[1].cursor, "next");
	assert.deepEqual(scopeOf("team", "lopdev").ids, ["t1"]);
});

test("an unusable cursor is answered as the scope's first page, not appended to it", async () => {
	reset();
	answer = async (request) =>
		request.cursor === undefined
			? { sessions: [wire("b"), wire("a")], truncated: true, next_cursor: "c1" }
			: {
					sessions: [wire("b"), wire("a")],
					truncated: true,
					next_cursor: "c1",
					cursor_missing: true,
				};
	await store.getState().fetchScopePage("team", "lopdev");
	await store.getState().fetchScopePage("team", "lopdev", "c1");
	assert.deepEqual(
		scopeOf("team", "lopdev").ids,
		["b", "a"],
		"a cursor the daemon could not use is a RE-READ of the first page, not an extension of it",
	);
	assert.equal(scopeOf("team", "lopdev").nextCursor, "c1");
});

test("a group's page is a single flight, and a superseded one is dropped", async () => {
	reset();
	const pending = [];
	answer = () =>
		new Promise((resolve) => {
			pending.push(resolve);
		});
	const first = store.getState().fetchScopePage("team", "lopdev");
	assert.equal(calls.length, 1);
	// A double press on the disclosure cannot issue a second read.
	void store.getState().fetchScopePage("team", "lopdev");
	assert.equal(
		calls.length,
		1,
		"a group's read is single-flight while one is in the air",
	);
	pending[0]({ sessions: [wire("t1")], truncated: false, next_cursor: null });
	await first;
	assert.deepEqual(scopeOf("team", "lopdev").ids, ["t1"]);

	// A collapse clears the page, so the next expansion reads the scope's top.
	store.getState().clearScope("team", "lopdev");
	assert.equal(scopeOf("team", "lopdev"), undefined);
	assert.deepEqual(
		ids(),
		["t1"],
		"clearing membership does not remove the row from the one row store",
	);
});

test("a failed group read keeps its rows and reports its own failure", async () => {
	reset();
	answer = async (request) => {
		if (request.cursor !== undefined) throw new Error("boom");
		return { sessions: [wire("t1")], truncated: true, next_cursor: "c1" };
	};
	await store.getState().fetchScopePage("team", "lopdev");
	await store.getState().fetchScopePage("team", "lopdev", "c1");
	const scope = scopeOf("team", "lopdev");
	assert.deepEqual(scope.ids, ["t1"], "the page that arrived is not retracted");
	assert.equal(scope.loading, false);
	assert.ok(scope.error, "the failure is stated beside the rows");
	assert.equal(
		store.getState().error,
		null,
		"a group's failure is not the store's failure: it must not raise the sidebar's alert",
	);
});

test("a head answer carries the census and does not overwrite it when it is silent", async () => {
	reset();
	answer = async (request) => ({
		sessions: [wire("a")],
		truncated: false,
		next_cursor: null,
		...(request.with_counts
			? {
					counts: {
						total: 757,
						active: 38,
						unbound: 0,
						scopes: [{ kind: "team", name: "lopdev", total: 434, active: 2 }],
					},
				}
			: {}),
	});
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.equal(store.getState().counts.total, 757);
	assert.equal(
		scopeCensusTotal(store.getState().counts, "team", "lopdev"),
		434,
	);
	assert.equal(
		scopeCensusTotal(store.getState().counts, "team", "other"),
		null,
		"an unknown scope falls back to the rows the client holds",
	);

	await store.getState().fetchSessions(LEGACY_CATALOGUE_PAGE, false);
	assert.equal(
		store.getState().counts.total,
		757,
		"a page that did not ask for a census does not deny the one it has",
	);
	assert.equal(calls[1].with_counts, undefined);
});

test("a census that half-parses is refused rather than painted", () => {
	assert.equal(catalogueCountsFrom(null), null);
	assert.equal(catalogueCountsFrom({ total: 1 }), null);
	assert.equal(
		catalogueCountsFrom({
			total: 1,
			active: 0,
			unbound: 0,
			scopes: [{ kind: "org", name: "x", total: 1, active: 0 }],
		}).scopes.length,
		0,
		"a census for an axis this client cannot draw is dropped, not stored",
	);
	assert.equal(
		catalogueCountsFrom({
			total: Number.NaN,
			active: 0,
			unbound: 0,
			scopes: [],
		}),
		null,
		"a non-number is not a count",
	);
});

/*
 * ---------------------------------------------------------------------------
 * THE WITHDRAWN PATH: a daemon that cannot page gets today's request, once.
 * ---------------------------------------------------------------------------
 */

test("without the capability the panel asks for the whole catalogue and no paging parameter", async () => {
	reset();
	answer = async () => ({
		sessions: [wire("a"), wire("b"), wire("c")],
		truncated: false,
	});
	// Exactly what the sidebar's refresh does when `session_catalogue_page` is
	// absent - the page size and the census flag are the SAME decision.
	await store.getState().fetchSessions(LEGACY_CATALOGUE_PAGE, false);
	assert.equal(calls.length, 1, "one read, not one per page");
	assert.equal(calls[0].limit, LEGACY_CATALOGUE_PAGE);
	for (const key of ["scope_kind", "scope_name", "cursor", "with_counts"]) {
		assert.equal(
			calls[0][key],
			undefined,
			`a daemon without the capability never sees \`${key}\``,
		);
	}
	assert.equal(
		desktopEndpoint(calls[0]).path,
		"/v1/desktop/sessions?limit=500&include_archived=true",
		"byte-identical to the request this app has always sent",
	);
	assert.equal(
		store.getState().head.nextCursor,
		null,
		"a daemon that cannot page returns no cursor, so no tail affordance exists",
	);
	assert.equal(
		store.getState().head.complete,
		true,
		"an untruncated answer with no cursor IS the whole catalogue",
	);
});

test("a truncated answer with no cursor is not a catalogue that has been paged through", async () => {
	reset();
	// A daemon that cannot page can still truncate: 500 rows of 757, with no
	// cursor, because it has none to give. Reading that as `complete` would let a
	// surface promise "that is everything" about a page it only knows the size of.
	answer = async () => ({ sessions: [wire("a")], truncated: true });
	await store.getState().fetchSessions(LEGACY_CATALOGUE_PAGE, false);
	assert.equal(store.getState().head.complete, false);
	assert.equal(store.getState().head.nextCursor, null);
});

test("the capability is what decides the page size, and it fails closed", async () => {
	const { desktopFeatureEnabled } = module;
	const paired = { desktop_available: true };
	assert.equal(
		desktopFeatureEnabled(
			{ ...paired, features: { session_catalogue_page: 1 } },
			"session_catalogue_page",
		),
		true,
	);
	assert.equal(
		desktopFeatureEnabled(
			{ ...paired, features: { session_catalogue: 3 } },
			"session_catalogue_page",
		),
		false,
		"a catalogue answer without the new key is a daemon that cannot page",
	);
	// The key is its own negotiation: an absent entry is a daemon that cannot page,
	// not a default that happens to be on.
	assert.equal(
		desktopFeatureEnabled(paired, "session_catalogue_page"),
		false,
		"an absent key is false, not a default",
	);
	assert.equal(desktopFeatureEnabled(null, "session_catalogue_page"), false);
});

test("the head page is larger than the active population, per the design's decision", () => {
	assert.ok(
		CATALOGUE_HEAD_PAGE >= 40,
		"`Active chats` is drawn from the rows held, so a full head page must outrun it",
	);
	assert.ok(CATALOGUE_GROUP_PAGE < CATALOGUE_HEAD_PAGE);
});

/*
 * ---------------------------------------------------------------------------
 * THE SENTENCES: the invariant the operator's screenshot is a counterexample to.
 * ---------------------------------------------------------------------------
 */

test("a group the census says holds chats never reads as empty", () => {
	const loading = groupChatsView({
		pageable: true,
		scope: undefined,
		held: 0,
		total: 434,
	});
	assert.equal(loading.state, "loading");
	assert.equal(loading.forbidden, true);
	assert.notEqual(
		loading.sentence,
		"No chats yet",
		"a page that has not arrived is not a group with no chats",
	);

	const emptyPage = groupChatsView({
		pageable: true,
		scope: { ids: [], nextCursor: null, loading: false, error: null, at: 1 },
		held: 0,
		total: 434,
	});
	assert.equal(emptyPage.state, "loading");
	assert.equal(emptyPage.forbidden, true);
	assert.notEqual(emptyPage.sentence, "No chats yet");

	// The group really is empty: the census agrees.
	const empty = groupChatsView({
		pageable: true,
		scope: { ids: [], nextCursor: null, loading: false, error: null, at: 1 },
		held: 0,
		total: 0,
	});
	assert.equal(empty.state, "empty");
	assert.equal(empty.sentence, "No chats yet");
	assert.equal(empty.forbidden, false);
});

/*
 * A FAILED READ OUTRANKS THE CENSUS'S "NOT CAUGHT UP" GUESS, and the order is the
 * rule rather than the shape of the code: this was found by the evidence rig
 * (`sidebar-lazy-chats`, `--scoped-case error`) rendering "Loading chats…" for a
 * group whose read had permanently failed - a sentence a reader waits on rather
 * than acts on, with no Retry anywhere on the row.
 */
test("a group whose read failed says so, even while the census says it holds chats", () => {
	const view = groupChatsView({
		pageable: true,
		scope: {
			ids: [],
			nextCursor: null,
			loading: false,
			error: "The stub was asked to refuse scoped reads.",
			at: 1,
		},
		held: 0,
		total: 70,
	});
	assert.equal(view.state, "error");
	assert.equal(view.sentence, "The stub was asked to refuse scoped reads.");
	assert.equal(
		view.retry,
		true,
		"a failure the reader can act on offers the act",
	);
});

test("an expanded group with rows offers its tail only when the daemon said so", () => {
	const partial = groupChatsView({
		pageable: true,
		scope: { ids: ["a"], nextCursor: "c1", loading: false, error: null, at: 1 },
		held: 1,
		total: 434,
	});
	assert.equal(partial.state, "rows");
	assert.equal(partial.more, true);
	const exhausted = groupChatsView({
		pageable: true,
		scope: { ids: ["a"], nextCursor: null, loading: false, error: null, at: 1 },
		held: 1,
		total: 1,
	});
	assert.equal(
		exhausted.more,
		false,
		"the cursor is the only thing that can say a page has a next row",
	);

	const failed = groupChatsView({
		pageable: true,
		scope: { ids: ["a"], nextCursor: "c1", loading: false, error: "no", at: 1 },
		held: 1,
		total: 434,
	});
	assert.equal(
		failed.state,
		"rows",
		"a failed extension does not withdraw the rows",
	);
	assert.equal(failed.retry, true);
	assert.equal(failed.sentence, "no");
});

test("a withdrawn capability renders a group exactly as today", () => {
	const empty = groupChatsView({
		pageable: false,
		scope: undefined,
		held: 0,
		total: null,
	});
	assert.deepEqual(empty, {
		state: "empty",
		sentence: "No chats yet",
		retry: false,
		more: false,
		forbidden: false,
	});
	const held = groupChatsView({
		pageable: false,
		scope: undefined,
		held: 3,
		total: null,
	});
	assert.equal(held.state, "rows");
	assert.equal(held.sentence, null);
	assert.equal(
		held.forbidden,
		false,
		"the invariant is a property of the census, which this backend cannot send",
	);
});

test("a group's badge is the census, and the held rows when a search is in force", () => {
	assert.equal(
		groupBadgeCount({ pageable: true, total: 434, held: 25, searching: false }),
		434,
		"lopdev shows 434, not the 283 a 500-row page happened to carry",
	);
	assert.equal(
		groupBadgeCount({ pageable: true, total: 434, held: 4, searching: true }),
		4,
		"under a query the group draws the matches, so the number must count them",
	);
	assert.equal(
		groupBadgeCount({
			pageable: true,
			total: null,
			held: 25,
			searching: false,
		}),
		25,
		"no census is today's badge",
	);
	assert.equal(
		groupBadgeCount({
			pageable: false,
			total: 434,
			held: 25,
			searching: false,
		}),
		25,
		"a daemon that cannot count is never asked to",
	);
});

/*
 * ---------------------------------------------------------------------------
 * THE TAIL: when the flat list may extend itself.
 * ---------------------------------------------------------------------------
 */

test("the tail extends within one screen of the bottom and nowhere else", () => {
	const base = {
		pageable: true,
		nextCursor: "c1",
		loading: false,
		error: null,
		scrollTop: 0,
		clientHeight: 400,
		scrollHeight: 2000,
	};
	assert.equal(tailExtendDue(base), false, "near the top, nothing is fetched");
	assert.equal(
		tailExtendDue({ ...base, scrollTop: 1200 }),
		true,
		"within a screen of the bottom",
	);
	assert.equal(
		tailExtendDue({ ...base, scrollTop: 1200, loading: true }),
		false,
		"single flight",
	);
	assert.equal(
		tailExtendDue({ ...base, scrollTop: 1200, nextCursor: null }),
		false,
		"the end of the catalogue is not an extension",
	);
	assert.equal(
		tailExtendDue({ ...base, scrollTop: 1200, error: "no" }),
		false,
		"a failure is not retried by a scroll",
	);
	assert.equal(
		tailExtendDue({ ...base, pageable: false }),
		false,
		"a daemon that cannot page has no tail",
	);
});

test("a region that cannot scroll is filled rather than left one page deep", () => {
	assert.equal(
		tailExtendDue({
			pageable: true,
			nextCursor: "c1",
			loading: false,
			error: null,
			scrollTop: 0,
			clientHeight: 900,
			scrollHeight: 300,
		}),
		true,
		"no scroll event can ever arrive, so waiting for one would strand the rows",
	);
});

test("the tail draws a wait and a failure, and no steady-state press", () => {
	assert.deepEqual(
		catalogueTailView({
			pageable: true,
			nextCursor: "c1",
			loading: false,
			error: null,
		}),
		{ kind: "none" },
		"the extension is driven by scroll position, not by a button",
	);
	assert.deepEqual(
		catalogueTailView({
			pageable: true,
			nextCursor: "c1",
			loading: true,
			error: null,
		}),
		{ kind: "loading" },
	);
	assert.deepEqual(
		catalogueTailView({
			pageable: true,
			nextCursor: "c1",
			loading: false,
			error: "Could not load more chats.",
		}),
		{ kind: "error", sentence: "Could not load more chats.", retry: true },
	);
	assert.deepEqual(
		catalogueTailView({
			pageable: false,
			nextCursor: null,
			loading: false,
			error: null,
		}),
		{ kind: "none" },
		"the withdrawn path keeps today's `Showing up to 500 chats` sentence",
	);
});

/*
 * ---------------------------------------------------------------------------
 * THE FACTS: only the head answer may settle them.
 * ---------------------------------------------------------------------------
 */

test("a scope answer settles neither the pin nor the archive facts", async () => {
	reset();
	// A pin this window made, and an archive it made, both stamped after nothing
	// has been read.
	store.setState({
		answerSeq: 4,
		pinFacts: { p1: { pinned: true, at: 5, title: "Pinned" } },
		archiveFacts: { a1: { archived: true, at: 5, answered: true } },
	});
	answer = async () => ({
		sessions: [wire("t1")],
		truncated: false,
		next_cursor: null,
	});
	await store.getState().fetchScopePage("team", "lopdev");
	assert.ok(
		store.getState().pinFacts.p1,
		"a scope answer speaks about its scope, so it cannot erase a pin made elsewhere",
	);
	assert.ok(
		store.getState().archiveFacts.a1,
		"and it cannot settle the archived set, which only the head page speaks for",
	);
});

test("a head answer newer than a pin settles it, exactly as before", async () => {
	reset();
	// `fetchSessions` takes `answerSeq + 1`, so a fact stamped BELOW the request
	// that reads it is the one a page supersedes. The other half of the rule - a
	// fact written after the request survives it - is `canonical-chat.test.mjs`'s.
	store.setState({
		answerSeq: 3,
		pinFacts: { p1: { pinned: true, at: 2, title: "Pinned" } },
	});
	answer = async () => ({
		sessions: [wire("a")],
		truncated: false,
		next_cursor: null,
	});
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	assert.equal(
		store.getState().pinFacts.p1,
		undefined,
		"the head page speaks for the pinned set as a whole",
	);
});

test("a tombstone survives a scope answer that does not carry its id", async () => {
	reset();
	store.setState({ forgotten: { gone: { at: 1, title: "Gone" } } });
	answer = async () => ({
		sessions: [wire("gone"), wire("t1")],
		truncated: false,
		next_cursor: null,
	});
	await store.getState().fetchScopePage("team", "lopdev");
	assert.equal(
		ids().includes("gone"),
		false,
		"a page that carries a permanently deleted id does not bring it back",
	);
	assert.ok(
		store.getState().forgotten.gone,
		"absence is not a claim, so the tombstone stays",
	);
});

/*
 * ---------------------------------------------------------------------------
 * THE ARCHIVED SET IS THE HEAD ANSWER'S, and a group's page leaves it out.
 * ---------------------------------------------------------------------------
 */

test("a scope request leaves the archived set out, and the head request asks for it", async () => {
	reset();
	answer = async () => ({ sessions: [], truncated: false });
	await store.getState().fetchSessions(CATALOGUE_HEAD_PAGE, true);
	await store.getState().fetchScopePage("team", "lopdev");
	assert.equal(
		calls[0].include_archived,
		true,
		"the head page speaks for the archived set as a whole, so it has to ask for it",
	);
	assert.equal(
		calls[1].include_archived,
		false,
		"a scope page's archived rows would be bytes the group rendering throws away, and they must not reach a fact-settling read",
	);
});

/*
 * THE EXTENSION AGAINST A CONCURRENT HEAD POLL.
 *
 * A live app polls the head every 30 s AND on every `catalogue` feed frame, so an
 * extension is very likely to have a head answer land between its request and its
 * answer. This pins that the extension still lands: the trace below is the shape
 * the evidence rig produced (`sidebar-lazy-chats`, `--scoped-case paged`) when the
 * tail press grew the store by nothing.
 */
test("a head answer landing mid-extension does not discard the extension", async () => {
	reset();
	const parked = [];
	answer = (request) =>
		new Promise((resolve) => parked.push({ request, resolve }));
	const settle = () => new Promise((done) => setTimeout(done, 0));

	const first = store.getState().fetchScopePage("team", "lopdev", null);
	await settle();
	for (const entry of parked) {
		if (entry.request.scope_kind !== "team") continue;
		entry.resolve({
			sessions: [wire("t1")],
			truncated: true,
			next_cursor: "off:1",
			cursor_missing: false,
		});
	}
	await first;
	assert.deepEqual(scopeOf("team", "lopdev").ids, ["t1"]);

	const extension = store.getState().fetchScopePage("team", "lopdev", "off:1");
	await settle();
	const head = store.getState().fetchSessions(50, true);
	await settle();
	for (const entry of parked) {
		if (entry.request.scope_kind !== undefined) continue;
		if (entry.request.limit !== 50) continue;
		entry.resolve({
			sessions: [wire("h1")],
			truncated: true,
			next_cursor: "off:1",
			counts: { total: 9, active: 0, unbound: 8, scopes: [] },
		});
	}
	await head;
	for (const entry of parked) {
		if (entry.request.cursor !== "off:1") continue;
		entry.resolve({
			sessions: [wire("t2"), wire("t3")],
			truncated: false,
			next_cursor: null,
			cursor_missing: false,
		});
	}
	await extension;
	assert.deepEqual(
		scopeOf("team", "lopdev").ids.slice().sort(),
		["t1", "t2", "t3"],
		"the extension's rows are the scope's, whatever landed in between",
	);
	assert.deepEqual(
		ids().slice().sort(),
		["h1", "t1", "t2", "t3"],
		"and they are in the one row store beside the head answer's",
	);
});
