import type { Meta, StoryObj } from "@storybook/react";
import { BrowserPageMenu } from "./browser-page-menu";
import { BrowserUrlBar } from "./browser-url-bar";

/**
 * S4b's address chrome in its two placements.
 *
 * The popout is the product surface: a 37px field row painted over the tab strip,
 * with the native suggestion list below it (not part of this frame — a native
 * `WebContentsView` cannot be captured in Storybook). The bar is the Tier 2
 * fallback: an in-flow 41px row with Back, Forward, Reload/Stop, Home and the
 * field, no dock and no suggestions. Both report `overlayMode`, so a frame can
 * show the Tier 1 field-only state too.
 */

const menu = (
	<BrowserPageMenu
		placement="popout"
		disabled={false}
		loading={false}
		canGoBack
		canGoForward={false}
		pageZoom={1}
		waitingCount={0}
		downloadsDir={null}
		onAddress={() => {}}
		onBack={() => {}}
		onForward={() => {}}
		onReload={() => {}}
		onStop={() => {}}
		onHome={() => {}}
		onFind={() => {}}
		onPrint={() => {}}
		onResetZoom={() => {}}
		onOpenDownloads={() => {}}
		onOpenApprovals={() => {}}
	/>
);

const common = {
	tabId: 1,
	url: "https://login.example.com/session",
	pendingUrl: null,
	loading: false,
	canGoBack: true,
	canGoForward: false,
	disabled: false,
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

/** The raised product row: 37px, navigation cluster, field and the page menu. */
export const Popout: Story = {
	args: {
		...common,
		placement: "popout",
		overlayMode: "popout",
		anchor: { x: 0, width: 1120 },
		menu,
	},
};

/** Tier 1: the native list is unavailable, so the field still works and the
 * placeholder carries the one sentence the user needs. Nothing reflows. */
export const PopoutListUnavailable: Story = {
	args: {
		...common,
		placement: "popout",
		overlayMode: "suspend",
		anchor: { x: 0, width: 1120 },
		menu,
	},
};

/** Tier 2: the popout could not take focus, so the same component sits in the
 * flow. One 41px shift; no dock, no suggestions. */
export const BarFallback: Story = {
	args: {
		...common,
		placement: "bar",
		overlayMode: "suspend",
		anchor: null,
	},
};
