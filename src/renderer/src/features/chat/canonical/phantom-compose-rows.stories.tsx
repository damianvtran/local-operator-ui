/**
 * The phantom compose rows: the operator's report, photographed through the
 * production reducer.
 *
 * WHAT WAS ON SCREEN. Switching into a conversation waiting on several
 * subagents showed, at the BOTTOM of the transcript, a stack of highlight rows
 * reading `hub composing 2.0 KB`, `wait composing 82 B`, `wait composing 77 B`,
 * `wait composing 87 B` — stuck for the whole multi-hour `wait`, on top of the
 * one `wait` call that was genuinely in flight. They were not in that
 * conversation's loaded history at all: their durable rows are hours older than
 * the snapshot's 100-row window.
 *
 * WHY THEY WERE THERE. All four frames in the fixture carry `not_run_reason` —
 * the harness's terminal verdict that the call will never run (`Invalid
 * arguments: …`) — and deliberately no `tool_execution_start`/`_end`, because
 * the API server pairs tool records by id and a synthetic start would claim the
 * tool ran. The TUI and the phone both read that verdict and settle the row with
 * it (`ToolCard.mark_not_run`, `projection.py`); this transport read only the id,
 * the name and the byte count, painted `composing`, and had nothing that could
 * ever settle it. The seed's placement rule then put each of them at the
 * viewer's own arrival, which is why they landed under the newest message.
 *
 * WHY BOTH STATES COME FROM ONE TREE. A pair captured from two checkouts cannot
 * be re-taken once the base moves on, so `Before` here spells out the pre-fix
 * PROJECTION — the record the pre-fix `tool_call_compose` arm built for every
 * frame it was handed: `phase: "composing"`, the frame's byte count, no clock,
 * placed at the reader's arrival. That arm read only the id, the name and the
 * byte count, so this is exactly what it painted these four frames as. `After`
 * folds the same frames through the shipped reducer. Both are one tree's bytes,
 * and the story says so where the images live.
 *
 * THE FIXTURE IS THE REAL SESSION, and its `note` says exactly which parts are
 * verbatim (`scripts/fixtures/phantom-compose-rows.json`): the four never-run
 * frames and the in-flight start are copied from the read-only snapshot of
 * `8f8660fb8e64`; the page is a minimal reconstruction of that snapshot's
 * history-window tail, and one real durable `Invalid arguments` tool row is
 * re-dated into it so the settle-in-place case is on screen.
 *
 * WHY THE PANE'S HEIGHT IS PINNED. A transcript story with no fixed height lets
 * the capture grow the viewport to the document, which photographs a state no
 * reader can be in. `PANE` is the transcript's measured reader height, so the
 * frames are what a reader is looking at and the captions are true of the bytes.
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
	type TranscriptRecord,
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

/**
 * The PRE-FIX projection, spelled out.
 *
 * Reproduced here rather than reached through the shipped reducer, because the
 * behaviour it describes no longer exists on this tree — which is what makes a
 * before/after pair from one tree possible. The pre-fix `tool_call_compose` arm
 * read only `tool_call_id`, `tool_name` and `argument_bytes`, and wrote a
 * `composing` row for every frame, whenever it was handed one; frames that are
 * not compose frames are folded the ordinary way, so the running `wait` row in
 * the pane is the real one, painted the real way.
 *
 * The reader's arrival is the clock for every row this creates, which is the
 * other half of the pre-fix `applyLiveSeed`: for a frame that stated no time of
 * its own, the arrival was the only instant it had.
 */
const beforeFix = (
	frames: LiveEvent[],
	state = withPage(),
): TranscriptState => {
	let next = state;
	for (const frame of frames) {
		if (frame.type !== "tool_call_compose") {
			next = applyEvent(next, frame, ARRIVAL_MS);
			continue;
		}
		const id = `tool:${String(frame.tool_call_id)}`;
		const record: TranscriptRecord = {
			kind: "tool",
			id,
			ts: ARRIVAL_MS,
			toolCallId: String(frame.tool_call_id),
			toolName: String(frame.tool_name ?? ""),
			intent: (frame.intent as string | null) ?? null,
			args: null,
			phase: "composing",
			argumentBytes: Number(frame.argument_bytes ?? 0),
			output: null,
			isError: false,
			durationS: null,
			startedAt: null,
			images: [],
			added: 0,
			removed: 0,
			diff: null,
			stopped: false,
			notRunReason: null,
		};
		const at = next.records.findIndex((candidate) => candidate.id === id);
		const records = next.records.slice();
		if (at >= 0) records[at] = record;
		else records.push(record);
		next = {
			...next,
			records,
			index: new Map(
				records.map((candidate, position) => [candidate.id, position]),
			),
		};
	}
	return next;
};

