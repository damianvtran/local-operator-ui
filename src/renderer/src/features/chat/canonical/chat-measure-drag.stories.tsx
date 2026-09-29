/**
 * The conversation column's drag affordance, on the production transcript.
 *
 * The records are the same shape `chat-measure.stories.tsx` uses, and for the
 * same reason: the subject is the column's width, so the frame has to show a
 * whole column rather than a crop, and the pair of stories has to differ by one
 * thing. Here the one thing is the INTERACTION - the handles are part of
 * `CanonicalTranscript`, so a story that renders the transcript renders them,
 * and `scripts/chat-measure-drag-evidence.mjs` drives them with a real pointer
 * through the CDP input pipeline. `:hover` and a button-down are browser state
 * and not story state; a story that faked either would be evidence about the
 * fake.
 *
 * WHY THE FRAME IS 1024px WIDE AND THE VIEWPORT IS WIDER. The pane is stated
 * rather than inherited so the geometry is a property of the story instead of of
 * the iframe, and the viewport is a little larger than that so the pane is not
 * clipped. Nothing in this file sets the measure: the handles read it from the
 * preferences store and write it back, which is the path under test.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type { SessionFailureNotice } from "../../../../../shared/desktop-stream-notice";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const TS = 1_760_000_000_000;

/**
 * Long enough to wrap several times at every width the handle can reach, so the
 * frames show what the width DOES to a line rather than what it does to a box.
 * The same 1,006-character sample `chat-measure.stories.tsx` measures, because
 * the readings from the two sets are read side by side.
 */
const SAMPLE =
	"The constraint is a single number, so the first thing to settle is what it is for. A reading measure exists to stop a line of prose from running wider than the eye can carry, and the guidance most typographers quote for that is between forty-five and seventy-five characters. This surface is not a reading pane, though, and the difference is not a quibble: it is a ledger. An agent turn interleaves two registers in one content box, the prose it writes to its owner and the rows recording what it did, and the reader's job is to scan a row and match it against the sentence that produced it. That job is served by the two registers sharing one left rail and one right edge, which is why the cap here is applied to the whole row content box and never to the prose alone. A cap on the prose by itself puts a second left edge inside the row, and the eye reads two left edges in one column as a mistake rather than as a decision. So the number is a compromise between a comfortable measure and an aligned ledger, and it is set by measurement rather than by taste.";

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

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		compacting: false,
		compactingSince: 0,
		viewEpoch: 0,
		oldestId: null,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const RECORDS: TranscriptRecord[] = [
	{
		kind: "assistant",
		id: "m1",
		ts: TS,
		text: SAMPLE,
		streaming: false,
		complete: true,
		stopReason: null,
		error: false,
	},
	tool({
		id: "t1",
		toolName: "read",
		args: { path: "src/renderer/src/styles/index.css" },
	}),
	tool({
		id: "t2",
		toolName: "bash",
		args: { command: "node scripts/chat-measure-drag-evidence.mjs --json" },
		durationS: 1.2,
	}),
	tool({
		id: "t3",
		toolName: "edit",
		args: { path: "src/renderer/src/features/chat/chat-measure-drag.ts" },
		durationS: 0.12,
		added: 42,
		removed: 11,
	}),
];

/** The pane the handles size, stated here so the geometry is the story's. */
const PANE = 1024;

const Frame = ({ height = 620 }: { height?: number }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="overflow-hidden" style={{ width: PANE, height }}>
			<CanonicalTranscript
				transcript={transcriptOf(RECORDS)}
				gate={null}
				waiting={false}
				starting={false}
				startingAfterId={null}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				/* The handles ARE this story's subject; the rig drives them. */
				measureHandle
				isSmallView={false}
				status={"live" as const}
				failure={null as SessionFailureNotice | null}
				awaitingHydration={false}
				onReconnect={() => {}}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Measure drag",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The transcript with both measure handles in place.
 *
 * There is one story, not one per state: the states this feature has are
 * BROWSER states (at rest, hovered, mid-drag, released, restored) and a story
 * cannot produce any of them. `scripts/chat-measure-drag-evidence.mjs` drives
 * the pointer, shoots each one and asserts what the store received.
 */
export const Transcript: Story = {
	render: () => <Frame />,
};
