/**
 * The tool row across every state, and the working line beside it.
 *
 * These render the PRODUCTION `CanonicalTranscript` from real
 * `TranscriptRecord`s, so what is judged is what ships — not a hand-built row
 * with the same class names. The states below are the ones that are hard or
 * slow to produce live: an interrupted call needs a turn stopped at the right
 * moment, a failure needs a command that fails, a long MCP name needs a server
 * connected. A story is the fastest honest way to look at all of them at once;
 * the live-app frames in `docs/evidence/transcript-images/` carry the case a
 * story cannot make.
 *
 * What to look for, since these frames are the design review:
 *
 * - The tool names form ONE left edge and the summaries form another, because
 *   the name column is shared and sized to the longest visible name.
 * - The outcome glyphs form one column and the durations another, because the
 *   duration slot is fixed width and right-aligned. That alignment is the whole
 *   reason a run of twenty rows can be scanned instead of read.
 * - The three outcomes are distinguishable with the colour turned off: a tick,
 *   a cross, a slashed circle. Tint is a second channel, never the only one.
 * - A running row has NO outcome glyph. The empty column is what says "still
 *   running", and its ground is one lightness step up rather than a border.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import { WorkingLine } from "../components/trace/working-line";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	type TranscriptState,
	appendPendingUser,
	applyEvent,
	applyHistoryPage,
	dropLiveRecords,
} from "./transcript-reducer";

const TS = 1_760_000_000_000;

type ToolRecord = Extract<TranscriptRecord, { kind: "tool" }>;

const tool = (over: Partial<ToolRecord> & { id: string }): ToolRecord => ({
	kind: "tool",
	ts: TS,
	toolCallId: over.id,
	toolName: "bash",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	output: "ok",
	isError: false,
	durationS: 0.4,
	startedAt: null,
	images: [],
	added: 0,
	removed: 0,
	// The result's own unified diff, or `null` when the call reported none —
	// which is every row here except the diff-body story below.
	diff: null,
	stopped: false,
	...over,
});

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		oldestId: null,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const Frame = ({
	records,
	width = "100%",
	height = 300,
	waiting = false,
	starting = false,
	startingAfterId = null,
	status = "live",
	error = null,
	isSmallView = false,
	openRows = false,
}: {
	records: TranscriptRecord[];
	width?: string;
	/**
	 * Sized to the rows it holds, not to a comfortable window.
	 *
	 * The transcript is `flex-col-reverse` and pins its content to the BOTTOM,
	 * so a tall frame photographs six rows adrift in several hundred pixels of
	 * empty ground — which is a worse picture of the design and, at 98.6% one
	 * colour, is what `check-evidence`'s uniformity ceiling exists to reject.
	 */
	height?: number;
	waiting?: boolean;
	/**
	 * A send this conversation has admitted and that has produced nothing yet —
	 * the cold-engage window, before the owner's first frame.
	 */
	starting?: boolean;
	/** The echo record that send painted; the clears measure from it. */
	startingAfterId?: string | null;
	/** The stream's own state, so the clears this rung has can be photographed. */
	status?: "connecting" | "live" | "reconnecting" | "unavailable";
	error?: string | null;
	/** The small-view wrapper of the same transcript. */
	isSmallView?: boolean;
	/**
	 * Click every row's trigger after mount, the way a reader opens one.
	 *
	 * The diff body lives behind the row's disclosure (§ 7.4: detail is one
	 * click away, never shown by default) and `CanonicalTranscript` deliberately
	 * takes no "start open" prop — the terminal's `open_on_settle` is a
	 * bang-mode behaviour this app has not ported. So a story that needs to SHOW
	 * a body reaches it the way a reader does, through the row's own trigger.
	 * That is also what makes these frames evidence about the disclosure itself:
	 * if the trigger stopped reaching the body, they would come out collapsed.
	 */
	openRows?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!openRows) return;
		for (const trigger of containerRef.current?.querySelectorAll<HTMLButtonElement>(
			'button[aria-expanded="false"]',
		) ?? []) {
			trigger.click();
		}
	}, [openRows]);
	return (
		<div
			className="overflow-y-auto p-6"
			ref={containerRef}
			style={{ width, height }}
		>
			<CanonicalTranscript
				transcript={transcriptOf(records)}
				gate={null}
				waiting={waiting}
				starting={starting}
				startingAfterId={startingAfterId}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={isSmallView}
				status={status}
				error={error}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Tool rows",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Every outcome in one column, at a comfortable width — plus the state
 * before there is an outcome at all: a call still being dictated. */
export const States: Story = {
	render: () => (
		<Frame
			height={300}
			records={[
				tool({
					id: "tool:1",
					toolName: "bash",
					args: { command: "ls ~/ | head -50; echo ---; du -sh *" },
					durationS: 2.94,
					output: "Applications\nDesktop\nDocuments",
				}),
				tool({
					id: "tool:2",
					toolName: "read",
					args: { path: "/Users/damian/local-operator-ui/docs/branding.md" },
					durationS: 0.04,
					output: "# Branding and design system",
				}),
				// The composing row, which has no execution time to report: the
				// duration slot stays reserved and EMPTY (`tool_card.py:2503-2507`),
				// and the dictation counter in the object column is the only thing on
				// the row that moves. Bytes chosen to land on a KB step, because the
				// spelling is what this row is for.
				tool({
					id: "tool:1c",
					toolName: "write",
					args: null,
					phase: "composing",
					argumentBytes: 12_688,
					durationS: null,
					output: null,
				}),
				// The diff counters, which is the row shape a write produces.
				tool({
					id: "tool:3",
					toolName: "edit",
					args: { path: "src/renderer/src/features/chat/canonical/x.tsx" },
					durationS: 0.12,
					added: 42,
					removed: 11,
					output: "edited",
				}),
				// A failure: danger ground, cross glyph, and the duration STILL dim —
				// `✗ 0.2s` is not all-red.
				tool({
					id: "tool:4",
					toolName: "bash",
					args: { command: "false" },
					durationS: 0.21,
					isError: true,
					output: "exit status 1",
				}),
				// A stop is not a failure: hueless glyph, no danger ground.
				tool({
					id: "tool:5",
					toolName: "grep",
					args: { pattern: "needle", path: "src" },
					durationS: 5,
					stopped: true,
					output: null,
				}),
				// Running: live clock, NO outcome glyph, raised ground. The start is
				// pinned in the past so the still SHOWS a clock that has moved —
				// captured at `startedAt: now` every running row reads `0s`, which
				// is indistinguishable from the frozen clock this replaced and is
				// exactly why the defect survived a review round.
				tool({
					id: "tool:6",
					toolName: "web_fetch",
					args: { url: "https://example.com/very/long/path/to/a/document" },
					phase: "running",
					durationS: null,
					startedAt: Date.now() - 12_000,
					output: null,
				}),
			]}
		/>
	),
};

/** Long names, unknown tools and MCP calls — what the name column must absorb. */
export const NamesAndFallbacks: Story = {
	render: () => (
		<Frame
			height={300}
			records={[
				// The column grows to the longest visible name, so these all share
				// one edge and every summary starts on one rail.
				tool({
					id: "tool:1",
					toolName: "list_variables",
					args: {},
					durationS: 0.01,
				}),
				tool({
					id: "tool:2",
					toolName: "read_variable",
					args: { name: "invoice_totals" },
					durationS: 0.01,
				}),
				// An MCP tool: plug glyph, and the name is the CALL rather than the
				// mint — `mcp__linear_create_issue` in eight columns reads `mcp__lin`.
				tool({
					id: "tool:3",
					toolName: "mcp__linear_create_issue",
					args: { team: "core", title: "Tool rows drift from the TUI" },
					durationS: 1.2,
					output: "created LIN-482",
				}),
				tool({
					id: "tool:4",
					toolName: "mcp__linear_list_issues",
					args: { team: "core" },
					durationS: 0.8,
					output: "12 issues",
				}),
				// An unknown tool: wrench, deliberately NOT the plug. "I do not know
				// this tool" and "this came from a server you connected" are
				// different answers.
				tool({
					id: "tool:5",
					toolName: "some_custom_tool",
					args: { thing: "value", other: 3 },
					durationS: 0.3,
					output: "done",
				}),
				// `team` and `eval` are absent from the TUI's table too, and take the
				// same wrench. The operator's own screenshot shows exactly this.
				tool({
					id: "tool:6",
					toolName: "team",
					args: { op: "list" },
					durationS: 0.02,
				}),
				tool({
					id: "tool:7",
					toolName: "eval",
					args: { code: "import pandas as pd\ndf.head()" },
					durationS: 1.9,
					output: "   a  b\n0  1  2",
				}),
			]}
		/>
	),
};

/**
 * The same rows in a narrow column.
 *
 * The shed order is the TUI's: the diff counters go first — "how a write went
 * is core, how much it wrote is meta" — then the summary truncates, and the
 * outcome column always survives. Compare against `States` at full width.
 */
export const Narrow: Story = {
	render: () => (
		<Frame
			width="420px"
			height={212}
			records={[
				tool({
					id: "tool:1",
					toolName: "edit",
					args: { path: "src/renderer/src/features/chat/canonical/x.tsx" },
					durationS: 0.12,
					added: 42,
					removed: 11,
					output: "edited",
				}),
				tool({
					id: "tool:2",
					toolName: "bash",
					args: {
						command:
							"rg --hidden --no-ignore -n 'imageCount' src | head -50 | sort -u",
					},
					durationS: 2.94,
					output: "one match",
				}),
				tool({
					id: "tool:3",
					toolName: "bash",
					args: { command: "false" },
					durationS: 0.21,
					isError: true,
					output: "exit status 1",
				}),
			]}
		/>
	),
};

/**
 * The working line, at the foot of a turn.
 *
 * It must not restate the row above it: the row says WHAT ran and how long that
 * call has taken, and this says what KIND of work is in flight and how old the
 * phase is. Two different facts, deliberately not the same words.
 */
export const Working: Story = {
	render: () => (
		<Frame
			waiting
			height={216}
			records={[
				tool({
					id: "tool:1",
					toolName: "read",
					args: { path: "docs/branding.md" },
					durationS: 0.04,
					output: "# Branding",
				}),
				tool({
					id: "tool:2",
					toolName: "bash",
					args: { command: "pnpm test:desktop" },
					phase: "running",
					durationS: null,
					// A running row's clock counts from here, because `durationS`
					// does not arrive until the call ends. Pinned 47s in the past so
					// the frame DEMONSTRATES the clock rather than catching it at
					// `0s` — a still taken immediately cannot distinguish a working
					// clock from the frozen one this replaced.
					startedAt: Date.now() - 47_000,
					intent: "Running the desktop gates",
					output: null,
				}),
			]}
		/>
	),
};

/**
 * The three runs the operator screenshotted when he reported the spacing as
 * "much too wide" and "not very uniform".
 *
 * This is a REGRESSION surface, not a showcase: each block reproduces one of
 * his three frames, and the point of the story is that the pitch between
 * adjacent like rows is CONSTANT within each block. The middle block is the
 * one that caught the bug — the `assistant` record between the two `hub` rows
 * carries tool calls and no prose, so it renders nothing, and before the fix it
 * still minted a wrapper with a margin AND broke the trace-adjacency chain, so
 * the row after it fell back to the wider `item` gap. An invisible record must
 * not be able to push visible rows apart.
 */
export const OperatorSpacingCases: Story = {
	render: () => (
		<div className="flex flex-col gap-8 p-6">
			{/* (a) Four consecutive settled rows: one pitch, repeated.
			    Heights here and below are `scrollHeight` measured in the rendered
			    story plus the Frame's 48px of padding, rounded up to the 4px ramp -
			    not guessed, and not "whatever looked right". A Frame shorter than
			    its transcript CLIPS it: the story's history is anchored at its top,
			    so the rows that fall out of the picture are the NEWEST ones, off
			    the bottom, while everything above them stays exactly where it was.
			    Read that off the two frames rather than from the flex direction:
			    across the short frame and its resized replacement the divider sits
			    at the same y, rows 1-5 sit at the same y, and what the short one is
			    missing is its sixth row and the trailing date band. On a spacing
			    surface that silently becomes a photograph of a SHORTER RUN, which
			    is the failure design and QA both caught on `joined-mid-turn` - six
			    rows in the frame it replaced, five here, against a README that says
			    six. Two things ate the slack: the `Start of conversation` divider
			    (#112), which occupies real height at the top, and 2px per gap from
			    the hairline. The
			    capture viewport in `capture-evidence.mjs` has to clear these too,
			    because the harness takes `max(scrollHeight, declared)` and a
			    viewport shorter than the Frame re-crops what the Frame just made
			    room for. */}
			<Frame
				height={232}
				records={[
					tool({
						id: "a1",
						toolName: "read",
						args: { path: "~/local-operator-ui/docs/branding.md" },
						durationS: 0.04,
					}),
					tool({
						id: "a2",
						toolName: "bash",
						args: { command: "pnpm check-types" },
						durationS: 12.4,
					}),
					tool({
						id: "a3",
						toolName: "bash",
						args: { command: "git status --short" },
						durationS: 0.08,
					}),
					tool({
						id: "a4",
						toolName: "bash",
						args: { command: "pnpm lint" },
						durationS: 3.1,
					}),
				]}
			/>
			{/* (b) Prose, then two `hub` rows separated by a tool-call-only
			    assistant record, then a `send` row. All four rows must sit on one
			    pitch: the invisible record between them is not a spacer. */}
			<Frame
				height={240}
				records={[
					{
						kind: "assistant",
						id: "b0",
						ts: TS,
						text: "Checking on both reviewers before I fold the rounds together.",
						streaming: false,
						complete: true,
						stopReason: null,
						error: false,
					},
					tool({
						id: "b1",
						toolName: "hub",
						args: { op: "peek", job_id: "reviewer" },
						durationS: 0.3,
					}),
					// Tool calls, no prose: renders nothing, must occupy nothing.
					{
						kind: "assistant",
						id: "b2",
						ts: TS,
						text: "",
						streaming: false,
						stopReason: "toolUse",
						error: false,
					},
					tool({
						id: "b3",
						toolName: "hub",
						args: { op: "peek", job_id: "designer" },
						durationS: 0.2,
					}),
					tool({
						id: "b4",
						toolName: "send",
						args: { target: "qa", message: "rounds are in" },
						durationS: 0.1,
					}),
				]}
			/>
			{/* (c) The long ragged run: two more invisible records seeded mid-run,
			    which is what made some adjacent pairs tight and others wide. */}
			<Frame
				height={256}
				records={[
					tool({
						id: "c1",
						toolName: "bash",
						args: { command: "git log --oneline -8" },
						durationS: 0.06,
					}),
					{
						kind: "assistant",
						id: "c2",
						ts: TS,
						text: "",
						streaming: false,
						stopReason: "toolUse",
						error: false,
					},
					tool({
						id: "c3",
						toolName: "bash",
						args: { command: "pnpm test:desktop" },
						durationS: 8.2,
					}),
					tool({
						id: "c4",
						toolName: "bash",
						args: { command: "pnpm build" },
						durationS: 34,
					}),
					{
						kind: "assistant",
						id: "c5",
						ts: TS,
						text: "",
						streaming: false,
						stopReason: "toolUse",
						error: false,
					},
					tool({
						id: "c6",
						toolName: "grep",
						args: { pattern: "min-h-6", path: "src" },
						durationS: 0.4,
					}),
					tool({
						id: "c7",
						toolName: "edit",
						args: {
							path: "src/renderer/src/shared/components/ui/disclosure.tsx",
						},
						durationS: 0.1,
						added: 8,
						removed: 3,
					}),
				]}
			/>
		</div>
	),
};

/**
 * Where the `trace` hairline applies, and — just as much the point — where it
 * does NOT.
 *
 * The gap between adjacent ledger rows is 2px, and the claim a run of identical
 * rows cannot make on its own is that this is a gap BETWEEN rows rather than a
 * margin every row carries. A per-row margin looks identical in a picture of a
 * run and is wrong everywhere else: it would push the first row of a run down
 * off its own turn boundary and re-space the prose/ledger tier that carries the
 * "same run vs new turn" signal. So each block here isolates one boundary:
 *
 * - (a) a LONE call, with prose either side. Nothing is adjacent to it on the
 *   ledger tier, so it takes no hairline at all — `item` above and below.
 * - (b) a mixed run: calls, a NOTICE between them, then more calls. The notice
 *   is `trace`-like, so every adjacent pair in the block takes the same 2px
 *   GAP — which is the claim this block makes, and all it claims. The PITCH is
 *   not uniform and is not supposed to read as though it were: measured, the
 *   block is `22, 23.7, 22`, because a tool row is a 20px box while the notice
 *   renders its own line box a little taller. That difference is the notice's,
 *   it predates this tier, and it is what the `dense` opt-in already minimises
 *   (`trace-line.tsx`: a row's pitch should follow the COLUMN it is in). What
 *   this tier owns is the distance BETWEEN rows, and a run whose gap changed
 *   wherever a notice appeared is the raggedness it was built to prevent.
 * - (c) a run that OPENS a turn. Its first row takes the turn boundary and the
 *   rest take the hairline, which is the ordering the gap must not disturb.
 */
export const TraceGapBoundaries: Story = {
	render: () => (
		<div className="flex flex-col gap-8 p-6">
			{/* (a) A lone call between two paragraphs: no neighbour, no hairline. */}
			<Frame
				height={228}
				records={[
					{
						kind: "assistant",
						id: "l0",
						ts: TS,
						text: "Checking the lockfile before I touch anything.",
						streaming: false,
						complete: true,
						stopReason: null,
						error: false,
					},
					tool({
						id: "l1",
						toolName: "read",
						args: { path: "pnpm-lock.yaml" },
						durationS: 0.06,
					}),
					{
						kind: "assistant",
						id: "l2",
						ts: TS,
						text: "It is unchanged, so the install is not the cause.",
						streaming: false,
						complete: true,
						stopReason: null,
						error: false,
					},
				]}
			/>
			{/* (b) A notice inside a run: one tier, one pitch, all the way down. */}
			<Frame
				height={236}
				records={[
					tool({
						id: "m1",
						toolName: "bash",
						args: { command: "pnpm check-types" },
						durationS: 11.2,
					}),
					{
						kind: "notice",
						id: "m2",
						ts: TS,
						text: "Reconnected to the backend.",
						level: "info",
					},
					tool({
						id: "m3",
						toolName: "bash",
						args: { command: "pnpm lint" },
						durationS: 2.8,
					}),
					tool({
						id: "m4",
						toolName: "grep",
						args: { pattern: "GAP", path: "src" },
						durationS: 0.11,
					}),
				]}
			/>
			{/* (c) The first row of a run takes the TURN boundary, not the
			    hairline: the gap is between rows, never above the first one. */}
			<Frame
				height={284}
				records={[
					{
						kind: "user",
						id: "n0",
						ts: TS,
						text: "Run the gates.",
						images: [],
					},
					tool({
						id: "n1",
						toolName: "bash",
						args: { command: "pnpm lint" },
						durationS: 3.1,
					}),
					tool({
						id: "n2",
						toolName: "bash",
						args: { command: "pnpm check-themes" },
						durationS: 6.4,
					}),
					tool({
						id: "n3",
						toolName: "bash",
						args: { command: "pnpm build" },
						durationS: 41,
					}),
				]}
			/>
		</div>
	),
};

/**
 * The hierarchy that must SURVIVE the tightening: a turn boundary still gets
 * real air, and the working line sits on the run below it.
 *
 * Tightening adjacent tool rows is only correct if the reader can still see
 * where one turn ended and the next began — otherwise the ledger becomes one
 * undifferentiated column. This frame is where that trade is judged.
 */
export const TurnBoundaryAndWorkingLine: Story = {
	render: () => (
		<Frame
			waiting
			height={360}
			records={[
				tool({
					id: "t1",
					toolName: "read",
					args: { path: "docs/branding.md" },
					durationS: 0.04,
				}),
				tool({
					id: "t2",
					toolName: "bash",
					args: { command: "pnpm lint" },
					durationS: 3.1,
				}),
				{
					kind: "user",
					id: "t3",
					ts: TS,
					text: "Tighten the rows, they read as separate cards.",
					images: [],
				},
				{
					kind: "assistant",
					id: "t4",
					ts: TS,
					text: "Measuring the pitch before I change anything.",
					streaming: false,
					complete: true,
					stopReason: null,
					error: false,
				},
				tool({
					id: "t5",
					toolName: "bash",
					args: { command: "node scripts/measure-pitch.mjs" },
					phase: "running",
					durationS: null,
					intent: "Measuring the row pitch",
					output: null,
				}),
			]}
		/>
	),
};

/**
 * The operator's alignment report, as one frame: prose between tool rows, and
 * a final answer, against the ledger they are supposed to line up with.
 *
 * The subject is a pair of EDGES. Agent prose and a tool row are two registers
 * of the same turn and sit in the same row content box, so a reader scanning
 * the column sees one left rail or sees a mistake; `margin-inline: auto` on the
 * answer gave them two, and a reading cap 62 characters wide stopped the prose
 * hundreds of pixels short of the ledger's right edge on any comfortable
 * window. The prose here is long enough to reach a cap if one is reintroduced,
 * and there are rows above AND below it because the report named both cases
 * ("text between tools as well as the agent responses").
 *
 * The user bubble is in the frame on purpose, as the control: it keeps its own
 * narrower measure, and a change that widened it too would be visible here.
 */
export const ProseToolAlignment: Story = {
	render: () => (
		<Frame
			height={396}
			records={[
				{
					kind: "user",
					id: "p0",
					ts: TS,
					text: "Why is the chat text indented differently from the tool rows?",
					images: [],
				},
				tool({
					id: "p1",
					toolName: "read",
					args: {
						path: "src/renderer/src/features/chat/components/markdown.css",
					},
					durationS: 0.05,
				}),
				{
					kind: "assistant",
					id: "p2",
					ts: TS,
					text: "The rendered answer was capped at a reading measure and then centred inside the row it owns, so it took a different left edge from the ledger below it and stopped well short of the same right edge.",
					streaming: false,
					complete: true,
					stopReason: null,
					error: false,
				},
				tool({
					id: "p3",
					toolName: "grep",
					args: { pattern: "lo-measured", path: "src" },
					durationS: 0.12,
				}),
				tool({
					id: "p4",
					toolName: "edit",
					args: {
						path: "src/renderer/src/features/chat/components/markdown.css",
					},
					durationS: 0.08,
					added: 6,
					removed: 4,
				}),
				{
					kind: "assistant",
					id: "p5",
					ts: TS,
					text: "Both registers now resolve against the row content box, so the answer opens on the same rail the tool names do and ends on the same right edge as their durations.",
					streaming: false,
					complete: true,
					stopReason: null,
					error: false,
				},
			]}
		/>
	),
};

/**
 * The gap between `message_start` and the first token, which is the state the
 * transcript used to paint twice.
 *
 * The reducer opens an assistant record the moment the provider call starts, so
 * for as long as the model is thinking there is a streaming record with no text
 * in it. That record used to mint a row reading "Writing" directly above the
 * working line, which already says `thinking` — two elements for one fact, and
 * the redundant one sat in the answer's own register rather than on the ledger.
 * The TUI has never had a second element here: its one `WorkingBlock` carries
 * the whole phase.
 *
 * What this frame has to show after the fix is BOTH halves of the trade. No
 * "Writing" row, and liveness still on screen — the working line is present,
 * spinning, and naming the phase. A frame that lost the row and the signal
 * together would be a regression, not a fix, so the story is deliberately
 * `waiting` with a ledger the model has not written to yet.
 */
export const StreamingBeforeFirstToken: Story = {
	render: () => (
		<Frame
			waiting
			height={192}
			records={[
				tool({
					id: "s1",
					toolName: "read",
					args: {
						path: "src/renderer/src/features/chat/components/markdown.css",
					},
					durationS: 0.05,
				}),
				// Streaming, no text: the model is on the wire. This is the record
				// that used to paint a row of its own.
				{
					kind: "assistant",
					id: "s2",
					ts: TS,
					text: "",
					streaming: true,
					stopReason: null,
					error: false,
				},
			]}
		/>
	),
};

/**
 * The window an accepted send spends waiting to be admitted: the user's own
 * bubble is in the transcript and the owner has produced nothing yet.
 *
 * This is the state the operator reported as dead air - "I hit send, the frame
 * shows my message, and then nothing for a good three seconds". On a cold
 * session those seconds are the runtime spawning inside the message request
 * (`use-warm-session.ts`), and the New-chat pane cannot warm before the send
 * because it has neither a session id nor a bridge to hold the warm with.
 *
 * What the frame has to show is one quiet line at the foot saying the app is
 * waiting, in the ledger's own register - not a card, not a spinner beside it
 * (§ 7: one liveness element per turn, and it is the working line), and named
 * without claiming anything the renderer cannot check. The echo is built
 * through the real `appendPendingUser` rather than hand-written, so the row in
 * the picture is the row the store actually paints.
 *
 * `height={220}` because the frame must show the transcript's FOOT: at 160 it
 * clipped the message time under the rung, so the pair read as two differences
 * rather than as the one added line it claims (design round 1, D1; the measured
 * scroll height of the content is 219).
 */
export const AdmittedSendBeforeFirstFrame: Story = {
	render: () => (
		<Frame
			starting
			startingAfterId="s1"
			height={220}
			records={
				appendPendingUser(
					EMPTY_TRANSCRIPT,
					"s1",
					"Summarise what failed in the last test run.",
					[],
				).records
			}
		/>
	),
};

/**
 * The same admitted send, in the SMALL-VIEW wrapper.
 *
 * The rung is rendered by a different wrapper in the small view (no
 * `AGENT_GUTTER`, a tighter `GAP.item`), so the narrow entry in the sweep - a
 * narrow COLUMN at `isSmallView={false}` - was never a picture of it (design
 * round 1, D2). Same records as the frame above, so the difference between the
 * two is the wrapper alone.
 */
export const AdmittedSendBeforeFirstFrameSmallView: Story = {
	render: () => (
		<Frame
			starting
			startingAfterId="s1"
			isSmallView
			height={220}
			records={
				appendPendingUser(
					EMPTY_TRANSCRIPT,
					"s1",
					"Summarise what failed in the last test run.",
					[],
				).records
			}
		/>
	),
};

/**
 * The rung's other clear: the stream has died, so the app is no longer waiting.
 *
 * `deriveWorkingLine` refuses the rung while `unavailable`, because the
 * transcript is about to render the failure itself and a line claiming progress
 * beside it is a claim the transport is not making. The clear had no frame
 * before this (the story's `status` was hardcoded to `live`), which is a review
 * surface rather than a behaviour - the derivation is asserted in
 * `scripts/tool-row.test.mjs` - so the same admitted send is photographed with
 * the transport gone: the error is on screen and the rung is not.
 */
export const AdmittedSendTransportDown: Story = {
	render: () => (
		<Frame
			starting
			startingAfterId="s1"
			status="unavailable"
			error="The connection to the local operator was lost. Reopen the session to reconnect."
			height={220}
			records={
				appendPendingUser(
					EMPTY_TRANSCRIPT,
					"s1",
					"Summarise what failed in the last test run.",
					[],
				).records
			}
		/>
	),
};

/**
 * The same admitted send with the wait line absent: the BEFORE frame.
 *
 * Deliberately the same records as the story above and nothing else changed, so
 * the pair isolates the one thing this change adds. What it shows is what the
 * app painted while the operator was waiting - the user's bubble, and then dead
 * air until the first frame from the owner - which is the state reported as "I
 * hit send and nothing happens for three seconds". `starting={false}` is
 * exactly the old behaviour: nothing is waiting on the app's own send state, so
 * the working line has no rung to stand on until `frontend.streaming` flips.
 *
 * The same `height={220}` as its pair, and that is the point: a pair whose
 * halves are cropped differently cannot show that one line is the difference.
 */
export const AdmittedSendBeforeFirstFrameBaseline: Story = {
	render: () => (
		<Frame
			height={220}
			records={
				appendPendingUser(
					EMPTY_TRANSCRIPT,
					"s1",
					"Summarise what failed in the last test run.",
					[],
				).records
			}
		/>
	),
};

/**
 * The COMMON case for an agent answer: prose interleaved with a fenced code
 * block, a table and a list, against the ledger rows that produced them.
 *
 * `branding.md` § 7 and the reading-measure comment in `markdown.css` both call
 * mixed prose and code the common case rather than an edge case, and this
 * change is precisely about what those blocks resolve against — so it is the
 * surface that most needs a picture, and until design review round 1 (D4) it
 * was the one with none. The plain-paragraph alignment frames cannot stand in
 * for it: a `<pre>`, a `<table>` and a `<ul>` each have their own box model and
 * their own history of escaping the measure.
 *
 * What this frame has to show is FOUR registers on ONE left rail — paragraph,
 * code, table, list — all opening on the tool rows' rail and ending on their
 * right edge, with nothing overflowing. Two prior findings live here and must
 * stay fixed: applying the cap per-block gave each type step its own left edge
 * (code review round 3, R1), and excluding `<pre>`/`<table>` from it left them
 * on the column edge while the prose centred, showing four left edges in one
 * message (design round 3, D13). Removing the cap is what makes all four agree
 * structurally, and this is where that is checkable.
 *
 * The table is deliberately wide enough to use the room the removed cap gives
 * back, since "the wider measure genuinely helps the table" is part of the
 * trade this PR made.
 */
export const MixedProseCodeAndTables: Story = {
	render: () => (
		<Frame
			// Sized to the content it holds: the four registers this frame exists
			// to show run 688px at 1440, and a shorter frame scrolls the list off
			// its own evidence.
			height={732}
			records={[
				{
					kind: "user",
					id: "m0",
					ts: TS,
					text: "Which rule was capping the answer, and what did it measure?",
					images: [],
				},
				tool({
					id: "m1",
					toolName: "grep",
					args: { pattern: "max-width", path: "src/renderer/src/features" },
					durationS: 0.09,
				}),
				{
					kind: "assistant",
					id: "m2",
					ts: TS,
					text: [
						"One rule carried both halves of the report, and it lived on the rendered markdown root rather than on the column:",
						"",
						"```css",
						".lo-measured .lo-markdown {",
						"\tmax-width: 62ch;",
						"\tmargin-inline: auto;",
						"}",
						"```",
						"",
						"Measured against the ledger row in the same turn, at the body step:",
						"",
						"| Viewport | Tool row | Agent prose, before | Left delta | Right delta |",
						"| --- | --- | --- | --- | --- |",
						"| 1024x620 | 102..962 | 258.6..805.4 | 156.6 | 156.6 |",
						"| 1440x900 | 310..1170 | 466.6..1013.4 | 156.6 | 156.6 |",
						"",
						"The consequences were the ones the report named:",
						"",
						"- `margin-inline: auto` centred the answer inside the row it owns, so the column showed two left rails instead of one.",
						"- `62ch` resolved to 546.7px, stopping the prose 313px short of the ledger's right edge on any comfortable window.",
						"- Both grew with the window rather than shrinking, because the cap binds harder the more room there is.",
						"",
						"The measure is now the user bubble's property alone.",
					].join("\n"),
					streaming: false,
					complete: true,
					stopReason: null,
					error: false,
				},
				tool({
					id: "m3",
					toolName: "edit",
					args: {
						path: "src/renderer/src/features/chat/components/markdown.css",
					},
					durationS: 0.07,
					added: 34,
					removed: 11,
				}),
			]}
		/>
	),
};

/** Each label the working line can carry, without needing a live turn to reach it. */
export const WorkingLabels: Story = {
	render: () => (
		<div className="flex flex-col gap-4 p-8">
			<WorkingLine activity="thinking" phase="thinking" />
			<WorkingLine activity="responding" phase="responding" />
			<WorkingLine activity="composing a call" phase="composing" />
			{/* The model's own stated intent, when it wrote one — this is why the
			    label is not the word "working". */}
			<WorkingLine
				activity="Auditing tickets against merged MRs"
				phase="running"
			/>
			{/* A batch drops the intents for a COUNT: presenting one call's purpose
			    as the whole batch's activity is a claim the rows above contradict. */}
			<WorkingLine activity="running 3 tools" phase="running" />
		</div>
	),
};

/**
 * The reported case: a viewer that joins a turn ALREADY IN FLIGHT.
 *
 * The owner's snapshot seed keeps the settling frame of every call that
 * finished before the viewer attached and drops the start it replaces, and the
 * settling frame carries no `args` — so the seed is a list of calls nobody can
 * name. Records here are built by the PRODUCTION reducer, in the same order the
 * session hook applies them, because the defect was never in the row's
 * presentation: it was in what the row was given.
 *
 * Three rows say what to look for:
 *
 * 1. A live start, then a receipt gap (`dropLiveRecords`), then the durable
 *    page and the seed's settling frame. The row is created by that settling
 *    frame, and it must still say the command — before the fix it fell through
 *    to the result's first line and read `exit code: 0`.
 * 2. A result that opens with the harness's own wiring (`exit code: 0`, then
 *    `--- stdout ---`). When the arguments really are unknown — a call from an
 *    older runtime, or one whose plan was rejected — the object column steps
 *    over that wiring instead of quoting it.
 * 3. A call that printed NOTHING, whose object column is therefore empty rather
 *    than quoting `(empty)`: the stand-in exists to say something, and this is
 *    the state that must not be mistaken for a rendering failure.
 * 4. A stand-in line long enough that the column truncates it, so the mark is
 *    judged where it has to survive an ellipsis rather than on a line of its own.
 * 5. A normal row, whose arguments arrived on the live start. Unchanged, and
 *    here as the control: it is what the rows above must look like.
 */
export const JoinedMidTurn: Story = {
	render: () => <Frame height={276} records={joinedMidTurn()} />,
};

/**
 * The transcript a mid-turn join produces, through the real reducer.
 *
 * Deterministic on purpose: frames captured from this story are compared
 * against `main`, so anything read from the clock would make the pair differ
 * for a reason that has nothing to do with the change.
 */
function joinedMidTurn(): TranscriptRecord[] {
	const args = {
		command: "sed -n '1130,1230p' src/main/update-service.ts",
		i: "Reading the updater",
	};
	const result = (text: string) => ({
		content: [{ type: "text", text }],
		details: {},
	});
	// The live start, which is the only frame that carries the arguments.
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "tool_execution_start",
			tool_call_id: "c-gap",
			tool_name: "bash",
			args,
		},
		TS,
	);
	// A receipt gap: live projections are dropped, durable rows are not.
	state = dropLiveRecords(state);
	// The snapshot's durable page, whose assistant row holds the arguments.
	state = applyHistoryPage(state, {
		entries: [
			{
				id: "a-gap",
				ts: TS,
				type: "message",
				payload: {
					kind: "message",
					role: "assistant",
					content: [],
					tool_calls: [{ id: "c-gap", name: "bash", arguments: args }],
				},
			},
		],
		has_more: false,
		cursor_missing: false,
	});
	// Then the seed's settling frame — no arguments, and the row does not exist.
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-gap",
			tool_name: "bash",
			result: result(
				"exit code: 0\n--- stdout ---\n      this.updateAvailable = false",
			),
			duration_s: 0.1,
		},
		TS + 100,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-unknown",
			tool_name: "bash",
			result: result(
				"exit code: 0\n--- stdout ---\n=== /Volumes ===\nLocal Operator 0.17.0",
			),
			duration_s: 0.3,
		},
		TS + 900,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-read",
			tool_name: "read",
			result: result("1130|  private setupUpdateEvents(): void {"),
			duration_s: 0.2,
		},
		TS + 1_200,
	);
	// The producer's own shape for a call that PRINTED NOTHING
	// (`tools/builtin.py:1694-1695`): outcome line and two empty sections. Unknown
	// arguments AND no result line to stand in, so the object column is empty —
	// the state QA round 1's Q1 asked for, and the one a reader is most likely to
	// misread as a rendering bug.
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-silent",
			tool_name: "bash",
			result: result(
				"exit code: 0\n--- stdout ---\n(empty)\n--- stderr ---\n(empty)",
			),
			duration_s: 0.1,
		},
		TS + 1_300,
	);
	// A stand-in line long enough to be truncated by the column itself, so the
	// mark and the column's own right-side ellipsis are visible TOGETHER: the
	// design round's D1, which asked for the state where the mark has to survive
	// truncation rather than being the only thing on the line.
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-long",
			tool_name: "grep",
			result: result(
				"exit code: 0\n--- stdout ---\n" +
					"src/renderer/src/features/chat/components/trace/tool-row.tsx:412: a line long enough that the object column truncates it",
			),
			duration_s: 0.4,
		},
		TS + 1_400,
	);
	// The control: arguments arrived on the start, which is what every settled
	// row looks like when the viewer was there for the whole turn.
	state = applyEvent(
		state,
		{
			type: "tool_execution_start",
			tool_call_id: "c-known",
			tool_name: "bash",
			args: { command: "pnpm check-types && pnpm test:desktop" },
		},
		TS + 1_500,
	);
	state = applyEvent(
		state,
		{
			type: "tool_execution_end",
			tool_call_id: "c-known",
			tool_name: "bash",
			result: result("exit code: 0\n--- stdout ---\nall checks passed"),
			duration_s: 12.4,
		},
		TS + 13_900,
	);
	return state.records;
}
/* ------------------------------------------------------------------ diff body

   The `write`/`edit` expansion: the tool result's own `difflib.unified_diff`
   payload, painted with the terminal's ink law. What to look for, since these
   frames are the design review:

   - EVERY LINE CARRIES ITS KIND'S INK, the whole line and not just its marker:
     a `+` line is green end to end, a `-` line red end to end, an `@@` header
     muted, context dim. That is what the terminal's own loop does
     (`_append_diff_body`, tool_card.py:2208-2220) — the reference's docstring
     claims the marker-only version and describes something the loop never did.
   - The `+N -M` pill on the collapsed row and the body underneath agree,
     because both come from the same result payload rather than from two
     renderings of the change.
   - A row with NO diff keeps its arguments. `_diff_details` omits `diff`
     entirely when nothing changed, and a row that reports no change is not the
     same claim as a row whose diff was dropped. A row that FAILED keeps them
     too: its arguments are the only account of what was attempted.
   - The body is a sunken well with a hairline, the app's one machine-voice
     idiom (`output-block.tsx`), NOT a new panel, card or border treatment.
   - At `DIFF_EXPAND_MAX_LINES`, the marker under the 40th line says how many
     were not shown — and it is PINNED to the well's foot, because a body whose
     lines wrap is taller than the well's derived ceiling and would otherwise
     scroll the marker out of sight. `diff-body-narrow-wrapped-cap` is the
     frame that shows it; see that story. */

