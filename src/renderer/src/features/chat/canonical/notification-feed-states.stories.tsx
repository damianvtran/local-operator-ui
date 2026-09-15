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

/**
 * A conversation long enough that the cache's caption is at issue.
 *
 * WHY THIS ONE EXISTS (design review round 1, D1). The caption was the first
 * child of the measured content box inside a bottom-anchored `flex-col-reverse`
 * scroller, which put it at the visual top of the content — measured on a
 * 36-row stale transcript at 1280x600, its rect was top -2028 in a 560px pane.
 * The committed `cached-paint` story has five rows and FITS, so the frame that
 * was supposed to show the affordance could not show that it was unreachable,
 * and the state was indistinguishable from a live one.
 *
 * The cache is only ever written for a conversation this pane has already
 * painted, so a cached paint is a conversation at least a screen tall: this is
 * the ordinary case, not an edge.
 */
const OVERFLOWING_ROWS: TranscriptRecord[] = Array.from(
	{ length: 18 },
	(_, index) => [
		user(`ou${String(index)}`, `Turn ${String(index + 1)}: adjust the model.`),
		assistant(
			`oa${String(index)}`,
			`Turn ${String(index + 1)} done. Reconciled the variance, rebuilt the driver table and re-ran the close. The enterprise line moved 4.1%, the services line stayed flat, and the two renewals from the last week of the quarter are the whole of the delta.`,
		),
	],
).flat();

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
	/** SIZED TO THE CONTENT for the two sparse states — see `ConversationGone`. */
	height = "h-[560px]",
}: {
	records: TranscriptRecord[];
	stale?: boolean;
	missing?: boolean;
	status: "connecting" | "live" | "unavailable";
	height?: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className={`flex flex-col bg-canvas ${height}`}>
			<CanonicalTranscript
				transcript={transcriptOf(records)}
				/*
				 * The reader's question, not the transport's: a cached paint or a
				 * vanished conversation both arrive BEFORE any authoritative page, and
				 * the pane's hold/statement rules read this rather than `status`.
				 */
				hydrated={false}
				gate={null}
				waiting={false}
				/*
				 * No send is admitted in any of these states, and that is the fixtures'
				 * choice rather than a default: `admittedSend` is the pane's own "I took a
				 * message and nothing has answered it", and a click-path frame is about
				 * what the pane paints BEFORE the owner answers, not about a turn the
				 * reader just started. Passing `true` here would put the wait line in
				 * every frame and photograph a different state.
				 */
				starting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status={status}
				failure={null}
				onReconnect={() => undefined}
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
 *
 * SIZED TO ITS CONTENT rather than to a window, for the reason the repo's other
 * sparse stories are: this state is three lines and a button, and in a 600px
 * frame it is 99.45% one colour — which `check-evidence` rejects, correctly, as
 * "the story painted its ground and nothing else". The height here is the
 * content's, so the frame is a picture of the state rather than of the ground.
 */
export const ConversationGone: Story = {
	render: () => (
		<Panel height="h-[200px]" records={[]} missing status="unavailable" />
	),
};

/**
 * Both states a click can arrive in, side by side, so the difference between
 * "behind" and "gone" is visible in one frame rather than inferred.
 */
export const TheTwoMisses: Story = {
	render: () => (
		<div className="grid grid-cols-2">
			<div className="bg-canvas">
				<Panel height="h-[200px]" records={[]} status="connecting" />
			</div>
			{/* `hairline`, not a panel fill: this is a divider between two states
			    and carries no information of its own. */}
			<div className="border-hairline border-l bg-canvas">
				<Panel height="h-[200px]" records={[]} missing status="unavailable" />
			</div>
		</div>
	),
};

/**
 * The caption on a transcript taller than the pane — the state the caption
 * exists for, and the one the first capture pass could not reach (D1). The
 * sentence must be on screen in the FIRST frame, with the rows it qualifies
 * below it and at full ink.
 */
export const CachedPaintOverflow: Story = {
	render: () => <Panel records={OVERFLOWING_ROWS} stale status="connecting" />,
};

/**
 * The same "not on this machine" state, reached the way a CLICK reaches it:
 * with this window's cached rows already in the live view.
 *
 * The committed `conversation-gone` story renders `records={[]}` — the other
 * half of the path. The 404 keeps the seeded rows, and with the history slot
 * and the footer timestamp ungated that painted "Start of conversation" above
 * "This conversation is no longer on this machine." plus a bare date floating
 * bottom-right (D2). This frame is the half that could show it.
 */
export const ConversationGoneWithPaint: Story = {
	render: () => (
		<Panel
			height="h-[260px]"
			records={CACHED_ROWS.slice(0, 2)}
			missing
			status="unavailable"
		/>
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
