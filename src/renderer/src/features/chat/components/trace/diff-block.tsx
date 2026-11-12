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
 * What this costs is measured rather than argued. The tightest pairs across
 * every palette are `success` on `sunken` at 4.58:1 (sage) and `danger` on
 * `sunken` at 4.57:1 (everforestLight, with sage's
 * 4.73:1 next), inside the
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
 * header strip, the classification, the cap, the overflow count, the withheld
 * stand-in and the copy — so this file holds one piece of state (collapsed or
 * expanded) and otherwise paints what the model hands it.
 *
 * THE CAP IS A DEFAULT, NOT A LIMIT. A body opens at the terminal's 40 lines,
 * and the `… N more diff lines` row under it is a BUTTON that shows every
 * recorded line (and becomes `Show less`). It used to be inert text: lines 41+
 * of every large `write`/`edit` were unreachable anywhere in the app, which is
 * the defect an operator reported reviewing a subagent's work. Lines the
 * PRODUCER never recorded are a different fact and get a footer, not a toggle
 * (`truncatedRows`); a legacy row whose diff the old core withheld gets one
 * notice (`diffBody(...).withheld`).
 */

import { cn } from "@shared/lib/utils";
import { type FC, useId, useLayoutEffect, useRef, useState } from "react";
import { DiffHistoryPager, type DiffHistoryScope } from "./diff-history";
import {
	type DiffFullDescriptor,
	diffFullNoticeLabel,
	diffFullViewLabel,
	namelessHeaderRows,
} from "./diff-history-model";
import { KIND_INK } from "./diff-ink";
import {
	DIFF_EXPAND_MAX_LINES,
	type DiffBodyLine,
	diffBody,
	diffOverflowLabel,
	diffShowLessLabel,
	diffTruncatedLabel,
	diffWithheldLabel,
} from "./tool-row-model";

export type DiffBlockProps = {
	/** The tool result's own diff lines, header pair included. */
	diff: readonly string[];
	/**
	 * Rendered diff rows the producer dropped before storing `diff`
	 * (`details.diff_truncated_rows`); 0 or absent when it dropped none.
	 */
	truncatedRows?: number;
	/**
	 * Where this call's FULL archived diff can be paged from, when the core
	 * archived one (`details.diff_full`). Only meaningful with
	 * `truncatedRows > 0`: the preview already holds every row otherwise.
	 * `scope` is the conversation the row was read through (parent or child),
	 * `callId` the tool call — the route resolves the artifact from both.
	 */
	history?: {
		scope: DiffHistoryScope | null;
		callId: string;
		descriptor: DiffFullDescriptor | null;
	};
	className?: string;
};

/**
 * Underline at rest separates the action from context rows and the dim footer
 * without introducing another ink. Start alignment follows the reader's locale.
 * The focus outline belongs to the label, not the sticky background's padding:
 * otherwise the well clips its bottom edge and leaves an empty 12px box.
 */
const TOGGLE =
	"group/diff-toggle block w-full cursor-pointer bg-sunken text-start text-ink-dim underline underline-offset-2 transition-colors duration-fast ease-out-quart hover:text-ink focus-visible:outline-none";

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
const Line: FC<{ line: DiffBodyLine; index: number }> = ({ line, index }) => (
	<span data-diff-line={index} className={cn(KIND_INK[line.kind], "block")}>
		{line.text}
	</span>
);

