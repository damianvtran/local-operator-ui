/**
 * `panels-analytics` — `/analytics` in every state it can be in.
 *
 * These render the PRODUCTION `AnalyticsPanel` — the shipped panel with its
 * query lifted — over fixtures, so what is judged here is what ships rather
 * than a story-shaped imitation of it. The states below are the ones that are
 * slow, awkward or impossible to reach live: a day with no calls needs a day
 * off, an unpriced ledger needs a local-only model, and a 30-day window with
 * twelve sessions needs a month of work.
 *
 * Every fixture is REAL-SHAPED — the exact field names and types §5 of the
 * design contract states, including the null cases — and the clock is fixed, so
 * two captures of one frame are the same frame.
 *
 * What to look for, since these frames are the design review:
 *
 * - The four stat cards have NO shared denominator, so exactly one of them
 *   (Cost) carries a bar, and its bar is the priced share rather than the
 *   spend.
 * - The chart's title names its series (`Daily tokens` / `Daily spend`), and
 *   the section meta states the span: the window rule is the reason this panel
 *   exists, and a header that disagreed with the axis is the defect it fixes.
 * - A table's bar column is a fixed width, so the bars stack into one column
 *   and the numbers form one right edge.
 * - The `Cache hit` column is a RATE per row, read from that row's own
 *   aggregate: `79%` beside a provider that reads its cache, `0%` for one that
 *   did not, and `—` for a row whose calls reported no context total at all,
 *   which is a different claim from a measured zero.
 * - `—` and `0` are different claims: an unpriced window shows `—` and a
 *   sentence, never `$0.00`.
 */

import { Button } from "@shared/components/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { DesktopUsageAggregate } from "../../../../../../shared/desktop-contract";
import "../../../../styles/index.css";
import type { AnalyticsData, AnalyticsMetric } from "./analytics-model";
import { AnalyticsPanel } from "./analytics-panel";

/* A fixed LOCAL noon, so the window's own arithmetic is stable everywhere: the
   panel derives its span from this clock, and a frame that moved with the
   machine's timezone would not be reproducible. */
const NOW = new Date(2026, 8, 13, 12, 0, 0);
const noop = () => {};

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

const provider = (
	calls: number,
	tokens: number,
	cost: number,
	cacheShare = 0,
) => {
	const context = tokens - Math.round(tokens * 0.2);
	return aggregate({
		calls,
		ok_calls: calls,
		context_tokens: context,
		output_tokens: tokens - context,
		cache_read_tokens: Math.round(context * cacheShare),
		cost_micro: cost,
		cost_known_calls: calls,
	});
};

/**
 * A row whose calls reported no read context at all.
 *
 * The `Cache hit` column divides by `context_tokens`, so this is the shape that
 * produces `—` rather than `0%`: a provider that gave no context total is not a
 * provider whose cache missed, and the fixture has to carry both or the column's
 * two spellings are indistinguishable in every frame. The output tokens are real
 * for the same reason — an unknown input is not a zero-token turn.
 */
const noContextTotal = (calls: number, output: number) =>
	aggregate({
		calls,
		ok_calls: calls,
		context_tokens: 0,
		output_tokens: output,
	});

/**
 * `days` consecutive local buckets ending on the fixture's own last day.
 *
 * Arithmetic on the date STRING is how a fixture ends up printing `Sep 32` — a
 * frame of a date that does not exist reads as a defect in the panel's
 * formatter, so the buckets come off a real `Date` walk. Local, like the panel's
 * own window rule: a UTC walk would disagree with the axis near midnight.
 */
const buckets = (days: number): string[] =>
	Array.from({ length: days }, (_, index) => {
		const date = new Date(
			NOW.getFullYear(),
			NOW.getMonth(),
			NOW.getDate() - (days - 1 - index),
		);
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	});

const DAILY = [
	["2026-09-07", 210_000, 3_120_000],
	["2026-09-08", 340_500, 5_480_000],
	["2026-09-09", 0, 0],
	["2026-09-10", 512_300, 7_010_000],
	["2026-09-11", 286_900, 4_260_000],
	["2026-09-12", 448_200, 6_640_000],
	["2026-09-13", 132_400, 2_120_000],
] as const;

