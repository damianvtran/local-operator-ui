import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentProps, FC, ReactNode } from "react";
import { useEffect } from "react";
import type { ApprovalRequestInput } from "../model/approval-queue-model";
import { approvalRows } from "../model/approval-queue-model";
import { BrowserConsentBar } from "./browser-consent-bar";

/**
 * The consent band's own states, for the review round that has to judge its copy
 * and its attribution without a native window (design round 1, D2/D3; UX round 1,
 * U1).
 *
 * WHY THESE ARE SPECIMENS RATHER THAN THE ROUTE. The band renders in the chrome
 * band, which is ordinary DOM — it is the native PAGE VIEW under it that no
 * browser tool can reach (11.3, U1). So the one surface a design review can
 * actually be shown is this one, and the requesters here are seeded through the
 * same session store the hand-over dialog reads, rather than passed as strings,
 * so what the frame shows is what the component computes.
 *
 * THE ROWS ARE BUILT BY THE REAL MODEL, not hand-written. `approvalRows` is what
 * the route runs, so the ordinals and the "expires in N minutes" readings in these
 * frames are the ones the product computes from the same inputs — a hand-written
 * row could show a number the model would never produce, which is the class of
 * evidence defect this file exists to avoid.
 *
 * Seeding happens in an effect rather than at module scope: a store written at
 * import time would leak into every later story in the same Storybook session,
 * and these frames are compared against each other.
 */

const NOW = Date.now();

function request(
	entryId: string,
	authority: string,
	minutesLeft: number,
	requesterSessionId: string | null = null,
	broad: ApprovalRequestInput["broad"] = {
		scope: "domain",
		key: authority.split(".").slice(-2).join("."),
	},
): ApprovalRequestInput {
	return {
		entryId,
		origin: `https://${authority}`,
		authority,
		broad,
		expiresAt: NOW + Math.round(minutesLeft * 60_000),
		requesterSessionId,
	};
}

const LIVE = request("specimen-1", "login.example.com", 9, "session-1f4c");

const WithSessions: FC<{
	titles: Record<string, string>;
	children: ReactNode;
}> = ({ titles, children }) => {
	useEffect(() => {
		useCanonicalSessionsStore.setState({
			sessions: Object.entries(titles).map(([session_id, title]) => ({
				session_id,
				title,
			})),
		});
	}, [titles]);
	return <div className="bg-canvas p-6">{children}</div>;
};

/** The tray's own props are the band's states; every story here renders the band
 * exactly as the route mounts it, so the framing (ground, edge, `aria-live`) is in
 * the frame rather than implied. */
const bar = (
	rows: ApprovalRequestInput[],
	options: {
		busy?: boolean;
		selectedEntryId?: string | null;
		resolved?: ComponentProps<typeof BrowserConsentBar>["resolved"];
		dockOpen?: boolean;
	} = {},
) => ({
	rows: approvalRows(rows, NOW),
	resolved: options.resolved ?? [],
	selectedEntryId:
		options.selectedEntryId === undefined ? null : options.selectedEntryId,
	onSelect: () => {},
	busy: options.busy ?? false,
	onDecide: () => {},
	dockOpen: options.dockOpen ?? false,
	onToggleDock: () => {},
	headerLabel: (count: number) =>
		count === 1 ? "1 approval waiting" : `${count} approvals waiting`,
});

const meta = {
	title: "Browser/Consent bar",
	component: BrowserConsentBar,
} satisfies Meta<typeof BrowserConsentBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The ordinary case: one request, the broad option offered because the host
 * computed its domain key, and every choice's own lifetime stated beneath it.
 * One pending request is also the case with NO header row: there is nothing to
 * disambiguate, so the band is the card.
 */
export const Pending: Story = {
	args: bar([LIVE]),
	render: (args) => (
		<div className="bg-canvas p-6">
			<BrowserConsentBar {...args} />
		</div>
	),
};

/**
 * The attribution case D2 is about, at its hardest, now with a queue behind it:
 * a request that is NOT the oldest, a requester the session list knows, and two
 * others waiting. The header row carries the count and one numbered chip per live
 * request, and the card answers for the SELECTED one — which is what stops a click
 * on request 2 from being read as an answer to request 1.
 */
