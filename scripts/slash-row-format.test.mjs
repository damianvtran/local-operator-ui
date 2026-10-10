import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SETTINGS_REFUSED = /settings refused/;
import { build } from "esbuild";

/*
 * The presentation port: a model row's window and price pair, and the row
 * shaping that feeds the composer's argument list.
 *
 * `formatWindow`, `trimPrice` and `formatPricePair` are verbatim ports of
 * `local_operator/tui/widgets/model_picker.py` (`format_window` :161-176,
 * `format_price_pair` :209-259, `_trim_price` :277-...). The vectors below are
 * the ones those functions print on the Python side, so a drift in either host
 * turns this red rather than shipping two different prices for one model.
 *
 * Bundled rather than imported because the module is TypeScript in the renderer
 * tree; the module under test is the REAL one and nothing is re-implemented here.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/slash-argument-rows"; export { activeModelForDefault, effortCommandSucceeded, writeModelDefaultSettings } from "./src/renderer/src/features/chat/pickers/model-default-settings"; export { matchChoices } from "./src/renderer/src/features/chat/components/slash-rank";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	formatWindow,
	formatPricePair,
	trimPrice,
	argumentRows,
	modelDefaultActionRow,
	shouldRunArgumentAction,
	activeModelForDefault,
	effortCommandSucceeded,
	writeModelDefaultSettings,
	effectiveInlineArgument,
	matchChoices,
	providerQualifier,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("formatWindow reproduces the TUI's own vectors", () => {
	// `model_picker.py:format_window`. The `.0m` collapse is why `1_048_576`
	// prints `1m` rather than `1.0m`.
	for (const [tokens, expected] of [
		[0, ""],
		[-1, ""],
		[999, "999"],
		[1000, "1k"],
		[400_000, "400k"],
		[1_000_000, "1m"],
		[1_048_576, "1m"],
		[1_500_000, "1.5m"],
	]) {
		assert.equal(formatWindow(tokens), expected, `formatWindow(${tokens})`);
	}
});

test("formatPricePair reproduces the TUI's own vectors", () => {
	// `model_picker.py:format_price_pair`. Four states, and the split matters: a
	// provider that quotes nothing is NOT free.
	for (const [input, output, routed, expected] of [
		[3, 15, false, "$3/15"],
		[0, 0, false, "free"],
		[-1, -1, false, ""],
		[1.25, 10, true, "usage-based"],
		[0.075, 0.3, false, "$0.075/0.3"],
		[18.75, 15, false, "$18.8/15"],
		[-1, 0, false, ""],
	]) {
		assert.equal(
			formatPricePair(input, output, routed),
			expected,
			`formatPricePair(${input}, ${output}, ${routed})`,
		);
	}
});

test("trimPrice keeps three significant figures below ten", () => {
	// A flat two decimals printed `$0.07` for `0.075` — a 6.7% under-quote on
	// exactly the cheap models a user picks BECAUSE of the price — and `$19` for
	// `18.75`, which reads as a real quoted price the provider does not charge.
	assert.equal(trimPrice(0.075), "0.075");
	assert.equal(trimPrice(18.75), "18.8");
	assert.equal(trimPrice(0.625), "0.625");
	assert.equal(trimPrice(0.875), "0.875");
	assert.equal(trimPrice(0.0481), "0.0481");
	assert.equal(trimPrice(3), "3");
	assert.equal(trimPrice(15), "15");
	assert.equal(trimPrice(1.25), "1.25");
	assert.equal(trimPrice(0.3), "0.3");
});

/** A real-shaped `command-entities?command=model` row: the fields
 *  `dataclasses.asdict(CatalogueEntry)` sends plus the route's own `value`. */
const modelRow = (over = {}) => ({
	provider: "anthropic",
	model_id: "claude-opus-5",
	selector: "anthropic/claude-opus-5",
	value: "anthropic/claude-opus-5",
	label: "Claude Opus 5",
	connected: true,
	context_window: 400_000,
	input_price: 3,
	output_price: 15,
	default_context_window: 200_000,
	max_context_window: 400_000,
	aggregated: false,
	routed: false,
	...over,
});

