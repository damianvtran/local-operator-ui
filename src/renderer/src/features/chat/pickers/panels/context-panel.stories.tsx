/**
 * `panels-context` — `/context` in every state it can be in.
 *
 * The production `ContextPanel` over fixtures of the OWNER's own answer, which
 * is what this panel reads: `/context` is a routed command rather than a
 * catalogue, so its body arrives as a `SlashResult` whose rows the owner built.
 *
 * Two rows carry the whole design:
 *
 * - The estimate rows each take `~`, because the number is an estimate of the
 *   next request rather than a measurement of the last one — which is also why
 *   section 1 exists above them and renders even when the ledger is empty.
 * - The Total sits behind a rule because it is a share of the CONTEXT WINDOW
 *   while the six rows above it are shares of the estimate. The separator is
 *   the claim that the row is a different kind of quantity.
 *
 * `NoNumbers` is the frame that matters most for compatibility: an older
 * backend sends the formatted pairs and no dict, and the panel renders them as
 * the owner spelled them with no bars — it never parses `~12.4k` back into a
 * number, because a formatter change would then silently move a chart.
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../../styles/index.css";
import type { SlashOutcome } from "../use-picker-backend";
import { ContextPanel } from "./context-panel";

const noop = () => {};

const frontend = {
	context_tokens: 12_400,
	context_window: 200_000,
	context_is_estimate: false,
};

const NUMBERS = {
	instructions: 18_400,
	tool_inventory: 2_240,
	tool_schemas: 21_800,
	environment: 1_120,
	knowledge_mcp_goal: 3_400,
	messages: 8_400,
	context_window: 200_000,
	cache_read: 31_200,
	total: 55_360,
};

const ITEMS: [string, string][] = [
	["Instructions", "~18.4k"],
	["Tool inventory", "~2.2k"],
	["Tool schemas", "~21.8k"],
	["Environment", "~1.1k"],
	["Skills / MCP / goal", "~3.4k"],
	["Messages", "~8.4k"],
	["Total", "~55.4k / 200k (27.7%)"],
	["Last cache read (exact)", "31.2k"],
];

const block = (data: Record<string, unknown>): SlashOutcome => ({
	kind: "block",
	text: "",
	style: "info",
	data,
});

const populated = block({
	type: "context",
	title: "Estimated next request",
	items: ITEMS,
	numbers: NUMBERS,
});

/** An older backend: the same rows, no `numbers`, so no bars and no parsing. */
const noNumbers = block({
	type: "context",
	title: "Estimated next request",
	items: ITEMS,
});

const base = {
	frontend,
	busy: false,
	result: null,
	onClose: noop,
};

const meta: Meta<typeof ContextPanel> = {
	title: "panels-context",
	component: ContextPanel,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof ContextPanel>;

/** The default state: the live gauge, the estimate, and the exact cache read. */
export const Populated: Story = { args: { ...base, outcome: populated } };

/** The pre-`numbers` path: pairs as the owner spelled them, no bars, no parse. */
export const NoNumbers: Story = { args: { ...base, outcome: noNumbers } };

/** The owner has no breakdown to give: the copy says what to do about it. */
export const BreakdownUnavailable: Story = {
	args: {
		...base,
		outcome: {
			kind: "notice",
			text: "context breakdown unavailable.",
			style: "info",
			data: {},
		},
	},
};

/** The owner returned nothing at all: not an error, and not an empty answer. */
export const Empty: Story = { args: { ...base, outcome: null } };

/** The wait is real (the block comes from the owner), so the copy says so. */
export const Loading: Story = { args: { ...base, outcome: null, busy: true } };

/** The owner's own failure text, never re-worded. */
export const Unavailable: Story = {
	args: {
		...base,
		outcome: null,
		result: {
			tone: "error",
			text: "/context did not run: the owner is not attached to this session.",
		},
	},
};

/** The live half unmeasured: the dotted rule and the words, sections 2 still up. */
export const FrontendUnmeasured: Story = {
	args: {
		...base,
		frontend: {
			context_tokens: null,
			context_window: null,
			context_is_estimate: null,
		},
		outcome: populated,
	},
};

/** An estimated live figure says so, right beside its numbers. */
export const Estimated: Story = {
	args: {
		...base,
		frontend: { ...frontend, context_is_estimate: true },
		outcome: populated,
	},
};

/**
 * The largest legal payload: every row the owner sends, plus the cache card.
 *
 * `/context`'s body is bounded by the owner's own row set — six estimate rows, a
 * total and at most one cache row — so the whole panel fits the host's scroll
 * box at every shipped size. That is why this story is the full payload rather
 * than a body that overflows: there is no larger legal answer to draw.
 */
export const Dense: Story = { args: { ...base, outcome: populated } };

/** 720px: the bars surrender width first; the labels and the total hold. */
export const Narrow: Story = { args: { ...base, outcome: populated } };
