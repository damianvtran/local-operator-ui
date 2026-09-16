/**
 * The sidebar must not lose its chats and teams, and the gate must heal without
 * the operator touching the window.
 *
 * THE REPORT. "Sometimes all the active chats and teams in the UI disappear and
 * it needs a refresh; it happens after a while of use, maybe under load; after
 * sitting a while they come back on their own."
 *
 * The decision the report is about is a handful of booleans wide - including the
 * SENTENCE the sidebar shows, which lives in the same module for exactly this
 * reason - so it is pinned here by driving those inputs rather than by asserting
 * against the component's source text. The gate lives in
 * `sidebar-catalogue-gate.ts` and the re-negotiation cadence in
 * `useDesktopCapabilities`, and both are the SHIPPED modules, bundled in memory.
 * Two substitutions, both of them the boundary rather than the behaviour:
 *
 *   - `@tanstack/react-query` becomes a recorder, because the thing under test is
 *     the options this hook hands the query - the interval, the background flag
 *     and the condition that ends it - and there is no query client in this
 *     process to observe them from outside;
 *   - nothing else is faked. `desktopResult` and the contract are the real ones.
 *
 * What is NOT here: that the component MOUNTS what the gate returns. That is the
 * rendered frames' job (`docs/evidence/daemon-attach-live-app`, and the
 * connectivity set), and the two are meant to be read together - this file says
 * the decision is right, the frames say it looks right. Every case below is now
 * input-driven: the two that used to assert on the component's source text
 * (review round 2, NIT-3) are gone, and the decisions they were guarding - the
 * sentence, its suppression when the store's own alert is up, and the memory of a
 * gate that was open - are asserted here instead.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

/*
 * The regex literals this module uses, hoisted to the top level: the
 * `useTopLevelRegex` rule charges a literal constructed inside a function, and
 * `scripts/` is outside `pnpm lint`'s path list, so this tree's own gate
 * (`pnpm lint:scripts`) is the only thing that would have said so.
 */
const RE_TANSTACK_REACT_QUERY = /^@tanstack\/react-query$/;
const RE_REACT_QUERY = /^react-query$/;
const RE_CANNOT_USE_THE_BACKEND_S_DESKTOP =
	/cannot use the backend's desktop controls/;
const RE_SHOWING_THE_LAST_CHATS_AND_TEAMS =
	/Showing the last chats and teams that loaded\./;
const RE_UPDATE_THE_BACKEND = /Update the backend/;
const RE_LAST_CHATS_AND_TEAMS_THAT_LOADED = /last chats and teams that loaded/;
const RE_UPDATE_THE_BACKEND_TO_USE_CANONICAL =
	/^Update the backend to use canonical chats\./;

const gateBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/sidebar-catalogue-gate";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { catalogueGate } = await import(
	`data:text/javascript;base64,${Buffer.from(gateBundle.outputFiles[0].text).toString("base64")}`
);

/** Records what `useDesktopCapabilities` asks React Query for. */
const CAPTURE_KEY = "__sidebarGateTestUseQuery";

const hookBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/api/local-operator/desktop-hooks";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "react-query-recorder",
			setup(builder) {
				builder.onResolve({ filter: RE_TANSTACK_REACT_QUERY }, () => ({
					path: "react-query",
					namespace: "fixture",
				}));
				builder.onLoad(
					{ filter: RE_REACT_QUERY, namespace: "fixture" },
					() => ({
						contents: `
							export const useQuery = (options) => {
								globalThis.${CAPTURE_KEY} = options;
								return { data: undefined, error: null, refetch: () => {} };
							};
						`,
						loader: "js",
					}),
				);
			},
		},
	],
});
const {
	useDesktopCapabilities,
	CAPABILITY_RENEGOTIATE_MS,
	CAPABILITY_WATCH_MS,
} = await import(
	`data:text/javascript;base64,${Buffer.from(hookBundle.outputFiles[0].text).toString("base64")}`
);

/**
 * The inputs, one per fact, with a healthy default. `planeAvailable` is what the
 * answer advertised (`desktop_available`), `storeFailed` is the store's own read
 * having failed, and `rows` is what the canonical store holds right now.
 */
