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
 *   scrolling up widens the window in batches — the same shape the legacy
 *   view uses, so the scroll container's `column-reverse` overflow anchor
 *   keeps the reader pinned.
 * - `performance.mark("lop:transcript:render")` per commit lets the numbers
 *   be read from the browser rather than asserted.
 *
 * Autoscroll is never taken from the reader: `column-reverse` plus the
 * overflow anchor keeps the newest content pinned only when they are already
 * at the bottom; the composer's "New activity" affordance covers the rest.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
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
import { CHAT_COLUMN_CONTAINER, CHAT_MEASURE } from "../chat-measure";
import { MarkdownRenderer } from "../components/markdown-renderer";
import { ErrorBlock } from "../components/message-item/error-block";
import {
	AGENT_GUTTER,
	MessageContainer,
} from "../components/message-item/message-container";
import { MessageTimestamp } from "../components/message-item/message-timestamp";
import { OutputBlock } from "../components/message-item/output-block";
import { AgentQuestion, TraceLine } from "../components/trace";
import { ToolRow as ToolLedgerRow } from "../components/trace/tool-row";
import {
	displayName,
	isBareToolName,
	summaryFromArgs,
	toolNameColumn,
} from "../components/trace/tool-row-model";
import { TraceGlyph } from "../components/trace/trace-rail";
import { WorkingLine } from "../components/trace/working-line";
import { CanonicalImage } from "./canonical-image";
import {
	type TranscriptRecord,
	type TranscriptState,
	withRecoveredOutcome,
} from "./transcript-reducer";
import { GAP, type Row, buildRows, paintsSomething } from "./transcript-rows";

/** Opts prose into the ~72-character measure defined in `markdown.css`. */
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
	onLoadOlder: () => void;
	containerRef: RefObject<HTMLDivElement>;
	isSmallView: boolean;

	status: "connecting" | "live" | "reconnecting" | "unavailable";
	error: string | null;
};

// ---------------------------------------------------------------- rows

