/**
 * The search hit's reveal seam: bring a matched message into view, expand the
 * collapsed turn that may be hiding it, and mark the row it landed on.
 *
 * ## Why this is one function, and where the seam is
 *
 * The transcript is lazy and windowed, so "go to this message" has up to three
 * layers to cross — reveal the row inside a collapsed turn, page an older one
 * into the window, then scroll it to the centre — and every surface that
 * navigates the transcript (the checkpoint rail's ticks, the failure jump, this
 * overlay) must cross them through ONE implementation or the app grows two
 * reveal behaviours that agree until someone fixes only one of them.
 *
 * That shared implementation is IN FLIGHT on sibling branches: the collapse
 * lane's `revealRecord` and the rail's Phase 2 `useTranscriptJump` (the TODO
 * in `use-checkpoints.ts` names it). Neither exists on this branch, so this
 * module is the smallest clean interface those will replace:
 *
 *   revealThreadSearchHit(scroller, id) -> "revealed" | "not-mounted"
 *
 * is the WHOLE surface the overlay consumes. When the shared primitive lands,
 * the staged walk below is deleted and its first half delegates to that
 * primitive; the second half — the transient mark — stays here, because a
 * landed match is this surface's own state and no other caller wants it.
 * TODO(thread-search-integration): swap the walk for the shared reveal; keep
 * `markLanded`.
 *
 * ## The staged walk, and its one layer
 *
 * A collapsed turn's rows are not in the DOM at all (`Disclosure` renders
 * `isOpen && children()`), and the bar that replaced them carries the FIRST
 * hidden row's id as its own anchor (`turn-summary.tsx`'s `data-record-id`),
 * so a lookup for that id must exclude the bar and a collapsed bar must be
 * opened before the row exists. This replicates the failure jump's staged
 * shape for the one layer a MESSAGE can hide behind: find results are user or
 * agent messages by contract, so they never sit inside a tool group's fold —
 * the layers a failed TOOL row needs are deliberately not duplicated here.
 *
 * The frame wait is load-bearing: a layer opens through React state, so its
 * children commit after the current task, and `requestAnimationFrame` is the
 * first moment the next layer — or the row — is in the DOM.
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

/** What a reveal attempt found. */
export type ThreadSearchRevealOutcome = "revealed" | "not-mounted";

/**
 * Whether the user has asked the OS for less motion.
 *
 * Read per call rather than cached, for the reason the failure jump states:
 * the preference can change while the app is open, and this is one
 * `matchMedia` on a press. It decides whether `scrollIntoView` is told to
 * animate; the mark's own treatment under the setting lives in the stylesheet.
 */
function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One frame, as a promise — the walk's only way to wait for React to commit. */
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
 * Bring the message `id` into view inside `scroller`, and mark it.
 *
 * `not-mounted` is not a failure: the message is older than the rendered
 * window (or inside a run that is still opening), and paging it in is the
 * transcript's own machinery — the integration phase's half of this seam. The
 * overlay treats both outcomes the same way today: the reader stays where they
 * are and the panel keeps its list.
 */
export async function revealThreadSearchHit(
	scroller: HTMLElement | null,
	id: string,
): Promise<ThreadSearchRevealOutcome> {
	if (scroller === null) return "not-mounted";
	const selector = `[data-record-id="${CSS.escape(id)}"]:not([data-turn-summary])`;
	let row = scroller.querySelector<HTMLElement>(selector);
	if (row === null) {
		/*
		 * Open the collapsed turn that holds the row, if one is there. The bar
		 * lists its rows' ids verbatim in `data-run-ids`, and its trigger is the
		 * first disclosure button in its subtree — the walk only ever OPENS, so a
		 * run the reader already expanded is left exactly as it is.
		 */
		const bar = [
			...scroller.querySelectorAll<HTMLElement>("[data-run-ids]"),
		].find((node) =>
			(node.getAttribute("data-run-ids") ?? "").split(" ").includes(id),
		);
		const trigger = bar?.querySelector<HTMLElement>("button[aria-expanded]");
		if (trigger?.getAttribute("aria-expanded") === "false") {
			trigger.click();
			await nextFrame();
			row = scroller.querySelector<HTMLElement>(selector);
		}
		if (row === null) return "not-mounted";
	}
	row.scrollIntoView({
		block: "center",
		behavior: prefersReducedMotion() ? "auto" : "smooth",
	});
	markLanded(row);
	return "revealed";
}
