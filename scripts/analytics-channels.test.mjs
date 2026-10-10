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
 * not a hand-written idea of the shape. Four rules a frame cannot distinguish
 * are pinned here:
 *
 * - the total is READ (`total_micro`) and printed through THIS panel's ladder
 *   (`formatMicroUsd`), with `+` for a lower bound — never re-summed, and
 *   never the strip's ladder, which is why this is a separate spelling and not
 *   an import of the strip's line builder;
 * - a `null` amount is the WORD `not tracked`, not `—`: `—` blames the read,
 *   and a record with no basis is a fact of its own;
 * - subscription dollars stay in their own bucket and their own word
 *   (`API-equivalent`) — the operator rule that plan-funded money is never
 *   mixed with cash;
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
		contents:
			'export * from "./src/renderer/src/features/chat/pickers/panels/analytics-model";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { channelsView } = await import(
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
	assert.equal(
		view.basisLine,
		"Billed $0.053 · API-equivalent $0.053 · Estimated $0.010 · 2 not tracked",
	);
	assert.deepEqual(view.rows, [
		{
			key: "0:Inference · anthropic/claude-sonnet-5-5",
			name: "Inference · anthropic/claude-sonnet-5-5",
			spend: "$0.900",
			// The inference placeholder basis (`not_tracked`) is not a row word
			// beside a sized figure; the summary's count carries it.
			basis: "",
		},
		{
			key: "1:Image · openai-sub/gpt-image-2",
			name: "Image · openai-sub/gpt-image-2",
			spend: "$0.053",
			basis: "API-equivalent",
		},
		{
			key: "2:Image · radient/gpt-image-2",
			name: "Image · radient/gpt-image-2",
			// `partial` row knowledge: a lower bound, marked the panel's way.
			spend: "$0.053+",
			basis: "billed",
		},
		{
			key: "3:Read · deepseek:read",
			name: "Read · deepseek:read",
			spend: "$0.0020",
			basis: "estimated",
		},
		{
			key: "4:Search · tavily",
			name: "Search · tavily",
			spend: "$0.0080",
			basis: "estimated",
		},
	]);
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
	assert.equal(view.rows[0].spend, "not tracked");
	assert.equal(view.basisLine, "1 not tracked");
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
		["billed", "API-equivalent"],
	);
});

test("tracked=false is carried through for the section's own sentence", () => {
	const view = channelsView({ ...SPEND_CHANNELS, tracked: false });
	assert.ok(view);
	assert.equal(view.tracked, false);
});
