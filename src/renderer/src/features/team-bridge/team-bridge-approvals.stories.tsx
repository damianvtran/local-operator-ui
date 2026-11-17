import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type { Meta, StoryObj } from "@storybook/react";
import {
	TeamBridgeAuthorizeNoticeView,
	TeamBridgeRequestsView,
} from "./team-bridge-approvals";
import {
	type ApprovalDecisionRow,
	type ApprovalRequestRow,
	mapApprovalRefusal,
} from "./team-bridge-approvals-model";

/*
 * The Team Bridge Requests view and the Touch ID prompt notice, in each state
 * a design and UX reviewer must see: loading, empty, error, populated (with a
 * locked row and a row that cannot be decided here), a mixed batch result, the
 * cooldown refusal, the locked refusal, presence-required, the decision
 * history, and the prompt notice both as started here and as NOT started by
 * you. Presentational only: refusals are built through the same
 * `mapApprovalRefusal` the container uses, so the copy shown is the copy
 * shipped. No message body appears anywhere - rows carry the card excerpt only.
 */

const at = "2026-11-17T14:05:00Z";
const person = (name: string) => ({
	account_id: `acct_${name.toLowerCase()}`,
	endpoint_id: null,
	name,
	email: `${name.toLowerCase()}@example.com`,
});
const row = (
	id: string,
	name: string,
	excerpt: string,
	over: Partial<ApprovalRequestRow> = {},
): ApprovalRequestRow => ({
	message_id: id,
	thread_id: "bct_1",
	created_at: at,
	excerpt,
	request: { state: "pending", expires_at: null },
	sender: person(name),
	ask: { session_id: "s_cos", ask_id: `ask_${id}`, status: "open" },
	decidable: true,
	unsent_decision: null,
	...over,
});

const priya = row(
	"bcmsg_1",
	"Priya",
	"Priya's agent asks: may it deploy the staging build of the billing service?",
);
const omar = row(
	"bcmsg_2",
	"Omar",
	"Omar's agent asks: may it share the Q3 forecast sheet with the finance channel?",
);
const lockedRow = row(
	"bcmsg_3",
	"Lena",
	"Lena's agent asks: may it book the offsite venue for 12 people?",
	{ unsent_decision: "approve" },
);
const noCard = row("bcmsg_4", "Sam", "", {
	excerpt: null,
	ask: null,
	decidable: false,
});
const populated = [priya, omar, lockedRow, noCard];

const history: ApprovalDecisionRow[] = [
	{
		request_id: "bcmsg_9",
		thread_id: "bct_1",
		decision: "approved",
		decided_at: "2026-11-16T09:12:00Z",
		requested_by: person("Priya"),
		decided_by: person("Damian"),
		decided_via_claimed: "desktop",
		ask_id: "ask_9",
	},
	{
		request_id: "bcmsg_8",
		thread_id: "bct_2",
		decision: "denied",
		decided_at: "2026-11-15T17:40:00Z",
		requested_by: person("Omar"),
		decided_by: person("Damian"),
		decided_via_claimed: "ask",
		ask_id: "ask_8",
	},
];

const refusal = (code: string, detail?: unknown) =>
	mapApprovalRefusal(
		new DesktopControlError(409, "", undefined, code, undefined, detail),
		(id) => populated.find((r) => r.message_id === id)?.sender.name ?? null,
	);

const meta = {
	title: "Team Bridge/Requests",
	component: TeamBridgeRequestsView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[720px] bg-surface text-ink">
				<Story />
			</div>
		),
	],
	args: {
		listState: "ready",
		rows: [],
		flow: { phase: "idle" },
		onDecide: () => {},
		onRetry: () => {},
		onDismissFlow: () => {},
		history: { state: "ready", rows: history },
	},
} satisfies Meta<typeof TeamBridgeRequestsView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { listState: "loading" } };
export const Empty: Story = {};
export const LoadError: Story = { args: { listState: "error" } };
/** Two open rows, one locked to its unsent "Approve", one with no card here. */
export const Populated: Story = { args: { rows: populated } };
export const Authorizing: Story = {
	args: {
		rows: populated,
		flow: {
			phase: "authorizing",
			items: [
				{ message_id: "bcmsg_1", decision: "approve" },
				{ message_id: "bcmsg_2", decision: "approve" },
			],
		},
	},
};
/** One approved, one already answered on its card, one not confirmed yet. */
export const MixedBatchResult: Story = {
	args: {
		rows: populated,
		flow: {
			phase: "done",
			results: [
				{
					message_id: "bcmsg_1",
					decision: "approve",
					sent: true,
					ask_settled: true,
					status: "approved",
				},
				{
					message_id: "bcmsg_2",
					decision: "approve",
					sent: false,
					ask_settled: false,
					error: "answered_on_card",
				},
				{
					message_id: "bcmsg_3",
					decision: "approve",
					sent: true,
					ask_settled: false,
					error: "messaging_unavailable",
				},
			],
		},
	},
};
export const Cooldown: Story = {
	args: {
		rows: populated,
		coolingDown: true,
		flow: {
			phase: "refused",
			refusal: refusal("operator_prompt_cooldown", {
				details: { retry_after_s: 8 },
			}),
		},
	},
};
export const LockedRefusal: Story = {
	args: {
		rows: populated,
		flow: {
			phase: "refused",
			refusal: refusal("earlier_decision_unconfirmed", {
				details: {
					items: [{ message_id: "bcmsg_3", unsent_decision: "approve" }],
				},
			}),
		},
	},
};
export const PresenceRequired: Story = {
	args: {
		rows: populated,
		flow: { phase: "refused", refusal: refusal("operator_presence_required") },
	},
};
export const History: Story = { args: { initialTab: "history" } };
export const HistoryEmpty: Story = {
	args: { initialTab: "history", history: { state: "ready", rows: [] } },
};

const promptItems = [
	{
		message_id: "bcmsg_1",
		word: "approve" as const,
		sender: "Priya",
		excerpt: "may it deploy the staging build of the billing service?",
	},
	{
		message_id: "bcmsg_2",
		word: "deny" as const,
		sender: "Omar",
		excerpt: "may it share the Q3 forecast sheet with the finance channel?",
	},
];

/** The prompt notice for a confirmation this window started. */
export const PromptNoticeOwn: StoryObj<typeof TeamBridgeAuthorizeNoticeView> = {
	render: () => (
		<div className="flex justify-center p-6">
			<TeamBridgeAuthorizeNoticeView
				notices={[
					{
						authorizeId: "a1",
						foreign: false,
						approveCount: 1,
						denyCount: 1,
						items: promptItems,
					},
				]}
			/>
		</div>
	),
};
/** The security label: a prompt another local process raised. */
export const PromptNoticeForeign: StoryObj<
	typeof TeamBridgeAuthorizeNoticeView
> = {
	render: () => (
		<div className="flex justify-center p-6">
			<TeamBridgeAuthorizeNoticeView
				notices={[
					{
						authorizeId: "a2",
						foreign: true,
						approveCount: 1,
						denyCount: 0,
						items: [
							promptItems[0],
							{
								message_id: "bcmsg_x",
								word: "approve",
								sender: null,
								excerpt: null,
							},
						],
					},
				]}
			/>
		</div>
	),
};
