import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
 * WHY THERE IS NO EDGE AT ALL (operator, 2026-11-27: "remove the border"; the
 * first neutral pass drew a `hairline-strong` outline and it still read as rough).
 * Every chip paints over a run of text whose box it must cover EXACTLY, which is
 * why it never had a `border` (1px adds 2px to the box and the chip would sit off
 * the characters it is over) and drew an `outline` instead. It draws neither now:
 * the chip is a FILL with a soft contact shadow, and both are painted outside the
 * layout box, so the box the composer measures is the box the chip covers.
 *
 * WHY THE LIVE CHIP IS A NEUTRAL `sunken` WELL WITH THE ACCENT ON THE GLYPH ONLY
 * (operator report 2026-11-27: "really ugly and out of theme"). It used to be the
 * `info` pair - a saturated blue wash and a cyan 1px edge - a hue the app's own
 * surfaces never carry: against a violet-grey user bubble it read as a foreign
 * widget, and a blue box is a status colour ("information") where a credential
 * reference is just an object in the sentence. `sunken` takes its tone from the
 * theme's own ground ladder in every one of the 59 themes, and it is the fill that
 * steps furthest from the grounds a chip sits on - ΔE00 >= 4.0 off `surface` (the
 * composer's ground), >= 5.1 off `message-surface` (the sent bubble), >= 6.1 off
 * `elevated`, measured over all 59 palettes - which is what lets the fill be the
 * chip's whole boundary now that no edge exists. The one colour on the chip is the
 * key glyph, in `accent` (>= 4.50:1 on `sunken` in every palette), which is what
 * makes it belong to the theme rather than to a status.
 *
 * THE MATERIAL IS THE COMPOSER'S, AT ABOUT HALF STRENGTH (`.lo-chip-surface` in
 * `styles/index.css`, where the numbers and the one recorded shadow exception
 * live): a faint vertical sheen and a top gleam over the fill, and one low contact
 * shadow. In-flow things normally take "the next ground, not a shadow"
 * (`branding.md`, Floating panels); a chip that sits ON a run of text has no ground
 * step to borrow once its edge is gone, so the shadow is what lifts it off the line.
 *
 * The role carries one more job than its looks: the fill is what HIDES the marker
 * characters the textarea paints under the composer's chip, so it has to stay a
 * flat, opaque palette value. `sunken` is one in every palette; a palette change
 * that gave it an alpha channel would let the raw marker text show through.
 */
export const CREDENTIAL_CHIP_ROLE = cn(
	// 3px AND NOT `rounded-sm` (6px), which is a measurement. The composer's chip
	// covers the marker `[Credential #1, 19 chars]` and the textarea paints its glyphs
	// underneath: a bracket's ink runs to the corners of the run box, and a 6px (and
	// even a 4px) corner leaves the bracket's foot showing as a speck at the chip's
	// bottom corners (seen in the zoomed frame, dark theme). 3px covers it, and is
	// still visibly softer than the 2px `rounded-xs` the chip had.
	"rounded-[3px] bg-sunken lo-chip-surface",
	// A chip that wraps draws its fill on each line rather than one stretched box
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
 * WHAT SEPARATES IT WITHOUT COLOUR (2026-11-27, replacing the dashed edge). Round 4
 * (design D2, code review MINOR 2, UX U17) measured the warning wash against the
 * `info` wash it then stood beside at a fill contrast of 1.00-1.63 and a greyscale
 * reading of 34 vs 35 of 255: separated by HUE and almost nothing else, so a dashed
 * edge carried the state for a reader who cannot separate a warm brown from a cool
 * blue, on the app's own doctrine that a state must not rest on colour alone. The
 * operator has since asked for no edge on either register, so the non-hue channels
 * are now two that need no stroke:
 *
 *  - THE GLYPH, the one that survives a reader who sees no hue at all: a key says "a
 *    credential is here", a triangle says "this one is not usable" (shape, not
 *    colour, and the larger mark on the chip);
 *  - THE MATERIAL: the live chip is raised (sheen and contact shadow, see the live
 *    role) and this one is FLAT, a plain wash with neither - the reference nothing
 *    backs has no object behind it to lift.
 *
 * The wash steps off every ground the chip sits on by ΔE00 >= 2.35 (`surface`,
 * `catppuccinMacchiato`), >= 3.58 on `message-surface` and >= 3.80 on `elevated`
 * over all 59 palettes, so it keeps a boundary without an edge. The composer's
 * ARMED token shares this wash and has no glyph of its own at all, so the three
 * registers stay one glyph and one material apart.
 */
