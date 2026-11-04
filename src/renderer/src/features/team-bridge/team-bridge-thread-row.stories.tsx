import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type {
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { MentionSourceContext } from "./mentions/mention-context";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { TeamBridgeThreadRow } from "./team-bridge-thread-row";

/*
 * The thread summary row under a Team Bridge root (operator, 2026-11-04):
 * full-width, click anywhere to open, unread at a glance. Every state the
 * brief names — no replies (row absent), read, unread 1 and 12, many repliers
 * (5, 3 shown), an agent replier, an old reply (date-only time) — plus the row
 * in its real message-list context. Switch the toolbar theme for light/dark.
 *
 * WHAT IS MOCKED: the rollup fields, including the TR1 `thread_unread_count`
 * and `reply_participant_ids`, are synthetic hub answers; the clock is pinned
 * through `now` so the relative-time copy is stable in frames.
 */

const NOW = new Date(2026, 10, 4, 15, 0);
const at = (days: number, hour: number, minute: number) =>
	new Date(
		NOW.getFullYear(),
		NOW.getMonth(),
		NOW.getDate() - days,
		hour,
		minute,
	).toISOString();

const directory: Record<string, TeamBridgeDirectoryMember> = {
	acct_ben: {
		account_id: "acct_ben",
		display_label: "Ben Tran",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
	},
	acct_cora: {
		account_id: "acct_cora",
		display_label: "Cora Lin",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
	},
	acct_aida: {
		account_id: "acct_aida",
		display_label: "Aida",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
	},
};
const profileFor = (sender: TeamBridgeMessage["sender"]) =>
	directory[sender.account_id];

const root = (over: Partial<TeamBridgeMessage> = {}): TeamBridgeMessage => ({
	id: "bcmsg_story_root",
	conversation_id: "bcv_story",
	seq: 1,
	sender: { account_id: "acct_ada", kind: "human", display_label: "Ada" },
	body: "Can someone confirm the Q3 renewal list before I send it out?",
	origin: "human",
	created_at: at(0, 9, 12),
	reply_count: 4,
	last_reply_at: at(0, 10, 39),
	reply_participants: ["Ben Tran", "Cora Lin"],
	reply_participant_ids: [
		{ account_id: "acct_ben", kind: "human" },
		{ account_id: "acct_cora", kind: "human" },
	],
	thread_unread_count: 0,
	...over,
});

const Frame: FC<{ message: TeamBridgeMessage; width?: number }> = ({
	message,
	width = 640,
}) => (
	<div className="bg-canvas p-4 text-ink" style={{ width }}>
		<div className="text-[12px] text-ink-dim">Message content column</div>
		<TeamBridgeThreadRow
			message={message}
			onOpen={() => {}}
			profileFor={profileFor}
			locale="en"
			now={NOW}
		/>
		{/* A sentinel below the row, so the "no replies" frame visibly has nothing
		    between the caption and it. */}
		<div className="mt-1 text-[12px] text-ink-dim">Next message</div>
	</div>
);

const meta = {
	title: "Team Bridge/Thread row",
	component: Frame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Frame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoReplies: Story = {
	args: {
		message: root({
			reply_count: undefined,
			last_reply_at: undefined,
			reply_participants: undefined,
			reply_participant_ids: undefined,
			thread_unread_count: undefined,
		}),
	},
};

export const Read: Story = { args: { message: root() } };

export const UnreadOne: Story = {
	args: { message: root({ thread_unread_count: 1 }) },
};

export const UnreadTwelve: Story = {
	args: { message: root({ reply_count: 18, thread_unread_count: 12 }) },
};

/* Five repliers: the hub caps its list at three, and so does the facepile. */
/* Past the badge cap: `99+ unread` (QA round 1, Q2). */
export const UnreadOverCap: Story = {
	args: { message: root({ reply_count: 180, thread_unread_count: 150 }) },
};

export const ManyParticipants: Story = {
	args: {
		message: root({
			reply_count: 9,
			thread_unread_count: 2,
			reply_participants: ["Ben Tran", "Cora Lin", "Aida", "Dev", "Eli"],
			reply_participant_ids: [
				{ account_id: "acct_ben", kind: "human" },
				{ account_id: "acct_cora", kind: "human" },
				{ account_id: "acct_aida", kind: "agent" },
				{ account_id: "acct_dev", kind: "human" },
				{ account_id: "acct_eli", kind: "human" },
			],
		}),
	},
};

export const AgentParticipant: Story = {
	args: {
		message: root({
			reply_count: 2,
			reply_participants: ["Aida", "Ben Tran"],
			reply_participant_ids: [
				{ account_id: "acct_aida", kind: "agent" },
				{ account_id: "acct_ben", kind: "human" },
			],
		}),
	},
};

/* Yesterday, and a reply from a previous year (date with the year). */
export const Yesterday: Story = {
	args: { message: root({ last_reply_at: at(1, 16, 5) }) },
};

export const LongRelativeTime: Story = {
	args: {
		message: root({
			last_reply_at: new Date(2025, 0, 28, 8, 0).toISOString(),
			thread_unread_count: 3,
		}),
		width: 360,
	},
};

/* A pre-TR1 hub: labels only, no unread field. Initials, and no badge. */
export const OlderHub: Story = {
	args: {
		message: root({
			reply_participant_ids: undefined,
			thread_unread_count: undefined,
		}),
	},
};

/* The row in its real message-list context: a read thread above an unread one,
   on the channel timeline's own `canvas` ground (design round 1, D1; #1668). */
export const InMessageList: Story = {
	render: () => (
		<div className="flex w-[760px] flex-col bg-canvas text-ink">
			<TeamBridgeMessageList
				messages={[
					root({ id: "bcmsg_a", seq: 1 }),
					root({
						id: "bcmsg_b",
						seq: 2,
						sender: {
							account_id: "acct_ben",
							kind: "human",
							display_label: "Ben Tran",
						},
						body: "Deploy to prod-2 is green. Anything else before I close the window?",
						created_at: at(0, 11, 2),
						reply_count: 3,
						thread_unread_count: 2,
						reply_participants: ["Aida", "Cora Lin"],
						reply_participant_ids: [
							{ account_id: "acct_aida", kind: "agent" },
							{ account_id: "acct_cora", kind: "human" },
						],
					}),
				]}
				labelFor={(sender) => sender.display_label}
				profileFor={profileFor}
				onReply={() => {}}
				tenantId="tnt_story"
			/>
		</div>
	),
	args: { message: root() },
};

/*
 * THE BEFORE/AFTER PAIRS. The same root, drawn through the real message list,
 * under the same story names a capture of origin/main uses for the old pill,
 * so each evidence pair differs only by the change under review.
 */
/* `bg-canvas`: the channel timeline's real ground since #1668 (`team-bridge-page.tsx`), so
   a transparent row is judged where operators see it (design round 1, D1). */
const ListFrame: FC<{ message: TeamBridgeMessage }> = ({ message }) => (
	<div className="flex w-[760px] flex-col bg-canvas text-ink">
		<TeamBridgeMessageList
			messages={[message]}
			labelFor={(sender) => sender.display_label}
			profileFor={profileFor}
			onReply={() => {}}
			tenantId="tnt_story"
		/>
	</div>
);
const inList = (story: Story): Story => ({
	...story,
	render: (args) => <ListFrame message={args.message} />,
});
export const ListNoReplies = inList(NoReplies);
export const ListRead = inList(Read);
export const ListUnread = inList(UnreadTwelve);
export const ListManyParticipants = inList(ManyParticipants);

/* The thread pane's `surface` host (#1668): the second ground the row lives on,
   with the pane's two variables so the facepile ring matches it. */
export const InThreadPaneHost: Story = {
	args: { message: root({ thread_unread_count: 2 }) },
	render: (args) => (
		<div className="flex w-[480px] flex-col bg-surface text-ink [--thread-row-host:var(--color-surface)] [--thread-row-message-hover:var(--color-elevated)]">
			<TeamBridgeMessageList
				messages={[args.message]}
				labelFor={(sender) => sender.display_label}
				profileFor={profileFor}
				onReply={() => {}}
				tenantId="tnt_story"
				density="compact"
			/>
		</div>
	),
};

/*
 * A thread root that MENTIONS THE READER (#1672 round 3, D6): #1668 paints its
 * inset box `accent-wash` at rest and on hover, and the facepile ring must read
 * that wash rather than the timeline's canvas. A minimal mention source names
 * the reader so the list's own mention highlighting decides the wash.
 */
const readerMentionSource = {
	conversationId: "bcv_story",
	candidates: [],
	conversationKind: "channel" as const,
	sendMentions: true,
	self: { accountId: "acct_me", label: "Damian", labelUnique: true },
};
export const ListMentionedUnread: Story = {
	args: {
		message: root({
			body: "@Damian can you confirm the Q3 renewal list before I send it out?",
			mentions: [{ kind: "human", account_id: "acct_me" }],
			thread_unread_count: 2,
		}),
	},
	render: (args) => (
		<MentionSourceContext.Provider value={readerMentionSource}>
			<ListFrame message={args.message} />
		</MentionSourceContext.Provider>
	),
};
