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
import { readFileSync } from "node:fs";
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
		defaultOptions: {
			queries: {
				staleTime: Number.POSITIVE_INFINITY,
				/*
				 * The grid now observes the (disabled) verdict query, which a static
				 * render leaves with no observer and so schedules for removal after
				 * the default five minutes -- a live timer that held this file open
				 * for 300 s after its last assertion (measured).
				 */
				gcTime: Number.POSITIVE_INFINITY,
			},
		},
	});
	client.setQueryData(desktopKeys.providers, rows);
	/*
	 * The grid holds its card list until the Radient login verdict can answer
	 * (`provider-grid.tsx`, the verdict's mount gate), and that read is gated on
	 * the capability answer. A static render never fetches, so the answer is
	 * seeded: a paired runtime WITHOUT `tunnel`, which issues no verdict read and
	 * leaves every chip to the census -- the premise every case here is about.
	 */
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: {},
	});
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

test("every step takes the same panel measure, and it is clamped", () => {
	/*
	 * Design round 1's D6: step 1 used to ask for a wider measure than steps 2 and
	 * 3, so pressing Continue narrowed the dialog by about 200px and the title, the
	 * step indicator and the close button all jumped inward mid-flow. An EMPTY map
	 * is the fix stated as a rule: every step resolves to the one measure, so a step
	 * added later cannot quietly widen the frame that holds the others.
	 */
	assert.deepEqual(Object.keys(STEP_PANEL_WIDTH), []);
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
	assert.match(ONBOARDING_PANEL_WIDTHS.single, /min\(40rem/);
	assert.equal(Object.keys(ONBOARDING_PANEL_WIDTHS).length, 1);
});

/*
 * ---------------------------------------------------------------- round 4 pins
 *
 * The Connected row's panel, its claim and the panel's own words, pinned by SHAPE.
 * These four are one decision each, and the state they live in -- an open Connected
 * row whose verdict is a refusal -- had no rendered evidence at all until the story
 * beside them was added (review round 4 R4-M2). A shape pin is what fails when the
 * decision is reverted; the pixels are the frames' business.
 */
/**
 * The claim line's `className` expression, sliced out of the grid's source.
 *
 * A pin on the WHOLE expression rather than a window around a keyword: the previous
 * version's forty-character distance check passed for a rewrite that reintroduced the
 * bug it was written for (review round 5, R5-m2).
 */
const claimInk = (source) => {
	const start = source.indexOf("className={`truncate text-meta");
	assert.ok(
		start >= 0,
		"the claim's own className expression must exist for this pin to mean anything",
	);
	const end = source.indexOf("}`}", start);
	assert.ok(end > start, "and it must be closed");
	return source.slice(start, end);
};

const stripComments = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const GRID_SOURCE = "src/renderer/src/features/providers/provider-grid.tsx";
const DETAIL_SOURCE = "src/renderer/src/features/providers/provider-detail.tsx";

test("an open Connected row can be closed where it stands: the item toggles, and Escape works", () => {
	const grid = stripComments(GRID_SOURCE);
	/*
	 * U15/R4-M1: the only open/close toggle in this grid lived in `addRow`, so a
	 * Connected row's panel could not be dismissed in place -- Escape did nothing and
	 * the only exit was navigating away and back, from a state this PR's own
	 * "Sign-in expired -- run /login <provider>" advice reaches.
	 */
	assert.match(
		grid,
		/onSelect=\{\(\) => toggle\(provider\.id\)\}/,
		"the Connected row's item must toggle the panel it opened",
	);
	assert.match(
		grid,
		/open\s*\n?\s*\?\s*"Close"/,
		'and say "Close" while the panel is open, as every add row does',
	);
	assert.match(
		grid,
		/if \(event\.key !== "Escape" \|\| event\.defaultPrevented\) return;/,
		"Escape must close the open panel, without stealing it from an open menu",
	);
});

test("the sign-out confirm hands focus back to the row's own control", () => {
	const grid = stripComments(GRID_SOURCE);
	/*
	 * U18/Q2: the confirm replaced the row's control, so when it closed focus fell to
	 * `<body>` -- a keyboard user dropped at the top of the page they had just
	 * changed. Both exits carry the row's place back.
	 */
	const signOut = grid.slice(grid.indexOf("const signOut = async"));
	assert.match(
		signOut.slice(0, 1200),
		/setFocusRow\(provider\.id\)/,
		"the sign-out arm must return focus to the row",
	);
	assert.match(
		grid,
		/setConfirmSignOut\(null\);\s*\n\s*setFocusRow\(provider\.id\);/,
		'the "Keep" arm must return focus to the row too',
	);
});

test("the row's claim carries its tone, and the panel does not repeat the claim", () => {
	const grid = stripComments(GRID_SOURCE);
	const detail = stripComments(DETAIL_SOURCE);
	/*
	 * D14/R4-m3/U16: the row's claim was one ink for every verdict -- so a dead
	 * sign-in looked like a healthy one while the tone survived only in the panel's
	 * badge -- and the panel then printed the same sentence 40 px below the row that
	 * already said it.
	 */
	assert.match(
		grid,
		/data-claim-tone=\{readiness\?\.tone\}/,
		"the claim must publish the tone a rig (and this pin) can read",
	);
	assert.match(
		grid,
		/readiness\?\.tone === "attention"[\s\S]{0,80}?"text-warning"/,
		"a refusal must not be painted in the row's ordinary ink",
	);
	/*
	 * AND NOTHING ELSE TAKES AN INK. The first version of this line painted
	 * `text-success` for every other verdict, and `loginClaim` answers `working` for
	 * every provider that is not Radient -- so all 18 healthy rows went green, which
	 * moved 3.9% of the `providers-connected` frame's pixels against a sibling capture
	 * of the pre-round-4 tree. The refusal is the only tone that says something here.
	 */
	/*
	 * THE WHOLE EXPRESSION, not a window beside it. The first version of this pin
	 * matched `"text-success"` within forty characters of an unrelated anchor, so a
	 * behaviourally identical rewrite of the very line D14 warns about passed the suite
	 * (review round 5, R5-m2). This slices the className expression out of the source
	 * and asserts what it may and may not contain.
	 */
	const ink = claimInk(grid);
	assert.match(
		ink,
		/attention[\s\S]*?"text-warning"/,
		"a refusal must not be painted in the row's ordinary ink",
	);
	assert.match(
		ink,
		/"text-ink-muted"/,
		"every other verdict stays in the row's ordinary register",
	);
	assert.doesNotMatch(
		ink,
		/text-success/,
		"and nothing on this line may spend the success ink: `loginClaim` answers `working` for every provider that is not Radient, so a success ink here paints every healthy row green (the regression this round's evidence caught)",
	);
	assert.doesNotMatch(
		detail,
		/<Badge variant=\{readiness\.tone\}/,
		"the panel must not restate the row's claim as a badge",
	);
	assert.match(
		detail,
		/readiness\?\.group === "Needs sign-in"/,
		"the panel must state a refusal it can see, where its controls are",
	);
	assert.match(
		grid,
		/readiness=\{readiness\}/,
		"the row's verdict must be handed to the panel, so the pair cannot disagree (Q4-2)",
	);
});

test("an open panel is visible on the control that opened it, and focus has somewhere to land", () => {
	const grid = stripComments(GRID_SOURCE);
	/*
	 * D1: every add row shows a bordered "Close" in this slot while its panel is open,
	 * and the Connected row -- whose only control is the overflow menu -- said nothing:
	 * the state was in `aria-expanded` alone, which a sighted user cannot read. D1 also
	 * asked for a frame of that state; the swept story `panel-refused-verdict` is it.
	 */
	const trigger = grid.slice(
		grid.indexOf("aria-label={`Manage ${brandOf(provider)}`}") - 900,
		grid.indexOf("aria-label={`Manage ${brandOf(provider)}`}"),
	);
	assert.match(
		trigger,
		/aria-expanded=\{open\}/,
		"the overflow trigger must publish whether its panel is open",
	);
	assert.match(
		trigger,
		/className=\{open \? "bg-control" : undefined\}/,
		"and show it: the fill is the colour step a hover takes, held while open",
	);
	/*
	 * U20: the focus pass restores the user's place to "the row's own control", and the
	 * destructive arm had nowhere to land because the row the user just signed out of is
	 * an ADD row -- which never registered its control, and the settings surface has no
	 * search field for the old fallback. Both halves are pinned: the registration, and
	 * the container as the last resort.
	 */
	const addRow = grid.slice(
		grid.indexOf("const addRow ="),
		grid.indexOf("const connectedRow ="),
	);
	assert.match(
		addRow,
		/rowButtons\.current\.set\(provider\.id, element\)/,
		"an add row must register its own control, or a sign-out drops focus on <body>",
	);
	assert.match(
		grid,
		/rowButtons\.current\.get\(focusRow\) \?\?[\s\S]{0,240}?gridRef\.current/,
		"and the grid itself is the last resort, so the chain always has an answer",
	);
	assert.match(
		grid,
		/ref=\{gridRef\}\s*\n?\s*tabIndex=\{-1\}/,
		"which requires the container to be focusable",
	);
});
