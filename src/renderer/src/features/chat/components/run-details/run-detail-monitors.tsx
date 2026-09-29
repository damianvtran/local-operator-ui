/**
 * The Monitors section of the run panel: the session's armed monitors.
 *
 * The Wakes section's twin, and the second half of the same answer: a session
 * can be WATCHING something as well as scheduled to fire. A monitor re-runs a
 * read-only call on an interval and delivers only what CHANGED, so between
 * deliveries it is invisible in the transcript — this is the standing list of
 * what is being watched, how each watch is doing, and when it next looks. The
 * TUI band gained its monitor rows as the same slice's other half
 * (`local_operator/tui/widgets/wake_panel.py::_monitor_section`, whose rows
 * this section mirrors), and the composer's monitor chip counts the same list
 * and points here.
 *
 * **One row per MONITOR, not per check**, the rule the wake rows state: a
 * monitor that checks every 60s is one watch with one next-check instant and one
 * health word, so it gets one row. Re-listing a check per tick would fill the
 * pane with the same watch.
 *
 * **Soonest check first.** The order is the due instant's, which the model
 * decides (`run-detail-model.ts`'s `deriveMonitors`) and not this file's — the
 * same question the Wakes section answers, so both lists lead with what is
 * next.
 *
 * **Absence is not a state.** Zero monitors renders NO section — no empty
 * heading, no placeholder — and the composer's chip is gated on the same list,
 * so the two surfaces are absent together. `frontend.monitors` is empty on
 * every session that has never armed one, which is nearly all of them.
 *
 * **Health is an ink this section DOES spend**, and that is the one deliberate
 * divergence from the Wakes rows beside it: every wake row is armed by
 * definition, so its mark carries one ink on every row, while a monitor has a
 * state to distinguish — the failure ladder auto-disables one after
 * `values.monitor.maxConsecutiveFailures` runs, and a disabled monitor must not
 * be invisible (the design's § 11.3). The ink is the warning role, applied by
 * the model's `alerting` flag (disabled, or mid-ladder), so the colour rule
 * lives in one place and the row only paints it.
 *
 * **Quiet rows with one revealed action.** Each row carries `Cancel monitor`,
 * revealed on hover and on focus-within (the app's row idiom,
 * `wake-conversation-row.tsx`), so the list stays a readout until the pointer
 * or the keyboard asks. It is the desktop half of the design's
 * cancel-affordance paragraph - the same DELETE `lop monitor cancel` takes -
 * behind one confirmation, and a refusal renders in the dialog that asked (the
 * `delete-conversation-dialog.tsx` rule) rather than vanishing into a toast. A
 * conversation a LIVE session owns refuses this route by design and answers
 * the backend's own sentence, shown verbatim; the session's `monitor` tool
 * remains the writer that may touch it.
 *
 * **Nothing here ticks.** The whole section takes the UNTIMED model, like the
 * plan and the wakes list: a monitor carries absolute instants (next due, last
 * check) and a health word, none of which is a function of when it is read.
 * That is why `lastCheckLabel` is an ABSOLUTE local time rather than the CLI's
 * relative age — see `MonitorRow`'s own note.
 */

import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { Button } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { ScanEye } from "lucide-react";
import { type Ref, useState } from "react";
import {
	type MonitorRow,
	type RunDetails,
	monitorClause,
	visibleMonitors,
} from "./run-detail-model";
import type { MonitorControls } from "./use-monitor-controls";

/**
 * One armed monitor: when it next checks, how often, how it is doing, and what
 * it watches.
 *
 * The layout is the wake row's, so the two lists read as one species: the mark
 * column is the pane's grid (`pl-3`, a 16px box, an 8px gap — the column the
 * plan's items and the roster's rows put their marks in), the first line is the
 * facts, and the second line is the authored text.
 *
 * The first line leads with the due-or-state slot (`9:26 AM EDT`, `disabled`,
 * `waiting`) because that is the question a reader arrives with, exactly as the
 * wake row leads with its fire instant — and it is the slot that takes the
 * WARNING ink when the model says `alerting`, because for a disabled monitor
 * that slot IS the state. The clauses after it are the TUI band's own run
 * (`· every 60s · last check 9:25 AM EDT`) in the dim ink; the health tail
 * (`· 3 failed`, or the disabled reason) follows in the warning ink when there
 * is one. The yield order follows the wake row's recorded rule: the free-text
 * slot truncates first (it has a `title`), the numeric cadence never clips, and
 * the health tail truncates rather than pushing the row wide, also with its
 * whole text in a `title`.
 *
 * `ScanEye` is a MARK and not a state, one ink on every row, which is why it
 * does not change with health: the state ink is the slot's and the tail's, and
 * a second signaller on the mark would say the same thing twice. (The `Eye`
 * glyph is refused because the providers page already draws it for revealing a
 * key — one glyph in this app means one thing.)
 *
 * `data-run-panel-row` is the roster's and the wake row's own hook, on purpose:
 * all of the pane's row lists carry it, so a capture rig or a QA pass that can
 * address a child's row can address a watch's.
 */
