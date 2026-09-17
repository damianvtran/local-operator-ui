/**
 * The phantom compose rows, shipped: the operator's report and what the fix
 * does with it.
 *
 * WHY THIS IS A STORY BESIDE THE TEST. `scripts/tool-compose-lifecycle.test.mjs`
 * asserts ids, phases and placement. The report was about PIXELS — four rows
 * reading `hub composing 2.0 KB`, `wait composing 82 B`, `wait composing 77 B`,
 * `wait composing 87 B`, stuck for the whole multi-hour `wait`, under a
 * conversation whose real rows are hours old — and a frame is also the only
 * thing that shows a reader what the row SAYS now.
 *
 * WHY THE `before` FRAMES ARE NOT HERE. They are the same states rendered by the
 * BASE tree, captured separately into `docs/evidence/chat-phantom-compose-rows/
 * before/` and declared as a supplementary set with its own source: a "before"
 * built in this tree would photograph the fix, which is exactly what the first
 * pass of this story did (it folded the real frames through the shipped reducer
 * and got `never sent` in both halves). `phantom-compose-rows-before.stories.tsx`
 * is the file that produces them, and `README.md` in the evidence set carries
 * the recipe. That file is deliberately NOT in the capture `STORIES` table:
 * running it here would render THIS tree's reducer under a `before` name.
 *
 * WHAT THE STATES ARE.
 *
 * The frames in the fixture are the reported ones, copied verbatim from the
 * read-only snapshot of session `8f8660fb8e64` (`/v1/desktop/sessions/
 * 8f8660fb8e64`, captured 1789652393): four never-run calls — all carrying
 * `not_run_reason` (`Invalid arguments: …`) and `dictation_complete`, and
 * deliberately no `tool_execution_start`/`_end`, because the API server pairs
 * tool records by id and a synthetic start would claim the tool ran — plus the
 * one `wait` call that was genuinely running. The fixture's own `note` says
 * which parts are verbatim and which are constructions.
 *
 * WHY THE PANE'S HEIGHT IS PINNED. A transcript story with no fixed height lets
 * the capture grow the viewport to the document, which photographs a state no
 * reader can be in. `PANE` is the transcript's measured clientHeight in a
 * 1380x900 window, so the frames are what a reader is looking at and the
 * captions are true of the bytes.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
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
	pageWithTwin: { entries: Entry[] };
	seed: { generation: string; liveEvents: LiveEvent[] };
	queuedSeed: { generation: string; liveEvents: LiveEvent[] };
};

const PAGE = FIXTURE.page.entries;
const TWIN_PAGE = FIXTURE.pageWithTwin.entries;
const SEED = FIXTURE.seed.liveEvents;
const QUEUED = FIXTURE.queuedSeed.liveEvents[0];

/** The reader's arrival: three hours after the conversation's last durable row. */
const LAST_TS = FIXTURE.historyWindow.lastTs;
const ARRIVAL_MS = Math.round((LAST_TS + 3 * 3600) * 1000);

/** The transcript pane's own height, in pixels: a reader's 685px column. */
const PANE = 685;

const pageOf = (entries: Entry[]): DesktopHistoryPage => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

const withPage = (entries: Entry[] = PAGE): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(entries));

/** The snapshot's own three fields: the only ones the fold reads. */
const frontendOf = (frames: LiveEvent[]): CanonicalFrontendState =>
	({
		streaming: true,
		generation: Number(FIXTURE.seed.generation),
		live_events: frames,
	}) as unknown as CanonicalFrontendState;

/** The shipped fold, a turn in flight: the hook's own call. */
const afterFix = (frames: LiveEvent[], state = withPage()): TranscriptState =>
	applyLiveSeed(state, frontendOf(frames), ARRIVAL_MS);

/**
 * The row the verdict has to settle, as the announcement left it.
 *
 * Built by folding the announcement frame itself, because that is the only way a
 * row in this state can exist: a durable page can never carry a composing row,
 * so the case has to be reached by replaying the turn's own frames in order.
 */
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
/** The same call with an EMPTY payload: a parked call that composed nothing. */
const EMPTY_VERDICT: LiveEvent = { ...VERDICT, argument_bytes: 0 };

const announced = (frame: LiveEvent = ANNOUNCEMENT): TranscriptState =>
	applyEvent(withPage(), frame, ARRIVAL_MS - 30_000);

/** The queued pair's own row: announced, then told the dictation is over. */
const QUEUED_ANNOUNCEMENT: LiveEvent = {
	...QUEUED,
	argument_bytes: 40,
	dictation_complete: false,
};
const queuedAnnounced = (): TranscriptState =>
	applyEvent(EMPTY_TRANSCRIPT, QUEUED_ANNOUNCEMENT, ARRIVAL_MS - 30_000);

/** A verdict folded onto the row its own announcement left, settled in place. */
const settled = (verdict: LiveEvent = VERDICT): TranscriptState =>
	applyLiveSeed(announced(), frontendOf([verdict]), ARRIVAL_MS);

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
	title: "Chat/Phantom compose rows",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The reported state, folded by the shipped reducer.
 *
 * The four verdicts are refused — their call is over, they state no time, and
 * their durable rows are the authority — so the pane ends on the one `wait` that
 * really is running, placed at the instant the producer stamped for it.
 */
