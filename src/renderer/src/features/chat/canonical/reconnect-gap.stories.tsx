/**
 * The transcript after a reader returns from another conversation: the rows
 * that were written while they were away, before and after the reconcile that
 * fetches them.
 *
 * WHY THIS IS A STORY BESIDE THE TEST. `scripts/reconnect-page-gap.test.mjs`
 * asserts which ids are in the transcript; a frame is the only thing that shows
 * the SEAM. The fix merges a snapshot's page with a durable tail, and the
 * failure mode a merge can introduce lives at that join — a duplicated row, a
 * row out of order, a row painted under the wrong neighbour — none of which an
 * id-set assertion would catch.
 *
 * Both transcripts below are built by the PRODUCTION reducer from wire-shaped
 * frames, the way `tool-row.stories.tsx` builds its rows, so the two frames
 * differ by the fix's own effect and nothing else:
 *
 *   - `Gap` is the transcript the client ended up with: the snapshot's page
 *     (which stops at the steering row, because the page is read through the
 *     cursor the steer refreshed) plus the live seed. The two rows written
 *     between the steer and the return are absent, so the conversation jumps
 *     from the steer straight to the live tail.
 *   - `Restored` is the same transcript plus the durable tail the reconcile
 *     now reads back: the absent rows are present, once each, in order.
 *
 * The backend cannot close this on its own: the in-flight conversation's own
 * rows are simply not durable yet, so no cursor or page bound can carry them —
 * which is why this guard ships on the client.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

/** One instant for every row, so the frames are byte-reproducible. */
const TS = 1_760_000_000_000;

/** A durable entry as the backend's `exclude_defaults` encoder writes one. */
const entry = (
	id: string,
	ts: number,
	payload: Record<string, unknown>,
): DesktopHistoryPage["entries"][number] => ({
	id,
	ts,
	type: "message",
	payload,
});

const user = (id: string, ts: number, text: string) =>
	entry(id, ts, { kind: "message", role: "user", content: [{ text }] });

const assistant = (
	id: string,
	ts: number,
	text: string,
	calls: {
		id: string;
		name: string;
		arguments: Record<string, unknown>;
	}[] = [],
) =>
	entry(id, ts, {
		kind: "message",
		role: "assistant",
		content: [{ text }],
		stop_reason: calls.length ? "toolUse" : "stop",
		// The arguments live on the ASSISTANT row, never on the tool result:
		// `applyHistoryPage` carries them across pages through `argsByCall`, and
		// a story that put them on the tool row would paint a transcript the
		// backend cannot produce.
		...(calls.length ? { tool_calls: calls } : {}),
	});

const tool = (
	id: string,
	ts: number,
	callId: string,
	toolName: string,
	output: string,
) =>
	entry(id, ts, {
		kind: "message",
		role: "tool",
		tool_call_id: callId,
		tool_name: toolName,
		content: [{ text: output }],
		provider_payload: { duration_s: 0.42 },
	});

/* The conversation, in the order it happened. */
const CONVERSATION = [
	user("m1", 1_760_000_000, "Check the retry path in the desktop transport."),
	assistant("m2", 1_760_000_001, "Reading the transport now.", [
		{
			id: "call-read",
			name: "read",
			arguments: { path: "src/main/desktop-transport.ts" },
		},
	]),
	tool("m3", 1_760_000_002, "call-read", "read", "…the reconnect handling…"),
	// The steering message. Its own row is durable, and the cursor the steer
	// refresh published is what bounds the snapshot's page.
	user(
		"m4",
		1_760_000_003,
		"Also check what happens when the socket drops mid-turn.",
	),
	// Written while the reader was on another conversation.
	assistant("m5", 1_760_000_004, "Checking the reconnect path as well.", [
		{
			id: "call-grep",
			name: "grep",
			arguments: { pattern: "after_seq", path: "src/main" },
		},
	]),
	tool("m6", 1_760_000_005, "call-grep", "grep", "desktop-transport.ts:412"),
];

const PAGE = CONVERSATION.slice(0, 4);
const ABSENT = CONVERSATION.slice(4);

/** The in-flight turn's seed: the row that arrives after the return. */
const LIVE = {
	type: "message_update",
	message: {
		id: "m7",
		role: "assistant",
		content: [{ type: "text", text: "The reconnect path retries once with " }],
	},
	delta: "the retained receipt cursor.",
};

const pageOf = (
	entries: DesktopHistoryPage["entries"],
): DesktopHistoryPage => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

/*
 * The same two steps the flush loop takes, in the same order: the snapshot's
 * durable page first (so an older replay can never regress newer painted
 * text), then the in-flight seed's events. The seed's own loop IS
 * `applyEvent` per event — `applyLiveSeed` only adds the generation carry,
 * which paints no row — so the frame is the shipped path without needing a
 * whole frontend state to exist.
 */
const transcriptOf = (
	entries: DesktopHistoryPage["entries"],
): TranscriptState =>
	applyEvent(applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(entries)), LIVE, TS);

/**
 * The transcript as the reader sees it, captioned with what is missing.
 *
 * The caption is apparatus, `text-ink-muted` for the reason the older-history
 * slot's captions are: it describes the frame rather than being part of the
 * surface under test.
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
		// No fixed height: the frame is sized to its content, which is also how
		// the capture sizes its viewport. A taller box than the rows would put a
		// majority-ground frame in the set, and `check-evidence`'s uniformity
		// ceiling exists because a frame that is 99% one colour is not a picture
		// of the app however correct the pixels in the middle are.
		<div className="flex flex-col gap-2 bg-canvas p-6">
			<p className="text-body-sm text-ink-muted">{caption}</p>
			<div className="min-h-0 flex-1 overflow-y-auto" ref={containerRef}>
				<CanonicalTranscript
					transcript={transcript}
					gate={null}
					waiting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					error={null}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Reconnect gap",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The gap: the page's last row is the steer, and the live tail follows it. */
export const Gap: Story = {
	render: () => (
		<Frame
			caption="Before: the snapshot's page ends at the steering row. The assistant and tool rows written while the reader was on another conversation are absent, so the transcript jumps straight to the live tail."
			transcript={transcriptOf(PAGE)}
		/>
	),
};

/** The same transcript once the reconcile has merged the durable tail. */
export const Restored: Story = {
	render: () => (
		<Frame
			caption="After: the durable tail is merged in, so the rows between the steer and the return are present — once each, in order, with their labels."
			transcript={transcriptOf([...PAGE, ...ABSENT])}
		/>
	),
};
