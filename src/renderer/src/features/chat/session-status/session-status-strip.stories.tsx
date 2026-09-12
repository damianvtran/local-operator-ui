/**
 * The session status strip in every state it can honestly be in.
 *
 * These render the PRODUCTION `SessionStatusStrip` from real
 * `CanonicalFrontendState` shapes, so what is judged is what ships. The states
 * below are the ones that are slow, expensive or impossible to reach live: a
 * saturated window needs a long conversation on a small model, an unpriceable
 * cost needs a model with no published price, a floor cost needs a session
 * resumed from disk, and an unknown window needs a provider that reports none.
 * A story is the fastest honest way to look at all of them at once.
 *
 * What to look for, since these frames are the design review:
 *
 * - The four readings sit on ONE baseline and read as metadata, one step below
 *   the composer's own controls. If they compete with Send, the weight is
 *   wrong.
 * - The ring's ARC, not its hue, is what says how full the window is. Cover the
 *   colour and the frames should still be orderable from emptiest to fullest.
 * - Three hues appear across these frames and no more: the calm reading
 *   (`info`), one worth noticing (`warning`), and one at or past the compaction
 *   trigger (`danger`). They are the TUI's own rungs.
 * - Unknown states say what they do not know instead of showing a zero. The
 *   no-reading wheel is an empty track; the unknown-window wheel is an empty
 *   track beside an absolute token count and a `/—` denominator.
 * - `estimate` is a WORD. If it reads as a dimmed number, the marker has been
 *   lost.
 * - In the 220px frame the row wraps rather than truncating as a group: only
 *   the model name ellipsises, because it is the one item with unbounded length
 *   and the one whose full value the tooltip carries.
 *
 * The two tooltip stories photograph the real thing by FOCUSING the trigger —
 * the path a keyboard user takes — rather than by forcing an open state, which
 * is why `Tooltip` has no `defaultOpen` prop.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import type { CanonicalFrontendState } from "../../../../../../src/shared/desktop-session-contract";
import { SessionStatusStrip } from "./session-status-strip";

/**
 * A frontend snapshot with only the fields the strip reads populated.
 *
 * Cast at the boundary rather than built whole: `CanonicalFrontendState` has
 * ~30 required fields, none of which this component touches, and a story that
 * filled them in would be asserting a shape nobody looks at.
 */
const state = (over: Partial<CanonicalFrontendState>): CanonicalFrontendState =>
	({
		context_tokens: null,
		context_window: null,
		context_is_estimate: null,
		cumulative_parent_cost: null,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "unknown",
		selected_model: null,
		effective_model: null,
		...over,
	}) as CanonicalFrontendState;

/**
 * The two models the frames use, copied from
 * `scripts/fixtures/session-status-capture.json` — i.e. from what a real
 * backend actually sent, not from a plausible-looking hand-written spec.
 */
const GPT_4O_MINI = {
	provider: "openrouter",
	model_id: "openai/gpt-4o-mini",
	display_name: "OpenAI: GPT-4o-mini",
	reasoning: false,
	reasoning_effort: null,
	reasoning_efforts: [],
	reasoning_default_effort: null,
	context_window: 128_000,
	max_context_window: null,
};

const GPT_5 = {
	provider: "openrouter",
	model_id: "openai/gpt-5",
	display_name: "OpenAI: GPT-5",
	reasoning: true,
	reasoning_effort: "high",
	reasoning_efforts: ["minimal", "low", "medium", "high"],
	reasoning_default_effort: null,
	context_window: 400_000,
	max_context_window: null,
};

/**
 * The strip inside the composer's own box, at the composer's own inset.
 *
 * Photographing the strip on bare canvas would judge it against a ground it
 * never renders on: it lives inside `COMPOSER_BOX`, which is `bg-surface` with
 * a `border-control` edge and `rounded-frame`. The ring's track and the
 * readings' hover fill both resolve against THAT ground, so a frame taken
 * anywhere else is evidence about a surface the user does not see.
 */
