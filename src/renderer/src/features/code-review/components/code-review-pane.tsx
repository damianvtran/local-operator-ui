import { PanelNotice } from "@features/chat/pickers/panels/panel-states";
import { Button, Separator, Skeleton } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { PanelRightClose, RefreshCw } from "lucide-react";
import { type FC, type Ref, useEffect, useRef, useState } from "react";
import type { DesktopCodeRequestsList } from "../../../../../shared/desktop-contract";
import { COMPOSER_TEXTAREA_SELECTOR } from "../../chat/composer-field";
import { ownsEscapeOutsideComposer } from "../../chat/hooks/use-interrupt-on-escape";
import {
	coolingClauses,
	groupRows,
	toolOutputNote,
} from "../code-review-model";
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
	/*
	 * THE PRESS'S THREE ANSWERS (UX round 1, U3): the control spins while work
	 * is in flight (`refreshing`), says `Checked just now` once the post-press
	 * refetch has SETTLED (changed rows or not - "refreshed, nothing changed"
	 * must read differently from "did nothing"), and states what failed, in the
	 * pane's own quiet register, when the POST failed over painted rows.
	 * Optional on the body (defaults: false / null) so a story that pins the
	 * four states does not restate the press's feedback.
	 */
	checked?: boolean;
	/**
	 * The backend is still scanning this session (`scan_state: "refreshing"`):
	 * the loading skeleton stays up, and its caption says so (design round 2,
	 * N2 — the same frame for a 10 s scan and a 100 ms load left a long scan
	 * reading as a stall).
	 */
	scanning?: boolean;
	refreshFailed?: string | null;
	onRefresh: () => void;
	onClose: () => void;
	nowMs: number;
	/** The pane's own root, for a reveal request to focus (UX round 1, U11). */
	rootRef?: Ref<HTMLDivElement>;
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
	checked = false,
	scanning = false,
	refreshFailed = null,
	onRefresh,
	onClose,
	nowMs,
	rootRef,
}) => {
	const cooling = coolingClauses(data?.cooling, nowMs);
	const groups = groupRows(data?.rows ?? []);
	return (
		<div
			ref={rootRef}
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
				<span className={cn("flex min-w-0 items-baseline gap-2")}>
					<span className={cn("min-w-0 truncate text-meta text-ink-muted")}>
						Code review
					</span>
					{/*
					 * ALWAYS RENDERED, EMPTY WHEN IDLE (UX round 2, U21): a live
					 * region that only exists while it has something to say is
					 * not reliably announced when it appears; the element stays
					 * in the tree and its content flips instead. `<output>` is
					 * the platform's own status region - the same one the
					 * loading caption uses - rather than a `role` on a span.
					 */}
					<output className={cn("shrink-0 text-meta text-ink-dim")}>
						{checked ? "Checked just now" : ""}
					</output>
				</span>
				<span className={cn("flex shrink-0 items-center gap-1")}>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={
							refreshing ? "Refreshing code reviews" : "Refresh code reviews"
						}
						/*
						 * `aria-disabled`, NOT `disabled` (UX round 1, U3): a disabled
						 * button drops focus to `<body>` the moment Enter is pressed, so the
						 * keyboard user loses their place; the handler guards the busy case
						 * instead and the control keeps focus through the refetch.
						 */
						aria-disabled={refreshing}
						onClick={onRefresh}
					>
						<RefreshCw
							aria-hidden="true"
							className={cn(refreshing && "motion-safe:animate-spin")}
						/>
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
			 * The notices under the bar, in a slot whose height is RESERVED
			 * (UX round 1, U12): the cooling line growing in pushed every row down
			 * 22px and put the row under the pointer somewhere else; the slot is
			 * `min-h-5` whether or not it has anything to say (`pb-1` keeps the
			 * spacing those lines always carried).
			 *
			 * The rate-limit line(s) are once per host (§5), and the refresh's own
			 * failure rides the same register: a quiet caption, not a panel-level
			 * error over painted rows (§6).
			 */}
			<output className={cn("flex min-h-5 flex-col gap-0.5 px-3 pb-1")}>
				{cooling.length > 0 &&
					cooling.map((line) => (
						<span key={line} className={cn("text-meta text-ink-dim")}>
							{line}
						</span>
					))}
				{refreshFailed && (
					<span className={cn("text-meta text-ink-dim")}>{refreshFailed}</span>
				)}
			</output>
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
							{scanning ? "Scanning this session…" : "Loading code reviews…"}
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
									{toolOutputNote(
										data?.tool_output_only_count ?? 0,
										data?.tool_output_truncated === true,
									)}
								</span>
							)}
						</>
					))}
			</div>
		</div>
	);
};

