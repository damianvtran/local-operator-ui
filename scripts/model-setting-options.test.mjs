/*
 * The option builders: what a settings row STORES versus what it SHOWS, how a
 * `hosting` narrows the model list, and what happens when the narrowing matches
 * nothing.
 *
 * These are pure functions precisely so they can be asserted here rather than
 * judged from a frame, and they are the part of this feature most likely to be
 * wrong: the two stored shapes are not interchangeable, and the narrowing is a
 * mapping we do not own whose failure mode — an empty list in a settings field
 * — reads as broken rather than as "we could not map your hosting".
 *
 * Exercised through the SHIPPED modules: the bundle below imports the same
 * `model-setting-options.ts` (and, through it, the same `providerReadiness`
 * classifier) the settings page renders, so a second implementation cannot pass
 * this test while the product disagrees with it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/model-setting-options";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's `@shared`/`@features` aliases are tsconfig paths, not node
	// resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
const {
	CURRENT_VALUE_GROUP,
	SIGN_IN_UNKNOWN_GROUP,
	compareModelRows,
	modelOptions,
	modelScopeNotice,
	providerOptions,
	scopedModelRows,
	selectedOption,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* --------------------------------------------------------------- fixtures */

/** A provider row as `/v1/auth/providers` serves it, in the registry's order. */
const provider = ({
	id,
	name = id,
	local = false,
	has_credential = false,
	credential_optional = false,
	configured = false,
}) => ({
	id,
	name,
	storage_id: id,
	search_aliases: [],
	auth_methods: [],
	local,
	configured,
	credential_optional,
	has_credential,
	stored_credentials: 0,
	base_url: null,
});

/*
 * The probe's own registry shape: twelve sign-in providers interleaved around
 * five local servers, which is why the bucket order is fixed rather than
 * first-seen.
 */
const PROVIDERS = [
	provider({ id: "openai", name: "OpenAI (ChatGPT Plus/Pro)" }),
	provider({ id: "anthropic", name: "Anthropic (Claude Pro/Max)" }),
	provider({
		id: "lmstudio",
		name: "LM Studio",
		local: true,
		configured: true,
		credential_optional: true,
	}),
	provider({
		id: "ollama",
		name: "Ollama",
		local: true,
		configured: true,
		credential_optional: true,
	}),
	provider({ id: "openrouter", name: "OpenRouter" }),
	provider({ id: "radient", name: "Radient" }),
];

const row = (over = {}) => ({
	provider: "openai",
	model_id: "gpt-5.6-sol",
	selector: "openai/gpt-5.6-sol",
	label: "GPT-5.6 Sol",
	connected: false,
	aggregated: false,
	...over,
});

/*
 * `model_name`'s value space has two entries with the SAME model id — a direct
 * provider and an aggregator serving it — and the selector is what tells them
 * apart. The fixture carries both on purpose.
 */
const CATALOGUE = {
	credentials_known: true,
	models: [
		row({
			provider: "openai",
			model_id: "gpt-5.6-sol",
			selector: "openai/gpt-5.6-sol",
			connected: false,
		}),
		row({
			provider: "openai",
			model_id: "gpt-4o",
			selector: "openai/gpt-4o",
			label: "GPT-4o",
			connected: true,
		}),
		row({
			provider: "anthropic",
			model_id: "claude-opus-5",
			selector: "anthropic/claude-opus-5",
			label: "Claude Opus 5",
			connected: false,
		}),
		row({
			provider: "openrouter",
			model_id: "anthropic/claude-opus-5",
			selector: "openrouter/anthropic/claude-opus-5",
			label: "Claude Opus 5",
			connected: false,
			aggregated: true,
		}),
	],
};

const ids = (options) => options.map((option) => option.id);
const names = (options) => options.map((option) => option.name);
const groups = (options) => [...new Set(options.map((option) => option.group))];

/* --------------------------------------------------------- provider rows */

