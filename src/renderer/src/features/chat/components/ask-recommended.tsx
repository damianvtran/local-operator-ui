/**
 * THE RECOMMENDATION MARK: one rendering of "the model recommends this", shared
 * by both ask cards.
 *
 * ## Why it is one module rather than a span in each card
 *
 * The recommendation is drawn on two surfaces that carry the same fact through
 * two different wire shapes - the DOCK card reads `PendingDesktopGate.recommended`
 * (an index) and the DRAWER card reads `PendingAskOption.recommended` (a flag
 * per option) - and the operator's report was about the mark itself rather than
 * about either card. A treatment copied into two files is how one card ends up
 * with the fix and the other keeps the defect, which is the failure this file
 * exists to make impossible.
 *
 * ## Not colour alone, and not prose alone
 *
 * The signal is two things, and neither is a hue:
 *
 *  - the option's LABEL is bolded where it is drawn (the card's job, so the
 *    weight lands beside the label rather than inside this badge);
 *  - this badge - the glyph plus the word - is its own element beside the label.
 *
 * That is the TUI's own treatment (`ask_picker.py` draws `▸ RECOMMENDED` at `fg`
 * plus bold because hue is not available on a terminal), so this is one rule in
 * two renderings rather than a web-only chip. It survives colour-blindness, a
 * greyscale screenshot, and a palette whose `accent` and `ink` collapse
 * together - which is the reason the badge carries no colour at all (measured on
 * the light theme: every chromatic candidate failed WCAG AA against the card's
 * ground, so the TUI's badge is not coloured either).
 *
 * Uppercase is deliberately NOT borrowed from the TUI: the renderer has no
 * uppercase register (`docs/branding.md` §8), and the caps there are a terminal
 * affordance rather than part of the mark.
 *
 * ## Why the glyph AND the word
 *
 * The word alone was the shipped mark, and it had the two failures the operator
 * reported: in the prose weight around it, `Recommended` read as part of the
 * description, and a reader skimming the label column never reached it. The
 * leading glyph is what makes the mark findable at a glance without spending a
 * colour role on it, and the word is what keeps it legible when only the pixels
 * survive (a screenshot, a greyscale print, a colour-blind reader).
 */
import { cn } from "@shared/lib/utils";

/**
 * The glyph, in its own element so it is never read aloud: a screen reader
 * hears "Recommended" once, from the word beside it, rather than a punctuation
 * name plus the word.
 */
export function AskRecommendedBadge({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				/*
				 * `shrink-0` so a long label wraps rather than squeezing the mark, and
				 * `ink-dim` rather than `ink`: the badge is a step off the label it
				 * qualifies, and the label's own weight step (the bolding) is what makes
				 * the pair read as one mark rather than two competing ones.
				 */
				"inline-flex shrink-0 items-baseline gap-0.5 font-medium text-ink-dim text-meta",
				className,
			)}
		>
			<span aria-hidden="true">▸</span>
			Recommended
		</span>
	);
}
