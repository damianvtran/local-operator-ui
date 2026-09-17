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
 *   2. THE SET. `markAllRead` sends exactly the store's rows that carry
 *      `unseen` AND a `completion_token`. A row without a token names no
 *      completion, and a row already read has nothing to acknowledge; sending
 *      either inflates the batch and puts a number in the receipt that no row's
 *      story explains. Zero such rows sends NO REQUEST — not an empty one.
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
const { desktopEndpoint, desktopRequestSchema } = await import(
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
const { unreadAckableCount, unreadAckableRows, markAllReadCopy } = storeModule;

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

/** Seed the store's rows, as a catalogue read would have left them. */
const seed = (rows) => {
	store.setState({ sessions: rows });
	requests = [];
};
const rowFor = (sessionId) =>
	store.getState().sessions.find((row) => row.session_id === sessionId);

test("the batch is exactly the rows carrying an unseen completion with a token", async () => {
	seed([
		{ session_id: SESSION, title: "Reconcile", attention: unread(SESSION) },
		{
			session_id: OTHER,
			title: "Quarterly",
			attention: unread(OTHER, {
				unseen: false,
				revision: [4, 4],
			}),
		},
		{
			session_id: "222222222222",
			title: "Read but no token",
			attention: unread("222222222222", { completion_token: null }),
		},
		{ session_id: "333333333333", title: "No attention at all" },
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
		{ session_id: SESSION, title: "Unread", attention: unread(SESSION) },
		{
			session_id: OTHER,
			title: "Read",
			attention: unread(OTHER, { unseen: false }),
		},
		{
			session_id: "333333333333",
			title: "No token",
			attention: unread("333333333333", { completion_token: null }),
		},
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

test("the control's copy names the extent before the click", () => {
	/*
	 * UX round 1 (U1) and design D3: the gesture is catalogue-wide, so the number
	 * belongs in the control's own words and the rows it reaches outside its own
	 * section are stated too. Design N5 is the third case: a mark with no token
	 * cannot be cleared, so when one exists the limit is named rather than left as
	 * a check that survives an acknowledged clear with nothing explaining it.
	 */
	const elsewhere = [
		{
			session_id: SESSION,
			title: "Active unread",
			active: true,
			attention: unread(SESSION),
		},
		{
			session_id: OTHER,
			title: "Previous unread",
			active: false,
			attention: unread(OTHER),
		},
	];
	const local = markAllReadCopy(elsewhere);
	assert.equal(local.label, "Mark all 2 read");
	assert.equal(
		local.scope,
		"Mark 2 unread chats as read, including 1 in Previous chats",
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
		{
			session_id: SESSION,
			title: "Active unread",
			active: true,
			attention: unread(SESSION),
		},
	]);
	assert.equal(withoutElsewhere.label, "Mark all 1 read");
	assert.equal(withoutElsewhere.scope, "Mark 1 unread chat as read.");
	assert.equal(
		withoutElsewhere.nameSuffix,
		"",
		"no words are spent on nothing",
	);

	const tokenless = markAllReadCopy([
		{
			session_id: SESSION,
			title: "Active unread",
			active: true,
			attention: unread(SESSION),
		},
		{
			session_id: "444444444444",
			title: "Unseen, no token",
			active: true,
			attention: unread("444444444444", { completion_token: null }),
		},
	]);
	assert.equal(tokenless.count, 1, "a mark with no token is not the set sent");
	assert.equal(
		tokenless.scope,
		"Mark 1 unread chat as read. 1 unread mark with no completion token cannot be cleared.",
	);
});

test("nothing unread sends no request and writes nothing", async () => {
	const rows = [
		{ session_id: SESSION, title: "Reconcile" },
		{
			session_id: OTHER,
			title: "Quarterly",
			attention: unread(OTHER, { unseen: false }),
		},
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
		{ session_id: SESSION, title: "Reconcile", attention: unread(SESSION) },
		{ session_id: OTHER, title: "Quarterly", attention: unread(OTHER) },
		{
			session_id: "222222222222",
			title: "Migrate",
			attention: unread("222222222222"),
		},
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
	seed([
		{ session_id: SESSION, title: "Reconcile", attention: unread(SESSION) },
	]);
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
	seed([
		{ session_id: SESSION, title: "Reconcile", attention: unread(SESSION) },
	]);
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
		{
			session_id: SESSION,
			title: "Reconcile",
			attention: unread(SESSION, { revision: [9, 9], unseen: false }),
		},
	]);
	store
		.getState()
		.applyAttentionMany([unread(SESSION, { revision: [3, 2], unseen: true })]);
	const held = rowFor(SESSION).attention;
	assert.deepEqual(held?.revision, [9, 9], "the newer pair holds");
	assert.equal(held?.unseen, false, "and the row is not un-read");
});

test("a state for a conversation the catalogue does not hold is dropped", () => {
	seed([
		{ session_id: SESSION, title: "Reconcile", attention: unread(SESSION) },
	]);
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
		{ session_id: SESSION, title: "Reconcile", attention: unread(SESSION) },
		{ session_id: OTHER, title: "Quarterly", attention: unread(OTHER) },
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