const Frame = ({
	children,
	width = 720,
	label,
}: {
	children: React.ReactNode;
	width?: number;
	label?: string;
}) => (
	<div
		className="flex flex-col gap-2 bg-canvas p-6"
		style={{ width: width + 48 }}
	>
		{label && <p className="text-ink-dim text-meta">{label}</p>}
		<div
			className="flex flex-col gap-3 rounded-frame border border-control bg-surface p-4"
			style={{ width }}
		>
			{children}
			{/* A stand-in for the composer's own field and button row, so the
			    strip is judged at its real weight relative to what sits under it
			    rather than alone in a box. */}
			<p className="text-ink-dim text-body">Ask me for help</p>
		</div>
	</div>
);

const meta: Meta = {
	title: "Chat/Session status strip",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Every state that has something to say, stacked for one comparison. */
export const States: Story = {
	render: () => (
		<div className="flex flex-col gap-4 bg-canvas p-2">
			<Frame label="Populated: a measured reading on a reasoning model, spend known">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_5,
						context_tokens: 13_591,
						context_window: 400_000,
						context_is_estimate: false,
						cumulative_parent_cost: 0.003018,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="No reading yet: an empty track, and no number claimed">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: null,
						context_window: 128_000,
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Estimate: the app's own count, not the provider's receipt">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: 52_400,
						context_window: 128_000,
						context_is_estimate: true,
						cumulative_parent_cost: 0.0412,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Window unknown: absolute tokens, an explicit denominator, no arc">
				<SessionStatusStrip
					frontend={state({
						effective_model: { ...GPT_4O_MINI, context_window: null },
						context_tokens: 240_000,
						context_window: null,
						cumulative_parent_cost: 1.2456,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Noticing band: past 55% of the window, with headroom left">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: 84_000,
						context_window: 128_000,
						context_is_estimate: false,
						cumulative_parent_cost: 0.318,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Saturated: over the window, compaction overdue, arc clamped">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: 150_000,
						context_window: 128_000,
						context_is_estimate: false,
						cumulative_parent_cost: 2.4,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
		</div>
	),
};

/** The cost readout's four honesty states, side by side. */
export const CostStates: Story = {
	render: () => (
		<div className="flex flex-col gap-4 bg-canvas p-2">
			<Frame label="Zero spend: no segment at all, never $0.0000">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: 9_400,
						context_window: 128_000,
						cumulative_parent_cost: 0,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Floor: a resumed session, or a subagent whose spend is partly unknown">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: 12_977,
						context_window: 128_000,
						cumulative_parent_cost: 2.1,
						subagent_cost_knowledge: "exact",
						cost_knowledge: "floor",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Unpriceable: tokens were billed on a model with no published price">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: 12_977,
						context_window: 128_000,
						cumulative_parent_cost: null,
						cost_knowledge: "unknown",
						last_usage: { input_tokens: 12_977, output_tokens: 2 },
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Under a cent: four decimals, per format_cost">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: 12_977,
						context_window: 128_000,
						cumulative_parent_cost: 0.00194775,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
		</div>
	),
};

/** The effort chip's states, including the one with nothing to open. */
export const EffortStates: Story = {
	render: () => (
		<div className="flex flex-col gap-4 bg-canvas p-2">
			<Frame label="A level is set: the ordinary case, and the chip opens /effort">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_5,
						context_tokens: 13_591,
						context_window: 400_000,
						cumulative_parent_cost: 0.31,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="A ladder with nothing chosen: `auto`, the word /effort auto uses">
				<SessionStatusStrip
					frontend={state({
						effective_model: { ...GPT_5, reasoning_effort: null },
						context_tokens: 13_591,
						context_window: 400_000,
						cumulative_parent_cost: 0.31,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Reasons with no ladder: `reasoning`, and no control to open">
				<SessionStatusStrip
					frontend={state({
						effective_model: {
							...GPT_5,
							display_name: "DeepSeek Reasoner",
							model_id: "deepseek-reasoner",
							reasoning_effort: null,
							reasoning_efforts: [],
						},
						context_tokens: 13_591,
						context_window: 128_000,
						cumulative_parent_cost: 0.31,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Non-reasoning model: no effort chip at all">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_4O_MINI,
						context_tokens: 13_591,
						context_window: 128_000,
						cumulative_parent_cost: 0.31,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
		</div>
	),
};

/**
 * A model name long enough to overrun the row, at two widths.
 *
 * An aggregator id with no curated name is the real source of these: the model
 * chip falls back to `model_id`, which is a full slug.
 */
export const LongModelName: Story = {
	render: () => {
		const long = {
			...GPT_5,
			display_name: "",
			model_id: "moonshotai/kimi-k2-instruct-0905-preview-long-context",
		};
		return (
			<div className="flex flex-col gap-4 bg-canvas p-2">
				<Frame label="Full width: the name fits, nothing truncates">
					<SessionStatusStrip
						frontend={state({
							effective_model: long,
							context_tokens: 210_000,
							context_window: 400_000,
							cumulative_parent_cost: 1.84,
							cost_knowledge: "exact",
						})}
						onCommand={() => undefined}
					/>
				</Frame>
				<Frame
					width={380}
					label="Narrower: the name ellipsises, the three readings stay whole"
				>
					<SessionStatusStrip
						frontend={state({
							effective_model: long,
							context_tokens: 210_000,
							context_window: 400_000,
							cumulative_parent_cost: 1.84,
							cost_knowledge: "exact",
						})}
						onCommand={() => undefined}
					/>
				</Frame>
			</div>
		);
	},
};

/**
 * The 220px chat column — the floor the column collapses to with the canvas
 * panel open, and the width at which the composer's button row was already
 * over budget before this strip existed.
 */
export const CollapsedColumn: Story = {
	render: () => (
		<div className="flex flex-col gap-4 bg-canvas p-2">
			<Frame
				width={220}
				label="220px column: the row wraps, every reading stays legible"
			>
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_5,
						context_tokens: 210_000,
						context_window: 400_000,
						context_is_estimate: false,
						cumulative_parent_cost: 1.84,
						cost_knowledge: "floor",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame width={220} label="220px, long model name and an estimate">
				<SessionStatusStrip
					frontend={state({
						effective_model: {
							...GPT_5,
							display_name: "",
							model_id: "moonshotai/kimi-k2-instruct-0905",
						},
						context_tokens: 352_000,
						context_window: 400_000,
						context_is_estimate: true,
						cumulative_parent_cost: 4.02,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
		</div>
	),
};

/**
 * The context tooltip, opened the way a keyboard user opens it.
 *
 * Focus rather than a forced open state, for the reason `Tooltip` gives for
 * having no `defaultOpen`: photographing a forced state photographs something
 * the product does not do.
 */
export const ContextTooltip: Story = {
	render: () => {
		const Focused = () => {
			const host = useRef<HTMLDivElement>(null);
			useEffect(() => {
				// The context reading is the third control in the row.
				const buttons = host.current?.querySelectorAll("button");
				(buttons?.[2] as HTMLButtonElement | undefined)?.focus();
			}, []);
			return (
				<div ref={host}>
					<SessionStatusStrip
						frontend={state({
							effective_model: {
								...GPT_5,
								context_window: 400_000,
								max_context_window: 1_000_000,
							},
							context_tokens: 352_000,
							context_window: 400_000,
							context_is_estimate: true,
							cumulative_parent_cost: 4.02,
							cost_knowledge: "exact",
						})}
						onCommand={() => undefined}
					/>
				</div>
			);
		};
		return (
			<div className="flex min-h-[320px] flex-col justify-end bg-canvas p-2">
				<Frame label="Context tooltip: percentage, tokens, window, model maximum, estimate">
					<Focused />
				</Frame>
			</div>
		);
	},
};

/** The cost tooltip on a floor figure, where the mark needs explaining. */
export const CostTooltip: Story = {
	render: () => {
		const Focused = () => {
			const host = useRef<HTMLDivElement>(null);
			useEffect(() => {
				const buttons = host.current?.querySelectorAll("button");
				// Model, effort, context, cost: the spend is the last one.
				const last = buttons?.[(buttons?.length ?? 1) - 1];
				(last as HTMLButtonElement | undefined)?.focus();
			}, []);
			return (
				<div ref={host}>
					<SessionStatusStrip
						frontend={state({
							effective_model: GPT_5,
							context_tokens: 13_591,
							context_window: 400_000,
							cumulative_parent_cost: 2.1,
							subagent_cost_knowledge: "exact",
							cost_knowledge: "floor",
						})}
						onCommand={() => undefined}
					/>
				</div>
			);
		};
		return (
			<div className="flex min-h-[320px] flex-col justify-end bg-canvas p-2">
				<Frame label="Cost tooltip: what the floor mark means">
					<Focused />
				</Frame>
			</div>
		);
	},
};

/**
 * The ABSOLUTE band rungs, which no other story draws.
 *
 * The TUI added these precisely because the fractional ladder alone leaves a
 * big window looking calm at the size that costs the most: 300k tokens is slow
 * and expensive to re-send whether the window is 1M or 200k. On a 1M-token
 * model the fractional rungs are unreachable in practice, so these two frames
 * are the only picture of `CONTEXT_COLOR_BANDS` doing its job — and round 1
 * shipped without them (design round 1, D4).
 */
export const AbsoluteRungs: Story = {
	render: () => (
		<div className="flex flex-col gap-4 bg-canvas p-2">
			<Frame label="Under both ladders: 150k on a 1M window is calm by either rule">
				<SessionStatusStrip
					frontend={state({
						effective_model: { ...GPT_5, context_window: 1_000_000 },
						context_tokens: 150_000,
						context_window: 1_000_000,
						context_is_estimate: false,
						cumulative_parent_cost: 0.94,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Absolute 200k rung: warm at 20% of the window, which the fractional ladder alone would call calm">
				<SessionStatusStrip
					frontend={state({
						effective_model: { ...GPT_5, context_window: 1_000_000 },
						context_tokens: 210_000,
						context_window: 1_000_000,
						context_is_estimate: false,
						cumulative_parent_cost: 1.31,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Absolute 500k rung: the top rung at 51% of the window, on size alone">
				<SessionStatusStrip
					frontend={state({
						effective_model: { ...GPT_5, context_window: 1_000_000 },
						context_tokens: 510_000,
						context_window: 1_000_000,
						context_is_estimate: false,
						cumulative_parent_cost: 3.18,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
		</div>
	),
};

/**
 * States where the strip must not claim more than it knows.
 *
 * The cold-snapshot frame is the one round 1 got wrong (UX round 1, U1): after
 * a reload the owner answers with a selector and nothing else, and the strip
 * rendered that as a confident raw id with the effort chip silently absent. The
 * frame below is what it must look like instead — a catalogue-resolved name and
 * an effort reading that says it does not know yet.
 *
 * The small-reading frame is the other half of D4: a 3.4% arc used to be four
 * coloured pixels and read as an empty ring, so `MIN_DRAWN_FRACTION` floors the
 * DRAWING while the number beside it stays exact.
 */
export const HonestUnknowns: Story = {
	render: () => (
		<div className="flex flex-col gap-4 bg-canvas p-2">
			<Frame label="Cold snapshot, first-party: the listing name stands, effort unknown rather than absent">
				<SessionStatusStrip
					frontend={state({
						effective_model: {
							provider: "anthropic",
							model_id: "claude-opus-5",
							// Empty on a cold snapshot, so the chip falls back to the id
							// rather than inventing a name it cannot vouch for. The
							// `model_catalogue` this story used to pass is gone: nothing
							// on the desktop path ever publishes it (round 2, Q4/U9).
							display_name: "",
							reasoning: false,
							reasoning_effort: null,
							reasoning_efforts: [],
							reasoning_default_effort: null,
							context_window: null,
							max_context_window: null,
						},
						context_tokens: 12_405,
						context_window: 200_000,
						cumulative_parent_cost: 0.0213,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Small but real: 3.4% draws a visible sweep, and the number stays unrounded">
				<SessionStatusStrip
					frontend={state({
						effective_model: GPT_5,
						context_tokens: 13_591,
						context_window: 400_000,
						context_is_estimate: false,
						cumulative_parent_cost: 0.003018,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Aggregator route: the chip refuses the listing name, exactly as the TUI band does">
				<SessionStatusStrip
					frontend={state({
						effective_model: {
							provider: "openrouter",
							model_id: "openai/gpt-5-mini",
							// The raw LISTING name. `model_label` refuses it for a
							// reseller, because 398 of ~400 names are shared between the
							// two shipped aggregators and none can say which route is
							// answering. The band prints `gpt-5-mini`; so does this
							// (round 2, Q3/R8/U9).
							display_name: "OpenAI: GPT-5 Mini",
							reasoning: true,
							reasoning_effort: "high",
							reasoning_efforts: ["minimal", "low", "medium", "high"],
							reasoning_default_effort: null,
							context_window: 400_000,
							max_context_window: null,
						},
						context_tokens: 13_591,
						context_window: 400_000,
						cumulative_parent_cost: 0.0042,
						cost_knowledge: "exact",
					})}
					onCommand={() => undefined}
				/>
			</Frame>
			<Frame label="Fixed-effort model: the SPEC says the ladder is empty, so the chip reports without offering">
				<SessionStatusStrip
					frontend={state({
						effective_model: {
							...GPT_5,
							// A reasoning model whose spec carries NO rungs. This is the
							// only source entitled to make the control read-only: round 1
							// inferred it from an empty picker list instead, which is a
							// cold owner rather than a fixed one (round 2, U8).
							reasoning_effort: null,
							reasoning_efforts: [],
						},
						context_tokens: 40_000,
						context_window: 400_000,
						cumulative_parent_cost: 0.21,
						cost_knowledge: "exact",
					})}
					effortEntities={[]}
					onCommand={() => undefined}
				/>
			</Frame>
		</div>
	),
};

/**
 * The closing line of the context tooltip, in the two states that measured
 * nothing.
 *
 * Round 1 appended "Measured now; …" to every context tooltip, so the
 * no-reading tooltip said there was no reading and then that it was measured
 * now, and the estimate tooltip labelled its number an estimate and called it a
 * measurement one line later (round 2, D8). The estimate case is visible in
 * `ContextTooltip` above; this frame is the other one, beside a measured
 * reading for comparison.
 */
export const TooltipHonesty: Story = {
	render: () => {
		const Focused: FC<{
			frontend: CanonicalFrontendState;
		}> = ({ frontend }) => {
			const host = useRef<HTMLDivElement>(null);
			useEffect(() => {
				// The context reading is the third control in the row.
				const buttons = host.current?.querySelectorAll("button");
				(buttons?.[2] as HTMLButtonElement | undefined)?.focus();
			}, []);
			return (
				<div ref={host}>
					<SessionStatusStrip frontend={frontend} onCommand={() => undefined} />
				</div>
			);
		};
		/*
		 * ONE tooltip per frame. Two `Focused` blocks in one story cannot both
		 * show their tooltip - focus is singular, so the second steals it and the
		 * first frame photographs an empty state, which is exactly the kind of
		 * absence that looks like evidence and is not.
		 */
		return (
			<div className="flex min-h-[320px] flex-col justify-end bg-canvas p-2">
				<Frame label="No reading: the closing line does not claim a measurement that has not happened">
					<Focused
						frontend={state({
							effective_model: GPT_5,
							context_tokens: null,
							context_window: 400_000,
						})}
					/>
				</Frame>
			</div>
		);
	},
};
