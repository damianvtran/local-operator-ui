import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The bulk read receipt: `attention.seen`, from the renderer's op to the marks
 * it clears.
 *
 * Why this file exists. "Mark all as read" is the first operation in this app
 * that can acknowledge MANY completions at once, and it is IRREVERSIBLE —
 * nothing in the store withdraws a receipt, so every way it can be wrong is
 * permanent for the user. Four properties hold it up, and each one is asserted
 * here because each fails silently on its own:
 *
 *   1. THE WIRE SHAPE. One POST to `/v1/desktop/attention/seen` carrying
 *      snake_case items in the order they were enumerated, and a body the
 *      backend's own schema accepts — 1..500 items, real uuids, no extra key.
 *      A batch that is refused at the schema is a click that did nothing.
 *   2. THE SET. `markAllRead` sends exactly the store's rows that DRAW an
 *      outstanding completion mark (`unreadMarkKind`: `unseen` plus a
 *      `complete`/`error`/`interrupted` status code) AND carry a
 *      `completion_token`. A row without a token names no completion, a row
 *      already read has nothing to acknowledge, and a row whose live state has
 *      taken it over (busy, wedged, a parked gate) draws its own glyph rather
 *      than the mark — sending any of the three inflates the batch and puts a
 *      number in the receipt that no row's story explains. Zero such rows sends
 *      NO REQUEST — not an empty one.
 *   3. THE ANSWER IS THE ONLY WRITE. `superseded` and `unknown` rows keep their
 *      marks, nothing is cleared optimistically while the request is in flight,
 *      and a refusal leaves the store byte-identical. This is the property that
 *      makes a failed request safe: there is nothing to roll back.
 *   4. THE FOREGROUND GATE COVERS THE NEW OP. Main refuses a read receipt from a
 *      window the user cannot see, and the bulk op is a read receipt: without it
 *      named there, a hidden window could clear a pile of marks nobody looked
 *      at. It is matched by NAME, so this is asserted against the shipped
 *      function rather than argued from the single-op case beside it.
 *
 * What is faked: the network (`desktopResult`), `electron`, and the store's
 * transcript-echo seam — the same three fixtures the neighbouring store and
 * transport tests use. Everything asserted is the shipped module.
 *
 * What this file is NOT: evidence that the control appears, reads correctly, or
 * that the rows repaint. Those are claims about pixels, and they are answered by
 * the frames under `docs/evidence/` driven through the real sidebar.
 */

/* ------------------------------------------------------------- contract */

