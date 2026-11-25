/**
 * The first-run STAGE (onboarding refresh, 2026-11): the rules the operator
 * asked for, pinned where a refactor cannot quietly undo them.
 *
 *  S-1  The web search step leaves the sequence when Radient is connected, and
 *       the count follows (2, 3 or 4 steps) - "a stage with entering an API key
 *       for search ... should be skipped if the user signs in with Radient".
 *  S-2  A persisted `extras` (the old combined step) lands on its successor, and
 *       a SEARCH that is no longer in the sequence moves on to MEET.
 *  S-3  The search step offers THREE options in the operator's order - Free
 *       (recommended, preselected), Radient, your own keys - and a Radient
 *       connected on the step shows its satisfied state with the other two
 *       stepped back.
 *  S-4  Sign-in: ChatGPT/Claude are LOG-INS (never "API key"), several sources
 *       can be connected, and while only subscriptions are, the Radient panel
 *       stays with the "in addition" nudge naming the connected plans.
 *  S-5  The wizard's analytics carry `{step, provider?}` only, through the one
 *       consent-gated capture path.
 *  S-6  The intro: any non-modifier key skips; reduced motion and resumed setup
 *       never play it.
 *  S-7  The bookend's fixtures spell her name "Aida".
 *
 * Rendering is SSR (`renderToStaticMarkup`) over a seeded query cache, the
 * `provider-grid-pin.test.mjs` shape: no DOM, no fetch, the real components.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { QueryClientProvider } from "@tanstack/react-query";
			import { SearchApiStep } from "./src/renderer/src/features/onboarding/components/steps/search-api-step";
			import { ConnectProviderStep } from "./src/renderer/src/features/onboarding/components/steps/connect-provider-step";
			export { QueryClient } from "@tanstack/react-query";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export {
				onboardingSequence,
				radientConnected,
				fallbackStep,
				decideIncludeSearch,
			} from "./src/renderer/src/features/onboarding/components/onboarding-sequence";
			export {
				OnboardingStep,
				migrateLegacyStep,
			} from "./src/renderer/src/shared/store/onboarding-store";
			export {
				onboardingStepPayload,
				trackOnboardingStepViewed,
				trackOnboardingStepCompleted,
			} from "./src/renderer/src/features/onboarding/components/onboarding-analytics";
			export { setProductEventSink } from "./src/renderer/src/shared/analytics/product-events";
			export {
				skipsIntro,
				initialStagePhase,
			} from "./src/renderer/src/features/onboarding/components/onboarding-intro";
			export {
				connectedSubscriptionBrands,
				STAGE_PROVIDER_IDS,
			} from "./src/renderer/src/features/onboarding/components/steps/connect-provider-step";
			export { t, setLocale } from "./src/i18n";
			import { Dialog } from "./src/renderer/src/shared/components/ui/dialog";
			import { StageTitle } from "./src/renderer/src/features/onboarding/components/onboarding-dialog";
			export const renderStageTitle = (size) =>
				renderToStaticMarkup(
					createElement(Dialog, {}, createElement(StageTitle, { size }, "Meet Aida")),
				);

			export const renderSearch = (client, props) =>
				renderToStaticMarkup(
					createElement(QueryClientProvider, { client },
						createElement(SearchApiStep, { showCredentialDescription: false, ...props })),
				);
			export const renderConnect = (client, providers) =>
				renderToStaticMarkup(
					createElement(QueryClientProvider, { client },
						createElement(ConnectProviderStep, {
							providers,
							isLoading: false,
							isError: false,
							onRetry: () => {},
							listFormat: (items) => new Intl.ListFormat("en", { type: "conjunction" }).format(items),
						})),
				);
		`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	// Shared with this file's imports so the seeded QueryClient is the one the
	// components read (see provider-grid-pin.test.mjs).
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	// The stage heading's module draws the brand mark and the helix; their
	// assets carry no assertion here.
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	jsx: "automatic",
	define: {
		"import.meta.env": JSON.stringify({
			VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:8080",
			VITE_RADIENT_SERVER_BASE_URL: "https://server.radient.ai",
			VITE_RADIENT_CLIENT_ID: "local-operator",
		}),
	},
	write: false,
});
const bundlePath = new URL("._onboarding-stage.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
globalThis.window = {
	api: {
		desktop: {
			request: async () => ({ status: 200, body: { result: {} } }),
		},
	},
};
const m = await import(bundlePath.href);
await unlink(bundlePath);
m.setLocale("en");
const { OnboardingStep: S } = m;

const method = (id, methodId, kind) => ({
	id,
	method_id: methodId,
	label: methodId,
	kind,
	requires_secret_input: kind === "api_key",
	paste_fallback: false,
});
const row = (id, name, kind, connected = false) => ({
	id,
	name,
	storage_id: id,
	search_aliases: [],
	auth_methods: [method(id, `${id}-m`, kind)],
	local: false,
	credential_optional: false,
	has_credential: connected,
	configured: false,
	stored_credentials: connected ? 1 : 0,
	base_url: null,
});
/** The three rows the stage draws itself, plus one the disclosure holds. */
const census = (connected = []) => [
	row("radient", "Radient", "browser", connected.includes("radient")),
	row(
		"openai",
		"OpenAI (ChatGPT Plus/Pro)",
		"browser",
		connected.includes("openai"),
	),
	row(
		"anthropic",
		"Anthropic (Claude)",
		"browser",
		connected.includes("anthropic"),
	),
	row("google", "Google", "api_key", connected.includes("google")),
];