/**
 * Whether an Escape target sits inside the composer's field.
 *
 * The mirror of `ownsEscapeOutsideComposer`'s own trick, for the one rung
 * ABOVE this pane: while a turn runs, the composer's press belongs to the
 * turn interrupt (agent review round 2, m1), so the pane leaves it unstamped.
 * A target that is not an element (a synthetic event, a text node) owns
 * nothing, and the pane keeps the press.
 */
function composerOwnsTarget(target: EventTarget | null): boolean {
	const closest = (
		target as { closest?: (selector: string) => unknown } | null | undefined
	)?.closest;
	if (typeof closest !== "function") return false;
	return closest.call(target, COMPOSER_TEXTAREA_SELECTOR) != null;
}

export const CodeReviewPane: FC<CodeReviewPaneProps> = ({
	sessionId,
	sessionLive,
	onClose,
	nowMs,
}) => {
	const query = useCodeRequests(sessionId, { visible: true, sessionLive });
	const refresh = useRefreshCodeRequests(sessionId);
	const clock = useMinuteClock(nowMs);
	const rootRef = useRef<HTMLDivElement>(null);
	const [feedback, setFeedback] = useState<"idle" | "pressed" | "checked">(
		"idle",
	);
	const refetchSeen = useRef(false);
	/** When the last press was taken; a failure older than the newest answer retires (U15). */
	const postPressAt = useRef(0);
	const [failure, setFailure] = useState<{
		at: number;
		message: string;
	} | null>(null);

	/*
	 * THE SCAN GATE (UX round 1, U2): `scan_state: "refreshing"` is the
	 * backend saying the index is being rebuilt for this journal, so an EMPTY
	 * answer is not yet a claim that the session has no code requests - the
	 * pane keeps its loading state until the scan settles (`ready`) or rows
	 * arrive. `missing` is NOT settling: there is no journal to scan, and the
	 * empty copy is the honest answer there.
	 */
	const scanSettling = query.data?.scan_state === "refreshing";
	const phase: CodeReviewPaneBodyProps["phase"] =
		query.data === undefined
			? query.isError
				? "error"
				: "loading"
			: scanSettling && (query.data.rows?.length ?? 0) === 0
				? "loading"
				: "ready";

	/*
	 * The post-press answer (UX round 1, U3; reworked in round 2, U14): the
	 * control spins through the POST *and* the refetch it triggers, then says
	 * `Checked just now` ONLY once that refetch settled SUCCESSFULLY - a
	 * failed read proves nothing and now leaves the failure cue instead
	 * (U14.1). `refetchSeen` is what tells a real refetch from the fresh
	 * ten-second window starving one, and the settle is read off `isFetching`
	 * falling - `dataUpdatedAt` is deliberately not a dependency of THAT
	 * effect (it would re-run it on every data change).
	 *
	 * The expiry lives in its OWN effect keyed on `feedback` (U14.2): in
	 * round 2 the timer was armed inside the settle effect and cleaned up by
	 * its own `setFeedback("checked")` state change, so it was cleared in the
	 * same commit it was set and the caption stood until the next press -
	 * measured still visible 113 s later. An effect that only reads `feedback`
	 * cannot cancel itself this way.
	 */
	useEffect(() => {
		if (feedback === "pressed" && query.isFetching) refetchSeen.current = true;
	}, [feedback, query.isFetching]);
	useEffect(() => {
		if (feedback !== "pressed" || !refetchSeen.current) return;
		if (query.isFetching) return;
		if (query.isError) {
			refetchSeen.current = false;
			setFeedback("idle");
			setFailure({
				at: postPressAt.current,
				message:
					query.error instanceof Error ? query.error.message : "try again",
			});
			return;
		}
		setFeedback("checked");
	}, [feedback, query.isFetching, query.isError, query.error]);
	useEffect(() => {
		if (feedback !== "checked") return;
		const id = window.setTimeout(() => setFeedback("idle"), 8_000);
		return () => window.clearTimeout(id);
	}, [feedback]);
	/*
	 * The failure line retires on a LATER SUCCESSFUL READ (UX round 2, U15):
	 * `refresh.isError` alone was sticky - only the next press replaced it -
	 * so the line is now a record with a timestamp, and any answer newer than
	 * it clears it. A read that keeps failing keeps the line, which is the
	 * point.
	 */
	useEffect(() => {
		if (!failure) return;
		if (query.dataUpdatedAt > failure.at) setFailure(null);
	}, [failure, query.dataUpdatedAt]);

	const onRefresh = () => {
		if (refresh.isPending || scanSettling) return;
		if (phase === "error") {
			void query.refetch();
			return;
		}
		refetchSeen.current = false;
		postPressAt.current = Date.now();
		setFeedback("pressed");
		setFailure(null);
		refresh.mutate(undefined, {
			onError: (error) =>
				setFailure({
					at: Date.now(),
					message: error instanceof Error ? error.message : "try again",
				}),
		});
	};

	/*
	 * ESCAPE CLOSES THE PANE (UX round 1, U9): the same rule the run panel's
	 * ladder states - an UNCLAIMED Escape is the pane's while it is open,
	 * `stopPropagation` so the window-level Escape does not also act on the
	 * press (a document listener is on the way to the window). A layer that
	 * claimed the press first (a tooltip's dismissable layer preventDefaults
	 * from the capture phase) keeps it.
	 *
	 * THREE CARVE-OUTS (agent review round 2, m1): an IME candidate window owns
	 * the key while it is composing; a field that consumes Escape WITHOUT
	 * announcing it (the sidebar's search, the directory chip's inline edit -
	 * the same `ownsEscapeOutsideComposer` rung the interrupt ladder reads)
	 * keeps it; and while a turn is running, a press whose target is the
	 * composer's field is LEFT to the turn interrupt rather than closing the
	 * pane - because swallowing that press both closed the pane and silenced
	 * the interrupt (the manager's rule for m1). The composer is not an
	 * escape-owning field by the ladder's definition (the textarea is its
	 * exception), which is exactly why this carve-out is stated here rather
	 * than falling out of `ownsEscapeOutsideComposer`.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented) return;
			if (event.isComposing) return;
			if (ownsEscapeOutsideComposer(event.target)) return;
			if (sessionLive && composerOwnsTarget(event.target)) return;
			event.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose, sessionLive]);

	/*
	 * THE CHIP'S REVEAL (UX round 1, U11): pressing the chip while the pane is
	 * already open re-requests attention, and the pane answers by taking focus
	 * on its own root (`tabIndex={-1}`) - there are no sections to scroll, so
	 * focus is the whole of what a reveal can be here.
	 */
	const reveal = useUiPreferencesStore((state) => state.codeReviewReveal);
	const clearReveal = useUiPreferencesStore(
		(state) => state.clearCodeReviewReveal,
	);
	useEffect(() => {
		if (!reveal) return;
		rootRef.current?.focus();
		clearReveal(reveal.nonce);
	}, [reveal, clearReveal]);

	const refreshing =
		refresh.isPending ||
		scanSettling ||
		(feedback === "pressed" && query.isFetching);
	const refreshFailed =
		failure && !refreshing ? `Couldn't refresh: ${failure.message}` : null;
	return (
		<CodeReviewPaneBody
			phase={phase}
			data={query.data}
			refreshing={refreshing}
			checked={feedback === "checked"}
			scanning={scanSettling}
			refreshFailed={refreshFailed}
			onRefresh={onRefresh}
			onClose={onClose}
			nowMs={clock}
			rootRef={rootRef}
		/>
	);
};
