import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

// The two modules are pure TypeScript with no React or DOM imports, so they
// bundle in memory the same way `transcript-reducer.test.mjs` does. The
// fixture is a VERBATIM `GET /v1/auth/providers` body from a local-operator
// 0.50.0 backend with nine providers signed in, captured for the 0.15.1
// defect report in which onboarding showed "Needs sign-in" over a signed-in
// census. It carries no credential values -- the census never does.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/providers/provider-labels";',
			'export * from "./src/renderer/src/shared/hooks/first-time-user";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
});
const { providerReadiness, decideFirstTimeUser, hasConnectedProvider } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

const census = JSON.parse(
	readFileSync(new URL("./fixtures/auth-providers-0.50.0.json", import.meta.url)),
).result.providers;

test("real 0.50.0 census renders 'Signed in' for every provider with a credential", () => {
	const labels = Object.fromEntries(
		census.map((provider) => [provider.id, providerReadiness(provider).label]),
	);
	assert.deepEqual(labels, {
		openai: "Signed in",
		anthropic: "Signed in",
		kimi: "Signed in",
		xai: "Signed in",
		deepseek: "Signed in",
		zai: "Signed in",
		google: "Needs sign-in",
		mistral: "Needs sign-in",
		lmstudio: "No key needed",
		ollama: "No key needed",
		vllm: "No key needed",
		llamacpp: "No key needed",
		"openai-compatible": "No key needed",
		openrouter: "Signed in",
		radient: "Signed in",
		alibaba: "Needs sign-in",
		"alibaba-token-plan": "Signed in",
	});
	// The short local label keeps its full statement reachable.
	assert.equal(
		providerReadiness(census.find((p) => p.id === "ollama")).detail,
		"No key needed - needs a running server",
	);
	// Signed in is the only success tone; a local server is not a connection.
	for (const provider of census) {
		const readiness = providerReadiness(provider);
		assert.equal(readiness.tone === "success", readiness.label === "Signed in");
	}
});

test("a credential in the environment alone still reads as signed in", () => {
	// `has_credential` folds in `resolve_env_key`, so a provider keyed only
	// through the environment arrives as has_credential: true with zero stored
	// credentials. Grouping on the count would mislabel it.
	const label = providerReadiness({
		local: false,
		credential_optional: false,
		configured: true,
		has_credential: true,
		stored_credentials: 0,
	}).label;
	assert.equal(label, "Signed in");
});

test("first-time decision: all configured -> returning, no onboarding", () => {
	assert.equal(
		decideFirstTimeUser({
			onboardingComplete: false,
			census: { status: "ready", providers: census },
			legacy: { status: "ready", keys: [] },
		}),
		"returning",
	);
});

test("first-time decision: only local providers configured -> first time", () => {
	const none = census.map((provider) => ({
		...provider,
		configured: provider.local,
		has_credential: false,
	}));
	assert.equal(hasConnectedProvider(none), false);
	assert.equal(
		decideFirstTimeUser({
			onboardingComplete: false,
			census: { status: "ready", providers: none },
			// The legacy list is IGNORED once the census has answered: on a real
			// machine it held Google/AWS/Radient keys and still meant nothing
			// about model providers.
			legacy: { status: "ready", keys: ["GOOGLE_ACCESS_TOKEN", "AWS_ACCESS_KEY_ID"] },
		}),
		"first_time",
	);
});

test("first-time decision: loading -> nothing decided yet", () => {
	assert.equal(
		decideFirstTimeUser({
			onboardingComplete: false,
			census: { status: "loading" },
			legacy: { status: "ready", keys: [] },
		}),
		"pending",
	);
	assert.equal(
		decideFirstTimeUser({
			onboardingComplete: false,
			census: { status: "unavailable" },
			legacy: { status: "loading" },
		}),
		"pending",
	);
	assert.equal(
		decideFirstTimeUser({
			onboardingComplete: false,
			census: { status: "unavailable" },
			legacy: { status: "error" },
		}),
		"pending",
	);
});

test("first-time decision: older backend falls back to the legacy key list", () => {
	assert.equal(
		decideFirstTimeUser({
			onboardingComplete: false,
			census: { status: "unavailable" },
			legacy: { status: "ready", keys: [] },
		}),
		"first_time",
	);
	assert.equal(
		decideFirstTimeUser({
			onboardingComplete: false,
			census: { status: "unavailable" },
			legacy: { status: "ready", keys: ["OPENAI_API_KEY"] },
		}),
		"returning",
	);
});

test("first-time decision: a completed onboarding is never reopened", () => {
	assert.equal(
		decideFirstTimeUser({
			onboardingComplete: true,
			census: { status: "ready", providers: [] },
			legacy: { status: "ready", keys: [] },
		}),
		"returning",
	);
});
