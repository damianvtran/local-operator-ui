import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { formatTurnTimestamp } from "@shared/utils/date-utils";
import { CircleCheck, History } from "lucide-react";
import type { FC } from "react";
import type { CanonicalGoalHistoryEntry } from "../../../../../../shared/desktop-session-contract";
import { EmptyState } from "./canvas-empty-state";

/**
 * The canvas pane's fourth view: the goals this session has settled.
 *
 * IT IS A RECORD, NOT A QUEUE. Every row here is finished — the judge called it
 * done, or the user replaced it — so nothing on this surface has an action, and
 * the omission of a delete control is deliberate rather than unfinished: no
 * command deletes a history row, and adding one would be a new destructive
 * capability on a session-scoped record. `id` is on the wire for the day the
 * operator asks for it; until then a row here is read, not operated.
 *
 * WHY THE FRAME AND NOT A FETCH. The entries ride `frontend.goal_history` rather
 * than arriving from `/goal --history`, because a fetch would bring a loading
 * state, an error state and a second cache to a pane whose job is browsing — and
 * the pane would then be able to disagree with the chip about the same session.
 * The receipt still ships for the typed command and for the TUI, reading the same
 * bounded list.
 */
export const CanvasGoalsViewer: FC<{
	entries: CanonicalGoalHistoryEntry[];
	/**
	 * The wire dropped entries to stay inside its bound.
	 *
	 * CARRIED SEPARATELY FROM `entries` BECAUSE THE LIST CANNOT SHOW IT: a capped
	 * list and a complete one look identical, so without this flag the pane
	 * silently under-reports — the exact bug the flag exists to prevent, and the
	 * reason this is the non-negotiable half of the history ruling. `entries` being
	 * empty while `truncated` is true is a REAL state (every carried entry could
	 * have been dropped by a later bound), which is why the two are rendered
	 * independently rather than one standing in for the other.
	 */
	truncated: boolean;
}> = ({ entries, truncated }) => {
	if (entries.length === 0 && !truncated) {
		/*
		 * THE PANE'S OWN EMPTY STATE, imported rather than restated (design review round
		 * 1, D7). This box used to be a copy with byte-identical classes; the pixels
		 * matched and the pane's one empty-state idiom had two writers, which is the
		 * drift that rule exists to prevent.
		 *
		 * THE DESCRIPTION IS THE APP'S OWN INVITATION FOR THIS ACT (design review round
		 * 1, D9): `no goal set — /goal <text> to set one` is what the TUI's goal panel
		 * and its `/goal` line already say (`local_operator/session/goal.py`), so the two
		 * surfaces spell one invitation one way rather than two. Only the leading
		 * capital differs, which is this pane's register (§ the truncation notice below
		 * is sentence case for the same reason). The second sentence stays because it is
		 * the pane's own answer to "what happens to a goal I finish", which the
		 * invitation does not give.
		 */
		return (
			<EmptyState
				title="No goals completed yet"
				description="No goal set — /goal <text> to set one. Finished goals are kept here."
			/>
		);
	}
	/*
	 * The count in the header counts the ROWS, not the session's history: a pane
	 * that printed a total it cannot see would be inventing the number the truncation
	 * flag exists to admit it does not have.
	 */
	return (
		<section className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto")}>
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				<span className={cn("shrink-0 text-meta text-ink-muted")}>Goals</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
					)}
				>
					{entries.length === 1 ? "1 goal" : `${entries.length} goals`}
				</span>
			</div>
			{/*
			 * THE TRUNCATION NOTICE, and it is not the empty state. It says what is
			 * missing rather than that nothing is here, so a capped list of three
			 * goals cannot read as a session that completed three goals and no more.
			 */}
			{truncated && (
				/*
				 * SENTENCE CASE AND A MEASURE (design review round 1's D4 and D10). The notice
				 * shipped lowercase and unmeasured: *"older settled goals are not carried here
				 * — this list is capped"* rendered directly beside the empty state's sentence-case
				 * description, and *"capped"* is the implementation's word where the pane's own
				 * precedent for a truncation notice is a proper sentence. It starts with a
				 * capital now, so the pane has ONE notice register, and it takes the pane's own
				 * measure (`max-w-80`, as the empty state and the other canvas notices do) so at
				 * the 400px dock floor the sentence does not run the pane's full width.
				 */
				<p className={cn("max-w-80 px-3 pb-1 text-meta text-ink-dim")}>
					Older settled goals are not carried here — this list is capped.
				</p>
			)}
			<ul className={cn("flex flex-col pb-1.5")}>
				{entries.map((entry) => (
					<GoalHistoryRow key={entry.id} entry={entry} />
				))}
			</ul>
		</section>
	);
};

