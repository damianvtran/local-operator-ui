/**
 * The hub's query keys and its per-page reads: one key shape, one status read.
 *
 *     node --test scripts/agent-hub-queries.test.mjs
 *
 * Three claims, each with the instrument that can actually falsify it.
 *
 * 1. THE KEY SHAPE IS ONE SHAPE, PROVED BY INVALIDATING A REAL CACHE. The list
 *    hook used to key its own inline array while `publicAgentKeys.list(page,
 *    perPage)` existed for callers — so the delist mutation invalidated a key no
 *    query was registered under, and a delisted agent stayed on the grid until
 *    its five-minute `staleTime` expired. Here the shipped hook module is
 *    bundled, a real `QueryClient` is populated under the key the hook's builder
 *    produces, and the shipped invalidation helper is run against it. A key
 *    shape that stops matching fails this file.
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
 * or that any of it renders (the frames and the round-trip reading do).
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const HOOKS_DIR = "src/renderer/src/features/agent-hub/hooks";
const read = (path) => readFileSync(path, "utf8");

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

const FILTERS = {
	page: 2,
	perPage: 12,
	categories: ["research"],
	name: undefined,
	description: undefined,
	sort: "download_count",
	order: "desc",
};

test("the list's key is built from one shape, and invalidating it reaches the query", async () => {
	const { publicAgentKeys, invalidatePublicAgentLists, QueryClient } =
		await load();
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	// A page fetched exactly as the hook would have fetched it: the hook's own
	// builder is the only thing that decides this key.
	const key = publicAgentKeys.list(FILTERS);
	queryClient.setQueryData(key, { msg: "ok", result: { records: [] } });

	const registered = queryClient.getQueryCache().find({ queryKey: key });
	assert.ok(registered, "the key the hook builds registers a query");
	assert.equal(registered.state.isInvalidated, false);

	await invalidatePublicAgentLists(queryClient);

	const after = queryClient.getQueryCache().find({ queryKey: key });
	assert.equal(
		after?.state.isInvalidated,
		true,
		"the delist path's invalidation reaches the key the list query uses",
	);
	// And the shape is stable across calls, so a caller cannot build a key that
	// matches by accident and stop matching after a re-render.
	assert.deepEqual(publicAgentKeys.list({ ...FILTERS }), key);
	assert.notDeepEqual(
		publicAgentKeys.list({ ...FILTERS, page: 3 }),
		key,
		"a different page is a different entry",
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
		/\[\.\.\.new Set\(agentIds\)\]\.sort\(\)/,
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
			else if (/\.tsx?$/.test(entry.name)) {
				const text = read(path);
				if (/useAgent(Like|Favourite|Download)(Count)?Query/.test(text)) {
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
		/refetchOnWindowFocus: false/,
		"the status read must not refire on focus while the list does not",
	);
	// The list is the other half of that pairing: a focus refetch there would
	// re-run the whole page read, which is the wave this change removes.
	const list = read(`${HOOKS_DIR}/use-public-agents-query.ts`);
	assert.match(list, /refetchOnWindowFocus: false/);
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
		/status\?: AgentViewerStatus/,
		"the card receives the viewer's state instead of reading it",
	);
});

test("the batched op is in both closed vocabularies the request passes through", () => {
	// The renderer's own union, and the zod schema that validates the request the
	// preload bridge carries. An op in one and not the other is a request that
	// never leaves the renderer.
	assert.match(
		read("src/renderer/src/shared/api/radient/proxy.ts"),
		/"agents\.statuses"/,
	);
	assert.match(read("src/shared/desktop-contract.ts"), /"agents\.statuses"/);
});
