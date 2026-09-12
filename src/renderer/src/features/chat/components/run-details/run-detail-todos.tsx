/**
 * The To-dos section of the run-details panel (`docs/run-details.md` § 4.2).
 *
 * The plan, in the model's own order, because a plan should read in the order it
 * was written. The encoding is the TUI's, unchanged: **luminance says open or
 * settled, a word says which settled state, and no item is coloured**
 * (`todo_panel.py:1754-1778`). The dock band spends colour on failure and on
 * nothing else, and a to-do waiting on an answer has not failed.
 *
 * The marks are lucide rather than ASCII: `- [ ]` is a terminal drawing a
 * picture with the characters it has, and what ports is the meaning — a box, a
 * checked box, a slashed box, a dashed box.
 */

import { cn } from "@shared/lib/utils";
import {
	type LucideIcon,
	Square,
	SquareCheck,
	SquareDashed,
	SquareSlash,
} from "lucide-react";
import {
	type RunDetails,
	type TodoItemStatus,
	type TodoItemView,
	todoTally,
	visibleTodoPhases,
} from "./run-detail-model";

/**
 * Characters the trailing tally may occupy.
 *
 * Same constant and same reasoning as the Subagents section's: the panel's width
 * is fixed (`§5`), so the budget is a fact about this component and the shed rule
 * is the model's.
 */
const TALLY_BUDGET = 46;

const TODO_MARK: Record<TodoItemStatus, LucideIcon> = {
	pending: Square,
	done: SquareCheck,
	dropped: SquareSlash,
	blocked: SquareDashed,
};

/**
 * Item ink. Pending is `ink-muted` because open work is an instruction; done and
 * dropped are `ink-dim` because settled work is a record; blocked is full `ink`
 * because it is the only row asking for something and it is the loudest row in
 * the section.
 */
const TODO_INK: Record<TodoItemStatus, string> = {
	pending: "text-ink-muted",
	done: "text-ink-dim",
	dropped: "text-ink-dim",
	blocked: "text-ink",
};

/** The trailing tag for a settled row: one fixed word, so it stays inline. */
const settledTag = (item: TodoItemView): string | null =>
	item.status === "dropped" ? "— dropped" : null;

/**
 * The blocked row's own line: the word that says which open state this is, and
 * why it is open. `null` on every other state.
 *
 * The reason is the only variable-length string in the plan, and that is the
 * whole reason it does not share the item's line (`§4.2`).
 */
const blockedReason = (item: TodoItemView): string | null => {
	if (item.status !== "blocked") return null;
	return item.reason ? `— blocked: ${item.reason}` : "— blocked";
};

/** The state in words, for the settled states that carry no visible tag. */
const HIDDEN_STATE: Partial<Record<TodoItemStatus, string>> = {
	done: "done",
	dropped: "dropped",
	blocked: "blocked",
};