/*
 * `gcTime: Infinity` because a seeded query otherwise schedules its 5-minute
 * garbage-collection timer, which keeps node's event loop - and so this test
 * file - alive long after the last assertion. Every client is cleared after.
 */
const clients = [];
after(() => {
	for (const c of clients) c.clear();
});
function client(rows) {
	const c = new m.QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { gcTime: Number.POSITIVE_INFINITY },
		},
	});
	clients.push(c);
	c.setQueryData(m.desktopKeys.providers, rows);
	c.setQueryData(["credentials"], { keys: [] });
	return c;
}
const text = (html) =>
	html
		.replace(/<[^>]+>/g, " ")
		.replace(/&#x27;/g, "'")
		.replace(/\s+/g, " ");

/* ------------------------------------------------------------------ S-1 */

test("S-1 search leaves the sequence when Radient is connected; the count follows", () => {
	const seq = (includeSearch, aidaAvailable) =>
		m.onboardingSequence({ includeSearch, aidaAvailable });
	assert.deepEqual(seq(true, true), [
		S.CONNECT_PROVIDER,
		S.DEFAULT_MODEL,
		S.SEARCH,
		S.MEET,
	]);
	assert.deepEqual(seq(false, true), [
		S.CONNECT_PROVIDER,
		S.DEFAULT_MODEL,
		S.MEET,
	]);
	assert.deepEqual(seq(true, false), [
		S.CONNECT_PROVIDER,
		S.DEFAULT_MODEL,
		S.SEARCH,
	]);
	assert.deepEqual(seq(false, false), [S.CONNECT_PROVIDER, S.DEFAULT_MODEL]);

	// The input the modal latches: only a CONNECTED Radient row counts.
	assert.equal(m.radientConnected(census()), false);
	assert.equal(m.radientConnected(census(["openai", "anthropic"])), false);
	assert.equal(m.radientConnected(census(["radient"])), true);
	assert.equal(m.radientConnected(undefined), false);
});

/* ------------------------------------------------------------------ S-2 */

test("S-2 a persisted extras step lands on its successor, never strands", () => {
	assert.equal(m.migrateLegacyStep("extras"), S.SEARCH);
	assert.equal(m.migrateLegacyStep(S.DEFAULT_MODEL), S.DEFAULT_MODEL);
	// Unknown values pass through for the modal's own fallback.
	assert.equal(m.migrateLegacyStep("create_agent"), "create_agent");

	const withMeet = [S.CONNECT_PROVIDER, S.DEFAULT_MODEL, S.MEET];
	assert.equal(m.fallbackStep(S.SEARCH, withMeet), S.MEET);
	assert.equal(
		m.fallbackStep(S.SEARCH, [S.CONNECT_PROVIDER, S.DEFAULT_MODEL]),
		S.CONNECT_PROVIDER,
	);
	assert.equal(m.fallbackStep("create_agent", withMeet), S.CONNECT_PROVIDER);
	assert.equal(m.fallbackStep(S.DEFAULT_MODEL, withMeet), S.DEFAULT_MODEL);
});

/* ------------------------------------------------------------------ S-3 */

test("S-3 search offers Free (recommended, preselected), Radient, then your own keys", () => {
	const rows = census();
	const html = m.renderSearch(client(rows), { radient: rows[0] });
	const order = [...html.matchAll(/data-search-mode="([^"]+)"/g)].map(
		(x) => x[1],
	);
	assert.deepEqual(order, [
		"onboarding-search-mode-free",
		"onboarding-search-mode-radient",
		"onboarding-search-mode-keys",
	]);
	const plain = text(html);
	assert.match(plain, new RegExp(m.t("ui.onboarding.search.mode.free")));
	assert.match(plain, new RegExp(m.t("ui.onboarding.search.recommended")));
	assert.match(
		plain,
		new RegExp(m.t("ui.onboarding.search.mode.radient_detail")),
	);
	assert.ok(plain.includes(m.t("ui.onboarding.search.mode.radient_action")));
	// Free is the one checked radio.
	const checked = [...html.matchAll(/<input[^>]*>/g)]
		.map((x) => x[0])
		.filter((tag) => /checked/.test(tag));
	assert.equal(checked.length, 1);
	assert.match(checked[0], /id="onboarding-search-mode-free"/);
});

