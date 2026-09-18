import { cn } from "@shared/lib/utils";
import { Key, TriangleAlert, X } from "lucide-react";
import type { CSSProperties, FC } from "react";

/**
 * The credential chip: one credential reference, drawn as a chip.
 *
 * TWO SURFACES RENDER THIS, and their being the same component is the point
 * rather than a saving. The TRANSCRIPT shows the citation a sent message
 * carries (`credentialCitation`'s sentence, or `describeUnstored`'s for a value
 * that did not survive) and the COMPOSER shows the `[Credential #N, M chars]`
 * marker the operator is about to send: one reference, one treatment, whether
 * it is on its way out or already gone.
 *
 * WHY THE ROLES LIVE HERE rather than in `credential-overlay.tsx`, where they
 * were written. The chip is the component the roles describe — it has the fill,
 * the edge and the ink — and the composer's mirror is a *consumer* of them: it
 * paints the chip's ground UNDER the textarea's glyphs, because a textarea
 * cannot carry a per-run background and the marker text must keep being painted
 * by the textarea (see that file's own note on §7.1). Keeping the definition
 * beside the component that renders ink on it is what stops the wash and the
 * chip drifting apart.
 *
 * WHY THE EDGE IS AN OUTLINE AND NOT A BORDER, which is a pixel requirement
 * rather than a style choice: every chip paints over a run of text whose box it
 * must cover EXACTLY. A 1px border adds 2px to the box and the chip would sit
 * off the characters it is over — the same property the composer's mirror
 * documents for its own spans, and the reason branding.md forbids box-shadow
 * rings in this app. `outline-solid` is required: `outline-width` alone leaves
 * `outline-style: none` and paints nothing.
 */
export const CREDENTIAL_CHIP_ROLE = cn(
	"rounded-xs bg-info-wash",
	"outline-1 outline-solid outline-info-border",
	// A chip that wraps draws its edge on each line rather than one stretched box
	// across the break, which is how an inline chip behaves everywhere else. It is
	// also what makes a wrapped run's fallback (the composer keeps the wash and
	// draws no chip there) the same shape as the chip it stands in for.
	"box-decoration-clone",
);

/**
 * The NOT-STORED treatment: the chip's shape, in the warning role.
 *
 * A reference nothing backs — a restored draft's marker in the composer, a
 * citation whose value did not survive in the transcript — is a chip the app
 * itself wrote for a value that is not there any more. Round 2 painted it with
 * the live chip's own wash and edge, so the two were pixel-identical and the
 * operator found out only after pressing Enter, from the citation the model
 * received (UX round 3, U13).
 *
 * WHY THE EDGE IS DASHED, which is the round-4 half of the same finding (design
 * round 4, D2; code review round 4, MINOR 2; UX round 4, U17). The warning pair
 * against the info pair separates the two states by HUE and almost nothing
 * else: measured over the generated palettes, the two washes sit at a fill
 * contrast of **1.00-1.63** (forty of the fifty-nine at or under 1.06), the two
 * edges at **1.00-1.72**, and a greyscale reading of the two fills is **34 vs
 * 35 of 255**. Desaturated, the live chip and the not-stored one are the same
 * patch with the same glyphs — so an operator who cannot separate a warm brown
 * from a cool blue would have no cue at all before pressing Enter, and the
 * app's own doctrine (the warning role on the unredacted sentence exists
 * precisely because the TUI's amber fails a monochrome terminal) says a state
 * must not rest on colour alone. A dash style costs no new token and survives
 * monochrome.
 *
 * THE GLYPH CHANGES TOO, which is the second channel and the one that survives a
 * reader who sees neither the hue nor the dash: a key says "a credential is
 * here", and a triangle says "this one is not usable". The composer's ARMED
 * token shares this wash and has no edge and no glyph of its own at all, so the
 * three registers stay one dash and one glyph apart.
 */
export const CREDENTIAL_NOT_STORED_ROLE = cn(
	"rounded-xs bg-warning-wash",
	"outline-1 outline-dashed outline-warning-border",
	"box-decoration-clone",
);

/** Which register a chip is drawn in: a live reference, or one nothing backs. */
export type CredentialChipTone = "live" | "warning";

