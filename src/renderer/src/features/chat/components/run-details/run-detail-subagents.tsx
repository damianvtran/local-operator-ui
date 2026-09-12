/**
 * The Subagents section of the run-details panel (`docs/run-details.md` § 4.1).
 *
 * One row per child. The row is TWO lines, and that is the one place the port
 * departs from the TUI's single-line grammar: the TUI has a full dock band and a
 * fixed-cell terminal to lay a row out in, a 384px popover does not, and the
 * activity string is the single most useful live datum in the list. So it gets
 * its own line rather than being the first thing shed.
 *
 * Every rule that decides WHAT is on a row lives in `run-detail-model.ts`; this
 * file decides only how it is painted.
 */

import { cn } from "@shared/lib/utils";
import {
	Check,
	CircleDashed,
	CircleHelp,
	CirclePause,
	CircleSlash,
	Clock,
	LoaderCircle,
	type LucideIcon,
	RotateCcw,
	X,
} from "lucide-react";
import {
	type ChildStatus,
	type RunDetails,
	type SubagentRow,
	childStateLabel,
	subagentTally,
	visibleSubagents,
} from "./run-detail-model";

/**
 * One mark per state, ported by meaning rather than by codepoint, exactly as
 * `trace/tool-glyphs.ts` ports the TUI's nerd-font table. `status_glyph` has a
 * mark for the pause circle and no branch at all for `gone` or an unrecognised
 * word — both fall through to its completed check — and all three have their
 * own mark here. `CirclePause` is the TUI's own `GLYPH_PAUSED`, reachable from
 * the restored path rather than from a live pause; the other two are the quiet
 * marks for "this state did not resolve into an outcome".
 *
 * Two properties are load-bearing and both are `§6.4`'s: **motion is a bonus,
 * never the contract** — running and interrupted are different SHAPES, so the
 * list survives `prefers-reduced-motion` and survives being looked at by someone
 * who cannot separate the two inks — and **failure is the only colour the
 * section spends**, which is the dock band's own ink law.
 */
const CHILD_ICON: Record<ChildStatus, LucideIcon> = {
	running: LoaderCircle,
	queued: Clock,
	paused: CirclePause,
	interrupted: RotateCcw,
	done: Check,
	cancelled: CircleSlash,
	gone: CircleDashed,
	unknown: CircleHelp,
	failed: X,
};

const CHILD_INK: Record<ChildStatus, string> = {
	// `subagent_panel.py:371-391`. The running spinner stays neutral: the accent
	// green is a scarce budget and a child at work has not done anything yet.
	running: "text-ink-muted",
	queued: "text-ink-dim",
	// Muted like `interrupted`, and for the same reason: the child is not gone
	// and did not fail — it is parked where the user left it, which is a state
	// they may come back to (`subagent_panel.py` returns `muted` for both).
	paused: "text-ink-muted",
	// A run cut off by the process ending is not a failure — nothing went wrong —
	// so it takes the muted ink and the rotate mark that says it may be resumable.
	interrupted: "text-ink-muted",
	done: "text-ink-dim",
	cancelled: "text-ink-dim",
	// Settled and quiet, and NOT `done`: both of these are states whose outcome
	// is unknown, so they take the quietest ink without claiming a green check
	// (`foldStatus`).
	gone: "text-ink-dim",
	unknown: "text-ink-dim",
	failed: "text-danger",
};

/**
 * Characters the trailing tally may occupy.
 *
 * The panel's width is a constant (`§5`: 384px) so its budget is one too — the
 * measurement this would otherwise need is `384 - 24px padding - the label's own
 * width`, which is what the number below is. The RULE lives in the model
 * (`subagentTally(rows, maxChars)`), because "which fact survives pressure" is
 * arithmetic and belongs where it can be asserted; only the width is a fact
 * about this component.
 */
const TALLY_BUDGET = 44;

const SubagentStateIcon = ({ status }: { status: ChildStatus }) => {
	const Icon = CHILD_ICON[status];
	return (
		<span
			aria-hidden={true}
			className={cn(
				"flex size-4 shrink-0 items-center justify-center",
				CHILD_INK[status],
			)}
		>
			<Icon
				className={cn(
					"size-4",
					// Reduced motion: the glyph holds its frame. Shape already
					// distinguishes it, which is why motion is a bonus and not the
					// contract.
					status === "running" && "motion-safe:animate-spin",
				)}
			/>
		</span>
	);
};

/**
 * The numbers run: role, elapsed, context, cost (`§4.1`).
 *
 * Each figure is omitted when unknown rather than zeroed — see the model — and
 * the segment disappears with it, which is why the seam is rendered BETWEEN
 * segments rather than after each one. Elapsed takes `tabular-nums` so a column
 * of them aligns without a fixed-width slot.
 */
const NumbersRun = ({ row }: { row: SubagentRow }) => {
	const figures: Array<{ key: string; text: string; tabular?: boolean }> = [];
	if (row.role) figures.push({ key: "role", text: row.role });
	if (row.elapsedLabel) {
		figures.push({ key: "elapsed", text: row.elapsedLabel, tabular: true });
	}
	if (row.contextLabel) {
		figures.push({ key: "context", text: row.contextLabel, tabular: true });
	}
	if (row.costLabel) {
		figures.push({ key: "cost", text: row.costLabel, tabular: true });
	}
	if (figures.length === 0) return null;
	return (
		<span
			className={cn(
				"flex shrink-0 items-baseline gap-1 text-meta text-ink-muted",
			)}
		>
			{figures.map((figure, index) => (
				<span key={figure.key} className={cn("flex items-baseline gap-1")}>
					{index > 0 && <span className={cn("text-ink-dim")}>·</span>}
					<span className={cn(figure.tabular && "tabular-nums")}>
						{figure.text}
					</span>
				</span>
			))}
		</span>
	);
};

