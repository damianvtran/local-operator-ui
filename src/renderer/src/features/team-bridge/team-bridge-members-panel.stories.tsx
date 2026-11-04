import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeParticipant,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeMembersPanel } from "./team-bridge-members-panel";

/**
 * The members panel (header count -> right drawer), transport-free.
 *
 * The decorator reproduces the docked slot the page gives it: the
 * conversation column on `surface` and the panel at the thread pane's width on
 * its own `canvas` ground, separated by the ground step alone (no border), so
 * a capture shows the composition the reader sees, not a floating card.
 */

const human = (
	account_id: string,
	display_label: string,
	role: "owner" | "member" = "member",
	state: "active" | "invited" = "active",
): TeamBridgeParticipant => ({
	account_id,
	kind: "human",
	display_label,
	role,
	state,
});
const agent = (
	account_id: string,
	display_label: string,
	state: "active" | "invited" = "active",
): TeamBridgeParticipant => ({
	account_id,
	kind: "agent",
	display_label,
	role: "member",
	state,
});

const person = (
	account_id: string,
	display_label: string,
	agentName?: string,
): TeamBridgeDirectoryMember => ({
	account_id,
	display_label,
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	...(agentName
		? {
				agent: {
					endpoint_id: `bep_${account_id}`,
					name: agentName,
					state: "active" as const,
				},
			}
		: {}),
});

const people: TeamBridgeDirectoryMember[] = [
	person("acct_self", "Damian Tran", "Aida"),
	person("acct_ben", "Ben Tran", "Juno"),
	person("acct_sana", "Sana Iqbal", "Orion"),
	person("acct_lee", "Sherman Lee"),
];

const base: TeamBridgeConversation = {
	id: "bcv_qa",
	tenant_id: "tnt_minerva",
	kind: "channel",
	name: "qa-coordination",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-11-02T12:00:00.000Z",
	latest_seq: 40,
	members: [
		human("acct_self", "Damian Tran", "owner"),
		human("acct_ben", "Ben Tran"),
		human("acct_sana", "Sana Iqbal"),
		human("acct_lee", "Sherman Lee", "member", "invited"),
		agent("acct_self", "Aida"),
		agent("acct_ben", "Juno"),
		agent("acct_sana", "Orion", "invited"),
	],
	last_read_seq: 40,
	unread_count: 0,
	muted: false,
	can_administer: true,
};

const FIRST = [
	"Ada",
	"Bea",
	"Cyrus",
	"Dana",
	"Emeka",
	"Farah",
	"Goran",
	"Hana",
	"Ivo",
	"Jun",
	"Kemi",
	"Luca",
	"Mei",
	"Nia",
	"Omar",
	"Priya",
];
const many: TeamBridgeConversation = {
	...base,
	members: [
		...base.members,
		...FIRST.map((name, index) =>
			human(`acct_m${index}`, `${name} ${index % 2 ? "Okafor" : "Moreau"}`),
		),
	],
};

const meta = {
	title: "Team Bridge/Members panel",
	component: TeamBridgeMembersPanel,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[760px] bg-surface text-ink">
				<div className="flex-1 p-6 text-ink-muted"># qa-coordination</div>
				<div className="h-full w-[26rem] shrink-0">
					<Story />
				</div>
			</div>
		),
	],
	args: {
		conversation: base,
		people,
		selfAccountId: "acct_self",
		conversationName: "qa-coordination",
		onAddMembers: () => {},
		onAction: () => Promise.resolve(),
		onClose: () => {},
	},
} satisfies Meta<typeof TeamBridgeMembersPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Owner viewer: Remove on other people, Leave on self, own agent removable. */
export const Populated: Story = {
	play: async ({ canvasElement }) => {
		const panel = within(canvasElement);
		await expect(panel.getByText("Pending approval")).toBeInTheDocument();
		await expect(
			panel.getByRole("button", { name: "Remove Ben Tran from conversation" }),
		).toBeInTheDocument();
		await expect(
			panel.getByRole("button", { name: "Leave this conversation" }),
		).toBeInTheDocument();
		// Someone else's agent has no route yet, so no control.
		await expect(
			panel.queryByRole("button", {
				name: "Remove Juno (Ben Tran) from conversation",
			}),
		).toBeNull();
	},
};

/** A row under the pointer: the action is revealed, the fill is the hover step. */
export const RowHover: Story = {
	play: async ({ canvasElement }) => {
		const row = within(canvasElement).getByText("Ben Tran").closest("li");
		if (row) await userEvent.hover(row);
	},
};

/** About twenty members: the search box appears (threshold 8). */
export const ManyMembers: Story = { args: { conversation: many } };

export const SearchWithQuery: Story = {
	args: { conversation: many, initialQuery: "oka" },
};

export const SearchNoMatch: Story = {
	args: { conversation: many, initialQuery: "zzz" },
};

/** A plain member: Add members (any active human may invite), but no Remove - only Leave on self. */
export const NonOwnerViewer: Story = {
	args: {
		conversation: {
			...base,
			members: base.members.map((member) =>
				member.kind === "human" && member.account_id === "acct_self"
					? { ...member, role: "member" as const }
					: member.kind === "human" && member.account_id === "acct_ben"
						? { ...member, role: "owner" as const }
						: member,
			),
		},
	},
};

export const RemoveConfirmOpen: Story = {
	args: { initialConfirmKey: "human:acct_ben" },
};

export const LeaveConfirmOpen: Story = {
	args: { initialConfirmKey: "human:acct_self" },
};

export const ActionRefused: Story = { args: { initialError: true } };

/** #general: derived membership, so no controls and one quiet line. */
export const BuiltinGeneral: Story = {
	args: {
		conversation: { ...base, name: "general", builtin: "general" },
		conversationName: "general",
		onAddMembers: undefined,
	},
};

/** #agents: no removes, but the reader may leave a channel they joined. */
export const BuiltinAgents: Story = {
	args: {
		conversation: { ...base, name: "agents", builtin: "agents" },
		conversationName: "agents",
		onAddMembers: undefined,
	},
};

/** A DM: read-only. */
export const DirectMessage: Story = {
	args: {
		conversation: {
			...base,
			kind: "dm",
			name: undefined,
			members: [
				human("acct_self", "Damian Tran"),
				human("acct_ben", "Ben Tran"),
			],
		},
		conversationName: "Ben Tran",
		onAddMembers: undefined,
	},
};
