import {
	useAidaDisplayName,
	useAidaTarget,
} from "@features/aida/use-aida-target";
import { MonitorCancelDialog } from "@features/chat/components/run-details/monitor-cancel-dialog";
import { useMonitorCancel } from "@features/chat/components/run-details/use-monitor-cancel";
import {
	type AidaWakeIdentity,
	sessionIsChiefOfStaff,
	wakeConfirmActionLabel,
	wakeConfirmSentence,
	wakeConfirmTitle,
} from "@features/chat/components/run-details/wake-controls-model";
/**
 * The Schedules page: every conversation on this machine that has wakes, with
 * its wakes beneath it; then a labelled Monitors section with every standing
 * watch on this machine, grouped by conversation; plus the fenced group of rows
 * still on the older agent-schedule engine.
 *
 * ## Wakes and monitors, one page
 *
 * A conversation can be SCHEDULED to fire (a wake) and WATCHING something (a
 * monitor); every other surface that draws one draws both - the TUI's band
 * (wakes, then a monitors section), the phone's Schedules view, the run pane's
 * two sections - and this page used to list wakes only (#1898). The monitors
 * are a second labelled section after the wakes rather than lines merged into
 * the wake rows: both listings are per session, so a merge would reconcile two
 * indexes, and a monitors-only conversation would have no wake row to sit
 * under. The section is read-and-cancel only - arming stays the agent's
 * `monitor` tool - and its rows and cancel are the run pane's own
 * (`MonitorRowView`, `useMonitorCancel`, `MonitorCancelDialog`), so a watch
 * reads and stops the same here as in its conversation.
 *
 * ## Two engines, one page, and why both are here
 *
 * The wake is the primitive now: `New scheduled task` creates a conversation
 * and arms a wake in it, and nothing on this page writes a legacy agent
 * schedule any more. The legacy ENGINE, however, is frozen rather than deleted -
 * rows that exist keep running - so a page that listed only wakes would be
 * hiding live automation. Those rows therefore appear in their own fenced,
 * labelled group, with their existing toggle, edit and delete, and the group is
 * absent entirely when no legacy row exists (which is the state of a machine
 * that has only ever used wakes).
 *
 * ## Why this page is where the confirm lives
 *
 * The run pane's Wakes section ALSO cancels now (the wakes control slice: a
 * visible `Cancel` on every row, one press for an ordinary wake, a small card
 * for the chief of staff's), so this page is no longer the only surface where a
 * schedule can be stopped - the sentence this comment used to carry ("a schedule
 * is read there and cancelled by the agent") was retired with that change (agent
 * review round 1, F7). This page's job is managing scheduled work - it is where
 * one is created - and it keeps its own bar: each wake line offers `Cancel wake`
 * behind the page-level confirm that names the prompt and says the conversation
 * stays. Pause is deliberately NOT offered: the wake model has no `paused_at`,
 * so a toggle could only be implemented as cancel-and-re-arm, which would
 * silently reset `fired_count`
 * and re-anchor a recurrence to the moment of the toggle.
 *
 * ## Freshness
 *
 * Nothing pushes the wake index (the supervisor is a separate process writing
 * files, and the only event stream the app has is per session), so the listing
 * polls and re-reads on window focus; every write invalidates it AND asks the
 * affected conversation's canonical snapshot to re-read, so a change made here
 * cannot leave the chat pane asserting a wake that was just cancelled.
 */
import type { ScheduleResponse } from "@shared/api/local-operator";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	useMonitorListingControls,
	useMonitorsListing,
} from "../hooks/use-monitors-queries";
import {
	invalidateLegacySchedules,
	useEditSchedule,
	useListAllSchedules,
	useRemoveSchedule,
} from "../hooks/use-schedules-queries";
import { useCancelWake, useWakesListing } from "../hooks/use-wakes-queries";
import {
	type ScheduledTaskRow,
	type WakeLine,
	isEmptyListing,
	monitorConversationRows,
	scheduledTaskRows,
	supervisorLead,
	wakePromptHead,
} from "../scheduled-task-model";
import { MonitorConversationRow } from "./monitor-conversation-row";
import { ScheduleFormDialog } from "./schedule-form-dialog";
import { ScheduleListItem } from "./schedule-list-item";
import {
	ScheduledTaskDialog,
	type WakeEditTarget,
} from "./scheduled-task-dialog";
import { WakeConversationRow } from "./wake-conversation-row";

