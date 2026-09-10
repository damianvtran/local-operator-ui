/**
 * The tool row: the TUI's dense ledger line, in the app's own medium.
 *
 * The TUI paints one fixed-column row per tool call —
 * `<glyph> <name padded> <summary> … <+N> <-M> <outcome> <duration>` — and the
 * reason it reads well is not that it is a terminal. It is that every fact sits
 * in the same place on every row, so a run of twenty calls is scanned by
 * position rather than parsed by reading. That property is what this ports.
 *
 * What deliberately does NOT port is the emulation. The TUI measures in cells
 * because that is the only unit it has; a browser has proportional text, real
 * column layout and a hover ground, so the columns here are `grid` tracks and
 * the hover state is a colour step rather than a repainted row. The result is
 * the same ledger with none of the pretend-terminal chrome — which is exactly
 * the operator's "without the borderless chrome but more tightly packed".
 *
 * Layout, left to right:
 *
 *   [glyph] [name, shared column] [summary, flexes] [+N] [-M] [outcome] [dur]
 *
 * - The NAME column is shared across every visible row and sized by the longest
 *   name on screen between an 8ch floor and a 24ch ceiling (`toolNameColumn`),
 *   so names stack into one edge and every summary starts on one rail. It is
 *   `ch` rather than `px` because the column holds monospace identifiers and
 *   `ch` is that font's own unit — the width then tracks the type scale instead
 *   of drifting away from it at another zoom.
 * - The DURATION slot is fixed at 5ch, right-aligned, so the outcome glyph
 *   lands on the same x whether a call took `0.4s` or `12.3s`. That single
 *   column of ticks down the left of the durations is most of what makes the
 *   ledger scannable, and it is why the slot is reserved even when a replayed
 *   row has no duration to put in it.
 * - The SHED order under pressure is the TUI's: diff counters go first, then
 *   the summary truncates, and the name column shrinks last. "How a write went
 *   is core, how much it wrote is meta" — so the outcome column always
 *   survives. Here the first two rungs are `min-w-0` plus `truncate` on the
 *   summary and a container query that drops the counters on a narrow row,
 *   rather than arithmetic, because the browser already measures.
 *
 * Colour is by ROLE and each state's ground is a lightness step, never a
 * border: running is `elevated`, failed is `danger-wash`, settled is the
 * surface it sits on, hover is `elevated`. The duration stays `ink-dim` in
 * every state — `✓ 0.4s` is not all-green — and the outcome is carried by the
 * glyph's SHAPE so it survives with no colour at all.
 *
 * The row keeps the app's one disclosure idiom (`Disclosure`, § 7): the whole
 * line is the trigger, it is a focus stop, and the detail is closed by default.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";
import {
	ErrorGlyph,
	InterruptedGlyph,
	SuccessGlyph,
	toolIcon,
} from "./tool-glyphs";
import {
	TOOL_NAME_COL_MIN,
	type ToolCategory,
	displayName,
	formatDuration,
	formatSettledDuration,
	toolCategory,
} from "./tool-row-model";

export type ToolRowOutcome = "running" | "success" | "error" | "interrupted";

export type ToolRowProps = {
	/** Wire name. Drives the glyph and the category ink; displayed via `displayName`. */
	toolName: string;
	/** Pre-derived argument summary (`summaryFromArgs`). */
	summary: string;
	outcome: ToolRowOutcome;
	/**
	 * Seconds. A RUNNING row shows this as a live integer clock; a settled row
	 * shows the tenth-of-a-second format under ten seconds. `null` on a settled
	 * row is a replay whose duration the transcript did not keep — the slot stays
	 * reserved and empty rather than claiming zero.
	 */
	durationS: number | null;
	/** Lines added, when the call reported a diff. Zero renders nothing. */
	added?: number;
	/** Lines removed, when the call reported a diff. Zero renders nothing. */
	removed?: number;
	/**
	 * The shared name-column width in characters, owned by the LIST because it
	 * is a property of what is on screen rather than of one row.
	 */
	nameColumn?: number;
	/** Detail behind the row's disclosure. Absent makes the row static. */
	details?: ReactNode;
	/** Open the disclosure initially (stories and measurement surfaces). */
	defaultOpen?: boolean;
	/** Extra classes on the row. */
	className?: string;
	/** Rendered under the row, inside its ground: tool-result screenshots. */
	media?: ReactNode;
};

