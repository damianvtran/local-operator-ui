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
 * border: running is `elevated`, a settled failure is `danger-wash`, settled is
 * the surface it sits on, hover is `elevated`. Identity is HUELESS and only the
 * state takes a hue — the tool glyph and the name read one expression
 * (`rowInk`), which is why they cannot disagree. The duration stays `ink-dim` in
 * every state — `✓ 0.4s` is not all-green — and the outcome is carried by the
 * glyph's SHAPE so it survives with no colour at all.
 *
 * The row keeps the app's one disclosure idiom (`Disclosure`, § 7): the whole
 * line is the trigger, it is a focus stop, and the detail is closed by default.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useEffect, useState } from "react";
import {
	ErrorGlyph,
	InterruptedGlyph,
	SuccessGlyph,
	toolIcon,
} from "./tool-glyphs";
import {
	TOOL_NAME_COL_MIN,
	displayName,
	formatDuration,
	formatSettledDuration,
	isBareToolName,
} from "./tool-row-model";

export type ToolRowOutcome =
	| "running"
	| "success"
	| "error"
	| "interrupted"
	/**
	 * A RECEIPT: a ledger row that reports an event rather than a call — an
	 * inbound peer message, a wake delivery.
	 *
	 * It exists because the two alternatives are both wrong. A receipt has no
	 * outcome to report, so `success` would paint a tick on a peer's words — a
	 * claim that something was accomplished — and the empty status column alone
	 * would read as "still running" (that is the whole reason a running row's
	 * column is empty). Naming the state is what keeps those three apart, and it
	 * costs nothing on screen: like `running`, it draws no glyph and no duration,
	 * and the slot stays reserved so a receipt in a run of calls does not move the
	 * column. The TUI's receipt blocks draw neither either
	 * (`PeerMessageBlock._build_row`, `WakeBlock._build_row`).
	 */
	| "receipt"
	/**
	 * A call the harness announced and then NEVER RAN (`ToolCallComposeEvent.
	 * not_run_reason`): parked at planning on invalid arguments or an unknown
	 * tool, or skipped by steering.
	 *
	 * A state of its own rather than `error`, because it is not a result. The
	 * call returned nothing, so `error` would claim a tool reported a failure,
	 * and `interrupted` would blame a stop that never happened. What the row has
	 * instead is the harness's own verdict, which the caller renders as the row's
	 * body, and a record of how far the model got before it was told nothing
	 * would receive the call.
	 *
	 * It wears the error ink on the glyph and the summary, and the cross glyph, which
	 * is the TUI's treatment (`ToolCard.mark_not_run` settles the card into the
	 * `tool-error` class: `never sent · N composed` under the harness's reason) — a
	 * cross says the call did not succeed, which is true, and the LABEL is what
	 * keeps it apart from a failure: the row's summary reads `never sent`, never
	 * `failed`, and its accessible label is "never ran".
	 *
	 * ONE CHANNEL DELIBERATELY DOES NOT FOLLOW, and it is the region one: the
	 * `bg-danger-wash` ground is gated on the `error` outcome alone
	 * (`failed = outcome === "error"`), because it marks a call that returned a
	 * FAILED RESULT — this row returned no result at all, which is the whole
	 * state. So a reader gets the same words, status glyph and name ink as a
	 * failure, on the plain surface, and no wash claiming a result that does not
	 * exist.
	 *
	 * THE INK IS NOT PART OF THAT DISTINCTION, and it is worth being exact about
	 * because it used to be: the tool ICON took `ink-dim` here while the NAME took
	 * `danger`, which is the glyph/name disagreement the colour pass fixed. Both
	 * now read one expression (`rowInk`), so this row is `danger` on the name and
	 * on the tool glyph and hueless on neither.
	 *
	 * SCOPE OF THAT DISTINCTION, because it is on the LIVE path only. A row read
	 * back from the durable transcript is the harness's record of a call it did
	 * send and that came back an error — the never-run verdicts settle a row the
	 * composing surface announced and leave no mark on the durable row — so such a
	 * row is not this state and must not be dressed as one: it wears the failure
	 * treatment identifier-for-identifier against the comparison surface
	 * (`chat-tool-rows/states`), which is exactly right for a call that really
	 * failed.
	 *
	 * The TURN-DEATH ending also lands here, one glyph away: a row still being
	 * dictated or waiting to run when the turn ended was never sent either, and
	 * only a verdict gives it a reason, so a death with no verdict has no body and
	 * keeps the interrupt's own state instead (see `neverSent`).
	 */
	| "not-run";

