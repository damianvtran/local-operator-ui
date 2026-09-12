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
 * EVERY CHARACTER OF A LINE TAKES ITS KIND'S INK — the whole `-` line red, the
 * whole `+` line green, the whole `@@` line muted. That is what the terminal
 * does: `_append_diff_body`'s loop appends the whole line under the kind's
 * style with no split anywhere (`row.append(truncate_cells(line, line_width),
 * style=ink)`, tool_card.py:2208-2220). The function's own docstring ("only the
 * leading marker character is coloured here") describes something it does not
 * do, and this file's first implementation followed that docstring; the real
 * card's spans settle it — `'-old line'` is ONE run of nine cells in #ef8078 and
 * `'+new line'` one run in #57c785, not a marker plus a default-ink tail.
 *
 * Full-line ink also fixes a case the marker-only version could not: a WRAPPED
 * continuation inherits its line's ink, so the tail of an addition reads as part
 * of the addition instead of starting at column 0 in body ink, in the same
 * column as the markers.
 *
 * What this costs is measured rather than argued. The tightest pairs across the
 * twelve palettes are `success` on `sunken` at 4.58:1 and `danger` on `sunken`
 * at 4.73:1 (both sage, which is the tightest palette in the set), inside the
 * 4.5 floor and already asserted as TEXT pairs by `scripts/contrast-contract.mjs`
 * (`AS_TEXT` against `canvas`/`surface`/`sunken`), so a wholly green line is a
 * pair the repo already re-proves on every run — not a new token. The
 * alternative, a role WASH behind ordinary `ink` text, was rejected on the
 * same measurements: it buys no contrast (`success` on `success-wash` bottoms
 * out at 4.66:1) and it puts a second ground inside a well whose whole point is
 * being `sunken`, striping the `@@` and context rows against the washed ones.
 *
 * Losing the kind with the colour is not possible: the marker glyph (`+`, `-`,
 * `@`) is the kind's own character, so the body still reads without colour at
 * all.
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
 * The line's ink, by the line's kind.
 *
 * Roles only, per `docs/branding.md` § 1: `success`/`danger` are the same two
 * roles the row's counters use, `ink-muted` is the TUI's `tool.diff.hunk` and
 * `ink-dim` its `tool.diff.context`. `success` and `danger` as text on a
 * `sunken` ground are asserted on all twelve themes by
 * `scripts/contrast-contract.mjs` (`AS_TEXT` against `canvas`/`surface`/
 * `sunken`), so the pairs this block introduces — coloured text in a sunken
 * well — are measured pairs rather than a new token. The two tightest are
 * 4.58 and 4.73 on sage; see the file header for the full reading.
 */
const KIND_INK: Record<DiffLineKind, string> = {
	hunk: "text-ink-muted",
	added: "text-success",
	removed: "text-danger",
	context: "text-ink-dim",
};

/**
 * One line, painted whole in its kind's ink.
 *
 * ONE span, and no `white-space` class on it: the well's own
 * `whitespace-pre-wrap` has to be what applies, because a line is long by
 * nature and a `whitespace-pre` here would OVERRIDE it — every long line then
 * grew a 200px horizontal overflow that `overflow-x-hidden` clipped, so the tail
 * of the line was neither shown nor scrollable. Measured, not anticipated: at
 * 560px the edit body's own box was 610px wide against 418px of column, and it
 * read as a truncated diff. `block` is what keeps one line to one row; the wrap
 * comes from the container.
 */
const Line: FC<{ line: DiffBodyLine }> = ({ line }) => (
	<span className={cn(KIND_INK[line.kind], "block")}>{line.text}</span>
);

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
				// so the frame said "40 lines" with nothing saying there were more.
				// The scroll region that remains is for a WRAPPED body (a 560px column
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
				/*
				 * STICKY, and this is the one thing in the well that must not be
				 * allowed to scroll away. The ceiling above is derived for UNWRAPPED
				 * rows, where the marker sits inside it by construction; a wrapped
				 * body is the shape that actually reaches the cap, and at a 560px
				 * column the 40 shown long lines are 80 rows — 1415px of content in a
				 * 738px clip, measured — so the marker's own row would begin 677px
				 * BELOW the fold. A body that claims completeness while lines are
				 * hidden is the same defect the 720px ceiling had.
				 *
				 * Three classes, each for a measured reason:
				 *
				 * - `sticky -bottom-3` (`bottom: -12px`) pins the row's box to the
				 *   well's inner edge. With plain `bottom-0` it pins 13px higher, at
				 *   the content-box edge, and the next diff row shows through the
				 *   band underneath it — the marker does not read as the well's foot
				 *   any more.
				 * - `pb-3` gives that pinned row the well's own bottom padding as its
				 *   background, so nothing shows through beneath the text.
				 * - `-mb-3` cancels the same padding in the FLOW, and it is not
				 *   cosmetic: without it the marker row is 12px taller, which took
				 *   the unwrapped at-cap body from 737px of content in a 738px clip
				 *   (no scroll — the property the ceiling was derived for) to 749 in
				 *   738, i.e. a scroll region at the exact height where there should
				 *   be none.
				 *
				 * In the well's flow rather than hoisted out as a caption under it:
				 * outside the scroller the marker would have to be counted for
				 * separately in the ceiling, and the ceiling is the well's own.
				 * `bg-sunken` is the well's ground, so the pinned row is not a second
				 * surface.
				 */
				<span className="sticky -bottom-3 -mb-3 block bg-sunken pb-3 text-ink-dim">
					{diffOverflowLabel(body.hidden)}
				</span>
			)}
		</div>
	);
};
