/**
 * Interrupted calls, told apart from failures: the operator's report and the
 * fix, as pixels.
 *
 * WHY THIS IS A STORY BESIDE THE TESTS. `transcript-reducer.test.mjs` asserts
 * the classification (which record fields move) and `tool-compose-lifecycle.
 * test.mjs` the compose endings. The report was about what a reader SEES: a
 * steering skip expanded to `Error / Tool call skipped: interrupted by
 * steering.`, and the live row said `never ran` in danger ink beside the turn's
 * own stopped line - the ledger's loudest ink, blaming either the agent or the
 * user for a decision no tool ever met. Whether that reads as "interrupted" on
 * the row is a question only a frame answers.
 *
 * WHAT EACH FRAME IS. Five states, each folded through the SHIPPED reducer
 * (`applyEvent` / `applyHistoryPage` / `applyLiveSeed`) over the fixtures in
 * `scripts/fixtures/interrupted-rows.json`, so what is judged is the production
 * `CanonicalTranscript` reading the production classification - not a hand-set
 * outcome prop:
 *
 * - `skip-live`: the steering skip as a live turn's terminal compose frame
 *   settles it (`not_run_kind: "skipped"`), the announcement still on screen.
 * - `skip-durable`: the same call AFTER A RELOAD. A durable page cannot carry a
 *   composing row, so this is the shape it really has: the loop's synthetic
 *   result (`details.__fault: "skipped"`, `is_error: true`), opened, so the
 *   expansion's own label is on the frame.
 * - `stop-mid-flight`: a call the user's stop killed, from the end event's own
 *   fault marker (`details.__fault: "aborted"`) with no client stop window
 *   standing - the reading a second viewer, a replay, or a fresh attach gets,
 *   which the client-side stop fact cannot reach.
 * - `genuine-failure`: the CONTROL - a call that really ran and failed
 *   (`details.__fault: "execution"`), which must keep its danger row and its
 *   `Error` label in both halves.
 * - `turn-counts`: the counters. Three calls fold into one run and close a
 *   turn, so one frame carries the collapsed group's chip and the turn's foot:
 *   `1 failed` before, and not-failed after - neither predicate is written in
 *   the view; both read `isError`, which the fix clears (verified, not
 *   re-implemented).
 *
 * WHY THE `before` FRAMES ARE NOT HERE. They are these same states rendered by
 * the BASE tree at `origin/main`, captured separately into
 * `docs/evidence/chat-interrupted-rows-before/` and declared as a supplementary
 * set with its own source (a detached worktree at the base commit, this story
 * file copied in, its title temporarily suffixed `before`). A "before" built in
 * this tree would photograph the fix.
 *
 * WHY THE PANE'S HEIGHT IS PINNED. A transcript story with no fixed height lets
 * the capture grow the viewport to the document, which photographs a state no
 * reader can be in. `PANE` is the same measured column the phantom-rows set
 * uses, so the two sets read side by side.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import fixtureJson from "../../../../../../scripts/fixtures/interrupted-rows.json";
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
	baseTs: number;
	pages: {
		turnCounts: { entries: Entry[] };
		plain: { entries: Entry[] };
		skipOnly: { entries: Entry[] };
		failureOnly: { entries: Entry[] };
	};
	skip: { live: { announcement: LiveEvent; verdict: LiveEvent } };
	stop: { announcement: LiveEvent; start: LiveEvent; end: LiveEvent };
};

const TURN_COUNTS_PAGE = FIXTURE.pages.turnCounts.entries;
const PLAIN_PAGE = FIXTURE.pages.plain.entries;
const SKIP_PAGE = FIXTURE.pages.skipOnly.entries;
const FAILURE_PAGE = FIXTURE.pages.failureOnly.entries;
const SKIP_ANNOUNCEMENT = FIXTURE.skip.live.announcement;
const SKIP_VERDICT = FIXTURE.skip.live.verdict;
const STOP_ANNOUNCEMENT = FIXTURE.stop.announcement;
const STOP_START = FIXTURE.stop.start;
const STOP_END = FIXTURE.stop.end;

/**
 * The reader's arrival: an hour after the page's last row, so every live frame
 * here is unambiguously LATER than the history it sits on.
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

/** The snapshot's own three fields: the only ones the fold reads. */
const frontendOf = (frames: LiveEvent[]): CanonicalFrontendState =>
	({
		streaming: true,
		generation: 1,
		live_events: frames,
	}) as unknown as CanonicalFrontendState;

/** The steering skip, live: announced, then settled in place by its verdict. */
const skipLive = (): TranscriptState =>
	applyLiveSeed(
		applyEvent(withPage(PLAIN_PAGE), SKIP_ANNOUNCEMENT, ARRIVAL_MS - 30_000),
		frontendOf([SKIP_VERDICT]),
		ARRIVAL_MS,
	);

/** The user's stop, live: announced, started, then killed by the end frame. */
const stopMidFlight = (): TranscriptState => {
	let state = withPage(PLAIN_PAGE);
	state = applyEvent(state, STOP_ANNOUNCEMENT, ARRIVAL_MS - 120_000);
	state = applyEvent(state, STOP_START, ARRIVAL_MS - 119_000);
	return applyEvent(state, STOP_END, ARRIVAL_MS - 30_000);
};

