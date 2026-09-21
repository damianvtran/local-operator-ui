import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The authoring lists' consumer of the `authoring` frame: `useProfiles` and
 * `useTeams` refreshing themselves when the backend says the authoring catalogue
 * moved.
 *
 * WHY THIS FILE EXISTS. The defect it guards against is invisible to every other
 * instrument in this repository: a team an AGENT created is written on the
 * backend, with no click in this window, no focus change and no navigation - so
 * nothing in the renderer has a reason to re-read `teams.list`, and the row stays
 * off screen until the operator reloads or switches tab. The frame is the whole
 * fix, and the frame is only half of it: the backend can publish revisions that
 * nobody invalidates on for the rest of time and every existing test stays green,
 * because the sidebar's own invalidation effect is keyed on the SESSIONS
 * catalogue and would refetch the session list on a frame that never mentioned a
 * team.
 *
 * WHAT IT PINS, and why each case is separate:
 *
 *   1. no frame at all -> no invalidation, which is the older-backend case: the
 *      frame is never published, `authoringRevision` stays null, and the lists
 *      behave exactly as they did before this change;
 *   2. one frame -> exactly one invalidation per key set, and the key set is
 *      BOTH the list and the singular prefix. The singular is asserted separately
 *      because prefix matching is element-wise: `["desktop", "profiles"]` does
 *      not cover `["desktop", "profile", name]`, so an implementation that
 *      invalidated only the list key would leave the detail entry - the profile
 *      `agents-page.tsx` is displaying - rendering a value an agent has since
 *      changed or deleted;
 *   3. the null baseline is a real case rather than the absence of one, because
 *      the FIRST render always sees it: a guard that treated "null" as "revision
 *      zero" would invalidate on every mount and turn this event into a poll;
 *   4. a duplicate delivery of the same revision is free. The frame is a LEVEL,
 *      and a re-connect or a re-subscribe can hand the same revision over twice
 *      while a re-render can re-run the effect; acting on the value rather than
 *      on the arrival is what keeps that from being a second refetch of a list
 *      nothing changed in.
 *
 * WHAT THIS FILE IS NOT: evidence that a row appears on screen without a refresh.
 * That is a claim about a rendered list, and it is answered by the frames on the
 * pull request, taken while the app sat on the sidebar and the profile was
 * created over the backend API from a shell.
 *
 * The hook is bundled and driven through a React stand-in rather than rendered -
 * the same instrument `desktop-watch-lease.test.mjs` and
 * `session-status-feed.test.mjs` use - because what is asserted is the CALL the
 * shipped hook makes to the query cache: `useDesktopFeed` (the transport) and
 * `useQueryClient` (the cache) are the two seams, and everything else in the
 * bundle is the shipped module.
 */

const reactStandIn = `
let cells = [];
const slot = () => {
	/*
	 * The cursor lives on globalThis so the harness can start a render pass at
	 * slot 0: cells persist ACROSS renders (which is what makes a re-render a
	 * re-render - a ref keeps the value it was given, and an effect with
	 * unchanged deps does not run) while the cursor restarts for every pass.
	 * A module-local cursor would hand each render a fresh set of cells, and a
	 * useRef initialised to the CURRENT revision then never latches - which is
	 * exactly the harness bug this comment exists so nobody re-introduces.
	 */
	const index = globalThis.__cursor++;
	if (!cells[index]) cells[index] = {};
	return cells[index];
};
export const useEffect = (fn, deps) => {
	const cell = slot();
	const changed =
		!cell.deps ||
		!deps ||
		cell.deps.length !== deps.length ||
		cell.deps.some((value, index) => !Object.is(value, deps[index]));
	if (changed) {
		cell.deps = deps;
		globalThis.__effects.push(fn);
	}
};
export const useLayoutEffect = useEffect;
export const useInsertionEffect = () => {};
export const useState = (init) => {
	const cell = slot();
	if (!("state" in cell)) cell.state = typeof init === "function" ? init() : init;
	return [cell.state, (next) => { cell.state = typeof next === "function" ? next(cell.state) : next; }];
};
export const useRef = (init) => {
	const cell = slot();
	if (!("ref" in cell)) cell.ref = { current: init };
	return cell.ref;
};
export const useCallback = (fn) => fn;
export const useMemo = (fn) => fn();
export const useSyncExternalStore = () => undefined;
export const useDebugValue = () => {};
export const createElement = () => null;
export const Fragment = Symbol("fragment");
/*
 * A fresh component instance, which every case needs: the cells ARE the hook
 * instance's state, so a test that reused them would inherit the ref the
 * previous case latched - and the duplicate-delivery case would then pass by
 * accident rather than by the guard it is about.
 */
export const __resetCells = () => {
	cells = [];
	globalThis.__cursor = 0;
};
export default { useEffect, useLayoutEffect, useInsertionEffect, useState, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment };
`;

