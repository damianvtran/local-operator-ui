/**
 * A SEND STRANDED BY ITS OWN WINDOW: the operator's report, photographed
 * through the production transcript.
 *
 * WHY THIS IS A STORY BESIDE THE TEST. `scripts/transcript-strand-hold.test.mjs`
 * asserts ids and order. The report was about PIXELS — the "push it to my
 * private github" exchange stuck at the TRAILING edge of a conversation whose
 * newer content rendered above it — and a frame is also the only thing that
 * shows it in place: the reader's own pane, bottom-anchored, in both rankings.
 *
 * WHY BOTH ORDERS COME FROM ONE TREE, and why an app open cannot show this.
 * The disorder is BORN OF THE SEND and lives in the in-memory transcript state
 * (the provisional echo and its tail block); the journal on disk is correctly
 * ordered, so opening a copy of the session in the app paints the healthy
 * order and cannot reproduce it. The faithful capture is therefore this pair:
 * both orders are built by the SHIPPED reducer over the real session's own
 * payloads (`scripts/fixtures/stranded-send-order.json`), and the only
 * difference between them is HOW the stranded rows rank:
 *
 *   - `Before` spells out the pre-fix tail block's ranking — the send and the
 *     exchange it held, pinned after every placed row, which is literally what
 *     `withTimeOrder` did before `releasedEchoes` existed.
 *   - `After` is the shipped reducer's discharge: the page read that lies
 *     entirely beyond the pane releases the hold, and the exchange ranks by its
 *     own instants.
 *
 * THE SEAL IS DELIBERATELY NOT APPLIED HERE. `sealDisjointBlock` runs after the
 * walk in the app, and it only drops rows the reader can re-read — it cannot
 * change the RANK the report is about. The test covers it with the seal in
 * place; the frames stop one step earlier so both orders carry every row.
 *
 * THE FIXTURE IS THE REAL SESSION, not a hand-made one: session
 * `9c59d684d16b`'s journal window (held page, the send itself, the streamed
 * exchange and the rows the stream carried after it) and the two entirely-newer
 * page reads captured from the same session (`newer` 19:06:05..19:24:03,
 * `newer2` 19:29:14..20:03:08). See `scripts/transcript-strand-hold.test.mjs`'s
 * header for the derivation and every transform applied to the journal bytes.
 *
 * WHY THE TAIL PAIR IS THE FULL STREAM, NOT THE EXCHANGE ALONE: the operator's
 * pane was watching LIVE when they looked, so every row the stream carried
 * after the exchange was admitted while the send's echo was still pending — the
 * exact shape the first cut of this fix failed to release (the manager's
 * `replay4.mjs`). The `Tail` pair therefore folds the stream too, and the
 * pre-fix ranking pins all of it, which is what the reader's pane actually
 * showed.
 *
 * WHY THE PANE'S HEIGHT IS PINNED. A transcript story with no fixed height lets
 * the capture grow its viewport to the document, so a full-content still shows
 * a state no reader can be in and every caption claiming the exchange is at
 * the trailing edge would be describing pixels the frame does not show.
 * `PANE` is the reader's measured height (the same 685px the transcript's own
 * stories pin), so the frames are what a reader is looking at and the captions
 * are true of the bytes.
 *
 * TWO PAIRS, TWO DISTANCES. `Tail` is the reader's arrival at the END of the
 * conversation: the bottom of the pane. `Slot` narrows the windows so the
 * exchange's own neighbourhood fits one frame — the same idiom as
 * `chat-stale-seed-order`'s seam. Neither pair is a montage: every frame is a
 * state the shipped reducer produces (or produced, for the one pre-fix
 * ranking) from the fixture, rendered by `CanonicalTranscript`.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import fixtureJson from "../../../../../../scripts/fixtures/stranded-send-order.json";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	type TranscriptState,
	appendPendingUser,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

type Entry = DesktopHistoryPage["entries"][number];

/** The journal windows, as `scripts/fixtures/stranded-send-order.json` carries them. */
const FIXTURE = fixtureJson as unknown as {
	held: { entries: Entry[] };
	send: { id: string; ts: number; text: string };
	exchange: { rows: Entry[] };
	stream: { rows: Entry[] };
	newer: { entries: Entry[] };
	newer2: { entries: Entry[] };
};

const SEND_ID = FIXTURE.send.id;

/** The transcript pane's own height: the reader's measured `clientHeight`. */
const PANE = 685;

const pageOf = (entries: Entry[]): DesktopHistoryPage => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

/** A tool row's record key is its call, `tool:<call_id>`; pages key by entry id. */
const recordKeyOf = (entry: Entry): string =>
	entry.payload?.role === "tool"
		? `tool:${String(entry.payload.tool_call_id ?? "")}`
		: entry.id;

/**
 * The streamed rows, folded the way the live stream folded them: one record
 * per journal row, the row's OWN clock as the event's `now` (the reader and the
 * owner share this journal's wall clock, a fact the fixture's own `ts` values
 * carry). This is what the pre-fix pane held between the send and the reads —
 * the exchange, and (in the tail pair) the rows the stream carried after it:
 * the operator's pane was watching live, so the send stayed pending while all
 * of them landed (`replay4.mjs`'s shape).
 */
