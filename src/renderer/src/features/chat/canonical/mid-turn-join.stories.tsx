/**
 * A turn joined MID-STREAM: the last chunk of an answer, painted with and
 * without the row saying that earlier text is missing.
 *
 * WHY THIS IS A STORY BESIDE THE TEST. `scripts/transcript-reducer.test.mjs`
 * asserts the record — text, `streaming`, `truncated` — and the hook test asserts
 * that a row which survives a receipt gap ends up agreeing with the producer's
 * assembled text. Neither can show the SEAM this fix is about: one line of
 * caption above prose that starts mid-sentence, in the pane a reader is looking
 * at. The change is a sentence on screen, so the evidence for it is a frame.
 *
 * THE PRODUCER'S SHAPE, which is what makes a join a truncation at all: one
 * streamed token is one `message_update` whose `delta` is the increment and whose
 * `message.content` is EMPTY — the harness assembles the text once, at the END of
 * the call, for a measured memory reason (`harness/loop.py`). The runtime's live
 * seed keeps the message's `message_start` and its LATEST update, so a viewer
 * that joins a running turn is handed a start and one chunk, with nothing that
 * says how much text came before it.
 *
 * WHY BOTH FRAMES COME FROM ONE TREE. The `Before` frame is built the pre-fix way
 * — `applyEvent` once per seed event, which is literally what the pre-fix
 * `applyLiveSeed` did — rather than captured from the base commit: a pair
 * captured from two trees cannot be re-taken once the base moves on, and the two
 * states then differ by more than the fix does. The only difference between the
 * frames here is the mark.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type {
	CanonicalFrontendState,
	DesktopHistoryPage,
} from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import type { CanonicalTranscriptStatus } from "./transcript-pane";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
	applyLiveSeed,
	markLiveRecordsTruncated,
} from "./transcript-reducer";

/** One instant for every frame, so the frames are byte-reproducible. */
const TS = 1_760_000_000_000;

/**
 * The reader's own pane height, pinned. A transcript story with no fixed height
 * lets the capture grow its viewport to the document, which shows a state no
 * reader can be in; 685px is the transcript's own measured `clientHeight` at
 * 1380x900 (the figure `docs/evidence/chat-scrolling/README.md` records).
 */
const PANE = 685;

type Entry = DesktopHistoryPage["entries"][number];

const entry = (
	id: string,
	ts: number,
	payload: Record<string, unknown>,
): Entry => ({ id, ts, type: "message", payload });

/** The question the turn is answering: what a joiner's page already holds. */
const PAGE: Entry[] = [
	entry("u1", TS, {
		kind: "message",
		role: "user",
		content: [{ text: "What changed in the auth flow this week?" }],
	}),
	entry("a1", TS + 1_000, {
		kind: "message",
		role: "assistant",
		content: [
			{
				text: "Three things landed: the token exchange moved behind the gateway, the retry budget is now per-route, and the refresh path is shared.",
			},
		],
		stop_reason: "stop",
	}),
];

/**
 * The same join over a COMPLETE, UNRELATED answer (design round 1, D1).
 *
 * The page above the joined row is the frame a reader's eye reaches for when the
 * caption's ownership is ambiguous: the original fixture's row above is the same
 * sentence's first half, which happens to read correctly under either parse and
 * so hides the defect it makes reachable. This one ends at its own full stop and
 * does not continue into the row below, so a caption that attaches upward is
 * visibly a claim about somebody else's paragraph.
 */
const PAGE_UNRELATED: Entry[] = [
	entry("u1", TS, {
		kind: "message",
		role: "user",
		content: [{ text: "What changed in the auth flow this week?" }],
	}),
	entry("a1", TS + 1_000, {
		kind: "message",
		role: "assistant",
		content: [
			{
				text: "The retry budget is now per-route, and the gateway holds the token exchange.",
			},
		],
		stop_reason: "stop",
	}),
];

/**
 * The seed of a turn in flight, as the runtime retains it: the message's start
 * (with the empty content the producer mints) and the ONE latest update.
 */