/** A two-hunk edit: context, removals, additions, both hunk headers. */
const MULTI_HUNK_EDIT = [
	// The NAMELESS header pair `difflib` emits (empty filenames and no line
	// terminator, so each line is exactly `--- ` / `+++ `). Stripped
	// positionally by the block, never by pattern.
	"--- ",
	"+++ ",
	"@@ -18,7 +18,8 @@ export function diffCounts(details: unknown) {",
	" \tconst source = (details ?? {}) as Record<string, unknown>;",
	"-\tconst count = (value: unknown) =>",
	'-\t\ttypeof value === "number" && value > 0 ? value : 0;',
	"+\tconst count = (value: unknown) =>",
	'+\t\ttypeof value === "number" && Number.isInteger(value) && value > 0',
	"+\t\t\t? value",
	"+\t\t\t: 0;",
	" \treturn { added: count(source.added), removed: count(source.removed) };",
	" }",
	"@@ -44,6 +45,7 @@ function sameImages(a: TranscriptImage[], b: TranscriptImage[]) {",
	" \tfor (let i = 0; i < a.length; i++) {",
	"-\t\tif (a[i].id !== b[i].id) return false;",
	"+\t\tif (a[i].id !== b[i].id) return false;",
	"+\t\tif (a[i].data !== b[i].data) return false;",
	// A removed line whose CONTENT begins `--`. At index 2 or beyond it is what
	// proves the header strip is POSITIONAL: a filter over the body would delete
	// a real removal here, silently, and the diff would claim a change that the
	// reader cannot see.
	"--- a SQL comment inside a Lua migration, still a removal",
	" \t}",
	" \treturn true;",
	" }",
];

