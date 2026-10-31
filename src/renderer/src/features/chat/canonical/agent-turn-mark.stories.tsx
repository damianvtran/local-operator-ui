/**
 * The agent's picture at the head of a turn: with a picture and without, at a
 * wide column and a narrow one.
 *
 * WHY THIS IS A STORY AND NOT ONLY A TEST. The rule "once per turn, at the
 * head, never narrowing the text" is a rule about a RENDERED COLUMN -
 * `scripts/tool-row.test.mjs` can assert which row is elected and that no
 * indent token exists, but not that the prose's own left and right edges are
 * the same with a picture as without one. So the two states are drawn in one
 * tree, at the same width, and the frames are measured rather than eyeballed.
 *
 * THE PANES ARE THE PRODUCTION PANE. `CanonicalTranscript` renders exactly what
 * `/chat` renders (it is the only transcript the app has), given records built
 * by hand instead of read from a session - the same fixture discipline
 * `chat-measure.stories.tsx` uses. What is NOT proven here: that the page
 * resolves the right agent for a conversation (that join lives in `chat-page`
 * and needs a backend), or that a real photograph downscales well.
 *
 * THE PICTURE IS SYNTHETIC: two tones and a seam on a canvas, neutral greys on
 * purpose, so no frame becomes a claim about a palette.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import "../../../styles/index.css";
import {
	setAgentAvatar,
	useAgentAvatar,
} from "@shared/store/agent-avatar-store";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import type { CanonicalTranscriptStatus } from "./transcript-pane";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/** One instant for every record, so the frames are byte-reproducible. */
const TS = 1_760_000_000_000;

/** The reader's own pane height, as `mid-turn-join.stories.tsx` pins it. */
const PANE_HEIGHT = 560;

/**
 * A 256px mark, the edge the store keeps. Greys, not a palette: the picture
 * stands in for whatever a user uploads.
 */
const syntheticPicture = (): string => {
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 256;
	const context = canvas.getContext("2d");
	if (!context) return "";
	context.fillStyle = "#6b7280";
	context.fillRect(0, 0, 256, 256);
	context.fillStyle = "#d1d5db";
	context.beginPath();
	context.moveTo(0, 256);
	context.lineTo(256, 0);
	context.lineTo(256, 256);
	context.closePath();
	context.fill();
	context.fillStyle = "#374151";
	context.beginPath();
	context.arc(128, 128, 54, 0, Math.PI * 2);
	context.fill();
	return canvas.toDataURL("image/webp", 0.9);
};

type ToolRecord = Extract<TranscriptRecord, { kind: "tool" }>;

const user = (id: string, text: string): TranscriptRecord => ({
	kind: "user",
	id,
	ts: TS,
	text,
	images: [],
});

const assistant = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS + 1_000,
	text,
	streaming: false,
	complete: true,
	stopReason: "stop",
	error: false,
});

