/**
 * The canonical transcript view.
 *
 * Paints `TranscriptRecord`s from the canonical session stream by the
 * docs/branding.md § 7 hierarchy, most prominent first:
 *
 *   1. the pending gate (a question for the user) — DOCKED above the composer
 *      by `QuestionDock` (§F1), not drawn here; the gate is read only by the
 *      working line;
 *   2. assistant prose at reading weight, no paper;
 *   3. one dense ledger row per tool action (`ToolRow`), running state on the
 *      row itself, never a spinner beside it — the one animated indicator is
 *      the aggregate `WorkingLine` at the foot;
 *   4. tool output behind the line's own disclosure;
 *   5. reasoning hidden (the canonical stream carries none as prose; a
 *      `thinking` record would go through `AgentReasoning`).
 *
 * Performance contract, because this is the surface that repaints per token:
 *
 * - Every row is a `memo` component keyed by the backend record id, and the
 *   reducer returns the SAME record object when nothing changed, so a delta
 *   to one assistant record re-renders exactly that row.
 * - Long transcripts are windowed: only the newest `WINDOW` rows mount, and
 *   scrolling up widens the window one step per deliberate act under the
 *   paging policy below, so the scroll container's `column-reverse` overflow
 *   anchor keeps the reader pinned.
 * - `performance.mark("lop:transcript:render")` per commit lets the numbers
 *   be read from the browser rather than asserted.
 *
 * Both kinds of growth — widening the local window and fetching the next
 * durable page — are driven by `use-scroll-paging`, which owns the one rule
 * this file previously got wrong in two different ways. The window widened
 * from a raw `scroll` listener, once per EVENT, so a fling widened it dozens
 * of times; the durable page did not happen at all without a click. Both are
 * now one coalesced demand with a settle debounce, a latch, and a held anchor.
 * The policy is pure and tested in `scripts/transcript-paging.test.mjs`; the
 * reasoning lives in `scroll-paging.ts`.
 *
 * Autoscroll is never taken from the reader: `column-reverse` plus the
 * overflow anchor keeps the newest content pinned only when they are already
 * at the bottom; the composer's "New activity" affordance covers the rest.
 * Scroll paging inherits that rule rather than restating it — a reader
 * following the tail neither loads a page nor has their offset corrected.
 */

import {
	NO_PROVIDER_NOTICE,
	useConnectProviderStore,
} from "@features/providers/connect-provider-store";
import { Button } from "@shared/components/ui";
import { useCompletionView } from "@shared/hooks/use-completion-view";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import {
	expandedRunsOf,
	writeRunExpanded,
} from "@shared/store/turn-collapse-open";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { showInfoToast } from "@shared/utils/toast-manager";
import {
	CircleAlert,
	Info,
	MessageSquareText,
	TriangleAlert,
} from "lucide-react";
import {
	type FC,
	type FocusEvent,
	type MouseEvent,
	type PointerEvent,
	type RefObject,
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link } from "react-router-dom";
import type {
	CanonicalFrontendState,
	PendingDesktopGate,
} from "../../../../../shared/desktop-session-contract";
import type { SessionFailureNotice } from "../../../../../shared/desktop-stream-notice";
import { askResponseSummary, askTimeoutSummary } from "../ask-queue";
import { CHAT_COLUMN_CONTAINER, CHAT_MEASURE } from "../chat-measure";
import { CHAT_REGION_LABEL } from "../chat-regions";
import {
	MarkdownRenderer,
	StreamingMarkdown,
} from "../components/markdown-renderer";
import { MessageContainer } from "../components/message-item/message-container";
import { TurnTimestamp } from "../components/message-item/turn-timestamp";
import { ReplyPreview } from "../components/reply-preview";
import { DiffBlock, TraceLine } from "../components/trace";
import {
	peerHasDetail,
	peerIdentityLine,
	peerSummary,
	wakePromptBody,
	wakeReceiptHeadline,
} from "../components/trace/receipt-row-model";
import {
	DETAIL_SECTION_MAX,
	ToolDetail,
} from "../components/trace/tool-detail";
import { hasDetail } from "../components/trace/tool-detail-model";
import { ToolRow as ToolLedgerRow } from "../components/trace/tool-row";
import {
	SEND_DELIVERY_NOTE,
	type SendDeliveryState,
	deliveryRowOutcome,
	formatBytes,
	formatDuration,
	isBareToolName,
	isDiffBodyRow,
	isFailedResult,
	outputFallbackLine,
	summaryFromArgs,
	toolOp,
} from "../components/trace/tool-row-model";
import { TraceFold } from "../components/trace/trace-fold";
import { TurnSummary } from "../components/trace/turn-summary";
import { WorkingLine } from "../components/trace/working-line";
import { focusComposer } from "../composer-field";
import { MISSING_SESSION_NOTICE_ID } from "../missing-session-notice";
import {
	DEFAULT_TRANSCRIPT_DISPLAY_MODE,
	type TranscriptDisplayMode,
	parseTranscriptDisplayMode,
} from "../transcript-display-mode";
import { CanvasPaneProvider } from "../utils/canvas-pane";
import { parseReplies } from "../utils/reply-utils";
import { CanonicalImage } from "./canonical-image";
import { CheckpointRail } from "./checkpoint-rail";
import { visibleRecords } from "./cross-session-visibility";
import { isRecordReachable } from "./failed-row-jump";
import { FoldMedia } from "./fold-media";
import { type FoldOpenEntry, foldOpenOf, withFoldOpen } from "./fold-open";
import { ImageGenCard } from "./image-gen-card";
import { imageGenCardView, isImageGenTool } from "./image-gen-card-model";
import { LinkToolkit } from "./link-toolkit";
import type { LoadOlderOutcome } from "./load-older";
import { forkEntryId } from "./message-actions";
import { AnswerActionRow } from "./message-actions-row";
import { OLDER_HISTORY_HINT_ID, OlderHistorySlot } from "./older-history-slot";
import type { OpenFrameFacts } from "./open-frame";
import {
	type ProviderErrorAction,
	providerErrorGuidance,
} from "./provider-error-guidance";
import { isQuotable } from "./quote-model";
import { QuoteToolkit } from "./quote-toolkit";
import { ensureReachable, jumpToEntry } from "./reveal-record";
import { SETTLE_MS } from "./scroll-paging";
import { THREAD_SEARCH_JUMP_MISS_COPY } from "./thread-search-model";
import { ThreadSearchOverlay } from "./thread-search-overlay";
import {
	type FoldGroup,
	type TurnFoot,
	foldImages,
	foldRuns,
	turnFeet,
	workedSecondsOf,
} from "./trace-fold-model";
import {
	TRANSCRIPT_DRAG_SLOP_PX,
	clickTargetIsControl,
	modalIsOpen,
	transcriptClickVerdict,
	wheelWithinGuard,
} from "./transcript-focus";
import { shareInFlight } from "./transcript-loader";
import {
	type CanonicalTranscriptStatus,
	canonicalTranscriptTerminal,
	transcriptPaneCollapses,
	transcriptPaneHoldsPlaceholder,
} from "./transcript-pane";
import { TranscriptPlaceholder } from "./transcript-placeholder";
import {
	type TranscriptImage,
	type TranscriptRecord,
	type TranscriptState,
	isInterruptedFault,
	streamDiagnostics,
	withRecoveredOutcome,
} from "./transcript-reducer";
import {
	GAP,
	type Row,
	buildRows,
	ledgerName,
	paintsSomething,
	runsOf,
	splitFirstLine,
} from "./transcript-rows";
import { turnAnswerMarkClass } from "./turn-answer-rail";
import {
	ALIGN_WALK_MAX_PAGES,
	type RunCollapsePlan,
	type SegmentPlan,
	WIDEN_MAX_STEPS,
	WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
	alignWalkDecision,
	alignWalkRunKeyConfirmed,
	alignWalkStateFor,
	collapsePlan,
	collapsePlanInputKey,
	collapseRowsKey,
	initialAlignWalkState,
	paintedRows,
	snapWindowToRunBoundary,
	widenTarget,
	windowTopRun,
} from "./turn-collapse-model";
import { useActiveCheckpoint } from "./use-active-checkpoint";
import type { AttachmentScope } from "./use-attachment-url";
import { useCheckpoints } from "./use-checkpoints";
import { useCrossSessionHidden } from "./use-cross-session-hidden";
import { useLinkSubject } from "./use-link-subject";
import { useScrollPaging } from "./use-scroll-paging";
import { useTurnAnswerRail } from "./use-turn-answer-rail";
import {
	type WorkingLineState,
	deriveWorkingLine,
	workingLineInputFor,
} from "./working-line-model";

/*
 * The user bubble takes no measure class any more.
 *
 * Its prose used to be centre-constrained at 62ch inside a card that a reply
 * quote or a wide attachment had widened — the operator report of 2026-09-16.
 * The card's own width is the measure now, so there is nothing to opt into;
 * `markdown.css`'s measure comment carries the report and the numbers, and the
 * rule that also keeps a cap off the agent's answer.
 */

const WINDOW = 60;
const WINDOW_STEP = 60;

/**
 * DEV INSTRUMENTATION (UI perf audit P1/P4; PR-6): how many times the foot map
 * and the chat-entry list are rebuilt.
 *
 * Both are memos over the window's `visible` rows and both used to rebuild on
 * every streamed token. These counters are what the benches read to show the
 * per-token work an input signature removes - the same shape
 * `dbgCollapsePlanCalls` (`turn-collapse-model.ts`) and `dbgActiveCueScans`
 * (`use-active-checkpoint.ts`) use. Nothing at runtime reads them.
 */
export const dbgFeetRebuilds = { count: 0 };
export const dbgChatEntriesRebuilds = { count: 0 };

/**
 * How far the render window may be extended to land its top edge on a run
 * boundary (the on-load fix, operator report 2026-09-28).
 *
 * The extension is the CHEAP half of alignment: a completed run the window's
 * edge cuts through lands its opening user row inside the list the plan reads,
 * so the bar gains the head row and the real duration in the same commit.
 * Three durable pages is the same order as `RECONCILE_TAIL_MAX_ENTRIES` and
 * covers every run whose collapse fills a screen; a run taller than this keeps
 * the window cut (renders cut at its top until the reader widens past it) —
 * since the end-loaded rule that costs the bar its Took clause, never the bar.
 * The cost of an extension is one heavier commit, not heavier DOM: a collapsed
 * run unmounts its hidden rows in the same render that plans them.
 */
const WINDOW_ALIGN_MAX_EXTRA = 300;

/* (`ALIGN_WALK_MAX_PAGES`, the walk's bound, lives in `turn-collapse-model.ts`
 * beside the decision that spends it.) */

/**
 * What a bar's appearance says out loud (the settle announcement's sentence).
 *
 * The bar's own words and quantities, so the announcement never states more
 * than the row does: the duration clause only when the bar carries one (a
 * head-cut bar does not — the number would be fabricated), the action count
 * only when non-zero. `formatDuration` is the bar's own formatter, so the
 * sentence and the row cannot disagree about "20m30s".
 */
function condenseSentence(segment: SegmentPlan): string {
	const parts: string[] = [];
	if (segment.facts.durationS !== null) {
		parts.push(`took ${formatDuration(segment.facts.durationS)}`);
	}
	if (segment.facts.actions > 0) {
		parts.push(
			segment.facts.actions === 1
				? "1 action"
				: `${segment.facts.actions} actions`,
		);
	}
	/*
	 * A labelled bar states its own kind first ("Wake: 8 actions."): a
	 * follow-up section appearing after the answer is not "the turn condensing",
	 * and saying so would announce the answer's own turn twice.
	 */
	const lead = segment.label ?? "Turn condensed";
	return parts.length === 0 ? `${lead}.` : `${lead}: ${parts.join(", ")}.`;
}

/**
 * Every row id a plan holds — the settle announcement's "was this run on
 * screen last pass" denominator (see that effect's comment).
 */
function planRowIds(runs: readonly RunCollapsePlan[]): Set<string> {
	const ids = new Set<string>();
	for (const run of runs) {
		for (const id of run.recordIds) ids.add(id);
	}
	return ids;
}

export type CanonicalTranscriptProps = {
	frontend?: CanonicalFrontendState | null;
	transcript: TranscriptState;
	gate: PendingDesktopGate | null;
	/** The owner is generating and nothing has painted yet for this turn. */
	waiting: boolean;
	/**
	 * A send from this conversation has been admitted and produced nothing yet.
	 *
	 * The one input here that is the APP's fact rather than the owner's: it is
	 * true from the moment an admission request is issued. It exists because a
	 * cold send spends seconds inside that request and the transcript used to
	 * show the user's own bubble and then nothing, which reads as the message
	 * having been dropped. See `working-line-model.ts` for the copy rule this
	 * branch is held to.
	 */
	starting: boolean;
	/**
	 * The record this send painted, which the wait's clears measure from.
	 *
	 * Passed rather than looked up here because the anchor is the app's own
	 * memory of its send, not a property of the transcript: see
	 * `ownerAnswered` for why a clear scoped to the tail of the list is a
	 * different (and wrong) rule.
	 */
	startingAfterId?: string | null;
	/**
	 * Whether the admitted send is still in its CREATE hop - no session id yet -
	 * which is what moves the wait line's label from `waiting for the agent` to
	 * `starting the session`.
	 *
	 * Passed from the page that owns the latch rather than re-derived here: the
	 * fact is the draft row's `sessionId`, and the page stitched it with the
	 * latch in the same expression that decided `starting`, so the two cannot
	 * disagree about which half of the wait is on screen.
	 */
	startingSession?: boolean;
	/**
	 * When the admitted send was issued (epoch ms), or null when nothing is
	 * admitted - the anchor the line's clock counts from.
	 *
	 * WHY IT IS NOT THIS COMPONENT'S MOUNT. The wait outlives every pane that
	 * renders it (the flip, a switch away and back), and the clock's contract is
	 * that the number never restarts under the reader; the anchor is the press's
	 * own instant, persisted on the draft row. See
	 * `WorkingLineInput.startingSince`.
	 */
	startingSince?: number | null;
	/**
	 * A Stop press is in flight for this conversation (the page's own fact):
	 * the working line relabels to the cancel-in-progress rung while it holds.
	 *
	 * Passed through to `workingLineInputFor` untouched - see
	 * `WorkingLineInput.stopping` for why the rung exists and why it carries no
	 * clock.
	 */
	stopping?: boolean;
	/**
	 * The image-gen card's Cancel path: the page's turn-interrupt press
	 * (`chat-page.tsx`'s `stop`, as `chat-content.tsx` folds it into
	 * `canonicalStop`), handed down so a running generation can be cancelled
	 * from its own card.
	 *
	 * THE SAME WRITE PATH the composer's Stop and Escape already take - never a
	 * second interrupt mechanism - which is why it arrives as the callback and
	 * is not re-derived here. PROVIDED ONLY WHERE A PRESS CAN WORK: the call
	 * site passes it when the backend advertises `session_interrupt` and the
	 * pane is not terminal (`canonicalStop`'s own two terms), so an absent prop
	 * means the card renders no Cancel control at all - never a button whose
	 * every press would answer "nothing was running".
	 *
	 * The restart and steer affordances are DELIBERATELY not wired: the named
	 * op for a regenerate press is not defined yet (the image-gen programme's
	 * frozen facts), so integration provides Cancel alone and the slots are
	 * demonstrated in stories until the op is named.
	 */
	onInterruptTurn?: () => void;
	/**
	 * The disputed idle is standing (the page's own fact): an `idle` receipt
	 * arrived while the pane still claimed a live turn.
	 *
	 * Passed through to `workingLineInputFor` untouched - see
	 * `WorkingLineInput.idleDisputed` for why the claim stays and only the
	 * clock is withheld (UX round 2, U9).
	 */
	idleDisputed?: boolean;
	/**
	 * The working line to paint, for a surface whose line does NOT come from this
	 * pane's own live session — today the run panel's child reader.
	 *
	 * OMITTED is every existing caller, and it must stay bit-for-bit what it was:
	 * the line is derived from this pane. A VALUE paints that line instead, and
	 * `null` paints none.
	 *
	 * WHY THE CHILD READER NEEDS IT (`working-line-model.ts` cannot answer for a
	 * child). A child's activity IS on the wire, but not in the reader's records:
	 * the reader renders the child's DURABLE page, and `transcript-reducer.ts`
	 * reduces every durable tool row to `phase: "done"` — the tool arm of
	 * `durableRecord` (`:1867`, declared `:1661`) — so for the props this reader
	 * passes (neither `waiting` nor `starting`) `deriveWorkingLine` over those
	 * records paints NOTHING and returns `null` (`working-line-model.ts:600`). The
	 * relay's progress string is the only place the child's own fact exists, so the
	 * reader hands the line in from the roster row it already holds
	 * (`deriveChildWorkingLine`, `run-detail-model.ts`).
	 *
	 * WHY `waiting`/`starting` WERE THE WRONG CHANNEL. `waiting` makes the
	 * derivation read THIS pane's records — for the reader those are the child's
	 * durable rows, which carry no running tool, so the one thing it could then say
	 * is `thinking` (the batch arm has nothing to count) while claiming a phase it
	 * cannot know. `starting` names a send THIS app admitted, and the admitted-send
	 * rung belongs to the pane that issued the send: a child reader can never be
	 * that pane (see its own comment). Neither prop can carry a fact that arrived on
	 * the wire about somebody else's conversation, which is why this is a third
	 * input rather than a re-reading of the two that are already here.
	 */
	workingLine?: WorkingLineState | null;
	loadingOlder: boolean;
	/**
	 * Fetch the next durable page. Resolving `false` rather than rejecting is
	 * what lets the paging policy count failures and stop retrying on its own
	 * (clause G); a caller that cannot report failure gets an unbounded retry
	 * loop or no retry at all, and neither is the contract.
	 */
	onLoadOlder: () => Promise<boolean>;
	/**
	 * The outcome-aware form of `onLoadOlder`, passed straight to the scroll pump
	 * so a lost race is not read as a failure. Optional: a caller with only the
	 * boolean keeps the old behaviour.
	 */
	onLoadOlderOutcome?: () => Promise<LoadOlderOutcome>;
	/** The session hook's single statement that the last ask failed. */
	olderFailed?: boolean;
	/**
	 * Re-ask the conversation's authoritative history read. Optional; see
	 * `OlderHistorySlot`'s prop of the same name — it is the control on the
	 * slot's `unproven` arm, and without it that arm states the fact and drops
	 * the control.
	 */
	onRetryHydration?: () => void;
	/**
	 * The older-history row's transport truth, where the caller knows it better
	 * than `status` does.
	 *
	 * The slot drops its retry while the transport is down, because a retry that
	 * cannot succeed must not be painted beside the transcript's own notice
	 * (`older-history-slot.tsx`). For a pane whose rows came from the session's
	 * own stream, `status` is that answer and stays it; this prop exists for a
	 * caller painting these rows from something else. The child reader's page is
	 * a read-only GET whose own `status` is a static `"live"` (there is no stream
	 * of ITS to be connecting or reconnecting on), so without it a child's failed
	 * page offers a `Try again` that cannot work while the parent's identical
	 * failure goes quiet — the asymmetry design round 1's D2 measured.
	 *
	 * Omitted, nothing changes: the row reads `status !== "live"` exactly as it
	 * always has.
	 */
	olderTransportDown?: boolean;
	/**
	 * The open frame's facts for this pane's page (`open-frame.ts`), or nothing.
	 *
	 * WHAT IT REPLACES, and it is the whole point of this prop: condensation here
	 * is a pure function of the LOADED rows, so a settled run whose head lies
	 * above the page condenses from a fragment - a minimum count, no duration -
	 * and this pane then spends the next several hundred milliseconds growing the
	 * bar one `/history` page at a time (the align walk below). With the facts,
	 * the bar states the turn's own figure on the frame it is first seen, and the
	 * walk stands down for that run. Absent is every old backend, every
	 * `building` answer, every peer's conversation and the child reader: today's
	 * behaviour, exactly.
	 */
	openFrame?: OpenFrameFacts | null;
	containerRef: RefObject<HTMLDivElement>;
	isSmallView: boolean;

	status: CanonicalTranscriptStatus;
	/** The published failure state: one product sentence and its action. */
	failure: SessionFailureNotice | null;
	/**
	 * Is an authoritative page for THIS session still owed?
	 *
	 * The hold stand-down below asks this and not `status`, because the two
	 * disagree in both directions on this path: `Retry` re-arms the stream as
	 * `connecting` in front of a conversation a completed read has already proven
	 * EMPTY, and a cold session's `cursor_missing` snapshot goes `live` without
	 * ever hydrating. Required rather than defaulted, like `onReconnect`: the
	 * caller that owns the reader is the only thing that can answer it, and a
	 * default would let a new call site collapse a conversation nobody has read
	 * yet.
	 *
	 * It is the SAME composed value the composer band reads as `isHydrating`
	 * (`CanonicalSessionHandle.awaitingHydration`), not a second derivation: a
	 * session-less draft owes no page, and `hydrated` alone cannot say so - it is
	 * false for a pane that will never have a session to hydrate. The rule and
	 * its failing shapes live in `transcriptPaneHoldsPlaceholder`.
	 */
	awaitingHydration: boolean;
	/**
	 * Has the conversation's history been PROVEN read (the session view's
	 * `hydrated`)?
	 *
	 * This is the older-history slot's end-claim gate, and deliberately a
	 * separate fact from `awaitingHydration`: `has_more: false` may come from a
	 * read that could not see the conversation at all (a stored remote session's
	 * cold open answers from a facade with no owner), and only proof makes "Start
	 * of conversation" honest. `awaitingHydration` says whether a page is still
	 * OWED; this says whether one has been READ — both false/true while owed, and
	 * the pair is what lets the slot hold "not loaded" rather than claiming an
	 * end nobody established (remote-load-hydration).
	 *
	 * OPTIONAL, DEFAULTING TRUE, and the default is a stated claim rather than a
	 * convenience: a caller that does not pass it asserts its rows are read whole
	 * — the child reader's page (a direct read of the child's own transcript), a
	 * story fixture, and the legacy callers all are. The chat pane, the one
	 * caller that can be owed a page, passes the session view's `hydrated`; a
	 * future caller that can be owed one must pass it too, or its slot can claim
	 * an end nobody has established.
	 */
	hydrationProven?: boolean;
	/**
	 * Whether a history read is OUT for this session — the session view's
	 * `historyReadPending` (`use-canonical-session`), true while a
	 * `reconcileTail` walk is in flight.
	 *
	 * What it does: the `unproven` end's "Try again" is a control whose press
	 * must be answerable, so while the read it fired is out the slot paints the
	 * pending row instead of repainting the identical "not loaded" row
	 * (UX round 1, U1; the session hook also refuses to stack a second walk
	 * while one is out). Optional, defaulting false — the conservative
	 * direction: a caller that omits it paints no pending state, which is a
	 * missed acknowledgement rather than a claim nobody made. The chat pane,
	 * the one caller with a walk to track, passes the view's own fact.
	 */
	historyReadPending?: boolean;
	/**
	 * True while the rows below came from the local paint cache rather than from
	 * the owner (M2).
	 *
	 * It is a rendered state, not a hint: rows stay at full `ink` (a cached row is
	 * a real row, and opacity is banned as a state signal in this system), and
	 * what says "this may be behind" is ONE caption in the pane's own status
	 * slot — the same slot `Reconnecting` and the failure notice use. It is
	 * present from the cached paint's first frame and goes in the same commit as
	 * the reconciled rows, so the reader never sees reconciled rows labelled
	 * "last saved" or the reverse.
	 */
	stale?: boolean;
	/**
	 * True when the backend says this conversation is not on this machine (M6).
	 *
	 * A distinct state rather than the failure notice, because that notice is
	 * about a TRANSPORT that may recover; the path that reaches this one is the
	 * notification click, which deliberately does not validate the id first and
	 * therefore needs words for "this conversation is gone" with no round trip
	 * spent to learn it.
	 */
	missing?: boolean;

	/**
	 * Which conversation's rows this is, for attachment resolution — defaulting
	 * to the live session's own.
	 *
	 * Supplied by the run panel's child reader, whose rows belong to a CHILD
	 * conversation inside the same session: a child's images are digests in the
	 * shared store and are served by the child-scoped route, which the parent's
	 * route refuses. Left undefined here, the scope is derived from `frontend`,
	 * which is the live session and the right answer for the main transcript.
	 * The reader passes its own because it deliberately hands `frontend={null}`
	 * to switch the rest of the live-session machinery off.
	 */
	attachmentScope?: AttachmentScope | null;
	/**
	 * The conversation a quote from a row is staged under.
	 *
	 * Handed in by `chat-content.tsx` as the SAME expression the composer is
	 * given as its `conversationId`, and the value is load-bearing: the
	 * conversation input store's replies (and the composer's `ReplyPreview`
	 * above them) are keyed per conversation, so a transcript that invented its
	 * own id here would stage a quote into a key nobody paints and the press
	 * would look like a no-op. Absent on a surface with no composer to receive
	 * it (stories, the run panel's child reader), which is why it is optional
	 * and why the toolkit does not mount without it.
	 */
	conversationId?: string;
	/**
	 * Tool call ids whose first label read is still in flight
	 * (`CanonicalSessionView.labelPending`). Such a row paints its object column
	 * EMPTY rather than the output stand-in, so the first frame of an open never
	 * shows a call's result where its command belongs. The hold ends with the
	 * first request's answer, or after `LABEL_HOLD_MAX_MS` when none comes.
	 * Optional: surfaces with no live stream (stories, the run panel's child
	 * reader) have nothing pending.
	 */
	labelPending?: ReadonlySet<string>;
	/**
	 * §F3's PER-MESSAGE FAILURE STATE, addressed to the one row it describes.
	 *
	 * WHY IT TRAVELS AS A RECORD ID (§F3, UX round 1's U4). The failure used to be
	 * stated by a paragraph above the composer - one register for a whole screen's
	 * worth of failures - and §F3 moves it onto the message: the class's own
	 * sentence with the remedies that resolve it. The address is the transcript's
	 * own id (`record.id`, the id the durable row will carry if it ever lands), so
	 * the line cannot attach to a neighbouring turn, and the row that wears it is
	 * the only one that re-renders when it changes.
	 *
	 * EVERY POST-PAINT FAILURE wears it now (S4): the store keeps the row and
	 * classifies the failure on it, so this surface - which the unknown class
	 * already had - became the one place every class states itself. See
	 * `UndeliveredTurn` for the copy and control rules.
	 */
	undelivered?: UndeliveredTurn | null;
	/**
	 * Whether a held row's column should show the LATE-HOLD mark
	 * (`CanonicalSessionView.labelHoldLate`): the hold has outlived
	 * `LABEL_HOLD_MARK_MS`, so the cell states that a value belongs there instead of
	 * staying silent about it. Static and textless; see the cell in `tool-row.tsx`.
	 */
	labelHoldLate?: boolean;
	/**
	 * Tool call ids whose HOLD a refusal ended and whose MARK stands in its place
	 * (`CanonicalSessionView.labelMarked`). Such a row paints the mark rather than the
	 * output stand-in while a later read may still name it - the two routes that reach
	 * a refused stand-down look identical at the moment of the decision, and only one of
	 * them may never show the call's output. The command or the backstop's stand-in
	 * replaces it.
	 */
	labelMarked?: ReadonlySet<string>;
	/**
	 * Re-arm the session's stream and history read.
	 *
	 * Required rather than optional: every caller of this component has a
	 * session handle to hand it, and a failure notice with no action is what
	 * this surface is being fixed to stop showing.
	 */
	onReconnect: () => void;
};

