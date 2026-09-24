/**
 * The provider grid's three presentation rules, asserted rather than restated.
 *
 * Code round 1 (R1-2) found that this diff introduced rules nothing could
 * regress-detect: the pin, the query rule, and the step's panel measure. All
 * three are cheap to check in the harness the repo already has
 * (`backend-error-surfaces.test.mjs` renders the real `ProviderGrid` against a
 * real `QueryClient`), so they are checked here.
 *
 * WHAT THIS FILE CANNOT SEE, stated so a green run is not read as more than it
 * is: this is `renderToStaticMarkup` with no DOM, so there is no typing and no
 * focus. A state a reader reaches by typing cannot be rendered into existence
 * here, which is why the filter and the pin are asserted as the exported rules
 * the component calls, and why the cue's behaviour under a query is asserted as
 * a PREDICATE whose inputs are `(providerId, recommendedId)` -- neither of which
 * is the query. The two states that are simply unreachable at this level are
 * carried by frames instead: `search-recommended` (the cue still present in a
 * filtered list) and `signed-in` (no cue over an existing credential). Focus
 * restoration is measured live by the UX round, not here.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { QueryClientProvider } from "@tanstack/react-query";
			import {
				ProviderGrid,
				recommendedProvider,
				showsRecommendedCue,
				visibleProviders,
			} from "./src/renderer/src/features/providers/provider-grid";
			export { QueryClient } from "@tanstack/react-query";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export { STEP_PANEL_WIDTH } from "./src/renderer/src/features/onboarding/components/onboarding-modal";
			export { ONBOARDING_PANEL_WIDTHS } from "./src/renderer/src/features/onboarding/components/onboarding-dialog";
			export { OnboardingStep } from "./src/renderer/src/shared/store/onboarding-store";
			export { recommendedProvider, showsRecommendedCue, visibleProviders };

			export const renderProviderGrid = (client) =>
				renderToStaticMarkup(
					createElement(
						QueryClientProvider,
						{ client },
						createElement(ProviderGrid, {}),
					),
				);
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	/*
	 * Shared with this file's own imports rather than bundled twice: two copies
	 * give the component a different QueryClient context than the one seeded
	 * below, and every render would report a fresh pending query and paint the
	 * loading branch.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	loader: { ".css": "empty" },
	jsx: "automatic",
	/*
	 * The onboarding modules this file imports for `STEP_PANEL_WIDTH` resolve
	 * `@shared/config` on the way, and `load-config.ts` reads
	 * `import.meta.env` -- a Vite-only global, undefined in Node, where
	 * `Object.entries(undefined)` throws at module load rather than at an
	 * assertion. Supplying it is not a stub of that module: the real config code
	 * runs, validating the same keys a dev build validates. The URL is the one
	 * `dev` exports, and every other VITE_ key in the schema has a default.
	 */
	define: {
		"import.meta.env": JSON.stringify({
			VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:8080",
			VITE_RADIENT_SERVER_BASE_URL: "https://server.radient.ai",
			VITE_RADIENT_CLIENT_ID: "local-operator",
		}),
	},
	write: false,
});

