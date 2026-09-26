/**
 * The conversation's FIRST frames: what a short conversation looks like while a
 * send is going out, and where its content sits.
 *
 * WHY THIS IS A STORY AGAINST THE TEST. The layout half of this change is one
 * auto margin on the transcript's content column, and its only honest evidence
 * is the geometry of a rendered pane: a node test over a class name would pass
 * on a build where the margin never resolved, and the driver scene
 * (`--scene first-send`) asserts the app-level reading. These cells are the
 * states a reviewer flips between by eye: a conversation that fits in the pane
 * (one user row, top-anchored, no scrollbar) versus the same column at its
 * other end of the range.
 *
 * The transcript is built through the REAL reducer (`applyEvent`), so the
 * record these cells render is the record the app paints, and the pane height
 * is pinned to the transcript's own measured `clientHeight` at 1380x900
 * (`docs/evidence/chat-scrolling/README.md`) so a cell cannot quietly grow its
 * viewport into a state no reader can be in.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import type { CanonicalTranscriptStatus } from "./transcript-pane";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	appendPendingUser,
	applyEvent,
} from "./transcript-reducer";

/** One instant for every frame, so the frames are byte-reproducible. */
const TS = 1_760_000_000_000;

/** The reader's own pane height (see the file comment). */
const PANE = 685;

/** One user row, as the reducer paints it off a durable `message_start`. */
const oneUserRow = (text: string): TranscriptState =>
	applyEvent(
		EMPTY_TRANSCRIPT,
		{
			type: "message_start",
			message: {
				id: "u1",
				role: "user",
				content: [{ type: "text", text }],
				tool_calls: [],
			},
		},
		TS,
	);

/**
 * The SAME row as an optimistic paint: what the transcript holds while a send
 * is going out, before the owner has answered (and, on a New chat, before
 * `sessions.create` has even returned). Appended through the reducer helper the
 * registry uses, so the record this cell renders is the one the app paints.
 */
const onePendingRow = (text: string): TranscriptState =>
	appendPendingUser(EMPTY_TRANSCRIPT, "req-1", text, [], TS);

const Frame = ({
	transcript,
	caption,
	status = "live",
	starting = false,
	startingSession = false,
	startingSince = null,
}: {
	transcript: TranscriptState;
	caption: string;
	status?: CanonicalTranscriptStatus;
	starting?: boolean;
	startingSession?: boolean;
	startingSince?: number | null;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			{/* A fixed caption box, so two frames overlay when a reviewer flips
			 * between them: two captions of different lengths would move the
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
					starting={starting}
					startingAfterId={starting ? "req-1" : null}
					startingSession={startingSession}
					startingSince={startingSince}
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
	title: "Chat/Conversation start",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * One user row in a pane it does not fill: the row sits just under the
 * "Start of conversation" slot at the TOP of the region, and the space below
 * it belongs to the conversation, not to a scroller holding a gap open.
 */
export const OneUserRow: Story = {
	render: () => (
		<Frame
			caption="One user row: a conversation shorter than the pane anchors to the top. The space below the row is free space the column does not claim - no scrollbar, and the row is not parked over the composer."
			transcript={oneUserRow("Summarise yesterday's QA run.")}
		/>
	),
};

/**
 * THE PRESS FRAME (conversation-start, T1): a draft whose send is in flight,
 * painted as the optimistic row - `starting` on, so the wait line stands under
 * it - with the composer empty and no greeting in sight. One frame of the
 * journey the change is for; the driver scene `--scene first-send` photographs
 * the same state in the real app, and this cell is the reference for the
 * storybook-side states the designer flips between.
 */
export const DraftSendInFlight: Story = {
	render: () => (
		<Frame
			caption="A New chat's first send, in flight: the optimistic row is in the conversation, the working line claims the wait, and the band has yielded its greeting - the state that used to be dead air for the whole create hop."
			transcript={onePendingRow("Summarise yesterday's QA run.")}
			starting
			startingSession
			startingSince={TS}
		/>
	),
};
