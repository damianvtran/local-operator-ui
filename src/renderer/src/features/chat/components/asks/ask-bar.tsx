/**
 * The MINIMIZED ask bar: one line above the composer that names the queue.
 *
 * ## Why a bar and not a card (design §5.0, the operator's R7 amendment)
 *
 * A queued ask does not block the agent, so it must not take the screen the way
 * a blocking question does. The old single-slot design had exactly two states -
 * the card, or nothing - and the operator's amendment names the missing third:
 * an ask the user has seen and is not answering YET. That state has to be
 * visible (a question nobody can find is a question nobody answers) and it has
 * to cost nothing: one line, in the composer's own chip vocabulary, never a
 * modal, never a toast, never a banner.
 *
 * ## It never steals focus, and it never animates
 *
 * Nothing here mounts on ask arrival by itself and nothing here moves the
 * reader's caret. The accent on the glyph is a PERSISTENT colour, deliberately
 * not a pulse: an animated accent would be the focus-steal this design exists to
 * avoid, expressed in colour instead of keys (the design note says this in
 * exactly those words, because a pulse is the obvious thing to reach for).
 *
 * ## What it says, and what it must never say
 *
 * The shared copy contract (`ask-queue.ts`) is the source of every string. In
 * particular this component never claims the user was TOLD anything: the backend
 * measures reach (a client is connected, a banner is possible), never delivery
 * to a person, and a bar that said "notified" would be the one claim the whole
 * feature's copy contract exists to forbid.
 */

import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { AskQueueView } from "../../ask-queue";
import { askCountLabel, askHeadline } from "../../ask-queue";

export type AskBarProps = {
	view: AskQueueView;
	/** Whether the panel below is expanded. The bar's own chevron flips it. */
	expanded: boolean;
	/** Flip the panel. Entered ONLY by the user, never on arrival. */
	onToggle: () => void;
	/** Extra classes on the outer box (the caller owns the measure). */
	className?: string;
};

/**
 * The bar's visible sentence: the count, then the head question.
 *
 * Kept as a function so the story and the suite can assert the line without a
 * DOM, which is the same reason `questionDockHint` is one.
 */
export const askBarText = (view: AskQueueView): string => {
	if (view.open <= 0) return "No asks outstanding";
	const count = askCountLabel(view.open);
	if (view.head === null) return count;
	return `${count} — ${askHeadline(view.head.ask)}`;
};

export const AskBar = ({
	view,
	expanded,
	onToggle,
	className,
}: AskBarProps) => {
	// An absent queue draws nothing at all: `asks === null` is "this backend does
	// not publish queued asks", which is NOT the same as an empty list, and a bar
	// over an old backend would be an affordance that can never be satisfied.
	if (view.asks === null) return null;
	// Zero asks is absent, never a zero badge (design §5.0's sidebar rule stated
	// for the bar: the affordance disappears at zero).
	if (view.rows.length === 0) return null;

	const head = view.head;
	const settledOnly = view.open === 0;
	const Chevron = expanded ? ChevronUp : ChevronDown;
	const label = askBarText(view);

	return (
		<div
			data-lo-ask-bar={expanded ? "expanded" : "minimized"}
			className={cn("flex w-full shrink-0", className)}
		>
			<button
				type="button"
				onClick={onToggle}
				/* The bar is a control, so it says what pressing it does rather than
				 * restating its own visible text - the label a screen reader reads is
				 * the sentence plus the action. */
				aria-expanded={expanded}
				aria-label={`${label}. ${expanded ? "Collapse" : "Expand to answer"}.`}
				className={cn(
					"flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left",
					// The composer status chip's own triple: a `surface` fill with a
					// `border-control` edge and `ink` copy, which is what makes this read
					// as a chip rather than as a banner.
					"border border-control bg-surface",
					// Hover is a COLOUR STEP, never a lift (branding § 2): nothing in this
					// app translates or scales under the pointer.
					"hover:bg-elevated",
				)}
			>
				<span
					aria-hidden="true"
					className={cn(
						"shrink-0 font-medium",
						// The accent's one spend in this row, and the design's own choice of
						// what it means: this glyph is what says a question is outstanding.
						// Persistent, never animated.
						settledOnly ? "text-ink-muted" : "text-accent",
					)}
				>
					?
				</span>
				<span className="min-w-0 flex-1 truncate text-ink">
					{settledOnly ? `${view.total} settled` : askCountLabel(view.open)}
					{head ? (
						<span className="text-ink-muted"> — {askHeadline(head.ask)}</span>
					) : null}
				</span>
				{view.truncated ? (
					/*
					 * The truncation is stated rather than hidden. The wire caps the list
					 * (20 newest), so a prefix drawn beside the session's own open count
					 * would be a list that lies by omission - and the count is published
					 * separately for exactly this case (design §4, A2 addendum).
					 */
					<span className="shrink-0 text-ink-muted text-xs">
						showing {view.rows.length} of {view.open}
					</span>
				) : null}
				<Chevron
					aria-hidden="true"
					className="shrink-0 text-ink-muted"
					size={16}
				/>
			</button>
		</div>
	);
};
