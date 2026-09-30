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

/**
 * THE DESTINATION EVERY RESTORE-DEATH FAILED CHIP OPENS (round-1 design D2):
 * the app started this tab's load at relaunch, no page ever committed, and the
 * bounded wait expired — the `ERR_FAILED (restore)` mark `host.ts` records. The
 * sentence is the timeout's ("The site did not answer in time."), because that
 * is what this wait expiring means; the machine line keeps the description for
 * a bug report. This frame is the panel the reviewer could not photograph from
 * the harness run, where the chip is the visible half and this is the surface
 * behind it.
 */
export const RestoreUnanswered: Story = {
	args: {
		failure: {
			code: -2,
			description: "ERR_FAILED (restore)",
			url: "http://127.0.0.1:3417/stall-0",
		},
		onRetry: () => {},
	},
	render: (args) => (
		<div className="h-96 bg-canvas">
			<BrowserLoadFailure {...args} />
		</div>
	),
};
