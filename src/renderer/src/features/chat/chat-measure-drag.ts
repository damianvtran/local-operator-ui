/**
 * The arithmetic behind the conversation column's drag affordance.
 *
 * A PURE MODULE, and deliberately so: `pnpm test:desktop` bundles the shipped
 * TypeScript in memory rather than rendering it, so a decision that lives in a
 * JSX handler is a decision no test can reach (`sidebar-split.ts` is the same
 * shape one feature over, and its test file states the same reason). What lives
 * here is the part that can be wrong in a way a person would not notice: the
 * clamp, the direction, and the rule that decides whether a gesture commits at
 * all. The pointer lifecycle, the hover timing and what the cue looks like are
 * NOT here - they are the frames' and the QA matrix's business.
 *
 * ## Two sources of truth, and which one wins
 *
 * The column is responsive (its cap is `max-width`, so it gives way to a narrow
 * pane) and it is also draggable. The rule this module implements, following the
 * pattern `deepseek-harness` ships and the one this repo already uses for
 * `chatSidebarListHeight`:
 *
 *  - **The reader's width REPLACES the shipped default as the cap.** It is not a
 *    second rule sitting beside the first, and there is no window size below
 *    which it stops applying.
 *  - **The responsive behaviour survives as the physical ceiling.** The stored
 *    width is never rewritten by a resize; the RENDER clamps, because a column
 *    cannot be wider than the pane it is in. So a reader who chose 1100px and
 *    then shrank the window sees a narrower column and still gets 1100px back
 *    when they widen it again.
 *  - **What the override cannot do is survive without the pane.** The honest
 *    limit, stated rather than discovered: on a pane narrower than the chosen
 *    width the column takes the pane, and the drag affordance can only ever
 *    narrow it further. That is the same seat the shipped cap is in, so the
 *    override does not fight the layout - it is the layout's ceiling, lowered
 *    or raised. And because the pane can hold the render still through most
 *    of a gesture there, a release whose width the pane is already showing
 *    commits NOTHING rather than writing a change no reader can see -
 *    `releasedChatMeasureWidth` asks the render before it writes.
 *
 * An override that instead pinned a fixed width would fight the layout exactly
 * where the app is narrowest, which is why it is not what this does.
 */

/**
 * The narrowest the reader may drag the column, in px.
 *
 * 520px is a reading column of roughly 65 characters at the 14px body step -
 * the top of the 45-75 range the typographic guidance cites - so the floor is
 * the point past which further narrowing is not a narrower ledger but a broken
 * one, and it is stated in the unit the trade-off is actually about rather than
 * as a round number. It is deliberately well below the shipped 810 so the
 * affordance has room in both directions.
 */
export const CHAT_MEASURE_MIN_PX = 520;

/**
 * The widest the reader may drag the column, in px.
 *
 * 1100px is ~161 characters a line, which is already past every comparator the
 * design board measured. A ceiling exists because "customize the width" is not
 * "remove the cap": without one, a 5K display would draw a single line of prose
 * across the whole window, which is the failure the measure exists to prevent.
 * The reader gets 290px more than the shipped default and no more.
 */
export const CHAT_MEASURE_MAX_PX = 1100;

/**
 * How far the pointer must travel, in px, before a gesture is a drag.
 *
 * THE RULE THIS NUMBER EXISTS FOR, and the bug it refuses: a press that does not
 * move must commit NOTHING. The obvious implementation commits on every release,
 * and that is wrong in a way that is invisible until a reader double-clicks the
 * handle - two press/release rounds - and silently replaces a wide preference
 * with whatever the gesture started from. `deepseek-harness` records the same
 * defect and the same guard ("a press-only gesture must not overwrite a wider
 * preference with its window-clamped display value"); this module is where the
 * guard lives here.
 *
 * 3px rather than 0: a click on a trackpad wobbles, and a 1px wobble is not an
 * instruction to change the column.
 */
export const DRAG_TRAVEL_PX = 3;

/** Clamp a width into the draggable range, rounding to whole pixels. */
export const clampChatMeasureWidth = (width: number): number =>
	Math.min(
		CHAT_MEASURE_MAX_PX,
		Math.max(CHAT_MEASURE_MIN_PX, Math.round(width)),
	);

