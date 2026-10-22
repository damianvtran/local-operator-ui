import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
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