/** The snapshot's own three fields: the only ones the fold reads. */
const frontendOf = (frames: LiveEvent[]): CanonicalFrontendState =>
	({
		streaming: true,
		generation: Number(FIXTURE.seed.generation),
		live_events: frames,
	}) as unknown as CanonicalFrontendState;

/** The shipped fold: a turn in flight, the snapshot's other two fields real. */
const afterFix = (frames: LiveEvent[], state = withPage()): TranscriptState =>
	applyLiveSeed(state, frontendOf(frames), ARRIVAL_MS);

/**
 * The row the verdict has to settle, as the announcement left it.
 *
 * Built by folding the announcement frame itself, because that is the only way a
 * row in this state can exist: a durable page can never carry a composing row,
 * so the case has to be reached by replaying the turn's own frames in order.
 */
const ANNOUNCEMENT = {
	type: "tool_call_compose",
	tool_call_id: SEED[0].tool_call_id,
	tool_name: "hub",
	argument_bytes: 1900,
	dictation_complete: false,
	not_run_reason: null,
};
const VERDICT = SEED[0];
const announced = (): TranscriptState =>
	applyEvent(withPage(), ANNOUNCEMENT, ARRIVAL_MS - 30_000);

/** The queued pair's own row: announced, then told the dictation is over. */
const QUEUED_ANNOUNCEMENT = {
	...QUEUED,
	argument_bytes: 40,
	dictation_complete: false,
};
const queuedAnnounced = (): TranscriptState =>
	applyEvent(EMPTY_TRANSCRIPT, QUEUED_ANNOUNCEMENT, ARRIVAL_MS - 30_000);

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
 * The report itself: the real seed, folded the way the shipped code did.
 *
 * The pane is a reader's, so the four never-run calls are the newest rows on
 * screen — painted as live calls, under a conversation whose answer is above
 * them, at the viewer's own arrival.
 */
export const BeforeArrival: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="Before: the real snapshot's seed folded at the reader's arrival. The four never-run calls are painted as live `composing` rows at the bottom of a pane whose real rows are hours old."
			transcript={beforeFix(SEED)}
		/>
	),
};

/**
 * The same page, the same seed, the shipped fold.
 *
 * The four verdicts are refused — the call is over, they state no time, and
 * their durable rows are the authority — so the pane ends on the one `wait` that
 * really is running, placed at the instant the producer stamped for it.
 */
export const AfterArrival: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After: the same page, the same seed and the same pane. The four never-run frames are refused, so the only live row is the `wait` call that is genuinely in flight."
			transcript={afterFix(SEED)}
		/>
	),
};

/** A verdict folding onto an announcement still on screen: pre-fix, it stays live. */
export const BeforeSettled: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="Before, with the call's own announcement already painted: the verdict folds onto it and the row goes on saying `composing`, with nothing that could ever settle it."
			transcript={beforeFix([VERDICT], announced())}
		/>
	),
};

/** The same two frames, shipped: the row settles IN PLACE under the harness's reason. */
export const AfterSettled: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After: the same row, settled in place by the verdict — `never sent · 2.0 KB composed`, no clock, and it is the same row rather than a second one."
			transcript={applyLiveSeed(announced(), frontendOf([VERDICT]), ARRIVAL_MS)}
		/>
	),
};

/** The same settled row opened, so the harness's own words are on the frame. */
export const AfterSettledOpen: Story = {
	render: () => (
		<Frame
			waiting={true}
			openRows={true}
			caption="After, the settled row opened: the harness's own verdict, in a `Not run` body — a never-run call reported as what it is, rather than as a failure it never had."
			transcript={applyLiveSeed(announced(), frontendOf([VERDICT]), ARRIVAL_MS)}
		/>
	),
};

/** The dictation ending: pre-fix the row keeps claiming the model is writing. */
export const BeforeQueued: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="Before, on the dictation ending: the model stopped writing and the call waits for its turn, while the row and the working line both go on saying `composing`."
			transcript={beforeFix([QUEUED], queuedAnnounced())}
		/>
	),
};

/** The same frame shipped: `queued · 109 B`, and the band says `waiting to run`. */
export const AfterQueued: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="After: the same call, saying `queued · 109 B` — the size it really reached — with the working line naming what is happening: waiting to run a call."
			transcript={applyLiveSeed(
				queuedAnnounced(),
				frontendOf([QUEUED]),
				ARRIVAL_MS,
			)}
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
