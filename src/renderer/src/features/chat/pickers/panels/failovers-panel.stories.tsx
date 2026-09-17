/**
 * `panels-failovers` — `/failovers` in every state it can be in.
 *
 * No chart anywhere in this file, and that is the design: a cascade is not a
 * quantity. What the panel answers is one question — is the model serving me the
 * one I selected — and its answer is a pair of labels plus one loud fact.
 *
 * `FailoverInForce` is the reason the panel exists: `Serving` takes the warning
 * tone and says `Failover is in force`, which is a measured condition rather
 * than a judgement about a number. `NoChains` is the empty answer, which is a
 * claim about configuration and is only reachable once the read succeeded.
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../../styles/index.css";
import {
	desktopRequestDeadlineDetail,
	desktopRequestDeadlineMs,
} from "../../../../../../shared/desktop-contract";
import { FailoversPanel } from "./failovers-panel";
import type { FailoversData } from "./failovers-panel";

const noop = () => {};

const CHAINS: Record<string, string[]> = {
	default: [
		"anthropic/claude-sonnet-4-5 (medium)",
		"openai/gpt-5-codex (medium)",
		"google/gemini-3-pro (low)",
	],
	fast: ["openai/gpt-5-mini (low)", "groq/kimi-k2 (low)"],
	reasoning: ["anthropic/claude-opus-4-1 (high)"],
};

const populated: FailoversData = {
	selected: { provider: "anthropic", model_id: "claude-sonnet-4-5" },
	effective: { provider: "anthropic", model_id: "claude-sonnet-4-5" },
	chains: CHAINS,
	scope: "configured_defaults",
	live_model_source: "owner",
};

const base = { loading: false, error: null, onClose: noop };

const meta: Meta<typeof FailoversPanel> = {
	title: "panels-failovers",
	component: FailoversPanel,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof FailoversPanel>;

/** The default state: serving the selected model, three configured chains. */
export const Populated: Story = { args: { ...base, data: populated } };

/** The panel's loud fact: a fallback is serving, so the pair differs. */
export const FailoverInForce: Story = {
	args: {
		...base,
		data: {
			...populated,
			effective: { provider: "openai", model_id: "gpt-5-codex" },
		},
	},
};

/** Nothing configured: the empty copy, and no invented chain. */
export const NoChains: Story = {
	args: { ...base, data: { ...populated, chains: {} } },
};

/** A chain that goes straight to an error, which the row says in words. */
export const EmptyChain: Story = {
	args: { ...base, data: { ...populated, chains: { ...CHAINS, minimal: [] } } },
};

/** No model recorded at all: `none` and no comparison made. */
export const Empty: Story = {
	args: {
		...base,
		data: { ...populated, selected: null, effective: null, chains: {} },
	},
};

/** First paint. */
export const Loading: Story = { args: { ...base, data: null, loading: true } };

/** The read failed, with the backend's own sentence. */
export const Unavailable: Story = {
	args: {
		...base,
		data: null,
		/* Built from the shipped functions, not transcribed: see the analytics story. */
		error: desktopRequestDeadlineDetail(
			"sessions.failovers",
			desktopRequestDeadlineMs("sessions.failovers"),
		).message,
	},
};

/** The largest legal payload: six configured chains of four hops each. */
export const Dense: Story = {
	args: {
		...base,
		data: {
			...populated,
			chains: {
				...CHAINS,
				"long-context": [
					"google/gemini-3-pro (high)",
					"anthropic/claude-sonnet-4-5 (high)",
					"openai/gpt-5 (high)",
					"xai/grok-4 (medium)",
				],
				local: ["ollama/qwen3-coder (low)", "lmstudio/local-model (low)"],
				cheap: [
					"deepseek/deepseek-v3.2 (low)",
					"groq/kimi-k2 (low)",
					"openrouter/mistral-large (low)",
				],
			},
		},
	},
};

/** 720px: the chips wrap, the key column holds. */
export const Narrow: Story = { args: { ...base, data: populated } };
