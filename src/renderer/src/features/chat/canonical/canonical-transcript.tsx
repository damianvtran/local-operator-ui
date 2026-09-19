/**
 * The canonical transcript view.
 *
 * Paints `TranscriptRecord`s from the canonical session stream by the
 * docs/branding.md § 7 hierarchy, most prominent first:
 *
 *   1. the pending gate (a question for the user) — `AgentQuestion`, last;
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

import { Button } from "@shared/components/ui";
import { useCompletionView } from "@shared/hooks/use-completion-view";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import {
	CircleAlert,
	Info,
	MessageSquareText,
	TriangleAlert,
} from "lucide-react";
import {
	type FC,
	type RefObject,
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	CanonicalFrontendState,
	PendingDesktopGate,
} from "../../../../../shared/desktop-session-contract";
import type { SessionFailureNotice } from "../../../../../shared/desktop-stream-notice";
import { CHAT_COLUMN_CONTAINER, CHAT_MEASURE } from "../chat-measure";
import { MarkdownRenderer } from "../components/markdown-renderer";
import {
	AGENT_GUTTER,
	MessageContainer,
} from "../components/message-item/message-container";
import { TurnTimestamp } from "../components/message-item/turn-timestamp";
import { ReplyPreview } from "../components/reply-preview";
import {
	AgentQuestion,
	AskOptions,
	DiffBlock,
	TraceLine,
} from "../components/trace";
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
	formatBytes,
	isBareToolName,
	isDiffBodyRow,
	outputFallbackLine,
	summaryFromArgs,
	toolNameColumn,
} from "../components/trace/tool-row-model";
import { WorkingLine } from "../components/trace/working-line";
import { MISSING_SESSION_NOTICE_ID } from "../missing-session-notice";
import { CanvasPaneProvider } from "../utils/canvas-pane";
import { parseReplies } from "../utils/reply-utils";
import { CanonicalImage } from "./canonical-image";
import { LinkToolkit } from "./link-toolkit";
import { OLDER_HISTORY_HINT_ID, OlderHistorySlot } from "./older-history-slot";
import { isQuotable } from "./quote-model";
import { QuoteToolkit } from "./quote-toolkit";
import {
	type CanonicalTranscriptStatus,
	canonicalTranscriptSpeaks,
	transcriptPaneCollapses,
	transcriptPaneHoldsPlaceholder,
} from "./transcript-pane";
import { TranscriptPlaceholder } from "./transcript-placeholder";
import {
	type TranscriptRecord,
	type TranscriptState,
	streamDiagnostics,
	withRecoveredOutcome,
} from "./transcript-reducer";
import {
	GAP,
	type Row,
	buildRows,
	ledgerName,
	paintsSomething,
	splitFirstLine,
} from "./transcript-rows";
import type { AttachmentScope } from "./use-attachment-url";
import { useLinkSubject } from "./use-link-subject";
import { useScrollPaging } from "./use-scroll-paging";
import { deriveWorkingLine, workingLineInputFor } from "./working-line-model";

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
	loadingOlder: boolean;
	/**
	 * Fetch the next durable page. Resolving `false` rather than rejecting is
	 * what lets the paging policy count failures and stop retrying on its own
	 * (clause G); a caller that cannot report failure gets an unbounded retry
	 * loop or no retry at all, and neither is the contract.
	 */
	onLoadOlder: () => Promise<boolean>;
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
	 * Re-arm the session's stream and history read.
	 *
	 * Required rather than optional: every caller of this component has a
	 * session handle to hand it, and a failure notice with no action is what
	 * this surface is being fixed to stop showing.
	 */
	onReconnect: () => void;
	/**
	 * Submit `label` as the answer to the pending `ask` gate.
	 *
	 * Optional because the transcript renders in surfaces that have no answer
	 * path at all (stories, and any caller without a live session). Absent, the
	 * options still render but do nothing — so the callers that CAN answer are
	 * the only ones that offer it, and the component never fakes a send.
	 */
	onAnswer?: (label: string) => void;
	/**
	 * An answer is already in flight, from a click or from the composer.
	 *
	 * Shared with the composer's own in-flight flag rather than tracked locally:
	 * a second source of truth here is how a click and a typed send end up both
	 * believing they are the only answer.
	 */
	answering?: boolean;
	/**
	 * This panel's own record of the gate it is showing, from the press onwards.
	 *
	 * `null` means nothing has been pressed here and the card is live. Once an
	 * answer has been attempted the card holds itself disabled until the gate
	 * itself changes (`request_id` or `question_index`), because the renderer's
	 * `pending_gate` is only cleared by the next stream frame — so between the
	 * owner accepting the answer and that frame arriving, a live card would let a
	 * second press post a second answer to a one-shot question (code review round
	 * 1, R-MINOR). `sending` also drives the callout's eyebrow, and `refused`
	 * carries the sentence when the owner would not take the answer.
	 */
	answer?: { sending: boolean; refused: string | null } | null;
};

