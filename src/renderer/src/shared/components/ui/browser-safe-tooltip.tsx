import { useBrowserViewPresent } from "@shared/browser-view-policy";
import type { FC } from "react";
import { Tooltip, type TooltipProps } from "./tooltip";

/**
 * A tooltip that is only mounted when no native browser view can be under it.
 *
 * WHY THIS EXISTS (S5 round-1 design D2 / UX U2). A tooltip may not pause the
 * page (the kind table), and a native `WebContentsView` paints above all DOM, so
 * a hint that opens into the content area is clipped once the Browser route is
 * mounted. The first cut answered that by DELETING the tooltips from the rail,
 * the collapsed sidebar and the profile — but those controls are rendered on
 * every route, and only one route has a view under them. On chat, schedules and
 * the rest, a name that used to appear on hover simply stopped appearing.
 *
 * The correct rule is conditional, not global: keep the tooltip where no surface
 * is mounted (`useBrowserViewPresent`), and fall back to the control's own
 * `aria-label` only where a view could clip it. Call sites pass the same props
 * they always did.
 *
 * ONE TREE, ALWAYS (round-2 UX U8). The first version returned bare children in
 * the view case, which REPLACED the trigger element whenever a view appeared or
 * disappeared — React remounted the button and focus fell to `<body>` in the
 * middle of a keyboard press. `Tooltip` already has the prop for this: the panel
 * closes while the root and its trigger node stay mounted.
 *
 * It is a separate file rather than part of `tooltip.tsx` so the shared tooltip
 * keeps its S5 invariant: it does not import the browser-view policy at all, and
 * therefore cannot accidentally rejoin the pause path.
 */
export const BrowserSafeTooltip: FC<TooltipProps> = (props) => {
	const viewPresent = useBrowserViewPresent();
	/* A BOOLEAN, ALWAYS (rounds 3–4, reviewer MAJOR-2): `undefined` flipped the
	   Radix root uncontrolled↔controlled on every view transition. And a view-based
	   label must not RESUME when the view goes away, so discard follows the VIEW
	   alone; a caller's own `suppressed` (drag, rename) keeps the resume default. */
	return (
		<Tooltip
			{...props}
			suppressed={viewPresent || Boolean(props.suppressed)}
			discardWhileSuppressed={viewPresent}
		/>
	);
};
BrowserSafeTooltip.displayName = "BrowserSafeTooltip";
