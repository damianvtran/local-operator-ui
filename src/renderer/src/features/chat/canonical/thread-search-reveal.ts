/**
 * The search hit's reveal seam: hand a hit to the transcript's own jump.
 *
 * ## What is whose
 *
 * Everything a reveal does belongs to machinery that already exists, and this
 * module is an adapter rather than a second implementation of any of it:
 *
 *   - opening the gated layers above a row (a collapsed turn's bar, its fold,
 *     the row's own detail disclosure) is `revealRecord` in
 *     `failed-row-jump.ts` — the walk the failure jump and the checkpoint rail
 *     also cross;
 *   - centring the landed row in the transcript's own scroller is
 *     `scrollRegionToCenter`, and the landing flash is `paintJumpHighlight`
 *     (`reveal-record.ts`), the same wash the rail's ticks light;
 *   - paging an OLDER message into the window — the transcript's row model and
 *     its render window — is `ensureReachable`'s loop, and it needs callbacks
 *     only `canonical-transcript.tsx` holds. That is why the app path does not
 *     call this function at all: the transcript passes its own
 *     `jumpToSearchHit` into the overlay as `onReveal` (see the overlay's
 *     prop), and a click gets the full near path — load pages, mount the
 *     window far enough, reveal, centre, flash.
 *
 * This adapter is the path for a surface with no transcript around it: the
 * stories, and the overlay's own suites. It answers the same outcome the app
 * path does, so the panel's behaviour is the same shape in both.
 *
 * ## The outcome
 *
 * `not-mounted` is the honest answer for a message outside the rendered
 * window: the walk cannot open a row that is not in the DOM. The caller
 * decides what the reader is told; nothing here fabricates a landing.
 */

import { jumpToEntry } from "./reveal-record";

/** What a reveal attempt found. The vocabulary the overlay's tests drive. */
export type ThreadSearchRevealOutcome = "revealed" | "not-mounted";

/**
 * Reveal the message `id` inside `scroller`, centring it and flashing the row.
 *
 * `scroller` is the transcript's own scroll container — the caller's ref, so a
 * second transcript on the same screen (a canvas pane, the run panel's child
 * reader) can never be the surface a hit navigates. The content box inside it
 * is the walk's root, the same `[data-lo-transcript-content]` the failure
 * jump's call site resolves.
 */
export async function revealThreadSearchHit(
	scroller: HTMLElement | null,
	id: string,
): Promise<ThreadSearchRevealOutcome> {
	if (scroller === null) return "not-mounted";
	const root =
		scroller.querySelector<HTMLElement>("[data-lo-transcript-content]") ??
		scroller;
	const outcome = await jumpToEntry(root, scroller, id);
	return outcome === "landed" ? "revealed" : "not-mounted";
}
