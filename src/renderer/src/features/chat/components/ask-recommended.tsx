/**
 * THE RECOMMENDATION MARK: one rendering of "the model recommends this", shared
 * by both ask cards.
 *
 * ## Why it is one module rather than a span in each card
 *
 * The recommendation is drawn on two surfaces - the DOCK card
 * (`PendingDesktopGate.recommended`) and the DRAWER card
 * (`PendingAskQuestion.recommended`) - and BOTH read it the same way: an index
 * into the options AS CARRIED. That is the only shape the wire has. The core's
 * `AskOption` (`local_operator/harness/types.py`) is `label`/`description` with
 * `extra="forbid"`, so no producer can put a per-option flag on the wire, and
 * `asks/queue.py`'s `_question_shape` writes the index beside `options` while
 * copying each option verbatim. This module therefore owns the ONE validated
 * read of that index (`recommendedIndex`), which is what keeps the two cards
 * from drifting into two opinions about which row is marked - the failure this
 * file exists to make impossible, and the one the drawer card shipped with (it
 * read a fictional `option.recommended` flag no producer sends, so it drew no
 * mark on any install; agent review round 1, R1-1).
 *
 * The operator's report was about the mark itself rather than about either card,
 * and a treatment copied into two files is how one card ends up with the fix and
 * the other keeps the defect.
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
 * `recommended` as a row index, or `null` when it is not one - THE ONE
 * VALIDATION, shared by both cards (`trace/ask-options.tsx` and
 * `asks/ask-panel.tsx`).
 *
 * VALIDATED, NEVER CLAMPED. A silent clamp would badge a row the model never
 * recommended, and the core already refuses an out-of-range index at the write
 * (`AskQuestion._shape` errors rather than hoisting against an index that
 * indexes nothing), so one arriving here is version skew or a hand-edited
 * fixture - a case that must draw nothing rather than the wrong row.
 *
 * `typeof === "number"` rather than a truthiness read, so a malformed `"0"` or
 * a `NaN` cannot invent a recommendation; non-integers (`1.5`) and negatives are
 * refused for the same reason (`-1` is not "no recommendation", it is a bug that
 * must not resolve to the last row). `null` is the ordinary answer on a backend
 * that predates the field, and it badges nothing.
 */
export function recommendedIndex(
	recommended: unknown,
	count: number,
): number | null {
	return typeof recommended === "number" &&
		Number.isInteger(recommended) &&
		recommended >= 0 &&
		recommended < count
		? recommended
		: null;
}

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
				 * `shrink-0` so a long label wraps rather than squeezing the mark.
				 *
				 * `ink-muted`, NOT `ink-dim` (design round 1, D2). The badge was drawn a
				 * step BELOW the description it sits above (measured: badge 5.25:1 against
				 * the description's 7.24:1 on the drawer's dark ground), so the mark
				 * under-ranked the prose it qualifies; `ink-muted` is the role the option
				 * descriptions and the app's other count lines already wear, and it clears
				 * the 4.5:1 text floor at 5.53:1 worst over the fifty-nine palettes on the
				 * grounds a badge row can sit on (`elevated`; `sunken` under a chosen or
				 * hovered row; 5.95:1 on `elevated` alone). The label's own weight step
				 * (the bolding) is what makes the pair read as one mark rather than two
				 * competing ones.
				 */
				"inline-flex shrink-0 items-baseline gap-0.5 font-medium text-ink-muted text-meta",
				className,
			)}
		>
			<span aria-hidden="true">▸</span>
			Recommended
		</span>
	);
}
