import type { CanonicalSpendChannels } from "../../../../../shared/desktop-session-contract";

/** Shared wire fixtures keep the three spend surfaces on the same payment facts.
 * Included money is list-price equivalent, never an additional cash charge.
 */
const vocabulary = {
	channels: {},
	bases: {
		billed: { label: "billed", marker: "billed", source_class: "paygo" },
		estimated: {
			label: "estimated",
			marker: "estimated",
			source_class: "paygo",
		},
		subscription_api_equivalent: {
			label: "included",
			marker: "included · API-equivalent",
			source_class: "subscription",
			note: "Covered by your plan — the amount is the API list-price equivalent, not money charged.",
		},
	},
};

export const subscriptionSpend: CanonicalSpendChannels = {
	version: 1,
	tracked: true,
	total_micro: 12_410_000,
	knowledge: "exact",
	by_basis: {
		billed: 790_000,
		subscription_api_equivalent: 11_620_000,
		estimated: 0,
		not_tracked_calls: 0,
		not_tracked_micro: 0,
	},
	rows: [
		{
			channel: "image",
			provider: "openai",
			model: "image-model",
			label: "Image generation",
			units: 1,
			unit: "images",
			amount_micro: 790_000,
			knowledge: "exact",
			basis: ["billed"],
			price_versions: [],
		},
	],
	children: {
		total_micro: 11_620_000,
		knowledge: "exact",
		by_basis: { subscription_api_equivalent: 11_620_000 },
	},
	vocabulary,
};

/** The same model can use an API key and a plan during one turn. */
export const mixedSpend: CanonicalSpendChannels = {
	...subscriptionSpend,
	rows: [
		{ ...subscriptionSpend.rows[0], amount_micro: 390_000 },
		{
			...subscriptionSpend.rows[0],
			channel: "inference",
			provider: "anthropic",
			model: "claude-sonnet-5-5",
			label: "anthropic/claude-sonnet-5-5",
			amount_micro: 1_400_000,
			units: 2,
			unit: "calls",
			basis: ["billed", "subscription_api_equivalent"],
		},
	],
	children: {
		total_micro: 10_620_000,
		knowledge: "exact",
		by_basis: { subscription_api_equivalent: 10_620_000 },
	},
};

export const paygoSpend: CanonicalSpendChannels = {
	...subscriptionSpend,
	by_basis: {
		billed: 12_410_000,
		subscription_api_equivalent: 0,
		estimated: 0,
		not_tracked_calls: 0,
		not_tracked_micro: 0,
	},
	children: {
		total_micro: 11_620_000,
		knowledge: "exact",
		by_basis: { billed: 11_620_000 },
	},
};

/** Old producers publish child money but cannot attribute its payment basis. */
export const legacySpend: CanonicalSpendChannels = {
	...subscriptionSpend,
	by_basis: {
		billed: 790_000,
		subscription_api_equivalent: 0,
		estimated: 0,
		not_tracked_calls: 0,
		not_tracked_micro: 11_620_000,
	},
	children: { total_micro: 11_620_000, knowledge: "exact" },
	vocabulary: undefined,
};

/** Estimated paygo is not a confirmed invoice or a subscription entitlement. */
export const estimatedSpend: CanonicalSpendChannels = {
	...paygoSpend,
	by_basis: {
		billed: 0,
		subscription_api_equivalent: 0,
		estimated: 12_410_000,
		not_tracked_calls: 0,
		not_tracked_micro: 0,
	},
	rows: paygoSpend.rows.map((row) => ({ ...row, basis: ["estimated"] })),
	children: {
		total_micro: 11_620_000,
		knowledge: "exact",
		by_basis: { estimated: 11_620_000 },
	},
};
