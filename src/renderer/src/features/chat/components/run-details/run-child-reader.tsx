/**
 * The child reader: one subagent's conversation, in the right pane
 * (`docs/run-sidebar.md` § 5).
 *
 * **The body is the parent's own transcript grammar**, not a second one. The
 * page is fetched from the read-only route (§ 10.1), reduced by the parent's own
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
 * - `frontend` is `null`. That is not cosmetic: it is also what stops the
 *   reader borrowing the PARENT's live-session machinery, which is the whole
 *   reason the rest of this reader is a static port rather than a second
 *   session view. It no longer means a child's images cannot resolve: the
 *   child-scoped attachment route ships in the same window as the transcript
 *   route (§ 10.3's media-relay row), so the reader hands `CanonicalTranscript`
 *   an `attachmentScope` naming THIS child, and a page's digest rows paint
 *   their pictures through `subagents.attachment`. Before that wiring the
 *   parent's route was the only one the renderer knew and it refuses a child's
 *   digests, so every child image rendered as unavailable — the deferral § 5.1
 *   licensed only "if that path ships late".
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
import type { AttachmentScope } from "../../canonical/use-attachment-url";
import type { SubagentRow } from "./run-detail-model";
import {
	briefIsInTranscript,
	foldBrief,
	reconcileLaunchTurns,
} from "./run-detail-model";
import { NumberRun, SubagentStateIcon } from "./run-detail-row-parts";
import { useChildRowClock } from "./run-details-clock";
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
	 * because a preview has no route to re-read — which is enforced rather than
	 * documented: the seam nulls the hook's `childId`, and every one of the hook's
	 * four effects returns early on a null `childId`, so a previewed reader makes
	 * NO request at all (before the fix the comment claimed this while the hook
	 * still read the tail once on mount and again on every 5s tick, which is the
	 * kind of quiet cost a story frame hides).
	 */
	previewPage?: DesktopChildTranscriptPage | null;
	/**
	 * Where this page's images resolve from: the parent session plus THIS child.
	 *
	 * `null` when the `subagent_transcript` capability did not negotiate (or when
	 * there is no session id, or no child id): in that state the reader is not
	 * reachable at all, and a row that resolved digest images through a route the
	 * backend does not serve would be a request made on faith. The panel owns the
	 * gate (`run-panel.tsx` mounts the reader only within it) and passes the scope
	 * only when it holds, so the capability check lives in one place rather than
	 * being re-derived here.
	 */
	attachmentScope: AttachmentScope | null;
	/**
	 * Called when the child's page cannot be opened at all.
	 *
	 * The panel keeps the ROSTER and says so in one line rather than leaving a
	 * reader parked on an error (§ 10.1's `404` row), so the decision belongs to
	 * the surface that can put the roster back.
	 */
	onUnopenable: () => void;
	/**
	 * The instants the panel's model was measured at, for the header's clock.
	 *
	 * The reader draws ONE time-dependent figure — the elapsed label — and it has
	 * to move while the child is running (`§ 5.1`, `§ 5.3`). Threaded from the
	 * pane rather than read here because the model's own instant is what makes a
	 * story frame reproducible (see `RunDetails.measuredAtMs`): the wire's
	 * `start_time` is real epoch seconds, but a fixture's `nowMs` is pinned, so a
	 * label derived from the wall clock alone would be right live and wrong in
	 * every frame of the set.
	 */
	measuredAtMs: number;
	measuredAtRealMs: number;
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
					"mt-1 max-h-40 overflow-auto rounded-md border border-danger-border bg-danger-wash px-2 py-1.5 font-mono text-mono-sm whitespace-pre-wrap break-words text-ink",
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
					"mt-1 rounded-md border border-hairline bg-surface px-2 py-1.5 text-body-sm whitespace-pre-wrap break-words text-ink",
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
						data-run-panel-brief-disclosure=""
					>
						{expanded ? (
							<ChevronDown aria-hidden={true} />
						) : (
							<ChevronRight aria-hidden={true} />
						)}
						{/*
						 * `Show N more lines` / `Show less`, in the roster's own phrasing: the
						 * two controls that say "there is more" in this pane are this one and
						 * the roster's `Show N more`, and a third spelling of the same job one
						 * section apart is the drift `branding.md` § 7's one-idiom rule exists
						 * to stop. The unit survives because it is the honest one: the count
						 * is LINES of one authored instruction, not rows.
						 */}
						{expanded ? "Show less" : `Show ${folded.hidden} more lines`}
					</Button>
				)}
			</div>
			{/*
			 * PROSE, in the prose role (`branding.md` § 4). The authored
			 * instruction is a paragraph the user wrote, not machine voice, and
			 * `font-mono` is reserved for paths, code, counts and identifiers —
			 * "monospace for emphasis, or for prose, is forbidden". The block's own
			 * ground and border already do the quoting; the monospace was doing no
			 * work the border was not, and it set the same sentence in a different
			 * voice from the identical sentence in the launch bubble below.
			 */}
			<pre
				className={cn(
					"max-h-48 overflow-auto font-sans text-body-sm leading-5 whitespace-pre-wrap break-words text-ink-muted",
				)}
			>
				{lines.join("\n")}
			</pre>
		</section>
	);
};