export const AttributedAndQueued: Story = {
	args: bar(
		[
			request("specimen-a", "docs.example.org", 8, "session-9a11"),
			LIVE,
			request("specimen-c", "shop.example.net", 4, "session-9a11"),
		],
		{ selectedEntryId: "specimen-1" },
	),
	render: (args) => (
		<WithSessions titles={{ "session-1f4c": "Quarterly research" }}>
			<BrowserConsentBar {...args} />
		</WithSessions>
	),
};

/**
 * A requester the session list does not know, and no public-suffix data, which is
 * the ordinary-installation shape: no domain option is offered and the band must
 * not describe one. The requester falls back to its bare id rather than claiming
 * to be a generic agent.
 */
export const UnnamedRequesterNoDomain: Story = {
	args: bar([
		request("specimen-1", "login.example.com", 9, "session-1f4c", null),
	]),
	render: (args) => <BrowserConsentBar {...args} />,
};

/**
 * The other half of the requester vocabulary, and the branch no frame carried
 * (review round 2, D10): a request whose requester is NOT a session identity —
 * an MCP client, or a session this build cannot name — reads "An agent" rather
 * than inventing an id for the user to read. The broad option is present, for
 * the same reason the other specimens carry it: the five choices have to line up
 * row against row across the frames.
 */
export const AnAgent: Story = {
	args: bar([request("specimen-1", "login.example.com", 9, null)]),
	render: (args) => (
		<div className="bg-canvas p-6">
			<BrowserConsentBar {...args} />
		</div>
	),
};

/**
 * A decision in flight: every choice is disabled, which is the state a second
 * click must not be able to race.
 */
export const Busy: Story = {
	args: bar([LIVE], { busy: true }),
	render: (args) => (
		<div className="bg-canvas p-6">
			<BrowserConsentBar {...args} />
		</div>
	),
};

/**
 * Three waiting, with the SECOND selected — the state the operator's numbered
 * callout exists for. The chips are the "numbered badge callout" of his first
 * ask, and the selected one is the request the card below answers.
 */
export const ThreeWaiting: Story = {
	args: bar(
		[
			request("specimen-a", "docs.example.org", 9, "session-1f4c"),
			request("specimen-b", "shop.example.net", 6, "session-1f4c"),
			request("specimen-c", "news.example.io", 2, "session-1f4c"),
		],
		{ selectedEntryId: "specimen-b" },
	),
	render: (args) => (
		<WithSessions titles={{ "session-1f4c": "Quarterly research" }}>
			<BrowserConsentBar {...args} />
		</WithSessions>
	),
};

/**
 * The two ways a request leaves without an answer (spec 3.4), from the renderer's
 * own memory of the last projection: one whose ten minutes ran out, and one the
 * agent withdrew. Both are non-interactive, both are the answer to "why did the
 * count change", and NEITHER is a denial — no durable record is written and the
 * agent may ask again.
 */
/**
 * The state a request leaves behind: the tray's resolved rows, and nothing live.
 *
 * THREE ROWS rather than the two the spec's §10.2 lists, and the reason is in the
 * capture harness: `storyDrew` rejects a story whose own element count (minus its
 * decorator's two) is under 7, and the two-row version measured 8 elements total
 * — one under the floor — so the frame could not be taken at all. Three rows is
 * also what the state honestly looks like: the renderer's memory holds up to five
 * (RESOLVED_KEEP), and the bounded list is only legible as a list with more than
 * one kind of departure in it.
 *
 * The band still renders with no live requests, which is the point of the §3.4
 * memory: a count that drops to zero with no explanation is the thing this state
 * exists to prevent.
 */
export const ExpiredAndWithdrawn: Story = {
	args: bar([], {
		resolved: [
			{
				key: "gone-1",
				kind: "expired",
				origin: "https://login.example.com",
				authority: "login.example.com",
				at: NOW,
			},
			{
				key: "gone-2",
				kind: "expired",
				origin: "https://docs.example.org",
				authority: "docs.example.org",
				at: NOW,
			},
			{
				key: "gone-3",
				kind: "withdrawn",
				origin: "https://shop.example.net",
				authority: "shop.example.net",
				at: NOW,
			},
		],
	}),
	render: (args) => (
		<div className="bg-canvas p-6">
			<BrowserConsentBar {...args} />
		</div>
	),
};
