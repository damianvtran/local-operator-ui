/**
 * The action group's states, on the component that ships them, with every
 * number in the header DERIVED from the rows underneath it.
 *
 * §E2's fold, after the operator's 2026-09-26 report: a collapsed run has to
 * answer "what has it done, and what is it doing NOW" on its own line. These
 * stories are that line in the states a reader meets it in - live, mid-run with
 * a failure among the counts, finished, a settled run whose summary is
 * kinds-only, restored from history with no stamps to date a span from, a
 * long-name in-flight fall, and one opened by the reader's own press - so the
 * design round judges the header the way it renders rather than from a
 * description of it.
 *
 * THE FIXTURES ARE DERIVED, NOT TYPED (`foldProps` below), because typed ones
 * drifted: a story once showed `Running wait 3600000` while the shipped
 * composition for that call is `Calling wait 3600000` (`wait` is not in the
 * verb table), and headers whose counts did not match their own children - the
 * frame and the PR body then quoted strings the app cannot produce (agent
 * review R2, design D2). `foldSummary` and `toolRowLabel` are the same pure
 * functions the transcript calls, so a story cannot state what the app would
 * not.
 *
 * WHAT A STILL CANNOT SAY, and where that lives instead: the auto-condense rule
 * ("finished sections condense; the live section and anything the reader opened
 * obey the reader") is a TRANSITION with two guards, and `Expanded` shows only
 * its resting state. `scripts/trace-fold-behaviour.test.mjs` drives the
 * transitions through this same component: arrival condensed, the press opens,
 * a live section never closes the reader's fold, a run with an unsettled call
 * does not condense, the settle fires once, and a fold opened after its section
 * ended stays open.
 *
 * THE STAMPS ARE FIXED, not `Date.now()`-relative: a live span computes against
 * the clock, but a frame that changes its own number on every re-capture is a
 * frame no two rounds can compare. A still is an instant, and each of these is
 * the honest instant it names - "10s" is what the header read ten seconds into
 * a run that is still going.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import "../../../../styles/index.css";
import { foldSummary } from "../../canonical/trace-fold-model";
import { ToolRow } from "./tool-row";
import { toolRowLabel } from "./tool-row-model";
import { TraceFold } from "./trace-fold";

/**
 * The padded sheet the transcript surfaces are read on (as `trace.stories`
 * uses): the fold's own margin is supplied by the transcript, so a story gives
 * it the column width and the neighbouring type and nothing else.
 *
 * The sentence above the fold is CONTEXT, not the subject: the fold renders one
 * line, and a frame of one line inside an empty 1280x130 sheet is refused by the
 * harness's own paint guard (`assertFramePaints`: 98.67% one colour, measured on
 * the `restored` state before this line existed). It is also the truer frame -
 * a condensed group is read under a message, not floating on a sheet.
 */
const Sheet = ({ children }: { children: ReactNode }) => (
	<div className="max-w-[760px] p-8">
		<p className="mb-2 text-body-sm text-ink-muted">
			Ran the suite, fixed the two failures, and pushed the branch.
		</p>
		{children}
	</div>
);

/**
 * One row's facts, as the transcript would hold them.
 *
 * `executing` is the row's own `phase === "running"`: the call is in flight and
 * its name is known, which is what the header's live clause paints. `op` is the
 * call's operation token (`toolOp`), which the row's verb composition reads for
 * the meta tools - passed through here so the story cannot show a label the
 * app would not (`AgentOps` below is the operator's own shape).
 */
type RowSpec = {
	name: string;
	object: string;
	op?: string;
	durationS: number | null;
	failed?: boolean;
	executing?: boolean;
};

/**
 * The fold's props, derived exactly as `canonical-transcript.tsx` derives them:
 * the summary from the actions' own names (`foldSummary`), the counts from the
 * rows, and the live clause from the executing row's own label composition
 * (`toolRowLabel`). Nothing here is typed twice.
 */
const foldProps = (specs: RowSpec[]) => {
	const actions = specs.map((spec) => ({
		name: spec.name,
		failed: spec.failed === true,
	}));
	const executing = specs.find((spec) => spec.executing === true);
	const label = executing
		? toolRowLabel(executing.name, executing.object, null, true, executing.op)
		: null;
	return {
		summary: foldSummary(actions),
		actionCount: specs.length,
		live: label ? { verb: label.verb, object: label.object } : null,
	};
};

/** The rows the fold's children render, from the same specs. */
const FoldRows = ({ specs }: { specs: RowSpec[] }) => (
	<>
		{specs.map((spec) => (
			<ToolRow
				key={`${spec.name}:${spec.object}`}
				toolName={spec.name}
				op={spec.op}
				summary={spec.object}
				outcome={spec.executing ? "running" : spec.failed ? "error" : "success"}
				durationS={spec.durationS}
				// A running row's clock is cleared rather than stamped: a still
				// taken at a fixed instant cannot carry a ticking number.
				startedAt={null}
			/>
		))}
	</>
);

const meta = {
	title: "chat/trace-fold",
	component: TraceFold,
	parameters: { layout: "fullscreen" },
	render: (args) => (
		<Sheet>
			<TraceFold {...args} />
		</Sheet>
	),
} satisfies Meta<typeof TraceFold>;

export default meta;
type Story = StoryObj<typeof meta>;

const LIVE_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "bash", object: "git status --short", durationS: 0.1 },
	{ name: "eval", object: "aggregate.py --since main", durationS: 1.1 },
	{
		name: "bash",
		object: "pnpm vitest run --coverage",
		durationS: null,
		executing: true,
	},
];

