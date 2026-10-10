import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The transcript reads its cross-session visibility through react-query
 * (`useCrossSessionHidden`), so even a server render needs a client in scope.
 * Nothing is seeded: in SSR the hooks resolve to their loading state, whose
 * fail-closed answer is "show everything" - the same answer an old backend
 * gets.
 */
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

// This is a separate file from the transport tests: bundling the transcript
// is asynchronous and must finish before any tests or HTTP teardown can run.
const bundle = await build({
	stdin: {
		contents: `export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
 export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
 export { MemoryRouter } from "react-router-dom";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	/*
	 * The renderer's `import.meta.env`, which these bundles did not need until the
	 * canonical transcript's answer action row read the speech credential probe
	 * (`@shared/hooks/use-credentials` -> `@shared/config`): `loadConfig` runs
	 * `Object.entries(import.meta.env)` at module scope, so without this define the
	 * bundle throws `Cannot convert undefined or null to object` at import time and
	 * the whole file fails before a test runs. `{}` is what `shared-composer.test.mjs`
	 * bakes for the same reason: nothing here reads a VITE_ variable.
	 */
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		/* One copy with the provider below; the hook inside the bundle must find
		 * the client the renders provide. */
		"@tanstack/react-query",
	],
});
const bundlePath = new URL("./_canonical-notice.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let CanonicalTranscript;
let EMPTY_TRANSCRIPT;
let MemoryRouter;
try {
	({ CanonicalTranscript, EMPTY_TRANSCRIPT, MemoryRouter } = await import(
		bundlePath.href
	));
} finally {
	await unlink(bundlePath);
}

// Render through NoticeRow, not TraceLine alone: the regression was the caller
// omitting verbOverride, which changed the label, glyph AND narration length.
// In particular a detail-less row has no disclosure to recover a clipped error.
for (const [name, headline, detail] of [
	...["failed", "completed"].flatMap((outcome) =>
		[null, "The full supporting job output."].map((detail) => [
			`${outcome}, ${detail ? "with detail" : "without detail"}`,
			`background job 'long-verification-job' ${outcome}: ${"Complete diagnostic context must remain readable. ".repeat(3)}END OF RESULT`,
			detail,
		]),
	),
	[
		"ordinary job",
		"The independent reviewer finished inspecting every requested verification report and found no remaining blockers.",
		null,
	],
]) {
	test(`job result preserves label, glyph and full message: ${name}`, () => {
		const markup = renderToStaticMarkup(
			h(
				QueryClientProvider,
				{ client: queryClient },
				h(CanonicalTranscript, {
					transcript: {
						...EMPTY_TRANSCRIPT,
						records: [
							{
								kind: "custom",
								id: "job-regression",
								ts: 1_760_000_000_000,
								customType: "job_result",
								level: "info",
								category: null,
								provider: null,
								headline,
								text: [headline, detail].filter(Boolean).join("\n"),
								attribution: "system",
								detail,
							},
						],
					},
					gate: null,
					waiting: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: null },
					isSmallView: false,
					status: "live",
					failure: null,
					hydrated: true,
					onReconnect: () => {},
				}),
			),
		);
		const text = markup.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'");
		assert.ok(
			text.includes(headline),
			"the full headline survives rendering, including its tail",
		);
		assert.ok(text.includes("job result:"));
		assert.ok(!text.includes("Worked on the request"));
		assert.ok(markup.includes("lucide-message-square-text"));
		assert.ok(!markup.includes("lucide-code-xml"));
		assert.equal(
			markup.includes('aria-expanded="false"'),
			Boolean(detail),
			"only a row with supporting detail has a disclosure",
		);
	});
}

/*
 * THE PROVIDER-FAILURE AFFORDANCE, RENDERED — the half the matcher's own suite
 * cannot see: that `NoticeRow` calls `providerErrorGuidance` at all, and that
 * what it renders is a real link to the settings surface.
 *
 * WHAT THIS DEFENDS. The decision suite
 * (`scripts/provider-error-guidance.test.mjs`) pins the classification; a
 * component that never called it would leave every one of those cases green.
 * The pair here is therefore the call site: the row draws the action, and the
 * route it points at is the two-literal deep link the settings page resolves
 * (`scripts/settings-section-routes.test.mjs` binds the section id).
 *
 * `MemoryRouter` is required because the action is a router `Link`; a link
 * outside a router is not a test-lightness question, it throws.
 */

/** A transcript rendering one record under the router the action links need. */
function renderRecord(record) {
	return renderToStaticMarkup(
		h(
			MemoryRouter,
			{},
			h(
				QueryClientProvider,
				{ client: queryClient },
				h(CanonicalTranscript, {
					transcript: { ...EMPTY_TRANSCRIPT, records: [record] },
					gate: null,
					waiting: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: null },
					isSmallView: false,
					status: "live",
					failure: null,
					hydrated: true,
					onReconnect: () => {},
				}),
			),
		),
	);
}

/** A session incident, as the reducer builds one. */
const incident = (overrides) => ({
	kind: "custom",
	id: "incident-provider-failure",
	ts: 1_760_000_000_000,
	customType: "session_incident",
	level: "error",
	category: null,
	provider: null,
	headline:
		"402: insufficient credits. Add credits to keep using Radient models.",
	text: "402: insufficient credits. Add credits to keep using Radient models.",
	attribution: "system",
	detail: null,
	...overrides,
});

test("a Radient billing incident carries the action, pointed at the account section", () => {
	const markup = renderRecord(
		incident({ category: "billing", provider: "radient/sonar-pro" }),
	);
	assert.ok(
		markup.includes("Open Radient account"),
		"the incident's remedy must be on the row, and named for where it lands",
	);
	assert.ok(
		markup.includes('href="/settings?section=radient"'),
		"the billing class must open the account section, where the balance and billing entry live (UX round 1, U3)",
	);
});

test("a refused credential asks the reader to sign in again", () => {
	const markup = renderRecord(
		incident({
			category: "auth",
			provider: "radient/auto",
			headline: "Radient refused the credential this machine holds.",
			text: "Radient refused the credential this machine holds.",
		}),
	);
	assert.ok(markup.includes("Sign in to Radient"));
	assert.ok(
		markup.includes('href="/settings?section=providers&amp;provider=radient"'),
	);
});

test("a non-Radient auth failure names the surface, not an account", () => {
	const markup = renderRecord(
		incident({
			category: "auth",
			provider: "anthropic/claude-opus-5",
			headline: "All OAuth credentials for provider 'anthropic' were refused.",
			text: "All OAuth credentials for provider 'anthropic' were refused.",
		}),
	);
	assert.ok(markup.includes("Open provider settings"));
	assert.ok(
		!markup.includes("Sign in to Radient"),
		"only a Radient failure may name Radient's sign-in",
	);
	assert.ok(markup.includes('href="/settings?section=providers"'));
});

test("a known category outside the set earns no affordance, whatever its payload quotes", () => {
	const markup = renderRecord(
		incident({
			category: "network",
			provider: null,
			headline: "connection reset while relaying: insufficient credits",
			text: "connection reset while relaying: insufficient credits",
		}),
	);
	assert.ok(
		!markup.includes("Open provider settings"),
		"the classifier's own answer must beat the prose it quotes",
	);
});

test("a notice with no classification falls back to the text families", () => {
	const markup = renderRecord({
		kind: "notice",
		id: "notice-quota",
		ts: 1_760_000_000_000,
		text: "The provider refused: insufficient credits. Top up the account or switch provider.",
		level: "error",
	});
	assert.ok(markup.includes("Open provider settings"));
	assert.ok(markup.includes('href="/settings?section=providers"'));
});

/*
 * A RADIENT 402 IS NEVER A RATE LIMIT, rendered through the shipped row.
 *
 * The runtime files the relayed refusal under `rate-limit`; the row used to say
 * "rate-limit: rate limit or quota exceeded (HTTP 402)" and offer a provider
 * settings button. The guidance beneath it is a client component reading the
 * account (`scripts/radient-credits-guidance.test.mjs` drives that half); here
 * the row's own words and which rows mount it are pinned.
 */
const RADIENT_402 = {
	category: "rate-limit",
	provider: "radient/auto",
	headline: "rate limit or quota exceeded (HTTP 402): insufficient credits",
	text: "[session incident (radient/auto)] rate-limit: rate limit or quota exceeded (HTTP 402): insufficient credits",
};

test("a Radient 402 filed as a rate limit reads as out of credits", () => {
	const markup = renderRecord(incident(RADIENT_402));
	const text = markup.replace(/<[^>]*>/g, "");
	assert.ok(text.includes("billing"), text);
	assert.ok(
		text.includes("Out of credits (HTTP 402): insufficient credits"),
		text,
	);
	assert.ok(!/rate-limit/i.test(text), text);
	assert.ok(!/rate limit or quota/i.test(text), text);
	assert.ok(
		markup.includes('href="/settings?section=radient"'),
		"the account section stays one press away beside the console actions",
	);
	assert.ok(
		!markup.includes("Open provider settings"),
		"a balance failure is not repaired in the providers grid",
	);
});

test("a non-Radient rate limit renders exactly as before", () => {
	const markup = renderRecord(
		incident({
			category: "rate-limit",
			provider: "anthropic/claude-opus-5",
			headline: "rate limit or quota exceeded (HTTP 429)",
			text: "[session incident (anthropic/claude-opus-5)] rate-limit: rate limit or quota exceeded (HTTP 429)",
		}),
	);
	const text = markup.replace(/<[^>]*>/g, "");
	assert.ok(text.includes("rate-limit"), text);
	assert.ok(text.includes("rate limit or quota exceeded (HTTP 429)"), text);
	assert.ok(text.includes("Open provider settings"));
	assert.ok(!text.includes("Out of credits"));
	assert.ok(!text.includes("Top up"));
});
