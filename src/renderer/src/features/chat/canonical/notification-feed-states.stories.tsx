/**
 * The three states a click can paint before the owner answers: a cached paint,
 * nothing at all, and a conversation that is not on this machine.
 *
 * These exist because each is a state the app must not mis-state, and each is
 * judged by looking at it:
 *
 * - The **cached paint** (`stale`) is rows this window showed before, with one
 *   caption in the transcript's own status slot. The rows stay at full `ink` —
 *   a cached row is a real row, and opacity is banned as a state signal — so the
 *   only thing separating it from live is the sentence, and whether that reads
 *   as "behind" or as "broken" is a judgement no assertion makes.
 * - The **skeleton** is what a first-ever open shows. It must not be the
 *   EMPTY-CONVERSATION state, which asserts something false about a conversation
 *   that may have a thousand messages in it.
 * - The **vanished session** is the click's deleted-row case, reached without a
 *   validating round trip. It carries house wording and the way out, and the
 *   composer below it refuses input.
 *
 * The stories render the production `CanonicalTranscript`, so they judge what
 * ships. Read them at a narrow width too: the caption sits in the same slot as
 * `Reconnecting`, and the sentence is longer than that word.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		oldestId: records[0]?.id ?? null,
		hasMore: false,
		argsByCall: new Map(),
	} as TranscriptState;
}

const user = (id: string, text: string): TranscriptRecord => ({
	kind: "user",
	id,
	ts: 1_760_000_000_000,
	text,
	images: [],
});

const assistant = (id: string, text: string): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: 1_760_000_000_000,
	text,
	streaming: false,
	complete: true,
	stopReason: null,
	error: false,
});

const CACHED_ROWS: TranscriptRecord[] = [
	user("u1", "Rebuild the forecast with the Q3 actuals."),
	assistant(
		"a1",
		"Reconciled the variance against the month-end close and rebuilt the forecast. The three rows below the fold are the ones that moved.",
	),
	assistant(
		"a2",
		"Q3 came in 4.1% above plan on the enterprise line, almost entirely from the two renewals that landed in the last week of the quarter.",
	),
	user("u2", "What does that do to the year?"),
	assistant(
		"a3",
		"It carries the year to 103.2% of plan. The thing to watch is the services line, which is flat and is not going to make it up.",
	),
];

function Panel({
	records,
	stale,
	missing,
	status,
}: {
	records: TranscriptRecord[];
	stale?: boolean;
	missing?: boolean;
	status: "connecting" | "live" | "unavailable";
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex h-[560px] flex-col bg-canvas">
			<CanonicalTranscript
				transcript={transcriptOf(records)}
				gate={null}
				waiting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status={status}
				error={null}
				stale={stale}
				missing={missing}
			/>
		</div>
	);
}

const meta: Meta = {
	title: "Chat/Notification feed states",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The click's fast path: rows this window already had, one sentence saying they
 * may be behind, and every row at full ink.
 */
export const CachedPaint: Story = {
	render: () => <Panel records={CACHED_ROWS} stale status="connecting" />,
};

/** The same conversation once the owner's snapshot has landed: caption gone. */
export const Reconciled: Story = {
	render: () => <Panel records={CACHED_ROWS} status="live" />,
};

/**
 * A conversation this window has never shown: three shapes and the label, and
 * explicitly not the empty-conversation state.
 */
export const LoadingFirstOpen: Story = {
	render: () => <Panel records={[]} status="connecting" />,
};

/**
 * A click for a conversation that no longer exists. Nothing to paint, house
 * wording, and the way out — never the transport's own refusal text.
 */
export const ConversationGone: Story = {
	render: () => <Panel records={[]} missing status="unavailable" />,
};

/**
 * Both states a click can arrive in, side by side, so the difference between
 * "behind" and "gone" is visible in one frame rather than inferred.
 */
export const TheTwoMisses: Story = {
	render: () => (
		<div className="grid grid-cols-2">
			<div className="bg-canvas">
				<Panel records={[]} status="connecting" />
			</div>
			{/* `hairline`, not a panel fill: this is a divider between two states
			    and carries no information of its own. */}
			<div className="border-hairline border-l bg-canvas">
				<Panel records={[]} missing status="unavailable" />
			</div>
		</div>
	),
};

/** The caption at the narrow end of the supported range. */
export const CachedPaintNarrow: Story = {
	render: () => (
		<div className="w-[380px] bg-canvas">
			<Panel records={CACHED_ROWS} stale status="connecting" />
		</div>
	),
};
