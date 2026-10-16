import type { Meta, StoryObj } from "@storybook/react";
import { BrowserNewTab } from "./browser-new-tab";

/**
 * A fresh tab's start surface (LOH-13 slice B).
 *
 * WHY THIS IS A STORY RATHER THAN A SCREENSHOT OF THE ROUTE. The page is DOM
 * painted under a hidden native view, and no browser tool can compose the two
 * (the same limit `browser-load-failure.stories.tsx` records), so a frame of
 * this component is the honest evidence for its copy and hierarchy; that the
 * surface appears *because* the active tab is on `about:blank` is pinned in
 * `scripts/browser-chrome.test.mjs`, against the shipped component.
 */

const meta = {
	title: "Browser/New tab",
	component: BrowserNewTab,
} satisfies Meta<typeof BrowserNewTab>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The state every new tab and every Home press lands on. */
export const StartPage: Story = {
	args: {
		onNavigate: () => {},
	},
	render: (args) => (
		<div className="h-96 bg-canvas">
			<BrowserNewTab {...args} />
		</div>
	),
};