const daily = (rows: readonly (readonly [string, number, number])[]) =>
	rows.map(([period, contexts, contexts2]) => ({
		period,
		model: "",
		input_tokens: contexts2 - Math.round(contexts2 * 0.2),
		output_tokens: Math.round(contexts2 * 0.2),
		cache_read_tokens: Math.round(contexts2 * 0.35),
		cache_write_tokens: Math.round(contexts2 * 0.04),
		reasoning_tokens: Math.round(contexts2 * 0.02),
		context_tokens: contexts,
		cost_micro: Math.round(contexts / 1000) * 14,
		cost_known_calls: 18,
		calls: 18,
	}));

const populated: AnalyticsData = {
	aggregate: aggregate({
		calls: 128,
		ok_calls: 124,
		input_tokens: 1_120_000,
		output_tokens: 264_000,
		cache_read_tokens: 840_000,
		cache_write_tokens: 96_000,
		reasoning_tokens: 41_000,
		context_tokens: 1_930_300,
		cost_micro: 18_402_000,
		cost_known_calls: 128,
		by_provider: {
			anthropic: provider(74, 1_240_000, 12_840_000, 0.79),
			openai: provider(38, 620_000, 4_120_000, 0),
			google: provider(16, 190_000, 1_442_000, 0.63),
			local: noContextTotal(4, 12_400),
		},
		by_session: {
			a1b2c3d4e5f6: provider(52, 900_000, 8_120_000, 0.66),
			b2c3d4e5f6a1: provider(31, 480_000, 4_260_000, 0),
			c3d4e5f6a1b2: provider(21, 320_000, 3_010_000, 0.48),
			d4e5f6a1b2c3: provider(14, 210_000, 1_940_000, 0.31),
			e5f6a1b2c3d4: noContextTotal(10, 42_000),
		},
	}),
	daily: daily(DAILY),
	daily_scope: "all_sessions",
	session_names: { a1b2c3d4e5f6: "Panel views" },
	session_parents: { b2c3d4e5f6a1: "a1b2c3d4e5f6" },
};

const base = {
	windowDays: 7,
	metric: "tokens" as const,
	thisSessionOnly: false,
	now: NOW,
	onWindowChange: noop,
	onMetricChange: noop,
	onThisSessionChange: noop,
	onClose: noop,
};

const meta: Meta<typeof AnalyticsPanel> = {
	title: "panels-analytics",
	component: AnalyticsPanel,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof AnalyticsPanel>;

/** The default state: seven days, three providers, five sessions. */
export const Populated: Story = {
	args: {
		...base,
		data: populated,
		loading: false,
		refreshing: false,
		error: null,
	},
};

/**
 * Presentation-flow evidence, not backend/transport evidence. Unlike the still
 * fixtures, these callbacks change real React state, so metric/window/scope and
 * close/reopen can be reviewed with the browser tool. Remounting on reopen
 * resets the same controls the production AnalyticsView owns per open.
 */
const InteractiveAnalytics = ({ onClose }: { onClose: () => void }) => {
	const [windowDays, setWindowDays] = useState(7);
	const [metric, setMetric] = useState<AnalyticsMetric>("tokens");
	const [thisSessionOnly, setThisSessionOnly] = useState(false);
	const scoped = thisSessionOnly ? ThisSessionOnly.args?.data : populated;
	const data = {
		...(scoped ?? populated),
		daily: daily(
			buckets(windowDays).map((day) => [day, 120_000, 150_000] as const),
		),
	};
	return (
		<AnalyticsPanel
			{...base}
			data={data}
			loading={false}
			refreshing={false}
			error={null}
			windowDays={windowDays}
			metric={metric}
			thisSessionOnly={thisSessionOnly}
			onWindowChange={setWindowDays}
			onMetricChange={setMetric}
			onThisSessionChange={setThisSessionOnly}
			onClose={onClose}
		/>
	);
};

const InteractionHarness = () => {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button onClick={() => setOpen(true)}>Open analytics</Button>
			{open && <InteractiveAnalytics onClose={() => setOpen(false)} />}
		</>
	);
};

