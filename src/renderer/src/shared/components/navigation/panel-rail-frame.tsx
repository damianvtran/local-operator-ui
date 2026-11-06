import { PANEL_RAIL_WIDTH_PX } from "@features/chat/chat-sidebar-layout";
import { PanelEdge } from "@shared/components/common/panel-edge";
import {
	EMPTY_RIGHT_SLOT_ROUTE,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { type FC, useLayoutEffect } from "react";
import { PanelRail, type PanelRailProps } from "./panel-rail";

/**
 * The panel rail in its own 44px column, for the story harnesses that compose a
 * header and a pane by hand (#872).
 *
 * WHY THIS EXISTS. The app mounts the rail through the shell's host
 * (`InPanelRailHost`), but the evidence stories draw their own row - a header, a
 * transcript ground and a pane - and photograph it. Their frames used to show the
 * four triggers in the header; they now show them where the product does, at the
 * row's trailing edge, by drawing the SAME `PanelRail` in the SAME width (the
 * constant the shell sizes its host from) beside the pane. It is not a second rail:
 * it is a host for the one.
 *
 * IT STATES THE ROUTE IT SIMULATES. The app's `chat-content` publishes the route
 * facts the rail's lit state is built on (`rightSlotRoute`); a story that draws its
 * own row publishes nothing, and an unpublished route is "nothing is drawable", so
 * a rail over an open pane would photograph unlit. The frame therefore publishes
 * the facts its own props imply (a session id means a conversation), exactly as
 * `chat-content` derives them from the same value.
 *
 * It lives beside the rail rather than in a `.stories` file so that stories in
 * other features can import it without importing a story.
 */
export const PanelRailFrame: FC<Partial<PanelRailProps>> = ({
	sessionId = "session-story",
	runDetails = null,
	mcpServers = [],
	listOnScreen = false,
	readerChildId = null,
	browserAttentionCount = 0,
	/* The scope defaults to `session` because the frame's own route default has a
	   conversation, exactly as `sessionId` does. */
	askCount = 0,
	askUpdates = 0,
	askScope = "session",
	consoleUnseenCount = 0,
	consoleUnseenPulsing = false,
	consoleLiveCount = 0,
	fileCount = 0,
	codeOpened = 0,
	codeMentioned = 0,
	codeAttention = null,
}) => {
	const setRightSlotRoute = useUiPreferencesStore((s) => s.setRightSlotRoute);
	const hasSession = sessionId !== null;
	useLayoutEffect(() => {
		setRightSlotRoute({ mounted: true, session: hasSession });
		return () => setRightSlotRoute(EMPTY_RIGHT_SLOT_ROUTE);
	}, [setRightSlotRoute, hasSession]);
	return (
		<div
			data-panel-rail-host=""
			data-glass-region="sidebar"
			/*
			 * THE SEAM IS ON THE FRAME'S HOST, exactly as it is on the shell's (agent
			 * review round 1, B1): the host is the full-height box that paints the
			 * ground, so `inset-y-0` resolves to y0. `relative` is load-bearing -
			 * without it the seam would resolve against the page and photograph a
			 * different geometry from the app's.
			 */
			className="relative h-full shrink-0 bg-surface"
			style={{ width: PANEL_RAIL_WIDTH_PX }}
		>
			<PanelRail
				sessionId={sessionId}
				runDetails={runDetails}
				mcpServers={mcpServers}
				listOnScreen={listOnScreen}
				readerChildId={readerChildId}
				browserAttentionCount={browserAttentionCount}
				askCount={askCount}
				askUpdates={askUpdates}
				askScope={askScope}
				consoleUnseenCount={consoleUnseenCount}
				consoleUnseenPulsing={consoleUnseenPulsing}
				consoleLiveCount={consoleLiveCount}
				fileCount={fileCount}
				codeOpened={codeOpened}
				codeMentioned={codeMentioned}
				codeAttention={codeAttention}
			/>
			<PanelEdge side="start" />
		</div>
	);
};