test("default is a separate, exact model action and never a catalogue row", () => {
	const action = modelDefaultActionRow(
		"default",
		{ provider: "anthropic", model_id: "claude-opus-5" },
		true,
		true,
	);
	assert.equal(action.kind, "action");
	assert.equal(action.id, "model-default");
	assert.equal(action.clickText, "Click does the same.");
	assert.deepEqual(action.model, {
		provider: "anthropic",
		model_id: "claude-opus-5",
	});
	assert.equal(shouldRunArgumentAction(action, true), true);
	assert.equal(shouldRunArgumentAction(action, false), false);
	assert.equal(
		modelDefaultActionRow(
			"default",
			{ provider: "anthropic", model_id: "claude-opus-5" },
			false,
			true,
		),
		null,
	);
	const unavailable = modelDefaultActionRow("default", null, true, true);
	assert.equal(unavailable.disabled, true);
	assert.equal(shouldRunArgumentAction(unavailable, true), false);
});

test("active model default requires both provider and model id", () => {
	assert.deepEqual(
		activeModelForDefault({ provider: "openrouter", model_id: "openai/gpt-5" }),
		{ provider: "openrouter", model_id: "openai/gpt-5" },
	);
	assert.equal(activeModelForDefault(null), null);
	assert.equal(
		activeModelForDefault({ provider: "openrouter", model_id: "" }),
		null,
	);
	assert.deepEqual(
		activeModelForDefault({
			provider: "openrouter",
			model_id: "openai/gpt-5",
			extra: true,
		}),
		{ provider: "openrouter", model_id: "openai/gpt-5" },
	);
});

test("model default writes hosting then model name and stops on refusal", async () => {
	const writes = [];
	await writeModelDefaultSettings(
		{ provider: "anthropic", model_id: "claude-opus-5" },
		async (key, value) => writes.push([key, value]),
	);
	assert.deepEqual(writes, [
		["hosting", "anthropic"],
		["model_name", "claude-opus-5"],
	]);
	const failed = [];
	await assert.rejects(
		writeModelDefaultSettings(
			{ provider: "openai", model_id: "gpt-5" },
			async (key, value) => {
				failed.push([key, value]);
				if (key === "hosting") throw new Error("settings refused");
			},
		),
		SETTINGS_REFUSED,
	);
	assert.deepEqual(failed, [["hosting", "openai"]]);
});

test("only an informational effort notice permits saving a machine default", () => {
	assert.equal(effortCommandSucceeded({ kind: "notice", style: "info" }), true);
	assert.equal(
		effortCommandSucceeded({ kind: "notice", style: "warning" }),
		false,
	);
	assert.equal(
		effortCommandSucceeded({ kind: "error", style: "error" }),
		false,
	);
	assert.equal(effortCommandSucceeded(null), false);
});

test("a model row carries the provider, the window and the price pair", () => {
	const rows = argumentRows(
		"model",
		[
			modelRow(),
			modelRow({
				provider: "openrouter",
				model_id: "auto",
				selector: "openrouter/auto",
				value: "openrouter/auto",
				label: "Auto Router",
				input_price: -1,
				output_price: -1,
				routed: true,
				aggregated: true,
			}),
			modelRow({
				provider: "local",
				model_id: "tiny",
				selector: "local/tiny",
				value: "local/tiny",
				label: "Tiny",
				input_price: 0,
				output_price: 0,
				context_window: -1,
			}),
			modelRow({
				provider: "openai",
				model_id: "quoted-nothing",
				selector: "openai/quoted-nothing",
				value: "openai/quoted-nothing",
				label: "Nothing to say",
				context_window: -1,
				input_price: -1,
				output_price: -1,
			}),
			modelRow({
				provider: "openai",
				model_id: "window-only",
				selector: "openai/window-only",
				value: "openai/window-only",
				label: "Window, no price",
				context_window: 200_000,
				input_price: -1,
				output_price: -1,
			}),
		],
		{ provider: "anthropic", model_id: "claude-opus-5" },
	);

	assert.equal(rows[0].value, "anthropic/claude-opus-5");
	assert.equal(rows[0].name, "Claude Opus 5");
	assert.equal(rows[0].description, "anthropic");
	assert.equal(rows[0].detail, "400k · $3/15");
	assert.equal(rows[0].current, true);

	// A meta-route says `usage-based` as a WORD, and never a pair of numbers.
	assert.equal(rows[1].detail, "400k · usage-based");
	// `aggregated` is named, and the window is never invented.
	assert.ok(rows[1].description.includes("aggregated"));

	// A stated pair of zeroes is `free`; an unknown window is blank, not a dash.
	assert.equal(rows[2].detail, "free");

	// An absent price is BLANK — not `free`, which would advertise a paid model
	// as free, the one error in this column a user would act on.
	assert.equal(rows[3].detail, undefined);
	assert.equal(rows[3].current, false);
	// Either half may be missing and only the other appears, so a row with a
	// window and no quote is a window alone rather than a dash or a zero.
	assert.equal(rows[4].detail, "200k");
});

