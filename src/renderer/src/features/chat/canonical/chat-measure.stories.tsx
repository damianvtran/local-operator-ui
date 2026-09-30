/**
 * The chat column's shared measure, at the shipped width and at the width it
 * carried before this change.
 *
 * Why this story exists rather than a frame of the live app. The subject is a
 * NUMBER - one line of CSS that every measure consumer inherits - and the two
 * things that make a number reviewable are that the frame shows the whole column
 * (not a crop, which cannot say how long a line got) and that the same records
 * are rendered at both values so the pair differs by nothing else. A live
 * conversation cannot hold the prose still while the width changes, so the
 * comparison would be between two different answers.
 *
 * `PreviousMeasure` is the SAME records at the 900px the column carried before
 * the narrowing, written as an override of `--lo-chat-measure` on the frame's
 * own wrapper. That is what makes the pair a controlled comparison: one number
 * differs, and everything else - font, viewport, container, records - is
 * identical. It is NOT a frame of `origin/main`; `docs/evidence/chat-measure/`'s
 * README states exactly what it does and does not prove.
 *
 * The records are chosen for the measurement, not for variety: one long assistant
 * answer, because the characters-per-line reading is taken over that paragraph,
 * and a short run of tool rows, because the ledger is what the measure has to
 * share its edges with (`chat-measure.ts`). There is deliberately NO user turn -
 * the user bubble carries its own narrower measure, so a frame containing one
 * would have two different boxes in it and the probe could not say which one it
 * measured.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type { SessionFailureNotice } from "../../../../../shared/desktop-stream-notice";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const TS = 1_760_000_000_000;

/**
 * The sample the characters-per-line reading is taken over.
 *
 * 1,059 characters of the register this surface actually carries - an agent
 * explaining a decision to its owner - because a line-length figure is only
 * comparable between two widths when the two runs wrap the same text. A
 * synthetic `lorem ipsum` would be a different average (the word lengths differ)
 * and would therefore make the number untrustworthy in the one place it is
 * quoted.
 */
const SAMPLE =
	"The constraint is a single number, so the first thing to settle is what it is for. A reading measure exists to stop a line of prose from running wider than the eye can carry, and the guidance most typographers quote for that is between forty-five and seventy-five characters. This surface is not a reading pane, though, and the difference is not a quibble: it is a ledger. An agent turn interleaves two registers in one content box, the prose it writes to its owner and the rows recording what it did, and the reader's job is to scan a row and match it against the sentence that produced it. That job is served by the two registers sharing one left rail and one right edge, which is why the cap here is applied to the whole row content box and never to the prose alone. A cap on the prose by itself puts a second left edge inside the row, and the eye reads two left edges in one column as a mistake rather than as a decision. So the number is a compromise between a comfortable measure and an aligned ledger, and it is set by measurement rather than by taste.";

const assistant = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});

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
		oldestTs: 0,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const RECORDS: TranscriptRecord[] = [
	assistant("m1", SAMPLE),
	tool({
		id: "t1",
		toolName: "read",
		args: { path: "src/renderer/src/features/chat/chat-measure.ts" },
	}),
	tool({
		id: "t2",
		toolName: "bash",
		args: { command: "node scripts/chat-measure-geometry.mjs --json" },
		durationS: 1.2,
	}),
	tool({
		id: "t3",
		toolName: "edit",
		args: { path: "src/renderer/src/styles/index.css" },
		durationS: 0.12,
		added: 42,
		removed: 11,
	}),
];

/**
 * The frame: a fixed-width pane holding the production transcript, so the
 * container query in `CHAT_MEASURE` resolves against a width this story states
 * rather than against the story iframe.
 *
 * The width is `1024`, which is above the 858px at which an 810px cap starts to
 * bind AND above the 948 an 900px cap needs - so both values are at their cap in
 * the same frame and the pair measures the two numbers rather than the pane.
 */
const PANE = 1024;

const Frame = ({
	measure,
	pane = PANE,
	height = 620,
}: {
	/** An override for `--lo-chat-measure`, in px, or `null` for the shipped value. */
	measure: number | null;
	/** The pane's own width, for the frame that has to show a column with no room. */
	pane?: number;
	height?: number;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div
			className="overflow-hidden"
			style={{
				width: pane,
				height,
				...(measure === null
					? {}
					: { ["--lo-chat-measure" as string]: `${measure}px` }),
			}}
		>
			<CanonicalTranscript
				transcript={transcriptOf(RECORDS)}
				gate={null}
				waiting={false}
				starting={false}
				startingAfterId={null}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
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
	title: "Chat/Measure",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The shipped measure. */
export const Transcript: Story = {
	render: () => <Frame measure={null} />,
};

/** The same records at the 900px the column carried before the narrowing. */
export const PreviousMeasure: Story = {
	render: () => <Frame measure={900} />,
};

/*
 * THE CONTROL PAIR.
 *
 * A 700px pane is below the 858px an 810px cap needs to bind, so at that pane
 * the content box is the pane less its insets - 668px - under BOTH measures.
 * The two frames must therefore be identical, and
 * `scripts/chat-measure-evidence.mjs` fails the run if they are not: a
 * difference would mean the 750px gate had started to bind, which is the one
 * way this change could narrow a column that has no room to spare.
 */
export const NarrowPane: Story = {
	render: () => <Frame measure={null} pane={700} height={460} />,
};

export const NarrowPanePreviousMeasure: Story = {
	render: () => <Frame measure={900} pane={700} height={460} />,
};
