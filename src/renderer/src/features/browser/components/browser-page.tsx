import type { FC } from "react";
import { BrowserSurface } from "./browser-surface";

/**
 * The browser route: the whole application surface, deep-linkable and reachable
 * from the rail, from a consent banner click on any route, and as the surface that
 * can give a page a full window.
 * Design: docs/design/ui-browser-tab.md 11.9 (a route now, a panel later);
 * docs/design/browser-approval-ux.md 7.1 (one implementation, two hosts), 7.5 (the
 * route stays).
 *
 * WHY THIS FILE IS NOW FOUR LINES, and why that is the change: the operator asked
 * for the browser to also open inside a conversation, showing that conversation's
 * tabs beside "all tabs" (PR 2). Two hosts is one implementation with a scope, not
 * two implementations, so everything that exists once per host moved into
 * `browser-surface.tsx` and this is the route's own choices and nothing else —
 * `tabScope="all"` and `requestScope="all"`, and its own evidence tags so a run can
 * say which host it drove. The route answers both of the surface's questions the
 * same way because it IS the whole application surface: every tab, every request
 * (spec 7.2 - `"all"` for the tabs and for the requester alike).
 * The route stays because it is what the rail points at and the only host that can
 * give the page a full window (§7.5); the pane is an additional entry point, never
 * a replacement.
 */
export const BrowserPage: FC = () => (
	<BrowserSurface
		tabScope="all"
		requestScope="all"
		surfaceTag="browser-route"
		dockSurfaceTag="browser-approvals-dock"
	/>
);