/**
 * One settled goal, in the to-do row's grammar: a 16px state mark, the text, and a
 * trailing `state · time` tag.
 *
 * THE TAG IS THE ONLY PLACE THE STATE IS SPELT, and the word is the wire's
 * `status` verbatim (the loop chip's rule), so the pane and the `/goal --history`
 * receipt cannot describe one goal differently. It is `title`-d so a clipped tag
 * still states itself on hover, and it is never struck: a tag that crossed out its
 * own word would be unreadable exactly where it matters.
 */
const GoalHistoryRow: FC<{ entry: CanonicalGoalHistoryEntry }> = ({
	entry,
}) => {
	const done = entry.status === "done";
	const Mark = done ? CircleCheck : History;
	const tag = goalHistoryTag(entry);
	/*
	 * `disabled` when there is nothing behind the row: a goal the wire settled
	 * without a reason has no detail, and a row that expands to an empty box claims
	 * otherwise. It is still a row of the same height, which is what `disabled`
	 * exists for on this primitive.
	 */
	const hasDetail = Boolean(entry.reason?.trim() || entry.settled_at);
	return (
		<li className={cn("flex flex-col")}>
			<Disclosure
				disabled={!hasDetail}
				rowClassName={cn("h-6 rounded-sm px-3 py-0")}
				summaryAlign="center"
				triggerLabel={`${entry.text} — ${tag}`}
				triggerTooltip={entry.text}
				summary={
					<span className={cn("flex min-w-0 flex-1 items-center gap-2")}>
						{/*
						 * The mark column is `aria-hidden`: the state is said in the tag and in
						 * the trigger's own name, and a screen reader reading a glyph's
						 * `CircleCheck` announces a component name rather than a fact.
						 */}
						<span
							aria-hidden={true}
							className={cn(
								"flex size-4 shrink-0 items-center justify-center text-ink-dim",
							)}
						>
							<Mark className={cn("size-4")} />
						</span>
						<span
							className={cn(
								"min-w-0 flex-1 truncate text-body-sm leading-5",
								done && "line-through text-ink-dim",
							)}
							title={entry.text}
						>
							{entry.text}
						</span>
						<span className={cn("shrink-0 text-meta text-ink-dim")} title={tag}>
							{tag}
						</span>
					</span>
				}
			>
				<div className={cn("flex flex-col gap-1 px-3 pb-1.5")}>
					{entry.reason?.trim() && (
						/*
						 * The judge's reason, as the todo row treats a variable-length
						 * sentence: clamped to two lines for the eye, `title` for the pointer,
						 * and an `sr-only` twin so assistive tech gets the whole sentence
						 * rather than the clamp.
						 */
						<span
							aria-hidden={true}
							className={cn("line-clamp-2 text-ink-muted text-meta leading-4")}
							title={entry.reason}
						>
							{entry.reason}
						</span>
					)}
					{entry.reason?.trim() && (
						<span className={cn("sr-only")}>{entry.reason}</span>
					)}
					{/*
					 * The exact instant in the machine voice, under the human one: the tag
					 * above is the app's existing short stamp (a locale-shaped, relative
					 * thing), and the ISO instant is what a reader who needs to reconcile
					 * this row against a log actually needs. `text-mono` is `branding.md`'s
					 * role for a machine value.
					 */}
					{entry.settled_at && (
						<span className={cn("text-mono text-2xs text-ink-dim")}>
							{entry.settled_at}
						</span>
					)}
				</div>
			</Disclosure>
		</li>
	);
};

/**
 * The row's trailing tag: `<status> · <short stamp>`, the wire's word then the app's
 * existing short timestamp helper.
 *
 * The word is NOT title-cased, translated or mapped — R9's aliases live on the
 * backend and the wire publishes one word per state; a surface that renamed
 * `superseded` to something friendlier would be the second vocabulary for one state
 * the design record refuses. The stamp is `formatTurnTimestamp`, which is the app's
 * one short form for a moment (and the reason this is not a second `Intl` call): it
 * already reads "2:03 PM" for today, "Yesterday 2:03 PM" for yesterday and a dated
 * form beyond that, so a goal settled this morning and one settled in March are
 * distinguishable without a new format.
 */
export const goalHistoryTag = (
	entry: CanonicalGoalHistoryEntry,
	now: Date = new Date(),
): string => {
	const stamp = formatTurnTimestamp(entry.settled_at, now);
	return stamp ? `${entry.status} · ${stamp}` : entry.status;
};
