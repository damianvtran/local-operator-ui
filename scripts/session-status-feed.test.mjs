import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The `session_status` frame's arrival path, and the guard that stops the two
 * writers of one row's status flapping.
 *
 * Why this file exists. The row's status is now written by two producers that
 * run on wildly different clocks: a `session_status` frame is a few hundred
 * bytes pushed on a level change, while `sessions.list` is a whole-catalogue
 * read (measured at ~120 ms median for 200 rows, and the sidebar asks for 500)
 * whose rows are computed BEFORE it is serialised. So the losing order is not a
 * corner case, it is the ordinary one for the row on screen: the chat page's own
 * marker effect deliberately fires a list refetch on exactly the transition the
 * frame is speeding up (`chat-page.tsx`), and that response can land after the
 * frame carrying the pre-transition status. Without the guard the sidebar paints
 * the correction and then flickers back for a poll cycle, which reads as a status
 * that is unreliable rather than one that is late.
 *
 * What it asserts, and why each case is separate:
 *
 *   1. a stale list (same epoch, lower revision) cannot clobber a fresher frame;
 *   2. a list at least as fresh as the frame DOES win — including the boundary,
 *      where equal revisions mean the list is not older and must not be refused;
 *   3. a new epoch retires the old counters, so a row stops advertising a counter
 *      no live process will ever mint. Stamp HYGIENE, not a pin: the guard needs
 *      epoch equality before it compares a single number, so a dead epoch's
 *      counter could never have refused a live list in the first place;
 *   4. an unstamped list still applies its status, because the stamp is
 *      evidence and its absence is not evidence against the row;
 *   5. a frame that carries nothing new returns the SAME state object, which is
 *      how a 500-row sidebar avoids a re-render per heartbeat;
 *   6. a frame for a session the catalogue does not know is dropped, and does
 *      not disturb the array it did not change;
 *   7. a stamp is a PAIR, so a merge handed half of one keeps a whole stamp or
 *      none - never a `(new epoch, old revision)` hybrid no process minted, and
 *      never a row pinned against the new epoch's own list because of it;
 *   8. the frame's own arrival path - the HOOK - hands the store the two-key
 *      pair, which is the part the store cannot check for itself;
 *   9. a frame moves a row's STATUS and can never move its SLOT - only a list
 *      read re-orders the array, which is the division of responsibility the
 *      desktop contract states (`src/shared/desktop-session-contract.ts`: the
 *      backend owns status precedence, the active/previous partition and the
 *      order). A future attempt to "fix" a late re-file inside the renderer has
 *      to fail here rather than merely look plausible;
 *  10. the `catalogue` frame is the REFETCH TRIGGER: it hands the sidebar a
 *      revision it watches, and it carries no state the list could be reordered
 *      from. That is the half a client-side sort would need, and it is not there
 *      to be used.
 *
 * The tests drive the STORE's own two entry points - `applySessionStatus` for the
 * frame and `fetchSessions` for the list - rather than `replaceSessionRows`
 * directly, because the mapping from a wire row to a catalogue row (`id`/`name`/
 * `mtime` -> `session_id`/`title`/`updated_at`) is part of the path the stamps
 * have to survive. A pure-function test of the merge would pass with the stamps
 * dropped on the way in.
 *
 * The last test is the deliberate exception: it drives the real HOOK
 * (`useDesktopFeed`, with `react` and the capability hook replaced) against the
 * real store, because the store writes whatever `status` argument it is handed
 * and a caller that passes the whole frame payload through leaves a `revision`
 * key on the row. A three-key payload is structurally assignable to
 * `SessionCatalogueStatus`, so no store-level assertion here can catch it: the
 * shape the app produces only exists at the hook's call site.
 *
 * What this file is NOT: evidence that the sidebar updates. That is a claim
 * about a rendered list, and it is answered by the frames under
 * `docs/evidence/` produced by the story harness that drives this same store and
 * this same hook in a real browser.
 */

