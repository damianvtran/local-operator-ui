/**
 * One running turn, four moments, through the production reducer: the operator's
 * report that live text HOPPED across its own tool calls while it streamed, and
 * that raw backticks showed before the markdown formed.
 *
 * THE REPORT. A turn streams text A, a `git grep` call, text B (`InfoList` in
 * backticks), a `sed` call. Four photographs of it, in order:
 *   1. A, grep, B, sed - correct;
 *   2. B still between the calls, two calls below;
 *   3. B MOVED below `sed` and a second `sed` (the calls grouped above it), and
 *      now shown as a code span;
 *   4. text C in its correct slot.
 * Moment 3 is the defect: B belongs between the calls it was written between.
 *
 * WHY THESE STORIES ARE THE SAME FILE ON TWO TREES. The pre-fix ranker no longer
 * exists in the shipped code, so a before/after pair cannot be built from one
 * tree by a flag. This file imports only the shipped reducer and the shipped
 * transcript, so rendering it on the base commit (`origin/main`) and on this
 * branch is the whole before/after: the events, the wake latencies and the pane
 * are byte-identical, and the only thing that differs is the ordering rule
 * (`journal-order.ts`'s arrival chain). `scripts/stream-order-live.test.mjs`
 * asserts the same sequence over every wake latency; these stories are the
 * frame the report was about.
 *
 * THE LATENCY IS THE TRIGGER. A `journal_order_ready` wake names a row's
 * `journal_seq` some frames AFTER the row was painted (the runtime refreshes its
 * durable index first). Here the wake for the first call's result lands while the
 * second text is still streaming - the cadence that reproduces the report. With
 * the wakes delivered immediately, or never, the old rule held.
 *
 * `LiveMarkdown` is the second half of the report: text B at the moment its
 * closing backtick has not arrived. Before, the open block painted literally
 * (`` `InfoList ``); after, it is already a code span.
 *
 * Nothing here asserts; the frames are the evidence (docs/evidence/
 * chat-stream-order-live/).
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

type LiveEvent = { type: string; [key: string]: unknown };

const GENERATION = "story-g";
/** The reader's pane: the transcript's own `clientHeight` at 1380x900. */
const PANE = 420;

const text = (id: string, body: string, calls: unknown[] = []) => ({
	id,
	role: "assistant",
	content: body ? [{ type: "text", text: body }] : [],
	tool_calls: calls,
});
const call = (id: string) => ({
	id,
	function: { name: "bash", arguments: "{}" },
});
const ok = { content: [{ type: "text", text: "ok" }] };
/*
 * `message_update` carries the text BEFORE the delta in `message` and the new
 * fragment in `delta` (the reducer appends `body + delta`), so a story streaming
 * one fragment sends an empty `message` - sending the whole text in both paints it twice.
 */
const wake = (...rows: Record<string, unknown>[]): LiveEvent => ({
	type: "journal_order_ready",
	journal_generation: GENERATION,
	rows,
});
const assistantRow = (id: string, seq: number) => ({
	id,
	type: "message",
	role: "assistant",
	journal_seq: seq,
});
const toolRow = (id: string, callId: string, seq: number) => ({
	id,
	type: "message",
	role: "tool",
	tool_call_id: callId,
	journal_seq: seq,
});

const A =
	"First I'll find where this renders and whether `main` already has it.";
const B_FULL =
	"That's `InfoList` in the infoline folder. Next I'll read how it renders items.";
const C =
	"The rows are single-line inputs, which would explain the clipping. I'll read `InfoItem` next.";

/**
 * The turn up to a moment, on one clock with a real `(epoch, seq)` per frame.
 * `bPrefix` is how much of text B has streamed at the moment; the wake for the
 * first call's result lands while B streams, which is what the report needed.
 */
