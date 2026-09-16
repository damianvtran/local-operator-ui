/**
 * The run panel's body: the roster, the plan, the tool jobs and the MCP server
 * list (`docs/run-sidebar.md` § 4-§ 7).
 *
 * One panel, four sections, and a section appears only when it has content: a
 * run with only to-dos shows only `To-dos`, a session with only MCP servers
 * shows only those. No empty heading and no placeholder — an empty section is
 * not a state anything renders, so it renders as absence.
 *
 * The body is presentational and in-flow: the pane (width, chrome bar, scroll
 * region, escape ladder) is `RunPanel`'s, because all of those are facts about
 * where this body is shown rather than about what it says.
 *
 * Its one behaviour is its clock (`useRunDetailsClock`), which is here rather
 * than higher up because this is the surface that draws a running child's
 * elapsed time and the only one that has to repaint when it moves.
 */

import { Separator } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Fragment, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { RunDetailJobs } from "./run-detail-jobs";
import { RunDetailMcp } from "./run-detail-mcp";
import type { McpServerRow, RunDetails } from "./run-detail-model";
import { hasRunDetails } from "./run-detail-model";
import { RunDetailSubagents } from "./run-detail-subagents";
import { RunDetailTodos } from "./run-detail-todos";
import { useRunDetailsClock } from "./run-details-clock";
import type { McpRemedyControls } from "./use-mcp-remedy";

export type RunDetailsPanelProps = HTMLAttributes<HTMLDivElement> & {
	details: RunDetails;
	mcpServers: readonly McpServerRow[];
	/** Whether the read carries an operation that is still running (`§ 7.2`). */
	mcpGrantRunning: boolean;
	/** The pane's MCP remedy controls: see `use-mcp-remedy.ts`. */
	mcpRemedy: McpRemedyControls;
	/** Whether a child's row can be opened (`§ 10.2`). */
	childrenOpenable: boolean;
	onOpenChild: (id: string) => void;
	/** Hoisted to the pane so a drill-in and back keeps the roster expanded. */
	rosterExpanded: boolean;
	onToggleRosterExpanded: () => void;
	/**
	 * The pane's own width, in pixels.
	 *
	 * Threaded down rather than read from the preference store by whichever
	 * section needs it: the pane's width is a fact about where these sections are
	 * SHOWN (`chat-content.tsx` sets both `width` and `minWidth` from the same
	 * value), and the tally's char budget is derived from it — see
	 * `tallyBudget`. One source, one reading.
	 */
	paneWidth: number;
	/**
	 * The To-dos section's element, for the pane's consume-once reveal request.
	 *
	 * Threaded through the body rather than read here: the request is the pane's
	 * (`RunPanel` owns the effect and the store subscription), and this component
	 * stays presentational — it renders the sections and decides nothing about
	 * where the pane is looking.
	 */
	todosSectionRef?: Ref<HTMLElement>;
	/**
	 * The Subagents section's element, for the same request.
	 *
	 * Three refs rather than one because the request now names one of three
	 * destinations (`RunPanelSection`): the composer's plan chip, its subagents
	 * chip and its jobs chip each point at their own section, and the pane resolves
	 * the request through whichever ref that section owns.
	 */
	subagentsSectionRef?: Ref<HTMLElement>;
	/** The Jobs section's element, for the same request. */
	jobsSectionRef?: Ref<HTMLElement>;
};

