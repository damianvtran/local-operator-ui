/**
 * THE COLLAPSED TURN'S OWN STATES (the frozen design's §4-§5).
 *
 * Why this is a story beside the tests. `turn-collapse-model.test.mjs` asserts
 * the plan's arithmetic and `turn-collapse-behaviour.test.mjs` drives the
 * interactions through the shipped transcript; neither can show the LINE a
 * reader looks at, in the pane a reader reads it in. The change is a row on
 * screen, so the evidence for it is a frame - one per state of the §5 case
 * matrix that a still can express, plus the live control.
 *
 * THE FIXTURES ARE BUILT THROUGH THE REAL REDUCER, so the records these cells
 * render are the records the app paints, `settledAt` included: the collapsed
 * bar's span is derived from frames of actual events, not a number typed beside
 * them. `Restored` is the one durable cell - a history page, no live `ts` to
 * settle from, which is exactly the state reload lands readers in.
 *
 * THE CAPTIONS ARE FIXTURE-LEVEL ON PURPOSE. The before half of this pair is
 * the same story on the pre-change tree (§10), where nothing collapses; a
 * caption that said "the work folds to one line" would be false of that frame.
 * Each caption names what the fixture IS, so it reads true on both halves.
 *
 * THE PANE IS PINNED (685px, the transcript's measured `clientHeight` at
 * 1380x900 - the figure the other transcript stories pin), so a cell cannot
 * quietly grow its viewport into a state no reader is in.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type {
	DesktopHistoryPage,
	PendingDesktopGate,
} from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import type { CanonicalTranscriptStatus } from "./transcript-pane";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

/** One instant for every frame, so the frames are byte-reproducible. */
const TS = 1_760_000_000_000;

/**
 * The wall clock the LIVE cells measure against (design round 1, D5).
 *
 * A cell whose row is still running paints elapsed = now − start (`formatDuration`
 * clamps), so a fixture pinned to `TS` alone read `100d+` — the capture-time now
 * against a stamp from last October. The frozen `TS` stays where the frame's
 * stamps are FICTION-FREE anyway (a completed turn's stamp is a fixed fact), and
 * the two in-flight cells (`Running`, `Parked`) take `NOW` instead so their
 * clocks describe the seconds the frame actually shows.
 */
const NOW = Date.now();

/** The reader's own pane height (see the file comment). */
const PANE = 685;

const userMessage = (id: string, text: string) => ({
	id,
	role: "user",
	content: [{ type: "text", text }],
	tool_calls: [],
});

const assistantMessage = (id: string, text: string) => ({
	id,
	role: "assistant",
	content: text ? [{ type: "text", text }] : [],
	tool_calls: [],
});

type CallSpec = {
	id: string;
	name: string;
	command: string;
	durationS: number;
	failed?: boolean;
	/** Left in flight: the start's frame and nothing after it. */
	holding?: boolean;
};

/**
 * One call on the ledger, as the transcript's own events paint it: a start
 * frame (which is where the row's `ts` and its `startedAt` come from) and,
 * unless the call is still running, the end frame that settles it - the end's
 * `endedAt` is the reducer's own composition (`startedAt + duration_s`), so the
 * bar's span reads the same arithmetic the app would run.
 */
const runCalls = (
	state: TranscriptState,
	calls: CallSpec[],
	startMs: number,
	spacingMs = 10_000,
): TranscriptState => {
	let next = state;
	let at = startMs;
	for (const call of calls) {
		next = applyEvent(
			next,
			{
				type: "tool_execution_start",
				tool_call_id: call.id,
				tool_name: call.name,
				args: { command: call.command },
			},
			at,
		);
		if (!call.holding) {
			next = applyEvent(
				next,
				{
					type: "tool_execution_end",
					tool_call_id: call.id,
					tool_name: call.name,
					result: { content: [{ type: "text", text: `${call.id} done\n` }] },
					is_error: call.failed === true,
					duration_s: call.durationS,
				},
				at + 500,
			);
		}
		at += spacingMs;
	}
	return next;
};

