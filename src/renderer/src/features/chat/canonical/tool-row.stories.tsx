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
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import {
	type SessionFailureNotice,
	streamFailureNotice,
} from "../../../../../shared/desktop-stream-notice";
import "../../../styles/index.css";
import { peerFields } from "../components/trace/receipt-row-model";
import { formatDuration } from "../components/trace/tool-row-model";
import { WorkingLine } from "../components/trace/working-line";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	type TranscriptState,
	appendPendingUser,
	applyEvent,
	applyHistoryPage,
	applyLiveSeed,
	compactionSettledLine,
	dropLiveRecords,
} from "./transcript-reducer";

const TS = 1_760_000_000_000;

/**
 * Two screenshots for the rows that carry one, as INLINE base64 — the live wire
 * shape (`TranscriptImage.data`), which `useAttachmentUrl` turns into a `data:`
 * URI on the first render with no relay request, so these stories need no backend.
 *
 * They exist because the surface the operator actually reported had no frame
 * anywhere: `grep` for a non-empty `images: [...]` across every `.stories.tsx`
 * found nothing, so `CanonicalImage` was exercised only through the shared
 * component's own story and never through the row that mounts it — including the
 * `Screenshot 1` / `Screenshot 2` labels a row with two images derives (QA round 1,
 * Q-3). Small and flat so the literal stays in the source file: 480x360 and
 * 320x480, 12 bands each, no anti-aliasing.
 */
const SHOT_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAeAAAAFoBAMAAAB9GTUTAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAnUExURZ48PJ5tPJ48np48bZ6ePG2ePDyePDyebTyenjxtnjw8nm08nv7+/gsvuucAAAABYktHRAyBs1FjAAAAB3RJTUUH6gkQExID2Z+b6gAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0xNlQxOToxODowMyswMDowMI0ybT8AAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMTZUMTk6MTg6MDMrMDA6MDD8b9WDAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTE2VDE5OjE4OjAzKzAwOjAwq3r0XAAAABBjYU52AAAAKAAAAWgAAAAAAAAAALIy97YAAAGISURBVHja7c/BAIBAAADBU0ghhRRSSCGFU0ghhRSSS2C//WYMZoywhDVsYQ9HOMMMV7jDE94whIWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYX/Cn/nxUt2nZ0bsgAAAABJRU5ErkJggg==";

const TALL_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAAUAAAAHgCAMAAADjUkR2AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAACBUExURZ48PJ47PJ5MPJ5vPJ5tPJ5vOZ5Mfp47oJ48np48m548cJ48bZ46bp5cXZ6hOp6ePKCePH2ePGyePG2ePGqePD+ePDyePDyeOzyeTDyebzyebTyeazyejjyenzyenjybnjxwnjxtnjxunjxdnjw6njw8njo8nl08nm48nm08nv7+/sp8UqYAAAABYktHRCpTvtSeAAAAB3RJTUUH6gkQExIER/sOSQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0wOS0xNlQxOToxODowMyswMDowMI0ybT8AAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMDktMTZUMTk6MTg6MDMrMDA6MDD8b9WDAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTA5LTE2VDE5OjE4OjA0KzAwOjAwbt3K0gAAABBjYU52AAAAGwAAAeAAAAAAAAAAANUM1AAAAALsSURBVHja7dAFAQJRAAWwjzuHuzv9C5LgJWCLsFKSWr3RDFrtTjfo9QfBcDSugsl0Ng8Wy1Ww3mx3wf5wPAXnyzW43R/P4PX+fJMiUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKBAgQIFChQoUKDAfw38AUgMDtEyr1dZAAAAAElFTkSuQmCC";

/** One image block, in the shape the reducer's `images` array holds. */
const image = (id: string, data: string, mimeType = "image/png") => ({
	id,
	data,
	attachment: null,
	mimeType,
});

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
	// The harness's never-run verdict and its fact, which only a row settled by
	// a compose frame carries — by verdict, or by a turn that ended while the
	// call was still being dictated. Every row here but the never-run states is
	// a call that really was sent to a tool.
	notRunReason: null,
	neverSent: false,
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

