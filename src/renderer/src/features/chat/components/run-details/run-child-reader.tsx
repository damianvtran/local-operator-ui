/**
 * The child reader: one subagent's conversation, in the right pane
 * (`docs/run-sidebar.md` § 5).
 *
 * **The body is the parent's own transcript grammar**, not a second one. The
 * page is fetched from the read-only route (§ 10.1), reduced by the parent's own
 * `applyHistoryPage` into a FRESH `TranscriptState`, and painted by the parent's
 * own `CanonicalTranscript` — because the durable-row → record mapping already
 * drops exactly the bookkeeping a child's transcript is full of
 * (`SILENT_CUSTOM_TYPES`, `transcript-reducer.ts:895`) and the point of the
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
 * **The result is the child's LAST MESSAGE, and this page paints it as nothing
 * else.** The foot used to carry its own `Result` block built from
 * `SubagentRow.resultText`, and that was wrong twice over. It is a LOSSY
 * duplicate: the runtime clips the wire's `result_text` (`frontend_state.py`'s
 * `JOB_RESULT_WIRE_CHARS = 2_000`, `:143-164`) while the child's own final
 * assistant row holds the same text verbatim, so the roster copy could only ever
 * be a prefix of the page's own last row. And it was unbounded, so a long result
 * grew a `shrink-0` sibling until the conversation — the one `flex-1` child of
 * an `overflow-hidden` column — was squeezed to no height at all, which is the
 * defect this header records. The TUI, which is the surface § 5 ports, never
 * painted one either: its child page keeps the settled `result_text` for exactly
 * one fact, a job cancelled while parked (`subagent_view.py:1808-1812`), and a
 * result reaches a reader there as the child's own last transcript row.
 *
 * Removing it also puts this page back inside `branding.md` § 7's hierarchy: the
 * answer is prose at reading weight, and the foot holds quiet statements rather
 * than a second card repeating the answer under the conversation that just made
 * it.
 *
 * The clipped copy is NOT gone everywhere, because there is one case where it is
 * the only copy left: a page this reader cannot open at all — a child with no
 * `session_id`, `pending`, `gone`, or `ready` with nothing painted (a FAILED
 * read lands on that last branch too, `use-child-transcript.ts`'s `error` and
 * an empty `ready` being the same absence here). Those states keep a BOUNDED
 * preview (`ResultPreview`), and the failure block stays unconditionally,
 * because `error_text` is `str(exc)` from the parent's runner and is in no child
 * transcript at all.
 *
 * **Both foot blocks say what the wire did to the value, and neither says more
 * than that.** The wire clips a job's free text and MARKS the cut
 * (`WIRE_CLIP_MARKER`), so the preview claims to be shortened only when the
 * value carries that marker — the label drops to a plain `Result` when the value
 * is the whole one — and the failure block states the bound when its own value
 * was cut. Before this, the shortening line was printed for every state the
 * predicate admits, including one where `result_text` is a 27-character STATE
 * stamp rather than an outcome: see `CANCELLED_BEFORE_START`, which the model
 * spends as the row's state word instead of as a result.
 *
 * **The working line is the one live fact this reader DOES paint.** It is the
 * exception the foot rules above leave room for, and it is worth the exception because
 * it answers the only question a reader has while looking at a child's page that
 * is still moving: what is it doing? Without it the bottom of a live child's
 * conversation is indistinguishable from a finished one — the child's last block
 * is often settled prose, the model pausing between tool calls — which is the
 * same failure the TUI's tail row exists for (`subagent_view.py`, `_tail_entry`).
 *
 * It is handed to `CanonicalTranscript` as its `workingLine` prop rather than
 * DERIVED by it, because a child's activity is not recoverable from the page the
 * reader fetches: the durable tool rows all reduce to `phase: "done"`
 * (`transcript-reducer.ts:1867`), so the parent's derivation over them paints
 * nothing for the props this reader passes, and the one change that would make it
 * speak — claiming a `waiting` pane — could only ever say `thinking`. The fact is
 * on the wire, though — `SubagentRow.activity` is the child relay's
 * `report_progress` string — so the reader derives the line from the row it
 * already holds (`deriveChildWorkingLine`, `run-detail-model.ts`) and the parent
 * component paints it. See that function for the vocabulary, the phase
 * classification, the withheld clock and the queued gate.
 *
 * No second stream subscription exists anywhere in here: the child's page is a
 * file behind a GET.
 */