const inputs = (over = {}) => ({
	ready: true,
	failed: false,
	answered: true,
	wasReady: true,
	rows: 12,
	storeFailed: false,
	planeAvailable: true,
	coveredByCompatibilityBanner: false,
	...over,
});

test("a ready gate shows the list and claims nothing about the past", () => {
	assert.deepEqual(catalogueGate(inputs()), {
		withdrawn: false,
		stale: false,
		showList: true,
		lastKnownRows: false,
		notice: null,
	});
});

test("an answer that WITHDRAWS the gate keeps the list mounted, marked stale", () => {
	// The reported bug, in one call: `ready` false, no error, an answer in hand.
	// Before the withdrawn case existed this produced `showList: false`, and every
	// block in the sidebar - agents, teams, chats - unmounted at once with no
	// `role="alert"` anywhere.
	const gate = catalogueGate(inputs({ ready: false, planeAvailable: false }));
	assert.equal(gate.withdrawn, true);
	assert.equal(gate.stale, true);
	assert.equal(gate.showList, true, "the list must never disappear silently");
	assert.equal(gate.lastKnownRows, true);
});

test("one statement per condition: the banner's condition silences the gate's", () => {
	// Design round 1, D3 with review round 2 MINOR-2 and QA round 1 Q-5. In the
	// frames that carried both, the full-bleed banner and this sentence said the
	// same thing 40px apart, each with a `Retry`, and the remedies disagreed - the
	// banner told the operator to restart the app while this app was recovering on
	// its own. The gate still keeps the rows; it just does not speak over a
	// statement that is already on screen.
	const covered = catalogueGate(
		inputs({
			ready: false,
			planeAvailable: false,
			coveredByCompatibilityBanner: true,
		}),
	);
	assert.equal(
		covered.showList,
		true,
		"suppressing the sentence keeps the list",
	);
	assert.equal(covered.notice, null, "the banner is already saying this");

	// And the sentence itself, for a condition the banner is NOT carrying: a
	// backend that advertises every required feature but not the catalogue.
	const uncovered = catalogueGate(
		inputs({
			ready: false,
			planeAvailable: false,
			coveredByCompatibilityBanner: false,
		}),
	);
	assert.match(
		uncovered.notice ?? "",
		RE_CANNOT_USE_THE_BACKEND_S_DESKTOP,
		"a plane that is unavailable is not a backend to update",
	);
	assert.match(uncovered.notice ?? "", RE_SHOWING_THE_LAST_CHATS_AND_TEAMS);
});

test("the error arm behaves exactly as it did", () => {
	const gate = catalogueGate(inputs({ ready: false, failed: true }));
	assert.equal(gate.withdrawn, false);
	assert.equal(gate.stale, true);
	assert.equal(gate.showList, true);
	assert.equal(
		gate.notice,
		null,
		"a failed query has its own alert and its own message; this one is silent",
	);
});

test("a first load that never opened the gate is not stale, and names the update", () => {
	// A first run against an older backend: no rows were ever loaded, so there is
	// nothing to keep, and saying otherwise would be a stale claim about a list that
	// never existed. The sentence is still owed - it is the one actionable thing
	// here, and it is what the pre-refactor component rendered on this path.
	const gate = catalogueGate(
		inputs({ ready: false, wasReady: false, rows: 0 }),
	);
	assert.equal(gate.stale, false);
	assert.equal(gate.showList, false);
	assert.equal(
		gate.notice,
		"Update the backend to use canonical chats. Existing histories are unchanged.",
	);
});

test("a first load that cannot use the plane says so instead of naming an update", () => {
	// The same path with `desktop_available: false`: nothing here would be fixed by
	// updating the backend, so the sentence must not promise that (review round 1,
	// F-3's class, one state over).
	const gate = catalogueGate(
		inputs({ ready: false, wasReady: false, rows: 0, planeAvailable: false }),
	);
	assert.equal(gate.showList, false);
	assert.match(gate.notice ?? "", RE_CANNOT_USE_THE_BACKEND_S_DESKTOP);
	assert.doesNotMatch(gate.notice ?? "", RE_UPDATE_THE_BACKEND);
});