const Frame = ({
	transcript,
	caption,
	waiting,
	openRows,
	smallView = false,
}: {
	transcript: TranscriptState;
	caption: string;
	waiting: boolean;
	/** Click every row open, the way a reader reaches a row's body. */
	openRows?: boolean;
	/** The pane's narrow / small-view layout (design round 1, D3). */
	smallView?: boolean;
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
					isSmallView={smallView}
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
	title: "Chat/Interrupted rows",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The steering skip, live: the verdict settles the row its announcement left.
 *
 * Before this change the row reads `never ran` in danger ink - the same
 * treatment a real failure takes - and there is no glyph. After it, the row is
 * the interrupted class: the hueless slashed circle, no danger word, and the
 * summary keeps the harness's own record of how far the model got
 * (`never sent · 2.0 KB composed`).
 */
export const SkipLive: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="The steering skip, live: the verdict (`Tool call skipped: interrupted by steering.`) settles the announced row in place. Before: `never ran` in danger ink. After: the interrupted mark, and no failure word."
			transcript={skipLive()}
		/>
	),
};

/**
 * The same call after a reload: the durable row, opened.
 *
 * A durable page never carries a composing row, so the reload half is the
 * loop's synthetic result - `is_error: true` with `details.__fault:
 * "skipped"` - and this frame opens it, because the label on the expansion is
 * half the report: `Error` before, over the reason in danger ink;
 * `Interrupted` after, over the same words.
 */
export const SkipDurable: Story = {
	render: () => (
		<Frame
			waiting={false}
			openRows={true}
			caption="The same skip after a reload: the durable row, opened. Before: `failed` beside an `Error` expansion. After: interrupted, and the harness's own words under `Interrupted`."
			transcript={withPage(SKIP_PAGE)}
		/>
	),
};

/**
 * The user's stop, mid-flight: the end event's own abort marker.
 *
 * No client stop window stands here on purpose - this is the reading a replay,
 * a second viewer or a fresh attach gets, where the end frame is the only
 * statement that the call was killed rather than broken. Before the change the
 * wire's `__fault: "aborted"` is invisible and the genuine `is_error` paints
 * `failed`; after it the marker classifies the row as interrupted and keeps the
 * duration the backend measured.
 */
export const StopMidFlight: Story = {
	render: () => (
		<Frame
			waiting={true}
			caption="A call killed by the user's stop, from the end frame's own abort marker (no client stop window): the wire fact alone classifies the row."
			transcript={stopMidFlight()}
		/>
	),
};

/**
 * The control: a call that really ran and failed.
 *
 * `details.__fault: "execution"` is a tool's own failure, so this row must keep
 * the danger ground, the `failed` word, and the `Error` label in BOTH halves.
 * A change that moved this row would have flattened the distinction it exists
 * to draw.
 */
export const GenuineFailure: Story = {
	render: () => (
		<Frame
			waiting={false}
			openRows={true}
			caption="The control: a call that ran and failed (an `execution` fault). It keeps its danger row and its `Error` label - unchanged in both halves."
			transcript={withPage(FAILURE_PAGE)}
		/>
	),
};

/**
 * The counters, on one frame: a folded run's chip and the turn's foot.
 *
 * Three calls (one of them the steering skip) fold into one run and the turn
 * closes on the answer, so the collapsed group's chip and the foot line both
 * count the skip. Both predicates read `isError` and nothing else - the fix
 * clears it, and the counts move with it; that is the verification, not a
 * second rule.
 */
export const TurnCounts: Story = {
	render: () => (
		<Frame
			waiting={false}
			caption="One turn, three calls (the first is the steering skip), folded: the group chip and the foot both count `1 failed` before, and neither does after."
			transcript={withPage(TURN_COUNTS_PAGE)}
		/>
	),
};

/**
 * The steering skip, live, EXPANDED - the other half of the operator's report.
 *
 * The report's row was opened when the reader hit it: before this change the
 * body reads `Not run` in DANGER ink with the reason in danger ink, on a call
 * whose only fault was being redirected. After it, the interrupted kinds label
 * the body `Interrupted` in the neutral label ink (the word the row's own
 * sr-only announcement and the TUI use) with the harness's reason in ordinary
 * ink - while the genuine never-run faults keep the danger `Not run` (the
 * control is `genuine-failure`, whose expansion is a result, not a verdict).
 */
export const SkipLiveExpanded: Story = {
	render: () => (
		<Frame
			waiting={true}
			openRows={true}
			caption="The live steering skip, opened: before `Not run` in danger ink; after `Interrupted` in the muted label ink, the reason in ordinary ink."
			transcript={skipLive()}
		/>
	),
};

/**
 * A call the user's stop killed, opened - the same body fix on the wire path.
 *
 * The end frame's own `aborted` marker classifies the row (no client stop
 * window stands), and its body follows the same rule as the live skip's: the
 * label names the state rather than claiming an `Output` that never existed.
 */
export const StopExpanded: Story = {
	render: () => (
		<Frame
			waiting={true}
			openRows={true}
			caption="The wire-marked stop, opened: the body is labelled `Interrupted` (before: `Not run`/none - the row was `failed`), and the measured span is kept."
			transcript={stopMidFlight()}
		/>
	),
};

/**
 * The durable skip at the pane's narrow / small-view width, COLLAPSED (D3).
 *
 * The states matrix wants the minimum supported width for the claims in this
 * set; the classification is layout-independent, so this pair is coverage
 * rather than a new claim - the row's mark and its summary at 720px.
 */
export const SkipDurableNarrow: Story = {
	render: () => (
		<Frame
			waiting={false}
			smallView={true}
			caption="The durable skip at the pane's narrow width (720px), collapsed: the interrupted mark and the summary survive the small-view layout."
			transcript={withPage(SKIP_PAGE)}
		/>
	),
};

/** The same narrow state, opened: the body label at the small-view width. */
export const SkipDurableNarrowExpanded: Story = {
	render: () => (
		<Frame
			waiting={false}
			smallView={true}
			openRows={true}
			caption="The durable skip at the pane's narrow width, opened: the `Interrupted` body label at the small-view width."
			transcript={withPage(SKIP_PAGE)}
		/>
	),
};
