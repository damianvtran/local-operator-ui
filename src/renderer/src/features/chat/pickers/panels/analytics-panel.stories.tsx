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
 * - The By-session table is PAGED: a strip of controls above it, twenty rows at
 *   a time, and a pager under its legend. The header's chevrons say which
 *   column the rows are ordered by, and the `session-*` stories below drive
 *   each control the way a reader would — the parts of that contract a frame
 *   cannot carry (`aria-sort`, the row count, the live region, focus) are
 *   asserted in those stories' `play` functions.
 */

import { Button } from "@shared/components/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
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
 * The same panel with a NEAR-ZERO day under the pointer.
 *
 * Review round 1 (D7) left this case unverified: every hover frame pointed at
 * Sep 7, the shortest NON-zero bar, which at 834k of the peak's 1.9M is a tall
 * bar by any measure. What that cannot answer is whether a fill step is findable
 * on a bar of a few pixels, where the step has almost no area to read — and
 * `obsidian` and `monokai` are the two palettes where the answer is not obvious.
 *
 * So the first day here carries 60k against the same 1.9M peak, about 3 percent
 * — a bar a few pixels tall — and the FIRST bar is what the rig's hover selector
 * lands on, so the same entry that produces `populated-hover` produces this one.
 * The ZERO day (Sep 9) is deliberately not the target: a zero bucket renders no
 * rectangle at all, so the rig's own "a selector that matched nothing THROWS"
 * rule would reject the frame rather than photograph an unreadable one.
 */
