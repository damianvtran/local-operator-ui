import type { Meta, StoryObj } from "@storybook/react";
import { BrowserPageMenu } from "./browser-page-menu";
import { BrowserUrlBar } from "./browser-url-bar";

/**
 * The permanent address row (S5).
 *
 * One 37px in-flow band: Back, Forward, Reload/Stop, Home, the field with its
 * site mark, the fixed 28px Approvals control and the overflow menu. The native
 * suggestion list is a child view and is not part of these frames — a native
 * `WebContentsView` cannot be captured in Storybook, and painting a DOM stand-in
 * would be a claim about pixels this harness cannot make.
 *
 * `overlayMode="suspend"` is the Tier 1 state (the child is unavailable on
 * Windows/Linux or after a failure): the field still works and the sentence is
 * painted inside its trailing edge.
 */

const menu = (
	<BrowserPageMenu
		disabled={false}
		canGoForward={false}
		pageZoom={1}
		waitingCount={0}
		downloadsDir={null}
		showForward={false}
		showHome={false}
		onForward={() => {}}
		onHome={() => {}}
		onFind={() => {}}
		onPrint={() => {}}
		onResetZoom={() => {}}
		onOpenDownloads={() => {}}
		onOpenApprovals={() => false}
		showApprovalsFolded={false}
		canControlPage
	/>
);

const common = {
	tabId: 1,
	url: "https://login.example.com/session",
	pendingUrl: null,
	canGoBack: true,
	canGoForward: false,
	disabled: false,
	loading: false,
	onNavigate: () => {},
	onBack: () => {},
	onForward: () => {},
	onReload: () => {},
	onStop: () => {},
	onHome: () => {},
} as const;

const meta = {
	title: "Browser/Address chrome",
	component: BrowserUrlBar,
	decorators: [
		(Story) => (
			<div className="bg-canvas p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof BrowserUrlBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Rest: the live URL is the value; nothing is focused. */
export const Rest: Story = {
	args: {
		...common,
		overlayMode: "popout",
		anchor: { x: 0, width: 1120 },
		menu,
	},
};

/** Loading: Reload becomes Stop in the same slot and a trailing spinner shows. */
export const Loading: Story = {
	args: {
		...common,
		loading: true,
		overlayMode: "popout",
		anchor: { x: 0, width: 1120 },
		menu,
	},
};

/** Tier 1: the list is unavailable; the sentence lives inside the field. */
export const ListUnavailable: Story = {
	args: {
		...common,
		overlayMode: "suspend",
		anchor: { x: 0, width: 1120 },
		menu,
	},
};

/** Narrow pane: Home folds into the overflow below 360px, Forward below 300. */
export const Narrow: Story = {
	args: {
		...common,
		hideForward: true,
		hideHome: true,
		overlayMode: "popout",
		anchor: { x: 0, width: 330 },
		menu: (
			<BrowserPageMenu
				disabled={false}
				canGoForward
				pageZoom={1}
				waitingCount={2}
				downloadsDir={null}
				showForward
				showHome
				onForward={() => {}}
				onHome={() => {}}
				onFind={() => {}}
				onPrint={() => {}}
				onResetZoom={() => {}}
				onOpenDownloads={() => {}}
				onOpenApprovals={() => false}
				showApprovalsFolded={false}
				canControlPage
			/>
		),
	},
};