/**
 * The page's section heading register: the legacy group's `h2`
 * (`text-heading text-ink`, 16px semibold), reused for the Wakes and Monitors
 * labels (design D2) so a group heading reads above the 13px row names it
 * heads rather than as one more row. No new token.
 */
const SECTION_HEADING_CLASS = "px-4 pt-3 pb-1 text-heading text-ink";

/** The one-row confirm for cancelling an armed wake. */
type PendingCancel = { row: ScheduledTaskRow; wake: WakeLine };

/** Which dialog is open, if any: the page has one slot for both branches. */
type DialogState = { mode: "create" } | ({ mode: "edit" } & WakeEditTarget);

export type SchedulesPageProps = {
	/**
	 * The instant every label on the page is derived against.
	 *
	 * Injectable for the same reason the run pane's model takes `nowMs`: a story
	 * that pins it renders the SAME labels on every capture, so a diff in the
	 * committed frames means the code moved rather than that the capture ran on
	 * another day. In the app it is the clock, read once per render.
	 */
	nowMs?: number;
};

export const SchedulesPage: FC<SchedulesPageProps> = ({
	nowMs = Date.now(),
}) => {
	useI18nLocale();
	const navigate = useNavigate();
	const [dialog, setDialog] = useState<DialogState | null>(null);
	const [pendingCancel, setPendingCancel] = useState<PendingCancel | null>(
		null,
	);
	const [editingLegacy, setEditingLegacy] = useState<ScheduleResponse | null>(
		null,
	);

	const listing = useWakesListing();
	const monitorsListing = useMonitorsListing();
	/*
	 * The pane's cancel interaction, driven by the page's key-splitting controls.
	 * `sessionId: null` because the hook's only use of it is a reset when the
	 * pane switches conversation, and this page never switches: its row keys are
	 * machine-unique (`monitorRowKey`), so no record can be read against the
	 * wrong session. Owned HERE, above the section, so the confirmation survives
	 * the re-read that drops a conversation's last watch.
	 */
	const monitorControls = useMonitorListingControls();
	const monitorCancel = useMonitorCancel({
		sessionId: null,
		controls: monitorControls,
	});
	const queryClient = useQueryClient();
	/*
	 * What this page knows about the chief of staff, read from the same shared
	 * `aida.status` cache entry the sidebar and the chat pane read
	 * (`use-aida-target.ts`), so no two surfaces can disagree about whose
	 * conversation a row is. The guard reads it through `wakeControlMode`; this
	 * page uses only the two halves it needs here (`sessionIsChiefOfStaff` for the
	 * confirmation's copy, and the mode for the managed lines' state).
	 */
	const capabilities = useDesktopCapabilities();
	const aidaEnabled = desktopFeatureEnabled(capabilities.data, "aida", 1);
	const aidaTarget = useAidaTarget(aidaEnabled);
	const aidaName = useAidaDisplayName();
	const wakeAida: AidaWakeIdentity = {
		capability: aidaEnabled,
		statusResolved: aidaTarget.isSuccess,
		sessionId: aidaTarget.data?.session_id ?? null,
		name: aidaName,
	};
	/*
	 * ONE refresh for the page rather than one reader's, and every control that
	 * offers a refresh calls it. The header control used to reload the wake listing
	 * alone, so the fenced legacy annex - its own query - did not move with it and
	 * a legacy row added in another window appeared only on the page's next mount
	 * (QA round 1, Q2). A second refresh that covers one read is the defect, not the
	 * redundancy: there is nothing to keep in step if there is one call.
	 */
	const refreshAll = () => {
		void listing.refetch();
		void monitorsListing.refetch();
		void invalidateLegacySchedules(queryClient);
	};
	const legacy = useListAllSchedules();
	const cancelWake = useCancelWake();
	const editLegacy = useEditSchedule();
	const removeLegacy = useRemoveSchedule();

	const legacyRows = legacy.data?.result?.schedules ?? [];
	const supervisor = listing.data?.supervisor;

	/*
	 * Can anything on this machine actually fire?
	 *
	 * `verifiable: false` is the third term and it is not decoration: a store
	 * outside the real home is supervised by nothing, so `supported`/`running`
	 * there describe the OPERATOR's launchd rather than this store's (the
	 * backend's own `_supervisor_info`). Reading that silence as "running" is how
	 * a page ends up promising a fire it cannot cause.
	 */
	const canFire =
		supervisor?.supported === true &&
		supervisor.running === true &&
		supervisor.verifiable !== false;

	/*
	 * `nowMs` is read once per render: a due label is true of the moment it is
	 * drawn, and the listing's own poll is what moves it on.
	 */
	const rows = scheduledTaskRows(listing.data?.entries, nowMs, {
		dueInstants: canFire,
	});

	/* Same instant, same pass: both sections' labels are true of one moment. */
	const monitorRows = monitorConversationRows(
		monitorsListing.data?.entries,
		nowMs,
	);

	const openConversation = (sessionId: string) => {
		void useCanonicalSessionsStore
			.getState()
			.openSession(sessionId)
			.then((opened) => {
				if (opened) navigate(`/chat/${sessionId}`);
			});
	};

	/**
	 * Whether the open confirmation may NAME the chief of staff.
	 *
	 * Decided at the same level as the modal that uses it, from the row the
	 * confirmation is ABOUT (not from whatever the list holds later): a cancel
	 * pressed on one row and a listing that moved under it must not turn the
	 * question into one about a different conversation.
	 */
	const namedCancel =
		pendingCancel !== null &&
		sessionIsChiefOfStaff(pendingCancel.row.sessionId, wakeAida);

	const handleCancelWake = async () => {
		if (!pendingCancel) return;
		const { row, wake } = pendingCancel;
		try {
			const sessionId = row.sessionId;
			await cancelWake.mutateAsync({
				sessionId,
				wakeId: wake.id,
			});
			/*
			 * The toast carries the way back. The confirm says "The conversation
			 * stays." and, when this was the last wake, the row that held the door
			 * open is gone - leaving the promise with no path to it (round-2 U6).
			 */
			showSuccessToast(t("ui.schedules.schedules_page.wake_cancelled"), {
				action: {
					get label() {
						return t("ui.schedules.schedules_page.open_conversation");
					},
					onClick: () => openConversation(sessionId),
				},
			});
			setPendingCancel(null);
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? t("ui.schedules.schedules_page.could_not_cancel_the_wake_message", {
							message: String(error.message),
						})
					: t("ui.schedules.schedules_page.could_not_cancel_the_wake"),
			);
		}
	};

	/** The legacy group's own edit path: same engine, same ops as before. */
	const handleSubmitLegacy = async (
		data: Parameters<typeof editLegacy.mutateAsync>[0]["scheduleData"],
	) => {
		if (!editingLegacy) return;
		try {
			await editLegacy.mutateAsync({
				scheduleId: editingLegacy.id,
				scheduleData: data,
			});
			showSuccessToast(t("ui.schedules.schedules_page.schedule_updated"));
			setEditingLegacy(null);
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? t(
							"ui.schedules.schedules_page.could_not_save_the_schedule_message",
							{ message: String(error.message) },
						)
					: t("ui.schedules.schedules_page.could_not_save_the_schedule"),
			);
		}
	};

	const handleRemoveLegacy = async (scheduleId: string) => {
		const schedule = legacyRows.find((row) => row.id === scheduleId);
		try {
			await removeLegacy.mutateAsync({
				scheduleId,
				agentId: schedule?.agent_id,
			});
			showSuccessToast(t("ui.schedules.schedules_page.schedule_removed"));
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? t(
							"ui.schedules.schedules_page.could_not_remove_the_schedule_message",
							{ message: String(error.message) },
						)
					: t("ui.schedules.schedules_page.could_not_remove_the_schedule"),
			);
		}
	};

	const handleToggleLegacy = async (schedule: ScheduleResponse) => {
		try {
			await editLegacy.mutateAsync({
				scheduleId: schedule.id,
				scheduleData: { is_active: !schedule.is_active },
			});
			showSuccessToast(
				schedule.is_active
					? t("ui.schedules.legacy.deactivated")
					: t("ui.schedules.legacy.activated"),
			);
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? t(
							"ui.schedules.schedules_page.could_not_toggle_the_schedule_message",
							{ message: String(error.message) },
						)
					: t("ui.schedules.schedules_page.could_not_toggle_the_schedule"),
			);
		}
	};

	/*
	 * Empty means BOTH lists settled, both are genuinely empty, AND the wake
	 * listing could be READ. The legacy half is awaited too, or a page whose wake
	 * listing answered first would flash "No scheduled tasks yet" over a machine
	 * that still has legacy rows to load. `read_error` is the third condition and
	 * the one that was missing: it is a 200, so the strip above could say the list
	 * was unreadable while the state beneath it told a user with thirty schedules
	 * that they had none (round-2 D13/U8). The predicate lives in the model so a
	 * test can hold it.
	 */
	const isEmpty = isEmptyListing({
		loading: listing.isLoading,
		error: listing.error !== null,
		readError: listing.data?.read_error === true,
		wakeRows: rows.length,
		legacyLoading: legacy.isLoading,
		legacyRows: legacyRows.length,
		monitorsLoading: monitorsListing.isLoading,
		monitorsError: monitorsListing.error !== null,
		monitorsReadError: monitorsListing.data?.read_error === true,
		monitorRows: monitorRows.length,
	});
	const monitorsReadError =
		!monitorsListing.isLoading && monitorsListing.data?.read_error === true;
	/* Something to say about monitors: rows, a failed read, or an unreadable index. */
	const hasMonitorSection =
		monitorRows.length > 0 ||
		monitorsListing.error !== null ||
		monitorsReadError;

	return (
		<div className="flex h-full flex-col gap-8 p-6">
			<PageHeader
				variant="compact"
				title={t("ui.schedules.schedules_page.schedules")}
			>
				{/*
				 * A way to ask for a fresh read, because the listing's own poll is a
				 * 30 s interval and a state a user changed in another pane of this
				 * window can be up to a poll behind (round-2 U3: a conversation
				 * un-parked by a turn still read `Parked` at the next read). The
				 * interval stays - the poll is what keeps the page honest without a
				 * press - and this is the press for when the user knows it moved.
				 */}
				{/* Keep refresh and create adjacent at narrow widths. */}
				<div className="flex items-center gap-2">
					<Button
						variant="secondary"
						size="icon"
						aria-label={t(
							"ui.schedules.schedules_page.refresh_scheduled_tasks",
						)}
						title={t("ui.schedules.schedules_page.refresh_scheduled_tasks")}
						disabled={listing.isFetching || monitorsListing.isFetching}
						onClick={refreshAll}
						data-tour-tag="refresh-schedules-button"
					>
						<RefreshCw />
					</Button>
					<Button
						variant="secondary"
						size="md"
						onClick={() => setDialog({ mode: "create" })}
						data-tour-tag="create-schedule-button"
					>
						<Plus />
						{t("ui.schedules.schedules_page.new_scheduled_task")}
					</Button>
				</div>
			</PageHeader>

			{/*
			 * The list frame: panel-tier 10 and no edge, the board/list/timeline
			 * panels' treatment (docs/branding.md § 2, § 5) — the rows inside keep
			 * their own hairlines, which is where the separation belongs on a list.
			 */}
			<div
				data-glass-region="panel"
				className="min-h-0 flex-1 overflow-y-auto rounded-md bg-surface"
			>
				{/* The page keeps its chrome while loading, so nothing jumps when
				    the rows arrive. No skeleton rows: the app reserves those for a
				    list whose length is known before it loads. */}
				{listing.isLoading && (
					<div className="flex justify-center py-16">
						<Spinner
							label={t("ui.schedules.schedules_page.loading_scheduled_tasks")}
						/>
					</div>
				)}

				{listing.error && (
					/* Three parts, in the app's own voice: what happened, what it
					   means, and what to do about it. The bare `Error fetching
					   schedules: <exception>` this replaces had one of the three and
					   no way back. */
					<div className="flex flex-col items-start gap-2 border-hairline border-b p-4">
						<p className="text-body text-ink">
							{t("ui.schedules.schedules_page.could_not_load_scheduled_tasks")}
						</p>
						<p className="text-body-sm text-ink-muted">
							{listing.error.message}
						</p>
						{/* React Query keeps serving the last answer, so rows under this
						    strip are the last list that LOADED rather than a claim about
						    now - and they used to assert `1 wake` each with nothing saying
						    so (round-2 U4). */}
						{(rows.length > 0 || legacyRows.length > 0) && (
							<p className="text-body-sm text-ink-muted">
								{t(
									"ui.schedules.scheduled_task_model.the_list_below_is_the_last_one_that_loaded_so_it_may_be_out_of_da",
								)}
							</p>
						)}
						<Button variant="secondary" size="sm" onClick={refreshAll}>
							{t("ui.schedules.schedules_page.try_again")}
						</Button>
					</div>
				)}

				{/* A listing that answered but could not READ the store is not an
				    empty store, and saying "no scheduled tasks" there would be a
				    claim the backend did not make. */}
				{!listing.isLoading && listing.data?.read_error && (
					<div className="flex flex-col items-start gap-2 border-hairline border-b p-4">
						<Alert variant="warning">
							{t(
								"ui.schedules.schedules_page.could_not_read_this_machine_s_scheduled_tasks_so_the_list_below_m",
							)}
						</Alert>
						{/* The partial failure had no way back either: the only recovery
						    was to leave the page and return (the designer's D6). Same
						    `refetch` the total-failure branch uses, because it is the same
						    recovery. */}
						<Button variant="secondary" size="sm" onClick={refreshAll}>
							{t("ui.schedules.schedules_page.try_again")}
						</Button>
					</div>
				)}

				{/* "Will my scheduled task actually fire" is not answerable from the
				    index: on macOS the supervisor is a LaunchAgent, and a listing
				    that omitted this would invite trusting a dead schedule. */}
				{!listing.isLoading && supervisor && !canFire && (
					<div className="border-hairline border-b p-4">
						<Alert variant="warning">{supervisorLead(supervisor)}</Alert>
						{/*
						 * The backend's own words, on their own line and in machine
						 * voice: `launchd reports the agent as not running` is a bug
						 * report's sentence, not a user's, and appending it to the lead
						 * sentence with no terminal period was two voices in one line
						 * (the designer's D6). `text-mono` is the role branding reserves
						 * for machine output.
						 */}
						{supervisor.detail && (
							<p className="mt-2 font-mono text-meta text-ink-dim">
								{supervisor.detail}
							</p>
						)}
					</div>
				)}

				{isEmpty && (
					/* An empty state that names the easier route rather than just
					   reporting the absence - and after this change that promise is
					   true: a wake an agent armed in chat appears on this page. */
					<div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
						<p className="text-heading text-ink">
							{t("ui.schedules.schedules_page.no_scheduled_tasks_yet")}
						</p>
						<p className="max-w-100 text-body-sm text-ink-muted">
							{t(
								"ui.schedules.schedules_page.ask_an_agent_in_chat_to_do_something_on_a_regular_basis_send_me_t",
							)}
						</p>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setDialog({ mode: "create" })}
							className="mt-2"
						>
							<Plus />
							{t("ui.schedules.schedules_page.new_scheduled_task")}
						</Button>
					</div>
				)}

				{/*
				 * `Wakes` is labelled only when the Monitors section is also on the
				 * page (UX U5, design D2). With one family the page title already
				 * names the list and a lone heading adds a line of chrome above every
				 * row - and keeps the wakes-only page byte-identical to what it was
				 * before monitors joined it; with two, labelling only one made the
				 * other read as unlabelled leftovers. Same component and class as the
				 * Monitors heading, so the two families match.
				 */}
				{rows.length > 0 && hasMonitorSection && (
					<h2 className={SECTION_HEADING_CLASS}>
						{t("ui.chat.run_details.wakes.title")}
					</h2>
				)}
				{rows.length > 0 && (
					<ul className="flex flex-col">
						{rows.map((row) => (
							<WakeConversationRow
								key={row.sessionId}
								row={row}
								onOpen={openConversation}
								identity={wakeAida}
								onCancel={(target, wake) =>
									setPendingCancel({ row: target, wake })
								}
								onEdit={(target, wake) =>
									setDialog({
										mode: "edit",
										sessionId: target.sessionId,
										wakeId: wake.id,
										message: wake.message,
										conversationName: target.name,
										position: wake.position,
										count: target.wakes.length,
										wake: wake.source,
										parked: target.parked,
									})
								}
							/>
						))}
					</ul>
				)}

				{/* The wake footnotes sit directly under the wake list, ABOVE the
				    Monitors section (agent review round 1, R1-2 / QA Q-1): below it,
				    "Showing N of M conversations with wakes" and the park sentence read
				    as if they described the monitor rows. */}
				{/* The listing is capped (the backend's own default), and past the cap
				    the page would otherwise under-report silently - `truncated` exists
				    so a client can say "showing N of M" (the reviewer's R7). */}
				{!listing.isLoading && listing.data?.truncated && (
					<p className="border-hairline border-t px-4 py-3 text-body-sm text-ink-dim">
						{t("ui.schedules.count.list_truncated", {
							shown: listing.data.entries.length,
							total: listing.data.total,
						})}
					</p>
				)}

				{/* The one sentence this page owes the reader, and the question the
				    whole feature raises: what happens when nobody is looking.
				    The FIRE half is gated on the supervisor, because when nothing can
				    fire that sentence is false on this screen - the strip below the
				    header carries that truth instead (the designer's D2). The PARK
				    half names the stop that parks and the stop that does not, because
				    the app's own `POST /v1/desktop/stop` writes no durable marker, and
				    says a TURN resumes them rather than the act of opening (round-2
				    U9; the two measurements are in `PARK_FOOTER_CLAUSE`'s own note). */}
				{(rows.length > 0 || legacyRows.length > 0) && (
					<p className="border-hairline border-t px-4 py-3 text-body-sm text-ink-dim">
						{canFire
							? t(
									"ui.schedules.schedules_page.wakes_fire_whether_or_not_this_window_is_open",
								)
							: ""}
						{t(
							"ui.schedules.scheduled_task_model.a_terminal_stop_parks_a_conversation_s_wakes_until_its_next_turn",
						)}
					</p>
				)}
				{/*
				 * The Monitors section (#1898): after the wakes, labelled, one row per
				 * conversation. Present whenever there is something to say about
				 * monitors - rows, a failed read, or an index that could not be read -
				 * and absent otherwise, the pane's "absence is not a state" rule: a
				 * machine with no watches shows no empty heading.
				 */}
				{hasMonitorSection && (
					/*
					 * `first:border-t-0` (design D3): the hairline separates this section
					 * from the wakes above it; on a monitors-only page nothing precedes it
					 * and the border drew a stray line on the panel's top edge. Every
					 * block above renders conditionally, so "first child" is exactly
					 * "nothing above".
					 */
					<section
						data-schedules-monitors-section
						aria-labelledby="schedules-monitors-heading"
						className="border-hairline border-t first:border-t-0"
					>
						{/* `tabIndex={-1}` + `data-monitor-focus-fallback`: the cancel
						    interaction's last focus target once no Cancel follows the one
						    that was pressed (UX U1, `use-monitor-cancel.ts`). */}
						<h2
							id="schedules-monitors-heading"
							tabIndex={-1}
							data-monitor-focus-fallback
							className={`${SECTION_HEADING_CLASS} outline-none`}
						>
							{t("ui.chat.run_details.monitors.title")}
						</h2>
						{/* The wake listing's failure strip, scoped to this section: the
						    two reads fail independently, so one failing must not blank or
						    discredit the other's rows. */}
						{monitorsListing.error && (
							<div className="flex flex-col items-start gap-2 border-hairline border-b px-4 pb-3">
								<p className="text-body text-ink">
									{t("ui.schedules.monitors.could_not_load_monitors")}
								</p>
								<p className="text-body-sm text-ink-muted">
									{monitorsListing.error.message}
								</p>
								<Button variant="secondary" size="sm" onClick={refreshAll}>
									{t("ui.schedules.schedules_page.try_again")}
								</Button>
							</div>
						)}
						{monitorsReadError && (
							<div className="flex flex-col items-start gap-2 border-hairline border-b px-4 pb-3">
								<Alert variant="warning">
									{t("ui.schedules.monitors.could_not_read_monitors")}
								</Alert>
								<Button variant="secondary" size="sm" onClick={refreshAll}>
									{t("ui.schedules.schedules_page.try_again")}
								</Button>
							</div>
						)}
						{monitorRows.length > 0 && (
							<ul className="flex flex-col">
								{monitorRows.map((row) => (
									<MonitorConversationRow
										key={row.sessionId}
										row={row}
										onOpen={openConversation}
										cancel={monitorCancel.section}
									/>
								))}
							</ul>
						)}
						{/* The route caps the listing (200 by default) and says so through
						    `truncated`; past it the section would under-report silently. */}
						{monitorsListing.data?.truncated && (
							<p className="border-hairline border-t px-4 py-3 text-body-sm text-ink-dim">
								{t("ui.schedules.monitors.list_truncated", {
									shown: monitorsListing.data.entries.length,
									total: monitorsListing.data.total,
								})}
							</p>
						)}
					</section>
				)}

				{/*
				 * The fenced legacy group. It appears only when a legacy row exists,
				 * and it says what it is: the rows here run on the older engine, each
				 * run starting a fresh agent with approvals granted automatically -
				 * which is the posture a wake does NOT have, stated in the dialog that
				 * creates one.
				 */}
				{(legacyRows.length > 0 || legacy.error) && (
					/*
					 * `bg-sunken` rather than the rows' `surface`: the designer's D5
					 * measured the fence as a PEER of the list above it (same ground,
					 * same type steps, same hairlines), and the note that a list is the
					 * wrong host for engine prose. It is an annex now - a different
					 * ground, and one sentence instead of three, because the posture it
					 * describes is stated in the dialog that creates its replacement.
					 */
					<section className="border-hairline border-t bg-sunken">
						<div className="flex flex-col gap-1 px-4 py-3">
							<h2 className="text-heading text-ink">
								{t("ui.schedules.schedules_page.legacy_schedules")}
							</h2>
							<p className="max-w-150 text-body-sm text-ink-muted">
								{t(
									"ui.schedules.schedules_page.these_run_on_the_older_agent_schedule_engine_new_scheduled_tasks",
								)}
							</p>
							{legacy.error && (
								<p className="text-body-sm text-danger">
									{t(
										"ui.schedules.schedules_page.could_not_load_legacy_schedules",
									)}
									{legacy.error.message}
								</p>
							)}
						</div>
						{legacyRows.map((schedule) => (
							<ScheduleListItem
								key={schedule.id}
								schedule={schedule}
								nowMs={nowMs}
								onEdit={() => setEditingLegacy(schedule)}
								onDelete={handleRemoveLegacy}
								onToggleActive={handleToggleLegacy}
							/>
						))}
					</section>
				)}
			</div>

			{/* ONE dialog, two branches: the page has one slot, so the create form
			    and the editor cannot both be open, and switching between them is a
			    change of state rather than a race between two dialogs. */}
			<ScheduledTaskDialog
				open={dialog !== null}
				onClose={() => setDialog(null)}
				nowMs={nowMs}
				edit={dialog?.mode === "edit" ? dialog : null}
			/>

			{/* The legacy group's editor, kept for the rows that still run on that
			    engine. It is never opened with no `initialData` any more: creating a
			    schedule there is what this page stopped doing. */}
			<ScheduleFormDialog
				open={editingLegacy !== null}
				onClose={() => setEditingLegacy(null)}
				onSubmit={(data) => handleSubmitLegacy(data)}
				initialData={editingLegacy}
			/>

			{/*
			 * The one confirmation for a cancel, with the SAME copy builders the pane's
			 * card uses (`wake-controls-model.ts`), so the two surfaces cannot ask this
			 * question two ways. `named` is the guard's own arm: only a row on a
			 * conversation KNOWN to be the chief of staff's puts her name on the
			 * question and on the button; every other row keeps the neutral wording.
			 */}
			{/* The monitor cancel's confirmation: the run pane's own dialog, so the
			    question, its `Keep` default and an in-dialog refusal read the same
			    on both surfaces. */}
			<MonitorCancelDialog {...monitorCancel.dialog} />

			<ConfirmationModal
				open={pendingCancel !== null}
				title={wakeConfirmTitle(namedCancel, wakeAida.name)}
				message={
					pendingCancel
						? wakeConfirmSentence({
								named: namedCancel,
								name: wakeAida.name,
								head: wakePromptHead(pendingCancel.wake.message),
							})
						: ""
				}
				confirmText={wakeConfirmActionLabel(namedCancel)}
				cancelText={t("ui.schedules.schedules_page.keep")}
				isDangerous
				onConfirm={() => void handleCancelWake()}
				onCancel={() => setPendingCancel(null)}
			/>
		</div>
	);
};
