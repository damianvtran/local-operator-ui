import type { Meta, StoryObj } from "@storybook/react";
import { TeamBridgeInvitationsView } from "./team-bridge-invitations";
import type { TeamBridgeInvitation } from "./team-bridge-invitations-model";

/*
 * The Invitations quick view (D5) in each state a reviewer must see: empty,
 * one, several, a load error, a row mid-accept, and the row outcomes. The view
 * is presentational, so no transport or query fixture is needed; the container
 * (`TeamBridgeInvitations`) only adds the mutation and the no-jitter row order.
 */
const launch: TeamBridgeInvitation = {
	key: "tnt_story|bcv_launch",
	conversationId: "bcv_launch",
	tenantId: "tnt_story",
	conversationKind: "channel",
	conversationName: "launch-room",
	agentName: "Robo Damian",
	inviter: { role: "added", name: "Ada Lovelace", self: false },
};
const design: TeamBridgeInvitation = {
	key: "tnt_story|bcv_design",
	conversationId: "bcv_design",
	tenantId: "tnt_story",
	conversationKind: "group",
	conversationName: "Ada, Grace, Robo Damian",
	agentName: "Robo Damian",
	inviter: { role: "created", name: "Grace Hopper", self: false },
};
const ops: TeamBridgeInvitation = {
	key: "tnt_story|bcv_ops",
	conversationId: "bcv_ops",
	tenantId: "tnt_story",
	conversationKind: "channel",
	conversationName: "ops-incidents",
	agentName: null,
	inviter: null,
};

const meta = {
	title: "Team Bridge/Invitations",
	component: TeamBridgeInvitationsView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[640px] bg-surface text-ink">
				<Story />
			</div>
		),
	],
	args: { listState: "ready", invitations: [], onAnswer: () => {} },
} satisfies Meta<typeof TeamBridgeInvitationsView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const One: Story = { args: { invitations: [launch] } };
export const Several: Story = {
	args: { invitations: [launch, design, ops] },
};
export const LoadError: Story = {
	args: { listState: "error", onRetry: () => {} },
};
export const Loading: Story = { args: { listState: "loading" } };
export const Accepting: Story = {
	args: {
		invitations: [launch, design],
		rowStates: { [launch.key]: { phase: "pending", decision: "accept" } },
	},
};
/* Outcomes keep the row in place: accepted, declined, a retryable refusal and a final one. */
export const Outcomes: Story = {
	args: {
		invitations: [launch, design, ops],
		rowStates: {
			[launch.key]: { phase: "done", decision: "accept" },
			[design.key]: { phase: "failed", kind: "agent_unavailable" },
			[ops.key]: { phase: "failed", kind: "already_answered" },
		},
	},
};
export const Declining: Story = {
	args: {
		invitations: [launch, design],
		rowStates: { [design.key]: { phase: "pending", decision: "decline" } },
	},
};
export const Declined: Story = {
	args: {
		invitations: [launch],
		rowStates: { [launch.key]: { phase: "done", decision: "decline" } },
	},
};
/* Answered elsewhere: the server's `invalid_transition` / `rule=not_invited`. */
export const AnsweredElsewhere: Story = {
	args: {
		invitations: [launch],
		rowStates: { [launch.key]: { phase: "failed", kind: "already_answered" } },
	},
};
export const ReadOnly: Story = {
	args: { invitations: [launch], readOnly: true },
};
/*
 * Wake-on-every-message (participation v2): the consent statement one row
 * shows, and both accepted outcomes, named and unnamed, side by side for the
 * design round's before/after.
 */
export const ConsentV2: Story = { args: { invitations: [launch] } };
export const Accepted: Story = {
	args: {
		invitations: [launch, ops],
		rowStates: {
			[launch.key]: { phase: "done", decision: "accept" },
			[ops.key]: { phase: "done", decision: "accept" },
		},
	},
};
