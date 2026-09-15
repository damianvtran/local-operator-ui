import type { Meta, StoryObj } from "@storybook/react";
import { BrowserUrlBar } from "./browser-url-bar";

/**
 * The control that OPENS the extensions sheet, which is what design round 1 (D1)
 * found unrendered: `docs/evidence/` held frames of the sheet in five states and
 * no frame anywhere of the surface a user has to reach it from.
 *
 * WHY IT IS WORTH A FRAME RATHER THAN A SENTENCE. The `Extensions` control is a
 * `ghost` button sitting immediately right of `Sites`, which is an `outline`
 * button carrying a count badge. That pair is a hierarchy claim — one control is
 * a bordered control with state, the other is a bare label next to it — and a
 * claim about hierarchy is judged by looking at it, in every theme, which is the
 * whole reason `capture-evidence.mjs` re-photographs these surfaces per palette.
 * Before this story, the only statement that the button exists at all was in the
 * component's source.
 *
 * WHAT THIS FRAME IS NOT: it is the chrome row, not the sheet, and nothing here
 * loads an extension. The sheet's own states — including the destructive
 * confirmation and the in-flight state — are the `browser-extensions-sheet--*`
 * stories beside it. Driving the whole flow (chooser → trust dialog → load) needs
 * the live app, and its UX review is blocked on the dev harness named in the PR.
 *
 * `approvalCount` is 2 so the `Sites` badge renders: the badge is the one part
 * of this row whose spacing against its neighbour moved when the second control
 * was added, and a frame of the row without it would not show that.
 */

const meta = {
	title: "Browser/Url bar",
	component: BrowserUrlBar,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BrowserUrlBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A committed page, one entry of history behind it, and no pending navigation:
 * the resting state a user is in when they reach for the extensions sheet. */
export const ExtensionsEntry: Story = {
	args: {
		url: "https://example.com/dashboard",
		pendingUrl: null,
		loading: false,
		canGoBack: true,
		canGoForward: false,
		disabled: false,
		approvalCount: 2,
		onNavigate: () => {},
		onBack: () => {},
		onForward: () => {},
		onReload: () => {},
		onStop: () => {},
		onOpenSites: () => {},
		onOpenExtensions: () => {},
	},
	render: (args) => (
		<div className="h-full bg-canvas">
			<BrowserUrlBar {...args} />
		</div>
	),
};
