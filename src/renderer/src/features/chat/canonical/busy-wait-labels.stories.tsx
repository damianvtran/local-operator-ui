/**
 * THE FIVE THINGS A WAITING MESSAGE CAN SAY, and the frame that shows the line
 * clearing.
 *
 * WHY THIS IS A STORY BESIDE THE TESTS. `scripts/busy-wait.test.mjs` pins the
 * rule (which ids get a label, and which sentence) and the row's wiring. What a
 * rule cannot be reviewed for is how the line SITS: it is a muted sentence under
 * the reader's own message, right-aligned with the stamp, and it takes a row
 * while it says anything — so when it clears, every row below it moves up one
 * line. That is a pixel question, and these are the pixels.
 *
 * THE PAIR AT THE END IS THE ONE THE DESIGNER NEEDS: identical conversations,
 * one with the message still queued and one delivered. Overlay the two frames
 * and the only difference is the line and the shift it causes at the tail.
 *
 * THE MODES ARE RECORDED THE WAY THE COMPOSER RECORDS THEM. `noteBusySend` runs
 * at the press in the app, before the request leaves; a story that only set
 * `queued_steering` would render no line at all (the map is the other source,
 * spec §C). Calling it while the story renders is the same call in the same
 * order.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import { noteBusySend } from "@shared/store/canonical-sessions-store";
import type {
	CanonicalFrontendState,
	DesktopHistoryPage,
} from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyHistoryPage,
} from "./transcript-reducer";

/**
 * One instant for every frame, so the frames are byte-reproducible.
 *
 * In SECONDS, because that is what a durable history entry carries: the reducer
 * multiplies by 1000 (`Math.round((entry.ts ?? 0) * 1000)`), and a millisecond
 * literal here renders as a year in the tens of thousands.
 */
const TS = 1_760_000_000;

/**
 * The reader's pane height, pinned (the transcript's own stories use the same
 * measured 685px at 1380x900): an unpinned height would grow the capture and
 * show a state no reader can be in.
 */
const PANE = 685;

type Entry = DesktopHistoryPage["entries"][number];

const entry = (
	id: string,
	ts: number,
	payload: Record<string, unknown>,
): Entry => ({ id, ts, type: "message", payload });

const question = (id: string, text: string): Entry =>
	entry(id, TS, {
		kind: "message",
		role: "user",
		content: [{ text }],
	});

const answer = (id: string, text: string): Entry =>
	entry(id, TS + 30, {
		kind: "message",
		role: "assistant",
		content: [{ text }],
		stop_reason: "stop",
	});

type Mode = "steer" | "queue" | "both";

/** One queued message, as this story needs it: the id the row carries and the mode. */
type Queued = { id: string; mode: Mode };

const transcriptOf = (entries: Entry[]): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries,
		has_more: false,
		cursor_missing: false,
	});

/**
 * A frame carrying only what this surface reads: a session id, the live flag,
 * and the owner's waiting list. The shape is the contract's; the cast is the
 * stories' idiom for a frame built field by field.
 */
const frameOf = (queued: Queued[], streaming = true): CanonicalFrontendState =>
	({
		session_id: "story-busy-wait",
		streaming,
		queued_steering: queued.map(({ id }) => ({
			id,
			text: "",
			image_count: 0,
			status: "queued",
		})),
	}) as unknown as CanonicalFrontendState;

const Frame = ({
	transcript,
	queued,
	caption,
	streaming = true,
}: {
	transcript: TranscriptState;
	queued: Queued[];
	caption: string;
	streaming?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	// The composer's own call, in the composer's own order (the press records
	// the mode; the backend's queue is what makes it a wait).
	for (const item of queued) noteBusySend(item.id, item.mode);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			{/* A fixed caption box, so a pair overlays when a reviewer flips
			 * between the frames. */}
			<p className="h-10 text-body-sm text-ink-muted">{caption}</p>
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE }}
				ref={containerRef}
			>
				<CanonicalTranscript
					transcript={transcript}
					frontend={frameOf(queued, streaming)}
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
	title: "Chat/Busy-send waiting labels",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The question the turn is answering, so the frame reads as a live chat. */
