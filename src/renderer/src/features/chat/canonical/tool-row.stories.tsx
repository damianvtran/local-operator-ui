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
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

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
			height={270}
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
				// Running: live clock, NO outcome glyph, raised ground.
				tool({
					id: "tool:6",
					toolName: "web_fetch",
					args: { url: "https://example.com/very/long/path/to/a/document" },
					phase: "running",
					durationS: null,
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
			height={190}
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
			height={190}
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
					intent: "Running the desktop gates",
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
