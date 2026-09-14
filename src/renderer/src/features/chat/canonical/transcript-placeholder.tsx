import { Skeleton } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/*
 * What a conversation pane shows while its transcript is still in flight.
 *
 * WHERE IT LIVES, and why that is the fix rather than a detail. This used to be
 * rendered inside the composer band, in the greeting's own slot, which is a
 * slot that only exists in the EMPTY-CHAT layout: the band claims the column
 * and centres itself, and the bar sat at the pane's centre. Photographed, that
 * is a different shape from the pane it stands in for - measured on the switch
 * this replaced, the composer's top edge moved 468px -> 736px and the box grew
 * 112px -> 148px at the moment the transcript landed, and the placeholder was a
 * centred 256px line where the transcript is a full-width left-anchored column.
 * A switch that ends by re-shaping the window has not finished registering. So
 * the placeholder renders in the TRANSCRIPT region now, at the same container
 * inset and the same bottom anchor the rows arrive at, and the composer keeps
 * its settled geometry underneath it.
 *
 * THE STEP IS `elevated`, NOT `sunken`, and that is measured rather than
 * preferred. The shared `Skeleton` defaults to `sunken` on the reasoning that
 * content sits on `surface` (deltaE00 4.48); this pane's ground is `canvas`,
 * where `sunken` is the WEAKEST adjacent pair in the system - deltaE00 1.89 in
 * the dark brand palette and 1.25 in `obsidian`, against the perceptual
 * threshold of about 2 that branding.md § 3 records from the captured frames.
 * A placeholder whose entire job is to be seen was standing on the faintest
 * step the system has, so the ROLE was the bug and not the pulse. `elevated` is
 * the next ground up from the pane's own and clears the threshold with margin
 * in all twelve palettes: at rest deltaE00 4.21 (iceberg) to 12.40 (radient),
 * and at the `animate-pulse` trough 2.21 to 7.11 - above the 1.03:1 floor as
 * well, where `sunken`'s trough measured 1.02:1 in the dark brand palette, i.e.
 * absent for part of every cycle in the one state where the pane has nothing
 * else to show. The pulse stays because it is what says "working" when the wait
 * is long; it is the step that was wrong, not the motion.
 *
 * THE WORDS ARE VISIBLE. `Loading conversation…` was `sr-only`, so a sighted
 * user got a faint bar and nothing naming the wait, while the state this
 * replaced ("Opening chat…") did have a visible sentence. `text-ink-dim` is the
 * role § 2 assigns to placeholders and clears the 4.5:1 floor on every ground.
 *
 * The bars are sized as prose lines rather than as one centred rule, so what is
 * on screen reads as "the transcript is coming" and not as "this chat is
 * empty"; the last one is shorter so the group has the ragged right edge a
 * paragraph has.
 */

type TranscriptPlaceholderProps = {
	/** Compact spacing below the small-view breakpoint, like the rows it stands in for. */
	isSmallView?: boolean;
};

export const TranscriptPlaceholder: FC<TranscriptPlaceholderProps> = ({
	isSmallView = false,
}) => (
	/*
	 * ONE element, `<output>` rather than a div with role="status": it carries
	 * the same implicit live-region semantics as a native element, which is what
	 * the a11y lint asks for, and the `aria-label` names the region. The visible
	 * caption lives INSIDE it rather than beside it, so the whole placeholder is
	 * one subtree - the transcript's own "is there content yet" reads exclude
	 * this element by that name, and a caption sitting outside it would have read
	 * as a transcript row (which is exactly how it was caught: every hydrating
	 * frame reported itself as settled).
	 */
	<output
		aria-label="Loading conversation"
		className={cn("flex flex-col gap-2", isSmallView && "gap-1.5")}
	>
		<Skeleton className={cn("h-3 w-56 bg-elevated")} />
		<Skeleton className={cn("h-3 w-80 bg-elevated")} />
		<Skeleton className={cn("h-3 w-64 bg-elevated")} />
		<span className={cn("mt-1 text-ink-dim text-meta")}>
			Loading conversation…
		</span>
	</output>
);
