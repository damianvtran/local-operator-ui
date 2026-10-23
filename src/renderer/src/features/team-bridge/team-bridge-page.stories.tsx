import type { Meta, StoryObj } from "@storybook/react";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import {} from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { ChatLayout } from "../../shared/components/common/chat-layout";
import {
	type PendingSend,
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeOrganization,
	type TeamBridgeTarget,
	asTeamBridgeTenantId,
	draftCreateInput,
	organizationOptions,
	performSend,
	threadWithPending,
} from "./team-bridge-model";
import { TeamBridgePageView } from "./team-bridge-page";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";
import { threadTargetFromSearch } from "./team-bridge-thread-read";

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
	useLayoutEffect(() => {
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
	// The header states 3 current members and distinguishes 2 active / 1 invited.
	// Populated rows are authoritative, rather than a decorative aggregate field.
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

/**
 * The rail's roster, one row per state the directory can answer with.
 *
 * The fixtures are deliberately ordered like the server orders them (no
 * client sort): the signed-in owner first, then a reachable member, a paused
 * admin, and two people whose bridge is off in each of its two spellings. The
 * screen capture therefore shows the quiet states beside the live ones, which
 * is the comparison this section exists to make.
 */
const directoryPeople = [
	{
		account_id: self,
		display_label: "Damian",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active" as const,
	},
	{
		account_id: "acct_bea",
		display_label: "Bea",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active" as const,
	},
	{
		account_id: "acct_ada",
		display_label: "Ada",
		role: "admin",
		bridge_enabled: true,
		bridge_state: "paused" as const,
	},
	{
		account_id: "acct_cy",
		display_label: "Cy",
		role: "member",
		bridge_enabled: false,
		bridge_state: "none" as const,
	},
	{
		account_id: "acct_dee",
		display_label: "Dee",
		role: "member",
		bridge_enabled: false,
		bridge_state: "disabled" as const,
	},
];

/** A DM with one of the roster's people, so that row's DM already exists. */
const beaDm: TeamBridgeConversation = {
	...dm,
	id: "bcv_dm_bea",
	members: [
		{
			account_id: self,
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
	],
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
			<div className="flex h-dvh flex-col">
				<Story />
			</div>
		),
	],
	args: {
		selfAccountId: self,
		conversations: [dm, channel, group],
		target: { type: "conversation", id: dm.id },
		messages,
		organizations: [minervaOrganization, northwindOrganization],
		scope: minervaOrganization.tenantId,
		totalUnread: minervaOrganization.unread + northwindOrganization.unread,
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

export const PopulatedDirectMessage: Story = {};

export const ChannelSelected: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
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
		target: { type: "conversation", id: previewChannel.id },
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
		target: { type: "conversation", id: mutedChannel.id },
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
		target: { type: "conversation", id: channel.id },
		defaultMenuOpen: true,
	},
};

export const EmptyAccount: Story = {
	args: {
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
	},
};

export const Loading: Story = {
	args: {
		listState: "loading",
		conversations: [],
		target: null,
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
		target: null,
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
		target: { type: "conversation", id: dm.id },
		messageState: "ready",
	},
};

/**
 * The hub lists both tenants, the memberships read has returned nothing (F6 on
 * #1314). The organizations are built through `organizationOptions` exactly as
 * the page builds them, so this frame shows the fix itself: before it, the
 * merged rail was empty here; now every row carries the hub's org name.
 */
export const AllOrganizationsHubOnly: Story = {
	args: {
		organizations: organizationOptions(
			[],
			[
				{ tenant_id: minervaOrganization.tenantId, unread: 5 },
				{ tenant_id: northwindOrganization.tenantId, unread: 4 },
			],
			[
				{ tenant_id: minervaOrganization.tenantId, tenant_name: "Minerva" },
				{
					tenant_id: northwindOrganization.tenantId,
					tenant_name: "Northwind Collective",
				},
			],
		),
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [dm, channel, group, northwindChannel],
		// #1296 selects by `target` (the view resolves the conversation itself).
		target: { type: "conversation", id: dm.id },
		messageState: "ready",
	},
};

/** An organization that has no conversations: the switcher still names it. */
export const EmptyOrganization: Story = {
	args: {
		organizations: [minervaOrganization, northwindOrganization],
		scope: northwindOrganization.tenantId,
		conversations: [],
		target: null,
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
		target: null,
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
		target: null,
		messages: [],
		messageState: "idle",
	},
};

/** Account-wide scope with nothing in it: the disabled create states its remedy. */
export const EmptyAllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [],
		target: null,
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
					sidebar={<div className="panel-top-pad h-full bg-surface" />}
					content={
						<main className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden bg-canvas">
							<TeamBridgePageView
								listState="ready"
								messageState="ready"
								conversations={[channel, group, dm]}
								target={{ type: "conversation", id: channel.id }}
								messages={messages}
								organizations={[minervaOrganization, northwindOrganization]}
								scope={asTeamBridgeTenantId("tnt_1")}
								totalUnread={3}
								selfAccountId={self}
								onTarget={() => {}}
								onSend={() => undefined}
								onNewChannel={() => {}}
								onScopeChange={() => {}}
							/>
						</main>
					}
				/>
			</div>
		);
	},
};