const CALL_A: CallSpec = {
	id: "c1",
	name: "bash",
	command: "pnpm test:desktop",
	durationS: 12.5,
};
const CALL_B: CallSpec = {
	id: "c2",
	name: "read",
	command: "src/invoices/query.ts",
	durationS: 0.4,
};

/**
 * A finished turn: the question, some calls, the answer - with the answer
 * settling at its own frame (`message_end`), which is the live half of the
 * span (`settledAt`; the durable half is `Restored`).
 */
const finishedTurn = (calls: CallSpec[]): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = runCalls(state, calls, TS + 2_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 70_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", ANSWER) },
		TS + 72_000,
	);
};

const QUESTION = "Which invoices were late last month?";
const ANSWER =
	"Four were late: 1042, 1088, 1103 and 1177. The pattern is the card that expired on file.";

/**
 * A turn the reader STEERED: the second question arrives while the first
 * answer is still being written, so it is not a turn of its own - it belongs
 * to the run it interrupted, and the collapse carries it inside.
 */
const steeredTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = runCalls(state, [CALL_A], TS + 2_000);
	state = applyEvent(
		state,
		{
			type: "message_start",
			message: userMessage(
				"u2",
				"Actually, include the ones credited late too.",
			),
		},
		TS + 30_000,
	);
	state = runCalls(state, [CALL_B], TS + 32_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 70_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", ANSWER) },
		TS + 72_000,
	);
};

/**
 * A turn the READER STOPPED: the answer was being written when the abort
 * arrived, so the record settles at the turn end's own frame (`agent_end`'s
 * sweep) and keeps its `Stopped before finishing` caption - the collapse does
 * not restate the interruption in the bar (v1; the sibling session owns the
 * outcome wording).
 */
const interruptedTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = runCalls(state, [CALL_A], TS + 2_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 40_000,
	);
	state = applyEvent(
		state,
		{
			type: "message_update",
			delta: "I was checking the credit ledger when",
			message: assistantMessage("a1", ""),
		},
		TS + 40_500,
	);
	return applyEvent(state, { type: "agent_end", aborted: true }, TS + 41_000);
};

/** A turn where one call genuinely ERRORED: the bar's one failure control. */
const failedTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = runCalls(state, [{ ...CALL_A, failed: true }, CALL_B], TS + 2_000);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 70_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", ANSWER) },
		TS + 72_000,
	);
};

/** Twelve calls, so the count clause is read at its long form. */
const LONG_CALLS: CallSpec[] = [
	{ id: "l1", name: "read", command: "src/invoices/query.ts", durationS: 0.3 },
	{
		id: "l2",
		name: "read",
		command: "src/invoices/refunds.ts",
		durationS: 0.4,
	},
	{
		id: "l3",
		name: "bash",
		command: "psql -c 'select * from invoices'",
		durationS: 4.2,
	},
	{
		id: "l4",
		name: "bash",
		command: "psql -c 'select * from credits'",
		durationS: 3.8,
	},
	{
		id: "l5",
		name: "eval",
		command: "join_frames.py --month august",
		durationS: 8.1,
	},
	{
		id: "l6",
		name: "eval",
		command: "late_by_card.py --month august",
		durationS: 2.9,
	},
	{ id: "l7", name: "read", command: "src/cards/expiry.ts", durationS: 0.5 },
	{ id: "l8", name: "bash", command: "git log --oneline -5", durationS: 0.2 },
	{
		id: "l9",
		name: "read",
		command: "src/settings/tolerance.ts",
		durationS: 0.3,
	},
	{ id: "l10", name: "bash", command: "rg 'grace_period' src", durationS: 1.1 },
	{ id: "l11", name: "eval", command: "tolerance_check.py", durationS: 3.4 },
	{
		id: "l12",
		name: "bash",
		command: "pnpm vitest run invoices",
		durationS: 6.6,
	},
];

