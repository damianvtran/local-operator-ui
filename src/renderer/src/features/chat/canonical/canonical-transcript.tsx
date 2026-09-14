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
import { MessageTimestamp } from "../components/message-item/message-timestamp";
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
import { ToolDetail } from "../components/trace/tool-detail";
import { hasDetail } from "../components/trace/tool-detail-model";
import { ToolRow as ToolLedgerRow } from "../components/trace/tool-row";
import {
	displayName,
	formatBytes,
	isBareToolName,
	isDiffBodyRow,
	outputFallbackLine,
	summaryFromArgs,
	toolNameColumn,
} from "../components/trace/tool-row-model";
import { WorkingLine } from "../components/trace/working-line";
import { CanonicalImage } from "./canonical-image";
import { OLDER_HISTORY_HINT_ID, OlderHistorySlot } from "./older-history-slot";
import {
	type CanonicalTranscriptStatus,
	transcriptPaneCollapses,
	transcriptPaneHoldsPlaceholder,
} from "./transcript-pane";
import { TranscriptPlaceholder } from "./transcript-placeholder";
import {
	type TranscriptRecord,
	type TranscriptState,
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
import { useScrollPaging } from "./use-scroll-paging";

/**
 * Opts the USER bubble into the reading measure defined in `markdown.css`.
 *
 * Agent-side prose deliberately does not take it. It resolves against the row
 * content box instead, so it shares one left edge and one right edge with the
 * tool rows of the same turn — see the measure comment in `markdown.css` for
 * the operator report that requires it and the numbers behind it.
 */
const MEASURE = "lo-measured";

const WINDOW = 60;
const WINDOW_STEP = 60;

export type CanonicalTranscriptProps = {
	frontend?: CanonicalFrontendState | null;
	transcript: TranscriptState;
	gate: PendingDesktopGate | null;
	/** The owner is generating and nothing has painted yet for this turn. */
	waiting: boolean;
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
	 * Has the durable history been READ for this conversation?
	 *
	 * The hold stand-down below asks this and not `status`, because the two
	 * disagree in both directions on this path: `Retry` re-arms the stream as
	 * `connecting` in front of a conversation a completed read has already proven
	 * EMPTY, and a cold session's `cursor_missing` snapshot goes `live` without
	 * ever hydrating. Required rather than defaulted, like `onReconnect`: the
	 * caller that owns the reader is the only thing that can answer it, and a
	 * default would let a new call site collapse a conversation nobody has read
	 * yet. The rule and its two failing shapes live in
	 * `transcriptPaneHoldsPlaceholder`.
	 */
	hydrated: boolean;

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
}: {
	record: Extract<TranscriptRecord, { kind: "user" }>;
	isSmallView: boolean;
	scope: AttachmentScope | null;
}) {
	return (
		<MessageContainer isUser isSmallView={isSmallView}>
			<div className="group relative flex w-full justify-end">
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
					<div className={cn("relative", MEASURE)}>
						<MarkdownRenderer content={record.text} />
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
			</div>
		</MessageContainer>
	);
});

