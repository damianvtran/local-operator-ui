import { cn } from "@shared/lib/utils";
import { type HTMLAttributes, type ReactNode, forwardRef } from "react";

type PaneSlotProps = HTMLAttributes<HTMLDivElement> & {
	/**
	 * The pane's width in pixels, from the store that owns the drag.
	 *
	 * OMITTED MEANS "THE BOX THIS PANE IS PINNED TO", and that is a different claim
	 * from a measured number rather than a default for one. A DOCKED pane has a
	 * width a person chose, so only the store knows it. An OVERLAY pane has no
	 * width of its own: it covers the row it is pinned to (`absolute inset-0`), and
	 * that row's width is a fact only the browser has after the row has been laid
	 * out - after a zoom, a sidebar drag or a rail mount settles.
	 *
	 * MEASURED, and it cost a design round (D8). Passing the measured row width
	 * into an `inset-0` box is over-constrained - the direction decides which inset
	 * is ignored, so in RTL the box keeps its trailing inset and a WIDER number
	 * pushes its leading edge past the containing block. The number is one reflow
	 * old for a frame or two after 200 % zoom (measured: 956 px of row state in a
	 * 456 px row while the width transition ran), and in those frames the pane is
	 * wider than the row it is clipped by: it gives the `overflow-hidden` row a
	 * horizontal scroll range it does not have once settled, and any programmatic
	 * scroll of a control inside that row (a `scrollIntoView`, a focus scroll) then
	 * consumes it and drags the pinned pane with it - 24 px in RTL, off the window.
	 * Left unstated, the box resolves to its own insets at paint time, which is the
	 * only width an overlay can be correct at.
	 */
	width?: number;
	/**
	 * A floor for the box, in pixels. Omitted, the floor is ZERO — see the class
	 * note below, where the measurement behind that default is written down. A
	 * STORY arm that has no divider and no row of its own names its own floor
	 * here instead (`run-details.stories.tsx`, `canvas.stories.tsx`).
	 */
	minWidth?: number;
	/**
	 * The geometry handle the app's own probes read this pane by
	 * (`data-tour-tag`).
	 */
	tourTag?: string;
	/**
	 * Everything else goes to the box unchanged — `data-canvas-mode`, the ref the
	 * canvas dock's own geometry probe holds, and anything a fifth occupant needs.
	 * A slot that swallowed its occupants' attributes would be a wrapper the app
	 * has to work around, which is the second way of doing things this file exists
	 * to prevent.
	 */
	children: ReactNode;
};

/**
 * The right-hand pane slot: the box every occupant of that column is mounted in.
 *
 * WHY THIS IS A COMPONENT RATHER THAN FIVE COPIES OF A CLASS STRING. The slot was
 * an inline `div` at each of the app's four mount sites, and the evidence stories
 * that render the same panes - `canvas.stories.tsx`, `run-details.stories.tsx`,
 * `browser-pane.stories.tsx` - wrote a sixth, seventh and eighth copy of it. That
 * is how the slot's leading `border-l border-hairline` outlived its removal from
 * the app by a whole review round: the app stopped drawing the rule, the stories
 * kept drawing it, and every before/after frame in the set therefore showed a
 * boundary the product no longer had (design review round 1, D1). A class list in
 * one place cannot disagree with itself, and `scripts/pane-slot-ground.test.mjs`
 * refuses a second spelling of it anywhere the panes are hosted.
 *
 * WHAT IT CARRIES, AND WHAT IT DELIBERATELY DOES NOT:
 *
 *   - the WIDTH stays an inline `style`: it is a continuously dragged pixel value,
 *     and Tailwind cannot express a number that does not exist until the user lets
 *     go of the divider (the same reason `chat-layout.tsx` states for the sidebar);
 *   - the WIDTH TRANSITION belongs to the slot rather than to any pane, because it
 *     is the drawer opening and closing that moves it;
 *   - NO SEAM. The pane's boundary is the tonal step between its ground and the
 *     column beside it (`canvas/index.tsx` states which ground and why), and the
 *     app draws no rule here. A rule on this element is the defect above;
 *   - no ground of its own either: the occupant paints its surface, so the slot
 *     stays a box;
 *   - the WIDTH stays a preference and the FLOOR is always an explicit `0`,
 *     because the two are not the same number and a box that lets the browser
 *     choose the second one is a box whose floor nobody can read. MEASURED, on
 *     the run panel at a row that could not host its preference: with the floor
 *     omitted the box still shrank to the 320px the row left, and with the floor
 *     spelled `0` it shrank to the same 320 — because a flex item that is a
 *     SCROLL CONTAINER (`overflow-hidden`, in this class list) has an automatic
 *     minimum size of zero, so the clip was carrying the floor the inline
 *     `minWidth: 0` used to state. The same box with the clip lifted and the
 *     floor omitted rendered 390.7px and put 70.7px of itself past its row: that
 *     is the content-minimum floor the `0` is there to refuse, and it is the
 *     defect this branch's D1/U1 was about. An omission that is safe only
 *     because a sibling class happens to imply it is an omission the next editor
 *     of the class list can make unsafe without touching a floor, so the number
 *     is stated here rather than inferred. `scripts/composer-tabs.test.mjs`
 *     reads it from this file.
 */
export const PaneSlot = forwardRef<HTMLDivElement, PaneSlotProps>(
	({ width, minWidth = 0, tourTag, className, children, ...rest }, ref) => (
		<div
			ref={ref}
			style={{ minWidth, width }}
			data-tour-tag={tourTag}
			className={cn(
				"relative h-full overflow-hidden transition-[width] duration-base ease-out-quart",
				/*
				 * THE CALLER'S OWN CLASSES ARE MERGED HERE, NOT SPREAD PAST. `className`
				 * used to travel in `...rest` and land on the element AFTER this `cn(...)`,
				 * so a caller that named one class replaced the WHOLE family list —
				 * `relative h-full overflow-hidden` included, and with it the clip and the
				 * floor this file's header argues for. Merging through `cn` keeps the family
				 * list and lets `twMerge` resolve a genuine collision (`absolute` over
				 * `relative`), which is what the ask drawer's narrow-width overlay needs.
				 */
				className,
			)}
			{...rest}
		>
			{children}
		</div>
	),
);

PaneSlot.displayName = "PaneSlot";
