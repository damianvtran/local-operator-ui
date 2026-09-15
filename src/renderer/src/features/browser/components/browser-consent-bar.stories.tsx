import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC, ReactNode } from "react";
import { useEffect } from "react";
import type { PendingConsentView } from "../hooks/use-browser-chrome";
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
 * Seeding happens in an effect rather than at module scope: a store written at
 * import time would leak into every later story in the same Storybook session,
 * and these frames are compared against each other.
 */

const PENDING: PendingConsentView = {
	entryId: "specimen-1",
	origin: "https://login.example.com",
	authority: "login.example.com",
	broad: { scope: "domain", key: "example.com" },
	expiresAt: Date.now() + 600_000,
	requesterSessionId: "session-1f4c",
};

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

const meta = {
	title: "Browser/Consent bar",
	component: BrowserConsentBar,
} satisfies Meta<typeof BrowserConsentBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The ordinary case: one request, the broad option offered because the host
 * computed its domain key, and every choice's own lifetime stated beneath it.
 */
export const Pending: Story = {
	args: { pending: PENDING, waitingBehind: 0, busy: false, onDecide: () => {} },
	render: (args) => (
		<div className="bg-canvas p-6">
			<BrowserConsentBar {...args} />
		</div>
	),
};

/**
 * The attribution case D2 is about, at its hardest: a request that is NOT the
 * oldest in the queue, and one the user arrived at from a notification. The band
 * names the conversation that asked and says how many others are waiting, so a
 * click on a banner cannot leave the user answering the wrong agent's request.
 */
export const AttributedAndQueued: Story = {
	args: {
		pending: PENDING,
		waitingBehind: 2,
		busy: false,
		onDecide: () => {},
	},
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
	args: {
		pending: { ...PENDING, broad: null },
		waitingBehind: 0,
		busy: false,
		onDecide: () => {},
	},
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
	args: {
		pending: { ...PENDING, requesterSessionId: null },
		waitingBehind: 0,
		busy: false,
		onDecide: () => {},
	},
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
	args: { pending: PENDING, waitingBehind: 0, busy: true, onDecide: () => {} },
	render: (args) => (
		<div className="bg-canvas p-6">
			<BrowserConsentBar {...args} />
		</div>
	),
};