// ---------------------------------------------------------------- rows

/**
 * The two controls §F3's line offers, bound to the message they resolve, and
 * the class's own copy for it.
 *
 * `Send again` re-issues the SAME payload through the composer's own send door
 * (so the store's unchanged-payload guard is satisfied by construction, not by a
 * second code path), and `Edit` returns the payload to the box - idempotent
 * with the act the failure's row already performs - reached from the message the
 * restore is about.
 *
 * GENERALISED FROM THE UNKNOWN CLASS TO EVERY POST-PAINT ONE (S4). For a
 * failure the STORE classified, the sentence is the class's own
 * (`sendFailureCopy`'s message, carried on the draft row as `error`) and
 * `retry` is the same call's verdict on whether a press can work - so this
 * line no longer states the fixed `Not delivered` over a refusal whose remedy
 * is an edit, and it no longer offers `Send again` where the daemon would only
 * refuse again. The reconnect-held claim is the one source with neither fact
 * (nothing classified it), and it keeps the fixed sentence and both controls.
 */
export type UndeliveredTurn = {
	recordId: string;
	/** The class's sentence, or absent for a claim nothing classified. */
	message?: string;
	/** Whether a press can work. Absent means the held claim's rule: it can. */
	retry?: boolean;
	/**
	 * Whether the payload is BACK IN THE COMPOSER unchanged, so this press would
	 * send the message the box already holds (UX round 1, U4).
	 *
	 * The row stays - for an unknowable outcome it IS the message's fate
	 * statement - but two live affordances for one payload read as two messages.
	 * Dimmed with `aria-disabled` and a refused click rather than `disabled`,
	 * for `older-history-slot.tsx`'s own reason: a `disabled` button cannot hold
	 * focus, and the keyboard reader who just put the payload back in the box is
	 * the reader most likely to be on this control. Absent means "not disabled",
	 * so every pre-U4 caller keeps the button as it was.
	 */
	retryDisabled?: boolean;
	onSendAgain: () => void;
	onEdit: () => void;
};

const UserRow = memo(function UserRow({
	record,
	isSmallView,
	scope,
	conversationId,
	undelivered = null,
}: {
	record: Extract<TranscriptRecord, { kind: "user" }>;
	isSmallView: boolean;
	scope: AttachmentScope | null;
	conversationId?: string;
	/** §F3's per-message failure state, when this row is the one it names. */
	undelivered?: UndeliveredTurn | null;
}) {
	/*
	 * The element a highlight has to BEGIN inside to count as a quote of THIS
	 * turn. The wrapper rather than the bubble's inner box: the bubble is the
	 * whole of a user turn, so a highlight anywhere in it is a highlight of this
	 * turn's words - and it is where the highlight begins that decides which turn
	 * owns it, so that decision is made against the widest box that is still this
	 * turn.
	 *
	 * No `group` class: it existed only for the toolkit's hover reveal, and the
	 * affordance is raised by a highlight now (`quote-toolkit.tsx`).
	 */
	const turnRef = useRef<HTMLDivElement>(null);
	/*
	 * Which link on this turn the toolbar is about, if any. ONE subject per row,
	 * decided by one hook (`use-link-subject.ts`), because the alternative is one
	 * hover state per link and therefore two toolbars on screen at once or a
	 * toolbar left behind by a link that scrolled away.
	 */
	const link = useLinkSubject(turnRef);
	/*
	 * The turn's own text, split from the reply markup a quoted send carries.
	 *
	 * This is the canonical path's half of what `message-paper.tsx` does on the
	 * legacy one, and it is not cosmetic: `buildSendPayload` prefixes
	 * `<reply-to>…</reply-to>` onto the payload at the send boundary, so without
	 * this split a turn that was itself a reply paints its own tags as literal
	 * text through `MarkdownRenderer`. Memoized because `parseReplies` mints a
	 * fresh uuid per reply, so an unmemoized call would hand `ReplyPreview` a new
	 * key on every render of every row.
	 *
	 * `parseReplies` reads that prefix across newlines, which is what makes this
	 * hold for the multi-paragraph turn that is the common case rather than for
	 * one-line ones only.
	 */
	const { replies, remainingContent } = useMemo(
		() => parseReplies(record.text),
		[record.text],
	);
	/*
	 * Whether this turn is long enough to need D2's eight-line clamp, MEASURED
	 * rather than guessed from a character count: the box is clamped first and
	 * then asked whether it is hiding anything, so a `Show more` can never appear
	 * on a turn that is already fully visible. Skipped while expanded, where the
	 * clamp is off and the box would always report itself as fitting.
	 */
	const [expanded, setExpanded] = useState(false);
	const [clamped, setClamped] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);
	/*
	 * The suppression below is one line rather than a block because biome attaches
	 * an ignore to the NEXT line: a multi-line one leaves the rule unreported and
	 * active, which is how this arrived as a red lint run with the reason already
	 * written above it.
	 *
	 * `remainingContent` is a re-measure TRIGGER, not a value this body reads. A
	 * turn whose text changes under the same row id - a streamed answer, a re-render
	 * with new prose - has to be asked again whether it now overflows, and dropping
	 * the dependency would strand the affordance on the first measurement of the
	 * row's life.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `remainingContent` re-measures the clamp; see above
	useLayoutEffect(() => {
		if (expanded) return;
		const el = bodyRef.current;
		if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
	}, [expanded, remainingContent]);
	return (
		<MessageContainer isUser isSmallView={isSmallView}>
			{/*
			 * The turn is a COLUMN - the bubble's row, then its stamp - and the stamp
			 * is a sibling of the bubble rather than a line inside it.
			 *
			 * `items-end` on the column is what puts the stamp against the BUBBLE's
			 * right edge: the bubble's row is justified to the same edge, so both
			 * resolve to it, while an agent-side row's shared content box (§ 7's one
			 * left rail and one right edge) is not where a reader looks for the time
			 * of their own message. The measure of the bubble, not of the column, is
			 * the thing a user turn reads as - so the stamp measures with it.
			 *
			 * The stamp is OUTSIDE `turnRef` on purpose, and the quote toolkit is
			 * where that matters most: `turnRef` is the element a selection must lie
			 * inside to count as a quote of this turn (the toolkit reads it as its
			 * `bodyText` anchor), so a drag that swept over a time would otherwise
			 * quote it as part of the words. `turnRef` is on the ROW div rather than
			 * on the bubble because the toolkit's own trigger has to sit inside it
			 * too; this column keeps the stamp out of it either way.
			 */}
			<div className={cn("group flex w-full flex-col items-end gap-1")}>
				<div ref={turnRef} className="group relative flex w-full justify-end">
					<div
						className={cn(
							// THE FILL IS THE BOUNDARY, NOT AN OUTLINE (D10).
							//
							// This carried `border-control`, chosen because a border was the
							// only edge the design contract would let this block take - it is
							// the role with the 3:1 floor, and removing the edge looked like
							// losing the one thing that said which speaker was which. Frames
							// say otherwise. The bubble sits on a `canvas` column and takes
							// its own `messageSurface` ground - the role exists because the
							// fill is this block's ONLY boundary (D10), and the shared
							// `surface` step it first took measures as low as ΔE00 2.05
							// (sage) across the palettes, where a fill that close to the
							// canvas reads as no boundary at all - and the block is ALSO an
							// aside by its own width (§D2), narrower than the prose beside
							// it: a fill plus a narrower width is a boundary twice over. The
							// rule on top of them was the third and loudest mark on the
							// quietest object in the transcript, and where `control` is dark
							// it read as an outline drawing rather than as a message.
							// Branding §5's own rule is to remove a border before tightening
							// spacing.
							//
							// The fill's step off the canvas is floored at ΔE00 4.0 by
							// `check-themes` now (the block was "+2.53 to +5.0 L*, median
							// 3.54" when D10 made the fill its boundary, and the low end is
							// the operator's "quite poor on some themes" report); see
							// `messageSurface` in the palette contract for the floor and the
							// arithmetic.
							//
							// `max-w-[85%]` of the 900 column is 765px (§D2), so the block
							// reads as an aside by width and never needs a cap on its TEXT
							// (branding §7 - the block's own width is what caps it). Padding
							// is 12px inline and 10px block; `rounded-frame` is the ramp's
							// 10px step, unchanged.
							"relative rounded-frame bg-message-surface text-ink break-words",
							/*
							 * The ONE border a bubble takes, and only while it is the message §F3's
							 * line is about: `a danger 1px leading edge` on the block. D10 removed the
							 * resting border because the fill is the boundary; this is not a resting
							 * state, it is the failure state, and the edge is the second signal that
							 * belongs to the message rather than to a paragraph about it.
							 */
							undelivered !== null && "border-l border-danger",
							isSmallView
								? "max-w-[92%] px-3 py-2.5"
								: "max-w-[85%] px-3 py-2.5",
						)}
					>
						{/*
						 * The bubble's body takes no measure class any more: its prose used to be
						 * centre-constrained at 62ch inside a card that a reply quote or a wide
						 * attachment had widened (the operator report of 2026-09-16), and the card's
						 * own width is the measure now, so there is nothing to opt into.
						 * `markdown.css`'s measure comment carries the report and the numbers, and
						 * the rule that also keeps a cap off the agent's answer.
						 */}
						<div
							ref={bodyRef}
							className={cn(
								"relative",
								/*
								 * Eight lines of `text-body` at 1.55 is 8 x 21.7 = 174px (D2).
								 *
								 * The clamp is on the BLOCK, because a pasted stack trace is
								 * still one user turn and would otherwise own the pane - and
								 * the affordance below is rendered only when the clamp is
								 * actually hiding something, so a turn that fits never grows a
								 * control that reveals nothing.
								 */
								!expanded && clamped ? "max-h-[174px] overflow-hidden" : "",
							)}
						>
							{/* The quote a quoted turn was sent with, rendered as the same
							    recessed block the composer stages it in - the reader sees one
							    idiom for "this is quoted" whether it is pending or sent. */}
							{replies.length > 0 && <ReplyPreview replies={replies} />}
							{/*
							 * `credentialCitations`, and only on the user's own turn: this is the only
							 * place in the transcript where a citation is the app's own words rather than
							 * the agent's prose about one. A message sent with a pasted secret reads in the
							 * reader's own voice, so the chip the composer showed must survive the send
							 * (operator report, 2026-09-17: the citation arrived as a wall of technical
							 * text). What the MODEL receives is unchanged — the sentence is still the
							 * message's own text; only how it is drawn changes.
							 */}
							<MarkdownRenderer
								content={remainingContent}
								credentialCitations
							/>
							{clamped && (
								/*
								 * A 30px full-width row INSIDE the block, with no divider
								 * (D2, the Raycast idiom): the clamp and its release are one
								 * object, so the release sits on the block's own ground
								 * rather than behind a rule between them.
								 */
								<button
									type="button"
									onClick={() => setExpanded((value) => !value)}
									aria-expanded={expanded}
									className={cn(
										"mt-1 h-[30px] w-full text-center text-ink-muted text-meta",
										"hover:text-ink",
									)}
								>
									{expanded ? "Show less" : "Show more"}
								</button>
							)}
							{record.images.length > 0 && (
								<div className={cn("mt-2 flex flex-col gap-2")}>
									{record.images.map((image, index) => (
										<CanonicalImage
											key={image.id}
											image={image}
											scope={scope}
											label={
												record.images.length === 1
													? "Attached image"
													: `Attached image ${index + 1}`
											}
										/>
									))}
								</div>
							)}
						</div>
					</div>
					{/*
					 * `!link.quoteAvailable` is the one-control rule: when the reader's
					 * highlight lies wholly inside a link, the LINK toolbar is the control
					 * that offers Quote - the operator's ask - and mounting this one too
					 * would paint two strips, both floating over the same highlight, each
					 * offering the same press.
					 */}
					{conversationId &&
						isQuotable(record, remainingContent) &&
						!link.quoteAvailable && (
							<QuoteToolkit conversationId={conversationId} turnRef={turnRef} />
						)}
					{conversationId && link.subject && (
						<LinkToolkit
							conversationId={conversationId}
							turnRef={turnRef}
							subject={link.subject}
							quoteAvailable={link.quoteAvailable}
							onDismiss={link.dismiss}
						/>
					)}
				</div>
				{/*
				 * THE USER TURN'S ACTION ROW (the operator's ask on the speak-aloud
				 * round), mounted from the column and NOT from inside `turnRef`: that
				 * element is a single flex ROW holding the bubble, and a second flow
				 * child would sit beside the bubble rather than under it. The row is
				 * the same component the answer's foot carries, in its `user` role
				 * (Copy alone - see `message-actions.ts` for why a user turn offers no
				 * Speak), so the copy press, the reveal and the toolbar semantics are
				 * one implementation rather than a second one beside it.
				 *
				 * Its `group` is the column above, so hovering anywhere on the turn
				 * reveals it; the row keeps its place at rest (opacity only), which is
				 * why nothing moves when it appears. `isQuotable` is the same "this
				 * turn has words to offer" gate the quote control reads - a turn with
				 * no words has nothing to copy.
				 */}
				{isQuotable(record, remainingContent) && (
					<AnswerActionRow
						kind="user"
						bodyText={remainingContent}
						revealId={record.id}
						revealAt={record.ts}
						/*
						 * FORK IS OFFERED FROM THE MESSAGE, not only from the sidebar row
						 * (#739): "fork the conversation from this message on". The entry id
						 * is `forkEntryId`'s answer for THIS record - the journal entry a
						 * cut can land at, which is what makes the picker a cut rather than
						 * a whole-conversation copy. `conversationId` is the picker's
						 * subject and is deliberately explicit: this transcript can be
						 * rendered for a conversation that is not the pane's own, and a
						 * request must never be answered with a substituted conversation.
						 *
						 * A transcript mounted with no conversation (the run-details child
						 * reader) passes neither, so the row offers no Fork there.
						 */
						conversationId={conversationId}
						entryId={forkEntryId(record) ?? undefined}
					/>
				)}
				{/*
				 * §F3's LINE, ONE ROW UNDER THE BLOCK IT IS ABOUT.
				 *
				 * The sentence is fixed rather than backend-authored: what the app KNOWS
				 * is that the owner's transcript does not hold this message (or that the
				 * claim is still open), and both cases are the same instruction to the
				 * reader - send it again, or take it back to edit. Nothing on the wire
				 * separates "refused" from "the response was lost" from "the daemon was
				 * gone", so the line states the one fact every one of them shares.
				 *
				 * NO LIVE REGION: the strip owns the connection's one live region and the
				 * composer states the Send gate; a third announcement of one press is the
				 * duplication this round removes, and the two controls are ordinary
				 * buttons the reader reaches by reading the line.
				 *
				 * `data-undelivered` is the rig's address for the line
				 * (`scripts/renderer-driver.mjs`'s `connection-drop` scene reads it), the
				 * same structural-marker rule the row's own archive press follows.
				 */}
				{undelivered !== null && (
					<div
						data-undelivered
						className={cn(
							"flex w-full items-center justify-end gap-3 text-danger text-meta",
						)}
					>
						<span className={cn("flex items-center gap-1")}>
							<CircleAlert
								aria-hidden="true"
								className={cn("size-3.5 shrink-0")}
							/>
							{undelivered.message ?? "Not delivered"}
						</span>
						{undelivered.retry !== false && (
							<button
								type="button"
								/*
								 * DIMMED, NOT GONE, while the composer holds this payload (UX round
								 * 1, U4): the row keeps its statement and both controls, and the
								 * box's own Send is the live affordance for this message until the
								 * text changes. `aria-disabled` rather than `disabled` - see the
								 * `UndeliveredTurn.retryDisabled` note.
								 */
								aria-disabled={undelivered.retryDisabled || undefined}
								className={cn(
									undelivered.retryDisabled
										? "text-ink-muted"
										: "cursor-pointer underline",
								)}
								onClick={(event) => {
									if (undelivered.retryDisabled) {
										event.preventDefault();
										return;
									}
									undelivered.onSendAgain();
								}}
							>
								Send again
							</button>
						)}
						<button
							type="button"
							className={cn("cursor-pointer underline")}
							onClick={undelivered.onEdit}
						>
							Edit
						</button>
					</div>
				)}
				{/*
				 * NO STAMP UNDER THE USER'S BLOCK (§D1; design round 1, D7). The turn's
				 * one stamp is on its foot line (§E3), at the end of the agent's answer,
				 * where it dates the exchange rather than one side of it: six stamp lines
				 * in one 1380 viewport - one under every user block and one under every
				 * answer - were a third of the rhythm problem the round measured. The
				 * moment the message was sent is still in the record (`record.ts`), and
				 * the foot's stamp is read from the reducer's frame time the same way.
				 */}
			</div>
		</MessageContainer>
	);
});

const AssistantRow = memo(function AssistantRow({
	record,
	isSmallView,
	closesTurn,
	answerRail,
	foot = null,
	closingLineSuppressed = false,
	conversationId,
}: {
	record: Extract<TranscriptRecord, { kind: "assistant" }>;
	isSmallView: boolean;
	closesTurn: boolean;
	/**
	 * Whether the opt-in rail is on, resolved ONCE for the transcript and handed
	 * down (see `CanonicalTranscript`'s `answerRail`): it is one query answering
	 * one question about one row, so a subscription per assistant row would
	 * N cache reads for it, and a prop keeps every memoised row's identity stable
	 * until the reader actually flips the switch.
	 */
	answerRail: boolean;
	/** §E3's foot line data, on the row that closes the turn. */
	foot?: TurnFoot | null;
	/**
	 * The run above carries a turn bar, so its closing line (the numbers AND the
	 * stamp) lives there instead: one summary and one stamp per turn (§4.3/§4.5,
	 * and the F5 defect the bar suppresses the foot for). Expanded or not — the
	 * bar stays the toggle and the line stays withheld.
	 */
	closingLineSuppressed?: boolean;
	conversationId?: string;
}) {
	const turnRef = useRef<HTMLDivElement>(null);
	/*
	 * Which link on this turn the toolbar is about, if any. One subject per row,
	 * decided by one hook (`use-link-subject.ts`), for the reason that file gives:
	 * per-link hover state is how two toolbars end up on screen at once.
	 */
	const link = useLinkSubject(turnRef);
	/*
	 * The assistant side of the split `UserRow` documents. Kept on both kinds
	 * rather than only on `user` because the markup is a property of the
	 * PAYLOAD and not of the speaker: the composer's `buildSendPayload` prefixes
	 * it onto whatever the turn carries (the `ask` gate's answer is one such
	 * send), so a model that echoed a quoted prompt would otherwise paint raw
	 * tags at agent-output weight, which § 7 is the most explicit about.
	 *
	 * `parseReplies` reads that markup as a leading run only, which is what makes
	 * this safe for the other half of the same case: an answer that merely
	 * DISCUSSES the wire format - this codebase's own sessions do - keeps its
	 * words instead of having them moved into a "Replying to" block.
	 */
	const { replies, remainingContent } = useMemo(
		() => parseReplies(record.text),
		[record.text],
	);
	// A tool-only assistant message has nothing to say; its tool rows carry the
	// turn. `buildRows` already drops it before a wrapper is minted — see
	// `paintsSomething` for why the record still exists at all — and this guard
	// stays as the component's own contract for any other caller.
	if (!paintsSomething(record)) return null;
	const refused = record.stopReason === "refusal" || record.error;
	/*
	 * Whether this answer has words to offer, asked ONCE for the row: the Quote
	 * toolkit above the foot and the foot's own action row are the two consumers
	 * of this derivation, so the same answer cannot be judged quotable in one
	 * place and not in the other - both read `quotable` (agent review round 1,
	 * R1-5: the toolkit used to re-ask `isQuotable` itself, which is the same
	 * call but a second place for the two to drift apart).
	 */
	const quotable = isQuotable(record, remainingContent);
	return (
		<MessageContainer isUser={false} isSmallView={isSmallView}>
			{/*
			 * No measure class here. The answer takes the full row content box, which
			 * is the box `ToolRow` resolves against, so prose and ledger in one turn
			 * share both edges structurally rather than by agreement.
			 */}
			<div
				ref={turnRef}
				className={cn(
					"relative break-words text-ink",
					/*
					 * THE ANSWER'S OWN MARK (issue #665), now an OPT-IN: the backend key
					 * `display.turn_answer_rail`, default off (operator report, 2026-09-30:
					 * the 2px always-on rule "looks ugly" and "cramped"). `closesTurn` is
					 * the segments module's election, so a post-dispose status reply never
					 * wears it. The classes, and why the prose box never moves between on
					 * and off, are `turnAnswerMarkClass`'s. `data-turn-answer` below is
					 * the hook rigs and tests read instead of a class name, and it is set
					 * from the election alone so it does not depend on the setting.
					 */
					turnAnswerMarkClass(closesTurn, answerRail),
				)}
				data-turn-answer={closesTurn || undefined}
				aria-busy={record.streaming || undefined}
				data-lo-streaming={record.streaming || undefined}
				data-lo-truncated={record.truncated || undefined}
			>
				{replies.length > 0 && <ReplyPreview replies={replies} />}
				{/*
				 * AN HONEST ROW FOR A MESSAGE THIS VIEWER ONLY PARTLY RECEIVED.
				 *
				 * `truncated` is set by the reducer when the row's text is real but not
				 * whole — a turn joined mid-stream, or a row that survived a receipt gap
				 * that may have swallowed deltas. It used to be silent: the row painted
				 * the chunk it held as if it were the answer, which is what "the message
				 * starts mid-sentence" looks like on screen. The mark says what is
				 * missing instead of inventing text, and it clears itself the moment
				 * `message_end` (or a durable row) states the whole answer.
				 *
				 * ONE SENTENCE PER STATE, because one sentence is not true of both (design
				 * round 1, D2; corroborated live by QA round 1's Q2). The join case really
				 * is missing a prefix and has nothing on screen under the caption; a row
				 * that lost continuity across a gap holds its OWN earlier text on screen,
				 * so a caption there naming a missing prefix would deny the text directly
				 * beneath it — and would be false whenever the withheld frame was one this
				 * viewer had already applied. That state claims only what the app knows:
				 * the receipt broke while this row was being written, so part of the
				 * answer MAY be missing.
				 *
				 * A caption in the meta register rather than a glyph, and placed ABOVE the
				 * prose because that is the side the missing text is on — the same quiet
				 * treatment `Stopped before finishing` gets below. Its distance to the
				 * chunk is 4px while the row itself takes the `mark` gap tier above it
				 * (`transcript-rows.ts`), which is what attaches the line to THIS row
				 * rather than to the answer above it (design round 1, D1).
				 */}
				{record.truncated && (
					<p className={cn("mb-1 text-ink-dim text-meta")}>
						{record.truncated === "prefix"
							? "Earlier text of this answer is not on screen"
							: "Part of this answer may be missing"}
					</p>
				)}
				{/*
				 * A STREAMING ROW RENDERS INCREMENTALLY; A SETTLED ROW RENDERS WHOLE.
				 *
				 * WHY THE SPLIT, MEASURED. The whole-message renderer re-parses the
				 * entire document on every flush — react-markdown 10.1.0 builds a fresh
				 * processor per render and `MarkdownRenderer`'s own comment records that
				 * there is no memo to miss — so a streaming row pays O(message) per
				 * frame. Measured in this repo's jsdom harness (one flush per 4-char
				 * delta, `scripts/streaming-markdown-parity.test.mjs`'s sibling): summed
				 * commit time over a 3KB/753-flush stream 3.2-4.2s, mean 4.3-5.6ms per
				 * flush; a 6KB/1506-flush stream 10.7-12.2s, mean 7.1-8.1ms per flush,
				 * worst 45-184ms — against a 16.7ms frame budget. The incremental
				 * renderer holds closed blocks memoised and paints the open tail as
				 * text: the same streams cost 0.26-0.47s total, mean 0.2-0.6ms per
				 * flush, and cost does NOT grow with the message.
				 *
				 * THE HANDOVER IS THE CORRECTNESS RULE, not a detail: the moment the row
				 * settles, the WHOLE message goes through `MarkdownRenderer` — the same
				 * renderer every settled row has always used — so the final paint is the
				 * authoritative full parse and the streaming path's per-block rendering
				 * can never be what a reader is left with. What the incremental path
				 * shows mid-flight is the parsed closed blocks plus the open block as
				 * text (its documented trade: `**bold**` reads literally until its
				 * paragraph closes); what settles is exactly what the full parse makes
				 * of the same string.
				 */}
				{record.streaming ? (
					<StreamingMarkdown
						content={remainingContent}
						className={cn(refused && "[--md-ink:var(--lo-danger)]")}
						styleProps={{
							fontSize: isSmallView
								? "var(--text-body-sm)"
								: "var(--text-body)",
							lineHeight: 1.6,
						}}
					/>
				) : (
					<MarkdownRenderer
						content={remainingContent}
						className={cn(refused && "[--md-ink:var(--lo-danger)]")}
						styleProps={{
							fontSize: isSmallView
								? "var(--text-body-sm)"
								: "var(--text-body)",
							lineHeight: 1.6,
						}}
						/*
						 * Linkification is the settled row's, and the streaming half is
						 * deliberately not handed this prop: `StreamingMarkdown` linkifies a
						 * block the moment it CLOSES (`StableBlock`'s own note: a closed
						 * block's source can never change again, so a path inside it is a
						 * finished path), while the open tail is painted as text and is never
						 * scanned — so `/Users/x/opoint-renewal-2026-09-1` cannot become a
						 * link to a path that does not exist. That is the same hazard the
						 * old `linkify={!record.streaming}` line refused, now enforced per
						 * block instead of per row.
						 */
						linkify
					/>
				)}
				{record.stopReason === "aborted" && (
					<p className="mt-1 text-ink-dim text-meta">
						Stopped before finishing
					</p>
				)}
				{/*
				 * `!link.quoteAvailable`: the same one-control rule the user row
				 * documents - when a link owns the highlight, the link toolbar carries
				 * Quote and this control stays off screen.
				 */}
				{conversationId && quotable && !link.quoteAvailable && (
					<QuoteToolkit conversationId={conversationId} turnRef={turnRef} />
				)}
				{conversationId && link.subject && (
					<LinkToolkit
						conversationId={conversationId}
						turnRef={turnRef}
						subject={link.subject}
						quoteAvailable={link.quoteAvailable}
						onDismiss={link.dismiss}
					/>
				)}
			</div>
			{/*
			 * One caption per TURN, on the answer it was working towards - not one per
			 * settled answer. `closesTurn` is computed over the whole record list by
			 * `closingAnswerIds` and passed in, because "is this a settled answer" is a fact
			 * about a record while "is this the turn's answer" is a fact about the turn:
			 * the operator's "just the final responses, not the in-progress tool
			 * intent/response" contrasts with the prose an agent writes BETWEEN calls, and
			 * gating on `!record.streaming` alone painted one clock per paragraph (round
			 * 1's D1/Q-2). `stopReason` is not the test either
			 * way: a durable entry can carry a null stop reason.
			 */}
			{/*
			 * OUTSIDE the content box above, so a selection drag over the answer cannot
			 * sweep a clock into a quote (`turnRef` is what the toolkit reads, and the
			 * stamp must not be inside it). `mt-1` is the same 4px the user-side
			 * caption takes from its column's `gap-1`; it is a margin here because this
			 * row's parent is the message container rather than a flex column, and
			 * wrapping the answer in one to borrow the gap would change how the
			 * markdown's own block margins collapse.
			 */}
			{/*
			 * ALIGNED STRUCTURALLY, NOT BY A GUTTER. This line is a sibling of the answer's
			 * content box inside `MessageContainer`, which is `relative w-full` for an agent
			 * row (D11: the 40px gutter and the agent glyph it existed for are both
			 * deleted), so the two share the container's own left edge with nothing between
			 * them. The comment this replaces named a `pl-10` gutter that no class in
			 * `features/chat` supplies any more, and a frame cannot settle an edge claim -
			 * so the rail is MEASURED from the rendered DOM
			 * (`scripts/chat-alignment-geometry.mjs`), and the numbers are in
			 * `docs/evidence/chat-canonical-message-actions/README.md`.
			 */}
			{closesTurn && (
				/*
				 * THE TURN-FOOT LINE (§E3), and the one line D9 leaves behind.
				 *
				 * `Worked for 1m 12s · 8 actions · 1 failed`, at the turn's own left edge,
				 * with the stamp at the far end. It REPLACES the per-message and
				 * per-tool-group stamps the transcript used to carry: D9 found those were
				 * about a third of a long thread's vertical run, and they said nothing the
				 * foot does not say once.
				 *
				 * THE FAILURE COUNT IS A CONTROL (U14, Cursor 3's `3 Files Edited -
				 * Review`): it opens the first failed row and scrolls to it, which is the
				 * only route from "something failed" to the thing that failed without
				 * reading the run. It resolves its row INSIDE the transcript it is drawn in
				 * (`closest`, not a document-wide query) so a canvas pane rendering the
				 * same record cannot be the one that opens, and it opens that row's
				 * disclosure BEFORE scrolling - the detail is what the reader came for, and
				 * landing on a closed row would make the jump a second click.
				 *
				 * THE ANSWER'S ACTION ROW RIDES THIS LINE (issue #695, design memo (c)). It is
				 * not a second band: a band of its own would cost a whole row per turn and
				 * would leave the turn's LAST line being controls rather than the turn's own
				 * fact.
				 *
				 * THE CAPTION KEEPS THE RAIL AND THE ACTIONS TAKE THE FAR END (operator
				 * direction, 2026-10-01: "now that the action buttons only show up on hover,
				 * the Worked for and action count looks a bit weird - rearrange so those are
				 * on the leftmost extent and the action buttons are to the right"). This
				 * SUPERSEDES the round-1 arrangement, where the actions took the line's left
				 * edge so the reader's eye returned to one rail: the row's reveal
				 * (`ACTION_ROW_REVEAL_CLASSES`) is opacity-only, so the buttons hold their
				 * box at rest but paint nothing - and a caption that FOLLOWED them read as
				 * indented by ~60px of nothing under the prose it belongs to. Now the
				 * caption starts at the content's own left edge - the same rail as the prose
				 * (`scripts/chat-alignment-geometry.mjs` measures it), and the right cluster
				 * is `[actions][stamp]` with the stamp rightmost, riding the actions'
				 * `ml-auto` spacer. The reveal stays opacity-only, so nothing moves when
				 * the buttons appear: the idle and hovered frames of the operator's state,
				 * and the caption/actions/stamp boxes the geometry script reads per state,
				 * are under `docs/evidence/chat-canonical-message-actions/` and its
				 * `-foot-before` sibling. The exact right-cluster composition is the design
				 * round's to settle; this is the clean default it judges.
				 *
				 * THE TWO HALVES OF THIS LINE HAVE DIFFERENT CONDITIONS, which is why the
				 * gate moved from the line to the pieces. The ACTIONS are a fact about the
				 * answer (there is prose to copy), so they render whenever the turn closes;
				 * the NUMBERS and the STAMP are facts about the turn's closing line, and a run
				 * that carries a turn bar already states both (`closingLineSuppressed`, F5).
				 * The bar keeps its own stamp and never takes the actions.
				 */
				<div className={cn("mt-1 flex items-center gap-2 text-meta")}>
					{!closingLineSuppressed && foot && foot.actions > 0 && (
						<>
							<span className={cn("text-ink-dim")}>
								{foot.durationS !== null
									? `Worked for ${formatDuration(foot.durationS)}`
									: "Worked"}
							</span>
							<span aria-hidden={true} className={cn("text-ink-dim")}>
								·
							</span>
							<span className={cn("text-ink-dim")}>
								{foot.actions === 1 ? "1 action" : `${foot.actions} actions`}
							</span>
							{/* NO FAILURE TALLY (operator, 2026-09-29, issue #6): the
							 * foot's `· N failed` control is retired with the bar's —
							 * failures stay discoverable by expanding the rows, which
							 * keep their red markers; no surface tallies them. */}
						</>
					)}
					{/*
					 * The gate the Quote control above already uses, for its reason: an answer
					 * still receiving deltas is a prefix the next token falsifies, so there is
					 * nothing settled to copy, and a body with no words in it (a `<reply-to>`
					 * send's markup alone) has nothing to offer either.
					 */}
					{quotable && (
						/*
						 * `ml-auto` sits on the WRAPPER rather than the row (the row takes no
						 * className): it is the first box of the right cluster, so it - and
						 * the stamp that follows it - ride the line's far end while the
						 * caption keeps the rail. `shrink-0` because the controls are the
						 * line's fixed part: the caption is the side with slack (it can
						 * wrap), and the buttons must never be what a narrow column squeezes.
						 */
						<span className={cn("ml-auto flex shrink-0")}>
							<AnswerActionRow
								bodyText={remainingContent}
								agentId={conversationId}
								speechId={record.id}
								revealId={record.id}
								revealAt={record.ts}
								/*
								 * FORK IS OFFERED FROM THE MESSAGE, not only from the sidebar
								 * row (#739), on the same gate the actions themselves carry:
								 * `forkEntryId` is the journal entry a cut can land at, and
								 * `conversationId` is the picker's subject, explicit because
								 * this transcript can be rendered for a conversation that is
								 * not the pane's own - a request must never be answered with
								 * a substituted conversation. A transcript mounted with no
								 * conversation passes neither, so the row offers no Fork there.
								 */
								conversationId={conversationId}
								entryId={forkEntryId(record) ?? undefined}
							/>
						</span>
					)}
					{!closingLineSuppressed && (
						<span className={cn(!quotable && "ml-auto")}>
							<TurnTimestamp timestamp={record.ts} scope="answer" />
						</span>
					)}
				</div>
			)}
		</MessageContainer>
	);
});

