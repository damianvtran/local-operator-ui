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
import { useEffect, useLayoutEffect, useRef } from "react";
import "../../../styles/index.css";
import {
	agentAvatarsQueryKey,
	useAgentAvatarMap,
} from "@shared/agent-avatar/agent-avatar";
import { useAgentSlotMark } from "@shared/agent-avatar/agent-avatar-slot";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useQueryClient } from "@tanstack/react-query";
import type { CanonicalFrontendState } from "../../../../../shared/desktop-session-contract";
import type { AgentAvatarSize } from "../agent-avatar-size";
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
	owned = true,
	height = PANE_HEIGHT,
	transcript = TRANSCRIPT,
}: {
	frame: string;
	width: number;
	agentId: string | null;
	/** The records to draw; the short three-turn fixture by default. */
	transcript?: TranscriptState;
	/** Whether the viewer owns the agent (the picture's ownership answer). */
	owned?: boolean;
	height?: number;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	/*
	 * THE PRODUCTION SEAM, not a hand-fed URL: the store hook the pane's page
	 * uses (`useAgentAvatar`) reads the picture by agent id, so the frame proves
	 * the stored value reaches the row - the same subscription that repaints a
	 * conversation when the picture changes.
	 */
	const agentAvatar = useAgentSlotMark({
		agentId,
		agentName: "coder",
		owned,
		pictureDoor: false,
	});
	return (
		<div
			data-frame={frame}
			className="flex min-h-0 flex-col overflow-hidden border border-hairline"
			style={{ width }}
		>
			<div
				className="flex min-h-0 flex-col"
				style={{ height }}
				ref={containerRef}
			>
				<CanonicalTranscript
					frontend={{} as CanonicalFrontendState}
					transcript={transcript}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					agentMark={agentAvatar}
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

/** A digest-shaped id: the media stub keys the bytes by it, nothing verifies it. */
const STORY_SHA = "b".repeat(64);

/**
 * Seeds the synthetic picture ONCE per page, through the SAME seam the app
 * reads: the agents map carries the picture's record (the key a real agents
 * read fills) and the preload media relay answers `agent.avatar` with the
 * bytes, so `useAgentAvatar` fetches it exactly as it does in the app.
 *
 * WHY NOT A WRITE: the picture lives in the backend now, so there is no
 * client-side `setAgentAvatar(id, dataUrl)` to call; a story cannot have a
 * backend, so it stands in for the two reads the seam makes. A canvas minted per
 * render would give the panes different pixels of the same fixture, which a
 * reviewer then has to explain - the bytes are decoded once.
 */
const STORY_PICTURE = (() => {
	const dataUrl = syntheticPicture();
	const base64 = dataUrl.split(",")[1] ?? "";
	return {
		mime: dataUrl.slice(5, dataUrl.indexOf(";")) || "image/webp",
		bytes: Uint8Array.from(atob(base64), (character) =>
			character.charCodeAt(0),
		),
	};
})();

const installMedia = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string }) =>
			request.op === "agent.avatar"
				? {
						status: 200,
						kind: "bytes",
						mimeType: STORY_PICTURE.mime,
						data: STORY_PICTURE.bytes,
					}
				: { status: 404, kind: "error", detail: "Not in this story." },
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};
installMedia();

const useStoredPicture = () => {
	// The story's OWN client (`.storybook/preview.tsx` makes one per story): the
	// app singleton is not the one this pane reads through.
	const client = useQueryClient();
	useEffect(() => {
		client.setQueryData(agentAvatarsQueryKey, {
			[STORY_AGENT_ID]: {
				sha256: STORY_SHA,
				mime: STORY_PICTURE.mime,
				bytes: STORY_PICTURE.bytes.byteLength,
				updated_at: "2026-10-30T00:00:00.000Z",
			},
		});
	}, [client]);
	// Read the map so the pane repaints when the query is filled.
	useAgentAvatarMap();
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
const PicturePane = ({
	frame,
	width,
	agentId = STORY_AGENT_ID,
	transcript,
	height,
}: {
	frame: string;
	width: number;
	agentId?: string | null;
	transcript?: TranscriptState;
	height?: number;
}) => {
	useStoredPicture();
	return (
		<Panel
			frame={frame}
			width={width}
			agentId={agentId}
			transcript={transcript}
			height={height}
		/>
	);
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

/** An owned agent that has NO stored picture (the map above lists only the pictured one). */
const BARE_AGENT_ID = "agent-story-bare";

/**
 * AN OWNED AGENT WITH NO PICTURE, in a real transcript: no mark at all (operator,
 * 2026-11-04). #1651 drew a dashed camera door at the first turn's head here; it
 * took a line above the first tool row for an agent that never asked for a
 * picture, so it is gone, and this frame is the D11 transcript exactly - the
 * same as `PlainWide`. `data-frame` is the measure hook for that comparison.
 */
export const NoPictureOwned: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<PicturePane
				frame="no-picture-owned"
				width={1024}
				agentId={BARE_AGENT_ID}
			/>
		</div>
	),
};

/** The same agent when the viewer does not own it: also no mark at all. */
export const NoPictureNotOwned: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<Panel
				frame="no-picture-not-owned"
				width={1024}
				agentId={BARE_AGENT_ID}
				owned={false}
			/>
		</div>
	),
};

