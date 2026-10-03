/**
 * THE ACTION ROW UNDER THE TURN-CLOSING ANSWER (issue #695, design memo (a)-(h)).
 *
 * Why a story of its own rather than rows on `tool-row.stories.tsx`. The claim
 * this set photographs is a ROW'S PRESENCE on one particular answer and its
 * ABSENCE everywhere else - on the intermediate answers of a turn, on an answer
 * whose turn is still streaming, on the user's own turn - and two of those states
 * need a fixture shape a hand-built record list cannot give (see below). Adding
 * rows to that file would also re-render frames two other sets are judged on,
 * which is a diff the reviewer of this change should not have to read.
 *
 * TWO FIXTURE SHAPES, ON PURPOSE. The states that only need records carry them
 * directly (`message-surface.stories.tsx`'s shape: a settled, complete answer is
 * a plain object). The two whose claim depends on the RUN - a turn that folds
 * into its bar, and a turn whose intermediate answer must NOT get a row - are
 * built through the real reducer (`transcript-reducer.ts`'s `applyEvent`, the way
 * `turn-collapse.stories.tsx` builds its own), because the bar's span, the run's
 * fold and the closing answer's identity are all derived from frames of real
 * events; a transcript assembled by hand would photograph a shape the app cannot
 * produce.
 *
 * THE BEFORE HALF IS A DECLARED SUPPLEMENTARY SET - `docs/evidence/
 * chat-canonical-message-actions-before/`, the same stories on the pre-change
 * tree, the title suffixed `before` for that one run so the ids land in their own
 * directory. Only the RESTING states have a before half: a hover, a focus and a
 * `Copied` state are this row's own, and there is nothing on the pre-change tree
 * for them to be a picture of.
 *
 * NO `play` FUNCTIONS. Every interaction state in this set is produced by the
 * capture rig's real pointer, real Tab walk and real press (the STORIES rows in
 * `scripts/capture-evidence.mjs`), because a class that faked `:hover` or
 * `:focus-visible` would photograph the story rather than the product.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

/** One instant for every frame, so the frames are byte-reproducible. */
const TS = 1_760_000_000_000;

/**
 * The conversation every frame is drawn in.
 *
 * Handed over deliberately: the row's Speak button is gated on an agent id
 * resolving (memo (d)), so a story that omitted it could not picture the row the
 * design round has to judge. Nothing else on this surface reads it - the Quote
 * toolkit mounts with it and still paints nothing without a highlight, which is
 * why the frames are unaffected by it.
 */
const CONVERSATION = "story-conversation";

/** A settled, complete agent answer - the ordinary case. */
const answer = (
	id: string,
	text: string,
	extra: Partial<Extract<TranscriptRecord, { kind: "assistant" }>> = {},
): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS + 1_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
	...extra,
});

const user = (id: string, text: string): TranscriptRecord => ({
	kind: "user",
	id,
	ts: TS,
	text,
	images: [],
});

/**
 * One ledger call, in the shape `tool-row.stories.tsx` uses for its own fixtures.
 *
 * Needed by ONE state: the in-flight turn, whose run has to hold a call for the
 * transcript to paint the answer being written rather than folding the whole span
 * into its bar (measured: a turn whose only content is the streaming answer gets
 * the bar and no prose).
 */
const tool = (
	over: Partial<Extract<TranscriptRecord, { kind: "tool" }>> & { id: string },
): TranscriptRecord => ({
	kind: "tool",
	ts: TS + 50_000,
	toolCallId: over.id,
	toolName: "read",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	output: "ok",
	isError: false,
	notRunReason: null,
	notRunKind: null,
	neverSent: false,
	durationS: 0.4,
	startedAt: null,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	...over,
});

/** A transcript state holding these rows, as `chat-content.tsx` hands one over. */
const transcriptOf = (records: TranscriptRecord[]): TranscriptState =>
	({
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	}) as TranscriptState;

const QUESTION = [
	"Morning - here is where the import stands before you pick it up.",
	"",
	"The March file loaded cleanly except for one row, which is failing on a `not null` column that the source system still writes as empty rather than absent. I left the table half written so you can see the row that stopped it.",
].join("\n");

const ANSWER = [
	"The row is not malformed, it is absent: the source writes an empty string where the schema's `not null` assumes a value, so the loader inserted a literal `''` and the constraint rejected it.",
	"",
	"Two ways out, and they differ in what the table means afterwards:",
	"",
	"- **Coerce at the boundary.** Map `''` to `NULL` in the extract step, and the column keeps saying exactly what the source knows, which is nothing.",
	"- **Relax the constraint.** A default of `''` accepts the file as it is, and every future consumer of that column has to remember that empty and missing are the same word here.",
	"",
	"I would take the first one, and I would not retry the load until the extract is fixed - a retry would append the four hundred rows behind it a second time.",
].join("\n");

/** The ordinary turn: one question, one answer, one row under it. */
const TURN: TranscriptRecord[] = [user("u1", QUESTION), answer("a1", ANSWER)];

/**
 * A one-line answer, which is the state the row's weight is judged on: at this
 * height the row must not read as a second sentence of the answer.
 */
