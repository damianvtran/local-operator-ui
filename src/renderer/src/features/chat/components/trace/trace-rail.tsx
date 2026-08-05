/**
 * The trace column's one left rail.
 *
 * Every row in the column is `[chevron 14][6][glyph 14][8][text]`, so text
 * always starts 42px in. The number is not chosen, it is the sum of the two
 * leading slots a row can carry: the disclosure chevron (14px, plus
 * `Disclosure`'s own 6px trigger gap) and the action glyph (14px, plus this
 * row's 8px gap). Text cannot begin before the last of them ends, so the row
 * that carries both fixes the rail for every row that carries fewer.
 *
 * What follows is that a row missing a leading element reserves its box
 * rather than closing up. Closing up is what gave the column three left
 * edges — 20px for reasoning, 22px for an action with no detail, 42px for an
 * action with detail — and it meant the text jumped 22px sideways the moment
 * a running step finished and gained its disclosure. A column that moves when
 * nothing conceptually moved reads as misalignment, not as structure.
 *
 * The two slots are reserved for different reasons, and they are reserved in
 * different places:
 *
 * - The **chevron** slot is an affordance, and it belongs to `Disclosure` —
 *   its `disabled` branch renders the same row box as its trigger with the
 *   gutter held open, so a row with nothing to reveal is not a special case
 *   here. Empty means there is nothing to open; a greyed chevron would
 *   promise a disclosure that does not exist.
 * - The **glyph** slot is identity: it names which action the row records,
 *   and it belongs to this column, which is why it lives here. Reasoning is
 *   not an action, so it has nothing to name — its 12px sans label already
 *   reads as a different kind of row against the monospace action labels, and
 *   inventing a glyph for it would make the quietest tier of § 7 look like
 *   work the agent did.
 */

import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";

export type TraceGlyphProps = {
	/** The 14px lucide glyph. Absent on a row that records no action. */
	children?: ReactNode;
	/** Ink for the glyph. */
	className?: string;
};

/**
 * The identity slot. Fixed at 14px whether or not it holds a glyph, because
 * its width is part of the rail.
 */
export const TraceGlyph = ({ children, className }: TraceGlyphProps) => (
	<span
		aria-hidden={true}
		className={cn("flex size-3.5 shrink-0 [&_svg]:size-3.5", className)}
	>
		{children}
	</span>
);