const contractBundle = await build({
	stdin: {
		contents: 'export * from "./src/shared/desktop-contract";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	desktopEndpoint,
	desktopRequestSchema,
	DESKTOP_FOREGROUND_REQUIRED_CODE,
	DESKTOP_FOREGROUND_REQUIRED_MESSAGE,
} = await import(
	`data:text/javascript;base64,${Buffer.from(contractBundle.outputFiles[0].text).toString("base64")}`
);

const SESSION = "2d5ad5da0025";
const OTHER = "e059761608ae";
const TOKEN = "9f2c4a1e-6b3d-4c8a-9f10-1a2b3c4d5e6f";
const LATER_TOKEN = "7b1d0f3a-1111-4222-8333-444455556666";

const item = (sessionId = SESSION, completionToken = TOKEN) => ({
	sessionId,
	completionToken,
});

test("the batch is one POST, with the items in the order they were sent", () => {
	const request = { op: "attention.seen", items: [item(), item(OTHER)] };
	assert.deepEqual(desktopEndpoint(request), {
		path: "/v1/desktop/attention/seen",
		method: "POST",
		body: {
			items: [
				{ session_id: SESSION, completion_token: TOKEN },
				{ session_id: OTHER, completion_token: TOKEN },
			],
		},
	});
	/*
	 * The path carries no `{session_id}` by design: the batch spans sessions, and
	 * `/v1/desktop/attention/seen` cannot be shadowed by the per-session
	 * `POST /v1/desktop/sessions/{id}/seen` at any registration order. Asserted
	 * rather than assumed, because that is the whole reason for the shape.
	 */
	assert.equal(desktopEndpoint(request).path.includes(SESSION), false);
});

test("the schema admits one item and 500, and refuses 0, 501 and anything malformed", () => {
	const parse = (request) => desktopRequestSchema.safeParse(request);
	const many = (count) =>
		Array.from({ length: count }, (_, index) =>
			item(index.toString(16).padStart(12, "0")),
		);

	// The bound is the catalogue's own maximum page, so every row the sidebar can
	// hold is sendable in one call and `markAllRead` never chunks a gesture.
	assert.equal(
		parse({ op: "attention.seen", items: many(1) }).success,
		true,
		"a single item is a legal batch",
	);
	assert.equal(
		parse({ op: "attention.seen", items: many(500) }).success,
		true,
		"500 items is the cap, and is legal",
	);
	assert.equal(
		parse({ op: "attention.seen", items: many(501) }).success,
		false,
		"501 items is over the cap",
	);
	assert.equal(
		parse({ op: "attention.seen", items: [] }).success,
		false,
		"an empty batch is not a batch",
	);
	// A token that is not a uuid cannot name a completion, and a session id that
	// is not the 12-hex shape is not a session this app can hold; both are refused
	// here rather than round-tripped to answer `unknown` for an item the client
	// should never have sent.
	assert.equal(
		parse({ op: "attention.seen", items: [item(SESSION, "not-a-uuid")] })
			.success,
		false,
		"a token that is not a uuid is refused before any HTTP",
	);
	assert.equal(
		parse({ op: "attention.seen", items: [item("../config")] }).success,
		false,
		"a session id shaped like a path is refused before any HTTP",
	);
	/*
	 * An extra field INSIDE an item is refused, which is the tightening agent review
	 * round 1 (R5) asked for: the arm's outer object was `.strict()` and the item was
	 * not, so an item carrying a third field was silently stripped here while the
	 * sibling repository's `extra="forbid"` model would have answered 422 for it. The
	 * two surfaces refuse the same now, and `desktopEndpoint` — asserted below —
	 * emits exactly `session_id` and `completion_token` for the items that ARE
	 * accepted.
	 */
	assert.equal(
		parse({
			op: "attention.seen",
			items: [{ ...item(), seenAt: 123 }],
		}).success,
		false,
		"an extra field on an item is refused rather than dropped",
	);
	assert.deepEqual(
		desktopEndpoint({ op: "attention.seen", items: [item()] }).body,
		{ items: [{ session_id: SESSION, completion_token: TOKEN }] },
		"the encoder emits the two modelled keys and nothing else",
	);
});

/* ----------------------------------------------------------------- store */

// The store's persistence needs a `localStorage`, and `desktopResult` is the
// network: the same two fixtures `session-status-feed.test.mjs` uses.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
let requests = [];
/**
 * Serve one receipt, and start a fresh request log.
 *
 * Assigned per test rather than once, because the interesting cases are what the
 * store does with a PARTICULAR answer — a partial one, a rejection, one that
 * never resolves — so a fixture left over from the previous test would make the
 * order the tests happen to run in part of what they assert. Each test sets it
 * through `serve` below.
 */
const serve = (receipt) => {
	requests = [];
	globalThis.__attentionRequest = async (request) => {
		requests.push(request);
		return receipt;
	};
};
globalThis.__attentionRequest = async () => ({
	read: [],
	superseded: [],
	unknown: [],
});

const storeBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";' +
			' export * from "./src/renderer/src/features/chat/mark-all-read";',
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
			name: "attention-seen-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "attention-seen-fixture" }),
				);
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "attention-seen-fixture" }),
				);
				// Only `desktopResult` is faked — it is the network. The error
				// classes are the real ones, because the store's error-copy rules
				// depend on their actual behaviour.
				builder.onLoad(
					{ filter: /.*/, namespace: "attention-seen-fixture" },
					(args) => ({
						contents: {
							transport: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
								`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
							)}
export const desktopResult = request => globalThis.__attentionRequest(request);`,
							echo: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
						}[args.path],
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});
const storeModule = await import(
	`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString("base64")}`
);
const { useCanonicalSessionsStore: store } = storeModule;
const {
	unreadAckableCount,
	unreadAckableRows,
	unreadMarkKind,
	markAllReadCopy,
} = storeModule;

/** One unread completion, as a catalogue row carries it. */
const unread = (sessionId, over = {}) => ({
	conversation_id: `session/${sessionId}`,
	completion_token: TOKEN,
	anchor_id: "result-1",
	kind: "complete",
	unseen: true,
	revision: [4, 3],
	supported: true,
	...over,
});

/**
 * The derived status pair of a finished turn that has not been read: what the
 * runtime publishes on `status` for a row whose completion mark stands
 * (`CatalogEntry.status_code`).
 */
const COMPLETE = { code: "complete", label: "Unseen completion" };

/**
 * The other derived pairs a catalogue row can carry, spelled the way
 * `CatalogEntry.status_code` publishes them: live state and a parked gate each
 * outrank an unread completion, so those rows never carry `complete`.
 */
const BUSY = { code: "busy", label: "Working" };
const WEDGED = { code: "wedged", label: "Not answering · process alive" };
const APPROVAL = { code: "approval", label: "Approval needed" };
const ANSWER = { code: "answer", label: "Answer needed" };

/**
 * One row as `sessions.list` sends it: the runtime's derived `status` pair BESIDE
 * the attention state, because those two are what the surface reads together.
 *
 * The pair is not decoration, and a fixture that leaves it off is not a row the
 * backend can produce. `status.code` is the runtime's own precedence: it
 * publishes `complete`/`error`/`interrupted` only where
 * `CatalogEntry.shows_completion_mark` holds, and `busy`, `wedged`, `approval`
 * or `answer` where live state outranks the mark. `unreadMarkKind` reads exactly
 * that, so a roster that omits it would be testing the predicate against a wire
 * the app cannot see — and would pass whatever the predicate did with an absent
 * code.
 */
const completeRow = (sessionId, over = {}) => ({
	session_id: sessionId,
	status: COMPLETE,
	attention: unread(sessionId),
	...over,
});

/** Seed the store's rows, as a catalogue read would have left them. */
const seed = (rows) => {
	store.setState({ sessions: rows });
	requests = [];
};
const rowFor = (sessionId) =>
	store.getState().sessions.find((row) => row.session_id === sessionId);

test("the batch is exactly the rows carrying an unseen completion with a token", async () => {
	seed([
		completeRow(SESSION, { title: "Reconcile" }),
		completeRow(OTHER, {
			title: "Quarterly",
			attention: unread(OTHER, {
				unseen: false,
				revision: [4, 4],
			}),
		}),
		completeRow("222222222222", {
			title: "Read but no token",
			attention: unread("222222222222", { completion_token: null }),
		}),
		/*
		 * The status pair is present and the mark is: this row is excluded for the
		 * ABSENCE of attention alone, which is what the case names.
		 */
		{
			session_id: "333333333333",
			title: "No attention at all",
			status: COMPLETE,
		},
	]);
	serve({ read: [], superseded: [], unknown: [] });
	await store.getState().markAllRead();
	assert.equal(requests.length, 1, "exactly one request for one gesture");
	assert.deepEqual(requests[0], {
		op: "attention.seen",
		items: [{ sessionId: SESSION, completionToken: TOKEN }],
	});
});

test("the label's number is the set the request sends, from one predicate", async () => {
	/*
	 * Agent review round 1 (R1): DESIGN §3.3 pins that "the count the control shows
	 * and the set `markAllRead` sends are the same fact", and the way that stops
	 * being true is two hand-written literals — one in the surface, one in the
	 * action. The predicate now has ONE home and both halves call it, so this
	 * asserts the invariant end to end on a roster that exercises all three
	 * exclusions at once: an ackable row, a row already read, and an unseen row
	 * that carries no token (which names no completion and so is neither counted
	 * nor sent).
	 */
	const rows = [
		completeRow(SESSION, { title: "Unread" }),
		completeRow(OTHER, {
			title: "Read",
			attention: unread(OTHER, { unseen: false }),
		}),
		completeRow("333333333333", {
			title: "No token",
			attention: unread("333333333333", { completion_token: null }),
		}),
	];
	seed(rows);
	serve({ read: [], superseded: [], unknown: [] });
	const copy = markAllReadCopy(rows);
	assert.equal(
		copy.count,
		unreadAckableCount(rows),
		"the label's number is the predicate's count",
	);
	assert.equal(copy.count, 1);
	await store.getState().markAllRead();
	assert.deepEqual(
		requests[0].items.map((entry) => entry.sessionId),
		unreadAckableRows(rows).map((row) => row.session_id),
		"the request carries exactly the rows that predicate returns",
	);
});

/**
 * Every row of the roster below carries the mark-bearing ATTENTION state
 * (`unseen` plus a token), which is what the count used to read — so each one
 * here was counted under the control before `unreadMarkKind`.
 *
 * The roster is one the backend can actually produce, because the exclusion is
 * not this client's opinion: `CatalogEntry.status_code` publishes `busy`,
 * `wedged`, `approval` or `answer` wherever live state or a parked gate
 * outranks an unread completion, and publishes `complete`/`error`/
 * `interrupted` only where `shows_completion_mark` holds. The last two rows are
 * the whitelist's own edges rather than wire states: a code this build does not
 * know, and the ABSENT pair a locally created row carries until its first
 * catalogue read. `unseen` is a LEVEL, so it survives a session being resumed
 * (nothing but an acknowledgement clears it) — which is exactly how a row that
 * finished a turn and started another came to be counted under a spinner.
 */
const MARK_ROSTER = [
	["busy-unseen", BUSY, {}],
	["wedged-unseen", WEDGED, {}],
	["approval-unseen", APPROVAL, {}],
	["answer-unseen", ANSWER, {}],
	["unknown-code-unseen", { code: "sideways", label: "?" }, {}],
	["no-status-unseen", undefined, {}],
	["complete-unseen", COMPLETE, { kind: "complete" }],
	["error-unseen", { code: "error", label: "Unseen error" }, { kind: "error" }],
	[
		"interrupted-unseen",
		{ code: "interrupted", label: "Unseen interruption" },
		{ kind: "interrupted" },
	],
	["complete-read", COMPLETE, { unseen: false }],
	["complete-tokenless", COMPLETE, { completion_token: null }],
];

const markRoster = () =>
	MARK_ROSTER.map(([id, status, attention]) =>
		completeRow(id, {
			title: id,
			...(status ? { status } : { status: undefined }),
			attention: unread(id, attention),
		}),
	);

test("the count is the rows DRAWING a mark, not the rows carrying `unseen`", async () => {
	const rows = markRoster();
	const kind = (id) =>
		unreadMarkKind(rows.find((row) => row.session_id === id));

	// The four the runtime outranks, and the two it cannot vouch for: no mark.
	for (const id of [
		"busy-unseen",
		"wedged-unseen",
		"approval-unseen",
		"answer-unseen",
		"unknown-code-unseen",
		"no-status-unseen",
	])
		assert.equal(kind(id), null, `${id} must draw no mark`);

	// The marks: a completion, and the two failures the operator counts as
	// "error X indicators".
	assert.equal(kind("complete-unseen"), "complete");
	assert.equal(kind("error-unseen"), "error");
	assert.equal(kind("interrupted-unseen"), "interrupted");

	// And the state stops the count: an acknowledged row is not a mark, and a
	// mark with no token is drawn but cannot be sent.
	assert.equal(kind("complete-read"), null);
	assert.equal(kind("complete-tokenless"), "complete");

	const copy = markAllReadCopy(rows);
	assert.equal(copy.count, 3, "the count is the drawn marks with a token");
	assert.equal(copy.label, "Mark all 3 read");

	seed(rows);
	serve({ read: [], superseded: [], unknown: [] });
	await store.getState().markAllRead();
	assert.deepEqual(
		requests[0].items.map((entry) => entry.sessionId),
		["complete-unseen", "error-unseen", "interrupted-unseen"],
		"the batch carries the three marks and nothing else",
	);
});

test("the tokenless clause names the drawn marks it cannot send, and only those", () => {
	/*
	 * The clause is the one sentence that has to agree with the screen: it says a
	 * mark stays because no click can clear it. Under bare `unseen` it also named
	 * rows with NO mark — a busy row's spinner was reported as an uncleared
	 * unread mark, which is the defect one seating away from the count.
	 */
	const rows = [
		completeRow(SESSION, { title: "Unread", active: true }),
		completeRow(OTHER, {
			title: "Mark, no token",
			active: true,
			attention: unread(OTHER, { completion_token: null }),
		}),
		completeRow("333333333333", {
			title: "Busy, no token",
			active: true,
			status: BUSY,
			attention: unread("333333333333", { completion_token: null }),
		}),
	];
	const copy = markAllReadCopy(rows);
	assert.equal(copy.count, 1);
	/*
	 * Every row is `active`, so the `elsewhere` clause is absent and this asserts the
	 * tokenless clause alone; the both-clauses sentence is asserted in the copy case
	 * above, where the separator defect (design D5 / QA Q-1) lived.
	 */
	assert.equal(
		copy.scope,
		"Mark 1 unread chat as read. 1 unread mark with no completion token cannot be cleared.",
		"the clause must name the drawn, unsendable mark and not the busy row's",
	);
});

test("the control's copy names the extent before the click", () => {
	/*
	 * UX round 1 (U1) and design D3: the gesture is catalogue-wide, so the number
	 * belongs in the control's own words and the rows it reaches outside its own
	 * section are stated too. Design N5 is the third case: a mark with no token
	 * cannot be cleared, so when one exists the limit is named rather than left as
	 * a check that survives an acknowledged clear with nothing explaining it.
	 */
	const elsewhere = [
		completeRow(SESSION, { title: "Active unread", active: true }),
		completeRow(OTHER, { title: "Previous unread", active: false }),
	];
	const local = markAllReadCopy(elsewhere);
	assert.equal(local.label, "Mark all 2 read");
	assert.equal(
		local.scope,
		"Mark 2 unread chats as read, including 1 in Previous chats.",
	);
	assert.equal(
		local.nameSuffix,
		", including 1 in Previous chats",
		"the accessible name carries the rows the visible label cannot",
	);
	// A name whose visible text is a prefix of it, so Label in Name (WCAG 2.5.3)
	// holds once the surface appends the suffix.
	assert.equal(
		`${local.label}${local.nameSuffix}`.startsWith(local.label),
		true,
	);

	const withoutElsewhere = markAllReadCopy([
		completeRow(SESSION, { title: "Active unread", active: true }),
	]);
	assert.equal(withoutElsewhere.label, "Mark all 1 read");
	assert.equal(withoutElsewhere.scope, "Mark 1 unread chat as read.");
	assert.equal(
		withoutElsewhere.nameSuffix,
		"",
		"no words are spent on nothing",
	);

	const tokenless = markAllReadCopy([
		completeRow(SESSION, { title: "Active unread", active: true }),
		completeRow("444444444444", {
			title: "Unseen, no token",
			active: true,
			attention: unread("444444444444", { completion_token: null }),
		}),
	]);
	assert.equal(tokenless.count, 1, "a mark with no token is not the set sent");
	assert.equal(
		tokenless.scope,
		"Mark 1 unread chat as read. 1 unread mark with no completion token cannot be cleared.",
	);
	/*
	 * BOTH CLAUSES AT ONCE, which is the case neither arm's own assertion above could
	 * see: the old join dropped the separator between them and produced "…in Previous
	 * chats 1 unread mark with no completion token cannot be cleared." (design D5 / QA
	 * Q-1, measured on this head and on the base). The tooltip is the one place a
	 * pointer user reads the extent, so both sentences have to survive being read
	 * together.
	 */
	const both = markAllReadCopy([
		...elsewhere,
		completeRow("555555555555", {
			title: "Unseen, no token",
			active: true,
			attention: unread("555555555555", { completion_token: null }),
		}),
	]);
	assert.equal(both.count, 2, "the tokenless mark is not in the set sent");
	assert.equal(
		both.scope,
		"Mark 2 unread chats as read, including 1 in Previous chats. 1 unread mark with no completion token cannot be cleared.",
	);
});

test("nothing unread sends no request and writes nothing", async () => {
	const rows = [
		{ session_id: SESSION, title: "Reconcile", status: COMPLETE },
		completeRow(OTHER, {
			title: "Quarterly",
			attention: unread(OTHER, { unseen: false }),
		}),
	];
	seed(rows);
	serve({ read: [], superseded: [], unknown: [] });
	const before = store.getState().sessions;
	const receipt = await store.getState().markAllRead();
	assert.deepEqual(receipt, {
		attempted: 0,
		cleared: 0,
		superseded: 0,
		unknown: 0,
	});
	// No request, not an empty one: the wire has a 1-item floor, and a batch of
	// zero would cost a round trip to clear nothing.
	assert.equal(requests.length, 0, "an empty pile is not a request");
	// And no write, so nothing repaints: identity, not deep equality.
	assert.equal(
		store.getState().sessions,
		before,
		"the store was left alone entirely",
	);
});

test("only the answer's `read` bucket clears a mark", async () => {
	seed([
		completeRow(SESSION, { title: "Reconcile" }),
		completeRow(OTHER, { title: "Quarterly" }),
		completeRow("222222222222", { title: "Migrate" }),
	]);
	serve({
		read: [
			{
				...rowFor(SESSION).attention,
				unseen: false,
				revision: [4, 4],
			},
		],
		superseded: [OTHER],
		unknown: ["222222222222"],
	});
	const receipt = await store.getState().markAllRead();
	assert.deepEqual(receipt, {
		attempted: 3,
		cleared: 1,
		superseded: 1,
		unknown: 1,
	});
	// The acknowledged row rests; the two the backend refused keep their marks,
	// because a refusal is not a clear and the user's screen must not say
	// otherwise.
	assert.equal(rowFor(SESSION).attention?.unseen, false);
	assert.equal(
		rowFor(OTHER).attention?.unseen,
		true,
		"a superseded row stays unread",
	);
	assert.equal(
		rowFor("222222222222").attention?.unseen,
		true,
		"an unknown row stays unread",
	);
});

test("nothing is cleared while the request is in flight, and a failure clears nothing", async () => {
	seed([completeRow(SESSION, { title: "Reconcile" })]);
	let settle;
	globalThis.__attentionRequest = () =>
		new Promise((resolve) => {
			settle = resolve;
		});
	const pending = store.getState().markAllRead();
	// The mark is still there: there is no optimistic write to roll back, which
	// is what makes the rejection case below safe rather than lossy.
	assert.equal(
		rowFor(SESSION).attention?.unseen,
		true,
		"the mark must outlive the request",
	);
	settle({
		read: [{ ...rowFor(SESSION).attention, unseen: false, revision: [4, 4] }],
		superseded: [],
		unknown: [],
	});
	await pending;
	assert.equal(rowFor(SESSION).attention?.unseen, false);
});

test("a failed request rejects and leaves every mark where it was", async () => {
	seed([completeRow(SESSION, { title: "Reconcile" })]);
	const before = store.getState().sessions;
	globalThis.__attentionRequest = async () => {
		throw new Error("the store is busy");
	};
	await assert.rejects(() => store.getState().markAllRead(), /busy/);
	assert.equal(store.getState().sessions, before, "nothing moved on a refusal");
	assert.equal(rowFor(SESSION).attention?.unseen, true);
});

test("the merge guard refuses a receipt that would carry a row backwards", async () => {
	/*
	 * A receipt's `read` entry is a snapshot, and a snapshot can be OLDER than
	 * what the row already holds — a frame that arrived while the batch was in
	 * flight, for instance. Applying it wholesale would un-read a completion the
	 * user has already been shown, which is the one direction the receipt clocks
	 * may never move. The state is applied through the same revision guard the
	 * single-frame path uses, so the newer pair stays.
	 */
	seed([
		completeRow(SESSION, {
			title: "Reconcile",
			attention: unread(SESSION, { revision: [9, 9], unseen: false }),
		}),
	]);
	store
		.getState()
		.applyAttentionMany([unread(SESSION, { revision: [3, 2], unseen: true })]);
	const held = rowFor(SESSION).attention;
	assert.deepEqual(held?.revision, [9, 9], "the newer pair holds");
	assert.equal(held?.unseen, false, "and the row is not un-read");
});

test("a state for a conversation the catalogue does not hold is dropped", () => {
	seed([completeRow(SESSION, { title: "Reconcile" })]);
	const before = store.getState().sessions;
	store.getState().applyAttentionMany([
		// A session that left the catalogue between the render and the answer:
		// inserting it would make a sidebar row with no title and no binding.
		unread("ffffffffffff", { unseen: false }),
		// A different namespace entirely — a persistent agent conversation is a
		// different authority even when the trailing id matches.
		unread(SESSION, { conversation_id: `agent/${OTHER}`, unseen: false }),
	]);
	assert.equal(store.getState().sessions, before, "no row was added or moved");
});

test("a batch of states is ONE commit", () => {
	seed([
		completeRow(SESSION, { title: "Reconcile" }),
		completeRow(OTHER, { title: "Quarterly" }),
	]);
	const before = store.getState().sessions;
	store
		.getState()
		.applyAttentionMany([
			unread(SESSION, { unseen: false, revision: [4, 4] }),
			unread(OTHER, { unseen: false, revision: [4, 4] }),
		]);
	const after = store.getState().sessions;
	// One new array for the whole batch, so N acknowledgements are one repaint of
	// a 500-row sidebar rather than N.
	assert.notEqual(after, before);
	assert.equal(after.length, before.length);
	assert.equal(after.filter((row) => row.attention?.unseen).length, 0);
});

/* ------------------------------------------------------------ main gate */

/* ---------------------------------------------- the refusal, as the user reads it */

/*
 * A refusal has to survive the IPC boundary as a CLASSIFIED failure.
 *
 * `ipcRenderer.invoke` rebuilds main's rejection as a plain `Error` and keeps
 * only the message, so the renderer can tell a deliberate refusal (the backend
 * was never asked) from a real transport failure only if the transport
 * classifies the sentence main sent. That classification lives in
 * `desktop-api.ts`, which every desktop caller shares, and these tests pin both
 * halves of it: the failure main produces, and the reading the renderer derives
 * from it. Before it, a background click on "Mark all as read" told the user
 * "Desktop controls could not reach the backend process." about a backend that
 * was answering the whole time (QA round 1, Q2) -- and the wrong sentence is a
 * wrong NEXT MOVE: there is nothing to retry against a backend that was never
 * called, the window is what has to move.
 */
const apiBundle = await build({
	stdin: {
		contents:
			'export { desktopRequest, desktopResult, userFacingMessage, isForegroundRequired, isServerUnreachable, DesktopControlError, UserFacingError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	desktopRequest,
	desktopResult,
	userFacingMessage,
	isForegroundRequired,
	isServerUnreachable,
	DesktopControlError,
	UserFacingError,
} = await import(
	`data:text/javascript;base64,${Buffer.from(apiBundle.outputFiles[0].text).toString("base64")}`
);

/**
 * Stand in for the preload bridge, with main's side rejecting.
 *
 * The message is wrapped the way Electron wraps it (`Error invoking remote
 * method '<channel>': Error: <message>`) rather than passed through bare, so the
 * classifier is exercised against the shape a real rejection has: main's
 * sentence inside text the renderer did not author.
 */
const ipcRejectsWith = (detail) => {
	/*
	 * Plain assignment rather than a typed stub: this is a `.mjs` harness, and the
	 * bridge the renderer reads (`window.api.desktop.request`) is what matters.
	 */
	globalThis.window = {
		api: {
			desktop: {
				request: () =>
					Promise.reject(
						new Error(
							`Error invoking remote method 'desktop-request': Error: ${detail}`,
						),
					),
			},
		},
	};
};

test("main's refusal reaches the reader as its own sentence, not as an unreachable backend", async () => {
	ipcRejectsWith(DESKTOP_FOREGROUND_REQUIRED_MESSAGE);
	const failure = await desktopRequest({
		op: "attention.seen",
		items: [item()],
	}).catch((error) => error);

	// The transport's half of the toast the sidebar composes. The clause it adds
	// itself ("The unread marks were not cleared.") stays true, and is the
	// caller's; the false sentence was this one.
	assert.equal(
		userFacingMessage(failure, "The backend did not answer."),
		DESKTOP_FOREGROUND_REQUIRED_MESSAGE,
	);
	assert.ok(
		failure instanceof UserFacingError,
		"refusal copy, by construction",
	);
	assert.equal(isForegroundRequired(failure), true);
	// The two readings must not both be true: the backend was reachable, and no
	// retry of the same click would have helped while the window was out of view.
	assert.equal(isServerUnreachable(failure), false);
	assert.equal(failure instanceof DesktopControlError, false);
});

test("a genuine transport failure keeps the unreachable sentence", async () => {
	ipcRejectsWith("net::ERR_CONNECTION_REFUSED");
	const failure = await desktopRequest({
		op: "attention.seen",
		items: [item()],
	}).catch((error) => error);

	assert.equal(
		userFacingMessage(failure, "fallback"),
		"Desktop controls could not reach the backend process.",
	);
	assert.equal(isForegroundRequired(failure), false);
	assert.equal(isServerUnreachable(failure), true);
});

test("every desktop caller gets the classification, not just the bulk one", async () => {
	// The single receipt rides the same gate, and its caller polls until the
	// window is in the foreground again -- which is only meaningful if the refusal
	// is recognisable there too. Asserted through the whole result path
	// (`desktopResult`) rather than `desktopRequest`, because that is what the
	// callers use.
	ipcRejectsWith(DESKTOP_FOREGROUND_REQUIRED_MESSAGE);
	const failure = await desktopResult({
		op: "sessions.seen",
		sessionId: SESSION,
		completionToken: TOKEN,
	}).catch((error) => error);

	assert.equal(isForegroundRequired(failure), true);
	assert.equal(isServerUnreachable(failure), false);
	assert.equal(
		userFacingMessage(failure, "fallback"),
		DESKTOP_FOREGROUND_REQUIRED_MESSAGE,
	);
});

const mainBundle = await build({
	stdin: {
		contents:
			'export { guardForegroundReceipts } from "./src/main/desktop-ipc";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "electron-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "electron-fixture" }, () => ({
					contents: `
			export const ipcMain = { handle: () => undefined };
			export const shell = { openExternal: async () => undefined };
		`,
					loader: "js",
				}));
			},
		},
	],
});
const { guardForegroundReceipts } = await import(
	`data:text/javascript;base64,${Buffer.from(mainBundle.outputFiles[0].text).toString("base64")}`
);

