import "../../../styles/index.css";

import { deriveRunDetails } from "@features/chat/components/run-details/run-detail-model";
import * as fixtures from "@features/chat/components/run-details/run-details.fixtures";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useLayoutEffect } from "react";
import { PanelRailFrame } from "./panel-rail-frame";

/**
 * The panel rail (#872, #896) as a surface of its own: the six right-slot doors in
 * the 44px column the shell hosts at the window's right edge.
 *
 * WHY A BARE FRAME AS WELL AS THE SHELL ARMS. `shell.stories.tsx` photographs the
 * rail where it lives, beside a conversation and a pane, and those frames carry the
 * geometry. These carry the rail's own STATES, one per frame, large enough to read
 * the marks: the run trigger's two dot inks, the browser badge at one and at the cap,
 * the console blip in both of its inks, the canvas files dot, the asks item offered
 * quiet / with a count / in the fleet scope / lit while its drawer holds the slot
 * (#896), each item lit, and the draft route, where all six doors are present too
 * (the always-visible rail, D1). The left half of every frame is the slot's own
 * rung (`elevated`), so the rail's leading edge and the lit item's bar are judged
 * against the ground they really meet.
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
	| "isCanvasOpen"
	| "isCodeReviewPaneOpen"
	| "isAskDrawerOpen";

const Rail: FC<{
	open?: OpenFlag;
	/** Focus this item with the keyboard modality, so `:focus-visible` is the frame's state. */
	focusItem?: "run" | "ask" | "browser" | "console" | "canvas" | "code";
	details?: ReturnType<typeof deriveRunDetails> | null;
	sessionId?: string | null;
	browserAttentionCount?: number;
	askCount?: number;
	askScope?: "session" | "fleet";
	consoleLiveCount?: number;
	consoleUnseenCount?: number;
	consoleUnseenPulsing?: boolean;
	fileCount?: number;
	/* The code review door's counts and its attention cause (/PR2). */
	codeOpened?: number;
	codeMentioned?: number;
	codeAttention?: string | null;
	/*
	 * The frame's height, defaulting to 220: the six-door rail is 6 x 32px items +
	 * 5 x 4px gaps + the container's 4px top padding (216), and a clipped sixth item
	 * would be a frame of a layout the app does not have.
	 */
	height?: number;
	/*
	 * The frame's width, defaulting to the rail-only 132. The two chord-tooltip
	 * states (#928) declare more: a tooltip opens LEFT of its item, and a 132px
	 * frame would clip the very sentence those frames exist to show.
	 */
	frameWidth?: number;
}> = ({
	open,
	focusItem,
	details = deriveRunDetails(fixtures.idle()),
	sessionId = "session-rail-story",
	browserAttentionCount = 0,
	askCount = 0,
	askScope = "session",
	consoleLiveCount = 0,
	consoleUnseenCount = 0,
	consoleUnseenPulsing = false,
	fileCount = 0,
	codeOpened = 0,
	codeMentioned = 0,
	codeAttention = null,
	height = 220,
	frameWidth = 132,
}) => {
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: open === "isRunPanelOpen",
			isBrowserPaneOpen: open === "isBrowserPaneOpen",
			isConsolePaneOpen: open === "isConsolePaneOpen",
			isCanvasOpen: open === "isCanvasOpen",
			isCodeReviewPaneOpen: open === "isCodeReviewPaneOpen",
			isAskDrawerOpen: open === "isAskDrawerOpen",
			/* The scope rides the open, as the store writes them together; a lit ask
			   frame needs it for the drawable check and the labels. */
			askDrawerScope: askScope,
			askDrawerEvictedPane: null,
		});
		return () =>
			useUiPreferencesStore.setState({
				isRunPanelOpen: false,
				isBrowserPaneOpen: false,
				isConsolePaneOpen: false,
				isCanvasOpen: false,
				isCodeReviewPaneOpen: false,
				isAskDrawerOpen: false,
			});
	}, [open, askScope]);
	/*
	 * `focusVisible: true` is what makes `:focus-visible` match for a script-focused
	 * control (Chromium's heuristic treats an unprompted `.focus()` as pointer
	 * focus), the same call `RemedyFocusGround` makes for the run panel's remedy.
	 */
	useEffect(() => {
		if (!focusItem) return;
		document
			.querySelector<HTMLButtonElement>(`[data-panel-rail-item="${focusItem}"]`)
			?.focus({ focusVisible: true } as FocusOptions);
	}, [focusItem]);
	return (
		<div
			data-testid="rail-frame"
			className="flex bg-canvas"
			style={{ height, width: frameWidth }}
		>
			<div className="flex-1 bg-elevated" />
			<PanelRailFrame
				sessionId={sessionId}
				runDetails={details}
				browserAttentionCount={browserAttentionCount}
				askCount={askCount}
				askScope={askScope}
				consoleLiveCount={consoleLiveCount}
				consoleUnseenCount={consoleUnseenCount}
				consoleUnseenPulsing={consoleUnseenPulsing}
				fileCount={fileCount}
				codeOpened={codeOpened}
				codeMentioned={codeMentioned}
				codeAttention={codeAttention}
			/>
		</div>
	);
};

