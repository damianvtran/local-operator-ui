/**
 * The canonical transcript view.
 *
 * Paints `TranscriptRecord`s from the canonical session stream by the
 * docs/branding.md § 7 hierarchy, most prominent first:
 *
 *   1. the pending gate (a question for the user) — `AgentQuestion`, last;
 *   2. assistant prose at reading weight, no paper;
 *   3. one quiet trace line per tool action (`TraceLine`), running state on
 *      the line itself, never a spinner beside it;
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
import type { PendingDesktopGate } from "../../../../../shared/desktop-session-contract";
import { MarkdownRenderer } from "../components/markdown-renderer";
import { ErrorBlock } from "../components/message-item/error-block";
import {
	AGENT_GUTTER,
	MessageContainer,
} from "../components/message-item/message-container";
import { MessageTimestamp } from "../components/message-item/message-timestamp";
import { OutputBlock } from "../components/message-item/output-block";
import { AgentQuestion, TraceLine } from "../components/trace";
import { TraceGlyph } from "../components/trace/trace-rail";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/** Opts prose into the ~72-character measure defined in `markdown.css`. */
const MEASURE = "lo-measured";
const WINDOW = 60;
const WINDOW_STEP = 60;

export type CanonicalTranscriptProps = {
	transcript: TranscriptState;
	gate: PendingDesktopGate | null;
	/** The owner is generating and nothing has painted yet for this turn. */
	waiting: boolean;
	loadingOlder: boolean;
	onLoadOlder: () => void;
	containerRef: RefObject<HTMLDivElement>;
	isSmallView: boolean;
	/** Session is cold (no live owner); shown once, quietly. */
	cold: boolean;
	status: "connecting" | "live" | "reconnecting" | "unavailable";
	error: string | null;
};

// ---------------------------------------------------------------- rows

