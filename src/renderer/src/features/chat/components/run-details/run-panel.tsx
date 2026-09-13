/**
 * The run panel: the right pane's second mode (`docs/run-sidebar.md` § 3, § 5.6, § 7).
 *
 * A sibling of the canvas rather than a popover over it, because the operator's
 * ask was for a pane that SWAPS with the canvas and stays readable BESIDE the
 * transcript. The canvas is a document pane; this is the live view over the
 * session's delegated work, which is the sentence the retired popover already
 * carried and the reason a taller, resizable pane is worth having.
 *
 * What lives here rather than in the body:
 *
 * - **The 40px `sunken` chrome bar**, the canvas's own pattern at the same
 *   height and on the same ground, so the two panes read as two modes of one
 *   slot. Its left half is the reader's (a back control and the breadcrumb, which
 *   IS the title — the pane has no visible one, for the reason the canvas removed
 *   its own); its right half is the pane's (a close button, and the reader's
 *   navigation controls).
 * - **The reader's position**, which is the lineage PATH over `parent_job_id`
 *   (`§ 5.5`) rather than a visit-history stack: a path needs no separate state,
 *   cannot go stale, and makes the breadcrumb and "back" agree by construction.
 * - **The scroll owner**: the roster area in the roster view, the transcript in
 *   the reader view, never both. Two nested scrollers is the defect the old
 *   popover's `min(60vh, 480px)` ceiling existed to avoid.
 * - **The Escape ladder** (`§ 3.5`), bound on this container and stopping
 *   propagation so the window-level Escape that cancels a pending session open
 *   cannot act on the same press.
 *
 * It does NOT own `isRunPanelOpen`: that is global and persisted (§ 3.5), like
 * the canvas's own flag, so switching conversations keeps the pane open on the
 * new session's data while the reader resets — a child belongs to one session's
 * lineage, and a reader pointed at another session's child is not a state
 * anything should be able to reach.
 */

import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
	ChevronLeft,
	ChevronRight,
	PanelRightClose,
	Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopChildTranscriptPage } from "../../../../../../shared/desktop-session-contract";
import { RunChildReader } from "./run-child-reader";
import {
	type McpServerRow,
	OPEN_CHILD_STATUSES,
	type RunDetails,
	type SubagentRow,
} from "./run-detail-model";
import { RunDetailsPanel } from "./run-details-panel";

export type RunPanelProps = {
	details: RunDetails;
	mcpServers: readonly McpServerRow[];
	/** The canonical session id the reader's route is addressed with. */
	sessionId: string | null;
	/** Per-child pulse counters, from the canonical session stream (`§ 5.3`). */
	pulses: Readonly<Record<string, number>>;
	/** Whether `subagent_transcript` negotiated (`§ 9.5`). */
	childrenOpenable: boolean;
	/**
	 * The child whose reader is open, or `null` for the roster view.
	 *
	 * CONTROLLED rather than local state, and that is `§ 3.4`'s requirement rather
	 * than tidiness: the trigger's attention dot has to know whether the list is on
	 * screen, and only the component that renders BOTH the trigger and this pane
	 * can answer that. So the view state lives one level up (`chat-content.tsx`)
	 * and is reported to the trigger from there.
	 */
	readerChildId: string | null;
	onReaderChildChange: (id: string | null) => void;
	/**
	 * A child page to paint instead of fetching one, for the story set.
	 *
	 * Threaded through the pane because the pane is what mounts the reader; the app
	 * never supplies it, and `RunChildReader` documents why the seam exists.
	 */
	previewPage?: DesktopChildTranscriptPage | null;
	onClose: () => void;
};

/** The rows that launched from the same parent, in the WIRE's own order.
 *
 * The authoritative sibling order, deliberately not the roster's presentation
 * order: the roster is a priority slice with a cap, and a stepper walking that
 * would skip the children the cap hid and change step as the slice moved. The
 * TUI makes the same choice and says why (`app.py:24187-24215`): a list that
 * loses the selected node's position oscillates over the first two children.
 */
const siblingsOf = (
	rows: readonly SubagentRow[],
	row: SubagentRow,
): SubagentRow[] =>
	rows.filter((candidate) => candidate.parentJobId === row.parentJobId);

/** The child's own children, in the same authoritative order. */
const childrenOf = (
	rows: readonly SubagentRow[],
	row: SubagentRow,
): SubagentRow[] =>
	rows.filter((candidate) => candidate.parentJobId === row.id);

