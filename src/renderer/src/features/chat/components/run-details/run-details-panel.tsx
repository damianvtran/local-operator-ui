/**
 * The run panel's body: the roster, the plan, the tool jobs and the MCP server
 * list (`docs/run-sidebar.md` § 4-§ 7).
 *
 * One panel, four sections, and a section appears only when it has content: a
 * run with only to-dos shows only `To-dos`, a session with only MCP servers
 * shows only those. No empty heading and no placeholder — an empty section is
 * not a state anything renders, so it renders as absence.
 *
 * The body is presentational and in-flow: the pane (width, chrome bar, scroll
 * region, escape ladder) is `RunPanel`'s, because all of those are facts about
 * where this body is shown rather than about what it says.
 *
 * Its clock (`useRunDetailsClock`) is here rather than higher up because this is
 * the surface that draws a running child's elapsed time and the only one that
 * has to repaint when it moves.
 *
 * AND TWO INTERACTIONS LIVE HERE, not in the sections that raise them: the
 * Monitors section's cancel confirmation and the per-row records it leaves
 * (`use-monitor-cancel.ts`), and the Wakes section's cancel — one press for an
 * ordinary wake, a confirmation for the chief of staff's, and every record
 * either attempt leaves (`use-wake-cancel.ts`). The Wakes section is gated on
 * `details.wakes.length` exactly as the Monitors section is on
 * `details.monitors.length`, and the canonical re-read every cancel fires
 * churns both lists the same way - measured on the monitors, where a
 * section-owned dialog unmounted mid-refusal on ~8 of 34 presses and the
 * keyboard fell to `<body>` (UX review round 1, U2). This body is above both
 * gates, so each interaction's state is owned here, the cards render OUTSIDE
 * the sections gate below, and the sections stay presentational.
 */

import { Separator } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Fragment, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { MonitorCancelDialog } from "./monitor-cancel-dialog";
import { RunDetailJobs } from "./run-detail-jobs";
import { RunDetailMcp } from "./run-detail-mcp";
import type { McpServerRow, RunDetails } from "./run-detail-model";
import { hasRunDetails } from "./run-detail-model";
import { RunDetailMonitors } from "./run-detail-monitors";
import { RunDetailSubagents } from "./run-detail-subagents";
import { RunDetailTodos } from "./run-detail-todos";
import { RunDetailWakes } from "./run-detail-wakes";
import { useRunDetailsClock } from "./run-details-clock";
import type { McpRemedyControls } from "./use-mcp-remedy";
import { useMonitorCancel } from "./use-monitor-cancel";
import type { MonitorControls } from "./use-monitor-controls";
import { useWakeCancel } from "./use-wake-cancel";
import type { WakeControls } from "./use-wake-controls";
import { WakeCancelPopover } from "./wake-cancel-popover";
import type { AidaWakeIdentity } from "./wake-controls-model";

