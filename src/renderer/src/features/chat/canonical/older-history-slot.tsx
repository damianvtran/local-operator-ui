import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import type { FC } from "react";

/**
 * The one row above the transcript that says what is happening to its history.
 *
 * Five states share it — an affordance, a load in progress, a failure with its
 * retry, a local window still opening, and the start of the conversation — and
 * they share it at ONE HEIGHT. That is the whole reason this is a component
 * rather than a conditional inline in `canonical-transcript`. The row sits
 * directly above the oldest rendered row, so every pixel it changes height by is
 * a pixel the entire conversation below it moves. With paging driven by a click
 * that was a shrug; with paging driven by scrolling it would be a jump, landing
 * at the exact moment the reader is looking at the top of the screen and the
 * transcript is already growing under them.
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
 * The affordance never leaves while there is history to fetch. Scrolling is the
 * fast path, not the only path: it stays a real, focusable, `Enter`-operable
 * button so the keyboard reaches it, so a reader who has learned to click it
 * keeps their habit, and so the scroll-paging latch has the deliberate act it
 * re-arms on (see `scroll-paging.ts`, rule 4). This mirrors the terminal UI's
 * `OlderHistoryNotice`, which was made a control for the same reason: the head
 * of the transcript must be operable and not merely descriptive.
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
	| "exhausted";

export type OlderHistorySlotProps = {
	state: OlderHistoryState;
	/** Rows the render window is holding back, for the `windowed` copy. */
	hiddenRows: number;
	/**
	 * The session is not live, so a retry cannot succeed and the transcript's
	 * own notice below is already explaining why. The slot goes quiet rather
	 * than stacking a second, louder, contradicting line on top of it.
	 */
	transportDown?: boolean;
	onLoadOlder: () => void;
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
const BOX = "mb-4 flex h-7 min-w-0 items-center gap-2";

/** Stable id so the scroller can point `aria-describedby` at the hint. */
export const OLDER_HISTORY_HINT_ID = "lo-older-history-hint";

export const OlderHistorySlot: FC<OlderHistorySlotProps> = ({
	state,
	hiddenRows,
	transportDown = false,
	onLoadOlder,
}) => {
	// What assistive technology is told, and ONLY what the visible row does not
	// already say. The visible button and text are in the accessibility tree
	// already, so mirroring their sentence into a live region made a screen
	// reader announce the same line twice. What is worth announcing is the
	// transition a reader did not initiate and cannot see if they are reading
	// further down: a load starting, a load failing.
	const announcement =
		state === "loading"
			? "Loading earlier messages"
			: state === "failed"
				? "Could not load earlier messages"
				: null;

	const busy = state === "loading";

	return (
		<div className={BOX}>
			<output className="sr-only" aria-live="polite">
				{announcement}
			</output>
			{state === "failed" ? (
				// Red, and not the terminal UI's quiet note. The TUI can afford a
				// calm phrasing because it classifies the failure first and only
				// stays quiet for the transport case that heals itself; the desktop
				// transport collapses every cause into one rejected request, so this
				// layer cannot honestly claim the failure is the harmless kind.
				// Branding § 8: say what happened, and give the next step beside it.
				//
				// `min-w-0` + `truncate` on the sentence and `shrink-0` on the action
				// is what keeps this one line at 252px; see the head comment.
				<>
					<span
						className="min-w-0 truncate text-danger text-meta"
						title="Could not load earlier messages"
					>
						Could not load earlier messages
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
				// A statement plus the gesture that acts on it. The reader has just
				// been given scrolling as the primary way to reach history, so the
				// row that reports history exists is the place to name it — the same
				// argument the terminal UI's head notice makes ("older messages above
				// — scroll up to load"). "Messages" rather than "rows": a row is a
				// transcript-internal unit the reader never chose.
				<span
					id={OLDER_HISTORY_HINT_ID}
					className="min-w-0 truncate text-ink-dim text-meta"
				>
					{hiddenRows} earlier {hiddenRows === 1 ? "message" : "messages"} above
					{transportDown ? "" : " — scroll up to load"}
				</span>
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
