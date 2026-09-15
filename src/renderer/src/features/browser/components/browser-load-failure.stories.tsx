import type { Meta, StoryObj } from "@storybook/react";
import { BrowserLoadFailure } from "./browser-load-failure";

/**
 * A refused navigation, as the chrome now paints it (design round 1, D1).
 *
 * WHY THIS IS A STORY RATHER THAN A SCREENSHOT OF THE ROUTE. The panel is DOM, but
 * the thing it replaces — Chromium's own blank surface for a refused main-frame
 * load — lives in the native view, and no browser tool can compose the two (U1).
 * A frame of this component is therefore the honest evidence for the panel's copy,
 * its hierarchy and its retry; that the panel appears *because* the host recorded
 * a refusal is measured in `scripts/browser-chrome-proof.mjs`, against the running
 * app, and stated as such.
 */

const meta = {
	title: "Browser/Load failure",
	component: BrowserLoadFailure,
} satisfies Meta<typeof BrowserLoadFailure>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The refusal the round-1 review's own frame recorded: nothing listening. */
export const ConnectionRefused: Story = {
	args: {
		failure: {
			code: -102,
			description: "ERR_CONNECTION_REFUSED",
			url: "http://127.0.0.1:9/",
		},
		onRetry: () => {},
	},
	render: (args) => (
		<div className="h-96 bg-canvas">
			<BrowserLoadFailure {...args} />
		</div>
	),
};

/**
 * The other refusal a person meets daily, and the one whose sentence must not be
 * about a connection being refused.
 */
export const NameNotResolved: Story = {
	args: {
		failure: {
			code: -105,
			description: "ERR_NAME_NOT_RESOLVED",
			url: "https://this-host-does-not-exist.example/",
		},
		onRetry: () => {},
	},
	render: (args) => (
		<div className="h-96 bg-canvas">
			<BrowserLoadFailure {...args} />
		</div>
	),
};

/**
 * A code with no sentence written for it: the panel says the one thing that is
 * always true rather than inventing a cause, and still shows the machine's own
 * words for a bug report.
 */
export const UnmappedCode: Story = {
	args: {
		failure: {
			code: -2,
			description: "ERR_FAILED",
			url: "https://flaky.example/dashboard",
		},
		onRetry: () => {},
	},
	render: (args) => (
		<div className="h-96 bg-canvas">
			<BrowserLoadFailure {...args} />
		</div>
	),
};
