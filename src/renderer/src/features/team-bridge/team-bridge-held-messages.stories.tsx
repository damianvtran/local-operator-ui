import type { Meta, StoryObj } from "@storybook/react";
import type { OwnerAuditMessage } from "../../../../shared/team-bridge-owner-audit-contract";
import { HeldMessagesView } from "./team-bridge-held-messages";
import { type HoldItem, holdRefusalLabel } from "./team-bridge-holds-model";
import type { HeldMessageDetail } from "./use-team-bridge-holds";

/*
 * The Held messages section of Approvals in each state a design and UX
 * reviewer must see: populated with every hold kind found on the operator's
 * machine (model_hold, work_scope_hold, write_once_conflict) plus core #4212's
 * Discard-only `screening_failed` with its Unscreened badge, an out-of-window
 * hold, a decided one and one whose details could not load; empty; error;
 * loading; release turned off. Presentational only: reasons, buttons and
 * refusals come from the same model the container uses, and the body shown is
 * the owner-audit body, never anything the hold list carries.
 */

const NOW = Date.parse("2026-11-18T12:00:00Z");
const hold = (id: string, over: Partial<HoldItem> = {}): HoldItem => ({
	message_id: id,
	conversation_id: "bcv_storyconv",
	seq: 4,
	held_at: "2026-10-31T09:12:00Z",
	kind: "owner_decision",
	hold_code: "model_hold",
	releasable: true,
	can_deliver: true,
	can_discard: true,
	deliver_until: "2026-11-24T09:12:00Z",
	decision: null,
	...over,
});
const audit = (
	id: string,
	person: string,
	body: string,
	agent?: string,
): OwnerAuditMessage =>
	({
		id,
		conversation_id: "bcv_storyconv",
		seq: 4,
		sender: { account_id: "acct_x", kind: "human", display_label: person },
		body,
		body_hash: null,
		origin: agent ? "agent" : "human",
		agent_label: agent ?? null,
		created_at: "2026-10-31T09:12:00Z",
	}) as unknown as OwnerAuditMessage;

const items: HoldItem[] = [
	hold("bcmsg_review", { held_at: "2026-10-31T09:12:00Z" }),
	hold("bcmsg_work", {
		hold_code: "work_scope_hold",
		held_at: "2026-11-17T16:40:00Z",
		deliver_until: "2026-11-24T16:40:00Z",
	}),
	hold("bcmsg_failed", {
		hold_code: "screening_failed",
		kind: "screening",
		can_deliver: false,
		deliver_until: null,
		unscreened: true,
		held_at: "2026-11-16T08:05:00Z",
	}),
	hold("bcmsg_conflict", {
		hold_code: "write_once_conflict",
		kind: "waiting",
		releasable: false,
		can_deliver: false,
		can_discard: false,
		deliver_until: null,
		held_at: "2026-11-10T11:00:00Z",
	}),
	hold("bcmsg_old", {
		can_deliver: false,
		deliver_until: "2026-11-07T10:00:00Z",
		held_at: "2026-10-31T10:00:00Z",
	}),
	hold("bcmsg_decided", {
		decision: {
			word: "discard",
			decided_at: "2026-11-18T10:00:00Z",
			outcome: "pending",
			key_id: "k1",
		},
	}),
	hold("bcmsg_missing"),
];

const messages: Record<string, OwnerAuditMessage> = {
	bcmsg_review: audit(
		"bcmsg_review",
		"Renee Park",
		"Can you check whether the Q4 vendor list is final before Friday?",
	),
	bcmsg_work: audit(
		"bcmsg_work",
		"Omar Haddad",
		"Please start drafting the onboarding plan for the new region and share a first version tomorrow.",
		"Atlas",
	),
	bcmsg_failed: audit(
		"bcmsg_failed",
		"Priya Shah",
		"Quick one: what time is the review on Thursday?",
		"Scout",
	),
	bcmsg_conflict: audit(
		"bcmsg_conflict",
		"Ana Lee",
		"Following up on the contract notes.",
	),
	bcmsg_old: audit("bcmsg_old", "Ben Tran", "Are we still on for the demo?"),
	bcmsg_decided: audit(
		"bcmsg_decided",
		"Renee Park",
		"Ignore my last message.",
	),
};

const SHA = "0".repeat(64);
const detail = (item: HoldItem): HeldMessageDetail => {
	const message = messages[item.message_id];
	return message
		? { state: "ready", message, bodySha256: SHA }
		: { state: "unavailable" };
};

const meta = {
	title: "Team Bridge/Held messages",
	component: HeldMessagesView,
	parameters: { layout: "padded" },
	args: {
		listState: "ready",
		items,
		detail,
		now: NOW,
		onDecide: () => {},
		onRetry: () => {},
	},
	decorators: [
		(Story) => (
			<div className="max-w-2xl bg-surface p-5">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof HeldMessagesView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Unscreened: Story = {
	args: {
		items: items.filter((item) => item.message_id === "bcmsg_failed"),
		refusals: {
			bcmsg_failed: holdRefusalLabel("snapshot_stale"),
		},
	},
};

export const Empty: Story = { args: { items: [] } };

export const LoadError: Story = { args: { listState: "error", items: [] } };

export const Loading: Story = { args: { listState: "loading", items: [] } };

export const ReleaseOff: Story = {
	args: {
		enabled: false,
		items: [
			hold("bcmsg_review", {
				releasable: false,
				can_deliver: false,
				can_discard: false,
			}),
		],
	},
};

/* The lower half of Populated on its own, so one viewport frames it: too old
   to deliver (Discard only), already decided, and details unavailable. */
export const Outcomes: Story = {
	args: {
		items: items.filter((item) =>
			["bcmsg_old", "bcmsg_decided", "bcmsg_missing"].includes(item.message_id),
		),
	},
};