export const AfterArrival: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After: the real snapshot's seed folded at the reader's arrival. The four never-run frames are refused, so the only live row is the `wait` call that is genuinely in flight."
			transcript={afterFix(SEED)}
		/>
	),
};

/** A verdict settling the row its own announcement left. */
export const AfterSettled: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After: the announcement's own row, settled in place by the verdict — `never sent · 2.0 KB composed`, no clock, and it is the same row rather than a second one."
			transcript={settled()}
		/>
	),
};

/** The same settled row opened, so the harness's own words are on the frame. */
export const AfterSettledOpen: Story = {
	render: () => (
		<Frame
			waiting={true}
			openRows={true}
			caption="After, the settled row opened: the harness's own verdict under a `Not run` label, scrolling sideways like a result body rather than reflowing."
			transcript={settled()}
		/>
	),
};

/**
 * A parked call that composed NOTHING, which the summary names rather than
 * measuring.
 *
 * The payload is empty when the call was refused before any argument was
 * written — an unknown tool is the case the contract's docstring names — and
 * `never sent · 0 B composed` would claim a measurement nobody made.
 */
export const AfterSettledEmpty: Story = {
	render: () => (
		<Frame
			waiting={true}
			openRows={true}
			caption="After, a never-run call whose payload is empty and which has no row yet: `never sent · nothing composed` names the absence instead of measuring it."
			transcript={applyEvent(withPage(), EMPTY_VERDICT, ARRIVAL_MS)}
		/>
	),
};

/**
 * The same settled row at a narrow column.
 *
 * The summary grew eleven characters with this change (`composing · N B` to
 * `never sent · N B composed`), so what the row does under width pressure is part
 * of what the fix has to show: the name and the summary hold the line and the
 * summary ellipsises, keeping `never sent` — the word the reader needs — and
 * shedding the byte count's tail. Captured at 420px for that reason, and the
 * caption states the ellipsis rather than claiming a shed the row does not do.
 */
export const AfterSettledNarrow: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After, the settled row at a 420px column: the summary is ellipsised, and the word it keeps first is `never sent`."
			transcript={settled()}
		/>
	),
};

/** The dictation ending, as the row and the working line state it. */
export const AfterQueued: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After, the dictation ending: the call waits to run, the row says `queued · 109 B`, and the band says `waiting to run a call` with NO clock — the dictation clock ended and nothing else has begun."
			transcript={applyLiveSeed(
				queuedAnnounced(),
				frontendOf([QUEUED]),
				ARRIVAL_MS,
			)}
		/>
	),
};

/**
 * The same frame SEEDED, with no row on screen to settle.
 *
 * This is the sibling ending of the reported shape: a frame whose dictation is
 * over, arriving with no row for it, used to create one at the reader's own
 * arrival — a banded `queued` row claiming the call was announced NOW. It is
 * refused for the same reason the verdict is: nothing here states when it
 * happened, and the call's own start or its durable row will say.
 */
export const AfterQueuedSeeded: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After, a seeded frame whose dictation is over and which has no row on screen: refused as well, so nothing claims the reader's arrival as the call's time."
			transcript={afterFix([QUEUED])}
		/>
	),
};

/**
 * The THIRD ending: the turn died while the call was still being dictated.
 *
 * No verdict arrives for this — the harness only leaves one for a call it
 * refused — and the row used to take the generic turn-end settlement, which on a
 * clean end paints a SUCCESS tick on a call no tool ever received. It now takes
 * the TUI's compose record (`never sent · N composed`) with the interrupt's own
 * state, which is what `ToolCard.mark_interrupted` does for a card that was
 * still composing.
 */
export const AfterTurnDeath: Story = {
	render: () => (
		<Frame
			waiting={false}
			caption="After, the turn ending on a call still being dictated: `never sent · 1.9 KB composed`, no clock, no duration, and the interrupt's own glyph — not the tick a clean end used to paint."
			transcript={applyEvent(announced(), TURN_END, ARRIVAL_MS)}
		/>
	),
};

/** The durable-twin case: a settled row is not walked back to `composing`. */
export const AfterDurableTwin: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After, with the call's durable result row loaded: a settled row has outgrown the announcement, so the verdict leaves it exactly as the transcript recorded it."
			transcript={afterFix(SEED, withPage(TWIN_PAGE))}
		/>
	),
};

/**
 * The same row opened.
 *
 * The durable row is the harness's record of a call it DID send and that came
 * back an error, so it wears the failure treatment — the `Error` body a real
 * failed call has. The `not-run` label belongs to the live path only, where the
 * call reached no tool at all, and this frame is what keeps the two apart on
 * screen.
 */
export const AfterDurableTwinOpen: Story = {
	render: () => (
		<Frame
			waiting={true}
			openRows={true}
			caption="After, the same durable row opened: it wears the failure treatment a real failed call has, because that is what the transcript recorded — the `Not run` label is the live path's."
			transcript={afterFix(SEED, withPage(TWIN_PAGE))}
		/>
	),
};
