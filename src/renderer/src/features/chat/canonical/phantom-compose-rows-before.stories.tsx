/**
 * The SAME states, rendered by the BASE tree: the "before" half of the pair.
 *
 * THIS FILE'S FRAMES ARE NOT CAPTURED FROM THIS TREE. Run as it stands here it
 * renders the shipped reducer, which settles every one of these frames — so its
 * frames would photograph the fix under a `before` name, which is exactly the
 * mistake this file exists to remove (the first pass of the shipped story folded
 * the real frames through the shipped reducer and got `never sent` in both
 * halves; agent review round 1 caught it by running the real pre-fix reducer
 * over the same fixture).
 *
 * THE RECIPE, and `docs/evidence/chat-phantom-compose-rows/README.md` repeats
 * it: check out the base commit in its own worktree, copy this file and
 * `scripts/fixtures/phantom-compose-rows.json` into it, serve that worktree's
 * Storybook, and
 *
 *     node scripts/capture-evidence.mjs <origin> \
 *       --only=chat-phantom-compose-rows-before \
 *       --themes=localOperatorDark,localOperatorLight --allow-backend
 *
 * then move the four leaf directories under `chat-phantom-compose-rows/before/`
 * and declare that directory as a supplementary set (its `source` says which
 * commit's code produced them). It is deliberately NOT in the capture `STORIES`
 * table: an entry there would make a sweep re-take these frames from this tree.
 *
 * WHAT IT RENDERS, and why the base tree is the only honest source: this tree's
 * `tool_call_compose` arm read only the id, the name and the byte count, so a
 * frame whose dictation was over — a verdict or a finished dictation — was
 * painted as a live `composing` row, and `applyLiveSeed` placed every clockless
 * frame that would create a row at the reader's own arrival.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import fixtureJson from "../../../../../../scripts/fixtures/phantom-compose-rows.json";
import type {
	CanonicalFrontendState,
	DesktopHistoryPage,
} from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
	applyLiveSeed,
} from "./transcript-reducer";

type Entry = DesktopHistoryPage["entries"][number];
/** The reducer's own live-frame shape: a `type` and whatever the frame carries. */
type LiveEvent = { type: string; [key: string]: unknown };

const FIXTURE = fixtureJson as unknown as {
	historyWindow: { lastTs: number };
	page: { entries: Entry[] };
	seed: { generation: string; liveEvents: LiveEvent[] };
	queuedSeed: { generation: string; liveEvents: LiveEvent[] };
};

const PAGE = FIXTURE.page.entries;
const SEED = FIXTURE.seed.liveEvents;
const QUEUED = FIXTURE.queuedSeed.liveEvents[0];
const LAST_TS = FIXTURE.historyWindow.lastTs;
const ARRIVAL_MS = Math.round((LAST_TS + 3 * 3600) * 1000);
const PANE = 685;

const withPage = (): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: PAGE,
		has_more: true,
		cursor_missing: false,
	});

const frontendOf = (frames: LiveEvent[]): CanonicalFrontendState =>
	({
		streaming: true,
		generation: Number(FIXTURE.seed.generation),
		live_events: frames,
	}) as unknown as CanonicalFrontendState;

/** This tree's own fold, unmodified: what the reader used to be handed. */
const beforeFix = (frames: LiveEvent[], state = withPage()): TranscriptState =>
	applyLiveSeed(state, frontendOf(frames), ARRIVAL_MS);

const ANNOUNCEMENT: LiveEvent = {
	type: "tool_call_compose",
	tool_call_id: SEED[0].tool_call_id,
	tool_name: "hub",
	argument_bytes: 1900,
	dictation_complete: false,
	not_run_reason: null,
};
const VERDICT = SEED[0];
/** The turn's own end, with no abort: the case that used to paint a tick. */
const TURN_END: LiveEvent = {
	type: "agent_end",
	generation: 1,
	aborted: false,
};
const QUEUED_ANNOUNCEMENT: LiveEvent = {
	...QUEUED,
	argument_bytes: 40,
	dictation_complete: false,
};

const Frame = ({
	transcript,
	caption,
}: {
	transcript: TranscriptState;
	caption: string;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			<p className="h-10 text-body-sm text-ink-muted">{caption}</p>
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE }}
				ref={containerRef}
			>
				<CanonicalTranscript
					transcript={transcript}
					gate={null}
					waiting={true}
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
	title: "Chat/Phantom compose rows before",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The report itself, as the base tree folded it. */
export const Arrival: Story = {
	render: () => (
		<Frame
			caption="Before: the real snapshot's seed folded at the reader's arrival. Four never-run calls are painted as live `composing` rows, under a conversation whose real rows are hours old."
			transcript={beforeFix(SEED)}
		/>
	),
};

/** A verdict folding onto the announcement still on screen. */
export const Settled: Story = {
	render: () => (
		<Frame
			caption="Before, with the call's own announcement already painted: the verdict folds onto it and the row goes on saying `composing`, with nothing that could ever settle it."
			transcript={applyEvent(
				applyEvent(withPage(), ANNOUNCEMENT, ARRIVAL_MS - 30_000),
				VERDICT,
				ARRIVAL_MS,
			)}
		/>
	),
};

/** The dictation ending folding onto the same row. */
export const Queued: Story = {
	render: () => (
		<Frame
			caption="Before, on the dictation ending: the model stopped writing and the call waits for its turn, while the row and the working line both go on saying `composing`."
			transcript={applyEvent(
				applyEvent(EMPTY_TRANSCRIPT, QUEUED_ANNOUNCEMENT, ARRIVAL_MS - 30_000),
				QUEUED,
				ARRIVAL_MS,
			)}
		/>
	),
};

/** The same frame SEEDED, with no row on screen: the sibling of the report. */
export const QueuedSeeded: Story = {
	render: () => (
		<Frame
			caption="Before, a seeded frame whose dictation is over and which has no row on screen: a banded `composing` row is created at the reader's own arrival."
			transcript={beforeFix([QUEUED])}
		/>
	),
};

/**
 * The THIRD ending, which this tree had no state for either: a turn ending on a
 * call that was still being dictated.
 *
 * The generic turn-end settlement marks any non-`done` row settled, and this
 * tree's ladder then reads a row with no output, no duration and no stop as a
 * row that SUCCEEDED — a tick on a call no tool ever received. Nothing in the
 * frames argues with it: the harness emits no verdict for a call the turn killed.
 */
export const TurnDeath: Story = {
	render: () => (
		<Frame
			caption="Before, the turn ending on a call still being dictated: the row is marked settled, and with no output, no duration and no stop the ladder paints it as a success."
			transcript={applyEvent(
				applyEvent(withPage(), ANNOUNCEMENT, ARRIVAL_MS - 30_000),
				TURN_END,
				ARRIVAL_MS,
			)}
		/>
	),
};
