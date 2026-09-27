import { cn } from "@shared/lib/utils";
import { type HTMLAttributes, type ReactNode, forwardRef } from "react";

type PaneSlotProps = HTMLAttributes<HTMLDivElement> & {
	/**
	 * The pane's width in pixels, from the store that owns the drag.
	 */
	width: number;
	/**
	 * A floor for the story arms, which do not run the divider that enforces one in
	 * the app. Omitted, the pane is free to shrink the way `flex-shrink` allows.
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
 *     stays a box.
 */
export const PaneSlot = forwardRef<HTMLDivElement, PaneSlotProps>(
	({ width, minWidth, tourTag, children, ...rest }, ref) => (
		<div
			ref={ref}
			style={minWidth === undefined ? { width } : { minWidth, width }}
			data-tour-tag={tourTag}
			className={cn(
				"relative h-full overflow-hidden transition-[width] duration-base ease-out-quart",
			)}
			{...rest}
		>
			{children}
		</div>
	),
);

PaneSlot.displayName = "PaneSlot";
