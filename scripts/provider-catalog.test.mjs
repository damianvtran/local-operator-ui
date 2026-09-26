/**
 * How a census row is presented, and what onboarding's default-model step
 * proposes -- both pure, both checked against the REAL registry census.
 *
 * The census fixture is the registry-derived first-run census the design audit
 * used (18 rows, Radient 15th), with `suggested_model` added where the backend
 * suggested-defaults change states one. Two rules this file exists for:
 *
 * - Every method tab label is unique within its provider and never repeats the
 *   provider's name (design D4: the tab and the primary button shared the
 *   accessible name "Anthropic (Claude Pro/Max)").
 * - The default-model step reads the CENSUS, so an OAuth sign-in (which has no
 *   `*_API_KEY`) is visible to it, and it proposes the backend's suggestion
 *   rather than `availableModels[0]` (design D5, UX U2). It must also degrade
 *   on an older backend that sends no `suggested_model` at all.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/providers/provider-catalog";',
			'export * from "./src/renderer/src/features/providers/default-model-choice";',
		].join("\n"),
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
const catalog = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	brandOf,
	methodName,
	monogramOf,
	providerGroup,
	rowActionLabel,
	addRowsByGroup,
	connectedRows,
	addRowMeta,
	deviceCodeOf,
	hostOf,
	unfinishedMessage,
	chooseDefaultModel,
} = catalog;

const census = JSON.parse(
	readFileSync(
		new URL("./fixtures/auth-providers-first-run.json", import.meta.url),
	),
).providers;

const SUGGESTIONS = {
	anthropic: { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
	openai: { id: "gpt-6-astra", name: "GPT-6 Astra" },
	deepseek: { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
	radient: { id: "auto", name: "Auto" },
};
/** The census as a backend with the suggested-defaults change sends it. */
const withSuggestions = census.map((row) => ({
	...row,
	suggested_model: SUGGESTIONS[row.id] ?? null,
}));
const signIn = (rows, id) =>
	rows.map((row) =>
		row.id === id
			? {
					...row,
					has_credential: true,
					configured: true,
					stored_credentials: 1,
				}
			: row,
	);

test("the fixture is the real first-run registry census", () => {
	assert.equal(census.length, 18);
	assert.equal(
		census.findIndex((row) => row.id === "radient"),
		14,
	);
});

test("brands drop the method parenthetical and keep plain names", () => {
	const brands = Object.fromEntries(
		census.map((row) => [row.id, brandOf(row)]),
	);
	assert.equal(brands.anthropic, "Anthropic");
	assert.equal(brands.openai, "OpenAI");
	assert.equal(brands.xai, "xAI");
	assert.equal(brands.zai, "Z.AI");
	assert.equal(brands.deepseek, "DeepSeek");
	assert.equal(brands["openai-compatible"], "OpenAI-compatible");
	assert.equal(
		brands["alibaba-token-plan"],
		"QwenCloud",
		"the registry's display name carries the plan, not the brand",
	);
});

test("no method tab repeats its provider's name, and each is unique in its chooser", () => {
	for (const row of census) {
		const names = row.auth_methods.map(methodName);
		assert.equal(new Set(names).size, names.length, `${row.id}: ${names}`);
		for (const name of names) {
			assert.ok(
				!name.includes(brandOf(row)) || row.auth_methods.length === 1,
				`${row.id}: tab "${name}" repeats the brand`,
			);
		}
	}
	const anthropic = census.find((row) => row.id === "anthropic");
	assert.deepEqual(anthropic.auth_methods.map(methodName), [
		"Claude subscription",
		"API key",
	]);
});

test("monograms are two letters", () => {
	for (const row of census) {
		assert.match(monogramOf(brandOf(row)), /^[A-Z0-9][A-Za-z0-9]$/, row.id);
	}
	assert.equal(monogramOf("DeepSeek"), "DS");
	assert.equal(monogramOf("OpenAI"), "OA");
	assert.equal(monogramOf("LM Studio"), "LS");
});

test("rows group by where access comes from, and each has one action", () => {
	const groups = Object.fromEntries(
		census.map((row) => [row.id, providerGroup(row)]),
	);
	assert.equal(groups.anthropic, "subscription");
	assert.equal(groups.radient, "subscription");
	assert.equal(groups.deepseek, "key");
	assert.equal(groups.google, "key");
	assert.equal(groups.ollama, "local");
	const labels = new Set(census.map(rowActionLabel));
	assert.deepEqual([...labels].sort(), ["Add key", "Set up", "Sign in"]);
	// The account a subscription row names is the one its user has, never a
	// method tab label: "Sign in with your Browser sign-in account" is what the
	// tab produced before `accountNameOf` existed.
	for (const row of census) {
		if (providerGroup(row) !== "subscription") continue;
		assert.doesNotMatch(
			addRowMeta(row),
			/sign-in account|token plan account/i,
			row.id,
		);
	}
	// Design D3: a key-only provider never says "sign-in".
	assert.equal(
		rowActionLabel(census.find((row) => row.id === "deepseek")),
		"Add key",
	);
});