/**
 * The People section, fully populated: self, an openable DM, a paused person
 * and the two "bridge off" spellings. Bea's DM already exists, so her row
 * opens it; the others resolve through the seeded compose flow.
 */
export const People: Story = {
	args: {
		conversations: [dm, beaDm, channel, group],
		target: { type: "conversation", id: dm.id },
		people: directoryPeople,
	},
};

/** The directory read in flight: one quiet 30px row under the conversation list. */
export const PeopleLoading: Story = {
	args: {
		people: [],
		peopleState: "loading",
	},
};

/** A refused directory: stated in the rail, with the conversations untouched. */
export const PeopleError: Story = {
	args: {
		people: [],
		peopleState: "error",
	},
};

/** Everyone but the reader has their bridge off: the roster is visible, inert. */
export const PeopleDisabled: Story = {
	args: {
		people: directoryPeople.filter(
			(member) =>
				member.account_id === self || member.bridge_state === "disabled",
		),
	},
};

/** The merged scope has no single roster, and says so instead of guessing. */
export const PeopleAllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [dm, beaDm, channel, group, northwindChannel],
		people: directoryPeople,
	},
};

/** The plan gate: signed in and current, but the organization has no Team Bridge. */
export const PlanRequired: Story = {
	args: {
		eligibility: "plan_required",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
		people: [],
	},
};

/** Signed out: the panel says so; there is no fake sign-in control to press. */
export const SignedOut: Story = {
	args: {
		eligibility: "signed_out",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
		people: [],
	},
};

/** An outdated app is named as such; another panel state on the same surface. */
export const UpdateRequired: Story = {
	args: {
		eligibility: "update_required",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
		people: [],
	},
};

/*
 * ---------------------------------------------------------------------------
 * The Slack-shaped rail (operator review 2026-10-21): built-in channels,
 * section headers that survive empty, a person's row as their DM, chiefs of
 * staff named "{agent} ({person})" from the live directory, the addressed
 * draft that creates nothing until the first send, and the To: compose bar.
 * ---------------------------------------------------------------------------
 */

const at = (minutesAgo: number) =>
	new Date(Date.now() - minutesAgo * 60_000).toISOString();

const humansChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_builtin_humans",
	name: "humans",
	builtin: "humans",
	unread_count: 2,
	last_message_at: at(3),
};
const agentsChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_builtin_agents",
	name: "agents",
	builtin: "agents",
	unread_count: 0,
	notify: "mention",
	last_message_at: at(40),
};

