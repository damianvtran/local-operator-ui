import "../../../styles/index.css";

import { deriveRunDetails } from "@features/chat/components/run-details/run-detail-model";
import * as fixtures from "@features/chat/components/run-details/run-details.fixtures";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useLayoutEffect } from "react";
import { PanelRailFrame } from "./panel-rail-frame";

/**
 * The panel rail (#872) as a surface of its own: the four right-slot doors in the
 * 44px column the shell hosts at the window's right edge.
 *
 * WHY A BARE FRAME AS WELL AS THE SHELL ARMS. `shell.stories.tsx` photographs the
 * rail where it lives, beside a conversation and a pane, and those frames carry the
 * geometry. These carry the rail's own STATES, one per frame, large enough to read
 * the marks: the run trigger's two dot inks, the browser badge at one and at the cap,
 * the console blip in both of its inks, the canvas files dot, each item lit, and the
 * draft route where two of the four are absent. The left half of every frame is the
 * slot's own rung (`elevated`), so the rail's leading hairline and the lit item's
 * bar are judged against the ground they really meet.
 *
 * THE STORE IS SET, NOT ASSUMED, for the reason every pane story sets its flags:
 * the preferences persist into the profile's localStorage, so a story that did not
 * would photograph whatever an earlier one left behind. The route facts come from
 * `PanelRailFrame`, which states the route its props imply exactly as `chat-content`
 * derives them.
 */
const meta = {
	title: "Navigation/Panel rail",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

type OpenFlag =
	| "isRunPanelOpen"
	| "isBrowserPaneOpen"
	| "isConsolePaneOpen"
	| "isCanvasOpen";

const Rail: FC<{
	open?: OpenFlag;
	details?: ReturnType<typeof deriveRunDetails> | null;
	sessionId?: string | null;
	browserAttentionCount?: number;
	consoleUnseenCount?: number;
	consoleUnseenPulsing?: boolean;
	fileCount?: number;
}> = ({
	open,
	details = deriveRunDetails(fixtures.idle()),
	sessionId = "session-rail-story",
	browserAttentionCount = 0,
	consoleUnseenCount = 0,
	consoleUnseenPulsing = false,
	fileCount = 0,
}) => {
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: open === "isRunPanelOpen",
			isBrowserPaneOpen: open === "isBrowserPaneOpen",
			isConsolePaneOpen: open === "isConsolePaneOpen",
			isCanvasOpen: open === "isCanvasOpen",
			isAskDrawerOpen: false,
			askDrawerEvictedPane: null,
		});
		return () =>
			useUiPreferencesStore.setState({
				isRunPanelOpen: false,
				isBrowserPaneOpen: false,
				isConsolePaneOpen: false,
				isCanvasOpen: false,
			});
	}, [open]);
	return (
		<div
			data-testid="rail-frame"
			className="flex h-[184px] w-[132px] bg-canvas"
		>
			<div className="flex-1 bg-elevated" />
			<PanelRailFrame
				sessionId={sessionId}
				runDetails={details}
				browserAttentionCount={browserAttentionCount}
				consoleUnseenCount={consoleUnseenCount}
				consoleUnseenPulsing={consoleUnseenPulsing}
				fileCount={fileCount}
			/>
		</div>
	);
};

/** Nothing to report, nothing open: the four doors at rest. */
export const Idle: Story = { render: () => <Rail /> };

/** A child failed and nobody has looked: the run trigger's `danger` dot. */
export const RunAttention: Story = {
	render: () => (
		<Rail details={deriveRunDetails(fixtures.headerTriggerFailed())} />
	),
};

/** Work in flight with the pane closed: the same dot in `info`. */
export const RunActivity: Story = {
	render: () => <Rail details={deriveRunDetails(fixtures.headerTrigger())} />,
};

/** One approval waiting: the badge on the corner, its ring the rail's own ground. */
export const BrowserOne: Story = {
	render: () => <Rail browserAttentionCount={1} />,
};

/** The widest the badge can be: `9+` is the glyph's own cap; the name keeps 12. */
export const BrowserAtCap: Story = {
	render: () => <Rail browserAttentionCount={12} />,
};

/** The console's blip while a completion is fresh. */
export const ConsoleBlip: Story = {
	render: () => <Rail consoleUnseenCount={1} consoleUnseenPulsing={true} />,
};

/** The same dot after its pulse, at rest in `inkMuted`. */
export const ConsoleBlipResting: Story = {
	render: () => <Rail consoleUnseenCount={1} consoleUnseenPulsing={false} />,
};

/** The conversation has files: the canvas item's quiet dot. */
export const CanvasFiles: Story = {
	render: () => <Rail fileCount={3} />,
};

/** Each pane lit in turn: the ground, the accent ink and the 2px bar. */
export const RunOpen: Story = {
	render: () => <Rail open="isRunPanelOpen" />,
};
export const BrowserOpen: Story = {
	render: () => <Rail open="isBrowserPaneOpen" browserAttentionCount={2} />,
};
export const ConsoleOpen: Story = {
	render: () => <Rail open="isConsolePaneOpen" />,
};
export const CanvasOpen: Story = {
	render: () => <Rail open="isCanvasOpen" fileCount={3} />,
};

/**
 * A draft: no run details and no conversation, so Run details and Console are
 * ABSENT (not disabled) and Browser and Canvas, which open on a draft, remain.
 */
export const DraftRoute: Story = {
	render: () => <Rail details={null} sessionId={null} />,
};
