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
 * A DOT AND THE SENTENCE, NOT A SKELETON LINE, since 2026-09-26. The shape was
 * three pulse bars sized as prose lines, and the operator's report asked for the
 * opposite: "a small loading indicator that is non-intrusive - smaller/quieter
 * than a big multi-bar skeleton that then gets replaced". Two reasons make that
 * the right trade rather than only the requested one:
 *
 *   - the bars were a SKETCH OF CONTENT, and the pane the wait now covers paints
 *     no other content at all (the rows are held until the page lands, see
 *     `transcriptPaneHoldsPlaceholder`), so a line sketch stands alone on an
 *     empty pane and reads as content that is about to arrive in that shape -
 *     three lines, this width. On a switch into a 620-row conversation or into
 *     an empty one it is an equally wrong guess, and the frame at the moment it
 *     is replaced makes the guess legible as a repaint;
 *   - a wait is not a layout. What the pane owes the reader here is one fact -
 *     "this conversation is still being read" - and the sentence is that fact;
 *     the indicator only has to be something the eye can hold onto while the
 *     sentence is read. A dot that pulses is that and nothing more.
 *
 * THE STEP IS `elevated`, NOT `sunken`, and that is measured rather than
 * preferred. The shared `Skeleton` defaults to `sunken` on the reasoning that
 * content sits on `surface` (deltaE00 4.48); this pane's ground is `canvas`,
 * where `sunken` is the WEAKEST adjacent pair in the system - deltaE00 1.89 in
 * the dark brand palette and 1.25 in `obsidian`, against the perceptual
 * threshold of about 2 that branding.md § 3 records from the captured frames.
 * A mark whose entire job is to be seen was standing on the faintest step the
 * system has, so the ROLE was the bug and not the pulse. `elevated` is the next
 * ground up from the pane's own and clears the threshold with margin in every
 * palette: at rest deltaE00 3.90 (rosePineDawn) to 12.40 (radient), measured
 * over all fifty-nine. The dot keeps that role, and it keeps it for the reason
 * the dot exists at all: it is the one thing on the pane the eye is meant to
 * catch before it reads.
 *
 * THE PULSE IS `animate-pulse-visible`, NOT `animate-pulse`, and that is the
 * same argument one level down. Tailwind's pulse is keyed `1 -> 0.5 -> 1`, and
 * on a GROUND that takes the step with it: in the light brand palette the
 * trough delivered deltaE00 1.63 against the pane's own canvas - under the same
 * ~2 aim, in the one state where the pane has nothing else to show (design
 * round 2, D8) - while dark measured 3.42 and cleared it. So the floor moved to
 * 0.7 (`styles/index.css` owns the keyframes and the reasoning): trough deltaE00
 * 3.02 (iceberg) to 9.12 (radient) at the token level across the twelve, and
 * 2.81 measured on the delivered light frame against its own ground (1.63
 * before), 4.26 dark (3.54 before), with rest unmoved at 4.79 / 6.52. The pulse
 * stays because it is what says "working" when the wait is long; it is the step
 * and then the depth of the fade that were wrong, not the motion.
 *
 * AND IT IS ONE INDETERMINATE ELEMENT, which is the branding.md § 3 rule for
 * liveness: "one such element per surface, opacity or background-position only,
 * never a layout property, and under reduced motion the element is VISIBLE with
 * the animation never running". The dot is `opacity` only, the keyframes end on
 * `1` (so a reduced-motion document lands on a fully opaque dot), and it is
 * `aria-hidden` because the sentence beside it is the announcement - the dot
 * says "active" to the eye and the live region says what is active.
 *
 * THE WORDS ARE VISIBLE. `Loading conversation…` was `sr-only`, so a sighted
 * user got a faint bar and nothing naming the wait, while the state this
 * replaced ("Opening chat…") did have a visible sentence. `text-ink-dim` is the
 * role § 2 assigns to placeholders and clears the 4.5:1 floor on every ground.
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
		className={cn("flex items-center gap-2", isSmallView && "gap-1.5")}
	>
		{/* The mark: `rounded-full` is the contract's word for a status dot, and
		    this is one - the surface's liveness, not a piece of content. */}
		<span
			aria-hidden="true"
			className="size-2 shrink-0 rounded-full bg-elevated animate-pulse-visible"
		/>
		<span className="text-ink-dim text-meta">Loading conversation…</span>
	</output>
);