test("the provider list is the WHOLE login registry, never credential-filtered", () => {
	const options = providerOptions(PROVIDERS);
	assert.deepEqual(
		ids(options).sort(),
		["anthropic", "lmstudio", "ollama", "openai", "openrouter", "radient"],
		"a provider with no credential must still be offered: hosting is where a user names the provider they intend to boot on, which may be one they have not logged into yet",
	);
});

test("provider rows are grouped usable-first, and a group is never split", () => {
	const options = providerOptions(PROVIDERS);
	// The registry interleaves its buckets — twelve sign-in providers, then the
	// local servers, then more sign-in providers — so a first-seen bucket order
	// would print "Needs sign-in" twice around the middle group.
	assert.deepEqual(groups(options), [
		"Needs a running server",
		"Needs sign-in",
	]);
	assert.deepEqual(ids(options), [
		"lmstudio",
		"ollama",
		"openai",
		"anthropic",
		"openrouter",
		"radient",
	]);
});

test("a local provider says No key needed rather than claiming a sign-in", () => {
	const options = providerOptions(PROVIDERS);
	const lmstudio = options.find((option) => option.id === "lmstudio");
	assert.equal(lmstudio?.description, "No key needed");
	assert.notEqual(
		lmstudio?.description,
		"Signed in",
		"`configured` is true for the local providers unconditionally, so a 'Signed in' label would claim a connection to a server nobody has shown is running",
	);
});

test("the stored value is the provider id and the shown value is its name", () => {
	const openai = providerOptions(PROVIDERS).find(
		(option) => option.id === "openai",
	);
	assert.equal(openai?.id, "openai");
	assert.equal(openai?.name, "OpenAI (ChatGPT Plus/Pro)");
});

/* ------------------------------------------------------------ model rows */

test("model_name stores the BARE model id and shows the selector", () => {
	const options = modelOptions(CATALOGUE, {
		kind: "model",
		hosting: "openai",
		current: "",
	});
	assert.deepEqual(ids(options), ["gpt-4o", "gpt-5.6-sol"]);
	assert.deepEqual(names(options), ["openai/gpt-4o", "openai/gpt-5.6-sol"]);
});

test("the subagent tiers store AND show the selector", () => {
	const options = modelOptions(CATALOGUE, {
		kind: "provider-model",
		hosting: "",
		current: "",
	});
	assert.deepEqual(ids(options), names(options));
	assert.ok(
		ids(options).includes("anthropic/claude-opus-5"),
		"`configured_effort_tiers` partitions each value on `/` and drops any value missing a side, so a bare model id here is a value the runtime refuses",
	);
});

test("model_name's list is narrowed to the effective hosting", () => {
	const options = modelOptions(CATALOGUE, {
		kind: "model",
		hosting: "anthropic",
		current: "",
	});
	assert.deepEqual(ids(options), ["claude-opus-5"]);
});

test("an unknown hosting shows the WHOLE catalogue, never an empty list", () => {
	// A local server that is down, an id the catalogue spells differently, or a
	// hosting the user just cleared. "We could not map your hosting" must not
	// look like "you own no models".
	for (const hosting of ["lmstudio", "openai-compatible", "noop", ""]) {
		const options = modelOptions(CATALOGUE, {
			kind: "model",
			hosting,
			current: "",
		});
		assert.equal(options.length, CATALOGUE.models.length, `hosting ${hosting}`);
	}
});

test("a stored model the catalogue does not contain is still listed", () => {
	// This repository's own configured fixture holds exactly this shape:
	// `model_name: "deepseek/deepseek-chat"`, a selector-shaped value the key is
	// documented not to hold. It must never render as a blank field.
	const options = modelOptions(CATALOGUE, {
		kind: "model",
		hosting: "deepseek",
		current: "deepseek/deepseek-chat",
	});
	const rescued = options.at(-1);
	assert.equal(rescued?.id, "deepseek/deepseek-chat");
	assert.equal(rescued?.name, "deepseek/deepseek-chat");
	assert.equal(rescued?.description, "Custom model");
	assert.equal(rescued?.group, CURRENT_VALUE_GROUP);
});