export const PopulatedHoverShallow: Story = {
	args: {
		...base,
		data: {
			...populated,
			daily: daily([["2026-09-07", 20_000, 200_000], ...DAILY.slice(1)]),
		},
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

/**
 * This session only: the aggregate narrows, the daily chart says it does not.
 *
 * The scoped aggregate is the ONE provider's own, spread rather than restated
 * (review round 1, D5): the previous fixture narrowed `calls`, `ok_calls` and
 * the cost and left the TOKEN fields at their all-sessions values, so the
 * `Tokens` and `Cache hit rate` tiles showed the wide scope's numbers beside a
 * scoped `Requests` and `Cost` — and beside a table reading the narrow ones,
 * which is how the designer found it. The panel is not at fault: all four tiles
 * read `data.aggregate`, and all four move together once the fixture narrows it.
 */
export const ThisSessionOnly: Story = {
	args: {
		...base,
		thisSessionOnly: true,
		data: {
			...populated,
			aggregate: aggregate({
				...provider(52, 900_000, 8_120_000, 0.72),
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

/* ---------------------------------------------------------------------------
 * The by-session table: paging, sorting, search and the one filter.
 *
 * A seven-day window on this machine is 4,550 sessions and a thirty-day one is
 * 7,065 (§2.1), so the ledger below is GENERATED rather than carried as a
 * literal. `scaleFixture` is deterministic — no clock, no randomness — because
 * two captures of one frame have to be the same frame, and it keeps the shapes
 * that make the decisions visible: ties on the numeric columns (the tie-break),
 * rows with no published price and rows with no context total (unknown sorts
 * last), a tail of unnamed sessions, a root/subagent split, and a handful of
 * depth-2 rows for the indentation.
 *
 * Every story drives the SHIPPED control through `play` — a real click on a
 * real header button, real typing into the real field, a real checkbox — so the
 * frame is of the affordance rather than of a state the story forced. The same
 * play carries the claims a frame cannot: `aria-sort` on the header cell, the
 * `tbody tr` count, the live region's text, and where focus is afterwards.
 * `docs/evidence/panels-analytics/README.md` says which claims live here and
 * which are the node suite's (`scripts/analytics-session-table.test.mjs`).
 * ------------------------------------------------------------------------- */

const NAMES = [
	"Panel views",
	"Composer slash parity",
	"Read-range streaming",
	"Session status strip",
	"Session status feed",
	"Analytics window rule",
	"Cache hit column",
	"Browser pane dock",
	"Trace legibility",
	"Move session chip",
];

/** The measured root count of a seven-day window (§2.4): 404 of 4,550 rows. */
const SCALE_ROOTS = 404;

/**
 * A cheap deterministic scramble.
 *
 * Ids have to LOOK like the ledger's own random hex — sequential ones would
 * make "sort by session id" a picture of the fixture's index rather than of an
 * order — and they have to be reproducible, which rules out `Math.random`.
 */
const scramble = (value: number): number => {
	let x = (value + 0x9e3779b9) >>> 0;
	x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
	return (x ^ (x >>> 16)) >>> 0;
};

const scaleId = (index: number): string =>
	`${scramble(index).toString(16).padStart(8, "0")}${scramble(index + 70_065)
		.toString(16)
		.padStart(4, "0")}`;

type ScaleFixture = AnalyticsData & {
	session_names: Record<string, string>;
	session_parents: Record<string, string>;
};

/**
 * `sessions` sessions, with `roots` of them top-level.
 *
 * The provider split is derived from the same totals the by-session rows add up
 * to, so the stat cards, the provider table's bars and the session table's
 * bars describe one ledger — a fixture whose halves disagreed would photograph
 * a defect that is not in the code.
 */
function scaleFixture(sessions: number, roots = SCALE_ROOTS): ScaleFixture {
	const ids = Array.from({ length: sessions }, (_, index) => scaleId(index));
	const bySession: Record<string, DesktopUsageAggregate> = {};
	const names: Record<string, string> = {};
	const parents: Record<string, string> = {};
	const totals = {
		calls: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		context: 0,
		costMicro: 0,
		costKnownCalls: 0,
	};
	for (const [index, id] of ids.entries()) {
		/*
		 * 1..7 calls, so equal values are common and the id tie-break is
		 * exercised by every sort rather than by a contrived pair.
		 *
		 * The per-call size comes off a DIFFERENT multiplier than the call count
		 * (5 and 3 against moduli of 7 and 13, so the pair cycles with period
		 * 91), because a single multiplier would make `tokens = calls * perCall`
		 * monotonic in `calls` — and the top page of a token ranking would then
		 * be twenty rows reading "7 calls", which is a picture of the fixture's
		 * arithmetic rather than of a ledger.
		 */
		const calls = 1 + ((index * 5) % 7);
		const perCall = 1_000 + ((index * 3) % 13) * 2_600;
		/* One row in 41 reported no context total: the `—` spelling of the
		   Cache hit rate column, and the cache half of "unknown sorts last". */
		const contextTokens = index % 41 === 3 ? 0 : perCall * calls;
		const outputTokens = 620 + (index % 5) * 90;
		const cacheReadTokens = Math.round(
			contextTokens * (0.25 + (index % 23) / 40),
		);
		const cacheWriteTokens = Math.round(contextTokens * 0.03);
		const reasoningTokens = Math.round(outputTokens * 0.12);
		/* One row in 37 has no published price: the Cost column's `—`. */
		const unpriced = index % 37 === 5;
		/*
		 * The cost is DERIVED FROM THE TOKENS at a per-row unit price, which is
		 * both what a ledger does and the only shape whose top page is legible.
		 * A product of the call count and a per-call price ties at the top —
		 * every row on the first page of a Cost sort has the same call count and
		 * the same maximum unit, so the frame reads `$2.37` twenty times and the
		 * sort cannot be judged from it. The unit price varies fourfold (a cheap
		 * model through an expensive one), so the order is related to the token
		 * order without being it.
		 */
		const microPerKiloToken = 1_200 + (scramble(index + 5) % 2_800);
		const costMicro = unpriced
			? 0
			: Math.round(
					((contextTokens + outputTokens) / 1_000) * microPerKiloToken,
				);
		const costKnownCalls = unpriced ? 0 : calls;
		bySession[id] = {
			calls,
			ok_calls: calls,
			input_tokens: contextTokens - cacheReadTokens,
			output_tokens: outputTokens,
			cache_read_tokens: cacheReadTokens,
			cache_write_tokens: cacheWriteTokens,
			reasoning_tokens: reasoningTokens,
			context_tokens: contextTokens,
			cost_micro: costMicro,
			cost_known_calls: costKnownCalls,
			components: {},
			by_provider: {},
			/* A `by_session` entry is a ONE-LEVEL row: the store builds it from
			   the per-session aggregate, so its own breakdowns are empty — which
			   is also why the design can say there is no per-row provider on the
			   wire. */
			by_session: {},
		};
		/* Every 50th session is unnamed, which is what an older backend renders
		   for ALL of them (`UnnamedSessions`) and what the search's id half
		   exists for. */
		if (index % 50 !== 13)
			names[id] =
				`${NAMES[index % NAMES.length]}${index % 5 === 0 ? ` ${index}` : ""}`;
		if (index >= roots) {
			/*
			 * Most subagents hang off a root; a few hang off another subagent,
			 * which is the only way a depth-2 row (and therefore the
			 * indentation) exists on a generated ledger. The parent is always a
			 * row that already has one of its own, so the walk terminates.
			 */
			const offset = (index - roots) % roots;
			parents[id] = ids[index % 97 === 41 ? roots + offset : offset];
		}
		totals.calls += calls;
		totals.input += contextTokens - cacheReadTokens;
		totals.output += outputTokens;
		totals.cacheRead += cacheReadTokens;
		totals.cacheWrite += cacheWriteTokens;
		totals.reasoning += reasoningTokens;
		totals.context += contextTokens;
		totals.costMicro += costMicro;
		totals.costKnownCalls += costKnownCalls;
	}
	const metricTokens = totals.input + totals.output;
	return {
		aggregate: aggregate({
			calls: totals.calls,
			ok_calls: totals.calls,
			input_tokens: totals.input,
			output_tokens: totals.output,
			cache_read_tokens: totals.cacheRead,
			cache_write_tokens: totals.cacheWrite,
			reasoning_tokens: totals.reasoning,
			context_tokens: totals.context,
			cost_micro: totals.costMicro,
			cost_known_calls: totals.costKnownCalls,
			by_provider: {
				anthropic: provider(
					Math.round(totals.calls * 0.62),
					Math.round(metricTokens * 0.62),
					Math.round(totals.costMicro * 0.68),
					0.71,
				),
				openai: provider(
					Math.round(totals.calls * 0.21),
					Math.round(metricTokens * 0.21),
					Math.round(totals.costMicro * 0.2),
					0,
				),
				google: provider(
					Math.round(totals.calls * 0.12),
					Math.round(metricTokens * 0.12),
					Math.round(totals.costMicro * 0.12),
					0.58,
				),
				local: noContextTotal(Math.round(totals.calls * 0.05), 12_400),
			},
			by_session: bySession,
		}),
		daily: daily(DAILY),
		daily_scope: "all_sessions",
		session_names: names,
		session_parents: parents,
	};
}

/** The operator's own seven-day window: 4,550 sessions, 404 of them roots. */
const SEVEN_DAY = scaleFixture(4_550);
/** The thirty-day window: 7,065 sessions, 228 pages becomes 354. */
const THIRTY_DAY = scaleFixture(7_065, Math.round(7_065 * 0.0888));

/**
 * How many sessions the `status` search should match.
 *
 * Counted from the fixture the same way the model counts (a case-folded
 * substring of the label, which is the only place "status" appears — the ids
 * are hex) so the story's assertion is exact without restating the rule's
 * implementation: `scripts/analytics-session-table.test.mjs` owns the rule, and
 * a drift between the two fails here loudly rather than quietly.
 */
const statusMatches = Object.values(SEVEN_DAY.session_names).filter((name) =>
	name.toLocaleLowerCase().includes("status"),
).length;

/*
 * Everything below reads the PANEL, not the document. `data-panel-body` is the
 * host's own name for the section's scroll region, and scoping matters here
 * because Storybook's own chrome renders a footer and a toolbar outside the
 * story: a `querySelector("output")` over the whole page is a query that will
 * one day find somebody else's.
 *
 * THE BODY HOLDS TWO TABLES, which is why every helper below reaches through
 * the by-session table's own accessible name rather than stopping at the
 * region. `[data-panel-body]` scopes to the section, not to the table under
 * discussion: the By-provider table renders ABOVE the By-session one, so an
 * unscoped `tbody tr` count was 24 (20 + 4), a `th` text search found the
 * provider table's headers first, and seven of these nine plays asserted
 * against the wrong table while the frames photographed cleanly over them
 * (QA round 1, Q-1). The region is still the right outer scope — it is what
 * keeps Storybook's own furniture out — and the table is the right inner one.
 *
 * The prefix match is on the table's `aria-label`, which the section builds
 * from `CACHE_HIT_MEANING`; a copy of the whole string here would be a second
 * place it is spelled, and it would fail as "found nothing" rather than as
 * "found the wrong thing" the day the sentence moved.
 */
const panel = () => document.querySelector("[data-panel-body]");
const sessionTable = () =>
	panel()?.querySelector('table[aria-label^="Usage by session"]');
const rowsInTable = () =>
	Array.from(sessionTable()?.querySelectorAll("tbody tr") ?? []);
const rowCount = () => rowsInTable().length;
const liveText = () => panel()?.querySelector("output")?.textContent ?? "";
const headerCell = (name: string) =>
	Array.from(sessionTable()?.querySelectorAll("th") ?? []).find((cell) =>
		cell.textContent?.startsWith(name),
	);

const scaled = (data: AnalyticsData) => ({
	...base,
	data,
	loading: false,
	refreshing: false,
	error: null,
});

/**
 * Wait until `element` will actually take the pointer, then hand it back.
 *
 * The panel is a Radix DIALOG, and a modal dialog disables pointer events on
 * `document.body` while it re-enables them on its own content — a frame or two
 * after mount, and a `play` starts inside that window. A pointer interaction
 * launched in it throws `Unable to perform pointer interaction as the element
 * has pointer-events: none`, which is a statement about WHEN the interaction
 * happened rather than about what it was: the same click is fine 200ms later,
 * and a reader cannot reach a control before it accepts the pointer either.
 *
 * Measured, rather than assumed: on this head the panel's subtree computes
 * `pointer-events: none` at ~380ms after navigation and `auto` from ~590ms, so
 * the wait is short and its absence is a coin toss that had already been
 * landing wrong — it is what made the sort plays throw on some machines and
 * pass on others (review round 1, U2).
 *
 * It waits on the ELEMENT the play is about to use rather than on the dialog,
 * so a control in a nested layer (a popover, a tooltip) gets the same
 * treatment; and it asserts rather than sleeps, so it returns the instant the
 * surface is interactive instead of costing every story a fixed delay.
 */
const whenInteractive = async <T extends Element>(element: T): Promise<T> => {
	await waitFor(() => {
		expect(getComputedStyle(element).pointerEvents).not.toBe("none");
	});
	return element;
};

/**
 * Page one of the seven-day window: the strip, twenty rows, the legend, the
 * pager.
 *
 * The frame is the claim, with one exception the frame cannot make: that the
 * table is bounded at twenty rows, which is asserted here so the picture and
 * the assertion cannot disagree.
 */
export const SessionPaginated: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		await expect(screen.getByText("1–20 of 4,550 sessions")).toBeTruthy();
		await expect(rowCount()).toBe(20);
		await expect(screen.getByText("1 / 228")).toBeTruthy();
	},
};

/** The second page, reached by pressing the shipped `Next` control. */
export const SessionPageTwo: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		const next = screen.getByRole("button", { name: "Next" });
		await whenInteractive(next);
		await userEvent.click(next);
		await expect(screen.getByText("21–40 of 4,550 sessions")).toBeTruthy();
		await expect(screen.getByText("2 / 228")).toBeTruthy();
		await expect(rowCount()).toBe(20);
		await expect(liveText()).toBe("Page 2 of 228.");
		/*
		 * Focus does NOT move on a page turn. This is the assertion the
		 * always-rendered four controls exist for: a `Next` that unmounted at
		 * the end would drop focus to `<body>`, and the reader would lose their
		 * place in the panel with nothing on screen to say why.
		 *
		 * The END of the set — where the pressed control is also the one the
		 * turn has to make unavailable — is `SessionLastPage` below, because
		 * that is the case this rule was written for and page one to two cannot
		 * fail: `Next` stays enabled there. The `blur` is the FRAME's, not the
		 * assertion's: the ring this play leaves on the control is the capture
		 * inheriting a focused control, and design round 1 (D2) showed the
		 * committed frame reading as an accent pill because of it.
		 */
		await expect(document.activeElement?.textContent).toBe("Next");
		(document.activeElement as HTMLElement | null)?.blur();
	},
};

/**
 * The END of the set: the case the four-button rule exists for.
 *
 * The reader presses `Last` and lands on a page whose `Next` and `Last` are
 * unavailable, which is exactly the state that used to take the caret with it:
 * a native `disabled` blurs the control it is set on, and the browser drops
 * focus to `<body>` rather than handing it to a sibling. `First` is pressed
 * back off the end for the same reason from the other side.
 *
 * The assertion is on `document.activeElement` because that is the only
 * surface the failure is visible on — the ring vanishes and the next Tab lands
 * somewhere else — and the state is reached by pressing the shipped controls
 * rather than by setting a page prop, so what is under test is the control the
 * reader has.
 */
export const SessionLastPage: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		/*
		 * The START end first, where `First` is already unavailable: an inert
		 * control must still take focus and must still do nothing, which is the
		 * property `aria-disabled` exists for. The page must not move.
		 */
		const first = await whenInteractive(
			screen.getByRole("button", { name: "First" }),
		);
		await userEvent.click(first);
		await expect(screen.getByText("1 / 228")).toBeTruthy();
		await expect(document.activeElement?.textContent).toBe("First");

		/*
		 * Then the END, and the story is left there: this is the state the
		 * pager's treatment exists for, so it is the state the frame has to
		 * hold.
		 */
		const last = await whenInteractive(
			screen.getByRole("button", { name: "Last" }),
		);
		await userEvent.click(last);
		await expect(screen.getByText("228 / 228")).toBeTruthy();
		// 4,550 = 227 full pages + a ten-row last page.
		await expect(
			screen.getByText("4,541–4,550 of 4,550 sessions"),
		).toBeTruthy();
		await expect(rowCount()).toBe(10);
		await expect(liveText()).toBe("Page 228 of 228.");
		/*
		 * The two leading controls are live and the two trailing ones are not,
		 * stated to assistive tech rather than only in colour — and the pressed
		 * `Last` is one of the two that just went unavailable, which is exactly
		 * the press a native `disabled` would have blurred.
		 */
		await expect(
			screen
				.getByRole("button", { name: "First" })
				.getAttribute("aria-disabled"),
		).toBe(null);
		await expect(
			screen
				.getByRole("button", { name: "Next" })
				.getAttribute("aria-disabled"),
		).toBe("true");
		await expect(
			screen
				.getByRole("button", { name: "Last" })
				.getAttribute("aria-disabled"),
		).toBe("true");
		await expect(document.activeElement?.textContent).toBe("Last");
		/*
		 * And pressing an unavailable `Next` is inert rather than silent: the
		 * page does not move, and the caret lands on the control that was
		 * pressed — an inert control is still a control, so it takes focus, and
		 * what must NOT happen is the caret falling to `<body>`.
		 */
		const next = screen.getByRole("button", { name: "Next" });
		await userEvent.click(next);
		await expect(screen.getByText("228 / 228")).toBeTruthy();
		await expect(document.activeElement?.tagName).toBe("BUTTON");
		await expect(document.activeElement?.textContent).toBe("Next");
		/*
		 * And the press is dropped for the frame's sake, after the assertion:
		 * this story's frame is the END of the set, and its claim is the inert
		 * treatment of `Next`/`Last` against the live `First`/`Prev`. A focus
		 * ring on `Next` would put the accent on the control that is supposed to
		 * be receding (design round 1, D1 and D2).
		 */
		next.blur();
	},
};

/** Cost, descending: the first activation's own direction. */
export const SessionSortedByCost: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		const cost = await whenInteractive(
			screen.getByRole("button", { name: "Cost" }),
		);
		await userEvent.click(cost);
		await expect(headerCell("Cost")?.getAttribute("aria-sort")).toBe(
			"descending",
		);
		await expect(headerCell("Tokens")?.getAttribute("aria-sort")).toBe("none");
		await expect(liveText()).toBe("Sorted by Cost, highest first.");
		/* Focus stays on the control that was pressed, so a second activation
		   is one key away rather than a re-navigation. */
		await expect(document.activeElement).toBe(cost);
		/*
		 * And then it is DROPPED, which is the frame's requirement rather than
		 * the assertion's: the capture ran on from the focused state, so the
		 * committed still showed a 2px accent ring around the pressed header and
		 * the resting sorted state — the ink step and the single chevron the
		 * design's non-colour argument rests on — was in no picture at all
		 * (design round 1, D2). The assertion above has already run.
		 */
		cost.blur();
	},
};