/**
 * The ledger row's own height, overriding the shared disclosure default.
 *
 * `Disclosure`'s `ROW` is `min-h-6 py-0.5`, which is right for a disclosure
 * sitting alone but wrong for a run of forty. The text occupies 17.4px, so the
 * default spends 6.6px per row on chrome, and over a transcript that is the
 * difference between 32 and 44 rows on a 900px screen.
 *
 * The 28px pitch this replaced had TWO contributors, and the distinction
 * matters because they live in different files. The box is `border-box`, so
 * `min-h-6` (24px) dominates `py-0.5` rather than adding to it and the old row
 * measured 24px, not 28px; the other 4px was the old `trace` gap (`mt-1`) that
 * `transcript-rows.ts` puts BETWEEN adjacent ledger rows. The fix cut both —
 * row 24→20 here, trace gap 4→0 there — and the gap then came back to 2px,
 * because a run at zero read as one fused column with no boundary between
 * consecutive calls. So THIS constant is the row's height and not the pitch:
 * a run measures `N × 20px + (N-1) × 2px`, and a reader chasing the spacing
 * model needs `transcript-rows.ts`'s `GAP` as well as this constant. Changing
 * one without reading the other is how the two drift.
 *
 * The TUI reference the operator sent measures ~20.4px per line, and the
 * designer rendered the same four rows at 28px and at this height: at 28 they
 * float as separate items, here they cohere into a block the eye runs down.
 * Density is the substance of "more tightly packed", not a finish detail.
 *
 * Read that comparison as 28 against the shipped 22 — this 20px box plus the
 * hairline — NOT as an endorsement of a 20px pitch. A 20px pitch is the
 * gap-at-zero state the tier has since moved off, because a run with no gap at
 * all fused into one column; a designer who reads this paragraph as "20 is the
 * cohering pitch" would be reading the argument for the row's HEIGHT as an
 * argument about the distance between rows, which is the confusion the
 * paragraph above exists to prevent.
 *
 * 20px with no padding: `min-h-5` clears the 17.4px text box by 2.6px, so the
 * line still has air around it and nothing clips at any theme's type scale —
 * the scales are identical across the set, since colour is the only thing a
 * palette supplies. Scoped to this row type through `rowClassName` — `min-h-6`
 * remains the app-wide idiom and other disclosure consumers keep it.
 */
const ROW_HEIGHT = "min-h-5 py-0";

