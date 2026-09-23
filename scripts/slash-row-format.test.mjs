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
			'export * from "./src/renderer/src/features/chat/components/slash-argument-rows"; export { effortCommandSucceeded, writeModelDefaultSettings } from "./src/renderer/src/features/chat/pickers/model-default-settings";',
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
	effortCommandSucceeded,
	writeModelDefaultSettings,
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

test("a model row only claims `no credential` when its own flag says so", () => {
	// `credentials_known` lives on `models.catalogue` and the entities route does
	// not carry it, so the rule is applied as written: only an explicit `false`
	// suppresses the caveat, and `connected` (which this route does send) is what
	// raises it.
	const [row] = argumentRows("model", [modelRow({ connected: false })], null);
	assert.equal(row.description, "anthropic, no credential");
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
	 * THE GUARD NAMES THE RENDERER-LOCAL SOURCES TOO, and that is the half that
	 * had to be EXTENDED rather than deleted when `/rename`'s flag list landed.
	 * The two halves answer different questions: the backend ids must equal the
	 * route's set exactly (a sixth one would query a route that does not serve
	 * it), while the renderer-local ids must equal the ones `argumentRows`
	 * actually has a `case` for (an id declared with no case renders nothing, and
	 * a case with no declared id is dead code) — and neither invariant is visible
	 * from the other, so both literals are pinned here. `title-refresh` joins
	 * `theme` in the second list, and the literal in each is the thing a future
	 * author updates deliberately.
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
		"model",
		"team",
		"theme",
		"title-refresh",
	]);
	// The renderer-local half: exactly two, and they are the ones the row shaper
	// has a case for. Read off `slash-argument-rows.ts` rather than restated, so
	// the two files cannot drift into "declared but not shaped".
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
	// Every renderer-local id has a `case` in `argumentRows`, and every declared
	// id is one of the two halves. Together these are the whole guard: a new
	// source cannot be added without stating which half it is, and a half cannot
	// be stated without the shaping existing.
	for (const id of localIds) {
		assert.match(
			rowSource,
			new RegExp(`case "${id}":`),
			`argumentRows must shape the renderer-local source "${id}"`,
		);
	}
	// The other five are entity commands and must exactly equal the route's set.
	assert.deepEqual(declared.filter((id) => !localIds.includes(id)).sort(), [
		"agent",
		"approvals",
		"effort",
		"model",
		"team",
	]);
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