test("a model row only claims `needs sign-in` when its own flag says so", () => {
	// `credentials_known` lives on `models.catalogue` and the entities route does
	// not carry it, so the rule is applied as written: only an explicit `false`
	// raises the caveat, and `connected` (which this route does send) is what
	// raises it. The words are the picker's shared ones (design round 1, D5/U3 -
	// `needs sign-in` on the dialog row's caveat, this row and the group heading
	// read as one state); the pre-fix pair here was `, no credential`.
	const [row] = argumentRows("model", [modelRow({ connected: false })], null);
	assert.equal(row.description, "anthropic, needs sign-in");
	const [connected] = argumentRows(
		"model",
		[modelRow({ connected: true })],
		null,
	);
	assert.equal(connected.description, "anthropic");
});

test("value rows are their own name, and `current` comes from the payload", () => {
	const rows = argumentRows(
		"effort",
		[{ value: "low" }, { value: "high" }],
		"high",
	);
	assert.deepEqual(rows, [
		// `name` is the title-cased human form (matching the strip's chip and the
		// `/effort` modal); `value` stays the raw rung the command is sent, and
		// `current` still compares the RAW value, never the cased label.
		{ value: "low", name: "Low", current: false },
		{ value: "high", name: "High", current: true },
	]);
	// `approvals` is NOT an effort list: its `auto` is a mode, not a rung, so it
	// is deliberately left uncased (the two cases are separate branches).
	const approvals = argumentRows("approvals", [{ value: "auto" }], "auto");
	assert.equal(approvals[0].name, "auto");
	assert.equal(approvals[0].current, true);
});

test("profile rows take their detail from the profile kind", () => {
	const rows = argumentRows(
		"agent",
		[
			{
				name: "reviewer",
				value: "reviewer",
				description: "Reviews a diff",
				kind: "role",
			},
			{ name: "guild", value: "guild", description: "" },
		],
		"guild",
	);
	assert.equal(rows[0].detail, "role");
	assert.equal(rows[0].current, false);
	// A team row carries no kind, so its detail column stays empty rather than
	// inventing a fact the payload does not have.
	assert.equal(rows[1].detail, undefined);
	assert.equal(rows[1].current, true);
});

test("a labelled team reads by its label, keeps its slug findable, and writes the slug", () => {
	/*
	 * The label split's row rule, from the branch that serves /team's list: the
	 * DISPLAY is the label — through `teamDisplayName`, the app's one statement
	 * of that rule — `value` - what a pick writes and a run sends - is the slug,
	 * and the slug is republished as an ALIAS so the team's actual key keeps
	 * FINDING the row while the row shows its label (`matchChoices` scores name
	 * and aliases, and the alias arm is pinned in `slash-rank.test.mjs`).
	 *
	 * The `slug` field is the display-side twin of that alias (design round 1,
	 * D2/D3): the popup draws it as the quiet mono token beside the label, and
	 * its presence is what tells the renderer the name is prose. Round 1's R1-2
	 * is pinned below: the rule is the SHARED one, trim included.
	 */
	const rows = argumentRows(
		"team",
		[
			{
				name: "lopdev",
				value: "lopdev",
				label: "Local Operator Dev",
				description: "Builds and ships local-operator itself.",
			},
		],
		null,
	);
	assert.equal(rows[0].name, "Local Operator Dev");
	assert.equal(rows[0].value, "lopdev");
	assert.equal(rows[0].slug, "lopdev");
	assert.deepEqual(rows[0].aliases, ["lopdev"]);
	// A row without a label (every agent, and any team from a backend that
	// predates the field) keeps today's shape exactly: no alias, no slug token,
	// name as was.
	const agents = argumentRows(
		"agent",
		[{ name: "coder", value: "coder" }],
		null,
	);
	assert.equal(agents[0].name, "coder");
	assert.equal(agents[0].aliases, undefined);
	assert.equal(agents[0].slug, undefined);
});

