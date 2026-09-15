import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
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
			'export * from "./src/renderer/src/features/chat/components/slash-argument-rows";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { formatWindow, formatPricePair, trimPrice, argumentRows } = await import(
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
	const [connected] = argumentRows("model", [modelRow({ connected: true })], null);
	assert.equal(connected.description, "anthropic");
});

test("value rows are their own name, and `current` comes from the payload", () => {
	const rows = argumentRows(
		"effort",
		[{ value: "low" }, { value: "high" }],
		"high",
	);
	assert.deepEqual(rows, [
		{ value: "low", name: "low", current: false },
		{ value: "high", name: "high", current: true },
	]);
	const approvals = argumentRows("approvals", [{ value: "auto" }], "auto");
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
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/pickers/picker-registry.tsx",
		"utf8",
	);
	const declared = [...source.matchAll(/source:\s*"([a-z]+)"/g)].map(
		(match) => match[1],
	);
	assert.deepEqual(
		[...new Set(declared)].sort(),
		["agent", "approvals", "effort", "model", "team", "theme"],
	);
	// `theme` is the one renderer-local source; the other five are entity
	// commands and must exactly equal the route's set.
	assert.deepEqual(
		declared.filter((id) => id !== "theme").sort(),
		["agent", "approvals", "effort", "model", "team"],
	);
});