test("a row the narrowing EXCLUDED is rescued with its real facts", () => {
	const options = modelOptions(CATALOGUE, {
		kind: "model",
		hosting: "openai",
		current: "claude-opus-5",
	});
	const rescued = options.find((option) => option.id === "claude-opus-5");
	assert.ok(rescued, "the current value must be listed");
	assert.equal(rescued.name, "anthropic/claude-opus-5");
	// Sentence case, like the `Signed in` / `Needs sign-in` sub-lines it sits
	// beside (design round 1, N1).
	assert.equal(rescued.description, "Anthropic, no credential");
	assert.equal(rescued.group, CURRENT_VALUE_GROUP);
});

test("a current value that IS listed is not duplicated by the rescue", () => {
	const options = modelOptions(CATALOGUE, {
		kind: "model",
		hosting: "openai",
		current: "gpt-4o",
	});
	assert.equal(ids(options).filter((id) => id === "gpt-4o").length, 1);
	assert.ok(!groups(options).includes(CURRENT_VALUE_GROUP));
});

test("an unreadable credential store lists everything and groups nothing", () => {
	const options = modelOptions(
		{ ...CATALOGUE, credentials_known: false },
		{ kind: "model", hosting: "openai", current: "" },
	);
	assert.equal(options.length, 2);
	assert.deepEqual(groups(options), [SIGN_IN_UNKNOWN_GROUP]);
	// `connected` is the listing's default when the store could not be read, so
	// a badge or a heading built from it is a claim the payload cannot support.
	for (const option of options) {
		assert.ok(
			!String(option.description).includes("no credential"),
			`${option.id} claims a credential state the payload does not carry`,
		);
	}
});

test("the model list orders usable rows first and leaves the rest in listing order", () => {
	const options = modelOptions(CATALOGUE, {
		kind: "model",
		hosting: "openai",
		current: "",
	});
	assert.deepEqual(
		options.map((option) => option.group),
		["Signed in", "Needs sign-in"],
	);
});

test("the subagent list is grouped by provider, in the listing's order", () => {
	const options = modelOptions(CATALOGUE, {
		kind: "provider-model",
		hosting: "",
		current: "",
	});
	assert.deepEqual(groups(options), ["openai", "anthropic", "openrouter"]);
});

/* -------------------------------------------------------- the comparator */

test("the comparator is usable-first, then the hosting's own provider", () => {
	const connected = row({ model_id: "a", connected: true });
	const unconnected = row({ model_id: "b", connected: false });
	assert.equal(compareModelRows(connected, unconnected, ""), -1);
	assert.equal(compareModelRows(unconnected, connected, ""), 1);

	const home = row({ provider: "anthropic", model_id: "c" });
	const away = row({ provider: "openai", model_id: "d" });
	assert.equal(compareModelRows(home, away, "anthropic"), -1);
	assert.equal(compareModelRows(away, home, "anthropic"), 1);
	// An empty hosting is "unknown", not a provider every row matches.
	assert.equal(compareModelRows(home, away, ""), 0);
	assert.equal(compareModelRows(unconnected, connected, ""), 1);
});

test("scoping widens only for model_name, and only when it has to", () => {
	assert.equal(
		scopedModelRows(CATALOGUE, { kind: "provider-model", hosting: "openai" })
			.length,
		CATALOGUE.models.length,
		"a `provider/model` value names its own provider, so there is no hosting to narrow by",
	);
	assert.equal(
		scopedModelRows(CATALOGUE, { kind: "model", hosting: "openai" }).length,
		2,
	);
});

/* ------------------------------------------------- the selected option */

test("the field shows its stored value, or the value itself when unknown", () => {
	const options = modelOptions(CATALOGUE, {
		kind: "model",
		hosting: "openai",
		current: "",
	});
	assert.equal(selectedOption(options, ""), null);
	assert.equal(selectedOption(options, "gpt-4o")?.name, "openai/gpt-4o");
	assert.deepEqual(selectedOption(options, "something-else"), {
		id: "something-else",
		name: "something-else",
	});
});

/* --------------------------------------------------- the scope, said out loud */

