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
import { useRef } from "react";
import "../../../styles/index.css";
import { WorkingLine } from "../components/trace/working-line";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	type TranscriptState,
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
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
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
				loadingOlder={false}
				onLoadOlder={() => undefined}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				error={null}
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

/** Every outcome, in one column, at a comfortable width. */
export const States: Story = {
	render: () => (
		<Frame
			height={210}
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
			height={230}
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
			height={150}
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
			height={150}
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
			{/* (a) Four consecutive settled rows: one pitch, repeated. */}
			<Frame
				height={130}
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
				height={150}
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
				height={210}
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
			height={260}
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
 * 3. A normal row, whose arguments arrived on the live start. Unchanged, and
 *    here as the control: it is what rows 1 and 2 must look like.
 */
export const JoinedMidTurn: Story = {
	render: () => <Frame height={170} records={joinedMidTurn()} />,
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