const UserRow = memo(function UserRow({
	record,
	isSmallView,
}: {
	record: Extract<TranscriptRecord, { kind: "user" }>;
	isSmallView: boolean;
}) {
	return (
		<MessageContainer isUser isSmallView={isSmallView}>
			<div className="group relative flex w-full justify-end">
				<div
					className={cn(
						"relative rounded-frame border border-hairline bg-surface text-ink break-words",
						isSmallView ? "max-w-[92%] px-3 py-2" : "max-w-[75%] px-4 py-3",
					)}
				>
					<div className={cn("relative", MEASURE)}>
						<MarkdownRenderer content={record.text} />
						{record.images > 0 && (
							<p className="mt-1 text-ink-dim text-meta">
								{record.images === 1
									? "1 image attached"
									: `${record.images} images attached`}
							</p>
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
	// A tool-only assistant message has nothing to say; its tool rows carry
	// the turn. Rendering an empty paragraph would leave a phantom gap.
	if (!record.text && !record.streaming) return null;
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

/** Names the action in the user's terms; the tool name is the object. */
const TOOL_VERBS: Record<string, { done: string; running: string }> = {
	bash: { done: "Ran", running: "Running" },
	read: { done: "Read", running: "Reading" },
	write: { done: "Wrote", running: "Writing" },
	edit: { done: "Edited", running: "Editing" },
	glob: { done: "Found files", running: "Finding files" },
	grep: { done: "Searched", running: "Searching" },
	web_search: { done: "Searched the web", running: "Searching the web" },
	web_fetch: { done: "Fetched", running: "Fetching" },
	eval: { done: "Ran code", running: "Running code" },
	task: { done: "Delegated work", running: "Delegating work" },
	browser: { done: "Used the browser", running: "Using the browser" },
	todo: { done: "Updated the plan", running: "Updating the plan" },
	ask: { done: "Asked", running: "Asking" },
};

/**
 * The machine-voice object for a tool row: the path, URL, pattern or command
 * it touched. A tool with no such argument has no object; the verb already
 * names it ("Used echo"), so repeating the name would read as a stutter.
 */
function toolObject(record: Extract<TranscriptRecord, { kind: "tool" }>) {
	const args = record.args ?? {};
	for (const key of ["path", "file_path", "url", "pattern", "command"]) {
		const value = args[key];
		if (typeof value === "string" && value) {
			return value.length > 96 ? `${value.slice(0, 93)}...` : value;
		}
	}
	return TOOL_VERBS[record.toolName] ? record.toolName : undefined;
}

const ToolRow = memo(function ToolRow({
	record,
	isSmallView,
	showAvatar,
}: {
	record: Extract<TranscriptRecord, { kind: "tool" }>;
	isSmallView: boolean;
	showAvatar: boolean;
}) {
	const verbs = TOOL_VERBS[record.toolName] ?? {
		done: `Used ${record.toolName || "a tool"}`,
		running: `Using ${record.toolName || "a tool"}`,
	};
	const running = record.phase !== "done";
	const composing = record.phase === "composing";
	// While the model is still dictating arguments there is no object yet;
	// the byte count is the only honest progress signal (see the backend's
	// ToolCallComposeEvent docstring).
	const narration = composing
		? (record.intent ??
			`writing the request${record.argumentBytes ? `, ${formatBytes(record.argumentBytes)}` : ""}`)
		: (record.intent ?? undefined);
	const object = composing ? undefined : toolObject(record);
	const details =
		record.output || record.args ? (
			<>
				{record.args && (
					<pre className="mb-3 max-h-[240px] overflow-auto rounded-sm border border-hairline bg-sunken p-3 font-mono text-ink-muted text-mono-sm">
						{JSON.stringify(record.args, null, 2)}
					</pre>
				)}
				{record.output &&
					(record.isError ? (
						<ErrorBlock error={record.output} isUser={false} />
					) : (
						<OutputBlock output={record.output} isUser={false} />
					))}
				{record.durationS !== null && (
					<p className="text-ink-dim text-meta">
						{record.durationS < 1
							? "under a second"
							: `${record.durationS.toFixed(1)}s`}
					</p>
				)}
			</>
		) : undefined;
	return (
		<MessageContainer
			isUser={false}
			isSmallView={isSmallView}
			showAvatar={showAvatar}
		>
			<TraceLine
				verbOverride={running ? verbs.running : verbs.done}
				object={object}
				narration={narration}
				running={running}
				failed={record.isError}
				details={details}
			/>
		</MessageContainer>
	);
});

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
	// (when long) behind the same disclosure idiom as a tool's output.
	const long = record.text.length > 160 || record.text.includes("\n");
	return (
		<MessageContainer isUser={false} isSmallView={isSmallView}>
			<TraceLine
				verbOverride={label ?? (long ? "Notice" : record.text)}
				narration={label && !long ? record.text : undefined}
				failed={level === "error"}
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

type Row = {
	record: TranscriptRecord;
	showAvatar: boolean;
	/** Vertical tier before this row, from `utils/message-grouping`'s ramp. */
	gap: "turn" | "item" | "trace" | "first";
};

function buildRows(records: TranscriptRecord[]): Row[] {
	const rows: Row[] = [];
	let previous: TranscriptRecord | null = null;
	for (const record of records) {
		const traceLike =
			record.kind === "tool" ||
			record.kind === "notice" ||
			record.kind === "compaction" ||
			record.kind === "custom";
		const previousTrace =
			previous &&
			(previous.kind === "tool" ||
				previous.kind === "notice" ||
				previous.kind === "compaction" ||
				previous.kind === "custom");
		const agentSide = record.kind !== "user";
		const previousAgent = previous !== null && previous.kind !== "user";
		const showAvatar = agentSide && !previousAgent;
		let gap: Row["gap"] = "item";
		if (!previous) gap = "first";
		else if (record.kind === "user" || previous.kind === "user") gap = "turn";
		else if (traceLike && previousTrace) gap = "trace";
		rows.push({ record, showAvatar, gap });
		previous = record;
	}
	return rows;
}

const GAP: Record<Row["gap"], [string, string]> = {
	first: ["", ""],
	turn: ["mt-6", "mt-4"],
	item: ["mt-3", "mt-2"],
	trace: ["mt-1", "mt-0.5"],
};

const TranscriptRow = memo(function TranscriptRow({
	row,
	isSmallView,
}: {
	row: Row;
	isSmallView: boolean;
}) {
	const { record } = row;
	let body: JSX.Element | null;
	switch (record.kind) {
		case "user":
			body = <UserRow record={record} isSmallView={isSmallView} />;
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
			className={cn(GAP[row.gap][isSmallView ? 1 : 0])}
		>
			{body}
		</div>
	);
});

export const CanonicalTranscript: FC<CanonicalTranscriptProps> = ({
	transcript,
	gate,
	waiting,
	loadingOlder,
	onLoadOlder,
	containerRef,
	isSmallView,
	cold,
	status,
	error,
}) => {
	const rows = useMemo(
		() => buildRows(transcript.records),
		[transcript.records],
	);
	// Windowing: newest rows first. The window widens when the reader nears the
	// top, and resets when the transcript is replaced (session switch/clear).
	const [window, setWindow] = useState(WINDOW);
	const total = rows.length;
	const visible = useMemo(
		() => (total > window ? rows.slice(total - window) : rows),
		[rows, total, window],
	);
	const hidden = total - visible.length;

	useEffect(() => {
		const container = containerRef.current;
		if (!container || hidden <= 0) return;
		const onScroll = () => {
			const { scrollTop, scrollHeight, clientHeight } = container;
			// column-reverse: scrollTop is negative going up; distance to the top
			// edge of the content is what remains.
			const distanceFromTop = scrollHeight - clientHeight - Math.abs(scrollTop);
			if (distanceFromTop < 320) {
				setWindow((current) => Math.min(total, current + WINDOW_STEP));
			}
		};
		container.addEventListener("scroll", onScroll, { passive: true });
		return () => container.removeEventListener("scroll", onScroll);
	}, [containerRef, hidden, total]);

	// Measurement hook: one mark per commit of this list. Read with
	// performance.getEntriesByName("lop:transcript:render").
	const commits = useRef(0);
	useLayoutEffect(() => {
		commits.current += 1;
		performance.mark("lop:transcript:render", {
			detail: { rows: visible.length, commit: commits.current },
		});
	});

	const lastRecord = transcript.records[transcript.records.length - 1];
	const lastIsLiveAssistant =
		lastRecord?.kind === "assistant" && lastRecord.streaming;
	const lastIsRunningTool =
		lastRecord?.kind === "tool" && lastRecord.phase !== "done";
	const showWaiting =
		waiting && !lastIsLiveAssistant && !lastIsRunningTool && !gate;

	return (
		<div
			ref={containerRef}
			data-lo-canonical-transcript={true}
			className={cn(
				"relative flex h-full w-full grow flex-col-reverse overflow-auto p-4 will-change-[scroll-position] [overflow-anchor:auto] [transform:translateZ(0)]",
			)}
		>
			<div className="mx-auto flex w-full max-w-[900px] flex-col sm:max-w-[90%] md:max-w-[900px]">
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
					/>
				))}

				{showWaiting && (
					<div className={cn("mt-3", !isSmallView && AGENT_GUTTER)}>
						<span className="flex items-center gap-2 text-ink-dim text-meta">
							<TraceGlyph />
							Thinking
						</span>
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

				{cold && total === 0 && status === "live" && (
					<p className="mt-2 text-ink-dim text-meta">
						No messages yet. The conversation starts when you send one.
					</p>
				)}
				{lastRecord && (
					<div className="mt-1 flex justify-end">
						<MessageTimestamp timestamp={new Date(lastRecord.ts)} />
					</div>
				)}
			</div>
		</div>
	);
};
