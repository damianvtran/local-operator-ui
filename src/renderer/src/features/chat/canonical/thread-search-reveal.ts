/**
 * The search hit's reveal seam: land the reader on a matched message and mark
 * it, through the SAME machinery the failure jump and the collapsed turn's bar
 * use.
 *
 * ## What is whose
 *
 * Expanding the gated layers (a collapsed turn's bar, a run's fold, the row's
 * own detail) and scroll-centring the row is `failed-row-jump.ts`'s job — it
 * was lifted out of the foot precisely so every "take me to this record" route
 * crosses the same walk, and this module is the third caller rather than a
 * second implementation of it. What belongs to THIS surface is the other half:
 *
 *   - the OUTCOME. `jumpToFailedRow` is fire-and-forget; a search hit needs to
 *     know whether the row is on screen at all, because a message older than
 *     the rendered window cannot be revealed by opening anything — it has to be
 *     paged in, which is the transcript's own machinery and the caller's next
 *     step (the integration phase's half of this seam). `not-mounted` is that
 *     fact, named.
 *   - the MARK. A landed match is this surface's own state and no other caller
 *     wants it.
 *
 * ## The wait, and why it is a poll rather than a frame count
 *
 * The walk waits one frame per gated layer it opens, so its scroll happens up
 * to two commits after the call. The mark needs the row, not the walk's
 * schedule, so this waits on the ROW — one frame at a time, bounded — and
 * applies the mark the moment it exists. A row already in the DOM is marked
 * with no frame waited at all, which is the common case: most hits were never
 * hidden.
 *
 * ## The mark, and who takes it away
 *
 * The row gets `data-lo-search-landed` for `THREAD_SEARCH_LANDED_MS`, styled
 * in `styles/index.css` as a fading accent wash. The fade-in is a CSS
 * animation and its resting state is TRANSPARENT, so the reduced-motion branch
 * in that stylesheet must keep a static wash instead (the app's global cap
 * lands an animation on its end keyframe — the trap `chat-row-title.tsx`
 * documents); under it, the mark still appears and is still taken away by the
 * SAME timer, so a reader who asked for less motion loses the fade and keeps
 * the fact. The timer — not the animation — is where the mark ends in both
 * worlds, which is also why it survives a theme swap mid-flight.
 */

import { jumpToFailedRow } from "./failed-row-jump";

/**
 * How long a landed row keeps its mark.
 *
 * Matched to the animation's own duration in `styles/index.css`, and exported
 * because the two must move together while neither can import the other: the
 * stylesheet spells it as the animation's length, this constant is when the
 * attribute is removed, and a test pins the pair by running the timer out.
 */
export const THREAD_SEARCH_LANDED_MS = 3000;

/** The attribute a landed row carries while it is marked. */
export const THREAD_SEARCH_LANDED_ATTR = "data-lo-search-landed";

/**
 * How many frames to wait for a row the walk may still be opening.
 *
 * Four, against a walk that waits one per layer and finds at most two on the
 * way to a message (the bar and its fold; a message never sits inside a tool
 * group's own detail). The budget only bounds a hop that cannot succeed — the
 * outcome it names, `not-mounted`, is the honest answer for a row that is not
 * in the window at all.
 */
export const THREAD_SEARCH_REVEAL_FRAMES = 4;

/** What a reveal attempt found. */
export type ThreadSearchRevealOutcome = "revealed" | "not-mounted";

/** One frame, as a promise — how the wait outlasts React's commits. */
function nextFrame(): Promise<void> {
	return new Promise((resolve) => {
		window.requestAnimationFrame(() => resolve());
	});
}

/** The row currently marked, with the timer that will unmark it. */
let landed: { row: HTMLElement; timer: ReturnType<typeof setTimeout> } | null =
	null;

/**
 * Drop the current mark now.
 *
 * Exported because two owners need it: the reveal below (a second jump moves
 * the mark rather than stacking a second one) and the overlay's unmount (a
 * closed panel must not leave a highlight behind on a row it no longer
 * explains).
 */
export function clearThreadSearchLanding(): void {
	if (landed === null) return;
	clearTimeout(landed.timer);
	landed.row.removeAttribute(THREAD_SEARCH_LANDED_ATTR);
	landed = null;
}

/** Mark a row as the search's landing place, replacing any previous mark. */
function markLanded(row: HTMLElement): void {
	clearThreadSearchLanding();
	/*
	 * Reading the box between the removal and the re-set is what restarts the
	 * fade when the mark moves back to the SAME row: in one task the engine would
	 * otherwise coalesce the two attribute changes into "still marked" and the
	 * animation would not replay. In jsdom this reads 0 and costs nothing.
	 */
	void row.offsetWidth;
	row.setAttribute(THREAD_SEARCH_LANDED_ATTR, "");
	landed = {
		row,
		timer: setTimeout(() => {
			row.removeAttribute(THREAD_SEARCH_LANDED_ATTR);
			landed = null;
		}, THREAD_SEARCH_LANDED_MS),
	};
}

/**
 * The row the walk would land on, excluding the collapsed bar that carries the
 * first hidden row's id as its own anchor (`:not([data-turn-summary])`, the
 * same exclusion `failed-row-jump.ts` makes).
 */
function landedRow(root: ParentNode, id: string): HTMLElement | null {
	return root.querySelector<HTMLElement>(
		`[data-record-id="${CSS.escape(id)}"]:not([data-turn-summary])`,
	);
}

/**
 * Land on the message `id` inside `scroller`, and mark it.
 *
 * `scroller` is the transcript's own scroll container — the caller's ref, so a
 * second transcript on the same screen (a canvas pane, the run panel's child
 * reader) can never be the surface a hit navigates.
 */
export async function revealThreadSearchHit(
	scroller: HTMLElement | null,
	id: string,
): Promise<ThreadSearchRevealOutcome> {
	if (scroller === null) return "not-mounted";
	jumpToFailedRow(scroller, id);
	for (let attempt = 0; attempt < THREAD_SEARCH_REVEAL_FRAMES; attempt += 1) {
		const row = landedRow(scroller, id);
		if (row !== null) {
			markLanded(row);
			return "revealed";
		}
		await nextFrame();
	}
	return "not-mounted";
}