const MonitorRowView = ({
	row,
	onCancel,
}: {
	row: MonitorRow;
	/** Ask to cancel this watch; the section owns the confirmation and the write. */
	onCancel: (row: MonitorRow) => void;
}) => {
	/*
	 * The identity line: the name first — it is what the CLI's own listing
	 * labels the row with (`f"{row['monitor_id']} {row['name']}"`) — and the
	 * authored description after the app's em-dash seam, when the arm carried
	 * one. Both halves share the block so the clamp and the `sr-only` twin
	 * cover the whole line; a row with neither draws no second line.
	 */
	const identity = row.name
		? row.description
			? `${row.name} — ${row.description}`
			: row.name
		: row.description;
	return (
		<li
			data-run-panel-row={row.id}
			className={cn("group/monitor flex items-start gap-2 px-3 py-0.5")}
		>
			<span className={cn("pt-0.5")}>
				<span
					aria-hidden={true}
					className={cn(
						"flex size-4 shrink-0 items-center justify-center text-ink-dim",
					)}
				>
					<ScanEye className={cn("size-4")} />
				</span>
			</span>
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				<div className={cn("flex items-baseline gap-1.5")}>
					{/*
					 * The due SLOT yields; the STATE WORD does not. A row with no due
					 * instant carries a word in its place (`disabled`, `waiting`), and
					 * that word is the row's verdict rather than a label: a clipped due
					 * label is recoverable context (the whole text rides `title`), while
					 * a clipped `disabl…` beside a free-text reason reads as a defect —
					 * measured in the first capture of `monitors-health`, where both
					 * shrinkable slots split the overflow and the reason's own length
					 * decided how much of the state survived. `nextDueAt === null` is
					 * the branch's reading of the model, SCOPED TO CORE-WRITTEN ROWS
					 * (agent review round 1, F2): the model's own condition for the
					 * slot's word is `disabled || nextDueAt === null`, and the two
					 * coincide because the core's disable path nulls the due
					 * (`scheduler.py`: "no next check is due for a disabled monitor"),
					 * which the same round verified. A hand-edited counters file that
					 * kept a due on a disabled monitor falls back to the label's
					 * ordinary yield — the behaviour this branch replaced — rather
					 * than a state the row cannot read.
					 */}
					<span
						className={cn(
							"truncate text-meta",
							row.nextDueAt === null ? "shrink-0" : "min-w-0",
							row.alerting ? "text-warning" : "text-ink-muted",
						)}
						title={row.whenLabel}
					>
						{row.whenLabel}
					</span>
					<span className={cn("shrink-0 text-ink-dim text-meta")}>
						{`· ${row.interval}`}
						{row.lastCheckLabel ? ` · ${row.lastCheckLabel}` : ""}
					</span>
					{row.healthLabel && (
						<span
							className={cn(
								"min-w-0 truncate text-meta",
								row.alerting ? "text-warning" : "text-ink-dim",
							)}
							title={row.healthLabel}
						>
							{`· ${row.healthLabel}`}
						</span>
					)}
				</div>
				{identity && (
					<>
						<span
							aria-hidden={true}
							className={cn("line-clamp-2 text-ink-muted text-meta leading-4")}
							title={identity}
						>
							{identity}
						</span>
						<span className={cn("sr-only")}>{identity}</span>
					</>
				)}
			</div>
			{/*
			 * The row's one control, revealed on hover and on focus-within (the app's
			 * row idiom) and ALWAYS IN THE LAYOUT - opacity, not display - so that
			 * revealing it moves nothing. `h-5` keeps the control inside the dense
			 * row's own 20px rhythm: a one-line watch row is `py-0.5` around a 16px
			 * line, and a `size="sm"` (28px) button would grow every row it sits in.
			 * The danger wash on hover is the wake line's own cancel ink, one list
			 * over.
			 */}
			<div className={cn("flex shrink-0 items-center")}>
				<Button
					variant="ghost"
					size="sm"
					data-monitor-cancel={row.id}
					aria-label={`Cancel monitor ${row.name}`}
					onClick={() => onCancel(row)}
					className={cn(
						"pointer-events-none opacity-0",
						"group-hover/monitor:pointer-events-auto group-hover/monitor:opacity-100",
						"group-focus-within/monitor:pointer-events-auto group-focus-within/monitor:opacity-100",
						"h-5 px-1.5 hover:bg-danger-wash hover:text-danger",
					)}
				>
					Cancel
				</Button>
			</div>
		</li>
	);
};