export const DiffBlock: FC<DiffBlockProps> = ({
	diff,
	truncatedRows = 0,
	history,
	className,
}) => {
	const [expanded, setExpanded] = useState(false);
	// Full mode REPLACES the preview inside this same well with one bounded page
	// of the archive; Back returns to the preview exactly as it was left.
	const [full, setFull] = useState(false);
	/*
	 * Rows exist that the preview does not show: the producer said so
	 * (`truncatedRows`), or the preview is EMPTY while the core archived the
	 * diff — the first/only row was too long for the inline budget, so no row
	 * could be kept inline (`isArchiveOnlyDiffRow`). Either way the descriptor
	 * decides what the footer offers; with no descriptor an empty preview stays
	 * the old honest nothing.
	 */
	const archiveOnly = diff.length === 0 && Boolean(history?.descriptor);
	const omitted = truncatedRows > 0 || archiveOnly;
	const descriptor = omitted ? (history?.descriptor ?? null) : null;
	const pageable =
		descriptor?.state === "archived" && history?.scope ? history : null;
	const wellId = useId();
	const wellRef = useRef<HTMLDivElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const anchorRef = useRef<{ scroller: HTMLElement; top: number } | null>(null);
	const viewFullRef = useRef<HTMLButtonElement>(null);
	const body = diffBody(diff, { expanded });
	/*
	 * The preview is the first rows of the same redacted diff the archive
	 * holds, so its nameless `---`/`+++` pair tells us the archive's too. Both
	 * the "View full diff · N lines" count and the pager's range subtract it:
	 * the reader never sees those rows (review round 1, R3/U4/Q3).
	 */
	const headerRows = namelessHeaderRows(diff);
	/*
	 * An archive-only row has no preview to read the pair from. Its offer
	 * assumes the producer's shape (`_diff_details` runs `difflib.unified_diff`
	 * without file names, so every non-empty diff opens with the nameless pair);
	 * the pager does NOT assume — it reads the pair off the archive's own first
	 * page (`headerRows` undefined), so the range it shows is measured.
	 */
	const offerHeaderRows = archiveOnly ? 2 : headerRows;

	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		if (!anchor) return;
		anchorRef.current = null;
		if (expanded) {
			// The canonical transcript is bottom-anchored (flex-col-reverse).
			// Growing in place otherwise keeps its tail, jumping past line 41.
			// Restore the first revealed line to the toggle's former viewport
			// position before paint; scrollTop also works in the negative range.
			const firstRevealed = wellRef.current?.querySelector<HTMLElement>(
				`[data-diff-line="${DIFF_EXPAND_MAX_LINES}"]`,
			);
			if (firstRevealed) {
				const top =
					firstRevealed.getBoundingClientRect().top -
					anchor.scroller.getBoundingClientRect().top;
				anchor.scroller.scrollTop += top - anchor.top;
			}
		} else {
			// Removing a long body can leave the reader above the well. Bring
			// its collapsed form back without disturbing unrelated transcript rows.
			wellRef.current?.scrollIntoView({ block: "nearest" });
		}
	}, [expanded]);

	const toggle = () => {
		const scroller = wellRef.current?.closest<HTMLElement>(
			"[data-lo-canonical-transcript]",
		);
		if (scroller && toggleRef.current) {
			anchorRef.current = {
				scroller,
				top:
					toggleRef.current.getBoundingClientRect().top -
					scroller.getBoundingClientRect().top,
			};
		}
		setExpanded((value) => !value);
	};
	return (
		<div
			id={wellId}
			ref={wellRef}
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
				// `whitespace-pre-wrap` and no horizontal scroll: a diff line is long
				// by nature and a horizontal scrollbar inside a disclosure is a
				// scroll region the reader has to discover, so long lines wrap
				// instead. `break-words` is required alongside it — a pre-wrapped
				// token with no break opportunity overflows the box rather than
				// wrapping.
				// §E5: one treatment for detail, code and diffs - `sunken`, radius
				// 10, no border (design round 1, D9).
				"rounded-md bg-sunken p-3 font-mono text-ink text-mono-sm whitespace-pre-wrap break-words",
				expanded || full
					? // EXPANDED (or paging the full diff): no ceiling and no scroll region of its own. The
						// reader asked for the whole diff, and a 200-line body in a
						// 740px inner scroller is a scroll-inside-a-scroll they have to
						// wheel through twice. The well grows and the transcript
						// scrolls it. `overflow-x-clip` rather than `-hidden` is the
						// load-bearing choice: `hidden` on one axis turns the other
						// axis's `visible` into `auto`, which would make the well a
						// scroll container again — and the `Show less` row's `sticky`
						// would then pin against a box that never scrolls instead of
						// the transcript viewport. `clip` does not create a scroll
						// container (CSS Overflow 3), so the toggle stays reachable at
						// the bottom of the viewport while any of the well is on
						// screen.
						"overflow-x-clip"
					: // COLLAPSED: the ceiling is DERIVED from the default depth
						// rather than picked: a diff at `DIFF_EXPAND_MAX_LINES = 40`
						// shows 40 lines AND the `… N more diff line(s)` toggle under
						// them, which at `text-mono-sm`'s 0.75rem/1.45 metrics is 41 x
						// 17.4px plus the 12px padding on each side. A shorter ceiling
						// hides the toggle that makes the default honest — measured
						// rather than anticipated: at 720px the capped body clipped
						// that row by 17px, so the frame said "40 lines" with nothing
						// saying there were more. The scroll region that remains is for
						// a WRAPPED body (a 560px column turns 40 lines into 80 rows),
						// which is the case it was always for.
						cn(
							"overflow-y-auto overflow-x-hidden",
							// One extra 17.4px row when producer truncation is stated:
							// the footer and toggle must both fit without an inner scroll.
							// A non-archived descriptor states WHY in one more row.
							omitted
								? descriptor && descriptor.state !== "archived"
									? "max-h-[776px]"
									: "max-h-[758px]"
								: "max-h-[740px]",
						),
				className,
			)}
		>
			{full && pageable?.scope ? (
				<DiffHistoryPager
					scope={pageable.scope}
					callId={pageable.callId}
					headerRows={archiveOnly ? undefined : headerRows}
					onBack={() => {
						setFull(false);
						// Back lands on the preview's own top, not wherever the
						// (possibly taller) page left the transcript, and focus
						// returns to the control that opened full mode (U1): the
						// pressed Back button no longer exists.
						requestAnimationFrame(() => {
							wellRef.current?.scrollIntoView({ block: "nearest" });
							viewFullRef.current?.focus({ preventScroll: true });
						});
					}}
				/>
			) : body.withheld ? (
				// One notice instead of the old core's stand-in plus a column of
				// blank rows: the diff it stood for was never stored, so there is
				// nothing to expand and no count worth stating.
				<span className="block text-ink-dim">{diffWithheldLabel()}</span>
			) : (
				body.lines.map((line, index) => (
					// Position is the key because a diff is an ordered record with no
					// identity of its own: the same line text legitimately appears
					// twice (a repeated `+` line), and the list never reorders in
					// place.
					// biome-ignore lint/suspicious/noArrayIndexKey: an immutable ordered record
					<Line key={index} line={line} index={index} />
				))
			)}
			{
				// Producer truncation is independent of display collapse: disclose
				// the missing record even before the reader reveals its stored tail.
				!full &&
					!body.withheld &&
					omitted &&
					(pageable ? (
						/*
						 * The omitted rows WERE archived, so "not recorded" would be
						 * false: the footer becomes the way to them. Same row, same
						 * ceiling as the truncation notice it replaces.
						 */
						<button
							type="button"
							ref={viewFullRef}
							data-diff-view-full=""
							onClick={() => setFull(true)}
							className={TOGGLE}
						>
							<span className="block group-focus-visible/diff-toggle:outline group-focus-visible/diff-toggle:outline-2 group-focus-visible/diff-toggle:outline-accent group-focus-visible/diff-toggle:outline-offset-[-2px]">
								{diffFullViewLabel(
									descriptor?.state === "archived"
										? Math.max(0, descriptor.rows - offerHeaderRows)
										: 0,
								)}
							</span>
						</button>
					) : (
						<>
							{truncatedRows > 0 && (
								// Never "0 more lines": an archive-only row states only
								// its descriptor's reason below.
								<span className="block text-ink-dim">
									{diffTruncatedLabel(truncatedRows)}
								</span>
							)}
							{descriptor && descriptor.state !== "archived" && (
								<span
									data-diff-full-notice={descriptor.state}
									className="block text-ink-dim"
								>
									{diffFullNoticeLabel(descriptor.state)}
								</span>
							)}
						</>
					))
			}
			{!full && body.expandable && !pageable && (
				/*
				 * NOT WHEN THE ARCHIVE IS OFFERED (design round 3, U7): "View full
				 * diff · 505 lines" sat directly above "… 158 more diff lines", two
				 * "more" controls whose counts disagree (41 + 158 ≠ 505) because the
				 * expander only counts the inline preview's own rows. The archive
				 * offer reaches every row, so it is the one way on.
				 *
				 * STICKY, and this is the one thing in the well that must not be
				 * allowed to scroll away. The ceiling above is derived for UNWRAPPED
				 * rows, where the toggle sits inside it by construction; a wrapped
				 * body is the shape that actually reaches the cap, and at a 560px
				 * column the 40 shown long lines are 80 rows — 1415px of content in a
				 * 738px client box, measured — so in the flow the toggle's own row
				 * begins 648.6px BELOW the clip, and the pin has to lift it by 677px
				 * (also this body's maxScroll, `scrollHeight - clientHeight`) to land
				 * it flush at the foot, its box top 709.61px inside the well. The two
				 * distances coincide only because the well's 12px bottom padding is
				 * the pin's own `bottom: -12px` offset. A body that claims completeness
				 * while lines are hidden is the same defect the 720px ceiling had.
				 *
				 * Three classes, each for a measured reason:
				 *
				 * - `sticky -bottom-3` (`bottom: -12px`) pins the row's box to the
				 *   well's inner edge. With plain `bottom-0` it pins 13px higher, at
				 *   the content-box edge, and the next diff row shows through the
				 *   band underneath it — the toggle does not read as the well's foot
				 *   any more.
				 * - `pb-3` gives that pinned row the well's own bottom padding as its
				 *   background, so nothing shows through beneath the text.
				 * - `-mb-3` cancels the same padding in the FLOW, and it is not
				 *   cosmetic: without it the toggle row is 12px taller, which took
				 *   the unwrapped at-cap body from 737px of content in a 738px clip
				 *   (no scroll — the property the ceiling was derived for) to 749 in
				 *   738, i.e. a scroll region at the exact height where there should
				 *   be none.
				 *
				 * In the well's flow rather than hoisted out as a caption under it:
				 * outside the scroller the toggle would have to be counted for
				 * separately in the ceiling, and the ceiling is the well's own.
				 * `bg-sunken` is the well's ground, so the pinned row is not a second
				 * surface. A real `<button>` (not a clickable span) so it is in the
				 * tab order, fires on Enter/Space, and announces its state through
				 * `aria-expanded`/`aria-controls`.
				 */
				<button
					type="button"
					ref={toggleRef}
					aria-expanded={expanded}
					aria-controls={wellId}
					onClick={toggle}
					className={cn(
						TOGGLE,
						"sticky -mb-3 pb-3",
						expanded ? "bottom-0" : "-bottom-3",
					)}
				>
					<span className="block group-focus-visible/diff-toggle:outline group-focus-visible/diff-toggle:outline-2 group-focus-visible/diff-toggle:outline-accent group-focus-visible/diff-toggle:outline-offset-[-2px]">
						{expanded ? diffShowLessLabel() : diffOverflowLabel(body.hidden)}
					</span>
				</button>
			)}
		</div>
	);
};