function turn(moment: 1 | 2 | 3 | 4, bPrefix = B_FULL.length): TranscriptState {
	let clock = 1_760_000_000_000;
	let seq = 0;
	let state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		{
			entries: [
				{
					id: "u1",
					type: "message",
					ts: 1_760_000_000,
					payload: {
						id: "u1",
						role: "user",
						content: [{ type: "text", text: "Why are these rows clipped?" }],
						tool_calls: [],
					},
					journal_seq: 0,
				},
			],
			has_more: false,
			cursor_missing: false,
			journal_generation: GENERATION,
			journal_order_state: "ready",
		},
		{ authoritative: true },
	);
	const emit = (event: LiveEvent) => {
		clock += 50;
		seq += 1;
		state = applyEvent(state, event, clock, { frame: { epoch: "e", seq } });
	};
	emit({ type: "message_start", message: text("m1", "") });
	emit({ type: "message_update", message: text("m1", ""), delta: A });
	emit({
		type: "tool_call_compose",
		tool_call_id: "c1",
		tool_name: "bash",
		argument_bytes: 40,
	});
	emit({ type: "message_end", message: text("m1", A, [call("c1")]) });
	emit(wake(assistantRow("m1", 1)));
	emit({
		type: "tool_execution_start",
		tool_call_id: "c1",
		tool_name: "bash",
		args: { command: "git grep -n Other src" },
	});
	emit({
		type: "tool_execution_end",
		tool_call_id: "c1",
		tool_name: "bash",
		result: ok,
		duration_s: 0.7,
	});
	// Moment 1: text B streaming, its call being composed.
	emit({ type: "message_start", message: text("m2", "") });
	const b = B_FULL.slice(0, bPrefix);
	emit({ type: "message_update", message: text("m2", ""), delta: b });
	emit({
		type: "tool_call_compose",
		tool_call_id: "c2",
		tool_name: "bash",
		argument_bytes: 60,
	});
	// The wake for the first call's result lands while B is still streaming.
	emit(wake(toolRow("r1", "c1", 2)));
	if (moment === 1) return state;
	// Moment 2: B is complete (message_end) and its call runs. The wake for B's
	// own row has NOT landed: it trails by the durable-index refresh.
	emit({ type: "message_end", message: text("m2", B_FULL, [call("c2")]) });
	emit({
		type: "tool_execution_start",
		tool_call_id: "c2",
		tool_name: "bash",
		args: { command: "sed -n 170,225p src/InfoList.tsx" },
	});
	if (moment === 2) return state;
	// Moment 3: the call finishes and the next turn step runs a second call
	// (`sed` again, the report's "sed + sed#2"), still before B's wake.
	emit({
		type: "tool_execution_end",
		tool_call_id: "c2",
		tool_name: "bash",
		result: ok,
		duration_s: 0.3,
	});
	emit({ type: "message_start", message: text("m3", "") });
	emit({ type: "message_end", message: text("m3", "", [call("c3")]) });
	emit({
		type: "tool_execution_start",
		tool_call_id: "c3",
		tool_name: "bash",
		args: { command: "sed -n 1,80p src/InfoItem.tsx" },
	});
	if (moment === 3) return state;
	// Moment 4: the wakes land and text C streams in its own slot.
	emit(wake(assistantRow("m2", 3)));
	emit(wake(toolRow("r2", "c2", 4)));
	emit({
		type: "tool_execution_end",
		tool_call_id: "c3",
		tool_name: "bash",
		result: ok,
		duration_s: 0.1,
	});
	emit({ type: "message_start", message: text("m4", "") });
	emit({ type: "message_update", message: text("m4", ""), delta: C });
	return state;
}

/**
 * The snapshot fields the transcript reads to know a turn is IN FLIGHT. The pane
 * is told it is waiting on the agent (`waiting`); without that the turn is read
 * as finished and condenses to its "Took 1s - 2 actions" summary, which hides
 * exactly the rows this story is about - a reader watching a running turn never
 * sees that state.
 */
const LIVE = {
	streaming: true,
	generation: 1,
	live_events: [],
} as unknown as CanonicalFrontendState;

const Frame = ({ transcript }: { transcript: TranscriptState }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE }}
				ref={containerRef}
			>
				<CanonicalTranscript
					transcript={transcript}
					frontend={LIVE}
					gate={null}
					waiting
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					awaitingHydration={false}
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Stream order live",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Text B is streaming and its call is being composed. */
export const Moment1TextStreaming: Story = {
	render: () => <Frame transcript={turn(1)} />,
};

/** B has settled and its call runs: B must stay between its calls. */
export const Moment2CallRunning: Story = {
	render: () => <Frame transcript={turn(2)} />,
};

/** The reported hop: before, B sat below both `sed` calls here. */
export const Moment3NextTextBegins: Story = {
	render: () => <Frame transcript={turn(3)} />,
};

/** Text C arrives in its own slot. */
export const Moment4TextC: Story = {
	render: () => <Frame transcript={turn(4)} />,
};

/** Text B one token before its closing backtick: a code span, not backticks. */
export const LiveMarkdown: Story = {
	render: () => <Frame transcript={turn(1, "That's `InfoList".length)} />,
};

