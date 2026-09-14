/**
 * The expanded tool detail: ONE pane, one ground, no JSON.
 *
 * The TUI's expansion is a single widget — a labelled block per argument key,
 * then the result body, separated by whitespace (`ToolCard._build_content`,
 * `tui/widgets/tool_card.py`). What this replaced did not read that way: the
 * arguments went through `JSON.stringify(record.args, null, 2)` inside one
 * bordered `<pre>`, the result landed in a second bordered block underneath, and
 * a `write` showed the model's own file content as escaped JSON. Two nested
 * boxes around a machine dump is the opposite of the structure the terminal has
 * had for longer than this app has existed, and it is the operator's report.
 *
 * What the pane keeps from the app it replaces: the ground (`sunken`, the code
 * ground of § 2) and the result's ink (`text-ink` for stdout, `text-danger` for
 * a failure). What it changes is the structure — the boxes collapse to one, the
 * argument keys become labels instead of JSON keys, and a JSON result is
 * structured by the same rules as a JSON argument (`tool-detail-model`).
 *
 * THE BORDER STAYS, and it is not chrome this change forgot to delete. The pane
 * is drawn on the transcript's `canvas` ground, and `canvas`/`sunken` cannot be
 * separated by luminance in the near-black palettes at all — obsidian's canvas
 * is #09090B against a sunken #030307, ΔE00 1.23, and there is no darker value
 * left to move to. That measurement is why `output-block.tsx` and `log-block.tsx`
 * carry `border-hairline`, and `scripts/contrast-contract.mjs` records it. ONE
 * hairline around the whole pane is the neutral form of that edge; the second
 * box the operator reported is what comes off.
 *
 * The SCROLL REGION is the other half of the TUI port, and it keeps the
 * terminal's REPORT. The terminal caps each block at
 * `INPUT_MAX_LINES`/`EXPAND_MAX_LINES` and reports the remainder as
 * "… N more lines", because a fixed grid has nowhere to put the rest; a browser
 * does, so the bound moves to the container and a huge `write` payload stays
 * fully readable by scrolling. What did NOT move with it was the report, and that
 * was a defect rather than a simplification (design round 1, D1): with the cap on
 * the whole pane, a long argument list pushed the `Output` label and the entire
 * result below the pane's own bottom edge — measured at label top y=416 against a
 * pane bottom of 408 — and an ordinary ten-line result was sliced through its own
 * glyphs, with nothing on screen saying more existed. Every committed frame had
 * `scrollHeight == clientHeight`, so no frame could show it. Two things fix that,
 * and both are visible in the frames this change committed:
 *
 * 1. THE CAP IS PER SECTION. The input block and the result each get their own
 *    ceiling, so neither can spend the other's budget: a long argument list
 *    cannot push the result's label out of the pane.
 * 2. THE REMAINDER IS SPELLED. A section whose content does not fit prints
 *    `detailOverflowLabel` under itself — the terminal's own line, in the app's
 *    existing vocabulary for it (`diff-block.tsx` prints the same shape for a
 *    capped diff). It counts what is below the fold RIGHT NOW, so it is true at
 *    rest and stops being shown once the reader has scrolled to the end; a
 *    number that did not move would go on claiming lines the reader had already
 *    read. It sits OUTSIDE the scroller, which is what makes it visible at rest
 *    — macOS paints overlay scrollbars only while scrolling, so the scroll
 *    region's own overflow is otherwise invisible.
 *
 * For the same reason the pane anchors its content to the TOP rather than to
 * the bottom the way `output-block.tsx` does (`flex-col-reverse`): the reader
 * opens the expansion to see the CALL, and a bottom-anchored pane would hide the
 * command in order to show the last line of its output — which the collapsed row
 * already carries as an outcome.
 */

import { cn } from "@shared/lib/utils";
import {
	type FC,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type DetailLine,
	argumentLines,
	detailOverflowLabel,
	resultLines,
} from "./tool-detail-model";

/**
 * One nesting step, in pixels.
 *
 * Two steps of § 5's 4px ramp: nesting is a within-component distinction, and
 * one ramp step is what separates two lines of the same block. The model counts
 * depth in LEVELS and `detailText` prints it in cells; this is the same rule in
 * the one medium the app actually paints.
 */
