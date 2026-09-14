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
 * The SCROLL REGION is the other half of the TUI port. The terminal caps each
 * block at `INPUT_MAX_LINES`/`EXPAND_MAX_LINES` and reports the remainder as
 * "… N more lines", because a fixed grid has nowhere to put the rest. A browser
 * does, so the bound moves to the container and nothing is truncated: a huge
 * `write` payload or a long `bash` result stays fully readable by scrolling.
 * For the same reason the pane anchors its content to the TOP rather than to
 * the bottom the way `output-block.tsx` does (`flex-col-reverse`): the reader
 * opens the expansion to see the CALL, and a bottom-anchored pane would hide the
 * command in order to show the last line of its output — which the collapsed row
 * already carries as an outcome.
 */

import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import {
	type DetailLine,
	argumentLines,
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

export const ToolDetail: FC<ToolDetailProps> = ({ args, output, isError }) => {
	const input = argumentLines(args);
	const structured = resultLines(output);
	return (
		<div
			className={cn(
				"max-h-[300px] w-full overflow-auto rounded-sm border border-hairline bg-sunken p-3 font-mono text-mono-sm",
			)}
		>
			{input.length > 0 && <DetailLines lines={input} label="input" />}
			{output && (
				// The section SEPARATOR is its label plus air, which is the TUI's own
				// idiom and the reason the label survives at all: without it the
				// result's first line reads as one more argument ("exit code: 0" under
				// "command: …"), which is the one ambiguity two boxes did solve.
				<div className={cn(input.length > 0 && "mt-3")}>
					<span
						className={cn(
							"mb-1 block text-meta",
							isError ? "text-danger" : "text-ink-dim",
						)}
					>
						{isError ? "Error" : "Output"}
					</span>
					{structured ? (
						<DetailLines lines={structured} label="result-json" />
					) : (
						// Verbatim, and deliberately NOT wrapped: `whitespace-pre` keeps a
						// shell result's own columns intact, which is the TUI's rule for an
						// output body too ("one output line is one row … never reflows").
						// The pane scrolls sideways instead of reflowing a table.
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
			)}
		</div>
	);
};
