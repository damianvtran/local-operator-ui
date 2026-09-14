/**
 * `panels-session` — `/session` in every state it can be in.
 *
 * The production `SessionPanel` over real-shaped `sessions.report` fixtures.
 * The states that matter here are the ones an older or unluckier ledger
 * produces, because each is a different KIND of unknown:
 *
 * - `tool_calls: null` is "no tool-call rows were ever recorded" (a session
 *   predating the feature) and must never render as a row of zeros;
 * - `descendants_aggregate: null` is "the subtree walk could not run" and must
 *   never read as "$0.00 of subagents";
 * - `timings.*.samples === 0` is `unknown (0 samples)`, not `0 ms`;
 * - `available: false` is "the read failed", where NOTHING on the panel — not
 *   even the live gauge — is trustworthy.
 *
 * The last frame in particular is why the panel is sectioned rather than
 * plain: a partial read has to be able to say which half it is missing.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type {
	DesktopSessionReport,
	DesktopUsageAggregate,
} from "../../../../../../shared/desktop-contract";
import "../../../../styles/index.css";
import { SessionPanel } from "./session-panel";

const noop = () => {};

/** The full-shape aggregate a report always carries; each fixture overrides. */
const aggregate = (
	over: Partial<DesktopUsageAggregate> = {},
): DesktopUsageAggregate => ({
	calls: 0,
	ok_calls: 0,
	input_tokens: 0,
	output_tokens: 0,
	cache_read_tokens: 0,
	cache_write_tokens: 0,
	reasoning_tokens: 0,
	context_tokens: 0,
	cost_micro: 0,
	cost_known_calls: 0,
	components: {},
	by_provider: {},
	by_session: {},
	...over,
});

const COMPONENTS = {
	system_prompt: 18_400,
	custom_instructions: 4_120,
	tool_inventory: 2_240,
	tool_schemas: 21_800,
	environment: 1_120,
	knowledge: 3_400,
	conversation: 61_200,
	tool_results: 24_800,
	images: 0,
};