/**
 * The same completed turn read from HISTORY: durable rows, whose `ts` is the
 * commit the runtime wrote, and no live frames at all - no `settledAt`, which
 * is the state reload lands readers in (the span must still read the same).
 */
const restoredTurn = (): TranscriptState => {
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	/*
	 * DURABLE ENTRIES CARRY SECONDS, not milliseconds (design round 1, D1):
	 * `applyHistoryPage` multiplies by 1000 the way the wire stores them, so
	 * feeding it `TS` read 72,000ms as 72,000s — `Took 20h`, stamp year 57742.
	 * The frame must read what the collapsed cell reads: `Took 1m12s` and
	 * `Oct 9, 2025`.
	 */
	const S = TS / 1000;
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * A turn still in flight: the control - nothing condenses while it runs.
 *
 * The stamps sit BEHIND the capture's own clock (D5): a call started five
 * seconds ago reads `5s` rather than the `0s` a start at module load shows or
 * the `100d+` the frozen `TS` showed.
 */
const runningTurn = (): TranscriptState => {
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		NOW - 10_000,
	);
	return runCalls(
		state,
		[
			{ ...CALL_A, holding: true },
			{ ...CALL_B, holding: true },
		],
		NOW - 5_000,
	);
};

/**
 * A turn PARKED on the reader's gate (design review round 1, D3).
 *
 * The same shape the live rig parks in: the call is out and the transcript
 * awaits an approval, so the pane's working line stands down - which is why
 * the collapse cannot read the working line alone. `Parked` passes the gate;
 * the fix's own test is that NO bar renders here (and the live set carries the
 * moment with its question card).
 */
const parkedTurn = (): TranscriptState => {
	const state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		NOW - 10_000,
	);
	return runCalls(state, [{ ...CALL_A, holding: true }], NOW - 5_000);
};

/** A minimal pending approval, shaped as the wire sends it. */
const PARKED_GATE: PendingDesktopGate = {
	request_id: "gate-1",
	kind: "approval",
	title: "Run the checks?",
	detail: "bash: pnpm test:desktop",
	options: [{ label: "Approve" }, { label: "Deny" }],
	secret: false,
	question_index: 0,
	question_total: 1,
};

/**
 * §5 case 3 (design round 1, D4a): the in-between is NARRATION - a settled
 * mid-turn assistant row and no calls at all - so the bar's whole sentence is
 * the span (`Took 1m12s`, no action clause).
 */
const narrationTurn = (): TranscriptState => {
	let state = applyEvent(
		EMPTY_TRANSCRIPT,
		{ type: "message_start", message: userMessage("u1", QUESTION) },
		TS,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("n1", "") },
		TS + 20_000,
	);
	state = applyEvent(
		state,
		{
			type: "message_end",
			message: assistantMessage("n1", "Checking the invoice ledger first."),
		},
		TS + 21_000,
	);
	state = applyEvent(
		state,
		{ type: "message_start", message: assistantMessage("a1", "") },
		TS + 70_000,
	);
	return applyEvent(
		state,
		{ type: "message_end", message: assistantMessage("a1", ANSWER) },
		TS + 72_000,
	);
};

/**
 * §11-R4 (design round 1, D4b): a PINNED statement inside the span - a
 * completion marker between two call rows - so the clustering the caveat names
 * is on a frame: collapsed, the marker sits below the bar, in its own place.
 */
