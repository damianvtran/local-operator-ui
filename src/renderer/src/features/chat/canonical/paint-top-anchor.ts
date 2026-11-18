/**
 * Whether the transcript column keeps its TOP anchor for the pane it is about
 * to paint.
 *
 * THE RULE, in one place because two files have to agree about it: a pane
 * showing a CACHED FRAGMENT - stale, and seeded from a paint the cache could not
 * keep whole (`PaintedConversation.complete` false) - must NOT top-anchor. The
 * column's top anchor is `mb-auto` in a `flex-col-reverse` scroller, which
 * absorbs the scroller's leftover height so a conversation shorter than the pane
 * sits at the top; it resolves to zero the moment the content overflows. A
 * fragment under that anchor is pushed to the top, and the taller page that
 * replaces it overflows, so the margin disappears and every row drops to the
 * bottom in one frame. Measured on a built renderer: first visible row +200.6 px,
 * last row +212.6 px, 26/26 and 16/16 runs at 500/700 KB tool results, 0 px on
 * 120-350 KB results and on genuinely short conversations.
 *
 * WHY THE ANSWER IS THE CURRENT LAYOUT IN EVERY OTHER CASE. A live pane never
 * moves by itself, and a COMPLETE paint is a conversation whose whole content is
 * already on screen: there is no taller page left to land, so the top alignment
 * today's pane has (and a short conversation deserves) is also the one that
 * cannot jump. Dropping the anchor there would move those conversations to the
 * bottom for no gain.
 *
 * `hasEntry` is not a restatement of `stale`: it is the pane's own fact about
 * whether a cache entry is behind the rows. A caller that sets `stale` without
 * one has no fragment to place, and bottom-aligning nothing is a layout change
 * with no defect behind it.
 */

/** The facts the column's anchor decision reads, all of them render state. */
export type PaintAnchorFacts = {
	/** The rows came from the paint cache and no snapshot has landed (`stale`). */
	stale: boolean;
	/** That cached paint is the whole conversation (`PaintedConversation.complete`). */
	complete: boolean;
	/** A cached paint is behind these rows at all. */
	hasEntry: boolean;
};

/** See the file header: top anchor unless a stale, incomplete paint is painted. */
export function paintKeepsTopAnchor(facts: PaintAnchorFacts): boolean {
	if (!facts.stale) return true;
	if (!facts.hasEntry) return true;
	return facts.complete;
}