/** A new file: every line an addition, header pair included. */
const NEW_FILE_WRITE = [
	"--- ",
	"+++ ",
	"@@ -0,0 +1,6 @@",
	"+# Release window notes",
	"+",
	"+A window is the PRs merged since the last tag.",
	"+A latecomer rides the next window.",
	"+",
	"+One owner per window, and the owner picks one bump for all of it.",
];

/** Longer than the body cap, built the way `difflib` builds a big hunk. */
const CAPPED_DIFF = [
	"--- ",
	"+++ ",
	"@@ -1,3 +1,43 @@",
	...Array.from(
		{ length: 43 },
		(_, i) => `+\trow ${i + 1} of a generated table`,
	),
];

/**
 * The cap AND long lines: 43 additions wide enough to wrap in a 560px column.
 *
 * Two different measurements, and this is the second one. The well's ceiling is
 * derived for UNWRAPPED rows (41 x 17.4px plus padding = 740px) and holds there
 * exactly; at 560px each of these lines takes two rows, so the body is roughly
 * twice the clip and the marker row would sit far below the scroll edge if it
 * were left in the flow. Measured in the live DOM at that width: 1415px of
 * content (`scrollHeight`) in a 738px client box, so `maxScroll` is 677px, and
 * in the flow the marker's own row starts 648.6px BELOW the clip. 677px is a
 * different quantity — the distance the pin lifts that row, and it equals this
 * body's `maxScroll` only because the well's 12px bottom padding is the pin's
 * own `bottom: -12px` offset; pinned, the row's box top lands 709.61px inside
 * the well. `sticky -bottom-3 pb-3 -mb-3` is what keeps the well honest at
 * every scroll position. Plain `bottom-0` is the version `diff-block.tsx`
 * rejects: it pins 13px higher, at the content-box edge, and the next diff row
 * shows through the band underneath the marker, so the pin stops reading as the
 * well's foot.
 */