/**
 * The row's own summary text — the object column before the row's bare-name drop.
 *
 * Shared with the trace fold's live clause (wired as `summaryOf` in the fold's
 * memo below): a collapsed group names the running call with the row's OWN words
 * rather than a second guess at them, and the composing/queued/never-sent
 * branches are exactly where a second guess would drift.
 *
 * `never sent` covers BOTH ways a call reaches no tool — the harness's verdict
 * (`notRunReason`) and a turn that died while the call was still being dictated
 * or waiting to run. The TUI states the two the same way (`mark_not_run`'s
 * summary; `mark_interrupted` keeps the compose facts for a card that was
 * composing or queued), which is why both read `never sent · N composed` rather
 * than only where a verdict happened to arrive.
 */
function toolRecordSummary(
	record: Extract<TranscriptRecord, { kind: "tool" }>,
): string {
	const composing = record.phase === "composing";
	const queued = record.phase === "queued";
	const neverSent = record.neverSent === true || Boolean(record.notRunReason);
	if (neverSent)
		// `never sent`, not `failed`: the call produced no result to fail, and the
		// size is the record of how far the model got before nothing would receive
		// it (`ToolCard.mark_not_run`). An empty payload is named rather than
		// rendered as `0 B`, which would claim a measurement.
		return `never sent · ${record.argumentBytes ? `${formatBytes(record.argumentBytes)} composed` : "nothing composed"}`;
	if (composing)
		return `composing${record.argumentBytes ? ` · ${formatBytes(record.argumentBytes)}` : ""}`;
	if (queued)
		// Dictation is over and the call has not started: the byte count stays
		// (it is how far the model got), and the status word stops claiming work
		// the model finished writing.
		return `queued${record.argumentBytes ? ` · ${formatBytes(record.argumentBytes)}` : ""}`;
	return summaryFromArgs(record.toolName, record.args);
}

/**
 * The delivery sentence a `send` expansion opens its result section with.
 *
 * WHY THE EXPANSION NEEDS A SECOND VOICE (UX round 1, U1/U4). The result body is
 * the core's own line, written for a model: it prints the pid, the message id, an
 * attempt count, and - for the fourth state - the agent API call that would check
 * the peer (`sessions(op="peek", …)`). A human who expanded the row to find out
 * what to do got one `whitespace-pre` line clipped by the box's right edge, with
 * the actionable half behind a horizontal scroll and no scrollbar drawn at rest
 * (measured: 811px of the mailbox sentence, 1423px of the `unconfirmed` one).
 *
 * So the instruction is said again, in the reader's own terms and in a box that
 * wraps (`SEND_DELIVERY_NOTE`), above the machine line rather than instead of it:
 * the raw text keeps the ids and the cause, and this keeps the reader from
 * re-sending a message that is already sitting in a peer's mailbox.
 *
 * `null` for `delivered` and for every row with no stated delivery, so a
 * successful send's expansion is exactly the one it always was.
 */
function DeliveryNote({ state }: { state: SendDeliveryState }) {
	const note = SEND_DELIVERY_NOTE[state];
	if (!note) return null;
	return <span data-delivery-note={state}>{note}</span>;
}

/**
 * One tool call as a ledger row.
 *
 * The row itself is `ToolRow`; this decides what goes in each of its columns
 * from a `TranscriptRecord`, and mounts the call's own screenshots underneath.
 *
 * The summary is derived the TUI's way (`summaryFromArgs`) rather than from
 * the first path-like argument, because "the first two identity scalars in
 * argument order" is what makes a `write` row say the filename instead of the
 * first sixty characters of the file. While the model is still DICTATING those
 * arguments there is nothing to summarise yet, so a composing row shows the
 * byte count — the only honest progress signal at that point, and the same one
 * the backend's `ToolCallComposeEvent` docstring names.
 *
 * `intent` is deliberately NOT rendered here. It is the model's account of WHY,
 * and it belongs to the working line at the foot of the transcript; a row that
 * shows both the arguments and the intent states two facts where the TUI states
 * one per surface, and the two immediately start restating each other.
 */
const ToolRow = memo(function ToolRow({
	record,
	isSmallView,
	scope,
	labelPending = false,
	labelHoldLate = false,
	labelMarked = false,
	stopping = false,
	onInterruptTurn,
}: {
	record: Extract<TranscriptRecord, { kind: "tool" }>;
	isSmallView: boolean;
	scope: AttachmentScope | null;
	/** The row's first label read is in flight: hold the stand-in back. */
	labelPending?: boolean;
	/** The held column has outlived `LABEL_HOLD_MARK_MS`. */
	labelHoldLate?: boolean;
	/** A refusal ended this row's hold: the mark stands in the hold's place. */
	labelMarked?: boolean;
	/** The pane's stop is in flight; see `TranscriptRow`'s copy of this prop. */
	stopping?: boolean;
	/** The pane's interrupt press, for the card's Cancel; absent = no control. */
	onInterruptTurn?: () => void;
}) {
	/*
	 * THE IMAGE-GEN CARD IS THE ROW for a call in the detection set. It owns
	 * the whole lifecycle - the progress while unsettled, the artifact and its
	 * quiet receipt when settled - so it REPLACES the ledger row and its media
	 * block rather than rendering beside them: two renderings of one call is
	 * the second component § 9 opens with, and a ledger line above a card would
	 * state the call twice. The predicate is the model module's one exported
	 * constant, adjustable in one place when the harness freezes the tool-name
	 * set.
	 */
	if (isImageGenTool(record.toolName)) {
		return (
			<MessageContainer isUser={false} isSmallView={isSmallView}>
				<ImageGenCard
					view={imageGenCardView(record, { stopping })}
					scope={scope}
					actions={onInterruptTurn ? { onCancel: onInterruptTurn } : undefined}
				/>
			</MessageContainer>
		);
	}
	const running = record.phase !== "done";
	const composing = record.phase === "composing";
	/*
	 * The two terminal compose endings, and why the row needs both.
	 *
	 * A call announced by a compose frame may finish its dictation and then wait
	 * a long while for its turn to start (`queued`), or be told it will never run
	 * at all (`notRunReason`). Neither call ever gets a `tool_execution_start`,
	 * so neither settles from anything else — and the frame that says so is the
	 * harness's own statement, not a guess this view makes. Without the queued
	 * arm the row went on claiming the model was still writing, with a ticking
	 * clock, for as long as the call waited; without the never-run arm it stayed
	 * `composing` for the life of the turn and was then painted as an interrupt.
	 *
	 * Both are the TUI's own states (`ToolCard.mark_queued` / `mark_not_run`) and
	 * the phone's (`queued` / `failed`), so the three surfaces agree on what the
	 * producer said rather than each inventing a reading of it. The copy for both
	 * lives in `toolRecordSummary` below.
	 */
	// Truthiness rather than `!== null`: a record built by hand (a test fixture, a
	// story) carries no `notRunReason` key at all, and `undefined !== null` would
	// paint every one of them as a never-run verdict.
	const notRun = Boolean(record.notRunReason);
	/*
	 * Which never-run rows are INTERRUPTS rather than failures (design round 1,
	 * D1): the interrupted kinds read as the same class the row's status column
	 * and the durable body already use, instead of the danger "Not run" a
	 * planning fault earns.
	 */
	const interruptedNotRun = notRun && isInterruptedFault(record.notRunKind);
	/*
	 * THE AMBER MIDDLE, read from the result's own state - `details.delivery.state`
	 * - and never from its text. A `send` that settled `mailbox` or `unconfirmed`
	 * is neither a success nor a failure: the core leaves `is_error` false for it,
	 * so without this arm the row would print the SILENT SUCCESS over a wake that
	 * was never answered, which is the incident this state model exists to stop
	 * restating. `delivered` and every other tool answer `null` here and keep the
	 * ladder exactly as it was; an unknown or absent state is already `null` by the
	 * time it reaches the record.
	 */
	const partial = deliveryRowOutcome(record.delivery) === "partial";
	const summary = toolRecordSummary(record);
	// When the arguments taught us nothing, the summary is the tool's own name,
	// which the row then drops as a stutter and the object column goes empty.
	// A row that says nothing about its call is the scannability this port
	// exists to create, lost — so the OUTPUT's first line stands in. It is a
	// weaker fact than the arguments (it says what came back rather than what
	// was asked) and it is deliberately second choice, but it beats a void.
	//
	// EXCEPT while the read that will find the arguments is still in flight
	// (`labelPending`): a joiner's seeded rows all start argument-less, and on
	// the first frame the stand-in is not a weaker fact but a wrong-looking one
	// — `bash  … {"text": 200, …` reads as the command that ran. An empty column
	// is the honest frame while that read is genuinely outstanding — it ends with
	// the first request's answer or after `LABEL_HOLD_MAX_MS`, whichever comes
	// first — and then the row either has its arguments or falls back to the
	// stand-in as before.
	const derived =
		!composing && isBareToolName(summary, record.toolName)
			? outputFallbackLine(record.output, labelPending)
			: null;
	/*
	 * The TUI's body-selection case 2 (`_build_content`, tool_card.py:1928-1939):
	 * when a settled, SUCCESSFUL `write`/`edit` reported a diff, the expansion is
	 * the DIFF ALONE. The arguments of a `write` are the whole new file content —
	 * the same change stated a second way — and the output line underneath is
	 * `edited` or `wrote N bytes`, which says nothing the diff does not. The
	 * mobile port drops the same two for the same tools
	 * (mobile/web/src/components/tool-row.tsx:95-96, 179-182).
	 *
	 * The three conditions live in `isDiffBodyRow` so they can be tested: the
	 * tool, the payload, and the call's own state. A row with no diff keeps its
	 * arguments, which is the honest shape for a call that changed nothing
	 * (`_diff_details` omits `diff` entirely when `_line_delta` is zero) and for a
	 * transcript predating `details` on the wire; a row that FAILED keeps them
	 * too, because there the arguments are the only account of what was attempted
	 * and the error only makes sense beside them.
	 */
	const body = notRun ? (
		/*
		 * The harness's own words, and the whole content of the fact: this call was
		 * announced and then never sent to a tool, and the reason is what stopped it
		 * (`Invalid arguments: arguments are not valid JSON: …`).
		 *
		 * The markup MIRRORS `ToolDetail`'s output section rather than approximating
		 * it, because a body in the trace is a section of machine payload and the two
		 * must read as one idiom: the same sunken box, the same `text-meta` label step
		 * above it (without which the label and the text run together as one
		 * paragraph — design round 1, D3), the same shared height cap, and the same
		 * `whitespace-pre` under an `overflow-auto` box: a verdict is a machine string
		 * with its own columns, and it scrolls sideways rather than reflowing, exactly
		 * as a tool's output does.
		 *
		 * LABELLED `Not run` rather than `Error`, which is the one difference from a
		 * result body and the point of it: the call produced no error RESULT, it
		 * produced no result at all.
		 *
		 * THE INTERRUPTED KINDS ARE NOT FAILURES HERE EITHER (design round 1, D1).
		 * `notRun` is only "parked with a verdict"; WHICH verdict is
		 * `record.notRunKind`, and for `skipped`/`aborted` the verdict is an
		 * interrupt — steering redirected, or the turn was stopped — so the label
		 * names the state (`Interrupted`, the word the row's own sr-only
		 * announcement and the TUI use) in the neutral label ink, with the
		 * harness's reason in body ink. The planning faults (`unknown_tool`,
		 * `invalid_arguments`, ...) ARE the call's own failure and keep the danger
		 * `Not run`, as does a legacy record that states no kind at all.
		 */
		<div
			className={cn(
				// The detail block's own treatment (§E5, D9): `sunken`, radius 10,
				// no border.
				"w-full rounded-md bg-sunken p-3 font-mono text-mono-sm",
			)}
			data-detail-section="not-run"
		>
			<span
				className={cn(
					"mb-1 block text-meta",
					interruptedNotRun ? "text-ink-dim" : "text-danger",
				)}
			>
				{interruptedNotRun ? "Interrupted" : "Not run"}
			</span>
			<div className={cn(DETAIL_SECTION_MAX, "overflow-auto")}>
				<pre
					className={cn(
						"whitespace-pre font-mono",
						interruptedNotRun ? "text-ink" : "text-danger",
					)}
				>
					{record.notRunReason}
				</pre>
			</div>
		</div>
	) : isDiffBodyRow(record) ? (
		<DiffBlock diff={record.diff} />
	) : hasDetail(record.args, record.output) ? (
		<ToolDetail
			args={record.args}
			output={record.output}
			/*
			 * THE SAME PREDICATE THE COUNTS USE (QA round 1, Q2). `record.isError`
			 * alone let a producer that set `is_error` on a partial paint an amber row
			 * over an `Error` block - the one place in the row the contradiction the
			 * rest of this change is armoured against would still show.
			 * `isFailedResult` is the expression the fold's failed count, the turn
			 * foot and the failed-row jump already read, so the heading and the counts
			 * cannot disagree about whether a call failed.
			 */
			isError={isFailedResult(record.isError, record.delivery)}
			/*
			 * The durable interrupted row reaches `ToolDetail` (its verdict lives in
			 * `output`, not `notRunReason`, so `notRun` is false for it) and must not
			 * be labelled `Output` — the record's own `stopped` is the same fact the
			 * live arm reads (design round 1, D1).
			 */
			interrupted={record.stopped === true}
			/*
			 * The reader's own sentence for a send that did not plainly succeed; the
			 * machine result stays below it (see `DeliveryNote`).
			 */
			note={
				record.delivery ? <DeliveryNote state={record.delivery} /> : undefined
			}
		/>
	) : undefined;
	/*
	 * The disclosure's body, and nothing else.
	 *
	 * A stamp used to sit at the foot of this section, placed as a sibling of the
	 * body so that it survived the pane's own scrolling. D9 deletes it: the stamp
	 * belongs to the TURN (one line, at the turn's foot), never to a tool group, and
	 * a run of twenty calls therefore stays twenty quiet lines with no clocks. The
	 * rows that expanded by default were the ones carrying the loudest, longest
	 * payloads, so the stamp was appearing on exactly the rows where the ledger's
	 * quiet mattered most.
	 */
	const details = body ? <>{body}</> : undefined;
	// Screenshots sit under the row and OUTSIDE the disclosure, which is where
	// the TUI mounts them. Hiding a picture behind a toggle is the complaint
	// being fixed, not a smaller version of it.
	const media =
		record.images.length > 0 ? (
			<div className={cn("mt-1 ml-5 flex flex-col gap-2")}>
				{record.images.map((image, index) => (
					<CanonicalImage
						key={image.id}
						image={image}
						scope={scope}
						label={record.images.length === 1 ? "Image" : `Image ${index + 1}`}
					/>
				))}
			</div>
		) : undefined;
	return (
		<MessageContainer isUser={false} isSmallView={isSmallView}>
			<ToolLedgerRow
				toolName={record.toolName}
				/*
				 * The operation token, so a meta tool's row says what the call DID
				 * (`Listed agents`, `Viewed agent designer`) rather than the one
				 * name-only verb its whole family used to share (`Delegated`, the
				 * operator's report of 2026-09-27). Empty while the arguments are
				 * still being written, which takes the generic verb rather than a
				 * guess.
				 */
				op={toolOp(record.args)}
				summary={summary}
				summaryFallback={derived}
				summaryHold={
					/*
					 * TWO WAYS THE MARK STANDS (round 4). The hold has outlived
					 * `LABEL_HOLD_MARK_MS` with no answer (design round 2, D6), OR a refusal
					 * ended the row's hold and left the question open - no read in flight, but a
					 * round ending may still name the call, so the output must not be stated in
					 * the meantime. Both render the same glyph, and both give way to the command.
					 */
					labelMarked === true ||
					(labelPending === true && labelHoldLate === true)
				}
				outcome={
					notRun
						? /* The never-run verdict's own class decides which row this is: a
						     steer-skip or a stop is an interrupt (the same two kinds the
						     end events carry), and every other verdict is the failure it
						     was. A record with no kind keeps the not-run state - the legacy
						     and hand-built shape. */
							isInterruptedFault(record.notRunKind)
							? "interrupted"
							: "not-run"
						: running
							? "running"
							: partial
								? "partial"
								: record.isError
									? "error"
									: record.stopped
										? "interrupted"
										: "success"
				}
				deliveryState={record.delivery}
				durationS={record.durationS}
				startedAt={record.startedAt}
				added={record.added}
				removed={record.removed}
				details={details}
				media={media}
			/>
		</MessageContainer>
	);
});

/**
 * The remedy a classified provider failure earns: one quiet control under the
 * row, on the row's own left rail.
 *
 * The same shape the no-provider notice's action already uses - a secondary
 * `sm` button - because a second notice idiom for one register would be the
 * defect the disclosure section of branding.md records. It is a router `Link`
 * rather than a press handler: the destination is a route a reader may want to
 * open in a new tab or copy, and the chat pane has no navigation of its own to
 * reuse.
 */
const ProviderAction: FC<{ action: ProviderErrorAction }> = ({ action }) => (
	<div className="mt-1 pl-6">
		<Button variant="secondary" size="sm" asChild>
			<Link to={action.to}>{action.label}</Link>
		</Button>
	</div>
);

