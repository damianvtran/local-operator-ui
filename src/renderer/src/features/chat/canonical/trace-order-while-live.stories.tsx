/**
 * A session read WHILE ITS TURN IS RUNNING, with the runtime's own `live_events`
 * seed folded in: the operator's report, photographed through the production
 * reducer.
 *
 * WHAT THE REPORT WAS. Opening "Optimize local session load times" (session
 * `c1c7072b735c`, its runtime mid-turn) painted a wall of extra `bash` rows
 * AFTER the in-flight row — the operator describes it as the running `wait` —
 * each showing a snippet of the tool's OUTPUT
 * where the command that ran belongs. The TUI, reading the same session, ends at
 * that row. The rows are the OPENING turn's eight calls, an hour and
 * several completed turns earlier — their previews are `efd48c10a fix(session):
 * charge the whole appends key and marker cost…` (record 8), `__pycache__` (9),
 * `./tests/unit/server/test_desktop_sessions.py` (12), `# Working on
 * local-operator` (13), `906 local_operator/server/routes/desktop_sessions.py`
 * (16), `__init__.py` (17), `"""Additive authenticated session API; legacy
 * per-turn chat stays unchanged."""` (20) and `Tool call skipped: interrupted by
 * steering.` (21). THE PREVIEWS ARE NOT UNIQUE STRINGS — three of the eight occur
 * more than once in the journal, `__pycache__` seven times — so the claim this
 * story rests on is the measured one instead: the page at that moment names
 * NONE of the eight (`reported.page_names_ghosts: []`), which is a fact about
 * the page rather than about how searchable a preview happens to be (QA round 1,
 * Q3).
 *
 * WHICH DOOR PAINTED THEM, settled with frames rather than with reasoning.
 * Three shipped paths could inject a row here, and the fixture carries the one
 * that did:
 *
 *   - `applyLiveSeed` (this story's subject) folds the snapshot's
 *     `frontend.snapshot.live_events` after the durable page. The captured
 *     snapshot really does carry these calls' shape: 102 frames, 100 of them
 *     `tool_execution_end` (the runtime's own `LIVE_EVENT_END_ROWS_MAX` cap), and
 *     59 of those 100 name a call the page cannot label — so 59 would CREATE a
 *     row. A `tool_execution_end` carries NO args (`tool_call_id`, `tool_name`,
 *     `result`, `duration_s`, `is_error` and nothing else), and `knownArgs` can
 *     only recover a command from a painted row or from `argsByCall`, which the
 *     durable assistant row fills. For a call whose assistant row the client
 *     never saw there is no command to show, so the row falls through to the
 *     output's first line — which is exactly the photographed symptom, and the
 *     reason the seed is the only door that can produce it.
 *   - the id-collision half of the same function is not it: these calls collide
 *     with nothing, because the page never names them at all (41 calls named, of
 *     the 102 frames' ids and the page's own).
 *   - `history_delta` is not it, on the wire's own evidence: a fresh subscription
 *     to this session (`GET …/events`, the load the report describes) serves
 *     `open`, `snapshot`, `frontend.update` and `event` frames and NO delta —
 *     the frame exists for a follower's reconnect gap, and a gap's rows are the
 *     RECENT ones between the painted frontier and the new cursor, never an
 *     hour-old turn's. A delta's rows are also durable rows, paired by
 *     `tool_call_id`, so those cards carry their commands; they cannot show an
 *     output where the arguments go.
 *
 * WHY THE SEED REACHES THESE CALLS AT ALL. `frontend_state._fold_live_event`
 * EMPTIES `live_events` on `agent_start`/`agent_end` — the RUN's boundaries, not
 * a turn's — so the seed of a run that has been going for an hour holds the
 * newest 100 settled calls of EVERY turn in it. Harvested at 13:45, that window
 * reached journal records 27..272: it names settled calls of completed turns an
 * hour before the in-flight one, and 100 ends is a cap, not a turn boundary.
 *
 * WHY THE EIGHT ARE NOT IN THE SEED ABOVE, AND WHY THE FRAME BELOW STILL SHOWS
 * NINE ROWS. They were when the operator looked, and the fixture proves the
 * mechanism rather than asserting it: the harvested seed reaches back only to
 * journal record 27 because the cap evicted the eight in the hour between the
 * report and the harvest, and the same cap is why the harvest injects 59 rows
 * where the report showed eight — the page is the newest 100 ENTRIES, the seed
 * keeps the newest 100 ENDS of the whole RUN, and the difference between the two
 * windows is what gets injected. So the reported moment is DERIVED: the harvest
 * walks the journal forward and takes the size at which the rule produces exactly
 * the eight calls the report proves (records 122..126, first 122). Its page comes
 * out of a truncated copy of the journal through the runtime's own reader, and
 * its seed is the frames the durable rows state for those calls — id, tool name,
 * `duration_s` and the result's own lines, which is everything a row paints from.
 * The frame beside it is therefore the operator's nine rows: the in-flight call
 * the page already names (so it is painted with its arguments — at that instant
 * a `bash`, `Finding engage timeouts`, minutes into its run) and the eight
 * injected `bash` calls under it. Worth stating plainly, because the report says
 * the pane ended at an in-flight `wait`: at records 121..126 the rule injects
 * exactly eight, and the call the turn was inside then is a `bash`; a pane whose
 * LAST row is a running `wait` is a later load of the same session, and by then
 * the same rule injects more than eight (`BeforeLive` is that state, an hour on).
 * One door, two moments — the count is the page/seed gap, never a constant.
 *
 * WHAT THE FRAME DOES NOT CLAIM. That the runtime still serves that seed at the
 * moment the operator clicked (it is his live session and was read, never
 * attached to); nothing about the durable ORDER of the real run, only about the
 * order the reducer derives from a real page and a real seed; nothing about a
 * runtime older than the snapshot. Where each row came from is stated as the
 * reducer decides it — `rows` under each frame is every record the fold stamped
 * with the reader's own arrival, which is the set of rows the seed created;
 * a row painted from the page keeps the durable `ts` its entry states. See
 * `scripts/harvest-trace-order-fixture.mjs` for every command and transform.
 *
 * WHY BOTH ORDERS COME FROM ONE TREE. The pair is the pre-fix fold and the shipped
 * one over the SAME fixture: `Before*` runs the pre-fix body spelled out (`beforeFix`
 * — every seed frame applied, nothing refused), because that state no longer
 * exists in the shipped code and is what these frames are evidence about, and
 * `After*` calls `applyLiveSeed` the way the hook calls it. A pair captured from
 * two trees photographs the fix but cannot be re-captured once the base moves;
 * this one can, and the only difference between the halves is HOW the seed is
 * folded — see the set's `README.md` for the capture command and the set's own
 * account of what each image is.
 *
 * WHY THE PANE'S HEIGHT IS PINNED. A transcript story with no fixed height lets
 * the capture grow its viewport to the document, so a still would show a state
 * no reader can be in: the reader's pane is 685px (the transcript's measured
 * `clientHeight` at 1380x900) and it is `flex-col-reverse`, so it sits at the
 * BOTTOM — on the injected rows, which is the complaint. `PANE` is that height,
 * so the frames are what a reader is looking at and the captions are true of the
 * bytes.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import "../../../styles/index.css";
import fixtureJson from "../../../../../../scripts/fixtures/trace-order.json";
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

/** The live turn's own call, as the harvested fixture carries it. */
type ReportedCall = {
	call_id: string;
	tool_name: string;
	intent: string | null;
	command: string;
	duration_s: number | null;
	is_error: boolean | null;
	output_first_line: string;
};

