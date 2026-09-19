/**
 * The hub's query keys and its per-page reads: one key shape, one status read.
 *
 *     node --test scripts/agent-hub-queries.test.mjs
 *
 * Three claims, each with the instrument that can actually falsify it.
 *
 * 1. THE KEY ONE SHAPE, PROVED BY MOUNTING THE HOOK. The list hook used to key
 *    its own inline array while `publicAgentKeys.list(page, perPage)` existed
 *    for callers — so the delist mutation invalidated a key no query was
 *    registered under, and a delisted agent stayed on the grid until its
 *    five-minute `staleTime` expired. This file used to register the cache
 *    ITSELF under the builder's key and then invalidate that, which pins "the
 *    builder and the invalidator agree" and NOT "the hook is registered under
 *    that builder's key": replacing the hook's `queryKey` with an unrelated
 *    prefix — a genuine regression, the delist invalidation no longer reaching
 *    it — left the file green (agent review round 1, R4). So the shipped hook is
 *    now MOUNTED against a real `QueryClient` and the key it registers is
 *    compared with the key the shipped builder produces.
 *
 * 2. THE PER-CARD FAN-OUT IS GONE. Asserted against the tree rather than by
 *    reading a diff: the hooks that issued one like-status, one favourite-status
 *    and three count reads per card must not exist, and no module may reference
 *    them. A frame cannot see this — the grid renders identically either way —
 *    which is why it is asserted here, and the request COUNTS live in
 *    `scripts/hub-round-trips.mjs`'s reading of a rendered page.
 *
 * 3. THE BATCHED READ IS ONE READ PER PAGE. Source-anchored for the parts a
 *    module cannot be asked in isolation (`refetchOnWindowFocus: false`, one
 *    call site per page, the op present in BOTH closed vocabularies) — stated
 *    plainly rather than dressed up as execution.
 *
 * WHAT IT DOES NOT PROVE: that the backend answers `agents.statuses` (the
 * local-operator PR carries that in `tests/e2e/test_desktop_radient_statuses.py`)
 * or that any of it renders (the frames and the round-trip reading do). The
 * mount below is jsdom, not a browser: it proves which key a query registers
 * and nothing about pixels.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const HOOKS_DIR = "src/renderer/src/features/agent-hub/hooks";
const read = (path) => readFileSync(path, "utf8");

/*
 * A bare regex literal cannot be hoisted out of these two call sites without
 * changing what they mean, and a literal inside a callback is what
 * `useTopLevelRegex` reports (agent review round 1, N2). Held once, at the top.
 */
/*
 * Source-anchored literals, held once at the top: a regex literal inside a
 * callback is what `useTopLevelRegex` reports, and hoisting it changes nothing
 * about what is asserted.
 */
const STATUS_IDS_ARE_SORTED = /\[\.\.\.new Set\(agentIds\)\]\.sort\(\)/;
const FOCUS_REFETCH_IS_OFF = /refetchOnWindowFocus: false/;
const STATUSES_OP = /"agents\.statuses"/;
const CARD_TAKES_STATUS = /status\?: AgentViewerStatus/;
const CARD_TAKES_UNKNOWN_STATE = /viewerStateKnown\?: boolean/;
const PER_CARD_READ = /useAgent(Like|Favourite|Download)(Count)?Query/;
const TS_OR_TSX = /\.tsx?$/;

