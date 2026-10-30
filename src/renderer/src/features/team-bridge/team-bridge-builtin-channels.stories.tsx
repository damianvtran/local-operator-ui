import type { Meta, StoryObj } from "@storybook/react";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
/*
 * The page mounts the shared composer, which reaches `window.electron` on mount;
 * Storybook mocks only `window.api`. Same side-effect shim, and the same reason,
 * as `team-bridge-page.stories.tsx`.
 */
import "../chat/components/story-electron-shim";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeOrganization,
	asTeamBridgeTenantId,
} from "./team-bridge-model";
import { TeamBridgePageView } from "./team-bridge-page";

/**
 * The three built-in channels together: #general, #humans and #agents beside an
 * ordinary channel, in one organization and in the All organizations view.
 *
 * WHY A SEPARATE FILE. #general (agent-server feat/bridge-builtin-general) is a
 * rail-order and header change, and `team-bridge-page.stories.tsx` is being
 * edited by several open branches at once; a board of its own keeps this one
 * reviewable without a merge conflict in the shared fixture file.
 *
 * Every built-in row here carries `discoverable: true, member: true`, the pair a
 * current server sends for a channel the caller belongs to: that is what keeps
 * the rail's "Preview" chip off #general (see `isPreviewConversation`). The
 * fixtures are hand-written; no real account ids or message bodies are used.
 */

const self = "acct_self";
const at = (minutesAgo: number) =>
	new Date(Date.now() - minutesAgo * 60_000).toISOString();

const minerva: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_1"),
	name: "Minerva",
	role: "owner",
	unread: 3,
};
const northwind: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_2"),
	name: "Northwind Collective",
	role: "member",
	unread: 1,
};

const human = (accountId: string, label: string) => ({
	account_id: accountId,
	kind: "human" as const,
	display_label: label,
	role: "member" as const,
	state: "active" as const,
});

const baseChannel = (
	tenant: TeamBridgeOrganization,
	patch: Partial<TeamBridgeConversation>,
): TeamBridgeConversation => ({
	id: "",
	tenant_id: tenant.tenantId,
	kind: "channel",
	name: "",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: self,
	last_message_at: at(30),
	latest_seq: 4,
	members: [human(self, "Damian Tran"), human("acct_ben", "Ben Tran")],
	last_read_seq: 4,
	unread_count: 0,
	muted: false,
	member_count: 2,
	discoverable: true,
	member: true,
	...patch,
});

/** One organization's built-ins plus an ordinary channel, newest activity LAST
 * on the built-ins so the frame shows the order is fixed, not by activity. */
const orgChannels = (tenant: TeamBridgeOrganization, key: string) => [
	baseChannel(tenant, {
		id: `bcv_${key}_launch`,
		name: "launch",
		topic: "Launch coordination",
		unread_count: 2,
		last_message_at: at(1),
	}),
	baseChannel(tenant, {
		id: `bcv_${key}_agents`,
		name: "agents",
		builtin: "agents",
		notify: "mention",
		last_message_at: at(5),
	}),
	baseChannel(tenant, {
		id: `bcv_${key}_humans`,
		name: "humans",
		builtin: "humans",
		unread_count: 1,
		last_message_at: at(9),
	}),
	baseChannel(tenant, {
		id: `bcv_${key}_general`,
		name: "general",
		builtin: "general",
		last_message_at: at(60),
		members: [
			human(self, "Damian Tran"),
			human("acct_ben", "Ben Tran"),
			{
				account_id: "acct_ben",
				kind: "agent",
				display_label: "Aida",
				role: "member",
				state: "active",
				joined_seq: 1,
			},
		],
		member_count: 3,
	}),
];

const minervaRows = orgChannels(minerva, "m");
const northwindRows = orgChannels(northwind, "n");
const minervaGeneral = minervaRows[3];

const generalThread: TeamBridgeMessage[] = [
	{
		id: "bcmsg_g1",
		conversation_id: minervaGeneral.id,
		seq: 1,
		sender: {
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
		},
		body: "Morning all — the staging deploy is green.",
		origin: "human",
		created_at: at(62),
	},
	{
		id: "bcmsg_g2",
		conversation_id: minervaGeneral.id,
		seq: 2,
		sender: { account_id: "acct_ben", kind: "agent", display_label: "Aida" },
		body: "Noted. I have moved the release checklist to *ready*.",
		body_hash: "hash-g2",
		origin: "agent",
		created_at: at(60),
	},
];

const roster = [
	{
		account_id: self,
		display_label: "Damian Tran",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active" as const,
		agent: { endpoint_id: "bep_self", name: "Aida", state: "active" },
	},
	{
		account_id: "acct_ben",
		display_label: "Ben Tran",
		role: "admin",
		bridge_enabled: true,
		bridge_state: "active" as const,
		agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
	},
];

const meta = {
	title: "Team Bridge/Built-in channels",
	component: TeamBridgePageView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-dvh flex-col">
				<Story />
			</div>
		),
	],
	args: {
		selfAccountId: self,
		conversations: minervaRows,
		people: roster,
		target: { type: "conversation", id: minervaGeneral.id },
		messages: generalThread,
		organizations: [minerva],
		scope: minerva.tenantId,
		totalUnread: minerva.unread,
		listState: "ready",
		messageState: "ready",
		onTarget: () => {},
		onSend: () => {},
		onNewChannel: () => {},
		onRetry: () => {},
		onScopeChange: () => {},
		onJoin: () => {},
		onNotifyChange: () => {},
		onRetryPeople: () => {},
	},
} satisfies Meta<typeof TeamBridgePageView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One organization: #general leads, open, with its header line and no Preview chip. */
export const SingleOrganization: Story = {};

/** The conversation menu on #general: notification levels only, no archive. */
export const SingleOrganizationMenu: Story = {
	args: { defaultMenuOpen: true },
};

/** All organizations: each org's #general first, each captioned with its org. */
export const AllOrganizations: Story = {
	args: {
		organizations: [minerva, northwind],
		scope: TEAM_BRIDGE_ALL_SCOPE,
		totalUnread: minerva.unread + northwind.unread,
		conversations: [...minervaRows, ...northwindRows],
	},
};

/** A server older than #general: the rail is exactly what it was (#humans first). */
export const OlderServerWithoutGeneral: Story = {
	args: {
		conversations: minervaRows.filter((row) => row.builtin !== "general"),
		target: { type: "conversation", id: minervaRows[2].id },
		messages: [],
	},
};

/** The list still loading. */
export const Loading: Story = {
	args: {
		listState: "loading",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
	},
};

/** All organizations, still loading. */
export const LoadingAllOrganizations: Story = {
	args: {
		organizations: [minerva, northwind],
		scope: TEAM_BRIDGE_ALL_SCOPE,
		listState: "loading",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
	},
};