export const RunDetailMonitors = ({
	details,
	sectionRef,
	controls,
}: {
	details: RunDetails;
	/**
	 * The section's own element, for a caller that has to bring it into view.
	 *
	 * Held by the PANE rather than by this section, the Wakes section's
	 * arrangement: the request that needs it comes from outside the pane
	 * entirely (the composer's monitor chip) and the pane is what consumes it.
	 * Nothing here reads the ref; the section is simply where the node exists.
	 */
	sectionRef?: Ref<HTMLElement>;
	/**
	 * The pane's monitor write controls (`use-monitor-controls.ts`), threaded from
	 * `chat-page.tsx` for the MCP remedies' reason: the page owns the session
	 * identity and the section stays presentational.
	 */
	controls: MonitorControls;
}) => {
	const { rows, hidden } = visibleMonitors(details.monitors);
	/*
	 * The confirmation's own state, held ONCE here rather than per row (the MCP
	 * section's arrangement): one dialog, one sentence and one write path, with
	 * the pressed row carried as the pending selection.
	 */
	const [pending, setPending] = useState<MonitorRow | null>(null);
	/*
	 * A refusal belongs to the row that was refused and is TRACKED BY ID rather
	 * than cleared by an effect - the delete dialog's rule
	 * (`delete-conversation-dialog.tsx`): opening the dialog on another row must
	 * not inherit a sentence about a different request, and a stored id compares
	 * rather than races.
	 */
	const [refusal, setRefusal] = useState<{
		monitorId: string;
		detail: string;
	} | null>(null);
	/*
	 * A COUNTER rather than a boolean, because the modal takes the signal as a
	 * CHANGE (`focusCancelSignal`): a second refusal has to move the keyboard
	 * back to Keep again, and a boolean already true would be no change at all.
	 */
	const [refusalSeq, setRefusalSeq] = useState(0);
	const shownRefusal =
		refusal && pending && refusal.monitorId === pending.id ? refusal : null;
	const confirmCancel = () => {
		if (!pending) return;
		void (async () => {
			const outcome = await controls.cancel(pending.id);
			/*
			 * Success needs nothing here beyond closing: the canonical re-read the
			 * controls fire is what drops the row, and it is the evidence the watch is
			 * gone. A refusal keeps the dialog up with the backend's own sentence - the
			 * one surface that can still say what happened - and hands the keyboard
			 * back to Keep.
			 */
			if (outcome.ok) {
				setPending(null);
				return;
			}
			setRefusal({ monitorId: pending.id, detail: outcome.detail });
			setRefusalSeq((seq) => seq + 1);
		})();
	};
	return (
		<section ref={sectionRef} className={cn("flex flex-col pb-1.5")}>
			{/*
			 * Label left, tally right, on one line: the sections' shared
			 * arrangement (`§4.1`). The tally is `monitorClause` — the SAME string
			 * the composer's chip carries — so the count above the composer and the
			 * count in the pane it opens cannot come to spell one number two ways.
			 */}
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				<span className={cn("shrink-0 text-meta text-ink-muted")}>
					Monitors
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
					)}
				>
					{monitorClause(details.monitors.length)}
				</span>
			</div>
			<ul className={cn("flex flex-col")}>
				{rows.map((row) => (
					<MonitorRowView key={row.id} row={row} onCancel={setPending} />
				))}
				{/*
				 * The overflow marker, and it is a STATEMENT rather than a control,
				 * for the Wakes section's reason: nothing in this pane can put a shed
				 * monitor back — the list is what the scheduler holds — so the count
				 * carries no affordance and wears the shared `Disclosure` primitive's
				 * `disabled` branch rather than the roster's `Show N more`, which IS a
				 * control. The wording names the thing counted ("more monitors"), like
				 * "more wakes" beside it: a bare `2 more` under a list of watches could
				 * be read as two more checks of the row above. The noun inflects because
				 * one is reachable through a raised `maxMonitors` setting or a
				 * hand-edited index, not through the shipping ceiling.
				 */}
				{hidden > 0 && (
					<li className={cn("pr-3")}>
						<Disclosure
							disabled={true}
							summary={`${hidden} more monitor${hidden === 1 ? "" : "s"}`}
							className={cn("pl-9 text-meta")}
						/>
					</li>
				)}
			</ul>
			{/*
			 * The footer sentence - "To stop a monitor, ask the agent to cancel it." -
			 * retired WITH the control rather than kept beside it: it was the
			 * stopgap's copy for a pane that had no control, and with the revealed
			 * `Cancel monitor` on every row it would send a reader around a button that
			 * is right beside the sentence. A refusal that leaves the reader with no
			 * move is answered where it happens, in the dialog.
			 */}
			<ConfirmationModal
				open={pending !== null}
				title="Cancel this monitor?"
				message={
					<>
						<p>
							{pending
								? `“${pending.name}” will not check again. The conversation stays.`
								: ""}
						</p>
						{shownRefusal && (
							<p className="pt-2 text-danger">{shownRefusal.detail}</p>
						)}
					</>
				}
				confirmText="Cancel monitor"
				cancelText="Keep"
				isDangerous
				/*
				 * The refusal is the only thing this dialog can be told that makes the
				 * SAFE action the one the keyboard should hold: the cancel did not
				 * happen, and the next Enter must not repeat it.
				 */
				focusCancelSignal={refusalSeq}
				onConfirm={confirmCancel}
				onCancel={() => setPending(null)}
			/>
		</section>
	);
};
