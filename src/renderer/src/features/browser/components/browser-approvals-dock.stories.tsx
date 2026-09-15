import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentProps } from "react";
import type { ApprovalRequestInput } from "../model/approval-queue-model";
import { approvalRows } from "../model/approval-queue-model";
import { BrowserApprovalsDock } from "./browser-approvals-dock";

/**
 * The approvals dock, in the states the review round has to judge.
 * Design: docs/design/browser-approval-ux.md 4.2 (the dock), 5.2 (the ordinal),
 * 8.2 in §10.2 (the states that must exist as frames).
 *
 * WHY THE DOCK NEEDS STORYBOOK EVIDENCE RATHER THAN A ROUTE CAPTURE. It is
 * ordinary DOM — a list of rows — and its whole claim is a reading: which sites an
 * agent may act on as the user, what is waiting, what was refused, and the three
 * destructive affordances that look alike and are not. A native page beside it
 * would tell a reviewer nothing and would need a real site to exist. The live
 * route's frames come from `browser-chrome-proof.mjs`, which composes them with a
 * real page and asserts the RECT — the one claim a Storybook frame cannot make.
 *
 * The `narrow` story is the width floor (§4.2): 20rem below a 1280px surface,
 * which is what the pane in PR 2 will actually be near. It is captured as its own
 * frame because the rows' copy and the buttons' wrap are the things that break,
 * and they break silently in a wide frame.
 */

const NOW = Date.now();

function request(
	entryId: string,
	authority: string,
	minutesLeft: number,
	requesterSessionId: string | null = "session-1f4c",
): ApprovalRequestInput {
	return {
		entryId,
		origin: `https://${authority}`,
		authority,
		broad: { scope: "domain", key: authority.split(".").slice(-2).join(".") },
		expiresAt: NOW + Math.round(minutesLeft * 60_000),
		requesterSessionId,
	};
}

const WAITING = [
	request("waiting-1", "login.example.com", 9),
	request("waiting-2", "docs.example.org", 6),
];

const APPROVALS = [
	{
		origin: "https://login.example.com",
		scope: "origin" as const,
		grantedAt: NOW - 60_000,
	},
	{
		origin: "https://example.com",
		scope: "domain" as const,
		grantedAt: NOW - 3_600_000,
	},
	{
		origin: "https://docs.example.org",
		scope: "session" as const,
		grantedAt: NOW - 120_000,
	},
];

const DENIED = [
	{
		origin: "https://ads.example.net",
		scope: "deny" as const,
		grantedAt: NOW - 900_000,
	},
];

const dock = (
	overrides: Partial<ComponentProps<typeof BrowserApprovalsDock>> = {},
) => ({
	open: true,
	rows: [] as ReturnType<typeof approvalRows>,
	resolved: [],
	selectedEntryId: null,
	onSelect: () => {},
	busy: false,
	onDecide: () => {},
	approvals: [],
	currentOrigin: null,
	onRevoke: () => {},
	onRevokeAll: () => {},
	onForgetSite: () => {},
	onClearData: () => {},
	onClose: () => {},
	surfaceTag: "browser-approvals-dock",
	...overrides,
});

const meta = {
	title: "Browser/Approvals dock",
	component: BrowserApprovalsDock,
	// The dock is a full-height in-flow column, so the story gives it a height to
	// fill: without one the frame would be a strip of text with no panel around it.
	decorators: [
		(Story) => (
			<div className="flex h-[720px] items-stretch bg-canvas">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof BrowserApprovalsDock>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Two waiting, the first selected and expanded into its card — the state the
 * queue's whole design turns on. The leading chip is the ordinal the tray's chip
 * and the tab's `Waiting n` chip carry. */
export const Waiting: Story = {
	args: dock({
		rows: approvalRows(WAITING, NOW),
		selectedEntryId: "waiting-1",
		approvals: APPROVALS,
		currentOrigin: "https://login.example.com",
	}),
};

/** Grants without a queue: what the sheet used to be, in its new host, with the
 * approved count in the header rather than on the control. */
export const Approved: Story = {
	args: dock({
		approvals: APPROVALS,
		currentOrigin: "https://login.example.com",
	}),
};

/** The refusal list on its own, which is the other reading of the same store: the
 * agent stops asking about these, and revoking a denial lets it ask again. */
export const Denied: Story = {
	args: dock({ approvals: DENIED }),
};

/** Nothing granted, nothing denied, nothing waiting: the first-run state, which
 * still has to explain the three affordances that look alike and are not. */
export const Empty: Story = {
	args: dock({}),
};

/** The 320px width the pane will actually be near (§4.2's floor). The dock's own
 * width classes are the product's — `w-80` below a 1280px surface — so this story
 * is CAPTURED in a narrow viewport (see `scripts/capture-evidence.mjs`) rather
 * than being forced narrow here: what breaks at 320 is the rows' copy and the
 * button rows, and they only break at the width the product actually gives them. */
export const Narrow: Story = {
	args: dock({
		rows: approvalRows(WAITING, NOW),
		selectedEntryId: "waiting-2",
		approvals: APPROVALS,
		currentOrigin: "https://docs.example.org",
	}),
};