test("S-3 a Radient connected on the step is its satisfied state; the others step back", () => {
	const rows = census(["radient"]);
	const html = m.renderSearch(client(rows), {
		radient: rows[0],
		radientConnected: true,
	});
	const plain = text(html);
	assert.ok(plain.includes(m.t("ui.onboarding.search.mode.radient_done")));
	assert.ok(!plain.includes(m.t("ui.onboarding.search.mode.radient_action")));
	// "Not needed with Radient" replaces both other options' descriptions.
	const notNeeded = m.t("ui.onboarding.search.mode.not_needed");
	assert.equal(plain.split(notNeeded).length - 1, 2);
	const inputs = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(
		(x) => x[0],
	);
	const byId = (id) => inputs.find((tag) => tag.includes(`id="${id}"`));
	assert.match(byId("onboarding-search-mode-free"), /disabled/);
	assert.match(byId("onboarding-search-mode-keys"), /disabled/);
	assert.match(byId("onboarding-search-mode-radient"), /checked/);
	// Without a Radient row (a backend that has none) the step keeps two options.
	const two = m.renderSearch(client(census()), {});
	assert.equal([...two.matchAll(/data-search-mode=/g)].length, 2);
});

/* ------------------------------------------------------------------ S-4 */

test("S-4 nothing connected: one Radient primary, and subscriptions are log-ins, not keys", () => {
	const html = m.renderConnect(client(census()), census());
	const plain = text(html);
	assert.ok(plain.includes(m.t("ui.onboarding.signin.radient.action")));
	assert.ok(plain.includes(m.t("ui.onboarding.signin.chatgpt.action")));
	assert.ok(plain.includes(m.t("ui.onboarding.signin.claude.action")));
	assert.ok(plain.includes(m.t("ui.onboarding.signin.divider")));
	// The operator's complaint: subscription sign-ins said "use your own API
	// keys". Outside the "Other ways" summary, no "API key" anywhere.
	const outsideDisclosure = plain.replace(
		m.t("ui.onboarding.signin.more_detail"),
		"",
	);
	assert.doesNotMatch(outsideDisclosure, /API key/i);
	assert.equal((html.match(/onboarding-luminous/g) ?? []).length, 1);
});

test("S-4 subscriptions only: the Radient panel stays, recommended IN ADDITION, with the nudge", () => {
	const rows = census(["openai"]);
	const html = m.renderConnect(client(rows), rows);
	const plain = text(html);
	assert.ok(
		plain.includes(m.t("ui.onboarding.signin.radient.eyebrow_in_addition")),
	);
	assert.ok(plain.includes(m.t("ui.onboarding.signin.radient.action_add")));
	assert.ok(
		plain.includes(
			m.t("ui.onboarding.signin.radient.nudge", { brands: "ChatGPT" }),
		),
	);
	// The footer's Continue is now the one primary: no luminous button.
	assert.equal((html.match(/onboarding-luminous/g) ?? []).length, 0);
	assert.match(html, /data-stage-connected="ChatGPT"/);
	assert.deepEqual(
		m.connectedSubscriptionBrands(census(["openai", "anthropic"])),
		["ChatGPT", "Claude"],
	);
});

test("S-4 several sources connected: each its own row, no nudge", () => {
	const rows = census(["radient", "openai", "anthropic"]);
	const html = m.renderConnect(client(rows), rows);
	const plain = text(html);
	for (const brand of ["Radient", "ChatGPT", "Claude"])
		assert.match(html, new RegExp(`data-stage-connected="${brand}"`));
	assert.ok(
		plain.includes(m.t("ui.onboarding.signin.radient.eyebrow_signed_in")),
	);
	assert.ok(!plain.includes("add Radient too"));
	// The stage draws these three itself; the disclosure must exclude them.
	assert.deepEqual(
		[...m.STAGE_PROVIDER_IDS],
		["radient", "openai", "anthropic"],
	);
});

/* ------------------------------------------------------------------ S-5 */

test("S-5 step analytics carry the step and an optional provider id, nothing else", () => {
	const seen = [];
	m.setProductEventSink((name, properties) => seen.push([name, properties]));
	try {
		m.trackOnboardingStepViewed(S.SEARCH);
		m.trackOnboardingStepCompleted(S.CONNECT_PROVIDER, "radient");
		m.trackOnboardingStepCompleted(S.SEARCH, "free");
		m.trackOnboardingStepCompleted(S.DEFAULT_MODEL, null);
	} finally {
		m.setProductEventSink("default");
	}
	assert.deepEqual(seen, [
		["onboarding_step_viewed", { step: "search" }],
		[
			"onboarding_step_completed",
			{ step: "connect_provider", provider: "radient" },
		],
		["onboarding_step_completed", { step: "search", provider: "free" }],
		["onboarding_step_completed", { step: "default_model" }],
	]);
	assert.deepEqual(m.onboardingStepPayload(S.MEET), { step: "meet" });
});

