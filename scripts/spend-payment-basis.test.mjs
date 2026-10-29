import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Bundle the shipped readers, not replicas of the display decisions. The wire
// fixtures are shared with all three stories so numeric and rendered proof use
// identical payment facts, including the older-producer negative control.
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/session-status/session-cost";',
			'export * from "./src/renderer/src/features/chat/session-status/spend-basis-fixtures";',
			'export * from "./src/renderer/src/features/chat/pickers/panels/session-report-model";',
			'export { channelsView } from "./src/renderer/src/features/chat/pickers/panels/analytics-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	channelsReading,
	channelBreakdown,
	channelBasisWords,
	channelPlanClause,
	childBasisLine,
	channelsView,
	subscriptionSpend,
	mixedSpend,
	paygoSpend,
	legacySpend,
	estimatedSpend,
	modelRows,
	spendBasisLegend,
	spendBasisTitle,
	costValue,
	costNote,
} = mod;

test("published total and split lead all channel summaries without row arithmetic", () => {
	for (const wire of [subscriptionSpend, mixedSpend]) {
		const reading = channelsReading(wire);
		assert.equal(
			channelBreakdown(reading).summary,
			"Total $12.41 · Billed $0.790 · Included $11.62 (API-equivalent)",
		);
		assert.equal(
			channelsView(wire).basisLine,
			"Total $12.41 · Billed $0.790 · Included $11.62 (API-equivalent)",
		);
		assert.match(
			channelPlanClause(reading, (micro) => `$${micro / 1e6}`),
			/plan-covered \(API-equivalent, not charged\)/,
		);
	}
	// A deliberately inconsistent row is not permission to repair the backend's total.
	const altered = {
		...subscriptionSpend,
		rows: [{ ...subscriptionSpend.rows[0], amount_micro: 99_000_000 }],
	};
	assert.equal(channelsView(altered).total, "$12.41");
});

test("same-turn inference keeps both recorded bases, without provider inference", () => {
	assert.equal(channelsView(mixedSpend).rows[1].basis, "Billed · Included");
	assert.deepEqual(
		channelBasisWords([
			"subscription_api_equivalent",
			"subscription_api_equivalent",
		]),
		["Included"],
	);
	const wire = {
		...subscriptionSpend,
		breakdown: {
			by_agent: [],
			by_source: [
				{
					id: "inference",
					label: "Inference",
					amount_micro: 12_410_000,
					knowledge: "exact",
					bases: ["billed", "subscription_api_equivalent"],
					unstated_records: 0,
				},
			],
		},
	};
	assert.equal(
		channelBreakdown(channelsReading(wire)).bySource[0].markers,
		"Billed · included · API-equivalent",
	);
	const noVocabulary = { ...wire, vocabulary: undefined };
	assert.equal(
		channelBreakdown(channelsReading(noVocabulary)).bySource[0].markers,
		"Billed · Included · API-equivalent",
	);
});

test("child provenance replaces untracked wording only when the wire records it", () => {
	assert.equal(
		childBasisLine(channelsReading(subscriptionSpend)),
		"Subagents $11.62 · Included (API-equivalent)",
	);
	assert.equal(
		childBasisLine(channelsReading(paygoSpend)),
		"Subagents $11.62 · Billed",
	);
	assert.equal(
		childBasisLine(channelsReading(legacySpend)),
		"Subagents $11.62 · without a tracked basis yet",
	);
	assert.match(
		channelBreakdown(channelsReading(legacySpend)).summary,
		/\$11.62 without a tracked basis yet/,
	);
	const unknownOwn = {
		...subscriptionSpend,
		by_basis: { ...subscriptionSpend.by_basis, not_tracked_micro: 100 },
	};
	assert.doesNotMatch(
		channelBreakdown(channelsReading(unknownOwn)).summary,
		/subagent sessions/,
	);
});

test("paygo has no plan note and old vocabulary is authoritative without a repeated qualifier", () => {
	const paygo = channelsReading(paygoSpend);
	assert.equal(channelBreakdown(paygo).planClause, null);
	assert.deepEqual(paygo.notes, []);
	assert.doesNotMatch(
		channelBreakdown(paygo).summary,
		/Included|API-equivalent/,
	);
	const old = structuredClone(subscriptionSpend);
	old.vocabulary.bases.subscription_api_equivalent.label = "API-equivalent";
	assert.equal(
		childBasisLine(channelsReading(old)),
		"Subagents $11.62 · API-equivalent",
	);
	assert.match(
		channelBreakdown(channelsReading(old)).summary,
		/API-equivalent \$11.62/,
	);
	assert.doesNotMatch(
		channelBreakdown(channelsReading(old)).summary,
		/\$11.62 \(API-equivalent\)/,
	);
});

