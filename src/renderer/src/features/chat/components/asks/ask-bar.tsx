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
import { askBarLabel, askBarText, askDeadlineText } from "../../ask-queue";

export type AskBarProps = {
	view: AskQueueView;
	/** Whether the panel below is expanded. The bar's own chevron flips it. */
	expanded: boolean;
	/** Flip the panel. Entered ONLY by the user, never on arrival. */
	onToggle: () => void;
	/**
	 * The client clock the deadline reading is rendered against.
	 *
	 * REQUIRED, and passed down from the carrier that already owns the ticking
	 * clock (`AskSurfaces`), rather than defaulted to `Date.now()` here: a bar
	 * that read the clock itself would tick on every render, which is the
	 * countdown-that-lies the carrier's own note is about.
	 */
	nowMs: number;
	/** Extra classes on the outer box (the caller owns the measure). */
	className?: string;
};

/**
 * The bar's visible sentence: the count, then the head question.
 *
 * Kept as a function so the story and the suite can assert the line without a
 * DOM, which is the same reason `questionDockHint` is one.
 */

export const AskBar = ({
	view,
	expanded,
	onToggle,
	nowMs,
	className,
}: AskBarProps) => {
	// An absent queue draws nothing at all: `asks === null` is "this backend does
	// not publish queued asks", which is NOT the same as an empty list, and a bar
	// over an old backend would be an affordance that can never be satisfied.
	if (view.asks === null) return null;
	// Zero asks is absent, never a zero badge (design §5.0's sidebar rule stated
	// for the bar: the affordance disappears at zero).
	if (view.rows.length === 0) return null;

	/*
	 * ONE SENTENCE, TWO READERS. The line drawn and the name announced come from the
	 * same function, because they used to diverge: with only settled asks the bar
	 * painted "1 settled" beside an accessible name that said "No asks
	 * outstanding" - the screen reader was told about a state the screen was not in
	 * (agent review F6, UX U3). Deriving both from `askBarText` makes the two
	 * readings agree by construction rather than by a reviewer noticing.
	 */
	const label = askBarText(view);
	const settledOnly = view.open === 0;
	const Chevron = expanded ? ChevronUp : ChevronDown;
	/*
	 * THE DEADLINE ON THE COLLAPSED BAR (audit). It used to live only on the panel
	 * row, so the one number a reader needs to triage - how long is left - was
	 * behind the very click they were deciding whether to make. The SOONEST
	 * deadline across the waiting asks is what decides that, and it is rendered
	 * against the carrier's clock so it ticks with the panel's copy rather than
	 * beside it.
	 *
	 * Null when nothing waiting carries a readable deadline, in which case the
	 * span is absent rather than an empty slot.
	 */
	const deadline =
		view.soonestExpiryMs === null
			? null
			: askDeadlineText(view.soonestExpiryMs, nowMs);

	return (
		<div
			data-lo-ask-bar={expanded ? "expanded" : "minimized"}
			className={cn("flex w-full shrink-0", className)}
		>
			<button
				type="button"
				/*
				 * Addressed by `AskSurfaces` on collapse, to hand focus back here (UX
				 * round 2, U6): the control that opened the panel is the control a
				 * keyboard user expects to return to, and a `data-` handle keeps that
				 * without a ref plumbed through a presentational component.
				 */
				data-lo-ask-bar-toggle=""
				onClick={onToggle}
				/* The bar is a control, so it says what pressing it does rather than
				 * restating its own visible text - the label a screen reader reads is
				 * the sentence plus the action. */
				aria-expanded={expanded}
				/*
				 * Q-3 (QA round 2): the sentence may already end in a full stop - a
				 * question does ("…the staging cluster?") - so appending one produced
				 * "cluster.. Collapse." A trailing stop is only added when the sentence
				 * does not already supply one.
				 */
				/*
				 * Composed in `ask-queue`'s `askBarLabel` rather than inline, so the
				 * full-stop rule (a question already ends in one - QA round 2, Q-3) is
				 * assertable without opening a story.
				 */
				aria-label={askBarLabel(view, expanded)}
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
						// The GLYPH keeps the muted role when nothing is outstanding, and
						// takes WARNING - not accent - when an outstanding ask is URGENT, which
						// is the one urgency cue the collapsed bar has room for.
						// (Round 1's D3 premise - the muted pair failing AA here - was refuted
						// by the design round's own re-measurement: 7.85:1 dark / 8.19:1
						// light, contract-floored at 5.5:1; the sentence keeps its `ink`.)
						settledOnly
							? "text-ink-muted"
							: view.urgent
								? "text-warning"
								: "text-accent",
					)}
				>
					?
				</span>
				{/*
				 * `text-ink`, not `text-ink-muted`: measured on the bar's own
				 * `surface`, the muted role is 3.59:1 dark / 3.66:1 light, under AA for
				 * the 14px sentence that carries the whole point of the chip (design
				 * round 1, D3). `ink` clears it in both palettes, and the accent glyph
				 * carries the emphasis instead of a second text role.
				 */}
				<span className="min-w-0 flex-1 truncate text-ink">{label}</span>
				{deadline === null ? null : (
					/*
					 * The triage reading, beside the sentence and before the truncation
					 * clause: `shrink-0` so it is never the half that yields, and
					 * `text-ink-muted` because the countdown is a SECONDARY fact beside the
					 * question - the accent/glyph already carries "an ask is outstanding".
					 */
					<span className="shrink-0 text-ink-muted text-xs">{deadline}</span>
				)}
				{view.truncated ? (
					/*
					 * The truncation is stated rather than hidden. The wire caps the list
					 * (20 newest), so a prefix drawn beside the session's own open count
					 * would be a list that lies by omission - and the count is published
					 * separately for exactly this case (design §4, A2 addendum).
					 */
					<span className="shrink-0 text-ink text-xs">
						showing {view.rows.length} of {view.open}
					</span>
				) : null}
				<Chevron aria-hidden="true" className="shrink-0 text-ink" size={16} />
			</button>
		</div>
	);
};
