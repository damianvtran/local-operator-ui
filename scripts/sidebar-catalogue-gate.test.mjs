/**
 * The sidebar must not lose its chats and teams, and the gate must heal without
 * the operator touching the window.
 *
 * THE REPORT. "Sometimes all the active chats and teams in the UI disappear and
 * it needs a refresh; it happens after a while of use, maybe under load; after
 * sitting a while they come back on their own."
 *
 * The decision the report is about is four booleans wide, so it is pinned here by
 * driving those booleans rather than by asserting against the component's source
 * text: the gate lives in `sidebar-catalogue-gate.ts` and the re-negotiation
 * cadence in `useDesktopCapabilities`, and both are the SHIPPED modules, bundled
 * in memory. Two substitutions, both of them the boundary rather than the
 * behaviour:
 *
 *   - `@tanstack/react-query` becomes a recorder, because the thing under test is
 *     the options this hook hands the query - the interval, the background flag
 *     and the condition that ends it - and there is no query client in this
 *     process to observe them from outside;
 *   - nothing else is faked. `desktopResult` and the contract are the real ones.
 *
 * What is NOT here: that the sidebar renders what the gate says. That is the
 * rendered frames' job (`docs/evidence/daemon-attach-live-app`, and the sidebar
 * story in the connectivity set), and the two are meant to be read together -
 * this file says the decision is right, the frames say it looks right.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

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
				builder.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({
					path: "react-query",
					namespace: "fixture",
				}));
				builder.onLoad(
					{ filter: /^react-query$/, namespace: "fixture" },
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
const { useDesktopCapabilities, CAPABILITY_RENEGOTIATE_MS } = await import(
	`data:text/javascript;base64,${Buffer.from(hookBundle.outputFiles[0].text).toString("base64")}`
);

const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const sidebar = readFileSync(join(ROOT, SIDEBAR), "utf8");

/** The four inputs, one per fact, with a healthy default. */
const inputs = (over = {}) => ({
	ready: true,
	failed: false,
	answered: true,
	wasReady: true,
	rows: 12,
	...over,
});

test("a ready gate shows the list and claims nothing about the past", () => {
	assert.deepEqual(catalogueGate(inputs()), {
		withdrawn: false,
		stale: false,
		showList: true,
		lastKnownRows: false,
	});
});

test("an answer that WITHDRAWS the gate keeps the list mounted, marked stale", () => {
	// The reported bug, in one call: `ready` false, no error, an answer in hand.
	// Before the withdrawn case existed this produced `showList: false`, and every
	// block in the sidebar - agents, teams, chats - unmounted at once with no
	// `role="alert"` anywhere.
	const gate = catalogueGate(inputs({ ready: false }));
	assert.equal(gate.withdrawn, true);
	assert.equal(gate.stale, true);
	assert.equal(gate.showList, true, "the list must never disappear silently");
	assert.equal(gate.lastKnownRows, true);
});

test("the error arm behaves exactly as it did", () => {
	const gate = catalogueGate(inputs({ ready: false, failed: true }));
	assert.equal(gate.withdrawn, false);
	assert.equal(gate.stale, true);
	assert.equal(gate.showList, true);
});

test("a first load that never opened the gate is not stale", () => {
	// A first run against an older backend: no rows were ever loaded, so there is
	// nothing to keep, and saying otherwise would be a stale claim about a list
	// that never existed.
	const gate = catalogueGate(
		inputs({ ready: false, wasReady: false, rows: 0 }),
	);
	assert.equal(gate.stale, false);
	assert.equal(gate.showList, false);
});

test("a store that genuinely emptied still reads as empty", () => {
	// The requirement the fix must not overrun: keeping last-known ROWS is not a
	// licence to claim rows. With nothing in the store the list stays mounted
	// (the gate is what it is) and says nothing about last-known anything, so the
	// empty state below it is the store's own answer.
	const gate = catalogueGate(inputs({ ready: false, rows: 0 }));
	assert.equal(gate.showList, true);
	assert.equal(gate.lastKnownRows, false);
});

test("the sidebar decides its list from the gate module, not a second rule", () => {
	// The gate is the only place the three consequences are decided. A reader that
	// re-derives `ready || stale` here would be the second idiom this file exists
	// to prevent, and it would not see the withdrawn case.
	assert.match(
		sidebar,
		/const \{ stale, showList, lastKnownRows \} = catalogueGate\(\{/,
		"the sidebar must take all three consequences from `catalogueGate`",
	);
	assert.doesNotMatch(
		sidebar,
		/const showList = ready \|\| stale/,
		"the old two-input rule must not survive beside the module",
	);
});

test("teams says it is loading, as agents already did", () => {
	// The asymmetry the report's evidence names: profiles had a line for the
	// window between mounting its section and having data, teams had none, so an
	// empty teams section was indistinguishable from an absent one.
	const at = sidebar.indexOf("{teams.data?.map(");
	assert.ok(at > 0, "the teams list must still render from its query's rows");
	const before = sidebar.slice(Math.max(0, at - 600), at);
	assert.match(before, /Loading teams…/, "teams needs its own loading line");
});

test("the capabilities query re-negotiates while the plane is shut, and stops", () => {
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
	assert.equal(
		interval({ state: { data: { desktop_available: true } } }),
		false,
		"an answer that opens the plane ends the re-negotiation",
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
