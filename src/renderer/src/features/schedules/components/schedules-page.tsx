/**
 * The Schedules page: every conversation on this machine that has wakes, with
 * its wakes beneath it, plus the fenced group of rows still on the older
 * agent-schedule engine.
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
 * The run pane's Wakes section is a readout: a schedule is read there and
 * cancelled by the agent, which is right for a pane watching a live turn. This
 * page's job is managing scheduled work - it is where one is created - so the
 * bar moves here: each wake line offers `Cancel wake`, behind a confirm that
 * names the prompt and says the conversation stays. Pause is deliberately NOT
 * offered: the wake model has no `paused_at`, so a toggle could only be
 * implemented as cancel-and-re-arm, which would silently reset `fired_count`
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
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button } from "@shared/components/ui";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { CalendarDays, Plus, RefreshCw } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	useEditSchedule,
	useListAllSchedules,
	useRemoveSchedule,
} from "../hooks/use-schedules-queries";
import { useCancelWake, useWakesListing } from "../hooks/use-wakes-queries";
import {
	PARK_FOOTER_CLAUSE,
	STALE_ROWS_CLAUSE,
	type ScheduledTaskRow,
	type WakeLine,
	isEmptyListing,
	scheduledTaskRows,
	supervisorLead,
	wakePromptHead,
} from "../scheduled-task-model";
import { ScheduleFormDialog } from "./schedule-form-dialog";
import { ScheduleListItem } from "./schedule-list-item";
import {
	ScheduledTaskDialog,
	type WakeEditTarget,
} from "./scheduled-task-dialog";
import { WakeConversationRow } from "./wake-conversation-row";

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
	const navigate = useNavigate();
	const [dialog, setDialog] = useState<DialogState | null>(null);
	const [pendingCancel, setPendingCancel] = useState<PendingCancel | null>(
		null,
	);
	const [editingLegacy, setEditingLegacy] = useState<ScheduleResponse | null>(
		null,
	);

	const listing = useWakesListing();
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

	const openConversation = (sessionId: string) => {
		void useCanonicalSessionsStore
			.getState()
			.openSession(sessionId)
			.then((opened) => {
				if (opened) navigate(`/chat/${sessionId}`);
			});
	};

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
			showSuccessToast("Wake cancelled", {
				action: {
					label: "Open conversation",
					onClick: () => openConversation(sessionId),
				},
			});
			setPendingCancel(null);
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? `Could not cancel the wake: ${error.message}`
					: "Could not cancel the wake.",
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
			showSuccessToast("Schedule updated");
			setEditingLegacy(null);
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? `Could not save the schedule: ${error.message}`
					: "Could not save the schedule.",
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
			showSuccessToast("Schedule removed");
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? `Could not remove the schedule: ${error.message}`
					: "Could not remove the schedule.",
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
				`Schedule ${schedule.is_active ? "deactivated" : "activated"}.`,
			);
		} catch (error) {
			showErrorToast(
				error instanceof Error
					? `Could not toggle the schedule: ${error.message}`
					: "Could not toggle the schedule.",
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
	});

	return (
		/* `gap-8`: `PageHeader` no longer ships its own bottom margin. */
		<div className="flex h-full flex-col gap-8 p-6">
			<PageHeader
				title="Schedules"
				icon={CalendarDays}
				subtitle="Work your conversations do on a schedule, repeating or once."
			>
				{/*
				 * A way to ask for a fresh read, because the listing's own poll is a
				 * 30 s interval and a state a user changed in another pane of this
				 * window can be up to a poll behind (round-2 U3: a conversation
				 * un-parked by a turn still read `Parked` at the next read). The
				 * interval stays - the poll is what keeps the page honest without a
				 * press - and this is the press for when the user knows it moved.
				 */}
				{/*
				 * The two header controls are ONE group, and the group is what
				 * `justify-between` places. As three siblings the icon was stranded
				 * mid-header (measured on `list`: icon box x=757..788 at the 60% mark,
				 * CTA x=1079..1255, 291 px of empty band between them) and at the app's
				 * minimum width the header wrapped so that the SECONDARY control held
				 * the right corner while `New scheduled task` dropped to its own line at
				 * the left edge - the primary action demoted below a secondary one. The
				 * group keeps them adjacent and wraps as a pair (design round 3).
				 */}
				<div className="flex items-center gap-2">
					<Button
						variant="secondary"
						size="icon"
						aria-label="Refresh scheduled tasks"
						title="Refresh scheduled tasks"
						disabled={listing.isFetching}
						onClick={() => void listing.refetch()}
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
						New scheduled task
					</Button>
				</div>
			</PageHeader>

			<div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-hairline bg-surface">
				{/* The page keeps its chrome while loading, so nothing jumps when
				    the rows arrive. No skeleton rows: the app reserves those for a
				    list whose length is known before it loads. */}
				{listing.isLoading && (
					<div className="flex justify-center py-16">
						<Spinner label="Loading scheduled tasks" />
					</div>
				)}

				{listing.error && (
					/* Three parts, in the app's own voice: what happened, what it
					   means, and what to do about it. The bare `Error fetching
					   schedules: <exception>` this replaces had one of the three and
					   no way back. */
					<div className="flex flex-col items-start gap-2 border-hairline border-b p-4">
						<p className="text-body text-ink">
							Could not load scheduled tasks.
						</p>
						<p className="text-body-sm text-ink-muted">
							{listing.error.message}
						</p>
						{/* React Query keeps serving the last answer, so rows under this
						    strip are the last list that LOADED rather than a claim about
						    now - and they used to assert `1 wake` each with nothing saying
						    so (round-2 U4). */}
						{(rows.length > 0 || legacyRows.length > 0) && (
							<p className="text-body-sm text-ink-muted">{STALE_ROWS_CLAUSE}</p>
						)}
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void listing.refetch()}
						>
							Try again
						</Button>
					</div>
				)}

				{/* A listing that answered but could not READ the store is not an
				    empty store, and saying "no scheduled tasks" there would be a
				    claim the backend did not make. */}
				{!listing.isLoading && listing.data?.read_error && (
					<div className="flex flex-col items-start gap-2 border-hairline border-b p-4">
						<Alert variant="warning">
							Could not read this machine's scheduled tasks, so the list below
							may be incomplete.
						</Alert>
						{/* The partial failure had no way back either: the only recovery
						    was to leave the page and return (the designer's D6). Same
						    `refetch` the total-failure branch uses, because it is the same
						    recovery. */}
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void listing.refetch()}
						>
							Try again
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
						<p className="text-heading text-ink">No scheduled tasks yet</p>
						<p className="max-w-100 text-body-sm text-ink-muted">
							Ask an agent in chat to do something on a regular basis — “send me
							the news at 8am every day” — and it will appear here. You can also
							set one up by hand.
						</p>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setDialog({ mode: "create" })}
							className="mt-2"
						>
							<Plus />
							New scheduled task
						</Button>
					</div>
				)}

				{rows.length > 0 && (
					<ul className="flex flex-col">
						{rows.map((row) => (
							<WakeConversationRow
								key={row.sessionId}
								row={row}
								onOpen={openConversation}
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
							<h2 className="text-heading text-ink">Legacy schedules</h2>
							<p className="max-w-150 text-body-sm text-ink-muted">
								These run on the older agent-schedule engine. New scheduled
								tasks are created as wakes, in a conversation.
							</p>
							{legacy.error && (
								<p className="text-body-sm text-danger">
									Could not load legacy schedules. {legacy.error.message}
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

				{/* The listing is capped (the backend's own default), and past the cap
				    the page would otherwise under-report silently - `truncated` exists
				    so a client can say "showing N of M" (the reviewer's R7). */}
				{!listing.isLoading && listing.data?.truncated && (
					<p className="border-hairline border-t px-4 py-3 text-body-sm text-ink-dim">
						Showing {listing.data.entries.length} of {listing.data.total}{" "}
						conversations with wakes.
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
						{canFire ? "Wakes fire whether or not this window is open. " : ""}
						{PARK_FOOTER_CLAUSE}
					</p>
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

			<ConfirmationModal
				open={pendingCancel !== null}
				title="Cancel this wake?"
				message={
					pendingCancel
						? `“${wakePromptHead(pendingCancel.wake.message)}” will not fire again. The conversation stays.`
						: ""
				}
				confirmText="Cancel wake"
				cancelText="Keep"
				isDangerous
				onConfirm={() => void handleCancelWake()}
				onCancel={() => setPendingCancel(null)}
			/>
		</div>
	);
};
