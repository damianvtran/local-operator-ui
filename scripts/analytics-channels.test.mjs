import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The analytics panel's By-channel view: the backend's published
 * `spend_channels` object as `/analytics` renders it (the cost-channels
 * project).
 *
 * `analytics-model.ts` owns this reading for the same reason it owns every
 * other panel decision — it is executable without a DOM — and the assertions
 * are off the backend's own golden fixture (`fixtures/spend-channels-v1.json`),
 * not a hand-written idea of the shape. Rules a frame cannot distinguish are
 * pinned here:
 *
 * - the total is READ (`total_micro`) and printed through THIS panel's ladder
 *   (`formatMicroUsd`), with `+` for a lower bound — never re-summed;
 * - a `null` amount is the words `price unknown`, shared with the strip
 *   (`PRICE_UNKNOWN_TEXT`): `—` blames the read, "not tracked" is the
 *   session-level state, and one record must not grow two descriptions;
 * - a null ROW is refused rather than thrown on (the reading filters it, so
 *   `rows: [null]` renders as no rows and the section stands);
 * - subscription dollars stay in their own bucket and their own word
 *   (`API-equivalent`) — the operator rule that plan-funded money is never
 *   mixed with cash;
 * - the composition line and the plan gloss come from the SAME builders the
 *   strip uses (`channelSummaryLine`/`channelPlanClause`), through this
 *   panel's ladder, so the words cannot drift even though the money ladders
 *   deliberately do;
 * - the two surfaces round a tie the same way (QA round 1, Q2 — swept here);
 * - everything that is not a usable v1 object (a future version included)
 *   renders as `null`, and the section then does not exist at all — today's
 *   panel, which is what an old server keeps.
 *
 * `scripts/session-status.test.mjs` owns the STRIP's reading of the same
 * object; these two files are the pair that keeps one wire object from growing
 * two spellings of one number on two surfaces.
 */

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/pickers/panels/analytics-model";',
			'export * from "./src/renderer/src/features/chat/session-status/session-cost";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { channelsView, sessionCost, PRICE_UNKNOWN_TEXT } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const SPEND_CHANNELS = JSON.parse(
	readFileSync(join(ROOT, "scripts/fixtures/spend-channels-v1.json"), "utf8"),
);

test("the fixture renders as the panel's table, in this panel's ladder", () => {
	const view = channelsView(SPEND_CHANNELS);
	assert.ok(view);
	assert.equal(view.tracked, true);
	// 1.016 USD is a lower bound (knowledge: partial), so the ladder's `+`.
	assert.equal(view.total, "$1.02+");
	// The plan gloss and the composition, from the shared builders: the total
	// includes plan-funded money, and the line can be reconciled on screen
	// (0.053 + 0.053 + 0.010 + 0.900 = 1.016; D1/D2).
	assert.equal(
		view.planClause,
		"Includes $0.053 API-equivalent (covered by a plan, not charged).",
	);
	assert.equal(
		view.basisLine,
		"Billed $0.053 · API-equivalent $0.053 · Estimated $0.010 · $0.900 without a tracked basis yet · 1 record without a price",
	);
	assert.deepEqual(
		view.rows.map((row) => [row.name, row.spend, row.basis]),
		[
			["Inference · anthropic/claude-sonnet-5-5", "$0.900", "—"],
			["Image · openai-sub/gpt-image-2", "$0.053", "API-equivalent"],
			["Image · radient/gpt-image-2", "$0.053+", "Billed"],
			["Search · tavily", "$0.0080", "Estimated"],
			["Read · deepseek:read", "$0.0020", "Estimated"],
		],
	);
	// Every row's key is its index-prefixed name (the index disambiguates
	// rows that share a name); the projection above checks the visible cells.
	view.rows.forEach((row, index) =>
		assert.equal(row.key, `${index}:${row.name}`),
	);
});

test("an unusable object renders as null, so the section does not exist", () => {
	// The panel renders nothing extra for a null view — an old backend, a
	// malformed payload and a future wire version all keep today's panel.
	assert.equal(channelsView(null), null);
	assert.equal(channelsView(undefined), null);
	assert.equal(channelsView({ ...SPEND_CHANNELS, version: 2 }), null);
	assert.equal(channelsView({ ...SPEND_CHANNELS, total_micro: 1.5 }), null);
	assert.equal(channelsView({ ...SPEND_CHANNELS, rows: null }), null);
	assert.equal(channelsView("spend_channels"), null);
});

test("a null amount and an unstately zero are words, never fabricated zeros", () => {
	const channels = {
		version: 1,
		tracked: true,
		total_micro: 0,
		knowledge: "partial",
		by_basis: {
			billed: 0,
			subscription_api_equivalent: 0,
			estimated: 0,
			not_tracked_calls: 1,
		},
		rows: [
			{
				channel: "tts",
				provider: "radient",
				model: "",
				label: "",
				units: 120,
				unit: "chars",
				amount_micro: null,
				knowledge: "unknown",
				basis: [],
				price_versions: [],
			},
		],
		children: { total_micro: 0, knowledge: "exact" },
	};
	const view = channelsView(channels);
	assert.ok(view);
	// partial + a zero total: money exists that could not be sized, so the
	// figure is this panel's unknown mark, never `$0.0000+`.
	assert.equal(view.total, "—");
	// The words are the strip's own for the same record — one constant, so the
	// two surfaces cannot describe one record two ways (D2) — and the panel's
	// own `—` stands in the Basis cell where a record has none (D5).
	assert.equal(view.rows[0].spend, PRICE_UNKNOWN_TEXT);
	assert.equal(view.rows[0].basis, "—");
	assert.equal(view.basisLine, "1 record without a price");
});

