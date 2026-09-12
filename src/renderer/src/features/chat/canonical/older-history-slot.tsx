import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/**
 * The one row above the transcript that says what is happening to its history.
 *
 * Four states share it — an affordance, a load in progress, a failure with its
 * retry, and the two ways history ends — and they share it at ONE HEIGHT. That
 * is the whole reason this is a component rather than a conditional inline in
 * `canonical-transcript`. The row sits directly above the oldest rendered row,
 * so every pixel it changes height by is a pixel the entire conversation below
 * it moves. With paging driven by a click that was a shrug; with paging driven
 * by scrolling it would be a jump, landing at the exact moment the reader is
 * looking at the top of the screen and the transcript is already growing under
 * them. So the box is fixed at `h-7` — the height of the `sm` Button, which is
 * the tallest thing that can occupy it — and the states swap inside it.
 *
 * The affordance never leaves while there is history to fetch. Scrolling is the
 * fast path, not the only path: it stays a real, focusable, `Enter`-operable
 * button so the keyboard reaches it, so a reader who has learned to click it
 * keeps their habit, and so the scroll-paging latch has the deliberate act it
 * re-arms on (see `scroll-paging.ts`, rule 4). This mirrors the terminal UI's
 * `OlderHistoryNotice`, which was made a control for the same reason: the head
 * of the transcript must be operable and not merely descriptive.
 *
 * The state is announced as well as drawn. The visible copy is the whole
 * message, but it changes without focus moving and often while the reader is
 * looking at rows further down, so a polite live region carries it to anyone
 * not watching this row.
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
	onLoadOlder: () => void;
};

/**
 * The fixed box. `h-7` matches `Button size="sm"`; `mb-4` is the gap to the
 * first row and belongs to the slot so the slot's presence or absence is the
 * only thing that changes the transcript's top spacing.
 */
const BOX = "mb-4 flex h-7 items-center justify-center";

export const OlderHistorySlot: FC<OlderHistorySlotProps> = ({
	state,
	hiddenRows,
	onLoadOlder,
}) => {
	// What assistive technology is told. `idle` and `windowed` are absent on
	// purpose: they are steady states a reader arrives at rather than events
	// that happen to them, and announcing "load earlier messages" every time the
	// window widens would narrate scrolling.
	const announcement =
		state === "loading"
			? "Loading earlier messages"
			: state === "failed"
				? "Could not load earlier messages"
				: state === "exhausted"
					? "Start of conversation"
					: null;

	return (
		<div className={BOX}>
			{/* `output`, not a `span` with `role="status"`: same implicit role and
			    the same polite live region, without the redundant attribute Biome's
			    `useSemanticElements` rule (correctly) rejects. `aria-live` is kept
			    explicit because `output`'s implicit politeness is "polite" in the
			    spec but not in every screen reader. */}
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
				<span className="flex items-center gap-2">
					<span className="text-danger text-meta">
						Could not load earlier messages
					</span>
					<Button variant="ghost" size="sm" onClick={onLoadOlder}>
						Try again
					</Button>
				</span>
			) : state === "loading" ? (
				// Still the Button, disabled, rather than a bare line: swapping the
				// element would move focus off it mid-load for a keyboard reader who
				// had just activated it.
				<Button variant="ghost" size="sm" disabled>
					<Spinner size="sm" />
					Loading earlier messages
				</Button>
			) : state === "idle" ? (
				<Button variant="ghost" size="sm" onClick={onLoadOlder}>
					Load earlier messages
				</Button>
			) : (
				<span className={cn("text-ink-dim text-meta")}>
					{state === "windowed"
						? `${hiddenRows} earlier ${hiddenRows === 1 ? "row" : "rows"} above`
						: "Start of conversation"}
				</span>
			)}
		</div>
	);
};