/** The session, as `scripts/fixtures/trace-order.json` carries it. */
const FIXTURE = fixtureJson as unknown as {
	session: { id: string; title: string; harvested_at: string };
	derivation: {
		streaming: boolean;
		seed_ends: number;
		unlabelled_ends: number;
		reach_back_records: [number, number] | null;
		evicted: string[];
	};
	page: { entries: Entry[] };
	seed: { streaming: boolean; generation: number; live_events: LiveEvent[] };
	reported: {
		through_record: number;
		record_window: [number, number];
		page: { entries: Entry[] };
		seed: { streaming: boolean; generation: number; live_events: LiveEvent[] };
		ghosts: string[];
		page_names_ghosts: string[];
		in_flight: LiveEvent | null;
	};
	report: ReportedCall[];
};

const PAGE = FIXTURE.page.entries;
const SEED = FIXTURE.seed.live_events;
const REPORTED = FIXTURE.reported;
const REPORTED_PAGE = REPORTED.page.entries;
const REPORTED_SEED = REPORTED.seed.live_events;

/**
 * The reader's arrival, in the reducer's milliseconds, per moment.
 *
 * A fixed offset from the in-flight call's own start rather than `Date.now()`:
 * every injected row carries this stamp and the frames are ABOUT it, so it must
 * not move between captures. The load landed a few seconds into the running call;
 * 40s is only far enough that the difference is legible.
 */
