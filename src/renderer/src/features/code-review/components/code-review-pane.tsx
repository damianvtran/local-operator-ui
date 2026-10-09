import { PanelNotice } from "@features/chat/pickers/panels/panel-states";
import { Button, Separator, Skeleton } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { PanelRightClose, RefreshCw } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import type { DesktopCodeRequestsList } from "../../../../../shared/desktop-contract";
import { coolingClauses, groupRows } from "../code-review-model";
import {
	useCodeRequests,
	useRefreshCodeRequests,
} from "../hooks/use-code-requests";
import { CodeReviewRow } from "./code-review-row";

/**
 * The Code review pane: the conversation's PR/MR ledger, in the right slot.
 *
 * THE CHROME IS THE SLOT'S OWN SHAPE (§9, "the run panel's exact shape"): one
 * `bg-elevated` column, a `h-10` bar with the OS-controls corner reserved, and
 * a `tabIndex={-1}` root under an `aria-label` so the pane can hold focus
 * without entering the tab order. Refresh and Close are the same two ghost
 * `icon-sm` controls every pane bar carries, with the family glyph
 * (`PanelRightClose`) for the close.
 *
 * THE FOUR STATES AND THE MIXED ONE (§6):
 * - LOADING is the cold read only - three skeleton rows and one sentence - and
 *   it is never drawn over painted rows, because the GET is local-first and a
 *   skeleton over data is a claim that the data is not there.
 * - EMPTY is a claim about an ANSWER and says so in the design's own sentence.
 * - ERROR is the GET itself failing: one notice and one Retry, no row-level
 *   failure ever reaches it.
 * - POPULATED draws the groups; a MIXED partial failure draws the rows WITH
 *   their own `Couldn't refresh` captions and adds only the cooling line - no
 *   panel-level error while any row is painted (§6, final bullet).
 *
 * THE BODY IS A SEPARATE COMPONENT because the stories own the states: a story
 * that pins `phase`, `data` and `nowMs` renders exactly the frame a review
 * judges, with the real rows and the real chrome, and no backend anywhere.
 */
export type CodeReviewPaneProps = {
	/** The conversation whose ledger this is. Never null: the pane mounts on a session. */
	sessionId: string;
	/** The session's transport is attached - the poll gate (§D.5). */
	sessionLive: boolean;
	onClose: () => void;
	/** A pinned clock, for story frames that must be reproducible. */
	nowMs?: number;
};

/**
 * The pane's clock for the `updated N min ago` tails, one tick a minute.
 *
 * A minute rather than the refetch cadence: the label is a reading of the wall
 * clock, and between refetches nothing else would move it - a failed refresh
 * leaves the row on screen for as long as the user looks at it. `nowMs` pins
 * the clock for stories; the interval is skipped there.
 */
function useMinuteClock(pinned?: number): number {
	const [now, setNow] = useState(() => pinned ?? Date.now());
	useEffect(() => {
		if (pinned !== undefined) return;
		const id = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(id);
	}, [pinned]);
	return pinned ?? now;
}

export type CodeReviewPaneBodyProps = {
	phase: "loading" | "error" | "ready";
	data: DesktopCodeRequestsList | undefined;
	refreshing: boolean;
	onRefresh: () => void;
	onClose: () => void;
	nowMs: number;
};

/** One group of rows under its header (§4): `Opened`, `Mentioned`. */
const RowGroup: FC<{
	label: string;
	rows: DesktopCodeRequestsList["rows"];
	nowMs: number;
}> = ({ label, rows, nowMs }) => (
	<section data-code-review-group={label.toLowerCase()}>
		<div
			className={cn("flex items-baseline justify-between gap-2 px-3 pt-2 pb-1")}
		>
			<span className={cn("text-meta text-ink-muted")}>{label}</span>
			<span className={cn("text-meta text-ink-dim")}>{rows.length}</span>
		</div>
		<ul className={cn("flex flex-col")}>
			{rows.map((row) => (
				<CodeReviewRow key={row.key} row={row} nowMs={nowMs} />
			))}
		</ul>
	</section>
);

