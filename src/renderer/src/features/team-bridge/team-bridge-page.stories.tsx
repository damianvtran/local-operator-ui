import type { Meta, StoryObj } from "@storybook/react";
import { type CSSProperties, useEffect } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { ChatLayout } from "../../shared/components/common/chat-layout";
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

/**
 * Storybook has no native window chrome, so the lane's CSS gates stay off.
 * Set the same document attributes `main.tsx` writes before render; without
 * them the comparison story is not the pre-fix shape (the lane is `display:
 * none`, so nothing is reserved above the page).
 */
const useMacChromeSimulation = () => {
	useEffect(() => {
		const root = document.documentElement;
		const previous = {
			mode: root.getAttribute("data-chrome-mode"),
			platform: root.getAttribute("data-chrome-platform"),
			leading: root.getAttribute("data-chrome-leading"),
		};
		root.setAttribute("data-chrome-mode", "integrated");
		root.setAttribute("data-chrome-platform", "mac");
		root.setAttribute("data-chrome-leading", "false");
		return () => {
			for (const [key, value] of Object.entries(previous)) {
				const name = `data-chrome-${key}`;
				if (value === null) root.removeAttribute(name);
				else root.setAttribute(name, value);
			}
		};
	}, []);
};

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
	// What agent-server sends on every row: active + invited (Damian, Bea, Cy).
	// The header must still read 2 active members, not 3, so this fixture is the
	// insider branch of `conversationMemberCount` rather than a decorative field.
	member_count: 3,
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

/**
 * A discoverable channel the caller has not joined.
 *
 * `members` is EMPTY on purpose: the preview's whole point is that membership
 * is the fact withheld, so the header's count has to come from `member_count`
 * and the rail has no participant rows to draw. The messages beside it in the
 * story are a trap for the component test — they must never be rendered.
 */
const previewChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_ch_preview",
	name: "product-design",
	topic: "Design critiques and reviews",
	visibility: "tenant",
	discoverable: true,
	member: false,
	member_count: 24,
	members: [],
	latest_seq: 41,
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	last_message_at: new Date(Date.now() - 30 * 60_000).toISOString(),
};

/** A joined channel whose notification register is the middle-low `mute`. */
const mutedChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_ch_muted",
	name: "alerts",
	discoverable: true,
	member: true,
	notify: "mute",
	muted: true,
	latest_seq: 12,
	last_read_seq: 10,
	unread_count: 2,
	last_message_at: new Date(Date.now() - 8 * 60_000).toISOString(),
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
		onJoin: () => {},
		onNotifyChange: () => {},
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

/**
 * The preview state: header metadata and the join banner, never a body.
 *
 * The messages are deliberately attached to the preview conversation in this
 * story. A regression that renders cached history under a non-member banner
 * would be visible here (and is asserted in the component test).
 */
export const PreviewChannel: Story = {
	args: {
		selected: previewChannel,
		conversations: [dm, previewChannel, group],
		messages: messages.map((message) => ({
			...message,
			conversation_id: previewChannel.id,
		})),
	},
};

/** A muted member channel: the rail draws its quiet bell beside the unread count. */
export const MutedChannel: Story = {
	args: {
		selected: mutedChannel,
		conversations: [dm, mutedChannel, group],
		messages: messages.map((message) => ({
			...message,
			conversation_id: mutedChannel.id,
		})),
	},
};

/** The header menu open on its three-level preference section. */
export const NotificationMenu: Story = {
	args: {
		selected: channel,
		defaultMenuOpen: true,
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

/**
 * The page in the real shell, with the chrome lane as an overlay.
 *
 * This is the shape the operator's screenshot is about: the panels start at
 * y0 and the 32px traffic-light clearance is padding INSIDE them, not a band
 * above them. `--chrome-strip-h` is set on the frame because Storybook has no
 * native window chrome; the production value comes from the same property.
 */
export const FlushToTheWindowTop: Story = {
	render: () => {
		useMacChromeSimulation();
		return (
			<div
				className="relative flex h-screen flex-col overflow-hidden"
				style={{ "--chrome-strip-h": "32px" } as CSSProperties}
			>
				<ChatLayout
					flushTop
					sidebar={<div className="h-full bg-surface" />}
					content={
						<main className="flex min-w-0 grow flex-col overflow-hidden bg-canvas">
							<TeamBridgePageView
								listState="ready"
								messageState="ready"
								conversations={[channel, group, dm]}
								selected={channel}
								messages={messages}
								organizations={[minervaOrganization, northwindOrganization]}
								scope={asTeamBridgeTenantId("tnt_1")}
								totalUnread={3}
								selfAccountId={self}
								onSelect={() => {}}
								onSend={() => undefined}
								onNewConversation={() => {}}
								onScopeChange={() => {}}
							/>
						</main>
					}
				/>
			</div>
		);
	},
};

/** The pre-fix shape, kept as the comparison frame: the lane reserves 32px and the page starts below it. */
export const LaneReservedComparison: Story = {
	render: () => {
		useMacChromeSimulation();
		return (
			<div
				className="relative flex h-screen flex-col overflow-hidden"
				style={{ "--chrome-strip-h": "32px" } as CSSProperties}
			>
				<ChatLayout
					sidebar={<div className="h-full bg-surface" />}
					content={
						<main className="flex min-w-0 grow flex-col overflow-hidden bg-canvas">
							<TeamBridgePageView
								listState="ready"
								messageState="ready"
								conversations={[channel, group, dm]}
								selected={channel}
								messages={messages}
								organizations={[minervaOrganization, northwindOrganization]}
								scope={asTeamBridgeTenantId("tnt_1")}
								totalUnread={3}
								selfAccountId={self}
								onSelect={() => {}}
								onSend={() => undefined}
								onNewConversation={() => {}}
								onScopeChange={() => {}}
							/>
						</main>
					}
				/>
			</div>
		);
	},
};