const NEST_STEP_PX = 8;

/**
 * How much of EACH section the pane shows before it reports the remainder.
 *
 * A shared ceiling rather than two tuned ones, because the two halves of a call
 * are the same kind of thing and a reader should not have to learn two budgets.
 * 240px is ~13 argument lines at `text-mono-sm`'s 17.4px line box plus the
 * block's 4px row gap: taller than any ordinary call's arguments (the panes this
 * replaced measured 129-223px for their whole content), short enough that a
 * `write` carrying a whole file cannot push the result's label off the screen.
 *
 * It is spent as a LITERAL Tailwind class below rather than interpolated from a
 * constant, because Tailwind compiles the utilities it can SEE in the source: a
 * `max-h-[${n}px]` template is simply not one of them. The number lives here so
 * there is one place to read it, and in `SECTION_MAX` so the two cannot drift.
 */
const SECTION_MAX = "max-h-[240px]";

export type ToolDetailProps = {
	/** The call's arguments, or `null` when the row has none to show. */
	args: Record<string, unknown> | null;
	/** The result text, or `null` when the call has not returned one. */
	output: string | null;
	/** The call failed, so its result is ink`danger` and labelled `Error`. */
	isError: boolean;
};

/**
 * One `key: value` line.
 *
 * The label and the value are two spans in ONE flowing paragraph, which is the
 * TUI's rule ported rather than restated: `_append_input_body` wraps the key
 * WITH its value instead of printing the key and clipping the value beside it.
 * There the clip silently deleted the middle of the first row — a 100-column
 * `pytest … -k expansion --maxfail=1` rendered as `-k expa… --maxfail=1`, which
 * is not a shortened command but a different one. Here the same rule is the
 * absence of `truncate`: the value wraps under its own label, so the reader sees
 * all of it, and nothing depends on a measured budget that could disagree with
 * the render at another zoom.
 */
const DetailLineRow: FC<{ line: DetailLine }> = ({ line }) => (
	<div
		className={cn("whitespace-pre-wrap break-words")}
		style={{ paddingInlineStart: (line.depth - 1) * NEST_STEP_PX }}
	>
		{line.key ? <span className={cn("text-ink-dim")}>{line.key}: </span> : null}
		<span className={cn("text-ink-muted")}>{line.value}</span>
	</div>
);

/** A run of detail lines, in the pane's own vertical rhythm. */
const DetailLines: FC<{ lines: readonly DetailLine[]; label: string }> = ({
	lines,
	label,
}) => (
	<div className={cn("flex flex-col gap-1")} data-detail-lines={label}>
		{lines.map((line, index) => (
			// The dotted path is unique for every REAL wire payload, but not by
			// construction: an argument key that itself contains a dot (`{"a.b": 1}`
			// beside `{a: {b: 2}}`) collides with its own subtree's path. The list is
			// rebuilt whole on every render and never reordered, so position is the
			// identity that cannot collide — the same bargain `diff-block.tsx` makes.
			// biome-ignore lint/suspicious/noArrayIndexKey: an immutable ordered record
			<DetailLineRow key={index} line={line} />
		))}
	</div>
);

/**
 * How many rows of a scroll region sit below its visible box, right now.
 *
 * GEOMETRY rather than a line cap, because the section is a real scroll region
 * and the number has to stay true while the reader scrolls: a count of the lines
 * a cap hid would go on claiming rows the reader had already read. Two things
 * come out of the same arithmetic — the content's own row PITCH (`line-height`
 * plus `row-gap`, which is 4px for a block of argument lines and 0 for the
 * `<pre>` a raw result prints in) and how far the content extends past the box's
 * bottom edge.
 *
 * The CONTENT is what the observer watches rather than the box: `max-h` fixes
 * the box's height, so a result streaming into an open pane grows the content and
 * resizes nothing the box itself could report.
 */