export const Interactive: Story = { render: () => <InteractionHarness /> };

/** A refetch over data that is already on screen: the body does not move. */
export const Refreshing: Story = {
	args: {
		...base,
		data: populated,
		loading: false,
		refreshing: true,
		error: null,
	},
};

/**
 * The same payload with the pointer resting on the chart's first bar.
 *
 * The story adds nothing to `Populated`, and that is the point: what it exists
 * for is the hover GROUND, and `:hover` is browser state rather than story state
 * — no story can force it, and a story that faked the class would be evidence
 * about the fake. `scripts/capture-evidence.mjs` moves a real pointer at the
 * bar's own rectangle for this id (its `{ hover }` entry), which is what makes
 * this the frame that shows what the pointer does to the mark it is on.
 */
export const PopulatedHover: Story = {
	args: {
		...base,
		data: populated,
		loading: false,
		refreshing: false,
		error: null,
	},
};

/**
 * An empty ANSWER — the one state where sections 2-4 are not rendered at all.
 *
 * A chart with no data invents an axis, so the whole body is one sentence
 * instead. This is the frame that proves the empty copy and the absence of an
 * invented axis at the same time.
 */
export const Empty: Story = {
	args: {
		...base,
		data: {
			aggregate: aggregate(),
			daily: [],
			daily_scope: "all_sessions",
		},
		loading: false,
		refreshing: false,
		error: null,
	},
};

/** First paint: the skeleton is shaped like the stat grid that replaces it. */
export const Loading: Story = {
	args: { ...base, data: null, loading: true, refreshing: false, error: null },
};

/** The read failed. The sentence is the backend's own detail, verbatim. */
export const Unavailable: Story = {
	args: {
		...base,
		data: null,
		loading: false,
		refreshing: false,
		error:
			"The backend did not answer /v1/desktop/analytics within 30s. Close and reopen this panel to try again.",
	},
};

/** Nothing priceable in scope: `—`, a sentence, and never `$0.00`. */
export const Unpriced: Story = {
	args: {
		...base,
		metric: "spend",
		data: {
			...populated,
			aggregate: aggregate({
				...populated.aggregate,
				cost_micro: 0,
				cost_known_calls: 0,
			}),
			daily: daily(DAILY).map((row) => ({
				...row,
				cost_micro: 0,
				cost_known_calls: 0,
			})),
		},
		loading: false,
		refreshing: false,
		error: null,
	},
};

/** Partly priceable: `$X+` in the stat and `N of M calls priced` in its note. */
export const PartialCost: Story = {
	args: {
		...base,
		metric: "spend",
		data: {
			...populated,
			aggregate: aggregate({
				...populated.aggregate,
				cost_known_calls: 96,
			}),
		},
		loading: false,
		refreshing: false,
		error: null,
	},
};

/** Thirty days: more buckets than the seven-day view, and the same controls. */
export const ThirtyDays: Story = {
	args: {
		...base,
		windowDays: 30,
		metric: "spend",
		data: {
			...populated,
			daily: daily(
				buckets(30).map(
					(period, index) =>
						[
							period,
							120_000 + index * 9_000,
							2_100_000 + index * 140_000,
						] as const,
				),
			),
		},
		loading: false,
		refreshing: false,
		error: null,
	},
};

/** This session only: the aggregate narrows, the daily chart says it does not. */
export const ThisSessionOnly: Story = {
	args: {
		...base,
		thisSessionOnly: true,
		data: {
			...populated,
			aggregate: aggregate({
				...populated.aggregate,
				calls: 52,
				ok_calls: 52,
				cost_micro: 8_120_000,
				cost_known_calls: 52,
				by_provider: { anthropic: provider(52, 900_000, 8_120_000, 0.72) },
				by_session: { a1b2c3d4e5f6: provider(52, 900_000, 8_120_000, 0.72) },
			}),
		},
		loading: false,
		refreshing: false,
		error: null,
	},
};