const UserRow = memo(function UserRow({
	record,
	isSmallView,
	sessionId,
}: {
	record: Extract<TranscriptRecord, { kind: "user" }>;
	isSmallView: boolean;
	sessionId: string | null;
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
										sessionId={sessionId}
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
			<div
				className={cn("group relative w-full break-words text-ink", MEASURE)}
				aria-busy={record.streaming || undefined}
				data-lo-streaming={record.streaming || undefined}
			>
				{record.text ? (
					<MarkdownRenderer
						content={record.text}
						className={cn(refused && "[--md-ink:var(--lo-danger)]")}
						styleProps={{
							fontSize: isSmallView
								? "var(--text-body-sm)"
								: "var(--text-body)",
							lineHeight: 1.6,
						}}
					/>
				) : (
					// Streaming but no text yet: the model is on the wire. One quiet
					// present-tense line at the trace tier, not a spinner card.
					<span className="flex items-center gap-2 text-ink-dim text-meta">
						<TraceGlyph />
						Writing
					</span>
				)}
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
	sessionId,
}: {
	record: Extract<TranscriptRecord, { kind: "tool" }>;
	isSmallView: boolean;
	showAvatar: boolean;
	nameColumn: number;
	sessionId: string | null;
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
			? firstLine(record.output)
			: null;
	const details =
		record.output || record.args ? (
			<>
				{record.args && (
					<pre
						className={cn(
							"mb-3 max-h-[240px] overflow-auto rounded-sm border border-hairline bg-sunken p-3 font-mono text-ink-muted text-mono-sm",
						)}
					>
						{JSON.stringify(record.args, null, 2)}
					</pre>
				)}
				{record.output &&
					(record.isError ? (
						<ErrorBlock error={record.output} isUser={false} />
					) : (
						<OutputBlock output={record.output} isUser={false} />
					))}
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
						sessionId={sessionId}
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

/**
 * The first non-empty line of a tool's output, bounded so it stays a summary.
 *
 * One line because the object column is one line: a multi-line result would be
 * truncated by CSS anyway, and taking the first line explicitly means the row
 * shows a whole thought rather than a fragment cut mid-word by the layout. The
 * cap matches what fits at the widest sensible column, so a 4 KB `bash` result
 * cannot push a long string through the truncation machinery on every render.
 */
function firstLine(output: string | null): string | null {
	if (!output) return null;
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed.slice(0, 160);
	}
	return null;
}

function formatBytes(count: number) {
	return count >= 1024 ? `${(count / 1024).toFixed(1)} KiB` : `${count} B`;
}

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
	const level = record.kind === "notice" ? record.level : ("info" as const);
	const Icon =
		level === "error"
			? CircleAlert
			: level === "warning"
				? TriangleAlert
				: record.kind === "custom"
					? MessageSquareText
					: Info;
	const label =
		record.kind === "custom" ? record.customType.replace(/_/g, " ") : undefined;
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
	const long = record.text.length > 400 || record.text.includes("\n");
	return (
		<MessageContainer isUser={false} isSmallView={isSmallView}>
			<TraceLine
				// Same column as the tool rows, so the same pitch: a notice must not
				// be the row that makes a run look ragged.
				dense={!long}
				verbOverride={label ?? (long ? "Notice" : record.text)}
				narration={label && !long ? record.text : undefined}
				failed={level === "error"}
				// The row carries the whole message when it is not collapsed, so
				// it must not be clipped to the rail width.
				wrap={!long}
				glyph={<Icon />}
				details={
					long ? (
						<p className="whitespace-pre-wrap text-body-sm text-ink-muted">
							{record.text}
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
	sessionId,
}: {
	row: Row;
	isSmallView: boolean;
	nameColumn: number;
	sessionId: string | null;
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
					sessionId={sessionId}
				/>
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
					sessionId={sessionId}
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
	error,
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
	useCompletionView(
		frontend,
		status === "live" && !waiting && !loadingOlder,
		containerRef,
	);
	const previousRows = useRef<Row[]>([]);
	const rows = useMemo(() => {
		const next = buildRows(painted.records, previousRows.current);
		previousRows.current = next;
		return next;
	}, [painted.records]);
	// Windowing: newest rows first. The window widens when the reader nears the
	// top, and resets when the transcript is replaced (session switch/clear).
	const [windowSize, setWindowSize] = useState(WINDOW);
	const total = rows.length;
	const visible = useMemo(
		() => (total > windowSize ? rows.slice(total - windowSize) : rows),
		[rows, total, windowSize],
	);
	const hidden = total - visible.length;

	/*
	 * An empty transcript must not claim the column's free space.
	 *
	 * This scroller carries `grow` so it absorbs the leftover height between
	 * the header and the composer. With rows in it that is the whole point.
	 * With NO rows it is an empty box that still votes for all the free space,
	 * and the composer band below -- which renders the greeting, the composer
	 * and the suggestion chips on exactly that condition -- is left pinned to
	 * the bottom under a large dark void.
	 *
	 * So the two are decided by one fact: when there is nothing to scroll, this
	 * element collapses out of the vertical layout and the band grows into the
	 * column and centres its group instead. `records` rather than `rows`
	 * because a record that renders to no row is still nothing to scroll.
	 *
	 * The legacy twin (`MessagesView`) already does this with its `collapsed`
	 * branch; the two paths change together so neither keeps the defect.
	 */
	const collapsed = transcript.records.length === 0;

	useEffect(() => {
		const container = containerRef.current;
		if (!container || hidden <= 0) return;
		const onScroll = () => {
			const { scrollTop, scrollHeight, clientHeight } = container;
			// column-reverse: scrollTop is negative going up; distance to the top
			// edge of the content is what remains.
			const distanceFromTop = scrollHeight - clientHeight - Math.abs(scrollTop);
			if (distanceFromTop < 320) {
				setWindowSize((current) => Math.min(total, current + WINDOW_STEP));
			}
		};
		container.addEventListener("scroll", onScroll, { passive: true });
		return () => container.removeEventListener("scroll", onScroll);
	}, [containerRef, hidden, total]);

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

	// The shared name column: sized to the longest tool name ON SCREEN, between
	// the TUI's 8ch floor and 24ch ceiling. Derived from the visible window
	// rather than the whole transcript, so scrolling to a run of `bash` rows
	// does not keep paying for an `mcp__…` name a thousand rows back.
	const nameColumn = useMemo(
		() =>
			toolNameColumn(
				visible
					.map((row) =>
						row.record.kind === "tool" ? displayName(row.record.toolName) : "",
					)
					.filter(Boolean),
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
			<div className={cn("flex flex-col", CHAT_MEASURE)}>
				{/* Older rows: durable pages, then the local window. */}
				{(transcript.hasMore || hidden > 0) && (
					<div className="mb-4 flex justify-center">
						{hidden > 0 ? (
							<span className="text-ink-dim text-meta">
								{hidden} earlier {hidden === 1 ? "row" : "rows"} above
							</span>
						) : (
							<Button
								variant="ghost"
								size="sm"
								onClick={onLoadOlder}
								disabled={loadingOlder}
							>
								{loadingOlder ? (
									<>
										<Spinner size="sm" />
										Loading earlier messages
									</>
								) : (
									"Load earlier messages"
								)}
							</Button>
						)}
					</div>
				)}

				{status === "unavailable" && error && (
					<p className="mb-4 text-danger text-meta">{error}</p>
				)}
				{status === "reconnecting" && (
					<p className="mb-4 text-ink-dim text-meta">Reconnecting</p>
				)}

				{visible.map((row) => (
					<TranscriptRow
						key={row.record.id}
						row={row}
						isSmallView={isSmallView}
						nameColumn={nameColumn}
						sessionId={sessionId}
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
							content={
								gate.detail ? `**${gate.title}**\n\n${gate.detail}` : gate.title
							}
						/>
						{gate.kind === "ask" && gate.options.length > 0 && (
							<ul className="mt-2 flex flex-col gap-1 pl-1">
								{gate.options.map((option, index) => (
									<li
										key={`${gate.request_id}-${String(index)}`}
										className="text-body-sm text-ink-muted"
									>
										<span className="font-mono text-ink-dim text-mono-sm">
											{index + 1}.
										</span>{" "}
										{option.label}
										{option.description ? ` — ${option.description}` : ""}
									</li>
								))}
							</ul>
						)}
						<p className="mt-2 text-ink-dim text-meta">
							{gate.kind === "approval"
								? "Reply yes or no in the composer."
								: gate.question_total > 1
									? `Question ${gate.question_index + 1} of ${gate.question_total}. Type your answer below.`
									: "Type your answer below."}
						</p>
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