/*
 * REVIEW ROUND 1 FRAMES. The first fix ranked parallel calls by committed slot
 * ahead of arrival, so the NEXT text painted between two parallel calls and hopped
 * below them when the wake landed (R1-M1 / Q2). Same file on the previous head
 * and this one: the before is that head, the after is this one.
 */
function parallelTurn(withText: boolean): TranscriptState {
	let clock = 1_760_000_000_000;
	let seq = 0;
	let state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		{
			entries: [
				{
					id: "u1",
					type: "message",
					ts: 1_760_000_000,
					payload: {
						id: "u1",
						role: "user",
						content: [{ type: "text", text: "Read both files." }],
						tool_calls: [],
					},
					journal_seq: 0,
				},
			],
			has_more: false,
			cursor_missing: false,
			journal_generation: GENERATION,
			journal_order_state: "ready",
		},
		{ authoritative: true },
	);
	const emit = (event: LiveEvent) => {
		clock += 50;
		seq += 1;
		state = applyEvent(state, event, clock, { frame: { epoch: "e", seq } });
	};
	emit({ type: "message_start", message: text("m1", "") });
	emit({
		type: "message_update",
		message: text("m1", ""),
		delta: "Reading both files.",
	});
	emit({
		type: "message_end",
		message: text("m1", "Reading both files.", [call("c1"), call("c2")]),
	});
	for (const [id, command] of [
		["c1", "cat alpha.txt"],
		["c2", "cat beta.txt"],
	]) {
		emit({
			type: "tool_execution_start",
			tool_call_id: id,
			tool_name: "bash",
			args: { command },
		});
	}
	// The batch ends out of slot order; the journal persists in slot order.
	for (const id of ["c2", "c1"])
		emit({
			type: "tool_execution_end",
			tool_call_id: id,
			tool_name: "bash",
			result: ok,
			duration_s: 0.2,
		});
	if (withText) {
		emit({ type: "message_start", message: text("m2", "") });
		emit({
			type: "message_update",
			message: text("m2", ""),
			delta: "Both files read; the answer follows.",
		});
	}
	return state;
}

/** Two parallel calls, then text, no wake yet: the text stays BELOW both calls. */
export const ParallelCallsThenText: Story = {
	render: () => <Frame transcript={parallelTurn(true)} />,
};

/**
 * A reply streamed up to `content`, as one assistant row on the same pane. The
 * design review's probes (D1 numbered-list marker, D2 half-typed closing fence)
 * as frames.
 */
function markdownTurn(content: string): TranscriptState {
	let clock = 1_760_000_000_000;
	let seq = 0;
	let state = applyHistoryPage(
		EMPTY_TRANSCRIPT,
		{
			entries: [
				{
					id: "u1",
					type: "message",
					ts: 1_760_000_000,
					payload: {
						id: "u1",
						role: "user",
						content: [{ type: "text", text: "Show me." }],
						tool_calls: [],
					},
					journal_seq: 0,
				},
			],
			has_more: false,
			cursor_missing: false,
			journal_generation: GENERATION,
			journal_order_state: "ready",
		},
		{ authoritative: true },
	);
	const emit = (event: LiveEvent) => {
		clock += 50;
		seq += 1;
		state = applyEvent(state, event, clock, { frame: { epoch: "e", seq } });
	};
	emit({ type: "message_start", message: text("m1", "") });
	emit({ type: "message_update", message: text("m1", ""), delta: content });
	return state;
}

const LIST = "Plan:\n\n- first item\n- second item\n- third item\n\n";

/** D1: the writer has typed the digit of the next list's marker. Nothing paints for it. */
export const NumberedMarkerDigit: Story = {
	render: () => <Frame transcript={markdownTurn(`${LIST}1`)} />,
};

/** D1: marker and dot typed; still nothing for it. */
export const NumberedMarkerDot: Story = {
	render: () => <Frame transcript={markdownTurn(`${LIST}1.`)} />,
};

/** D2: one backtick of the closing fence: the code block does not grow a line. */
export const FenceHalfClosed: Story = {
	render: () => (
		<Frame
			transcript={markdownTurn("Run it:\n\n```sh\nnpm install\nnpm test\n``")}
		/>
	),
};

/** D2 baseline: the same fence one line earlier (no closer typed). */
export const FenceNoCloser: Story = {
	render: () => (
		<Frame
			transcript={markdownTurn("Run it:\n\n```sh\nnpm install\nnpm test\n")}
		/>
	),
};