/** A pane at one step of the size setting, with a picture or without. */
const SizedPane = ({
	size,
	agentId,
}: {
	size: AgentAvatarSize;
	agentId: string;
}) => {
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({ agentAvatarSize: size });
		return () => useUiPreferencesStore.setState({ agentAvatarSize: "small" });
	}, [size]);
	return <PicturePane frame={`size-${size}`} width={1024} agentId={agentId} />;
};

export const SizeSmall: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<SizedPane size="small" agentId={STORY_AGENT_ID} />
		</div>
	),
};
export const SizeMedium: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<SizedPane size="medium" agentId={STORY_AGENT_ID} />
		</div>
	),
};
export const SizeLarge: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<SizedPane size="large" agentId={STORY_AGENT_ID} />
		</div>
	),
};
/** The large step with no picture: still nothing, at any size. */
export const SizeLargeNoPicture: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<SizedPane size="large" agentId={BARE_AGENT_ID} />
		</div>
	),
};

/**
 * A LONG TRANSCRIPT, WITH THE DOM WINDOW ON (QA round 1, Q3).
 *
 * The short fixtures never reach the windowing path, so they cannot show the
 * thing the size setting must not break: the window ESTIMATES an entry it has
 * not mounted, and the estimate for a turn head reads `turnMarkHeight(size)`.
 * 60 turns (120 records, a mark on each turn's head) is well past what a pane
 * mounts at once, and the story switches the window on the way the app does
 * (`canonicalTranscriptDomWindow` = "on", read once at mount, so it is set before
 * the transcript mounts). A probe in the rig reads `[data-turn-mark-count]`-style
 * facts off the DOM: how many marks are mounted against how many turns, and the
 * region's `scrollHeight` at the top, middle and bottom.
 */
const LONG_TURNS = 60;
const LONG_RECORDS: TranscriptRecord[] = Array.from(
	{ length: LONG_TURNS },
	(_, turn) => [
		user(
			`lu${turn}`,
			`Question ${turn + 1}: what did the retry budget become?`,
		),
		assistant(
			`la${turn}`,
			`Answer ${turn + 1}: it moved into the gateway client and is read from one constant per route, so a route cannot carry a second copy.`,
		),
	],
).flat();
const LONG_TRANSCRIPT = transcriptOf(LONG_RECORDS);

const LongPane = ({
	size,
	agentId,
}: {
	size: AgentAvatarSize;
	/** `null` draws no marks at all: the control for the mark's own cost. */
	agentId?: string | null;
}) => {
	// The window is read once per transcript mount; state it before the mount.
	try {
		window.localStorage.setItem("canonicalTranscriptDomWindow", "on");
	} catch {
		// A host without storage draws the full DOM; the probe then reports it.
	}
	/*
	 * THE STEP IS STATED DURING RENDER, NOT IN AN EFFECT: the app persists it long
	 * before a conversation mounts, so a transcript's FIRST render already reads
	 * the reader's step. An effect would render the first frame at the previous
	 * step and carry its measured heights into the estimates, a drift no session
	 * can produce.
	 */
	useUiPreferencesStore.setState({ agentAvatarSize: size });
	useLayoutEffect(
		() => () => useUiPreferencesStore.setState({ agentAvatarSize: "small" }),
		[],
	);
	return (
		<PicturePane
			frame={`long-${size}`}
			width={1024}
			agentId={agentId}
			transcript={LONG_TRANSCRIPT}
			height={560}
		/>
	);
};

export const LongWindowedSmall: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<LongPane size="small" />
		</div>
	),
};
export const LongWindowedLarge: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<LongPane size="large" />
		</div>
	),
};
/** The control: the same long transcript at the large step with NO marks drawn. */
export const LongWindowedLargeNoMarks: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<LongPane size="large" agentId={null} />
		</div>
	),
};

/**
 * THE OPERATOR'S CASE (2026-11-04): an agent turn that opens straight into tool
 * rows, the shape of most delegated sessions. Without a picture its first tool
 * row must sit directly under the user's turn, at the turn gap and nothing more;
 * with one, the picture's line sits between them. `data-frame` is the measure
 * hook for the y offset of the first tool row.
 */
const TOOL_FIRST = transcriptOf([
	user("tu1", "Run the checks on the avatar branch."),
	tool({
		id: "tt1",
		ts: TS + 500,
		toolName: "bash",
		args: { command: "pnpm check-types" },
	}),
	tool({
		id: "tt2",
		ts: TS + 600,
		toolName: "read",
		args: { path: "src/renderer/src/shared/agent-avatar/avatar-presence.ts" },
	}),
	assistant("ta1", "Types are clean and the presence table reads as intended."),
]);

export const ToolFirstNoPicture: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<PicturePane
				frame="tool-first-no-picture"
				width={720}
				agentId={BARE_AGENT_ID}
				transcript={TOOL_FIRST}
				height={320}
			/>
		</div>
	),
};

export const ToolFirstPicture: Story = {
	render: () => (
		<div className="bg-canvas p-6">
			<PicturePane
				frame="tool-first-picture"
				width={720}
				transcript={TOOL_FIRST}
				height={320}
			/>
		</div>
	),
};
