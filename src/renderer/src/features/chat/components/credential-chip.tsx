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
			// `ml-auto` so the count and the control hug the chip's right edge when
			// the run box is wider than the words, which is what makes the chip read
			// as one object rather than as text with a chip's border around it.
			<span className="ml-auto shrink-0">{`· ${chars} chars`}</span>
		)}
		{onClear && (
			<button
				type="button"
				aria-label={clearLabel}
				onClick={onClear}
				// The chip layer is `pointer-events-none` so that a click anywhere else
				// on the chip reaches the textarea underneath and places the caret; the
				// control is the one part that takes the pointer, and it says so here.
				// Its ink and hover ground are the roles this app already asserts (ink on
				// the chip's fill and on `elevated`), so the control adds no new triple
				// to the contrast contract — see its rows.
				className="pointer-events-auto -mr-0.5 flex shrink-0 items-center rounded-xs text-ink hover:bg-elevated"
			>
				<X aria-hidden="true" className="size-3" />
			</button>
		)}
	</span>
);