/* ------------------------------------------------------------------ S-6 */

test("S-6 the intro: any real key skips; reduced motion and resumed setup never play it", () => {
	for (const key of ["Shift", "Control", "Alt", "Meta", "CapsLock"])
		assert.equal(m.skipsIntro({ key }), false, key);
	for (const key of ["Enter", "Escape", " ", "a", "Tab"])
		assert.equal(m.skipsIntro({ key }), true, key);
	assert.equal(m.initialStagePhase("auto", true, false), "intro");
	assert.equal(m.initialStagePhase("auto", true, true), "steps");
	assert.equal(m.initialStagePhase("auto", false, false), "steps");
	assert.equal(m.initialStagePhase("hold", false, true), "intro");
	assert.equal(m.initialStagePhase("skip", true, false), "steps");
});

/* ------------------------------------------------------------------ S-7 */

test("S-7 the bookend's story fixtures spell her name Aida, never Ada", () => {
	const stories = readFileSync(
		"src/renderer/src/features/onboarding/components/onboarding-modal.stories.tsx",
		"utf8",
	);
	assert.doesNotMatch(stories, /name="Ada"/);
	// MeetAida, MeetAidaDelivered and RadientConnected (L14) each name her.
	assert.equal((stories.match(/<AidaBridge name="Aida"/g) ?? []).length, 3);
});

/* ------------------------------------------------------------------ S-8 */

test("S-8 the stage heading carries exactly the size it asks for (Meet Aida is display)", () => {
	/*
	 * Design round 1, D2: the size used to ride on the `asChild` h1, and Radix's
	 * Slot concatenates class lists, so the primitive's `text-heading` survived
	 * beside `text-display` and won on stylesheet order (Meet Aida at 16px).
	 * Exactly one type-ramp size may reach the h1.
	 */
	const ramp = /^text-(display|title|heading|body|body-sm|meta|meta-sm)$/;
	for (const [size, want] of [
		["display", "text-display"],
		["title", "text-title"],
	]) {
		const html = m.renderStageTitle(size);
		const classes = (html.match(/<h1[^>]*class="([^"]*)"/)?.[1] ?? "").split(
			/\s+/,
		);
		assert.deepEqual(
			classes.filter((name) => ramp.test(name)),
			[want],
			`h1 for "${size}": ${classes.join(" ")}`,
		);
	}
});

/* ------------------------------------------------------------------ S-9 */

test("S-9 the search latch: decided when the census answers, live on steps 1-2, held after", () => {
	/*
	 * Code review round 1, R4/R5: the latch was decided at MOUNT (app start, no
	 * census yet), and nothing tested the latch itself - a regression to a live
	 * `!radientOn` would have passed every helper test. This walks the reducer
	 * through the user's own timeline.
	 */
	const step = (s, radientOn, censusLoaded = true) => ({
		step: s,
		radientOn,
		censusLoaded,
	});
	const decide = m.decideIncludeSearch;
	// Before the census answers, nothing is decided - even with no Radient row.
	assert.equal(decide(null, step(S.SEARCH, false, false)), null);
	// A resumed setup on SEARCH whose census says Radient: decided OUT on the
	// first answer, so fallbackStep can move it on to Meet.
	assert.equal(decide(null, step(S.SEARCH, true)), false);
	assert.equal(
		m.fallbackStep(
			S.SEARCH,
			m.onboardingSequence({ includeSearch: false, aidaAvailable: true }),
		),
		S.MEET,
	);
	// Live on sign-in and the model step: Radient connecting there removes it.
	let latch = decide(null, step(S.CONNECT_PROVIDER, false));
	assert.equal(latch, true);
	latch = decide(latch, step(S.CONNECT_PROVIDER, true));
	assert.equal(latch, false);
	latch = decide(latch, step(S.DEFAULT_MODEL, false));
	assert.equal(latch, true, "signing out again on step 2 brings it back");
	// Held on SEARCH: Radient connecting there keeps the step under the user.
	latch = decide(latch, step(S.SEARCH, false));
	latch = decide(latch, step(S.SEARCH, true));
	assert.equal(latch, true, "the step never vanishes mid-flow");
	latch = decide(latch, step(S.MEET, true));
	assert.equal(latch, true);
	// Back to the model step re-opens the latch and re-decides.
	latch = decide(latch, step(S.DEFAULT_MODEL, true));
	assert.equal(latch, false);
	// A census refetch in flight never un-decides.
	assert.equal(decide(false, step(S.SEARCH, false, false)), false);
});