// The shipped query module and its key builder, bundled in memory so the test
// runs the code the app runs rather than a restatement of its key shape.
const bundle = await build({
	stdin: {
		contents: `
			export { publicAgentKeys, invalidatePublicAgentLists, usePublicAgentsQuery } from "./src/renderer/src/features/agent-hub/hooks/use-public-agents-query";
			export { agentStatusKeys, patchAgentStatus } from "./src/renderer/src/features/agent-hub/hooks/use-agent-statuses-query";
			export { QueryClient } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	/*
	 * React and react-query are BUNDLED rather than left external. A data: URL
	 * cannot resolve a bare specifier, so an external `react` here fails at
	 * import time (ERR_INVALID_URL); the module never renders, so a second copy
	 * of React inside the bundle is harmless.
	 */
	write: false,
});
const source = bundle.outputFiles[0].text;
const load = () =>
	import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`
	);

/*
 * A SECOND bundle, written to disk rather than to a data: URL, because this one
 * is MOUNTED.
 *
 * A data: URL cannot resolve a bare specifier, so the bundle above has to carry
 * its own copy of React — harmless while nothing renders, and fatal the moment
 * something does: a component rendered by the TEST's `react-dom` while calling
 * that copy's hook dispatcher is an invalid hook call. Written to a file with
 * `packages: "external"` (the pattern `suggestion-stack-react.test.mjs` uses),
 * the component under test and the renderer share ONE React, one react-dom and
 * one react-query — which is what makes the mount below an execution of the
 * shipped hook rather than a restatement of its key shape.
 */
const mountBundle = await build({
	stdin: {
		contents: `
			export { publicAgentKeys, invalidatePublicAgentLists, usePublicAgentsQuery } from "./src/renderer/src/features/agent-hub/hooks/use-public-agents-query";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const mountPath = new URL(
	`./_agent-hub-queries-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(mountPath, mountBundle.outputFiles[0].text);
after(async () => {
	await unlink(mountPath).catch(() => {});
});

/*
 * The request the mounted hook makes, answered from the same envelope the
 * stories use. Stubbed rather than allowed to fail so the query settles as a
 * SUCCESS: the claim is about which key a query registers and which key an
 * invalidation reaches, and a rejected read would leave the same key registered
 * while making the output read like a transport failure.
 *
 * The stub COUNTS, because the mounted query is ACTIVE: React Query answers an
 * invalidation that reaches an active query by refetching it, which clears the
 * `isInvalidated` flag again before any assertion can read it. The count is the
 * observable effect, and it is the one that matters on screen — the delisted
 * agent leaves the grid because the page the hook registered is re-read.
 */
const stubTransport = (window) => {
	const requests = [];
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				return {
					status: 200,
					body: {
						result: {
							data: {
								msg: "Agents listed successfully",
								result: {
									page: 2,
									per_page: 12,
									total_pages: 3,
									total_records: 30,
									records: [],
								},
							},
						},
					},
				};
			},
		},
	};
	return requests;
};

/**
 * Mount the shipped list hook and hand back the query it registered.
 *
 * `filters` is passed through unchanged, so the assertion that follows compares
 * the key the HOOK registered with the key the shipped BUILDER produces — two
 * different modules, which is exactly the pair the old test could not hold
 * together.
 */
const mountListHook = async (filters) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	const previous = { window: globalThis.window, document: globalThis.document };
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	/*
	 * `act` reads this flag, and without it React only WARNS and then lets the
	 * effects flush on their own schedule — which is how a mount test becomes a
	 * race that passes locally and hangs in CI.
	 */
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const requests = stubTransport(dom.window);

	const { publicAgentKeys, invalidatePublicAgentLists, usePublicAgentsQuery } =
		await import(mountPath.href);
	const { QueryClient, QueryClientProvider } = await import(mountPath.href);
	/*
	 * react-dom/client feature-detects the DOM at import time, so it is imported
	 * here, after the document exists, rather than at module scope.
	 */
	const { createRoot } = await import("react-dom/client");

	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const Probe = () => {
		usePublicAgentsQuery(filters);
		return null;
	};
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(Probe),
			),
		);
	});
	return {
		publicAgentKeys,
		invalidatePublicAgentLists,
		queryClient,
		requests,
		teardown: async () => {
			await act(async () => root.unmount());
			/*
			 * `clear()`, not just unmount: React Query keeps a `gcTime` timer per
			 * cached query, so a client left holding one keeps the process alive for
			 * its full ten minutes and `node --test` waits for the event loop to
			 * drain. Measured: without this the file sat until the runner's own
			 * timeout, with every assertion inside it already passing.
			 */
			queryClient.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
};

const FILTERS = {
	page: 2,
	perPage: 12,
	categories: ["research"],
	name: undefined,
	description: undefined,
	sort: "download_count",
	order: "desc",
};

test("the list hook registers the key its own builder produces, and invalidation reaches it", async () => {
	const filters = FILTERS;
	const {
		publicAgentKeys,
		invalidatePublicAgentLists,
		queryClient,
		requests,
		teardown,
	} = await mountListHook(filters);

	try {
		const registered = queryClient.getQueryCache().getAll();
		assert.equal(
			registered.length,
			1,
			"mounting the list hook registers exactly one query",
		);
		/*
		 * THE ASSERTION THE OLD FORM COULD NOT MAKE. Changing the hook's
		 * `queryKey` to any other shape — the reviewer's mutation was an unrelated
		 * `["public-agent-list", …]` prefix — fails here, because this key comes
		 * from the hook that ran and the expected one from the shipped builder.
		 */
		assert.deepEqual(
			registered[0].queryKey,
			publicAgentKeys.list(filters),
			"the running hook keys itself with the builder's key, not one of its own",
		);
		assert.equal(registered[0].state.isInvalidated, false);

		/*
		 * And the delist path's invalidation reaches THAT query — the half that
		 * makes the key shape matter: a delisted agent stayed on the grid because
		 * the invalidation named a key nothing was registered under. The query is
		 * active, so the effect to read is the refetch it causes, not a flag React
		 * Query clears again on the way through.
		 */
		const before = requests.length;
		await act(async () => {
			await invalidatePublicAgentLists(queryClient);
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		assert.equal(
			requests.length,
			before + 1,
			"the delist path's invalidation reaches the list query the hook registered, and re-reads it",
		);
	} finally {
		await teardown();
	}
});

test("the list key builder is faithful, and stable across calls", async () => {
	const { publicAgentKeys } = await load();
	const key = publicAgentKeys.list(FILTERS);
	// Stable across calls, so a caller cannot build a key that matches by
	// accident and stop matching after a re-render.
	assert.deepEqual(publicAgentKeys.list({ ...FILTERS }), key);
	assert.notDeepEqual(
		publicAgentKeys.list({ ...FILTERS, page: 3 }),
		key,
		"a different page is a different entry",
	);
	// The categories array is joined into the key, so the same filters passed as
	// a fresh array are the same cache entry.
	assert.deepEqual(
		publicAgentKeys.list({ ...FILTERS, categories: ["research"] }),
		key,
	);
});

test("the batched status key carries the ids and is patched in place", async () => {
	const { agentStatusKeys, patchAgentStatus, QueryClient } = await load();
	const queryClient = new QueryClient();
	const ids = ["b", "a"];
	const key = agentStatusKeys.page(ids);
	queryClient.setQueryData(key, { a: { liked: false, favourited: false } });

	patchAgentStatus(queryClient, "a", { liked: true });

	assert.deepEqual(queryClient.getQueryData(key), {
		a: { liked: true, favourited: false },
	});
	// The key is a function of the ids it is HANDED. Normalising them is the
	// hook's job (`statusIds`), and it is deliberately in one place: the same
	// array feeds the key and the request, so a caller cannot key a sorted list
	// while fetching an unsorted one. These two assertions hold both halves —
	// the builder is faithful, and the hook is what makes it order-independent.
	assert.deepEqual(agentStatusKeys.page(["a", "b"]), [
		...agentStatusKeys.all,
		"page",
		["a", "b"],
	]);
	const hook = readFileSync(
		"src/renderer/src/features/agent-hub/hooks/use-agent-statuses-query.ts",
		"utf8",
	);
	assert.match(
		hook,
		STATUS_IDS_ARE_SORTED,
		"the hook sorts and de-duplicates the ids before keying or fetching them",
	);
});

test("the per-card fan-out's hooks are gone, and nothing references them", () => {
	const files = readdirSync(HOOKS_DIR);
	for (const gone of [
		"use-agent-like-query.ts",
		"use-agent-favourite-query.ts",
		"use-agent-like-count-query.ts",
		"use-agent-favourite-count-query.ts",
		"use-agent-download-count-query.ts",
	]) {
		assert.ok(
			!files.includes(gone),
			`${gone} still exists: it is one request per card per viewer`,
		);
	}

	// Both the hook and the component names, so a re-export or a rename cannot
	// reinstate the fan-out behind this test's back.
	const offenders = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = `${dir}/${entry.name}`;
			if (entry.isDirectory()) walk(path);
			else if (TS_OR_TSX.test(entry.name)) {
				const text = read(path);
				if (PER_CARD_READ.test(text)) {
					offenders.push(path);
				}
			}
		}
	};
	walk("src/renderer/src");
	assert.deepEqual(offenders, [], "no module reads a per-card status or count");
});

test("the page reads the viewer's state once, and never on window focus", () => {
	const page = read("src/renderer/src/features/agent-hub/agent-hub-page.tsx");
	assert.equal(
		page.split("useAgentStatusesQuery(").length - 1,
		1,
		"one batched read for the page",
	);
	const statuses = read(`${HOOKS_DIR}/use-agent-statuses-query.ts`);
	assert.match(
		statuses,
		FOCUS_REFETCH_IS_OFF,
		"the status read must not refire on focus while the list does not",
	);
	// The list is the other half of that pairing: a focus refetch there would
	// re-run the whole page read, which is the wave this change removes.
	const list = read(`${HOOKS_DIR}/use-public-agents-query.ts`);
	assert.match(list, FOCUS_REFETCH_IS_OFF);
	// And the counts are folded from the record rather than fetched per card.
	const card = read(
		"src/renderer/src/features/agent-hub/components/agent-card.tsx",
	);
	for (const field of ["like_count", "favourite_count", "download_count"]) {
		assert.match(
			card,
			new RegExp(`agent\\.${field}`),
			`${field} comes from the record`,
		);
	}
	assert.match(
		read(
			"src/renderer/src/features/agent-hub/components/agent-card-container.tsx",
		),
		CARD_TAKES_STATUS,
		"the card receives the viewer's state instead of reading it",
	);
	/*
	 * And it is TOLD WHEN THAT STATE IS UNKNOWN, which is the R1 fix: the
	 * container's `?? false` rendered a failed or partial status read as "you
	 * have not liked this" on every card at once, so a revert to spreading the
	 * map with a default fails here rather than only in a re-captured frame.
	 */
	assert.match(
		read(
			"src/renderer/src/features/agent-hub/components/agent-card-container.tsx",
		),
		CARD_TAKES_UNKNOWN_STATE,
		"the card is told whether the viewer's state was actually read",
	);
});

test("the batched op is in both closed vocabularies the request passes through", () => {
	// The renderer's own union, and the zod schema that validates the request the
	// preload bridge carries. An op in one and not the other is a request that
	// never leaves the renderer.
	assert.match(
		read("src/renderer/src/shared/api/radient/proxy.ts"),
		STATUSES_OP,
	);
	assert.match(read("src/shared/desktop-contract.ts"), STATUSES_OP);
});