/** The section is live and its last call has not settled. */
export const Live: Story = {
	args: {
		...foldProps(LIVE_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 11_000, running: false },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3", "s4"],
		children: <FoldRows specs={LIVE_ROWS} />,
	},
};

/**
 * The fall D1 named: a realistic long command in flight. The name is the only
 * element that truncates and the counts survive it - the frame exists so that
 * claim is judged from a render, not from the flex arithmetic.
 */
export const LongName: Story = {
	args: {
		...(() => {
			const specs = LIVE_ROWS.map((spec, index) =>
				index === LIVE_ROWS.length - 1
					? {
							...spec,
							object:
								"node scripts/capture-evidence.mjs --only=chat-trace-fold-- --themes=localOperatorDark,localOperatorLight",
						}
					: spec,
			);
			return { ...foldProps(specs), children: <FoldRows specs={specs} /> };
		})(),
		span: { startedAtMs: 1_000, endedAtMs: 13_000, running: false },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3", "s4"],
	},
};

const MID_RUN_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "bash", object: "git push origin fix", durationS: 9.1, failed: true },
	{ name: "eval", object: "aggregate.py --since main", durationS: 1.1 },
	{ name: "wait", object: "3600000", durationS: null, executing: true },
];

/** Mid-run: the counts have moved and one call in the group failed. */
export const MidRun: Story = {
	args: {
		...foldProps(MID_RUN_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 34_000, running: false },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3", "s4"],
		children: <FoldRows specs={MID_RUN_ROWS} />,
	},
};

const FINISHED_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "bash", object: "git push origin fix", durationS: 9.1, failed: true },
	{ name: "bash", object: "pnpm storybook", durationS: 4.2 },
	{ name: "bash", object: "node scripts/capture-evidence.mjs", durationS: 3.3 },
	{ name: "bash", object: "git status --short", durationS: 0.1 },
];

/** The section has ended: condensed, and the header names what ran. */
export const Finished: Story = {
	args: {
		...foldProps(FINISHED_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 73_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3", "s4", "s5"],
		children: <FoldRows specs={FINISHED_ROWS} />,
	},
};

const KINDS_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "bash", object: "node scripts/capture-evidence.mjs", durationS: 3.3 },
	{ name: "eval", object: "aggregate.py --since main", durationS: 1.1 },
	{ name: "bash", object: "pnpm storybook", durationS: 4.2 },
];

/**
 * A settled run whose summary is kinds-only (`3 shell · 1 python`, no lead
 * verb) - the finished form of any run containing an `eval`, which design round
 * 1's D3 asked the sweep to carry. Opened by the reader's own press: the press
 * is the HARNESS's (`press:` on this story's sweep row), not a `play` that sets
 * state, because the question the frame answers is whether the fold's own
 * control is what opens it. A visitor to Storybook can click the trigger
 * themselves and see the same thing.
 */
export const Expanded: Story = {
	args: {
		...foldProps(KINDS_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 73_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3", "s4"],
		children: <FoldRows specs={KINDS_ROWS} />,
	},
};

const RESTORED_ROWS: RowSpec[] = [
	{ name: "bash", object: "pnpm install", durationS: 12.5 },
	{ name: "bash", object: "pnpm vitest run", durationS: 2.4 },
	{ name: "eval", object: "backfill.py --day 2026-09-24", durationS: 40.2 },
];

/** A group restored from history: durations, but no stamps to date a span. */
export const Restored: Story = {
	args: {
		...foldProps(RESTORED_ROWS),
		span: null,
		live: null,
		sectionLive: false,
		recordIds: ["h1"],
		children: <FoldRows specs={RESTORED_ROWS} />,
	},
};

const AGENT_OPS_ROWS: RowSpec[] = [
	{ name: "grep", object: "delegated", durationS: 0.2 },
	{
		name: "read",
		object: "src/renderer/src/features/chat/components/trace/tool-row-model.ts",
		durationS: 0.1,
	},
	{
		name: "read",
		object: "src/renderer/src/features/chat/canonical/trace-fold-model.ts",
		durationS: 0.1,
	},
	{ name: "glob", object: "src/renderer/src/features/**/*.ts", durationS: 0.1 },
	// The empty object is the DERIVED text, not a gap: `summaryFromArgs` drops
	// the operation selector once the verb says it (`toolOp`), and a listing
	// with nothing else in its arguments resolves to nothing to add.
	{ name: "agent", object: "", op: "list", durationS: 0.31 },
	{ name: "agent", object: "designer", op: "show", durationS: 0.12 },
	{ name: "agent", object: "ux-reviewer", op: "show", durationS: 0.11 },
];

/**
 * The operator's own shape, and the header it must not claim (2026-09-27).
 *
 * Four file reads and three agent-profile READS used to fold as `Explored 4
 * files, delegated 3 tasks` - the word for a hand-off spent on calls that
 * delegated nothing - while each row above it read `Delegated`. With the op
 * tier the same seven actions fold by kind under the profile calls' own noun
 * (`4 files · 3 agents`), and the rows carry the operation's verb (`Listed
 * agents`, `Viewed agent designer`). The rows behind the trigger are the same
 * composition the transcript paints (`FoldRows` renders the shipped `ToolRow`),
 * so a frame cannot claim a label the app would not produce.
 */
export const AgentOps: Story = {
	args: {
		...foldProps(AGENT_OPS_ROWS),
		span: { startedAtMs: 1_000, endedAtMs: 6_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"],
		children: <FoldRows specs={AGENT_OPS_ROWS} />,
	},
};