export type CredentialChipProps = {
	/** What the chip names the reference: a store key, or a marker's `#N`. */
	label: string;
	/** The character count, drawn after the chip's separator. `null` hides it. */
	chars?: number | null;
	/** The register. See the two role constants above. */
	tone?: CredentialChipTone;
	/**
	 * The full sentence the chip stands for, as the native `title`.
	 *
	 * A native tooltip rather than the app's `Tooltip`, for `reply-preview.tsx`'s
	 * reason: this block can render once per reference inside prose, and a Radix
	 * popper per chip is the cost `styles/index.css` already pays a carve-out for
	 * (a floating wrapper with the panel's own box intercepts clicks meant for the
	 * text under it). It is also what carries the information the chip's own two
	 * words drop: the agent-facing sentence says the value cannot be read and
	 * names the environment variable, and the reader who needs that can hover.
	 */
	title?: string;
	/**
	 * The clear control, or `null`/absent where there is nothing to clear.
	 *
	 * Absent on every TRANSCRIPT chip, deliberately — a sent message cannot be
	 * un-sent, and a control there would either silently mutate the session's
	 * credential store or lie about what it does. Adding one would need the
	 * message to be withdrawn from the model's context as well as from the
	 * transcript, which is a conversation-store change rather than a render.
	 *
	 * Absent on the composer's chip too, in two states: a marker nothing backs (no
	 * value to throw away) and a composer that is REFUSING input, where the clear
	 * is a write into the box and carries the same predicate every other writer
	 * carries. Both are the same rule — a control whose verb cannot run is not
	 * drawn — which is why the caller passes the decision in as `null` rather than
	 * the chip deciding for itself.
	 */
	onClear?: (() => void) | null;
	/** The clear control's accessible name. Required whenever `onClear` is. */
	clearLabel?: string;
	/**
	 * Extra classes for the caller's own geometry — the composer positions the
	 * chip absolutely over a measured run and must not have its box re-derived
	 * here.
	 */
	className?: string;
	/**
	 * The caller's own geometry, for the composer's measured layer. Passed through
	 * rather than expressed as classes because the position is a measurement (a
	 * rect read from the mirror) and not a step on any scale.
	 */
	style?: CSSProperties;
};

/**
 * One credential reference as a chip: glyph, name, count, and optionally the
 * control that throws it away.
 *
 * THE COUNT IS THE OPERATOR'S INTEGRITY CHECK (`editor.py:523-540`): it is
 * characters, never lines, because a line count is the weakest form of the
 * check exactly where truncation hides, as in a PEM block. It is rendered as
 * `<n> chars` from the same authority the store's receipt uses
 * (`credentialLabel`), so the chip and the citation cannot disagree.
 *
 * SENTENCE CASE AND NO EMOJI, per the branding contract: this is a fact about a
 * reference, not a decoration.
 */
