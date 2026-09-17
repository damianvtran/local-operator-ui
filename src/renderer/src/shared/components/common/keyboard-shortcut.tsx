/**
 * A rendered keyboard shortcut, as key caps.
 *
 * `kbd` rather than styled spans: the element already means "key the user
 * presses", so the caps read correctly to a screen reader without any ARIA. The
 * key's text is the element's own content (or, for an icon, its `sr-only` twin),
 * so the chord stays in the accessible name of whatever control carries it — the
 * chat sidebar's New chat row and the inline editor's footer both rely on that.
 *
 * ## One idiom, and no ground of its own
 *
 * A cap carries **no fill and no border**. What separates a key from the sentence
 * around it is the monospace ink, the fixed box and the centring — not a box
 * drawn round it. This is the operator's report, and the fill it describes was
 * real: `bg-sunken` drew a recessed box that measured 1.11-1.26:1 against the
 * chat sidebar's `surface` and 1.20-1.55:1 against the footer's `elevated` — a
 * step too small to read as elevation, and still a visible BOX, because a shape
 * with an edge is legible at ratios a colour step is not. It also made one thing
 * into three treatments: the app rail could not draw a cap at all (its ground IS
 * `sunken`, so the cap's fill vanished into it, ΔE00 0.00), and the New chat row's
 * caps needed a caller-supplied `outline-control` edge while that row was current,
 * for the same collapse.
 *
 * ## The geometry IS the consistency
 *
 * Every cap is the same size whatever it carries — a glyph (`↑`, `↵`), a word
 * (`esc`) or a lucide icon (`⌘`): one min width, one height, one padding, one ink
 * role, one icon size. It did not use to be, and the numbers are committed rather
 * than argued: `docs/evidence/new-chat-shortcut/README.md` reads the shipped frames
 * at 20 CSS px wide for both caps, and **14 px tall** for the `⌘` cap against
 * **21.5 px tall** for the `N` cap beside it — two heights for one bar, because the
 * icon branch padded a 10px glyph with `p-0.5` while the text branch padded a 12px
 * line with `py-0.5`.
 *
 * The icon is now drawn at the size the text is set in, so a glyph and an icon
 * occupy the same box rather than approximating each other. `min-w-5` rather than
 * a fixed width because `esc` is three glyphs and cannot be 20px wide without
 * clipping: the box is a MINIMUM that a word grows out of, with the same floor
 * and the same padding for everything.
 *
 * ## One ink, and why it is `ink-dim`
 *
 * Chosen by measurement rather than by eye, because a cap lands on four different
 * grounds: `surface` (the chat sidebar), `highlight` (a row that is current),
 * `sunken` (the app rail) and `elevated` (the command palette's footer). The
 * contract in `scripts/contrast-contract.mjs` asserts `ink-dim` at the 4.5:1 text
 * floor on the four grounds a cap renders on in every palette, and it measures
 * **4.51:1** at its worst over the twelve palettes the port started from (dracula
 * on `elevated`; 4.72:1 on `highlight`, 4.65:1 on `sunken`), so one role is legal
 * everywhere a cap lands rather than one role per ground.
 *
 * It spent a round at `ink-muted`, one step up, and the measurement that moved it
 * back is about the RANK of the thing a cap annotates rather than about the floor
 * the cap clears on its own. The palette prints its legend labels in `ink-dim`,
 * so a cap at `ink-muted` outranked the label it annotates — read out of the
 * committed pairs, a legend cap sat at 6.76-6.83:1 against the bar while its
 * labels read 4.55:1 and 3.87:1, and on the active row the `Go` verb read 4.54:1
 * against its own `↵` cap at 7.02:1. That is backwards for an annotation, and the
 * operator asked for these to be "a bit more subtle", so at `ink-dim` a cap sits
 * at or below its label and the monospace face and the uniform box are what still
 * say "this is a key".
 *
 * The cost is stated rather than hidden: on the app rail the row's own label is
 * `ink`, so the chord is the quieter of the two there. That is the intended
 * relationship — the label is what you read, the cap is what tells you it has a
 * key — and `docs/command-palette.md` records it the same way, having previously
 * recorded the opposite for a round.
 *
 * ## Why there is no `size` or `className` prop any more
 *
 * Both existed to let a caller re-skin a cap, and there is nothing left to
 * re-skin: the size difference between an icon and a glyph was the defect this
 * component now closes by construction, and the caller-supplied edge the chat
 * sidebar used to pass (`capEdge`, an `outline-control` on the New chat row while
 * that row was current) existed for one reason — the cap's fill and the row's
 * ground were the same `sunken` role, so on that row the cap had to be drawn
 * round to be visible at all. With no fill there is nothing for the row's ground
 * to collide with, the edge is retired, and a caller-supplied appearance would be
 * a second cap idiom — which is what this change is removing.
 */