const SEED = [
	{
		type: "message_start",
		message: { id: "a2", role: "assistant", content: [], tool_calls: [] },
	},
	{
		type: "message_update",
		message: { id: "a2", role: "assistant", content: [], tool_calls: [] },
		delta: "so the refresh path is now shared with the mobile client.",
	},
];

/** The question the turn is aiming at — the same id the page will not carry. */
const ARRIVAL_MS = TS + 60_000;

const frontendOf = (seed: unknown[]): CanonicalFrontendState =>
	({
		streaming: true,
		generation: 2,
		live_events: seed,
	}) as unknown as CanonicalFrontendState;

const withPage = (page: Entry[] = PAGE): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: page,
		has_more: false,
		cursor_missing: false,
	});

/**
 * The pre-fix fold, spelled out: `applyEvent` per seed event, with nothing
 * telling the reducer the event is a replay of a window the viewer never had.
 *
 * Kept as its own function rather than reconstructed from `applyLiveSeed`,
 * because the state it produces is the one the shipped code no longer produces —
 * which is exactly what makes the pair on one tree possible.
 */
const beforeFix = (seed: unknown[]): TranscriptState => {
	let next = withPage();
	for (const event of seed) next = applyEvent(next, event as never, ARRIVAL_MS);
	return next;
};

/** The shipped fold, called the way the hook calls it. */
const afterFix = (seed: unknown[]): TranscriptState =>
	applyLiveSeed(withPage(), frontendOf(seed), ARRIVAL_MS);

/** The same fold over the unrelated page: the D1 frame's fixture. */
const afterFixUnrelated = (seed: unknown[]): TranscriptState =>
	applyLiveSeed(withPage(PAGE_UNRELATED), frontendOf(seed), ARRIVAL_MS);

/**
 * A SEED WHOSE DELTA COULD NOT BE PLACED (design round 1, D2's second state).
 *
 * The reconnect this PR keeps rows for: the row holds text painted before the
 * gap and the seed names the same message with a delta nothing can position, so
 * the delta is withheld and the row says a chunk of it may be missing. The
 * caption for this state is NOT the join's — the row's own earlier text is on
 * screen under it — and until this story there was no frame for it at all.
 */
const seededWithheld = (): TranscriptState => {
	let next = withPage();
	next = applyEvent(
		next,
		{
			type: "message_start",
			message: { id: "a2", role: "assistant", content: [], tool_calls: [] },
		},
		ARRIVAL_MS,
	);
	next = applyEvent(
		next,
		{
			type: "message_update",
			message: { id: "a2", role: "assistant", content: [], tool_calls: [] },
			delta:
				"The refresh path is shared with the mobile client, which is the part that took longest to land.",
		},
		ARRIVAL_MS + 500,
	);
	return applyLiveSeed(next, frontendOf(SEED), ARRIVAL_MS + 60_000);
};

/**
 * A RECEIPT GAP OVER A ROW THAT WAS BEING WRITTEN (design round 1, D2's third
 * state, and QA round 1's Q2 seen live).
 *
 * `markLiveRecordsTruncated` is what the gap calls now: the rows stay painted —
 * this is the answer the operator watched vanish — and the streaming ones say
 * their continuity broke. The row here was minted by `message_start`, so its own
 * earlier text IS on screen, which is exactly the case the old single sentence
 * denied.
 */
const afterGap = (): TranscriptState => {
	let next = withPage();
	next = applyEvent(
		next,
		{
			type: "message_start",
			message: { id: "a2", role: "assistant", content: [], tool_calls: [] },
		},
		ARRIVAL_MS,
	);
	for (const chunk of [
		"Three things landed this week. ",
		"The token exchange moved behind the gateway, ",
		"the retry budget is now per-route, and ",
		"the refresh path is shared.",
	]) {
		next = applyEvent(
			next,
			{
				type: "message_update",
				message: { id: "a2", role: "assistant", content: [], tool_calls: [] },
				delta: chunk,
			},
			ARRIVAL_MS + 500,
		);
	}
	return markLiveRecordsTruncated(next);
};

