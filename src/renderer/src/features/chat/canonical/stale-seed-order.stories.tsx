/**
 * A FINISHED conversation with the runtime's own stale seed folded into it: the
 * operator's report, photographed through the production reducer.
 *
 * WHY THIS IS A STORY BESIDE THE TEST. `scripts/seed-placement.test.mjs` asserts
 * ids and order. The report was about PIXELS — a wall of `wait`/`hub`/`task`/
 * `bash` rows from the previous morning painted under the final assistant
 * message — and a frame is also the only thing that shows the SEAM: the answer's
 * own row and whatever sits beneath it, in one still.
 *
 * WHY BOTH ORDERS COME FROM ONE TREE. The design round produced its pair from
 * two trees, the PR base and the PR head, which photographs the fix but can
 * never be re-captured once the base moves on. Both orders here are built by the
 * SHIPPED reducer from the same real fixture, and the only difference between
 * them is HOW the seed is folded:
 *
 *   - `Before` runs the pre-fix fold spelled out — `applyEvent` once per seed
 *     event at the reader's arrival clock, which is literally what the pre-fix
 *     `applyLiveSeed` did (a loop over `live_events`), with nothing in the
 *     reducer refusing anything.
 *   - `After` calls `applyLiveSeed` the way the hook calls it, with the
 *     snapshot's own `streaming: false`, so a frame that would CREATE a row and
 *     states no time of its own is refused.
 *
 * THE FIXTURE IS THE REAL SESSION: the page is the newest 100 journal lines the
 * app reads through `history_cursor`, the seed is the 100 `tool_execution_end`
 * rows the runtime retains for that eight-hour turn (67 of which the page cannot
 * label), and `older` is the tail behind the page. See
 * `scripts/seed-placement.test.mjs`'s header for the derivation and every
 * transform applied to the journal.
 *
 * The `Seam` pair narrows the seed to the newest twelve calls the page cannot
 * label. The unreduced seed's 67 appended rows overflow the transcript's own
 * render window, which pushes the answer out of the pane entirely, so the
 * narrowed pair is the device that puts the answer and what sits under it in one
 * frame. `Arrival` is the unreduced, real seed.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import fixtureJson from "../../../../../../scripts/fixtures/stale-seed-order.json";
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

/** The journal, as `scripts/fixtures/stale-seed-order.json` carries it. */
const FIXTURE = fixtureJson as unknown as {
	page: { entries: Entry[] };
	older: { entries: Entry[] };
	seed: { generation: string; live_events: LiveEvent[] };
};

const PAGE = FIXTURE.page.entries;
const SEED = FIXTURE.seed.live_events as LiveEvent[];

/**
 * The reader's arrival: three hours after the conversation's last durable row.
 *
 * A fixed offset rather than `Date.now()`, because the arrival stamp is the one
 * thing these frames are ABOUT (every pre-fix seeded row carries it, and the
 * pane's own timestamp is the symptom the operator photographed as `3:56 PM`),
 * so it must not move between captures. The real run's arrival was ~1 h after
 * the final message; the offset only has to be far enough that the difference is
 * legible on the frame.
 */
const LAST_TS = PAGE.at(-1)?.ts ?? 0;
const ARRIVAL_MS = Math.round((LAST_TS + 3 * 3600) * 1000);

/** The calls the durable page never names: every row the seed injects is theirs. */
const UNLABELLED = (() => {
	const labelled = new Set(
		PAGE.flatMap((entry) =>
			((entry.payload?.tool_calls ?? []) as { id: string }[]).map(
				(call) => call.id,
			),
		),
	);
	return SEED.map((event) => String(event.tool_call_id)).filter(
		(callId) => !labelled.has(callId),
	);
})();

/** The newest twelve unlabelled calls: enough to fill a seam, not a pane. */
const SEAM_CALLS = new Set(UNLABELLED.slice(-12));
const SEAM_SEED = SEED.filter((event) =>
	SEAM_CALLS.has(String(event.tool_call_id)),
);

const pageOf = (entries: Entry[]): DesktopHistoryPage => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

/** The durable page, read through the cursor the snapshot published. */
const withPage = (): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(PAGE));

/**
 * The pre-fix fold, spelled out: `applyEvent` per seed event at the arrival.
 *
 * Kept as its own function rather than reconstructed from `applyLiveSeed`,
 * because the state it produces is the one that no longer exists in the shipped
 * code — which is exactly what makes the pair on one tree possible, and what the
 * `Before` frames are evidence about.
 */
const beforeFix = (seed: LiveEvent[], state = withPage()): TranscriptState => {
	let next = state;
	for (const event of seed) next = applyEvent(next, event, ARRIVAL_MS);
	return next;
};

/**
 * The snapshot's own three fields, which are the only ones the fold reads
 * (`streaming`, `generation`, `live_events`). A story has no wire frame to hand
 * it, and building the other twenty-six fields would be apparatus rather than
 * evidence — so the cast is stated here, once, rather than hidden in the calls.
 */
const frontendOf = (seed: LiveEvent[]): CanonicalFrontendState =>
	({
		streaming: false,
		generation: Number(FIXTURE.seed.generation),
		live_events: seed,
	}) as unknown as CanonicalFrontendState;

/** The shipped fold: the snapshot's own `streaming: false` for a finished turn. */
const afterFix = (seed: LiveEvent[], state = withPage()): TranscriptState =>
	applyLiveSeed(state, frontendOf(seed), ARRIVAL_MS);

/**
 * The transcript as the reader sees it, captioned with what the frame is.
 *
 * The caption is apparatus, `text-ink-muted` for the reason the other transcript
 * stories' captions are: it describes the frame rather than being part of the
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
		// No fixed height: the frame is sized to its content, which is how the
		// capture sizes its viewport too. A box taller than the rows would put a
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
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					// A static transcript of a conversation that has been read: no
					// page is owed, and there is no session handle to re-arm, so
					// this handler is unreachable rather than a working stand-in.
					awaitingHydration={false}
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Stale seed order",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The report itself: the real seed, folded the way the shipped code did. */
export const BeforeArrival: Story = {
	render: () => (
		<Frame
			caption="Before: the finished conversation with the runtime's real seed folded in at the reader's arrival. The stale ledger rows are the newest rows in the pane, so the answer is not in it at all."
			transcript={beforeFix(SEED)}
		/>
	),
};

/** The same page, the same real seed, the shipped fold: the answer is the tail. */
export const AfterArrival: Story = {
	render: () => (
		<Frame
			caption="After: the same conversation and the same seed. The seed cannot label a row the page never named, so nothing is painted under the final message — the conversation ends where the conversation ended."
			transcript={afterFix(SEED)}
		/>
	),
};

/** The seam, pre-fix: the answer, and twelve stale calls under it as `3:56 PM`. */
export const BeforeSeam: Story = {
	render: () => (
		<Frame
			caption="Before, narrowed to the newest twelve calls the page cannot label: the answer, then the stale ledger rows painted under it, carrying the reader's own arrival as their time."
			transcript={beforeFix(SEAM_SEED)}
		/>
	),
};

/** The seam, post-fix: the same twelve rows refused, so the answer ends the pane. */
export const AfterSeam: Story = {
	render: () => (
		<Frame
			caption="After, the same twelve rows: refused, not greyed and not captioned. The pane ends at the answer's own timestamp, and the calls return as durable rows when the client's reconcile read reaches them."
			transcript={afterFix(SEAM_SEED)}
		/>
	),
};
