import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import type { FC } from "react";

/**
 * The one row above the transcript that says what is happening to its history.
 *
 * Six states share it — an affordance, a load in progress, a failure with its
 * retry, a local window still opening, an unproven end with its own retry, and
 * the start of the conversation — and they share it at ONE HEIGHT. That is the
 * whole reason this is a component rather than a conditional inline in
 * `canonical-transcript`. The row sits directly above the oldest rendered row,
 * so every pixel it changes height by is a pixel the entire conversation below
 * it moves. With paging driven by a click that was a shrug; with paging driven
 * by scrolling it would be a jump, landing at the exact moment the reader is
 * looking at the top of the screen and the transcript is already growing under
 * them.
 *
 * ## Why the height is a floor with a clamp, not a bare fixed height
 *
 * `h-7` alone fixes the BOX and says nothing about its content. The failure
 * line's copy has an intrinsic width of ~258px, and the transcript's content box
 * is 252px at the app's own minimum window (800px floor, minus the 220px rail,
 * minus the 280px chat list, minus `p-4` and the reserved scrollbar gutter). So
 * at a width the app explicitly supports the copy wrapped to two lines and
 * measured 34.78px inside a 28px box, crossing the row's own bottom rule — the
 * component's one invariant, broken by the one state that most needs to be read.
 *
 * The fix is a single row that cannot wrap (`min-w-0` + `truncate` on the text,
 * `shrink-0` on the control) plus `title` for the full sentence. Truncation is
 * the right trade here and not a dodge: the retry control stays fully visible at
 * every width, which is the part the reader must be able to act on, and the
 * sentence degrades from its middle rather than the layout degrading. The
 * stories render the failure state at the app-minimum width precisely so the
 * next reviewer sees this rather than deriving it.
 *
 * ## Why the button stays enabled while loading
 *
 * A `disabled` button cannot hold focus: Chrome blurs it to `<body>` the moment
 * the attribute lands, so a keyboard reader who activated the affordance lost
 * their place mid-load and the next Tab started from the top of the document.
 * That defeated the stated reason for keeping a Button here at all. It is
 * `aria-disabled` instead, with the click ignored while a page is in flight —
 * focus survives, and the label is free to paint at a readable ink role rather
 * than at the disabled-control exemption.
 *
 * ## Which arms are a control and which are a statement
 *
 * The row is an operable control in THREE of its arms and a statement in the
 * other two, and that split is deliberate rather than an oversight to be
 * closed:
 *
 * - `idle` ("Load earlier messages"), `failed` ("Try again") and `unproven`
 *   ("Try again" — remote-load-hydration's arm: `has_more` says the end, no
 *   read has proven it, and the control re-asks the read) render a real
 *   `Button`: focusable, `Enter`-operable, a visible focus ring. These are the
 *   states where the row is the only way forward — nothing is coming on its
 *   own, the last attempt failed, or the last answer proved nothing — so a
 *   keyboard reader, and a reader who has learned to click it, keeps a control
 *   to act on. The click is also the deliberate act the scroll-paging latch
 *   re-arms on (see `scroll-paging.ts`, rule 4). `loading` is the same
 *   `Button`, `aria-disabled` so it keeps focus.
 * - `windowed` and `exhausted` render a plain statement (`<span>`), not a
 *   control. In `windowed` the gesture IS the payload: the row appears while
 *   the reader is already scrolling and the pump still owes them the local
 *   widen, so the useful thing to say is what they are already doing and what
 *   it will buy. A button there would offer a second way to do what the
 *   scroll in flight is about to do. The keyboard reader's operable route out
 *   of `windowed` is therefore the scroller's own keys, not this row: Home and
 *   PageUp are read by the paging hook as input (`use-scroll-paging.ts`), Home
 *   deliberately, so it re-arms the latch as a click would. `exhausted` has
 *   nothing left to operate.
 *
 * Every arm keeps the SAME fixed box, control or statement, which is the
 * invariant the height section above exists for. This mirrors the terminal
 * UI's `OlderHistoryNotice` in the states where it is a control, and no
 * further: the claim is not that the head of the transcript is always
 * operable, only that it is whenever the row is the reader's sole route.
 */

