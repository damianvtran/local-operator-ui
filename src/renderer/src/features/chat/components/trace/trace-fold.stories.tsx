/**
 * The action group's five visible states, on the component that ships them.
 *
 * §E2's fold, after the operator's 2026-09-26 report: a collapsed run has to
 * answer "what has it done, and what is it doing NOW" on its own line. These
 * stories are that line in each state a reader meets it in - live, mid-run with
 * a failure among the counts, finished, hand-opened, and restored from history
 * with no stamps to date a span from - so the design round judges the header
 * the way it renders rather than from a description of it.
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
 * the honest instant it names - "12s" is what the header read twelve seconds
 * into a call that is still running.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import "../../../../styles/index.css";
import { ToolRow } from "./tool-row";
import { TraceFold } from "./trace-fold";

/**
 * The padded sheet the transcript surfaces are read on (as `trace.stories`
 * uses): the fold's own margin is supplied by the transcript, so a story gives
 * it the column width and the neighbouring type and nothing else.
 *
 * The sentence above the fold is CONTEXT, not the subject: the fold renders one
 * line, and a frame of one line inside an empty 1280x110 sheet is refused by the
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
 * One row, in the words the ledger paints - `ToolRow`, the same component the
 * transcript mounts inside the fold, so a story cannot drift from the shipped
 * row.
 */
const Row = ({
	name = "bash",
	summary,
	durationS,
	outcome = "success",
}: {
	name?: string;
	summary: string;
	durationS: number;
	outcome?: "success" | "error" | "running";
}) => (
	<ToolRow
		toolName={name}
		summary={summary}
		outcome={outcome}
		durationS={durationS}
	/>
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

/** The section is live and its last call has not settled. */
export const Live: Story = {
	args: {
		summary: "3 shell · 1 python",
		actionCount: 4,
		failedCount: 0,
		span: { startedAtMs: 1_000, endedAtMs: 11_000, running: false },
		live: { verb: "Running", object: "pnpm vitest run" },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3", "s4"],
		children: (
			<>
				<Row summary="pnpm vitest run" durationS={2.4} />
				<Row
					summary="src/features/chat/canonical/transcript-reducer.ts"
					durationS={0.08}
				/>
				<Row name="eval" summary="aggregate.py --since main" durationS={1.1} />
				<Row summary="pnpm vitest run" durationS={0.4} outcome="running" />
			</>
		),
	},
};

/** Mid-run: the counts have moved and one call in the group failed. */
export const MidRun: Story = {
	args: {
		summary: "3 shell · 1 python",
		actionCount: 4,
		failedCount: 1,
		span: { startedAtMs: 1_000, endedAtMs: 34_000, running: false },
		live: { verb: "Running", object: "wait 3600000" },
		sectionLive: true,
		recordIds: ["s1", "s2", "s3", "s4"],
		children: (
			<>
				<Row summary="pnpm vitest run" durationS={2.4} />
				<Row summary="git push origin fix" durationS={9.1} outcome="error" />
				<Row name="eval" summary="aggregate.py --since main" durationS={1.1} />
				<Row name="wait" summary="3600000" durationS={0.2} outcome="running" />
			</>
		),
	},
};

/** The section has ended: condensed, and the header names what ran. */
export const Finished: Story = {
	args: {
		summary: "Ran 5 commands",
		actionCount: 5,
		failedCount: 1,
		span: { startedAtMs: 1_000, endedAtMs: 73_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1", "s2", "s3", "s4", "s5"],
		children: (
			<>
				<Row summary="pnpm vitest run" durationS={2.4} />
				<Row summary="git push origin fix" durationS={9.1} outcome="error" />
				<Row name="eval" summary="aggregate.py --since main" durationS={1.1} />
				<Row summary="pnpm storybook" durationS={4.2} />
				<Row summary="node scripts/capture-evidence.mjs" durationS={3.3} />
			</>
		),
	},
};

/** A group restored from history: durations, but no stamps to date a span. */
export const Restored: Story = {
	args: {
		summary: "8 shell · 2 python",
		actionCount: 10,
		failedCount: 0,
		span: null,
		live: null,
		sectionLive: false,
		recordIds: ["h1"],
		children: (
			<>
				<Row summary="pnpm install" durationS={12.5} />
				<Row
					name="eval"
					summary="backfill.py --day 2026-09-24"
					durationS={40.2}
				/>
			</>
		),
	},
};

/**
 * Opened by the reader's own press. The press is the HARNESS's (`press:` on this
 * story's sweep row), not a `play` that sets state: the question the frame
 * answers is whether the fold's own control is what opens it, so the state has
 * to arrive the way it arrives for a reader. A visitor to Storybook can click
 * the trigger themselves and see the same thing.
 */
export const Expanded: Story = {
	args: {
		summary: "Ran 5 commands",
		actionCount: 5,
		failedCount: 0,
		span: { startedAtMs: 1_000, endedAtMs: 73_000, running: false },
		live: null,
		sectionLive: false,
		recordIds: ["s1"],
		children: (
			<>
				<Row summary="pnpm vitest run" durationS={2.4} />
				<Row name="eval" summary="aggregate.py --since main" durationS={1.1} />
			</>
		),
	},
};