const CONVERSATION = [
	question("u-earlier", "What changed in the retry path?"),
	answer(
		"a-earlier",
		"The budget is per-route now, and the refresh path is shared with the phone.",
	),
];

/**
 * The conversation each single-state story needs: the queued message is a ROW in
 * the transcript, because the label is joined to it by id (`noteBusySend` names
 * the press, `queued_steering` names the wait, and the row is where the two
 * meet). A story that queued an id no row carries would render nothing, which
 * is the fail-safe, not the state.
 */
const awaiting = (id: string, text: string): Entry[] => [
	...CONVERSATION,
	question(id, text),
];

/**
 * A conversation long enough to put the labelled message at the TAIL of the
 * pane, with rows below it: the pair is about what the line does to everything
 * after it, and a nearly-empty pane would show the shift against emptiness.
 */
/**
 * A conversation that FITS the pane, so the tail pair measures the shift rather
 * than the scroll: with content taller than the pane the transcript is
 * bottom-pinned and the scroll anchor keeps the tail still (measured: the row
 * below stays at the same y in both frames). Here the labelled message is last,
 * the answer under it moves up one line when the label clears, and that is the
 * shift this pair is for.
 */
const TAIL_CONVERSATION = [
	question("u-earlier", "What changed in the retry path?"),
	answer(
		"a-earlier",
		"The budget is per-route now, and the refresh path is shared with the phone.",
	),
	question(
		"req-tail",
		"Then check the queue receipts before you close it out.",
	),
	answer(
		"a-after",
		"Reading the receipts now — the fold will show the last four calls.",
	),
];

export const Steer: Story = {
	render: () => (
		<Frame
			caption="Steer: a busy Enter sends now. It stops the running step, and may stop a tool mid-call — which is what the line says."
			transcript={transcriptOf(
				awaiting("req-steer", "One more thing before the step finishes."),
			)}
			queued={[{ id: "req-steer", mode: "steer" }]}
		/>
	),
};

export const Queue: Story = {
	render: () => (
		<Frame
			caption="Queue: the message waits for the step to finish. No tool is interrupted, and the line says so."
			transcript={transcriptOf(
				awaiting("req-queue", "Add the receipt note when this step is done."),
			)}
			queued={[{ id: "req-queue", mode: "queue" }]}
		/>
	),
};

export const Both: Story = {
	render: () => (
		<Frame
			caption="Queue, then steer: it waits like queue, and steers like steer if the step runs too long."
			transcript={transcriptOf(
				awaiting(
					"req-both",
					"Queue the changelog note, and steer if it drags.",
				),
			)}
			queued={[{ id: "req-both", mode: "both" }]}
		/>
	),
};

export const Joined: Story = {
	render: () => (
		<Frame
			caption="Joined: a steer is already waiting, so the queue row goes out with it — its line says so, and the steer keeps its own."
			transcript={transcriptOf([
				...CONVERSATION,
				question("req-queue-1", "Also add the receipt note to the changelog."),
				question("req-steer-1", "Wait — is the release cut already?"),
			])}
			queued={[
				{ id: "req-queue-1", mode: "queue" },
				{ id: "req-steer-1", mode: "steer" },
			]}
		/>
	),
};

export const Deferred: Story = {
	render: () => (
		<Frame
			caption="Deferred: the turn has ended and the message still waits, so it goes out with the reader's next message."
			transcript={transcriptOf([
				...CONVERSATION,
				question(
					"req-deferred",
					"Then ship the receipts with the next release.",
				),
			])}
			queued={[{ id: "req-deferred", mode: "queue" }]}
			streaming={false}
		/>
	),
};

export const TailLabelled: Story = {
	render: () => (
		<Frame
			caption="Tail, waiting: the line holds a row under the reader's message, so everything below it sits one line lower."
			transcript={transcriptOf(TAIL_CONVERSATION)}
			queued={[{ id: "req-tail", mode: "queue" }]}
		/>
	),
};

export const TailCleared: Story = {
	render: () => (
		<Frame
			caption="Tail, delivered: same conversation, the queue empty. The line and its row are gone and the rows below move up — overlay this on the waiting frame to read the shift."
			transcript={transcriptOf(TAIL_CONVERSATION)}
			queued={[]}
		/>
	),
};
