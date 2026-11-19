import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui/dialog";
import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect, useState } from "react";
import {
	TeamBridgeAuthorizeNoticeView,
	TeamBridgeAuthorizeNotices,
} from "./team-bridge-approval-notice";
import { TeamBridgeRequestsView } from "./team-bridge-approvals";
import {
	type ApprovalDecisionRow,
	type ApprovalRequestRow,
	applyAuthorizeFrame,
	mapApprovalRefusal,
	resetAuthorizeNoticesForTests,
} from "./team-bridge-approvals-model";
import { HeldMessagesView } from "./team-bridge-held-messages";
import type { HoldItem } from "./team-bridge-holds-model";

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
	account_id: `acct_${name.toLowerCase().replace(/\W+/g, "_")}`,
	endpoint_id: null,
	name,
	email: `${name.toLowerCase().split(" ")[0]}@example.com`,
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
	request: { state: "pending", expires_at: "2026-11-17T15:05:00Z" },
	sender: person(name),
	ask: { session_id: "s_cos", ask_id: `ask_${id}`, status: "open" },
	decidable: true,
	unsent_decision: null,
	...over,
});

const priya = row(
	"bcmsg_1",
	"Priya Raman",
	"Priya's agent asks: may it deploy the staging build of the billing service?",
);
const omar = row(
	"bcmsg_2",
	"Omar Haddad",
	"Omar's agent asks: may it share the Q3 forecast sheet with the finance channel?",
);
const lockedRow = row(
	"bcmsg_3",
	"Lena Fischer",
	"Lena's agent asks: may it book the offsite venue for 12 people?",
	{ unsent_decision: "approve" },
);
const noCard = row("bcmsg_4", "Sam Okafor", "", {
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
		requested_by: person("Priya Raman"),
		decided_by: person("Damian"),
		decided_via_claimed: "desktop",
		ask_id: "ask_9",
	},
	{
		request_id: "bcmsg_8",
		thread_id: "bct_2",
		decision: "denied",
		decided_at: "2026-11-15T17:40:00Z",
		requested_by: person("Omar Haddad"),
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
/**
 * After a batch: the decided rows have LEFT the list (the decide's refetch
 * drops them), so the results are their own list under a counted heading,
 * with the senders captured when the person pressed (R1-02, Q1, D7).
 */
export const MixedBatchResult: Story = {
	args: {
		rows: [lockedRow, noCard],
		flow: {
			phase: "done",
			labels: {
				bcmsg_1: "Priya Raman",
				bcmsg_2: "Omar Haddad",
				bcmsg_3: "Lena Fischer",
			},
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
/** Everything sent: no rows left, the results stay until Dismiss. */
export const AllSentResult: Story = {
	args: {
		rows: [],
		flow: {
			phase: "done",
			labels: { bcmsg_1: "Priya Raman", bcmsg_2: "Omar Haddad" },
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
					decision: "deny",
					sent: true,
					ask_settled: true,
					status: "denied",
				},
			],
		},
	},
};
/**
 * A long list scrolled: the batch bar stays pinned at the top, and Select all
 * reads mixed with 2 of 12 selected (U8).
 */
export const ManyRowsScrolled: Story = {
	args: {
		rows: Array.from({ length: 12 }, (_, index) =>
			row(
				`bcmsg_m${index}`,
				["Priya Raman", "Omar Haddad", "Lena Fischer"][index % 3],
				`Request ${index + 1}: may it renew the shared tooling subscription?`,
			),
		),
		initialSelected: ["bcmsg_m0", "bcmsg_m1"],
	},
	play: async ({ canvasElement }) => {
		const scroller = canvasElement.querySelector("section");
		if (scroller) scroller.scrollTop = 600;
	},
};
/** Two selected, one of them locked to Approve: Deny says "1 of 2" (U6). */
export const SelectionWithLockedRow: Story = {
	args: {
		rows: populated,
		initialSelected: ["bcmsg_1", "bcmsg_3"],
	},
};
/** Counts down live and clears itself when the wait ends (D4, Q3). */
export const Cooldown: Story = {
	args: {
		rows: populated,
		coolingDown: true,
		cooldownUntil: Date.now() + 8_000,
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
/** Batch deciding unavailable: each row opens its card instead (D5, U3). */
export const PresenceRequired: Story = {
	args: {
		rows: populated,
		presenceRequired: true,
		onOpenCard: () => {},
		flow: { phase: "refused", refusal: refusal("operator_presence_required") },
	},
};
/** The same state after Dismiss: the batch controls stay away (D5). */
export const PresenceRequiredDismissed: Story = {
	args: {
		rows: populated,
		presenceRequired: true,
		onOpenCard: () => {},
	},
};
/** Rows with their "Open in chat" door (U3). */
export const PopulatedWithOpen: Story = {
	args: { rows: populated, onOpenCard: () => {} },
};
/** A prompt this window did not start has ended: the trace it leaves (U7). */
export const ForeignPromptTrace: Story = {
	args: {
		rows: populated,
		onDismissTrace: () => {},
		traces: [
			{
				authorizeId: "f1",
				count: 2,
				ended: "signed",
				at: Date.parse("2026-11-17T14:12:00Z"),
			},
			{
				authorizeId: "f0",
				count: 1,
				ended: "dismissed",
				at: Date.parse("2026-11-17T14:02:00Z"),
			},
		],
	},
};
/**
 * History: the first row was decided on this machine, so it carries the
 * excerpt captured then and opens its card; the second was decided elsewhere
 * (U2).
 */
export const History: Story = {
	args: {
		initialTab: "history",
		onOpenCard: () => {},
		decided: (id) =>
			id === "bcmsg_9"
				? {
						sender: "Priya Raman",
						excerpt:
							"Priya's agent asks: may it renew the design-tool licence for one year?",
						sessionId: "s_cos",
					}
				: null,
	},
};
export const HistoryEmpty: Story = {
	args: { initialTab: "history", history: { state: "ready", rows: [] } },
};

const promptItems = [
	{
		message_id: "bcmsg_1",
		word: "approve" as const,
		sender: "Priya Raman",
		excerpt: "may it deploy the staging build of the billing service?",
	},
	{
		message_id: "bcmsg_2",
		word: "deny" as const,
		sender: "Omar Haddad",
		excerpt: "may it share the Q3 forecast sheet with the finance channel?",
	},
];

/** The prompt notice for a confirmation this window started. */
export const PromptNoticeOwn: StoryObj<typeof TeamBridgeAuthorizeNoticeView> = {
	render: () => (
		<div className="flex w-full items-start justify-center p-6">
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
		<div className="flex w-full items-start justify-center p-6">
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
							{
								message_id: "bcmsg_y",
								word: null,
								sender: "Omar Haddad",
								excerpt: null,
							},
						],
					},
				]}
			/>
		</div>
	),
};

/**
 * The notice above an open dialog (security S-3): the host is portalled to
 * <body> at `z-[60]`, over Radix's `z-50` scrim, and keeps `aria-live` so the
 * dialog's `aria-hidden` sweep leaves it announced. Drives the REAL host
 * through the module store with a foreign frame (no `client_ref`).
 */
function NoticeOverDialog() {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		resetAuthorizeNoticesForTests();
		applyAuthorizeFrame({
			authorize_id: "story_foreign",
			client_ref: null,
			state: "prompting",
			items: [promptItems[0]],
		});
		setReady(true);
		return () => resetAuthorizeNoticesForTests();
	}, []);
	if (!ready) return null;
	return (
		<>
			<Dialog open>
				<DialogContent>
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>
						A dialog the person had open when the prompt appeared.
					</DialogDescription>
				</DialogContent>
			</Dialog>
			<TeamBridgeAuthorizeNotices />
		</>
	);
}
export const PromptNoticeOverDialog: StoryObj = {
	render: () => <NoticeOverDialog />,
};