/** The roster with each member's chief of staff, as the directory publishes it. */
const rosterWithChiefs = [
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
	{
		account_id: "acct_sherman",
		display_label: "Sherman Tsui",
		role: "admin",
		bridge_enabled: true,
		bridge_state: "active" as const,
		agent: { endpoint_id: "bep_sherman", name: "Juno", state: "active" },
	},
	{
		account_id: "acct_sana",
		display_label: "Sana Ketabchi",
		role: "admin",
		bridge_enabled: false,
		bridge_state: "none" as const,
	},
	{
		account_id: "acct_ola",
		display_label: "Ola Fagbemi",
		role: "admin",
		bridge_enabled: false,
		bridge_state: "none" as const,
	},
];

/** A DM with Ben whose creator label the hub stored as "Member". */
const benDm: TeamBridgeConversation = {
	...dm,
	id: "bcv_dm_ben",
	unread_count: 1,
	last_message_at: at(2),
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Member",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
			role: "member",
			state: "active",
		},
	],
};

const benThread: TeamBridgeMessage[] = [
	{
		id: "bcmsg_y1",
		conversation_id: benDm.id,
		seq: 1,
		sender: {
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
		},
		body: "Hi, will miss the standup this morning. Deploying the remote cloud to the new AWS infra.",
		origin: "human",
		created_at: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_t1",
		conversation_id: benDm.id,
		seq: 2,
		sender: { account_id: self, kind: "human", display_label: "Member" },
		body: "Also FYI, user-dashboard is fully ported to shadcn/tailwind components.",
		origin: "human",
		created_at: at(9),
	},
	{
		id: "bcmsg_t2",
		conversation_id: benDm.id,
		seq: 3,
		sender: { account_id: self, kind: "human", display_label: "Member" },
		body: "New features there should look better out of the box, without the **MUI** jank.",
		origin: "human",
		created_at: at(8),
	},
	{
		id: "bcmsg_t3",
		conversation_id: benDm.id,
		seq: 4,
		sender: {
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
		},
		body: "**What happened**\n\n- A pre-push hook pushed its own seed commit to `main`\n- `main` was restored 9 minutes later by `aa72763`\n\nI'll write up the fix.",
		origin: "human",
		created_at: at(2),
	},
];

const slackRail = {
	conversations: [humansChannel, agentsChannel, channel, benDm],
	people: rosterWithChiefs,
	organizations: [minervaOrganization],
	scope: minervaOrganization.tenantId,
};

/** Ben's row is selected and IS the DM: no "@ Ben" row exists above People. */
export const PersonRowIsTheDm: Story = {
	args: {
		...slackRail,
		target: { type: "person", accountId: "acct_ben" },
		messages: benThread,
	},
};

/** Built-in #humans first, with its topic in the header. */
export const BuiltinHumansChannel: Story = {
	args: {
		...slackRail,
		target: { type: "conversation", id: humansChannel.id },
		messages: [],
	},
};

/** A person with no DM: an addressed draft; nothing has been created. */
export const PersonDraft: Story = {
	args: {
		...slackRail,
		conversations: [humansChannel, agentsChannel],
		target: { type: "person", accountId: "acct_sherman" },
		messages: [],
		messageState: "idle",
	},
};

/** A chief of staff selected: "Aida (Ben)", the DM created on first send. */
export const ChiefOfStaffDraft: Story = {
	args: {
		...slackRail,
		target: { type: "chief", accountId: "acct_ben" },
		messages: [],
		messageState: "idle",
	},
};

/** "Start a group conversation": the To: bar seeded with one recipient. */
export const ComposeGroup: Story = {
	args: {
		...slackRail,
		target: {
			type: "compose",
			recipients: [{ kind: "human", accountId: "acct_ben", label: "Ben Tran" }],
		},
		messages: [],
		messageState: "idle",
	},
};

/** A new organization: every header stays, each empty line is the create action. */
export const EmptySections: Story = {
	args: {
		conversations: [],
		people: [rosterWithChiefs[0]],
		organizations: [minervaOrganization],
		scope: minervaOrganization.tenantId,
		target: null,
		messages: [],
		messageState: "idle",
	},
};