const arrivalOf = (frames: LiveEvent[]): number => {
	const start = frames.find((event) => event.type === "tool_execution_start");
	return Math.round(Number(start?.started_at_epoch ?? 0) * 1000) + 40_000;
};
const ARRIVAL_MS = arrivalOf(SEED);
const REPORTED_ARRIVAL_MS = arrivalOf(REPORTED_SEED);

/**
 * The transcript pane's own height, in pixels.
 *
 * 685 is the transcript's measured `clientHeight` in a 1380x900 window (the
 * design round's geometry), i.e. the height a reader actually reads at.
 */
const PANE = 685;

/**
 * The list box under the pane: eight ids, and one `… N more` line when the set
 * is longer than eight.
 *
 * DERIVED FROM WHAT IT PRINTS, and that is the point of the constant rather than
 * a `h-*` step: the box it replaces was `h-28` (112px) with the same
 * `overflow-hidden`, which fitted the header and five id lines and nothing else —
 * the FIFTH id runs into the box's own bottom border at 876, and the `… N more`
 * line never rendered at all, so the panel's header count and its list said
 * different things and the README claimed all eight ids were named (design round
 * 1, D2). WHICH LINE THE OLD BOX CUT was mis-stated as the sixth until round 2's
 * D2-3 re-measured the pre-delta frame: its bands are the header (777,787) plus
 * five id lines (797,808) (816,826) (832,843) (850,861) (868,877) against a box
 * ending at 876, so five are present, the fifth is the one on the border, and no
 * sixth line's ink exists anywhere. The row pitch is the one the committed
 * frames show (17px), and the terms are: 8px padding, the 17px header line, its
 * 4px `mb-1`, then `PANEL_IDS + 1` lines for the ids plus the `… more` line, then
 * 8px padding — 8 + 17 + 4 + 17 * 9 + 8 = 190, which puts the ninth line's
 * bottom edge exactly on the padding boundary and leaves NO slack rather than
 * "room to spare" (the value this note claimed until round 2's R2-1 read it
 * against the expression). The box is sized to what it prints and does not round
 * up; the numbers are re-measured off the pixels after every re-capture (see the
 * set's README).
 */
const PANEL_IDS = 8;
const PANEL = 8 + 17 + 4 + 17 * (PANEL_IDS + 1) + 8;

const pageOf = (entries: Entry[]): DesktopHistoryPage => ({
	entries,
	has_more: true,
	cursor_missing: false,
});

/** The durable page, read through the cursor the snapshot published. */
const withPage = (entries: Entry[] = PAGE): TranscriptState =>
	applyHistoryPage(EMPTY_TRANSCRIPT, pageOf(entries));

/**
 * The snapshot's own fields, cast to the ones the fold reads (`streaming`,
 * `generation`, `live_events`), with the moment's own `streaming`.
 *
 * The cast is stated once here rather than hidden in the calls: a story has no
 * wire frame to hand the fold, and building the other twenty-six fields would be
 * apparatus rather than evidence.
 */
