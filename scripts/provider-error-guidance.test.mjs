import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * WHAT A CHAT ROW OFFERS WHEN A PROVIDER ACCOUNT FAILED — the matcher alone.
 *
 * The rendered half (the affordance's markup and its route) lives in
 * `scripts/canonical-notice.test.mjs`; this file drives the DECISION, which is
 * where the two review risks sit: a classifier that fires on text it should not
 * (half a transcript would grow a button), and one that misses the rows the
 * runtime actually produces (the report stops where the reader's remedy should
 * start).
 *
 * The families are the ones named in the module's header, each quoted from a
 * text this product or its backend produces - so each has a case below, and the
 * negative cases pin the "narrow" promise: ordinary words about credit, quota
 * or signing in must NOT earn an affordance.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/canonical/provider-error-guidance";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
});
const {
	providerErrorGuidance,
	radientOutOfCredits,
	radientOutOfCreditsWording,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const PROVIDER_SETTINGS = "/settings?section=providers";
const RADIENT_SETTINGS = "/settings?section=providers&provider=radient";
const RADIENT_ACCOUNT = "/settings?section=radient";

test("the harness's own classification decides when it can", () => {
	assert.deepEqual(
		providerErrorGuidance({
			text: "credentials were rejected",
			category: "auth",
		}),
		{ label: "Open provider settings", to: PROVIDER_SETTINGS },
	);
	assert.deepEqual(
		providerErrorGuidance({
			text: "402 payment required",
			category: "billing",
		}),
		{ label: "Open provider settings", to: PROVIDER_SETTINGS },
	);
	assert.deepEqual(
		providerErrorGuidance({
			text: "429 too many requests",
			category: "rate-limit",
		}),
		{ label: "Open provider settings", to: PROVIDER_SETTINGS },
	);
});

test("a Radient failure gets its own words, and the surface that can act on it", () => {
	assert.deepEqual(
		providerErrorGuidance({
			text: "Radient refused the credential",
			category: "auth",
			provider: "radient/sonar-pro",
		}),
		{ label: "Sign in to Radient", to: RADIENT_SETTINGS },
	);
	/*
	 * The billing class lands on the ACCOUNT section, not the grid: the balance,
	 * the verify-to-claim callout and the console's billing entry all live there,
	 * and the grid only signs a provider in (UX round 1, U3).
	 */
	assert.deepEqual(
		providerErrorGuidance({
			text: "402: insufficient credits",
			category: "billing",
			provider: "radient/auto",
		}),
		{ label: "Open Radient account", to: RADIENT_ACCOUNT },
	);
});

test("a category outside the set is the classifier's answer, not the prose's", () => {
	/*
	 * "network" is a known category; its payload quoting an out-of-credits
	 * refusal is some OTHER error's words, and the row must not dress itself in
	 * a remedy the failure is not about.
	 */
	assert.equal(
		providerErrorGuidance({
			text: "connection reset while relaying: insufficient credits",
			category: "network",
		}),
		null,
	);
	assert.equal(
		providerErrorGuidance({
			text: "mcp authorization failed",
			category: "mcp",
		}),
		null,
	);
});

test("the text families cover the rows that carry no classification", () => {
	for (const text of [
		"402: insufficient credits",
		"rate limit or quota exceeded",
		"anthropic: 429 rate_limit_error - credit balance is too low",
	]) {
		assert.deepEqual(
			providerErrorGuidance({ text, category: null }),
			{ label: "Open provider settings", to: PROVIDER_SETTINGS },
			text,
		);
	}
	assert.deepEqual(
		providerErrorGuidance({
			text: "Sign in to Radient to access your account",
			category: null,
		}),
		{ label: "Sign in to Radient", to: RADIENT_SETTINGS },
	);
	/*
	 * `unknown` is the classifier saying it could not decide, which is exactly
	 * where the fallback belongs - the same phrase as a plain notice.
	 */
	assert.deepEqual(
		providerErrorGuidance({
			text: "insufficient credits",
			category: "unknown",
		}),
		{ label: "Open provider settings", to: PROVIDER_SETTINGS },
	);
});

test("ordinary words earn nothing", () => {
	for (const text of [
		"The user asked about their credit card.",
		"The quota feature is documented in the manual.",
		/*
		 * The gerund near-miss, and the reason this case is worth keeping: the
		 * matcher keys on the plane's own phrase ("sign in to Radient"), and a
		 * broadened matcher that read "signing in" as the same sentence would fail
		 * here (review round 1, R3).
		 */
		"This paragraph mentions signing in to Radient as a concept.",
		"Credit balance updated successfully.",
	]) {
		assert.equal(providerErrorGuidance({ text }), null, text);
	}
});

test("the boundary is the sentence, not the concept: the phrase earns the action", () => {
	/*
	 * The explicit half of R3's boundary: the matcher keys on the EXACT phrase
	 * "sign in to Radient" (the desktop plane's own sentence), wherever a row
	 * carries it - so prose containing it earns the action, and the gerund above
	 * (which does not contain it) earns nothing. Both directions are pinned
	 * rather than left to a comment.
	 */
	assert.deepEqual(
		providerErrorGuidance({
			text: "How do I sign in to Radient from a terminal?",
		}),
		{ label: "Sign in to Radient", to: RADIENT_SETTINGS },
	);
});

/*
 * A RADIENT 402 IS NEVER A RATE LIMIT.
 *
 * The runtime files a relayed Radient refusal under `rate-limit` when the
 * relayed label says "rate limit or quota exceeded", so the structured category
 * alone sent a user with an empty balance to "Open provider settings". The text
 * marker for the balance outranks that one category on a Radient-named row, and
 * nowhere else.
 */
const RELAYED_402 =
	"rate limit or quota exceeded (HTTP 402): insufficient credits";

test("a Radient 402 filed under rate-limit is out-of-credits, with the account action", () => {
	const row = {
		text: `[session incident (radient/auto)] rate-limit: ${RELAYED_402}`,
		headline: RELAYED_402,
		category: "rate-limit",
		provider: "radient/auto",
	};
	assert.equal(radientOutOfCredits(row), true);
	assert.deepEqual(providerErrorGuidance(row), {
		label: "Open Radient account",
		to: RADIENT_ACCOUNT,
	});
	assert.deepEqual(radientOutOfCreditsWording(row), {
		label: "billing",
		headline: "Out of credits (HTTP 402): insufficient credits",
	});
});

test("the billing class keeps its own headline, and only the label is the row's", () => {
	const row = {
		text: "[session incident (radient/auto)] billing: HTTP 402: insufficient credits",
		headline: "HTTP 402: insufficient credits",
		category: "billing",
		provider: "radient/auto",
	};
	assert.equal(radientOutOfCredits(row), true);
	assert.deepEqual(radientOutOfCreditsWording(row), {
		label: "billing",
		headline: "HTTP 402: insufficient credits",
	});
});

test("a non-Radient rate limit is untouched, even when it quotes a 402", () => {
	for (const provider of ["anthropic/claude-opus-5", null]) {
		const row = {
			text: `rate-limit: ${RELAYED_402}`,
			headline: RELAYED_402,
			category: "rate-limit",
			provider,
		};
		assert.equal(radientOutOfCredits(row), false, String(provider));
		assert.equal(radientOutOfCreditsWording(row), null, String(provider));
		assert.deepEqual(providerErrorGuidance(row), {
			label: "Open provider settings",
			to: PROVIDER_SETTINGS,
		});
	}
});

test("a Radient rate limit that is not about the balance stays a rate limit", () => {
	const row = {
		text: "rate-limit: rate limit or quota exceeded (HTTP 429): slow down",
		headline: "rate limit or quota exceeded (HTTP 429): slow down",
		category: "rate-limit",
		provider: "radient/auto",
	};
	assert.equal(radientOutOfCredits(row), false);
	assert.equal(radientOutOfCreditsWording(row), null);
	assert.deepEqual(providerErrorGuidance(row), {
		label: "Open provider settings",
		to: RADIENT_SETTINGS,
	});
});

test("another category quoting the balance is still the classifier's answer", () => {
	const row = {
		text: "connection reset while relaying: insufficient credits",
		headline: "connection reset while relaying: insufficient credits",
		category: "network",
		provider: "radient/auto",
	};
	assert.equal(radientOutOfCredits(row), false);
	assert.equal(providerErrorGuidance(row), null);
});