// These boards use the real page and ChatLayout, not a width-only pane mock.
// The presentation seam prevents Storybook from contacting the operator's hub.
const threadRoot: TeamBridgeMessage = {
	...messages[0],
	conversation_id: channel.id,
	reply_count: 2,
	reply_participants: ["Bea", "Ada"],
	last_reply_at: new Date().toISOString(),
};
const threadReply: TeamBridgeMessage = {
	...messages[1],
	conversation_id: channel.id,
	thread_root_id: threadRoot.id,
};
const threadTarget = {
	tenantId: channel.tenant_id,
	conversationId: channel.id,
	rootId: threadRoot.id,
};

export const ThreadSummaryRow: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: [threadRoot],
	},
};
export const ThreadAtMinimumWindow: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: [threadRoot],
		threadLink: threadTarget,
		renderThreadPane: (_target, close) => (
			<TeamBridgeThreadPaneView
				root={threadRoot}
				replies={[threadReply]}
				state="ready"
				labelFor={(sender) => sender.display_label}
				onClose={close}
				onRetry={() => {}}
				onSend={async () => {}}
			/>
		),
	},
	render: (args) => (
		<div className="h-[700px] w-[800px] max-w-full">
			<TeamBridgePageView {...args} />
		</div>
	),
};

/**
 * A deep link opens the thread on the route's first paint. The simulated `<main>`
 * carries the shell's own `panel-top-pad` (app.tsx spells it unconditionally now
 * that the per-route `flushTop` opt-in is gone); the route root's `panel-flush`
 * cancels it, so the panels still paint from y0 and pad their own first row.
 */
export const ThreadDeepLinkFromSearch: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: [],
		// The old root is deliberately NOT present in the timeline page.
		threadLink: threadTargetFromSearch(
			new URLSearchParams({
				tenant: channel.tenant_id,
				conversation: channel.id,
				thread: threadRoot.id,
			}),
		),
		renderThreadPane: (_target, close) => (
			<TeamBridgeThreadPaneView
				root={threadRoot}
				replies={[threadReply]}
				state="ready"
				labelFor={(sender) => sender.display_label}
				onClose={close}
				onRetry={() => {}}
				onSend={async () => {}}
			/>
		),
	},
	render: (args) => {
		useMacChromeSimulation();
		return (
			<div
				className="relative flex h-screen flex-col overflow-hidden"
				style={{ "--chrome-strip-h": "32px" } as CSSProperties}
			>
				<ChatLayout
					sidebar={<div className="panel-top-pad h-full bg-surface" />}
					content={
						<main className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden bg-canvas">
							<TeamBridgePageView {...args} />
						</main>
					}
				/>
			</div>
		);
	},
};

/** The real visibility observer drives this board's local badge, without a hub
 * request. In a background/unfocused document it intentionally remains unread;
 * once the replies intersect an active pane the same onRead seam clears it.
 */
export const ThreadReadAcknowledgement: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: [threadRoot],
		threadLink: threadTarget,
	},
	render: (args) => {
		const [unread, setUnread] = useState(1);
		return (
			<TeamBridgePageView
				{...args}
				totalUnread={unread}
				conversations={[{ ...channel, unread_count: unread }]}
				renderThreadPane={(_target, close) => (
					<TeamBridgeThreadPaneView
						root={threadRoot}
						replies={[threadReply]}
						state="ready"
						labelFor={(sender) => sender.display_label}
						onClose={close}
						onRetry={() => {}}
						onSend={async () => {}}
						onRead={async () => {
							setUnread(0);
						}}
					/>
				)}
			/>
		);
	},
};