const frontendOf = (
	seed: LiveEvent[],
	streaming: boolean,
): CanonicalFrontendState =>
	({
		streaming,
		generation: FIXTURE.seed.generation,
		live_events: seed,
	}) as unknown as CanonicalFrontendState;

/** The shipped fold, exactly as the hook calls it for an in-flight snapshot. */
const shipped = (
	seed: LiveEvent[],
	{
		entries = PAGE,
		streaming = FIXTURE.seed.streaming,
		arrival = ARRIVAL_MS,
	}: { entries?: Entry[]; streaming?: boolean; arrival?: number } = {},
): TranscriptState =>
	applyLiveSeed(withPage(entries), frontendOf(seed, streaming), arrival);

/**
 * The PRE-FIX fold, spelled out: every seed frame applied, nothing refused.
 *
 * Kept as its own function rather than reconstructed from `applyLiveSeed`, because
 * the state it produces no longer exists in the shipped code — which is what makes
 * a before/after pair possible on ONE tree, and what the `Before` frames are
 * evidence about. It is the pre-fix `applyLiveSeed` body: a loop over the seed's
 * frames, handing `applyEvent` the clock the frame itself states (`epochMs`) or
 * the reader's arrival. The pre-fix fold's closing `withTimeOrder` is spelled out
 * below and is load-bearing for these frames: this seed's LAST frame states a
 * clock, so the sort ran, and it is what puts the injected rows after the running
 * call rather than before it — the order the operator photographed (review round
 * 1, R2; fixed at 352a38f30).
 *
 * WHERE THIS MODEL IS NOT THE PRE-FIX BODY, SAID RATHER THAN LEFT TO BE FOUND
 * (review round 2, R2-3). The pre-fix body set its `placed` flag inside
 * `if (id !== null && !next.index.has(id))` and only when `seededClock` resolved a
 * clock — and `seededClock` answers from `epochMs` OR from `argsByCall.anchoredAt`,
 * the durable row that named the call. This model sets the flag on `started_at_epoch`
 * alone and without asking whether the frame CREATES a row, so it diverges in
 * exactly two cases: it sorts when a clocked frame's row was ALREADY painted (the
 * pre-fix body would not — `applyEvent` folds onto the painted row whatever the
 * clock), and it does NOT sort when a settled end's only clock is the durable row
 * naming it (the pre-fix body would). Neither moment these four frames render
 * reaches either case — review round 1's probe measured
 * `new beforeFix === shipped pre-fix body? true` on both, and design round 2's D1
 * re-measured `story beforeFix order === base pre-fix order? true` on the reported
 * moment — so no committed pixel depends on the difference. It is stated rather
 * than closed because closing it means exporting `seededClock`, `seededRecordId` and
 * `seededCallId` from the reducer or copying them here, and a second copy of the
 * placement rule that can drift from the reducer is the worse defect. Worth knowing
 * only to whoever reuses this model for another seed: run the first frame that
 * would CREATE a row and state a clock through the real predicate, not this one.
 */
const beforeFix = (
	seed: LiveEvent[],
	{
		entries = PAGE,
		arrival = ARRIVAL_MS,
	}: { entries?: Entry[]; arrival?: number } = {},
): TranscriptState => {
	let state = withPage(entries);
	let placed = false;
	for (const event of seed) {
		const stated = Number(event.started_at_epoch);
		if (stated > 0) placed = true;
		state = applyEvent(
			state,
			event,
			stated > 0 ? Math.round(stated * 1000) : arrival,
		);
	}
	/*
	 * The pre-fix fold's closing step, spelled out: once ANY frame stated a clock,
	 * the whole array is put in time order — a stable sort by `ts`, the rule the
	 * reducer shares with the durable page (`withTimeOrder`). It is load-bearing for
	 * these frames and not a detail: it is what puts a settled call's injected row
	 * UNDER the running call the report says it sat under, while without it the
	 * seed's own order (ends first, the in-flight start last) paints the running
	 * call at the bottom — the opposite of the photograph.
	 */
	if (!placed) return state;
	const records = state.records
		.map((record, position) => ({ record, position }))
		.sort((a, b) =>
			a.record.ts !== b.record.ts
				? a.record.ts - b.record.ts
				: a.position - b.position,
		)
		.map((entry) => entry.record);
	return {
		...state,
		records,
		index: new Map(records.map((record, at) => [record.id, at])),
	};
};