const tool = (over: Partial<ToolRecord> & { id: string }): ToolRecord => ({
	kind: "tool",
	ts: TS + 2_000,
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

/**
 * TWO TURNS, because "once per turn" is only visible against a second one.
 *
 * The first turn is the shape the mark has to survive: prose, then two calls
 * (one of which is long enough to fold), then a closing answer - three agent
 * rows, ONE picture. The second turn proves the mark comes back for the next
 * turn rather than disappearing after the first.
 */
const RECORDS: TranscriptRecord[] = [
	user("u1", "Which files changed the retry budget?"),
	assistant(
		"a1",
		"Two: the gateway client and the route table. Reading both before I answer.",
	),
	tool({
		id: "t1",
		toolName: "read",
		args: { path: "src/shared/api/gateway.ts" },
	}),
	tool({
		id: "t2",
		toolName: "bash",
		args: { command: "git diff --stat origin/main -- src/shared/api" },
		durationS: 1.4,
	}),
	assistant(
		"a2",
		"The retry budget moved into `gateway.ts` and is now per-route: the table reads it from one constant, so a route cannot carry a second copy.",
	),
	user("u2", "And the mobile client?"),
	assistant(
		"a3",
		"It inherits the same budget through the shared client. Nothing on the mobile side hard-codes a number any more.",
	),
	/*
	 * THE THIRD TURN OPENS ON THE LEDGER, which is the one shape the mark's two
	 * render sites disagree about: the turn's first row is a CALL, the calls fold
	 * behind one bar, and the bar - not the hidden row - is then the turn's first
	 * line. It is here because that is the path a picture could silently fall off
	 * (the row it belongs to is unmounted).
	 */
	user("u3", "Run the suite and tell me what broke."),
	tool({ id: "t3", toolName: "bash", args: { command: "pnpm test" } }),
	tool({
		id: "t4",
		toolName: "bash",
		args: { command: "pnpm check-types" },
		durationS: 2.1,
	}),
	assistant("a4", "Two failures, both in the retry table's fixture."),
];

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

const TRANSCRIPT = transcriptOf(RECORDS);

/**
 * One pane at an exact width.
 *
 * `data-frame` is the measurement hook: the rig reads the prose's own box
 * inside `[data-frame="<name>"]`, so the number in the report is the rendered
 * measure and not a class name.
 */
const Panel = ({
	frame,
	width,
	agentId,
}: {
	frame: string;
	width: number;
	agentId: string | null;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	/*
	 * THE PRODUCTION SEAM, not a hand-fed URL: the store hook the pane's page
	 * uses (`useAgentAvatar`) reads the picture by agent id, so the frame proves
	 * the stored value reaches the row - the same subscription that repaints a
	 * conversation when the picture changes.
	 */
	const agentAvatar = useAgentAvatar(agentId);
	return (
		<div
			data-frame={frame}
			className="flex min-h-0 flex-col overflow-hidden border border-hairline"
			style={{ width }}
		>
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE_HEIGHT }}
				ref={containerRef}
			>
				<CanonicalTranscript
					frontend={{} as CanonicalFrontendState}
					transcript={TRANSCRIPT}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					agentAvatar={agentAvatar}
					/*
					 * THE NAME THE IMAGE PRINTS: without it the frame renders
					 * `alt=""` and the frame cannot show what a reader with a screen
					 * reader hears (agent review round 2, R2-3 on #1518).
					 */
					agentName="coder"
					status={"live" as CanonicalTranscriptStatus}
					failure={null}
					awaitingHydration={false}
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

/** The agent the fixture picture is stored under. */
const STORY_AGENT_ID = "agent-story-coder";

/**
 * Stores the synthetic picture ONCE per page, through the same call the
 * settings pane makes, so the frame shows the stored shape rather than a
 * hand-written URL. A canvas minted per render would give the panes different
 * pixels of the same fixture, which a reviewer then has to explain.
 */
const useStoredPicture = () => {
	const [stored, setStored] = useState(false);
	useEffect(() => {
		if (stored) return;
		const picture = syntheticPicture();
		if (picture) setAgentAvatar(STORY_AGENT_ID, picture);
		setStored(true);
	}, [stored]);
	return stored;
};

/**
 * All four states in one frame: picture and no picture, wide and narrow. The
 * two pairs are what a reviewer measures against each other.
 */
const Gallery = () => {
	useStoredPicture();
	return (
		<div className="flex flex-wrap items-start gap-6 bg-canvas p-6">
			<Panel frame="picture-wide" width={1024} agentId={STORY_AGENT_ID} />
			<Panel frame="picture-narrow" width={420} agentId={STORY_AGENT_ID} />
			<Panel frame="plain-wide" width={1024} agentId={null} />
			<Panel frame="plain-narrow" width={420} agentId={null} />
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Agent turn mark",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** All four states in one frame: the pair to compare is picture vs plain. */
export const GalleryStory: Story = {
	name: "Gallery",
	render: () => <Gallery />,
};

/** A pane whose agent has a stored picture; a component so the hook is legal. */
const PicturePane = ({ frame, width }: { frame: string; width: number }) => {
	useStoredPicture();
	return <Panel frame={frame} width={width} agentId={STORY_AGENT_ID} />;
};

/** Just the wide picture pane, for a frame a reviewer can read at 1:1. */
export const PictureWide: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<PicturePane frame="picture-wide" width={1024} />
		</div>
	),
};

/** The narrow column, where a gutter would have cost the most. */
export const PictureNarrow: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<PicturePane frame="picture-narrow" width={420} />
		</div>
	),
};

/**
 * The SAME conversation for an agent with no picture: D11's transcript, which
 * is what an agent that never had a picture must still get. Paired with the
 * picture frames above so the two can be measured against each other - the
 * prose's box is the number the mark must not move.
 */
export const PlainWide: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<Panel frame="plain-wide" width={1024} agentId={null} />
		</div>
	),
};

export const PlainNarrow: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<Panel frame="plain-narrow" width={420} agentId={null} />
		</div>
	),
};