/**
 * The reader's foot: what a user CANNOT do here (§ 5.6).
 *
 * Present for every child state, and that is the point. The foot slot used to
 * hold only the outcome block, which exists once a child has settled — so the
 * one state in which "can I steer this?" arises (a RUNNING child) showed no
 * controls and said nothing about why. That is the puzzle § 5.6 says this line
 * exists to prevent: the absence of controls is then a stated fact rather than
 * something to work out from what is missing.
 *
 * Quiet by construction — `text-meta`, `ink-muted`, no ground — because it is
 * not an alert and not a status; a `danger` or accented footer would put a
 * statement about the SURFACE above the agent's own output in § 7's hierarchy.
 */
const ReadOnlyFooter = () => (
	<div className={cn("shrink-0 border-hairline border-t px-3 py-2")}>
		<p className={cn("text-meta text-ink-muted")}>
			Read-only — this is the subagent's conversation, not a way to steer it.
		</p>
	</div>
);

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
	attachmentScope,
	measuredAtMs,
	measuredAtRealMs,
	onUnopenable,
}: RunChildReaderProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	/**
	 * The reader's own root, which holds focus for the states that have no
	 * transcript yet — see the focus effect below.
	 */
	const readerRef = useRef<HTMLDivElement>(null);
	/*
	 * The preview seam, decided BEFORE the hook is called because it decides what
	 * the hook is asked for. A supplied page means "paint this instead of reading
	 * one", and the hook is therefore given no child to read: every one of its four
	 * effects returns early on a null `childId`, so a previewed reader issues no
	 * request — no tail read on mount, no 5s poll, no pulse read. Nulling the id
	 * also clears the state the hook keeps for a child, which is what makes the
	 * seam genuinely inert rather than merely ignored.
	 *
	 * The alternative — passing the real id and just not painting the result — was
	 * what the code did, and it cost a `subagents.transcript` request per reader
	 * mount and another every 5s, from every story frame in the set.
	 */
	const usingPreview = previewPage !== null;
	const fetched = useChildTranscript({
		sessionId,
		childId: usingPreview ? null : row.childSessionId,
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
	 * The header's clock (`§ 5.1`, `§ 5.3`; round 1, Q3).
	 *
	 * `frontend.update` is published only when the runtime has a field delta to
	 * send, so a running child's elapsed label freezes the moment the wire goes
	 * quiet — the roster's rows have ticked from their own start times since the
	 * clock was written (`useRunDetailsClock`), and this header, which is not on
	 * that path because the pane mounts it in place of the roster body, sat on the
	 * last published label instead: six samples of `running 3s` over 20 s while the
	 * wire's own age for the job was 109 s. Same rule, same interval, one row —
	 * see `useChildRowClock`.
	 *
	 * Only the RETIMED row is used for the header's own facts; every other use of
	 * `row` below is a fact about the launch (brief, outcome, attachment scope,
	 * status) that no clock can move.
	 */
	const headerRow = useChildRowClock(row, { measuredAtMs, measuredAtRealMs });

	/*
	 * Focus moves INTO the body when the reader opens (`§ 8`), so the scroll keys
	 * and `Escape` land here rather than on the row the reader just left.
	 *
	 * Driven from the STATE rather than from mount, and that is the whole fix
	 * (round 1, U1-1/Q4): the transcript element only exists once the page is
	 * readable, so a mount-time effect focused `null` while `state === "loading"`
	 * painted a `QuietLine`, and an empty dependency list never retried — leaving
	 * `document.activeElement` on `BODY`, with `Escape` and the reader's own
	 * paging keys dead until the user pressed Tab.
	 *
	 * The root carries the focus for the states with no transcript (`loading`,
	 * `pending`, `gone`, `error`, and an unaddressed child), because the way out
	 * of a reader that has nothing to paint is the same way out as any other
	 * (`Escape`/Back), and it hands the focus to the transcript — the element that
	 * actually pages — the moment one mounts. The effect re-runs when `hasTranscript`
	 * flips, so a page that arrives late still takes focus **if the reader still has
	 * it**, and never otherwise: a reader whose operator has moved on to the composer
	 * leaves their caret alone (round 3, R3-4). It does not re-run on a pulse or a
	 * refetch that leaves the state alone.
	 */
	const hasTranscript = state === "ready" && painted.records.length > 0;
	useEffect(() => {
		/*
		 * Which element holds focus for THIS state: the transcript when one is painted,
		 * the reader's root otherwise. `hasTranscript` is a dependency rather than only
		 * a body read because a page ARRIVING is the transition this effect is about.
		 *
		 * The move happens only while the reader still holds the focus it took, which
		 * is what makes it idempotent per open AND harmless when a page arrives late
		 * (round 3, R3-4). `document.activeElement` is one of the reader's own two
		 * elements, or nothing (a pane opened over an unmounted roster row leaves it
		 * on `<body>`) — those are the cases where the focus is the reader's to move.
		 * Anything else means the operator has put it somewhere since, and the common
		 * case is the composer: the previous, unconditional version fired on every
		 * `hasTranscript` transition, so a slow child's first rows pulled the caret
		 * out of a half-typed message.
		 */
		const target = hasTranscript ? containerRef.current : readerRef.current;
		if (!target) return;
		const active = document.activeElement;
		const mine =
			active === null ||
			active === document.body ||
			active === readerRef.current ||
			active === containerRef.current;
		if (!mine || active === target) return;
		target.focus();
	}, [hasTranscript]);

	// An unopenable child hands the pane back to the roster, once.
	const reported = useRef(false);
	useEffect(() => {
		if (state !== "error" || reported.current) return;
		reported.current = true;
		onUnopenable();
	}, [onUnopenable, state]);

	const stateWord = row.stateWord;
	/*
	 * Whether the brief block has anything left to say: `BriefBlock` renders only
	 * when the row carries a brief AND the transcript is not already showing it.
	 * Computed from the RECONCILED records, so the two can never disagree about
	 * what is painted.
	 */
	const briefOnScreen =
		Boolean(row.brief) && !briefIsInTranscript(painted.records, row.brief);
	return (
		/*
		 * `tabIndex={-1}`: programmatic focus only. A reader opened on a state with
		 * nothing painted yet still has to be leaveable by keyboard, and the effect
		 * above needs a target for every one of them.
		 */
		<div
			ref={readerRef}
			tabIndex={-1}
			className={cn("flex min-h-0 flex-1 flex-col")}
		>
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
					<SubagentStateIcon status={headerRow.status} />
				</span>
				<div className={cn("flex min-w-0 flex-1 flex-col gap-0.5")}>
					<span
						className={cn("min-w-0 truncate text-body-sm text-ink")}
						title={headerRow.label}
					>
						{headerRow.label}
					</span>
					<div className={cn("flex min-w-0 items-baseline gap-2")}>
						<span className={cn("shrink-0 text-meta text-ink-muted")}>
							{stateWord}
						</span>
						<NumberRun row={headerRow} includeModel={true} />
					</div>
				</div>
			</div>

			{/*
			 * The brief, and ONLY when the transcript is not already carrying it
			 * (`briefIsInTranscript`). In the ordinary case the reconciled launch turn
			 * IS the brief, in its own chronological place, so this block is the
			 * fallback for a launch the transcript does not render — not a second copy
			 * of the sentence above it.
			 */}
			{briefOnScreen && <BriefBlock row={row} />}

			{/*
			 * The BODY, and the one scroll owner in this view. `bg-canvas` is the
			 * main transcript's ground, so the child's conversation resolves against
			 * the same plane the parent's does — the "reads like the parent
			 * transcript" requirement is partly a GROUND requirement (§ 7).
			 */}
			<div
				className={cn("flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas")}
			>
				{!row.childSessionId ? (
					/*
					 * The one row the ROSTER cannot stop you reaching: a child with no
					 * `session_id` is not a control there, but the breadcrumb and the
					 * sibling stepper walk the wire's own lineage and can land here, so
					 * the reader states the fact rather than parking on a load that can
					 * never resolve. `Loading…` was the honest label for a request that
					 * was in flight; for one that was never issued it was a spinner
					 * forever.
					 */
					<QuietLine>
						This subagent's row carries no session id, so there is no
						conversation to open from here.
					</QuietLine>
				) : state === "pending" ? (
					/*
					 * § 10.1's first absence: the child's directory exists and
					 * `transcript.jsonl` does not (`desktop_sessions.child_transcript`,
					 * which derives the state from the FILESYSTEM and not from a row's
					 * status). The copy states exactly that and no more — it used to say the
					 * child "has not written anything yet", which is a claim about its
					 * history that this route cannot make: a file moved aside, or a store
					 * that pruned it, leaves the same two facts on disk as a child that never
					 * appended (round 1, Q10). It is re-probed on the next pulse rather than
					 * being final.
					 */
					<QuietLine>This subagent has no transcript on disk yet.</QuietLine>
				) : state === "gone" ? (
					/*
					 * § 10.1's second absence: the child's SESSION DIRECTORY is missing —
					 * swept, or removed by hand. That is the whole of what `gone` means, and
					 * the copy says it rather than naming the transcript file, which is the
					 * `pending` case one line above.
					 */
					<QuietLine>
						This subagent's session directory is no longer on disk.
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
						/*
						 * False by construction rather than by omission: this reader renders a
						 * subagent's transcript from its own file, so there is no send of ITS
						 * to wait on. The admitted-send rung belongs to the pane that issued the
						 * send, and a child reader can never be that pane.
						 */
						starting={false}
						loadingOlder={loadingOlder}
						onLoadOlder={loadOlder}
						containerRef={containerRef}
						/*
						 * The pane is 420px by default and the reader is its own column, so the
						 * transcript's narrow rules do not apply: those exist for a chat column
						 * squeezed by a pane beside it, and this IS the pane.
						 *
						 * The transcript's bottom-pinning (`flex-col-reverse`) is KEPT, and it
						 * is a deliberate decision rather than an inherited accident: the page
						 * `§5.3` fetches is the TAIL, so the bottom edge is where the newest
						 * rows are, and a top-anchored scroller would open a long child on its
						 * oldest loaded row instead. A short child therefore shows ground above
						 * its first row, which is the parent's own grammar — and the reader's
						 * foot is closed by the `§5.6` read-only statement below it, so the
						 * empty space sits above a settled foot rather than below a floating
						 * body. Recorded in `docs/run-sidebar.md` (`§5.6`) so it is not
						 * re-raised as an oversight.
						 */
						isSmallView={false}
						status="live"
						failure={null}
						/*
						 * A child page has no session handle to re-arm: its read is the
						 * child-scoped route, re-run when the child next beats (`pulse`),
						 * and `useChildTranscript` exposes no reconnect of its own. The
						 * prop is required by `CanonicalTranscript` so the live chat
						 * surface can never paint a notice without its action; this
						 * reader paints no notice (`failure` is null and its own
						 * unavailable states are rendered by the page's foot), so the
						 * handler is unreachable rather than an inert control.
						 */
						onReconnect={() => {}}
						attachmentScope={attachmentScope}
					/>
				)}
				{/*
				 * The outcome, at the foot of the page, from the ROSTER ROW (§5.1) —
				 * the TUI's roster-carries-the-outcome rule applied in the page. It
				 * needs no new wire data and no read of the transcript's tail, and it
				 * is where a reader looks for "how did this end" without scrolling a
				 * conversation to its last row. It renders only once the child has
				 * settled, which is why it cannot be the only thing in the foot slot.
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
			{/*
			 * The read-only statement, OUTSIDE the scroll region so it holds the foot
			 * of the reader in every state (§ 5.6). Placed after the body rather than
			 * before it because it is about the whole surface, and a statement above
			 * the conversation would read as a header for the child's first turn.
			 */}
			<ReadOnlyFooter />
		</div>
	);
};