export type RunDetailsPanelProps = HTMLAttributes<HTMLDivElement> & {
	details: RunDetails;
	mcpServers: readonly McpServerRow[];
	/** Whether the read carries an operation that is still running (`§ 7.2`). */
	mcpGrantRunning: boolean;
	/** The pane's MCP remedy controls: see `use-mcp-remedy.ts`. */
	mcpRemedy: McpRemedyControls;
	/** Whether a child's row can be opened (`§ 10.2`). */
	childrenOpenable: boolean;
	onOpenChild: (id: string) => void;
	/** Hoisted to the pane so a drill-in and back keeps the roster expanded. */
	rosterExpanded: boolean;
	onToggleRosterExpanded: () => void;
	/**
	 * The pane's own width, in pixels.
	 *
	 * Threaded down rather than read from the preference store by whichever
	 * section needs it: the pane's width is a fact about where these sections are
	 * SHOWN (`chat-content.tsx` sets both `width` and `minWidth` from the same
	 * value), and the tally's char budget is derived from it — see
	 * `tallyBudget`. One source, one reading.
	 */
	paneWidth: number;
	/**
	 * The To-dos section's element, for the pane's consume-once reveal request.
	 *
	 * Threaded through the body rather than read here: the request is the pane's
	 * (`RunPanel` owns the effect and the store subscription), and this component
	 * stays presentational — it renders the sections and decides nothing about
	 * where the pane is looking.
	 */
	todosSectionRef?: Ref<HTMLElement>;
	/**
	 * The Subagents section's element, for the same request.
	 *
	 * Four refs rather than one because the request now names one of four
	 * destinations (`RunPanelSection`): the composer's plan chip, its subagents
	 * chip, its jobs chip and its wake chip each point at their own section, and
	 * the pane resolves the request through whichever ref that section owns —
	 * through the `Record` in `run-panel.tsx`, so a destination added to the union
	 * and missed here is a TYPE ERROR rather than a mis-scrolled pane.
	 */
	subagentsSectionRef?: Ref<HTMLElement>;
	/** The Jobs section's element, for the same request. */
	jobsSectionRef?: Ref<HTMLElement>;
	/**
	 * The Wakes section's element, for the same request.
	 *
	 * The fourth ref, and with it the fourth destination the composer's status row
	 * can name (`RunPanelSection`): the wake chip opens the pane at this section
	 * exactly as the plan chip opens it at the plan, and the pane resolves the
	 * request through whichever ref that section owns.
	 */
	wakesSectionRef?: Ref<HTMLElement>;
	/**
	 * The Monitors section's element, for the same request.
	 *
	 * The fifth ref, and with it the fifth destination the composer's status row
	 * can name (`RunPanelSection`): the monitor chip opens the pane at this
	 * section exactly as the wake chip opens it at the wakes, and the pane
	 * resolves the request through whichever ref that section owns.
	 */
	monitorsSectionRef?: Ref<HTMLElement>;
	/**
	 * The pane's monitor write controls (`use-monitor-controls.ts`), threaded from
	 * the page exactly as `mcpRemedy` is: the write belongs to the level that owns
	 * the session identity, and this body's cancel interaction (below) is what
	 * confirms it.
	 */
	monitorControls: MonitorControls;
	/**
	 * The pane's wake write controls (`use-wake-controls.ts`), threaded from the
	 * page exactly as `monitorControls` is: the wakes' confirmation and every
	 * record an attempt leaves live in this body, one section over.
	 */
	wakeControls: WakeControls;
	/**
	 * What the pane knows about the chief of staff (`useAidaTarget` at the page):
	 * the guard that keeps her check-ins from being one stray click from gone.
	 * Plain data rather than a hook call for the monitors' reason — the stories
	 * inject identity instead of needing providers.
	 */
	wakeAida: AidaWakeIdentity;
	/**
	 * The conversation whose canonical session this pane reports, or `null` when
	 * none exists yet.
	 *
	 * Threaded down for ONE reader: the monitors cancel interaction resets when
	 * the session changes - monitor handles are per-session (`m1`..), so a pending
	 * row or a row's record from one conversation must not be read against
	 * another conversation's list.
	 */
	sessionId: string | null;
};