export const RunDetailsPanel = ({
	details,
	mcpServers,
	mcpGrantRunning,
	mcpRemedy,
	childrenOpenable,
	onOpenChild,
	rosterExpanded,
	onToggleRosterExpanded,
	paneWidth,
	todosSectionRef,
	subagentsSectionRef,
	jobsSectionRef,
	className,
	...props
}: RunDetailsPanelProps) => {
	/*
	 * The clock is taken HERE, at the body, and the re-measured model is handed to
	 * the SUBAGENT rows only. Nothing above this component ticks (see
	 * `useRunDetailsClock`): the roster is the only surface that draws a value
	 * which moves, so it is the only one that has to be repainted when one does.
	 *
	 * The to-dos section deliberately takes the UNTIMED model. There is no
	 * time-dependent field anywhere in the plan — an item is pending, done,
	 * dropped or blocked, and every count is derived from those — so handing it
	 * the re-measured object would re-render the whole plan once a second to
	 * paint the same pixels, which is the reflow `§6.3` exists to prevent, one
	 * component over. The re-measured object is a fresh object whenever anything
	 * moved, so a memo would not save it either.
	 */
	const measured = useRunDetailsClock(details);
	/*
	 * Presence is judged on the DERIVED lists rather than on the visible slices:
	 * a section whose rows are all over the cap still has content, and its
	 * disclosure is the thing that says so.
	 */
	const sections: Array<{ key: string; body: ReactNode }> = [];
	if (details.subagents.length > 0) {
		sections.push({
			key: "subagents",
			body: (
				<RunDetailSubagents
					details={measured}
					expanded={rosterExpanded}
					onToggleExpanded={onToggleRosterExpanded}
					onOpenChild={onOpenChild}
					interactive={childrenOpenable}
					paneWidth={paneWidth}
					sectionRef={subagentsSectionRef}
				/>
			),
		});
	}
	/*
	 * The PHASE count here and the ITEM count at the composer's plan chip are two
	 * spellings of one rule, and they are deliberately different.
	 *
	 * The pane is about phases: it renders their headers, their items and their
	 * `+N more`, so it appears whenever there is a phase to render - including a
	 * named phase with no items, which is a real state the backend publishes (the
	 * checkpoint arrives with `todos: [{ name: "Foundation", items: [] }]`).
	 * The chip is about work: `totalTodos` is the item count, so a plan that
	 * arrived as an empty phase prints nothing at all rather than stating a finished
	 * plan over it (`All to-dos resolved` under the settled clause; `0 to-dos open`
	 * when this note was written, which read as a finished plan too).
	 *
	 * `totalTodos > 0` implies `todos.length > 0`, so the two cannot disagree in a
	 * reachable state; the note is here because this PR is what made the
	 * distinction load-bearing, and "unifying" the two spellings would put the
	 * chip back to claiming a plan it cannot count (agent review, round 1, N2).
	 */
	if (details.todos.length > 0) {
		sections.push({
			key: "todos",
			body: (
				<RunDetailTodos
					details={details}
					paneWidth={paneWidth}
					sectionRef={todosSectionRef}
				/>
			),
		});
	}
	/*
	 * The Jobs section, and its gate is the same rule the composer's jobs chip is
	 * gated on: rows that have not settled. It takes the MEASURED model rather than
	 * the untimed one, unlike the plan above — the elapsed clock is the one figure
	 * this section draws that moves, so it is the one section beside the roster that
	 * has to be repainted when it does.
	 *
	 * `openJobs > 0` is a presence test on the DERIVED list, like the two above it,
	 * and it is what makes `hasRunDetails`'s new clause and this section the same
	 * fact: the quiet line says "Nothing in flight" only when there is no section to
	 * contradict it.
	 */
	if (details.openJobs > 0) {
		sections.push({
			key: "jobs",
			body: (
				<RunDetailJobs
					details={measured}
					paneWidth={paneWidth}
					sectionRef={jobsSectionRef}
				/>
			),
		});
	}
	if (mcpServers.length > 0) {
		sections.push({
			key: "mcp",
			body: (
				<RunDetailMcp
					servers={mcpServers}
					grantRunning={mcpGrantRunning}
					remedy={mcpRemedy}
				/>
			),
		});
	}

	if (sections.length === 0) {
		/*
		 * The QUIET STATE, and it is a state this surface did not have before.
		 *
		 * The old popover could not open empty: its trigger was gated on
		 * `hasRunDetails`, so a session with nothing outstanding had no button and
		 * therefore no empty panel to design. The pane's button is always there
		 * (`§ 3.3`), so a canonical session with no children, no plan and no MCP
		 * servers opens onto an empty pane — and the honest treatment of that is
		 * one line saying so rather than a skeleton or a placeholder row.
		 *
		 * `hasRunDetails` decides which sentence, and this is the job it kept when
		 * it lost its visibility gate: "nothing in flight" is a different fact from
		 * "no run", and the settled case is the one a reader arrives in after work
		 * they just watched finish. The second branch is DEFENSIVE: every clause of
		 * `hasRunDetails` implies rows to render, so it is unreachable through the
		 * panel today. It is written rather than asserted away because the copy
		 * must never claim "nothing in flight" while something is outstanding, and
		 * a silent fallthrough is exactly how it would.
		 */
		return (
			<div className={cn("flex flex-col", className)} {...props}>
				<p className={cn("px-3 py-3 text-body-sm text-ink-muted")}>
					{hasRunDetails(details)
						? "Nothing to show yet."
						: "Nothing in flight."}
				</p>
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			{sections.map((section, index) => (
				<Fragment key={section.key}>
					{/*
					 * One `hairline` rule between two stacked lists, and nothing else
					 * in the panel: it is the decorative role, and the boundary between
					 * two lists carries no information a reader has to read.
					 */}
					{index > 0 && <Separator />}
					{section.body}
				</Fragment>
			))}
		</div>
	);
};