export type ToolRowProps = {
	/** Wire name. Drives the glyph and the category ink; displayed via `displayName`. */
	toolName: string;
	/** Pre-derived argument summary (`summaryFromArgs`). */
	summary: string;
	/**
	 * What to show when `summary` turns out to be nothing but the tool's name.
	 *
	 * That case is dropped as a stutter (see the summary column below), which
	 * leaves the object column — the row's whole identity — empty. The caller
	 * knows facts this component does not, so it supplies the stand-in rather
	 * than this reaching for one: today the output's first line.
	 */
	summaryFallback?: string | null;
	outcome: ToolRowOutcome;
	/**
	 * Seconds. A settled row shows the tenth-of-a-second format under ten
	 * seconds. `null` on a settled row is a replay whose duration the transcript
	 * did not keep — the slot stays reserved and empty rather than claiming zero.
	 *
	 * A RUNNING row does not have this yet (the backend only reports a duration
	 * on `tool_execution_end`); it counts from `startedAt` instead.
	 */
	durationS: number | null;
	/**
	 * Wall-clock ms the call began executing, for a running row's own clock.
	 *
	 * A running row cannot get its elapsed time from `durationS`, which stays
	 * `null` until the call ends — so without this the row rendered `0s` for its
	 * whole life and a four-minute `bash` was indistinguishable from an instant
	 * one. The spec makes this number load-bearing: the empty status column says
	 * "still running" and the ticking clock says for how long.
	 */
	startedAt?: number | null;
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
 * The ink a row takes, for its NAME and for its TOOL GLYPH — one expression, so
 * the two can never disagree.
 *
 * They used to be two: the glyph read `running ? accent : failed ? danger :
 * ink-dim` while the name read a five-entry category map, which is what shipped
 * `task`/`hub`/`todo` with an accent name beside a grey glyph and answered
 * "the icon is not colored but the tool name is colored".
 *
 * ## Identity is HUELESS; state is the only colour in the column
 *
 * Every settled row takes ONE ink, whatever its category (`read`/`mutate`/
 * `exec`/`meta`/`plain` and the `plain` fallback alike). Category is carried by
 * the tool glyph's SHAPE, which already differs per category and is documented
 * in `tool-glyphs.ts` as the thing that ports; colour was a second, partial copy
 * of it. The map this replaces spent two hues that mean something else elsewhere
 * — `info` ("here is a fact", on six other sites) and `accent` (this row's own
 * LIVENESS ink, three lines below) — and it did not even carry emphasis: on 26
 * of 41 dark themes the `read` name and on 30 of 41 the `meta` name measure LESS
 * contrast on `canvas` than the hueless ones they sat beside.
 *
 * So the swap is a trade of `accent`/`info`/`ink-dim` for one hueless identity
 * ink, and the state keeps `accent` (running), `danger` (failed, and `not-run`,
 * whose call did not happen either) and `ink-dim` (interrupted is deliberately
 * hueless — a stop is not a failure, and the summary states the distinction:
 * `never sent`, not `failed`).
 *
 * A RECEIPT needs no branch: it is settled, so it takes the identity ink, which
 * is what it already chose for itself. `wake` is a `meta` tool, and the retired
 * table bought the wake RECEIPT the accent — the palette's LIVENESS colour —
 * making one receipt louder than the calls around it.
 *
 * ## The rule a new tool follows
 *
 * A new tool needs one entry in `TOOL_ICONS` and nothing else: it settles to
 * this ink like every other row and gets no colour. There is no category-to-hue
 * table left to extend, and no way for a new tool to be the one row that looks
 * different. A new STATE is the only change that touches colour, and that is a
 * deliberate edit to `ToolRowOutcome`.
 */
const rowInk = (outcome: ToolRowOutcome): string => {
	if (outcome === "running") return "text-accent";
	if (outcome === "error" || outcome === "not-run") return "text-danger";
	/*
	 * `interrupted` and every settled success take the identity ink, and that is
	 * a DECISION rather than a default (design round 1, D6: an interrupted call
	 * is the only outcome with no colour of its own). Three reasons, and the
	 * first is the one that decides it:
	 *
	 *  - the ink is the row's IDENTITY channel and the glyph is its STATE one.
	 *    `interrupted` HAS its own glyph (the slashed circle) and its own
	 *    duration, so it is already distinguished from a settled receipt without
	 *    a tint; spending an ink here would put a third colour meaning "neither
	 *    running nor failed" on a channel whose whole job is to be the same on
	 *    every row of a tool.
	 *  - a fourth ink would have to come from a role the palette has, and the
	 *    only ones left are `ink-dim` (too quiet: it is the metadata register)
	 *    and `warning` (a judgement about the interrupt, which the row does not
	 *    have - an interrupt is often the user's own Escape).
	 *  - the fleet cost is real: the trace is the densest surface in the app, and
	 *    every extra colour there is one more thing that has to hold a floor on
	 *    all 59 palettes for a state the glyph already carries.
	 *
	 * Recorded because "no colour" and "settled" are otherwise the same signal,
	 * and a later round should meet the reasoning rather than the silence.
	 */
	return "text-ink-muted";
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
 * What the outcome glyph says in words, for assistive tech.
 *
 * `interrupted` is "interrupted" rather than "failed" for the same reason its
 * glyph is hueless: the user stopped it, and reporting that as a failure blames
 * the agent for the user's own decision.
 */
const OUTCOME_LABEL: Record<ToolRowOutcome, string> = {
	running: "",
	success: "succeeded",
	error: "failed",
	interrupted: "interrupted",
	// NOT "failed": the call produced no result to fail, and the harness's own
	// verdict names what stopped it before it was sent to a tool. Announced
	// rather than silent for the same reason `error` is: it is a settled outcome
	// the row is the only carrier of, and a reader who cannot see the glyph would
	// otherwise hear only the size.
	"not-run": "never ran",
	// Nothing to report: a receipt is not an action, so it has no outcome to
	// announce. Silence here is not the running row's silence — that one is
	// covered by the working line, which names the running phase in turn.
	receipt: "",
};

/** The row's clock ticks at 1Hz because it shows whole seconds (`CLOCK_INTERVAL_S`). */
const ROW_CLOCK_MS = 1000;

/**
 * Seconds elapsed since `startedAt`, re-rendered once a second; `null` when the
 * row is not running.
 *
 * The interval exists only while a row is actually running, so a settled
 * transcript of forty rows holds zero timers — which is why this is scoped to
 * `StatusCluster` rather than hoisted to the transcript: the common case is
 * that nothing is running, and one shared ticker would repaint every memoised
 * row each second to move one number.
 *
 * Seeded synchronously rather than at the first tick so a row that mounts into
 * an already-running call (a reconnect, or scrolling it back into view) shows
 * the true elapsed time immediately instead of restarting at `0s`.
 */
function useRunningElapsed(startedAt: number | null): number | null {
	const [elapsed, setElapsed] = useState<number | null>(() =>
		startedAt === null ? null : Math.max(0, (Date.now() - startedAt) / 1000),
	);
	useEffect(() => {
		if (startedAt === null) {
			setElapsed(null);
			return;
		}
		const read = () => setElapsed(Math.max(0, (Date.now() - startedAt) / 1000));
		read();
		const timer = window.setInterval(read, ROW_CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [startedAt]);
	return elapsed;
}

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
	startedAt,
}: {
	outcome: ToolRowOutcome;
	durationS: number | null;
	startedAt?: number | null;
}) => {
	const running = outcome === "running";
	const elapsed = useRunningElapsed(running ? (startedAt ?? null) : null);
	const Glyph =
		outcome === "success"
			? SuccessGlyph
			: outcome === "error" || outcome === "not-run"
				? // The cross is the TUI's mark for this settlement (`mark_not_run`
					// puts the card in the error class). Shape is the primary channel, so
					// the DISTINCTION from a tool failure rides the summary and the
					// accessible label rather than a second invented glyph — the three
					// outcome glyphs are a contract, and a fourth would weaken it.
					ErrorGlyph
				: outcome === "interrupted"
					? InterruptedGlyph
					: null;
	const glyphInk =
		outcome === "success"
			? "text-success"
			: outcome === "error" || outcome === "not-run"
				? "text-danger"
				: // `interrupted` is deliberately hueless: a stop is not a failure,
					// and giving it danger ink would report the user's own interrupt as
					// something that went wrong.
					"text-ink-dim";
	/*
	 * The status column of a RUNNING row, which is either its own clock or
	 * NOTHING AT ALL.
	 *
	 * A composing row passes `startedAt: null` because nothing has run yet — the
	 * model is still dictating the arguments — and this used to fall through to
	 * `?? 0`, painting `0s` on the one row that is demonstrably doing something.
	 * The TUI refuses to paint an execution time for that state at all
	 * (`tool_card.py:2503-2507`: "Nothing has RUN, so there is no execution time
	 * to report") and keeps the dictation clock in the summary beside the byte
	 * count. The app keeps the phase age on the working line instead, so the slot
	 * here stays RESERVED and empty: the column still holds, and the row no longer
	 * claims a call took no time to compose itself.
	 */
	const text = running
		? startedAt == null
			? ""
			: formatDuration(elapsed ?? 0)
		: formatSettledDuration(durationS);
	return (
		<span className={cn("flex shrink-0 items-center gap-1.5")}>
			<span className={cn("flex size-3.5 shrink-0 [&_svg]:size-3.5", glyphInk)}>
				{Glyph ? <Glyph aria-hidden={true} /> : null}
				{/*
				 * The outcome in words, for a reader who cannot see the glyph.
				 *
				 * The mark itself is `aria-hidden` — it is decorative to assistive
				 * tech — so without this a row announced its name, summary and
				 * duration but never whether the call succeeded, which is the one
				 * fact the row exists to carry. `sr-only` is the established idiom
				 * here. A running row says nothing: the working line already
				 * announces the phase in its own live region, and repeating it per
				 * row would read the whole ledger out on every tick.
				 */}
				{OUTCOME_LABEL[outcome] ? (
					<span className={cn("sr-only")}>{OUTCOME_LABEL[outcome]}</span>
				) : null}
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
	summaryFallback = null,
	outcome,
	durationS,
	startedAt = null,
	added = 0,
	removed = 0,
	nameColumn = TOOL_NAME_COL_MIN,
	details,
	defaultOpen = false,
	className,
	media,
}: ToolRowProps) => {
	const running = outcome === "running";
	// The GROUND is gated on the `error` outcome alone, deliberately: see
	// `neverSent` below, which states why a not-run row does not claim the wash.
	// Its INK is not gated the same way — the name and the tool glyph take
	// `danger` for `not-run` as for `error`, through the one expression below.
	const failed = outcome === "error";
	const Icon = toolIcon(toolName);
	const name = displayName(toolName);
	// The one expression the summary cell both prints and titles, so the tooltip
	// cannot drift from the text it stands for — including the dropped-stutter
	// fallback below.
	const summaryText = isBareToolName(summary, toolName)
		? (summaryFallback ?? "")
		: summary;

	const row = (
		<span className={cn("flex min-w-0 flex-1 items-center gap-2")}>
			<span
				aria-hidden={true}
				className={cn(
					"flex size-3.5 shrink-0 [&_svg]:size-3.5",
					// THE ONE EXPRESSION. The tool glyph reads exactly the ink the name
					// below reads, so identity and state cannot be painted differently
					// inside one row — this pair used to be two expressions, and the
					// mismatch it produced (`task`/`hub`/`todo` accent names beside
					// grey glyphs) is the operator's own report. Liveness is the accent
					// on this glyph plus the raised ground: a still frame has to read
					// "live" without motion (D26).
					rowInk(outcome),
				)}
			>
				<Icon />
			</span>
			<span
				className={cn(
					"shrink-0 truncate font-mono text-mono-sm",
					// A 4px minimum gutter before the summary rail, so a name that
					// fills its column does not come within the row's own gap of the
					// summary. The column grows to the longest visible name, so at the
					// ceiling the two would otherwise sit 8px apart.
					//
					// It is ADDED to the measured width below rather than taken out of
					// it: as padding inside `${nameColumn}ch` it stole 4px from the
					// text box and truncated the very name the column was sized for
					// (`web_fetch` rendered as `web_fet…`).
					"pr-1",
					rowInk(outcome),
				)}
				// The shared column is a per-list measurement, so it cannot be a
				// static class: Tailwind compiles the utilities it can see in the
				// source, and `w-[${n}ch]` is not one of them.
				//
				// `calc` so the gutter above is added to the column rather than
				// carved out of it: `nameColumn` is the width the NAME needs, and
				// the 4px is separation from the summary beside it.
				style={{ width: `calc(${nameColumn}ch + 0.25rem)` }}
				title={name}
			>
				{name}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate font-mono text-mono-sm",
					running ? "text-ink-muted" : "text-ink-dim",
				)}
				// The name beside it has carried a `title` since it became truncatable;
				// this cell truncates too, and at 390px the summary is the half that
				// loses: measured 126.4px of box against 461px of text, so a peer row's
				// preview read as `"review-agent" · ca…` with no way to see the rest
				// short of opening the row (UX round 1, U4).
				title={summaryText}
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
				 *
				 * The test lives in `isBareToolName` because the transcript needs the
				 * same answer to decide whether to supply `summaryFallback` — two
				 * copies of this rule could disagree and leave a row blank with a
				 * usable fact in hand.
				 */}
				{summaryText}
			</span>
			<DiffCounters added={added} removed={removed} />
			<StatusCluster
				outcome={outcome}
				durationS={durationS}
				startedAt={startedAt}
			/>
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
			rowClassName={ROW_HEIGHT}
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
			// Both branches take the same height, or a run alternates between two
			// pitches depending on which calls happened to produce output.
			rowClassName={ROW_HEIGHT}
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