const foldExchange = (
	state: TranscriptState,
	rows: Entry[],
): TranscriptState => {
	let next = state;
	for (const row of rows) {
		const payload = row.payload ?? {};
		const content = (payload as { content?: unknown[] }).content;
		const now = Math.round(row.ts * 1000);
		if (payload.role === "assistant") {
			next = applyEvent(
				next,
				{
					type: "message_start",
					message: {
						role: "assistant",
						content: [],
						tool_calls: payload.tool_calls ?? [],
						id: row.id,
					},
				},
				now,
			);
			if (content?.length)
				next = applyEvent(
					next,
					{ type: "message_end", message: { ...payload, id: row.id } },
					now,
				);
		} else if (payload.role === "tool") {
			next = applyEvent(
				next,
				{
					type: "tool_execution_end",
					tool_call_id: payload.tool_call_id,
					tool_name: payload.tool_name,
					result: { content: payload.content, is_error: false },
				},
				now,
			);
		} else if (payload.role === "user") {
			next = applyEvent(
				next,
				{
					type: "message_start",
					message: { role: "user", content: payload.content ?? [], id: row.id },
				},
				now,
			);
			next = applyEvent(
				next,
				{ type: "message_end", message: { ...payload, id: row.id } },
				now,
			);
		}
	}
	return next;
};

/**
 * The shipped reducer's state for one narrowed reading of the session: the held
 * page, the send (its echo), the streamed rows (the exchange, then whatever the
 * stream carried after it), then the entirely-newer reads. This IS the `After`
 * order — the discharge fires on the first read.
 */
const afterFold = (windows: {
	held: Entry[];
	exchange: Entry[];
	stream: Entry[];
	newer: Entry[];
	newer2: Entry[];
}): TranscriptState => {
	let state = applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(windows.held));
	state = appendPendingUser(
		state,
		SEND_ID,
		FIXTURE.send.text,
		[],
		Math.round(FIXTURE.send.ts * 1000),
	);
	state = foldExchange(state, windows.exchange);
	if (windows.stream.length) state = foldExchange(state, windows.stream);
	state = applyHistoryPage(state, pageOf(windows.newer));
	if (windows.newer2.length)
		state = applyHistoryPage(state, pageOf(windows.newer2));
	return state;
};

/**
 * The pre-fix ranking, spelled out: `withTimeOrder`'s tail block pinned a
 * pending echo — and every row admitted while it held, the whole stream above
 * all — BELOW every placed row. Re-ranking the shipped state with that rule is
 * exactly what the pre-discharge reducer produced; nothing else about the
 * records differs.
 */
const beforeRanking = (state: TranscriptState): TranscriptState => {
	const pinned = new Set<string>([
		SEND_ID,
		...FIXTURE.exchange.rows.map(recordKeyOf),
		...FIXTURE.stream.rows.map(recordKeyOf),
	]);
	const held = state.records.filter((record) => pinned.has(record.id));
	const placed = state.records.filter((record) => !pinned.has(record.id));
	const records: TranscriptRecord[] = [...placed, ...held];
	return {
		...state,
		records,
		index: new Map(records.map((record, at) => [record.id, at])),
	};
};

/** The full session windows: what the reader's own pane held and read. */
const FULL = {
	held: FIXTURE.held.entries,
	exchange: FIXTURE.exchange.rows,
	stream: FIXTURE.stream.rows,
	newer: FIXTURE.newer.entries,
	newer2: FIXTURE.newer2.entries,
};

/**
 * The narrowed windows: the exchange's own neighbourhood with enough held and
 * newer context that the pane fills the way a reader's does — the last
 * fourteen held rows, the exchange's first sixteen journal rows, and the
 * first six entries of the newer read.
 */
const SLOT = {
	held: FIXTURE.held.entries.slice(-14),
	exchange: FIXTURE.exchange.rows.slice(0, 16),
	stream: [],
	newer: FIXTURE.newer.entries.slice(0, 6),
	newer2: [],
};

/**
 * The transcript as the reader sees it, captioned with what the frame is — the
 * same frame shape `chat-stale-seed-order` uses, pane height pinned.
 */
const Frame = ({
	transcript,
	caption,
}: {
	transcript: TranscriptState;
	caption: string;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			{/* A fixed caption box, two lines tall, so a pair overlays. */}
			<p className="h-10 text-body-sm text-ink-muted">{caption}</p>
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE }}
				ref={containerRef}
			>
				<CanonicalTranscript
					transcript={transcript}
					gate={null}
					waiting={false}
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
	title: "Chat/Stranded hold order",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The reader's arrival at the end: the send and its whole stream stuck under newer content. */
export const BeforeTail: Story = {
	render: () => (
		<Frame
			caption="Before: the reader's pane at the end of the conversation, with the pre-fix tail block's ranking. The 19:00 send and everything the stream carried after it are pinned below every row the newer reads placed — the exchange sits at the tail, under 40+ minutes of newer content (20:03)."
			transcript={beforeRanking(afterFold(FULL))}
		/>
	),
};

/** The same arrival through the discharge: the bottom ends at the newest rows. */
export const AfterTail: Story = {
	render: () => (
		<Frame
			caption="After: the same conversation, same pane. The first read whose oldest entry is newer than the send's stamp releases the hold, so the bottom of the conversation ends at its newest rows (20:03). The exchange ranks at its own 19:00 slot, above this window."
			transcript={afterFold(FULL)}
		/>
	),
};

/** The narrowed neighbourhoood, before: the block parks the send at the tail. */
export const BeforeSlot: Story = {
	render: () => (
		<Frame
			caption="Before, narrowed to the exchange's own neighbourhood: the send and its streamed replies pinned after every placed row, so the 19:00 exchange renders below content read later in the day (19:06)."
			transcript={beforeRanking(afterFold(SLOT))}
		/>
	),
};

/** The narrowed neighbourhood, after: the exchange returns to its own time. */
export const AfterSlot: Story = {
	render: () => (
		<Frame
			caption="After, the same neighbourhood: the send and its replies rank by their own instants, between the held rows and the content the newer read carried (19:06) — the journal's own order, not the pane's tail."
			transcript={afterFold(SLOT)}
		/>
	),
};