/**
 * Every record the fold stamped with the reader's own arrival.
 *
 * That stamp is the seed's signature: a row the PAGE paints keeps the durable
 * `ts` its entry states, and only `applyLiveSeed` hands a created row the
 * reader's clock. So this list IS the injected set, per rendered frame, and it
 * is printed under each one rather than left to a reader's inference.
 */
const injected = (transcript: TranscriptState, arrival: number): string[] =>
	transcript.records
		.filter((record) => record.ts === arrival)
		.map((record) => record.id);

/**
 * The transcript as the reader sees it, captioned with what the frame is.
 *
 * The caption is apparatus, `text-ink-muted` for the reason the other transcript
 * stories' captions are: it describes the frame rather than being part of the
 * surface under test.
 *
 * `waiting` IS THE APP'S OWN VALUE, NOT `false`. The app passes
 * `waiting={canonical.busy}` (`features/chat/components/chat-content.tsx`) and
 * that `busy` is `canonical.frontend?.streaming === true`, so a mid-turn pane
 * has it true — the same `streaming` that lets the fold create an arrival row at
 * all. Every moment in this set is a mid-turn state, so the fold and the Frame
 * are handed the SAME `seed.streaming` and cannot disagree. Hard-coding `false`
 * here photographed a mid-turn pane with the turn's own liveness element — the
 * working line, which `deriveWorkingLine` reaches only under `waiting` — deleted
 * (design round 1, D3).
 *
 * WHAT THE FOOTNOTE AND THE PANEL ARE FOR. A frame has to carry the facts a
 * reader of the BYTES cannot infer: the viewport it was taken in (AGENTS.md's
 * capture rule), and the cells that are a function of the wall clock — the
 * running row's elapsed figure and the working line's age beside it, which read
 * the SAME anchor (the call's own producer stamp, `working-line-model.ts`'s
 * all-or-nothing `startedAt` from PR #310) and count to the MACHINE's clock at
 * render. They move together between the two frames of a pair and between
 * captures of one commit, while every other cell reproduces (design round 1,
 * D6/D7; QA round 1, Q2) — and the same rule is what makes the two figures
 * AGREE, which design round 1's D3 found them not doing on the pre-#310 base,
 * where the line restarted at the reader's arrival. The panel under the pane is a
 * fixed box, so the pair overlays: it is sized for its header, its eight id lines
 * and the `… N more` line that can follow them, because at the 112px it shipped
 * with the FIFTH id ran into the box's own bottom border and the `… N more` line
 * never rendered at all (design round 1, D2; the measured bands are in `PANEL`'s
 * own note).
 */
