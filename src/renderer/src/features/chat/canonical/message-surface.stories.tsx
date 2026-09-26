/**
 * The user message block, on the working surface it is read against.
 *
 * WHY THIS SET EXISTS (operator report, 2026-09-26): "the contrast between the
 * user message background and the chat background is quite poor on some
 * themes, so we might want to just subtly adjust the contrast of the user
 * message backgrounds so that it can properly stand out on various light and
 * dark themes." The block's fill IS its boundary (D10's amendment, §L), so the
 * only thing that makes it stand out is its step against the `canvas` column -
 * and this story is the surface that step is judged on: one user turn and one
 * short reply on the column's own ground, at the same 1024px pane the
 * user-card-measure set uses, so a reviewer compares the block against the
 * real neighbour rather than against a mock frame.
 *
 * The evidence pair is `docs/evidence/chat-canonical-message-surface/` (this
 * head) against `...-before/` (the shared `surface` fill, captured from the
 * pre-change tree). The four themes are chosen from the audit's extremes
 * rather than taste: `sage` 2.05 and `catppuccinMacchiato` 2.08 are the two
 * worst steps off the canvas in the fleet, `mintLight` is a light theme the
 * change moves only at the margin, and `radient` is the widest step of all
 * (6.76 ΔE00) and is NOT moved - so the pair shows both that the floor moves
 * what fails it and that it leaves what already clears it alone.
 *
 * No `play` function: both rows are settling-free resting states, and the
 * evidence rig takes them.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const TS = 1_760_000_000_000;

/** A settled, complete agent answer with no stop reason - the ordinary case. */
const answer = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: TS + 1_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});

/** A transcript state holding one row, as `chat-content.tsx` hands one over. */
const transcriptOf = (records: TranscriptRecord[]): TranscriptState =>
	({
		records,
		index: new Map(records.map((entry, position) => [entry.id, position])),
	}) as TranscriptState;

/**
 * One user turn and one reply.
 *
 * The user text is deliberately the majority shape - a few paragraphs of
 * prose, no quote and no attachment - because the fill's step is what this set
 * photographs, and a card widened by a quote or a capture would add width
 * claims that belong to the user-card-measure set instead.
 */
const TURN: TranscriptRecord[] = [
	{
		kind: "user",
		id: "u1",
		ts: TS,
		text: [
			"Morning - here is where the import stands before you pick it up.",
			"",
			"The March file loaded cleanly except for one row, which is failing on a `not null` column that the source system still writes as empty rather than absent. I left the table half written so you can see the row that stopped it, and I did not retry, because a retry would have appended the four hundred rows behind it a second time.",
		].join("\n"),
		images: [],
	},
	answer(
		"a1",
		"Thanks - I will read the half-written table first, then answer the row question from what the source actually sends.",
	),
];

/**
 * The transcript pane in a fixed 1024x`height` frame, on `bg-canvas`.
 *
 * Pinned in PIXELS for the same reason the user-card-measure frames are: the
 * claim is about the block's step against the column at the pane this app
 * reads in, and a story rendered in a wider or narrower preview would be
 * photographing a different case than the one written down.
 */
const Frame = ({
	records,
	height = 560,
}: {
	records: TranscriptRecord[];
	height?: number;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col bg-canvas" style={{ width: 1024, height }}>
			<div className="flex min-h-0 grow flex-col px-4 pt-4">
				<CanonicalTranscript
					transcript={transcriptOf(records)}
					frontend={null}
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
	title: "Chat/Canonical message surface",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The block on the working surface, beside the reply it is read with. */
export const UserTurn: Story = {
	render: () => <Frame records={TURN} />,
};
