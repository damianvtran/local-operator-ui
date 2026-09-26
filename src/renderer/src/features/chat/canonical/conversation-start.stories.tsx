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