const NoticeRow = memo(function NoticeRow({
	record,
	isSmallView,
}: {
	record: Extract<
		TranscriptRecord,
		{ kind: "notice" | "compaction" | "custom" }
	>;
	isSmallView: boolean;
}) {
	// A custom row and a notice are two registers, and the difference is what
	// the row is FOR.
	//
	// A custom row is a STATEMENT the harness made in the conversation -- a
	// session incident, a model switch, a relayed message -- and its text IS the
	// message. Painting its type name and hiding the text behind a chevron is
	// what made 946 of the operator's own incidents read as the literal string
	// "session incident": an error row in the info ink, its message visible only
	// to someone who thought to click. The TUI has never done that
	// (`tui/widgets/transcript.py::NoticeBlock` paints one wrapping line in the
	// kind's ink, message in place), and the reducer now decides the level, the
	// message and the supporting detail for every custom type -- so this row
	// paints what it is given rather than re-deciding how long is too long.
	if (record.kind === "custom") {
		const Icon = record.level === "error" ? CircleAlert : MessageSquareText;
		const providerAction = providerErrorGuidance({
			text: record.text,
			category: record.category,
			provider: record.provider,
		});
		return (
			<MessageContainer isUser={false} isSmallView={isSmallView}>
				<TraceLine
					// The ledger pitch, so a run does not go ragged wherever a
					// statement lands in it. The message wraps BELOW that pitch
					// rather than truncating at it: a clipped sentence costs the
					// reader the half that says what happened.
					dense
					// Keep an explicit statement label even when the payload repeats
					// "job": omitting it selects the tool fallback, which replaces the
					// glyph and clips narration even when there is no detail to open.
					verbOverride={record.category ?? record.customType.replace(/_/g, " ")}
					// The provider/model the incident names rides the ledger's
					// machine-voice object column: it is an identifier, not prose, and
					// "which provider died" is the decision-relevant half for an
					// operator running several of them.
					object={record.provider ?? undefined}
					narration={record.headline}
					failed={record.level === "error"}
					wrap
					glyph={<Icon />}
					details={
						/* No extra indent: the disclosure's content box already sits on
						   the ledger's body edge (x250 in the 1280 column, the same as a
						   tool row's args block), which was measured in the DOM rather
						   than read off a frame — see the design round's D4 in the PR
						   thread. Indenting the paragraph further put it at x270, off
						   the edge it already shared. */
						record.detail ? (
							// `break-words` for the same reason the notice's tail carries
							// it: `pre-wrap` alone leaves `overflow-wrap: normal`, and an
							// errno string or a socket path is one unbreakable run.
							<p className="whitespace-pre-wrap break-words text-body-sm text-ink-muted">
								{record.detail}
							</p>
						) : undefined
					}
				/>
				{providerAction ? <ProviderAction action={providerAction} /> : null}
			</MessageContainer>
		);
	}
	const level = record.kind === "notice" ? record.level : ("info" as const);
	const Icon =
		level === "error"
			? CircleAlert
			: level === "warning"
				? TriangleAlert
				: Info;
	// Notices are machine voice at the trace tier: one quiet line, the body
	// (when genuinely long) behind the same disclosure idiom as a tool's output.
	//
	// "Long" means a multi-paragraph body worth collapsing, NOT an ordinary
	// sentence. A notice that is not long renders through `verbOverride`, which
	// `TraceRow` clipped inside a `truncate` span with no disclosure to open --
	// so a 100-160 char notice lost its tail with no way to recover it short of
	// devtools. Every actionable cold-start reason lands there once the renderer
	// prefixes "The message was not sent: " (115-146 chars), and the half that
	// was cut is the INSTRUCTION: "…Connect one in Settings > Providers, then
	// send th…" (QA Q6).
	//
	// The fix is to let those wrap in place rather than to hide them behind a
	// chevron: a notice the user must ACT on should not require a click to
	// read, and collapsing it merely trades a clipped sentence for an invisible
	// one. The disclosure is kept for text that is actually bulky.
	//
	// And the disclosure carries the REST of the notice, never the notice again:
	// `details={record.text}` disclosed a verbatim duplicate of the row above it
	// whenever the opening line was the whole text (a long single-line notice) and
	// re-read the first line whenever it was not (round 2's D7/Q5/R11/U14). A
	// notice whose first line IS the whole text now has nothing to disclose and
	// paints through the static branch, which is the honest affordance: a chevron
	// that reveals the same bytes promises material it does not add.
	const { headline, rest } = splitFirstLine(record.text);
	const providerAction = providerErrorGuidance({ text: record.text });
	return (
		<MessageContainer isUser={false} isSmallView={isSmallView}>
			<TraceLine
				// Same column as the tool rows, so the same pitch: a notice must not
				// be the row that makes a run look ragged.
				dense={!rest}
				// The row states the notice's OWN opening line, not the word
				// "Notice": a bulky notice used to render as the literal type name
				// with the whole body behind the chevron, which is the defect the
				// operator reported one register down.
				verbOverride={headline}
				failed={level === "error"}
				// The row carries the whole opening line when it is not collapsed,
				// so it must not be clipped to the rail width.
				wrap
				glyph={<Icon />}
				details={
					rest ? (
						// `break-words` as well as `pre-wrap`: a notice's own tail can be
						// an unbreakable run (D7 measured `scrollWidth` 2773 in an 840px
						// box), and `pre-wrap` alone leaves `overflow-wrap: normal`.
						<p className="whitespace-pre-wrap break-words text-body-sm text-ink-muted">
							{rest}
						</p>
					) : undefined
				}
			/>
			{/*
			 * The backend's "No model provider is configured yet" notice names a
			 * Settings path to type out (design D7). The sentence is kept -- it is
			 * the backend's -- and gains the action it describes, which opens the
			 * connect dialog over this conversation instead of navigating away.
			 */}
			{NO_PROVIDER_NOTICE.test(record.text) ? (
				<div className="mt-1 pl-6">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => useConnectProviderStore.getState().openConnect()}
					>
						Connect a provider
					</Button>
				</div>
			) : null}
			{providerAction ? <ProviderAction action={providerAction} /> : null}
		</MessageContainer>
	);
});

// ------------------------------------------------------------- receipts

/**
 * An inbound cross-session message (`lop send` from another session).
 *
 * A ledger row rather than a card, because that is what the TUI draws
 * (`PeerMessageBlock`, `tui/widgets/transcript.py`) and the mobile fold agrees
 * (`mobile/projection.py`): `peer` in the shared name column, the inbound glyph,
 * the sender as the summary. What it replaced was its own card type whose body
 * was the model-facing envelope verbatim — `<peer-session-message from_pid=92064
 * …>` and all.
 *
 * The peer row takes the shared name column and the ink a row with no category
 * takes: `peer` is a glyph in the TUI's table rather than a classified tool, so
 * `toolCategory` files it `plain` and it settles to `ink-muted`. Giving a receipt
 * an accent of its own would make it louder than the calls around it. Its sibling
 * `WakeRow` is the same row in the same register, and for the reason that decides
 * it there: a RECEIPT is not a CALL. `wake` is a `meta` tool in both maps, but
 * those maps are consulted by TOOL CARDS — `_category_element` has one caller
 * (`tool_card.py:3240`, inside `ToolCard`) — while the TUI draws both receipts as
 * blocks that paint icon `dim` / name `muted` and ask the table nothing
 * (`transcript.py:2152-2153`, `:2836-2837`). So both rows settle to the neutral,
 * which is what `rowInk`'s `receipt` branch states once for the pair.
 *
 * The disclosure is offered only when the expansion carries a fact the collapsed
 * row cannot (`peerHasDetail`): a body, or the pid/model the identity line adds
 * to the one-line summary. The TUI's `can_expand()` is unconditional, but it also
 * states the rule this follows — an expansion that delivers nothing is worse than
 * no expansion — and its sibling here already rules the same case static (a wake
 * with no prompt). An all-absent sender used to expand to `another session`: the
 * collapsed summary verbatim, at the cost of a click (design D5, UX U2).
 */
const PeerRow = memo(function PeerRow({
	record,
	isSmallView,
}: {
	record: Extract<TranscriptRecord, { kind: "peer" }>;
	isSmallView: boolean;
}) {
	const detail = peerHasDetail(record.sender, record.body);
	if (!detail) {
		return (
			<MessageContainer isUser={false} isSmallView={isSmallView}>
				<ToolLedgerRow
					toolName="peer"
					summary={peerSummary(record.sender, record.body)}
					outcome="receipt"
					durationS={null}
				/>
			</MessageContainer>
		);
	}
	return (
		<MessageContainer isUser={false} isSmallView={isSmallView}>
			<ToolLedgerRow
				toolName="peer"
				summary={peerSummary(record.sender, record.body)}
				outcome="receipt"
				durationS={null}
				details={
					// `px-3` puts this body on the SAME text rail as the pane above it:
					// a tool expansion's border sits on the glyph rail and its text is
					// inset by the pane's own padding, so a receipt body left flush sat
					// 11px left of every other expanded body in the ledger (design D2:
					// 262 vs 251 at 1280, 112 vs 101 at 560). § 7: one left rail.
					<div className={cn("flex flex-col gap-2 px-3")}>
						{/*
						 * Identity FIRST, body under it — the TUI's order, and it is the
						 * header that justifies the expansion. `text-ink-muted` is the middle
						 * step of the TUI's ramp for it (summary `dim` -> identity `muted` ->
						 * body `fg`); at `dim` it was the same ink as the summary row above it
						 * and read as a dimmer continuation of the headline rather than as the
						 * header of the block below.
						 */}
						<p className={cn("text-body-sm text-ink-muted")}>
							{peerIdentityLine(record.sender)}
						</p>
						{/*
						 * The message as the peer wrote it: real newlines, prose ink, selectable
						 * (nothing in this subtree sets `select-none`). Not rendered at all for
						 * an empty body — the TUI drops trailing blanks and refuses to paint a
						 * separator with nothing under it, because an expansion that promises
						 * detail and delivers whitespace is worse than one that shows the
						 * addressing facts alone.
						 */}
						{record.body ? (
							<p
								className={cn(
									"whitespace-pre-wrap break-words text-body-sm text-ink",
								)}
							>
								{record.body}
							</p>
						) : null}
					</div>
				}
			/>
		</MessageContainer>
	);
});

/**
 * A queued ask's receipt: the response that landed, or the notice that the
 * deadline passed.
 *
 * ## Why a receipt and not a card
 *
 * Both rows report an EVENT rather than a call, which is the register `peer` and
 * `wake` already take here and the TUI takes for the same two facts
 * (`transcript.py`'s response/timeout blocks). The design note calls this "one
 * transcript receipt block per surface's own idiom": the data is the same
 * `ask_response`/`ask_timeout` pair the phone fold paints, and what differs per
 * surface is only how a receipt is drawn.
 *
 * ## What the expansion is FOR
 *
 * A response row exists so a question and its answer can be found again later —
 * the ask itself may be long gone from the live queue, which is the durability
 * the whole feature is built on. So the expansion lists the QUESTIONS and what
 * was answered for each, in the ask's own order, and a question with no answer
 * says so rather than leaving a gap (a decline, or a partially-answered ask from
 * the legacy incremental path). A SECRET answer is `[<key>]` on the wire and is
 * painted verbatim: the value only ever existed in the session's memory store.
 *
 * The timeout row has NO expansion. It states a fact in one sentence and the
 * expansion would repeat it — the rule `PeerRow` states and `WakeRow` applies
 * (an expansion that delivers nothing is worse than no expansion), with the
 * timeout's extra half (the ask is still answerable) already in the words.
 *
 * ## INK, and one honest gap
 *
 * Both rows take the neutral receipt register, because neither is a call and the
 * ledger's rule is that a receipt takes the name column's own ink — see
 * `rowInk`'s `receipt` branch. The BACKEND marks a timeout and a late answer
 * `warning` (`harness/rows.py`), and matching that here would need a warning arm
 * on the shared `ToolRowOutcome`, which is a change to the ledger every other
 * row reads. Until it exists, the warning is carried in WORDS - the timeout's
 * summary is the backend's own sentence and says the agent moved on - and the
 * ink parity is a named follow-up rather than a silent difference.
 */
const AskReceiptRow = memo(function AskReceiptRow({
	record,
	isSmallView,
}: {
	record: Extract<TranscriptRecord, { kind: "ask_response" | "ask_timeout" }>;
	isSmallView: boolean;
}) {
	if (record.kind === "ask_timeout")
		return (
			<MessageContainer isUser={false} isSmallView={isSmallView}>
				<ToolLedgerRow
					toolName="ask"
					/*
					 * VERBLESS: the backend's own sentence is the whole label. With the
					 * verb column this row read "Asked Timed out after 15m - ...", and its
					 * sibling read "Asked Answered late - ..." (design round 2, D13).
					 */
					verbless
					summary={askTimeoutSummary(record)}
					outcome="receipt"
					durationS={null}
				/>
			</MessageContainer>
		);
	const summary = askResponseSummary(record);
	if (record.questions.length === 0)
		return (
			<MessageContainer isUser={false} isSmallView={isSmallView}>
				<ToolLedgerRow
					toolName="ask"
					verbless
					summary={summary}
					outcome="receipt"
					durationS={null}
				/>
			</MessageContainer>
		);
	return (
		<MessageContainer isUser={false} isSmallView={isSmallView}>
			<ToolLedgerRow
				toolName="ask"
				verbless
				summary={summary}
				outcome="receipt"
				durationS={null}
				details={
					// `px-3` for the reason `PeerRow` states: an expanded receipt body has
					// to sit on the same text rail as every other expansion in the ledger.
					<div className={cn("flex flex-col gap-2 px-3")}>
						{record.secretLost ? (
							<p className={cn("text-body-sm text-warning")}>
								The session no longer holds the credential this answer named.
							</p>
						) : null}
						{record.questions.map((question) => (
							<div key={question.id} className={cn("flex flex-col gap-0.5")}>
								<p className={cn("text-body-sm text-ink-muted")}>
									{question.question}
								</p>
								<p
									className={cn(
										"whitespace-pre-wrap break-words text-body-sm text-ink",
									)}
								>
									{(record.answers[question.id] ?? []).length > 0
										? (record.answers[question.id] ?? []).join(", ")
										: "No answer given"}
								</p>
							</div>
						))}
					</div>
				}
			/>
		</MessageContainer>
	);
});

/**
 * A scheduled-wake delivery receipt.
 *
 * The row exists because a wake fires with no user keystroke: before it, a
 * resumed session showed the agent answering a wake with no sign the wake ever
 * fired. `wake` is already a `meta` category (it shares the TUI's clock glyph),
 * and the headline is the TUI's `WakeBlock` headline — the delivery's envelope
 * with the `(alarm)` marker, the `Scheduled wake` prefix and the cancel how-to
 * stripped, so what the reader gets is WHICH wake fired (`w-9 (1, every 6h)`)
 * rather than instructions addressed to the model. The receipt's INK is not that
 * category's, though: this is the delivery BLOCK, whose TUI analogue paints the
 * neutral register, so it settles to `ink-muted` beside `PeerRow` — see that
 * row's doc, and `rowInk`'s `receipt` branch for the rule.
 *
 * The disclosure is offered only when a prompt came with it. The TUI's blocks
 * return `can_expand() == true` unconditionally, but it also has a stated rule
 * against an expansion that delivers nothing (see `PeerMessageBlock`'s empty-body
 * comment), and here the headline already carries every addressing fact there is
 * — a wake id and its schedule — so an empty expansion would hold nothing at all.
 */
const WakeRow = memo(function WakeRow({
	record,
	isSmallView,
}: {
	record: Extract<TranscriptRecord, { kind: "wake" }>;
	isSmallView: boolean;
}) {
	const prompt = wakePromptBody(record.text);
	return (
		<MessageContainer isUser={false} isSmallView={isSmallView}>
			<ToolLedgerRow
				toolName="wake"
				summary={wakeReceiptHeadline(record.text)}
				outcome="receipt"
				durationS={null}
				details={
					prompt ? (
						// `px-3`: the same content rail as every other expanded body in the
						// ledger — see `PeerRow` above for the measurement.
						<p
							className={cn(
								"whitespace-pre-wrap break-words px-3 text-body-sm text-ink-dim",
							)}
						>
							{prompt}
						</p>
					) : undefined
				}
			/>
		</MessageContainer>
	);
});
// ---------------------------------------------------------------- list

/** Development row-render counter; read by the perf readout below. */
const rowRenderCount = { current: 0 };

/**
 * A fold's first row, redrawn at the trace tier: the fold wrapper carries the
 * gap the row arrived with (D8), so the row inside must not carry it twice.
 *
 * CACHED PER ROW OBJECT, because `TranscriptRow` is memoised on its `row` prop
 * and `buildRows` hands back the SAME row object for an untouched record - a
 * fresh `{...row}` on every render would re-render every fold's first row on
 * every streamed token, which is the per-delta cost `buildRows`' reuse exists
 * to remove. A `WeakMap` lets the copy die with the row it was made from.
 */
const traceTierRows = new WeakMap<Row, Row>();
const atTraceTier = (row: Row): Row => {
	if (row.gap === "trace") return row;
	let copy = traceTierRows.get(row);
	if (!copy) {
		copy = { ...row, gap: "trace" };
		traceTierRows.set(row, copy);
	}
	return copy;
};

/*
 * The GROUP-level twin of `atTraceTier`, for the one caller that passes
 * groups instead of rows: a collapsed run's hidden groups mount inside the
 * bar's disclosure, and the FIRST of them must arrive at the trace tier the
 * way `TraceFold` demotes its first row — otherwise it keeps the turn-tier
 * margin it earned as the turn's opener and the expansion re-introduces a
 * 32px step between the bar and the row beneath it (design review round 1,
 * D2: measured 36px box gap / Δ57px centers in the driven app, against the
 * ledger's own 22px pitch). Same `WeakMap` reuse rule as the row helper: an
 * untouched group keeps its identity so this adds no per-render copies.
 */
const traceTierGroups = new WeakMap<SectionGroup, SectionGroup>();
const atTraceTierGroup = (group: SectionGroup): SectionGroup => {
	if (group.kind === "row") {
		const row = atTraceTier(group.row);
		if (row === group.row) return group;
		let copy = traceTierGroups.get(group);
		if (!copy) {
			copy = { ...group, row };
			traceTierGroups.set(group, copy);
		}
		return copy;
	}
	if (group.gap === "trace") return group;
	let copy = traceTierGroups.get(group);
	if (!copy) {
		copy = { ...group, gap: "trace" };
		traceTierGroups.set(group, copy);
	}
	return copy;
};

/*
 * THE ROW DIRECTLY BELOW A BAR sits at the item tier rather than the trace tier
 * (operator report, 2026-09-29: the pinned "Context compacted" row "hugs the
 * summary row's rule too closely ... wants more breathing room between the
 * horizontal line and the row beneath it"). The trace tier is the LEDGER's
 * adjacency step; the rule is the bar saying the block below is a new one, so
 * the first row under it takes the in-turn block step - the same 12px the
 * closing answer already sits below the rule, so the block reads one way
 * whichever lands there. RAISE-ONLY: a first-after-bar row whose own gap is
 * wider (a steer's `turn` boundary, above all) keeps it; this loosens a 2px hug
 * and moves nothing else. Same `WeakMap` reuse rule as its siblings: an
 * untouched group keeps its identity so memoised rows are not re-rendered per
 * streamed token.
 */
const itemTierGroups = new WeakMap<SectionGroup, SectionGroup>();
const atItemTierGroup = (group: SectionGroup): SectionGroup => {
	if (group.kind === "row") {
		if (group.row.gap !== "trace") return group;
		let copy = itemTierGroups.get(group);
		if (!copy) {
			copy = { ...group, row: { ...group.row, gap: "item" } };
			itemTierGroups.set(group, copy);
		}
		return copy;
	}
	if (group.gap !== "trace") return group;
	let copy = itemTierGroups.get(group);
	if (!copy) {
		copy = { ...group, gap: "item" };
		itemTierGroups.set(group, copy);
	}
	return copy;
};

const TranscriptRow = memo(function TranscriptRow({
	row,
	isSmallView,
	scope,
	conversationId,
	/*
	 * The fold onto `origin/main` that carried #490 (`fix(chat): label every
	 * seeded tool row on open, and keep edit counts a stripped seed drops`) under
	 * this redesign is why this component takes BOTH of these: `foot` is the
	 * redesign's (§E3's per-turn foot line on the row that closes the turn) and
	 * `labelPending` is #490's, which suppresses the output stand-in while the
	 * read that will find a seeded call's arguments is still in flight. They are
	 * independent facts about a row, so the fold is the union rather than a
	 * choice - the same reason the inner `ToolRow` below still reads
	 * `outputFallbackLine`, and why dropping this prop would silently restore the
	 * bug #490 fixed (`bash  … {"text": 200…` drawn as if it were the command).
	 */
	answerRail = false,
	foot = null,
	closingLineSuppressed = false,
	labelPending = false,
	undelivered = null,
	labelHoldLate = false,
	labelMarked = false,
	stopping = false,
	onInterruptTurn,
}: {
	row: Row;
	isSmallView: boolean;
	scope: AttachmentScope | null;
	conversationId?: string;
	/**
	 * The transcript's one read of the rail setting. A BOOLEAN rather than the
	 * query, for the reason `labelPending` documents below: the rows are
	 * memoised, and the value changes only when the reader flips the switch.
	 */
	answerRail?: boolean;
	/** The turn's own foot line, on the row that closes it (§E3). */
	foot?: TurnFoot | null;
	/** The run above carries a bar; see `AssistantRow`'s copy of this prop. */
	closingLineSuppressed?: boolean;
	/**
	 * §F3's per-message failure state, or null. ONE OBJECT FOR THE WHOLE LIST,
	 * and every row but the one it names keeps the null it already had: the rows
	 * are memoised, so a fresh object per row would re-render the transcript on
	 * every paint (the same rule `labelPending` documents one line down).
	 */
	undelivered?: UndeliveredTurn | null;
	/**
	 * A BOOLEAN per row rather than the set: the rows are memoised, and handing
	 * every row the set would re-render all of them each time one id settles.
	 */
	labelPending?: boolean;
	/** The held column has outlived `LABEL_HOLD_MARK_MS`. */
	labelHoldLate?: boolean;
	/** A refusal ended this row's hold: the mark stands in the hold's place. */
	labelMarked?: boolean;
	/**
	 * The pane's stop is in flight (the transcript's own `stopping`): the
	 * image-gen card draws its cancelling step from this. A per-row BOOLEAN for
	 * the same reason `labelHoldLate` is one - the rows are memoised, and a fact
	 * that changes once per press is cheaper compared than threaded as state.
	 */
	stopping?: boolean;
	/**
	 * The pane's interrupt press (`CanonicalTranscriptProps.onInterruptTurn`),
	 * for the card's Cancel. Undefined means no control, by rule.
	 */
	onInterruptTurn?: () => void;
}) {
	rowRenderCount.current += 1;
	const { record } = row;
	let body: JSX.Element | null;
	switch (record.kind) {
		case "user":
			body = (
				<UserRow
					record={record}
					isSmallView={isSmallView}
					scope={scope}
					conversationId={conversationId}
					undelivered={undelivered?.recordId === record.id ? undelivered : null}
				/>
			);
			break;
		case "assistant":
			body = (
				<AssistantRow
					record={record}
					isSmallView={isSmallView}
					closesTurn={row.closesTurn}
					answerRail={answerRail}
					foot={foot}
					closingLineSuppressed={closingLineSuppressed}
					conversationId={conversationId}
				/>
			);
			break;
		case "tool":
			body = (
				/*
				 * The redesign's `ToolRow` takes `record`, the two layout flags and
				 * `labelPending`; main's `showAvatar`/`nameColumn` are NOT threaded
				 * because the redesign replaced that row's anatomy (its verb/object
				 * columns and the bubble's own app mark) and main's `nameColumn`
				 * definition was already gone from this file's merge. `labelPending`
				 * is the one prop #490 added that the new anatomy still needs.
				 */
				<ToolRow
					record={record}
					isSmallView={isSmallView}
					scope={scope}
					labelPending={labelPending}
					labelHoldLate={labelHoldLate}
					labelMarked={labelMarked}
					stopping={stopping}
					onInterruptTurn={onInterruptTurn}
				/>
			);
			break;
		case "peer":
			body = <PeerRow record={record} isSmallView={isSmallView} />;
			break;
		/*
		 * The two queued-ask receipts. One arm for both because they are one
		 * feature's pair and share a row component — the two-row shape the design
		 * calls for (`ask_timeout-` then `ask-response-` for a late answer), with
		 * the component deciding which of the two it is holding.
		 */
		case "ask_response":
		case "ask_timeout":
			body = <AskReceiptRow record={record} isSmallView={isSmallView} />;
			break;
		case "wake":
			body = <WakeRow record={record} isSmallView={isSmallView} />;
			break;
		default:
			body = <NoticeRow record={record} isSmallView={isSmallView} />;
	}
	if (body === null) return null;
	return (
		<div
			data-record-id={record.id}
			// The row's SPEAKER, as a machine-readable marker beside the id. It exists because
			// nothing in the DOM said which kind a row was: the id names the record, not the
			// party, so a rig counting user rows had to guess from layout classes - and the
			// guess one made (two attributes the app has never rendered) read 0 over a
			// transcript that plainly painted the row (agent review R-5, design D1). The
			// VALUE is the record's own `kind` (`canonical-transcript-types.ts`), emitted
			// verbatim rather than mapped, so a new record kind is identifiable the day it
			// exists instead of the day someone remembers to extend a list.
			data-record-kind={record.kind}
			data-completion-anchor={record.id}
			// Only `"true"` is ever queried, so the attribute is omitted rather
			// than emitted as `"false"` on every row of a long transcript.
			data-completion-complete={
				"complete" in record &&
				record.complete === true &&
				(record.kind !== "assistant" ||
					(!record.streaming && Boolean(record.text)))
					? "true"
					: undefined
			}
			className={cn(GAP[row.gap][isSmallView ? 1 : 0])}
		>
			{body}
		</div>
	);
});

/**
 * How long a click's `lop:open:requested` mark stays usable as a trace origin.
 *
 * Between the click and the first painted row sit a window recreation, an IPC
 * round trip and a history read; a minute is far longer than the worst honest
 * sample and far shorter than "the user came back to this window later", which
 * is the case that would otherwise be measured as a multi-second click.
 */
const OPEN_TRACE_MS = 60_000;

/**
 * The one sentence a refused checkpoint jump says.
 *
 * Both failure moments speak it — the near path's budget refusing to walk
 * further, and a row that vanished between reachability and reveal — because
 * the reader's situation is the same either way: the tick points at something
 * this view cannot show. An INFO toast rather than an error: the reader asked
 * for a place in their own history, and the answer is "further back than this
 * view has loaded", not a failed request to retry.
 *
 * The noun is the UI's own: the cards and tick labels say "Turn N", and
 * "checkpoint" is this design's internal word - it appears nowhere a reader
 * can see it (design round 1, D4). The sentence ends with the STEP (UX round
 * 1, U2): the transcript's own gesture - scroll up for older pages - is what
 * changes the answer, and a refusal without it is a dead end. The search
 * jump's copy carries the same tail.
 */
const CHECKPOINT_JUMP_MISS_COPY =
	"Could not reach that turn. It is further back than the loaded history — scroll up in the transcript to load more.";

/**
 * A fold group as the aggregation pass hands it on: the partition's own
 * variants unchanged. A run group used to carry a section flag
 * (`isNewestTurn`) for the fold's condense; the condense is retired (the
 * fold's open state is the reader's, see `fold-open.ts`), so the decoration
 * is gone with it.
 */
type SectionGroup =
	| (Extract<FoldGroup, { kind: "run" }> & {
			/**
			 * The run's images, computed by the groups memo while the rows are still
			 * in hand (`foldImages`). The fold's condensed header carries them because
			 * a collapsed fold UNMOUNTS the rows that draw them: without this, the
			 * artifact a call produced went with the rows and the reader had to expand
			 * the group to see it, which is the cost condensing was built to remove.
			 * Empty for almost every run, which is what keeps the no-image case's DOM
			 * and its height exactly what they were.
			 */
			images: TranscriptImage[];
	  })
	| Extract<FoldGroup, { kind: "row" }>;