// A real file rather than a data: URL: React DOM's server build resolves its own
// CJS entry at import time, which a data: URL has no base path for.
const bundlePath = new URL("._provider-grid-pin.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

// The bridge the hook reads through. The census below is seeded into the query
// cache instead of being fetched, so the queryFn never runs; the stub exists
// because the renderer picks its HTTP branch without it, and that branch is not
// the code that ships.
globalThis.window = {
	api: {
		desktop: {
			request: async () => ({ status: 200, body: { providers: [] } }),
		},
	},
};

const {
	QueryClient,
	desktopKeys,
	renderProviderGrid,
	recommendedProvider,
	showsRecommendedCue,
	visibleProviders,
	STEP_PANEL_WIDTH,
	ONBOARDING_PANEL_WIDTHS,
	OnboardingStep,
} = await import(bundlePath.href);
await unlink(bundlePath);

/**
 * A census in the registry's shape (`DesktopProvider`, `shared/desktop-contract.ts`),
 * with the recommended row deliberately NOT first -- the order the real registry
 * ships is `radient` 15th of 18 -- and one row whose `search_aliases` are what a
 * search matches on.
 */
const method = (id, methodId, label, kind) => ({
	id,
	method_id: methodId,
	label,
	kind,
	requires_secret_input: kind === "api_key",
	paste_fallback: false,
});

const row = (id, name, searchAliases, authMethods) => ({
	id,
	name,
	storage_id: id,
	search_aliases: searchAliases,
	auth_methods: authMethods,
	local: false,
	credential_optional: false,
	has_credential: false,
	configured: false,
	stored_credentials: 0,
	base_url: null,
});

const census = (overrides = {}) => [
	row(
		"openai",
		"OpenAI (ChatGPT Plus/Pro)",
		["codex"],
		[method("openai", "openai-key", "API key", "api_key")],
	),
	row(
		"anthropic",
		"Anthropic (Claude)",
		[],
		[method("anthropic", "anthropic-key", "API key", "api_key")],
	),
	{
		...row(
			"radient",
			"Radient",
			["radient-oauth", "radient-api-key"],
			[
				method("radient", "radient-oauth", "Sign in with Radient", "browser"),
				method("radient", "radient-api-key", "Radient Pass key", "api_key"),
			],
		),
		...overrides,
	},
];

const ids = (rows) => rows.map((provider) => provider.id);

/** The markup the grid paints for one census, without a DOM and without a fetch. */
function render(rows) {
	const client = new QueryClient({
		defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
	});
	client.setQueryData(desktopKeys.providers, rows);
	return renderProviderGrid(client);
}

test("the unfiltered list is registry order with the recommendation pinned first", () => {
	const rows = census();
	assert.deepEqual(
		ids(visibleProviders(rows, "", "radient")),
		["radient", "openai", "anthropic"],
		"the pin moves one row and leaves the rest in registry order",
	);
	// A query is the reader's own instruction: registry order, no pin.
	assert.deepEqual(
		ids(visibleProviders(rows, "a", "radient")),
		["openai", "anthropic", "radient"],
		"a filtered list is registry order, so the pinned row stays where the census put it",
	);
	assert.deepEqual(
		ids(visibleProviders(rows, "codex", "radient")),
		["openai"],
		"the filter still matches `search_aliases`",
	);
	assert.deepEqual(
		ids(visibleProviders(rows, "zzz", "radient")),
		[],
		"a query that matches nothing leaves the grid its empty state",
	);
});

test("the cue travels with the provider, so a query cannot switch it off", () => {
	/*
	 * The rule UX round 1 measured the absence of (U2): `rad` narrowed the list
	 * to the one row the promotion is about and the cue was gone. The cue's
	 * inputs are the row's id and the recommended id, and the recommended id
	 * comes from `recommendedProvider(rows)` -- the census, never the query --
	 * so a filtered list keeps it. A query that excludes the row entirely is the
	 * only way the cue disappears with it.
	 */
	assert.equal(showsRecommendedCue("radient", "radient"), true);
	assert.equal(showsRecommendedCue("openai", "radient"), false);
	assert.equal(showsRecommendedCue("radient", null), false);
	assert.ok(
		visibleProviders(census(), "rad", "radient").some(
			(provider) => provider.id === "radient",
		),
		"the row the promotion is about survives its own query",
	);
});

test("first-run advice stops at the credential, on both surfaces", () => {
	assert.equal(recommendedProvider(census())?.id, "radient");
	/*
	 * The state UX round 1 inferred (U3) and the code round could not find a
	 * frame for (R1-6): a stored credential. "Recommended" over a sign-in the
	 * reader has already done argues for a decision they have made, so neither
	 * the pin nor the cue applies -- measured in the markup below, whose first
	 * card is the registry's first row.
	 */
	const signedIn = census({ has_credential: true, configured: true });
	assert.equal(recommendedProvider(signedIn), null);
	assert.deepEqual(
		ids(
			visibleProviders(signedIn, "", recommendedProvider(signedIn)?.id ?? null),
		),
		["openai", "anthropic", "radient"],
	);
	assert.equal(
		recommendedProvider(census({ configured: true, has_credential: false })),
		null,
		"an environment credential counts as signed in too",
	);
});

test("the rendered grid carries the cue, the reason, and the rig's hooks", () => {
	const html = render(census());
	assert.match(html, /Recommended/);
	assert.match(html, /One browser sign-in\. Nothing to paste\./);
	// The two hooks `provider-setup.stories.tsx` measures through. A frame rig
	// that loses them prints `absent` rather than failing, so they are pinned.
	assert.match(html, /data-provider-grid=""/);
	assert.equal(
		html.indexOf('data-provider-id="radient"') <
			html.indexOf('data-provider-id="openai"'),
		true,
	);
});

test("the signed-in census renders no cue anywhere", () => {
	const html = render(census({ has_credential: true, configured: true }));
	assert.doesNotMatch(html, /Recommended/);
	assert.doesNotMatch(html, /Nothing to paste/);
	/*
	 * A signed-in row now leads the page in the "Connected" block (design audit
	 * D3: Radient "Signed in" was card 15 of 18, below the fold). So it renders
	 * BEFORE the rows still to add -- and it is no longer a row to add at all.
	 */
	assert.match(html, />Connected</);
	assert.equal(
		html.indexOf('data-provider-id="radient"') <
			html.indexOf('data-provider-id="openai"'),
		true,
	);
	assert.equal(html.split('data-provider-id="radient"').length - 1, 1);
});

test("only the provider step takes the grid measure, and both measures are clamped", () => {
	assert.equal(STEP_PANEL_WIDTH[OnboardingStep.CONNECT_PROVIDER], "grid");
	// One entry: every other step falls through to the form measure. A step added
	// later that wanted the grid's width has to say so here, in a red test.
	assert.deepEqual(Object.keys(STEP_PANEL_WIDTH), [
		OnboardingStep.CONNECT_PROVIDER,
	]);
	/*
	 * Design round 1's D1: the panel is `w-full` and this frame used to clamp
	 * only its height, so a measure wider than the viewport painted its own
	 * border on column 0 of an 800px window. The PIXELS are the frames' business;
	 * this pins that neither measure can exceed the viewport.
	 */
	for (const [shape, measure] of Object.entries(ONBOARDING_PANEL_WIDTHS)) {
		assert.match(
			measure,
			/^max-w-\[min\(\d+rem,calc\(100vw-4rem\)\)\]$/,
			`the ${shape} measure must be clamped against the viewport`,
		);
	}
	assert.match(ONBOARDING_PANEL_WIDTHS.grid, /min\(60rem/);
	assert.match(ONBOARDING_PANEL_WIDTHS.form, /min\(35rem/);
});
