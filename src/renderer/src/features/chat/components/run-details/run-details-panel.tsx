/**
 * The run-details panel body (`docs/run-details.md` § 4).
 *
 * One panel, two sections, and a section appears only when it has content: a run
 * with only to-dos shows only `To-dos`, a run with only children shows only
 * `Subagents`. No empty heading and no placeholder — an empty section is not a
 * state anything renders, so it renders as absence.
 *
 * The panel is presentational and in-flow: the popover, the width, the scroll
 * region and the focus target are the TRIGGER's, because they are all facts about
 * where this body is shown rather than about what it says.
 *
 * Its one behaviour is its clock (`useRunDetailsClock`), which is here rather
 * than higher up because this is the surface that draws a running child's
 * elapsed time and the only one that has to repaint when it moves.
 */

import { Separator } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import type { RunDetails } from "./run-detail-model";
import { RunDetailSubagents } from "./run-detail-subagents";
import { RunDetailTodos } from "./run-detail-todos";
import { useRunDetailsClock } from "./run-details-clock";

export type RunDetailsPanelProps = HTMLAttributes<HTMLDivElement> & {
	details: RunDetails;
};

export const RunDetailsPanel = ({
	details,
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
	 * paint the same pixels, which is the reflow §6.3 exists to prevent, one
	 * component over. The re-measured object is a fresh object whenever anything
	 * moved, so a memo would not save it either.
	 */
	const measured = useRunDetailsClock(details);
	/*
	 * Presence is judged on the DERIVED lists rather than on the visible slices:
	 * a section whose rows are all over the cap still has content, and its `+N
	 * more` row is the thing that says so. Both sections empty is unreachable
	 * through the trigger (`§6.3`: the trigger is not rendered, so the popover
	 * cannot open empty), so there is no empty-state copy here to get wrong.
	 */
	const sections: Array<{ key: string; body: ReactNode }> = [];
	if (details.subagents.length > 0) {
		sections.push({
			key: "subagents",
			body: <RunDetailSubagents details={measured} />,
		});
	}
	if (details.todos.length > 0) {
		sections.push({
			key: "todos",
			body: <RunDetailTodos details={details} />,
		});
	}

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			{sections.map((section, index) => (
				<Fragment key={section.key}>
					{/*
					 * One `hairline` rule between the two stacked lists, and nothing
					 * else in the panel: it is the decorative role, and the boundary
					 * between two lists carries no information a reader has to read.
					 */}
					{index > 0 && <Separator />}
					{section.body}
				</Fragment>
			))}
		</div>
	);
};
