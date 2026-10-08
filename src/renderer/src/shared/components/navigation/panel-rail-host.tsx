import { type FC, type ReactNode, createContext, useContext } from "react";
import { createPortal } from "react-dom";

/**
 * Where the panel rail is drawn, handed from the shell to the chat surface (#872).
 *
 * WHY A HOST AND A PORTAL RATHER THAN A CHILD. The rail has to be a SIBLING of the
 * shell's measured content column: both width callers (the shell's lane and the
 * chat surface's own row) read that column's box, so a 44px sibling narrows the
 * number for every reader and `resolveRightSlotWidth`, `canvasDockWidth` and
 * `CHAT_PANE_MIN_PX` need no edit. Mounted inside the chat surface's row it would
 * sit LEFT of the fleet asks pane (a shell-level sibling of the route), i.e. not on
 * the window's edge. But the rail's INPUTS - the session, the approvals count, the
 * run panel's acknowledgement ledger, the console's unseen marks - live in the
 * chat surface, which is below the shell. A portal resolves both: the element is
 * the shell's and the React tree (context, props, state) is the chat surface's.
 *
 * Same shape as `LaneLeadingContext` in `chat-layout.tsx`: the shell owns the
 * element and publishes it, the route renders into it. This file is its own module
 * so the shell and the chat surface can both import it without importing each other.
 *
 * OUTSIDE THE SHELL IT IS INERT: a story that renders the chat surface alone gets
 * `null` here and no rail, rather than a rail drawn inside the content. The shell
 * frames in `shell.stories.tsx` use the same wrapper the app does.
 */
export const PanelRailHostContext = createContext<HTMLElement | null>(null);

/** Render `children` into the shell's rail host; nothing when there is none. */
export const InPanelRailHost: FC<{ children: ReactNode }> = ({ children }) => {
	const host = useContext(PanelRailHostContext);
	return host ? createPortal(children, host) : null;
};