function transcriptOf(
	records: TranscriptRecord[],
	compacting = false,
): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		// The pass claim is the ONLY thing on this state that the transcript
		// itself carries rather than reading off a record, so it is a parameter
		// here: the compacting stories are the only frames that set it.
		compacting,
		// The claim's own start, so the clock the rung derives is a fixed age
		// rather than whatever the shutter catches (design round 2, D3).
		compactingSince: compacting ? Date.now() - 47_000 : 0,
		viewEpoch: 0,
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
	compacting = false,
	starting = false,
	startingAfterId = null,
	status = "live",
	failure = null,
	isSmallView = false,
	/*
	 * A fixture of rows handed in rather than read: by default NO page is owed,
	 * and the hold cannot fire here anyway (it needs zero records). The
	 * admitted-send stories pass `true` deliberately - a pane whose history has
	 * not been read is the row of the pane matrix where the wait line must
	 * outrank the loading placeholder, and the New-chat path the operator
	 * reported is exactly that row (`transcript-pane.ts`).
	 */
	awaitingHydration = false,
	openRows = false,
	keepClosed,
	frontend = null,
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
	 * A compaction pass in flight (`TranscriptState.compacting`).
	 *
	 * Not `waiting`: the app never knows a pass is coming until the backend says
	 * one started, and the rung this raises is a different claim with its own
	 * phase. See `CompactingRung` / `CompactingSettled` below for the
	 * pair a reviewer needs.
	 */
	compacting?: boolean;
	/**
	 * A send this conversation has admitted and that has produced nothing yet —
	 * the cold-engage window, before the owner's first frame.
	 */
	starting?: boolean;
	/** The echo record that send painted; the clears measure from it. */
	startingAfterId?: string | null;
	/** The stream's own state, so the clears this rung has can be photographed. */
	status?: "connecting" | "live" | "reconnecting" | "unavailable";
	/** The published failure notice, as the stream hands it over. */
	failure?: SessionFailureNotice | null;
	/** Is an authoritative page for this session still owed? */
	awaitingHydration?: boolean;
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
	/**
	 * The row positions `openRows` leaves CLOSED, in paint order.
	 *
	 * The receipt stories need both states of the same row type in one frame — a
	 * collapsed peer row beside an expanded one, which is the pair that shows what
	 * the disclosure is FOR (the collapsed row is the sender and a preview; the
	 * expansion is the pid, the model and the whole message). Two separate stories
	 * would show the two states and not the contrast, and the contrast is the
	 * review question.
	 */
	keepClosed?: number[];
	/**
	 * The producer's frontend state, when the frame is about something that only
	 * exists on it.
	 *
	 * Almost every story here is a picture of the ROWS, which carry their own
	 * facts; the resumed-clock frame below is the exception, because the phase a
	 * viewer resumes into (`thinking` — a model call in flight, with no row
	 * behind it at all) is stated nowhere else. So the fold is threaded exactly
	 * as the reader threads it (`chat-content.tsx`).
	 */
	frontend?: CanonicalFrontendState | null;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!openRows) return;
		const triggers = Array.from(
			containerRef.current?.querySelectorAll<HTMLButtonElement>(
				'button[aria-expanded="false"]',
			) ?? [],
		);
		for (const [position, trigger] of triggers.entries()) {
			if (keepClosed?.includes(position)) continue;
			trigger.click();
		}
	}, [openRows, keepClosed]);
	return (
		<div
			className="overflow-y-auto p-6"
			ref={containerRef}
			style={{ width, height }}
		>
			<CanonicalTranscript
				transcript={transcriptOf(records, compacting)}
				frontend={frontend}
				gate={null}
				waiting={waiting}
				starting={starting}
				startingAfterId={startingAfterId}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={isSmallView}
				status={status}
				failure={failure}
				/*
				 * The admitted-send stories pass `true` and the rest take the default:
				 * see `Frame`'s own note. A row-less pane whose history has not been read
				 * is the row where the wait line has to outrank the placeholder, and that
				 * is the state the operator's New-chat report is in.
				 */
				awaitingHydration={awaitingHydration}
				onReconnect={() => {}}
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
				//
				// Hand-set rather than driven, because this story's records are
				// literals and the anchor is the one thing a literal cannot state.
				// `ResumedRunningClock` below is the frame that goes through
				// `applyLiveSeed` and the reducer's `started_at_epoch`, which is
				// what a resumed viewer actually runs.
				tool({
					id: "tool:6",
					toolName: "web_fetch",
					args: { url: "https://example.com/very/long/path/to/a/document" },
					phase: "running",
					durationS: null,
					startedAt: Date.now() - 12_000,
					output: null,
				}),
				// NEVER RUN, and the reason this row is in the comparison beside the
				// failure above: it wears the same danger ground and cross glyph, and
				// the two must still be told apart on the row itself. The summary says
				// `never sent`, not `failed`, and the label says the call never ran —
				// the call produced no result to fail. It also carries no duration at
				// all, because nothing measured one.
				tool({
					id: "tool:7",
					toolName: "hub",
					args: null,
					argumentBytes: 2048,
					notRunReason:
						"Invalid arguments: arguments are not valid JSON: Expecting ',' delimiter: line 1 column 1978 (char 1977)",
					neverSent: true,
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
/**
 * A compaction pass in flight: the aggregate working line is the only thing on
 * screen that says so, and its label is the terminal host's own.
 *
 * The two states of the change that deleted `/compact`'s dialog, named for the
 * STATE rather than for a before/after pair — every other `-before`/`-after`
 * directory in this repo means before/after THE CHANGE, and this pair is one
 * tree photographed either side of the pass settling (review round 1, R5).
 * The dialog used to be the whole of the surface's answer to the command, and it
 * stayed up over a pass that had already finished; the transcript now carries
 * the fact itself — this rung while the pass runs, the info line below once it
 * settles (`CompactingSettled`, the same transcript with the `compaction` record
 * the reducer paints and no pass in flight).
 *
 * The clock is left at 0s deliberately: this story is about the copy and the
 * fact, and `Working` above is the story that pins the ticking clock.
 */
export const CompactingRung: Story = {
	render: () => (
		<Frame
			compacting
			height={300}
			records={[
				tool({
					id: "tool:1",
					toolName: "read",
					args: { path: "docs/branding.md" },
					durationS: 0.04,
					output: "# Branding",
				}),
				{
					kind: "user",
					id: "u1",
					ts: TS,
					text: "Compact the context, then keep going.",
					images: [],
				},
			]}
		/>
	),
};

/**
 * The same transcript once the pass has settled: the rung is gone and the
 * reducer's own info line is what took its place, carrying the token counts the
 * backend reported.
 *
 * Both frames are one change, which is why they are a pair rather than two
 * stories: the dialog this replaces was what used to stand between them.
 */
export const CompactingSettled: Story = {
	render: () => (
		<Frame
			height={300}
			records={[
				tool({
					id: "tool:1",
					toolName: "read",
					args: { path: "docs/branding.md" },
					durationS: 0.04,
					output: "# Branding",
				}),
				{
					kind: "user",
					id: "u1",
					ts: TS,
					text: "Compact the context, then keep going.",
					images: [],
				},
				{
					kind: "compaction",
					id: "compaction:1:41000:9000",
					// ASKED OF THE RULE, not typed by hand: a frame whose sentence is a
					// literal cannot detect a regression in the copy it claims to show
					// (design round 2, D4). The figures are the LIVE sentence, which is
					// the one the pairing carries onto the durable row (round 4); a cold
					// reader's bare sentence is the rule's other half and has its own
					// test rather than a frame.
					ts: TS,
					text: compactionSettledLine(41_000, 9_000),
				},
			]}
		/>
	),
};

/**
 * The other half of the settled copy: a pass whose two figures round to the same
 * step says the number ONCE (`Context compacted to 52.7k tokens`), which is UX
 * round 1's U4 and had no frame until design round 2's D4.
 *
 * It was deleted for a round while the copy carried no figures at all; the rule
 * prints the pair again, so the branch is back and so is its frame — a branch of
 * the copy that only a test can see is the thing D4 was about.
 */
export const CompactingSettledUnchanged: Story = {
	render: () => (
		<Frame
			height={300}
			records={[
				tool({
					id: "tool:1",
					toolName: "read",
					args: { path: "docs/branding.md" },
					durationS: 0.04,
					output: "# Branding",
				}),
				{
					kind: "user",
					id: "u1",
					ts: TS,
					text: "Compact the context, then keep going.",
					images: [],
				},
				{
					kind: "compaction",
					id: "compaction:1:52700:52700",
					ts: TS,
					text: compactionSettledLine(52_700, 52_700),
				},
			]}
		/>
	),
};

/**
 * The third ending: a pass that did NOT run.
 *
 * A refusal emits no `compaction_start` — the runtime answers the routed command
 * with an optimistic receipt and the pass declines before the start event — so
 * this row is the pass's ONLY record, and until this round the reducer listed it
 * as bookkeeping and painted nothing at all (UX round 1, U1 = QA Q2). With the
 * dialog gone that silence was the surface the dialog used to occupy, and the
 * operator's own gesture is what reaches it: the shipped default keeps 20,000
 * tokens verbatim, so `/compact` on a young conversation declines.
 *
 * The ink is the backend's, not this story's: `harness/rows.py`'s
 * `compaction_refused_notice` derives `warning` for a decline and `error` for a
 * failure, and the phone and the terminal host both render through it.
 */
export const CompactingRefused: Story = {
	render: () => (
		<Frame
			height={300}
			records={[
				tool({
					id: "tool:1",
					toolName: "read",
					args: { path: "docs/branding.md" },
					durationS: 0.04,
					output: "# Branding",
				}),
				{
					kind: "user",
					id: "u1",
					ts: TS,
					text: "Compact the context, then keep going.",
					images: [],
				},
				{
					kind: "notice",
					id: "refusal:1",
					ts: TS,
					level: "warning",
					text: "Compaction did not run — nothing to compact: the whole conversation is ~8 tokens and the most recent 20,000 are kept verbatim",
				},
			]}
		/>
	),
};

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
 *
 * AND IT IS THE FRAME FOR THE OPERATOR'S OTHER REPORT (2026-09-17): the
 * transcript's footer line used to be keyed to the newest record, so during a
 * live turn its stamp landed directly under this working line. That line is
 * removed rather than re-gated (`turn-timestamp.tsx` carries the reasoning), and
 * this frame is the evidence that the foot now ends at the working line — the
 * last row a transcript can end on that is not a record at all.
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

export const AnswerInProgress: Story = {
	render: () => (
		<Frame
			waiting
			height={340}
			records={[
				{
					kind: "user",
					id: "p1",
					ts: TS,
					text: "Which invoices were paid late?",
					images: [],
				},
				{
					kind: "assistant",
					id: "p2",
					ts: TS + 4_000,
					text: "Reading the ledger first.",
					streaming: false,
					complete: true,
					stopReason: null,
					error: false,
				},
				tool({
					id: "p3",
					toolName: "read",
					args: { path: "invoices/2026-08.csv" },
					durationS: 0.06,
				}),
				// The answer that is still arriving. It carries prose and no caption:
				// this record is the operator's "in-progress tool intent/response",
				// and the working line below is the only liveness element on screen
				// (§ 7).
				{
					kind: "assistant",
					id: "p4",
					ts: TS + 9_000,
					text: "Four were late, and the oldest is 41 days",
					streaming: true,
					stopReason: null,
					error: false,
				},
			]}
		/>
	),
};

/**
 * A turn whose prose arrives in pieces, which is the shape the caption's count
 * has to survive: three intermediate paragraphs interleaved with the calls they
 * narrate, and a closing answer.
 *
 * The operator asked for a caption on the agent's final responses and then asked,
 * in the same breath, what a turn like this looks like - because a stamp per
 * settled prose row is four captions in one turn, while the ledger below it stays
 * four lines. The frame exists so that question is judged on pixels rather than
 * on the rule, and round 1 judged it: four identical clocks interleaved with the
 * ledger, the worst shape being two of them 56px apart with one sentence between
 * them (design round 1, D1). The caption is now gated on the turn's CLOSING
 * answer - `closingAnswerIds` in `canonical/transcript-rows.ts` - so what this
 * frame shows is ONE caption, under the answer the turn ends on, and the narrative
 * paragraphs above it unlabelled.
 *
 * Both readings of the operator's sentence are legible here, which is why the
 * story is kept in the set rather than reduced to its after half: `paintsSomething`
 * still keeps the count down for a turn that goes quiet between calls, and the
 * closing-answer rule is what keeps it down for one that talks four times.
 */
export const ProseBetweenCalls: Story = {
	render: () => (
		<Frame
			height={520}
			records={[
				{
					kind: "user",
					id: "q1",
					ts: TS,
					text: "Reconcile August against the bank feed.",
					images: [],
				},
				{
					kind: "assistant",
					id: "q2",
					ts: TS + 2_000,
					text: "Pulling both sides of the month first.",
					streaming: false,
					complete: true,
					stopReason: null,
					error: false,
				},
				tool({
					id: "q3",
					toolName: "read",
					args: { path: "invoices/2026-08.csv" },
					durationS: 0.08,
				}),
				tool({
					id: "q4",
					toolName: "read",
					args: { path: "bank/2026-08.csv" },
					durationS: 0.05,
				}),
				{
					kind: "assistant",
					id: "q5",
					ts: TS + 5_000,
					text: "Both ledgers agree on 214 of the 220 rows.",
					streaming: false,
					complete: true,
					stopReason: null,
					error: false,
				},
				tool({
					id: "q6",
					toolName: "bash",
					args: { command: "node scripts/diff-ledgers.mjs" },
					durationS: 1.2,
				}),
				{
					kind: "assistant",
					id: "q7",
					ts: TS + 8_000,
					text: "The six that disagree are all dated on a weekend.",
					streaming: false,
					complete: true,
					stopReason: null,
					error: false,
				},
				tool({
					id: "q8",
					toolName: "bash",
					args: { command: "node scripts/check-weekends.mjs" },
					durationS: 0.7,
				}),
				{
					kind: "assistant",
					id: "q9",
					ts: TS + 11_000,
					text: "Four invoices were paid late, and the oldest is 41 days behind.",
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
 *
 * The height is 420 rather than the 396 this story carried: the closing answer's
 * caption is part of the claim ("a final answer" above), and at 396 the pane cut
 * through its glyphs - the last text band measured 7px against 11-12px for a whole
 * caption, so a reader saw a clipped string rather than a caption, and the air the
 * frame exists to show under the closing answer was not shown at all (design round
 * 1, D3).
 */
export const ProseToolAlignment: Story = {
	render: () => (
		<Frame
			height={420}
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
 * The turn stamp: the time under a user turn, and inside an open tool call.
 *
 * The two surfaces the operator named, in one frame, with the CONTRAST that is
 * half the design: four user turns carrying four shapes of one formatter
 * (`today`, `Yesterday`, a dated stamp from this year, and one from last year),
 * an open tool call with its stamp under the pane, and a call with nothing to
 * disclose beside it, which is a line with no stamp at all. A frame holding
 * only the stamped rows could not show that the ledger stays quiet.
 *
 * THE INSTANTS ARE RELATIVE TO THE CAPTURE, deliberately, and it is the only
 * way these shapes can be photographed: `today` and `Yesterday` are calendar
 * facts about the moment of reading, so a fixed fixture would photograph a
 * stamp reading `Sep 12, 2025` from the day after it was taken. These frames
 * are therefore a function of the tree AND of the day they were taken, which
 * the surface's README states rather than hides. Everything else in this set
 * keeps the fixed `TS` fixture for the opposite reason: a duration, an outcome
 * or a summary must not move between two captures of the same tree.
 */
export const TurnTimestamps: Story = {
	render: () => {
		const now = Date.now();
		const hours = (count: number) => now - count * 3_600_000;
		const days = (count: number) => now - count * 86_400_000;
		// Last year, month and day held: the one shape that carries a year, and a
		// calendar-year fact rather than "365 days ago".
		const lastYear = new Date(
			new Date(now).getFullYear() - 1,
			8,
			12,
			15,
			42,
		).getTime();
		return (
			<Frame
				height={760}
				openRows
				records={[
					{
						kind: "user",
						id: "s1",
						ts: lastYear,
						text: "Which invoices were late last month?",
						images: [],
					},
					{
						kind: "assistant",
						id: "s2",
						ts: lastYear + 1000,
						text: "Three were late. The list is in the run above.",
						streaming: false,
						complete: true,
						stopReason: null,
						error: false,
					},
					{
						kind: "user",
						id: "s3",
						ts: days(20),
						text: "Reconcile the ledger against the bank feed.",
						images: [],
					},
					// The open call: its stamp is the last thing in the expansion, below
					// the pane and outside both of the pane's scrolling sections.
					tool({
						id: "s4",
						ts: days(20) + 2000,
						toolName: "bash",
						args: { command: "pnpm reconcile --month 2026-08" },
						output: "matched 214 of 217 invoices",
						durationS: 12.4,
					}),
					// The quiet row beside it: no readable arguments and no output means no
					// disclosure to open, so there is nowhere for a stamp to be.
					tool({
						id: "s5",
						ts: days(20) + 3000,
						toolName: "team",
						args: {},
						output: null,
					}),
					{
						kind: "user",
						id: "s6",
						ts: hours(30),
						text: "Now do the same for this month.",
						images: [],
					},
					{
						kind: "user",
						id: "s8",
						ts: hours(2),
						text: "What is left to check before I send these on?",
						images: [],
					},
				]}
			/>
		);
	},
};

/**
 * The same stamps in the NARROW COLUMN.
 *
 * Not the small view, and this comment said it was until review round 1 (D4):
 * `isSmallView` is false here, so the bubble takes the comfortable
 * `max-w-[75%] px-4 py-3` rather than the small view's `max-w-[92%] px-3 py-2`.
 * The small view IS pictured with a stamp —
 * `chat-tool-rows/admitted-send-before-first-frame-small-view/`, where the
 * bubble's border and the stamp's ink both end at the same x.
 *
 * The narrow column is worth a frame because the transcript is a different shape
 * there: the bubble is a larger fraction of the width, and a reader on a narrow
 * window is the one most likely to be reading a single long conversation. WHAT
 * THE FRAME DOES NOT SHOW, because this comment claimed it and the pixels say
 * otherwise (design round 2, D2-3): nothing about the stamp's line is close to
 * wrapping. The transcript column ends at x 362 of the 420px frame, so the stamp
 * sits alone on its own line — ink x 260..362, the rest of that line empty.
 *
 * IT IS NOT EVIDENCE OF AN EDGE DISTINCTION, which this comment implied and
 * which the layout does not have: a user row is `flex w-full justify-end` with no
 * right inset, so the bubble's right edge and the row content box's are the same
 * line at every width (measured at 0.0px on 420/1024/1440 in review round 1,
 * R2/D3). The stamp is right-aligned to the turn's own right edge, which is the
 * bubble's because the row is right-justified.
 */
export const TurnTimestampsNarrow: Story = {
	render: () => {
		const now = Date.now();
		return (
			<Frame
				width="420px"
				height={500}
				openRows
				records={[
					{
						kind: "user",
						id: "n1",
						ts: now - 26 * 3_600_000,
						text: "Did the reconciliation finish?",
						images: [],
					},
					tool({
						id: "n2",
						ts: now - 26 * 3_600_000 + 2000,
						toolName: "bash",
						args: { command: "pnpm reconcile --month 2026-09 --dry-run" },
						output: "3 unmatched, 0 errors",
						durationS: 8.9,
					}),
					{
						kind: "user",
						id: "n3",
						ts: now - 1_800_000,
						text: "Send the three exceptions to Priya.",
						images: [],
					},
				]}
			/>
		);
	},
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
			awaitingHydration={true}
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
			awaitingHydration={true}
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
			awaitingHydration={true}
			status="unavailable"
			failure={streamFailureNotice(null)}
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
			/*
			 * The same row of the pane matrix as its pair (`awaitingHydration={true}`), so the
			 * two frames differ by the added line and by nothing else: with the
			 * default the baseline would also differ in which claim the pane's own
			 * hold makes, and the pair would no longer isolate the change.
			 */
			awaitingHydration={true}
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
						"The measure is the user card's own width instead, and the prose inside it fills the card.",
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
 * The operator's report: a viewer that RESUMES a turn already in flight.
 *
 * THE DEFECT. "Each time I resume it says it's been waiting for 0s regardless
 * of how long." Both counters on this surface restarted from the moment the
 * view loaded, because neither was handed the producer's own start:
 *
 *   - the ROW read the instant the frame ARRIVED (the seed was applied with
 *     `now`), so a call that had been running for over two minutes read `0s`
 *     the moment it was painted;
 *   - the WORKING LINE had no anchor at all, so a resumed pane always started
 *     the band at zero.
 *
 * WHY A FRAME AND NOT ONLY THE TEST. The counter is what the operator reads,
 * and the two arms are anchored by DIFFERENT facts, which is exactly the pair a
 * reviewer needs to see side by side:
 *
 *   - the right-hand pane resumes a RUNNING batch. Its clock comes from the
 *     oldest card's own start, which is finer than any phase edge — a batch
 *     restarts its phase zero every time a call joins it, so the phase fold
 *     would restart a clock mid-batch. The card's start is the frame's own
 *     `started_at_epoch`.
 *   - the left-hand pane resumes a MODEL CALL, where there is no card at all.
 *     Its clock can only come from the producer's folded phase, and only when
 *     the folded phase equals the one derived here (the TUI's gate,
 *     `OperatorApp._folded_phase_epoch`).
 *
 * Both are built through the PRODUCTION reducer, in the order the session hook
 * applies them, so what is photographed is the wiring and not a record with a
 * hand-set timestamp — which is what the `States` story above has to do and why
 * it cannot show this.
 */
export const ResumedRunningClock: Story = {
	render: () => {
		// Anchored to the capture for the reason `conversationRows` gives in
		// `reconnect-gap.stories.tsx`: the counter is measured against the real
		// wall clock at render, so the anchors below are derived from this frame's
		// own instant and the age photographed is the fixture's, not the shutter's.
		const now = Date.now();
		const agoS = (ms: number) => (now - ms) / 1000;
		/*
		 * The two ages the fixture states, and the captions DERIVE their spellings
		 * from them rather than restating them.
		 *
		 * WHY DERIVED: a hand-copied number had already drifted from the frame it
		 * sits over once (design round 1's D3), and the age is the one fact both
		 * halves of this pair are about — so a caption that repeats it by hand is a
		 * second description of the fixture, kept in step by nothing.
		 *
		 * WHY THE WORDS ARE ARM-NEUTRAL, and why they say the counter "counts on":
		 * both halves are shot with this same story file (the before half runs it
		 * against main's reducer and main's working-line model), so a caption
		 * asserting `not this view's mount` would be contradicted by the before
		 * half's own pixels, which ARE this view's mount. And because the counter is
		 * LIVE, the shutter always lands a beat after this story anchored its clock,
		 * so the frame reads that much more than the age named here — which is the
		 * fact "counts on" states and a pinned number does not. A caption holding the
		 * rendered value instead would be wrong on every capture whose shutter was
		 * slower than the last, which is how the number it replaced went stale.
		 */
		const THINKING_MS = 92_000;
		const RUNNING_MS = 137_000;
		const age = (ms: number) => formatDuration(Math.round(ms / 1000));
		/*
		 * Cast at the boundary rather than built whole, as
		 * `session-status-strip.stories.tsx` does for the same reason: a full
		 * `CanonicalFrontendState` is thirty-odd fields of session bookkeeping that
		 * this frame makes no claim about, and a fixture that spelled them all out
		 * would be a second description of the wire to keep in step. The two fields
		 * here are the ones the band reads, and they are DECLARED on the contract
		 * rather than reached for through its index signature.
		 */
		const folded = (phase: string, startedAt: number): CanonicalFrontendState =>
			({
				activity_phase: phase,
				activity_phase_started_at: startedAt,
			}) as unknown as CanonicalFrontendState;
		// The snapshot's own seed, applied exactly as the session hook applies it:
		// a compose frame, then the start that replaces it, both before any
		// post-snapshot event.
		const resumed = applyLiveSeed(
			EMPTY_TRANSCRIPT,
			{
				...folded("running", agoS(RUNNING_MS)),
				streaming: true,
				generation: 1,
				live_events: [
					{
						type: "tool_call_compose",
						tool_call_id: "call-resume",
						tool_name: "bash",
						argument_bytes: 24,
					},
					{
						type: "tool_execution_start",
						tool_call_id: "call-resume",
						tool_name: "bash",
						intent: "re-running the transport suite",
						args: { command: "pnpm test:desktop" },
						started_at_epoch: agoS(RUNNING_MS),
					},
				],
			},
			now,
		);
		return (
			<div className="flex flex-col gap-6 bg-canvas p-6 lg:flex-row">
				<div className="min-w-0 flex-1">
					<p className="pb-2 text-body-sm text-ink-muted">
						Resumed on a MODEL CALL: nothing has painted yet for this turn, so
						the band is the only thing on screen carrying the clock. The
						snapshot states that this phase began {age(THINKING_MS)} ago; the
						band resumes that age and counts on, or restarts from this view's
						mount.
					</p>
					<Frame
						height={240}
						waiting={true}
						frontend={folded("thinking", agoS(THINKING_MS))}
						records={[
							{
								kind: "user",
								id: "u-resume",
								ts: TS,
								text: "Re-run the transport suite against the resumed clock.",
								images: [],
							},
						]}
					/>
				</div>
				<div className="min-w-0 flex-1">
					<p className="pb-2 text-body-sm text-ink-muted">
						Resumed on a RUNNING BATCH: the oldest call in the batch. The
						snapshot states it began {age(RUNNING_MS)} ago; the row and the band
						resume that age and count on, or count from the moment this view
						loaded.
					</p>
					<Frame
						height={240}
						waiting={true}
						frontend={folded("running", agoS(RUNNING_MS))}
						records={resumed.records}
					/>
				</div>
			</div>
		);
	},
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

/* ------------------------------------------- expanded detail and receipts */

/*
 * The operator's report, and what these stories are evidence about:
 *
 *   "Expanded tool rows render JSON.stringify(args) in one bordered box and the
 *   output in a second; an inbound peer message renders its own card whose body
 *   is the raw `<peer-session-message …>` envelope."
 *
 * So the review question is a reading question, and these frames are the only
 * way to answer it: does an expansion read as ONE pane on one ground, does a
 * receipt read as a row on the same ledger as the calls beside it, and can a
 * capped section hide the result it was opened for? What they do NOT show is
 * asserted instead — that no JSON punctuation reaches the pane, that no envelope
 * reaches the record, and that a hostile sender field cannot reorder a label —
 * in the sections of `scripts/tool-row.test.mjs` and
 * `scripts/transcript-reducer.test.mjs`, because an absence is invisible on a
 * screenshot.
 *
 * Every one of them renders the PRODUCTION `CanonicalTranscript` from real
 * `TranscriptRecord`s and reaches its bodies through the row's own disclosure,
 * so what is judged is what ships. The one exception is deliberate and is
 * stated where it is used: the hostile-sender fixture is built through
 * `peerFields`, because a hand-built sender would bypass the sanitiser and the
 * frame would then be a picture of an input the app cannot produce.
 */

/** A receipt's sender, in the shape the reducer projects off the wire. */
const PEER_SENDER = {
	pid: "92064",
	conversationName: "review-agent",
	cwd: "/Users/damian/local-operator-ui",
	sessionId: "01J8ZQ4K7XABCDEF",
	modelLabel: "deepseek/deepseek-flash",
};

/**
 * One peer message. `sender: null` is a delivery with no identity at all, which
 * the row has to survive: the fallback vocabulary is "another session" rather
 * than a blank column.
 */
const peer = (
	over: Partial<Extract<TranscriptRecord, { kind: "peer" }>> & { id: string },
): Extract<TranscriptRecord, { kind: "peer" }> => ({
	kind: "peer",
	ts: TS,
	body: "",
	sender: PEER_SENDER,
	...over,
});

/** One wake delivery, envelope and all — the headline is derived from it. */
const wake = (
	over: Partial<Extract<TranscriptRecord, { kind: "wake" }>> & { id: string },
): Extract<TranscriptRecord, { kind: "wake" }> => ({
	kind: "wake",
	ts: TS,
	text: '(alarm) Scheduled wake w-9 (1, every 6h) — cancel with wake({op:"cancel",id:"w-9"})',
	...over,
});

/**
 * The expansion of an ordinary call: one pane, a labelled block per argument,
 * then the result.
 *
 * Three cases, because they are the three the old rendering made unreadable in
 * different ways. `bash` is the one the operator screenshotted — a command and a
 * wall of stdout, which the pane separates by a LABEL rather than by a second
 * box. `read` is the case where the arguments and the result look alike (a path
 * and file contents), which is exactly when two boxes were load-bearing and a
 * label has to do the work instead. The MCP row is the JSON case: `params` used
 * to print as `{"filter": {"status": "open"}}` and now prints as
 * `params.filter.status: open`.
 */
export const ExpandedDetail: Story = {
	render: () => (
		<Frame
			height={760}
			openRows
			records={[
				tool({
					id: "tool:bash",
					toolName: "bash",
					args: { command: "pnpm test:desktop 2>&1 | tail -3" },
					output: "ℹ tests 40\nℹ pass 40\nℹ fail 0\n",
					durationS: 92.4,
				}),
				tool({
					id: "tool:read",
					toolName: "read",
					args: {
						path: "src/renderer/src/features/chat/components/trace/tool-row.tsx",
						offset: 100,
						limit: 40,
					},
					output:
						'const ROW_HEIGHT = "min-h-5 py-0";\n\nexport type ToolRowProps = {\n\t/** Wire name. Drives the glyph and the category ink. */\n\ttoolName: string;',
					durationS: 0.04,
				}),
				tool({
					id: "tool:mcp",
					toolName: "mcp__linear__create_issue",
					args: {
						team: "core",
						title: "Expanded tool rows leak machine syntax",
						params: {
							filter: { status: "open", assignee: "damianvtran" },
							tags: ["ui", "trace"],
						},
						dry_run: false,
					},
					output: "Created ENG-1284",
					durationS: 1.21,
				}),
			]}
		/>
	),
};

/**
 * A result that IS JSON, and one that only looks like it.
 *
 * The rule is narrow on purpose: a result is structured only when it parses
 * cleanly AND its root is an object or an array. Object, array and non-JSON side
 * by side, so the boundary is visible — `exit code: 0` is not JSON and must stay
 * byte-for-byte, and a bare `200` in a result body is a value the tool chose to
 * print, not a record.
 */
export const ExpandedJsonResult: Story = {
	render: () => (
		<Frame
			height={760}
			openRows
			records={[
				tool({
					id: "tool:json-object",
					toolName: "mcp__linear__list_issues",
					args: { team: "core", state: "open" },
					output: JSON.stringify(
						{
							items: [
								{
									id: "ENG-1284",
									title: "Expanded tool rows leak machine syntax",
									labels: ["ui"],
								},
								{
									id: "ENG-1290",
									title: "Peer messages render an envelope",
									labels: ["trace"],
								},
							],
							total: 2,
							has_more: false,
						},
						null,
						2,
					),
					durationS: 0.88,
				}),
				tool({
					id: "tool:json-array",
					toolName: "glob",
					args: { pattern: "src/**/*.stories.tsx" },
					output: JSON.stringify(
						["tool-row.stories.tsx", "trace.stories.tsx"],
						null,
						2,
					),
					durationS: 0.11,
				}),
				tool({
					id: "tool:plain",
					toolName: "grep",
					args: { pattern: "peer-session-message", path: "src" },
					output: "no matches",
					durationS: 0.07,
				}),
			]}
		/>
	),
};

/**
 * A failed call: the arguments stay beside the error.
 *
 * The TUI's rule (`tool_card.py`, the `elif self._output:` branch): a settled
 * SUCCESSFUL `write`/`edit` with a diff expands to the diff alone, because the
 * arguments are the same change stated twice — but a failure produced no diff,
 * and there the inputs are the only account of what was attempted. The error
 * only makes sense next to them, so the pane shows both, with the result in the
 * danger ink and its label reading `Error`.
 */
export const ExpandedFailedEdit: Story = {
	render: () => (
		<Frame
			height={420}
			openRows
			records={[
				tool({
					id: "tool:failed-edit",
					toolName: "edit",
					args: {
						path: "src/renderer/src/features/chat/canonical/transcript-reducer.ts",
						old_text: "const SILENT_CUSTOM_TYPES = new Set([",
						new_text: "const SILENT_CUSTOM_TYPES = new Set<string>([",
					},
					output: "Error: old_text did not match the file at line 543",
					isError: true,
					durationS: 0.03,
				}),
			]}
		/>
	),
};

/**
 * A realistic deploy script, and the build log a verification run prints.
 *
 * Both are the SHAPE of the operator's own calls rather than a repeat of one line
 * N times: a script whose lines differ in length and indent is what the wrap rule
 * and the cap are judged against, and a log at the real column widths is what
 * tells a reader the pane is printing byte-for-byte rather than reflowing.
 */
const LONG_SCRIPT = [
	"set -euo pipefail",
	'cd "$(git rev-parse --show-toplevel)"',
	"git fetch origin main --quiet",
	"git rebase origin/main || { git rebase --abort; exit 1; }",
	"pnpm install --frozen-lockfile",
	"pnpm lint",
	"pnpm check-types",
	"pnpm check-themes",
	"pnpm check-evidence",
	"pnpm test:desktop",
	"pnpm bundle-size",
	"pnpm startup-closure",
	"pnpm build",
	"for job in out/main/index.js out/preload/index.js; do",
	'  test -s "$job" || { echo "missing $job"; exit 1; }',
	"done",
	"git status --short > /tmp/status.txt",
	"wc -l < /tmp/status.txt",
	'echo "deploy ready"',
].join("\n");

const BUILD_LOG = [
	"vite v7.1.5 building for production...",
	"✓ 1840 modules transformed.",
	"renderer/index.html                     0.62 kB │ gzip:  0.38 kB",
	"assets/index-Dd9kj2.css               142.18 kB │ gzip: 18.44 kB",
	"assets/index-B7xq1P.js                412.55 kB │ gzip: 118.02 kB",
	"assets/desktop-B1mQ8a.js            2,318.44 kB │ gzip: 604.77 kB",
	"✓ built in 13.58s",
	"",
	"pnpm test:desktop › scripts/tool-row.test.mjs",
	"ℹ tests 43",
	"ℹ pass 43",
	"ℹ fail 0",
	"",
	"pnpm test:desktop › scripts/transcript-reducer.test.mjs",
	"ℹ tests 42",
	"ℹ pass 42",
	"ℹ fail 0",
	"",
	"pnpm test:desktop › scripts/chat-search.test.mjs",
	"ℹ tests 31",
	"ℹ pass 31",
	"ℹ fail 0",
].join("\n");

/**
 * A pane whose INPUT overflows, and one where the input AND the result both do.
 *
 * This is the frame the earlier set could not produce, and that is exactly why the
 * defect survived it: every committed pane had `scrollHeight == clientHeight`, so
 * the cap was never exercised and nothing showed that a long argument list pushed
 * the `Output` label and the whole result below the pane's own bottom edge
 * (design round 1, D1 — the label's top edge measured y=416 against a pane bottom
 * of 408, and an ordinary three-line result was sliced through its own glyphs).
 *
 * The two rows are the two shapes that reach it. The first is a realistic deploy
 * script in `command` — long enough to cap — with a short result under it, which
 * is the case that used to hide the result. The second is long on BOTH sides, so
 * the input and the result each spend their own ceiling and neither can take the
 * other's.
 *
 * What to read in the frames: the result's label and its first lines are visible
 * with the input capped above them, and each capped section prints the terminal's
 * own `… N more line(s)` under itself rather than leaving a scroll region's
 * overflow to be discovered.
 *
 * Two stories rather than one story at two widths, which is the diff body's own
 * precedent: at 560 the same script WRAPS, so the input block grows to a height
 * the wide frame does not need, and a frame sized for the narrow pass would be
 * mostly empty ground at 1280 while one sized for the wide pass would clip the
 * narrow one. Both share the records below; only the viewport and the Frame's
 * height differ.
 */
const OVERFLOW_RECORDS: TranscriptRecord[] = [
	tool({
		id: "tool:long-script",
		toolName: "bash",
		args: { command: LONG_SCRIPT, timeout_ms: 600_000 },
		output: "deploy ready\n",
		durationS: 128.6,
	}),
	tool({
		id: "tool:long-both",
		toolName: "mcp__linear__list_issues",
		args: {
			query: "expanded rows leak machine syntax into the transcript",
			params: {
				filter: {
					status: "open",
					assignee: "damianvtran",
					labels: ["ui", "trace"],
				},
				order: { field: "updated", direction: "descending" },
				include: { comments: true, attachments: false },
			},
			limit: 25,
			cursor: "eyJvZmZzZXQiOjI1LCJxdWVyeSI6InByb2ZpbGUgbGVhayJ9",
			dry_run: false,
		},
		output: BUILD_LOG,
		durationS: 3.4,
	}),
];

export const ExpandedOverflow: Story = {
	render: () => <Frame height={1100} openRows records={OVERFLOW_RECORDS} />,
};

/**
 * The same two calls in a 560px column, where the same script WRAPS.
 *
 * The pane is the same HEIGHT here — each section is capped, so a narrower
 * column does not make the expansion taller, it makes the same arguments occupy
 * more rows. What changes is what fits inside the two ceilings: a wrapped `key:
 * value` line puts its value under its key, so fewer arguments fit in the input
 * block and the report under it counts more of them. That is the case worth
 * looking at, because it is the one where a reader has to be able to tell that
 * the block continues.
 */
export const ExpandedOverflowNarrow: Story = {
	render: () => <Frame height={1100} openRows records={OVERFLOW_RECORDS} />,
};

/**
 * The results that hold nothing, and the row that holds nothing to disclose.
 *
 * Three shapes that all used to put something on screen that should not be
 * there. An empty container (`{}`, `{"items": []}`) is what a "no rows found" API
 * returns, and the pane used to fall back to printing the raw braces under its
 * own `Output` label — the JSON punctuation this pane exists to keep out
 * (reviewer F4). It now prints `(empty)`, the word the producer itself writes for
 * a section that held nothing.
 *
 * The third row is the disclosure gate. Its arguments are an all-empty container
 * and it printed no result, so `argumentLines` yields nothing — and the row used
 * to OFFER a disclosure anyway, opening onto a bordered, padded, empty `sunken`
 * box (reviewer F2, QA Q-2, photographed empty in the running app). It is a
 * STATIC row here: no chevron, no hover, nothing to open. That is the readable
 * half of the fix — the gate agreeing with the pane.
 */
export const ExpandedEmptyResult: Story = {
	render: () => (
		<Frame
			height={420}
			openRows
			records={[
				tool({
					id: "tool:empty-object",
					toolName: "read",
					args: { path: "docs/ledger.md" },
					output: "{}",
					durationS: 0.02,
				}),
				tool({
					id: "tool:empty-rows",
					toolName: "mcp__linear__list_issues",
					args: { team: "core", state: "open" },
					output: JSON.stringify({ items: [] }, null, 2),
					durationS: 0.41,
				}),
				tool({
					id: "tool:no-detail",
					toolName: "mcp__linear__list_issues",
					args: { params: {} },
					output: "",
					durationS: 0.38,
				}),
			]}
		/>
	),
};

/**
 * The two receipt rows, and the row that has nothing to disclose.
 *
 * A peer message and a wake delivery are LEDGER rows — the TUI draws both
 * (`PeerMessageBlock`, `WakeBlock`) and the phone's fold agrees — so a note that
 * arrived mid-run belongs to the run rather than floating as a card.
 *
 * Four cases, and the first pair is the one that needs both states in ONE frame:
 * a collapsed peer row is the sender and a preview, and the expansion is the
 * pid, the model and the whole message. The third has no body at all and must
 * still paint, because the identity is what the disclosure is for; the fourth is
 * the wake receipt, whose headline is `w-9 (1, every 6h)` rather than the
 * `(alarm) … — cancel with wake({op:"cancel",id:"w-9"})` markup the model reads.
 */
export const ReceiptRows: Story = {
	render: () => (
		<Frame
			height={560}
			openRows
			keepClosed={[0]}
			records={[
				peer({
					id: "peer:1",
					body: "can you look at the flaky test in warm-session?",
				}),
				peer({
					id: "peer:2",
					body: "PR #154 is ready for review.\n\nThe peer envelope was still leaking onto the row, so the receipt now projects details.body and details.sender instead.\n\nNo rush — the gate is green either way.",
				}),
				peer({
					id: "peer:3",
					body: "",
					sender: {
						...PEER_SENDER,
						conversationName: "",
						cwd: "",
						sessionId: "",
					},
				}),
				wake({
					id: "wake:1",
					text: '(alarm) Scheduled wake w-9 (1, every 6h) — cancel with wake({op:"cancel",id:"w-9"})\n\ncheck the deploy finished before you answer',
				}),
			]}
		/>
	),
};

/**
 * The hostile sender: what the row's sanitiser does with a name that fights back.
 *
 * The sender fields cross a process boundary from another session, so a
 * conversation name is free text the peer chose, and three of the hazards have
 * been reproduced on this row (reviewer F1, QA Q-1): an unterminated `U+202E`
 * reverses every glyph after it — including the pid printed beside the name, the
 * one field a reader uses to address the peer back — and a control sequence
 * re-inks whatever it is painted into.
 *
 * The fixture is built through `peerFields` rather than by hand, and that is the
 * point of it: `peerFields` is the one constructor of a `PeerSender` (the reducer
 * projects every wire row through it), so this story runs the REAL sanitiser over
 * the REAL wire shape. A hand-built sender would bypass the sanitiser and the
 * frame would then be a picture of an input the app cannot produce.
 *
 * Three rows, one collapsed: the collapsed summary is where the scrambled name
 * used to read `… rednes eltioth a morf ydob A`, the expanded identity line is
 * where the pid sat beside it, and the third row is the SIZE hazard — a name
 * bounded rather than allowed to own the row.
 */
export const ReceiptHostileSender: Story = {
	render: () => (
		<Frame
			height={300}
			openRows
			keepClosed={[0]}
			records={[
				peer({
					id: "peer:bidi",
					// A newline, a tab and an RTL override in ONE name: the shape
					// hazard and the rendering hazard together, which is how the
					// reported frame read.
					...peerFields({
						body: "the flaky test is in warm-session.test.mjs — can you take it?",
						sender: {
							pid: 7780000001234,
							conversation_name:
								"first line\nsecond line\ttabbed\u202eRTL override",
							cwd: "/Users/damian/local-operator-ui-worktrees/tool-trace-legibility",
							session_id: "01J8ZQ4K7XABCDEFGHJKMNPQRS",
							model_label: "anthropic/claude-opus-5",
						},
					}),
				}),
				peer({
					id: "peer:control",
					// A CSI colour and an OSC window title, the two sequence forms the
					// 7-bit-only pattern used to leave behind.
					...peerFields({
						body: "",
						sender: {
							pid: 92064,
							conversation_name: "a\u001b[31mred\u001b]0;pwned\u0007agent",
							model_label: "deepseek/deepseek-flash",
						},
					}),
				}),
				peer({
					id: "peer:long",
					...peerFields({
						body: "",
						sender: {
							pid: 48213,
							conversation_name: `malformed-${"overlong-conversation-name-".repeat(
								8,
							)}ui`,
							model_label: "openai/gpt-5",
						},
					}),
				}),
			]}
		/>
	),
};

/**
 * ONE run, both row KINDS: three tool calls with a peer message and a wake
 * delivery between them.
 *
 * The gap this closes was stated rather than hidden in round 2 (design, §
 * "Checked and NOT filed"): every committed frame carried one kind at a time, so
 * "the receipt rows share the ledger's own name column" rested on the mechanism
 * (`ledgerName` feeds the single `toolNameColumn` measurement) plus a round-1
 * mixed-list frame that predates the receipt projection — not on a picture taken
 * at the head it was claimed of. A measurement is what makes the claim true, and
 * a frame is what makes it checkable by a reader who was not here.
 *
 * What to read in it, in the order the rows are stacked:
 *
 * - ONE rail and ONE name column across both kinds. `bash`, `read`, `write` and
 *   the receipts' `peer` / `wake` names start at the same x and take the same
 *   `ink-muted`, because the column is sized once for the longest name visible
 *   in the transcript and every kind takes part in that one measurement. A run
 *   that had two spines — a tool column and a receipt column — would show two
 *   left edges here and nowhere else, which is exactly why one kind per frame
 *   could not settle it.
 * - The expanded pane's argument text and the expanded receipt's body sit on the
 *   SAME rail to within the pane's own hairline (design round 1, D2: 1px, and it
 *   is the border). Both are in shot above and below each other.
 * - A note that arrived mid-run belongs to the run: the peer row is a ledger row
 *   between two calls rather than a card floating over them, and the wake
 *   delivery reads `w-9 (1, every 6h)` rather than the `(alarm) … — cancel with
 *   wake({…})` markup the model reads.
 *
 * Every row is opened through its own trigger, which is why the collapsed
 * states are not the subject here — `receipt-rows` carries that pair.
 */
export const MixedRun: Story = {
	render: () => (
		<Frame
			height={830}
			openRows
			records={[
				tool({
					id: "tool:mixed-bash",
					toolName: "bash",
					args: {
						command: "pnpm test:desktop 2>&1 | tail -3",
						timeout_ms: 600_000,
					},
					output: "ℹ tests 820\nℹ pass 816\nℹ fail 4\n",
					durationS: 92.4,
				}),
				peer({
					id: "peer:mixed",
					body: "the receipts and the tool rows share one name column now — can you check a run that has both?",
				}),
				tool({
					id: "tool:mixed-read",
					toolName: "read",
					args: {
						path: "src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
						offset: 108,
						limit: 20,
					},
					output:
						'const ledgerName = (record: TranscriptRecord) =>\n\trecord.kind === "peer" || record.kind === "wake"\n\t\t? displayName(record.kind)\n\t\t: toolDisplayName(record.toolName);',
					durationS: 0.04,
				}),
				wake({
					id: "wake:mixed",
					text: '(alarm) Scheduled wake w-9 (1, every 6h) — cancel with wake({op:"cancel",id:"w-9"})\n\ncheck the deploy finished before you answer',
				}),
				tool({
					id: "tool:mixed-write",
					toolName: "write",
					args: {
						path: "scripts/tool-row.test.mjs",
						content: "// the mixed-run case, pinned rather than photographed",
					},
					output: "Written 1 line to scripts/tool-row.test.mjs",
					durationS: 0.03,
				}),
			]}
		/>
	),
};

/** A canonical tool row carrying ONE screenshot — the operator's own report. */
export const Screenshots: Story = {
	render: () => (
		<Frame
			height={420}
			records={[
				tool({
					id: "tool:shot:1",
					toolName: "read",
					args: { path: "/Users/damian/local-operator-ui/docs/branding.md" },
					durationS: 0.04,
					output: "# Branding and design system",
					images: [image("tool:shot:1:0", SHOT_B64)],
				}),
			]}
		/>
	),
};

/** Two screenshots in ONE row, which is where the `Screenshot 1`/`2` labels appear. */
export const ScreenshotsTwo: Story = {
	render: () => (
		<Frame
			height={700}
			records={[
				tool({
					id: "tool:shot:2",
					toolName: "read",
					args: { path: "/tmp/frames" },
					durationS: 1.2,
					output: "2 images",
					images: [
						image("tool:shot:2:0", SHOT_B64),
						image("tool:shot:2:1", TALL_B64),
					],
				}),
			]}
		/>
	),
};

/**
 * A USER turn carrying two attachments, which is the other label family
 * (`Attached image 1` / `2`) and the other call site of the same component
 * (`canonical-transcript.tsx`). One story, because the labels are the surface.
 */
export const UserAttachments: Story = {
	render: () => (
		<Frame
			height={700}
			records={[
				{
					kind: "user",
					id: "user:shots:1",
					ts: TS,
					text: "Here are the two frames I rendered.",
					images: [
						image("user:shots:1:0", SHOT_B64),
						image("user:shots:1:1", TALL_B64),
					],
				},
			]}
		/>
	),
};