import { Button } from "@shared/components/ui";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopChildTranscriptPage } from "../../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "../../canonical/canonical-transcript";
import { TAIL_EPS_PX } from "../../canonical/scroll-paging";
import {
	EMPTY_TRANSCRIPT,
	applyHistoryPage,
} from "../../canonical/transcript-reducer";
import type { AttachmentScope } from "../../canonical/use-attachment-url";
import { ScrollToBottomButton } from "../scroll-to-bottom-button";
import { ChildSubagents } from "./run-child-subagents";
import type { SubagentRow } from "./run-detail-model";
import {
	briefIsInTranscript,
	deriveChildWorkingLine,
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
	/**
	 * This child's OWN children, in the wire's order (`childrenOf`).
	 *
	 * Computed by the PANE rather than here, and handed down rather than derived
	 * from a `lineage` prop, for the reason the pane walks the lineage at all: one
	 * walk answers the breadcrumb, the peer stepper, the descend control and this
	 * list, so the count the chrome bar prints and the rows below it come off the
	 * same call and cannot disagree about which children this child has.
	 *
	 * Named `childRows` and not `children`, which is React's own prop: a data
	 * list under that name reads as this component's element children, and the
	 * lint contract refuses the spelling outright
	 * (`lint/correctness/noChildrenProp`).
	 */
	childRows: readonly SubagentRow[];
	/** Whether a row in that list can be opened — `subagent_transcript`, `§ 10.2`. */
	childrenOpenable: boolean;
	/** The pane's own open, so this list walks DOWN the tree (`openChild`). */
	onOpenChild: (id: string) => void;
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
	/**
	 * The pane's own width, which this page's own subagents section measures its
	 * row mark's shed rule against (`childCountFitsInline`).
	 *
	 * Threaded like `paneWidth` is to every other section: the width the pane is
	 * drawn at is the caller's, not this page's to look up.
	 */
	paneWidth: number;
};

/**
 * The marker the runtime's wire clip leaves on a value it shortened.
 *
 * `frontend_state._bound_job_text_in_place` clips `result_text`, `prompt` and
 * `error_text` to the tighter of the field's own bound (`JOB_RESULT_WIRE_CHARS`
 * and `JOB_ERROR_WIRE_CHARS` are both 2_000) and this row's share of the frame's
 * text budget, and it MARKS the cut: `value[:limit] + "…"`. A value that ends in
 * the ellipsis was shortened; one that does not is the whole value the runtime
 * recorded.
 *
 * Read off the VALUE rather than off its length, and that is the point: the
 * share bound can be well under 2_000, so a short marked value is still a
 * clipped one — `length >= 2_000` would call it whole. The marker is the wire's
 * own disclosure, so the pane repeats the wire instead of guessing at it. The
 * residual the marker cannot close is a value that genuinely ends in an
 * ellipsis and was never clipped, which no renderer can tell from a clipped one
 * without a companion flag on the wire.
 */
const WIRE_CLIP_MARKER = "…";
/** Whether the WIRE shortened this value — see `WIRE_CLIP_MARKER`. */
const clippedByWire = (text: string): boolean =>
	text.endsWith(WIRE_CLIP_MARKER);

/**
 * A failure's own words — the one outcome the child's conversation does NOT
 * carry, and the reason this block outlived the result block beside it.
 *
 * `error_text` is `str(exc)` from the PARENT's runner, so no child transcript
 * holds it (`frontend_state.py` keeps it at the same 2_000-character wire bound
 * `result_text` gets, and for the opposite reason: the result has a second copy
 * on the child's page, so clipping it is safe, while the exception has none). It
 * is therefore UNGATED on the transcript state: a page this reader could not
 * open at all is the case where the exception is most needed.
 *
 * MACHINE VOICE, verbatim, and never paraphrased: an exception's own words are
 * the only version of it a reader can act on, and a summarised exception is a
 * claim nobody can check (`run-detail-subagents.tsx` makes the same argument for
 * the roster's one-line summary). Bounded (`max-h-40 overflow-auto`) because it
 * is a sibling of the conversation rather than its content, and an unbounded
 * sibling displaces the only `flex-1` child of this `overflow-hidden` column —
 * the shape the result block was removed for.
 *
 * VERBATIM AS THE WIRE CARRIES IT, which is what the one line under the block
 * states: the field is clipped at the wire like every other free-text field, so
 * a value carrying `WIRE_CLIP_MARKER` says where the bound is rather than
 * letting a cut exception read as the whole of one. The line is worth its space
 * here and not on the preview, because this is the only copy of why a child
 * failed — there is nothing a reader can go and read instead.
 */