/**
 * Settled name ink by category, mirroring `_TOOL_CATEGORY`'s five bindings.
 *
 * Liveness outranks identity: a running row never shows a category hue, which
 * is why this map is consulted only in the settled branch. The mapping is
 * intent-preserving rather than hex-preserving — the TUI's `signal` blue is the
 * app's `info`, its `label` violet is the accent, and its two `muted`
 * categories are `ink-muted` — because the app has twelve palettes and the TUI
 * has one, so what ports is which categories are SEPARATE, not what colour each
 * one was in the dark theme.
 */
const CATEGORY_INK: Record<ToolCategory, string> = {
	read: "text-info",
	mutate: "text-ink-muted",
	exec: "text-ink-muted",
	meta: "text-accent",
	plain: "text-ink-muted",
};

/**
 * The diff counters.
 *
 * Never `+0` or `-0`: a zero states that nothing was added, which is a
 * different claim from "the count is unknown", and the rows carrying no counts
 * are the second kind. `tabular-nums` so a column of counters stays a column.
 *
 * `@[34rem]/toolrow:flex` is the shed: on a narrow row the counters are hidden
 * and everything else survives, which is the TUI's own first rung ("how a write
 * went is core, how much it wrote is meta"). It is a CONTAINER query, not a
 * viewport one, because the transcript narrows with the canvas open while the
 * window does not.
 */
const DiffCounters = ({
	added,
	removed,
}: {
	added: number;
	removed: number;
}) => {
	if (added <= 0 && removed <= 0) return null;
	return (
		<span
			className={cn(
				"hidden shrink-0 gap-1 font-mono text-mono-sm tabular-nums @[34rem]/toolrow:flex",
			)}
		>
			{added > 0 && <span className={cn("text-success")}>+{added}</span>}
			{removed > 0 && <span className={cn("text-danger")}>-{removed}</span>}
		</span>
	);
};

/**
 * The outcome + duration cluster, the right edge of every row.
 *
 * The duration slot is `w-[5ch]` and right-aligned in EVERY state including the
 * empty one, which is the whole reason the glyphs line up. A running row
 * occupies the glyph slot with a reserved empty box rather than closing up:
 * closing up would slide the clock sideways at the instant the call settles,
 * and a column that moves when nothing conceptually moved reads as
 * misalignment.
 */
const StatusCluster = ({
	outcome,
	durationS,
}: {
	outcome: ToolRowOutcome;
	durationS: number | null;
}) => {
	const running = outcome === "running";
	const Glyph =
		outcome === "success"
			? SuccessGlyph
			: outcome === "error"
				? ErrorGlyph
				: outcome === "interrupted"
					? InterruptedGlyph
					: null;
	const glyphInk =
		outcome === "success"
			? "text-success"
			: outcome === "error"
				? "text-danger"
				: // `interrupted` is deliberately hueless: a stop is not a failure,
					// and giving it danger ink would report the user's own interrupt as
					// something that went wrong.
					"text-ink-dim";
	const text = running
		? formatDuration(durationS ?? 0)
		: formatSettledDuration(durationS);
	return (
		<span className={cn("flex shrink-0 items-center gap-1.5")}>
			<span className={cn("flex size-3.5 shrink-0 [&_svg]:size-3.5", glyphInk)}>
				{Glyph ? <Glyph aria-hidden={true} /> : null}
			</span>
			<span
				className={cn(
					"w-[5ch] text-right font-mono text-ink-dim text-mono-sm tabular-nums",
				)}
			>
				{text}
			</span>
		</span>
	);
};

