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
import { askBarDeadline, askBarLabel, askBarText } from "../../ask-queue";

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
	 * behind the very click they were deciding whether to make. It is composed by
	 * `askBarDeadline` rather than here, because the SPAN and the BUTTON'S NAME
	 * both carry it and two compositions of one reading is the drift this file has
	 * already been bitten by twice (UX round 1's U2, design round 1's D4).
	 *
	 * Null when nothing waiting carries a readable deadline, or when the frame is
	 * truncated and a queue-scope countdown cannot be derived from a prefix (design
	 * round 1, D6) - in which case the span is absent rather than an empty slot.
	 */
	const deadline = askBarDeadline(view, nowMs);

	return (
		<div
			data-lo-ask-bar={expanded ? "expanded" : "minimized"}
			/*
			 * `@container` (container-type: inline-size) so the deadline can YIELD to
			 * the question at narrow widths without a media query guessing the app's
			 * window size: the bar measures ITSELF, and the chat column is a fraction
			 * of the window (about 300px at the app's own 800px minimum). See the
			 * deadline span's own variant for the rule and its floor.
			 */
			className={cn("@container flex w-full shrink-0", className)}
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
				aria-label={askBarLabel(view, expanded, nowMs)}
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
						// takes WARNING - not accent - when an ask the bar COUNTS AS WAITING is
						// urgent, the same set its sibling deadline reads. The FIRST CUT scoped
						// this to the outstanding set instead (which includes `timed_out`), and a
						// moved-on ask's stale urgency then spent the bar's one warning ink over
						// a queue nothing was waiting on - UX round 1's U1 and design round 1's
						// D1, one defect found twice.
						// The 7.85:1 / 8.19:1 re-measurement below is the standing one.
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
				 * `text-ink`, not `text-ink-muted`: the muted pair was ONCE measured at
				 * 3.59:1 here and that measurement was REFUTED by the design round's own
				 * re-read of the tokens - `ink-muted` on the bar's `surface` is 7.85:1
				 * dark / 8.19:1 light, contract-floored at 5.5:1 (the earlier round's D3
				 * premise; the refutation is recorded in the glyph comment above, and the
				 * 3.59 belongs in the removed-premise pile rather than beside this line -
				 * design round 1 of THIS change, D7). `ink` still carries the sentence,
				 * and the glyph carries the emphasis instead of a second text role.
				 */}
				<span className="min-w-0 flex-1 truncate text-ink">{label}</span>
				{deadline === null ? null : (
					/*
					 * The triage reading, beside the sentence and before the truncation
					 * clause: `shrink-0` so it is never the half that ellipsises into a
					 * number nobody can read, and `text-ink-muted` because the countdown is a
					 * SECONDARY fact beside the question.
					 *
					 * IT YIELDS ENTIRELY AT THE NARROWEST COLUMNS, rather than being
					 * protected at the question's expense (UX round 1's U3). Measured at the
					 * story's 617px pane: the deadline block is 83px `shrink-0` plus its gap,
					 * and every other sibling is fixed too, so the question - the one thing
					 * the bar exists to name - is the half that gets squeezed. Below 20rem
					 * (320px) of BAR width it is not rendered at all, which is the width the
					 * app's OWN minimum window (800x600) leaves for the pane - about 268px of
					 * bar, measured on the `pane-floor` frame - so the question keeps its
					 * room exactly where the room runs out, and the panel row still prints
					 * the same countdown for the same ask. Above it both fit; at 617px the
					 * question ellipsises to make the deadline's 83px, which is the trade the
					 * design round's own D2/D3 asked to see photographed.
					 */
					<span className="hidden shrink-0 text-ink-muted text-xs @[20rem]:inline">
						{deadline}
					</span>
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
