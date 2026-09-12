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
