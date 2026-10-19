import type { Meta, StoryObj } from "@storybook/react";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeOrganization,
	asTeamBridgeTenantId,
} from "./team-bridge-model";
import { TeamBridgePageView } from "./team-bridge-page";

/**
 * Presentation states for the Team Bridge page.
 *
 * The view is pure, so each state here is one props change rather than a live
 * daemon: loading and error are real branches of the page, empty is a real
 * account state, and the populated boards are the two shapes that matter for
 * review — a human↔agent DM (agent badge, right-aligned own messages) and a
 * channel with unread and an invited member (the row badge and the invited
 * marker). Fixtures are hand-written rather than captured so a reviewer can see
 * exactly what the state contains; no real account ids or message bodies are
 * used.
 */

const self = "acct_self";

const dm: TeamBridgeConversation = {
	id: "bcv_dm_1",
	tenant_id: "tnt_1",
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: new Date().toISOString(),
	latest_seq: 4,
	members: [
		{
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_agent",
			kind: "agent",
			display_label: "Ada's agent",
			role: "member",
			state: "active",
			joined_seq: 2,
		},
	],
	last_read_seq: 2,
	unread_count: 2,
	muted: false,
};

const channel: TeamBridgeConversation = {
	id: "bcv_ch_1",
	tenant_id: "tnt_1",
	kind: "channel",
	name: "launch",
	topic: "Launch coordination",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: new Date(Date.now() - 4 * 60_000).toISOString(),
	latest_seq: 12,
	members: [
		{
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_bea",
			kind: "human",
			display_label: "Bea",
			role: "member",
			state: "active",
		},
		{
			account_id: "acct_cy",
			kind: "human",
			display_label: "Cy",
			role: "member",
			state: "invited",
		},
	],
	last_read_seq: 9,
	unread_count: 3,
	muted: false,
};

const group: TeamBridgeConversation = {
	...channel,
	id: "bcv_grp_1",
	kind: "group",
	name: "Design review",
	visibility: "private",
	latest_seq: 3,
	last_read_seq: 3,
	unread_count: 0,
	last_message_at: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
};

const messages: TeamBridgeMessage[] = [
	{
		id: "bcmsg_1",
		conversation_id: dm.id,
		seq: 1,
		sender: {
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
		},
		body: "Can you take the launch checklist today?",
		origin: "human",
		created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_2",
		conversation_id: dm.id,
		seq: 2,
		sender: {
			account_id: "acct_agent",
			kind: "agent",
			display_label: "Ada's agent",
		},
		body: "Yes — I am working through the two open items now.",
		body_hash: "hash-2",
		origin: "agent",
		created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_3",
		conversation_id: dm.id,
		seq: 3,
		sender: {
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
		},
		body: "Great. Ping me if the second one needs a decision.",
		origin: "human",
		created_at: new Date(Date.now() - 8 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_4",
		conversation_id: dm.id,
		seq: 4,
		sender: {
			account_id: "acct_agent",
			kind: "agent",
			display_label: "Ada's agent",
		},
		body: "It does — I have posted the question in the channel.",
		body_hash: "hash-4",
		origin: "agent",
		created_at: new Date(Date.now() - 6 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_5",
		conversation_id: dm.id,
		seq: 5,
		sender: {
			account_id: "acct_agent",
			kind: "agent",
			display_label: "Ada's agent",
		},
		// A held message: the agent's own history carries `null` until admitted.
		body: null,
		body_hash: "hash-5",
		origin: "agent",
		created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
	},
];

const minervaOrganization: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_1"),
	name: "Minerva",
	role: "owner",
	unread: 5,
};

const northwindOrganization: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_2"),
	name: "Northwind Collective",
	role: "member",
	unread: 4,
};

/** A row from the second organization, so the merged board has two chips. */
const northwindChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_ch_2",
	tenant_id: northwindOrganization.tenantId,
	name: "field-notes",
	latest_seq: 6,
	last_read_seq: 2,
	unread_count: 4,
	last_message_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
};

const meta = {
	title: "Team Bridge/Page",
	component: TeamBridgePageView,
	parameters: { layout: "fullscreen" },
	// Storybook's root has no height of its own; the app's shell gives the page
	// `flex-1 min-h-0`. The board supplies the same constraint so the capture
	// shows the real composition rather than a page collapsed to its content.
	decorators: [
		(Story) => (
			<div className="h-dvh">
				<Story />
			</div>
		),
	],
	args: {
		selfAccountId: self,
		conversations: [dm, channel, group],
		selected: dm,
		messages,
		organizations: [minervaOrganization, northwindOrganization],
		scope: minervaOrganization.tenantId,
		totalUnread: minervaOrganization.unread + northwindOrganization.unread,
		listState: "ready",
		messageState: "ready",
		onSelect: () => {},
		onSend: () => {},
		onNewConversation: () => {},
		onRetry: () => {},
		onScopeChange: () => {},
	},
} satisfies Meta<typeof TeamBridgePageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedDirectMessage: Story = {};

export const ChannelSelected: Story = {
	args: {
		selected: channel,
		messages: messages.map((message) => ({
			...message,
			conversation_id: channel.id,
		})),
	},
};

export const EmptyAccount: Story = {
	args: {
		conversations: [],
		selected: null,
		messages: [],
		messageState: "idle",
	},
};

export const Loading: Story = {
	args: {
		listState: "loading",
		conversations: [],
		selected: null,
		messages: [],
		messageState: "idle",
	},
};

export const SendFailed: Story = {
	args: {
		sendFailed: true,
		initialDraft: "Ping me when the checklist is done.",
	},
};

export const ErrorState: Story = {
	args: {
		listState: "error",
		conversations: [],
		selected: null,
		messages: [],
		messageState: "idle",
	},
};

export const ThreadError: Story = {
	args: { messageState: "error" },
};

export const SendingDisabledComposer: Story = {
	args: { sending: true },
};

/**
 * The container's real first paint for a single-membership account: scope
 * defaults to the only organization (not All), no row carries a chip, and
 * create is available.
 */
export const SingleOrganization: Story = {
	args: {
		organizations: [minervaOrganization],
		totalUnread: minervaOrganization.unread,
	},
};

/** Several organizations, one selected: the menu holds the others. */
export const MultipleOrganizations: Story = {};

/** The account-wide view: merged, newest first, every row labelled with its org. */
export const AllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [dm, channel, group, northwindChannel],
		selected: dm,
		messageState: "ready",
	},
};

/** An organization that has no conversations: the switcher still names it. */
export const EmptyOrganization: Story = {
	args: {
		organizations: [minervaOrganization, northwindOrganization],
		scope: northwindOrganization.tenantId,
		conversations: [],
		selected: null,
		messages: [],
		messageState: "idle",
	},
};

/** The memberships read failed: rows cannot be labelled, so the rail says so. */
export const OrganizationsUnavailable: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		organizations: [],
		organizationsFailed: true,
		listState: "error",
		conversations: [],
		selected: null,
		messages: [],
		messageState: "idle",
	},
};

/** Account-wide scope while the merged list loads: the reason stays on screen. */
export const LoadingAllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		listState: "loading",
		conversations: [],
		selected: null,
		messages: [],
		messageState: "idle",
	},
};

/** Account-wide scope with nothing in it: the disabled create states its remedy. */
export const EmptyAllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [],
		selected: null,
		messages: [],
		messageState: "idle",
	},
};