const FailureText = ({ text }: { text: string }) => (
	<>
		<pre
			className={cn(
				"mt-1 max-h-40 overflow-auto rounded-md border border-danger-border bg-danger-wash px-2 py-1.5 font-mono text-mono-sm whitespace-pre-wrap break-words text-ink",
			)}
		>
			{text}
		</pre>
		{clippedByWire(text) && (
			<p className={cn("mt-1 text-meta text-ink-muted")}>
				Shortened at the wire. The runtime records at most the first 2,000
				characters of an error.
			</p>
		)}
	</>
);

/**
 * The clipped result, for the states that have no conversation to read instead.
 *
 * This is the ONE survivor of the block the header docstring removes, and it is
 * honest about what the wire did to the value it paints. `result_text` is
 * truncated at the wire (`JOB_RESULT_WIRE_CHARS`, `frontend_state.py:143-164`,
 * cut mid-word) and the cut is marked, so this block announces itself as a
 * `Result preview` exactly when the value carries that marker and as a plain
 * `Result` when it is the whole value. A block that called every one of them a
 * "preview" would claim shortening over values the wire left whole — which is
 * what it did, in one state, over a 27-character state stamp — and one that
 * called them all "Result" would claim a child's whole answer from a prefix of
 * it. Under the value sits the other half of the honesty: the conversation the
 * full text is in is not on this page, which is why the block is here at all.
 *
 * BOUNDED like the failure block, and that is a requirement rather than a
 * preference: every state that renders this one renders it INSTEAD of a
 * conversation, so an unbounded preview would be the takeover the change
 * removed, in the states with the least to look at. `max-h-40 overflow-auto`
 * makes it scroll rather than push, and `text-body-sm` keeps it prose rather than
 * machine voice — the clipping is the app's, not something the child said.
 *
 * The label and the line under it are both decided by `clippedByWire`, so a
 * whole value is announced as the result rather than as a shortened copy of
 * one: the wire's marker is the only evidence either claim has, and a state that
 * reaches this block without it gets neither. The reason the block is here at
 * all — the conversation it belongs to is not on this page — is stated either
 * way, because that is a fact about the PANE and no clip can change it.
 */
const ResultPreview = ({ text }: { text: string }) => (
	<div className={cn("mt-1 flex flex-col gap-1")}>
		<p
			className={cn(
				"max-h-40 overflow-auto rounded-md border border-hairline bg-surface px-2 py-1.5 text-body-sm whitespace-pre-wrap break-words text-ink",
			)}
		>
			{text}
		</p>
		<p className={cn("text-meta text-ink-muted")}>
			{clippedByWire(text)
				? "This is a shortened copy. This subagent's conversation is not available here."
				: "This subagent's conversation is not available here."}
		</p>
	</div>
);

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
 *
 * It names the PAGE rather than the conversation, and that is the one word this
 * sentence has ever needed care over: the foot is painted in every state,
 * including the ones whose body says the conversation is gone, was never
 * addressable, or has nothing painted yet (`previewsClippedResult`). Calling
 * those "the subagent's conversation" told a reader twice that there was nothing
 * to read and then named the missing thing as the thing on screen. "Page" is
 * true in all of them — this pane — and it keeps § 5.6's job, which is about
 * what the surface does NOT do rather than about what it holds.
 */
const ReadOnlyFooter = () => (
	<div className={cn("shrink-0 border-hairline border-t px-3 py-2")}>
		<p className={cn("text-meta text-ink-muted")}>
			Read-only — this is the subagent's page, not a way to steer it.
		</p>
	</div>
);

/** One quiet line for a state where the body has nothing to paint. */
const QuietLine = ({ children }: { children: React.ReactNode }) => (
	<p className={cn("px-3 py-3 text-body-sm text-ink-muted")}>{children}</p>
);

