import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
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

/**
 * A roster long enough to scroll both columns at the dialog's 780px cap: the
 * evidence for "the last row ends fully visible above the footer" needs a list
 * that actually overflows. Names are synthetic.
 */
const LONG_NAMES = [
	"Ana Lima",
	"Bao Nguyen",
	"Carla Diaz",
	"Dev Patel",
	"Elif Kaya",
	"Femi Ade",
	"Greta Holm",
	"Hiro Sato",
	"Ines Costa",
	"Jon Berg",
	"Kira Wolf",
	"Lea Novak",
	"Milo Hart",
	"Nia Brooks",
];
const longPeople: TeamBridgeDirectoryMember[] = [
	...people,
	...LONG_NAMES.map((name, index) => ({
		account_id: `acct_long_${index}`,
		display_label: name,
		role: "member",
		bridge_enabled: true,
		bridge_state: "active" as const,
		agent: {
			endpoint_id: `bep_long_${index}`,
			name: "Aida",
			state: "active" as const,
		},
	})),
];
const longConversation: TeamBridgeConversation = {
	...conversation,
	members: [
		...conversation.members,
		...LONG_NAMES.slice(0, 10).map((name, index) => ({
			account_id: `acct_long_${index}`,
			kind: "human" as const,
			display_label: name,
			role: "member" as const,
			state: "active" as const,
		})),
	],
};

const meta = {
	title: "Team Bridge/Add members",
	component: TeamBridgeAddMembersView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="min-h-dvh bg-canvas">
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
		canInvite: true,
		canRemove: true,
		onClose: () => {},
		onRetryMembers: () => {},
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
		// An invited agent is never painted as active: it wears the Invited pill.
		await expect(dialog.getByText("Invited")).toBeInTheDocument();
		await expect(
			dialog.getByRole("button", { name: "Remove Ben Tran from conversation" }),
		).toBeInTheDocument();
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
	args: { canInvite: false, canRemove: false },
};

/**
 * A peer who EXISTS in the directory but cannot be reached yet. The operator
 * asked to see these rather than have them hidden, so the row stays, disabled,
 * with the reason in words - the frame is the evidence for that requirement.
 */
export const BridgeNotEnabled: Story = {
	args: { people: [people[0], people[4]] },
	play: async ({ canvasElement }) => {
		const dialog = within(canvasElement.ownerDocument.body);
		await expect(dialog.getByText("Cy Smith")).toBeInTheDocument();
		await expect(dialog.getByText("Not on Team Bridge")).toBeInTheDocument();
	},
};

/** Enough rows to scroll both columns; the capture scrolls them to the end. */
export const LongList: Story = {
	args: { conversation: longConversation, people: longPeople },
	/*
	 * Scrolled to the END of both columns, because the defect being guarded is
	 * the LAST row: it must sit fully above the footer, not under its edge.
	 */
	play: async ({ canvasElement }) => {
		const body = canvasElement.ownerDocument.body;
		await waitFor(() =>
			expect(
				body.querySelectorAll('[role="dialog"] [class*="overflow-y-auto"]'),
			).toHaveLength(2),
		);
		for (const column of body.querySelectorAll<HTMLElement>(
			'[role="dialog"] [class*="overflow-y-auto"]',
		)) {
			column.scrollTop = column.scrollHeight;
			await expect(column.scrollHeight).toBeGreaterThan(column.clientHeight);
		}
	},
};

/** A query that matches only a current member: the invite list says why. */
export const SearchNoResults: Story = {
	play: async ({ canvasElement }) => {
		const dialog = within(canvasElement.ownerDocument.body);
		await userEvent.type(
			dialog.getByRole("textbox", { name: "Search people and agents" }),
			"ben",
		);
		await expect(
			dialog.getByText(/No one to invite matches/),
		).toBeInTheDocument();
	},
};

/** A query nothing matches: both columns state their own empty result. */
export const SearchNothing: Story = {
	play: async ({ canvasElement }) => {
		const dialog = within(canvasElement.ownerDocument.body);
		await userEvent.type(
			dialog.getByRole("textbox", { name: "Search people and agents" }),
			"zzz",
		);
		await expect(
			dialog.getByText("No current members match your search."),
		).toBeInTheDocument();
	},
};

/**
 * The remove action revealed with its tooltip. Synthetic events cannot set CSS
 * `:hover`, so the reveal shown is the keyboard one (`:focus-within`, the same
 * class list); the tooltip opens from the hover the play dispatches.
 */
export const RemoveTooltip: Story = {
	play: async ({ canvasElement }) => {
		const dialog = within(canvasElement.ownerDocument.body);
		const button = dialog.getByRole("button", {
			name: "Remove Ben Tran from conversation",
		});
		button.focus();
		await userEvent.hover(button);
		await waitFor(() =>
			expect(dialog.getAllByText("Remove from conversation")[0]).toBeVisible(),
		);
	},
};

/** The first press arms the row; the confirmation names the member. */
export const RemoveConfirm: Story = {
	play: async ({ canvasElement }) => {
		const dialog = within(canvasElement.ownerDocument.body);
		const button = dialog.getByRole("button", {
			name: "Remove Ben Tran from conversation",
		});
		// Focus first: the action is `pointer-events-none` until its row is
		// hovered or focused (the shared reveal), and userEvent honours that.
		button.focus();
		await userEvent.click(button);
		await waitFor(() =>
			expect(
				dialog.getByRole("button", { name: "Remove Ben Tran" }),
			).toBeInTheDocument(),
		);
	},
};

/** The remove write in flight: the row says "Removing…" in place. */
export const Removing: Story = {
	args: { pendingKey: "remove:acct_ben" },
};

export const MutationError: Story = {
	args: { mutationError: true },
};

export const InvitationPending: Story = {
	args: { pendingKey: "add" },
};

/** The dialog closed: later captures pair it with the header/menu stories. */
export const Closed: Story = {
	args: { open: false },
};