/**
 * The row's second line (`§4.1`), which is one of two different kinds of text.
 *
 * Both variants take `ink-muted`, where the activity line used to take
 * `ink-dim`: at 12px on the panel ground `dim` measures ≈4.7:1 — the tightest
 * text on the surface — and it is the ink the TUI deliberately moved AWAY from
 * for this same field (`subagent_panel.py:1069-1071`, and the assignment at
 * `:1153` that names `muted` for it).
 *
 * `errorLine` is MACHINE VOICE: `font-mono`, matching every other exception the
 * app prints (`trace/working-line.tsx:167`), kept VERBATIM — a fabricated
 * translation of an exception is a claim nobody can check — and wrapped to at
 * most two lines. Wrapping is the substantive half of that: head-truncated on
 * one line, `FileNotFoundError: [Errno 2] No such file or directory:
 * 'ledger/q1.csv'` rendered as `…'le…`, keeping the exception's preamble and
 * cutting the identifier, which is the only part that says WHAT failed.
 *
 * `activity` is prose about the work: sans, one line, head-truncated, because
 * there the head IS the useful part (the tool, then its arguments).
 */
const DetailLine = ({ row }: { row: SubagentRow }) => {
	if (row.errorLine) {
		return (
			<span
				/*
				 * `leading-4` is pinned here for the same reason the activity line
				 * pins it: `text-mono-sm`'s inherited 1.45 lands the two clamped
				 * lines 3px off the 4px ramp, so the worst row in the list measured
				 * 67px against `§5`'s 64. Both variants of the second line are one
				 * 16px line height, and the failure row is exactly 12 + 20 + 2×16.
				 */
				className={cn(
					"line-clamp-2 font-mono text-ink-muted text-mono-sm leading-4",
				)}
				title={row.errorLine}
			>
				{row.errorLine}
			</span>
		);
	}
	if (row.activity) {
		return (
			<span
				className={cn("truncate text-ink-muted text-meta leading-4")}
				title={row.activity}
			>
				{row.activity}
			</span>
		);
	}
	return null;
};

const SubagentRowView = ({ row }: { row: SubagentRow }) => {
	/*
	 * Line 2 is the live datum while the child works and the outcome's first line
	 * once it has failed; a settled child that is neither has none.
	 *
	 * **That last part is this design's own choice, not a port, and the citation
	 * it used to carry was wrong.** The TUI's roster does blank a settled row's
	 * activity, but not for the reason claimed here: `row_facts` fills it from
	 * `result_text` for every settled state (`subagent_panel.py:628-640`) and only
	 * blanks it when the row's PAGE IS OPEN (`:653-660`, `if current and not
	 * running`), which is the collapsed preview's `current=False` — so a settled
	 * roster row there keeps its text. What this panel does instead is drop the
	 * second line for a settled child that did not fail, because a 384px popover
	 * two lines per row cannot hold a paragraph of `result_text` per settled child
	 * and keep the live rows legible. The full record is the transcript, which is
	 * where §3.1 sends it.
	 */
	return (
		<li
			className={cn(
				// No hover ground: nothing in this panel is clickable (`§4.3`), so
				// nothing may react to a pointer. A row that lights up under the
				// cursor is a promise the surface does not keep.
				//
				// `py-1.5` with the two pinned line-heights below is what makes the
				// row heights exact (`§5`): 12 + 20 = 32px single-line, 12 + 20 + 16
				// = 48px with a second line. The line-heights are pinned rather than
				// inherited because `body-sm`'s 1.5 and `meta`'s 1.45 both land off
				// the 4px ramp (19.5px and 17.4px), which measured as a 48-50px
				// two-line row instead of the 48 the contract claims.
				"flex gap-2 px-3 py-1.5",
			)}
		>
			<span className={cn("pt-0.5")}>
				<SubagentStateIcon status={row.status} />
			</span>
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				<div className={cn("flex items-baseline gap-2")}>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-body-sm text-ink leading-5",
						)}
						title={row.label}
					>
						{row.label}
					</span>
					{/*
					 * The state in words, for a reader who cannot see the mark.
					 *
					 * The glyph is `aria-hidden` — it is decoration to assistive tech —
					 * so without this the row announced a label and a row of numbers and
					 * never whether the child was still going or had failed, which is
					 * the one fact the row exists to carry (`§6.4`).
					 */}
					<span className={cn("sr-only")}>{childStateLabel(row)}</span>
					<NumbersRun row={row} />
				</div>
				<DetailLine row={row} />
			</div>
		</li>
	);
};

export const RunDetailSubagents = ({ details }: { details: RunDetails }) => {
	const { rows, hidden } = visibleSubagents(details.subagents);
	return (
		<section className={cn("flex flex-col pb-1.5")}>
			{/*
			 * Label left, tally right, on one line: "the section label with a quiet
			 * trailing tally" (`§4.1`). Right-aligning it is what gives the tally the
			 * width its shedding rule is about, and it keeps two panels' tallies in
			 * the same column when a run has both sections.
			 */}
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				<span className={cn("shrink-0 text-meta text-ink-muted")}>
					Subagents
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
					)}
				>
					{subagentTally(details.subagents, TALLY_BUDGET)}
				</span>
			</div>
			<ul className={cn("flex flex-col")}>
				{rows.map((row) => (
					<SubagentRowView key={row.id} row={row} />
				))}
				{/* Disclosed, never silently dropped (`§2.1`): the count is the only
				 * thing that says the list is a slice. */}
				{hidden > 0 && (
					<li className={cn("px-3 pt-1 text-meta text-ink-dim")}>
						{`+${hidden} more`}
					</li>
				)}
			</ul>
		</section>
	);
};