/*
 * THE LEGACY "Member" LABEL (operator report, 2026-10-22). Production rows
 * written before agent-server #166 carry the hub's placeholder "Member" as the
 * stored label for creators and self-joins. These boards hold every sender at
 * that label: the reader (resolved from the signed-in identity, since this
 * roster leaves them out), Ben (resolved from the directory) and a member who
 * left (in no directory: rendered as an unknown person with a neutral glyph).
 */
const legacyGroup: TeamBridgeConversation = {
	...dm,
	id: "bcv_grp_legacy",
	kind: "group",
	name: "release-ops",
	unread_count: 0,
	last_read_seq: 3,
	latest_seq: 3,
	last_message_at: at(4),
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Member",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_ben",
			kind: "human",
			display_label: "Member",
			role: "member",
			state: "active",
		},
		{
			account_id: "acct_departed",
			kind: "human",
			display_label: "Member",
			role: "member",
			state: "removed",
		},
	],
};

const legacyThread: TeamBridgeMessage[] = [
	["acct_ben", "Cutting the 0.42 release branch now.", 30],
	[self, "Thanks. I'll take the changelog.", 20],
	["acct_departed", "Handing my open tickets over before I go.", 12],
	[self, "Got them, thank you.", 4],
].map(([accountId, body, minutesAgo], index) => ({
	id: `bcmsg_legacy_${index + 1}`,
	conversation_id: legacyGroup.id,
	seq: index + 1,
	sender: {
		account_id: accountId as string,
		kind: "human" as const,
		display_label: "Member",
	},
	body: body as string,
	origin: "human" as const,
	created_at: at(minutesAgo as number),
}));

/** Every stored label is "Member": names come from directory and identity. */
export const LegacyMemberLabels: Story = {
	args: {
		conversations: [humansChannel, legacyGroup],
		// The roster leaves the reader out, as a self-excluding directory does.
		people: rosterWithChiefs.slice(1),
		organizations: [minervaOrganization],
		scope: minervaOrganization.tenantId,
		selfName: "Damian Tran",
		target: { type: "conversation", id: legacyGroup.id },
		messages: legacyThread,
	},
};

/** The same thread in the merged view, named from its organization's roster. */
export const LegacyMemberLabelsAllOrganizations: Story = {
	args: {
		...LegacyMemberLabels.args,
		scope: TEAM_BRIDGE_ALL_SCOPE,
		people: [],
		directories: { [minervaOrganization.tenantId]: rosterWithChiefs.slice(1) },
	},
};

/** Production-shaped regression: one active human owner, three invited agents.
 * No member_count is required to derive the current total from participant rows.
 */
export const FourMembersThreeInvited: Story = {
	args: {
		organizations: [minervaOrganization],
		scope: asTeamBridgeTenantId("tnt_1"),
		conversations: [
			{
				...channel,
				id: "bcv_qa_coordination",
				name: "qa-coordination",
				member_count: undefined,
				members: [
					{
						account_id: self,
						kind: "human",
						display_label: "Damian Tran",
						role: "owner",
						state: "active",
					},
					...["Ben Tran", "Sana Ketabchi", "Sherman Tsui"].map(
						(name, index) => ({
							account_id: `acct_invited_${index}`,
							kind: "agent" as const,
							display_label: name,
							role: "member" as const,
							state: "invited" as const,
						}),
					),
				],
			},
		],
		target: { type: "conversation", id: "bcv_qa_coordination" },
		people: rosterWithChiefs,
		messages: [],
	},
};

/** The server's DisplayAgentName falls back to the person's name when the
 * endpoint has no agent_name. #1334 owns honest unnamed-CoS composition;
 * this story exercises inclusion of that existing endpoint, not designation.
 */
export const OwnChiefServerFallback: Story = {
	// Keep the real picker controlled so browser QA can select/remove an agent
	// and verify that its human owner is never implicitly added to the draft.
	render: function OwnChiefPicker(args) {
		const [target, setTarget] = useState<TeamBridgeTarget | null>(args.target);
		return (
			<TeamBridgePageView {...args} target={target} onTarget={setTarget} />
		);
	},
	args: {
		...PersonDraft.args,
		people: rosterWithChiefs.map((person) =>
			person.account_id === self && person.agent
				? { ...person, agent: { ...person.agent, name: person.display_label } }
				: person,
		),
		target: { type: "compose", recipients: [] },
	},
};