export const RunDetailsPanel = ({
	details,
	mcpServers,
	mcpGrantRunning,
	mcpRemedy,
	childrenOpenable,
	onOpenChild,
	rosterExpanded,
	onToggleRosterExpanded,
	paneWidth,
	todosSectionRef,
	subagentsSectionRef,
	jobsSectionRef,
	wakesSectionRef,
	monitorsSectionRef,
	monitorControls,
	wakeControls,
	wakeAida,
	sessionId,
	className,
	...props
}: RunDetailsPanelProps) => {
	/*
	 * The clock is taken HERE, at the body, and the re-measured model is handed to
	 * the SUBAGENT rows only. Nothing above this component ticks (see
	 * `useRunDetailsClock`): the roster is the only surface that draws a value
	 * which moves, so it is the only one that has to be repainted when one does.
	 *
	 * The to-dos section deliberately takes the UNTIMED model. There is no
	 * time-dependent field anywhere in the plan — an item is pending, done,
	 * dropped or blocked, and every count is derived from those — so handing it
	 * the re-measured object would re-render the whole plan once a second to
	 * paint the same pixels, which is the reflow `§6.3` exists to prevent, one
	 * component over. The re-measured object is a fresh object whenever anything
	 * moved, so a memo would not save it either.
	 */
	const measured = useRunDetailsClock(details);
	/*
	 * The Monitors cancel interaction, owned HERE rather than by the section that
	 * raises it - see the header for the churn this answers. It takes the write
	 * controls and the session identity, and hands back the row-facing half
	 * (`section`) and the dialog's props.
	 */
	const monitorCancel = useMonitorCancel({
		sessionId,
		controls: monitorControls,
	});
	/*
	 * The Wakes cancel interaction, owned HERE for the same reason and one
	 * section over: the wakes list churns under the canonical re-read a cancel
	 * fires, so the one-press write, the confirmation and every record live above
	 * the section gate. It takes the write controls, the session identity and the
	 * display name the confirmation may name.
	 */
	const wakeCancel = useWakeCancel({
		sessionId,
		controls: wakeControls,
		name: wakeAida.name,
	});
	/*
	 * Presence is judged on the DERIVED lists rather than on the visible slices:
	 * a section whose rows are all over the cap still has content, and its
	 * disclosure is the thing that says so.
	 */
	const sections: Array<{ key: string; body: ReactNode }> = [];
	if (details.subagents.length > 0) {
		sections.push({
			key: "subagents",
			body: (
				<RunDetailSubagents
					details={measured}
					expanded={rosterExpanded}
					onToggleExpanded={onToggleRosterExpanded}
					onOpenChild={onOpenChild}
					interactive={childrenOpenable}
					paneWidth={paneWidth}
					sectionRef={subagentsSectionRef}
				/>
			),
		});
	}
	/*
	 * The PHASE count here and the ITEM count at the composer's plan chip are two
	 * spellings of one rule, and they are deliberately different.
	 *
	 * The pane is about phases: it renders their headers, their items and their
	 * `+N more`, so it appears whenever there is a phase to render - including a
	 * named phase with no items, which is a real state the backend publishes (the
	 * checkpoint arrives with `todos: [{ name: "Foundation", items: [] }]`).
	 * The chip is about work: `totalTodos` is the item count, so a plan that
	 * arrived as an empty phase prints nothing at all rather than stating a finished
	 * plan over it (`All to-dos resolved` under the settled clause; `0 to-dos open`
	 * when this note was written, which read as a finished plan too).
	 *
	 * `totalTodos > 0` implies `todos.length > 0`, so the two cannot disagree in a
	 * reachable state; the note is here because this PR is what made the
	 * distinction load-bearing, and "unifying" the two spellings would put the
	 * chip back to claiming a plan it cannot count (agent review, round 1, N2).
	 */
	if (details.todos.length > 0) {
		sections.push({
			key: "todos",
			body: (
				<RunDetailTodos
					details={details}
					paneWidth={paneWidth}
					sectionRef={todosSectionRef}
				/>
			),
		});
	}
	/*
	 * The Jobs section, and its gate is the same rule the composer's jobs chip is
	 * gated on: rows that have not settled. It takes the MEASURED model rather than
	 * the untimed one, unlike the plan above — the elapsed clock is the one figure
	 * this section draws that moves, so it is the one section beside the roster that
	 * has to be repainted when it does.
	 *
	 * `openJobs > 0` is a presence test on the DERIVED list, like the two above it,
	 * and it is what makes `hasRunDetails`'s new clause and this section the same
	 * fact: the quiet line says "Nothing in flight" only when there is no section to
	 * contradict it.
	 */
	if (details.openJobs > 0) {
		sections.push({
			key: "jobs",
			body: (
				<RunDetailJobs
					details={measured}
					paneWidth={paneWidth}
					sectionRef={jobsSectionRef}
				/>
			),
		});
	}
	/*
	 * The Wakes section, and its gate is the same rule the composer's wake chip is
	 * gated on: at least one ARMED schedule. A session whose only content is a wake
	 * is one this pane has something to show for, which is why this section (and
	 * not a widened `hasRunDetails`) is what keeps the QUIET STATE below out of
	 * reach for it — see that branch's own note.
	 *
	 * It takes the UNTIMED model, like the plan above it and unlike the roster and
	 * the jobs list: an armed wake carries an absolute local instant and a cadence,
	 * neither of which is a function of when it is read, so a re-measure would
	 * repaint the same pixels once a second. There is deliberately no relative form
	 * ("in 42m") for the same reason.
	 *
	 * ORDER: after the tool jobs and before the MCP servers. `docs/run-sidebar.md`
	 * § 7.2 FIXES the section order rather than reordering sections by state (its
	 * own words: "takes the consequence by fixing the section order"), and it fixes
	 * the MCP list as LAST — so a new section joins the end of the run's own lists,
	 * where the jobs chips' own placement also came from. It is deliberately not
	 * placed beside the composer's chip order, which is a different surface's
	 * reading order (there the standing facts lead the live ones).
	 */
	if (details.wakes.length > 0) {
		sections.push({
			key: "wakes",
			body: (
				<RunDetailWakes
					details={details}
					sectionRef={wakesSectionRef}
					sessionId={sessionId}
					cancel={wakeCancel.section}
					identity={wakeAida}
				/>
			),
		});
	}
	/*
	 * The Monitors section, `wakes`' sibling and its gate's twin: at least one
	 * ARMED monitor, off the model's own list. A session whose only content is an
	 * armed monitor is one this pane has something to show for, which is why this
	 * section (and not a widened `hasRunDetails`) is what keeps the QUIET STATE
	 * below out of reach for it — exactly as the wake section's own note argues
	 * for wakes: the section renders at `monitors.length > 0`, so
	 * `sections.length` is non-zero and the quiet branch is unreachable.
	 *
	 * It takes the UNTIMED model, like the plan and the wakes above it: a monitor
	 * carries absolute instants (next due, last check) and a health word, none of
	 * which is a function of when it is read.
	 *
	 * ORDER: directly after the wakes and before the MCP servers. The same rule
	 * that fixed the wakes section's place decides this one — the section order is
	 * fixed rather than reordered by state, the MCP list is LAST — and within the
	 * session's own standing facts the wakes lead and the monitors follow, which
	 * is the TUI band's own order ("wake rows first, then a monitor section").
	 */
	if (details.monitors.length > 0) {
		sections.push({
			key: "monitors",
			body: (
				<RunDetailMonitors
					details={details}
					sectionRef={monitorsSectionRef}
					cancel={monitorCancel.section}
				/>
			),
		});
	}
	if (mcpServers.length > 0) {
		sections.push({
			key: "mcp",
			body: (
				<RunDetailMcp
					servers={mcpServers}
					grantRunning={mcpGrantRunning}
					paneWidth={paneWidth}
					remedy={mcpRemedy}
				/>
			),
		});
	}

	/*
	 * The QUIET STATE, and it is a state this surface did not have before.
	 *
	 * The old popover could not open empty: its trigger was gated on
	 * `hasRunDetails`, so a session with nothing outstanding had no button and
	 * therefore no empty panel to design. The pane's button is always there
	 * (`§ 3.3`), so a canonical session with no children, no plan and no MCP
	 * servers opens onto an empty pane — and the honest treatment of that is
	 * one line saying so rather than a skeleton or a placeholder row.
	 *
	 * `hasRunDetails` decides which sentence, and this is the job it kept when
	 * it lost its visibility gate: "nothing in flight" is a different fact from
	 * "no run", and the settled case is the one a reader arrives in after work
	 * they just watched finish. The second branch is DEFENSIVE: every clause of
	 * `hasRunDetails` implies rows to render, so it is unreachable through the
	 * panel today. It is written rather than asserted away because the copy
	 * must never claim "nothing in flight" while something is outstanding, and
	 * a silent fallthrough is exactly how it would.
	 *
	 * **A session whose only content is ARMED WAKES deliberately does NOT widen
	 * `hasRunDetails`** (`docs/composer-wakes.md` states the decision and its
	 * alternative). The wake chip points into this pane, so "Nothing to show
	 * yet." must not be what a reader finds there — and it is not: the Wakes
	 * section above renders at `wakes.length > 0`, which makes `sections.length`
	 * non-zero and the quiet block below UNREACHABLE for that session. Widening
	 * the predicate would have been the other way to get there and is rejected
	 * on the field's own meaning: it answers "is anything asking for something
	 * right now" (`run-detail-model.ts`), and an armed wake is a FUTURE event
	 * that has asked for nothing yet. A predicate widened to cover it would be
	 * answering a different question under the same name at every one of its
	 * clauses.
	 *
	 * THE QUIET BLOCK IS AN ARM OF ONE RETURN rather than a return of its own,
	 * because the monitors cancel dialog must render in both states (see the
	 * note above it): the canonical re-read a cancel fires can empty
	 * `details.monitors` for a frame, and a session whose only section was
	 * Monitors lands here - with the dialog open - for that frame.
	 */
	return (
		<div className={cn("flex flex-col", className)} {...props}>
			{sections.length === 0 && (
				<p className={cn("px-3 py-3 text-body-sm text-ink-muted")}>
					{hasRunDetails(details)
						? "Nothing to show yet."
						: "Nothing in flight."}
				</p>
			)}
			{sections.map((section, index) => (
				<Fragment key={section.key}>
					{/*
					 * One `hairline` rule between two stacked lists, and nothing else
					 * in the panel: it is the decorative role, and the boundary between
					 * two lists carries no information a reader has to read.
					 */}
					{index > 0 && <Separator />}
					{section.body}
				</Fragment>
			))}
			{/*
			 * The monitors cancel confirmation renders in this body, OUTSIDE the
			 * sections gate: the canonical re-read a cancel fires churns the list
			 * the Monitors section is gated on, and a dialog inside that section
			 * unmounted mid-refusal with it (UX review round 1, U2). This body
			 * survives the churn - including the churn that lands on the quiet
			 * block above - so the refusal stays until dismissed. See
			 * `use-monitor-cancel.ts` for the state that backs it.
			 */}
			<MonitorCancelDialog {...monitorCancel.dialog} />
			{/*
			 * The wakes confirmation, rendered here for the monitors' own reason: the
			 * wakes list is gated on `details.wakes.length` and empties for a frame
			 * under the same canonical re-read, so a card owned by that section would
			 * leave with its rows — measured for monitors as ~8 of 34 refusals losing
			 * their sentence. It is anchored to the rect captured at the press, so it
			 * keeps its place even while its row is off the screen.
			 */}
			<WakeCancelPopover {...wakeCancel.popover} />
		</div>
	);
};