/** Nothing to report, nothing open: the six doors at rest. */
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
 * A draft: no run details and no conversation, and still all six doors (the
 * always-visible rail, D1) - the ask door in its fleet scope, and Run details,
 * Console and Code review opening panes that say they need a conversation.
 */
export const DraftRoute: Story = {
	render: () => <Rail details={null} sessionId={null} askScope="fleet" />,
};

/**
 * THE FOCUSED, LIT ITEM (design round 1, D2): the keyboard ring and the 2px lit
 * bar must BOTH be drawn. Before, they occupied the same pixels in the same ink.
 */
export const BrowserOpenFocused: Story = {
	render: () => (
		<Rail
			open="isBrowserPaneOpen"
			focusItem="browser"
			browserAttentionCount={2}
		/>
	),
};

/** The capped badge on the LIT item (D4): the mark, the lit ground and the bar together. */
export const BrowserOpenAtCap: Story = {
	render: () => <Rail open="isBrowserPaneOpen" browserAttentionCount={12} />,
};

/** The console's blip while its own pane is open (the item is lit and the dot still draws). */
export const ConsoleOpenBlip: Story = {
	render: () => (
		<Rail
			open="isConsolePaneOpen"
			consoleLiveCount={1}
			consoleUnseenCount={1}
			consoleUnseenPulsing={true}
		/>
	),
};

/**
 * THE UNREAD DOT WITHOUT A LIVE SURFACE (D4): the state the operator reported. The
 * item is unlit because nothing is running, and the dot still says a terminal in
 * this conversation finished since the user last looked.
 */
export const ConsoleUnreadDot: Story = {
	render: () => (
		<Rail
			open="isConsolePaneOpen"
			consoleLiveCount={0}
			consoleUnseenCount={1}
			consoleUnseenPulsing={false}
		/>
	),
};

/*
 * THE CODE REVIEW DOOR (built spec §8, manager decision §M.1): LAST, so nothing
 * above it moves, with the attention dot on a real open row with checks failing
 * or findings open.
 */
/** Quiet: counts in the name, no dot. */
export const CodeItem: Story = {
	render: () => <Rail codeOpened={2} codeMentioned={1} />,
};

/** With the attention dot: an open row's checks are failing (U6's cause). */
export const CodeAttention: Story = {
	render: () => (
		<Rail codeOpened={2} codeMentioned={1} codeAttention={"checks failing"} />
	),
};

/** The door lit: the code review pane is the drawn occupant. */
export const CodeOpen: Story = {
	render: () => (
		<Rail open="isCodeReviewPaneOpen" codeOpened={2} codeMentioned={1} />
	),
};

/**
 * THE ASKS ITEM (#896). The door that used to live in the chat header, second in
 * the rail - its historical slot, the pre-#872 header order's (Run -> Asks ->
 * Browser -> Console -> Canvas). Same tag (`ask-pane-trigger`, the drawer's
 * focus-return anchor and Escape door), same scope split, and `data-ask-scope` on
 * the element so the scope-legibility claim (UX round 1, U3) is assertable here
 * rather than read off pixels - a rig compares the attribute AND the glyph between
 * the session and fleet frames.
 */

/** The door offered at ZERO asks: the state the operator asked to keep visible -
 * the entry point is a door to the surface, not a badge, and no number draws. */
export const AsksQuiet: Story = {
	render: () => <Rail />,
};

/** The count, in a CONVERSATION context: the badge draws 3 and the name keeps the
 * exact number (the glyph's cap is `9+`; the sentence is uncapped). */
export const AsksWaiting: Story = {
	render: () => <Rail askCount={3} />,
};

/** AND AT THE TOP LEVEL: the same control carrying the whole fleet's count, the
 * scope glyph saying so where the header's trigger said it (`MessagesSquare`). */
export const AsksFleet: Story = {
	render: () => <Rail askCount={11} askScope="fleet" />,
};

/**
 * THE ITEM LIT WHILE ITS DRAWER HOLDS THE SLOT (#896): the state the header could
 * not show on the rail - before the move the rail lit NOTHING while the drawer was
 * up, and the count stays drawn while open, as it did in the header.
 */
export const AsksOpen: Story = {
	render: () => <Rail open="isAskDrawerOpen" askCount={3} />,
};

/**
 * THE BOUND CHORD IN BOTH REGISTERS (issue #928): the console ships
 * `primary+j`, so its tooltip AND its accessible name print the chord — `Ctrl+J`
 * in this harness, `⌘J` where the chrome facts say mac. The capture rig hovers
 * the item; the tooltip opens LEFT, which is why this state widens the frame.
 */
export const ConsoleChordTooltip: Story = {
	render: () => <Rail frameWidth={360} />,
};

/**
 * THE UNBOUND STATE (issue #928): an action with no chord prints NO parens at
 * all. The browser ships unbound, and its tooltip is the sentence it always
 * was — the pair to `ConsoleChordTooltip`, one frame each.
 */
export const BrowserNoChord: Story = {
	render: () => <Rail frameWidth={360} />,
};
