import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import type { BrowserTabView } from "../hooks/use-browser-chrome";
import { BrowserTabStrip } from "./browser-tab-strip";

/**
 * The tab strip in every state the review round has to judge, including the ones
 * that only exist because of the operator's "I don't see any work" report
 * (docs/design/browser-approval-ux.md 6, 8.3).
 *
 * WHY THE STRIP NEEDS SPECIMENS. It is entirely ordinary DOM — the native page
 * under it is not — so a design review of the grammar (a sheet of paper in a well
 * rather than a row of buttons), of the four chips, and of the reveal/timing rules
 * can only happen here. The live route's frames come from
 * `browser-chrome-proof.mjs`, which composes the strip with a real page and asserts
 * the RECT; this file is where the states are enumerated.
 *
 * THE FIXTURES CARRY `loading` PER TAB, because that is the field the strip reads:
 * a background agent tab that is loading shows a spinner, which is the only signal
 * a parked tab can give — an agent tab is created non-active and only the active
 * tab occupies the content rectangle. The `loading` fixture below is therefore not
 * a detail of the frame, it is the claim.
 */

const tab = (
	tabId: number,
	title: string,
	overrides: Partial<BrowserTabView> = {},
): BrowserTabView => ({
	tabId,
	title,
	url: `https://${title.toLowerCase().replace(/\s+/g, "-")}.example.com`,
	owner: "user",
	active: false,
	restored: false,
	handedOver: false,
	failed: false,
	loading: false,
	...overrides,
});

const strip = (
	tabs: BrowserTabView[],
	activeTabId: number | null,
	waiting: Record<number, number> = {},
) => ({
	tabs,
	activeTabId,
	waiting,
	onActivate: () => {},
	onClose: () => {},
	onNewTab: () => {},
	onHandOver: () => {},
	onRevokeHandOver: () => {},
});

/** A ground under the strip, so the active tab's notch — the 1px of `canvas` that
 * makes the tab continuous with the page — is a thing the frame can show. Without
 * it the frame ends at the strip's rule and the claim is untestable. */
const decorators: Meta<typeof BrowserTabStrip>["decorators"] = [
	(Story) => (
		<div className="flex flex-col bg-canvas">
			<Story />
			<div className="h-16 bg-canvas" />
		</div>
	),
];

/** Top-level because Biome forbids a regex literal inside a function, and the
 * label is the same string the trigger's `aria-label` is built from. */
const TAB_ACTIONS_LABEL = /^Tab actions for /;

const meta = {
	title: "Browser/Tab strip",
	component: BrowserTabStrip,
	decorators,
} satisfies Meta<typeof BrowserTabStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One tab: the strip must not look broken with a single entry (spec 7.4 names
 * this as a state the pane has to survive, and it is the same component). */
export const One: Story = {
	args: strip([tab(1, "Docs")], 1),
};

/** Six tabs, the second active: the ordinary working state, and where the
 * inactive grammar — no fill, a `hairline` between neighbours — is visible. */
export const Many: Story = {
	args: strip(
		[
			tab(1, "Dashboard"),
			tab(2, "Docs"),
			tab(3, "Pricing"),
			tab(4, "Login"),
			tab(5, "Support"),
			tab(6, "Status"),
		],
		2,
	),
};

/**
 * Twelve tabs with titles long enough to truncate: the row scrolls rather than
 * shrinking tabs below the width at which a name is readable (D13).
 *
 * THE TITLES DIFFER IN THEIR FIRST WORD (design round 3, D18). They used to share
 * `Release notes for the `, so a frame whose whole point is what survives truncation
 * showed twelve textually identical tabs: the measurement proved the width and the
 * picture could not. `Spring release notes` and its siblings put the distinguishing
 * word where the truncation leaves it.
 */
export const Overflowing: Story = {
	args: strip(
		Array.from({ length: 12 }, (_, index) =>
			tab(
				index + 1,
				`${["Spring", "Summer", "Autumn", "Winter", "Budget", "Roadmap"][index % 6]} release notes`,
			),
		),
		10,
	),
};

/** A tab parked on an origin the agent has not been approved for: `Waiting 2` is
 * the ordinal of the live request, the same number the tray's chip and the dock's
 * row carry. */
export const Waiting: Story = {
	args: strip([tab(1, "Dashboard"), tab(2, "Docs"), tab(3, "Login")], 1, {
		3: 2,
	}),
};

/** THE §8.3 STATE, and the reason this file exists: an agent tab that is loading
 * in the BACKGROUND shows a spinner, beside an agent tab that is parked and a
 * waiting tab. Before this round the spinner was gated on the ACTIVE tab, so this
 * frame would have shown two idle agent tabs and nothing else. */
export const AgentAndWaiting: Story = {
	args: strip(
		[
			tab(1, "Dashboard"),
			tab(2, "Quarterly report", {
				owner: "agent",
				loading: true,
				url: "https://reports.example.com/quarterly",
			}),
			tab(3, "Login", { owner: "agent" }),
			tab(4, "Checkout", { handedOver: true }),
		],
		1,
		{ 4: 1 },
	),
};

/** A background tab whose main-frame load was refused: the one carrier of that
 * state, because the failure panel belongs to the active tab and the page area is
 * blank (design round 1, D1). */
export const Failed: Story = {
	args: strip(
		[tab(1, "Dashboard"), tab(2, "Reports", { owner: "agent", failed: true })],
		1,
	),
};

/** A restored tab: a FRESH navigation to a remembered URL, so the chip pre-empts
 * the "why am I signed out" question (design 7.3). */
export const Restored: Story = {
	args: strip([tab(1, "Dashboard"), tab(2, "Inbox", { restored: true })], 1),
};

/** The row's actions expanded IN THE BAND — the fix for a menu that painted
 * downward into the content rect, where the native view occludes it. The strip
 * grows by this row; the page shrinks by the same amount, which is why there is no
 * suppression and no z-index in this design. The `play` function clicks the same
 * trigger a person clicks, so the frame is the product's own state rather than a
 * prop this story could set. */
export const ActionsExpanded: Story = {
	args: strip([tab(1, "Dashboard"), tab(2, "Reports"), tab(3, "Login")], 1),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const triggers = await canvas.findAllByLabelText(TAB_ACTIONS_LABEL);
		await userEvent.click(triggers[1]);
	},
};