const report = (
	over: Partial<DesktopSessionReport> = {},
): DesktopSessionReport => ({
	session_id: "a1b2c3d4e5f6",
	available: true,
	aggregate: aggregate({
		calls: 42,
		ok_calls: 40,
		input_tokens: 486_000,
		output_tokens: 92_400,
		cache_read_tokens: 312_000,
		cache_write_tokens: 24_000,
		reasoning_tokens: 18_200,
		context_tokens: 578_400,
		cost_micro: 8_124_000,
		cost_known_calls: 42,
		components: COMPONENTS,
	}),
	descendants_aggregate: null,
	descendant_ids: [],
	by_model: [
		{
			provider: "anthropic",
			model_id: "claude-sonnet-4-5",
			aggregate: aggregate({
				calls: 34,
				ok_calls: 32,
				context_tokens: 462_000,
				output_tokens: 74_000,
				cost_micro: 6_820_000,
				cost_known_calls: 34,
			}),
		},
		{
			provider: "openai",
			model_id: "gpt-5-codex",
			aggregate: aggregate({
				calls: 8,
				ok_calls: 8,
				context_tokens: 116_400,
				output_tokens: 18_400,
				cost_micro: 1_304_000,
				cost_known_calls: 8,
			}),
		},
	],
	by_purpose: [
		{
			purpose: "turn",
			aggregate: aggregate({
				calls: 35,
				ok_calls: 33,
				context_tokens: 520_000,
				output_tokens: 82_000,
				cost_micro: 7_240_000,
				cost_known_calls: 35,
			}),
		},
		{
			purpose: "naming",
			aggregate: aggregate({
				calls: 4,
				ok_calls: 4,
				context_tokens: 22_400,
				output_tokens: 1_200,
				cost_micro: 84_000,
				cost_known_calls: 4,
			}),
		},
		{
			purpose: "compaction",
			aggregate: aggregate({
				calls: 3,
				ok_calls: 3,
				context_tokens: 36_000,
				output_tokens: 9_200,
				cost_micro: 800_000,
				cost_known_calls: 3,
			}),
		},
	],
	by_purpose_outcome: [
		{ purpose: "turn", outcome: "stop", calls: 33 },
		{ purpose: "turn", outcome: "length", calls: 2 },
	],
	missing_usage_calls: 2,
	unknown_usage_calls: 0,
	timings: {
		duration_ms: { samples: 42, mean_ms: 12_400, min_ms: 840, max_ms: 41_200 },
		ttft_ms: { samples: 40, mean_ms: 1_240, min_ms: 620, max_ms: 4_800 },
		preparation_ms: { samples: 42, mean_ms: 84, min_ms: 12, max_ms: 260 },
	},
	recent: Array.from({ length: 12 }, (_, index) => ({
		request_id: `0000000${index}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.slice(-36),
		ts_ms: Date.UTC(2026, 8, 13, 11, 40 - index * 3),
		provider: index % 4 === 3 ? "openai" : "anthropic",
		model_id: index % 4 === 3 ? "gpt-5-codex" : "claude-sonnet-4-5",
		purpose: index === 0 ? "naming" : "turn",
		outcome: index === 2 ? "length" : "stop",
		usage_reported: index === 1 ? null : true,
		context_tokens: 540_000 + index * 1_200,
		output_tokens: 2_400 + index * 40,
		duration_ms: 12_400 - index * 120,
		ttft_ms: 1_240 - index * 8,
		preparation_ms: 84,
		ok: index === 2 ? false : index === 1 ? null : true,
	})),
	first_ts_ms: Date.UTC(2026, 8, 13, 9, 12),
	last_ts_ms: Date.UTC(2026, 8, 13, 11, 40),
	tool_calls: {
		total: 96,
		ok: 88,
		faults: {
			unknown_tool: 3,
			invalid_arguments: 2,
			denied: 2,
			execution: 1,
		},
		faults_by_tool: { bash: 3, edit: 2, read: 1 },
		nested_total: 12,
		nested_ok: 11,
		nested_excluded: 1,
	},
	...over,
});

const frontend = {
	conversation_title: "First-class panel views",
	context_tokens: 12_400,
	context_window: 200_000,
	context_is_estimate: false,
};

const base = {
	loading: false,
	error: null,
	gated: false,
	frontend,
	sessionId: "a1b2c3d4e5f6",
	metric: "tokens" as const,
	onMetricChange: noop,
	onClose: noop,
};

const meta: Meta<typeof SessionPanel> = {
	title: "panels-session",
	component: SessionPanel,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof SessionPanel>;

/** The default state: nine sections, one ledger snapshot. */
export const Populated: Story = {
	args: { ...base, report: report() },
};

/** A subtree that could be walked: the headline becomes the tree's money. */
export const TreeCost: Story = {
	args: {
		...base,
		report: report({
			descendant_ids: ["b2c3d4e5f6a1", "c3d4e5f6a1b2"],
			descendants_aggregate: aggregate({
				calls: 61,
				ok_calls: 59,
				context_tokens: 720_000,
				output_tokens: 148_000,
				cost_micro: 14_820_000,
				cost_known_calls: 61,
				components: COMPONENTS,
			}),
		}),
	},
};

/** A subtree the walk could not run: the note says so, and never `$0.00`. */
export const TreeCostUnmeasured: Story = {
	args: {
		...base,
		report: report({
			descendant_ids: ["b2c3d4e5f6a1"],
			descendants_aggregate: null,
		}),
	},
};

/** A session predating tool-call recording: one line, no zeroed counters. */
export const NoToolCalls: Story = {
	args: { ...base, report: report({ tool_calls: null }) },
};

/** Timings with no samples: `unknown (0 samples)`, never `0 ms`. */
export const ZeroSamples: Story = {
	args: {
		...base,
		report: report({
			timings: {
				duration_ms: { samples: 0, mean_ms: null, min_ms: null, max_ms: null },
				ttft_ms: { samples: 0, mean_ms: null, min_ms: null, max_ms: null },
				preparation_ms: {
					samples: 0,
					mean_ms: null,
					min_ms: null,
					max_ms: null,
				},
			},
		}),
	},
};

/** An empty ledger: the empty copy, plus the LIVE gauge that still has a value. */
export const Empty: Story = {
	args: {
		...base,
		report: report({
			aggregate: aggregate(),
			by_model: [],
			by_purpose: [],
			by_purpose_outcome: [],
			recent: [],
			tool_calls: null,
			first_ts_ms: null,
			last_ts_ms: null,
		}),
	},
};

/** No call in the session is priceable: `—` and the sentence beside it. */
export const Unpriced: Story = {
	args: {
		...base,
		report: report({
			aggregate: aggregate({
				...report().aggregate,
				cost_micro: 0,
				cost_known_calls: 0,
			}),
		}),
	},
};

/**
 * The ledger could not be read.
 *
 * Not one section renders, including the live gauge: when the read failed there
 * is no way to say which numbers are trustworthy, and a lone bar under a
 * failure heading invites the reader to trust the rest.
 */
export const Unavailable: Story = {
	args: { ...base, report: report({ available: false }) },
};

/** First paint: the stat grid's skeleton, so the body does not jump later. */
export const Loading: Story = {
	args: { ...base, report: null, loading: true },
};

/** The backend predates the op: the update action, and no call to the route. */
export const Gated: Story = {
	args: { ...base, report: null, gated: true },
};

/** The largest legal payload: every table at its cap on one body. */
export const Dense: Story = {
	args: {
		...base,
		report: report({
			recent: Array.from({ length: 50 }, (_, index) => ({
				request_id: `000000${index}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.slice(-36),
				ts_ms: Date.UTC(2026, 8, 13, 11, 40) - index * 90_000,
				provider: ["anthropic", "openai", "google"][index % 3],
				model_id: ["claude-sonnet-4-5", "gpt-5-codex", "gemini-3-pro"][
					index % 3
				],
				purpose: ["turn", "compaction", "aside", "naming"][index % 4],
				outcome: index % 7 === 0 ? "length" : "stop",
				usage_reported: index % 5 === 0 ? null : true,
				context_tokens: 620_000 + index * 2_400,
				output_tokens: 3_400 + index * 80,
				duration_ms: 42_000 - index * 200,
				ttft_ms: 2_400 - index * 20,
				preparation_ms: 84 + index,
				ok: index % 11 === 0 ? false : index % 5 === 0 ? null : true,
			})),
			by_model: Array.from({ length: 5 }, (_, index) => ({
				provider: ["anthropic", "openai", "google", "xai", "groq"][index],
				model_id: [
					"claude-sonnet-4-5",
					"gpt-5-codex",
					"gemini-3-pro",
					"grok-4",
					"kimi-k2",
				][index],
				aggregate: aggregate({
					calls: 30 - index * 4,
					ok_calls: 29 - index * 4,
					context_tokens: 400_000 - index * 60_000,
					output_tokens: 80_000 - index * 12_000,
					cost_micro: 6_000_000 - index * 900_000,
					cost_known_calls: 30 - index * 4,
				}),
			})),
		}),
	},
};

/** 720px: the tables shed the Calls column last, the bars first. */
export const Narrow: Story = { args: { ...base, report: report() } };
