import { PANEL_RAIL_WIDTH_PX } from "@features/chat/chat-sidebar-layout";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
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
 * the facts its own props imply (a run model means run details, a session id means
 * a conversation), exactly as `chat-content` derives them from the same values.
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
	consoleUnseenCount = 0,
	consoleUnseenPulsing = false,
	fileCount = 0,
}) => {
	const setRightSlotRoute = useUiPreferencesStore((s) => s.setRightSlotRoute);
	const hasRunDetails = runDetails !== null;
	const hasSession = sessionId !== null;
	useLayoutEffect(() => {
		setRightSlotRoute({
			mounted: true,
			runDetails: hasRunDetails,
			session: hasSession,
		});
		return () =>
			setRightSlotRoute({ mounted: false, runDetails: false, session: false });
	}, [setRightSlotRoute, hasRunDetails, hasSession]);
	return (
		<div
			data-panel-rail-host=""
			className="h-full shrink-0 bg-surface"
			style={{ width: PANEL_RAIL_WIDTH_PX }}
		>
			<PanelRail
				sessionId={sessionId}
				runDetails={runDetails}
				mcpServers={mcpServers}
				listOnScreen={listOnScreen}
				readerChildId={readerChildId}
				browserAttentionCount={browserAttentionCount}
				consoleUnseenCount={consoleUnseenCount}
				consoleUnseenPulsing={consoleUnseenPulsing}
				fileCount={fileCount}
			/>
		</div>
	);
};
