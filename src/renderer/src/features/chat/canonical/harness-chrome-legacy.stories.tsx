/**
 * Legacy goal-continuation chrome: the pre-marker rows, told apart from the
 * user's own words, as pixels.
 *
 * WHY THIS IS A STORY BESIDE THE TESTS. `transcript-reducer.test.mjs` pins the
 * recogniser (hidden on both arms, near-misses painted); what the operator
 * reported was what a READER SEES - a stored transcript in which the harness's
 * own "Continue working toward this goal: ..." row sat in the conversation as
 * if the person had typed it. Whether the fix reads as "that row was never
 * mine" is a question only a frame answers, and the PANE below is the reader's
 * own column.
 *
 * WHAT EACH FRAME IS. Three states, each folded through the SHIPPED reducer
 * (`applyHistoryPage` / `applyEvent`) over
 * `scripts/fixtures/harness-chrome-legacy.json`, so what is judged is the
 * production `CanonicalTranscript` reading the production fold - not a
 * hand-set record:
 *
 * - `stored-transcript`: the operator's exact case. A durable page carries the
 *   continuation row with NO `harness_injected` marker (it predates the
 *   stamp), between the person's ask and the answer it drove. Before: the row
 *   paints as the user's own message. After: it is gone; the ask and the
 *   answer stand.
 * - `live-arrival`: the same unstamped row arriving as a live `message_start`
 *   from an owner on an older build, folded over a reloaded page.
 * - `typed-near-miss`: the CONTROL - a message the PERSON typed that OPENS
 *   with the continuation's head but does not close with its tail. It must
 *   keep painting in both halves; a fix that hid it would be eating the
 *   person's words to hide the harness's.
 *
 * WHY THE `before` FRAMES ARE NOT HERE. They are these same states rendered by
 * the BASE tree (`origin/main`), captured separately into
 * `docs/evidence/chat-harness-chrome-legacy-before/` and declared as a
 * supplementary set with its own source (a throwaway checkout at the base
 * commit, this story file copied in with its title suffixed `before`). A
 * "before" built in this tree would photograph the fix.
 *
 * WHY THE PANE'S HEIGHT IS PINNED. A transcript story with no fixed height
 * lets the capture grow the viewport to the document, which photographs a
 * state no reader can be in. `PANE` is the same measured 685px column the
 * interrupted-rows set uses, so the two sets read side by side.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import fixtureJson from "../../../../../../scripts/fixtures/harness-chrome-legacy.json";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptState,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

type Entry = DesktopHistoryPage["entries"][number];
/** The reducer's own live-frame shape: a `type` and whatever the frame carries. */
type LiveEvent = { type: string; [key: string]: unknown };

const FIXTURE = fixtureJson as unknown as {
	baseTs: number;
	pages: {
		stored: { entries: Entry[] };
		plain: { entries: Entry[] };
		nearMiss: { entries: Entry[] };
	};
	live: { continuation: LiveEvent };
};

const STORED_PAGE = FIXTURE.pages.stored.entries;
const PLAIN_PAGE = FIXTURE.pages.plain.entries;
const NEAR_MISS_PAGE = FIXTURE.pages.nearMiss.entries;
const LIVE_CONTINUATION = FIXTURE.live.continuation;

/**
 * The reader's arrival: an hour after the page's last row, so the live frame
 * is unambiguously LATER than the history it sits on (the same offset the
 * interrupted-rows set uses).
 */
const ARRIVAL_MS = (FIXTURE.baseTs + 3_600) * 1000;

/** The transcript pane's own height, in pixels: a reader's 685px column. */
const PANE = 685;

const pageOf = (entries: Entry[]): DesktopHistoryPage => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

const withPage = (entries: Entry[]): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(entries));

/**
 * The unstamped continuation, arriving live: an older owner sends it, so there
 * is no marker and the fallback recogniser is what decides it.
 */
const liveArrival = (): TranscriptState =>
	applyEvent(withPage(PLAIN_PAGE), LIVE_CONTINUATION, ARRIVAL_MS);

const Frame = ({
	transcript,
	caption,
	waiting,
	openRows,
}: {
	transcript: TranscriptState;
	caption: string;
	waiting: boolean;
	/** Click every row open, the way a reader reaches a row's body. */
	openRows?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!openRows) return;
		const triggers = Array.from(
			containerRef.current?.querySelectorAll<HTMLButtonElement>(
				'button[aria-expanded="false"]',
			) ?? [],
		);
		for (const trigger of triggers) trigger.click();
	}, [openRows]);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			{/* A fixed caption box, so the conversation does not move between the
			    frames of a pair: their captions are different lengths, and a
			    free-height paragraph would shift the transcript by a line. */}
			<p className="h-10 text-body-sm text-ink-muted">{caption}</p>
			{/* The reader's own pane, pinned: see `PANE`. The transcript's scroller
			    is `flex-col-reverse`, so a fixed-height box with no scroller of its
			    own is what lands the reader at the BOTTOM, on the newest rows. */}
			<div
				className="flex min-h-0 flex-col"
				style={{ height: PANE }}
				ref={containerRef}
			>
				<CanonicalTranscript
					transcript={transcript}
					gate={null}
					waiting={waiting}
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
	title: "Chat/Harness chrome legacy",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The operator's case: a stored transcript whose continuation row predates the
 * marker.
 *
 * The row has no `provider_payload` at all, so the marker cannot decide it -
 * only the text recogniser can. Before this change the row paints as the
 * user's own message, between the ask and the answer; after it, the exchange
 * reads as what it was: one ask, one answer.
 */
export const StoredTranscript: Story = {
	render: () => (
		<Frame
			waiting={false}
			openRows={true}
			caption="A stored transcript that predates the marker, the turn opened the way a reader reaches it: the harness's goal-continuation row sits among the person's own words. Before: it paints as the user's message. After: it is gone and the exchange stands."
			transcript={withPage(STORED_PAGE)}
		/>
	),
};

/**
 * The same chrome arriving live from an owner on an older build.
 *
 * The live wire is the second half of the report's surface: an older owner
 * still sends these rows, and this one carries no marker either, so the same
 * fallback has to hold on `message_start` as it does on the durable page.
 */
export const LiveArrival: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="The same unstamped row arriving live from an owner on an older build (a `message_start` with no marker), folded over a reloaded page. Before: painted under the page. After: suppressed."
			transcript={liveArrival()}
		/>
	),
};

/**
 * The control: a message the PERSON typed that opens with the head.
 *
 * `Continue working toward this goal:` is a sentence a person can write (it is
 * the head of the harness's prompt, and nothing more). This message never
 * closes with the tail, so it is the user's own words and must keep painting
 * in both halves - the near-miss the recogniser is not allowed to eat.
 */
export const TypedNearMiss: Story = {
	render: () => (
		<Frame
			waiting={false}
			openRows={true}
			caption="The control: a message the PERSON typed that opens with the continuation's head (`Continue working toward this goal:`) but never closes with its tail, in the opened turn. It must keep painting in both halves."
			transcript={withPage(NEAR_MISS_PAGE)}
		/>
	),
};
