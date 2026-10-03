/**
 * The composer's status row, one frame per claim the design record makes.
 *
 * These render the PRODUCTION `ComposerStatusRow`, over real `RunDetails` from
 * `deriveRunDetails` over wire-shaped `todos` — so the counts in these frames
 * come off the same derivation the pane and the header trigger read, rather than
 * off a tally written for a story.
 *
 * ## What a story can and cannot settle here
 *
 * `docs/evidence/composer-readings/README.md` records the rule this surface
 * inherits: the composer's rows are photographed in the LIVE app, because their
 * line depends on the real column width, the real chip sizes and the real button
 * sizes. What a story can do, and what these frames are for, is put the row on
 * the ground it actually renders on, at the column widths its own container
 * queries resolve against, with the component that ships.
 *
 * So `@container/chatcol` is declared on the frame's own wrapper — without a
 * container in the tree the queries match nothing, the row is permanently
 * stacked, and every frame would certify a layout the product does not have at
 * that width. That is the strip's story making the same point, and it is also why
 * the composer box is hand-built here: the row's ground is the chat column's
 * `canvas`, and the only things the box contributes are the two roles it renders
 * against (`rounded-frame border-control bg-surface p-4`) and a neighbour whose
 * height makes the row's vertical cost legible.
 *
 * Every frame carries more than one band, and each band is a different claim:
 * the row's states beside each other, a long goal beside one that fits, the
 * collapsed row above its own expanded form, and the same pair at the column
 * floor. A single band would be one number with nothing to compare it to.
 *
 * The `data-capture-pending` handshake on the two stories with an expanded band
 * is the convention the run-details and trace sets use: the state arrives a paint
 * after the click, and a frame of the wrong state is indistinguishable from a
 * frame of the right one in a directory listing.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import "../../../styles/index.css";
import { cn } from "@shared/lib/utils";
import type { DesktopLoopState } from "../../../../../../src/shared/desktop-control-contract";
import type {
	CanonicalFrontendState,
	PendingAsk,
} from "../../../../../../src/shared/desktop-session-contract";
import { EMPTY_DRAFTS } from "../ask-queue";
import { AskSurfaces } from "./asks/ask-surfaces";
import { ComposerStatusRow } from "./composer-status-row";
import { type RunDetails, deriveRunDetails } from "./run-details";

/**
 * A frontend snapshot with only the field the row reads.
 *
 * Cast at the boundary rather than built whole, which is the strip's story's own
 * device: `CanonicalFrontendState` carries around thirty required fields and this
 * row touches one of them.
 */
const frontend = (
	goal: string,
	loop: DesktopLoopState | null = null,
): CanonicalFrontendState => ({ goal, loop }) as CanonicalFrontendState;

/**
 * One wire loop state, in `DesktopLoopState`'s own shape.
 *
 * Every field the row reads is a parameter with a resting value, so a band says only
 * what it is about: the STATUS is the affordance's whole input, `completed`/
 * `iterations` are the clause's progress, and `goal`/`reason` are carried because the
 * wire carries them (the row deliberately prints neither — see
 * `docs/composer-status-tabs.md` § 13).
 */
const loopOf = (
	status: DesktopLoopState["status"],
	extra: Partial<DesktopLoopState> = {},
): DesktopLoopState => ({
	status,
	completed: 0,
	iterations: null,
	goal: "",
	reason: "",
	...extra,
});

/** A plan in the wire shape the backend publishes: phases holding items. */
const planOf = (statuses: string[]): Array<Record<string, unknown>> => [
	{
		name: "Plan",
		items: statuses.map((status, index) => ({
			text: `Step ${index + 1}`,
			status,
		})),
	},
];

const detailsOf = (statuses: string[]): RunDetails =>
	deriveRunDetails({ jobs: [], todos: planOf(statuses) });

/** Nothing at all: the state the row must render nothing for. */
const EMPTY: RunDetails = deriveRunDetails({ jobs: [], todos: [] });

/**
 * A finished plan with an abandoned item: two done, one dropped, nothing open.
 * It is the case that decides between the two settled spellings.
 */
const FINISHED = detailsOf(["done", "done", "dropped"]);

/** A plan that finished cleanly: every item done, so nothing was dropped. */
const RESOLVED = detailsOf(["done", "done", "done"]);

/** In flight: two done, two pending, one blocked — five items, three open. */
const IN_FLIGHT = detailsOf(["done", "pending", "blocked", "done", "pending"]);

/**
 * One wire job, with only the fields the partition and the fold read.
 *
 * `type` is the row's own word: `task` is a delegated child, `bash` a tool job —
 * and the two are the partition the activity chips are about, so a fixture that
 * left it out would test one list twice.
 */
const wireJob = (
	id: string,
	type: string,
	status: string,
	label: string,
	queued = false,
): Record<string, unknown> => ({
	id,
	type,
	status,
	queued,
	label,
	start_time: 1_000,
	settled_at: null,
});

/**
 * The model over a job list and a plan, off the real derivation.
 *
 * The counts in these frames are therefore the model's own, exactly as they are
 * in the app: the chips read `openChildren`/`openJobs`, and a story that built a
 * `RunDetails` by hand could show a number the derivation would never produce.
 */
const detailsWith = (
	jobs: Array<Record<string, unknown>>,
	statuses: string[] = [],
): RunDetails =>
	deriveRunDetails({
		jobs,
		todos: statuses.length > 0 ? planOf(statuses) : [],
	});

/** Two children and one tool job: both activity chips, with counts that differ. */
const BOTH_ACTIVITY = detailsWith(
	[
		wireJob("c1", "task", "running", "Audit the March invoices"),
		wireJob("c2", "task", "running", "Summarise the findings"),
		wireJob("s1", "bash", "running", "bash: sleep 150 ; echo child-done"),
	],
	["pending"],
);

/** One tool job and nothing else: the jobs chip alone, at the row's start. */
const JOBS_ONLY = detailsWith([
	wireJob("s1", "bash", "running", "bash: sleep 150 ; echo child-done"),
]);

/** A parked child: open, so the chip renders — and its mark is the Clock. */
const PARKED = detailsWith([wireJob("c1", "task", "running", "Parked", true)]);

/**
 * Settled work: no chip at all, which is the state the count gate exists for.
 *
 * `frontend.jobs` keeps a row for a few minutes after it settles, so this is a
 * session the wire is still describing and the row deliberately says nothing
 * about (`docs/composer-activity-chips.md` § 5).
 */
const SETTLED_ACTIVITY = detailsWith([
	wireJob("c1", "task", "done", "Audit the March invoices"),
	wireJob("s1", "bash", "completed", "bash: wc -l invoices/march.csv"),
]);

/**
 * One ARMED wake schedule in the wire's shape, epoch MILLISECONDS for the due
 * instant — the trap the contract names beside the epoch-SECONDS job rows.
 *
 * `next_due_at` is minutes from a FIXED instant rather than from `Date.now()`, so
 * the clause in a frame is reproducible: a caption that re-renders differently on
 * every capture is one nobody can compare against the previous one.
 */
const WAKE_NOW_MS = Date.parse("2026-03-14T14:26:00Z");

const wakeOf = (
	id: string,
	message: string,
	dueInMinutes: number,
	everyMinutes?: number,
	limit?: number,
): Record<string, unknown> => ({
	id,
	message,
	next_due_at: WAKE_NOW_MS + dueInMinutes * 60_000,
	created_at: WAKE_NOW_MS - 3_600_000,
	every_ms: everyMinutes === undefined ? null : everyMinutes * 60_000,
	/* `remaining` stays null exactly as the backend publishes it, and `limit` is
	   what the bounded clause is rendered from — see the fixtures' own note. */
	remaining: null,
	limit: limit ?? null,
	fired_count: 0,
});

/**
 * One ARMED monitor in the wire's shape — the spec's identity joined with the
 * health counters, exactly what the scheduler's `index_rows()` publishes.
 *
 * `next_due_at` is epoch MILLISECONDS like the wake's, and `null` is a real
 * wire state: a monitor whose next tick is not known (or that the ladder has
 * parked) has no due slot, and the pane's row states the fact instead.
 */
const monitorOf = (
	id: string,
	name: string,
	dueInMinutes: number | null,
	extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
	id,
	name,
	tool: "bash",
	arguments: {},
	every_ms: 60_000,
	until_at: null,
	description: "",
	created_at: WAKE_NOW_MS - 3_600_000,
	next_due_at:
		dueInMinutes === null ? null : WAKE_NOW_MS + dueInMinutes * 60_000,
	last_check_at: WAKE_NOW_MS - 60_000,
	checks: 1,
	deliveries: 0,
	consecutive_failures: 0,
	disabled: false,
	disabled_reason: "",
	...extra,
});

/** One schedule: the wake chip alone, at the row's start. */
const WAKES_ONLY: RunDetails = deriveRunDetails({
	jobs: [],
	todos: [],
	wakes: [wakeOf("w1", "Check the 09:00 deploy finished", 34)],
	nowMs: WAKE_NOW_MS,
});

/** Nine schedules: the chip's count at the wire's ordinary full-scheduler size. */
const WAKES_MANY: RunDetails = deriveRunDetails({
	jobs: [],
	todos: [],
	wakes: Array.from({ length: 9 }, (_, index) =>
		wakeOf(`w${index + 1}`, `Wake ${index + 1}`, (index + 1) * 45),
	),
	nowMs: WAKE_NOW_MS,
});

/**
 * A plan and an armed wake: the pair the row has to hold, and the pane's own two
 * sections in miniature.
 */
const PLAN_AND_WAKES: RunDetails = deriveRunDetails({
	jobs: [],
	todos: planOf(["pending", "done"]),
	wakes: [
		wakeOf("w1", "Stand-up reminder", 12),
		wakeOf("w2", "Sweep the ingest queue", 90, 90),
	],
	nowMs: WAKE_NOW_MS,
});

/**
 * All five chips at once: goal, plan, wakes, subagents and jobs.
 *
 * The row's widest state, which is the one the wrap and the ordinal first-chip
 * rule both have to survive. The pair with `ActivityWidths` (four chips) is the
 * difference the fourth count chip makes to the wrap regime.
 */
const ALL_FIVE: RunDetails = deriveRunDetails({
	jobs: [
		wireJob("c1", "task", "running", "Audit the March invoices"),
		wireJob("s1", "bash", "running", "bash: sleep 150 ; echo child-done"),
	],
	todos: planOf(["pending"]),
	wakes: [
		wakeOf("w1", "Stand-up reminder", 12),
		wakeOf("w2", "Sweep the ingest queue", 90, 90),
	],
	nowMs: WAKE_NOW_MS,
});

/**
 * All six chips at once: goal, plan, wakes, monitors, subagents and jobs — the
 * row's widest state, one standing-fact chip past `ALL_FIVE`.
 *
 * The pair with `ALL_FIVE` is the difference the fifth count chip makes to the
 * wrap regime, which `MonitorWidths` measures at the four widths.
 */
const ALL_SIX: RunDetails = deriveRunDetails({
	jobs: [
		wireJob("c1", "task", "running", "Audit the March invoices"),
		wireJob("s1", "bash", "running", "bash: sleep 150 ; echo child-done"),
	],
	todos: planOf(["pending"]),
	wakes: [
		wakeOf("w1", "Stand-up reminder", 12),
		wakeOf("w2", "Sweep the ingest queue", 90, 90),
	],
	monitors: [monitorOf("m1", "loom-pr-1710", 1)],
	nowMs: WAKE_NOW_MS,
});

/** One watch and nothing else: the monitor chip alone, at the row's start. */
const MONITORS_ONLY: RunDetails = deriveRunDetails({
	jobs: [],
	todos: [],
	monitors: [monitorOf("m1", "loom-pr-1710", 1)],
	nowMs: WAKE_NOW_MS,
});

/**
 * Wakes and watches together: the two standing-fact chips in one gutter, the
 * wakes first — the order the TUI band renders its two row groups in.
 */
const MONITORS_AND_WAKES: RunDetails = deriveRunDetails({
	jobs: [],
	todos: [],
	wakes: [wakeOf("w1", "Stand-up reminder", 12)],
	monitors: [
		monitorOf("m1", "loom-pr-1710", 1),
		monitorOf("m2", "slack-thread-42", 2),
		monitorOf("m3", "ingest-queue", 3),
	],
	nowMs: WAKE_NOW_MS,
});

/**
 * Health that belongs to the pane's ROWS and not to this chip's count.
 *
 * One mid-ladder watch and one the ladder parked, and the chip above them is
 * the same `3 monitors armed` a healthy trio prints — a chip is a count, and
 * the state ink is the section's, not its own.
 */