/*
 * Approvals with the Held messages section composed in (design D1, UX U1):
 * no requests and three holds (held messages first, no "No requests are
 * waiting." line), requests and holds together, and neither (one empty
 * state, not two).
 */
const heldAt = (day: number) =>
	`2026-11-${String(day).padStart(2, "0")}T09:00:00Z`;
const heldItem = (id: string, over: Partial<HoldItem> = {}): HoldItem => ({
	message_id: id,
	conversation_id: "bcv_storyconv",
	seq: 4,
	held_at: heldAt(16),
	kind: "owner_decision",
	hold_code: "model_hold",
	releasable: true,
	can_deliver: true,
	can_discard: true,
	deliver_until: heldAt(23),
	decision: null,
	...over,
});
const heldItems = [
	heldItem("bcmsg_h1"),
	heldItem("bcmsg_h2", { hold_code: "work_scope_hold" }),
	heldItem("bcmsg_h3", {
		can_deliver: false,
		held_at: heldAt(1),
		deliver_until: heldAt(8),
	}),
];
const heldBodies: Record<string, [string, string]> = {
	bcmsg_h1: [
		"Renee Park",
		"Can you check whether the Q4 vendor list is final?",
	],
	bcmsg_h2: ["Omar Haddad", "Please start drafting the onboarding plan."],
	bcmsg_h3: ["Ben Tran", "Are we still on for the demo?"],
};
const heldView = (items: HoldItem[], hideWhenEmpty = false) => (
	<HeldMessagesView
		listState="ready"
		items={items}
		hideWhenEmpty={hideWhenEmpty}
		now={Date.parse("2026-11-18T12:00:00Z")}
		onDecide={() => {}}
		detail={(item) => {
			const [person, body] = heldBodies[item.message_id] ?? ["", ""];
			return {
				state: "ready",
				tenantId: "tnt_story",
				binding: { state: "shown", hash: "0".repeat(64) },
				message: {
					id: item.message_id,
					conversation_id: item.conversation_id,
					seq: 4,
					sender: {
						account_id: "acct_x",
						kind: "human",
						display_label: person,
					},
					body,
					body_hash: null,
					origin: "human",
					agent_label: null,
					created_at: heldAt(16),
				} as never,
			};
		}}
	/>
);

export const HeldOnly: Story = {
	args: { rows: [], held: heldView(heldItems), heldCount: heldItems.length },
};

export const HeldAndRequests: Story = {
	args: {
		rows: populated,
		held: heldView(heldItems),
		heldCount: heldItems.length,
	},
};

export const NeitherWithHeldSection: Story = {
	args: { rows: [], held: heldView([], true), heldCount: 0 },
};