const WRAPPED_CAPPED_DIFF = [
	"--- ",
	"+++ ",
	"@@ -1,3 +1,43 @@",
	...Array.from(
		{ length: 43 },
		(_, i) =>
			`+\t\tconst row${i + 1} = { cells: ["alpha", "beta", "gamma"], width: "generated" };`,
	),
];

/** At the cap in a WRAPPING column: 40 long lines shown, the rest announced. */
const WRAPPED_CAPPED_WRITE_ROW = tool({
	id: "tool:8",
	toolName: "write",
	args: { path: "scripts/wrapped-table.mjs", content: "…" },
	durationS: 0.5,
	added: 43,
	removed: 0,
	output: "Overwrote scripts/wrapped-table.mjs (4384 chars).",
	diff: WRAPPED_CAPPED_DIFF,
});

/* One record per case, as constants so the narrow story below reuses the same
   rows rather than a second copy of them that can drift. */

const EDIT_ROW = tool({
	id: "tool:1",
	toolName: "edit",
	args: {
		path: "src/renderer/src/features/chat/components/trace/tool-row-model.ts",
		hunks: [{ find: "const count", replace: "const count2" }],
	},
	durationS: 0.12,
	added: 6,
	removed: 3,
	output:
		"Edited src/renderer/src/features/chat/components/trace/tool-row-model.ts: 2 hunk(s), 2 replacement(s) applied.",
	diff: MULTI_HUNK_EDIT,
});