const MONITORS_UNHEALTHY: RunDetails = deriveRunDetails({
	jobs: [],
	todos: [],
	monitors: [
		monitorOf("m1", "loom-pr-1710", 1),
		monitorOf("m2", "ingest-queue", 2, { consecutive_failures: 3 }),
		monitorOf("m3", "staging-pings", null, {
			disabled: true,
			disabled_reason: "connection refused",
		}),
	],
	nowMs: WAKE_NOW_MS,
});

/** A goal that fits: the control for the truncation claim beside `LONG_GOAL`. */
const SHORT_GOAL = "Reconcile the March invoices";

/**
 * A goal long enough to truncate at a 900px column and to need the body's cap.
 * Written as prose WITH a line break in it, because the collapsed form has to
 * collapse a break and the expanded form has to keep it.
 */
const LONG_GOAL =
	"Reconcile the March invoices against the payments ledger, group the unpaid rows\nby customer, confirm what 'pending' means with finance (two rows need a decision), then write reports/unpaid-march.md from the reconciled totals and publish the summary to the finance channel before the month closes";

/**
 * The column width at and below which the APP takes its small-view step.
 *
 * `chat-content.tsx` measures the chat column with a `ResizeObserver` and sets
 * `isSmallView` under 550px, so this is a property of the COLUMN and not of the
 * window: a 220px band inside a 1380px window is small view, and a story that
 * rendered the large-view inset there would certify a layout the product does not
 * have at that width. The floor frames shipped that way until design review
 * round 1 measured them (D3): the row took `px-4 pb-2` and the box `p-4` at a
 * width where the app renders `px-2 pb-1` and `p-2`, so the set certified 58px
 * and a 168px body against the app's 54px and 184px.
 *
 * Copied rather than imported because `chat-content.tsx` does not export it: the
 * threshold lives in a `ResizeObserver` callback there. A drift in one of the two
 * numbers would show up as a frame whose inset does not match the app's, which is
 * the defect this constant exists to prevent - so if that 550 moves, this moves
 * with it.
 */
const SMALL_VIEW_PX = 550;

/**
 * One composer band at the column width under test.
 *
 * The row's own bottom padding is the ONLY gap between it and the box, exactly as
 * in the app: `message-input.tsx`'s form is a bare `w-full` and owns no gap, so a
 * frame that added one would show a spacing the product does not have. The box
 * mirrors `COMPOSER_BOX`'s two steps so the band is the app's band at the width
 * it is drawn at, and `isSmallView` is derived from `width` rather than chosen,
 * so a band cannot describe a step the app would not render there.
 */
const Composer = ({
	width = 900,
	label,
	children,
}: {
	width?: number;
	label: string;
	children: React.ReactNode;
}) => {
	const isSmall = width <= SMALL_VIEW_PX;

	return (
		<div className="flex flex-col bg-canvas p-6" style={{ width: width + 48 }}>
			<p className={cn("pb-2 text-ink-dim text-meta")}>{label}</p>
			<div className={cn("@container/chatcol flex flex-col")} style={{ width }}>
				{children}
				<div
					className={cn(
						"flex w-full flex-col rounded-frame border border-control bg-surface",
						isSmall ? "gap-2 rounded-md p-2" : "gap-3 p-4",
					)}
				>
					<p className={cn("text-body-sm text-ink-dim")}>
						A message would be typed here.
					</p>
				</div>
			</div>
		</div>
	);
};

/**
 * Click the goal's trigger and hold the shutter until the state it produces is
 * up.
 *
 * The rig polls `document.documentElement.dataset.capturePending` before it takes
 * a frame, so setting it here is what stops the shutter landing on the closed
 * chip; the poll below is on the DOM rather than on a clock, because the state
 * arrives a paint after the click and a fixed sleep would be a race won by luck.
 * On exhaustion nothing is released, which makes the rig THROW on this story
 * rather than photograph whatever happened to be on screen.
 *
 * The chip is selected by its own `aria-expanded`, which is the disclosure
 * primitive's attribute and the real affordance: the row adds no inert hook to a
 * shared primitive for a photograph's sake. The LAST band is the one clicked, so
 * a story whose other bands are already closed needs no further addressing.
 */