export const ToolRow = ({
	toolName,
	summary,
	outcome,
	durationS,
	added = 0,
	removed = 0,
	nameColumn = TOOL_NAME_COL_MIN,
	details,
	defaultOpen = false,
	className,
	media,
}: ToolRowProps) => {
	const running = outcome === "running";
	const failed = outcome === "error";
	const Icon = toolIcon(toolName);
	const name = displayName(toolName);

	const row = (
		<span className={cn("flex min-w-0 flex-1 items-center gap-2")}>
			<span
				aria-hidden={true}
				className={cn(
					"flex size-3.5 shrink-0 [&_svg]:size-3.5",
					// Liveness is the accent on the glyph plus the raised ground: a
					// still frame has to read "live" without motion (D26).
					running ? "text-accent" : failed ? "text-danger" : "text-ink-dim",
				)}
			>
				<Icon />
			</span>
			<span
				className={cn(
					"shrink-0 truncate font-mono text-mono-sm",
					running
						? "text-ink"
						: failed
							? "text-danger"
							: CATEGORY_INK[toolCategory(toolName)],
				)}
				// The shared column is a per-list measurement, so it cannot be a
				// static class: Tailwind compiles the utilities it can see in the
				// source, and `w-[${n}ch]` is not one of them.
				style={{ width: `${nameColumn}ch` }}
				title={name}
			>
				{name}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate font-mono text-mono-sm",
					running ? "text-ink-muted" : "text-ink-dim",
				)}
			>
				{/*
				 * A summary identical to the name beside it is dropped.
				 *
				 * The TUI's `_summary_from_args` falls back to the tool's own name
				 * when no argument is summarisable, and there it is nearly
				 * invisible: the name column is 8 cells, so `list_variables` is
				 * truncated to `list_var` and the summary is the only place the
				 * full name appears. This column GROWS to the longest visible name,
				 * which turns that same fallback into `list_variables
				 * list_variables` — the exact stutter the fallback exists to avoid.
				 *
				 * Dropping it preserves the rule's INTENT (the summary carries what
				 * the name does not) rather than its literal output, which is the
				 * only sense in which a port to a different measure can be faithful.
				 */}
				{summary === name ? "" : summary}
			</span>
			<DiffCounters added={added} removed={removed} />
			<StatusCluster outcome={outcome} durationS={durationS} />
		</span>
	);

	// The state ground, applied to the row box rather than to a card: § 2's
	// elevation-is-a-lightness-step, and the TUI's own `.tool-running` /
	// `.tool-error` rules, which set a background and never a border.
	const ground = running
		? "bg-elevated"
		: failed
			? "bg-danger-wash"
			: "hover:bg-elevated";

	// `Disclosure`'s disabled branch deliberately refuses `triggerClassName` — a
	// hover response on something that does not answer a click is a lie — so a
	// static row takes its ground on the wrapper instead. The ground is the
	// row's STATE, not its affordance, and a running row that printed nothing
	// yet still has to read as running.
	const body = details ? (
		<Disclosure
			summary={row}
			chevron="leading"
			defaultOpen={defaultOpen}
			className={cn("@container/toolrow", className)}
			// The whole row is the target, so it takes a row-shaped ground that
			// bleeds 8px past the text on both sides while the text stays on the
			// rail — the same idiom `TraceLine` uses, and the one a list row has in
			// Warp, Zed and VS Code.
			triggerClassName={cn("-mx-2 rounded-sm px-2", ground)}
		>
			{details}
		</Disclosure>
	) : (
		<Disclosure
			disabled
			summary={row}
			className={cn(
				"@container/toolrow",
				(running || failed) && cn("-mx-2 rounded-sm px-2", ground),
				className,
			)}
		/>
	);

	if (!media) return body;
	// Tool-result screenshots sit UNDER the settled row and inside its ground,
	// which is where the TUI mounts them (`session_presentation.py:846-848`).
	return (
		<div className={cn("flex flex-col")}>
			{body}
			{media}
		</div>
	);
};