test("a padded or whitespace-only label goes through the shared trim rule", () => {
	/*
	 * Round 1's R1-2. This row used to replicate `label || name` WITHOUT
	 * `teamDisplayName`'s trim, so a padded label rendered padded where every
	 * other surface trims it, and a whitespace-only label - the exact case the
	 * helper's docblock calls load-bearing - blanked the row instead of falling
	 * back to the slug. The helper is the one statement of the rule; this test
	 * pins that the popup's rows are read through it.
	 */
	const rows = argumentRows(
		"team",
		[{ name: "lopdev", value: "lopdev", label: "  Local Operator Dev  " }],
		null,
	);
	assert.equal(rows[0].name, "Local Operator Dev");
	assert.deepEqual(rows[0].aliases, ["lopdev"]);
	assert.equal(rows[0].slug, "lopdev");

	const blank = argumentRows(
		"team",
		[{ name: "lopdev", value: "lopdev", label: "   " }],
		null,
	);
	assert.equal(blank[0].name, "lopdev");
	// A label that cannot win leaves the row in its unlabelled shape: no alias
	// to publish, and no slug token to draw.
	assert.equal(blank[0].aliases, undefined);
	assert.equal(blank[0].slug, undefined);
});

test("theme rows come from the renderer's own table shape", () => {
	const rows = argumentRows(
		"theme",
		[{ value: "dracula", name: "Dracula", description: "High contrast" }],
		"dracula",
	);
	assert.deepEqual(rows, [
		{
			value: "dracula",
			name: "Dracula",
			description: "High contrast",
			current: true,
		},
	]);
});