export type OlderHistoryState =
	/** More durable history exists and nothing is in flight. */
	| "idle"
	/** A durable page is being fetched. */
	| "loading"
	/** The last durable page failed; the action is still operable. */
	| "failed"
	/** Rows are held back by the render window only; no round trip is needed. */
	| "windowed"
	/** Every row this conversation has is mounted. */
	| "exhausted"
	/**
	 * The end claim is UNPROVEN (remote-load-hydration): `has_more` says the
	 * conversation stops here, but no read has proven it — a stored remote
	 * session's cold open answers from a facade with no owner, and the session
	 * hook refuses to count that answer as proof. Neither arm around this one may
	 * paint: "Start of conversation" is a claim nobody established, "Could not
	 * load" a failure nobody observed. The row states the fact and offers the one
	 * act that can change it: the read again.
	 */
	| "unproven";

export type OlderHistorySlotProps = {
	state: OlderHistoryState;
	/**
	 * The session is not live, so a retry cannot succeed and the transcript's
	 * own notice below is already explaining why. The slot goes quiet rather
	 * than stacking a second, louder, contradicting line on top of it.
	 */
	transportDown?: boolean;
	onLoadOlder: () => void;
	/**
	 * Re-ask the conversation's authoritative history read (the `unproven` arm's
	 * control — `CanonicalSessionHandle.rehydrate`). Optional so fixtures that
	 * build these props keep type-checking; without it the arm states the fact
	 * and drops the control, which is the same degradation `transportDown` asks
	 * for on the arms that have a gesture to drop.
	 */
	onRetryHydration?: () => void;
};

/**
 * The fixed box. `h-7` matches `Button size="sm"`; `mb-4` is the gap to the
 * first row and belongs to the slot so the slot's presence or absence is the
 * only thing that changes the transcript's top spacing.
 *
 * Left-aligned, not centred: every other in-flow notice in this column
 * (`status` errors, "Reconnecting") is left-aligned, and two notice idioms 16px
 * apart in one column is the inconsistency branding § 7 asks us not to ship.
 */
const BOX = "@container/olderhistory mb-4 flex h-7 min-w-0 items-center gap-2";

/*
 * Two spellings of each sentence, chosen by the width of THIS row.
 *
 * The fixed height (clause F) is not negotiable: the slot sits directly above
 * the oldest row, so any height it gains is height the whole conversation moves
 * by, at the moment the reader is looking at the top of the screen. That makes
 * truncation the only way a too-long sentence can degrade — and truncation was
 * eating the part that carries the meaning. Measured at the app's own floors:
 * the fault line clipped 6px at 252px and 38px at 220px, and the windowed hint
 * clipped 44px of 264px at 220px, losing the gesture it exists to name.
 *
 * The windowed sentence's own length is now FIXED rather than a function of the
 * window: it carried a count of hidden rows, and that count is gone (design
 * round 1, D1 — see the branch comment).
 *
 * A shorter sentence at a narrower column is the fix that keeps F. The
 * container is this row rather than the chat column because the row is what
 * has to fit: the same narrow column yields a different budget here depending on
 * whether an action sits beside the text, and `@container` asks the question
 * that determines the answer.
 *
 * 260px is where the long spellings stop fitting, not a round number: the fault
 * line's own intrinsic width is ~258px.
 *
 * The short spelling is deliberately still the OLD one for the windowed row
 * (`Scroll up for earlier`). It was measured to fit at the widths where it is
 * the only thing painted and it is already free of both the count and the unit
 * the windowed sentence lost (design round 1, D1), so it is the one half of
 * this pair that D1 did not have to move — and lengthening it to name the
 * subject again (`Scroll up for earlier history`, 30 characters against 22)
 * would re-open exactly the clipping this pair exists to prevent, at a measure
 * where nothing else in the row can be dropped instead.
 */
/** The short spelling: shown only BELOW 260px, hidden at or above it. */
const SHORT_COPY = "@min-[260px]/olderhistory:hidden";
/** The full spelling: shown at or above 260px, hidden below it. */
const FULL_COPY = "@max-[260px]/olderhistory:hidden";

/** Stable id so the scroller can point `aria-describedby` at the hint. */
export const OLDER_HISTORY_HINT_ID = "lo-older-history-hint";