/**
 * The width a drag is currently pointing at.
 *
 * `startWidth` is the CAP the gesture began from - the reader's own width if
 * they have one, else the shipped default - and NOT the width on screen. That
 * distinction is the second half of the double-click defect: on a pane narrower
 * than the stored width the two differ, and starting from what is drawn would
 * commit the window's clamped value as the reader's new preference.
 *
 * The doubling is because the column is CENTRED: each edge is half the width
 * from the centre, so an edge that should follow the pointer exactly needs the
 * width to move by twice the pointer's travel. Getting this wrong is not a crash
 * - the column simply drifts at half the speed of the hand, which reads as the
 * handle being "sticky" and is the kind of thing only a person notices.
 */
export const draggedChatMeasureWidth = ({
	startWidth,
	deltaX,
	edge,
}: {
	startWidth: number;
	deltaX: number;
	edge: "left" | "right";
}): number =>
	clampChatMeasureWidth(
		edge === "right" ? startWidth + deltaX * 2 : startWidth - deltaX * 2,
	);

/**
 * The width the column PAINTS at, given the cap a measure asks for and the
 * width the pane can show for it.
 *
 * This is `CHAT_MEASURE`'s rule stated as arithmetic, once: the column is
 * `w-full` (it cannot exceed the pane's content box) and capped at
 * `max-width: var(--lo-chat-measure)` (it cannot exceed the reader's number),
 * so what is drawn is the smaller of the two. It exists so the release below
 * can ask THE RENDER'S OWN QUESTION rather than a second copy of it - two
 * spellings of this clamp are how the commit and the pixels drift apart, which
 * is the U4 defect itself.
 */
export const renderedChatMeasureWidth = (
	capPx: number,
	panePx: number,
): number => Math.min(capPx, panePx);

/**
 * What a released gesture should store, or `null` when it should store nothing.
 *
 * `null` is a first-class answer here rather than a quiet "keep what you had":
 * the caller must not write the store at all, because writing the value it
 * already holds would still be a write, and a write is what would let a
 * press-only gesture outlive a wider preference through some later path that
 * reads the store instead of the preference.
 *
 * TWO REFUSALS LIVE HERE, and the second is the render consultation (UX round
 * 2's U4; agent round 2's R2-1 - "the commit path asks the render"):
 *
 *  - **A gesture that did not travel is not an instruction.** The travel guard
 *    below, unchanged.
 *  - **A gesture the render cannot show is not a change.** On a pane narrower
 *    than the cap the RENDER clamps the column to the pane
 *    (`renderedChatMeasureWidth`), so travel can move the preview - and, before
 *    this rule, the store - while every pixel stays put: UX round 2 measured
 *    stored 1100 -> 1060 at a pane rendering 968 with `aria-valuenow` and
 *    `max-width` following and nothing on screen moving. A release whose width
 *    would paint exactly the column already on screen therefore writes
 *    NOTHING: the store may not change while no pixel does.
 *
 * `panePx` is the width the pane can SHOW for the column - the column's own
 * bound where the cap does not bind - read by the caller from the scroll
 * container the column is `w-full` of. It is REQUIRED rather than optional: a
 * release rule that can be called without asking the render is the defect the
 * parameter exists to refuse.
 */
export const releasedChatMeasureWidth = ({
	startWidth,
	deltaX,
	edge,
	panePx,
}: {
	startWidth: number;
	deltaX: number;
	edge: "left" | "right";
	panePx: number;
}): number | null => {
	if (Math.abs(deltaX) < DRAG_TRAVEL_PX) return null;
	const width = draggedChatMeasureWidth({ startWidth, deltaX, edge });
	/*
	 * The equality is EXACT, deliberately: anything that is not the same number
	 * is treated as a change and commits. A tolerance would be a second guess
	 * about what the eye can see, and the one thing this rule may never do is
	 * swallow a width a reader asked for and the pane could show.
	 */
	return renderedChatMeasureWidth(width, panePx) ===
		renderedChatMeasureWidth(startWidth, panePx)
		? null
		: width;
};
