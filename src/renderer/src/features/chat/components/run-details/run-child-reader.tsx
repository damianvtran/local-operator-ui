/**
 * The child reader: one subagent's conversation, in the right pane
 * (`docs/run-sidebar.md` § 5).
 *
 * **The body is the parent's own transcript grammar**, not a second one. The
 * page is fetched from the read-only route (§ 9.1), reduced by the parent's own
 * `applyHistoryPage` into a FRESH `TranscriptState`, and painted by the parent's
 * own `CanonicalTranscript` — because the durable-row → record mapping already
 * drops exactly the bookkeeping a child's transcript is full of
 * (`SILENT_CUSTOM_TYPES`, `transcript-reducer.ts:502-509`) and the point of the
 * port is that the child's conversation reads like the parent's. A second
 * grammar for the same durable rows is the two rails `branding.md` § 7 forbids.
 *
 * **What is switched OFF here, and why each one has to be.** The parent's
 * transcript component is driven by three live-session concepts a child cannot
 * supply:
 *
 * - `frontend` is `null`. That is not cosmetic: it is also what makes
 *   `sessionId` resolve to `null` inside `CanonicalTranscript`, which is what
 *   stops attachment resolution from asking for the PARENT's session's images.
 *   A child page's images are digests, and the child-scoped attachment path is
 *   not part of this change (§ 5.1), so the honest outcome is
 *   `BrokenAttachment`'s "not available" rather than a broken <img> or — worse —
 *   the parent's picture.
 * - `gate` is `null` and `waiting` is `false`: a child has no pending question,
 *   and this reader deliberately carries no way to answer one anyway (§ 5.6).
 * - `status` is a static `"live"`, `error` is `null`. The reader's own state is
 *   the absence lines below, not the stream's connection status.
 *
 * No second stream subscription exists anywhere in here: the child's page is a
 * file behind a GET.
 */

import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopChildTranscriptPage } from "../../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "../../canonical/canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	applyHistoryPage,
} from "../../canonical/transcript-reducer";
import type { SubagentRow } from "./run-detail-model";
import { foldBrief, reconcileLaunchTurns } from "./run-detail-model";
import { NumberRun, SubagentStateIcon } from "./run-detail-row-parts";
import {
	type ChildTranscriptState,
	useChildTranscript,
} from "./use-child-transcript";

export type RunChildReaderProps = {
	row: SubagentRow;
	sessionId: string | null;
	/** This child's pulse counter, from the canonical stream. */
	pulse: number;
	/** Whether the child is still open (running or queued). */
	live: boolean;
	/**
	 * A page to paint INSTEAD of fetching one — the story and test seam.
	 *
	 * The retired surface had the same seam for the same reason (`defaultOpen`):
	 * states that need a live backend to reach cannot be photographed from a story
	 * otherwise, and a fixture is what makes them reproducible. The app never
	 * passes this, and a supplied page also stops the pulse and the fallback poll,
	 * because a preview has no route to re-read.
	 */
	previewPage?: DesktopChildTranscriptPage | null;
	/**
	 * Called when the child's page cannot be opened at all.
	 *
	 * The panel keeps the ROSTER and says so in one line rather than leaving a
	 * reader parked on an error (§ 9.1's `404` row), so the decision belongs to
	 * the surface that can put the roster back.
	 */
	onUnopenable: () => void;
};

/**
 * The outcome block's copy, from the roster row rather than the transcript
 * (`§5.1`): the row already carries the child's terminal text, and reading it
 * out of a paged window would be a second, weaker source for the same fact.
 */
const OutcomeBlock = ({ row }: { row: SubagentRow }) => {
	if (row.errorText) {
		return (
			/*
			 * MACHINE VOICE, verbatim, and never paraphrased: an exception's own
			 * words are the only version of it a reader can act on, and a
			 * summarised exception is a claim nobody can check (`run-detail-subagents.tsx`
			 * makes the same argument for the roster's one-line summary).
			 */
			<pre
				className={cn(
					"mt-1 max-h-40 overflow-auto rounded-sm border border-danger-border bg-danger-wash px-2 py-1.5 font-mono text-mono-sm whitespace-pre-wrap break-words text-ink",
				)}
			>
				{row.errorText}
			</pre>
		);
	}
	if (row.resultText) {
		return (
			<p
				className={cn(
					"mt-1 rounded-sm border border-hairline bg-surface px-2 py-1.5 text-body-sm whitespace-pre-wrap break-words text-ink",
				)}
			>
				{row.resultText}
			</p>
		);
	}
	return null;
};