/**
 * A ledger written before the daily rollup existed: calls but no daily rows.
 *
 * Section 2 says so in words while sections 1, 3 and 4 stay up — the whole
 * point of a per-section empty state rather than a blanked panel.
 */
export const NoDailyRows: Story = {
	args: {
		...base,
		data: { ...populated, daily: [] },
		loading: false,
		refreshing: false,
		error: null,
	},
};

/**
 * An older backend: no `session_names`, no `session_parents`.
 *
 * The by-session table prints the hex ids and no indentation, silently — an id
 * is a true label, so there is nothing to apologise for.
 */
export const UnnamedSessions: Story = {
	args: {
		...base,
		data: {
			...populated,
			session_names: undefined,
			session_parents: undefined,
		},
		loading: false,
		refreshing: false,
		error: null,
	},
};

/** The largest legal payload: a body that overflows, evidencing the fold rule. */
export const Dense: Story = {
	args: {
		...base,
		windowDays: 30,
		data: {
			aggregate: aggregate({
				calls: 812,
				ok_calls: 773,
				input_tokens: 12_400_000,
				output_tokens: 2_860_000,
				cache_read_tokens: 9_120_000,
				cache_write_tokens: 640_000,
				reasoning_tokens: 380_000,
				context_tokens: 14_920_000,
				cost_micro: 128_402_000,
				cost_known_calls: 741,
				by_provider: Object.fromEntries(
					[
						"anthropic",
						"openai",
						"google",
						"mistral",
						"groq",
						"xai",
						"deepseek",
						"openrouter",
					].map((name, index) => [
						name,
						provider(
							100 - index * 9,
							(9 - index) * 420_000,
							(9 - index) * 3_140_000,
							0.05 + index * 0.08,
						),
					]),
				),
				by_session: Object.fromEntries(
					Array.from({ length: 17 }, (_, index) => [
						`${index}f3a4b5c6d7`.slice(-12).padStart(12, "0"),
						provider(
							60 - index * 3,
							(17 - index) * 210_000,
							(17 - index) * 640_000,
							0.11 + index * 0.04,
						),
					]),
				),
			}),
			daily: daily(
				buckets(30).map(
					(period, index) =>
						[
							period,
							380_000 + index * 42_000,
							6_250_000 + index * 510_000,
						] as const,
				),
			),
			daily_scope: "all_sessions",
			session_names: Object.fromEntries(
				Array.from({ length: 17 }, (_, index) => [
					`${index}f3a4b5c6d7`.slice(-12).padStart(12, "0"),
					[
						"Panel views",
						"Composer slash parity",
						"Read-range streaming",
						"Session status strip",
					][index % 4] + (index > 3 ? ` ${index}` : ""),
				]),
			),
			session_parents: Object.fromEntries(
				Array.from({ length: 8 }, (_, index) => [
					`${index + 1}f3a4b5c6d7`.slice(-12).padStart(12, "0"),
					`${index}f3a4b5c6d7`.slice(-12).padStart(12, "0"),
				]),
			),
		},
		loading: false,
		refreshing: false,
		error: null,
	},
};

/**
 * 720px: bars surrender width first, labels and values hold.
 *
 * The dialog is portal-rendered and viewport-fixed, so the width comes from the
 * capture's own viewport rather than from a wrapper — which is why this story
 * differs from `Populated` only in the density it carries.
 */
export const Narrow: Story = {
	args: {
		...base,
		data: {
			...populated,
			aggregate: aggregate({
				...populated.aggregate,
				by_session: {
					a1b2c3d4e5f6: provider(52, 900_000, 8_120_000, 0.62),
					b2c3d4e5f6a1: provider(31, 480_000, 4_260_000, 0.08),
					c3d4e5f6a1b2: provider(21, 320_000, 3_010_000, 0),
				},
			}),
			session_names: {},
		},
		loading: false,
		refreshing: false,
		error: null,
	},
};
