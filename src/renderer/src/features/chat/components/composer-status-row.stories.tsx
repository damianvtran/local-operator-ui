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
import type { CanonicalFrontendState } from "../../../../../../src/shared/desktop-session-contract";
import { ComposerStatusRow } from "./composer-status-row";
import { type RunDetails, deriveRunDetails } from "./run-details";

/**
 * A frontend snapshot with only the field the row reads.
 *
 * Cast at the boundary rather than built whole, which is the strip's story's own
 * device: `CanonicalFrontendState` carries around thirty required fields and this
 * row touches one of them.
 */
const frontend = (goal: string): CanonicalFrontendState =>
	({ goal }) as CanonicalFrontendState;

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
				const goal =
					goalItem && goalText
						? ` · goal ${Math.round(
								goalItem.getBoundingClientRect().width,
							)}px (text ${goalText.clientWidth}/${goalText.scrollWidth})`
						: "";
				setFacts(
					`${Math.round(
						row.getBoundingClientRect().width,
					)}px column · row ${Math.round(
						row.getBoundingClientRect().height,
					)}px tall · overflowX ${row.scrollWidth - row.clientWidth}px · ${
						row.querySelectorAll("button").length
					} chips${goal}`,
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
