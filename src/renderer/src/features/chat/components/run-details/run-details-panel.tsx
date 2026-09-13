/**
 * The run panel's body: the roster, the plan and the MCP server list
 * (`docs/run-sidebar.md` § 4-§ 7).
 *
 * One panel, three sections, and a section appears only when it has content: a
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
import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { RunDetailMcp } from "./run-detail-mcp";
import type { McpServerRow, RunDetails } from "./run-detail-model";
import { hasRunDetails } from "./run-detail-model";
import { RunDetailSubagents } from "./run-detail-subagents";
import { RunDetailTodos } from "./run-detail-todos";
import { useRunDetailsClock } from "./run-details-clock";

export type RunDetailsPanelProps = HTMLAttributes<HTMLDivElement> & {
	details: RunDetails;
	mcpServers: readonly McpServerRow[];
	/** Whether a child's row can be opened (`§ 9.5`). */
	childrenOpenable: boolean;
	onOpenChild: (id: string) => void;
	/** Hoisted to the pane so a drill-in and back keeps the roster expanded. */
	rosterExpanded: boolean;
	onToggleRosterExpanded: () => void;
};

export const RunDetailsPanel = ({
	details,
	mcpServers,
	childrenOpenable,
	onOpenChild,
	rosterExpanded,
	onToggleRosterExpanded,
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
				/>
			),
		});
	}
	if (details.todos.length > 0) {
		sections.push({
			key: "todos",
			body: <RunDetailTodos details={details} />,
		});
	}
	if (mcpServers.length > 0) {
		sections.push({ key: "mcp", body: <RunDetailMcp servers={mcpServers} /> });
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