export const RunChildReader = ({
	row,
	childRows,
	childrenOpenable,
	onOpenChild,
	sessionId,
	pulse,
	live,
	previewPage = null,
	attachmentScope,
	measuredAtMs,
	measuredAtRealMs,
	onUnopenable,
	paneWidth,
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
	 * The foot of the page: what this child is doing, as the wire last said it.
	 * Derived rather than read raw so the one rule — which children get a line, and
	 * which phase it is in — stays in the model beside the row it reads
	 * (`deriveChildWorkingLine`, whose docstring carries the vocabulary, the
	 * withheld clock, and the one deliberate departure from the TUI's queued
	 * child).
	 *
	 * Derived on every render rather than memoised, and that is deliberate: it is a
	 * ternary over two fields of a row the pane re-derives at 1 Hz anyway, and the
	 * component it feeds is inert to a fresh object — `WorkingLine` keys its phase
	 * off the PHASE STRING (`working-line.tsx`) and holds its spinner frame in
	 * state, so the same phase with the same activity paints the same frame
	 * whatever the object's identity. A memo here would buy a re-render of one row
	 * and cost an exhaustive-deps exemption.
	 */
	const workingLine = deriveChildWorkingLine(row);

	/*
	 * The follow-the-tail affordance, against THIS pane's own scroller.
	 *
	 * The parent's transcript gets this from the chat page, which owns the
	 * scroller's ref and mounts the control in its composer band
	 * (`chat-page.tsx` -> `message-input.tsx`). The reader owns a scroller of its
	 * own and has no composer, so nothing was ever registered here and the pane
	 * had no way to tell a reader who had drifted up that there was anything
	 * below — the operator's third report on the parent/child difference.
	 *
	 * The hook is the SAME one, over the reader's own ref and the reader's own
	 * row count, so the control's condition (scrollable AND more than a threshold
	 * from the origin) cannot be answered two ways on two surfaces.
	 * `hasNewActivity` is deliberately NOT passed: the parent never passes it
	 * either — no caller of `message-input.tsx` or `chat-content.tsx` does — so the
	 * reader ports the behaviour the operator actually has rather than reviving a
	 * label the parent does not show. The design note's `§6.2` asks for that signal
	 * derived from the reader's own arrivals; the parent's mount is the premise it
	 * rests on and the parent's mount does not derive it, so the premise is what
	 * needs amending rather than the port, and the new-content register is recorded
	 * as deferred on the pull request instead of half-ported here (UX U2; review
	 * R1-3 and design D5 both landed on the same reduction).
	 *
	 * THE THRESHOLD IS `TAIL_EPS_PX`, not the parent's 50, and that is a fix for a
	 * measured gap rather than a preference (UX U3): between 24px and 50px from the
	 * tail the paging policy already says this reader is NOT following the tail
	 * (`followingTail: fromTail <= TAIL_EPS_PX`, `use-scroll-paging.ts`) while the
	 * control stayed hidden — the STATIONARY window in which "not following the
	 * tail" and "offered the way back" disagreed, and the window a reader actually
	 * sits in. Measured on the pre-remediation head: at 24, 25, 49 and 50px the
	 * control is hidden; at 51px it shows.
	 *
	 * QA round 2 (Q3) corrected the first version of this sentence, which claimed
	 * the arrival itself: at 40px the control is hidden pre-remediation and one
	 * arrival does leave the tail 263px away with the newest row 221px below the
	 * fold — but the hook's own recompute has SHOWN the control by then, so the
	 * reproducible defect is the stationary band, not the arrival. One constant, so
	 * the two conditions cannot drift apart again; the parent's 50 is left alone,
	 * because the parent's band is a composer and its divergence is its own
	 * (recorded as a follow-up on the pull request rather than changed here).
	 *
	 * `transcript.records.length` is the `contentKey` for the same reason the chat
	 * page uses its own record count: a child HOP remounts this reader entirely
	 * (`run-panel.tsx` keys it by the row), and a page that grows re-checks the
	 * control's condition, which is what makes it appear while the reader is
	 * scrolled up and new rows are arriving.
	 */
	const { isFarFromBottom, scrollToBottom } = useScrollToBottom(
		TAIL_EPS_PX,
		containerRef,
		transcript.records.length,
	);

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
	 * `pending`, `gone`, an `error` that painted nothing, and an unaddressed child),
	 * because the way out of a
	 * reader that has nothing to paint is the same way out as any other
	 * (`Escape`/Back), and it hands the focus to the transcript — the element that
	 * actually pages — the moment one mounts. The effect re-runs when
	 * `bodyPaintsConversation` flips, so a page that arrives late still takes focus
	 * **if the reader still has it**,
	 * and never otherwise: a reader whose operator has moved on to the composer
	 * leaves their caret alone (round 3, R3-4). It does not re-run on a pulse or a
	 * refetch that leaves the state alone.
	 */
	/*
	 * Whether the BODY below paints the child's CONVERSATION.
	 *
	 * This is the body's own branch condition and not a second opinion about it:
	 * the chain in the markup takes its first four branches on `childSessionId`,
	 * `pending`, `gone` and `loading`, and the branch that renders the transcript
	 * is guarded by THIS boolean, so which states have a conversation is a fact
	 * stated once. The foot's own predicate below is derived from it for the same
	 * reason.
	 *
	 * `error` is the FIFTH member of `ChildTranscriptState` and it is not spelled
	 * out here because it does not need a branch of its own: the hook KEEPS the
	 * rows it already had when a read fails rather than blanking the body it has
	 * (`use-child-transcript.ts`), so a failed read that already painted a page has
	 * a conversation like any other state's, and one that read nothing falls through
	 * to the final `QuietLine` below and paints "no conversation on record yet".
	 * The earlier spelling of this expression (`state === "ready" &&
	 * painted.records.length > 0`) read the first of those two as having no
	 * conversation, and the foot then painted a second, clipped copy of the last
	 * message under the conversation that had just made it — `previewsClippedResult`
	 * disagreeing with the body it is defined against (round 2, C8).
	 *
	 * The focus effect's own dependency below reads it too, for the same reason: the
	 * transcript element exists in exactly the states that paint one. It is declared
	 * before that effect rather than beside it because the effect's docstring above
	 * describes the FOCUS rule, and this is the one condition that rule is about.
	 */
	const bodyPaintsConversation =
		Boolean(row.childSessionId) &&
		state !== "pending" &&
		state !== "gone" &&
		state !== "loading" &&
		painted.records.length > 0;
	/*
	 * Whether the foot may paint the clipped preview at all: i.e. whether the
	 * BODY above has no conversation to paint instead.
	 *
	 * The states that render a `QuietLine` rather than the transcript are named by
	 * `bodyPaintsConversation` — the same expression the markup below branches on,
	 * read here rather than restated — so the two cannot disagree about which states
	 * those are. That is what the earlier spelling got wrong: it agreed with the body
	 * in every state except `error` with rows retained, where the body paints the
	 * conversation and the foot said there was none to paint (round 2, C8).
	 *
	 * `!row.childSessionId` is stated on its own because that absence is permanent
	 * rather than a page in flight: a row the wire never gave a session id cannot
	 * be waited out, and the `loading` the hook reports for it is not the flicker
	 * the exception below is about.
	 *
	 * `loading` is deliberately NOT one of the states that preview, although
	 * `bodyPaintsConversation` is false there: a page in flight is a conversation
	 * that is expected momentarily, and a preview that appeared and then vanished
	 * under itself would be a flicker around the foot of a pane that is already
	 * about to fill in. `pending` and `loading` are the pair the distinction is
	 * for, and they are one predicate apart.
	 */
	const previewsClippedResult =
		!row.childSessionId || (!bodyPaintsConversation && state !== "loading");
	useEffect(() => {
		/*
		 * Which element holds focus for THIS state: the transcript when one is painted,
		 * the reader's root otherwise. `bodyPaintsConversation` is a dependency rather
		 * than only a body read because a page ARRIVING is the transition this effect
		 * is about.
		 *
		 * The move happens only while the reader still holds the focus it took, which
		 * is what makes it idempotent per open AND harmless when a page arrives late
		 * (round 3, R3-4). `document.activeElement` is one of the reader's own two
		 * elements, or nothing (a pane opened over an unmounted roster row leaves it
		 * on `<body>`) — those are the cases where the focus is the reader's to move.
		 * Anything else means the operator has put it somewhere since, and the common
		 * case is the composer: the previous, unconditional version fired on every
		 * `bodyPaintsConversation` transition, so a slow child's first rows pulled the
		 * caret out of a half-typed message.
		 */
		const target = bodyPaintsConversation
			? containerRef.current
			: readerRef.current;
		if (!target) return;
		const active = document.activeElement;
		const mine =
			active === null ||
			active === document.body ||
			active === readerRef.current ||
			active === containerRef.current;
		if (!mine || active === target) return;
		target.focus();
	}, [bodyPaintsConversation]);

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
			 * The child's OWN subagents (`§ 5`), and why it sits HERE rather than
			 * further down the page.
			 *
			 * The reader's column is the pane's height less the 40px chrome bar
			 * (`§ 8`), and the transcript below is this view's ONE scroll owner —
			 * `flex-1 min-h-0`, bottom-pinned to the tail page the route answers
			 * (`§ 5.3`). A `shrink-0` band in the HEAD therefore costs exactly what it
			 * draws and nothing else: 28px of label line (`px-3 pt-2 pb-1` around
			 * `text-meta`'s 16px) plus one 32px or 48px row per direct child, the
			 * roster's own ladder, because these are the roster's rows. The transcript
			 * absorbs that cost and keeps its scroll. Anything placed INSIDE the body
			 * would either join the transcript's reversed scroller — painting a list of
			 * children at the tail end of a conversation — or add the second scrollbar
			 * `§ 8`'s scroll-owner row forbids.
			 *
			 * ABOVE the brief rather than below it, because the two blocks answer the
			 * questions a reader asks in this order: the facts row names the child,
			 * this section says who that child delegated to, and the brief is the
			 * longest block on the page (folded, up to its `max-h-48`) whose text
			 * belongs beside the transcript it heads.
			 */}
			<ChildSubagents
				ownerLabel={row.label}
				rows={childRows}
				interactive={childrenOpenable}
				onOpenChild={onOpenChild}
				paneWidth={paneWidth}
			/>

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
			 *
			 * KNOWN GAP, DELIBERATELY DEFERRED (review round 1, R3 / QA Q-1): a
			 * RUNNING child whose page is still empty — `pending`, `gone`, `loading`,
			 * or `ready` with no rows — paints no foot line, because these arms
			 * answer with a `QuietLine` and never reach `CanonicalTranscript` (and
			 * so never receive `workingLine`). The activity string is on the row
			 * already; what is missing is a composition decision about a line ABOVE
			 * an absence sentence whose copy `§ 10.1` owns. `docs/run-sidebar.md`
			 * `§ 5.8` records it, and `scripts/child-reader-foot-react.test.mjs` renders
			 * these arms and pins that no line is painted, so the follow-up that adds one
			 * cannot land unnoticed.
			 */}
			<div
				className={cn(
					/*
					 * `relative` because this div is the positioning context for the
					 * follow-the-tail control below: the control must not scroll with the
					 * conversation, and the transcript's own scroller cannot host it (an
					 * absolutely positioned child of a scroller moves with the content it is
					 * meant to lead you back to).
					 */
					"relative flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas",
				)}
			>
				{/*
				 * The follow-the-tail control, at the foot of the pane and in the reader's
				 * OWN column.
				 *
				 * WHERE IT BELONGS. The parent mounts this in the composer band, another
				 * column under the transcript; the reader has no composer, so the band it has
				 * is the one its own layout draws at the foot of the conversation — the strip
				 * reserved by the `h-12` spacer at the end of this body. THE SHARED CONTROL
				 * NO LONGER TAKES A DISTANCE: the composer redesign (its D15) anchors the
				 * disc `bottom-full` + 12px to its container's TOP edge, so a pane with no
				 * composer states its own floor in classes — `bottom-2` puts the disc 8px
				 * above the band's floor and `mb-0` drops the composer's 12px step, the same
				 * geometry the old `bottomDistance={8}` measured, and `left-0 right-0
				 * justify-center` keeps the chip centred on the reading column the design
				 * round signed, rather than the parent's `right-3`. It is 8px rather than
				 * the 16px the first cut used (which put the chip on the rows' own text —
				 * QA Q1, UX U1).
				 *
				 * FIRST IN THE DOM, LAST ON SCREEN, on purpose (UX U4). `absolute` takes it
				 * out of flow, so its DOM position costs nothing visually, and putting it here
				 * keeps the pane's own controls together for a keyboard user: rendered after
				 * the conversation it was the last tabbable in the pane AND in the app, reached
				 * only after tabbing through every row of a streaming child. The screen
				 * position is unchanged — the spacer at the foot is what gives it a home.
				 *
				 * The control is `pointer-events-none` while hidden
				 * (`scroll-to-bottom-button.tsx`), so it cannot be hit when it is not showing,
				 * and the band below it carries no text either way.
				 */}
				{bodyPaintsConversation && !row.errorText && (
					<ScrollToBottomButton
						visible={isFarFromBottom}
						onClick={scrollToBottom}
						className="bottom-2 left-0 right-0 mb-0 justify-center"
					/>
				)}
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
				) : bodyPaintsConversation ? (
					/*
					 * ONE CLIP, AT THE SCROLLER'S OWN BOX (design round 2, D6).
					 *
					 * The conversation's scroller is the focused element after any wheel or
					 * click, so it draws the app's own `:focus-visible` ring
					 * (`html :focus-visible`, 2px + a 2px offset, `--color-accent`) around
					 * its border box. Outlines are ink overflow and an ancestor's
					 * `overflow: hidden` clips them exactly as it clips a shadow — that is
					 * the stylesheet's own doctrine, and it is why this scroller has never
					 * shown a ring: in this column the scroller's box is the body's box, so
					 * the stroke falls outside the clip on every side.
					 *
					 * The reserved band below the conversation moved that clip bottom by
					 * 48px, and the ring's BOTTOM segment — 2px wide, full width, in
					 * `accent` — landed inside it: a rule across the foot, in twelve of the
					 * sixteen captured states and in every palette, appearing and
					 * disappearing with focus. It reads as a divider between the
					 * conversation and the control, which is not what a quarter of a focus
					 * ring should look like.
					 *
					 * So the clip goes back to the scroller's own box, on a wrapper this
					 * pane owns rather than on the body: the band is OUTSIDE the clipped
					 * region, the ring is clipped where it always was, and nothing else
					 * about the layout moves (the wrapper is the only child's box).
					 *
					 * WHAT THIS DOES NOT FIX, stated rather than hidden: the scroller is
					 * then a focusable element with no VISIBLE ring — the pre-existing
					 * defect this segment accidentally exposed, not one this pane
					 * introduced. The parent transcript's scroller sits in the same
					 * position (its own box is its clip box too), so the honest fix is the
					 * pattern the stylesheet names for exactly this case — the WRAPPER
					 * draws the ring (`has-[:focus-visible]:outline-solid`) — applied to
					 * `CanonicalTranscript`'s scroller, which is shared with the chat page
					 * and needs its own evidence on the surface with more users. Recorded
					 * as a follow-up on the pull request; not half-done here.
					 */
					<div
						data-lo-child-transcript-clip=""
						className={cn("flex min-h-0 grow flex-col overflow-hidden")}
					>
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
							/*
							 * The foot: what the child is doing, from the roster row rather than from
							 * `painted.records`. Passing it is the whole change - omitted, the parent
							 * derives from the records it was given, and a child's durable rows reduce
							 * to `phase: "done"` (`transcript-reducer.ts:1867`), so the derivation
							 * paints nothing here; its phase is `null` for a pane that claims no send.
							 * `null` - a settled child, or a queued one - paints nothing.
							 */
							workingLine={workingLine}
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
							 * The reader's question, answered by this reader's own state: this
							 * branch is reached only where `bodyPaintsConversation` holds, so the
							 * child's page HAS been read and rows were painted (`ready`, or a
							 * failed read that kept the rows it had) and nothing is still owed.
							 * The hold cannot fire anyway — it needs zero records and this branch
							 * is reached only with rows — and `false` is what the reader's own
							 * state says rather than a value chosen to keep the predicate quiet.
							 */
							awaitingHydration={false}
							/*
							 * A child page has no session handle to re-arm: its read is the
							 * child-scoped route, re-run when the child next beats (`pulse`),
							 * and `useChildTranscript` exposes no reconnect of its own. The
							 * prop is required by `CanonicalTranscript` so the live chat
							 * surface can never paint a notice without its action; this
							 * reader paints no notice at all (`failure` is null, and its
							 * unavailable states are the body's own quiet lines rather than
							 * a notice), so the handler is unreachable rather than an inert
							 * control.
							 */
							onReconnect={() => {}}
							attachmentScope={attachmentScope}
						/>
					</div>
				) : (
					/*
					 * A page with no rows this renderer paints: the file exists and holds
					 * nothing, or the read failed before it ever painted one. One line, no
					 * skeleton — a state a reader can read rather than an animation they
					 * have to wait out. This is the other half of `bodyPaintsConversation`,
					 * the branch that decides whether the transcript is painted at all
					 * (round 2, C8).
					 */
					<QuietLine>
						This subagent has no conversation on record yet.
					</QuietLine>
				)}
				{/*
				 * The failure, at the foot and UNGATED on what the body painted: the
				 * exception is the parent's, not the child's, so no transcript holds
				 * it and there is nothing to prefer it to (`FailureText`).
				 */}
				{row.errorText && (
					<div className={cn("shrink-0 border-hairline border-t px-3 py-2")}>
						<span className={cn("text-meta text-ink-muted")}>Failed</span>
						<FailureText text={row.errorText} />
					</div>
				)}
				{/*
				 * The clipped result, and ONLY where the body painted no conversation
				 * (`previewsClippedResult`) — otherwise the page's own last message IS
				 * the result and this block would be a lossy second copy of it under
				 * the conversation that just made it (the header docstring). The
				 * failure wins the slot when both are on the wire, which is the
				 * precedence the single outcome block had before this change.
				 */}
				{!row.errorText && previewsClippedResult && row.resultText && (
					<div className={cn("shrink-0 border-hairline border-t px-3 py-2")}>
						<span className={cn("text-meta text-ink-muted")}>
							{clippedByWire(row.resultText) ? "Result preview" : "Result"}
						</span>
						<ResultPreview text={row.resultText} />
					</div>
				)}
				{/*
				 * The control's band: the pane's own foot, reserved so the control can float
				 * in it WITHOUT covering a row.
				 *
				 * WHY A RESERVED BAND, with the numbers. The control is a 2rem chip; the
				 * parent mounts it over its composer band, which carries no transcript text.
				 * This pane has no composer, so the first cut put the chip 16px above the
				 * conversation's own bottom edge — the transcript's `p-4` — and that inset is
				 * where the rows' TEXT is: measured on the pre-remediation head, the chip's
				 * rect `(1055,818)`–`(1087,850)` intersected the row at the fold by its full
				 * 32px (QA Q1, UX U1). The band is 48px — 8px of air, the 32px chip, 8px of
				 * air — reserved in the body's own flex column, so the chip has somewhere to
				 * live that the conversation does not paint into.
				 *
				 * RESERVED STATICALLY rather than only while the control shows, and that is
				 * the reason for the shape: a band that appeared WITH the control would move
				 * the reader's own text by its height at the exact moment they are reading —
				 * the motion this pane's rig exists to prove is absent across arrivals. The
				 * condition is a LAYOUT condition (`bodyPaintsConversation` and no failure),
				 * so the band never changes size while the reader scrolls; only the control's
				 * opacity does. The honest cost is 48px of inset above the read-only statement
				 * in every painted state, against a control that can no longer land on a word.
				 *
				 * GATED ON THE CONVERSATION'S OWN BRANCH, and that gate is load-bearing
				 * rather than tidiness: the outcome blocks this pane draws under the
				 * conversation are `shrink-0` and own the pane's foot when they are present.
				 * A child with no painted conversation has no scroller to lead back to. And a
				 * child whose EXCEPTION is painted gets no control at all, even when its
				 * conversation is long and scrollable: the band sits under the failure text, so
				 * a control there would sit over the one thing on this surface a reader must be
				 * able to read (QA Q2 — the trade stated rather than inherited; the wheel still
				 * gets the reader up, and `docs/run-sidebar.md` `§5.6` now carries the rule).
				 */}
				{bodyPaintsConversation && !row.errorText && (
					<div
						data-lo-child-chip-band=""
						className={cn("h-12 shrink-0")}
						aria-hidden="true"
					/>
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
