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

/** The trailing tag, in one grammar: `— state`, or `— state: reason`. */
const itemTag = (item: TodoItemView): string | null => {
	if (item.status === "blocked") {
		return item.reason ? `— blocked: ${item.reason}` : "— blocked";
	}
	if (item.status === "dropped") return "— dropped";
	return null;
};

/** The state in words, for the settled states that carry no visible tag. */
const HIDDEN_STATE: Partial<Record<TodoItemStatus, string>> = {
	done: "done",
	dropped: "dropped",
	blocked: "blocked",
};

const TodoRow = ({ item }: { item: TodoItemView }) => {
	const Mark = TODO_MARK[item.status];
	const tag = itemTag(item);
	const settled = item.status === "done" || item.status === "dropped";
	return (
		<li className={cn("flex items-center gap-2 py-0.5 pr-3 pl-6")}>
			{/*
			 * The mark column is one ink on every row.
			 *
			 * `todo_panel.py:1780-1783` keeps it `dim` unconditionally — it is the
			 * dock's rail, the same column the composer's chevron sits in — so the
			 * state is said in the TEXT rather than duplicated in the mark. It is
			 * also what keeps four rows of one plan reading as one list.
			 */}
			<Mark aria-hidden={true} className={cn("size-4 shrink-0 text-ink-dim")} />
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-body-sm",
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
				 * crossed out (`todo_panel.py:1763-1766`), and it steps up to
				 * `ink-muted`: on the blocked row it is the part that says what the
				 * item waits on, which is the whole reason the user has to look.
				 *
				 * Capped at 60% so a long reason truncates rather than eating the
				 * item's own text — the item is the subject, the reason qualifies it.
				 */
				<span
					className={cn(
						"max-w-[60%] shrink-0 truncate text-meta",
						item.status === "blocked" ? "text-ink-muted" : "text-ink-dim",
					)}
					title={tag}
				>
					{tag}
				</span>
			)}
		</li>
	);
};

export const RunDetailTodos = ({ details }: { details: RunDetails }) => {
	const { phases, hidden } = visibleTodoPhases(details.todos);
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
					 * where closed means done or dropped, the same notion the TUI's
					 * auto-hide uses.
					 */}
					{phase.name && (
						<div className={cn("flex items-baseline gap-1 px-3 pt-1 pb-0.5")}>
							<span className={cn("truncate text-meta text-ink-muted")}>
								{phase.name}
							</span>
							<span className={cn("shrink-0 text-meta text-ink-dim")}>
								{`· ${phase.closed}/${phase.total}`}
							</span>
						</div>
					)}
					<ul className={cn("flex flex-col")}>
						{phase.items.map((item, index) => (
							<TodoRow key={`${index}-${item.text}`} item={item} />
						))}
					</ul>
				</div>
			))}
			{/* Disclosed rather than truncated. Every hidden row here is a CLOSED
			 * one — the model never hides an open or blocked item — so the count can
			 * only ever be settled work. */}
			{hidden > 0 && (
				<p className={cn("px-3 pt-1 text-meta text-ink-dim")}>
					{`+${hidden} more`}
				</p>
			)}
		</section>
	);
};