/** The label column, ascending — the one `localeCompare` order in the table. */
export const SessionSortedBySession: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		await userEvent.click(
			await whenInteractive(screen.getByRole("button", { name: "Session" })),
		);
		await expect(headerCell("Session")?.getAttribute("aria-sort")).toBe(
			"ascending",
		);
		await expect(liveText()).toBe("Sorted by Session, A to Z.");
		/*
		 * The rendered order really is the comparator's: the first two labels
		 * are in ascending collation order. Read off the DOM rather than
		 * restated from the fixture, so a comparator that returned a constant
		 * fails here.
		 */
		const labels = rowsInTable()
			.slice(0, 2)
			.map((row) => row.querySelector("td span")?.textContent ?? "");
		await expect((labels[0] ?? "").localeCompare(labels[1] ?? "") <= 0).toBe(
			true,
		);
		/*
		 * Focus is dropped for the FRAME's sake, after every assertion has run:
		 * a captured `:focus-visible` ring on the active header read as an accent
		 * PILL around the column name rather than as the header row, so the
		 * resting sorted state — the ink step and the single chevron the design's
		 * non-colour argument rests on — was in no picture at all (design round 1,
		 * D2). The `Cost` story above does the same for the same reason.
		 */
		(document.activeElement as HTMLElement | null)?.blur();
	},
};