test("the foreground gate covers the bulk receipt, by name", async () => {
	const state = { visible: false, minimized: true, focused: false };
	const owner = {
		isDestroyed: () => false,
		isVisible: () => state.visible,
		isMinimized: () => state.minimized,
		isFocused: () => state.focused,
	};
	const sent = [];
	const guarded = guardForegroundReceipts(
		() => owner,
		async (input) => {
			sent.push(input);
			return { status: 200, body: { result: {} } };
		},
	);
	const batch = {
		op: "attention.seen",
		items: [item(), item(OTHER, LATER_TOKEN)],
	};

	// The whole point: a batch is a pile of marks, and a hidden or minimised
	// window has shown the user none of the results behind them.
	await assert.rejects(() => guarded(batch), /foreground/);
	assert.equal(sent.length, 0, "no background state reached the backend");

	// Each negative stands on its own, as it does for the single receipt.
	for (const background of [
		{ focused: false },
		{ visible: false },
		{ minimized: true },
	]) {
		Object.assign(state, { visible: true, minimized: false, focused: true });
		Object.assign(state, background);
		await assert.rejects(
			() => guarded(batch),
			/foreground/,
			JSON.stringify(background),
		);
	}
	assert.equal(sent.length, 0);

	Object.assign(state, { visible: true, minimized: false, focused: true });
	await guarded(batch);
	assert.equal(sent.length, 1, "a visible, focused window may clear the pile");

	/*
	 * And the delivery claim is still NOT gated, which is the case a careless
	 * widening would break: `sessions.notified` claims cross-surface delivery of a
	 * notification, which by definition fires while the window is in the
	 * background. A loop over every op whose name mentions sessions would have
	 * refused it.
	 */
	Object.assign(state, { visible: false, minimized: true, focused: false });
	await guarded({
		op: "sessions.notified",
		sessionId: SESSION,
		completionToken: TOKEN,
	});
	assert.equal(
		sent.length,
		2,
		"a delivery claim is still admitted in the background",
	);
});

test("the refusal and its code are one authority, so the producer cannot drift from the classifier", async () => {
	// The pin the contract's comment promises: main refuses with the SHARED
	// sentence, and the renderer classifies by it. A reworded producer against an
	// unchanged classifier is how a refusal goes back to reading as an unreachable
	// backend, and a code that exists only in the renderer would be a second
	// authority for the same fact.
	const state = { visible: false, minimized: true, focused: false };
	const owner = {
		isDestroyed: () => false,
		isVisible: () => state.visible,
		isMinimized: () => state.minimized,
		isFocused: () => state.focused,
	};
	const guarded = guardForegroundReceipts(
		() => owner,
		async () => ({ status: 200, body: { result: {} } }),
	);
	await assert.rejects(
		() => guarded({ op: "attention.seen", items: [item()] }),
		(error) => {
			assert.equal(error.message, DESKTOP_FOREGROUND_REQUIRED_MESSAGE);
			return true;
		},
	);
	assert.equal(DESKTOP_FOREGROUND_REQUIRED_CODE, "foreground_required");
});