export const CredentialChip: FC<CredentialChipProps> = ({
	label,
	chars = null,
	tone = "live",
	title,
	onClear,
	clearLabel,
	className,
	style,
}) => (
	<span
		// Not `aria-hidden`, anywhere it is mounted: a chip carries the reference's
		// own words on the transcript, and its clear control is a real control that
		// cannot sit inside a hidden subtree. In the COMPOSER the textarea already
		// exposes the same marker text, so the reference is announced twice there —
		// accepted rather than repaired, because the alternative is a mode flag whose
		// two settings render two accessibility trees for one component, and the
		// composer's half is the one that must not diverge from the transcript's.
		className={cn(
			"inline-flex items-center gap-1 px-1 text-ink",
			tone === "warning" ? CREDENTIAL_NOT_STORED_ROLE : CREDENTIAL_CHIP_ROLE,
			className,
		)}
		title={title}
		style={style}
	>
		{tone === "warning" ? (
			<TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
		) : (
			<Key aria-hidden="true" className="size-3 shrink-0" />
		)}
		<span className="truncate">{label}</span>
		{chars !== null && (
			// NO `ml-auto` HERE IN EITHER REGISTER (design round 1, D1; round 2, D8).
			// The composer's chip is painted in a box the MINT fixed
			// (`[Credential #1, 19 chars]` is 157.33px wide at the 1024 rung) while the
			// chip's own face is ~111px, so a count that takes the slack parks empty
			// fill *between* the ordinal and the facts it belongs to: `#1` and
			// `· 19 chars` read as two stranded clusters. Round 1 moved the slack to the
			// control and left it on the count WHERE THERE IS NO CONTROL - so the
			// unbacked register, the one a restored draft shows once its value is gone,
			// kept the defect and 58px of it (round 2, D8: the widest void in the set).
			// The arrangement is now the same in both registers, which is the honest
			// reading of "the facts sit together": the face's own gaps are the four
			// between glyph and ordinal and the five before the count, the slack falls
			// at the far edge of the box, and the control - when there is one - is what
			// the gutter precedes.
			<span className="shrink-0">{`· ${chars} chars`}</span>
		)}
		{onClear && (
			<button
				type="button"
				aria-label={clearLabel}
				onClick={onClear}
				// The chip layer is `pointer-events-none` so that a click anywhere else
				// on the chip reaches the textarea underneath and places the caret; the
				// control is the one part that takes the pointer, and it says so here.
				//
				// `ml-auto` IS THE GUTTER (design round 1, D1): the control, not the
				// count, is what the slack sits before.
				//
				// `p-0.5` IS THE TARGET (design round 1, D2; UX round 1, U5): a bare
				// `size-3` glyph was a 12x12 box, the smallest control in the composer
				// and the only one whose click destroys a held secret. 4px of padding
				// makes it 16x16, which is as far as this chip's run box allows - the
				// box is 17px tall at the 1024 rung and 16px at the shipped 440 rung, so
				// a 24x24 target would put the chip's own ground over the lines above
				// and below and swallow their clicks. The deviating number is recorded
				// rather than left silent: 16x16 against WCAG 2.2 SC 2.5.8's 24x24, with
				// the box the constraint (see the design record's §7.1).
				//
				// THE INK STEPS, THE GROUND IS THE APP'S GHOST PAIR (design round 1,
				// D3). `hover:bg-elevated` alone was the only feedback, and measured
				// across the palettes it is 1.00-1.33:1 against the chip's fill (16 of
				// 59 at or under 1.05:1; `obsidian` ΔE00 0.77, the default theme
				// greyscale-identical) - a state resting on hue, which this app's
				// doctrine forbids. The perceivable step is therefore the INK, from
				// `ink-muted` (4.56:1 at worst on this fill, over all 59) to `ink`
				// (6.99:1 at worst), which is also the working-directory chip's own
				// prune-control idiom. `hover:bg-elevated active:bg-sunken` is the
				// button primitive's ghost pair, kept as the second channel and as the
				// pressed state the control had none of.
				//
				// THE STEP'S FLOOR IS NOT MET IN EVERY PALETTE, RECORDED RATHER THAN
				// CLAIMED AWAY (design round 2, D9). D3 asked for a step "perceivable by
				// luminance in every theme", and the channel moved and the default theme
				// plus the photographed worst cases are genuinely fixed - but measured over
				// all 59 palettes with the repo's own `deltaE`/`loadPalettes`: the ink step
				// is at or under 1.10:1 in 12 of 59, the ground step in 28 of 59, and BOTH
				// channels are at or under 1.10:1 in 7 of 59 (`everforest` exactly 1.000 -
				// hue moves, luminance does not - `ayuMirage` 1.017, `catppuccinFrappe`
				// 1.038, `oneDark` 1.070, `tokyoNight` 1.076, `gruvbox` 1.087,
				// `tokyoNightStorm` 1.095). So this is a RECORDED DEVIATION from that rule,
				// not a pass: in those seven the perceivable feedback is the focus ring and
				// the pointer cursor rather than the fill. The sentences above are about the
				// control's LEGIBILITY against the fill (4.6:1 at worst on the warning fill,
				// 5.51:1 on the info fill), which holds everywhere; the step's magnitude is a
				// palette-contract question and is deliberately NOT answered by a change in
				// this component.
				//
				// `focus-visible:outline-offset-1!` is the primitive's dense-size
				// offset, for the primitive's reason: the global `:focus-visible` rule
				// draws a 2px ring at a 2px offset, which on a 16px control bleeds 3px
				// past its box - out over the chip's own edge and into the words beside
				// it. `!` because the global rule and a utility carry the same
				// specificity, exactly as `button.tsx` spells it.
				className="pointer-events-auto -mr-0.5 ml-auto flex shrink-0 cursor-pointer items-center rounded-xs p-0.5 text-ink-muted hover:bg-elevated hover:text-ink focus-visible:outline-offset-1! active:bg-sunken"
			>
				<X aria-hidden="true" className="size-3" />
			</button>
		)}
		{/*
		 * THE SENTENCE STAYS IN THE ACCESSIBILITY TREE (design round 1, D5; UX round
		 * 1, U4). The full sentence the chip stands for was rendered text before
		 * this change; putting it only in a native `title` on a non-focusable span
		 * made it a pointer-only affordance, and `title` support on a span is
		 * inconsistent - so a screen reader got the name and the count and lost the
		 * one clause that says the value cannot be read. A visually hidden element
		 * carries the same words without touching what the chip paints, and nothing
		 * stored, sent or logged changes with it.
		 */}
		{title && <span className="sr-only">{title}</span>}
	</span>
);