// ---------------------------------------------------------------- rows

const UserRow = memo(function UserRow({
	record,
	isSmallView,
	scope,
	conversationId,
}: {
	record: Extract<TranscriptRecord, { kind: "user" }>;
	isSmallView: boolean;
	scope: AttachmentScope | null;
	conversationId?: string;
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
			<div className={cn("flex w-full flex-col items-end gap-1")}>
				<div ref={turnRef} className="group relative flex w-full justify-end">
					<div
						className={cn(
							// `border-control`, not `hairline`. The bubble keeps its own
							// ground (`surface`) on a column that is `canvas` for the working
							// surface's sake (see chat-content.tsx), so the fill is a
							// lightness step as well as this edge - but a step is not an
							// edge, and this border is still the boundary the design contract
							// asks for. Because the agent side has no bubble at all, the edge
							// is also the whole visual distinction between the two speakers.
							// Removing it would lose information, which is the contract's own
							// test for a structural boundary, so it takes the role with the
							// 3:1 floor rather than the decorative one with no floor.
							"relative rounded-frame border border-control bg-surface text-ink break-words",
							isSmallView ? "max-w-[92%] px-3 py-2" : "max-w-[75%] px-4 py-3",
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
						<div className={cn("relative")}>
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
				 * One stamp per turn, always visible (the operator's request). The
				 * record's own `ts` is the moment the message was sent, which the
				 * reducer sets from the owner's frame rather than from paint time -
				 * § 7's "rows are placed by the time they carry, never by the moment
				 * the reader happened to see them".
				 */}
				<TurnTimestamp timestamp={record.ts} scope="turn" />
			</div>
		</MessageContainer>
	);
});

const AssistantRow = memo(function AssistantRow({
	record,
	isSmallView,
	showAvatar,
	closesTurn,
	conversationId,
}: {
	record: Extract<TranscriptRecord, { kind: "assistant" }>;
	isSmallView: boolean;
	showAvatar: boolean;
	closesTurn: boolean;
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
	return (
		<MessageContainer
			isUser={false}
			isSmallView={isSmallView}
			showAvatar={showAvatar}
		>
			{/*
			 * No measure class here. The answer takes the full row content box, which
			 * is the box `ToolRow` resolves against, so prose and ledger in one turn
			 * share both edges structurally rather than by agreement.
			 */}
			<div
				ref={turnRef}
				className={cn("relative w-full break-words text-ink")}
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
				<MarkdownRenderer
					content={remainingContent}
					className={cn(refused && "[--md-ink:var(--lo-danger)]")}
					styleProps={{
						fontSize: isSmallView ? "var(--text-body-sm)" : "var(--text-body)",
						lineHeight: 1.6,
					}}
					/*
					 * A STREAMING ROW IS NOT LINKIFIED, for the reason `isQuotable`
					 * refuses a streaming record: the row is a prefix the next token
					 * falsifies, so `/Users/x/opoint-renewal-2026-09-1` would become a link
					 * to a path that does not exist and then silently re-link as the rest
					 * of it arrived. The links appear when the row settles - which is also
					 * when its Quote control appears.
					 */
					linkify={!record.streaming}
				/>
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
			 * Left-aligned by the container's own `pl-10` gutter, which is the padding
			 * the answer's prose already starts at - so the caption and the prose share
			 * one left edge structurally rather than by a second measurement (the frame
			 * is where that is checked; see `docs/evidence/chat-tool-rows/README.md`).
			 */}
			{closesTurn && (
				<div className={cn("mt-1")}>
					<TurnTimestamp timestamp={record.ts} scope="answer" />
				</div>
			)}
		</MessageContainer>
	);
});

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
	showAvatar,
	nameColumn,
	scope,
}: {
	record: Extract<TranscriptRecord, { kind: "tool" }>;
	isSmallView: boolean;
	showAvatar: boolean;
	nameColumn: number;
	scope: AttachmentScope | null;
}) {
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
	 * producer said rather than each inventing a reading of it.
	 */
	const queued = record.phase === "queued";
	// Truthiness rather than `!== null`: a record built by hand (a test fixture, a
	// story) carries no `notRunReason` key at all, and `undefined !== null` would
	// paint every one of them as a never-run verdict.
	const notRun = Boolean(record.notRunReason);
	/*
	 * The call reached no tool — the verdict's fact, and also the turn-death one:
	 * a row still being dictated or waiting to run when the turn ended was never
	 * sent either, and the harness's verdict is only one of the two ways that
	 * happens. The TUI states the two the same way, and the record of it is the
	 * same sentence (`mark_not_run`'s summary; `mark_interrupted` keeps the compose
	 * facts for a card that was composing or queued), which is why the row below
	 * reads `never sent · N composed` for both rather than only where a verdict
	 * happened to arrive.
	 */
	const neverSent = record.neverSent === true || notRun;
	const summary = neverSent
		? // `never sent`, not `failed`: the call produced no result to fail, and the
			// size is the record of how far the model got before nothing would receive
			// it (`ToolCard.mark_not_run`). An empty payload is named rather than
			// rendered as `0 B`, which would claim a measurement.
			`never sent · ${record.argumentBytes ? `${formatBytes(record.argumentBytes)} composed` : "nothing composed"}`
		: composing
			? `composing${record.argumentBytes ? ` · ${formatBytes(record.argumentBytes)}` : ""}`
			: queued
				? // Dictation is over and the call has not started: the byte count stays
					// (it is how far the model got), and the status word stops claiming work
					// the model finished writing.
					`queued${record.argumentBytes ? ` · ${formatBytes(record.argumentBytes)}` : ""}`
				: summaryFromArgs(record.toolName, record.args);
	// When the arguments taught us nothing, the summary is the tool's own name,
	// which the row then drops as a stutter and the object column goes empty.
	// A row that says nothing about its call is the scannability this port
	// exists to create, lost — so the OUTPUT's first line stands in. It is a
	// weaker fact than the arguments (it says what came back rather than what
	// was asked) and it is deliberately second choice, but it beats a void.
	const derived =
		!composing && isBareToolName(summary, record.toolName)
			? outputFallbackLine(record.output)
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
		 */
		<div
			className={cn(
				"w-full rounded-sm border border-hairline bg-sunken p-3 font-mono text-mono-sm",
			)}
			data-detail-section="not-run"
		>
			<span className={cn("mb-1 block text-meta text-danger")}>Not run</span>
			<div className={cn(DETAIL_SECTION_MAX, "overflow-auto")}>
				<pre className={cn("whitespace-pre font-mono text-danger")}>
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
			isError={record.isError}
		/>
	) : undefined;
	/*
	 * The stamp at the foot of the EXPANDED section, and the reason it is a
	 * sibling of the body rather than a line inside `ToolDetail`.
	 *
	 * The operator asked for the time "at the bottom right of the expanded
	 * section", and the expanded section is this composition — the arguments or
	 * the diff, then the result — not the pane component alone. Both body shapes
	 * get the stamp from here: a settled `write`/`edit` whose expansion is the
	 * DIFF (`isDiffBodyRow`) never mounts `ToolDetail` at all, so a stamp handled
	 * inside the pane would be missing from exactly the rows whose payload is
	 * longest and whose time is most worth knowing.
	 *
	 * It is also the only placement that survives the pane's own scrolling.
	 * `ToolDetail`'s two sections are each their own `overflow-auto` box with a
	 * `detailOverflowLabel` report under them, and that report is deliberately
	 * OUTSIDE its scroller so it stays true at rest; anything INSIDE the pane is
	 * scrolled away at rest on a long payload, which is a stamp that is not "at
	 * the bottom of the expanded section" for the rows that most need one. Below
	 * the pane there is nothing to scroll: the stamp is on screen the moment the
	 * row opens, with the last line that is true of the payload immediately above
	 * it.
	 *
	 * The air above it is the disclosure content's own `gap-2`
	 * (`shared/components/ui/disclosure.tsx`), which is the one spacing the shared
	 * idiom owns; the stamp takes the rhythm of the section it sits in rather than
	 * adding a margin of its own. Its right edge is the pane's, because both are
	 * in the same indented column.
	 *
	 * A COLLAPSED row has no body at all — `hasDetail`/`isDiffBodyRow` return
	 * false and the ledger row renders its disabled branch, which structurally
	 * cannot render children — so a run of twenty calls stays twenty quiet lines
	 * with no stamps. That quiet is what the hover-only model was protecting, and
	 * it is why the stamp lives inside the disclosure instead of under every row.
	 */
	const details = body ? (
		<>
			{body}
			{/*
			 * `pr-4` is the row's own meta column, and it is what keeps a ledger row to
			 * ONE right edge. The disclosure's trigger is `w-full` inside a box that also
			 * carries `-mx-2 px-2` (`trace/tool-row.tsx`), and that negative margin bleeds
			 * on the LEFT only, so the trigger's box ends 8px short of the row and its own
			 * `px-2` puts the duration 8px further in again - 16px in total, measured at
			 * 1074 against the row's 1090 at 1280 and 364 against 380 at 420, in both
			 * palettes. The pane and the disclosure content column both reach the row's
			 * true edge, so without this the stamp sat 16px right of the duration one line
			 * above it: two right edges inside one card (design round 1, D2). The stamp
			 * moves onto the meta column rather than the trigger growing, because the
			 * trigger's bleed is what the row's hover ground is drawn from and restyling
			 * that ground is a different change from this one.
			 */}
			<div className={cn("flex justify-end pr-4")}>
				<TurnTimestamp timestamp={record.ts} scope="tool" />
			</div>
		</>
	) : undefined;
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
						label={
							record.images.length === 1
								? "Screenshot"
								: `Screenshot ${index + 1}`
						}
					/>
				))}
			</div>
		) : undefined;
	return (
		<MessageContainer
			isUser={false}
			isSmallView={isSmallView}
			showAvatar={showAvatar}
		>
			<ToolLedgerRow
				toolName={record.toolName}
				summary={summary}
				summaryFallback={derived}
				outcome={
					notRun
						? "not-run"
						: running
							? "running"
							: record.isError
								? "error"
								: record.stopped
									? "interrupted"
									: "success"
				}
				durationS={record.durationS}
				startedAt={record.startedAt}
				added={record.added}
				removed={record.removed}
				nameColumn={nameColumn}
				details={details}
				media={media}
			/>
		</MessageContainer>
	);
});

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
	showAvatar,
	nameColumn,
}: {
	record: Extract<TranscriptRecord, { kind: "peer" }>;
	isSmallView: boolean;
	showAvatar: boolean;
	nameColumn: number;
}) {
	const detail = peerHasDetail(record.sender, record.body);
	if (!detail) {
		return (
			<MessageContainer
				isUser={false}
				isSmallView={isSmallView}
				showAvatar={showAvatar}
			>
				<ToolLedgerRow
					toolName="peer"
					summary={peerSummary(record.sender, record.body)}
					outcome="receipt"
					durationS={null}
					nameColumn={nameColumn}
				/>
			</MessageContainer>
		);
	}
	return (
		<MessageContainer
			isUser={false}
			isSmallView={isSmallView}
			showAvatar={showAvatar}
		>
			<ToolLedgerRow
				toolName="peer"
				summary={peerSummary(record.sender, record.body)}
				outcome="receipt"
				durationS={null}
				nameColumn={nameColumn}
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
	showAvatar,
	nameColumn,
}: {
	record: Extract<TranscriptRecord, { kind: "wake" }>;
	isSmallView: boolean;
	showAvatar: boolean;
	nameColumn: number;
}) {
	const prompt = wakePromptBody(record.text);
	return (
		<MessageContainer
			isUser={false}
			isSmallView={isSmallView}
			showAvatar={showAvatar}
		>
			<ToolLedgerRow
				toolName="wake"
				summary={wakeReceiptHeadline(record.text)}
				outcome="receipt"
				durationS={null}
				nameColumn={nameColumn}
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

const TranscriptRow = memo(function TranscriptRow({
	row,
	isSmallView,
	nameColumn,
	scope,
	conversationId,
}: {
	row: Row;
	isSmallView: boolean;
	nameColumn: number;
	scope: AttachmentScope | null;
	conversationId?: string;
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
				/>
			);
			break;
		case "assistant":
			body = (
				<AssistantRow
					record={record}
					isSmallView={isSmallView}
					showAvatar={row.showAvatar}
					closesTurn={row.closesTurn}
					conversationId={conversationId}
				/>
			);
			break;
		case "tool":
			body = (
				<ToolRow
					record={record}
					isSmallView={isSmallView}
					showAvatar={row.showAvatar}
					nameColumn={nameColumn}
					scope={scope}
				/>
			);
			break;
		case "peer":
			body = (
				<PeerRow
					record={record}
					isSmallView={isSmallView}
					showAvatar={row.showAvatar}
					nameColumn={nameColumn}
				/>
			);
			break;
		case "wake":
			body = (
				<WakeRow
					record={record}
					isSmallView={isSmallView}
					showAvatar={row.showAvatar}
					nameColumn={nameColumn}
				/>
			);
			break;
		default:
			body = <NoticeRow record={record} isSmallView={isSmallView} />;
	}
	if (body === null) return null;
	return (
		<div
			data-record-id={record.id}
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

export const CanonicalTranscript: FC<CanonicalTranscriptProps> = ({
	frontend,
	transcript,
	gate,
	waiting,
	starting,
	startingAfterId,
	loadingOlder,
	onLoadOlder,
	containerRef,
	isSmallView,
	status,
	failure,
	awaitingHydration,
	stale = false,
	missing = false,
	attachmentScope,
	conversationId,
	onReconnect,
	onAnswer,
	answering = false,
	answer = null,
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
	const previousRows = useRef<Row[]>([]);
	const rows = useMemo(() => {
		const next = buildRows(painted.records, previousRows.current);
		previousRows.current = next;
		return next;
	}, [painted.records]);
	// Windowing: newest rows first. The window widens when the reader nears the
	// top, and resets when the transcript is replaced (session switch/clear).
	const [windowSize, setWindowSize] = useState(WINDOW);
	// Clause H: a different conversation starts at the default window. Without
	// this, opening a long conversation and then a short one leaves the short
	// one mounting every row it has, and the paging state reset below would be
	// reasoning about a window that belongs to the previous transcript.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on session change only
	useEffect(() => {
		setWindowSize(WINDOW);
	}, [sessionId]);
	const total = rows.length;
	const visible = useMemo(
		() => (total > windowSize ? rows.slice(total - windowSize) : rows),
		[rows, total, windowSize],
	);
	const hidden = total - visible.length;

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
	const widen = useCallback(() => {
		setWindowSize((current) => Math.min(total, current + WINDOW_STEP));
	}, [total]);

	// The session identity the paging state belongs to. `hasMore` is folded in
	// because `/clear` replaces the transcript without changing the session, and
	// a latch held against rows that are gone would refuse the first gesture in
	// the transcript that replaced them.
	const { slotState, requestOlder } = useScrollPaging({
		containerRef,
		sessionKey: sessionId,
		hiddenRows: hidden,
		hasMore: Boolean(transcript.hasMore),
		onWiden: widen,
		onLoadOlder,
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

	// Measurement hook: one mark per commit of this list. Read with
	// performance.getEntriesByName("lop:transcript:render").
	const commits = useRef(0);
	const [perf, setPerf] = useState("");
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
				`commits=${commits.current} rowRenders=${rowRenderCount.current} rows=${visible.length} flushes=${flushes.length} flushP50=${p50.toFixed(2)}ms flushMax=${max.toFixed(2)}ms settledUpdates=${streamDiagnostics.settledAssistantUpdate} seedDeltasWithheld=${streamDiagnostics.seededDeltaWithheld}`,
			);
		}, 1000);
		return () => window.clearInterval(timer);
	}, [visible.length]);

	// The shared name column: sized to the longest ledger name ON SCREEN, between
	// the TUI's 8ch floor and 24ch ceiling. Derived from the visible window
	// rather than the whole transcript, so scrolling to a run of `bash` rows
	// does not keep paying for an `mcp__…` name a thousand rows back.
	//
	// A receipt row (`peer`, `wake`) is part of that measurement, not exempt from
	// it: it sits on the same spine as the calls around it, and a name left out
	// of the set would shift every other row's summary rail when it scrolled into
	// view. `ledgerName` is the one place that decides which records have a name
	// column at all.
	const nameColumn = useMemo(
		() =>
			toolNameColumn(
				visible.map((row) => ledgerName(row.record)).filter(Boolean),
			),
		[visible],
	);

	// What the working line says, and which phase it is timing. The derivation
	// (and its copy contract, including the one branch this app drives from its
	// own admitted send rather than from a frame) lives in
	// `working-line-model.ts`; this is only the memo that keeps it off the
	// per-token path.
	const working = useMemo(
		() =>
			// One input builder for this claim's two readers - this rung and the
			// composer's hint - so the two cannot be handed different facts
			// (`workingLineInputFor`, `working-line-model.ts`).
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
					gate,
					// One definition of "this pane is speaking for itself", shared with the
					// band's own greeting decision rather than a second copy of "the
					// transport is down": the failure notice and the reconnecting line are
					// the only things on screen that say what happened, so the rung must
					// not claim progress beside them.
					//
					// The four fields are spelled out rather than handed over as
					// `paneView`: this is a memo, and a fresh object would make its deps
					// depend on the view's identity instead of on the facts it reads.
					unavailable: canonicalTranscriptSpeaks({
						status,
						failure,
						missing,
						stale,
					}),
					records: transcript.records,
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
			gate,
			status,
			failure,
			// The pane's two click-path states, because the predicate above reads them
			// and a memo that missed them would keep a claim the pane has withdrawn.
			missing,
			stale,
			transcript.records,
		],
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
		<div
			className={cn(
				CHAT_COLUMN_CONTAINER,
				collapsed ? "h-0 grow-0 overflow-hidden" : "flex min-h-0 grow flex-col",
			)}
		>
			{stale && (
				/*
				 * Pinned to the pane's top edge, in the flow rather than over it: it
				 * takes its own row and no row of the conversation is ever painted
				 * under it. `shrink-0` so a tall neighbour cannot squeeze it away, and
				 * the same horizontal inset as the scroller's own padding so the two
				 * share a centre.
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
				 * agreeing with the property it stood for, so the property is read directly.
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
				tabIndex={transcript.records.length === 0 ? -1 : 0}
				role="log"
				aria-label="Conversation transcript"
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
				<div
					data-lo-transcript-content
					className={cn("flex flex-col", CHAT_MEASURE)}
				>
					{/* The state this element exists for: no rows yet, and the stream is
				    still bringing them. Rendered inside the content column so it lands
				    at the same inset and the same bottom anchor the rows will, rather
				    than at the pane's centre in the composer band. */}
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
				    slot is one fixed-height row either way. */}
					{/* NOT while the paint is cached: a cache entry carries no paging
				    cursor (its rows are trimmed), which the slot reads as `exhausted`
				    and says "Start of conversation" over a transcript that may be a
				    thousand messages in. Measured on a captured frame, not inferred.
				    The caption above already says the view is not authoritative. */}
					{transcript.records.length > 0 && !stale && !missing && (
						<OlderHistorySlot
							state={slotState}
							hiddenRows={hidden}
							// A retry cannot succeed while the transport is down, and the
							// transcript's own notice below already explains why. The slot
							// drops its gesture hint rather than stacking a second claim on
							// top of that one.
							transportDown={status !== "live"}
							onLoadOlder={requestOlder}
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
						<div
							className={cn(
								"mb-4 flex flex-col gap-2",
								!isSmallView && AGENT_GUTTER,
							)}
						>
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
				    no state to reconcile to. */}
					{!missing && (
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
							{visible.map((row) => (
								<TranscriptRow
									key={row.record.id}
									row={row}
									isSmallView={isSmallView}
									nameColumn={nameColumn}
									scope={mediaScope}
									conversationId={conversationId}
								/>
							))}
						</CanvasPaneProvider>
					)}

					{working && (
						// On the `item` tier, not a tier of its own: the working line is
						// the foot of the run above it and shares that run's rhythm. It
						// takes slightly more than `trace` because it is the one row that
						// is not a completed action, and slightly less than a turn
						// boundary because the turn has not ended.
						<div
							className={cn(
								GAP.item[isSmallView ? 1 : 0],
								!isSmallView && AGENT_GUTTER,
							)}
						>
							<WorkingLine
								activity={working.activity}
								phase={working.phase}
								startedAt={working.startedAt}
								clock={working.clock}
							/>
						</div>
					)}

					{/* Tier 1: the pending gate is always last while it is actionable. */}
					{gate && (
						<div className={cn("mt-6", !isSmallView && AGENT_GUTTER)}>
							<AgentQuestion
								/*
								 * The eyebrow says what is happening, and the options are disabled
								 * for both halves of that: an answer on its way, and an answer this
								 * gate already took (the hold). Binding the eyebrow to only the
								 * second half of the options' own condition left the committed
								 * in-flight story frame reading "Waiting for your answer" over a
								 * card whose every option was disabled — two bindings, two
								 * claims, one frame (design round 2, D7). The product switches
								 * correctly on the live surface (UX round 2, U2, six samples over
								 * a held window); the story drove `answering` and disagreed with
								 * itself.
								 */
								busy={answering || Boolean(answer?.sending)}
								content={
									gate.detail
										? `**${gate.title}**\n\n${gate.detail}`
										: gate.title
								}
							/>
							{gate.kind === "ask" && (
								<AskOptions
									options={gate.options}
									recommended={gate.recommended}
									requestId={gate.request_id}
									// One answer in flight at a time, and the card holds itself
									// disabled after a press until the gate itself moves: `admitting`
									// is the composer's shared flag, and `answer` is this panel's own
									// record that it already answered this gate.
									busy={answering || answer !== null}
									onAnswer={(label) => onAnswer?.(label)}
								/>
							)}
							<p className="mt-2 text-ink-dim text-meta">
								{gate.kind === "approval"
									? /*
										 * BOTH exits, because a parked card has two and used to
										 * name one (UX round 1, U2). Escape aborts the WHOLE
										 * turn - measured: the card clears, the turn ends
										 * `aborted`, the transcript keeps no denial - so the
										 * sentence promises the turn's stop exactly as the
										 * composer's Stop control does. On a paired backend that
										 * predates the control Escape does nothing, and the
										 * composer says so while the turn runs; the card stays
										 * unconditional rather than reading the capability a
										 * second time, which is a copy decision the UX round can
										 * revisit if the skew window ever outlives the fix.
										 */
										"Reply yes or no in the composer, or press Escape to stop the turn."
									: /*
										 * The hint names the new affordance first and keeps the
										 * free-text path honest, because both are real: the
										 * options are never guaranteed exhaustive (the terminal
										 * card carries an explicit free-text row for exactly this
										 * reason), and a `secret` ask renders no options at all,
										 * where the composer is the only answer path.
										 *
										 * The digits are named because they work and nothing said
										 * so: the card draws `1.` `2.` `3.` and typing one resolves
										 * to that label, which is a shortcut a reader of the card
										 * cannot otherwise discover. The TUI teaches its own
										 * digits in a footer legend; this is the same sentence in
										 * the one line this card has (UX round 1, U6).
										 */
										[
											gate.question_total > 1
												? `Question ${gate.question_index + 1} of ${gate.question_total}.`
												: null,
											/*
											 * "type 1-9 and send", not "press 1-9": a digit on its own does
											 * nothing. It is typed into the composer and only sending resolves
											 * it, so the hint describes the two presses the shortcut actually
											 * takes (UX round 2, U10).
											 */
											gate.options.length > 0
												? "Choose an option, type 1-9 and send, or type your own answer below."
												: "Type your answer below.",
										]
											.filter(Boolean)
											.join(" ")}
							</p>
							{/*
							 * A refused answer, on the card the press was made on.
							 *
							 * The round-1 finding was that a rejected press reported itself in
							 * the composer's alert, in backend vocabulary ("this question is no
							 * longer pending"), after the card it referred to had gone; and that
							 * a second press repeated it because the card was still enabled
							 * (QA round 1, Q3; UX round 1, U4). The sentence is outcome-first
							 * and the card stays held, so there is nothing to press twice.
							 *
							 * `output`, not a `p` with `role="status"`: the element carries that
							 * role implicitly, so the announcement survives without an ARIA
							 * attribute restating what the tag already says.
							 */}
							{answer?.refused && (
								<output className="mt-2 block text-body-sm text-danger">
									{answer.refused}
								</output>
							)}
						</div>
					)}

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
	);
};