const bundle = await build({
	stdin: {
		contents:
			'export { useProfiles, useTeams } from "./src/renderer/src/shared/api/local-operator/profile-hooks";' +
			' export { __resetCells } from "@react-stand-in";',
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
			name: "authoring-refresh-fixture",
			setup(builder) {
				/*
				 * The transport, which is not this file's subject: `desktopResult`
				 * is the network and the query never runs here (the `useQuery` stub
				 * below answers instead). Keyed on the importer being profile-hooks,
				 * so `desktop-api` imported by anything else in the graph keeps the
				 * real module.
				 */
				builder.onResolve({ filter: /\.\/desktop-api$/ }, (args) =>
					/local-operator\/profile-hooks\.ts$/.test(args.importer)
						? { path: "transport", namespace: "authoring-fixture" }
						: undefined,
				);
				builder.onResolve({ filter: /\.\/backend-error$/ }, (args) =>
					/local-operator\/profile-hooks\.ts$/.test(args.importer)
						? { path: "transport", namespace: "authoring-fixture" }
						: undefined,
				);
				/*
				 * The feed, stubbed to the ONE value this file steers: the hook under
				 * test is a CONSUMER of the revision, and its own branch is pinned by
				 * `session-status-feed.test.mjs` and `desktop-feed.test.mjs`. Driving
				 * the real feed here would make a transport failure and a consumer
				 * failure look identical.
				 */
				builder.onResolve(
					{ filter: /^@shared\/hooks\/use-desktop-feed$/ },
					() => ({ path: "feed", namespace: "authoring-fixture" }),
				);
				/*
				 * `useQueryClient` is stubbed because it needs a provider this harness
				 * does not build, and it is the seam under assertion: every call it is
				 * handed is recorded, in order. `useQuery` answers with an inert result
				 * so the hook renders without a cache.
				 */
				builder.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({
					path: "react-query",
					namespace: "authoring-fixture",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "authoring-fixture" },
					(args) => ({
						contents: {
							transport: `export class DesktopControlError extends Error {}
export class UserFacingError extends Error {}
export const userFacingMessage = (error) => String(error?.message ?? error);
export const retryDesktopQuery = () => false;
export const desktopResult = async () => { throw new Error("the query must not run in this harness"); };`,
							feed: "export const useDesktopFeed = () => ({ available: true, connected: true, catalogueRevision: null, authoringRevision: globalThis.__revision });",
							"react-query": `export const useQueryClient = () => globalThis.__queryClient;
export const useQuery = (options) => {
	globalThis.__queryKeys.push(options.queryKey);
	return { data: undefined, error: null, isLoading: false };
};`,
						}[args.path],
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
				/*
				 * Its OWN namespace: esbuild takes the first onLoad whose filter and
				 * namespace match, so a second handler in `authoring-fixture` would
				 * never be reached and the react import would resolve to one of the
				 * stubs above.
				 */
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "authoring-react",
				}));
				// The harness reaches the stand-in's own reset through a specifier of its
				// own, so the fixture never has to be resolved as a real package name.
				builder.onResolve({ filter: /^@react-stand-in$/ }, () => ({
					path: "react",
					namespace: "authoring-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "authoring-react" }, () => ({
					contents: reactStandIn,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});
const { useProfiles, useTeams, __resetCells } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** Every `invalidateQueries` call the shipped hook made, in order. */
globalThis.__invalidations = [];
globalThis.__queryKeys = [];
globalThis.__queryClient = {
	invalidateQueries: (options) => {
		globalThis.__invalidations.push(options.queryKey);
		return Promise.resolve();
	},
};
/** The revision the stubbed feed publishes, as the hook's render reads it. */
globalThis.__revision = null;
globalThis.__effects = [];

/**
 * One render of the agents page's two list hooks, then a commit of the effects
 * the render recorded.
 *
 * Both hooks are rendered together because that is how the page mounts them
 * (`agents-page.tsx`: `useProfiles(enabled && !teamMode)` beside
 * `useTeams(enabled && teamMode)`, one of them disabled), and the claim under
 * test is per key set: the revision arrives once and TWO lists must each refresh
 * their own.
 */
function render() {
	globalThis.__cursor = 0;
	globalThis.__effects = [];
	useProfiles(true);
	useTeams(true);
	return globalThis.__effects.splice(0);
}

/** Commit the effects a render recorded, the way React would after paint. */
function commit(effects) {
	for (const effect of effects) effect();
}

/**
 * A fresh instance of the page's two hooks at the null baseline, committed.
 *
 * Every case starts here, because the stand-in's cells hold the instance's state
 * and the ref that makes a duplicate delivery free: reusing them would let one
 * case inherit the revision the previous one latched.
 */
function freshMount() {
	__resetCells();
	globalThis.__revision = null;
	return render();
}

const PROFILES = ["desktop", "profiles"];
const PROFILE = ["desktop", "profile"];
const TEAMS = ["desktop", "teams"];
const TEAM = ["desktop", "team"];

test("no frame means no invalidation at all", () => {
	globalThis.__invalidations = [];
	// The mount, which is the only render an older backend ever produces.
	commit(freshMount());
	assert.deepEqual(
		globalThis.__invalidations,
		[],
		"a backend that never publishes the frame changes nothing",
	);
});

test("one frame invalidates each list and its detail prefix exactly once", () => {
	globalThis.__invalidations = [];
	commit(freshMount());
	assert.deepEqual(globalThis.__invalidations, []);

	// The frame: the feed hands the hook a revision, and the hooks re-render with
	// it. Both lists own their own refresh, so both key sets must be invalidated -
	// one of the two hooks doing it would leave half the sidebar's authoring
	// surface stale.
	globalThis.__revision = 4;
	commit(render());
	assert.deepEqual(
		globalThis.__invalidations,
		[PROFILES, PROFILE, TEAMS, TEAM],
		"each list key AND its singular detail prefix, once each",
	);
	// The singular prefix is what covers an entry the page is displaying
	// (`["desktop", "profile", name]`): element-wise prefix matching means the
	// list key does not reach it, which is why it is invalidated on its own.
	assert.deepEqual(globalThis.__invalidations.slice(0, 2), [PROFILES, PROFILE]);
});

test("the null baseline invalidates nothing, however many times it renders", () => {
	globalThis.__invalidations = [];
	commit(freshMount());
	// A re-render with the baseline still in place - a capability poll answering,
	// the window regaining focus - must not be mistaken for a revision zero.
	globalThis.__revision = null;
	commit(render());
	commit(render());
	assert.deepEqual(globalThis.__invalidations, []);
});

test("a duplicate delivery of the same revision invalidates once", () => {
	globalThis.__invalidations = [];
	commit(freshMount());
	globalThis.__revision = 4;
	const frame = render();
	commit(frame);
	assert.equal(globalThis.__invalidations.length, 4);

	/*
	 * The re-delivery. A reconnect can hand the same revision over again, and the
	 * effect it reaches is the one recorded above - so the guard is the revision
	 * the hook last ACTED on rather than the arrival. Run it twice more and the
	 * assertion is the count, not the shape: a refetch per delivery is a list
	 * re-read on every reconnect, which is the poll this frame exists instead of.
	 */
	commit(frame);
	commit(frame);
	assert.equal(
		globalThis.__invalidations.length,
		4,
		"the same revision is not a change",
	);

	// And the next real revision is still acted on: a guard that latched shut
	// after the first frame would pass the assertion above and fail this one.
	globalThis.__revision = 5;
	commit(render());
	assert.equal(globalThis.__invalidations.length, 8);
	assert.deepEqual(globalThis.__invalidations.slice(4), [
		PROFILES,
		PROFILE,
		TEAMS,
		TEAM,
	]);
});

/*
 * The half the effects cannot show: this change adds an EVENT, not a timer, and
 * the baseline refresh rate must not move with it.
 *
 * A source assertion, in the shape `desktop-feed.test.mjs` uses for the poll it
 * replaced. What it pins is the rule the frame is being added under: whatever
 * happens here, the two hooks keep their `staleTime` (the freshness window a
 * mount and a window focus read), nothing in the renderer gains an interval, and
 * the invalidation is not smuggled into the route-scoped sidebar - which is
 * mounted by the chat page and would therefore miss `/agents`, the page these
 * lists live on.
 */
test("the refresh is an event, not a timer, and it does not live in the sidebar", () => {
	const hooks = readFileSync(
		"src/renderer/src/shared/api/local-operator/profile-hooks.ts",
		"utf8",
	);
	assert.equal(
		hooks.split("staleTime: 10_000").length - 1,
		2,
		"both hooks keep the freshness window they had: this change adds no cadence",
	);
	assert.ok(
		!hooks.includes("setInterval"),
		"an event-driven refresh adds no timer of its own",
	);
	assert.ok(
		hooks.includes("useAuthoringRefresh("),
		"the invalidation is owned by the query's own hook",
	);
	const sidebar = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	assert.ok(
		!sidebar.includes("authoringRevision"),
		"the sidebar is route-scoped and must not own this refresh: /agents would miss it",
	);
});