test("the add block leads its subscriptions with the recommendation", () => {
	const groups = addRowsByGroup(census, null);
	assert.equal(groups.subscription[0].id, "radient");
	assert.equal(
		groups.subscription.length + groups.key.length + groups.local.length,
		18,
	);
	assert.equal(groups.local.length, 5);
});

test("a connected row leaves the add block and joins Connected, default first", () => {
	const rows = signIn(signIn(census, "deepseek"), "anthropic");
	const connected = connectedRows(rows, "deepseek").map((row) => row.id);
	assert.deepEqual(
		connected,
		["deepseek", "anthropic"],
		"default first, then by brand",
	);
	const groups = addRowsByGroup(rows, "deepseek");
	const ids = [...groups.subscription, ...groups.key, ...groups.local].map(
		(r) => r.id,
	);
	assert.ok(!ids.includes("deepseek") && !ids.includes("anthropic"));
	// A local runtime is Connected only when it IS the default: nothing probes.
	assert.deepEqual(
		connectedRows(census, "ollama").map((row) => row.id),
		["ollama"],
	);
	assert.deepEqual(connectedRows(census, null), []);
});

test("the device code is the field when sent, else parsed from the old sentence", () => {
	assert.equal(
		deviceCodeOf({ user_code: "WXYZ-1234", instructions: null }),
		"WXYZ-1234",
	);
	assert.equal(
		deviceCodeOf({ instructions: "Enter code: ABCD-EFGH" }),
		"ABCD-EFGH",
		"older backend: the code is inside `instructions`",
	);
	assert.equal(
		deviceCodeOf({
			instructions:
				"Or open: http://localhost:54545/launch If your browser shows a login code, paste it here.",
		}),
		null,
		"a paste instruction is not a device code",
	);
	assert.equal(
		hostOf("https://www.claude.ai/oauth/authorize?x=1"),
		"claude.ai",
	);
	assert.equal(hostOf(null), null);
});

test("an unfinished sign-in names its cause", () => {
	assert.match(
		unfinishedMessage({ state: "expired", message: "" }, "Anthropic"),
		/expired/,
	);
	assert.match(
		unfinishedMessage(
			{ state: "cancelled", message: "Replaced by a new sign-in." },
			"Anthropic",
		),
		/newer sign-in replaced/,
	);
	assert.match(
		unfinishedMessage(
			{ state: "cancelled", message: "Sign-in cancelled." },
			"X",
		),
		/You cancelled/,
	);
	assert.equal(
		unfinishedMessage(
			{ state: "failed", message: "Sign-in failed." },
			"Anthropic",
		),
		"Anthropic didn't confirm the sign-in.",
	);
});

test("step 2: a default the backend applied is shown as chosen", () => {
	const choice = chooseDefaultModel(signIn(withSuggestions, "anthropic"), {
		hosting: "anthropic",
		model: "claude-opus-5-5",
	});
	assert.equal(choice.kind, "applied");
	assert.equal(choice.provider.id, "anthropic");
});

test("step 2: an OAuth sign-in is visible, and its suggestion is preselected", () => {
	// Anthropic signed in by browser: no `*_API_KEY` anywhere, which is exactly
	// the case the old credentials-list filter could not see (UX U2).
	const choice = chooseDefaultModel(signIn(withSuggestions, "anthropic"), {
		hosting: null,
		model: null,
	});
	assert.equal(choice.kind, "proposed");
	assert.equal(choice.provider.id, "anthropic");
	assert.deepEqual(choice.model, SUGGESTIONS.anthropic);
});

test("step 2: with several connected, the featured order breaks the tie", () => {
	const rows = signIn(signIn(withSuggestions, "deepseek"), "openai");
	const choice = chooseDefaultModel(rows, { hosting: null, model: null });
	assert.equal(choice.provider.id, "openai");
});

test("step 2 on an OLDER backend: no suggestion is invented, the user picks", () => {
	const choice = chooseDefaultModel(signIn(census, "deepseek"), {
		hosting: null,
		model: null,
	});
	assert.equal(choice.kind, "choose");
	assert.equal(choice.provider.id, "deepseek");
});

test("step 2 with nothing connected says so", () => {
	assert.equal(
		chooseDefaultModel(census, { hosting: null, model: null }).kind,
		"none",
	);
	// A local runtime without a configured default is not "connected" here.
	assert.equal(
		chooseDefaultModel(withSuggestions, { hosting: null, model: null }).kind,
		"none",
	);
});