/** The same real picker with the endpoint's own agent name published. */
export const OwnChiefNamed: Story = {
	render: OwnChiefServerFallback.render,
	args: {
		...OwnChiefServerFallback.args,
		people: rosterWithChiefs,
	},
};

/*
 * TEAM BRIDGE: OPTIMISTIC SEND, SPARSE THREAD, CHIEF-OF-STAFF LABEL
 * (operator report after v0.39.9). Fixtures are hand-written; the pending rows
 * are built with the same `threadWithPending` the page uses, so a story shows
 * what the container really hands the view.
 */
const sentAt = new Date().toISOString();
const pendingEntry = (
	clientRef: string,
	body: string,
	status: "sending" | "failed",
): PendingSend => ({
	clientRef,
	body,
	createdAt: sentAt,
	tenantId: "tnt_1",
	conversationId: benDm.id,
	draftKey: null,
	baselineSeq: 1,
	status,
});
const withPending = (pending: PendingSend[]) =>
	threadWithPending(benThread, pending, {
		accountId: self,
		label: "Damian Tran",
	});

/** The message is on screen before the round trip: dimmed, "Sending…". */
export const OptimisticSending: Story = {
	args: (() => {
		const pendingSends = [
			pendingEntry("ref-1", "On my way, see you there.", "sending"),
		];
		return {
			...slackRail,
			selfName: "Damian Tran",
			target: { type: "person" as const, accountId: "acct_ben" },
			messages: withPending(pendingSends),
			pendingSends,
		};
	})(),
};

/** A refused send stays in the thread as "Not sent" with a Retry. */
export const OptimisticFailedWithRetry: Story = {
	args: (() => {
		const pendingSends = [
			pendingEntry("ref-2", "On my way, see you there.", "failed"),
		];
		return {
			...slackRail,
			selfName: "Damian Tran",
			target: { type: "person" as const, accountId: "acct_ben" },
			messages: withPending(pendingSends),
			pendingSends,
			onRetrySend: () => {},
		};
	})(),
};

/** Sending, then a failed one beneath it: typed order, after confirmed rows. */
export const OptimisticMixed: Story = {
	args: (() => {
		const pendingSends = [
			pendingEntry("ref-3", "First, this one failed.", "failed"),
			pendingEntry("ref-4", "Second, still sending.", "sending"),
		];
		return {
			...slackRail,
			selfName: "Damian Tran",
			target: { type: "person" as const, accountId: "acct_ben" },
			messages: withPending(pendingSends),
			pendingSends,
			onRetrySend: () => {},
		};
	})(),
};

/** One message in a thread: breathing room under it, above the composer. */
export const SparseThread: Story = {
	args: {
		...slackRail,
		target: { type: "person", accountId: "acct_ben" },
		messages: benThread.slice(0, 1),
	},
};

/**
 * Chiefs of staff: Ben's agent name was defaulted to Ben's own name by the
 * server ("Ben Tran" → "Ben Tran's chief of staff"), Sherman's is Juno
 * ("Juno (Sherman Tsui)"). The DM below stores the doubled label "Ben Tran (Ben
 * Tran)" as the agent member's name; it must read as the same single label on
 * the rail, the thread header, the composer placeholder and the messages.
 */