const useOpenLastGoal = () => {
	useEffect(() => {
		const triggers = document.querySelectorAll<HTMLButtonElement>(
			"[data-composer-status-row] button[aria-expanded]",
		);
		const trigger = triggers[triggers.length - 1];
		if (!trigger) return;
		document.documentElement.dataset.capturePending = "1";
		trigger.click();
		const poll = window.setInterval(() => {
			if (!document.querySelector("[data-status-goal-body]")) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
};

/**
 * One band: the composer band, plus the row the story is about.
 *
 * The row's `isSmallView` is derived from the BAND'S width, here, once - the same
 * rule the app applies with its own `ResizeObserver`. Passing it from the story
 * body would let a band describe a step the app would not render at that width,
 * which is exactly the defect design review round 1 measured (D3).
 */
const Band = ({
	width = 900,
	label,
	frontend: f,
	runDetails,
}: {
	width?: number;
	label: string;
	frontend: CanonicalFrontendState;
	runDetails: RunDetails | null;
}) => (
	<Composer width={width} label={label}>
		<ComposerStatusRow
			frontend={f}
			runDetails={runDetails}
			isSmallView={width <= SMALL_VIEW_PX}
		/>
	</Composer>
);

const meta: Meta = {
	title: "Chat/Composer status row",
	parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

/**
 * The record's state matrix, in its own order, one band per state — plus the
 * state it says most needs pinning.
 *
 * The FIRST band is that state: a session with neither a goal nor a plan renders
 * NOTHING, so this band IS the pre-change composer — the box with no row above it,
 * which is what every such session looked like before this change. Read it
 * against the fourth band and the pair is the before/after of the whole feature.
 */
export const States: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<Band
				label="No goal and no plan: the row renders nothing at all (the pre-change composer)"
				frontend={frontend("")}
				runDetails={EMPTY}
			/>
			<Band
				label="Goal alone: chevron, label, colon, and a snippet that truncates in CSS"
				frontend={frontend(LONG_GOAL)}
				runDetails={null}
			/>
			<Band
				label="Plan alone, at the row's start: 3 of 5 open — pending plus blocked, the model's own count"
				frontend={frontend("")}
				runDetails={IN_FLIGHT}
			/>
			<Band
				label="Both: the count holds the right edge and does not move with the goal's text"
				frontend={frontend(LONG_GOAL)}
				runDetails={IN_FLIGHT}
			/>
			<Band
				label="A plan every item of which is done: All to-dos resolved"
				frontend={frontend("")}
				runDetails={RESOLVED}
			/>
			<Band
				label="A finished plan with an abandoned item: All to-dos closed, and deliberately not resolved"
				frontend={frontend("")}
				runDetails={FINISHED}
			/>
		</div>
	),
};

/**
 * The truncation claim, with its own control above it.
 *
 * A goal that fits, then one that does not: an unbounded value truncates with a
 * CSS ellipsis while its full text stays readable before the press (the tooltip
 * and the accessible name), and the short band above is what makes "the ellipsis
 * is the browser's" visible rather than asserted.
 */
export const LongGoal: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<Band
				label="A goal that fits: the chip is content-sized, so nothing is clipped"
				frontend={frontend(SHORT_GOAL)}
				runDetails={null}
			/>
			<Band
				label="A 300-character goal: the ellipsis is the browser's, the tooltip carries the rest"
				frontend={frontend(LONG_GOAL)}
				runDetails={IN_FLIGHT}
			/>
			{/*
			 * Design review round 1's D4: the set photographed a long goal before this
			 * change and never after, so the width the goal now YIELDS beside the two
			 * activity chips was unmeasured. The four chips take ~379px of a 900px
			 * column and the goal is the item that gives, so this band prints the goal
			 * item's own box against its text's `clientWidth`/`scrollWidth` — the
			 * truncation is readable as a number and not only as an ellipsis.
			 */}
			<RowFacts>
				<Band
					width={900}
					label="The same 300-character goal with all four chips: the goal is what yields"
					frontend={frontend(LONG_GOAL)}
					runDetails={BOTH_ACTIVITY}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * The goal expanded in place, at a 900px column, directly under its collapsed
 * form so the vertical cost is the difference between two bands in one frame.
 *
 * Opened by CLICKING the real trigger rather than by a `defaultOpen` prop the row
 * does not have: production API that only a story calls is how a state ends up
 * unreachable in the product. What the frame is for: the full text, the author's
 * line break kept, the `max-h-32` cap and the body's own scroller.
 */
export const Expanded: Story = {
	render: () => {
		useOpenLastGoal();
		return (
			<div className={cn("flex flex-col gap-4")}>
				<Band
					label="Collapsed: one line, 32px of the composer band"
					frontend={frontend(LONG_GOAL)}
					runDetails={IN_FLIGHT}
				/>
				<Band
					label="Expanded by a click on the real trigger: the author's break is kept and the body caps at six whole lines"
					frontend={frontend(LONG_GOAL)}
					runDetails={IN_FLIGHT}
				/>
			</div>
		);
	},
};

/**
 * The column floor: the chat column's width with the canvas open in the app,
 * collapsed above its expanded form.
 *
 * **172px, not the record's 220px.** QA round 1 drove the built app at 1380x600
 * and 1380x900 and measured the column at 172px with the canvas holding the right
 * slot; 220px was the record's assumption and the app never renders it. A frame
 * drawn at a width the product does not have is a frame about a different layout,
 * so this is the app's number and the record's § 2.4 is corrected to match it.
 *
 * The band takes the SMALL-VIEW step, which is what the app does here: 172px is
 * well under the 550px threshold `chat-content.tsx` measures with its own
 * `ResizeObserver`. Until design review round 1 (D3) this story rendered the
 * large-view inset at this width, so the set certified 58px of collapsed height
 * and a 168px body where the product renders 54px and a 120px-capped body; the
 * numbers the README states are now the ones this frame actually contains.
 *
 * At or below 240px of column the row stops being a line - the goal takes the
 * row's own width and the count sits below it - which is the arrangement that
 * buys the expanded body the row's whole width instead of the row less a count
 * chip. The body's measure in the second band is the record's § 11 risk 1, and
 * these frames are how that risk is settled rather than assumed.
 */
const FLOOR_COLUMN_PX = 172;

export const ColumnFloor: Story = {
	render: () => {
		useOpenLastGoal();
		return (
			<div className={cn("flex flex-col gap-4")}>
				<Band
					width={FLOOR_COLUMN_PX}
					label="Collapsed: the row stacks, and the label stays visible"
					frontend={frontend(LONG_GOAL)}
					runDetails={IN_FLIGHT}
				/>
				<Band
					width={FLOOR_COLUMN_PX}
					label="Expanded: the body takes the row's width less the indent"
					frontend={frontend(LONG_GOAL)}
					runDetails={IN_FLIGHT}
				/>
			</div>
		);
	},
};

/**
 * A band that MEASURES the row it contains and prints the numbers into the frame.
 *
 * The row's width behaviour is a claim about boxes, and this is the only instrument
 * in this set that can make it checkable in a still: `check-evidence` validates the
 * image, and a reader of the image cannot measure it. The caption is therefore part
 * of the frame — the row's height in pixels, its horizontal overflow
 * (`scrollWidth - clientWidth`, which must be 0 at every width) and how many chips
 * it managed to render.
 *
 * It measures AFTER `document.fonts.ready` and two animation frames, for the reason
 * the rig waits for the same gate: Chrome paints a fallback box for a glyph whose
 * face is still loading, and a height measured before that arrives is a caption
 * that disagrees with the pixels beside it. `data-capture-pending` holds the
 * shutter until the measurement lands, which is this set's own convention.
 */
const RowFacts = ({ children }: { children: React.ReactNode }) => {
	const host = useRef<HTMLDivElement>(null);
	const [facts, setFacts] = useState("measuring…");
	useEffect(() => {
		let second = 0;
		let cancelled = false;
		document.documentElement.dataset.capturePending = "1";
		const settle = () => {
			const row = host.current?.querySelector<HTMLElement>(
				"[data-composer-status-row]",
			);
			if (row && !cancelled) {
				/*
				 * The row's OWN width is the column under test: the row is `w-full` inside
				 * the band's `@container/chatcol` box, which is what the two container
				 * queries resolve against. Measuring the probe's own host instead would
				 * report the STORY's width and print the same number in every band.
				 */
				/*
				 * The GOAL's own numbers, when the band has a goal (design review round
				 * 1's D4): the item's box against its snippet's `clientWidth` against the
				 * text's `scrollWidth`. The four chips take ~379px of a 900px column and
				 * the goal is the item that yields, so the width it now gets is the change
				 * — and a reader of a still cannot measure a box in it. `clientWidth <
				 * scrollWidth` is the truncation, as a number.
				 */
				const goalItem = row.querySelector<HTMLElement>("[aria-expanded]");
				const goalText = goalItem?.querySelector<HTMLElement>("span.truncate");
				/*
				 * The DISMISS controls' boxes, in the order they appear, which is the number
				 * this row's two affordances cost: they hold their box at rest so that a hover
				 * cannot move the text beside them (`docs/composer-status-tabs.md` § 12), and a
				 * held box is invisible in a still. Printing the widths is the only way the
				 * frame can say how wide the thing nobody can see is.
				 */
				const dismissWidths = [
					...row.querySelectorAll<HTMLElement>(
						"[data-status-goal-dismiss], [data-status-loop-dismiss]",
					),
				].map((box) => `${Math.round(box.getBoundingClientRect().width)}px`);
				/*
				 * The DISTANCE from each dismiss to the words it acts on, which is design review
				 * round 1's D1 as a number: the review measured the same control at 132px, 414px
				 * and 532px from its chip while it sat at the flex ITEM's trailing edge, and the
				 * ruling was that it belongs at the chip's own. A still cannot show a distance
				 * between two boxes, and the fix is a property of that distance — so the frames
				 * print it, beside the held width that makes it visible at all.
				 *
				 * Measured off the chip's own box rather than a class name: the claim is about
				 * geometry, and the chip is whichever element the dismiss's line carries
				 * (`aria-expanded` for the goal's disclosure, `data-status-loop` for the readout).
				 */
				const dismissGaps = [
					...row.querySelectorAll<HTMLElement>(
						"[data-status-goal-dismiss], [data-status-loop-dismiss]",
					),
				].map((box) => {
					const chip = box.parentElement?.querySelector<HTMLElement>(
						"[aria-expanded], [data-status-loop]",
					);
					return chip
						? `${Math.round(
								box.getBoundingClientRect().left -
									chip.getBoundingClientRect().right,
							)}px`
						: "?";
				});
				const goal =
					goalItem && goalText
						? ` · goal ${Math.round(
								goalItem.getBoundingClientRect().width,
							)}px (text ${goalText.clientWidth}/${goalText.scrollWidth})`
						: "";
				/*
				 * The CHIPS, counted by their own hooks rather than by `button`.
				 *
				 * It used to count buttons, which was the same number while every chip was a
				 * button and nothing else was: the row now also carries one DISMISS control per
				 * item that has one, so a button count would state a chip count that includes
				 * controls a reader can see are not chips. The dismiss count is printed
				 * BESIDE it instead, because holding an invisible box is exactly what those
				 * controls do and the number is how a still can say how much room they hold.
				 */
				/*
				 * The LOOP item's own numbers, which is the fit rule's instrument (QA round 2,
				 * Q4): the item's painted width against the row's content box, plus the clause it
				 * actually painted. A reader of a still cannot measure either box, and the two
				 * together are the claim — the figure rides along only while the box carries the
				 * item, and the width the item gives up is the figure's own.
				 */
				const loopChip = row.querySelector<HTMLElement>("[data-status-loop]");
				const loopItem = loopChip?.parentElement;
				const loopFacts =
					loopChip && loopItem
						? ` · loop item ${Math.round(
								loopItem.getBoundingClientRect().width,
							)}px in ${row.clientWidth}px: “${(loopChip.textContent ?? "").trim()}”`
						: "";
				const chips = row.querySelectorAll(
					"[aria-expanded], [data-status-plan], [data-status-wakes], [data-status-subagents], [data-status-jobs], [data-status-loop]",
				).length;
				const dismisses = row.querySelectorAll(
					"[data-status-goal-dismiss], [data-status-loop-dismiss]",
				).length;
				setFacts(
					`${Math.round(
						row.getBoundingClientRect().width,
					)}px column · row ${Math.round(
						row.getBoundingClientRect().height,
					)}px tall · overflowX ${row.scrollWidth - row.clientWidth}px · ${chips} chips · ${dismisses} dismiss${
						dismissWidths.length > 0 ? ` (${dismissWidths.join("+")})` : ""
					}${
						dismissGaps.length > 0
							? ` · dismiss gap ${dismissGaps.join("+")}`
							: ""
					}${goal}${loopFacts}`,
				);
			}
			if (!cancelled) {
				document.documentElement.removeAttribute("data-capture-pending");
			}
		};
		document.fonts.ready.then(() => {
			requestAnimationFrame(() => {
				second = requestAnimationFrame(settle);
			});
		});
		return () => {
			cancelled = true;
			cancelAnimationFrame(second);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
	return (
		<div ref={host} className={cn("flex flex-col")}>
			{children}
			<p data-row-facts="" className={cn("pt-1 text-ink-dim text-meta")}>
				{facts}
			</p>
		</div>
	);
};

/**
 * The two activity chips, one state per band, with the state they must NOT render
 * for as the last one.
 *
 * Band 4 is the gate's whole justification rather than a state anyone asked for:
 * a session whose rows have all settled grows no chip, because `frontend.jobs`
 * keeps those rows for a few minutes and `0 subagents running` would describe rows
 * that are about to vanish (`docs/composer-activity-chips.md` § 5). Read it against
 * band 1, which is the same row with a live child in it.
 */
export const ActivityChips: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<Band
				label="Both lists in flight: the subagents chip leads with the spin, the jobs chip with its own"
				frontend={frontend(SHORT_GOAL)}
				runDetails={BOTH_ACTIVITY}
			/>
			<Band
				label="Jobs alone, at the row's start: no goal, no plan, so the first-chip rule falls to it"
				frontend={frontend("")}
				runDetails={JOBS_ONLY}
			/>
			<Band
				label="A parked child: open, so the chip renders — and nothing spins, because nothing is running"
				frontend={frontend("")}
				runDetails={PARKED}
			/>
			<Band
				label="Settled work: the rows are still on the wire and no chip is drawn for them"
				frontend={frontend(SHORT_GOAL)}
				runDetails={SETTLED_ACTIVITY}
			/>
		</div>
	),
};

/**
 * A MIXED open set: fifteen children at work and twenty-five parked behind them.
 *
 * This is the ORDINARY shape of a large delegation rather than an edge —
 * `DEFAULT_MAX_RUNNING_JOBS = 15` (`harness/jobs.py:36`) is the pool subagents and
 * backgrounded shells share — and it is the state design review round 2's D6 was
 * found in: with the count taken over every open row and the word taken from the
 * busiest one, the chip read `40 subagents running` while the pane's own tally two
 * inches away read `15 running · 25 queued · 17 interrupted · 5 done`. The wire
 * shape here is that snapshot: 15 `running`, 25 `queued`, 17 settled rows of two
 * kinds (which the gate must NOT count) and 5 children that finished.
 */
const FAN_OUT = detailsWith([
	...Array.from({ length: 15 }, (_, i) =>
		wireJob(`run-${i}`, "task", "running", `Child ${i}`),
	),
	...Array.from({ length: 25 }, (_, i) =>
		wireJob(`queue-${i}`, "task", "running", `Child ${15 + i}`, true),
	),
	...Array.from({ length: 17 }, (_, i) =>
		wireJob(`stop-${i}`, "task", "interrupted", `Child ${40 + i}`),
	),
	...Array.from({ length: 5 }, (_, i) =>
		wireJob(`done-${i}`, "task", "done", `Child ${57 + i}`),
	),
]);

/** The same rule through the jobs list: one parked tool row beside two live ones. */
const MIXED_JOBS = detailsWith([
	wireJob("s1", "bash", "running", "bash: sleep 150 ; echo child-done"),
	wireJob("s2", "bash", "running", "bash: pnpm build"),
	wireJob("s3", "bash", "running", "bash: pnpm test", true),
]);

/** The control: a uniform set, where the state word is still the right one. */
const UNIFORM_QUEUED = detailsWith([
	...Array.from({ length: 25 }, (_, i) =>
		wireJob(`queue-${i}`, "task", "running", `Child ${i}`, true),
	),
]);

/**
 * A mixed open set, and the uniform control beside it.
 *
 * Design review round 2's D6, in one story: the count is every open row and the
 * WORD has to survive that, so a mixed set states the family's word
 * (`40 subagents open`) and a uniform one keeps the state's (`25 subagents
 * queued`). The busiest state does not vanish — it is in the chip's accessible
 * name and tooltip, which is the only reading assistive tech gets, because the
 * mark is `aria-hidden` by the roster's contract.
 *
 * Each band prints its own numbers (`RowFacts`), because the claim is about what
 * that sentence does to the row: the mixed wording is NARROWER than the state word
 * it replaces (`40 subagents open` against `40 subagents running`), so it cannot
 * cost the row a line, and the frame is what says so.
 */
export const ActivityMixed: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					label="Forty open, fifteen of them running: the chip states the total with the family's word"
					frontend={frontend(SHORT_GOAL)}
					runDetails={FAN_OUT}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					label="The same rule on the jobs list: two live tool rows beside a parked one"
					frontend={frontend(SHORT_GOAL)}
					runDetails={MIXED_JOBS}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					label="The control — a uniform set, where the state word is still the right one"
					frontend={frontend(SHORT_GOAL)}
					runDetails={UNIFORM_QUEUED}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * The stacked arrangement at the 240px boundary: the row's edges where they
 * actually differ, and where three chips once tore away from the goal.
 *
 * Design review round 1's D2 is the arrangement this story exists to keep honest
 * (the goal's line, then the counts as one left-aligned group), and its D5 is the
 * two states no still in the set covered in THIS arrangement: a chip's hover
 * ground, and the keyboard focus ring. Both are browser state rather than story
 * state, so both are the rig's own input — `{ hover }` moves a real pointer,
 * `{ tabTo }` presses the real Tab key — and neither is a class this story fakes.
 */
export const ActivityStacked: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					width={240}
					label="240: the goal keeps the line, the three counts share the next one as a group"
					frontend={frontend(SHORT_GOAL)}
					runDetails={BOTH_ACTIVITY}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * The running mark with motion LIVE, and it is the set's one deliberate exception
 * (`capture-evidence.mjs`'s `{ liveMotion }`). Two tuples capture this one story a
 * rotation apart, which is the only way any frame in this repository can show the
 * spin at all: the rig's default injects `animation: none !important` before every
 * shutter, and the reduced-motion frame proves the shape's RESTING visibility, not
 * the motion. The README says which of the two claims each frame carries.
 */
export const ActivityMarkMotion: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<Band
				label="A child running: the mark spins"
				frontend={frontend(SHORT_GOAL)}
				runDetails={BOTH_ACTIVITY}
			/>
		</div>
	),
};

/**
 * The width story, because the row is at its budget and four chips cannot share a
 * line.
 *
 * `docs/composer-status-tabs.md` § 5.4 budgets ~168px of a 204px content box for
 * ONE count chip; this row now holds a goal and three of them. The FIVE widths are
 * the ones the record and the frames argue about, and the two in the middle exist
 * because the wrap regime has three heights rather than one (design review round
 * 2, N2):
 *
 * - 900, the composer's own column width, where all four share a line (row 32px);
 * - 460, where the goal takes its own line and all three counts still share the
 *   next (row 54px);
 * - 300, where the plan and subagents chips share a line and the jobs chip drops
 *   below them (row 80px);
 * - 240, `CHAT_CHIP_ICON_ONLY_PX`, the boundary where the composer's chrome stops
 *   sharing one line — and where the row is still a line, so the chips must WRAP
 *   rather than paint past the column (row 106px);
 * - 172, the app's real floor with the canvas open (QA round 1, measured), where
 *   the row stacks: the goal takes the row's width, the chips follow it, and there
 *   is no wrap to do because there is no line to wrap out of (row 106px).
 *
 * Every band prints its own numbers (`RowFacts`), and the one that matters is
 * `overflowX 0` at all five. The heights are the other half — 32 / 54 / 80 / 106 /
 * 106px band by band: the row's height changes when a chip appears, when a chip
 * wraps among its siblings, and when the row stacks, which is the cost this design
 * accepts rather than hides.
 */
export const ActivityWidths: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					width={900}
					label="900: goal, plan, subagents and jobs on one line (the app's own column width)"
					frontend={frontend(SHORT_GOAL)}
					runDetails={BOTH_ACTIVITY}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={460}
					label="460: the goal takes its own line, and all three count chips still share the next"
					frontend={frontend(SHORT_GOAL)}
					runDetails={BOTH_ACTIVITY}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={300}
					label="300: the plan and subagents chips share a line, the jobs chip drops below"
					frontend={frontend(SHORT_GOAL)}
					runDetails={BOTH_ACTIVITY}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={240}
					label="240 (CHAT_CHIP_ICON_ONLY_PX): the chips that do not fit take the next line"
					frontend={frontend(SHORT_GOAL)}
					runDetails={BOTH_ACTIVITY}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={FLOOR_COLUMN_PX}
					label="172 (the column floor): the row stacks, and the chips follow the goal"
					frontend={frontend(SHORT_GOAL)}
					runDetails={BOTH_ACTIVITY}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * The wake chip: the fourth count, and the one about the FUTURE.
 *
 * Five bands, each a claim the design record makes, and the five together are what
 * "a session's armed wakes are visible" means on this row:
 *
 * 1. wakes alone — no goal, no plan, no activity — so the chip takes the row's
 *    content edge. This is the state nothing in the app could show before, and
 *    the pair with band 4 is the count gate.
 * 2. one schedule beside the plan, where the two leading chips have to share the
 *    row's 8px gutter rather than each opening their own edge with the
 *    `${FIRST_CHIP}` cancellation.
 * 3. nine schedules: the count is the model's, and the row is unchanged by how
 *    many rows the pane behind it will draw.
 * 4. the CONTROL band: the same plan and activity with no wakes, so the chip's
 *    absence is legible as an absence rather than as a chip that happens to be
 *    somewhere else on the line.
 * 5. the goal, the plan, the wakes and both activity counts at 900px, which is
 *    the row at its widest and the frame the wrap has to survive.
 */
export const WakeChip: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<Band
				label="Wakes alone: one schedule, no goal and no plan, so the chip is at the row's start"
				frontend={frontend("")}
				runDetails={WAKES_ONLY}
			/>
			<Band
				label="The plan and the wakes: two count chips in one gutter, the plan first"
				frontend={frontend("")}
				runDetails={PLAN_AND_WAKES}
			/>
			<Band
				label="Nine schedules: the chip states the model's count, and only the pane behind it caps its rows"
				frontend={frontend("")}
				runDetails={WAKES_MANY}
			/>
			<Band
				label="The control: the same plan and activity with no wakes — no chip at all"
				frontend={frontend("")}
				runDetails={BOTH_ACTIVITY}
			/>
			<Band
				label="All five at 900: goal, plan, wakes, subagents and jobs on one line"
				frontend={frontend(SHORT_GOAL)}
				runDetails={ALL_FIVE}
			/>
		</div>
	),
};

/**
 * The row's width story with the FOURTH count chip, which is the one that changes
 * the wrap regime.
 *
 * `ActivityWidths` above measures the same row with three counts; the difference
 * this set exists to show is what the wake chip costs at each width, and the
 * numbers are printed into each frame rather than asserted beside it. The four
 * widths are the ones the record and the frames argue about, plus the row's own
 * smaller floor:
 *
 * - 900, the composer's own column width;
 * - 240, `CHAT_CHIP_ICON_ONLY_PX`, the boundary where the composer's chrome stops
 *   sharing one line;
 * - 220, the column floor the wake change was specified against — narrower than
 *   any of the three above, and the width where the chips have the least room;
 * - 172, the app's real floor with the canvas open (QA round 1, measured).
 *
 * The one number that matters at all four is `overflowX 0`: a chip group that
 * wraps inside its column instead of painting past it.
 */
export const WakeWidths: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					width={900}
					label="900: all five chips on one line beside the goal"
					frontend={frontend(SHORT_GOAL)}
					runDetails={ALL_FIVE}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={240}
					label="240 (CHAT_CHIP_ICON_ONLY_PX): the chips take the line under the goal"
					frontend={frontend(SHORT_GOAL)}
					runDetails={ALL_FIVE}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={220}
					label="220 (the specified column floor): the same group, one line lower"
					frontend={frontend(SHORT_GOAL)}
					runDetails={ALL_FIVE}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={FLOOR_COLUMN_PX}
					label="172 (the app's real floor): the row stacks, and the chips follow the goal"
					frontend={frontend(SHORT_GOAL)}
					runDetails={ALL_FIVE}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * The MONITOR chip: the session's armed watches, after the wakes.
 *
 * The chip's facts are the wake chip's own (a count off the model's list, spelled
 * by the same clause the pane's Monitors section prints), and the one thing this
 * set adds is the pair's ORDER: the wakes lead and the watches follow, so a
 * session with only watches puts this chip at the row's start and a session with
 * both reads `1 wake armed 3 monitors armed` in one gutter.
 *
 * The health band is the chip's own claim: a chip is a COUNT, and a monitor's
 * health lives on the pane's ROWS — so the mid-ladder and disabled watches in
 * that band do not change this row at all.
 */
export const MonitorChip: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<Band
				label="Monitors alone: one watch, no goal and no plan, so the chip is at the row's start"
				frontend={frontend("")}
				runDetails={MONITORS_ONLY}
			/>
			<Band
				label="The wakes and the watches: two count chips in one gutter, the wakes first"
				frontend={frontend("")}
				runDetails={MONITORS_AND_WAKES}
			/>
			<Band
				label="Health on the pane's rows only: a disabled and a mid-ladder watch leave this chip stating the same count"
				frontend={frontend("")}
				runDetails={MONITORS_UNHEALTHY}
			/>
			<Band
				label="The control: the same wakes with no monitors — the wake chip alone"
				frontend={frontend("")}
				runDetails={WAKES_ONLY}
			/>
			<Band
				label="All six at 900: goal, plan, wakes, monitors, subagents and jobs on one line"
				frontend={frontend(SHORT_GOAL)}
				runDetails={ALL_SIX}
			/>
		</div>
	),
};

/**
 * The row's width story with the FIFTH count chip, at `WakeWidths`' four widths.
 *
 * The claim to read at all four is the same one `WakeWidths` measures —
 * `overflowX 0`, the group wrapping inside its column rather than past it — with
 * one more chip in the group and one more clause to wrap. The numbers are printed
 * into each frame rather than asserted beside it.
 */
export const MonitorWidths: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					width={900}
					label="900: all six chips on one line beside the goal"
					frontend={frontend(SHORT_GOAL)}
					runDetails={ALL_SIX}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={240}
					label="240 (CHAT_CHIP_ICON_ONLY_PX): the chips take the line under the goal"
					frontend={frontend(SHORT_GOAL)}
					runDetails={ALL_SIX}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={220}
					label="220 (the specified column floor): the same group, one line lower"
					frontend={frontend(SHORT_GOAL)}
					runDetails={ALL_SIX}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={FLOOR_COLUMN_PX}
					label="172 (the app's real floor): the row stacks, and the chips follow the goal"
					frontend={frontend(SHORT_GOAL)}
					runDetails={ALL_SIX}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * The goal chip's DISMISS: the `X` and its word, held at rest and revealed by hover
 * or by focus.
 *
 * The state a still can carry is the RESTING one — `:hover` and `:focus-within` are
 * browser state and no story can force either — so this story pairs a resting band
 * with the three bands the revealed states were captured from
 * (`docs/evidence/composer-status-clear/`, which says plainly that the reveal was
 * captured through FOCUS-within and that no `:hover` frame exists in this set: the
 * `browser` tool has no hover verb, and a press in this host produces focus without
 * hover, measured).
 *
 * What the resting band is FOR, and it is the half a hover frame cannot show: the
 * control is invisible and STILL THERE, holding its box, so the chip's snippet does
 * not move under the pointer when the affordance appears (`branding.md` § 5: hover is
 * a colour step). The band's own numbers (`RowFacts`) print the goal item's width
 * against the snippet's `clientWidth`/`scrollWidth`, which is the truncation that
 * the held box costs, as a number rather than as an ellipsis.
 *
 * The last two bands are the STACKED arrangement (240px and the app's real 172px
 * column floor), where the word is dropped and the X is what is left: the affordance
 * has to survive the one width where the row has least room, and the accessible name
 * is unchanged there.
 */
export const GoalClear: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					label="The goal's dismiss at rest: nothing painted, its box held so hover cannot move the snippet"
					frontend={frontend(SHORT_GOAL)}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
			<Band
				label="The goal alone on the row: the control stays beside the words, at the chip's trailing edge"
				frontend={frontend(SHORT_GOAL)}
				runDetails={null}
			/>
			<RowFacts>
				<Band
					label="A long goal with a plan: the held box is what the snippet yields to, and the count does not move"
					frontend={frontend(LONG_GOAL)}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={240}
					label="240: the goal keeps its line AND its word — the drop is strictly below this width, so this band is the layout rule rather than the X-alone state"
					frontend={frontend(SHORT_GOAL)}
					runDetails={BOTH_ACTIVITY}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={FLOOR_COLUMN_PX}
					label="172 (the app's real floor): the row stacks, the word is dropped, the X keeps its own box and its accessible name, and nothing overflows"
					frontend={frontend(LONG_GOAL)}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * The LOOP chip: the sixth chip, its STOP/CLEAR affordance, and the two absences.
 *
 * Seven bands, and the pair structure is the point rather than the count:
 *
 * 1. a loop alone — no goal, no plan — so the chip takes the row's content edge and
 *    the first-chip rule falls to it;
 * 2. the ordinary pair: a goal, a loop and the plan, which is the band the loop's own
 *    control was captured revealed on (`docs/evidence/composer-status-clear/`,
 *    through FOCUS-within — see that set's README for what a press can and cannot
 *    produce in this host);
 * 3. `judging`, the wire's other moving state, where the clause prints its own word
 *    and no figure;
 * 4. `achieved` — SETTLED, so the same control says `Clear loop`;
 * 5. `failed`, the second settled spelling, because the affordance reads the state and
 *    not a count of successes;
 * 6. the CONTROL band pair: `idle` beside no loop at all, which render the same
 *    nothing — a session with no loop grows no chip, and `Loop: idle` is not a line
 *    above anybody's composer;
 * 7. the row at its WIDEST now: the goal, the loop and all four counts at 900px, with
 *    its own numbers — the state the wrap and the ordinal first-chip rule have to
 *    survive one chip further than `WakeChip` measured.
 */
export const LoopChip: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<Band
				label="A loop alone: 2 of 5 turns, at the row's start, with its own affordance"
				frontend={frontend(
					"",
					loopOf("running", { completed: 2, iterations: 5 }),
				)}
				runDetails={null}
			/>
			<Band
				label="The pair: the goal, the loop and the plan — Stop loop while it moves"
				frontend={frontend(
					SHORT_GOAL,
					loopOf("running", { completed: 2, iterations: 5 }),
				)}
				runDetails={IN_FLIGHT}
			/>
			<Band
				label="Judging: the same chip, the other moving state, and no figure beside the word"
				frontend={frontend(SHORT_GOAL, loopOf("judging", { completed: 5 }))}
				runDetails={IN_FLIGHT}
			/>
			<Band
				label="Settled: the loop met the goal, and the control now says Clear loop"
				frontend={frontend(SHORT_GOAL, loopOf("achieved", { completed: 5 }))}
				runDetails={IN_FLIGHT}
			/>
			<Band
				label="Settled, the other spelling: a loop that failed is cleared, not stopped"
				frontend={frontend(SHORT_GOAL, loopOf("failed", { completed: 3 }))}
				runDetails={IN_FLIGHT}
			/>
			<Band
				label="The control: an idle loop draws no chip at all"
				frontend={frontend(SHORT_GOAL, loopOf("idle"))}
				runDetails={IN_FLIGHT}
			/>
			<Band
				label="The control: the same session with the field absent, which is the same absence"
				frontend={frontend(SHORT_GOAL)}
				runDetails={IN_FLIGHT}
			/>
			<RowFacts>
				<Band
					label="All six chips at 900: the goal and the loop on the first line, the four counts wrapped to the second"
					frontend={frontend(
						SHORT_GOAL,
						loopOf("running", { completed: 2, iterations: 5 }),
					)}
					runDetails={ALL_FIVE}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={FLOOR_COLUMN_PX}
					label="172 (the app's real floor): six chips stacked, the loop's own line under the goal"
					frontend={frontend(
						SHORT_GOAL,
						loopOf("running", { completed: 2, iterations: 5 }),
					)}
					runDetails={ALL_FIVE}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * Focus one control and hold the shutter until the reveal it produces is up.
 *
 * WHY AN EFFECT AND NOT A PRESS, which is the whole reason these two states had no
 * frame (design review round 2's D9): the settled loop's `Clear loop` cannot be
 * photographed by pressing it — the press is what takes the chip away — and the two
 * states exist only under FOCUS, which the `browser` tool can produce (it has no hover
 * verb; `../README.md` states that cost). The existing story frames reach a revealed
 * state by CLICKING the trigger, which is exactly what these two cannot survive, so
 * they focus their own control instead and mark the shutter pending until the browser
 * agrees it is focused — the `useOpenLastGoal` convention below, one activator over.
 */
const useFocusLastDismiss = (selector: string) => {
	useEffect(() => {
		const nodes = document.querySelectorAll<HTMLElement>(selector);
		const node = nodes[nodes.length - 1];
		if (!node) return;
		document.documentElement.dataset.capturePending = "1";
		node.focus();
		const poll = window.setInterval(() => {
			if (document.activeElement !== node) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [selector]);
};

/**
 * The same, for a control that is NOT the last match — the goal chip's own TRIGGER
 * (design review round 2's D4).
 *
 * WHY A SECOND HELPER RATHER THAN A `:first-of-type` IN THE CALLER. Inside
 * `[data-status-goal]` there are two buttons — the disclosure's trigger and the
 * dismiss the disclosure renders on its line — and the trigger is the FIRST of them,
 * because the primitive renders `{trigger}{trailing}`. `:first-of-type` would also
 * depend on the item's own wrapper shape, which is not what this is about: what the
 * band needs is the one control that opens the disclosure's tooltip.
 */
const useFocusFirst = (selector: string) => {
	useEffect(() => {
		const node = document.querySelector<HTMLElement>(selector);
		if (!node) return;
		document.documentElement.dataset.capturePending = "1";
		node.focus();
		const poll = window.setInterval(() => {
			if (document.activeElement !== node) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [selector]);
};

/**
 * THE BAND QA ROUND 2's Q4 LIVES IN, at both clause shapes and on both sides of every
 * boundary the round named.
 *
 * The widths are the ones the defect was measured at, and they are two steps with a
 * pixel on each side: **241/240/239**, the `@max-[240px]` step the copy rules fire on
 * (where the row read `overflowX 19px` for a goal loop and `52px` for a count loop at
 * 240 and 241, and 0 one pixel below), and **173/172/171**, the app's floor with the
 * canvas open. The two clause shapes are the wire's own: a count loop prints its target
 * (`, 0 of 25 turns`), a goal loop prints a count (`, 0 turns`) — and the count loop is
 * the WIDER of the two, which is why a rule sized on the narrower one is a rule that
 * paints past its column.
 *
 * FOUR STORIES RATHER THAN ONE, and the constraint is the frame: a band's label and its
 * printed numbers wrap inside the narrow column they describe, so a band is ~215px of
 * page, the capture viewport is 720 CSS px, and a band below the fold is a claim its
 * own frame does not carry. Three bands per frame, one shape per frame.
 *
 * Every band prints its own numbers (`RowFacts`): the item's painted width in the row's
 * content box, and the clause it actually painted. The claim is the pair — the figure
 * rides along only while the box carries the item — and neither number can be measured
 * by a reader of a still.
 */
const COUNT_CLAUSE = {
	label: "count loop, `0 of 25 turns`",
	loop: loopOf("running", { completed: 0, iterations: 25 }),
};
const GOAL_CLAUSE = {
	label: "goal loop, `0 turns`",
	loop: loopOf("running", { completed: 0 }),
};

/** One shape at three widths, stacked: a frame holds three of these and no more. */
const bandFit = (
	clause: { label: string; loop: DesktopLoopState },
	widths: number[],
) => (
	<div className={cn("flex flex-col gap-3")}>
		{widths.map((width) => (
			<RowFacts key={`${width}-${clause.label}`}>
				<Band
					width={width}
					label={`${width}px column, ${clause.label}`}
					frontend={frontend("", clause.loop)}
					runDetails={null}
				/>
			</RowFacts>
		))}
	</div>
);

/** The `@max-[240px]` step, count loop: the widths the reading was taken at, and a pixel either side. */
export const LoopBandFit: Story = {
	render: () => bandFit(COUNT_CLAUSE, [241, 240, 239]),
};

/** The same step, goal loop: the NARROWER clause, which is where the step looked sufficient. */
export const LoopBandFitGoal: Story = {
	render: () => bandFit(GOAL_CLAUSE, [241, 240, 239]),
};

/** The app's floor with the canvas open, count loop, and a pixel either side of it. */
export const LoopBandFitFloor: Story = {
	render: () => bandFit(COUNT_CLAUSE, [173, 172, 171]),
};

/** The floor, goal loop. */
export const LoopBandFitFloorGoal: Story = {
	render: () => bandFit(GOAL_CLAUSE, [173, 172, 171]),
};

/**
 * The SETTLED loop's own dismiss, painted — the state design review round 2's D9 found
 * unpainted, because the only way to reach it was a press that removes the chip.
 *
 * One band, revealed by focus, so the word `Clear loop` and the settled clause
 * (`Loop: achieved`) are both in the picture beside the 86px box the control holds.
 */
export const LoopSettledFocus: Story = {
	render: () => {
		useFocusLastDismiss("[data-status-loop-dismiss]");
		return (
			<div className={cn("flex flex-col gap-4")}>
				<RowFacts>
					<Band
						label="Settled: the loop met the goal, and the control says Clear loop — revealed"
						frontend={frontend(
							SHORT_GOAL,
							loopOf("achieved", { completed: 5 }),
						)}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
			</div>
		);
	},
};

/**
 * A LONG goal's dismiss, painted — the clamp's own paint (design review round 2's D7/D9).
 *
 * `TOOLTIP_CLAMP` is `line-clamp-4`, and the frame the set already carried for it was a
 * two-line tooltip over a short goal: the class was true and its clamp was not shown.
 * This band is the 300-character goal with its dismiss focused, which is the state D9
 * named as capturable — four lines at most, with the ellipsis that says so.
 *
 * THE TOOLTIP ITSELF IS NOT IN THE PICTURE, and the label says so (design review round
 * 3, `D12`). A programmatic focus paints the reveal but does not open a Radix tooltip —
 * `:focus-visible` is what the primitive waits for, and this instrument has no keyboard
 * — so a label promising "the tooltip clamps to four lines" was a still asserting a state
 * its own pixels contradict. The clamp is declared by the class and by the tooltip the
 * control owns; what this frame is evidence of is the held box and the word beside it.
 */
export const LongGoalDismissFocus: Story = {
	render: () => {
		useFocusLastDismiss("[data-status-goal-dismiss]");
		return (
			<div className={cn("flex flex-col gap-4")}>
				<RowFacts>
					<Band
						label="A 300-character goal, its dismiss revealed: the box and the word are painted, and the clamped tooltip is declared rather than shown"
						frontend={frontend(LONG_GOAL)}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
			</div>
		);
	},
};

/**
 * The two bands whose printed numbers `docs/composer-status-tabs.md` cites, on their own
 * page so a frame can carry them (agent review round 2, MINOR 3).
 *
 * The `LoopChip` story carries both — the six-chip band at 900px and the 172px floor —
 * but every frame committed for it photographs bands 1-4, because the two `RowFacts`
 * bands sit below the fold and a story page cannot be scrolled by the capture tool. The
 * numbers those frames do not carry are the ones the record quotes (`2 dismiss
 * (89px+86px) · dismiss gap 0px+0px` for the loop half of D1's geometry, and the 158px
 * floor height of § 3.1), so they are shot here instead of cited to pixels that do not
 * contain them.
 */
export const LoopChipFacts: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					label="All six chips at 900: the goal and the loop on the first line, the four counts wrapped to the second"
					frontend={frontend(
						SHORT_GOAL,
						loopOf("running", { completed: 2, iterations: 5 }),
					)}
					runDetails={ALL_FIVE}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={FLOOR_COLUMN_PX}
					label="172 (the app's real floor): six chips stacked, the loop's own line under the goal"
					frontend={frontend(
						SHORT_GOAL,
						loopOf("running", { completed: 2, iterations: 5 }),
					)}
					runDetails={ALL_FIVE}
				/>
			</RowFacts>
		</div>
	),
};

/* ---------------------------------------------------------------- */
/* The goal's lifecycle: done, stalled, working and the two controls */
/* ---------------------------------------------------------------- */

/**
 * A frontend snapshot carrying the goal's LIFECYCLE fields.
 *
 * `frontend()` above carries only `goal` and `loop`, which was the whole of the
 * row's input until the judge existed. These fields arrive together — one backend
 * change — and their PRESENCE is the capability gate the row reads, so a fixture
 * that carried `goal_status` without them would be describing a backend that
 * cannot exist.
 *
 * Cast through `unknown` rather than straight to the state, because the lifecycle
 * fields make this object's shape overlap the target too little for a single
 * assertion: the fixture is a PARTIAL snapshot on purpose, and the row reads only
 * these fields off it.
 */
const lifecycle = (
	goal: string,
	status: string,
	judge: {
		state: string;
		run?: number;
		verdict?: string;
		reason?: string;
	} | null = null,
): CanonicalFrontendState =>
	({
		goal,
		goal_status: status,
		goal_judge: judge,
		goal_history: [],
		goal_history_truncated: false,
	}) as unknown as CanonicalFrontendState;

/**
 * THE PAIR IS THE MEASUREMENT (design §8.3, story 1): the active chip and the done
 * one in one frame, so "what changed" is a comparison at one height rather than a
 * claim about a still.
 *
 * The done band's `Dismiss` is revealed by focusing it — the reveal is
 * `group-hover`/`group-focus-within`, and this instrument has no hover verb
 * (`useFocusLastDismiss` records that cost). Both bands keep the goal text
 * identical on purpose: the only difference the frame should show is the settled
 * state.
 */
export const GoalDone: Story = {
	render: () => {
		useFocusLastDismiss("[data-status-goal-dismiss]");
		return (
			<div className={cn("flex flex-col gap-4")}>
				<RowFacts>
					<Band
						label="Active: unchanged from the shipped chip — the control pair is not painted until the line is hovered or focused"
						frontend={lifecycle(SHORT_GOAL, "active")}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
				<RowFacts>
					<Band
						label="Done: the value struck in the settled ink, the unstruck `— done` tag after it, and the single `Dismiss` (focused, so it is painted) in the trailing slot — THE PANEL PAINTED OVER THE BAND ABOVE IS THAT CONTROL'S OWN TOOLTIP (a focus opens it), not part of the chip: it is what covers part of the band above's caption, and the chip itself is the 32px row"
						frontend={lifecycle(SHORT_GOAL, "done", { state: "done" })}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
			</div>
		);
	},
};

/**
 * Keyboard focus on the done chip's one control, so the REVEAL and the focus ring
 * are photographed together (design §8.3, story 2 — the pattern
 * `LongGoalDismissFocus` already set for the active chip's clear).
 *
 * The visible word is `Dismiss` and the accessible name says where the goal goes:
 * `Dismiss the finished goal — it stays in the goal history`. That name is what
 * makes the press safe without a confirmation, and it is not in the picture — a
 * programmatic focus paints the reveal, not a tooltip — so this label states what
 * the frame cannot.
 */
export const GoalDoneDismissFocus: Story = {
	render: () => {
		useFocusLastDismiss("[data-status-goal-dismiss]");
		return (
			<div className={cn("flex flex-col gap-4")}>
				<RowFacts>
					<Band
						label="A done goal, its `Dismiss` focused: the held box and the word beside it, on the row's one line"
						frontend={lifecycle(SHORT_GOAL, "done", { state: "done" })}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
			</div>
		);
	},
};

/**
 * `stalled` next to `active`, in one frame (design §8.3, story 3), because the
 * difference IS the finding: the whole mark is an ink step on the `Goal:` label —
 * `text-ink-muted` to `text-ink` — plus the word `stalled` in the accessible name,
 * which a still cannot show. The two bands carry the same goal text so the ink is
 * the only variable.
 */
export const GoalStalled: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					label="Active: the label at `ink-muted`, the resting ink"
					frontend={lifecycle(SHORT_GOAL, "active", { state: "waiting" })}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					label="Stalled: the same label at `ink` (the loudest ink on the row, which the to-do panel reserves for the row asking for something) and 0px of anything else — the word `stalled` rides the accessible name"
					frontend={lifecycle(SHORT_GOAL, "active", {
						state: "stalled",
						verdict: "unknown",
					})}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * A story whose whole point is that NOTHING MOVES (design §8.3, story 4): a
 * `judging` chip beside an active one, printed as pixels rather than argued.
 *
 * React reuses the DOM across these two bands because they differ only in a field
 * the row does not paint, so the frame is the claim — and the two bands' `RowFacts`
 * are what make it checkable rather than eyeballed: the item's box is the same
 * number in both.
 */
export const GoalWorking: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					label="Active (`goal_judge.state`: waiting): the chip at rest"
					frontend={lifecycle(SHORT_GOAL, "active", { state: "waiting" })}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					label="Judging: the SAME chip, because what is happening is a turn streaming above it — the word `working` is in the accessible name and nowhere in the paint"
					frontend={lifecycle(SHORT_GOAL, "active", {
						state: "judging",
						run: 2,
						verdict: "continue",
					})}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * Both controls revealed, at 900px, for a goal that FITS and the 300-character one
 * (design §8.3, story 5). The 66px the second control costs is a number this story
 * exists to print: `RowFacts` reads the item's width, the snippet's
 * `clientWidth`/`scrollWidth`, each control's own width and the row's `overflowX`.
 *
 * The `Done` control is focused, which reveals the PAIR: the reveal is
 * `group-focus-within` as well as `group-hover`, so a keyboard user reaches both
 * and one focus paints both.
 */
export const GoalActionsRevealed: Story = {
	render: () => {
		useFocusLastDismiss("[data-status-goal-done]");
		return (
			<div className={cn("flex flex-col gap-4")}>
				<RowFacts>
					<Band
						label="900, a goal that fits: the pair is AT REST in this band — the single focus this story sets lands on the band below, and an at-rest pair paints nothing. Nothing is truncated"
						frontend={lifecycle(SHORT_GOAL, "active")}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
				<RowFacts>
					<Band
						label="900, the 300-character goal: THIS is the band the one focus lands in, so `Done` inboard and `Clear goal` trailing are both painted here — the snippet is what yields to the pair, and the pair is what the goal yields to"
						frontend={lifecycle(LONG_GOAL, "active")}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
			</div>
		);
	},
};

/**
 * The same pair at the two real floors (design §8.3, story 6): 240px, where the
 * `@max-[240px]` step fires, and the app's 172px floor. Both words are dropped
 * there — `NARROW_HIDDEN` — while each control's accessible name never is, and the
 * assertion the frame carries is `overflowX === 0`: the row gives up a word rather
 * than paint past its column.
 *
 * The goal is the 300-character one in both bands, because a narrow column with a
 * short goal would not exercise the yield order the floors are about.
 */
export const GoalActionsFloor: Story = {
	render: () => {
		useFocusLastDismiss("[data-status-goal-done]");
		return (
			<div className={cn("flex flex-col gap-4")}>
				<RowFacts>
					<Band
						width={239}
						label="239 (the copy rule's own step — the rule fires strictly BELOW 240, so 240 itself sits one pixel above it): both words dropped, the icons carrying the accessible names"
						frontend={lifecycle(LONG_GOAL, "active")}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
				<RowFacts>
					<Band
						width={FLOOR_COLUMN_PX}
						label="172 (the app's floor): the same pair, the same dropped words, zero horizontal overflow"
						frontend={lifecycle(LONG_GOAL, "active")}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
			</div>
		);
	},
};

/**
 * THE DONE BAND AT THE TWO REAL FLOORS (design review round 1, D1): the frame that
 * finding asked for and no story carried.
 *
 * WHY IT IS ITS OWN STORY RATHER THAN A THIRD WIDTH ON `GoalActionsFloor`. That
 * story measures the ACTIVE pair at 240 and 172, and neither `GoalDone` nor
 * `GoalDoneDismissFocus` sets a width - so whether the unstruck `— done` tag eats
 * the value exactly where the column is narrowest was, on this head, arithmetic the
 * round could not settle: at the 172px floor the row is stacked, the chip's line is
 * the 156px content box, the tag adds ~48px of text plus a 4px gap, and the value is
 * the `min-w-0 truncate` that yields. The finding's own two remedies are "add the
 * done band at 240 and 172" or "cut the tag there (`NARROW_HIDDEN`)", and both are
 * decisions a frame has to license - so the frame is the deliverable and this is the
 * story that draws it.
 *
 * The goal is the 300-character one in BOTH bands, `GoalActionsFloor`'s own rule: a
 * narrow column with a short goal would not exercise the yield order. `RowFacts`
 * prints the item's box against the value's `clientWidth`/`scrollWidth`, which is
 * D1's question as a number rather than as an ellipsis a reader has to interpret -
 * and the tag's cost is legible in the pair, because the 240 band and the 172 band
 * differ only in the step the `@max-[240px]` rule fires on.
 *
 * The `Dismiss` is left at REST here: at the floor the control is the `CircleCheck`
 * alone, and the reveal is `group-hover`/`group-focus-within`, which no story can
 * set (the focused half is `GoalDoneDismissFocus`).
 */
export const GoalDoneFloor: Story = {
	render: () => (
		<div className={cn("flex flex-col gap-4")}>
			<RowFacts>
				<Band
					width={240}
					label="240 (the stacked band's own edge — the row is already 54px tall here): the tag YIELDS at this width too, so the only cost left on the line is the held `Dismiss`'s 76px invisible box — what the numbers beneath measure"
					frontend={lifecycle(LONG_GOAL, "done", { state: "done" })}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
			<RowFacts>
				<Band
					width={FLOOR_COLUMN_PX}
					label="172 (the app's floor): the same settled chip in the stacked band, where the tag has yielded so the value keeps the width (D1) — what these pixels carry is the STRIKE and the dim ink; the `Dismiss` is at rest (`opacity-0`), so no check mark is painted in this band and the state's second home is the accessible name (`— done, <goal>`) — zero horizontal overflow"
					frontend={lifecycle(LONG_GOAL, "done", { state: "done" })}
					runDetails={IN_FLIGHT}
				/>
			</RowFacts>
		</div>
	),
};

/**
 * THE GOAL CHIP'S OWN TOOLTIP, AT THE COLUMN FLOOR (design review round 2, D4).
 *
 * WHAT IT EXISTS FOR. The disclosure's tooltip carries `goalLabel` — `Expand the
 * session goal — <the goal>` — which is the whole 1956px fixture at this head, and at
 * `TooltipContent`'s `max-w-64` and `text-meta` that is roughly eight lines drawn over
 * the composer in a 172px column. The control BESIDE it (the dismiss) has been clamped
 * to four lines since `TOOLTIP_CLAMP` was introduced, and no frame had ever measured
 * the disclosure's half of the pair: every goal frame in the tree that paints a tooltip
 * paints the DISMISS's (`goal-done` band 2, `goal-done-dismiss-focus`,
 * `goal-capability-off` band 2). This pair is that missing measurement — band 1 with
 * nothing focused, band 2 with the goal trigger focused, which is the state that opens
 * the panel.
 *
 * WHY THE PANEL IS IN THE FRAME RATHER THAN DECLARED. This rig cannot hover - its own
 * note says "a hovered frame carries no tooltip" - but a programmatic focus does open a
 * Radix tooltip, which `goal-done`'s band 2 shows, so focusing the trigger is the path
 * a keyboard user takes to the same panel and the frame is a picture of the real thing
 * rather than of a forced state. The clamp is `line-clamp-4`: the same constant, so the
 * pair cannot drift.
 *
 * The whole goal stays readable where it belongs and this frame does not claim
 * otherwise: the disclosure's expanded body carries it in full, as does the accessible
 * name, and `line-clamp-4` is a measure on the hover panel rather than a second
 * truncation of the value.
 */
export const GoalTooltipFloor: Story = {
	render: () => {
		useFocusFirst("[data-status-goal] button");
		return (
			<div className={cn("flex flex-col gap-4")}>
				<RowFacts>
					<Band
						width={FLOOR_COLUMN_PX}
						label="At rest at 172: nothing focused, so no panel is painted and the snippet is what yields"
						frontend={lifecycle(LONG_GOAL, "active")}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
				<RowFacts>
					<Band
						width={FLOOR_COLUMN_PX}
						label="The goal TRIGGER focused: the disclosure's own tooltip over the chip, CLAMPED to four lines (`line-clamp-4`, the same constant the dismiss beside it uses) — the panel painted over the band above is that tooltip, and the goal is carried in full by the expanded body and the accessible name"
						frontend={lifecycle(LONG_GOAL, "active")}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
			</div>
		);
	},
};

/**
 * THE CAPABILITY GATE, PHOTOGRAPHED AS A PAIR (design review round 1's spec table,
 * `capability-off`): a frontend that carries NONE of the lifecycle fields beside one
 * that carries them.
 *
 * WHY THE PAIR AND NOT THE LEGACY BAND ALONE. The gate's whole claim is an ABSENCE -
 * on a backend that predates `goal_status`/`goal_judge`, the row renders no new
 * control at all - and an absence is only evidence beside the state that has the
 * thing: the legacy band's chip carries the shipped `Clear goal` and nothing else,
 * while the capable band's chip carries the `Done` control the change adds (focused
 * here, so the pair is painted rather than held invisibly, which is the only way a
 * still distinguishes a held box from an absent one). `RowFacts` prints each band's
 * dismiss boxes and their widths — the boxes that carry
 * `data-status-goal-dismiss`/`data-status-loop-dismiss`, which is NOT the control this
 * story focuses (`Done`, `data-status-goal-done`, deliberately outside that selector),
 * so what the caption measures beside the new control is the SHIPPED box it sits
 * beside rather than the control itself (agent review round 3, R3-2).
 *
 * The bottom band's fixture is the legacy one deliberately: `frontend()` carries only
 * `goal` and `loop`, which was the row's whole input until the judge existed, and
 * `goalCapability` is `typeof goal_status === "string"` - so this band IS the
 * pre-change composer's chip rather than a snapshot built to look like it. Both bands
 * carry the same goal text and the same plan, so the control is the only variable.
 */
export const GoalCapabilityOff: Story = {
	render: () => {
		useFocusLastDismiss("[data-status-goal-done]");
		return (
			<div className={cn("flex flex-col gap-4")}>
				<RowFacts>
					<Band
						label="A backend without the lifecycle fields: the chip the app shipped before the judge, one `Clear goal` and no `Done` beside it"
						frontend={frontend(SHORT_GOAL)}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
				<RowFacts>
					<Band
						label="The same goal on a capable frontend: the pair is painted, `Done` inboard and `Clear goal` trailing, because one focus reveals both — and the panel over the band above is the focused control's own tooltip, the same focus-opened panel `goal-done` carries"
						frontend={lifecycle(SHORT_GOAL, "active")}
						runDetails={IN_FLIGHT}
					/>
				</RowFacts>
			</div>
		);
	},
};

/* ------------------------------------------------------------------ */
/* The ask item: the queued-ask lane as one chip in this row           */
/* ------------------------------------------------------------------ */

/*
 * The queued-ask affordance used to be its own strip above the composer. It is a
 * row item now, in this row's register, and these bands are what that means in
 * every state the copy contract distinguishes:
 *
 *   waiting    one open ask            -> `1 question waiting`  (ATTENTION)
 *   settled    one answered ask        -> `All asks settled`    (quiet)
 *   moved-on   one timed-out ask       -> `1 question moved on` (quiet)
 *   multiple   two waiting asks        -> `2 questions waiting` (ATTENTION)
 *   mixed      one waiting + one moved -> `1 question waiting` visible, the split
 *                                         in the announced name alone
 *   truncated  the wire's cap          -> `N outstanding`
 *   zero-ask   a published empty queue -> the item is absent
 *
 * WHAT TO LOOK FOR, since these frames are the design review:
 *
 * - **It reads as a PEER of `All to-dos resolved` and `2 wakes armed`** - same
 *   control box, same gaps, same type step, left-aligned at the row's content
 *   edge. No fill, no edge, no banner.
 * - **Attention is a COLOUR STEP, not a size.** Waiting paints the label `ink`
 *   and the mark `accent`; settled and moved-on keep the muted rest state. The
 *   row's height is IDENTICAL in every band (measured, in the set's README).
 * - **One glyph, one meaning.** `HelpCircle` is the panel's own mark for an open
 *   ask; it never stands for anything else in this row.
 * - **Expanded, the panel carries the question as asked and the answer as
 *   given** - the pair that makes `expanded-settled` worth a frame beside
 *   `expanded-moved-on`, whose row says "Timed out - the agent moved on; you can
 *   still answer" without pretending nothing happened.
 *
 * THE STORIES DRIVE THE FLAG FOR REAL (UX round 1, U2). Every band owns the ask
 * lane's ONE flag and hands the same state to both halves - the row item's
 * `askExpanded`/`onAskToggle` and the panel's `expanded`/`onToggle` - exactly as
 * `chat-page.tsx` does in the app. So in Storybook a reader can press the chip,
 * watch the panel appear, press Escape inside it and watch focus come back: the
 * interaction this change is about is walkable rather than pinned. `ask-driven`
 * makes that explicit by pressing the chip ITSELF on mount and holding the
 * shutter until the panel is up.
 */

/** The clock every ask frame is pinned to, so a countdown reads the same twice. */
const ASK_TS = 1_760_000_000_000;
const ASK_MINUTE = 60_000;
const ASK_NOW = ASK_TS + 12 * ASK_MINUTE;

const askOf = (over: Partial<PendingAsk> & { ask_id: string }): PendingAsk => {
	/*
	 * THE WIRE'S OWN WINDOW ARITHMETIC, DERIVED RATHER THAN RESTATED (design round 3's
	 * D1, QA round 3's Q2). A fixture no consumer could produce renders a frame that
	 * claims a state the product cannot be in - the round-3 headline frame paired a
	 * 900-second window with `expires in 18m`, three minutes longer than the ask's
	 * whole life - and the class is worth closing at the factory rather than at the
	 * one site that was caught. The backend keeps two invariants: the deadline IS the
	 * window (`expires_at = created_at + timeout_s * 1000`), and `urgent` is DERIVED
	 * from it (`timeout_s <= 900`), which is why no fixture may set the flag by taste.
	 * A site that passes either one explicitly and disagrees gets a throw - at the
	 * story, where it is visible, rather than in a frame nobody can falsify.
	 *
	 * The pinned clock is `ASK_NOW` (twelve minutes after `ASK_TS`), so a fixture's
	 * window is also what the countdown in its frame reads: `ASK_OPEN`'s hour reads
	 * `expires in 48m`.
	 */
	const created_at = over.created_at ?? ASK_TS;
	const timeout_s = over.timeout_s ?? 3600;
	const expires_at = created_at + timeout_s * 1000;
	const urgent = timeout_s <= 900;
	if (over.expires_at !== undefined && over.expires_at !== expires_at)
		throw new Error(
			`askOf(${over.ask_id}): expires_at contradicts created_at + timeout_s`,
		);
	if (over.urgent !== undefined && over.urgent !== urgent)
		throw new Error(
			`askOf(${over.ask_id}): urgent contradicts the wire's timeout_s <= 900`,
		);
	/*
	 * THE THIRD INVARIANT, STATUS AGAINST WINDOW (design round 4's nit): the two above
	 * constrain the deadline and the flag against each other but not against the STATUS
	 * the fold derives from them, so a `timed_out` ask carrying a deadline in the future
	 * - the agent having moved on from an ask that still has time to run - passed the
	 * guard while being a state no consumer can produce. The fold is explicit that it
	 * never re-derives `status` from `expires_at` (ask-queue.ts:38), so the pair is the
	 * caller's to keep consistent and this factory is where the caller is checked.
	 */
	const status = over.status ?? "open";
	if (status === "open" && expires_at <= ASK_NOW)
		throw new Error(
			`askOf(${over.ask_id}): an open ask's window has already closed`,
		);
	if (status === "timed_out" && expires_at > ASK_NOW)
		throw new Error(
			`askOf(${over.ask_id}): a timed-out ask carries a live deadline - the agent cannot have moved on from an ask with time left`,
		);
	if (over.answered_at != null && over.answered_at > ASK_NOW)
		throw new Error(
			`askOf(${over.ask_id}): answered_at is in the future of the pinned clock`,
		);
	return {
		created_at,
		expires_at,
		timeout_s,
		urgent,
		status: "open",
		delivered: false,
		questions: [],
		...over,
	};
};

const ASK_QUESTION = {
	id: "target",
	question: "Which environment should I deploy this to?",
	options: [
		{
			label: "staging",
			description: "The shared pre-prod cluster",
			recommended: true,
		},
		{ label: "production", description: "Live traffic" },
	],
};

/** One question the agent is still waiting on: the item's attention state. */
const ASK_OPEN = askOf({ ask_id: "a-7f3c", questions: [ASK_QUESTION] });

/** Answered and delivered: the question as asked and the answer as given. */
const ASK_ANSWERED = askOf({
	ask_id: "a-answered",
	status: "answered",
	answered_at: ASK_TS + 8 * ASK_MINUTE,
	delivered: true,
	answers: { target: ["staging"] },
	answered_by: { surface: "desktop" },
	questions: [ASK_QUESTION],
});

/**
 * The deadline passed and the agent moved on; a late answer still reaches it.
 *
 * Its window is the factory's hour measured from an hour BEFORE the pinned clock, so
 * the ask is twelve minutes past its deadline and internally consistent (see
 * `askOf`); the first cut created it AT the pinned clock and expired it a minute
 * earlier, which is a life that ends before it starts.
 */
const ASK_MOVED_ON = askOf({
	ask_id: "a-moved-on",
	status: "timed_out",
	created_at: ASK_TS - 60 * ASK_MINUTE,
	questions: [ASK_QUESTION],
});

/** A second open ask, so the `N` form has something to count. */
const ASK_SECOND = askOf({
	ask_id: "a-second",
	created_at: ASK_TS + 2 * ASK_MINUTE,
	questions: [
		{
			id: "files",
			question: "Which files should the cleanup script touch?",
			options: [{ label: "logs only" }, { label: "logs and caches" }],
		},
	],
});

/**
 * THE SHORT-WINDOW ASK (the audit's second item): the wire's own `urgent`, which
 * the backend derives from the window itself (`timeout_s <= 900`).
 *
 * Stated as the wire states it rather than as a fixture flag a frame could invent:
 * the row's mark is what the picture is about, and the rule that makes an ask urgent
 * lives in the backend. Its quarter-hour window leaves three minutes at the pinned
 * clock, which is what an urgent ask's countdown reads - the state the round-3 frame
 * got wrong by pairing the same flag with eighteen minutes.
 */
const ASK_URGENT = askOf({
	ask_id: "a-urgent",
	timeout_s: 900,
	questions: [ASK_QUESTION],
});

/**
 * A SECOND WAITING ASK WITH A SOONER WINDOW, for the subject form: two asks are
 * inside their windows and they do not expire together, which is the case a bare
 * `expires in 12m` would mis-attribute (design round 1's D2).
 *
 * Half an hour is above the 900-second threshold, so it is NOT urgent - a fixture
 * with a short window and `urgent: false` would be the same impossible-state class
 * the factory above now refuses.
 */
const ASK_SECOND_WINDOW = askOf({
	ask_id: "a-keys",
	created_at: ASK_TS + 2 * ASK_MINUTE,
	timeout_s: 1800,
	questions: [
		{
			id: "rotate",
			question: "Rotate the API keys now?",
			options: [{ label: "yes" }, { label: "no" }],
		},
	],
});

/**
 * A MOVED-ON ask that WAS urgent: the case both urgency arms must leave alone, since
 * the agent has walked past it and its window is closed. Its short window is why the
 * wire's flag is true, and it expired fifteen minutes before the pinned clock.
 */
const ASK_MOVED_ON_URGENT = askOf({
	ask_id: "a-moved-urgent",
	status: "timed_out",
	created_at: ASK_TS - 30 * ASK_MINUTE,
	timeout_s: 900,
	questions: [ASK_QUESTION],
});

/**
 * The frontend snapshot the item reads, with the wire's own counts.
 *
 * `asks_open` is the backend's OUTSTANDING tally (`open` OR `timed_out`), which
 * is the one count that is not the split: the split is derived from the rows, and
 * that is the whole point of `waiting`/`movedOn`. `over` exists so a band can
 * publish a tally its rows do not add up to (the `truncated` case).
 */
const asksFrontend = (
	asks: PendingAsk[],
	over: Partial<CanonicalFrontendState> = {},
): CanonicalFrontendState =>
	({
		goal: "",
		loop: null,
		asks,
		asks_open: asks.filter(
			(row) => row.status === "open" || row.status === "timed_out",
		).length,
		asks_truncated: false,
		...over,
	}) as CanonicalFrontendState;

/**
 * One band: the composer, the panel the item opens, and the row the item is in.
 *
 * The floor is the ONE flag, owned here the way `chat-page.tsx` owns it: `open`
 * feeds the panel's `expanded` AND the item's `askExpanded`, and both doors are
 * the same setter. A band that pinned either half would photograph a state the
 * press could not reach (U2).
 */
const AskBand = ({
	width = 900,
	label,
	asks,
	runDetails = null,
	goal = "",
	tally,
	defaultOpen = false,
	drive = false,
	focusPanel = false,
}: {
	width?: number;
	label: string;
	asks: PendingAsk[];
	runDetails?: RunDetails | null;
	goal?: string;
	/** A published count the rows do not add up to; the truncated case. */
	tally?: number;
	/** Pinned open for a still: the panel and the item read the same state. */
	defaultOpen?: boolean;
	/** Press the chip on mount and hold the shutter until the panel is up. */
	drive?: boolean;
	/** Focus the chip, press it, and hold the shutter until focus lands. */
	focusPanel?: boolean;
}) => {
	const [open, setOpen] = useState(defaultOpen);
	usePressTheChipOnce(drive);
	useFocusThePanelOnce(focusPanel);
	/*
	 * The published override for the truncated case: the WIRE's cap is what makes
	 * the split unknowable, so the fixture states both halves of that fact - the
	 * backend's own tally AND the flag that says the list it published is a prefix.
	 */
	const published =
		tally === undefined ? {} : { asks_open: tally, asks_truncated: true };
	return (
		<Composer width={width} label={label}>
			<AskSurfaces
				frontend={asksFrontend(asks, published)}
				nowMs={ASK_NOW}
				expanded={open}
				onToggle={setOpen}
				drafts={EMPTY_DRAFTS}
				onDraftChange={() => undefined}
				onAnswer={() => undefined}
				onDecline={() => undefined}
				className="pb-2"
			/>
			<ComposerStatusRow
				frontend={asksFrontend(asks, { ...published, goal })}
				runDetails={runDetails}
				isSmallView={width <= SMALL_VIEW_PX}
				askExpanded={open}
				onAskToggle={setOpen}
				/*
				 * THE SAME PINNED CLOCK THE PANEL GETS. The item prints the soonest waiting
				 * deadline now, and a countdown rendered against the wall clock cannot be
				 * photographed twice into the same frame - nor can a frame's reading be
				 * compared with the panel row's beside it.
				 */
				nowMs={ASK_NOW}
			/>
		</Composer>
	);
};

/**
 * Press the chip itself, once, and hold the shutter until the panel is up.
 *
 * The same handshake `useOpenLastGoal` uses, and for the same reason: the state a
 * press produces arrives a paint later, so the rig polls the DOM (the panel's own
 * root) instead of sleeping. On exhaustion nothing is released, which makes the
 * rig THROW on this story rather than photograph the collapsed band under a
 * driven name.
 *
 * The LAST chip in the document is the one pressed, so a story that renders other
 * bands needs no further addressing.
 */
const usePressTheChipOnce = (enabled: boolean) => {
	useEffect(() => {
		if (!enabled) return;
		const chips = document.querySelectorAll<HTMLButtonElement>(
			"[data-lo-ask-item-toggle]",
		);
		const chip = chips[chips.length - 1];
		if (!chip) return;
		document.documentElement.dataset.capturePending = "1";
		chip.click();
		const poll = window.setInterval(() => {
			if (!document.querySelector("[data-lo-ask-surfaces]")) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [enabled]);
};

/**
 * Focus the chip, PRESS it, and hold the shutter until focus lands in the panel.
 *
 * This is the SETTLED case's keyboard path, and it cannot be a pinned state: the
 * landing stop is produced by the panel's own focus move, which only fires on a
 * transition that found focus on the item - so the story has to do what the user
 * does (`focus()` then `click()`, in that order: a scripted click alone moves no
 * focus). What the frame is for is the FOCUS RING on that stop (agent review round
 * 2, F9; UX round 2, U4): a still has no focus, so the one panel visual no other
 * frame in the set can carry has to be produced by a story that puts focus there.
 *
 * The poll waits for the ring's own condition rather than for the panel: the panel
 * mounts a paint before focus moves into it, and a frame taken in between would
 * show a panel with the keyboard nowhere.
 */
const useFocusThePanelOnce = (enabled: boolean) => {
	useEffect(() => {
		if (!enabled) return;
		const chips = document.querySelectorAll<HTMLButtonElement>(
			"[data-lo-ask-item-toggle]",
		);
		const chip = chips[chips.length - 1];
		if (!chip) return;
		document.documentElement.dataset.capturePending = "1";
		chip.focus();
		chip.click();
		const poll = window.setInterval(() => {
			const panel = document.querySelector("[data-lo-ask-surfaces]");
			if (!panel || !panel.contains(document.activeElement)) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [enabled]);
};

/** One ask waiting: the item's ATTENTION state, beside the box it will answer into. */
export const AskWaiting: Story = {
	render: () => (
		<AskBand
			width={569}
			label="One open ask, forty-eight minutes left on it"
			asks={[ASK_OPEN]}
		/>
	),
};

/** Everything answered: the quiet register, kept on screen like a resolved plan. */
export const AskSettled: Story = {
	render: () => (
		<AskBand
			width={569}
			label="A settled queue: `All asks settled`, in the muted rest state every other settled chip uses"
			asks={[ASK_ANSWERED]}
		/>
	),
};

/** The deadline passed: quiet, and distinguishable from answered in the panel. */
export const AskMovedOn: Story = {
	render: () => (
		<AskBand
			width={569}
			label="A moved-on ask: `1 question moved on` — quiet, because the agent is no longer waiting on it"
			asks={[ASK_MOVED_ON]}
		/>
	),
};

/** Two waits: the `N` form, matching `2 wakes armed` in the chips beside it. */
export const AskMultiple: Story = {
	render: () => (
		<AskBand
			width={569}
			label="Two open asks: forty-eight minutes left on one, fifty on the other"
			asks={[ASK_OPEN, ASK_SECOND]}
		/>
	),
};

/**
 * A MIXED queue: one still waiting, one the agent moved on from.
 *
 * The visible clause says only the waiting half (a chip is a register, not a
 * paragraph) and the announced name carries the split - open the tooltip or read
 * `aria-label` to see `1 question waiting · 1 moved on`. This is the state where
 * the old strip could say nothing at all but `2 questions waiting`.
 */
export const AskMixed: Story = {
	render: () => (
		<AskBand
			width={569}
			label="One ask waiting, one the agent moved on from"
			asks={[ASK_OPEN, ASK_MOVED_ON]}
		/>
	),
};

/**
 * A TRUNCATED frame: the wire caps the list, so the split is unknowable.
 *
 * The clause states the backend's own outstanding tally instead of splitting a
 * prefix as if it were the whole queue - and the same rule covers a frame whose
 * rows lag the tally without being marked truncated (agent review round 1, F2).
 */
export const AskTruncated: Story = {
	render: () => (
		<AskBand
			width={569}
			label="A capped list with a published tally: the frame carries one row and the backend counts twelve"
			asks={[ASK_OPEN]}
			tally={12}
		/>
	),
};

/** Zero asks: the affordance is absent, and the row's other chips are not. */
export const AskZero: Story = {
	render: () => (
		<AskBand
			width={585}
			label="Zero asks: no item at all, while the row's own chips stand exactly as they do beside it"
			asks={[]}
			goal="Reconcile the March invoices"
			runDetails={ASK_NEIGHBOURS_DETAILS}
		/>
	),
};

/** The neighbours the item has to sit among, at the row's own order. */
const ASK_NEIGHBOURS_DETAILS: RunDetails = deriveRunDetails({
	jobs: [],
	todos: planOf(["pending", "done"]),
	wakes: [
		wakeOf("w1", "Stand-up reminder", 12),
		wakeOf("w2", "Sweep the ingest queue", 90, 90),
	],
	monitors: [monitorOf("m1", "loom-pr-1710", 1)],
	nowMs: WAKE_NOW_MS,
});

/**
 * The item between its neighbours: goal, plan, ask, wakes, monitors — the row's
 * own order, with the ask chip after the plan and before the wakes.
 *
 * 585px is the measure the BEFORE half was captured at (the old pane width minus
 * this harness's own padding), so the pair is a fair comparison of one arrangement
 * against the other at one width.
 */
export const AskNeighbours: Story = {
	render: () => (
		<AskBand
			width={585}
			label="Goal, plan, ask, wakes, monitors: the ask item in the register it now belongs to"
			asks={[ASK_OPEN]}
			goal="Reconcile the March invoices"
			runDetails={ASK_NEIGHBOURS_DETAILS}
		/>
	),
};

/** The same row at the narrow band: the item must not wrap or truncate wrongly. */
export const AskNeighboursNarrow: Story = {
	render: () => (
		<AskBand
			width={393}
			label="The same five chips at 393px: the item wraps with its neighbours rather than claiming a row"
			asks={[ASK_OPEN]}
			goal="Reconcile the March invoices"
			runDetails={ASK_NEIGHBOURS_DETAILS}
		/>
	),
};

/**
 * The LONGEST clause at the narrow band (`1 question moved on`, 148.39px against
 * the waiting clause's 133.47px): the one place a width defect could show.
 */
export const AskNarrowLongest: Story = {
	render: () => (
		<AskBand
			width={393}
			label="The longest clause at 393px: `1 question moved on` wraps as a unit rather than truncating"
			asks={[ASK_MOVED_ON]}
			goal="Reconcile the March invoices"
			runDetails={ASK_NEIGHBOURS_DETAILS}
		/>
	),
};

/** Expanded over a settled queue: the question as asked and the answer as given. */
export const AskExpandedSettled: Story = {
	render: () => (
		<AskBand
			width={569}
			label="Settled and expanded: the item reads `Collapse …` and the panel carries the question and its answer"
			asks={[ASK_ANSWERED]}
			defaultOpen
		/>
	),
};

/** Expanded over a moved-on ask: still answerable, and it says so. */
export const AskExpandedMovedOn: Story = {
	render: () => (
		<AskBand
			width={569}
			label="Moved on and expanded: `Timed out - the agent moved on`, and the answer controls stay live"
			asks={[ASK_MOVED_ON]}
			defaultOpen
		/>
	),
};

/**
 * Expanded over a WAITING ask: the one combination the first pair could not show -
 * the item in its ATTENTION register with its panel open, and the composer in ask
 * mode (design round 1, D2).
 */
export const AskExpandedWaiting: Story = {
	render: () => (
		<AskBand
			width={569}
			label="Waiting and expanded: the attention item open, with the form that answers it"
			asks={[ASK_OPEN]}
			defaultOpen
		/>
	),
};

/** Expanded over two waits: the `N` form with its panel. */
export const AskExpandedMultiple: Story = {
	render: () => (
		<AskBand
			width={569}
			label="Two waits and expanded: `2 questions waiting`, and the queue's two forms behind it"
			asks={[ASK_OPEN, ASK_SECOND]}
			defaultOpen
		/>
	),
};

/**
 * DRIVEN, not pinned: this band starts collapsed and the chip is PRESSED after the
 * first paint, so the frame is the state a reader's own press produces - the
 * evidence the first round's stills could not carry (UX round 1, U2; QA Q-1).
 *
 * `data-capture-pending` holds the rig's shutter until the panel's own root is up,
 * so a frame filed under this name cannot be a collapsed band.
 */
export const AskDriven: Story = {
	render: () => (
		<AskBand
			width={569}
			label="Pressed, not pinned: the chip clicks itself after paint and the panel opens from it"
			asks={[ASK_OPEN]}
			drive
		/>
	),
};

/**
 * The SETTLED panel's landing stop, FOCUSED: the ring the app's base layer paints.
 *
 * The one panel visual a still otherwise cannot carry, so it needs a story that
 * puts focus there rather than a pinned flag (agent review round 2, F9; UX round 2,
 * U4). A settled queue has no controls to land on, so the panel ROOT is the stop -
 * `tabIndex={-1}` plus the app's `html :focus-visible` rule, which is what the root
 * no longer suppresses with `outline-none`. The chip is focused and then pressed,
 * exactly as a keyboard user reaches it, because the app's focus move is guarded on
 * the transition finding focus on the item.
 *
 * AFTER-ONLY, like `driven-open`: the old surface's panel had no scripted landing
 * stop at all, so there is no before half to pair with this (the set's README says
 * so).
 */
export const AskFocusedPanel: Story = {
	render: () => (
		<AskBand
			width={569}
			label="Settled and focused: the panel root carries the keyboard, and the ring shows it"
			asks={[ASK_ANSWERED]}
			focusPanel
		/>
	),
};

/**
 * THE COUNTDOWN ON THE COLLAPSED FACE, and urgency with an ink of its own.
 *
 * The audit's two remaining items, in one frame: the item states the soonest
 * waiting deadline, and its mark steps to `warning` for it. The fixture's window is
 * the wire's own short one (900 seconds, three minutes left at the pinned clock),
 * which is also what makes the ink truthful - before this pass the item said
 * `1 question waiting` with an `accent` mark and neither fact was on screen anywhere
 * without opening the panel.
 */
export const AskUrgent: Story = {
	render: () => (
		<AskBand
			width={569}
			label="One urgent ask: the wire's own 900-second window, three minutes left on it"
			asks={[ASK_URGENT]}
		/>
	),
};

/**
 * TWO WINDOWS, ONE NUMBER: the item names no ask, so the countdown carries a subject.
 *
 * `AskOpen` has forty-eight minutes left and `AskSecondWindow` twenty; the number
 * printed is the SOONER one's, and the `soonest ask` subject is what keeps it from
 * reading as whichever ask the reader had in mind (design round 1's D2, with the head
 * noun design round 3's D4 asked for).
 * whichever ask the reader had in mind (design round 1's D2).
 */
export const AskTwoWindows: Story = {
	render: () => (
		<AskBand
			width={569}
			label="Two waiting asks with DIFFERENT windows: forty-eight minutes left on one, twenty on the other"
			asks={[ASK_OPEN, ASK_SECOND_WINDOW]}
		/>
	),
};

/**
 * THE APP'S APPLIED FLOOR, in this set's own unit: a 480px column, whose composer box
 * is 432px.
 *
 * THE COLUMN'S FLOOR IS 480, NOT 220 AND NOT 172 (`chat-sidebar-layout.ts`'s
 * `CHAT_PANE_MIN_PX`, applied by §I and asserted EXACTLY by
 * `scripts/chat-pane-floors.test.mjs`; that test's own note records that the
 * assertion it replaced allowed `(0, 480]` "while the tree was still at 220"). The
 * composer band insets the box 24px each side, so the widest tier this row has
 * (341px, the subject's yield) cannot bind until the column falls to about 389px -
 * which is why this frame is the honest floor and the earlier one was not: it pins
 * the box at 432, and the countdown IS painted here, in full, subject and sentence.
 *
 * WHAT THIS FRAME IS FOR, therefore: it is the frame that says the yield is a
 * container-query SAFETY NET rather than a rule the product applies - at every width
 * the app can currently produce, the item paints the whole clause, and the tier
 * frames below (`241`, `260`) photograph a narrowing it does not reach.
 *
 * Agent review round 2's F1 is why this exists at all: the set used to pin 220 (a
 * retracted floor) and then 172 (the composer box inside that 220 column, i.e. a
 * layout the app no longer renders), both of which claimed more about the product than
 * the numbers support.
 */
export const AskColumnFloorApplied: Story = {
	render: () => (
		<AskBand
			width={432}
			label="The applied floor: a 480px column, whose composer box is 432px - the window the app's own floor produces"
			asks={[ASK_OPEN]}
		/>
	),
};

/**
 * THE BAND WHERE THE COUNTDOWN USED TO BE CUT (design round 4's MAJOR).
 *
 * The sentence does not fit a 241px column, and an earlier cut let it ellipsise
 * there - painting `expires in 4...`, a prefix of BOTH `4m` and `48m`, beside an
 * urgency ink claiming fifteen minutes or less. These three states exist to
 * photograph the band and to assert the countdown is never partial in it: the
 * subject yields first, the sentence gives way to the VALUE whole, and the row keeps
 * its column.
 */
export const AskMultipleBand260: Story = {
	render: () => (
		<AskBand
			width={260}
			label="Two open asks at 260px: the sentence yields WHOLE to the value - the countdown is never cut mid-number"
			asks={[ASK_OPEN, ASK_SECOND]}
		/>
	),
};

export const AskTwoWindowsBand260: Story = {
	render: () => (
		<AskBand
			width={260}
			label="Two windows at 260px: the same yield, on the state whose number belongs to the sooner ask"
			asks={[ASK_OPEN, ASK_SECOND_WINDOW]}
		/>
	),
};

export const AskMultipleBand241: Story = {
	render: () => (
		<AskBand
			width={241}
			label="Two open asks at the 241px band edge: the value is whole here, which is what this state exists to show"
			asks={[ASK_OPEN, ASK_SECOND]}
		/>
	),
};

/** An urgent ask with its panel open: the row's mark is `warning`, glyph unchanged. */
export const AskExpandedUrgent: Story = {
	render: () => (
		<AskBand
			width={569}
			label="An urgent ask with the panel open"
			asks={[ASK_URGENT]}
			defaultOpen
		/>
	),
};

/**
 * MOVED ON **AND** URGENT: the case the ink arm must not repaint.
 *
 * The urgency arm sets ink, never glyph. A timed-out ask's status glyph is the
 * Clock, and an early cut of that arm returned `HelpCircle` before the status
 * switch - so one glyph meant both "open, maybe urgent" and "timed out, urgent"
 * (design round 1's D5). This frame is the one that would move if it regressed.
 */
export const AskExpandedMovedOnUrgent: Story = {
	render: () => (
		<AskBand
			width={569}
			label="A MOVED-ON ask that was urgent, with the panel open"
			asks={[ASK_MOVED_ON_URGENT]}
			defaultOpen
		/>
	),
};