test("subscription dollars stay their own bucket and their own word", () => {
	const channels = {
		version: 1,
		tracked: true,
		total_micro: 1_500_000,
		knowledge: "exact",
		by_basis: {
			billed: 1_000_000,
			subscription_api_equivalent: 500_000,
			estimated: 0,
			not_tracked_calls: 0,
		},
		rows: [
			{
				channel: "image",
				provider: "radient",
				model: "",
				label: "",
				units: 1,
				unit: "images",
				amount_micro: 1_000_000,
				knowledge: "exact",
				basis: ["billed"],
				price_versions: [],
			},
			{
				channel: "image",
				provider: "openai-sub",
				model: "",
				label: "",
				units: 1,
				unit: "images",
				amount_micro: 500_000,
				knowledge: "exact",
				basis: ["subscription_api_equivalent"],
				price_versions: [],
			},
		],
		children: { total_micro: 0, knowledge: "exact" },
	};
	const view = channelsView(channels);
	assert.ok(view);
	assert.equal(view.total, "$1.50");
	assert.equal(view.basisLine, "Billed $1.00 · API-equivalent $0.500");
	assert.deepEqual(
		view.rows.map((row) => row.basis),
		["Billed", "API-equivalent"],
	);
});

test("tracked=false is carried through for the section's own sentence", () => {
	const view = channelsView({ ...SPEND_CHANNELS, tracked: false });
	assert.ok(view);
	assert.equal(view.tracked, false);
	// The count is withheld for a tracked=false session: `N records without a
	// price` under the section's "not tracked" sentence read as a
	// contradiction (D2). The buckets and the not-tracked money stay itemised.
	assert.doesNotMatch(view.basisLine, /without a price/);
	assert.match(view.basisLine, /\$0\.900 without a tracked basis yet/);
});

test("a null row renders as no rows rather than taking the panel down", () => {
	// MINOR-2: `rows: [null]` used to throw inside the model (reading
	// `channel` off null) while the strip's own reading filtered it — one
	// malformed row must fall back, not crash the panel. The drop is COUNTED
	// so the table can say "could not be read" instead of "no rows" (Q6).
	const view = channelsView({ ...SPEND_CHANNELS, rows: [null] });
	assert.ok(view);
	assert.deepEqual(view.rows, []);
	assert.equal(view.rowsDropped, 1);
});

test("the panel's remainder register is a suffix `+`, the strip's a prefix `≥`", () => {
	/*
	 * The same published remainder, one floored contributor: the strip's
	 * register is the band's `≥` prefix, the panel's is the TUI table cell's
	 * trailing `+` (analytics_panel.py `_cost_cell`) — round 2, MINOR-2, and
	 * the two-surface half of the strip's own floor test.
	 */
	const flooredRow = { ...SPEND_CHANNELS.rows[0], knowledge: "partial" };
	const view = channelsView({
		...SPEND_CHANNELS,
		rows: [flooredRow, ...SPEND_CHANNELS.rows.slice(1)],
	});
	assert.ok(view);
	assert.match(view.basisLine, /\$0\.900\+ without a tracked basis yet/);
});

test("the strip and the panel round a tie the same way (QA round 1, Q2)", () => {
	/*
	 * QA swept the money range and found six tie values where the strip and
	 * the panel printed one digit apart on the SAME micro amount, because the
	 * panel's ladder rounded half away from zero (`toFixed`) while the strip's
	 * followed Python's f-string rule. Both now round half to EVEN, and the
	 * expected strings below are `python3`'s own output for these amounts
	 * (format(0.0625, ".3f") -> "0.062", etc.) — the TUI's rule, pinned across
	 * the two surfaces rather than restated in prose.
	 */
	const cases = new Map([
		[62_500, "$0.062"],
		[312_500, "$0.312"],
		[562_500, "$0.562"],
		[812_500, "$0.812"],
		[1_125_000, "$1.12"],
		[1_625_000, "$1.62"],
		// Neighbours a micro either side of a tie: not ties themselves, but the
		// pair must still agree — and 501 must round UP.
		[62_499, "$0.062"],
		[62_501, "$0.063"],
	]);
	for (const [micro, want] of cases) {
		const object = {
			version: 1,
			tracked: true,
			total_micro: micro,
			knowledge: "exact",
			by_basis: {
				billed: micro,
				subscription_api_equivalent: 0,
				estimated: 0,
				not_tracked_calls: 0,
			},
			rows: [],
			children: { total_micro: micro, knowledge: "exact" },
		};
		const strip = sessionCost(
			{
				cumulative_parent_cost: null,
				cost_knowledge: "exact",
				spend_channels: object,
			},
			null,
			{ costChannels: true },
		).text;
		const view = channelsView(object);
		assert.ok(view);
		assert.equal(strip, want, `strip at ${micro} µ`);
		assert.equal(view.total, want, `panel at ${micro} µ`);
	}
});
