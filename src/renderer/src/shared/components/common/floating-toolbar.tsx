/**
 * The one shell every floating toolbar in the app wears.
 *
 * WHY THIS EXISTS. The operator reported, of the canonical transcript's two
 * toolbars, that "they seem to be slightly different styles which is annoying".
 * He was right, and the difference was not a deliberate register: the
 * per-turn selection strip wore `rounded-md` with a hairline and no shadow, the
 * column-level selection strip wore `rounded-sm` with `p-1` and the one
 * overlay shadow, the link strip sat between them at `gap-0.5`, and the row's
 * own action cluster wore the same tokens as the first with different padding.
 * Four copies of one object is four places for the next spacing tweak to land
 * in one of them only.
 *
 * WHAT IS AND IS NOT IN THE SHELL. The classes below are the CHROME - the
 * ground, the edge, the radius, the height, the padding and the gap - because
 * those are what a reader reads as "the same toolbar". Placement, stacking and
 * the reveal treatment are deliberately NOT here: a strip that floats over a
 * selection and a cluster that sits in the row's own trailing seat need
 * different positions and different z-indices, and the selection strips need
 * `invisible` while they are being measured. Every caller appends those, so
 * the chrome cannot drift between them.
 *
 * WHY NO SHADOW. `docs/branding.md` § 2 reserves the one shadow for "menu,
 * dialog, drawer, popover, tooltip, select" - objects that leave the flow as a
 * surface in their own right. A selection toolbar is a small group over the
 * prose it acts on, and the `elevated` ground plus the hairline is what makes
 * it read as floating (§ 2's elevation rule). Two of the four copies had
 * drifted onto `shadow-overlay`; converging on the contract role is the fix,
 * not a new value.
 *
 * WHY `gap-1` AND `px-1` RATHER THAN THE SMALLER PAIR. The row's own cluster
 * and the column-level strip already used them, so they are the majority
 * spelling, and the buttons are the same `icon-sm` control in every copy. The
 * quote strip's tighter `gap-0 px-0.5` was a local adjustment in the change
 * that introduced `preferGutter`; with that placement gone (`quote-anchor.ts`
 * has the selection-first rule now), there is nothing left for the tighter
 * pair to buy.
 *
 * ACCESSIBILITY. `role="toolbar"` and an accessible name are part of the
 * shell rather than of each caller: a group of icon buttons with no name is
 * announced as "toolbar" and nothing else, and the four copies had three
 * different answers (two unnamed). A caller may pass its own name; it may not
 * omit one.
 */

import { cn } from "@shared/lib/utils";
import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";

/**
 * The chrome, as one string. Exported so a caller that cannot render the
 * component (the row's in-flow cluster, which is not absolutely positioned)
 * still wears the identical tokens.
 */
export const FLOATING_TOOLBAR_CHROME =
	"flex h-8 items-center gap-1 rounded-md border border-hairline bg-elevated px-1";

export type FloatingToolbarProps = HTMLAttributes<HTMLDivElement> & {
	/** The accessible name of the group. Required: see the header. */
	label: string;
	children: ReactNode;
};

/**
 * A floating toolbar: the chrome above, `role="toolbar"`, and the one press
 * behaviour every copy shared.
 *
 * `onMouseDown` is cancelled so a press does not collapse the reader's
 * selection, and does not move focus off the highlight before `click` runs -
 * the two reasons every existing copy carried the same line.
 */
export const FloatingToolbar = forwardRef<HTMLDivElement, FloatingToolbarProps>(
	function FloatingToolbar({ label, className, children, ...rest }, ref) {
		return (
			/*
			 * `rest` FIRST, then the contract: a caller may pass data attributes,
			 * a style or an id, but it may not replace the role, the accessible
			 * name, the chrome or the press behaviour. The first version spread
			 * `rest` last, which let any caller silently drop the name a toolbar
			 * must have (code review round 1, C5).
			 */
			<div
				{...rest}
				ref={ref}
				role="toolbar"
				aria-label={label}
				className={cn(FLOATING_TOOLBAR_CHROME, className)}
				onMouseDown={(event) => event.preventDefault()}
			>
				{children}
			</div>
		);
	},
);