import { Command, CornerDownLeft } from "lucide-react";
import { Fragment } from "react";
import type { ElementType, FC } from "react";

type KeyboardShortcutProps = {
	shortcut: string;
};

/**
 * The icon size, tied to the type step rather than to a glyph eyeballed in
 * isolation: `CAP` sets `text-mono-sm` (12px), and an icon inside it has to be
 * that size for the two to occupy the same box. It used to be 10 while the text
 * was 12, which is most of why a cap carrying an icon and a cap carrying a word
 * were different sizes.
 */
const ICON_SIZE = 12;

/**
 * The cap itself: one idiom for every key, on every ground, in every theme.
 *
 * `rounded-xs` is invisible without a fill and is kept deliberately — the cap's
 * box is the same box whatever it is painted on, so a future treatment that wants
 * a corner does not have to rediscover the radius (2px is this system's radius
 * for a shape at control scale, `docs/branding.md` § 5).
 */
const CAP =
	"inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1 font-mono text-ink-dim text-mono-sm";

/**
 * The chord's own spacing, and why it is not the caps' default gap.
 *
 * The wrapper's gap is the only thing that sets how far apart two caps' INK sit,
 * because a cap's box is a `min-w-5` floor with its content centred in it: shrinking
 * a cap's PADDING moves nothing while the box is wider than its content (the content
 * is re-centred in what is left), so padding is not a lever here and the gap is.
 * With the box invisible, that ink distance is the whole rhythm of a chord, and at
 * the wrapper's old `gap-1` it was wider than the box-to-box distance the retired
 * filled caps read at: measured in the rig's own frames of the New chat row, the
 * ink gaps were 10px and 11px, where the filled caps had left 5-6px of ground
 * between a box edge and the joiner. At `gap-0` they measure 6px and 7px, so a
 * chord reads as one key again — the before/after frames and the numbers are in
 * `docs/evidence/chat-sidebar-current-row/README.md`.
 */
const CHORD = "inline-flex items-center gap-0";

const keyIconMap: Record<string, ElementType> = {
	"⌘": Command,
	cmd: Command,
	command: Command,
	enter: CornerDownLeft,
	"↵": CornerDownLeft,
};

export const KeyboardShortcut: FC<KeyboardShortcutProps> = ({ shortcut }) => {
	const keys = shortcut.split("+").map((key) => key.trim());

	return (
		<span className={CHORD}>
			{keys.map((key, index) => {
				const Icon = keyIconMap[key.toLowerCase()];
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: the same key legitimately repeats in one shortcut ("Meta+Meta" exists in bindings), so position is part of the identity; the shortcut string is a stable prop, never reordered in place.
					<Fragment key={`${key}-${index}`}>
						{index > 0 && (
							/* The joiner between two caps, and not a cap: punctuation carries the
							   caps' own ink (`ink-dim`) and not the sentence's, so a chord does
							   not read as three marks joined by a louder one. */
							<span aria-hidden="true" className="text-mono-sm text-ink-dim">
								+
							</span>
						)}
						<kbd className={CAP}>
							{Icon ? (
								<>
									<Icon size={ICON_SIZE} aria-hidden="true" />
									<span className="sr-only">{key}</span>
								</>
							) : (
								key
							)}
						</kbd>
					</Fragment>
				);
			})}
		</span>
	);
};