const SHORT_TURN: TranscriptRecord[] = [
	user("u1", "Is the March import finished?"),
	answer("a1", "It finished with the same four invoices outstanding."),
];

/** A refusal: a refusal is still an answer the reader may want to keep. */
const REFUSED_TURN: TranscriptRecord[] = [
	user("u1", QUESTION),
	answer(
		"a1",
		"I cannot rewrite the loader to swallow a constraint violation - that would hide the row that stopped it rather than fix what writes an empty string.",
		{ stopReason: "refusal" },
	),
];

/** A partly-received answer: the caption above says which part may be missing. */
const TRUNCATED_TURN: TranscriptRecord[] = [
	user("u1", QUESTION),
	answer("a1", ANSWER, { truncated: "interrupted" }),
];

/**
 * Still streaming, in the only shape the reader ever sees it: the PREVIOUS turn
 * settled and carries its row, and the answer being written right now carries
 * none. The row's gate is the one `linkify` and the Quote control already use -
 * an answer the next token falsifies has no settled text to copy - so the frame
 * has to hold both halves to be a claim about the gate rather than a picture of an
 * empty pane.
 *
 * BUILT FROM RECORDS WITH NO CALLS: a turn whose whole content is still arriving
 * has no settled tail for the run walk to close on, and a fixture with calls would
 * fold and hide the very row this frame is about.
 */
const STREAMING_TURN: TranscriptRecord[] = [
	user("u1", QUESTION),
	answer("a1", "It finished with the same four invoices outstanding."),
	user("u2", "And the April file?"),
	answer("a2", "Reading the April ledger first."),
	tool({ id: "t1", args: { path: "invoices/2026-04.csv" } }),
	answer("a3", "The April loader read the header and the first", {
		streaming: true,
		complete: false,
		ts: TS + 90_000,
	}),
];

/* ------------------------------------------------- the reducer-built fixtures */

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
};

/**
 * One call on the ledger, as the transcript's own events paint it: a start frame
 * (where the row's `ts` and `startedAt` come from) and the end frame that settles
 * it, so the bar's span is the arithmetic the app would run.
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
		next = applyEvent(
			next,
			{
				type: "tool_execution_end",
				tool_call_id: call.id,
				tool_name: call.name,
				result: { content: [{ type: "text", text: `${call.id} done\n` }] },
				is_error: false,
				duration_s: call.durationS,
			},
			at + 500,
		);
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

/** The question, some calls, and the answer that settles at its own frame. */
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

const NARRATION =
	"I will read the half-written table first, then answer the row question from what the source actually sends.";

/**
 * One turn with TWO settled answers in it. Only the second closes the turn, so
 * the row's scope ruling (one row per turn, memo (a)) is judged here: a
 * per-answer row would paint two on this frame.
 *
 * BUILT FROM RECORDS, WITH NO CALL BETWEEN THEM, and both halves of that are
 * deliberate. A call would fold the run into the turn bar, which is the state
 * `bar-suppressed` already owns - this frame is about the row's COUNT. Records
 * rather than the reducer because the claim here needs no span arithmetic: what
 * matters is that the list holds two settled answers in one turn, which is a fact
 * about the list.
 */
const MULTI_TURN: TranscriptRecord[] = [
	user("u1", QUESTION),
	answer("a1", NARRATION),
	answer("a2", ANSWER, { ts: TS + 60_000 }),
];

/**
 * The transcript pane in a fixed frame, on `bg-canvas`.
 *
 * Pinned in PIXELS rather than left to the viewport, for the reason the other
 * transcript stories pin theirs: the claim is about a row's edge against the
 * prose's and about the line it sits on, and a preview at another width would be
 * photographing a different case than the one written down. `isSmallView` is a
 * prop of the transcript itself, so the narrow state is a real one rather than a
 * CSS width applied around it.
 */
const Frame = ({
	state,
	width = 1024,
	height = 560,
	isSmallView = false,
	waiting = false,
}: {
	state: TranscriptState;
	width?: number;
	height?: number;
	isSmallView?: boolean;
	waiting?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width, height }}>
			<div className="flex min-h-0 grow flex-col px-4 pt-4">
				<CanonicalTranscript
					transcript={state}
					frontend={null}
					gate={null}
					waiting={waiting}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={isSmallView}
					status="live"
					failure={null}
					awaitingHydration={false}
					onReconnect={() => {}}
					conversationId={CONVERSATION}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Canonical message actions",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The ordinary case: a question, its answer, and the row under it at rest. */
export const Rest: Story = {
	render: () => <Frame state={transcriptOf(TURN)} />,
};

/** An answer of one line - the row must not read as a second sentence. */
export const ShortAnswer: Story = {
	render: () => <Frame state={transcriptOf(SHORT_TURN)} height={320} />,
};

/** A refusal: the row is present, and the danger ink stays on the prose. */
export const Refused: Story = {
	render: () => <Frame state={transcriptOf(REFUSED_TURN)} height={380} />,
};