export const RunPanel = ({
	details,
	mcpServers,
	sessionId,
	pulses,
	childrenOpenable,
	readerChildId,
	onReaderChildChange,
	previewPage = null,
	onClose,
}: RunPanelProps) => {
	const openChildId = readerChildId;
	/*
	 * The disclosure's state, hoisted here from the roster so a drill-in and back
	 * does not collapse the list under the reader (`§ 4`: it lasts "for as long as
	 * the panel is open on that session"). It still resets when the panel closes,
	 * because this component unmounts with it.
	 */
	const [rosterExpanded, setRosterExpanded] = useState(false);
	/*
	 * The degraded state's action (`§ 10.5`). `canUpdateBackend` is the same guard
	 * the compatibility banner uses for the same button — the updater is a main-
	 * process capability and a browser build has none — so the control appears only
	 * where it can work, and `Retry` covers the case where it cannot: a backend that
	 * came up since the capabilities were read.
	 */
	const [updatingBackend, setUpdatingBackend] = useState(false);
	const [updateBackendError, setUpdateBackendError] = useState<string | null>(
		null,
	);
	const queryClient = useQueryClient();
	const canUpdateBackend = Boolean(window.api?.updater?.updateBackend);
	const retryCapabilities = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: desktopKeys.capabilities });
	}, [queryClient]);
	const updateBackend = useCallback(async () => {
		setUpdatingBackend(true);
		setUpdateBackendError(null);
		try {
			await window.api.updater.updateBackend();
			retryCapabilities();
		} catch {
			setUpdateBackendError("The backend update could not start.");
		} finally {
			setUpdatingBackend(false);
		}
	}, [retryCapabilities]);
	/** One line above the roster when a child could not be opened at all. */
	const [unopenable, setUnopenable] = useState(false);
	/*
	 * The row the reader was opened from, kept so "back" can return focus to it —
	 * and, separately, so the header's facts survive the child leaving
	 * `frontend.jobs` (a settled child is swept minutes later, `§ 5.2`).
	 */
	const openedFrom = useRef<string | null>(null);
	const cachedRow = useRef<SubagentRow | null>(null);

	const openRow = useMemo(
		() =>
			openChildId
				? (details.subagents.find((row) => row.id === openChildId) ?? null)
				: null,
		[details.subagents, openChildId],
	);
	// The roster's live row while it is present, else whatever the panel opened
	// with: a swept child keeps its facts instead of blanking its own header.
	if (openRow) cachedRow.current = openRow;
	const row = openRow ?? (openChildId ? cachedRow.current : null);

	/*
	 * The path, walked over `parent_job_id` (`§ 5.5`). The guard is not
	 * decoration: the wire's lineage comes from the runtime's own graph, and a
	 * cycle there would hang this walk rather than mis-draw it.
	 */
	const path = useMemo(() => {
		if (!row) return [] as SubagentRow[];
		const byId = new Map(details.subagents.map((entry) => [entry.id, entry]));
		const chain: SubagentRow[] = [];
		const seen = new Set<string>();
		let cursor: SubagentRow | undefined = row;
		while (cursor && !seen.has(cursor.id)) {
			seen.add(cursor.id);
			chain.unshift(cursor);
			cursor = cursor.parentJobId ? byId.get(cursor.parentJobId) : undefined;
		}
		return chain;
	}, [details.subagents, row]);

	/*
	 * Closing the reader. Focus returns to the row it came from — one rAF later,
	 * because the roster has to paint before its button can take focus — and the
	 * unopenable note is cleared, since it describes a child the reader has now
	 * left.
	 */
	const back = useCallback(() => {
		const from = openedFrom.current;
		onReaderChildChange(null);
		setUnopenable(false);
		if (!from) return;
		requestAnimationFrame(() => {
			document
				.querySelector<HTMLButtonElement>(
					`[data-run-panel-row="${CSS.escape(from)}"] button`,
				)
				?.focus();
		});
	}, [onReaderChildChange]);

	const openChild = useCallback(
		(id: string) => {
			openedFrom.current = id;
			cachedRow.current = null;
			setUnopenable(false);
			onReaderChildChange(id);
		},
		[onReaderChildChange],
	);

	/*
	 * `§ 3.5`'s two-step ladder, on the container and not on `window`. The reader
	 * open: back one level. At the roster: close the panel. `stopPropagation` is
	 * what keeps the window-level Escape (which cancels a pending session open,
	 * `chat-page.tsx:804-815`) from acting on the same press.
	 *
	 * `⌘[`/`Ctrl+[` is the platform's own back gesture (`§ 5.5`), and it is a
	 * keyboard binding rather than a bare letter because the composer is live in
	 * this layout: the TUI's `p`/`c`/`r` would have to be stolen from a focused
	 * text field, and that is why its single-letter keys are controls here.
	 */
	const onKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (
				event.key === "[" &&
				(event.metaKey || event.ctrlKey) &&
				openChildId
			) {
				event.preventDefault();
				event.stopPropagation();
				back();
				return;
			}
			if (event.key !== "Escape") return;
			event.stopPropagation();
			if (openChildId) {
				back();
				return;
			}
			onClose();
		},
		[back, onClose, openChildId],
	);

	/*
	 * Switching conversations resets the reader (`§ 3.5`). Keyed on the session
	 * identity rather than on a prop of the reader, because the child ids are the
	 * session's and a reader left pointing at one after the session changed would
	 * be reading a conversation that is no longer on screen.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on session change only
	useEffect(() => {
		onReaderChildChange(null);
		setUnopenable(false);
		openedFrom.current = null;
		cachedRow.current = null;
	}, [sessionId]);

	const siblings = row ? siblingsOf(details.subagents, row) : [];
	const index = row ? siblings.findIndex((entry) => entry.id === row.id) : -1;
	const previous = index > 0 ? siblings[index - 1] : null;
	const next =
		index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
	const children = row ? childrenOf(details.subagents, row) : [];

	return (
		/*
		 * `tabIndex={-1}` so the container can hold focus for the Escape ladder
		 * without entering the tab order; the ROLE is the canvas's own precedent —
		 * a named `region` rather than a dialog, because this is in-flow content
		 * and not a modal the user has to dismiss before touching anything else.
		 */
		<section
			aria-label="Run details"
			tabIndex={-1}
			onKeyDown={onKeyDown}
			className={cn("flex h-full flex-col bg-surface")}
		>
			{/*
			 * `bg-sunken`, the canvas's ground for this bar and the same 40px, so the
			 * two panes read as one slot with two modes. `shrink-0` because the body
			 * below owns the remaining height and the bar must not lose a pixel of
			 * its declared size to a flex deficit.
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 bg-sunken px-2",
				)}
			>
				<div className={cn("flex min-w-0 items-center gap-1")}>
					{row ? (
						<>
							<Tooltip content="Back">
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Back"
									onClick={back}
								>
									<Undo2 aria-hidden="true" />
								</Button>
							</Tooltip>
							{/*
							 * The breadcrumb IS the title (`§ 5.2`): the root crumb is the
							 * panel itself — pressing it closes the panel, after one back
							 * from the first level — and each crumb after it is one level of
							 * the lineage. A `<nav>` because it is navigation, and the current
							 * crumb is marked rather than linked.
							 */}
							<nav
								aria-label="Subagent path"
								className={cn("flex min-w-0 items-center gap-1")}
							>
								<button
									type="button"
									onClick={onClose}
									className={cn(
										"shrink-0 truncate rounded-sm px-1 text-meta text-ink-muted hover:text-ink",
									)}
								>
									Run details
								</button>
								{path.map((crumb, crumbIndex) => (
									<span
										key={crumb.id}
										className={cn("flex min-w-0 items-center gap-1")}
									>
										<span aria-hidden="true" className={cn("text-ink-dim")}>
											/
										</span>
										<button
											type="button"
											aria-current={
												crumbIndex === path.length - 1 ? "page" : undefined
											}
											onClick={() => openChild(crumb.id)}
											className={cn(
												"min-w-0 truncate rounded-sm px-1 text-meta",
												crumbIndex === path.length - 1
													? "text-ink"
													: "text-ink-muted hover:text-ink",
											)}
											title={crumb.label}
										>
											{crumb.label}
										</button>
									</span>
								))}
							</nav>
						</>
					) : (
						<span className={cn("px-1 text-meta text-ink-dim")}>
							Run details
						</span>
					)}
				</div>
				<div className={cn("flex shrink-0 items-center gap-0.5")}>
					{row && (
						<>
							{children.length > 0 && (
								/*
								 * The descend control (`§ 5.5`): named for the count rather
								 * than with an arrow, because an unlabelled chevron beside the
								 * peer stepper is three arrows with two meanings.
								 */
								<Tooltip
									content={`Open ${children.length} child subagent${
										children.length === 1 ? "" : "s"
									}`}
								>
									<Button
										variant="ghost"
										size="sm"
										className={cn("text-meta text-ink-muted")}
										onClick={() => openChild(children[0].id)}
									>
										{`${children.length} children`}
									</Button>
								</Tooltip>
							)}
							{siblings.length > 1 && (
								<>
									<Tooltip content="Previous subagent">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Previous subagent"
											disabled={!previous}
											onClick={() => previous && openChild(previous.id)}
										>
											<ChevronLeft aria-hidden="true" />
										</Button>
									</Tooltip>
									<Tooltip content="Next subagent">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Next subagent"
											disabled={!next}
											onClick={() => next && openChild(next.id)}
										>
											<ChevronRight aria-hidden="true" />
										</Button>
									</Tooltip>
								</>
							)}
						</>
					)}
					<Tooltip content="Close run details">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close run details"
							onClick={onClose}
							data-tour-tag="close-run-panel-button"
						>
							<PanelRightClose aria-hidden="true" />
						</Button>
					</Tooltip>
				</div>
			</div>

			{row ? (
				<RunChildReader
					/*
					 * Keyed by the child so a hop REPLACES the reader rather than
					 * re-rendering it in place: the body, the scroll position and the
					 * brief's expander all belong to one child (`§ 11`, risk 7 — the TUI
					 * resets the scroll only on a new job, and the same rule has to hold
					 * here or a reader lands mid-transcript).
					 */
					key={row.id}
					row={row}
					sessionId={sessionId}
					pulse={pulses[row.id] ?? 0}
					live={OPEN_CHILD_STATUSES.includes(row.status)}
					previewPage={previewPage}
					onUnopenable={() => {
						onReaderChildChange(null);
						setUnopenable(true);
						openedFrom.current = null;
					}}
				/>
			) : (
				/*
				 * The scroll owner, and NO tab stop of its own.
				 *
				 * Every row inside it is a real button, so the region is reachable and
				 * operable by keyboard through its own content, and the Escape ladder
				 * binds on the section above: focusing a row puts the ladder in reach. A
				 * bare `tabIndex` here would add a stop that announces a container and
				 * does nothing when it is pressed — the transcript's own scroller needs
				 * one because it pages on keydown, and this one does not page at all.
				 */
				<div
					className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain")}
				>
					{/*
					 * `§ 10.5`'s one quiet line, and its ACTION. A lit row that opens
					 * nothing is worse than a quiet one, and a state whose explanation is
					 * missing is the "not a hidden failure" half of that section — so the
					 * line names the situation and offers the same remedy the app's other
					 * gated surfaces offer: the updater, when this build has one, plus the
					 * capability re-read for the case where the backend came up since.
					 *
					 * The two controls are the compatibility banner's own, with the same
					 * labels and the same `window.api.updater.updateBackend` call rather
					 * than a second update path — a second path is a second place for the
					 * confirmation, the failure copy and the restart advice to be wrong.
					 */}
					{!childrenOpenable && details.subagents.length > 0 && (
						<div
							className={cn(
								"flex flex-col gap-2 px-3 pt-2 pb-1 text-meta text-ink-muted",
							)}
						>
							<p>
								Opening a subagent's conversation needs a newer Local Operator
								backend. Update the backend and restart the app.
							</p>
							<div className={cn("flex items-center gap-2")}>
								{canUpdateBackend && (
									<Button
										variant="secondary"
										size="sm"
										disabled={updatingBackend}
										onClick={updateBackend}
									>
										{updatingBackend ? "Updating" : "Update backend"}
									</Button>
								)}
								<Button variant="ghost" size="sm" onClick={retryCapabilities}>
									Retry
								</Button>
								{updateBackendError && (
									<span className={cn("text-danger")}>
										{updateBackendError}
									</span>
								)}
							</div>
						</div>
					)}
					{unopenable && (
						<p className={cn("px-3 pt-2 text-meta text-ink-muted")}>
							That subagent's conversation could not be opened.
						</p>
					)}
					<RunDetailsPanel
						details={details}
						mcpServers={mcpServers}
						childrenOpenable={childrenOpenable}
						onOpenChild={openChild}
						rosterExpanded={rosterExpanded}
						onToggleRosterExpanded={() => setRosterExpanded(true)}
					/>
				</div>
			)}
		</section>
	);
};