test("the inline list's entity ids are exactly the ones the route serves", () => {
	/*
	 * The drift guard §5.3 asks for, in the style `test_slash_echo.py` pins the
	 * shared registry with: a literal in the test, with the source line in a
	 * comment. `desktop_catalogues.py:262-305` answers exactly these five
	 * commands, and `desktop_commands.py:57-65` advertises the same five in
	 * `native_action.data.entities` (plus `rename`, `goal` and `loop`, which the
	 * desktop routes to dialogs and have no inline list).
	 *
	 * A stale id would not fail anywhere — it would render an empty list, which
	 * is the failure mode this guard exists to make impossible.
	 *
	 * THE GUARD NAMES ALL THREE CATEGORIES. The backend entity ids must equal the
	 * route's set exactly (a sixth one would query a route that does not serve
	 * it); the sessionless ids must equal the literal `SessionlessArgumentSource`
	 * declares, because each one must have a `case` in `argumentRows` (an id
	 * declared with no case renders nothing, and a case with no declared id is
	 * dead code); and the renderer-local ids must equal the ones the shaper has a
	 * case for too. Neither invariant is visible from the other, so each literal
	 * is pinned here and updated deliberately.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/pickers/picker-registry.tsx",
		"utf8",
	);
	const declared = [...source.matchAll(/source:\s*"([a-z-]+)"/g)].map(
		(match) => match[1],
	);
	assert.deepEqual([...new Set(declared)].sort(), [
		"agent",
		"approvals",
		"effort",
		"mcp",
		"model",
		"provider-accounts",
		"providers",
		"team",
		"theme",
		"title-refresh",
	]);
	// The renderer-local half and the sessionless half: read off
	// `slash-argument-rows.ts` rather than restated, so the two files cannot
	// drift into "declared but not shaped".
	const rowSource = readFileSync(
		"src/renderer/src/features/chat/components/slash-argument-rows.ts",
		"utf8",
	);
	const localUnion =
		/RendererArgumentSource = ([^;]+);/.exec(rowSource)?.[1] ?? "";
	const localIds = [...localUnion.matchAll(/"([a-z-]+)"/g)]
		.map((match) => match[1])
		.sort();
	assert.deepEqual(localIds, ["theme", "title-refresh"]);
	const sessionlessUnion =
		/SessionlessArgumentSource =\s*([^;]+);/.exec(rowSource)?.[1] ?? "";
	const sessionlessIds = [...sessionlessUnion.matchAll(/"([a-z-]+)"/g)]
		.map((match) => match[1])
		.sort();
	assert.deepEqual(sessionlessIds, ["mcp", "provider-accounts", "providers"]);
	// Every sessionless and renderer-local id has a `case` in `argumentRows`.
	for (const id of [...localIds, ...sessionlessIds]) {
		assert.match(
			rowSource,
			new RegExp(`case "${id}":`),
			`argumentRows must shape the source "${id}"`,
		);
	}
	// What is left, once both of those are taken out, are the entity commands
	// and they must exactly equal the route's set.
	assert.deepEqual(
		declared
			.filter((id) => !localIds.includes(id) && !sessionlessIds.includes(id))
			.sort(),
		["agent", "approvals", "effort", "model", "team"],
	);
});

/* ------------------------------------------------ sessionless source shaping */

/**
 * A census row shaped like `/v1/auth/providers` answers it (`provider_catalogue`
 * landed): every field the composer's `/login` list reads.
 */
const providerRow = (over = {}) => ({
	id: "openai",
	name: "OpenAI (ChatGPT Plus/Pro)",
	search_aliases: ["gpt", "chatgpt", "codex"],
	state: "needs_login",
	...over,
});

test("a provider row is written by id and read by brand and qualifier", () => {
	const rows = argumentRows(
		"providers",
		[
			providerRow(),
			providerRow({
				id: "deepseek",
				name: "DeepSeek",
				search_aliases: ["ds"],
				state: "logged_in",
			}),
			providerRow({
				id: "anthropic",
				name: "Anthropic (Claude Pro/Max)",
				search_aliases: [],
				state: "env_key",
			}),
			providerRow({
				id: "alibaba-token-plan",
				name: "QwenCloud Token Plan",
				brand: "QwenCloud",
				search_aliases: [],
				state: "local_ready",
			}),
		],
		null,
	);
	// The pick writes the ID; the name column shows the BRAND the backend owns
	// (or the strip-parenthetical fallback when it sends none); the description
	// is the qualifier the id does not already say.
	assert.deepEqual(rows[0], {
		value: "openai",
		name: "OpenAI",
		description: "ChatGPT Plus/Pro",
		detail: "needs login",
		aliases: ["gpt", "chatgpt", "codex"],
	});
	assert.equal(rows[1].name, "DeepSeek");
	// A name that restates its id answers with an EMPTY cell, not a repeat.
	assert.equal(rows[1].description, "");
	// `_credential_state`'s words, one per machine state (spec §5's copy table).
	assert.equal(rows[1].detail, "logged in");
	assert.equal(rows[2].detail, "env key");
	// The backend brand wins over every derivation.
	assert.equal(rows[3].name, "QwenCloud");
	assert.equal(rows[3].detail, "configured server");
	// `local_unconfigured` reads "configure server" (the CLI's own words).
	const [local] = argumentRows(
		"providers",
		[
			providerRow({
				id: "ollama",
				name: "Ollama",
				state: "local_unconfigured",
			}),
		],
		null,
	);
	assert.equal(local.detail, "configure server");
});

test("a row an older backend sends still shapes, without claiming a state", () => {
	// `brand` and `state` absent (the pre-catalogue row): the name falls back to
	// the strip-parenthetical rule, the qualifier still comes from the raw name,
	// and the detail column stays EMPTY rather than inventing a state.
	const [row] = argumentRows(
		"providers",
		[{ id: "openai", name: "OpenAI (ChatGPT Plus/Pro)" }],
		null,
	);
	assert.equal(row.name, "OpenAI");
	assert.equal(row.description, "ChatGPT Plus/Pro");
	assert.equal(row.detail, undefined);
	assert.equal(row.aliases, undefined);
});

test("the qualifier port answers the TUI's own vectors", () => {
	// `_provider_summary` (`app.py:52567`): the parenthetical when there is one,
	// an EMPTY cell when the name restates the id, the name itself otherwise.
	assert.equal(
		providerQualifier("openai", "OpenAI (ChatGPT Plus/Pro)"),
		"ChatGPT Plus/Pro",
	);
	assert.equal(providerQualifier("deepseek", "DeepSeek"), "");
	assert.equal(providerQualifier("openrouter", "OpenRouter"), "");
	assert.equal(
		providerQualifier("alibaba-token-plan", "QwenCloud Token Plan"),
		"QwenCloud Token Plan",
	);
	assert.equal(providerQualifier("kimi", "Kimi (Moonshot)"), "Moonshot");
});

test("subsequences and aliases both reach openai", () => {
	/*
	 * The operator's exact typo class (`/login ope…`): a subsequence of the id
	 * reaches the row (`ope` → `openai`, the matcher's own fuzzy arm), and the
	 * registry's aliases reach it by name (`chatgpt`, `gpt` — the spellings a
	 * user actually types for this provider).
	 */
	const rows = argumentRows(
		"providers",
		[
			providerRow(),
			providerRow({
				id: "openrouter",
				name: "OpenRouter",
				search_aliases: ["or", "router"],
			}),
			providerRow({
				id: "anthropic",
				name: "Anthropic (Claude Pro/Max)",
				search_aliases: ["claude"],
			}),
		],
		null,
	);
	for (const query of ["ope", "chatgpt", "gpt", "openai"]) {
		const matches = matchChoices(query, rows);
		assert.ok(matches.length > 0, `${query} reaches a row`);
		assert.equal(matches[0].choice.value, "openai", `${query} reaches openai`);
	}
});

test("/logout's list groups credentials per provider and names the removal", () => {
	const rows = argumentRows(
		"provider-accounts",
		[
			{
				provider: "openai",
				type: "oauth",
				identity_label: "damian@gominerva.com",
			},
			// Two credentials under ONE storage id (`xai`/`xai-oauth` share a row,
			// and a provider can hold a key beside an OAuth grant): one row, the
			// count as the digest, no identity — the TUI's own rule.
			{ provider: "xai", type: "api_key", identity_label: "Stored credential" },
			{ provider: "xai", type: "oauth", identity_label: "Stored credential" },
			{
				provider: "anthropic",
				type: "api_key",
				identity_label: "work@example.com",
			},
		],
		null,
	);
	assert.deepEqual(
		rows.map((row) => row.value),
		["openai", "xai", "anthropic"],
	);
	assert.equal(rows[0].detail, "remove oauth · damian@gominerva.com");
	// One row per provider: the second credential under `xai` is a COUNT, not a
	// second row (`_removal_detail` reads `remove 2 credentials`).
	assert.equal(rows[1].detail, "remove 2 credentials");
	assert.equal(rows[2].detail, "remove api key · work@example.com");
	// Every row on this list destroys a credential; the alert is what the
	// keyboard gate reads to fill rather than fire on a fuzzy survivor.
	for (const row of rows) assert.equal(row.alert, true, row.value);
	// A single credential with only the generic label has no identity to state.
	const [alone] = argumentRows(
		"provider-accounts",
		[
			{
				provider: "github",
				type: "oauth",
				identity_label: "Stored credential",
			},
		],
		null,
	);
	assert.equal(alone.detail, "remove oauth");
});

test("/logout rows are named the census way, and carry its aliases", () => {
	/*
	 * Round 1, D5/U6 and U4: `/login` named rows by the census's `brand` and
	 * reached them by `search_aliases`; `/logout` showed the raw id and matched
	 * the id alone, so the SAME provider read `OpenAI` in one popup and `openai`
	 * in the next, and `chatgpt` reached it in one command but not the other.
	 * The shaper now joins the census the hook already fetches.
	 */
	const census = [
		{
			id: "openai",
			name: "OpenAI (ChatGPT Plus/Pro)",
			brand: "OpenAI",
			search_aliases: ["gpt", "chatgpt"],
		},
		{
			id: "anthropic",
			name: "Anthropic (Claude Pro/Max)",
			brand: "Anthropic",
			search_aliases: ["claude"],
		},
	];
	const rows = argumentRows(
		"provider-accounts",
		[
			{ provider: "openai", type: "oauth", identity_label: "a@b.c" },
			{ provider: "zai", type: "api_key", identity_label: "Stored credential" },
		],
		null,
		{ providers: census },
	);
	assert.equal(rows[0].name, "OpenAI");
	assert.equal(
		rows[0].value,
		"openai",
		"the id stays the value the command takes",
	);
	assert.deepEqual(rows[0].aliases, ["gpt", "chatgpt"]);
	assert.equal(
		matchChoices("chatgpt", rows)[0]?.choice.value,
		"openai",
		"the alias vocabulary is the one /login already honours",
	);
	// A provider the census does not know (or a census that failed to load)
	// keeps the row legible by its id, with no invented aliases.
	assert.equal(rows[1].name, "zai");
	assert.equal(rows[1].aliases, undefined);
});

/* The document table the real backend will publish (spec §3.1): descriptions
   verbatim from the TUI's own literal (`app.py:47703-47725`). */
const MCP_VERBS = [
	{
		verb: "list",
		description: "Show every configured server and its status",
		destructive: false,
		offers: null,
	},
	{
		verb: "add",
		description: "Configure a new server (url, or a stdio command)",
		destructive: false,
		offers: null,
	},
	{
		verb: "remove",
		description: "Delete a server from local-operator's config",
		destructive: true,
		offers: "all",
	},
	{
		verb: "login",
		description: "Authorize an OAuth server (opens the browser)",
		destructive: false,
		offers: "oauth",
	},
	{
		verb: "logout",
		description: "Forget a server's stored OAuth credential",
		destructive: true,
		offers: "signed_in",
	},
	{
		verb: "reauth",
		description:
			"Forget first, then authorize — for an account or scope change",
		destructive: true,
		offers: "oauth",
	},
];

const MCP_SERVERS = [
	{
		name: "linear",
		status: "needs_sign_in",
		actions: ["test", "sign_in"],
		source: { path: "/Users/you/.local-operator/config.yml" },
	},
	{
		name: "github",
		status: "connected",
		actions: ["test", "sign_out", "reauth"],
		source: { path: "/Users/you/.claude.json" },
	},
	{
		name: "postgres",
		status: "needs_sign_in",
		actions: ["test", "set_key"],
		source: { path: "/Users/you/project/.mcp.json" },
	},
];

test("the /mcp verb slot reads the document's verbs, alert on destructive", () => {
	const rows = argumentRows("mcp", MCP_SERVERS, null, {
		argument: "",
		verbs: MCP_VERBS,
	});
	// The document's ORDER, list first — the row a stray Enter lands on is the
	// one that only shows something.
	//
	// THE TRAILING SPACE IS THE HANDOFF (round 1, U1): the value is what a pick
	// WRITES, and choosing a verb must leave `/mcp login ` in the buffer so the
	// server slot opens — `completionFor` appends no space for this source
	// (`nameThenMessage` is false on purpose: that flag would CLOSE the list
	// instead of advancing it), so the row's own value carries it.
	assert.deepEqual(
		rows.map((row) => row.value),
		["list ", "add ", "remove ", "login ", "logout ", "reauth "],
	);
	assert.equal(
		rows[0].description,
		"Show every configured server and its status",
	);
	// `alert` is the keyboard gate's input: destructive verbs carry it, and an
	// empty argument is not evidence about which verb is meant.
	assert.deepEqual(
		rows.map((row) => row.alert),
		[false, false, true, false, true, true],
	);
});

test("a partially typed verb stays in the verb slot", () => {
	const rows = argumentRows("mcp", MCP_SERVERS, null, {
		argument: "lo",
		verbs: MCP_VERBS,
	});
	// The slot is the TUI's partition on the first space; a partial word is
	// still the verb slot, and every candidate keeps the terminator its pick
	// will write.
	assert.deepEqual(
		rows.map((row) => row.value),
		["list ", "add ", "remove ", "login ", "logout ", "reauth "],
	);
});

test("the /mcp server slot filters by offers and names the per-verb outcome", () => {
	const rowsFor = (verb) =>
		argumentRows("mcp", MCP_SERVERS, null, {
			argument: `${verb} `,
			verbs: MCP_VERBS,
		});
	// `login` admits every OAuth-capable row — signed out via `sign_in` and
	// signed in via `reauth`/`sign_out` are BOTH reachable (the TUI's rule).
	const login = rowsFor("login");
	assert.deepEqual(
		login.map((row) => row.value),
		["login linear", "login github"],
	);
	assert.equal(login[0].detail, "needs sign-in");
	assert.equal(login[1].detail, "connected — will re-use");
	assert.equal(
		login.every((row) => row.alert === false),
		true,
	);
	// `logout` admits only rows a logout can act on, and its detail names what
	// is being removed, never a bare connection state.
	const logout = rowsFor("logout");
	assert.deepEqual(
		logout.map((row) => row.value),
		["logout github"],
	);
	assert.equal(logout[0].detail, "stored credential · connected");
	assert.equal(logout[0].alert, true);
	const reauth = rowsFor("reauth");
	assert.equal(reauth[1].detail, "connected — will re-authorize");
	// `remove` admits EVERY configured row (the config is what it edits), and
	// the detail is the source file — home-relative through `compactPath` — so
	// a foreign import's refusal is something the user saw coming.
	const remove = rowsFor("remove");
	assert.deepEqual(
		remove.map((row) => row.value),
		["remove linear", "remove github", "remove postgres"],
	);
	assert.equal(remove[1].detail, "~/.claude.json");
	assert.equal(
		remove.every((row) => row.alert === true),
		true,
	);
	// `list` takes no argument and an added name is new by definition: both
	// offer nothing, and the user just types.
	assert.deepEqual(rowsFor("list"), []);
	assert.deepEqual(rowsFor("add"), []);
});

test("a backend that does not advertise the features offers no list at all", () => {
	/*
	 * The degrade matrix (spec §4.2), driven through the REAL resolver the hook
	 * reads: `provider_catalogue` absent drops both provider lists, an
	 * `mcp_catalog` still at 1 drops the MCP pair (the verbs table the server
	 * slot needs is the v2 addition), and neither may disturb a list that
	 * carries no requirement (every existing command's).
	 */
	const login = {
		source: "providers",
		nameThenMessage: false,
		runs: true,
		requires: "provider_catalogue",
	};
	const accounts = {
		source: "provider-accounts",
		nameThenMessage: false,
		runs: false,
		requires: "provider_catalogue",
	};
	const mcp = {
		source: "mcp",
		nameThenMessage: false,
		runs: false,
		requires: "mcp_catalog",
	};
	const licensed = {
		desktop_available: true,
		features: { provider_catalogue: 1, mcp_catalog: 2 },
	};
	assert.deepEqual(effectiveInlineArgument(login, licensed), login);
	assert.deepEqual(effectiveInlineArgument(accounts, licensed), accounts);
	assert.deepEqual(effectiveInlineArgument(mcp, licensed), mcp);
	const providerless = {
		desktop_available: true,
		features: { mcp_catalog: 2 },
	};
	assert.equal(effectiveInlineArgument(login, providerless), undefined);
	assert.equal(effectiveInlineArgument(accounts, providerless), undefined);
	assert.deepEqual(effectiveInlineArgument(mcp, providerless), mcp);
	// `mcp_catalog: 1` is the shipped Settings contract, NOT this licence.
	const v1Catalog = {
		desktop_available: true,
		features: { provider_catalogue: 1, mcp_catalog: 1 },
	};
	assert.equal(effectiveInlineArgument(mcp, v1Catalog), undefined);
	assert.deepEqual(effectiveInlineArgument(login, v1Catalog), login);
	// No answer at all, and an unpaired plane, both fail closed.
	assert.equal(effectiveInlineArgument(login, null), undefined);
	assert.equal(effectiveInlineArgument(mcp, undefined), undefined);
	assert.equal(
		effectiveInlineArgument(login, {
			desktop_available: false,
			features: { provider_catalogue: 1 },
		}),
		undefined,
	);
	// A list with no requirement predates all of this and is never touched.
	const model = { source: "model", nameThenMessage: false, runs: false };
	assert.deepEqual(effectiveInlineArgument(model, null), model);
});

test("the /rename flag list is the one row the backend honours, aliased", () => {
	/*
	 * The row the operator's report is about, and its boundaries. `--refresh` is
	 * the ONE row: the backend honours more spellings than any surface should
	 * OFFER (`session/naming.py`'s `TITLE_REFRESH_FLAGS` / `TITLE_REFRESH_WORDS`
	 * carry `--auto`, `--update`, `--retitle` and their bare forms as a
	 * TOLERANCE, so a near-miss is never stored as a title), and the help text
	 * advertises exactly one of them (`slash_commands.py`:
	 * `"Name this conversation, or /title --refresh"`). A test rather than a
	 * comment because the list is a literal and a literal grows by accident.
	 *
	 * The alias is pinned with the row because the alias is the half a reviewer
	 * would "tidy away": it looks redundant next to a name that `refresh`
	 * subsequence-matches, and its whole job is RANK (`matchChoices` scores on
	 * name and aliases, displays `name`).
	 *
	 * ROUND 1 (U3) ADDED THE BARE SYNONYMS to that list — `update` and `retitle`,
	 * which the backend honours and the first cut left unreachable. They are ALIASES
	 * and not rows, so the visible list stays ONE choice while a user who knows one
	 * of those words can find it; `--update`/`--retitle` are pinned here too because
	 * the dashed spellings are what a user who learned the flag shape reaches for.
	 * `--auto` is in NEITHER the aliases nor the rows, deliberately: it is the one
	 * honoured spelling with no bare twin, so it cannot be reached by typing a word
	 * a user already knows — only by being taught, and this list is not where the
	 * backend's tolerance gets advertised.
	 */
	const rows = argumentRows("title-refresh", [], null);
	assert.equal(rows.length, 1);
	assert.deepEqual(rows[0], {
		value: "--refresh",
		name: "--refresh",
		description: "Re-read the conversation and name it again",
		detail: "resumes auto-naming",
		aliases: ["refresh", "update", "retitle", "--update", "--retitle"],
	});
	// The flag form is what a pick writes AND what a run sends, so a row whose
	// `value` drifted from its `name` would run a different spelling than it
	// shows. They are equal here by construction and pinned so they stay so.
	assert.equal(rows[0].value, rows[0].name);
	// The inputs are ignored, and that is the contract: no route serves this list,
	// so a caller that passed entities by mistake must get the same rows rather
	// than a phantom list.
	assert.deepEqual(argumentRows("title-refresh", [{ value: "x" }], "x"), rows);
	// A copy, not the module constant: a caller that mutated a returned row must
	// not corrupt the next caller's list.
	assert.notEqual(argumentRows("title-refresh", [], null), rows);
});