/** A partly-received answer, with the caption that says which part is missing. */
export const Truncated: Story = {
	render: () => <Frame state={transcriptOf(TRUNCATED_TURN)} height={400} />,
};

/** Still streaming: the row is ABSENT, because nothing has settled to copy. */
export const Streaming: Story = {
	render: () => (
		<Frame state={transcriptOf(STREAMING_TURN)} waiting height={620} />
	),
};

/** Two settled answers in one turn: exactly one row, on the closing answer. */
export const MultiAnswer: Story = {
	render: () => <Frame state={transcriptOf(MULTI_TURN)} height={640} />,
};

/** A turn that folds into its bar: the actions stay on the line, the bar keeps the stamp. */
export const BarSuppressed: Story = {
	render: () => <Frame state={finishedTurn([CALL_A, CALL_B])} height={640} />,
};

/**
 * The MINIMUM action case: one call, so the turn's own foot would read
 * `Worked for 12.5s · 1 action` if that caption could stand beside the actions.
 *
 * Design round 1's D1 asked for a state that paints the caption BESIDE the row,
 * and this frame is the answer rather than a restatement of the request. The app
 * cannot paint that composition: `planRun` hides every non-pinned row of a
 * turn's prefix, `staysVisibleWhileCollapsed` is false for every `tool` record,
 * so a turn with ANY call gives the run something to hide and the run collapses;
 * a collapsed run withholds the caption AND the stamp from the closing line
 * (`suppressClosingLine`) because the bar states both. The reverse case - a turn
 * with no calls - has `foot.actions === 0`, so the caption is absent by its own
 * gate. One call is therefore the tightest test of the claim: the bar reads
 * `1 action` above, and the line under the answer carries the actions alone.
 * The set's README states the chain in full.
 */
export const OneCallTurn: Story = {
	render: () => <Frame state={finishedTurn([CALL_A])} height={560} />,
};

/**
 * The narrow column and the small view: one line, buttons intact, and NO caption
 * - the turn's run folds into its bar, which states the numbers itself, so the
 * closing line carries the actions alone (design round 1, Q3: this description
 * used to say "caption truncating", and there is no caption in this state to
 * truncate).
 */
export const Narrow: Story = {
	render: () => (
		<Frame state={transcriptOf(TURN)} width={420} height={620} isSmallView />
	),
};

/**
 * THE OPERATOR'S FOOT-LINE STATE (2026-10-01): a turn that COMPACTED
 * mid-run. The memory statement is pinned, so the hidden span partitions into
 * two segments around it (`turn-segments.ts`) and no pre-answer segment carries
 * the turn's stamp - the foot's own rule keeps the closing line, which is then
 * the one shape where the caption and the action row paint TOGETHER:
 * `Worked for 12s · 2 actions` beside the buttons.
 *
 * WHY THIS STORY EXISTS (the operator's report): "now that the action buttons
 * only show up on hover, the Worked for and action count looks a bit weird -
 * rearrange so those are on the leftmost extent and the action buttons are to
 * the right." The caption used to FOLLOW the (invisible at rest) buttons, so
 * it read indented by the buttons' own width; this is the state that shows it,
 * and the frame the before/after pair under
 * `docs/evidence/chat-canonical-message-actions-foot-before/` is taken from.
 *
 * Built through the DURABLE path (`applyHistoryPage`) rather than the live
 * events, because a compaction is a durable row first (`append_compaction`
 * writes `tokens_before` and no after-figure) and the fixture needs no live
 * frames: the turn is settled.
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
			entry("t1", S + 2, {
				kind: "message",
				role: "tool",
				tool_call_id: "c1",
				tool_name: "bash",
				content: [{ type: "text", text: "tests 40\npass 40\n" }],
				provider_payload: { duration_s: 12.5, details: {} },
			}),
			{
				id: "n1",
				ts: S + 5,
				type: "compaction",
				payload: { tokens_before: 41_000 },
			},
			entry("t2", S + 8, {
				kind: "message",
				role: "tool",
				tool_call_id: "c2",
				tool_name: "read",
				content: [{ type: "text", text: "src/invoices/query.ts\n" }],
				provider_payload: { duration_s: 0.4, details: {} },
			}),
			entry("a1", S + 70, {
				kind: "message",
				role: "assistant",
				content: [{ text: ANSWER }],
				stop_reason: "stop",
			}),
		],
		has_more: false,
		cursor_missing: false,
	});
};

/** A turn split by a mid-run compaction: the closing line keeps its foot. */
export const CompactedRun: Story = {
	render: () => <Frame state={compactedTurn()} height={640} />,
};

/**
 * The same turn at the SMALL VIEW (design round 1, D2).
 *
 * `isSmallView` is a PROP the transcript is told about, not something it infers
 * from the window - so a 420px viewport running the 1024px story is the wide
 * layout clipped by the frame, not the small view (measured: the caption and the
 * actions report the same boxes at both widths). The caption's rail at
 * `isSmallView` is what the design round asked for, and it needs a state that
 * actually paints it.
 */
export const CompactedRunSmall: Story = {
	render: () => (
		<Frame state={compactedTurn()} width={420} height={640} isSmallView />
	),
};