const TodoRow = ({ item }: { item: TodoItemView }) => {
	const Mark = TODO_MARK[item.status];
	const tag = settledTag(item);
	const reason = blockedReason(item);
	const settled = item.status === "done" || item.status === "dropped";
	return (
		<li className={cn("flex gap-2 px-3 py-0.5")}>
			{/*
			 * The mark column is one ink on every row.
			 *
			 * `todo_panel.py:1780-1783` keeps it `dim` unconditionally — it is the
			 * dock's rail, the same column the composer's chevron sits in — so the
			 * state is said in the TEXT rather than duplicated in the mark. It is
			 * also what keeps four rows of one plan reading as one list.
			 */}
			<span className={cn("pt-0.5")}>
				{/*
				 * `pl-3` and this 16px box put the mark in the SUBAGENT rows' state
				 * column exactly: the two lists are one panel and they share one
				 * grid (`§5`). The plan's own indent lives on the second line, not
				 * in this column.
				 */}
				<span
					aria-hidden={true}
					className={cn(
						"flex size-4 shrink-0 items-center justify-center text-ink-dim",
					)}
				>
					<Mark className={cn("size-4")} />
				</span>
			</span>
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				<div className={cn("flex items-baseline gap-2")}>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-body-sm leading-5",
							TODO_INK[item.status],
							settled && "line-through",
						)}
						title={item.text}
					>
						{item.text}
					</span>
					{HIDDEN_STATE[item.status] && (
						<span className={cn("sr-only")}>{HIDDEN_STATE[item.status]}</span>
					)}
					{tag && (
						/*
						 * The tag is NOT struck, so it stays readable on a row that is
						 * crossed out (`todo_panel.py:1763-1766`). Only `dropped` keeps
						 * its tag inline: one fixed word, on a row that stays one line.
						 */
						<span className={cn("shrink-0 text-ink-dim text-meta")} title={tag}>
							{tag}
						</span>
					)}
				</div>
				{reason && (
					/*
					 * The blocked reason gets its OWN line — the grammar the subagent
					 * section already uses for the activity datum — because sharing the
					 * item's line truncated both strings to fragments: the item (the
					 * subject) lost its payload, and the reason was cut mid-word. Two
					 * variable-length strings on one line means neither is ever
					 * readable. The item takes the full row width; the reason takes the
					 * line below, where it has that same width to itself.
					 *
					 * `ink-muted` rather than the mark's `ink-dim`: on a blocked row
					 * this is the part that says what the work is waiting on, and `dim`
					 * is the ink for settled work.
					 */
					<span
						className={cn("truncate text-ink-muted text-meta leading-4")}
						title={reason}
					>
						{reason}
					</span>
				)}
			</div>
		</li>
	);
};

export const RunDetailTodos = ({ details }: { details: RunDetails }) => {
	const { phases } = visibleTodoPhases(details.todos);
	return (
		<section className={cn("flex flex-col pb-1.5")}>
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				<span className={cn("shrink-0 text-meta text-ink-muted")}>To-dos</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
					)}
				>
					{todoTally(details, TALLY_BUDGET)}
				</span>
			</div>
			{phases.map((phase) => (
				<div key={phase.name ?? "__flat"} className={cn("flex flex-col")}>
					{/*
					 * Headerless for the flat, single-phase plan: an `init` with no
					 * phases of its own does not grow a `Todos · 0/3` header it does not
					 * need. The counts are the plan's own progress — closed over total,
					 * where closed means done or dropped — and they are counted over the
					 * WHOLE phase rather than over the visible slice, so a header cannot
					 * shrink as rows overflow. `resolved` is that closure in words
					 * (`§4.2`).
					 */}
					{phase.name && (
						<div className={cn("flex items-baseline gap-1 px-3 pt-1 pb-0.5")}>
							<span className={cn("truncate text-ink-muted text-meta")}>
								{phase.name}
							</span>
							<span className={cn("shrink-0 text-ink-dim text-meta")}>
								{`· ${phase.closed}/${phase.total} resolved`}
							</span>
						</div>
					)}
					<ul className={cn("flex flex-col")}>
						{phase.items.map((item, index) => (
							<TodoRow key={`${index}-${item.text}`} item={item} />
						))}
						{/*
						 * Disclosed INSIDE the phase that lost the rows (`§6.3`), so the
						 * plan never appears to start mid-way and every phase header above
						 * stays accountable to the rows beneath it. Every hidden row is a
						 * CLOSED one — the model never hides an open or blocked item — so
						 * the count can only ever be settled work.
						 *
						 * The phase keeps its header and this row even when every item of
						 * it was shed, which is the one place a header has no item under
						 * it: silence there would be the plan lying about its own size.
						 */}
						{phase.hidden > 0 && (
							/*
							 * `pl-9` puts the disclosure in the ITEM-TEXT column, not the mark
							 * column: 12px of row padding + the 16px mark + the 8px gap. In the
							 * first column it read as the NEXT phase's header rather than as
							 * this phase's footer — same 12px type, same x, one ink step from
							 * the header below it — and there is no rule between phases to say
							 * where one ends. The indent lives under the rows it counts, which
							 * is the same rule the blocked reason follows (`§4.2`, `§5`).
							 */
							<li className={cn("pt-1 pr-3 pl-9 text-ink-dim text-meta")}>
								{`+${phase.hidden} more`}
							</li>
						)}
					</ul>
				</div>
			))}
		</section>
	);
};