/**
 * The brief: the child's authored instruction, folded, with the hidden line
 * count stated (`§5.1`, the TUI's rule at `subagent_view.py:1053-1073`).
 *
 * `⟨expand⟩` alone cannot distinguish two more lines from fifty, and whether to
 * expand is exactly that question. The count is the whole affordance.
 */
const BriefBlock = ({ row }: { row: SubagentRow }) => {
	const [expanded, setExpanded] = useState(false);
	const folded = useMemo(() => foldBrief(row.brief), [row.brief]);
	if (!row.brief) return null;
	const lines = expanded ? row.brief.split("\n") : folded.lines;
	return (
		<section
			className={cn("flex flex-col gap-1 border-hairline border-b px-3 py-2")}
		>
			<div className={cn("flex items-baseline justify-between gap-2")}>
				{/*
				 * A section label in the panel's own grammar, not a heading: the pane
				 * has no titles (§ 5.2 keeps the reader's title in the breadcrumb), and
				 * this names a block inside the body rather than the surface.
				 */}
				<span className={cn("text-meta text-ink-muted")}>Delegated with</span>
				{folded.hidden > 0 && (
					<Button
						variant="ghost"
						size="sm"
						className={cn("shrink-0 text-ink-muted")}
						aria-expanded={expanded}
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded ? (
							<ChevronDown aria-hidden={true} />
						) : (
							<ChevronRight aria-hidden={true} />
						)}
						{expanded ? "Collapse" : `${folded.hidden} more lines`}
					</Button>
				)}
			</div>
			<pre
				className={cn(
					"max-h-48 overflow-auto font-mono text-mono-sm leading-4 whitespace-pre-wrap break-words text-ink-muted",
				)}
			>
				{lines.join("\n")}
			</pre>
		</section>
	);
};

/** One quiet line for a state where the body has nothing to paint. */
const QuietLine = ({ children }: { children: React.ReactNode }) => (
	<p className={cn("px-3 py-3 text-body-sm text-ink-muted")}>{children}</p>
);