const Frame = ({
	transcript,
	caption,
	rows,
	waiting,
}: {
	transcript: TranscriptState;
	caption: string;
	rows: string[];
	waiting: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	/** The ids the panel prints before it counts the rest. */
	const shown = rows.slice(0, PANEL_IDS);
	return (
		<div className="flex flex-col gap-2 bg-canvas p-6">
			{/*
			 * A FIXED caption box, two lines tall, so a pair overlays when a reviewer
			 * flips between the frames instead of moving with the wrapping.
			 */}
			<p className="h-10 text-body-sm text-ink-muted">{caption}</p>
			{/*
			 * The reader's own pane, pinned: see `PANE`. A wrapper that scrolled
			 * instead would park the inner scroller at its top, showing the oldest
			 * rows rather than the arrival.
			 */}
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
			{/*
			 * The injected set, named. A frame is evidence about WHICH rows are painted
			 * where, and "the pane ends in a wall of rows" is not that: the ids below are
			 * the seed's own signature (see `injected`). The box is a fixed height on
			 * EVERY frame — including the two with no ids to print — so the pair overlays,
			 * and `PANEL` is derived from what it prints (see its own note).
			 */}
			<div
				className="overflow-hidden rounded-sm border border-hairline bg-sunken p-2 font-mono text-mono-sm text-ink-muted"
				style={{ height: PANEL }}
			>
				<div className="mb-1 text-meta text-ink-dim">
					rows stamped at the reader's arrival: {rows.length}
				</div>
				{shown.map((id) => (
					<div key={id}>{id}</div>
				))}
				{rows.length > PANEL_IDS ? (
					<div>… {rows.length - PANEL_IDS} more</div>
				) : null}
			</div>
			{/*
			 * The geometry, on the frame rather than only in the README beside it: a
			 * reader holding the bytes has no other way to know which window they were
			 * taken in.
			 */}
			<p className="text-meta text-ink-dim">
				pane {PANE}px pinned, column full width, capture viewport 1280x800
				floored to the document; the running row's elapsed figure and the
				working line's age read the SAME anchor — the call's own producer stamp
				— and both count to the machine's clock at render, which is why they
				move together between captures.
			</p>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Trace order while live",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The report itself: the nine rows the operator's pane ended on.
 *
 * The page is the one record 122 served, read by the runtime's own reader out of
 * a truncated copy of the journal; the seed is the ends the journal states for
 * that moment plus the in-flight call. The eight `bash` rows below it are the
 * operator's report, painted by the STORY-LOCAL pre-fix fold — not by the shipped
 * one, which refuses every one of them (see `beforeFix`) — and the fact that
 * carries the argument is measured rather than inferred from look-alike text: the
 * page names NONE of the eight (`reported.page_names_ghosts: []`, and `ghosts` is
 * reconstructed from the journal's own rows). Their previews are NOT unique
 * strings — three of the eight occur more than once in the journal
 * (`__pycache__` seven times) — so this story claims the measured empty
 * intersection and not uniqueness (QA round 1, Q3).
 */
export const BeforeReport: Story = {
	render: () => {
		const transcript = beforeFix(REPORTED_SEED, {
			entries: REPORTED_PAGE,
			arrival: REPORTED_ARRIVAL_MS,
		});
		const inFlight = REPORTED.in_flight;
		return (
			<Frame
				caption={`Before: opening the session while its turn runs (streaming: ${REPORTED.seed.streaming}) at journal record ${REPORTED.through_record}. The pane's own last rows are the eight — the opening turn's bash calls, an hour earlier — each painted at the reader's arrival showing output where its command belongs, with the call the turn was inside (${inFlight?.tool_name}, ${inFlight?.intent}) immediately above them.`}
				transcript={transcript}
				rows={injected(transcript, REPORTED_ARRIVAL_MS)}
				waiting={REPORTED.seed.streaming}
			/>
		);
	},
};

/**
 * The same frames, the same page, the shipped fold: the pane ends where the turn does.
 *
 * The eight rows are refused rather than greyed or captioned — an unplaceable row
 * is not painted at a position nobody stated — and they return as durable rows
 * through the reconcile read the client already fires for unlabelled calls
 * (`reconcileLimit`; `seedCallsMissingLabels` selects exactly this set).
 *
 * THAT RETURN IS DERIVED, NOT COMMITTED, and this comment says so rather than
 * leaving a reader to look for a frame that does not exist: the committed fixture
 * cannot carry it, because `page`, `older` and `reported.page` name 0 of the
 * eight each. Design round 1 derived it from the real journal instead —
 * `read_transcript_page(session_dir, before_id=<reported.page[0].id>, limit=300)`
 * against an isolated copy — which returns 22 entries naming 8/8 of them at their
 * own instants (1789663239.573 … 264.898 … 267.398 … 270.200), with the pane's
 * tail pixel-identical to this frame and `rows stamped at the reader's arrival: 0`.
 * So the claim holds and has a measurement; it has no still (design round 1, D4).
 */
export const AfterReport: Story = {
	render: () => {
		const transcript = shipped(REPORTED_SEED, {
			entries: REPORTED_PAGE,
			arrival: REPORTED_ARRIVAL_MS,
		});
		const inFlight = REPORTED.in_flight;
		return (
			<Frame
				caption={`After: the same session and the same frames. The pane still ends on the call the turn was inside (${inFlight?.tool_name}, ${inFlight?.intent}) — the working line and the footer are all that sit below it — and no injected row is painted: a clockless settled row is refused, because a settled row's position belongs to the durable record, which is the only thing that can date it.`}
				transcript={transcript}
				rows={injected(transcript, REPORTED_ARRIVAL_MS)}
				waiting={REPORTED.seed.streaming}
			/>
		);
	},
};

/**
 * The unmodified harvest, an hour later: every settled call the runtime kept.
 *
 * `derivation.unlabelled_ends` (59) of the seed's 100 ends name a call the page
 * cannot label, so the wall is the class rather than the eight — the eight are
 * simply the ones the report could prove at record 122, by the page naming none
 * of them, and at that moment the same rule injected exactly those eight.
 */
export const BeforeLive: Story = {
	render: () => {
		const transcript = beforeFix(SEED);
		const inFlight = SEED.find(
			(event) => event.type === "tool_execution_start",
		);
		return (
			<Frame
				caption={`Before: the harvested seed itself — ${FIXTURE.derivation.seed_ends} retained ends, ${FIXTURE.derivation.unlabelled_ends} of them unable to name a command — through the pre-fix fold. The pane's own foot is ${FIXTURE.derivation.unlabelled_ends + 1} fabricated rows, each stamped with the reader's arrival and showing output where its command belongs; the turn's in-flight ${inFlight?.tool_name} sits above them, off this pane's top edge.`}
				transcript={transcript}
				rows={injected(transcript, ARRIVAL_MS)}
				waiting={FIXTURE.seed.streaming}
			/>
		);
	},
};

/**
 * The unmodified harvest through the shipped fold: the wall is gone.
 *
 * This is the frame that states the fix does not depend on the reported moment:
 * the same 100 retained ends, the same page, the same in-flight call, and no row
 * painted at the arrival by the settled-row rule.
 */
export const AfterLive: Story = {
	render: () => {
		const transcript = shipped(SEED);
		const inFlight = SEED.find(
			(event) => event.type === "tool_execution_start",
		);
		/*
		 * TWO LINES, WHICH IS WHAT THE BOX HOLDS (`h-10` at `text-body-sm`'s 1.5
		 * line-height). This caption ran to three lines until round 2's D2-1, and the
		 * third band painted below the box and inside the pane on BOTH themes —
		 * apparatus text inside the surface under test. The clause is the point of the
		 * sentence, so the clause stays and the rest was shortened until the ink bands
		 * measured two again.
		 */
		// A compose frame never ran, so nothing dates it either — and it is not this
		// rule's business (#312 refuses a finished-dictation compose frame). Named
		// here rather than counted away, because "none is painted" would be false.
		const composing = SEED.filter((event) => event.type === "tool_call_compose")
			.map((event) => String(event.tool_call_id))
			.join(", ");
		return (
			<Frame
				caption={`After: the harvested seed (${FIXTURE.derivation.seed_ends} retained ends, ${FIXTURE.derivation.unlabelled_ends} unable to name a command) through the shipped fold. Its last record row IS the one still stamped at the arrival (${composing}) — the compose frame, which never ran and is #312's half of the clause — with the in-flight ${inFlight?.tool_name} immediately above it and no settled call's row painted at the arrival at all.`}
				transcript={transcript}
				rows={injected(transcript, ARRIVAL_MS)}
				waiting={FIXTURE.seed.streaming}
			/>
		);
	},
};