export const CanonicalTranscript: FC<CanonicalTranscriptProps> = ({
	frontend,
	transcript,
	gate,
	waiting,
	starting,
	startingAfterId,
	startingSession,
	startingSince,
	stopping,
	onInterruptTurn,
	idleDisputed,
	workingLine,
	loadingOlder,
	onLoadOlder,
	onLoadOlderOutcome,
	olderFailed,
	onRetryHydration,
	olderTransportDown,
	openFrame,
	containerRef,
	isSmallView,
	status,
	failure,
	awaitingHydration,
	hydrationProven = true,
	historyReadPending = false,
	stale = false,
	missing = false,
	attachmentScope,
	conversationId,
	labelPending,
	undelivered = null,
	labelHoldLate,
	labelMarked,
	onReconnect,
}) => {
	// A crash-recovered outcome has no durable row of its own, so it is
	// synthesized here rather than in the stream reducer: this is the layer that
	// decides what is renderable, and an anchor with nothing to hit-test is an
	// unread badge the user can never clear.
	// Anchors already synthesized for THIS conversation. Held in a ref because
	// the row must outlive the `unseen` flag that created it (see
	// `withRecoveredOutcome`), and reset per conversation so one session's
	// recovered outcome can never paint into another's transcript.
	const recovered = useRef<{ session: string | null; anchors: Set<string> }>({
		session: null,
		anchors: new Set(),
	});
	const sessionId = frontend?.session_id ?? null;
	/*
	 * The attachment scope: the caller's when it supplied one (the child
	 * reader), otherwise the live session with no child. One value, computed
	 * once, so no row can disagree with another about where its bytes come
	 * from.
	 */
	const mediaScope: AttachmentScope | null =
		attachmentScope ?? (sessionId ? { sessionId, childId: null } : null);
	if (recovered.current.session !== sessionId) {
		recovered.current = { session: sessionId, anchors: new Set() };
	}
	const painted = useMemo(
		() =>
			withRecoveredOutcome(
				transcript,
				frontend?.attention,
				Boolean(frontend?.streaming),
				recovered.current.anchors,
			),
		[transcript, frontend?.attention, frontend?.streaming],
	);
	/*
	 * THE CROSS-SESSION FILTER: the single seam where the records a reader may
	 * SEE become the records this pane builds from. `hide` is the backend's
	 * `display.hide_cross_session`; default off means `visibleRecords` drops
	 * nothing and hands back the bare reference, so every downstream memo keeps
	 * its identity. Both consumers of the records read `shownRecords`: the row
	 * builder below, and the working line further down - that line derives from
	 * RECORDS (unlike the TUI's card-derived line), so an unfiltered list would
	 * still name a running `send`. The raw `transcript.records.length` gates
	 * below stay RAW on purpose: they answer "does this pane hold data", not
	 * "what does it paint", and a session whose only rows are hidden must not
	 * flip the pane's empty state.
	 */
	const hide = useCrossSessionHidden();
	/*
	 * ONE read of the rail setting for the whole transcript, handed to the rows as
	 * a boolean prop: the elected answer is the only row that consumes it, so a
	 * hook per assistant row would subscribe to the Settings query once per row
	 * for one fact (agent review round 1, R4).
	 */
	const answerRail = useTurnAnswerRail();
	const shownRecords = useMemo(
		() => visibleRecords(painted.records, hide),
		[painted.records, hide],
	);
	// `loadingOlder` is deliberately NOT part of this gate any more.
	//
	// The acknowledgement asks one question: can the reader actually see the
	// completed anchor row? `useCompletionView` answers it by hit-testing that
	// row, which is a direct measurement and is honest on any frame, including
	// one where history is mounting above. Loading older rows is at the far end
	// of the transcript from the anchor and was only ever a proxy for "layout is
	// in flux".
	//
	// Under click-driven paging that proxy was harmless because it flipped twice
	// per reader decision. Under scroll-driven paging it flips per revealed page,
	// and every flip re-runs this effect: the poll interval is torn down and
	// rebuilt and the `acknowledged` latch inside it is lost, so a reader
	// scrolling back through history would leave a completion unacknowledged that
	// they had been looking at the whole time.
	useCompletionView(frontend, status === "live" && !waiting, containerRef);
	/*
	 * The checkpoint rail's manifest (design §D5/D10). Keyed on the pane's own
	 * conversation identity, so a session switch is a fresh read and nothing
	 * from the previous manifest survives (the hook owns that reset).
	 *
	 * The rail is met with the hook's policy rather than a second one: one
	 * read per conversation, the warm only on the reader's own gestures, the
	 * poll only while a requested name is pending, and a backend without the
	 * op degrading to a hidden rail with one warn (`use-checkpoints.ts`).
	 */
	const checkpoints = useCheckpoints(sessionId ?? "");
	const previousRows = useRef<Row[]>([]);
	const rows = useMemo(() => {
		const next = buildRows(shownRecords, previousRows.current);
		previousRows.current = next;
		return next;
	}, [shownRecords]);
	/*
	 * The jump's read of the row model BETWEEN awaits. `ensureReachable`'s
	 * callbacks run after frame waits and page loads, so they must see the
	 * model as it is then rather than as this render closed over it.
	 */
	const rowsRef = useRef(rows);
	rowsRef.current = rows;
	// Windowing: newest rows first. The window widens when the reader nears the
	// top, and resets when the transcript is replaced (session switch/clear).
	//
	// THE RESET IS A RENDER-PHASE ADJUSTMENT, NOT AN EFFECT, and that is a
	// measurement rather than a preference (operator report, 2026-09-26: "no
	// jitter where things seem to load at different times"). As an effect it
	// landed one commit AFTER the new transcript's first paint, so a switch into
	// a long conversation painted the window inherited from the previous one and
	// then dropped to the newest sixty - measured on the cached-switch sequence,
	// the first painted frame held all 106 fetched rows and the next commit
	// trimmed it (`scr` extent 8,315.6 -> 4,864.2 px, all of it above the fold,
	// and a second paint all the same). Adjusting the state during render
	// re-renders before the browser paints (React's "adjusting state when a prop
	// changes"), so the first frame of a conversation is already the windowed
	// one. Clause H's reason is unchanged: without a reset, opening a long
	// conversation and then a short one leaves the short one mounting every row
	// it has, and the paging state would be reasoning about a window that
	// belongs to the previous transcript.
	const [windowSession, setWindowSession] = useState(sessionId);
	const [windowSize, setWindowSize] = useState(WINDOW);
	/* The completion walk's budget, KEYED BY THE RUN it is walking (1b/B): the
	 * run under the window's top edge owns the pages spent on it, so a
	 * conversation that outlives its first walk can still complete the bars of
	 * turns that settle later. See `alignWalkStateFor` and the effect below. */
	const alignWalk = useRef(initialAlignWalkState());
	/* The settle announcement's own memory — see the effect beside the collapse
	 * plan. `keys` are the bars already stated (or absorbed silently, when they
	 * were window-entered rather than settled); `rowIds` are every row the
	 * PREVIOUS pass's plan held, which is what tells a settle from a reveal. */
	const announcedPlan = useRef<{
		keys: Set<string>;
		rowIds: Set<string>;
	} | null>(null);
	if (windowSession !== sessionId) {
		setWindowSession(sessionId);
		setWindowSize(WINDOW);
		alignWalk.current = initialAlignWalkState();
		announcedPlan.current = null;
	}
	/*
	 * THE FOLD-OPEN REGISTRY, keyed to the conversation and reset the same
	 * render-phase way (operator report, 2026-09-27). It lives HERE rather than
	 * on each `TraceFold` because a fold's React identity is its key - the first
	 * row of its run - and the render window's leading edge walks through runs as
	 * rows arrive, remounting them; `fold-open.ts`'s header carries the measured
	 * walk and the migration the registry performs. `sessionId` is the
	 * transcript's own conversation identity, the same value the window above
	 * resets on, so the two cannot disagree about a switch.
	 *
	 * THE IDENTITY IS STICKY ACROSS A NULL, and that is the report's own failure
	 * class one layer down: the reconnect gap arms null `frontend` outright, so a
	 * registry keyed on `sessionId` alone would close every fold the reader opened
	 * on every reconnect. The last STATED id is held until a different one
	 * arrives - a gap keeps the conversation, a switch changes it.
	 */
	const foldSession = useRef(sessionId);
	if (sessionId !== null) foldSession.current = sessionId;
	const [foldOpen, setFoldOpen] = useState<{
		session: string | null;
		entries: readonly FoldOpenEntry[];
	}>(() => ({ session: foldSession.current, entries: [] }));
	if (foldOpen.session !== foldSession.current) {
		setFoldOpen({ session: foldSession.current, entries: [] });
	}
	/**
	 * The reader's press on a fold, recorded against the fold's CURRENT id set.
	 *
	 * `keep` is every record the conversation holds - not just the render window:
	 * a fold scrolled outside the window is still the reader's, and pruning its
	 * entry the moment its rows leave the window would reproduce the bug this
	 * registry exists to fix, one scroll later.
	 */
	const setFoldOpenFor = (ids: readonly string[], open: boolean) => {
		const keep = new Set(transcript.records.map((record) => record.id));
		setFoldOpen((current) => ({
			session: foldSession.current,
			entries: withFoldOpen(
				current.session === foldSession.current ? current.entries : [],
				ids,
				open,
				keep,
			),
		}));
	};
	/*
	 * THE READER'S EXPANSION OF TURN BARS, per conversation. The store is a
	 * sibling of the paint cache (`shared/store/turn-collapse-open.ts`) so the
	 * state survives the window's edge walking past a bar and a switch away and
	 * back; a reload arrives at the shipped default (collapsed) by design. The
	 * render-phase adjustment mirrors the window reset above and for the same
	 * reason: a switch must read the NEW conversation's set in its first paint,
	 * not one commit later. `openRuns` is the readable copy; every write goes
	 * through the store so the two cannot drift.
	 */
	/*
	 * The collapse's own liveness and open-run set, for the WIDEN's paint count
	 * (loader-continuity 1b). `widen()` runs from an input event long after the
	 * render that computed them, and it must count the same rows the render pass
	 * paints: a run the reader has opened shows its rows, and the newest run
	 * while a turn is being written never collapses. Read through a ref rather
	 * than added to `widen`'s dependency list, because `widen` is consumed by
	 * the paging hook and a new identity per render would re-create it (and the
	 * hook's refs) for a value that only an event reads - the same reason
	 * `rowsRef` exists.
	 *
	 * `mode` rides in the SAME ref for the same reason, and it is the reader's
	 * display mode (M1/Q1): the count below and the plan the list paints from must
	 * read ONE mode, or the step measures a paint the reader is not looking at.
	 * The value is the PARSED one (`parseTranscriptDisplayMode`, the read-side
	 * judge this component already uses at the plan below) rather than the raw
	 * store value, and it is kept out of `widen`'s dependency list for the reason
	 * above: a mode change is a re-render, not a new callback identity.
	 */
	const widenInputs = useRef<{
		live: boolean;
		openRuns: ReadonlySet<string> | undefined;
		/** The reader's mode, for the widen's paint count (see this ref's note). */
		mode: TranscriptDisplayMode;
		/**
		 * The size the reader is LOOKING at (`alignSize`, the snap's output), which is
		 * the widen's measuring baseline (agent review round 1, R1-1): the raw
		 * `windowSize` can be far smaller than what is mounted, and a search measured
		 * from the raw number compares windows the render never painted. A ref for the
		 * same reason as the two above — `widen` runs from an input event long after
		 * the render that computed this, and adding it to the callback's dependencies
		 * would re-create the hook's refs on every mount change.
		 */
		mounted: number;
	}>({
		live: false,
		openRuns: undefined,
		mode: DEFAULT_TRANSCRIPT_DISPLAY_MODE,
		mounted: 0,
	});
	const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(() =>
		expandedRunsOf(sessionId),
	);
	const [openRunsSession, setOpenRunsSession] = useState(sessionId);
	if (openRunsSession !== sessionId) {
		setOpenRunsSession(sessionId);
		setOpenRuns(expandedRunsOf(sessionId));
	}
	const setRunOpen = useCallback(
		(runKey: string, open: boolean) => {
			setOpenRuns(writeRunExpanded(sessionId, runKey, open));
		},
		[sessionId],
	);
	/*
	 * Where the pressed bar sat when the reader pressed it, and the bar lookup the
	 * press and its layout effect share. The rule these serve - a pressed bar stays
	 * where it was pressed, and its write goes out acknowledged to the paging hook
	 * - is stated at the effect that spends them.
	 */
	const pressedBar = useRef<{ id: string; top: number } | null>(null);
	/*
	 * Found by comparing the attribute rather than by a selector: a record id is
	 * arbitrary text, and escaping it for a selector is a second thing to get wrong
	 * (and `CSS.escape` is absent from the test DOM).
	 */
	const barFor = useCallback(
		(id: string): Element | null => {
			const bars = containerRef.current?.querySelectorAll(
				"[data-turn-summary]",
			);
			for (const bar of bars ?? []) {
				if (bar.getAttribute("data-record-id") === id) return bar;
			}
			return null;
		},
		[containerRef],
	);
	const openBar = useCallback(
		(runKey: string, firstId: string, open: boolean) => {
			/*
			 * RECORDED FOR A CLOSE AS WELL AS AN OPEN (QA round 2, QA-2). The open
			 * was compensated first because that is where the defect was measured;
			 * the close moves the viewport the other way by the same span and is
			 * just as much the reader's press, so it takes the same record and the
			 * same single write. One record per press, consumed by the next commit,
			 * so the two movements cannot double-count each other - the open's write
			 * is already spent, and acknowledged, before the close is pressed.
			 */
			const bar = barFor(firstId);
			if (bar) {
				pressedBar.current = {
					id: firstId,
					top: bar.getBoundingClientRect().top,
				};
			}
			setRunOpen(runKey, open);
		},
		[barFor, setRunOpen],
	);
	const total = rows.length;
	// What the working line says, and which phase it is timing. The derivation
	// (and its copy contract, including the one branch this app drives from its
	// own admitted send rather than from a frame) lives in
	// `working-line-model.ts`; this is only the memo that keeps it off the
	// per-token path.
	const paneWorking = useMemo(
		() =>
			// One input builder for this claim's two readers - this rung and the
			// composer's hint (`workingLineInputFor`, `working-line-model.ts`).
			// The builder is shared; the record lists handed to it are not: this
			// rung reads the cross-session filter's `shownRecords`, while the
			// composer's hint still reads the raw records (`chat-content.tsx`).
			// No divergence is reachable today - `waiting` is answered by the
			// ladder's fallback on either list, and the one predicate that could
			// flip on dropped rows (`ownerAnswered`) is decided over RAW records
			// in `chat-page` before either reader is built. If that normalization
			// ever moves off raw records, this seam moves with it.
			deriveWorkingLine(
				workingLineInputFor({
					waiting,
					// The pass is the transcript's own fact, read here rather than
					// latched in this view: one source for the rung and the composer's
					// hint (see `transcript-reducer`'s `compacting`).
					compacting: transcript.compacting,
					// The phase's own start, so the clock times the PASS rather than this
					// component's mount - and so the frame is a picture of the state
					// instead of the shutter's timing (design round 2, D3).
					compactingSince: transcript.compactingSince,
					// The producer's OWN phase and its zero, off the frontend state that
					// rode in with the snapshot. This is the half a resumed pane cannot
					// derive from its own records (`thinking` has no tool row behind it at
					// all), and it is used only when the producer's phase equals the one
					// derived here - the gate lives in `deriveWorkingLine`, once, because
					// the comparison needs the derived phase.
					foldedPhase: frontend?.activity_phase,
					foldedPhaseStartedAt: frontend?.activity_phase_started_at,
					starting,
					startingAfterId,
					startingSession,
					startingSince,
					stopping: stopping === true,
					// The disputed idle's clock-withhold (U9): one fact with the
					// composer's sentence, folded from the notice's kind in the page
					// and handed to the SAME derivation both surfaces read, so the
					// rung's number and the sentence cannot disagree about whether
					// the pane can vouch for a duration.
					idleDisputed: idleDisputed === true,
					gate,
					// The rung yields to a TERMINAL statement and not to a reconnect
					// (operator incident, 2026-10-07): a receipt gap drops the
					// authoritative frontend and the pane says "Reconnecting", but the
					// last reading still says the turn is running - and that is exactly
					// the window in which the reader must not lose the in-flight claim.
					// The predicate is the pane's own (`canonicalTranscriptTerminal`),
					// so the rung and the composer's hint cannot disagree about which
					// statements end a claim; see its doc for the full rule and
					// `reconnect-gap.stories.tsx`'s `RestoredRunning` for the frame.
					//
					// The four fields are spelled out rather than handed over as
					// `paneView`: this is a memo, and a fresh object would make its deps
					// depend on the view's identity instead of on the facts it reads.
					unavailable: canonicalTranscriptTerminal({
						status,
						failure,
						missing,
						stale,
					}),
					records: shownRecords,
				}),
			),
		[
			waiting,
			transcript.compacting,
			// The phase's own start, read by the builder above: without it a pass
			// whose stamp changed while the claim did not would keep the old anchor.
			transcript.compactingSince,
			// Read by the builder above as the resumed rung's anchor. Spelled out as the
			// two fields rather than the `frontend` object, for the same reason the four
			// view flags are: a memo whose dep is the object re-derives on every frame
			// the stream repaints, which is the per-token path this memo exists to stay
			// off.
			frontend?.activity_phase,
			frontend?.activity_phase_started_at,
			starting,
			startingAfterId,
			startingSession,
			startingSince,
			stopping,
			// Read by the builder above (U9): a disputed idle arriving or retiring
			// moves the rung's clock cell, so it is a dep of this memo by the same
			// rule as `stopping`.
			idleDisputed,
			gate,
			status,
			failure,
			// The pane's two click-path states, because the predicate above reads them
			// and a memo that missed them would keep a claim the pane has withdrawn.
			missing,
			stale,
			shownRecords,
		],
	);

	/*
	 * IS A TURN BEING WRITTEN (or parked on a question)? The collapse's own
	 * liveness rule, derived ONCE here and read by the window's snap, the widen's
	 * paint count and the plan below. It is above them because the snap needs it:
	 * the completed-run allowance is for a SETTLED turn's bar, and mounting a run
	 * that is still streaming whole would put a live turn's whole prefix on screen
	 * — the cost the window exists to bound. See `snapWindowToRunBoundary`.
	 */
	const paneIsLive =
		(workingLine === undefined ? paneWorking : workingLine) !== null ||
		gate !== null;

	/*
	 * The window's top edge lands on a RUN boundary, not a raw row count (the
	 * on-load fix, operator report 2026-09-28: a completed run the edge cut
	 * through could not collapse until the reader scrolled its head in). See
	 * `snapWindowToRunBoundary` for the rule and its bound. The snap is a pure
	 * derivation of `rows` and `windowSize` — no state, so nothing can race the
	 * first paint — and it composes with the widen steps below: a widened window
	 * snaps again, and the snapshot's own arrival snaps the first non-empty
	 * window without an effect.
	 */
	/*
	 * The run under the RAW window edge, computed ONCE (agent review round 2,
	 * R2-2): `windowTopRun` is a whole-store partition, and both the snap below and
	 * the walk's store confirmation read the same run — this is the one partition
	 * per render they share, rather than one each.
	 */
	const storeTopRun = useMemo(
		() => windowTopRun(rows, windowSize),
		[rows, windowSize],
	);
	const alignSize = useMemo(
		() =>
			snapWindowToRunBoundary(
				rows,
				windowSize,
				WINDOW_ALIGN_MAX_EXTRA,
				// The COMPLETED-RUN allowance (1b/A): a run whose own opening row is in the
				// store may be snapped all the way to that row, so a settled turn states its
				// true action count and its `Took` clause at open. See the constant's note for
				// why the reach is safe (a collapsed run unmounts what its bar hides) and why
				// the bound is the widen's own.
				WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
				// …and it is for a SETTLED run only: `paneIsLive` is the same liveness the
				// collapse reads, so a turn still being written keeps the ordinary reach and
				// cannot mount its whole streaming prefix (see the snap's own note).
				paneIsLive,
				storeTopRun,
			),
		[rows, windowSize, paneIsLive, storeTopRun],
	);
	const visible = useMemo(
		() => (total > alignSize ? rows.slice(total - alignSize) : rows),
		[rows, total, alignSize],
	);
	const hidden = total - visible.length;
	/*
	 * THE WINDOW'S STRUCTURAL SIGNATURE (UI perf audit P1/P4; PR-6). `rows` is
	 * rebuilt on every streaming flush and `visible` is a fresh slice of it, so a
	 * memo keyed on either re-ran per streamed token - including the tokens that
	 * only append to an answer's text. This is ONE serialization of what the
	 * plan and the feet READ (`collapseRowsKey`, `turn-collapse-model.ts`), and
	 * every memo below that is arithmetic over the window keys on it instead of
	 * on the array.
	 */
	const rowsKey = useMemo(() => collapseRowsKey(visible), [visible]);
	/*
	 * The rail's reader-side cue (design round 1, D2 + U1; the settle re-read
	 * is UX round 1, N1): one derivation of both halves the rail consumes,
	 * owned and unit-pinned in `use-active-checkpoint.ts` beside this file.
	 * `loadedIds` is the record ids this store holds; `activeId` is the
	 * checkpoint at the reading position.
	 */
	const { activeId: activeCheckpointId, loadedIds: loadedCheckpointIds } =
		useActiveCheckpoint(containerRef, rows, checkpoints.checkpoints);
	/*
	 * ONE in-flight page for the walk-side consumers — the align fetch below
	 * and the jump walk — while the READER's own scroll path keeps the pager's
	 * raw refusal semantics (`onLoadOlder` straight through).
	 *
	 * HISTORY OF THE SPLIT: the pager used to answer a concurrent ask with
	 * `false`, and a walk read that as "history ends here", so a jump colliding
	 * with an align page fell through to a clamped mount instead of awaiting the
	 * page already on its way. The session hook is now single-flight and SHARES
	 * the in-flight page with every caller (`createOlderLoader`), so this wrapper
	 * is redundant for the hook's own `onLoadOlder`; it is kept because the
	 * walk's callers may be handed any boolean pager (the child reader's), and
	 * sharing is idempotent.
	 */
	const walkLoadOlder = useMemo(
		() => shareInFlight(onLoadOlder),
		[onLoadOlder],
	);
	/*
	 * §E2's aggregation tier, and §E3's foot lines, computed over the SAME visible
	 * rows the list renders. Both are pure (`trace-fold-model.ts`) because both are
	 * arithmetic over the row list that a test can ask about without rendering a
	 * transcript: which runs fold, what a fold says, and what a turn's foot reports.
	 *
	 * `isFoldable` is the tool ledger alone: `peer` and `wake` rows are RECEIPTS, not
	 * actions (§E2 folds "actions"), and a receipt hidden inside a summary of work
	 * would be a message the reader never saw.
	 */
	const rowGroups = useMemo(() => {
		/*
		 * `isNewestTurn` used to be computed here for the fold's condense; the
		 * condense is retired (the fold's open state is the reader's, see
		 * `fold-open.ts`), and the map below carries only the run's images - the
		 * media lane's own decoration, documented at its own site.
		 */
		const groups = foldRuns(visible, {
			nameOf: (row) => ledgerName(row.record),
			/*
			 * `isFailedResult`, not `isError` alone: a `send` that settled `mailbox` or
			 * `unconfirmed` is a non-failure the core leaves `is_error` false for, and the
			 * shared predicate says so here rather than assuming it of the producer. This
			 * one expression feeds the fold's failed count, the turn foot's `· N failed`
			 * AND the failed-row jump's target, so counting a partial result as a failure
			 * would jump the reader to a message sitting in the peer's inbox.
			 */
			failedOf: (row) =>
				row.record.kind === "tool" &&
				isFailedResult(row.record.isError, row.record.delivery),
			durationOf: workedSecondsOf,
			/*
			 * The fold's condensed header is fed from the records themselves: the
			 * running call's own words (`toolRecordSummary`), its own running
			 * predicate, and the two stamps its span is built from. All four live
			 * behind options so the model stays a pure function over rows.
			 */
			summaryOf: (row) =>
				row.record.kind === "tool" ? toolRecordSummary(row.record) : "",
			/*
			 * The operation token, so the fold's live clause names an op-aware call
			 * in the same words its own row prints - see `foldLive`.
			 */
			opOf: (row) =>
				row.record.kind === "tool" ? toolOp(row.record.args) : "",
			runningOf: (row) =>
				row.record.kind === "tool" && row.record.phase !== "done",
			/*
			 * The live clause's predicate is NARROWER than the condense guard's: a
			 * composing or queued call has no name to paint yet, so the header waits
			 * for `phase === "running"` rather than announcing a phase it cannot
			 * back (see `foldLive`).
			 */
			executingOf: (row) =>
				row.record.kind === "tool" && row.record.phase === "running",
			startedAtOf: (row) =>
				row.record.kind === "tool" ? row.record.startedAt : null,
			endedAtOf: (row) =>
				row.record.kind === "tool" ? row.record.endedAt : null,
			isFoldable: (row) => row.record.kind === "tool",
		});
		return groups.map((group) =>
			group.kind === "run"
				? {
						...group,
						/*
						 * The run's pictures, computed HERE rather than at the fold's call
						 * site: a collapsed fold unmounts the rows that draw them, so the
						 * condensed group has to carry what they would have shown, and
						 * this memo is where the rows are still in hand. Empty for almost
						 * every run (`foldImages` returns nothing when no action produced
						 * an image), which is what keeps the no-image case's DOM and its
						 * height exactly what they were.
						 */
						images: foldImages(group.rows),
					}
				: group,
		);
	}, [visible]);
	/*
	 * KEYED ON THE WINDOW'S SIGNATURE, NOT ON `visible` (UI perf audit P4; PR-6).
	 * The foot is arithmetic over the same partition the plan builds - counts,
	 * failed ids and worked seconds, all of them structural - so a token that
	 * only lengthens an answer's text cannot change one entry. The foot map's
	 * values are read by ID (`feet.get(row.record.id)`), so the
	 * stale-by-identity map this holds between tokens is the same map.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt from `visible` only when the content signature above moves; a `visible` dependency would rebuild it on every streamed token, which is the per-token cost this memo exists to remove.
	const feet = useMemo(() => {
		dbgFeetRebuilds.count += 1;
		/*
		 * The foot counts the SAME unit the caption rule and the collapse model use:
		 * the rows are partitioned by `runsOf`, and the tally resets at a run's
		 * opener. The historical `gap === "turn"` proxy also fires on a steer row,
		 * which used to reset the count mid-turn and let a steered run's foot
		 * disagree with everything above it (F5: a bar saying `12 actions` over a
		 * foot saying `4`).
		 */
		const openerIds = new Set(
			runsOf(visible).map((run) => visible[run.openingIndex].record.id),
		);
		return turnFeet(visible, {
			/*
			 * `isFailedResult`, not `isError` alone: a `send` that settled `mailbox` or
			 * `unconfirmed` is a non-failure the core leaves `is_error` false for, and the
			 * shared predicate says so here rather than assuming it of the producer. This
			 * one expression feeds the fold's failed count, the turn foot's `· N failed`
			 * AND the failed-row jump's target, so counting a partial result as a failure
			 * would jump the reader to a message sitting in the peer's inbox.
			 */
			failedOf: (row) =>
				row.record.kind === "tool" &&
				isFailedResult(row.record.isError, row.record.delivery),
			/*
			 * The SAME quantity every condensed bar states (`workedSecondsOf`): one
			 * definition, so the bars of a ladder add up to this figure (#708 D1).
			 */
			durationOf: workedSecondsOf,
			isAction: (row) => row.record.kind === "tool",
			opensRun: (row) => openerIds.has(row.record.id),
		});
	}, [rowsKey]);

	/*
	 * An empty transcript must not claim the column's free space - UNLESS the
	 * reader has not been told what the conversation holds yet.
	 *
	 * This scroller carries `grow` so it absorbs the leftover height between the
	 * header and the composer. With rows in it that is the whole point. With NO
	 * rows it is an empty box that still votes for all the free space, and the
	 * composer band below -- which renders the greeting, the composer and the
	 * suggestion chips on exactly that condition -- is left pinned to the bottom
	 * under a large dark void.
	 *
	 * So the hold asks whether this session is still OWED a page, and NOT `status` -
	 * the handle's composed `awaitingHydration`, the same value the composer band
	 * below reads as `isHydrating`. The distance between those two is the whole of
	 * the pre-merge resolution check's Finding 1. They disagree in both directions
	 * on this path: `Retry` re-arms the stream as `connecting` in front of a
	 * conversation a completed read has already proven EMPTY
	 * (`use-canonical-session.ts` leaves `hydrated` untouched), and a cold session's
	 * `cursor_missing` snapshot goes `live` without hydrating. Keyed on the
	 * transport's word the pane held "Loading conversation…" over a conversation
	 * known to hold nothing while the band took the greeting and its own `grow`, two
	 * contradictory claims splitting one column until the snapshot landed and the
	 * composer dropped to the empty-chat position -- the 468px -> 736px move this
	 * work exists to remove -- and the mirror state (not yet read, already `live`)
	 * left no loading claim anywhere. Both directions are pinned in
	 * `scripts/session-switch.test.mjs`.
	 *
	 * THE THIRD DIRECTION, and it is the operator's own report in a second surface:
	 * a pane with NO session answers "has a page been applied" with `no` forever.
	 * A New chat is a staged draft that opens no stream at all, so keyed on
	 * `hydrated` this pane held `Loading conversation…` and its shimmer rows above
	 * the band's restored greeting and chips - the same two-contradictory-claims
	 * class as Finding 1, and the half the operator would still read as an unfixed
	 * stuck loader. The owed question is composed ONCE, on the canonical session
	 * handle, precisely so a session-less pane cannot be read as a wait that is not
	 * happening; the band and this pane are its two readers.
	 *
	 * THE DECISION IS A MATRIX, NOT A CASE. A row-less pane has exactly one claim
	 * to make, and the rule over all four of its inputs lives in `transcript-pane.ts`,
	 * where a node test walks every combination rather than the directions a defect
	 * happened to be found in. It reads: the pane HOLDS the placeholder exactly
	 * while a page for this session is still owed, there is nothing to scroll, AND
	 * the pane has nothing of its own to say.
	 *
	 * The statement term is there because a pane can be speaking while no page has
	 * been applied: the failure notice (`unavailable` with a published failure, which
	 * the history-read arm publishes with `hydrated` still false by construction) and the
	 * reconnecting line are both CONTENT, and the notice is the only thing on screen
	 * that says what happened and the only place its control lives. This rule once
	 * hid them behind an `overflow: hidden` box 0px tall - measured in the running
	 * app, the scroller box was 880x0 with the notice inside it and the control at
	 * y=60 outside the visible pane - and the reconnecting line was clipped the same
	 * way for the whole retry window (design round 1, D3: scroller h 0, text at
	 * y 70.6). `canonicalTranscriptSpeaks`, in the same module, owns that decision,
	 * and the composer band asks it the same question before it claims the free
	 * height for a greeting.
	 *
	 * Which is also why the placeholder stands down in those two states: beside a
	 * statement it would be a SECOND claim, and the untrue one (the load is not still
	 * running - it failed, or the stream is re-establishing). It adds no geometry
	 * there either, because the scroller is already held out of `collapsed` by the
	 * statement, so the placeholder buys a contradiction and nothing else.
	 *
	 * The three facts stay separate and none implies another: a `reconnecting` or
	 * `unavailable` pane has rows or a statement to show, a `connecting` pane with a
	 * page still owed has no statement of its own, and a pane with rows paints them
	 * whatever its stream is doing. The collapse therefore stands down for all
	 * three, and happens only in the one row where none of them is true.
	 *
	 * `records` rather than `rows` because a record that renders to no row is still
	 * nothing to scroll. (The legacy twin this sentence was written against,
	 * `MessagesView`, has since been deleted with the socket transport, so the
	 * "the two paths change together" it used to bind no longer applies to
	 * anything.)

	 * AND A SEND THIS PANE HAS ADMITTED, which is the case this change exists for
	 * and the one row of the matrix the record list cannot express: the reader has
	 * not been told what the conversation holds, there is nothing to scroll, and
	 * the pane DOES have something of its own to say - the wait line the owner's
	 * admission put in flight. So the placeholder stands down (it would be a
	 * second, weaker claim: the load is not the thing the reader is waiting for
	 * any more) and the pane still does not collapse, because the wait line is
	 * rendered at this scroller's foot and had no height to paint in. Measured
	 * before this term existed: the rung was in the DOM at t+258 ms and its first
	 * painted pixel was at t+13.8 s (QA round 1, Q1) - exactly the dead air the
	 * operator reported on the New-chat path.
	 */
	const paneView = {
		status,
		failure,
		awaitingHydration,
		recordCount: transcript.records.length,
		/*
		 * A send this pane has admitted and the owner has not answered. The pane's
		 * own fact rather than the stream's, and the one row of the matrix that no
		 * record can express: see the term's rationale in `transcript-pane.ts`.
		 */
		admittedSend: starting,
		// The two states a notification click can paint with no authoritative
		// answer in hand. Both are statements of the pane's own, so it must not
		// collapse out of the layout and the band must not offer the greeting over
		// a conversation nobody has read; the rules and the reasoning live in
		// `transcript-pane.ts`, which is the one authority for them.
		missing,
		stale,
	};
	const holdPlaceholder = transcriptPaneHoldsPlaceholder(paneView);
	const collapsed = transcriptPaneCollapses(paneView);

	/*
	 * The END of the click-to-visible trace: the first commit that paints a
	 * transcript row for this conversation.
	 *
	 * A LAYOUT effect rather than a passive one on purpose. A passive effect runs
	 * after the browser could have painted, so it would measure when React
	 * happened to schedule the callback rather than when the user could read a
	 * row. Once per conversation: a mark per row would measure scrolling rather
	 * than the click, and the point of the trace is the FIRST row. The sibling
	 * mark is at the click (`app.tsx`), and `performance.measure` throws when
	 * either mark is absent - the ordinary case for a conversation opened from
	 * the sidebar - so it is guarded rather than caught.
	 *
	 * The requested mark is CONSUMED, and a stale one is refused (review round 1,
	 * R1-5). It is written by the click and never expired, so measuring from it
	 * whenever it exists means the next conversation opened from the sidebar
	 * produces a measure running from the ORIGINAL click - phantom multi-second
	 * samples in exactly the p50/p95 this trace is collected for. Clearing after
	 * the measure keeps one click to one sample; the age gate covers a click
	 * whose window never paints a row, which would otherwise poison the first
	 * sample after the app returns to it.
	 */
	const tracedSession = useRef<string | null>(null);
	useLayoutEffect(() => {
		if (visible.length === 0) return;
		const key = sessionId ?? "";
		if (tracedSession.current === key) return;
		tracedSession.current = key;
		performance.mark("lop:open:first-row");
		const requested = performance
			.getEntriesByName("lop:open:requested", "mark")
			.at(-1);
		if (requested && performance.now() - requested.startTime <= OPEN_TRACE_MS) {
			performance.measure(
				"lop:open:to-first-row",
				"lop:open:requested",
				"lop:open:first-row",
			);
		}
		performance.clearMarks("lop:open:requested");
	}, [visible.length, sessionId]);

	// Both growth paths now go through one policy. The local window used to
	// widen from its own raw `scroll` listener, once per EVENT below 320px from
	// the top, which meant a single fling widened it by dozens of steps and
	// mounted hundreds of rows for one gesture. It is the same jitter family as
	// the missing durable paging and it gets the same discipline.
	//
	// THE STEP IS CHOSEN IN THE READER'S CURRENCY (loader-continuity 1b). A raw
	// `+WINDOW_STEP` over a transcript of finished turns moves the count in the
	// slot and mounts rows the collapse hides again, so the reader's gesture
	// reveals nothing: measured on the operator's journal, one 618-row run
	// painted 4-7 rows across window 60..300, and the bar only gained its real
	// count and its `Took` clause at window 300. `widenTarget` walks the same
	// steps until the window PAINTS `minVisibleRows` more rows than the one it
	// started from, and stops at `WIDEN_MAX_STEPS` steps - the bound the reveal
	// chain already uses, so one gesture still reveals one window's worth.
	const widen = useCallback(() => {
		setWindowSize(() =>
			Math.min(
				total,
				widenTarget(rowsRef.current, widenInputs.current.mounted, {
					step: WINDOW_STEP,
					live: widenInputs.current.live,
					openRuns: widenInputs.current.openRuns,
					/*
					 * The reader's OWN mode (M1/Q1): a `by-response` transcript keeps rows the
					 * `by-turn` plan calls hidden, so a step measured without it stops late and
					 * commits a larger window than one gesture promises. See `widenInputs`.
					 */
					mode: widenInputs.current.mode,
					snapMaxExtra: WINDOW_ALIGN_MAX_EXTRA,
					// The render's OWN second bound (the completed-run allowance), so the
					// step's painted delta is measured against the window the component
					// actually mounts - agent review round 1, R1-1.
					completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
					maxRows: Math.min(
						total,
						widenInputs.current.mounted + WIDEN_MAX_STEPS * WINDOW_STEP,
					),
				}),
			),
		);
	}, [total]);

	/*
	 * THE PAINT COUNT THE PAGING HOOK SETTLES IN (design §5.2).
	 *
	 * The hook judges whether a reveal showed the reader anything, and the only
	 * honest currency for that is the rows the collapse actually PAINTS — the same
	 * count `widenTarget` above searches with, read through the same function so
	 * there is one measurement and not a second counting path. It is read through
	 * `widenInputs` for the reason that ref exists: the reveal is dispatched from
	 * an input event long after the render that computed these, and a settle
	 * arrives after the commit that changed them, so the accessor has to read
	 * whatever is CURRENT at the moment it is called rather than close over a
	 * render's values. `rowsRef.current` is the whole list (the window is a slice
	 * of it) and `mounted` is `alignSize`, the size the reader is looking at — the
	 * pair `widen` measures against above.
	 *
	 * No dependency list entries: every input is read through a ref at call time,
	 * and a fresh identity per render would only re-create the hook's `live` ref.
	 */
	const readPaintedRows = useCallback(
		() =>
			paintedRows(rowsRef.current, widenInputs.current.mounted, {
				step: WINDOW_STEP,
				live: widenInputs.current.live,
				openRuns: widenInputs.current.openRuns,
				mode: widenInputs.current.mode,
				snapMaxExtra: WINDOW_ALIGN_MAX_EXTRA,
				completedRunMaxExtra: WINDOW_ALIGN_COMPLETED_RUN_MAX_EXTRA,
			}),
		[],
	);

	// The session identity the paging state belongs to. `hasMore` is folded in
	// because `/clear` replaces the transcript without changing the session, and
	// a latch held against rows that are gone would refuse the first gesture in
	// the transcript that replaced them.
	const {
		slotState,
		requestOlder,
		mayAutoWalk,
		followingTail,
		acknowledgeOwnWrite,
	} = useScrollPaging({
		containerRef,
		sessionKey: sessionId,
		hiddenRows: hidden,
		hasMore: Boolean(transcript.hasMore),
		/*
		 * The end claim's proof, from the one place that holds it — see the prop's
		 * docblock. The default true belongs to callers with no owed page; this
		 * call site passes the value itself.
		 */
		hydrationProven,
		historyReadPending,
		onWiden: widen,
		paintedRows: readPaintedRows,
		onLoadOlder,
		onLoadOlderOutcome,
		olderFailed,
		loadingOlder,
		// The content node exists only once the transcript is non-empty; this is
		// what re-runs the observer effect at that moment.
		contentKey: collapsed ? "empty" : "filled",
		// The MOUNTED count, not the total: a local widen reveals rows the
		// transcript already had, so `rows.length` does not change and the
		// pre-paint correction would skip exactly the reveal that displaces the
		// reader furthest. `visible.length` changes on both growth paths.
		rowCount: visible.length,
	});
	/*
	 * A PRESSED BAR STAYS WHERE IT WAS PRESSED (UX review round 1 on #708, U1).
	 *
	 * The disclosure idiom is "the row you press stays and its content appears
	 * under it". The browser's scroll anchoring gives that everywhere except at
	 * the bottom of this transcript: the scroller is `flex-col-reverse` and pinned
	 * at `scrollTop = 0`, so growing content is added ABOVE the pinned tail and
	 * the pressed bar is pushed off the top (measured: y 272 to -348, the scroller
	 * unmoved, with 620px of opened span between the reader and the bar's label).
	 * A reader following live work sits at the bottom, so that is the most likely
	 * place for the press.
	 *
	 * So the press records where the bar is, and the commit that MOUNTS OR
	 * UNMOUNTS its content moves the scroller by exactly how far the bar moved -
	 * the close needs this as much as the open (QA round 2, QA-2: an un-
	 * compensated close moved the reader about 2.5 span-lengths, the same defect
	 * with the sign flipped). Where the
	 * browser already held the bar (top, mid-transcript) the delta is zero and
	 * this writes nothing, so it cannot fight the anchoring it complements. The
	 * shift is in the reversed axis's own sign (`scrollTop` is negative above the
	 * tail and more negative moves content DOWN - `scroll-paging` states the
	 * contract), and it is one assignment in the layout phase, so no frame paints
	 * the bar off-screen first.
	 *
	 * THE WRITE IS ACKNOWLEDGED TO THE PAGING HOOK, and that is not bookkeeping
	 * (review round 2, MINOR-3). This scroller's `onPointerDown` opened the hook's
	 * drag window when the reader pressed the bar, so the `scroll` event this
	 * write produces would otherwise be read as the reader dragging older-ward:
	 * a correction recorded as input, which arms a paging demand from a click.
	 * `acknowledgeOwnWrite` takes the offsets around the assignment, so a write
	 * the browser clamps to nothing claims nothing either.
	 */
	useLayoutEffect(() => {
		const pressed = pressedBar.current;
		if (pressed === null) return;
		pressedBar.current = null;
		const region = containerRef.current;
		const bar = barFor(pressed.id);
		if (!region || !bar) return;
		const moved = bar.getBoundingClientRect().top - pressed.top;
		if (Math.abs(moved) < 1) return;
		const before = region.scrollTop;
		region.scrollTop += moved;
		acknowledgeOwnWrite(before, region.scrollTop);
	});
	/*
	 * §D7's near path, wired to the rail's ticks: ensure the row is reachable
	 * (load pages, mount the render window), reveal it through the collapse
	 * walk, centre it in the scroller, flash it.
	 *
	 * The window mount is this layer's job because the window is this layer's
	 * state: the model can hold a row the window has not mounted (`slice(total
	 * - windowSize)` mounts from the tail), so the loop's `mount` widens it
	 * exactly as far as the row and no further — the same write the reader's
	 * own scroll makes, one commit wide.
	 */
	const jumpTo = useCallback(
		async (id: string, missCopy: string) => {
			const region = containerRef.current;
			const root =
				region?.querySelector<HTMLElement>("[data-lo-transcript-content]") ??
				null;
			if (!region || !root) return;
			const reachable = await ensureReachable({
				isReachable: () => isRecordReachable(root, id),
				rowDistance: () => {
					const index = rowsRef.current.findIndex(
						(row) => row.record.id === id,
					);
					return index === -1 ? null : rowsRef.current.length - index;
				},
				mount: (distance) => {
					/*
					 * The row's EXACT distance - no margin. The old +16 rows were the
					 * centring era's headroom (Q-2: a page-leading target had nothing
					 * above it to centre against and clamped, -254 px), and the jump
					 * now anchors the row's TOP at the scrollport's top (issue #680),
					 * where the margin buys nothing: for the oldest mounted row the
					 * oldest-end clamp IS the anchor, and the landing's settle
					 * re-measures after this write commits. A viewport-derived margin
					 * comes back only if the rendered matrix shows a case that needs it
					 * (the frames decide, never a fixed row guess).
					 */
					setWindowSize((current) =>
						current >= distance ? current : distance,
					);
				},
				loadOlder: walkLoadOlder,
			});
			if (!reachable) {
				showInfoToast(missCopy);
				return;
			}
			const outcome = await jumpToEntry(root, region, id);
			if (outcome === "missing") showInfoToast(missCopy);
		},
		[containerRef, walkLoadOlder],
	);
	/*
	 * The rail's ticks and the search overlay both land through this near path
	 * (`ensureReachable` above); the two callers differ only in the sentence a
	 * refusal speaks, so that is the argument rather than a second loop.
	 */
	const jumpToCheckpoint = useCallback(
		(id: string) => void jumpTo(id, CHECKPOINT_JUMP_MISS_COPY),
		[jumpTo],
	);
	const jumpToSearchHit = useCallback(
		(id: string) => jumpTo(id, THREAD_SEARCH_JUMP_MISS_COPY),
		[jumpTo],
	);
	/*
	 * The rail's naming warm (D2): `onHover` already fires on the CARD's own
	 * intent-delayed open, not on a fly-over, so each call here is one the
	 * reader looked at — one id per gesture.
	 */
	const handleCheckpointHover = useCallback(
		(id: string | null) => {
			if (id) checkpoints.warm([id]);
		},
		[checkpoints.warm],
	);

	// Measurement hook: one mark per commit of this list. Read with
	// performance.getEntriesByName("lop:transcript:render").
	const commits = useRef(0);
	const [perf, setPerf] = useState("");

	/*
	 * The reader's transcript display mode (issue #756): read as the RAW stored
	 * value and parsed at the one call site that consumes it (`collapsePlan`
	 * below), so a tampered or future token is judged where it is used rather
	 * than trusted on the way in.
	 */
	const transcriptDisplayMode = useUiPreferencesStore(
		(state) => state.transcriptDisplayMode,
	);
	useLayoutEffect(() => {
		commits.current += 1;
		performance.mark("lop:transcript:render", {
			detail: { rows: visible.length, commit: commits.current },
		});
	});
	// Development-only readout of the same numbers, exposed on the DOM so an
	// automated browser (which cannot evaluate script) can read them: list
	// commits, row renders, and the p50/max of the flush measure the stream
	// hook records. Not rendered in production builds.
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		const timer = window.setInterval(() => {
			const flushes = performance
				.getEntriesByName("lop:transcript:flush")
				.map((entry) => entry.duration)
				.sort((a, b) => a - b);
			const p50 = flushes[Math.floor(flushes.length / 2)] ?? 0;
			const max = flushes.at(-1) ?? 0;
			setPerf(
				`commits=${commits.current} rowRenders=${rowRenderCount.current} rows=${visible.length} flushes=${flushes.length} flushP50=${p50.toFixed(2)}ms flushMax=${max.toFixed(2)}ms settledUpdates=${streamDiagnostics.settledAssistantUpdate} seedDeltasWithheld=${streamDiagnostics.seededDeltaWithheld} staleUpdateFrameDropped=${streamDiagnostics.staleUpdateFrameDropped} idlessFrameRefused=${streamDiagnostics.idlessFrameRefused}`,
			);
		}, 1000);
		return () => window.clearInterval(timer);
	}, [visible.length]);

	/*
	 * What this view PAINTS: the pane's own line, unless a caller handed one in.
	 * `undefined` is "no override" and `null` is "paint none", so the test is
	 * against `undefined` rather than against truthiness — the child reader is the
	 * one caller that supplies either, and it is the one case the derivation above
	 * cannot answer (see the prop's docstring). No memo: this is a choice between
	 * two values that are already computed, and only `paneWorking` costs anything.
	 */
	const working = workingLine === undefined ? paneWorking : workingLine;
	/* The widen's paint count reads these (see `widenInputs`): the collapse's own
	 * liveness rule, stated once here and reused by the plan below, the mounted
	 * size the widen measures from, and the reader's display mode — the same value
	 * the plan below is handed, so the step cannot measure a paint the reader is not
	 * looking at (M1/Q1). */
	widenInputs.current = {
		live: paneIsLive,
		openRuns,
		mode: parseTranscriptDisplayMode(transcriptDisplayMode),
		mounted: alignSize,
	};

	/*
	 * THE READER'S FOCUS, tracked for the collapse's own guard (the model's
	 * `focusHold`): the record id of the row holding `document.activeElement`
	 * inside the scroller. Focus EVENTS rather than a render-time DOM read, so
	 * the value is React state and a focus move is a re-render the plan can
	 * answer; `null` means "focus is not in a row". A CLICK IS ALSO A FOCUS
	 * (agent review round 1, NIT-1): in Chromium, pressing a control focuses
	 * it, so a pointer reader who just clicked a row's button holds that run
	 * open exactly as a keyboard reader does — the guard makes them the same
	 * promise (a collapse never unmounts the focused row) and releases it the
	 * same way, when focus moves on. The bar is excluded deliberately: it
	 * carries `data-record-id` too (its anchor row's), and a reader focusing a
	 * bar's button must not hold that bar's run open — the bar is not a row
	 * being hidden, it IS the collapse.
	 */
	const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null);
	const handleTranscriptFocus = useCallback(
		(event: FocusEvent<HTMLDivElement>) => {
			const row = (event.target as Element).closest("[data-record-id]");
			setFocusedRecordId(
				row === null || row.closest("[data-turn-summary]") !== null
					? null
					: row.getAttribute("data-record-id"),
			);
		},
		[],
	);
	const handleTranscriptBlur = useCallback(
		(event: FocusEvent<HTMLDivElement>) => {
			const next = event.relatedTarget as Node | null;
			if (next === null || !event.currentTarget.contains(next)) {
				setFocusedRecordId(null);
			}
		},
		[],
	);

	/*
	 * THE BLANK-SPACE CLICK, AND ITS GUARDS (issue #661).
	 *
	 * A press on empty transcript space focuses nowhere today, so the next
	 * keystroke reaches nobody until the reader clicks the box - and the box is
	 * the only sensible target for a press that landed on no control. The policy
	 * is `transcript-focus.ts`'s; what lives here is the DOM half: the press's
	 * origin and the selection state BEFORE the browser collapses it. That
	 * recording is the whole reason the handlers are on the container rather
	 * than one `onClick`: by click time a press-time selection is already gone,
	 * and a click carries no memory of where the pointer came from.
	 *
	 * The recording is deliberately silent - no preventDefault, no focus call,
	 * no state that re-renders - so every existing handler receives the reader's
	 * gesture exactly as it did.
	 */
	const pressRef = useRef<{
		x: number;
		y: number;
		/** Whether a transcript selection existed before the browser collapsed it. */
		hadSelection: boolean;
		/** Whether the press began on a control (see `clickTargetIsControl`). */
		onControl: boolean;
	} | null>(null);
	/** When the last wheel notch arrived; the click's own scroll-gesture read. */
	const wheelAtRef = useRef(Number.NEGATIVE_INFINITY);

	/*
	 * Whether non-collapsed text is selected INSIDE this transcript. Scoped to
	 * the container because a selection elsewhere - the sidebar, the composer,
	 * another pane - is not the gesture this guard exists for, and because a
	 * selection in the transcript is the one a click here is about to
	 * collapse.
	 */
	const selectionInsideTranscript = useCallback((): boolean => {
		const selection = window.getSelection();
		const region = containerRef.current;
		if (!selection || selection.isCollapsed || !region) return false;
		const node = selection.anchorNode ?? selection.focusNode;
		return node !== null && region.contains(node);
	}, [containerRef]);

	const handleTranscriptPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			/*
			 * Primary presses only: a right- or middle-click is not the gesture
			 * this rule answers, and it must not leave a recording behind for a
			 * click that never comes.
			 */
			if (event.button !== 0) {
				pressRef.current = null;
				return;
			}
			pressRef.current = {
				x: event.clientX,
				y: event.clientY,
				hadSelection: selectionInsideTranscript(),
				onControl: clickTargetIsControl(event.target),
			};
		},
		[selectionInsideTranscript],
	);

	const handleTranscriptWheel = useCallback(() => {
		wheelAtRef.current = performance.now();
	}, []);

	const handleTranscriptClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const press = pressRef.current;
			pressRef.current = null;
			/*
			 * A press another handler already answered is left alone:
			 * `defaultPrevented` is the "someone got here first" tell the
			 * palette shortcut documents, and the surface that consumed the
			 * gesture owns it.
			 */
			if (event.defaultPrevented) return;
			const verdict = transcriptClickVerdict({
				controlPress:
					clickTargetIsControl(event.target) || press?.onControl === true,
				modalOpen: modalIsOpen(document),
				pressHadSelection: press?.hadSelection === true,
				selectionNotCollapsed: selectionInsideTranscript(),
				shiftExtends: event.shiftKey,
				dragged:
					press !== null &&
					Math.hypot(event.clientX - press.x, event.clientY - press.y) >
						TRANSCRIPT_DRAG_SLOP_PX,
				scrolledRecently: wheelWithinGuard(
					wheelAtRef.current,
					performance.now(),
				),
			});
			/*
			 * The composer's own door (`composer-field.ts`), the hand-off the
			 * Quote toolkit already uses from this component's tree: it is the
			 * single place focus is given - the ask gate's "the user took the
			 * box" flag reset included - and a no-op when no composer is
			 * mounted (a story, a pane without one).
			 *
			 * THE TRADE, named because it is the one a reader hits: focus leaving
			 * for the composer means the transcript's own KEYBOARD paging (Space,
			 * PageUp, the arrows - the keys `use-scroll-paging.ts` listens for)
			 * now lands in the textarea, so a reader who scrolls by keyboard
			 * after a click types spaces instead. The scroller stays reachable
			 * with Tab/F6, and the alternative - leaving the caret on the
			 * scroller - is the "my keystrokes go nowhere" state #661 exists to
			 * remove (design round 2, U2). The flag reset is the door's own
			 * contract read literally: a hand-off makes the box ours again, so a
			 * gate advancing on its own schedule may claim focus for its next
			 * question, the same as after a press into the empty box.
			 */
			if (verdict === "focus") focusComposer();
		},
		[selectionInsideTranscript],
	);

	/*
	 * THE TURN COLLAPSE (§4.5), computed beside the fold groups and the feet: one
	 * pure plan (`turn-collapse-model.ts`) over the same `visible` rows the list
	 * renders, so a bar can only ever summarise rows that are loaded and on
	 * screen. `live` is the liveness the working line and the folds read; the
	 * model applies it to the newest run's IN-FLIGHT CYCLE only (the rows after its
	 * last settled close), so a finished turn above the reader's place still
	 * collapses while a later turn streams, and a sequence the reader already saw
	 * condense stays condensed when a wake / peer message / job result starts the
	 * next cycle in the same run (operator report, 2026-10-01).
	 */
	const collapseInputs = useMemo(
		() => ({
			live: working !== null || gate !== null,
			focusHold: focusedRecordId,
			openRuns,
			/*
			 * THE READER'S DISPLAY MODE (issue #756), read HERE and parsed on the way
			 * in: the store rehydrates past its setters, so a token this build does
			 * not know must land on the default rather than reach the partition.
			 * `parseTranscriptDisplayMode` is the one judge of that (the read-side
			 * pattern `parseSidebarView` sets one surface over).
			 */
			mode: parseTranscriptDisplayMode(transcriptDisplayMode),
			/*
			 * The server's facts (see the prop): in the SAME object the plan and its
			 * input signature both read, so the bar's text and the memo key that
			 * decides when it is recomputed cannot disagree about what the facts are.
			 * `undefined` rather than an empty map for "no facts", so an absent
			 * `openFrame` leaves the option exactly as absent as it was.
			 */
			runFacts: openFrame?.runs,
			/*
			 * WHETHER THIS READER HIDES CROSS-SESSION ROWS (agent review round 1, F2).
			 * The plan's rows are already filtered by `visibleRecords(…, hide)` above;
			 * this tells the model that the SERVER's totals count rows this reader does
			 * not have on screen, so a fact's count cannot be taken as-is and, where it
			 * cannot be split, must not be taken at all.
			 */
			hideCrossSession: hide,
		}),
		[
			focusedRecordId,
			gate,
			hide,
			openFrame,
			openRuns,
			transcriptDisplayMode,
			working,
		],
	);
	/*
	 * THE PLAN'S INPUT SIGNATURE (UI perf audit P1; PR-6). The rows half is the
	 * one computed above and shared with the feet; this adds the options half.
	 * Keying the plan on the pair is what makes it ONE PLAN PER STRUCTURAL
	 * PASS: a token that only lengthens an answer's text moves neither half, so
	 * it buys no plan at all. The join itself lives in the model
	 * (`collapsePlanInputKey`) rather than being re-spelled here, so the two
	 * halves cannot drift apart.
	 */
	const collapseKey = useMemo(
		() => collapsePlanInputKey(rowsKey, collapseInputs),
		[collapseInputs, rowsKey],
	);
	/*
	 * `live` is the newest run's UNSETTLEDNESS, and it has two halves here,
	 * not one (design review round 1, D3): the working line covers a turn
	 * being written, and the READER GATE covers a turn parked on a question -
	 * the working line deliberately stands down while the question dock holds
	 * the stage, so a rule that read only `working` condensed a parked turn
	 * and un-condensed it when the call resumed, with no reader action.
	 *
	 * `focusHold`/`openRuns` are the focus guard's inputs (see
	 * `focusedRecordId` above): a run that would unmount the row the reader's
	 * keyboard focus is in stands open until the focus moves on. Both travel
	 * through `collapseInputs` and are in `collapseKey`.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt from `visible`/`collapseInputs` only when the input signature above moves; a `visible` dependency would re-plan the whole window on every streamed token, which is the per-token cost this memo exists to remove.
	const collapse = useMemo(
		() => collapsePlan(visible, collapseInputs),
		[collapseKey],
	);
	/*
	 * THE WALK'S CUT-RUN KEY (UI perf audit A3, corrected by review round 1 R1).
	 * The completion walk below asks "is there a run whose bar is PAINTED and
	 * whose opening user row is not in the STORE?" — and the `collapsePlan` right
	 * above already answers the PAINTED half. That is the plan the list paints
	 * from, so the walk reads its answer instead of building a second plan over
	 * the whole store on every transcript update.
	 *
	 * THE PLAN IS OVER `visible`, THOUGH, SO IT CANNOT ANSWER THE STORE HALF.
	 * R1's counterexample: a settled run taller than the snap's 720-row allowance
	 * keeps the ordinary snap, so the raw edge sits inside it and the plan reads
	 * `opensWithUserRow: false` while the store holds the run whole — a "cut" the
	 * walk can never resolve, because a prepend shifts the edge and the run's head
	 * equally. `alignWalkRunKeyConfirmed` closes that: the plan's key stands only
	 * when the store's own run under the same edge is head-cut and is the same run.
	 *
	 * KEYING THE EFFECT ON THIS STRING, NOT ON `rows`, IS THE PERF FIX: a streaming
	 * flush moves `rows` on every frame, so the effect used to re-run — and pay a
	 * whole-store `collapsePlan` — on each one even when no run it can act on had
	 * changed. The store confirmation costs one `windowTopRun` per render, and only
	 * while a cut bar is actually painted (the plan key short-circuits to null
	 * otherwise), which is exactly when the walk has something to decide.
	 */
	const alignWalkKey = useMemo(
		() => alignWalkRunKeyConfirmed(collapse, storeTopRun, openRuns),
		[collapse, storeTopRun, openRuns],
	);
	/*
	 * The walk's clock wake (agent review round 1, R2): `mayAutoWalk` is a stable
	 * callback whose VALUE moves with time alone, so a walk waiting only on the
	 * input debounce has nothing to re-run it. Bumping this tick from a one-shot
	 * timer re-runs the effect exactly once when the debounce has had time to
	 * expire; see the arm in the effect below.
	 */
	const [walkClockTick, setWalkClockTick] = useState(0);

	/*
	 * THE COMPLETION WALK (loader-continuity 1b, design spec section 7): a
	 * settled turn finishes its own condensation instead of waiting for the
	 * reader to scroll the head in page by page.
	 *
	 * WHEN the edge sits inside a run whose head the FETCHED rows cut off, the
	 * snap has no boundary to land on and the bar can only describe the loaded
	 * span — no real action count, no `Took` clause. The walk fetches that head,
	 * one page per invocation, for as long as the decision's clauses hold: the
	 * run is still cut AND the backend has more, no page is in flight, every
	 * page so far applied, and the reader is following the tail with no recent
	 * input (`mayAutoWalk` — the hook's own geometry and input clock, never a
	 * re-derivation here).
	 *
	 * WHY ONE PAGE PER INVOCATION rather than a loop, and why the effect's own
	 * dependency list is the walk's clock: a landing flips `loadingOlder` and, when
	 * it completes the run, moves `alignWalkKey` to null, so the effect re-runs by
	 * itself once per page — the same shape the flat two-page budget had, with the
	 * pages counted instead of capped at two. A loop inside the effect would walk
	 * the whole bound in one commit and hand the reader twelve pages of history as
	 * one uninterruptible act.
	 *
	 * WHY IT STOPS RATHER THAN RETRIES on a non-`applied` outcome: a failure
	 * already owns the failed row and the automatic retry budget (rule G), and a
	 * walk that kept asking through a failure is the operator's "keeps loading in
	 * chunks" loop. `halted` is the walk's own memory of that, cleared with the
	 * rest of it on a session change — the reader's next act re-arms everything.
	 *
	 * THE DEPENDENCIES ARE THE KEY AND THE DECISION'S OWN INPUTS (UI perf audit
	 * A3). `rows` and `alignSize` used to sit here as re-run triggers; the key now
	 * carries everything either of them stood for — it is rebuilt from the plan,
	 * which is built over `visible` (so a window move is already in it) — and
	 * `loadingOlder` is the once-per-page clock the walk actually advances on.
	 * Listing `paneIsLive`/`openRuns` separately would be redundant for the same
	 * reason: the plan folds both.
	 *
	 * `walkClockTick` is the same CLASS of dependency the old `alignSize` was: a
	 * RE-RUN TRIGGER, not a value this body reads. `mayAutoWalk` moves with time
	 * while its identity does not, so without a dependency that changes there is
	 * nothing to re-decide a walk that is only waiting on the input debounce (the
	 * arm below explains why that cannot wait for an unrelated transition).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `walkClockTick` is a re-run trigger (the settle wake), not a value this body reads; see the note above
	useEffect(() => {
		/*
		 * WHOSE WALK THIS IS (1b/B). The run with a condensed, head-cut bar owns the
		 * budget, and moving to a different such run starts a fresh one — that is what
		 * lets a later settled turn complete its own bar in a long-lived conversation.
		 * The same run keeps its spent budget, so no run is walked twice for the same
		 * content. `widenInputs` is the render's own collapse inputs (the same ones
		 * the widen and the plan read), so "condensed" here means the bar the reader
		 * is looking at.
		 */
		const state = alignWalkStateFor(alignWalk.current, alignWalkKey);
		const mayWalk = mayAutoWalk();
		const decision = alignWalkDecision(state.spent, {
			hasMore: Boolean(transcript.hasMore),
			loadingOlder,
			headCut: state.key !== null,
			mayWalk,
			halted: state.halted,
		});
		alignWalk.current = { ...state, spent: decision.spent };
		if (!decision.fetch) {
			/*
			 * THE CLOCK IS NOT A DEPENDENCY (agent review round 1, R2). `mayAutoWalk`
			 * reports `performance.now() - lastInputAt >= SETTLE_MS`, so its VALUE
			 * moves with time alone while its identity (the dependency) does not. A
			 * walk that is complete but for the settle would therefore never be
			 * re-decided: the old dependency list re-ran on every streaming commit
			 * (`rows` was fresh per flush), and this one keys on the run instead. So
			 * the walk wakes ITSELF: one one-shot timer, armed only while a cut run is
			 * painted, more is available, no page is in flight, the budget is unspent
			 * and the debounce is the only missing clause — exactly the state that
			 * would otherwise wait for an unrelated transition. The tick re-runs this
			 * effect; a real transition re-runs it first and the cleanup drops the
			 * timer.
			 */
			const clockOnlyRefusal =
				state.key !== null &&
				Boolean(transcript.hasMore) &&
				!loadingOlder &&
				!state.halted &&
				!mayWalk &&
				/*
				 * …AND THE TAIL, not just the clock (agent review round 2, R2-1).
				 * `mayWalk` is false for TWO reasons — the debounce is still running OR the
				 * reader is off the tail — and only the first is a clock this wake can
				 * change. Arming on `!mayWalk` alone re-armed the timer forever for an
				 * off-tail reader while a cut bar was painted: nothing would ever satisfy
				 * it, and `spent` never grew (no fetch), so the loop could not even bound
				 * itself. Off the tail the walk waits for a real transition, as it did
				 * before this wake existed.
				 */
				followingTail() &&
				alignWalk.current.spent < ALIGN_WALK_MAX_PAGES;
			if (!clockOnlyRefusal) return;
			const wake = window.setTimeout(
				() => setWalkClockTick((tick) => tick + 1),
				SETTLE_MS,
			);
			return () => window.clearTimeout(wake);
		}
		const dispatchedFor = state.key;
		void walkLoadOlder().then((applied) => {
			/*
			 * A walk page that did not apply halts the walk. `applied` is the boolean
			 * form of the SAME single-flight ask the reader's own pump uses
			 * (`createOlderLoader`), so the walk and a gesture can never be waiting on
			 * two pages at once.
			 *
			 * THE KEY IS RE-CHECKED FIRST (agent review round 1, R1-2). A page can
			 * resolve after the window has moved to a DIFFERENT cut run, and halting
			 * whichever run is current then refuses that run's walk for its whole life
			 * although none of its own pages failed — its bar would stay partial with
			 * no reader-visible reason. Only the run that spent the ask may be halted
			 * by its outcome.
			 */
			if (!applied && alignWalk.current.key === dispatchedFor) {
				alignWalk.current = { ...alignWalk.current, halted: true };
			}
		});
	}, [
		alignWalkKey,
		loadingOlder,
		transcript.hasMore,
		walkLoadOlder,
		mayAutoWalk,
		followingTail,
		walkClockTick,
	]);

	/*
	 * THE SETTLE ANNOUNCEMENT (polite). A bar appearing is a transition the
	 * reader did not initiate — rows readable a moment ago are unmounted — and
	 * nothing on screen says so out loud. ONE `<output aria-live="polite">`
	 * states each newly appeared bar in the bar's own words. Two skips keep it
	 * about SETTLES rather than loads: the first pass that has any runs
	 * initialises without announcing (opening a conversation is a load), and a
	 * session switch re-arms that skip (the transcript component outlives a
	 * conversation switch). A reader's own press never reaches here: it changes
	 * the reader's expansion, not which runs collapse.
	 *
	 * A WINDOW REVEAL IS NOT A SETTLE EITHER (agent review round 1, MAJOR-1).
	 * The window only ever GROWS, and every step of that growth presents bars
	 * for runs the previous pass never held — a scroll-up widen, the open's
	 * snap, a jump's mount. A set-difference against the previous pass's keys
	 * announced every one of them ("ten announcements on a widen, zero
	 * settles", the reviewer's probe-widen-announce.test.mjs), while nothing
	 * the reader could see was unmounted: those runs were folded before the
	 * reader ever saw them unfold. So an utterance must also find the run
	 * PRESENT in the previous pass — sharing at least one row with it — which
	 * is exactly "its rows were on screen a moment ago". The row-id test also
	 * bridges the live→settled KEY JUMP: a run being written keys on its last
	 * row and a settled one on its answer, but its rows are the same rows.
	 * Window-entered bars are absorbed into `keys` silently, so a later reveal
	 * of the same run stays quiet.
	 */
	const [condenseAnnouncement, setCondenseAnnouncement] = useState("");
	useEffect(() => {
		/*
		 * The announcement's unit is the SEGMENT (a run can now hold several bars),
		 * keyed by the same key the reader's expansion uses. Still ONE `<output>` for
		 * the whole list: several bars per run make a live region per bar the
		 * obvious wrong turn, and each new bar simply adds its sentence to the one.
		 */
		const collapsed = collapse.runs.flatMap((run) =>
			run.segments.filter((segment) => segment.collapsed),
		);
		const rowIds = planRowIds(collapse.runs);
		const previous = announcedPlan.current;
		if (previous === null) {
			/*
			 * The first pass that has RUNS initialises without announcing: its
			 * bars are what the conversation loaded with, not a settle. A pass
			 * with no runs at all - a held or empty pane - leaves the
			 * initialisation for the first pass that paints rows.
			 */
			if (collapse.runs.length > 0) {
				announcedPlan.current = {
					keys: new Set(collapsed.map((segment) => segment.key)),
					rowIds,
				};
			}
			return;
		}
		const appeared = collapsed.filter(
			(segment) =>
				!previous.keys.has(segment.key) &&
				segment.segmentIds.some((id) => previous.rowIds.has(id)),
		);
		announcedPlan.current = {
			keys: new Set([
				...previous.keys,
				...collapsed.map((segment) => segment.key),
			]),
			rowIds,
		};
		if (appeared.length === 0) return;
		setCondenseAnnouncement(appeared.map(condenseSentence).join(" "));
	}, [collapse]);

	/*
	 * THE LIST, RE-EXPRESSED AS ENTRIES. Every group renders exactly as today,
	 * with one exception: a collapsed SEGMENT's hidden groups move INSIDE its bar
	 * (so they are merely unmounted while collapsed - the fold's own contract)
	 * and the bar takes the slot and gap of the segment's FIRST hidden group.
	 * Pinned rows, the elected answer and the trailing statements keep their
	 * places, so a collapse never reorders a visible row.
	 *
	 * THE WALK CONSUMES GROUPS STRICTLY IN ORDER, which is why a pinned row between
	 * two hidden spans can no longer land after a bar that precedes it: each span
	 * pushes its own bar the moment its first group is reached, and the pinned row
	 * is pushed where the walk finds it. Sorting afterwards could not express that
	 * (the two orders differ per expansion state); the partition is what fixes it.
	 */
	/*
	 * KEYED ON `visible`, DELIBERATELY, unlike the feet (UI perf audit P4; PR-6).
	 * An entry holds the GROUPS it renders, and a group holds the rows - so the
	 * answer's new text has to travel through this memo to reach the DOM. The
	 * plan it consumes is stable across a text token; the entries are not, and
	 * a signature key here would freeze the transcript's text. Its count is
	 * reported, not moved.
	 */
	const chatEntries = useMemo(() => {
		dbgChatEntriesRebuilds.count += 1;
		const indexOf = new Map<string, number>();
		visible.forEach((row, index) => indexOf.set(row.record.id, index));

		type ChatEntry =
			| {
					kind: "group";
					group: SectionGroup;
					suppressClosingLine: boolean;
					/**
					 * Whether this group renders below a bar of its run. The row beneath
					 * the bar's rule re-tiers at the render pass (`atItemTierGroup`); this
					 * flag is the walk's half of that decision, set where the bar is
					 * placed.
					 */
					afterBar?: boolean;
			  }
			| {
					kind: "bar";
					segment: SegmentPlan;
					/** The whole run's ids: the bar's long-standing `data-run-ids`. */
					runIds: readonly string[];
					children: SectionGroup[];
					/**
					 * The segment's pictures, computed HERE because the bar's children
					 * are unmounted while it is collapsed and these are what they would
					 * have shown. The segment's own rows rather than the whole run: a bar
					 * shows exactly what it hides, and a pinned row that stays on screen
					 * keeps drawing its own media.
					 */
					images: TranscriptImage[];
			  };

		const entries: ChatEntry[] = [];
		let next = 0;
		for (const plan of collapse.runs) {
			/*
			 * Runs and groups both partition `visible`, so this walk consumes each
			 * group exactly once, in order.
			 */
			const groups: SectionGroup[] = [];
			while (next < rowGroups.length) {
				const group = rowGroups[next];
				const start = indexOf.get(
					group.kind === "run" ? group.id : group.row.record.id,
				);
				if (start === undefined || start > plan.run.endIndex) break;
				groups.push(group);
				next += 1;
			}
			if (!plan.collapses) {
				for (const group of groups) {
					entries.push({
						kind: "group",
						group,
						suppressClosingLine: false,
					});
				}
				continue;
			}
			/* Which segment (index) each hidden row belongs to. */
			const segmentOf = new Map<string, number>();
			plan.segments.forEach((segment, index) => {
				for (const id of segment.segmentIds) segmentOf.set(id, index);
			});
			/*
			 * The turn's ONE stamp lives on the bar that carries it, and that bar
			 * withholds the answer's own closing line (`stampTs` is set only when
			 * that bar is the run's sole pre-answer segment, so the totals it
			 * states are the turn's). Any other shape keeps the foot: it is where
			 * the turn's totals and stamp go when the bars state only parts.
			 */
			const footWithheld = plan.segments.some(
				(segment) => segment.collapsed && segment.stampTs !== null,
			);
			const children = new Map<number, SectionGroup[]>();
			let afterBar = false;
			for (const group of groups) {
				/*
				 * A GROUP IS HIDDEN ONLY IF EVERY ROW OF IT IS IN ONE SEGMENT (agent
				 * review round 1 on #708, R1-5; the pre-segments code checked `every`).
				 * A segment is a maximal contiguous span and a run group is a run of
				 * contiguous tool rows, so a group cannot straddle a boundary today - but
				 * that invariant lives in two other files, and if a boundary is ever
				 * drawn mid-group, reading only the FIRST row would swallow the group's
				 * visible rows into the bar without a sound. A mixed group renders in
				 * place instead: visible rows stay visible.
				 */
				const groupRows = group.kind === "run" ? group.rows : [group.row];
				const first = segmentOf.get(groupRows[0].record.id);
				const index = groupRows.every(
					(member) => segmentOf.get(member.record.id) === first,
				)
					? first
					: undefined;
				const segment = index === undefined ? null : plan.segments[index];
				if (segment !== null && index !== undefined && segment.collapsed) {
					let held = children.get(index);
					if (held === undefined) {
						held = [];
						children.set(index, held);
						/* The bar sits where the segment's first hidden group did. */
						entries.push({
							kind: "bar",
							segment,
							runIds: plan.recordIds,
							children: held,
							images: foldImages(segment.rows),
						});
						afterBar = true;
					}
					held.push(group);
					continue;
				}
				/*
				 * A hidden group of a segment the focus hold stood open renders in
				 * place, exactly as it did before this pass could collapse it.
				 */
				entries.push({
					kind: "group",
					group,
					suppressClosingLine: footWithheld && segment === null,
					afterBar,
				});
			}
		}
		return entries;
	}, [visible, rowGroups, collapse]);

	/**
	 * One group as the list has always rendered it — a folded run of calls, or a
	 * single row — with the turn's closing line (the foot numbers AND the stamp)
	 * withheld from a run that carries a bar: the bar states both, one per turn
	 * (`feet.get(...) ?? null` and the caption block share one switch).
	 */
	const renderGroup = (
		group: SectionGroup,
		suppressClosingLine: boolean,
		soleImageGroup = false,
	) =>
		group.kind === "run" ? (
			<TraceFold
				key={group.id}
				/*
				 * The fold carries its first row's gap (a turn's 32px when
				 * the run opens the turn), and every row inside it sits at
				 * the trace tier - the fold holds the WHOLE run, D8.
				 */
				className={GAP[group.gap][isSmallView ? 1 : 0]}
				recordIds={group.rows.map((row) => row.record.id)}
				summary={group.summary}
				actionCount={group.rows.length}
				span={group.span}
				live={group.live}
				/*
				 * THE READER'S OPEN STATE, held by the conversation rather than by
				 * the fold (operator report, 2026-09-27): the fold's React key is
				 * its first row, and the render window's leading edge walks through
				 * a run as rows arrive, which remounts the fold - state kept on the
				 * instance cannot survive that, and the fold re-collapsed under the
				 * reader. The registry answers for the fold's CURRENT id set and
				 * migrates with it.
				 */
				open={foldOpenOf(
					foldOpen.entries,
					group.rows.map((row) => row.record.id),
				)}
				onOpenChange={(next) =>
					setFoldOpenFor(
						group.rows.map((row) => row.record.id),
						next,
					)
				}
				/*
				 * The run's images, while the rows that draw them are unmounted.
				 * Rendered only while the fold is condensed, and not passed at all
				 * for a run that produced none - the overwhelmingly common case, and
				 * the reason a group with no images is byte-for-byte the group it was.
				 */
				condensedMedia={
					group.images.length > 0
						? (expand: () => void) => (
								<FoldMedia
									images={group.images}
									scope={mediaScope}
									onRevealMore={expand}
									uncapped={soleImageGroup}
								/>
							)
						: undefined
				}
				/*
				 * The count travels beside the node: the header prints it as text,
				 * because a 64px tile cannot carry a label and the count is what the
				 * strip's own accessible name already says. `soleImageGroup` is the
				 * bar's own children's case, with two effects, both keyed to the same
				 * fact - this group IS the span's whole image story:
				 *
				 * - the clause drops (D3/U6): when its count would repeat the bar's
				 *   number one line above, the BAR keeps the aggregate and the group
				 *   omits the duplicate; two image-bearing groups make the numbers
				 *   differ, and then each level states its own;
				 * - the strip uncaps (U8): the press that opened the bar asked for
				 *   `the rest`, so this group's strip shows its whole set rather than
				 *   charging a second press for pictures the reader already asked for.
				 */
				mediaCount={soleImageGroup ? 0 : group.images.length}
			>
				{group.rows.map((row, index) => (
					<TranscriptRow
						key={row.record.id}
						row={index === 0 ? atTraceTier(row) : row}
						isSmallView={isSmallView}
						scope={mediaScope}
						conversationId={conversationId}
						labelPending={
							row.record.kind === "tool" &&
							labelPending?.has(row.record.toolCallId) === true
						}
						labelHoldLate={labelHoldLate === true}
						labelMarked={
							row.record.kind === "tool" &&
							labelMarked?.has(row.record.toolCallId) === true
						}
						foot={
							suppressClosingLine ? null : (feet.get(row.record.id) ?? null)
						}
						closingLineSuppressed={suppressClosingLine}
						undelivered={undelivered}
						answerRail={answerRail}
						stopping={stopping === true}
						onInterruptTurn={onInterruptTurn}
					/>
				))}
			</TraceFold>
		) : (
			<TranscriptRow
				key={group.row.record.id}
				row={group.row}
				isSmallView={isSmallView}
				scope={mediaScope}
				conversationId={conversationId}
				labelPending={
					group.row.record.kind === "tool" &&
					labelPending?.has(group.row.record.toolCallId) === true
				}
				labelHoldLate={labelHoldLate === true}
				labelMarked={
					group.row.record.kind === "tool" &&
					labelMarked?.has(group.row.record.toolCallId) === true
				}
				foot={
					suppressClosingLine ? null : (feet.get(group.row.record.id) ?? null)
				}
				closingLineSuppressed={suppressClosingLine}
				undelivered={undelivered}
				answerRail={answerRail}
				stopping={stopping === true}
				onInterruptTurn={onInterruptTurn}
			/>
		);

	return (
		/*
		 * The pane COLUMN, and the scroll box is one child of it.
		 *
		 * Why the extra level: the stale caption has to sit OUTSIDE the scrolling
		 * content (design review round 1, D1). It used to be the first child of the
		 * measured content box inside a bottom-anchored `flex-col-reverse` scroller,
		 * which put it at the visual TOP of the content - measured on a 36-row stale
		 * transcript at 1280x600, its rect was top -2028 in a 560px viewport, i.e.
		 * 2028px above the fold and unreachable without scrolling the whole
		 * conversation. The cache is written on unmount, so it only ever holds
		 * conversations taller than the pane, which makes that the COMMON case
		 * rather than an edge, and the affordance M2 exists for (the pane is
		 * distinguishable by being wrong) was invisible exactly when it was needed.
		 *
		 * `@container/chatcol` moves here with it: the caption uses the shared
		 * measure, whose variants are written against this container, and a caption
		 * that sat outside its own container would simply not see them.
		 *
		 * `collapsed` still owns the pane's height, one level down, and the wrapper
		 * collapses with it so a collapsed pane cannot leave the caption behind as
		 * a row of its own.
		 */
		/*
		 * `relative` is what the floating search overlay positions against: its slot
		 * is this column's top-right corner (`thread-search-overlay.tsx`), and an
		 * absolutely positioned child resolves against the nearest positioned
		 * ancestor — which this box was not, so the panel would have been placed
		 * against the page and floated over the chat header. The class is inert for
		 * every other reader of this column (no offsets, no z-index, same box).
		 */
		<div
			className={cn(
				CHAT_COLUMN_CONTAINER,
				collapsed
					? "relative h-0 grow-0 overflow-hidden"
					: "relative flex min-h-0 grow flex-col",
			)}
		>
			{stale && !holdPlaceholder && (
				/*
				 * Pinned to the pane's top edge, in the flow rather than over it: it
				 * takes its own row and no row of the conversation is ever painted
				 * under it. `shrink-0` so a tall neighbour cannot squeeze it away, and
				 * the same horizontal inset as the scroller's own padding so the two
				 * share a centre.
				 *
				 * AND IT STANDS DOWN WHILE THE PANE HOLDS. `stale` is still true for
				 * a cached paint whose page is owed - that is the flag the hold reads
				 * - and while the hold is up NOTHING of the cached paint is on screen
				 * (the rows are gated out below), so a caption describing it would be
				 * the pane talking about a view nobody can see. The two go away
				 * together, which is the rule this element was introduced under; the
				 * hold is just the case where "together" means "neither yet".
				 */
				<p
					className={cn(
						"shrink-0 px-4 pt-4 text-ink-dim text-meta",
						CHAT_MEASURE,
					)}
				>
					Showing the last saved view — checking for newer messages.
				</p>
			)}
			{/*
			 * §D5's placement: the rail is a SIBLING of the scroll box, not a child
			 * of it — an absolutely-positioned child of an `overflow: auto` box
			 * scrolls away with the content it is supposed to index. This wrapper
			 * exists to give the two a box whose height IS the scroller's: the
			 * column also holds the stale-conversation caption above (when it
			 * paints), and `inset-y-0` against the column would draw the rail over
			 * that caption. Layout is the wrapper's only job: it takes the
			 * scroller's place in the column's flex (`min-h-0 grow`) and hands it
			 * straight back, so the scroll box's own box, its reserved gutter and
			 * the bottom anchor all behave exactly as before.
			 */}
			<div className={cn("relative flex min-h-0 grow flex-col")}>
				{/*
				 * THE RAIL COMES FIRST IN THE DOM (UX round 1, U3): it is the
				 * transcript's navigation affordance, and it used to sit after
				 * the scroller, so reaching its ticks meant tabbing through
				 * every focusable row (46 Tabs from the composer, measured).
				 * The rail is absolutely positioned, so DOM order costs no
				 * pixels - the column's first tab stop is the rail now. It DOES
				 * cost paint order, which the rail's own wrapper answers: the rail
				 * carries `z-10` because the scroller below it is positioned too
				 * (`relative` + `translateZ(0)`), and without it the scroller's box
				 * would take every pointer aimed at a tick (the scene's hover legs
				 * went dead on this change until the rail carried z; measured). Its
				 * props carry the one fact the component owns and the hook
				 * does not - which conversation, so a session switch drops any
				 * open card - plus the two callbacks; `building` is the hook's
				 * index state, not the rail's to derive.
				 */}
				<CheckpointRail
					sessionId={sessionId ?? ""}
					checkpoints={checkpoints.checkpoints}
					building={checkpoints.building}
					loadedIds={loadedCheckpointIds}
					activeId={activeCheckpointId}
					/*
					 * The callback itself, not an inline arrow (UI perf audit A6): the rail
					 * is `memo`ised, and a fresh arrow each render would break the prop
					 * comparison on its own. `jumpToCheckpoint` is already a `useCallback`
					 * that returns void, so the wrapper bought nothing.
					 */
					onJump={jumpToCheckpoint}
					onHover={handleCheckpointHover}
				/>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: the click is a pointer gesture that hands the caret to the composer, which the keyboard already reaches with Tab; the transcript's own keys are its paging keys (Home/PageUp/ArrowUp), and adding a key that moved focus would take them away. */}
				<div
					ref={containerRef}
					data-lo-canonical-transcript={true}
					/*
					 * The transcript is a tab stop, and that is an accessibility fix rather
					 * than a nicety.
					 *
					 * Paging responds to Home/PageUp/ArrowUp through a `keydown` listener on
					 * THIS element, but a plain scrolling div is not in the tab order, so
					 * nothing a keyboard reader could do would deliver those keys. Measured
					 * on the previous head: 40 Tab presses never entered the transcript, and
					 * in the state a reader arrives in it contained zero focusable elements
					 * — so with the click-only button gone, older history was unreachable
					 * without a pointer. A scrollable region is independently required to be
					 * keyboard-operable (WCAG 2.1.1); this satisfies both at once.
					 *
					 * `role="log"` with a name is what makes the stop explicable when it is
					 * announced, instead of an unlabelled group the reader has to probe.
					 *
					 * The stop is keyed on the ROWS, which is the only thing it is for: paging
					 * acts on scrollable content, and a row-less pane has none, so Home/PageUp/
					 * ArrowUp have no target there and a stop on it would be a focus trap with
					 * nothing behind it (the notice's own control stays focusable, and the
					 * statement stays in the reading order). Keying it on `collapsed ||
					 * holdPlaceholder` was a proxy for "no rows" - both imply it - and the hold
					 * no longer covers every row-less pane, because a pane with a statement of
					 * its own paints that instead of the placeholder. The proxy stopped
					 * agreeing with the property it stood for, so the property is read directly
					 * - and the property now differs from the hold in the OTHER direction too:
					 * a pane HOLDING a cached paint has records in state and no rows on screen,
					 * so it is `holdPlaceholder`, not the record count, that keeps the stop off
					 * that pane.
					 *
					 * THE TURN ORDER OF THOSE STOPS USED TO COST ONE PRESS PER ROW, AND IT NO
					 * LONGER DOES (UX round 1, U4; QA round 1, Q5). While the control was
					 * revealed by the row's hover it was permanently mounted, and `opacity-0`
					 * kept its place in the tab order by design - so a window of mounted rows
					 * charged the keyboard reader one press per quotable turn, oldest first,
					 * and the newest answer was the farthest away. The trigger is a highlight
					 * now, and with no highlight of this turn's the control is absent from the
					 * DOM rather than hidden, so it contributes no stop at all. The keyboard
					 * path is the one the operator's own ask implies: make a highlight
					 * (shift+arrows, shift+click), Tab to the control that appears, press it.
					 *
					 * The alternative recorded at the time - a shortcut key - stays a new
					 * interaction rather than a fix to this one, and nothing here needs it:
					 * the walk it was proposed to remove is gone.
					 */
					data-chat-region="transcript"
					data-region-entry
					/*
					 * §C4's third region, and the stop that was already here. The spec's landmark
					 * name for it is `Conversation` (the three it lists are `Chats`,
					 * `Conversation`, `Message composer`), shortened from `Conversation
					 * transcript` because the region IS the transcript - the word was doing the
					 * role's work twice.
					 *
					 * WHY NOT THE `<main>` AROUND IT: a region marker claims its element for the
					 * `F6` walk on every route it renders on, and `<main>` is the shell's, drawn
					 * for Settings and Agents too. The scroller exists only where there is a
					 * conversation, which is exactly where this region exists.
					 *
					 * §C4 also asks for "arrow keys between turns" and that is deliberately NOT
					 * built: the bare arrows are this scroller's own paging keys
					 * (`use-scroll-paging.ts`'s `Home`/`ArrowUp`/`PageUp`/`ArrowDown` case), and
					 * a keyboard-operable scroll region is a WCAG 2.1.1 requirement rather than a
					 * preference - taking the arrows for a turn walk would trade one accessible
					 * gesture for another. The transcript's own stop, which is the half the
					 * finding is about, is here.
					 */
					tabIndex={transcript.records.length === 0 || holdPlaceholder ? -1 : 0}
					role="log"
					aria-label={CHAT_REGION_LABEL.transcript}
					// Only the `windowed` branch renders that id, so the description has to
					// track the branch rather than the looser "history exists" condition it
					// was derived from: `hasMore` with no hidden rows yields `idle`, whose
					// button carries its own label, and pointing at an absent element makes
					// the scroller's accessible description resolve to nothing at all — a
					// worse outcome than omitting it, and invisible unless someone reads the
					// tree while the slot happens to be idle.
					aria-describedby={
						slotState === "windowed" ? OLDER_HISTORY_HINT_ID : undefined
					}
					/*
					 * The focus guard's two inputs (see `focusedRecordId` above): React's
					 * onFocus/onBlur are focusin/focusout at this container, so focus
					 * arriving anywhere inside updates the held row and focus leaving the
					 * scroller clears it.
					 */
					onFocus={handleTranscriptFocus}
					onBlur={handleTranscriptBlur}
					onPointerDown={handleTranscriptPointerDown}
					onWheel={handleTranscriptWheel}
					onClick={handleTranscriptClick}
					className={cn(
						// `min-h-0`, not `h-full`: this is the flex child that must absorb
						// the column's leftover height. `h-full` resolves its flex base to
						// the FULL container height, so the base sum overshot the container
						// by the header plus the composer and the deficit was taken out of
						// the header - which is why the header rendered a different height
						// depending on how tall the composer happened to be.
						//
						// `scrollbar-gutter: stable both-edges` because this is the scroll
						// container and the composer below it is not. An 8px scrollbar takes
						// its width off the right of THIS content box only, so `mx-auto`
						// centred the transcript 4px left of the composer - a permanent
						// misalignment between the two elements the eye most wants aligned.
						// Reserving the gutter on both edges restores a symmetric content
						// box: measured in the running app, the centre delta goes 4px -> 0.
						// `stable` alone would reserve only the right edge and keep it.
						//
						// The mask that dissolves the top edge under the chat header is NOT a
						// class here: it is a scroll-driven animation with a `@supports`
						// fallback, which no utility can express, so it lives in
						// `styles/index.css` keyed on `data-lo-canonical-transcript` - the
						// attribute the transcript's own container already carries. A mask
						// changes neither the box's size nor its layout, so the scroll
						// region, the reserved gutter and the bottom anchor autoscroll reads
						// are all as they were.
						"relative flex w-full flex-col-reverse [scrollbar-gutter:stable_both-edges] will-change-[scroll-position] [overflow-anchor:auto] [transform:translateZ(0)]",
						collapsed
							? "h-0 grow-0 overflow-hidden p-0"
							: "min-h-0 grow overflow-auto p-4",
					)}
				>
					{perf && (
						<span data-lo-perf className="sr-only" aria-hidden="true">
							{perf}
						</span>
					)}
					{/*
					 * The settle announcement (see the effect beside the collapse plan):
					 * `output` with `aria-live="polite"`, the idiom the older-history
					 * slot and the aside panel already use — a quiet statement of a
					 * transition the reader did not initiate. The data attribute is
					 * what tells this region from the slot's (both are `output`s with
					 * `aria-live`), for a rig and for the behaviour suite.
					 */}
					<output
						data-condense-announcement=""
						className="sr-only"
						aria-live="polite"
					>
						{condenseAnnouncement}
					</output>
					<div
						data-lo-transcript-content
						/*
						 * `mb-auto` IS THE TOP ANCHOR, and it is a mechanism rather than a nudge.
						 *
						 * The scroller above is `flex-col-reverse` (its paging hook, its
						 * `overflow-anchor` pinning and its top-fade mask are all written against
						 * that origin), so this column is packed to the main-axis start, which is
						 * the BOTTOM: short content hugs the composer, and always has. In a
						 * reversed column the column's physical bottom is the main-start side, so
						 * an auto margin there absorbs positive free space and pushes the column
						 * to the top of the scroller - while a column that overflows has no
						 * positive free space at all, the auto margin resolves to zero, and the
						 * layout is byte-identical to the bottom-packed one. That "only while it
						 * fits" behaviour is why this is the design rather than a
						 * `scrollable`-conditioned `justify-end`, which would need a threshold to
						 * tune and could oscillate around the fill point.
						 *
						 * The empty state is untouched by it: a collapsed pane is `h-0` (see
						 * `collapsed` above), so there is no free space for a margin to absorb
						 * and the centred splash is unaffected. And a transcript shorter than the
						 * pane never scrolls, so the mask stays inert (the ramp note in
						 * `styles/index.css`).
						 */
						className={cn("mb-auto flex flex-col", CHAT_MEASURE)}
					>
						{/* The state this element exists for: the frame BEFORE the conversation's
				    first page, when there is nothing of it to paint yet - either because
				    the pane holds no records at all, or because every record it holds is
				    this window's cached memory of the conversation and the page that would
				    make them paintable is still owed (see `transcriptPaneHoldsPlaceholder`).
				    Rendered inside the content column so it lands at the same inset and the
				    same bottom anchor the rows will, rather than at the pane's centre in
				    the composer band. */}
						{holdPlaceholder && (
							<TranscriptPlaceholder isSmallView={isSmallView} />
						)}
						{/* Older rows: durable pages, then the local window. One fixed-height
				    slot for every state of both, so a state change above the oldest
				    row can never shift the conversation under the reader.
				
				    Rendered whenever the transcript has any rows at all, rather than
				    only while history remains. The previous guard
				    (`hasMore || hidden > 0 || loading`) was the exact inverse of the
				    condition that yields `exhausted`, so "Start of conversation" was
				    copy the product could never show — and reaching the oldest
				    message unmounted the slot, moving every row below it up by 44px
				    at that moment. Keeping it mounted is what makes the end of
				    history a statement instead of an absence, and costs nothing: the
				    slot is one fixed-height row either way. The statement itself is
				    gated on proof (`hydrationProven`): an unproven end says "not
				    loaded" and offers the read again, never the end copy
				    (remote-load-hydration). */}
						{/* NOT while the paint is cached: a cache entry carries no paging
				    cursor (its rows are trimmed), which the slot reads as `exhausted`
				    and says "Start of conversation" over a transcript that may be a
				    thousand messages in. Measured on a captured frame, not inferred.
				    The caption above already says the view is not authoritative. */}
						{transcript.records.length > 0 && !stale && !missing && (
							<OlderHistorySlot
								state={slotState}
								// A retry cannot succeed while the transport is down, and the
								// transcript's own notice below already explains why. The slot
								// drops its gesture hint rather than stacking a second claim on
								// top of that one. `olderTransportDown` is the same assertion
								// for a caller whose rows did NOT come from this session's
								// stream (the child reader's page): it is the caller's own
								// status, so a pane with no stream of its own is not read as a
								// live one by default.
								transportDown={olderTransportDown ?? status !== "live"}
								onLoadOlder={requestOlder}
								/* The `unproven` arm's control: the same read the cold
								 * open fires, re-asked by the reader's own hand. */
								onRetryHydration={onRetryHydration}
							/>
						)}

						{/*
						 * THE STALE CAPTION IS NOT PAINTED IN HERE ANY MORE (design round 2,
						 * D10). It is hoisted above the scroller — see the `stale` paragraph near
						 * the top of this component — and the second, legacy copy that used to sit
						 * at this spot rendered the SAME sentence twice on every short pane: once
						 * pinned to the pane's top edge, once immediately above the first bubble.
						 * A long transcript hid it above the fold, which is why only the ordinary
						 * and narrow fixtures showed the duplication while the overflowing one
						 * passed.
						 *
						 * This surface's contract is ONE caption for one status, and a status the
						 * reader has already read is not improved by being repeated, so the
						 * in-scroll copy is the one that goes. The hoisted one is kept because it
						 * survives not scrolled to the top, which was the original D1 defect.
						 *
						 * The loading skeleton is not rendered here either: it is
						 * `TranscriptPlaceholder`, inside the content column above, because the
						 * pane's own decision module (`transcript-pane.ts`) is the single
						 * authority for when a row-less pane holds a placeholder — and because the
						 * ground the old inline bars used (`sunken`, the weakest adjacent step in
						 * most palettes) was measured against the pane's `canvas` and replaced
						 * with `elevated` there.
						 */}
						{missing ? (
							/*
							 * The named state for a conversation this machine does not have,
							 * and its way out. It replaces the whole status block rather than
							 * sitting beside it: the failure notice and `Reconnecting` both
							 * describe a TRANSPORT that may recover, and this is not that.
							 *
							 * The action clears the selection, which lands the reader on the
							 * catalogue's own empty state — the only thing that can be done
							 * about a conversation that no longer exists. It is NOT a retry:
							 * retrying asks a question whose answer is about the session.
							 */
							<div className="mb-4 flex flex-col gap-2">
								{/*
								 * `id` is what the refused composer points its `aria-describedby` at
								 * (UX round 1, U3): this sentence is the pane's statement of WHY the box
								 * takes nothing, and it is the only one that survives the box being
								 * non-empty. The name lives in `../missing-session-notice` so the two
								 * components cannot spell it differently.
								 */}
								<p
									id={MISSING_SESSION_NOTICE_ID}
									className="text-body-sm text-ink"
								>
									This conversation is no longer on this machine.
								</p>
								<p className="text-ink-dim text-meta">
									It was deleted, or it belongs to a machine this app is not
									connected to.
								</p>
								<Button
									variant="outline"
									size="sm"
									className="self-start"
									onClick={() => {
										// Read at click time rather than subscribed: this component
										// must not re-render every time the catalogue does.
										useCanonicalSessionsStore.getState().setActiveSession(null);
									}}
								>
									Start a new chat
								</Button>
							</div>
						) : null}

						{status === "unavailable" && failure && (
							/*
							 * One sentence and the one action that helps.
							 *
							 * The sentence is the PRODUCT's, not the transport's:
							 * `failure.statement` is translated from the relay's machine detail by
							 * `shared/desktop-stream-notice.ts`, so the packaged app and the
							 * browser harness paint the same words for the same failure - which is
							 * what was broken when the frame showed "The event stream ended." and
							 * the shipped relay said "The event stream was refused (401)."
							 * (design round 1, D1).
							 *
							 * It sits at the reading register the contract gives something the
							 * reader must act on (D2): `text-meta` is the caption step, and this
							 * was the bottom 4% of a 648px void. The block is edge-aligned with the
							 * composer by sharing the column container above, and its bottom
							 * margin is small so the notice reads as attached to the composer
							 * rather than floating in the pane.
							 *
							 * The control is named for what it DOES (D4): the shell carries a
							 * legacy banner whose "Retry" re-probes a different API, and two
							 * controls with one accessible name and two actions reached a keyboard
							 * user together. `action === null` means reconnecting cannot help, so
							 * no control is painted rather than one that cannot work (Q-2).
							 */
							<div
								data-lo-session-failure
								className="mb-1 flex flex-wrap items-center gap-3"
							>
								<p className="text-body-sm text-danger">{failure.statement}</p>
								{failure.action === "reconnect" && (
									<Button variant="outline" size="sm" onClick={onReconnect}>
										Reconnect
									</Button>
								)}
							</div>
						)}
						{status === "reconnecting" && (
							// Reading register, not the caption step: during the retry window
							// this is the pane's only statement, and it has to be perceivable
							// (design round 1, D3).
							<p className="mb-4 text-body-sm text-ink-dim">Reconnecting</p>
						)}

						{/* Rows are suppressed for a conversation that is not there: the pane
				    must not paint its last memory of a session the backend says is
				    gone, because nothing on screen could then be trusted and there is
				    no state to reconcile to - and for one that is still ARRIVING: a
				    `holdPlaceholder` pane has the cached paint in state and nothing of
				    it on screen, so the page that ends the hold brings the rows and the
				    readings in ONE commit instead of correcting a painted guess. */}
						{!missing && !holdPlaceholder && (
							/*
							 * THE PANE THIS CONVERSATION'S LINKS OPEN INTO, provided once for the
							 * whole row list rather than threaded through the rows: the anchor that
							 * a press lands on is inside `MarkdownRenderer` (which every markdown
							 * surface in the app renders and which has no pane of its own) and the
							 * toolbar that offers the same open is a sibling of it, so a prop would
							 * have to reach both from here anyway. `conversationId` is exactly the
							 * canvas store's key for this pane, and it is the SAME value the rows
							 * already receive for their quotes and the canvas dock below is given as
							 * its `conversationId` - one identity, one source.
							 *
							 * Absent (stories, the run panel's child reader) the provider still
							 * mounts and answers `null`, so those surfaces keep the OS hand-off
							 * they had and nothing about their tree changes shape.
							 */
							<CanvasPaneProvider conversationId={conversationId}>
								{/*
								 * THE ROWS, WITH §E2's AGGREGATION TIER APPLIED.
								 *
								 * `foldRuns` decides which consecutive actions become one summary
								 * line, and it never reorders them: the fold is keyed by its FIRST
								 * row, so it cannot claim a place ahead of the action that opens it,
								 * and the rows inside it are the same `TranscriptRow`s with the same
								 * ids in the same DOM - which is what keeps every `data-record-id`
								 * lookup (the failure jump among them) working the same whether a
								 * run happens to be folded or not.
								 *
								 * ONE THING THE FOLD NEEDS FROM MAIN THAT THE ROWS DO NOT CARRY THEMSELVES:
								 * `labelPending` is a Set on this component and a BOOLEAN on the row,
								 * resolved here for #490's reason (see `TranscriptRow`'s props). The
								 * fold onto `origin/main` that brought #490 under this redesign removed
								 * the `visible.map` this replaced, so the resolution is re-expressed at
								 * the two call sites rather than kept as main's single one - and the
								 * SAME treatment applies to #520's `labelHoldLate`/`labelMarked` pair:
								 * the Set resolves against the row's own `toolCallId` at each call site,
								 * so a held or mark-ended row states its column inside a fold exactly
								 * as it would standing alone.
								 */}
								{chatEntries.map((entry) =>
									entry.kind === "bar" ? (
										<TurnSummary
											/*
											 * Prefixed: the segment's key is a ROW ID (`runsOf`: the closing
											 * answer's, else the run's last row's; later segments append
											 * `#<row>`), and the run's groups render as their own children
											 * elsewhere in the same list - an unprefixed key collided with
											 * one of them (two children, one key) and React silently
											 * dropped one of the pair. The prefix also states which
											 * collided: the replaced slot is not the bar.
											 */
											key={`turn-summary:${entry.segment.key}`}
											recordIds={entry.runIds}
											/*
											 * The ids THIS bar hides. With several bars in a run, the
											 * run's ids alone cannot say which bar holds a row, and the
											 * reveal walk (`failed-row-jump.ts`) would open the FIRST bar
											 * of the run for a row in the second - one unrequested
											 * expansion per bar in between.
											 */
											segmentIds={entry.segment.segmentIds}
											/*
											 * The bar stands where the FIRST hidden row stood, so it
											 * carries that row's identity: a lookup for the row finds the
											 * bar that replaced its slot.
											 */
											anchorRecordId={entry.segment.firstId}
											className={GAP[entry.segment.gap][isSmallView ? 1 : 0]}
											durationS={entry.segment.facts.durationS}
											actionCount={entry.segment.facts.actions}
											/*
											 * The count is a minimum while the segment's head is cut
											 * (`N+ actions`): see `TurnSummaryFacts.partial` - the bar says
											 * so in its own vocabulary rather than stating a total it
											 * cannot know.
											 */
											partial={entry.segment.facts.partial}
											title={entry.segment.facts.title}
											stampTs={entry.segment.stampTs}
											label={entry.segment.label}
											completed={entry.segment.completed}
											open={openRuns.has(entry.segment.key)}
											onOpenChange={(next) =>
												openBar(entry.segment.key, entry.segment.firstId, next)
											}
											/*
											 * The span's pictures, while the rows that draw them are
											 * unmounted - the same composition and the same rule as
											 * `renderGroup`'s: rendered only while collapsed, and not
											 * passed at all for a run that produced none.
											 */
											condensedMedia={
												entry.images.length > 0
													? (expand: () => void) => (
															<FoldMedia
																images={entry.images}
																scope={mediaScope}
																onRevealMore={expand}
																indent="flush"
															/>
														)
													: undefined
											}
											mediaCount={entry.images.length}
										>
											{entry.children.map((child, index) =>
												/*
												 * The first hidden group drops to the trace tier, the way
												 * `TraceFold` demotes its first row: the bar replaces the
												 * group's slot, so the group cannot also keep the turn-tier
												 * margin it earned as the turn's opener (D2). Every other
												 * group keeps the gap the unfolded list gave it.
												 *
												 * The third argument is the span's sole-image-group fact,
												 * named with both of its effects at the parameter's own
												 * comment: D3/U6's duplicate rule for the clause, and
												 * U8's uncapped strip so one press reaches the rest.
												 */
												renderGroup(
													index === 0 ? atTraceTierGroup(child) : child,
													true,
													child.kind === "run" &&
														entry.images.length > 0 &&
														child.images.length === entry.images.length,
												),
											)}
										</TurnSummary>
									) : (
										/*
										 * The first group under a bar re-tiers to the item step;
										 * every later group and every other run's groups keep the
										 * gap the unfolded list gave them.
										 */
										renderGroup(
											entry.afterBar
												? atItemTierGroup(entry.group)
												: entry.group,
											entry.suppressClosingLine,
										)
									),
								)}
							</CanvasPaneProvider>
						)}

						{/*
						 * THE FOOT SLOT IS RESERVED, NOT TOGGLED (operator report, 2026-09-27).
						 *
						 * "Sometimes the whole conversation including the leading edge shifts up
						 * even though we're now in the scroll phase." Measured on the harness
						 * (`scripts/scroll-shift-evidence.mjs`, a tall fixture at 1380x872):
						 * while the transcript is anchored at the tail, this row MOUNTING moved
						 * every settled row and the last row's bottom edge - the leading edge -
						 * up 29.4px in one frame at the turn's start, and its unmount moved them
						 * back down at the turn's end. The scroller is pinned at `scrollTop = 0`,
						 * so anything that appears below the last row displaces the whole
						 * conversation; the fix is that nothing appears: the line mounts into a
						 * row that was already there.
						 *
						 * 29.4px is this row's own footprint - `GAP.item`'s 12px plus one
						 * `text-mono-sm` line at 1.45 line-height (17.4px) - and `min-h-[1lh]`
						 * rather than a number is what keeps the reserve glued to the thing it
						 * reserves: the reserve is exactly one line of the line's own type, so a
						 * change to that token moves both together. The reserved row is
						 * otherwise empty - it paints no text when no turn is running and holds
						 * no live region - so the idle pane is the same picture it was, one row
						 * taller.
						 *
						 * This is the older-history slot's rule, one element down ("One
						 * fixed-height slot for every state of both, so a state change above the
						 * oldest row can never shift the conversation under the reader"), and it
						 * is withheld on the same terms: the slot belongs to a CONVERSATION, not
						 * to a turn, and the failure surfaces replace the rows rather than sit
						 * above them.
						 */}
						{transcript.records.length > 0 && !stale && !missing && (
							<div
								data-lo-transcript-foot={true}
								className={cn(
									// On the `item` tier, not a tier of its own: the working line is
									// the foot of the run above it and shares that run's rhythm. It
									// takes slightly more than `trace` because it is the one row that
									// is not a completed action, and slightly less than a turn
									// boundary because the turn has not ended.
									GAP.item[isSmallView ? 1 : 0],
									"min-h-[1lh] font-mono text-mono-sm",
								)}
							>
								{working && (
									<WorkingLine
										activity={working.activity}
										phase={working.phase}
										startedAt={working.startedAt}
										clock={working.clock}
									/>
								)}
							</div>
						)}

						{/*
						 * NO GATE HERE. The pending question used to render as this list's
						 * last item; it is DOCKED above the composer now (chat redesign §F1,
						 * `trace/question-dock.tsx`), because an inline card is off-screen on a
						 * long turn and the question is the one thing the agent is blocked on.
						 * `gate` is still read above, by the working line: a pending question
						 * outranks the wait line, and that decision is the pane's.
						 */}

						{/* No empty state here. The composer already owns it: it renders
				    "What can I help you with today?" with the suggestion grid on
				    the same condition, so a cold conversation used to show a line
				    saying it was empty directly above a block inviting you to
				    start it -- two empty states for one empty state (design D6).
				    The composer's version wins because it offers the action; this
				    one only described the situation. */}
					</div>
				</div>
			</div>
			{/*
			 * The in-thread search overlay (`⌘F`), mounted HERE rather than in the
			 * scroller: it floats over the transcript and must not scroll with it,
			 * and it must not be clipped by the scroller's own `overflow: auto` — a
			 * sibling of the scroller inside the (now `relative`) column is both.
			 *
			 * It takes the scroller's own ref as its reveal root, so a hit navigates
			 * THIS transcript: a second transcript on the same screen (the run panel's
			 * child reader) is a different mount with a different ref, and it renders
			 * no overlay of its own — `sessionId` is null on a draft, so the chord
			 * has nothing to search and the panel is absent rather than empty.
			 */}
			{sessionId !== null && (
				<ThreadSearchOverlay
					sessionId={sessionId}
					containerRef={containerRef}
					onReveal={jumpToSearchHit}
				/>
			)}
		</div>
	);
};