export const RunChildReader = ({
	row,
	sessionId,
	pulse,
	live,
	previewPage = null,
	onUnopenable,
}: RunChildReaderProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const fetched = useChildTranscript({
		sessionId,
		childId: row.childSessionId,
		pulse,
		live,
	});
	/*
	 * The preview seam: a supplied page is reduced through the SAME
	 * `applyHistoryPage` the live path uses, into a fresh `TranscriptState`, so a
	 * story frame is a picture of the real row pipeline rather than of a
	 * hand-written record list. `useState` seeds it once, and the pulse is not
	 * consulted at all.
	 */
	const [previewTranscript] = useState(() =>
		previewPage ? applyHistoryPage(EMPTY_TRANSCRIPT, previewPage) : null,
	);
	const usingPreview = previewPage !== null;
	const state: ChildTranscriptState = usingPreview
		? (previewPage?.state ?? "ready")
		: fetched.state;
	const transcript = usingPreview
		? (previewTranscript ?? EMPTY_TRANSCRIPT)
		: fetched.transcript;
	const loadingOlder = usingPreview ? false : fetched.loadingOlder;
	const loadOlder = usingPreview ? async () => false : fetched.loadOlder;

	/*
	 * The launch turn, reconciled (`§5.1`). Applied to the READER's own record
	 * list rather than inside the reducer: the parent's reducer is shared, and a
	 * rule about a child's launch identity does not belong on the path every
	 * conversation in the app takes. `index` stays valid because records are
	 * replaced in place, never inserted or removed.
	 */
	const painted = useMemo(() => {
		const records = reconcileLaunchTurns(transcript.records, row.launchPrompts);
		return records === transcript.records
			? transcript
			: { ...transcript, records };
	}, [row.launchPrompts, transcript]);

	/*
	 * Focus moves INTO the body when the reader opens (§ 8), so the scroll keys
	 * and `Escape` land here rather than on the trigger the reader just left. The
	 * transcript element is already a tab stop with a name, so focusing it is
	 * both the accessibility fix and the behavioural one.
	 */
	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	// An unopenable child hands the pane back to the roster, once.
	const reported = useRef(false);
	useEffect(() => {
		if (state !== "error" || reported.current) return;
		reported.current = true;
		onUnopenable();
	}, [onUnopenable, state]);

	const stateWord = row.stateWord;
	return (
		<div className={cn("flex min-h-0 flex-1 flex-col")}>
			{/*
			 * The facts row (`§5.2`): the roster row's grammar re-used as a page
			 * header — state mark, label, then the numbers run. `model_label` is
			 * read HERE and nowhere else in the product, which is the departure
			 * §5.2 states: the roster row has no model segment, and the child's own
			 * model is a fact about understanding a delegation.
			 */}
			<div
				className={cn(
					"flex items-start gap-2 border-hairline border-b px-3 py-2",
				)}
			>
				<span className={cn("pt-0.5")}>
					<SubagentStateIcon status={row.status} />
				</span>
				<div className={cn("flex min-w-0 flex-1 flex-col gap-0.5")}>
					<span
						className={cn("min-w-0 truncate text-body-sm text-ink")}
						title={row.label}
					>
						{row.label}
					</span>
					<div className={cn("flex min-w-0 items-baseline gap-2")}>
						<span className={cn("shrink-0 text-meta text-ink-muted")}>
							{stateWord}
						</span>
						<NumberRun row={row} includeModel={true} />
					</div>
				</div>
			</div>

			<BriefBlock row={row} />

			{/*
			 * The BODY, and the one scroll owner in this view. `bg-canvas` is the
			 * main transcript's ground, so the child's conversation resolves against
			 * the same plane the parent's does — the "reads like the parent
			 * transcript" requirement is partly a GROUND requirement (§ 7).
			 */}
			<div
				className={cn("flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas")}
			>
				{state === "pending" ? (
					/*
					 * § 9.1's first absence, in the copy that document fixes: the
					 * directory exists and the file does not yet, which is a fact about
					 * a child that has not reached its first append — and it is
					 * re-probed on the next pulse rather than being final.
					 */
					<QuietLine>This subagent has not written anything yet.</QuietLine>
				) : state === "gone" ? (
					/* § 9.1's second absence: the directory itself is missing. Final. */
					<QuietLine>
						This subagent's transcript is no longer on disk.
					</QuietLine>
				) : state === "loading" ? (
					<QuietLine>Loading this subagent's conversation…</QuietLine>
				) : painted.records.length === 0 ? (
					/*
					 * `ready` with no rows: the file exists and holds nothing this
					 * renderer paints. One line, no skeleton — a state a reader can
					 * read rather than an animation they have to wait out.
					 */
					<QuietLine>
						This subagent has no conversation on record yet.
					</QuietLine>
				) : (
					<CanonicalTranscript
						frontend={null}
						transcript={painted}
						gate={null}
						waiting={false}
						loadingOlder={loadingOlder}
						onLoadOlder={loadOlder}
						containerRef={containerRef}
						// The pane is 420px by default and the reader is its own column,
						// so the transcript's narrow rules do not apply: those exist for a
						// chat column squeezed by a pane beside it, and this IS the pane.
						isSmallView={false}
						status="live"
						error={null}
					/>
				)}
				{/*
				 * The outcome, at the foot of the page, from the ROSTER ROW (§5.1) —
				 * the TUI's roster-carries-the-outcome rule applied in the page. It
				 * needs no new wire data and no read of the transcript's tail, and it
				 * is where a reader looks for "how did this end" without scrolling a
				 * conversation to its last row.
				 */}
				{(row.errorText || row.resultText) && (
					<div className={cn("shrink-0 border-hairline border-t px-3 py-2")}>
						<span className={cn("text-meta text-ink-muted")}>
							{row.errorText ? "Failed" : "Result"}
						</span>
						<OutcomeBlock row={row} />
					</div>
				)}
			</div>
		</div>
	);
};
