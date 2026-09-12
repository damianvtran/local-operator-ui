/**
 * The unified diff a `write`/`edit` reported, as the row's expansion body.
 *
 * This is the ported terminal body, not a web diff viewer: it is the tool
 * result's own `difflib.unified_diff` payload, painted with the TUI's ink law
 * (`_append_diff_body`, tool_card.py:2178-2225) — `@` hunk markers muted, `+`
 * added in the success green, `-` removed in danger, everything else dim
 * context, the same inks as the row's own `+N -M` pill so the summary and the
 * body tell one story.
 *
 * A DIFF, not a diff viewer: no side-by-side, no gutter numbers, no per-hunk
 * collapse. The agent already made the change; the reader is auditing what it
 * did, and the fastest way to read that is the same 80-column body the terminal
 * shows, in the app's own type scale.
 *
 * Only the leading MARKER is tinted and the text rides the ordinary body ink.
 * That is the law `_append_diff_body`'s own docstring states — "only the
 * leading marker character is coloured here; the text rides the card's default
 * so a coloured line never reads as a wall of tint" — and the reason is
 * legibility: a 40-line body painted green-on-green loses the one thing that
 * makes a diff readable, which is the text. It is why a `-` line's prose stays
 * at full contrast instead of receding into the danger ink the way a
 * status message would.
 *
 * Everything with a right answer lives in `tool-row-model.ts` — the positional
 * header strip, the classification, the cap and the overflow marker — so this
 * file is presentational: it takes lines, paints them, and decides nothing.
 */

import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import {
	type DiffBodyLine,
	type DiffLineKind,
	diffBody,
	diffOverflowLabel,
} from "./tool-row-model";

export type DiffBlockProps = {
	/** The tool result's own diff lines, header pair included. */
	diff: readonly string[];
	className?: string;
};

/**
 * The marker's ink, by the line's kind.
 *
 * Roles only, per `docs/branding.md` § 1: `success`/`danger` are the same two
 * roles the row's counters use, `ink-muted` is the TUI's `tool.diff.hunk` and
 * `ink-dim` its `tool.diff.context`. `success` and `danger` as text on a
 * `sunken` ground are asserted on all twelve themes by
 * `scripts/contrast-contract.mjs` (`AS_TEXT` against `canvas`/`surface`/
 * `sunken`), so the one pair this block introduces — coloured text in a sunken
 * well — is a measured pair rather than a new token.
 */
const MARKER_INK: Record<DiffLineKind, string> = {
	hunk: "text-ink-muted",
	added: "text-success",
	removed: "text-danger",
	context: "text-ink-dim",
};

/**
 * One line: the marker in its kind's ink, the rest in the body's.
 *
 * Two spans rather than a tinted class on the whole line, and no `white-space`
 * on either of them: the well's own `whitespace-pre-wrap` has to be what applies,
 * because a line is long by nature and a `whitespace-pre` here would OVERRIDE it
 * — every long line then grew a 200px horizontal overflow that
 * `overflow-x-hidden` clipped, so the tail of the line was neither shown nor
 * scrollable. Measured, not anticipated: at 560px the edit body's own box was
 * 610px wide against 418px of column, and it read as a truncated diff. `block`
 * is what keeps one line to one row; the wrap comes from the container.
 */
const Line: FC<{ line: DiffBodyLine }> = ({ line }) => {
	const rest = line.text.slice(line.marker.length);
	return (
		<span className="block">
			{line.marker && (
				<span className={cn(MARKER_INK[line.kind])}>{line.marker}</span>
			)}
			{rest}
		</span>
	);
};

export const DiffBlock: FC<DiffBlockProps> = ({ diff, className }) => {
	const body = diffBody(diff);
	return (
		<div
			className={cn(
				// The app's existing sunken well, the same shape `output-block.tsx`
				// uses for machine voice: `rounded-sm bg-sunken p-3 font-mono
				// text-mono-sm`, a height ceiling, and the ground as the boundary.
				//
				// `border-hairline` is not decoration here and it is not optional:
				// `sunken` inside a trace sits on `canvas`, and
				// `scripts/contrast-contract.mjs` records why the two cannot be
				// separated by luminance in the near-black palettes (obsidian's
				// canvas is #09090B against a #030307 sunken, ΔE00 1.23) — so the
				// blocks that live there carry the hairline instead, `output-block`
				// and `log-block` among them.
				//
				// `whitespace-pre-wrap` with `overflow-auto` vertically only: a diff
				// line is long by nature and a horizontal scrollbar inside a
				// disclosure is a scroll region the reader has to discover, so long
				// lines wrap instead. `break-words` is required alongside it — a
				// pre-wrapped token with no break opportunity overflows the box
				// rather than wrapping.
				// The ceiling is DERIVED from the cap rather than picked: a diff at
				// `DIFF_EXPAND_MAX_LINES = 40` shows 40 lines AND the `… N more diff
				// line(s)` marker under them, which at `text-mono-sm`'s 0.75rem/1.45
				// metrics is 41 x 17.4px plus the 12px padding on each side. A shorter
				// ceiling hides the marker that makes the cap honest — measured rather
				// than anticipated: at 720px the capped body clipped that row by 17px,
				// so the frame said "40 lines" with nothing saying there were more. The
				// scroll region that remains is for a WRAPPED body (a 560px column
				// turns 40 lines into 80 rows), which is the case it was always for.
				"max-h-[740px] overflow-y-auto overflow-x-hidden rounded-sm border border-hairline bg-sunken p-3 font-mono text-ink text-mono-sm whitespace-pre-wrap break-words",
				className,
			)}
		>
			{body.lines.map((line, index) => (
				// Position is the key because a diff is an ordered record with no
				// identity of its own: the same line text legitimately appears twice
				// (a repeated `+` line), and the list never reorders in place.
				// biome-ignore lint/suspicious/noArrayIndexKey: an immutable ordered record
				<Line key={index} line={line} />
			))}
			{body.hidden > 0 && (
				<span className="block text-ink-dim">
					{diffOverflowLabel(body.hidden)}
				</span>
			)}
		</div>
	);
};
