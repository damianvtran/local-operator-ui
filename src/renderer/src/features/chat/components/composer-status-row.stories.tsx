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
import { useEffect } from "react";
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