test("a store that genuinely emptied still reads as empty", () => {
	// The requirement the fix must not overrun: keeping last-known ROWS is not a
	// licence to claim rows. With nothing in the store the list stays mounted
	// (the gate is what it is) and says nothing about last-known anything, so the
	// empty state below it is the store's own answer.
	const gate = catalogueGate(inputs({ ready: false, rows: 0 }));
	assert.equal(
		gate.stale,
		true,
		"the gate was open, so the state is still stale",
	);
	assert.equal(gate.showList, true);
	assert.equal(gate.lastKnownRows, false);
	assert.doesNotMatch(gate.notice ?? "", RE_LAST_CHATS_AND_TEAMS_THAT_LOADED);
});

test("a mount that lost its own memory keeps the rows the store still holds", () => {
	// Review round 2, MINOR-3: `wasReady` is a per-mount ref while `sessions` is a
	// module store, so a remount during a withdrawal (navigate away and back while
	// the plane is unavailable) has to read the rows as the memory it lost. They are
	// the same fact: a row exists only because a `sessions.list` through an OPEN
	// gate put it there, and `sessions` is not persisted.
	const gate = catalogueGate(
		inputs({ ready: false, wasReady: false, rows: 12, planeAvailable: false }),
	);
	assert.equal(gate.stale, true);
	assert.equal(
		gate.showList,
		true,
		"a remount must not hide rows the app holds",
	);
	assert.equal(gate.lastKnownRows, true);
});

test("the store's own failure suppresses the gate sentence (the D9 rule)", () => {
	// Review round 2, MINOR-2 / QA round 1, Q-5: the store's alert at the foot of
	// the sidebar already says the read failed and offers a refresh, so a flapping
	// backend - the operator's reported condition - must not stack a warning about
	// the gate above a danger about the read. The gate keeps its list either way.
	const gate = catalogueGate(
		inputs({ ready: false, storeFailed: true, planeAvailable: false }),
	);
	assert.equal(gate.showList, true);
	assert.equal(gate.stale, true);
	assert.equal(
		gate.notice,
		null,
		"one statement about one backend is the file's own rule (D9)",
	);
});

test("the version half keeps the remedy that exists", () => {
	// A plane that IS available and merely does not advertise the catalogue is a
	// backend to update, and that is the one place "Update the backend" is true.
	const gate = catalogueGate(inputs({ ready: false, planeAvailable: true }));
	assert.match(gate.notice ?? "", RE_UPDATE_THE_BACKEND_TO_USE_CANONICAL);
});

test("the capabilities query watches the open plane, and re-negotiates a shut one", () => {
	useDesktopCapabilities();
	const options = globalThis[CAPTURE_KEY];
	assert.ok(options, "the hook must hand React Query an options object");
	assert.deepEqual(
		options.queryKey,
		["desktop", "capabilities"],
		"this must be the capabilities query and not a neighbour's options",
	);
	assert.equal(
		options.refetchIntervalInBackground,
		true,
		"the recovery may not pause when nothing is focused, or it needs the operator back",
	);

	const interval = options.refetchInterval;
	assert.equal(typeof interval, "function");
	/*
	 * Both cadences, and why the open state has one at all: a withdrawal is
	 * announced by nothing else the renderer holds - main's status stays attached
	 * while the backend starts refusing this app's desktop calls - so a query that
	 * only polls once the plane is SHUT can never learn that it shut. Measured in
	 * the frame rig before this change: the withdrawal produced no re-ask at all
	 * and the two frames came out byte-identical.
	 */
	assert.equal(
		interval({ state: { data: { desktop_available: true } } }),
		CAPABILITY_WATCH_MS,
		"an open plane is watched, slowly, because nothing else reports the close",
	);
	assert.ok(
		CAPABILITY_WATCH_MS > CAPABILITY_RENEGOTIATE_MS,
		"the watch is the slow cadence, the re-negotiation the fast one",
	);
	assert.equal(
		interval({ state: { data: { desktop_available: false } } }),
		CAPABILITY_RENEGOTIATE_MS,
		"a daemon this app holds no token for is exactly the state to re-ask about",
	);
	assert.equal(
		interval({ state: { data: undefined } }),
		CAPABILITY_RENEGOTIATE_MS,
		"the failing arm is the other half of the same freeze",
	);
});
