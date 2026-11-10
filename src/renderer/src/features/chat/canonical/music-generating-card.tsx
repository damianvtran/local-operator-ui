import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { useContext, useEffect, useState } from "react";
import {
	type MusicGeneratingView,
	MusicJobSettlementsContext,
	MusicJobsLiveContext,
	musicGeneratingView,
	musicJobIdOf,
} from "./music-generating-model";
import { MusicJobMotif } from "./music-job-motif";

const stateLine = (view: MusicGeneratingView): string => {
	switch (view.state) {
		case "queued":
			return t("ui.music.queued");
		case "generating":
			if (view.modify) return t("ui.music.modifying");
			return view.total > 1
				? t("ui.music.generating_tracks", { count: view.total })
				: t("ui.music.generating");
		case "cancel_requested":
			return t("ui.music.cancel_requested");
		case "done":
			return t("ui.music.ready");
		case "failed":
			return t("ui.music.job_failed");
		case "cancelled":
			return t("ui.music.job_cancelled");
		case "unavailable":
			return t("ui.music.job_status.unavailable");
	}
};

/**
 * The in-chat generating card for one detached music job (see
 * `music-generating-model.ts` for where each state comes from).
 *
 * GEOMETRY IS STATE-INDEPENDENT: every state paints the same two rows — the
 * state line and the motif's fixed 240×44 box — and the Cancel control sits in
 * its own column beside them, so the card does not change height when the job
 * settles or the control leaves. The finished audio is NOT drawn here: it stays
 * on the existing `job_result` row (`MusicResult`), unchanged, so the transcript
 * never paints one purchased track twice. The motif animates only while the
 * provider is working, and only under `motion-safe`, so reduced motion paints
 * the identical box at rest.
 */
export const MusicGeneratingCard = ({
	view,
	onCancel,
}: {
	view: MusicGeneratingView;
	/** Asks the chat's confirm flow to cancel `view.cancelRow`; absent = no control. */
	onCancel?: (rect: DOMRect) => void;
}) => {
	const cost = view.cost;
	return (
		<div
			data-music-generating={view.jobId}
			data-music-state={view.state}
			className={cn("mt-2 flex min-w-0 items-start gap-2")}
		>
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				<p
					aria-live="polite"
					className={cn(
						"text-body-sm",
						view.state === "failed" ? "text-danger" : "text-ink",
					)}
				>
					{stateLine(view)}
					{cost && <span className={cn("text-ink-muted")}> {cost}</span>}
				</p>
				<MusicJobMotif
					active={view.state === "generating"}
					completed={view.completed}
					total={view.total}
				/>
			</div>
			{view.cancelRow && onCancel && (
				<Button
					variant="ghost"
					size="sm"
					data-music-cancel={view.jobId}
					aria-label={t("ui.chat.run_details.job_cancel_aria", {
						label: view.cancelRow.label,
					})}
					// The Jobs row's own control styling: the same act, one surface over.
					className={cn(
						"h-6 shrink-0 px-1.5 hover:bg-danger-wash hover:text-danger",
					)}
					onClick={(event) =>
						onCancel(event.currentTarget.getBoundingClientRect())
					}
				>
					{t("ui.common.actions.cancel")}
				</Button>
			)}
		</div>
	);
};

/**
 * How long a job id may be missing from loaded run details before the card
 * calls its status unavailable. The call's result (carrying the job id) and the
 * run-details frame that first lists the job arrive separately, so a freshly
 * launched job is briefly absent from a loaded list; without this window every
 * launch would flash "status unavailable" before "queued". A job lost across a
 * restart stays absent, so it still reaches the unavailable state (R15-4).
 */
export const MUSIC_JOB_MISSING_GRACE_MS = 5000;

/**
 * The transcript's mount: derives the view from the call's record plus the two
 * contexts, or renders nothing (null) so the caller keeps the ordinary row.
 */
export const useMusicGeneratingView = (
	toolName: string,
	details: unknown,
): MusicGeneratingView | null => {
	const live = useContext(MusicJobsLiveContext);
	const settlements = useContext(MusicJobSettlementsContext);
	const jobId = musicJobIdOf(details);
	const row = jobId ? live?.rows.get(jobId) : undefined;
	const settlement = jobId ? settlements.get(jobId) : undefined;
	const missing =
		jobId !== null && live?.loaded === true && !row && !settlement;
	// Keyed by job id so a recycled row never inherits another job's elapsed grace.
	const [graceOver, setGraceOver] = useState<string | null>(null);
	useEffect(() => {
		if (!missing || jobId === null) return;
		const timer = setTimeout(
			() => setGraceOver(jobId),
			MUSIC_JOB_MISSING_GRACE_MS,
		);
		return () => clearTimeout(timer);
	}, [missing, jobId]);
	return musicGeneratingView({
		toolName,
		details,
		row,
		settlement,
		liveLoaded: missing && graceOver === jobId,
	});
};

export const ConnectedMusicGeneratingCard = ({
	view,
}: {
	view: MusicGeneratingView;
}) => {
	const live = useContext(MusicJobsLiveContext);
	const request = live?.request ?? null;
	const row = view.cancelRow;
	return (
		<MusicGeneratingCard
			view={view}
			onCancel={
				request && row
					? (rect) =>
							// The rect is frozen at the press, as the Jobs row does: the
							// card can re-render under the canonical re-read a cancel fires.
							request(row, {
								left: rect.left,
								top: rect.top,
								bottom: rect.bottom,
								right: rect.right,
							})
					: undefined
			}
		/>
	);
};
