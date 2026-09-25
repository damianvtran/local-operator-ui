/**
 * The chat's "nothing can answer a message" rule, as a pure function.
 *
 * WHY THIS FILE EXISTS. `needsProvider` decided the empty-chat card, the
 * composer's placeholder and (now) whether Send is enabled, from two reads:
 * "is a provider connected" and "is a default configured". A configured default
 * whose credential is GONE counted as a working setup -- `auth.logout` clears the
 * credential and leaves `hosting` in the config -- so after signing out of the
 * only provider there was no card, no status line and no placeholder, while
 * every send failed (code round 1 m3, QA round 1's follow-up observation).
 *
 * The rule moved out of the hook for the same reason the sign-in rules moved out
 * of the panel: a decision this consequential should be assertable without a
 * renderer. The hook is a thin read of the two queries over it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export { providerStatusFrom } from "./src/renderer/src/features/providers/use-provider-status";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
	tsconfig: "tsconfig.web.json",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const { providerStatusFrom } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A census row in the shape `providers.list` returns. */
const row = (id, extra = {}) => ({
	id,
	local: false,
	has_credential: false,
	stored_credentials: 0,
	auth_methods: [],
	...extra,
});

const base = {
	censusEnabled: true,
	censusLoaded: true,
	configLoading: false,
	hosting: null,
	rows: [],
};

test("nothing connected and nothing configured is the connect-me state", () => {
	assert.deepEqual(providerStatusFrom({ ...base, rows: [row("anthropic")] }), {
		isKnown: true,
		needsProvider: true,
		/*
		 * Nothing with a credential, so there is nothing to name a model WITH: this is
		 * the connect-me state, not the choose-a-model one (U21).
		 */
		needsModel: false,
	});
});

test("a configured default whose credential is GONE still asks for a provider", () => {
	/*
	 * The m3 case exactly: the user signed out of the only provider, so the
	 * census row is present and bare while `hosting` still names it. Before this
	 * rule the chat said nothing at all and the send failed.
	 */
	assert.deepEqual(
		providerStatusFrom({
			...base,
			hosting: "anthropic",
			rows: [row("anthropic")],
		}),
		{ isKnown: true, needsProvider: true, needsModel: false },
	);
});

test("a configured default whose row is MISSING from the census is trusted", () => {
	/*
	 * An older census that does not carry the row is not evidence that the
	 * provider is unusable, and nagging a user whose setup this app cannot read is
	 * the worse failure (the rule's own stated bias).
	 */
	assert.deepEqual(
		providerStatusFrom({ ...base, hosting: "anthropic", rows: [] }),
		{ isKnown: true, needsProvider: false, needsModel: false },
	);
});

test("a local runtime and a stored key both count as usable", () => {
	assert.deepEqual(
		providerStatusFrom({
			...base,
			hosting: "ollama",
			rows: [row("ollama", { local: true })],
		}),
		{ isKnown: true, needsProvider: false, needsModel: false },
	);
	assert.deepEqual(
		providerStatusFrom({
			...base,
			hosting: "deepseek",
			rows: [row("deepseek", { stored_credentials: 1 })],
		}),
		{ isKnown: true, needsProvider: false, needsModel: false },
	);
});

test("a connected provider with no default is the choose-a-model state, not the connect-me one", () => {
	/*
	 * The state U21 was measured in: a first run whose provider IS connected and whose
	 * default was deliberately NOT written, because the backend lists no models for it.
	 * `needsProvider` is false -- the provider is there -- and `needsModel` is true,
	 * which is what the composer refuses a send on.
	 */
	assert.deepEqual(
		providerStatusFrom({
			...base,
			rows: [row("anthropic", { has_credential: true })],
		}),
		{ isKnown: true, needsProvider: false, needsModel: true },
	);
	/*
	 * And with a usable default it is neither state: a configured `hosting` whose row
	 * holds a credential is something the backend can answer with.
	 */
	assert.deepEqual(
		providerStatusFrom({
			...base,
			hosting: "anthropic",
			rows: [row("anthropic", { has_credential: true })],
		}),
		{ isKnown: true, needsProvider: false, needsModel: false },
	);
	/*
	 * Neither is it true while a read is pending: "I could not tell" is not "nothing
	 * can answer", and refusing a send on unknown state would refuse working setups.
	 */
	assert.equal(
		providerStatusFrom({
			...base,
			censusLoaded: false,
			rows: [row("anthropic", { has_credential: true })],
		}).needsModel,
		false,
	);
});

test("while either read is pending - or the census is unsupported - it is unknown", () => {
	// Nagging a user whose setup this app could not read is the worse failure.
	assert.equal(
		providerStatusFrom({
			...base,
			configLoading: true,
			rows: [row("anthropic")],
		}).needsProvider,
		false,
	);
	assert.equal(
		providerStatusFrom({ ...base, censusLoaded: false, rows: [] })
			.needsProvider,
		false,
	);
	assert.equal(
		providerStatusFrom({ ...base, censusEnabled: false, rows: [] })
			.needsProvider,
		false,
	);
	assert.equal(
		providerStatusFrom({ ...base, censusEnabled: false, rows: [] }).isKnown,
		false,
	);
});