/**
 * The turn ENDED, with the producer's assembled text: the one thing that clears
 * the mark, and the frame that shows it clearing.
 */
const settled = (text: string): TranscriptState =>
	applyEvent(
		afterFix(SEED),
		{
			type: "message_end",
			message: {
				id: "a2",
				role: "assistant",
				content: [{ type: "text", text }],
			},
		},
		ARRIVAL_MS + 1_000,
	);

const Frame = ({
	transcript,
	caption,
	status = "live",
}: {
	transcript: TranscriptState;
	caption: string;
	status?: CanonicalTranscriptStatus;
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
					gate={null}
					waiting={false}
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
	title: "Chat/Mid-turn join",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The join, pre-fix: the chunk alone, presented as the answer.
 *
 * Nothing on screen says the rest exists — which is what the operator reported
 * as a message that starts mid-sentence and is only whole once the turn ends.
 */
export const BeforeJoin: Story = {
	render: () => (
		<Frame
			caption="Before: a turn joined mid-stream. The seed carries the message's latest chunk and nothing that says how much text precedes it, so the row paints that chunk as the whole answer."
			transcript={beforeFix(SEED)}
		/>
	),
};

/** The join, post-fix: the same chunk, and the row saying it is not the start. */
export const AfterJoin: Story = {
	render: () => (
		<Frame
			caption="After: the same seed, the same chunk. The row states that earlier text is not on screen — the prefix is genuinely unknown, so it is named rather than invented, and cleared the moment the turn states the whole answer."
			transcript={afterFix(SEED)}
		/>
	),
};

/** The end of the same turn: the producer's assembled text replaces the tail. */
export const AfterJoinSettled: Story = {
	render: () => (
		<Frame
			caption="After, at the turn's end: `message_end` carries the assembled text, so the row is the whole answer and the caption is gone."
			transcript={settled(
				"Three things landed: the token exchange moved behind the gateway, the retry budget is now per-route, and the refresh path is now shared with the mobile client.",
			)}
		/>
	),
};

/**
 * The same join, over an answer that is complete and unrelated (D1).
 *
 * The capture the design round asked for by name, and the reason it is a frame
 * rather than an argument: with the ORIGINAL fixture's row above — the same
 * sentence's first half — the caption reads correctly whether it is attached to
 * this row or to the paragraph above it. Here the row above ends at its own full
 * stop and elsewhere in the answer, and the caption sits 12px below it against
 * its own 4px to the chunk, so the ownership is legible without a caption text
 * that has to argue for it.
 */
export const AfterJoinUnrelated: Story = {
	render: () => (
		<Frame
			caption="After, with an unrelated complete answer above it: the same joined chunk. The gap above this row is a between-components step (12px) against the caption's 4px to its own text, so the line attaches to the row it describes rather than to the answer above — the mis-parse the design round judged in the original fixture."
			transcript={afterFixUnrelated(SEED)}
		/>
	),
};

/**
 * The reconnect states that had no frame before (D2, second and third states).
 *
 * The caption for a row that lost continuity is `Part of this answer may be
 * missing`, and the difference from the join's sentence is the whole point: this
 * row's own earlier text is on screen under it, so a caption claiming a missing
 * prefix would deny the paragraph directly beneath it.
 */
export const AfterSeedWithheld: Story = {
	render: () => (
		<Frame
			caption="After, reconnecting: the row kept the text it had painted before the gap, and the seed's delta could not be placed after it, so the delta is withheld. The row's own earlier text is on screen, which is why its caption claims a possible hole rather than a missing prefix."
			transcript={seededWithheld()}
		/>
	),
};

/** The same caption on the gap path, with the pane saying it is reconnecting. */
export const AfterGap: Story = {
	render: () => (
		<Frame
			caption="After a receipt gap, reconnecting: the answer being written is KEPT and marked uncertain rather than erased. The row was minted by `message_start`, so it starts where the answer starts and its earlier text is on screen — the real uncertainty is a hole in the middle, and the caption says that."
			transcript={afterGap()}
			status="reconnecting"
		/>
	),
};
