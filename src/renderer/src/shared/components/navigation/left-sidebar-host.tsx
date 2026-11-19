import { type FC, type ReactNode, createContext, useContext } from "react";
import { createPortal } from "react-dom";

/**
 * Where a route draws its own left sidebar, handed from the shell to the route
 * (operator, 2026-11-03: "the left sidebar becomes the team bridge view").
 *
 * WHY THE SHELL'S COLUMN AND NOT A SECOND ONE. A route that drew its rail beside
 * `SidebarNavigation` put two sidebars in the window - 260px of app nav plus the
 * page's 288px rail, 548px of chrome at the 800px minimum - which is the "view in
 * view" the operator called unpopular. On a route that owns the column, the shell
 * keeps the column (its width preference, resize divider, `PanelEdge`, glass
 * `sidebar` region and the titlebar lane over it) and swaps only what is inside.
 *
 * WHY A HOST AND A PORTAL RATHER THAN A `sidebar` PROP. The rail's inputs - the
 * drafts, the roster, the scope, the quick view, the pointer-in-rail hold - live
 * in the page's own React tree, under the account-keyed owner. Lifting ~25 of them
 * into a store shared by two sibling subtrees would be a large refactor of the
 * account fence for the same pixels. A portal leaves the state where it is: the
 * element is the shell's, the React tree (context, props, synthetic events) is the
 * page's. Same shape as `panel-rail-host.tsx`, which the shell already uses for
 * the right-hand rail.
 *
 * OUTSIDE THE SHELL IT RENDERS INLINE - the one deliberate difference from
 * `InPanelRailHost`, which renders nothing. A story or a `renderToStaticMarkup`
 * suite that mounts the page alone has no shell column to fill, and the rail is
 * the page's primary navigation: dropping it would make every such frame and
 * assertion describe a page with no rail. `fallback` is the inline copy, usually
 * exactly the column the page drew before the swap; it is a separate element
 * rather than a wrapper around `children` because the inline column carries its
 * own width, top pad and glass region, all of which the shell's column owns when
 * hosted.
 */
export const LeftSidebarHostContext = createContext<{
	host: HTMLElement | null;
} | null>(null);

/** Whether the route's rail is being drawn in the shell's column. */
export const useLeftSidebarHosted = (): boolean =>
	useContext(LeftSidebarHostContext) !== null;

/**
 * Render `children` into the shell's left column when the shell offers one,
 * else render `fallback` where the caller stands.
 *
 * THREE STATES, NOT TWO. No context is "no shell" (inline). A context whose
 * `host` is still null is the shell's first commit: its column's ref has not
 * landed yet. That renders NOTHING rather than the inline copy, because the
 * inline copy would mount the whole rail for one commit and then remount it
 * inside the portal - every effect below it twice, on every visit.
 */
export const InLeftSidebarHost: FC<{
	children: ReactNode;
	fallback: ReactNode;
}> = ({ children, fallback }) => {
	const slot = useContext(LeftSidebarHostContext);
	if (!slot) return fallback;
	return slot.host ? createPortal(children, slot.host) : null;
};
