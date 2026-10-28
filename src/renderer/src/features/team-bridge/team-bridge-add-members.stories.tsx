import { Button } from "@shared/components/ui/button";
import { UserPlus } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeAddMembersView } from "./team-bridge-add-members";

/**
 * Transport-free membership states for later desktop-width light/dark capture.
 * The self-owned chief of staff is present on purpose: the DM rail excludes it,
 * but this picker must offer it with its current display name.
 */
const conversation: TeamBridgeConversation = {
	id: "bcv_article_search",
	tenant_id: "tnt_minerva",
	kind: "group",
	name: "article-search-reindex",
	visibility: "private",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: "2026-10-28T12:00:00.000Z",
	latest_seq: 12,
	members: [
		{
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian Tran",
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
		{
			account_id: "acct_sherman",
			kind: "agent",
			display_label: "Juno",
			role: "member",
			state: "invited",
			joined_seq: 0,
		},
	],
	last_read_seq: 12,
	unread_count: 0,
	muted: false,
	can_administer: true,
};

const people: TeamBridgeDirectoryMember[] = [
	{
		account_id: "acct_self",
		display_label: "Damian Tran",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "bep_self", name: "Aida", state: "active" },
	},
	{
		account_id: "acct_ben",
		display_label: "Ben Tran",
		role: "admin",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
	},
	{
		account_id: "acct_sherman",
		display_label: "Sherman Tsui",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "bep_sherman", name: "Juno", state: "active" },
	},
	{
		account_id: "acct_ada",
		display_label: "Ada Lovelace",
		role: "member",
		bridge_enabled: true,
		bridge_state: "paused",
		agent: { endpoint_id: "bep_ada", name: "Scout", state: "paused" },
	},
	{
		account_id: "acct_cy",
		display_label: "Cy Smith",
		role: "member",
		bridge_enabled: false,
		bridge_state: "none",
		agent: { endpoint_id: "bep_cy", name: "Helper", state: "disabled" },
	},
];

const meta = {
	title: "Team Bridge/Add members",
	component: TeamBridgeAddMembersView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="min-h-dvh bg-canvas">
				<div className="flex h-11 items-center justify-end gap-1 border-b border-hairline bg-surface px-5">
					<Button
						type="button"
						size="icon-sm"
						variant="ghost"
						aria-label="Add members capture anchor"
					>
						<UserPlus size={16} aria-hidden="true" />
					</Button>
				</div>
				<Story />
			</div>
		),
	],
	args: {
		open: true,
		conversation,
		people,
		selfAccountId: "acct_self",
		peopleState: "ready",
		canAdminister: true,
		onClose: () => {},
		onRetryPeople: () => {},
		onAdd: () => {},
		onRemove: () => {},
	},
} satisfies Meta<typeof TeamBridgeAddMembersView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
	play: async ({ canvasElement }) => {
		const dialog = within(canvasElement.ownerDocument.body);
		await expect(dialog.getByText("Aida (Damian Tran)")).toBeInTheDocument();
		await expect(dialog.getByText("Invited; not active yet")).toBeInTheDocument();
		await expect(dialog.getByRole("button", { name: "Remove Ben Tran" })).toBeInTheDocument();
	},
};

export const Loading: Story = {
	args: { people: [], peopleState: "loading" },
};

export const LoadError: Story = {
	args: { people: [], peopleState: "error" },
};

export const Empty: Story = {
	args: { people: [] },
};

export const ReadOnly: Story = {
	args: { canAdminister: false },
};

export const MutationError: Story = {
	args: { mutationError: true },
};

export const InvitationPending: Story = {
	args: { pendingKey: "add" },
};

export const HeaderControl: Story = {
	args: { open: false },
};
