import type { Meta, StoryObj } from "@storybook/react";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import {
	type TeamBridgeOrganization,
	asTeamBridgeTenantId,
} from "./team-bridge-model";
import { TeamBridgePageView } from "./team-bridge-page";

/**
 * Archive -> view archived -> permanent delete.
 *
 * The page view is pure, so each state here is one props change. The fixtures
 * are hand-written (the operator's real leftover test channels are named for
 * recognisability; no real account ids or message bodies). Dialogs are seeded
 * OPEN with `initialDialog` because a portal cannot be opened from a still, and
 * the Archived channels view with `initialQuickView`.
 *
 * Capture these in the real browser (Storybook) for the design round; the node
 * suite `scripts/team-bridge-archive.test.mjs` pins the same states as markup.
 */

const self = "acct_self";
const minerva: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_1"),
	name: "Minerva",
	role: "owner",
	unread: 0,
};

const member = (
	account_id: string,
	display_label: string,
	role: "owner" | "member" = "member",
) => ({
	account_id,
	kind: "human" as const,
	display_label,
	role,
	state: "active" as const,
});

const channel = (
	patch: Partial<TeamBridgeConversation>,
): TeamBridgeConversation => ({
	id: "bcv_ch_launch",
	tenant_id: "tnt_1",
	kind: "channel",
	name: "launch",
	topic: "Launch coordination",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: self,
	last_message_at: new Date(Date.now() - 4 * 60_000).toISOString(),
	latest_seq: 6,
	members: [member(self, "Damian", "owner"), member("acct_bea", "Bea")],
	last_read_seq: 6,
	unread_count: 0,
	muted: false,
	can_administer: true,
	...patch,
});

const live = channel({});
const humans = channel({
	id: "bcv_humans",
	name: "humans",
	builtin: "humans",
	can_administer: false,
});

const archivedAt = new Date(Date.now() - 26 * 60 * 60_000).toISOString();
const proof1 = channel({
	id: "bcv_proof_1",
	name: "release-proof-0.84.1",
	status: "archived",
	archived_at: archivedAt,
	archived_by: "acct_ada",
	archived_by_label: "Ada Lovelace",
});
const proof2 = channel({
	id: "bcv_proof_2",
	name: "release-proof-0.84.2",
	status: "archived",
	archived_at: archivedAt,
	archived_by: "acct_ada",
	archived_by_label: "Ada Lovelace",
});

const history: TeamBridgeMessage[] = [
	{
		id: "bcmsg_1",
		conversation_id: proof1.id,
		seq: 1,
		sender: { account_id: "acct_bea", kind: "human", display_label: "Bea" },
		body: "Release proof 0.84.1 passed on the QA tenant.",
		origin: "human",
		created_at: new Date(Date.now() - 30 * 60 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_2",
		conversation_id: proof1.id,
		seq: 2,
		sender: { account_id: self, kind: "human", display_label: "Damian" },
		body: "Thanks — archiving this one now that the proof is recorded.",
		origin: "human",
		created_at: new Date(Date.now() - 27 * 60 * 60_000).toISOString(),
	},
];

const meta = {
	title: "Team Bridge/Archive",
	component: TeamBridgePageView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-dvh">
				<Story />
			</div>
		),
	],
	args: {
		selfAccountId: self,
		conversations: [humans, live],
		target: { type: "conversation", id: live.id },
		messages: [],
		organizations: [minerva],
		scope: minerva.tenantId,
		totalUnread: 0,
		listState: "ready",
		messageState: "ready",
		onTarget: () => {},
		onSend: () => {},
		onNewChannel: () => {},
		onRetry: () => {},
		onScopeChange: () => {},
		onJoin: () => {},
		onNotifyChange: () => {},
		onArchive: () => {},
		onUnarchive: () => {},
		onDelete: async () => {},
		onOpenArchived: () => {},
		onRetryArchived: () => {},
		archivedConversations: [proof1, proof2],
		archivedState: "ready",
	},
} satisfies Meta<typeof TeamBridgePageView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The header menu with "Archive channel" (an administrator on an open channel). */
export const ArchiveInHeaderMenu: Story = {
	args: { defaultMenuOpen: true },
};

/** The confirm: members keep read access, nobody can post. */
export const ArchiveConfirm: Story = {
	args: { initialDialog: { kind: "archive", conversationId: live.id } },
};

/** The Archived channels view with two archived channels (populated). */
export const ArchivedViewPopulated: Story = {
	args: { initialQuickView: "archived" },
};

export const ArchivedViewEmpty: Story = {
	args: { initialQuickView: "archived", archivedConversations: [] },
};

export const ArchivedViewLoading: Story = {
	args: {
		initialQuickView: "archived",
		archivedState: "loading",
		archivedConversations: [],
	},
};

export const ArchivedViewError: Story = {
	args: {
		initialQuickView: "archived",
		archivedState: "error",
		archivedConversations: [],
	},
};

/** An archived channel opened read-only: banner with Unarchive and Delete permanently. */
export const ArchivedChannelAsAdministrator: Story = {
	args: {
		conversations: [humans, live],
		archivedConversations: [proof1, proof2],
		target: { type: "conversation", id: proof1.id },
		messages: history,
	},
};

/** The same channel for a plain member: the fact, and no buttons. */
export const ArchivedChannelAsMember: Story = {
	args: {
		archivedConversations: [{ ...proof1, can_administer: false }, proof2],
		target: { type: "conversation", id: proof1.id },
		messages: history,
	},
};

export const ArchivedChannelUnarchiveFailed: Story = {
	args: {
		archivedConversations: [proof1, proof2],
		target: { type: "conversation", id: proof1.id },
		messages: history,
		unarchiveFailed: true,
	},
};

/** The destructive confirm: erase list, cannot be undone, type the name. */
export const DeletePermanentlyConfirm: Story = {
	args: {
		archivedConversations: [proof1, proof2],
		target: { type: "conversation", id: proof1.id },
		messages: history,
		initialDialog: { kind: "delete", conversationId: proof1.id },
	},
};

/** The archive was refused after the optimistic removal: the row is back, with the reason. */
export const ArchiveRefused: Story = {
	args: { archiveFailed: true },
};