const pinnedTurn = (): TranscriptState => {
	const S = TS / 1000;
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	/*
	 * The marker is a CUSTOM entry, not a message (the durable reader switches
	 * on `entry.type === "custom" && payload.custom_type ===
	 * "completion_attention"`): a `message` spelling of it silently paints
	 * nothing, which is how the first capture of this cell missed its notice.
	 */
	const customEntry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "custom", payload });
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			customEntry("n1", S + 6, {
				custom_type: "completion_attention",
				details: { anchor: "n1", kind: "interrupted" },
			}),
			entry("t2", S + 9, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * THE OPERATOR'S OWN STATE (2026-09-29, issue: the condensed bar's spacing):
 * "the condensed row ('Context compacted') hugs the summary row's rule too
 * closely" and "the chevron ('>') doesn't reach the right end of the rule".
 *
 * The `pinned` cell above photographs a completion MARKER; this one is the pin
 * list's first member - the memory statement - read durably so its sentence is
 * the cold reader's own (`COMPACTED_LINE`), which is the string the report
 * quotes and the row BOTH halves of the fix move: the gap under the bar's rule,
 * and the bar's own chevron against the rule's end.
 */
const compactedTurn = (): TranscriptState => {
	const S = TS / 1000;
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			/*
			 * The durable compaction entry: `append_compaction` writes
			 * `tokens_before` and no after-figure, and a row with no settled
			 * sentence of its own keeps `COMPACTED_LINE` - the operator's row.
			 */
			{
				id: "n1",
				ts: S + 6,
				type: "compaction",
				payload: { tokens_before: 41_000 },
			},
			entry("t2", S + 9, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/**
 * ISSUE #5'S CELL (operator feedback, 2026-09-29): the turn as the operator
 * sees it when a window-collect runs - peer and wake delivery receipts among
 * the call rows. Under the narrowed pin list these collapse WITH the work, and
 * the pair of frames (this one, and the same story pressed open in the
 * capture table) is what the design round judges.
 */
const receiptsTurn = (): TranscriptState => {
	const S = TS / 1000;
	type Entry = DesktopHistoryPage["entries"][number];
	const entry = (
		id: string,
		ts: number,
		payload: Record<string, unknown>,
	): Entry => ({ id, ts, type: "message", payload });
	return applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: [
			entry("u1", S, {
				kind: "message",
				role: "user",
				content: [{ text: QUESTION }],
			}),
			entry("p1", S + 2, {
				kind: "custom",
				custom_type: "peer_message",
				details: {
					body: "window-collect: 140 records staged for the next batch.",
					sender: {
						pid: "",
						conversationName: "ingest-rail",
						cwd: "",
						sessionId: "",
						modelLabel: "",
					},
				},
			}),
			entry("t1", S + 3, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			entry("w1", S + 5, {
				kind: "custom",
				custom_type: "wake_prompt",
				details: {
					text: "(alarm) Scheduled wake w-9 (1, every 6h)\n\nCollect the staged records.",
				},
			}),
			entry("t2", S + 9, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("a1", S + 72, {
				kind: "message",
				role: "assistant",
				content: [{ type: "text", text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

const Frame = ({
	transcript,
	caption,
	status = "live",
	waiting = false,
	gate = null,
}: {
	transcript: TranscriptState;
	caption: string;
	status?: CanonicalTranscriptStatus;
	waiting?: boolean;
	gate?: PendingDesktopGate | null;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			{/* A fixed caption box, so the pair overlays when a reviewer flips
			 * between the frames: two captions of different lengths would move the
			 * conversation under them. */}
			<p className="h-10 text-body-sm text-ink-muted">{caption}</p>
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE }}
				ref={containerRef}
			>
				<CanonicalTranscript
					transcript={transcript}
					gate={gate}
					waiting={waiting}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status={status}
					failure={null}
					awaitingHydration={false}
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "chat/turn-collapse",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

/** §5 case 2-3: a completed turn, the work standing in for one line. */
export const Collapsed: Story = {
	render: () => (
		<Frame
			transcript={finishedTurn([CALL_A, CALL_B])}
			caption="A finished turn — the question, two calls, the answer."
		/>
	),
};

/**
 * The same turn after the reader's press: the bar IS the toggle, and the rows
 * it stood in for are mounted again with their own folds intact. Pressed
 * through the bar's own trigger (`press:` on this story's sweep row) rather
 * than pre-opened, because the question is whether that control opens it.
 */
export const Expanded: Story = {
	render: () => (
		<Frame
			transcript={finishedTurn([CALL_A, CALL_B])}
			caption="The same turn, opened by the reader's press."
		/>
	),
};

/** §5 case 5: the steer is part of the run it interrupted. */
export const Steering: Story = {
	render: () => (
		<Frame
			transcript={steeredTurn()}
			caption="A turn steered mid-run — the second question arrived while the first answer was being written."
		/>
	),
};

/** §5 case 6: interrupted, answer painted; the bar states no outcome. */
export const Interrupted: Story = {
	render: () => (
		<Frame
			transcript={interruptedTurn()}
			caption="A turn the reader stopped — the answer keeps its own caption; the bar does not restate it."
		/>
	),
};

/** §5 case 4: one genuine error, one control away. */
export const Failed: Story = {
	render: () => (
		<Frame
			transcript={failedTurn()}
			caption="A turn with one failed call — no tally on the bar; the red row keeps the state, one press away."
		/>
	),
};

/** §5 case 9: the count clause at its long form. */
export const LongRun: Story = {
	render: () => (
		<Frame
			transcript={finishedTurn(LONG_CALLS)}
			caption="A long turn — twelve calls between the question and the answer."
		/>
	),
};

/** The reload state: durable rows, no live frames, the same span. */
export const Restored: Story = {
	render: () => (
		<Frame
			transcript={restoredTurn()}
			caption="The same turn read from history — durable rows, no live frames."
		/>
	),
};

/** The control: a turn in flight renders as it always did. */
export const Running: Story = {
	render: () => (
		<Frame
			transcript={runningTurn()}
			caption="A turn still in flight — nothing condenses while it runs."
			waiting={true}
		/>
	),
};

/** §5 case 3, named by design round 1 (D4a): narration only, no calls. */
export const Narration: Story = {
	render: () => (
		<Frame
			transcript={narrationTurn()}
			caption="Narration between the question and the answer — no calls, so the bar is the span alone."
		/>
	),
};

/** §11-R4, named by design round 1 (D4b): a pinned statement in the span. */
export const Pinned: Story = {
	render: () => (
		<Frame
			transcript={pinnedTurn()}
			caption="A completion marker among the call rows — a pinned statement the collapse keeps in its own place."
		/>
	),
};

/**
 * THE OPERATOR'S CELL (2026-09-29): the condensation's spacing report. The
 * caption names the state only, so the frame reads as true on the pre-fix half
 * of the pair as well.
 */
export const PinnedCompaction: Story = {
	render: () => (
		<Frame
			transcript={compactedTurn()}
			caption="The memory statement among the call rows — the pinned row the collapsed bar keeps below its rule."
		/>
	),
};

/**
 * D3's cell: the turn parks on the reader's gate, so nothing condenses.
 *
 * The gate is a real `PendingDesktopGate`; the question CARD itself docks
 * above the composer outside this frame (the live set's parked capture shows
 * it), and what this cell pins is the transcript's half of the same moment:
 * no bar while the turn waits.
 */
/**
 * ISSUE #5'S FRAMES: peer and wake receipts inside a completed turn -
 * collapsed here, pressed open by the capture table's second row, so the
 * design round judges the reveal of the receipts the narrowed pins hide.
 */
export const Receipts: Story = {
	render: () => (
		<Frame
			transcript={receiptsTurn()}
			caption="Peer and wake receipts among the call rows — receipts the collapsed bar now stands in for."
		/>
	),
};

export const Parked: Story = {
	render: () => (
		<Frame
			transcript={parkedTurn()}
			caption="A turn parked on an approval — the gate holds it, so nothing condenses."
			gate={PARKED_GATE}
		/>
	),
};