const aggregate = (micro, calls = 1, known = calls) => ({
	calls,
	ok_calls: calls,
	cost_micro: micro,
	cost_known_calls: known,
	context_tokens: 0,
	output_tokens: 0,
	input_tokens: 0,
	cache_read_tokens: 0,
	cache_write_tokens: 0,
	reasoning_tokens: 0,
	components: {},
	by_provider: {},
	by_session: {},
});
const model = { provider: "anthropic", model_id: "same-model" };
const report = () => ({
	aggregate: aggregate(1_790_000, 3),
	descendants_aggregate: aggregate(10_620_000),
	descendant_ids: ["synthetic-child"],
	by_model: [{ ...model, aggregate: aggregate(1_790_000, 3) }],
	by_model_basis: [
		{ ...model, billing_basis: "billed", aggregate: aggregate(390_000) },
		{ ...model, billing_basis: "billed", aggregate: aggregate(400_000) },
		{
			...model,
			billing_basis: "subscription_api_equivalent",
			aggregate: aggregate(1_000_000),
		},
	],
	descendants_by_basis: [
		{
			billing_basis: "subscription_api_equivalent",
			aggregate: aggregate(10_620_000),
		},
	],
});

test("session legend reconciles own plus descendants and model column joins distinct bases", () => {
	const data = report();
	assert.equal(costValue(data), "$12.41");
	assert.equal(costNote(data), "$1.79 own · $10.62 subagents");
	assert.equal(spendBasisTitle(data), "Spend by basis");
	assert.equal(
		spendBasisLegend(data),
		"Billed $0.790 · Included $11.62 (API-equivalent)",
	);
	assert.equal(modelRows(data, "cost")[0].basis, "Billed · Included");
	assert.equal(modelRows(data, "cost")[0].value, "$1.79");
	assert.equal(modelRows(data, "tokens")[0].basis, undefined);
});

test("older reports cannot claim a child basis or invent a model basis", () => {
	const data = report();
	data.descendants_by_basis = undefined;
	assert.equal(spendBasisTitle(data), "Spend by basis (own)");
	assert.equal(
		spendBasisLegend(data),
		"Billed $0.790 · Included $1.00 (API-equivalent)",
	);
	data.by_model.push({
		provider: "unknown",
		model_id: "no-basis",
		aggregate: aggregate(1),
	});
	assert.equal(
		modelRows(data, "cost").find((row) => row.key === "unknown/no-basis").basis,
		"—",
	);
	data.by_model_basis = undefined;
	assert.equal(spendBasisLegend(data), null);
	assert.equal(modelRows(data, "cost")[0].basis, undefined);
});

test("session basis amounts preserve partial and unpriced aggregate knowledge", () => {
	const data = report();
	data.by_model_basis[0].aggregate = aggregate(390_000, 3, 1);
	assert.match(spendBasisLegend(data), /Billed \$0.790\+/);
	data.by_model_basis = [
		{ ...model, billing_basis: "billed", aggregate: aggregate(0, 1, 0) },
	];
	data.descendants_by_basis = [];
	assert.equal(spendBasisLegend(data), "Billed —");
});

test("estimated payment remains distinct from billed and included on every channel reading", () => {
	const reading = channelsReading(estimatedSpend);
	assert.equal(
		channelBreakdown(reading).summary,
		"Total $12.41 · Estimated $12.41",
	);
	assert.equal(channelsView(estimatedSpend).rows[0].basis, "Estimated");
	assert.equal(childBasisLine(reading), "Subagents $11.62 · Estimated");
	assert.equal(channelBreakdown(reading).planClause, null);
	assert.deepEqual(reading.notes, []);
	const data = report();
	data.by_model_basis = [
		{
			...model,
			billing_basis: "estimated",
			aggregate: aggregate(1_790_000, 3),
		},
	];
	data.descendants_by_basis = [
		{ billing_basis: "estimated", aggregate: aggregate(10_620_000) },
	];
	assert.equal(modelRows(data, "cost")[0].basis, "Estimated");
	assert.equal(spendBasisLegend(data), "Estimated $12.41");
});