// The store is bundled with the same fixtures `desktop-feed.test.mjs` uses:
// `desktopResult` is the network and is the only thing faked; the store's own
// persistence needs a `localStorage`.
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
globalThis.__statusRequest = async () => ({});

const storeBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/store/canonical-sessions-store";' +
			' export {useDesktopFeed} from "./src/renderer/src/shared/hooks/use-desktop-feed";',
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
			name: "session-status-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "transport", namespace: "session-status-fixture" }),
				);
				/*
				 * The hook's other two dependencies, and ONLY where the hook asks for
				 * them: the filter keys off the importer, because `react` is also what
				 * `zustand` (inside the store this bundle is about) imports, and handing
				 * zustand a two-function stub would break the store rather than the hook.
				 *
				 * `useEffect` records its effect instead of running it, so the test owns
				 * the commit - the same seam `completion-view-ack.test.mjs` uses.
				 */
				builder.onResolve({ filter: /^react$/ }, (args) =>
					/shared\/hooks\/use-desktop-feed\.ts$/.test(args.importer)
						? { path: "react-hooks", namespace: "session-status-fixture" }
						: undefined,
				);
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-hooks/ },
					() => ({ path: "capabilities", namespace: "session-status-fixture" }),
				);
				// Only `desktopResult` is faked - it is the network. The error
				// classes are re-exported from the real module, because the store's
				// error-copy rules depend on their actual behaviour.
				builder.onLoad(
					{ filter: /.*/, namespace: "session-status-fixture" },
					(args) => ({
						contents: {
							transport: `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
								`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
							)}
export const desktopResult = request => globalThis.__statusRequest(request);`,
							capabilities: `export const desktopFeatureEnabled = () => true;
export const useDesktopCapabilities = () => ({data: {features: {desktop_feed: true}}});`,
							"react-hooks": `export function useEffect(effect) { globalThis.__effects.push(effect); return () => {}; }
export function useState(initial) { return [typeof initial === "function" ? initial() : initial, (value) => { globalThis.__stateSets.push(value); }]; }`,
						}[args.path],
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
				// The store's contract with the transcript hook is three no-op calls,
				// and this file is not testing the echo. Same stub the neighbouring
				// store tests use.
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "echo-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "echo-fixture" }, () => ({
					contents: `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const { useCanonicalSessionsStore: store, useDesktopFeed } = await import(
	`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString("base64")}`
);
// The hook's recorded effects, and the frame handler its subscription installs.
// Both are published by the `react`/feed fixtures above.
globalThis.__effects = [];
// Every value any `useState` setter in the hook was handed, in order. The hook's
// catalogue revision is published through one, so a setter that discarded its
// argument would leave the trigger unassertable.
globalThis.__stateSets = [];
globalThis.__frames = () => {
	throw new Error("the hook never subscribed");
};

const EPOCH = "9f2c1a6b7d3e4051";
const LATER_EPOCH = "1a2b3c4d5e6f7081";
const SESSION = "0f1e2d3c4b5a";
const OTHER = "ffffffffffff";
const TITLE = "Quarterly revenue model";

/** One row in `sessions.list`'s own wire field names (`id`/`name`/`mtime`). */
const wire = (over = {}) => ({
	id: SESSION,
	name: TITLE,
	mtime: 1_760_000_000,
	...over,
});

let servedRows = [];
globalThis.__statusRequest = async () => ({
	sessions: servedRows,
	truncated: false,
});

/** A full catalogue response, driven through the store's real `fetchSessions`. */
const list = async (rows) => {
	servedRows = rows;
	await store.getState().fetchSessions();
	return store.getState().sessions;
};

/** The row under test, as the sidebar would read it. */
const row = () =>
	store.getState().sessions.find((item) => item.session_id === SESSION);

/** One catalogue row as a frame or a list would have left it. */
const catalogue = (over = {}) => ({
	session_id: SESSION,
	title: TITLE,
	binding: { agent: null, team: null },
	status: { code: "approval", label: "Approval needed" },
	status_revision: 5,
	status_epoch: EPOCH,
	...over,
});

/** Seed the store as a previous frame left it. */
const seeded = (over = {}) => {
	store.setState({ sessions: [catalogue(over)] });
};

test("a stale list cannot clobber a fresher frame", async () => {
	seeded();
	/*
	 * The response was computed before the gate was answered: same epoch, LOWER
	 * revision, and the status the row had before the frame arrived.
	 */
	const rows = await list([
		wire({
			status: { code: "busy", label: "Working" },
			status_revision: 3,
			status_epoch: EPOCH,
		}),
	]);
	const held = rows.find((item) => item.session_id === SESSION);
	assert.deepEqual(held.status, { code: "approval", label: "Approval needed" });
	assert.equal(held.status_revision, 5);
	assert.equal(held.status_epoch, EPOCH);
});

test("a list at least as fresh as the frame wins", async () => {
	seeded();
	await list([
		wire({
			status: { code: "complete", label: "Complete" },
			status_revision: 6,
			status_epoch: EPOCH,
		}),
	]);
	assert.deepEqual(row().status, { code: "complete", label: "Complete" });
	assert.equal(row().status_revision, 6);

	/*
	 * The boundary, and the reason it is asserted rather than assumed: the guard
	 * refuses an incoming revision that is STRICTLY lower, so equality belongs to
	 * the list. A guard written `>=` would pin a frame's value against a response
	 * that is entitled to the row - the same value here, but the wrong rule, and
	 * it would show up as a row that stops tracking a backend which re-stamps the
	 * same revision after a change the client never saw as a frame.
	 */
	seeded();
	await list([
		wire({
			status: { code: "busy", label: "Working" },
			status_revision: 5,
			status_epoch: EPOCH,
		}),
	]);
	assert.deepEqual(row().status, { code: "busy", label: "Working" });
	assert.equal(row().status_revision, 5);
});

test("a new epoch retires the old counters", async () => {
	/*
	 * TWO rows stamped by the process that has just gone, and one of them is not
	 * the row the frame names: the counters belong to a PROCESS, so the reset has
	 * to reach every row, not only the one being written.
	 */
	store.setState({
		sessions: [
			catalogue({
				status: { code: "busy", label: "Working" },
				status_revision: 9,
			}),
			catalogue({
				session_id: OTHER,
				title: "Release notes",
				status: { code: "complete", label: "Complete" },
				status_revision: 4,
			}),
		],
	});
	const untouched = () =>
		store.getState().sessions.find((item) => item.session_id === OTHER);
	/*
	 * The feed restarted. Its first frame for this session carries revision 1 -
	 * LOWER than the 9 the row holds - and it must still apply, because that 9
	 * was minted by a process that no longer exists. This is the case a guard
	 * that compared revisions alone would misread as "the frame is stale".
	 */
	store
		.getState()
		.applySessionStatus(
			SESSION,
			{ code: "idle", label: "Recent" },
			1,
			LATER_EPOCH,
		);
	assert.deepEqual(row().status, { code: "idle", label: "Recent" });
	assert.equal(row().status_revision, 1);
	assert.equal(row().status_epoch, LATER_EPOCH);

	// The other row keeps its STATUS - the frame said nothing about it - and
	// loses the stamp, which is the dead process's counter and nothing else.
	assert.deepEqual(untouched().status, { code: "complete", label: "Complete" });
	assert.equal(untouched().status_revision, undefined);
	assert.equal(untouched().status_epoch, undefined);

	/*
	 * And the live epoch's ordering works from the new stamp: a response from the
	 * process now serving us that stamps the same revision is not older than the
	 * frame, so it wins. This is the stamp being USABLE after the reset, not the
	 * reset deciding anything: the response carries LATER_EPOCH, so it would have
	 * won against the retired counter too, because the guard requires epoch
	 * equality before it compares a single revision. What the reset itself bought
	 * is the assertion above - the other row's dead counter is gone rather than
	 * left on screen reading as ordering evidence. The one order it does decide is
	 * narrow and the opposite way: a list response from the dead process landing
	 * after a frame from that same dead process is accepted here, where the stamp
	 * it would have lost against is no longer there.
	 */
	await list([
		wire({
			status: { code: "busy", label: "Working" },
			status_revision: 1,
			status_epoch: LATER_EPOCH,
		}),
	]);
	assert.deepEqual(row().status, { code: "busy", label: "Working" });
	assert.equal(row().status_epoch, LATER_EPOCH);
});

test("an unstamped list still applies its status", async () => {
	seeded({
		status: { code: "complete", label: "Complete" },
		status_revision: 7,
		status_epoch: EPOCH,
	});
	/*
	 * An older backend, or one that has published nothing for this session: no
	 * `status_revision`, no `status_epoch`. The status is the only thing it can
	 * contribute and it is applied; the stamp it says nothing about is not
	 * cleared, because an absent key is not a claim (the same rule the row merge
	 * has always had for `supported`).
	 */
	await list([wire({ status: { code: "error", label: "Failed" } })]);
	assert.deepEqual(row().status, { code: "error", label: "Failed" });
	assert.equal(row().status_revision, 7);
	assert.equal(row().status_epoch, EPOCH);
});

test("a frame that carries nothing new returns the same state", async () => {
	seeded();
	const before = store.getState();
	store
		.getState()
		.applySessionStatus(
			SESSION,
			{ code: "approval", label: "Approval needed" },
			5,
			EPOCH,
		);
	// Identity, not equality: this is the store deliberately avoiding a re-render
	// of a 500-row sidebar for a level that carried nothing new. The same rule
	// `applyAttention` and the attention merge follow.
	assert.equal(store.getState(), before);

	// A frame that DOES carry something new must not be swallowed by that guard.
	store
		.getState()
		.applySessionStatus(SESSION, { code: "busy", label: "Working" }, 6, EPOCH);
	assert.notEqual(store.getState(), before);
	assert.deepEqual(row().status, { code: "busy", label: "Working" });
	assert.equal(row().status_revision, 6);
});

test("a frame for an unknown session is dropped", async () => {
	seeded();
	const before = store.getState();
	store
		.getState()
		.applySessionStatus(OTHER, { code: "busy", label: "Working" }, 1, EPOCH);
	/*
	 * Membership is the catalogue's question (`sessions.list`), not the feed's.
	 * Inserting here would make a sidebar row with no title, no binding and no
	 * status - an entry for something the user cannot identify.
	 */
	assert.equal(store.getState(), before);
	assert.deepEqual(
		store.getState().sessions.map((item) => item.session_id),
		[SESSION],
	);

	/*
	 * The epoch bookkeeping is about the PROCESS, not about the row, so a frame
	 * naming a session we do not hold still retires another epoch's stamps: the
	 * rows it leaves behind would otherwise carry counters from a dead run.
	 */
	store
		.getState()
		.applySessionStatus(
			OTHER,
			{ code: "busy", label: "Working" },
			1,
			LATER_EPOCH,
		);
	assert.equal(row().status_revision, undefined);
	assert.equal(row().status_epoch, undefined);
	assert.deepEqual(row().status, {
		code: "approval",
		label: "Approval needed",
	});
});

test("a half stamp is not a stamp", async () => {
	seeded();
	/*
	 * The merge is handed an epoch and no revision. Neither half orders anything on
	 * its own, so this row carries no stamp - and the spread that merges it must not
	 * MINT one out of the two rows, because `(LATER_EPOCH, 5)` is an epoch that has
	 * never counted to five. The current pair survives instead, under the rule this
	 * merge already has for every other field: an absent key is not a claim.
	 */
	await list([
		wire({
			status: { code: "busy", label: "Working" },
			status_epoch: LATER_EPOCH,
		}),
	]);
	assert.deepEqual(row().status, { code: "busy", label: "Working" });
	assert.equal(row().status_revision, 5);
	assert.equal(row().status_epoch, EPOCH);
});

test("a half stamp cannot pin the new epoch's own list", async () => {
	seeded();
	/*
	 * The consequence, in the sequence the review reproduced. `(LATER_EPOCH, 5)` is
	 * a stamp no process minted, and the guard cannot tell: the live epoch's list
	 * arrives carrying its own counter, loses to the fabrication, and the row stays
	 * on the value the list was trying to correct - pinned on the list path, which
	 * is the mirror of the flap the guard exists to stop.
	 */
	await list([
		wire({
			status: { code: "busy", label: "Working" },
			status_epoch: LATER_EPOCH,
		}),
	]);
	await list([
		wire({
			status: { code: "idle", label: "Recent" },
			status_revision: 3,
			status_epoch: LATER_EPOCH,
		}),
	]);
	assert.deepEqual(row().status, { code: "idle", label: "Recent" });
	assert.equal(row().status_revision, 3);
	assert.equal(row().status_epoch, LATER_EPOCH);
});

test("a revision with no epoch is not a stamp either", async () => {
	seeded();
	/*
	 * The mirror half, because the rule is about the PAIR rather than about the
	 * missing revision: a revision with no epoch is equally unusable, and equally
	 * not a claim about the process that minted it.
	 */
	await list([
		wire({ status: { code: "error", label: "Failed" }, status_revision: 8 }),
	]);
	assert.deepEqual(row().status, { code: "error", label: "Failed" });
	assert.equal(row().status_revision, 5);
	assert.equal(row().status_epoch, EPOCH);
});

/*
 * THE DIVISION OF RESPONSIBILITY, pinned from the side that can be broken by
 * accident. A row's SLOT is the backend's: the list arrives in the backend's
 * order (`rank_entries`, by order key) and the sidebar renders that array in
 * sequence, so a re-file travels on a LIST READ and on nothing else. A frame is
 * a few hundred bytes about one row's status, and the tempting shortcut when a
 * re-file looks late is to sort where the row's data already is - which would put
 * two implementations of the order key in two languages, one of them without the
 * wake band, and would show up as a list that disagrees with the next read.
 *
 * So this asserts the negative directly: a frame that completes the MIDDLE row
 * leaves the array exactly as it was, and the same roster delivered as a list
 * read is what moves it. A renderer-side sort has to fail the first assertion.
 */
test("a frame moves a row's status and cannot move its slot", async () => {
	const ids = ["111111111111", "222222222222", "333333333333"];
	await list(
		ids.map((id, index) =>
			wire({ id, name: `Row ${index}`, mtime: 1_760_000_000 - index }),
		),
	);
	const order = () => store.getState().sessions.map((item) => item.session_id);
	assert.deepEqual(order(), ids);

	// The BACKEND's reorder, as the next list read would answer it: the completed
	// row leads. Delivered as a read, it is the only thing that moves the row.
	await list([
		wire({ id: ids[2], name: "Row 2", mtime: 1_760_000_000 - 2 }),
		wire({ id: ids[0], name: "Row 0", mtime: 1_760_000_000 }),
		wire({ id: ids[1], name: "Row 1", mtime: 1_760_000_000 - 1 }),
	]);
	assert.deepEqual(order(), [ids[2], ids[0], ids[1]]);

	// Back to the pre-completion order, then the frame the completion actually
	// arrives on.
	await list(
		ids.map((id, index) =>
			wire({ id, name: `Row ${index}`, mtime: 1_760_000_000 - index }),
		),
	);
	assert.deepEqual(order(), ids);
	store
		.getState()
		.applySessionStatus(
			ids[2],
			{ code: "complete", label: "Complete" },
			9,
			EPOCH,
		);
	const completed = store
		.getState()
		.sessions.find((item) => item.session_id === ids[2]);
	assert.deepEqual(completed.status, { code: "complete", label: "Complete" });
	assert.equal(completed.status_revision, 9);
	// THE ASSERTION THIS TEST EXISTS FOR: the status moved and the SLOT did not.
	// The row is still last, and a renderer that inferred the order from the row
	// it just wrote would have it first.
	assert.deepEqual(order(), ids);
});

/*
 * The arrival path ABOVE the store, which is where the row's shape is decided.
 * The store writes its `status` argument onto the row verbatim, so a hook that
 * hands it the frame's whole `payload` leaves a `revision` key on a row whose
 * status type has no such field - and every test above passes a two-key literal,
 * so none of them can see it. `react` is stubbed to record the effect rather than
 * run it (the commit is driven here), the capability hook is stubbed open, and
 * everything else - the hook, the store, the guard - is the shipped module.
 */
test("the hook hands the store the pair, not the frame payload", () => {
	seeded();
	globalThis.__effects.length = 0;
	globalThis.__frames = () => {
		throw new Error("the hook never subscribed");
	};
	globalThis.window = {
		api: {
			desktop: {
				feed: {
					subscribe: (onFrame) => {
						globalThis.__frames = onFrame;
						return () => {};
					},
					watchState: () => () => {},
				},
			},
		},
	};
	const connection = useDesktopFeed();
	// Without the gate open the effect below never subscribes, and every assertion
	// after it would pass vacuously against a row nothing had written.
	assert.equal(connection.available, true);
	for (const effect of globalThis.__effects) effect();
	globalThis.__frames({
		epoch: EPOCH,
		seq: 7,
		type: "session_status",
		session_id: SESSION,
		payload: { code: "complete", label: "Complete", revision: 3 },
	});
	// `revision` is on the frame and NOT on the row's status: it reaches the row
	// through the stamp the guard compares, which is the only place it is evidence.
	assert.deepEqual(Object.keys(row().status), ["code", "label"]);
	assert.deepEqual(row().status, { code: "complete", label: "Complete" });
	assert.equal(row().status_revision, 3);
	assert.equal(row().status_epoch, EPOCH);
});

/*
 * The other half of the same division: what a `catalogue` frame HANDS the client.
 *
 * The frame is the refetch trigger, and its payload is a revision rather than a
 * list. The sidebar's effect is keyed on `feed.catalogueRevision`, so one bump
 * re-runs `fetchSessions` once - which is how a row that re-ordered inside its
 * section gets its new slot without a renderer-side sort. The value is asserted
 * here because it is the hook's own decision: a frame that kept the revision to
 * itself, or handed over its payload's other keys, would leave the sidebar
 * without a trigger it can watch - and a `useState` setter that discarded its
 * argument is the shape this test's fixture would previously have hidden.
 *
 * The unknown-type case is asserted beside it because it is the same branch: a
 * frame this build does not know must publish nothing at all, which is what makes
 * a newer backend's frame a no-op for an older renderer.
 */
test("the catalogue frame publishes the revision the sidebar refetches on", () => {
	seeded();
	globalThis.__effects.length = 0;
	globalThis.__stateSets.length = 0;
	globalThis.__frames = () => {
		throw new Error("the hook never subscribed");
	};
	globalThis.window = {
		api: {
			desktop: {
				feed: {
					subscribe: (onFrame) => {
						globalThis.__frames = onFrame;
						return () => {};
					},
					watchState: () => () => {},
				},
			},
		},
	};
	const connection = useDesktopFeed();
	assert.equal(connection.available, true);
	// Before any frame there is no revision to watch, and that `null` is what the
	// sidebar's effect reads as "nothing has been invalidated yet".
	assert.equal(connection.catalogueRevision, null);
	for (const effect of globalThis.__effects) effect();

	globalThis.__frames({
		epoch: EPOCH,
		seq: 11,
		type: "catalogue",
		payload: { revision: 7 },
	});
	assert.deepEqual(globalThis.__stateSets, [7]);

	// A frame type this build does not know publishes nothing - neither a revision
	// nor anything else - which is the compatibility rule the hook's own comment
	// states.
	globalThis.__frames({
		epoch: EPOCH,
		seq: 12,
		type: "something_newer",
		payload: {},
	});
	assert.deepEqual(globalThis.__stateSets, [7]);
});