const echoedRoster = rosterWithChiefs.map((row) =>
	row.account_id === "acct_ben"
		? {
				...row,
				agent: { endpoint_id: "bep_ben", name: "Ben Tran", state: "active" },
			}
		: row,
);
const chiefDm: TeamBridgeConversation = {
	...dm,
	id: "bcv_dm_chief",
	agent_capable: true,
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Damian Tran",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_ben",
			kind: "agent",
			display_label: "Ben Tran (Ben Tran)",
			role: "member",
			state: "active",
		},
	],
};
export const ChiefLabelUnnamedAgent: Story = {
	args: {
		...slackRail,
		people: echoedRoster,
		conversations: [humansChannel, agentsChannel, chiefDm],
		target: { type: "chief", accountId: "acct_ben" },
		messages: [
			{
				id: "bcmsg_c1",
				conversation_id: chiefDm.id,
				seq: 1,
				sender: {
					account_id: "acct_ben",
					kind: "agent",
					display_label: "Ben Tran (Ben Tran)",
				},
				body: "Hi, this is Ben's chief of staff. How can I help?",
				origin: "agent",
				created_at: at(5),
			},
		],
	},
};

/** The same, with the agent's own name published: "Aida (Ben Tran)". */
export const ChiefLabelNamedAgent: Story = {
	args: {
		...ChiefLabelUnnamedAgent.args,
		people: rosterWithChiefs,
	},
};

/**
 * Scripted transport around the real view + performSend. Buttons control only
 * the fake server's settlement, never the message row: this makes the no-id,
 * failed, Retry and feed-before-POST windows observable in a browser. It does
 * not claim coverage of the production query/container glue or a live backend.
 */
export const OptimisticIntegrationFlow: Story = {
	render: (args) => {
		const [pending, setPending] = useState<PendingSend[]>([]);
		const [confirmed, setConfirmed] = useState<TeamBridgeMessage[]>([]);
		const [made, setMade] = useState(false);
		const [counts, setCounts] = useState({ create: 0, post: 0 });
		const remembered = useRef(
			new Map<string, { id: string; tenantId: string | undefined }>(),
		);
		const resolveCreate = useRef<(() => void) | null>(null);
		const post = useRef<{
			ok: () => void;
			no: () => void;
			body: string;
			ref: string;
		} | null>(null);
		const patch = (ref: string, value: Partial<PendingSend>) =>
			setPending((rows) =>
				rows.map((row) => (row.clientRef === ref ? { ...row, ...value } : row)),
			);
		const run = async (body: string, clientRef: string) => {
			patch(clientRef, { status: "sending" });
			const result = await performSend({
				conversationId: null,
				tenantId: "tnt_1",
				draftTenantId: "tnt_1",
				draftKey: "integration",
				input: draftCreateInput([
					{ kind: "human", accountId: "acct_ben", label: "Ben Tran" },
				]),
				body,
				clientRef,
				remembered: remembered.current,
				create: () => {
					setCounts((c) => ({ ...c, create: c.create + 1 }));
					return new Promise((resolve) => {
						resolveCreate.current = () => {
							setMade(true);
							resolve({ id: benDm.id, tenant_id: "tnt_1" });
						};
					});
				},
				onCreated: (c) => patch(clientRef, { conversationId: c.id }),
				post: () => {
					setCounts((c) => ({ ...c, post: c.post + 1 }));
					return new Promise((resolve, reject) => {
						post.current = {
							ok: () => resolve({ id: "bcmsg_flow" }),
							no: () => reject(new Error("scripted failure")),
							body,
							ref: clientRef,
						};
					});
				},
			});
			patch(
				clientRef,
				result.ok
					? { status: "sent", confirmedId: result.confirmedId }
					: { status: "failed" },
			);
		};
		const feed = () => {
			if (post.current)
				setConfirmed([
					{
						id: "bcmsg_flow",
						conversation_id: benDm.id,
						seq: 1,
						sender: {
							account_id: self,
							kind: "human",
							display_label: "Damian Tran",
						},
						origin: "human",
						body: post.current.body,
						created_at: sentAt,
					},
				]);
		};
		return (
			<div className="flex h-full flex-col">
				<div className="flex shrink-0 gap-3 p-2 text-[12px]">
					<button type="button" onClick={() => resolveCreate.current?.()}>
						Resolve create
					</button>
					<button type="button" onClick={() => post.current?.no()}>
						Reject POST
					</button>
					<button type="button" onClick={feed}>
						Deliver server copy
					</button>
					<button type="button" onClick={() => post.current?.ok()}>
						Resolve POST
					</button>
					<span>
						Create {counts.create}; POST {counts.post}
					</span>
				</div>
				<TeamBridgePageView
					{...args}
					{...slackRail}
					selfName="Damian Tran"
					conversations={made ? [benDm] : []}
					target={{ type: "person", accountId: "acct_ben" }}
					messageState={made ? "ready" : "idle"}
					messages={threadWithPending(confirmed, pending, {
						accountId: self,
						label: "Damian Tran",
					})}
					pendingSends={pending}
					onSend={(body, ref) => {
						setPending((rows) => [
							...rows,
							{
								clientRef: ref,
								body,
								createdAt: sentAt,
								tenantId: "tnt_1",
								conversationId: null,
								draftKey: "integration",
								baselineSeq: -1,
								status: "sending",
							},
						]);
						return run(body, ref);
					}}
					onRetrySend={(ref) => {
						const row = pending.find((r) => r.clientRef === ref);
						if (row) void run(row.body, ref);
					}}
				/>
			</div>
		);
	},
};

