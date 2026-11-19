import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { useEffect, useState } from "react";
import type { TeamBridgeMessage } from "../../../../shared/team-bridge-contract";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";

const root: TeamBridgeMessage = {
	id: "bcmsg_root0001",
	conversation_id: "bcv_threads01",
	seq: 1,
	sender: { account_id: "acct_a", kind: "human", display_label: "Ada" },
	body: "Who can QA the new conversation flow?\n\nPlease check tenant isolation and the empty state.",
	origin: "human",
	created_at: new Date().toISOString(),
};
const reply: TeamBridgeMessage = {
	...root,
	id: "bcmsg_reply001",
	seq: 2,
	sender: { account_id: "acct_b", kind: "agent", display_label: "Bea's agent" },
	body: "Claiming this. I will post the request/response evidence here.\n\n- Unauthorized request\n- Wrong tenant\n- Successful send",
	origin: "agent",
	thread_root_id: root.id,
};

const meta = {
	title: "Team Bridge/Thread pane",
	component: TeamBridgeThreadPaneView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[720px] bg-surface text-ink">
				<div className="flex-1 p-6 text-ink-muted">#agents</div>
				<div className="h-full w-[26rem] shrink-0">
					<Story />
				</div>
			</div>
		),
	],
	args: {
		root,
		replies: [],
		state: "ready",
		labelFor: (sender) => sender.display_label,
		onClose: () => {},
		onRetry: () => {},
		onSend: async () => {},
	},
} satisfies Meta<typeof TeamBridgeThreadPaneView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Loading: Story = { args: { state: "loading" } };
export const LoadError: Story = { args: { state: "error" } };
export const Populated: Story = {
	args: { root: { ...root, reply_count: 1 }, replies: [reply] },
};
export const ReadOnly: Story = { args: { readOnly: true } };
export const SendError: Story = {
	args: {
		onSend: async () => {
			throw new Error("refused");
		},
	},
};

/** Deterministic long-thread and request-pending boards; no real dispatch. */
export const MoreReplies: Story = {
	args: { root: { ...root, reply_count: 51 }, replies: [reply], hasMore: true },
};
export const LoadingMoreReplies: Story = {
	args: {
		root: { ...root, reply_count: 51 },
		replies: [reply],
		hasMore: true,
		loadingMore: true,
	},
};
export const Sending: Story = {
	args: {
		root: { ...root, reply_count: 1 },
		replies: [reply],
		onSend: () => new Promise<void>(() => {}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("textbox"),
			"I am checking this now.",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: t("ui.teamBridge.composer.send") }),
		);
	},
};

/* F9 frame: an overflowing thread opens at its newest reply. */
export const LongThreadOpensAtNewest: Story = {
	args: {
		root: { ...root, reply_count: 18 },
		replies: Array.from({ length: 18 }, (_, index) => ({
			...reply,
			id: `bcmsg_long_reply_${index + 1}`,
			seq: index + 2,
			body:
				index === 17
					? "Newest reply — this should be in view when the thread opens."
					: `Earlier reply ${index + 1}.`,
		})),
	},
};

const longReplies = (count: number, from = 0): TeamBridgeMessage[] =>
	Array.from({ length: count }, (_, index) => ({
		...reply,
		id: `bcmsg_page_reply_${from + index + 1}`,
		seq: from + index + 2,
		body: `Reply ${from + index + 1}.`,
	}));

/*
 * D18: "Load more replies" that REALLY appends a page (the thread pages
 * forward). With `hold()` the reader stays where they were and reads the new
 * page downward; without it the view would jump to the end of the new page.
 * The first reply of the new page reads "Reply 13." so the frame shows where
 * reading resumes.
 */
const LoadMoreAppends = () => {
	const [replies, setReplies] = useState(() => longReplies(12));
	const [loadingMore, setLoadingMore] = useState(false);
	return (
		<TeamBridgeThreadPaneView
			root={{ ...root, reply_count: 24 }}
			replies={replies}
			state="ready"
			labelFor={(sender) => sender.display_label}
			onClose={() => {}}
			onRetry={() => {}}
			onSend={async () => {}}
			hasMore={replies.length < 24}
			loadingMore={loadingMore}
			onMore={() => {
				setLoadingMore(true);
				// A short delay, like a real page fetch, so before/after frames differ.
				setTimeout(() => {
					setReplies((current) => [
						...current,
						...longReplies(12, current.length),
					]);
					setLoadingMore(false);
				}, 400);
			}}
		/>
	);
};
export const LoadMoreAppendsPage: Story = {
	render: () => <LoadMoreAppends />,
};

/*
 * D14: a reply ARRIVES while the reader is scrolled up. Scroll to the top,
 * then wait: every 3 s a new reply is appended. The reader is not moved.
 * Scroll back to the bottom and later replies are followed again.
 */
const ArrivesWhileScrolledUp = () => {
	const [replies, setReplies] = useState(() => longReplies(16));
	useEffect(() => {
		const timer = setInterval(() => {
			setReplies((current) =>
				current.length >= 24
					? current
					: [...current, ...longReplies(1, current.length)],
			);
		}, 3000);
		return () => clearInterval(timer);
	}, []);
	return (
		<TeamBridgeThreadPaneView
			root={{ ...root, reply_count: replies.length }}
			replies={replies}
			state="ready"
			labelFor={(sender) => sender.display_label}
			onClose={() => {}}
			onRetry={() => {}}
			onSend={async () => {}}
		/>
	);
};
export const ReplyArrivesWhileScrolledUp: Story = {
	render: () => <ArrivesWhileScrolledUp />,
};