export const CREDENTIAL_NOT_STORED_ROLE = cn(
	// The same 3px as the live chip, for the same bracket-corner reason.
	"rounded-[3px] bg-warning-wash",
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
	/**
	 * The field's own type step, so the chip's text is the size of the line box it
	 * covers rather than the app's body step: the composer passes its own
	 * `isSmallView`, and the run box IS the field's line box (17px at the wide rung,
	 * 16px at the compact one). Without it the compact rung's chip renders 14px over
	 * a 13px run, a step too big and a pixel under the prose baseline (design round
	 * 8, D20).
	 */
	small?: boolean;
};

/**
 * The chip's character count, as its own component so the chip (an expression
 * body with no hook slot, and mounted in two registers) repaints the count when
 * the interface language changes without being rewritten around a hook. The
 * whole phrase is ONE message, "· {chars, plural, ...}", because the separator,
 * the count's position and the unit's plural form all vary by language.
 */
const CredentialChipChars: FC<{ chars: number }> = ({ chars }) => {
	useI18nLocale();
	return (
		// MUTED AND TABULAR, SO THE NAME LEADS (operator report 2026-11-27). The name
		// and the count were one ink at one weight, which made "· 107 chars" as loud
		// as the reference it qualifies. The count is the integrity check, not the
		// identity, so it steps down to `ink-muted` (>= 5.53:1 on `sunken` in all 59
		// palettes, `warning-wash` 5.55:1) - still text-legal, and the same ink the
		// clear control rests at - and uses tabular figures so two chips of different
		// lengths line their digits up when they sit in one message.
		<span className="shrink-0 text-ink-muted tabular-nums">
			{t("ui.chat.credential_notice.chip_chars", { chars })}
		</span>
	);
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
	small = false,
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
			/*
			 * `max-w-full` IS THE CLAMP, AND IT IS WHAT LETS THE LABEL ELLIPSISE (design
			 * round 2, D1). `truncate` on the name is only half of an ellipsis: the other
			 * half is a box to truncate INTO, and an `inline-flex` with no bound takes its
			 * width from its content — so a name long enough to pass the line box made the
			 * chip refuse to narrow (measured: 405.78px at every pane from 1024 down to
			 * 300, +157.78px past a 440 line box, with `clientWidth == scrollWidth` on the
			 * label in all twelve themes, i.e. the ellipsis never fired and the chip ran out
			 * through the bubble's edge and sliced flat). The stored register always looked
			 * clamped because its own name is a single long token AND the transcript's card
			 * gives it a line box to fit; the bound is now the chip's own, so every long
			 * name behaves the same way.
			 *
			 * It bounds the chip to its containing block and nothing else: every chip whose
			 * content already fits — which is every composer chip, and the stored chip at
			 * any pane wider than ~280px — measures exactly as it did before, because
			 * `max-width` only bites when the content exceeds it.
			 */
			"inline-flex max-w-full items-center justify-between gap-1.5 px-3 text-ink",
			tone === "warning" ? CREDENTIAL_NOT_STORED_ROLE : CREDENTIAL_CHIP_ROLE,
			small ? "text-body-sm" : "text-body",
			className,
		)}
		title={title}
		style={style}
	>
		{/* THE GLYPH IS THE CHIP'S ONE COLOUR, and the register's second channel (see
		    the not-stored role): `accent` for a key the app holds, `warning` for the
		    triangle on a reference nothing backs. Both are text-legal on their own fill in
		    every palette (accent on `sunken` >= 4.50:1, warning on `warning-wash`
		    >= 4.54:1), and `size-3.5` rather than the old 12px because a coloured glyph
		    is the chip's only mark and 12px read as a speck. It sits inside the run's
		    line box (14px in 16-17px), so it changes no box metric. */}
		{tone === "warning" ? (
			<TriangleAlert
				aria-hidden="true"
				className="size-3.5 shrink-0 text-warning"
			/>
		) : (
			<Key aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
		)}
		{/* A LIVE reference's name is a machine identifier (`LOP_SECRET_…`, `#1`), which
		    is what the app's monospace is for ("monospace is machine voice only",
		    `AGENTS.md`), and it makes a 19-character key read as one token rather than
		    prose. The not-stored register keeps the interface face: its label is a
		    translated sentence ("Credential not stored"), which is prose, not an
		    identifier. `tracking-tight` offsets mono's wide advance so the chip stays
		    inside the run box the composer fixes (see the layer's `min-width`). */}
		<span
			className={cn(
				"min-w-0 truncate",
				tone === "live" && "font-mono tracking-tight",
			)}
		>
			{label}
		</span>
		{chars !== null && (
			// NO `ml-auto` HERE IN EITHER REGISTER (design round 1, D1; round 2, D8).
			// The composer's chip is painted in a box the MINT fixed
			// (`[Credential #1, 19 chars]` is 157.33px wide at the 1024 rung) while the
			// chip's own face is ~123px, so a count that takes the slack parks empty
			// fill *between* the ordinal and the facts it belongs to: `#1` and
			// `· 19 chars` read as two stranded clusters.
			//
			// WHERE THE SLACK GOES NOW (design round 8, D19): the root is
			// `justify-between`, so it is divided ACROSS THE GAPS THE CHIP HAS rather
			// than parked anywhere - and the two registers do not have the same number
			// of gaps. Backed, with the control: three gaps of 10.69 / 10.68 / 10.69 at
			// the 1024 rung. Unbacked (no control - a restored draft whose value is gone,
			// or a composer refusing input): TWO gaps of 22.03 / 22.01, because there is
			// no third item to spread them towards. That wider pair is intended rather
			// than inherited: it is the price of a register that carries no control, the
			// designer looked at the delivered frame and did not ask for it to change,
			// and re-grouping the items to tighten it would re-price D19 itself (it
			// takes the backed chip's own 10.7px band to about 20px).
			<CredentialChipChars chars={chars} />
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
				// THE TRAILING EDGE IS WHERE IT SITS (design round 8, D19): the root is
				// `justify-between`, so the control is the last item and needs no
				// `ml-auto` to reach the end - the utility it carried through rounds 1-7
				// is gone. `-mr-1` is the optical margin that pairs with `px-3`: the
				// control carries about 4px of its own bearing inside its 16px target
				// (2px of padding plus the icon's own inset), so 12px of box padding on
				// both ends leaves the PAINTED ends 4px apart; the negative margin takes
				// that back, leaving 12.02 left against 12.81 right at the 1024 rung.
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
				// THE INK STEPS AND THE GROUND STEPS, BOTH PERCEIVABLE (design round 1, D3;
				// re-measured 2026-11-27 for the `sunken` chip). The control rests at
				// `ink-muted` and steps TO `ink` on hover, which is also the working-
				// directory chip's own prune-control idiom, with the app's ghost pair as
				// the second channel: `hover:bg-elevated`, and `active:bg-surface` for the
				// pressed state.
				//
				// WHY `active:bg-surface` AND NOT THE PRIMITIVE'S `active:bg-sunken`: the
				// chip's own ground IS `sunken` now, so `sunken` would paint the pressed
				// state as the resting one. `surface` sits between the chip and the hover
				// fill, which keeps the three states distinct.
				//
				// MEASURED over all 59 palettes with the repo's own `deltaE`/`loadPalettes`:
				// the hover ground is a real luminance step off the chip - ΔE00 >= 6.07
				// (`iceberg`), contrast ratio >= 1.16:1, no palette at or under 1.10:1 -
				// where the `info` chip it replaces left 7 of 59 with BOTH steps at or
				// under 1.10:1 (design round 2, D9's recorded deviation, which this
				// closes rather than repeats). The pressed ground is ΔE00 >= 3.96 off the
				// chip and >= 2.0 off the hover fill. The INK step is ΔE00(ink, ink-muted)
				// >= 2.01 (`catppuccinFrappe`), the contract's own floor. Legibility holds
				// at every state: `ink-muted` on `sunken` 5.53:1 at worst (`kanagawaLotus`),
				// `ink` on `sunken` 7.10:1, `ink` on the hover fill 8.13:1, `ink-muted` on
				// the pressed fill 6.92:1.
				//
				// `focus-visible:outline-offset-1!` is the primitive's dense-size
				// offset, for the primitive's reason: the global `:focus-visible` rule
				// draws a 2px ring at a 2px offset, which on a 16px control bleeds 3px
				// past its box - out over the chip's own edge and into the words beside
				// it. `!` because the global rule and a utility carry the same
				// specificity, exactly as `button.tsx` spells it.
				className="pointer-events-auto -mr-1 flex shrink-0 cursor-pointer items-center rounded-xs p-0.5 text-ink-muted hover:bg-elevated hover:text-ink focus-visible:outline-offset-1! active:bg-surface"
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