export const OlderHistorySlot: FC<OlderHistorySlotProps> = ({
	state,
	transportDown = false,
	onLoadOlder,
	onRetryHydration,
}) => {
	// What assistive technology is told, and ONLY what the visible row does not
	// already say. The visible button and text are in the accessibility tree
	// already, so mirroring their sentence into a live region made a screen
	// reader announce the same line twice. What is worth announcing is the
	// transition a reader did not initiate and cannot see if they are reading
	// further down: a load starting, a load failing.
	//
	// The transport case is announced in the same quiet terms it is painted in:
	// telling a screen-reader user that something "could not" load, when the
	// transcript is simultaneously announcing that it is reconnecting, is the
	// same contradiction D4 removes from the visual row.
	const announcement =
		state === "loading"
			? "Loading earlier messages"
			: state === "failed"
				? transportDown
					? "Earlier messages did not load"
					: "Could not load earlier messages"
				: state === "unproven"
					? "Earlier history not loaded"
					: null;

	const busy = state === "loading";

	return (
		<div className={BOX}>
			<output className="sr-only" aria-live="polite">
				{announcement}
			</output>
			{state === "failed" && transportDown ? (
				/*
				 * The transport is down, so this is not a fault the reader can answer.
				 *
				 * Painting a red fault with a `Try again` here put a retry that cannot
				 * succeed directly above the transcript's own dim "Reconnecting" line,
				 * and in the session-error case stacked two red lines 16px apart — two
				 * claims about one event, with the action attached to the symptom
				 * rather than the cause. The rule that already fixes the `windowed`
				 * case is the rule this case needs: when the transport is down, the
				 * transcript's notice carries the sentence and the slot goes quiet.
				 *
				 * Quiet, not silent. The row keeps its height (clause F) and still
				 * states that the fetch did not happen, at `ink-dim` rather than
				 * `danger` — which is the terminal UI's own reasoning for keeping the
				 * transport case non-red: the condition resolves itself, so it is not
				 * an error for the user to answer. The recoverable `Try again` below
				 * is untouched and still covers the case this branch does not: the
				 * transport is up and the fetch genuinely failed.
				 *
				 * This branch is DEFENSIVE, and a reader should not mistake it for
				 * the product's offline experience. In the flows a UX pass could
				 * actually produce, a real transport loss tears the session view down
				 * — rows go to 0 and the empty state takes the surface — before this
				 * branch ever renders; and on the browser-development surface a
				 * killed backend never flips `status` at all, because the
				 * `EventSource` stays in CONNECTING rather than erroring. Both are
				 * pre-existing behaviours of the session stream and the shell, not of
				 * this slot, and neither is addressed here. What this branch
				 * guarantees is that IF the state is reachable, it does not stack a
				 * second red claim on the transcript's own notice.
				 */
				<span className="min-w-0 truncate text-ink-dim text-meta">
					<span className={SHORT_COPY}>Not loaded</span>
					<span className={FULL_COPY}>Earlier messages did not load</span>
				</span>
			) : state === "failed" ? (
				// Red, and not the terminal UI's quiet note. The TUI can afford a
				// calm phrasing because it classifies the failure first and only
				// stays quiet for the transport case that heals itself; the desktop
				// transport collapses every remaining cause into one rejected
				// request, so this layer cannot honestly claim THIS failure is the
				// harmless kind — the harmless kind is handled one branch above.
				// Branding § 8: say what happened, and give the next step beside it.
				//
				// `min-w-0` + `truncate` on the sentence and `shrink-0` on the action
				// is what keeps this one line; the short spelling is what keeps the
				// words when truncation would eat them. See the head comment.
				<>
					<span
						className="min-w-0 truncate text-danger text-meta"
						title="Could not load earlier messages"
					>
						<span className={SHORT_COPY}>Did not load</span>
						<span className={FULL_COPY}>Could not load earlier messages</span>
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="shrink-0"
						onClick={onLoadOlder}
					>
						Try again
					</Button>
				</>
			) : busy ? (
				<Button
					variant="ghost"
					size="sm"
					// Not `disabled`: see the head comment. The click is ignored here
					// rather than by the platform, so focus stays where the reader put
					// it and the label keeps a readable ink role.
					aria-disabled
					onClick={(event) => {
						event.preventDefault();
					}}
					className="text-ink-muted"
				>
					<Spinner size="sm" />
					Loading earlier messages
				</Button>
			) : state === "idle" ? (
				<Button variant="ghost" size="sm" onClick={onLoadOlder}>
					Load earlier messages
				</Button>
			) : state === "windowed" ? (
				/*
				 * A statement plus the gesture that acts on it. The reader has just
				 * been given scrolling as the primary way to reach history, so the
				 * row that reports history exists is the place to name it — the same
				 * argument the terminal UI's head notice makes ("older messages above
				 * — scroll up to load").
				 *
				 * NO COUNT AND NO UNIT, which is what the row used to carry and what
				 * design round 1's D1 measured away. `hiddenRows` is a count of ROWS
				 * (`canonical-transcript`'s `total - visible.length`, one unit per
				 * record `buildRows` produced) and the copy called those units
				 * "messages" — but rows are not what a reader counts: the render
				 * folds a run of ≥3 actions into one summary line, so most counted
				 * rows never paint as themselves. Measured: the row read `14 earlier
				 * messages above — scroll up to load` over six visible rows, the bar
				 * beneath it reading `225 actions`, and the gesture that followed it
				 * added no visible row. A number in a unit the reader cannot see is a
				 * claim branding § 8 does not allow, and making the two agree is a
				 * MODEL change (the fold is decided in the render plan, not in the
				 * window), so the row states what it can stand behind instead: there
				 * is history above, and scrolling is how you reach it. The subject is
				 * the transcript's HISTORY, which is what the head comment calls it
				 * — a word this row can be held to, unlike a tally of rows.
				 *
				 * The transport clause is unchanged: a fetch that would follow the
				 * local widen cannot be promised while the transport is down, so the
				 * gesture is dropped and the row states only what is true.
				 *
				 * The full sentence is in `title` for the same reason the fault line
				 * carries one (head comment): the row cannot wrap, so at the widths
				 * where the short spelling takes over the sentence the reader sees
				 * is the shorter one, and the fuller wording stays reachable.
				 */
				<span
					id={OLDER_HISTORY_HINT_ID}
					className="min-w-0 truncate text-ink-dim text-meta"
					title={
						transportDown
							? "Earlier history above"
							: "Earlier history above — scroll up to load"
					}
				>
					{/* The gesture is the payload, so it is the clause that goes when
					    the column cannot hold it (and, above, when the transport
					    cannot deliver it). Truncation would have dropped the gesture
					    instead, which is the half a reader cannot infer. */}
					<span className={SHORT_COPY}>
						{transportDown ? "Earlier history above" : "Scroll up for earlier"}
					</span>
					<span className={FULL_COPY}>
						Earlier history above
						{transportDown ? "" : " — scroll up to load"}
					</span>
				</span>
			) : state === "unproven" ? (
				/*
				 * NOT THE END, AND NOT AN ERROR EITHER (remote-load-hydration). The
				 * transcript holds rows and `has_more` says the end, but no read has
				 * proven what lies behind them (see `OlderHistoryState.unproven`), so
				 * the row may state neither "Start of conversation" — a claim nobody
				 * has established — nor "Could not load" — a failure nobody has
				 * observed. What it can say is the fact itself, with the one act that
				 * can change it: retry the read. The control is dropped while the
				 * transport is down, on the same rule the failed arm's quiet branch
				 * follows: a retry that cannot succeed must not be painted beside the
				 * transcript's own notice.
				 */
				<>
					<span
						className="min-w-0 truncate text-ink-dim text-meta"
						title="Earlier history not loaded"
					>
						{/* The short spelling keeps its SUBJECT (design review round 1, D3):
						    four characters away the transport-down fault line renders "Not
						    loaded", and the two rows' remedies differ — wait for the connection
						    versus press the retry — so the dim pair must not read as one
						    sentence. "Earlier not loaded" is 18 characters and fits the
						    252px box with room to spare (measured in the narrow renders beside
						    the arm's own spelling). */}
						<span className={SHORT_COPY}>Earlier not loaded</span>
						<span className={FULL_COPY}>Earlier history not loaded</span>
					</span>
					{!transportDown && onRetryHydration && (
						<Button
							variant="ghost"
							size="sm"
							className="shrink-0"
							onClick={onRetryHydration}
						>
							Try again
						</Button>
					)}
				</>
			) : (
				// The start of the conversation, stated rather than left to absence.
				// The slot stays mounted here on purpose: removing the first row
				// would shift every row below it by the slot's own 44px at the exact
				// moment the reader arrives at the oldest message, which is the shift
				// the whole component exists to prevent. The terminal UI keeps its
				// head notice for the same reason.
				<span className="min-w-0 truncate text-ink-dim text-meta">
					Start of conversation
				</span>
			)}
		</div>
	);
};
