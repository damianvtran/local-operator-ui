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

import { Separator } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
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
	tallyBudget,
	todoTally,
	visibleTodoPhases,
} from "./run-detail-model";

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
					<>
						{/*
						 * `line-clamp-2` and a `sr-only` twin, rather than the single clipped line
						 * this used to be (round 2, U2-3): the reason is a variable-length sentence
						 * and the row already owns the line, so the pane's own convention for
						 * prose — the roster's activity line and failure text, the MCP diagnosis —
						 * applies here too. A reason longer than two lines still exists in full for
						 * assistive tech (the twin) and on hover (the `title`), and a mouse is no
						 * longer the only way to read a sentence that is the whole point of the
						 * blocked state. The row grows with it: 16px per line, the same pin the
						 * record already carries (§ 8). `ink-muted` rather than the mark's
						 * `ink-dim`: on a blocked row this is the part that says what the work is
						 * waiting on, and `dim` is the ink for settled work.
						 */}
						<span
							aria-hidden={true}
							className={cn("line-clamp-2 text-ink-muted text-meta leading-4")}
							title={reason}
						>
							{reason}
						</span>
						<span className={cn("sr-only")}>{reason}</span>
					</>
				)}
			</div>
		</li>
	);
};

export const RunDetailTodos = ({
	details,
	paneWidth,
}: {
	details: RunDetails;
	/** The pane's own width, which is what the tally's budget is measured against. */
	paneWidth: number;
}) => {
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
					{todoTally(details, tallyBudget(paneWidth))}
				</span>
			</div>
			{/*
			 * Keyed by POSITION as well as by name, and the position is load-bearing:
			 * the model folds the implicit `Todos` phase per phase (`§ 6.1`), so a plan
			 * the backend lazily grew can hold more than one UNNAMED phase and
			 * `phase.name ?? "__flat"` then collides on every one of them — React
			 * re-uses one subtree for two phases, which is how a list renders rows from
			 * the wrong phase. The order is the model's own, so an index is stable for
			 * a given plan and does not churn on a re-render.
			 */}
			{phases.map((phase, phaseIndex) => {
				/*
				 * A phase whose rows were ALL shed renders its header and its count on
				 * ONE line (`Reconcile · 5 hidden`). § 6.2 prices the header over a
				 * fully-shed phase deliberately — nothing here is hidden, so the
				 * accountability rule is what the header still carries — but stacked as
				 * two lines it read as a phase with nothing in it and an orphaned count
				 * below. One line keeps the rule and removes the empty column.
				 */
				const fullyShed = phase.items.length === 0 && phase.hidden > 0;
				/*
				 * THE UNNAMED GROUP'S BOUNDARY (`§ 6.2`; round 1, U1-5/Q9).
				 *
				 * A headerless phase is the implicit one the backend lazily creates, and
				 * the fold assumes it LEADS the plan — which it does in the ordinary
				 * case, because it is what the first `add` creates. When it does not lead
				 * (a named phase written first, then an unphased `add`), it used to
				 * render its items directly under the previous phase's rows at the same
				 * indent, with no header and no rule: `sweep the build cache` read as a
				 * `Ship it` item, and the per-phase counts this change removed were the
				 * only other signal that said otherwise.
				 *
				 * The boundary is a `hairline` rule, and it is the ONLY rule in the plan:
				 * a named phase is bounded by its own header line, so a rule appears
				 * exactly where the name that would have carried the boundary is absent.
				 * The alternative — heading the group with the backend's implicit name —
				 * is what `§ 6.2` removed (a `Todos` phase under a `To-dos` section), and
				 * inventing a word for it would be a claim the wire does not make.
				 */
				const leadsThePlan = phaseIndex === 0;
				return (
					<div
						key={`${phaseIndex}-${phase.name ?? "__flat"}`}
						className={cn("flex flex-col")}
					>
						{phase.name === null && !leadsThePlan && <Separator />}
						{phase.name && (
							/*
							 * The phase header is the phase's NAME ALONE (`§6.2`), plus the shed
							 * count in the fully-shed case above.
							 *
							 * It used to carry `· {closed}/{total} resolved`, which was a
							 * partition of the section tally's own number stated one line above
							 * it in the same weight — `closed` spelled three or four times in
							 * four lines, and the plan's closure measured at two levels.
							 *
							 * The departure is from the TUI and the reason is citable: the TUI's
							 * `PhaseName · done/total` (`todo_panel.py:1256-1267`) exists because
							 * its dock HIDES a fully settled phase after 60s, so the count is the
							 * only evidence a hidden phase was complete. This panel hides no
							 * phase — a list that reflows under its reader is the defect the old
							 * design refused for the auto-hide — so the count had no job.
							 *
							 * The cost, stated rather than hidden: a phase all of whose rows the
							 * cap shed reads as its name and its own count, and its completion is
							 * legible from the section tally rather than from the header.
							 */
							<div className={cn("flex items-baseline gap-1 px-3 pt-1 pb-0.5")}>
								<span className={cn("truncate text-ink-muted text-meta")}>
									{phase.name}
								</span>
								{fullyShed && (
									/*
									 * `· 5 hidden` on the header line, in the header's own ink and
									 * weight: it is the phase's own statement about its own rows,
									 * not a control and not a second count.
									 */
									<span className={cn("shrink-0 text-ink-dim text-meta")}>
										· {phase.hidden} hidden
									</span>
								)}
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
							 * A STATEMENT, not a control, and the difference is deliberate:
							 * the model sheds these rows and nothing in this pane can put them
							 * back, so the count carries no affordance — no hover ground, no
							 * pointer, no button role — and it does NOT wear the roster's
							 * `Show N more`, which IS a control. The shared `Disclosure`
							 * primitive's `disabled` branch is exactly that row: it keeps the
							 * chevron gutter and the row height of every other disclosure in
							 * the app while dressing this one as what it is. An inert
							 * `+N more` that read like a button was the defect.
							 *
							 * Suppressed when the header already carries the count, so a
							 * fully-shed phase says it once.
							 *
							 * `pl-9` puts the count in the ITEM-TEXT column, not the mark
							 * column: 12px of row padding + the 16px mark + the 8px gap. In the
							 * first column it read as the NEXT phase's header rather than as
							 * this phase's footer — same 12px type, same x, one ink step from
							 * the header below it — and there is no rule between phases to say
							 * where one ends. The indent lives under the rows it counts, which
							 * is the same rule the blocked reason follows (`§4.2`, `§5`).
							 */}
							{phase.hidden > 0 && !fullyShed && (
								<li className={cn("pr-3")}>
									<Disclosure
										disabled={true}
										summary={`${phase.hidden} hidden`}
										className={cn("pl-9 text-meta")}
									/>
								</li>
							)}
						</ul>
					</div>
				);
			})}
		</section>
	);
};