const AssistantRow = memo(function AssistantRow({
	record,
	isSmallView,
	showAvatar,
}: {
	record: Extract<TranscriptRecord, { kind: "assistant" }>;
	isSmallView: boolean;
	showAvatar: boolean;
}) {
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
				className={cn("group relative w-full break-words text-ink")}
				aria-busy={record.streaming || undefined}
				data-lo-streaming={record.streaming || undefined}
			>
				<MarkdownRenderer
					content={record.text}
					className={cn(refused && "[--md-ink:var(--lo-danger)]")}
					styleProps={{
						fontSize: isSmallView ? "var(--text-body-sm)" : "var(--text-body)",
						lineHeight: 1.6,
					}}
				/>
				{record.stopReason === "aborted" && (
					<p className="mt-1 text-ink-dim text-meta">
						Stopped before finishing
					</p>
				)}
			</div>
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
	const summary = composing
		? `composing${record.argumentBytes ? ` · ${formatBytes(record.argumentBytes)}` : ""}`
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
	const details =
		// The TUI's body-selection case 2 (`_build_content`, tool_card.py:1928-1939):
		// when a settled, SUCCESSFUL `write`/`edit` reported a diff, the expansion is
		// the DIFF ALONE. The arguments of a `write` are the whole new file content —
		// the same change stated a second way — and the output line underneath is
		// `edited` or `wrote N bytes`, which says nothing the diff does not. The
		// mobile port drops the same two for the same tools
		// (mobile/web/src/components/tool-row.tsx:95-96, 179-182).
		//
		// The three conditions live in `isDiffBodyRow` so they can be tested: the
		// tool, the payload, and the call's own state. A row with no diff keeps its
		// arguments, which is the honest shape for a call that changed nothing
		// (`_diff_details` omits `diff` entirely when `_line_delta` is zero) and for a
		// transcript predating `details` on the wire; a row that FAILED keeps them
		// too, because there the arguments are the only account of what was attempted
		// and the error only makes sense beside them.
		isDiffBodyRow(record) ? (
			<DiffBlock diff={record.diff} />
		) : hasDetail(record.args, record.output) ? (
			<ToolDetail
				args={record.args}
				output={record.output}
				isError={record.isError}
			/>
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
					running
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
 * `peer` has no entry in `tool-row-model.CATEGORIES`, which is deliberate: the
 * `plain` fallback gives the name column `text-ink-muted`, the same ink the
 * TUI's own peer row paints it in. Giving it `meta` would buy it the accent and
 * make a receipt louder than the calls around it.
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
 * rather than instructions addressed to the model.
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
}: {
	row: Row;
	isSmallView: boolean;
	nameColumn: number;
	scope: AttachmentScope | null;
}) {
	rowRenderCount.current += 1;
	const { record } = row;
	let body: JSX.Element | null;
	switch (record.kind) {
		case "user":
			body = (
				<UserRow record={record} isSmallView={isSmallView} scope={scope} />
			);
			break;
		case "assistant":
			body = (
				<AssistantRow
					record={record}
					isSmallView={isSmallView}
					showAvatar={row.showAvatar}
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

export const CanonicalTranscript: FC<CanonicalTranscriptProps> = ({
	frontend,
	transcript,
	gate,
	waiting,
	loadingOlder,
	onLoadOlder,
	containerRef,
	isSmallView,
	status,
	failure,
	hydrated,
	attachmentScope,
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
	 * So the hold asks `hydrated` and NOT `status`, and the distance between the
	 * two is the whole of the pre-merge resolution check's Finding 1. They
	 * disagree in both directions on this path: `Retry` re-arms the stream as
	 * `connecting` in front of a conversation a completed read has already proven
	 * EMPTY (`use-canonical-session.ts` leaves `hydrated` untouched), and a cold
	 * session's `cursor_missing` snapshot goes `live` without hydrating. Keyed on
	 * the transport's word the pane held "Loading conversation…" over a
	 * conversation known to hold nothing while the band took the greeting and its
	 * own `grow`, two contradictory claims splitting one column until the
	 * snapshot landed and the composer dropped to the empty-chat position -- the
	 * 468px -> 736px move this work exists to remove -- and the mirror state (not
	 * yet read, already `live`) left no loading claim anywhere. Both directions
	 * are pinned in `scripts/session-switch.test.mjs`.
	 *
	 * THE DECISION IS A MATRIX, NOT A CASE. A row-less pane has exactly one claim
	 * to make, and the rule over all four of its inputs lives in `transcript-pane.ts`,
	 * where a node test walks every combination rather than the directions a defect
	 * happened to be found in. It reads: the pane HOLDS the placeholder exactly
	 * while the reader has not been told what the conversation holds, there is
	 * nothing to scroll, AND the pane has nothing of its own to say.
	 *
	 * The statement term is there because a pane can be speaking while nobody has
	 * read it: the failure notice (`unavailable` with a published failure, which the
	 * history-read arm publishes with `hydrated` still false by construction) and the
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
	 * The three facts stay separate and none implies another: a hydrated
	 * `reconnecting` or `unavailable` pane has rows or a statement to show, an
	 * unhydrated `connecting` pane has no statement of its own, and a pane with rows
	 * paints them whatever its stream is doing. The collapse therefore stands down
	 * for all three, and happens only in the one row where none of them is true.
	 *
	 * `records` rather than `rows` because a record that renders to no row is still
	 * nothing to scroll. The legacy twin (`MessagesView`) already does this with its
	 * `collapsed` branch; the two paths change together so neither keeps the defect.
	 */
	const paneView = {
		status,
		failure,
		hydrated,
		recordCount: transcript.records.length,
	};
	const holdPlaceholder = transcriptPaneHoldsPlaceholder(paneView);
	const collapsed = transcriptPaneCollapses(paneView);

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
				`commits=${commits.current} rowRenders=${rowRenderCount.current} rows=${visible.length} flushes=${flushes.length} flushP50=${p50.toFixed(2)}ms flushMax=${max.toFixed(2)}ms`,
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

	const lastRecord = transcript.records[transcript.records.length - 1];

	// What the working line says, and which phase it is timing.
	//
	// Every branch is a fact the backend actually sent. `intent` rides
	// `tool_execution_start` and is already on the tool record; a streaming
	// assistant record IS what "responding" means; and `thinking` is the default
	// for a model call in flight with nothing on the ledger to show for it. The
	// vocabulary is the harness's own (`harness/intent.py`), so a reader who
	// learned it in the terminal does not learn it again here.
	//
	// The PHASE is coarser than the label on purpose: a batch of three calls is
	// one phase however many times its phrase is re-derived as calls settle, so
	// the clock keeps counting instead of resetting to `0s` under the reader.
	const working = useMemo(() => {
		if (!waiting || gate) return null;
		const runningTools = transcript.records.filter(
			(record) => record.kind === "tool" && record.phase === "running",
		) as Extract<TranscriptRecord, { kind: "tool" }>[];
		if (runningTools.length > 0) {
			// One call states its own purpose; a batch states a COUNT. Presenting
			// one call's intent as the whole batch's activity is a claim the rows
			// above it immediately contradict, and the count is the one fact this
			// line has that appears nowhere else on screen.
			const activity =
				runningTools.length === 1
					? (runningTools[0].intent ??
						`running ${displayName(runningTools[0].toolName)}`)
					: `running ${runningTools.length} tools`;
			return { activity, phase: "running" };
		}
		const composing = transcript.records.filter(
			(record) => record.kind === "tool" && record.phase === "composing",
		).length;
		if (composing > 0) {
			// The tool's NAME is deliberately absent: it arrives in fragments, and
			// `composing wr` reads as a typo rather than as a state.
			return {
				activity: `composing ${composing === 1 ? "a call" : `${composing} calls`}`,
				phase: "composing",
			};
		}
		const tail = transcript.records[transcript.records.length - 1];
		if (tail?.kind === "assistant" && tail.streaming) {
			// Only once prose is ACTUALLY streaming. `message_start` fires from a
			// placeholder at the top of every provider call, before the first
			// token, so flipping on it would claim the model is writing for the
			// whole of every turn — which is why the record's own `text` is the
			// trigger here, not its existence.
			if (tail.text) return { activity: "responding", phase: "responding" };
		}
		return { activity: "thinking", phase: "thinking" };
	}, [waiting, gate, transcript.records]);

	return (
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
				CHAT_COLUMN_CONTAINER,
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
				{holdPlaceholder && <TranscriptPlaceholder isSmallView={isSmallView} />}
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
				{transcript.records.length > 0 && (
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

				{visible.map((row) => (
					<TranscriptRow
						key={row.record.id}
						row={row}
						isSmallView={isSmallView}
						nameColumn={nameColumn}
						scope={mediaScope}
					/>
				))}

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
						<WorkingLine activity={working.activity} phase={working.phase} />
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
								gate.detail ? `**${gate.title}**\n\n${gate.detail}` : gate.title
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
								? "Reply yes or no in the composer."
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
				{lastRecord && (
					<div className="mt-1 flex justify-end">
						<MessageTimestamp timestamp={new Date(lastRecord.ts)} />
					</div>
				)}
			</div>
		</div>
	);
};
