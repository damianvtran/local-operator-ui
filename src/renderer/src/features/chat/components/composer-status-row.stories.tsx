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

/** A finished plan: two done, one dropped, nothing open. */
const FINISHED = detailsOf(["done", "done", "dropped"]);

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
 * One composer band at the column width under test.
 *
 * The row's own bottom padding is the ONLY gap between it and the box, exactly as
 * in the app: `message-input.tsx`'s form is a bare `w-full` and owns no gap, so a
 * frame that added one would show a spacing the product does not have.
 */
const Composer = ({
	width = 900,
	label,
	children,
}: {
	width?: number;
	label: string;
	children: React.ReactNode;
}) => (
	<div className="flex flex-col bg-canvas p-6" style={{ width: width + 48 }}>
		<p className={cn("pb-2 text-ink-dim text-meta")}>{label}</p>
		<div className={cn("@container/chatcol flex flex-col")} style={{ width }}>
			{children}
			<div
				className={cn(
					"flex w-full flex-col gap-3 rounded-frame border border-control bg-surface p-4",
				)}
			>
				<p className={cn("text-body-sm text-ink-dim")}>
					A message would be typed here.
				</p>
			</div>
		</div>
	</div>
);

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
			<Composer label="No goal and no plan: the row renders nothing at all (the pre-change composer)">
				<ComposerStatusRow frontend={frontend("")} runDetails={EMPTY} />
			</Composer>
			<Composer label="Goal alone: chevron, label, colon, and a snippet that truncates in CSS">
				<ComposerStatusRow frontend={frontend(LONG_GOAL)} runDetails={null} />
			</Composer>
			<Composer label="Plan alone, at the row's start: 3 of 5 open — pending plus blocked, the model's own count">
				<ComposerStatusRow frontend={frontend("")} runDetails={IN_FLIGHT} />
			</Composer>
			<Composer label="Both: the count holds the right edge and does not move with the goal's text">
				<ComposerStatusRow
					frontend={frontend(LONG_GOAL)}
					runDetails={IN_FLIGHT}
				/>
			</Composer>
			<Composer label="A finished plan still renders, and says 0 to-dos open">
				<ComposerStatusRow frontend={frontend("")} runDetails={FINISHED} />
			</Composer>
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
			<Composer label="A goal that fits: the chip is content-sized, so nothing is clipped">
				<ComposerStatusRow frontend={frontend(SHORT_GOAL)} runDetails={null} />
			</Composer>
			<Composer label="A 300-character goal: the ellipsis is the browser's, the tooltip carries the rest">
				<ComposerStatusRow
					frontend={frontend(LONG_GOAL)}
					runDetails={IN_FLIGHT}
				/>
			</Composer>
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
				<Composer label="Collapsed: one line, 32px of the composer band">
					<ComposerStatusRow
						frontend={frontend(LONG_GOAL)}
						runDetails={IN_FLIGHT}
					/>
				</Composer>
				<Composer label="Expanded by a click on the real trigger: the author's break is kept and the body caps at 128px">
					<ComposerStatusRow
						frontend={frontend(LONG_GOAL)}
						runDetails={IN_FLIGHT}
					/>
				</Composer>
			</div>
		);
	},
};

/**
 * The column floor: a 220px column, which is the canvas pane's own open width,
 * collapsed above its expanded form.
 *
 * At or below 240px of column the row stops being a line — the goal takes the
 * row's own width, the count sits below it, and the goal's label goes `sr-only` so
 * the chip can shrink to its chevron. The cost is 26px of collapsed height, paid
 * here because the EXPANDED body would otherwise measure the row less a whole
 * count chip.
 *
 * The body's measure in the second band is the record's § 11 risk 1: it is the
 * row's own width less the primitive's 20px indent, its acceptance floor is 160px,
 * and if this frame shows less than that the remedy is the record's § 10 option D.
 */
export const ColumnFloor: Story = {
	render: () => {
		useOpenLastGoal();
		return (
			<div className={cn("flex flex-col gap-4")}>
				<Composer
					width={220}
					label="Collapsed: the row stacks, the label goes sr-only"
				>
					<ComposerStatusRow
						frontend={frontend(LONG_GOAL)}
						runDetails={IN_FLIGHT}
					/>
				</Composer>
				<Composer
					width={220}
					label="Expanded: the body takes the row's width less the indent"
				>
					<ComposerStatusRow
						frontend={frontend(LONG_GOAL)}
						runDetails={IN_FLIGHT}
					/>
				</Composer>
			</div>
		);
	},
};
