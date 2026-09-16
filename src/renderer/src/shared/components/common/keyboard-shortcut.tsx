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
 * ## One ink, and why it is `ink-muted`
 *
 * Chosen by measurement rather than by eye, because a cap lands on four different
 * grounds: `surface` (the chat sidebar), `highlight` (a row that is current),
 * `sunken` (the app rail) and `elevated` (the command palette's footer). The
 * contract in `scripts/contrast-contract.mjs` asserts this one at the 4.5:1 text
 * floor on all of them — plus `highlight`, which is the ground this component's
 * own row state introduced — and it measures 5.54:1 at its worst across the
 * twelve palettes (dracula on `elevated`), so one role is legal everywhere a cap
 * renders rather than one role per ground.
 *
 * `ink-dim` is the alternative, and it is rejected on the measurement
 * `docs/command-palette.md` already records for that same row: 5.76:1 on the
 * rail against the label's 8.94:1, which reads as fine print rather than as a
 * key. The step up is a change, not a hierarchy — the chord and its label share a
 * ground, and the cap is what tells you it is a key.
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
	"inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1 font-mono text-ink-muted text-mono-sm";

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
		<span className="inline-flex items-center gap-1">
			{keys.map((key, index) => {
				const Icon = keyIconMap[key.toLowerCase()];
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: the same key legitimately repeats in one shortcut ("Meta+Meta" exists in bindings), so position is part of the identity; the shortcut string is a stable prop, never reordered in place.
					<Fragment key={`${key}-${index}`}>
						{index > 0 && (
							/* The joiner between two caps, and not a cap: it is punctuation,
							   so it keeps the quieter ink the caps were moved off. */
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