test("a narrowed model list says which provider it is narrowed to", () => {
	// U2: the narrowing is right, and it was silent. A user who types a model
	// they know and reads "Nothing matches that model" concludes the app does
	// not have it, when the reason is a scope nobody named.
	assert.equal(
		modelScopeNotice(
			{ kind: "model", hosting: "anthropic", hostingLabel: "Anthropic" },
			CATALOGUE,
		),
		"Models for Anthropic",
	);
});

test("a scope that could not be resolved says so, in the same line", () => {
	// U3: seven of the seventeen providers in the reviewed registry have no
	// catalogue rows at all, and in those states the list silently becomes the
	// whole catalogue — where a model from another provider is pickable for a
	// field that stores a bare id resolved against `hosting`. The user has to be
	// able to see that from the list, not infer it from row prefixes.
	assert.equal(
		modelScopeNotice(
			{ kind: "model", hosting: "lmstudio", hostingLabel: "LM Studio" },
			CATALOGUE,
		),
		"No models listed for LM Studio. Showing all models.",
	);
	// An aggregator that carries no rows of its own - OpenRouter in the
	// reviewed environment - is the same state, and so is a hosting id the
	// catalogue spells differently.
	assert.equal(
		modelScopeNotice({ kind: "model", hosting: "zzz" }, CATALOGUE),
		"No models listed for Zzz. Showing all models.",
	);
});

test("there is nothing to say when nothing is scoped", () => {
	// The subagent tiers store a selector, so their list is not narrowed; an
	// empty hosting is not a scope that failed but no scope at all; and a
	// catalogue that has not arrived yet is not evidence that the scope failed.
	assert.equal(
		modelScopeNotice({ kind: "model", hosting: "" }, CATALOGUE),
		null,
	);
	assert.equal(
		modelScopeNotice(
			{ kind: "tier", hosting: "anthropic", hostingLabel: "Anthropic" },
			CATALOGUE,
		),
		null,
	);
	assert.equal(
		modelScopeNotice({ kind: "model", hosting: "anthropic" }, undefined),
		null,
	);
});

test("a provider id the catalogue names reads in sentence case, like its neighbours", () => {
	// N1: the sub-line sits beside "Signed in" and "Needs sign-in", and one
	// lowercase prefix among them reads as a different kind of fact.
	const options = modelOptions(CATALOGUE, {
		kind: "model",
		hosting: "anthropic",
		current: "",
	});
	const opus = options.find((entry) => entry.id === "claude-opus-5");
	assert.equal(opus?.description, "Anthropic, no credential");
});

test("a picked row keeps its own label when two rows share one stored id", () => {
	// R1-5: `model_name` stores a bare id, and a direct provider and an
	// aggregator can both carry it. Resolving by id alone shows whichever row
	// comes first, so the field's text visibly swaps a moment after the pick.
	const shared = {
		credentials_known: true,
		models: [
			row({
				provider: "anthropic",
				model_id: "claude-opus-5",
				selector: "anthropic/claude-opus-5",
				connected: true,
			}),
			row({
				provider: "openrouter",
				model_id: "claude-opus-5",
				selector: "openrouter/anthropic/claude-opus-5",
				connected: true,
				aggregated: true,
			}),
		],
	};
	const options = modelOptions(shared, {
		kind: "model",
		hosting: "",
		current: "",
	});
	assert.equal(options.length, 2);
	// Both carry the same id, which is what the field stores …
	assert.equal(options[0].id, options[1].id);
	// … so the shown name is what has to break the tie.
	assert.equal(
		selectedOption(options, "claude-opus-5")?.name,
		"anthropic/claude-opus-5",
	);
	assert.equal(
		selectedOption(
			options,
			"claude-opus-5",
			"openrouter/anthropic/claude-opus-5",
		)?.name,
		"openrouter/anthropic/claude-opus-5",
	);
	// A preference for a row that is not in the list does not hide the value.
	assert.equal(
		selectedOption(options, "claude-opus-5", "something-else")?.name,
		"anthropic/claude-opus-5",
	);
});