const NEW_FILE_ROW = tool({
	id: "tool:2",
	toolName: "write",
	args: {
		path: "notes/release-window.md",
		content:
			"# Release window notes\n\nA window is the PRs merged since the last tag.",
	},
	durationS: 0.03,
	added: 6,
	removed: 0,
	output: "Created notes/release-window.md (124 chars).",
	diff: NEW_FILE_WRITE,
});

/** At the cap: 40 lines shown, the rest announced. The count is the number of
    lines actually hidden rather than a rounded-off "more". */
const CAPPED_WRITE_ROW = tool({
	id: "tool:3",
	toolName: "write",
	args: { path: "scripts/generated-table.mjs", content: "…" },
	durationS: 0.4,
	added: 43,
	removed: 0,
	output: "Overwrote scripts/generated-table.mjs (1204 chars).",
	diff: CAPPED_DIFF,
});

/** Unchanged content: the backend omits `diff` entirely, so the row falls back
    to its arguments. Not the same statement as a row whose diff was dropped —
    this call reported that nothing changed. */
const UNCHANGED_WRITE_ROW = tool({
	id: "tool:4",
	toolName: "write",
	args: {
		path: "notes/release-window.md",
		content:
			"# Release window notes\n\nA window is the PRs merged since the last tag.",
	},
	durationS: 0.02,
	added: 0,
	removed: 0,
	output: "Overwrote notes/release-window.md (124 chars).",
	diff: null,
});

