/**
 * The transcript pane's own decision: does it HOLD the placeholder with no rows,
 * or collapse out of the layout?
 *
 * Pure and separate from the component for the reason `scroll-paging.ts` is:
 * the decision is a rule about state, so a node test can pin it, and the
 * component should be left with the rendering rather than the reasoning. The
 * band that shares this decision lives in `chat-content.tsx`/`message-input.tsx`
 * and asks the SAME property through `isHydrating` - one question, two readers.
 *
 * WHY IT IS THE READER'S QUESTION AND NOT THE TRANSPORT'S. `hydrated` means the
 * durable history has been read; `status` says where the stream is. On this path
 * the two disagree in BOTH directions, and each direction was a defect the
 * pre-merge resolution check found (Finding 1):
 *
 * - `status === "connecting"` with `hydrated === true`: `Retry` after a stream
 *   failure re-arms the stream (`use-canonical-session.ts` sets
 *   `failure: null, status: "connecting"` and leaves `hydrated` alone) in front
 *   of a conversation a completed read has already proven EMPTY. Holding there
 *   painted "Loading conversation…" over a conversation that is known to hold
 *   nothing, while the band took the greeting and its `grow` - two contradictory
 *   loading claims splitting one column, and the composer dropped to the
 *   empty-chat position when the snapshot landed. That is the 468px -> 736px
 *   move this work exists to remove.
 * - `status === "live"` with `hydrated === false`: a cold session's snapshot
 *   carries `cursor_missing`, so it goes `live` without hydrating. Not holding
 *   there left the pane collapsed and the band at natural height with no
 *   greeting, i.e. no loading claim anywhere until the history read landed.
 *
 * Keyed on `hydrated`, the two readers cannot disagree: the pane holds exactly
 * while the reader has not been told what the conversation holds, and the band
 * claims the empty-chat shape exactly once it has.
 *
 * `records` rather than rendered rows, because a record that renders to no row
 * is still nothing to scroll.
 */
export function transcriptPaneHoldsPlaceholder(view: {
	/** Has the durable history been read for this conversation? */
	hydrated: boolean;
	/** How many records the transcript holds, painted or not. */
	recordCount: number;
}): boolean {
	return !view.hydrated && view.recordCount === 0;
}
