import type { Meta, StoryObj } from "@storybook/react";
import { BrowserUrlBar } from "./browser-url-bar";

/**
 * The URL bar and its Approvals control, in the three states the badge has
 * (docs/design/browser-approval-ux.md 5): no requests, one, three.
 *
 * WHY THE CONTROL NEEDS ITS OWN FRAMES. The badge is a requirement the operator
 * asked for twice, and its whole claim is a reading: the count sits at the
 * control's corner, `warningWash` with a `border-control` edge, and it does not
 * shove the label. A frame is the only thing that shows whether "Approvals" is
 * still legible under it — the contrast contract can prove the triple, not the
 * layout.
 *
 * The bar is captured against `canvas`, which is the ground it renders on in the
 * route (the banner above the page). The chat pane's header is the other ground
 * the badge appears on, and it is `surface`; both are asserted by the
 * `browser approvals badge` row in `scripts/contrast-contract.mjs`.
 */

const bar = (waitingCount: number) => ({
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
	onOpenApprovals: () => {},
	waitingCount,
});

const meta = {
	title: "Browser/URL bar",
	component: BrowserUrlBar,
	/* The badge sits half outside the control's box, so the story needs a little
	   room around it: without padding the frame would clip the number the frame
	   exists to show. */
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

/** Nothing is being asked, so there is no badge at all — the honest rendering
 * rather than a zero, which would read as a count of something. */
export const NoBadge: Story = {
	args: bar(0),
};

/** One request waiting: the common case, and the narrowest the badge gets. */
export const OneWaiting: Story = {
	args: bar(1),
};

/** Three waiting: the number the operator's queue exists to make visible. */
export const ThreeWaiting: Story = {
	args: bar(3),
};

/**
 * TWO DIGITS, the state that makes the badge's geometry load-bearing.
 *
 * The badge is `min-w-4` and grows with the number, anchored at the control's
 * inner top-right corner; at one digit it is 18px and at two it is ~24px. This is
 * the frame a reviewer needs to see that the wider pill still sits inside the URL
 * bar's own box rather than over its right edge (design round 2, D3 asked for it
 * by name), and it is the state a busy machine reaches in a minute.
 */
export const TwoDigits: Story = {
	args: bar(12),
};
