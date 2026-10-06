/**
 * The ask gate's divert states on the desktop LIVE TRACE, as pixels: the
 * settle-only ask row and the marker drop, driven by the SHIPPED reducer.
 *
 * WHY A STORY BESIDE THE TESTS. `transcript-reducer.test.mjs` pins the fold
 * (which records move, which states stay identical); whether the frames a
 * reader actually sees are clean is a question only pixels answer. A diverted
 * ask must leave NO trace on the live trace — no running row while the forked
 * clearance check runs, no settled row after — while a raised ask paints its
 * one row AT SETTLE (the queue's receipt). Those are visual claims, so they get
 * frames.
 *
 * WHY THE FIXTURES ARE WIRE-SHAPED AND NOT LIVE APP CAPTURES. The gate is a
 * core-repo feature in flight (design `docs/design/ask-gate.md`; the core PR is
 * named in this PR's thread): no released runtime can yet divert an ask, so
 * there is no app run to photograph. The frames below fold exactly the shapes
 * the core defines — the live `tool_call_compose`/`tool_execution_start`/
 * `tool_execution_end` frames and the `details.ask_gate.hidden` marker (§3) —
 * through the production reducer and paint the production `CanonicalTranscript`,
 * the same evidence contract `interrupted-rows.stories.tsx` states for its own
 * marker. When the core lands, the two `diverted-*` frames are re-shootable
 * from a live run; the fold they pin does not change.
 *
 * WHAT EACH FRAME IS.
 *
 * - `diverted-live`: the gate MID-FLIGHT, queued engine live. The ask call has
 *   been announced and started (its frames are folded above), and nothing
 *   paints — the settle-only rule holds the row. Before this change the same
 *   fold leaves a RUNNING `ask` row up for the gate's whole duration.
 * - `diverted-settled`: the divert itself. The settled frame's result carries
 *   the marker and the row is dropped — the state is the same two rows as
 *   above. Before this change the row settled carrying the decision note
 *   (`[Ask clearance] No question was put to the user…`) — the leak the marker
 *   exists to close.
 * - `raise-settled`: the receipt half. No marker, so the row is created AT
 *   SETTLE with the queue's receipt and the object column the suppressed start
 *   still learned.
 * - `unreadable-live`: the mixed-build fallback (§5) — no mode read, so
 *   today's mounting stands: the running row is the flash residual.
 * - `unreadable-settled`: the same frame's marker STILL drops it at settle —
 *   the two halves of "a brief trace, not persistent".
 *
 * WHY THE PANE'S HEIGHT IS PINNED. A transcript story with no fixed height
 * lets the capture grow the viewport to the document, which photographs a
 * state no reader can be in. `PANE` is the same measured column the
 * interrupted-rows and phantom-rows sets use, so the sets read side by side.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

type Entry = DesktopHistoryPage["entries"][number];
/** The reducer's own live-frame shape: a `type` and whatever the frame carries. */
type LiveEvent = { type: string; [key: string]: unknown };

/**
 * The reader's arrival, RELATIVE to the render clock on purpose.
 *
 * A live row's elapsed figure counts to the machine's clock at render — the
 * property `chat-trace-order-while-live`'s own caption documents — so a frozen
 * anchor would photograph a call "running" for weeks by the time anyone reads
 * the frame. Everything about the session (the page's rows, the fold instants)
 * is stated relative to this instant, so the frames read as one coherent
 * moment whenever they are captured: the running row is seconds old, not days.
 */
const ARRIVAL_MS = Date.now() - 10_000;

/** The page's own rows: five minutes before the reader arrived. */
const PAGE_BASE = Math.round((ARRIVAL_MS - 300_000) / 1000);

/** The transcript pane's own height, in pixels: a reader's 685px column. */
const PANE = 685;

/** The mode read a queued-engine session's live fold carries (`asks` present). */
const ENGINE_LIVE = { queuedAskEngine: true };

const PAGE: Entry[] = [
	{
		id: "ag-u1",
		ts: PAGE_BASE,
		type: "message",
		payload: {
			kind: "message",
			role: "user",
			id: "ag-u1",
			content: [
				{
					type: "text",
					text: "Tag the release notes once CI is green.",
				},
			],
			tool_calls: [],
		},
	},
	{
		id: "ag-a1",
		ts: PAGE_BASE + 16,
		type: "message",
		payload: {
			kind: "message",
			role: "assistant",
			id: "ag-a1",
			content: [
				{
					type: "text",
					text: "The notes are written. One thing I want to confirm before I tag:",
				},
			],
			tool_calls: [],
		},
	},
];

/** The call, announced while the model is still dictating its questions. */
const COMPOSE: LiveEvent = {
	type: "tool_call_compose",
	tool_call_id: "call_ask_gate_1",
	tool_name: "ask",
	argument_bytes: 0,
	intent: "Ask whether to tag the release now",
};

/** The call starts: this is the instant the gate begins its check. */
const START: LiveEvent = {
	type: "tool_execution_start",
	tool_call_id: "call_ask_gate_1",
	tool_name: "ask",
	intent: "Ask whether to tag the release now",
	args: {
		questions: [
			{
				id: "q1",
				question: "Tag v0.68.0 now, or wait for the audit to finish?",
				options: [
					{
						label: "Tag now",
						description: "CI is green; the audit only covers the CLI.",
					},
					{ label: "Wait for the audit" },
				],
				recommended: 0,
				multi: false,
				secret: false,
			},
		],
		timeout: 1800,
	},
};