export const CodeReviewPaneBody: FC<CodeReviewPaneBodyProps> = ({
	phase,
	data,
	refreshing,
	onRefresh,
	onClose,
	nowMs,
}) => {
	const cooling = coolingClauses(data?.cooling, nowMs);
	const groups = groupRows(data?.rows ?? []);
	return (
		<div
			data-code-review-pane=""
			aria-label="Code review"
			tabIndex={-1}
			className={cn("flex h-full flex-col bg-elevated")}
		>
			{/*
			 * The bar: title on the left, the two controls on the right, the OS
			 * caption corner reserved by padding (the console pane's own note says
			 * why padding and not a spacer here: this row's last child IS the
			 * control that must clear the buttons).
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 px-2",
					"[padding-inline-end:max(0.5rem,var(--chrome-inset-end-pane,var(--chrome-inset-end)))]",
				)}
				data-code-review-bar=""
			>
				<span className={cn("min-w-0 truncate text-meta text-ink-muted")}>
					Code review
				</span>
				<span className={cn("flex shrink-0 items-center gap-1")}>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Refresh code reviews"
						onClick={onRefresh}
						disabled={refreshing}
					>
						<RefreshCw aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close code review"
						onClick={onClose}
					>
						<PanelRightClose aria-hidden="true" />
					</Button>
				</span>
			</div>
			{/*
			 * The rate-limit line(s), directly under the bar and once per host (§5):
			 * row-level repetition of one host's window is noise, and the window is a
			 * fact about the HOST rather than about any row.
			 */}
			{cooling.length > 0 && (
				<div className={cn("flex flex-col gap-0.5 px-3 pb-1")}>
					{cooling.map((line) => (
						<span key={line} className={cn("text-meta text-ink-dim")}>
							{line}
						</span>
					))}
				</div>
			)}
			<div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto")}>
				{phase === "loading" && (
					<div className={cn("flex flex-col gap-2 px-3 py-3")}>
						{[0, 1, 2].map((row) => (
							<div
								key={`code-review-skeleton-${row}`}
								aria-hidden="true"
								className={cn("flex flex-col gap-1.5")}
							>
								<Skeleton className={cn("h-3 w-40")} />
								<Skeleton className={cn("h-3.5 w-full")} />
								<Skeleton className={cn("h-3 w-24")} />
							</div>
						))}
						<output className={cn("text-meta text-ink-dim")}>
							Loading code reviews…
						</output>
					</div>
				)}
				{phase === "error" && (
					<div className={cn("px-3 py-2")}>
						<PanelNotice
							kind="unavailable"
							text="Code reviews could not be read."
							detail="Nothing was lost — the session's record is unchanged."
						/>
						<Button
							variant="outline"
							size="sm"
							className={cn("mt-2")}
							onClick={onRefresh}
						>
							Retry
						</Button>
					</div>
				)}
				{phase === "ready" &&
					(groups.opened.length === 0 && groups.mentioned.length === 0 ? (
						<div className={cn("px-3 py-3")}>
							<PanelNotice
								kind="empty"
								text="No code reviews yet."
								detail="Pull requests and merge requests this session opens or mentions will appear here."
							/>
						</div>
					) : (
						<>
							{groups.opened.length > 0 && (
								<RowGroup label="Opened" rows={groups.opened} nowMs={nowMs} />
							)}
							{groups.opened.length > 0 && groups.mentioned.length > 0 && (
								<div className={cn("px-3 py-2")}>
									<Separator />
								</div>
							)}
							{groups.mentioned.length > 0 && (
								<RowGroup
									label="Mentioned"
									rows={groups.mentioned}
									nowMs={nowMs}
								/>
							)}
							{(data?.tool_output_only_count ?? 0) > 0 && (
								<span className={cn("px-3 py-2 text-meta text-ink-dim")}>
									{data?.tool_output_only_count} more seen in tool output
								</span>
							)}
						</>
					))}
			</div>
		</div>
	);
};

export const CodeReviewPane: FC<CodeReviewPaneProps> = ({
	sessionId,
	sessionLive,
	onClose,
	nowMs,
}) => {
	const query = useCodeRequests(sessionId, { visible: true, sessionLive });
	const refresh = useRefreshCodeRequests(sessionId);
	const clock = useMinuteClock(nowMs);
	const phase: CodeReviewPaneBodyProps["phase"] =
		query.data !== undefined ? "ready" : query.isError ? "error" : "loading";
	return (
		<CodeReviewPaneBody
			phase={phase}
			data={query.data}
			refreshing={refresh.isPending}
			onRefresh={() => {
				if (phase === "error") {
					void query.refetch();
					return;
				}
				refresh.mutate();
			}}
			onClose={onClose}
			nowMs={clock}
		/>
	);
};