/**
 * Real page + picker + create serializer + read projection, with an in-memory
 * service boundary. No daemon or production write: the visible payload is what
 * draftCreateInput produced, and its stored labels are fed back uncomposed so
 * the merged page must resolve the same named/unnamed identity on read.
 */
export const OwnChiefCreateReadRoundTrip: Story = {
	args: OwnChiefServerFallback.args,
	render: function OwnChiefRoundTrip(args) {
		const [target, setTarget] = useState<TeamBridgeTarget | null>(args.target);
		const [created, setCreated] = useState<TeamBridgeConversation | null>(null);
		const [confirmed, setConfirmed] = useState<TeamBridgeMessage[]>([]);
		const [wire, setWire] = useState<ReturnType<typeof draftCreateInput>>(null);
		return (
			<div className="flex h-full flex-col">
				<output
					className="shrink-0 px-3 py-1 text-meta-sm"
					aria-label="Fixture create payload"
				>
					{wire ? JSON.stringify(wire) : "Fixture only: no create yet"}
				</output>
				<TeamBridgePageView
					{...args}
					target={target}
					onTarget={setTarget}
					conversations={created ? [created] : []}
					messages={confirmed}
					messageState={created ? "ready" : "idle"}
					onSend={async (body) => {
						if (target?.type !== "compose") return;
						const input = draftCreateInput(target.recipients);
						if (!input) return;
						setWire(input);
						const conversation: TeamBridgeConversation = {
							...dm,
							id: "bcv_self_roundtrip",
							tenant_id: "tnt_1",
							kind: input.kind,
							name: "",
							agent_capable: input.agentCapable,
							members: [
								{
									account_id: self,
									kind: "human",
									display_label: "Damian Tran",
									role: "owner",
									state: "active",
								},
								...input.members.map((member) => ({
									account_id: member.account_id,
									kind: member.kind,
									display_label: member.display_label ?? "",
									role: "member" as const,
									state: "invited" as const,
								})),
							],
						};
						setCreated(conversation);
						setConfirmed([
							{
								id: "bcmsg_self_roundtrip",
								conversation_id: conversation.id,
								seq: 1,
								sender: {
									account_id: self,
									kind: "human",
									display_label: "Damian Tran",
								},
								origin: "human",
								body,
								created_at: new Date().toISOString(),
							},
						]);
						setTarget({ type: "conversation", id: conversation.id });
					}}
				/>
			</div>
		);
	},
};

export const OwnChiefNamedCreateReadRoundTrip: Story = {
	render: OwnChiefCreateReadRoundTrip.render,
	args: { ...OwnChiefNamed.args },
};