/** A failure: danger ground, cross glyph, and the error in full. No diff exists
    on this path — `execute_write` returns before it has one — so the row keeps
    both the arguments that were rejected and the reason. `isDiffBodyRow` guards
    the same thing at the component: a row carrying BOTH keeps its arguments and
    its error (`scripts/tool-row.test.mjs`). */
const FAILED_WRITE_ROW = tool({
	id: "tool:5",
	toolName: "write",
	args: { path: "", content: "x" },
	durationS: 0.01,
	isError: true,
	output: "path must be a non-empty string",
	diff: null,
});

/** Composing: the model is still dictating the arguments, so there is nothing
    to summarise and no result to render. The byte count is the only honest
    progress signal at this point. */
const COMPOSING_WRITE_ROW = tool({
	id: "tool:6",
	toolName: "write",
	phase: "composing",
	argumentBytes: 1204,
	args: null,
	output: null,
	durationS: null,
	diff: null,
});

/** A neighbour that is not a diff row, in the same frame, so a regression in
    the args/output path is visible here rather than only in `states`. */
const BASH_ROW = tool({
	id: "tool:7",
	toolName: "bash",
	args: { command: "git status --short" },
	durationS: 0.07,
	output: " M src/renderer/src/features/chat/canonical/tool-row.stories.tsx",
	diff: null,
});