function useRowsBelowFold(ref: RefObject<HTMLDivElement | null>): number {
	const [rows, setRows] = useState(0);
	// Deliberately no dependency array: the content is rebuilt on every render of
	// an open row, and the effect is a couple of style reads and one subtraction.
	// `setRows` with an unchanged value is a no-op in React, so it cannot loop.
	useLayoutEffect(() => {
		const box = ref.current;
		if (!box) return;
		const content = box.firstElementChild as HTMLElement | null;
		const measure = () => {
			const computed = content ? getComputedStyle(content) : null;
			// `row-gap` is `normal` on a `<pre>`, which parses to NaN and reads as 0.
			const line = Number.parseFloat(computed?.lineHeight ?? "");
			const gap = Number.parseFloat(computed?.rowGap ?? "");
			const pitch =
				(Number.isFinite(line) ? line : 0) + (Number.isFinite(gap) ? gap : 0);
			const below = box.scrollHeight - box.scrollTop - box.clientHeight;
			setRows(pitch > 0 && below > 0 ? Math.ceil(below / pitch) : 0);
		};
		measure();
		box.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(content ?? box);
		return () => {
			box.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	});
	return rows;
}

/**
 * The line under a capped section that says how much of it is still below.
 *
 * OUTSIDE the scroller, which is the whole point: it has to be visible while the
 * reader is at rest, and a pinned row inside the region would be the reader's
 * own scroll position deciding whether the pane admits to holding more.
 */
const Remainder: FC<{ rows: number }> = ({ rows }) =>
	rows > 0 ? (
		<span className={cn("mt-1 block text-ink-dim")}>
			{detailOverflowLabel(rows)}
		</span>
	) : null;

export const ToolDetail: FC<ToolDetailProps> = ({ args, output, isError }) => {
	const input = argumentLines(args);
	const structured = resultLines(output);
	const inputRef = useRef<HTMLDivElement>(null);
	const outputRef = useRef<HTMLDivElement>(null);
	const inputHidden = useRowsBelowFold(inputRef);
	const outputHidden = useRowsBelowFold(outputRef);

	/*
	 * Nothing to paint, so nothing is painted.
	 *
	 * `hasDetail` is the CHEAP gate and this is the exact one, and they agree on
	 * every input the pane can be handed — but the gate is bounded, and where its
	 * bound runs out it answers optimistically. The reader must never pay for that
	 * with a bordered, padded, empty `sunken` box, which is what QA's Q-2
	 * photographed, so the pane refuses to draw one whatever it was asked.
	 */
	if (input.length === 0 && !output) return null;

	return (
		<div
			className={cn(
				"w-full rounded-sm border border-hairline bg-sunken p-3 font-mono text-mono-sm",
			)}
		>
			{input.length > 0 && (
				<div data-detail-section="input">
					<div ref={inputRef} className={cn(SECTION_MAX, "overflow-auto")}>
						<DetailLines lines={input} label="input" />
					</div>
					<Remainder rows={inputHidden} />
				</div>
			)}
			{output && (
				// The section SEPARATOR is its label plus air, which is the TUI's own
				// idiom and the reason the label survives at all: without it the
				// result's first line reads as one more argument ("exit code: 0" under
				// "command: …"), which is the one ambiguity two boxes did solve. It is
				// also the fact design round 1 measured as missing: the label is the
				// thing a capped input block used to push off the pane.
				<div
					className={cn(input.length > 0 && "mt-3")}
					data-detail-section="output"
				>
					<span
						className={cn(
							"mb-1 block text-meta",
							isError ? "text-danger" : "text-ink-dim",
						)}
					>
						{isError ? "Error" : "Output"}
					</span>
					<div ref={outputRef} className={cn(SECTION_MAX, "overflow-auto")}>
						{structured ? (
							<DetailLines lines={structured} label="result-json" />
						) : (
							// Verbatim, and deliberately NOT wrapped: `whitespace-pre` keeps a
							// shell result's own columns intact, which is the TUI's rule for an
							// output body too ("one output line is one row … never reflows").
							// The section scrolls sideways instead of reflowing a table.
							<pre
								className={cn(
									"whitespace-pre font-mono",
									isError ? "text-danger" : "text-ink",
								)}
							>
								{output}
							</pre>
						)}
					</div>
					<Remainder rows={outputHidden} />
				</div>
			)}
		</div>
	);
};