/** A raise: the queue's receipt (the shape `asks/render.py` composes). */
const END_RAISE: LiveEvent = {
	type: "tool_execution_end",
	tool_call_id: "call_ask_gate_1",
	tool_name: "ask",
	result: {
		content: [
			{
				type: "text",
				text:
					"Ask a-7f3 queued (1 question); showing on desktop. Continue with " +
					"other work — their answer arrives as an **ask response** turn. A " +
					"RECEIPT IS NOT CONSENT: do not run anything the answer was meant " +
					"to authorise. If nothing arrives by 14:20 you will get a timeout " +
					"notice.",
			},
		],
		details: {},
	},
	duration_s: 2.4,
	is_error: false,
};

/** A divert: the marker rides the result's `details` (design §3). */
const END_DIVERT: LiveEvent = {
	type: "tool_execution_end",
	tool_call_id: "call_ask_gate_1",
	tool_name: "ask",
	result: {
		content: [
			{
				type: "text",
				text:
					"[Ask clearance] No question was put to the user. A forked check " +
					"read the conversation and found your recommended option plainly " +
					"the best path — proceed with it and state the assumption where " +
					"it matters. The user was NOT asked and did not answer.",
			},
		],
		details: {
			ask_gate: {
				hidden: true,
				verdict: "clear",
				reason: "CI is green and the audit covers only the CLI.",
			},
		},
	},
	duration_s: 2.1,
	is_error: false,
};

const pageOf = (entries: Entry[]): DesktopHistoryPage => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

const withPage = (): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(PAGE));

/** Announced, then started — the gate is running. */
const askInFlight = (engineLive: boolean): TranscriptState => {
	const options = engineLive ? ENGINE_LIVE : undefined;
	let state = withPage();
	state = applyEvent(state, COMPOSE, ARRIVAL_MS - 31_000, options);
	return applyEvent(state, START, ARRIVAL_MS - 30_000, options);
};

/** The same call after its settling frame. */
const askSettled = (end: LiveEvent, engineLive: boolean): TranscriptState =>
	applyEvent(askInFlight(engineLive), end, ARRIVAL_MS - 1_000, {
		...(engineLive ? ENGINE_LIVE : {}),
	});

const Frame = ({
	transcript,
	caption,
	waiting,
	openRows,
}: {
	transcript: TranscriptState;
	caption: string;
	waiting: boolean;
	/** Click every row open, the way a reader reaches a row's body. */
	openRows?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!openRows) return;
		const triggers = Array.from(
			containerRef.current?.querySelectorAll<HTMLButtonElement>(
				'button[aria-expanded="false"]',
			) ?? [],
		);
		for (const trigger of triggers) trigger.click();
	}, [openRows]);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			{/* A fixed caption box, so the conversation does not move between the
			    frames of a pair: their captions are different lengths, and a
			    free-height paragraph would shift the transcript by a line. */}
			<p className="h-10 text-body-sm text-ink-muted">{caption}</p>
			{/* The reader's own pane, pinned: see `PANE`. The transcript's scroller
			    is `flex-col-reverse`, so a fixed-height box with no scroller of
			    its own is what lands the reader at the BOTTOM, on the newest rows. */}
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE }}
				ref={containerRef}
			>
				<CanonicalTranscript
					transcript={transcript}
					gate={null}
					waiting={waiting}
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
	title: "Chat/Ask gate rows",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The gate mid-flight under a live queued engine: NOTHING paints where the
 * running `ask` row used to be.
 */
export const DivertedLive: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="Mid-gate, queued engine live: the call is announced and running, and no `ask` row paints — the row is held until settle. Before this change the same fold leaves a running row up for the gate's whole duration."
			transcript={askInFlight(true)}
		/>
	),
};

/**
 * The divert's settle: the marker drops the row, and the pane stays clean.
 */
export const DivertedSettled: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="A diverted ask settles: still nothing. `details.ask_gate.hidden` drops the row; the model keeps the decision note in its context, the user never sees it. Before this change the row settled showing that note."
			transcript={askSettled(END_DIVERT, true)}
		/>
	),
};

/**
 * The receipt half: an ask that reached the user keeps its row, created AT
 * settle, with the object column the suppressed start still learned.
 */
export const RaiseSettled: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="A raised ask settles (no marker): its one row appears at settle with the queue's receipt — the ask the user is answering keeps its ledger row, and the row carries the call's arguments."
			transcript={askSettled(END_RAISE, true)}
		/>
	),
};

/**
 * The raised ask's row, opened: the receipt the row really carries.
 */
export const RaiseSettledExpanded: Story = {
	render: () => (
		<Frame
			waiting={true}
			openRows={true}
			caption="The same settled row, opened: the queue's receipt is the body ('Continue with other work' — the model's own instruction, not the user's), and the argument column re-states the question the ask carried."
			transcript={askSettled(END_RAISE, true)}
		/>
	),
};

/**
 * The mixed-build fallback (§5): no mode read, so today's mounting stands —
 * this is the flash residual the design accepts.
 */
export const UnreadableLive: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="An unreadable mode (an old core, or a mixed build): today's mounting stands — the running row is the flash residual the design records; the settle frame still drops it."
			transcript={askInFlight(false)}
		/>
	),
};

/**
 * The same frame's marker still drops it: "a brief trace, not persistent".
 */
export const UnreadableSettled: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="The same state at settle: the marker drops the flashed row, so even a viewer that cannot read the mode keeps no trace of the divert."
			transcript={askSettled(END_DIVERT, false)}
		/>
	),
};