/**
 * The diff body across its states, at a width where no line wraps.
 *
 * The frame height is the height this content MEASURES at 1280px wide — the
 * `scrollHeight` of the frame's own scroll box, read out of the story in a real
 * browser — because the frame IS the body: a shorter one photographs a scrolled
 * corner of it and cuts the last three cases off the bottom.
 */
export const DiffBody: Story = {
	render: () => (
		<Frame
			height={2110}
			openRows
			records={[
				EDIT_ROW,
				NEW_FILE_ROW,
				CAPPED_WRITE_ROW,
				UNCHANGED_WRITE_ROW,
				FAILED_WRITE_ROW,
				COMPOSING_WRITE_ROW,
				BASH_ROW,
			]}
		/>
	),
};

/**
 * The same body in a 560px column: the wrap rule, not the layout.
 *
 * A diff line is long by nature, and the claim this frame exists for is that
 * the body WRAPS rather than growing a horizontal scrollbar inside a
 * disclosure — a scroll region the reader has to discover, at the width where
 * the transcript is most likely to be narrow. Two cases rather than seven,
 * because under wrapping each body grows and the honest picture of the rule is
 * one you can see whole: the multi-hunk edit, and the capped body whose
 * remaining scroll is now vertical only.
 */
export const DiffBodyNarrow: Story = {
	render: () => (
		<Frame height={1380} openRows records={[EDIT_ROW, CAPPED_WRITE_ROW]} />
	),
};

/**
 * The cap at a WRAPPING width, which is the shape that actually reaches it.
 *
 * The ceiling above is derived for unwrapped rows and is exactly right there;
 * a 560px column turns 40 long lines into ~80 rows — 1415px of content in a
 * 738px client box, measured — so the marker's own row begins 648.6px BELOW the
 * clip, and the body would say "40 lines" while 40 rows stayed hidden. (677px is
 * the distance the pin lifts that row, not the below-the-fold gap; the
 * WRAPPED_CAPPED_DIFF fixture above carries both quantities and why they
 * differ.) That is the defect class the 720px ceiling was fixed for. Here the
 * frame is at rest, scrolled to the top, and the marker is pinned to the well's
 * foot: if it ever stops being visible, this frame shows the well claiming
 * completeness with lines missing, which is the whole point of it.
 */
export const DiffBodyNarrowWrappedCap: Story = {
	render: () => (
		<Frame height={830} openRows records={[WRAPPED_CAPPED_WRITE_ROW]} />
	),
};