/** A search that matches: the visible match line and the live announcement. */
export const SessionSearchMatch: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		await userEvent.type(
			await whenInteractive(
				screen.getByRole("textbox", { name: "Search sessions" }),
			),
			"status",
		);
		await expect(
			screen.getByText(`${statusMatches} of 4,550 sessions match "status"`),
		).toBeTruthy();
		await expect(rowCount()).toBe(20);
		await expect(liveText()).toBe(`${statusMatches} sessions match "status".`);
	},
};

/** A search that matches nothing: the honest empty state and its detail. */
export const SessionSearchEmpty: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		await userEvent.type(
			await whenInteractive(
				screen.getByRole("textbox", { name: "Search sessions" }),
			),
			"zzz",
		);
		await expect(
			screen.getByText('No sessions match "zzz".', { selector: "p" }),
		).toBeTruthy();
		await expect(
			screen.getByText(
				"4,550 sessions in this window. Clear the search to see them.",
			),
		).toBeTruthy();
		/* No table, no legend and no pager: nothing to explain, and a pager
		   over an empty set is four disabled controls. */
		await expect(rowsInTable().length).toBe(0);
		await expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
		await expect(liveText()).toBe('No sessions match "zzz".');
	},
};

/** The one filter: the roots, which is 8.9% of the rows and 17.2% of the tokens. */
export const SessionTopLevelOnly: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		await userEvent.click(
			await whenInteractive(
				screen.getByRole("checkbox", { name: "Top-level only" }),
			),
		);
		await expect(
			screen.getByText("404 of 4,550 sessions · top-level only"),
		).toBeTruthy();
		await expect(screen.getByText("1–20 of 404 sessions")).toBeTruthy();
		await expect(screen.getByText("1 / 21")).toBeTruthy();
		await expect(liveText()).toBe("Top-level only: 404 sessions.");
	},
};

/** The real scale of a thirty-day window: 7,065 rows, 354 pages. */
export const SessionScale30d: Story = {
	args: scaled({
		...THIRTY_DAY,
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
	}),
	play: async () => {
		await expect(screen.getByText("1–20 of 7,065 sessions")).toBeTruthy();
		await expect(screen.getByText("1 / 354")).toBeTruthy();
		await expect(rowCount()).toBe(20);
	},
};

/**
 * The same page at 720px, where the strip has to wrap.
 *
 * The story adds nothing to `SessionPaginated` — the width is the capture
 * viewport's, because the panel is a portal-rendered dialog and no wrapper can
 * set its width. What this play is here for is the half a narrow frame cannot
 * show: every control is still reachable at that width.
 */
export const SessionNarrow720: Story = {
	args: scaled(SEVEN_DAY),
	play: async () => {
		await expect(
			screen.getByRole("textbox", { name: "Search sessions" }),
		).toBeTruthy();
		await expect(
			screen.getByRole("checkbox", { name: "Top-level only" }),
		).toBeTruthy();
		await expect(screen.getByRole("button", { name: "Last" })).toBeTruthy();
		await expect(rowCount()).toBe(20);
	},
};
