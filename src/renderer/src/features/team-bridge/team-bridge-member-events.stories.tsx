import { TooltipProvider } from "@shared/components/ui/tooltip";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import type {
	TeamBridgeEvent,
	TeamBridgeEventParty,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeMessageList } from "./team-bridge-message-list";

/*
 * Membership event lines in the SHIPPED timeline list, from fixtures that
 * transcribe the frozen agent-server `events[]` contract (the server is not
 * deployed yet). `NoEvents` is the same timeline with the field absent: what
 * every conversation shows until the hub sends events.
 */

const party = (
	account: string,
	label: string,
	kind: "human" | "agent" = "human",
): TeamBridgeEventParty => ({
	kind,
	account_id: account,
	display_label: label,
	...(kind === "agent" ? { endpoint_id: `bep_${account}` } : {}),
});
const DAMIAN = party("acct_damian", "Damian Tran");
const BEN = party("acct_ben", "Ben Tran");
const SANA = party("acct_sana", "Sana Ketabchi");
const AIDA_SANA = party("acct_sana", "Aida (Sana Ketabchi)", "agent");
const AIDA_DAMIAN = party("acct_damian", "Aida (Damian Tran)", "agent");
const MILO = party("acct_milo", "Milo Park");

let eventSeq = 0;
const event = (overrides: Partial<TeamBridgeEvent>): TeamBridgeEvent => {
	eventSeq += 1;
	return {
		id: `bcev_story_${eventSeq}`,
		event_seq: eventSeq,
		kind: "invited",
		implicit: false,
		actor: DAMIAN,
		targets: [SANA],
		request_id: `bcrq_story_${eventSeq}`,
		after_seq: 0,
		at: "2026-10-30T14:02:11.123Z",
		...overrides,
	};
};

const today = new Date();
const at = (minutes: number) =>
	new Date(
		today.getFullYear(),
		today.getMonth(),
		today.getDate(),
		9,
		minutes,
	).toISOString();
const message = (
	seq: number,
	sender: TeamBridgeEventParty,
	body: string,
	minute: number,
): TeamBridgeMessage => ({
	id: `bcmsg_story_${seq}`,
	conversation_id: "bcv_story",
	seq,
	sender: {
		account_id: sender.account_id,
		kind: sender.kind,
		display_label: sender.display_label,
	},
	body,
	origin: sender.kind,
	created_at: at(minute),
});

const MESSAGES = [
	message(1, DAMIAN, "Kicking off the launch checklist here.", 0),
	message(2, BEN, "Thanks. I'll take the release notes.", 6),
	message(3, SANA, "Happy to help with QA.", 14),
	message(4, DAMIAN, "Great, the build is up for review.", 30),
];

const meta = {
	title: "Team Bridge/Member events",
	component: TeamBridgeMessageList,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<TooltipProvider>
				<div className="flex min-h-[420px] w-[640px] max-w-full flex-col bg-canvas text-ink">
					<Story />
				</div>
			</TooltipProvider>
		),
	],
	args: {
		messages: MESSAGES,
		labelFor: (sender) => sender.display_label,
		arrivalsEnabled: false,
	},
} satisfies Meta<typeof TeamBridgeMessageList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The 'before': the timeline with `events` absent (today's hub). */
export const NoEvents: Story = {};

export const SingleInvite: Story = {
	args: {
		events: [
			event({
				after_seq: 1,
				targets: [SANA, AIDA_SANA],
				at: at(2),
			}),
		],
	},
};

export const RolledUpInvite: Story = {
	args: {
		events: [
			event({
				id: "bcev_rollup_a",
				request_id: "bcrq_rollup",
				after_seq: 2,
				targets: [BEN, SANA],
				at: at(8),
			}),
			event({
				id: "bcev_rollup_b",
				request_id: "bcrq_rollup",
				after_seq: 2,
				targets: [AIDA_SANA, MILO],
				at: at(8),
			}),
		],
	},
};

/** The full-list sentence a keyboard reader lands on (see `RolledUpInvite`). */
const FULL_LIST_NAME =
	/invited Ben Tran, Sana Ketabchi, Aida \(Sana Ketabchi\), and Milo Park/;

/** Keyboard focus opens the full list (hover does the same with a pointer). */
export const RolledUpTooltip: Story = {
	...RolledUpInvite,
	play: async ({ canvasElement }) => {
		await userEvent.tab();
		const line = within(canvasElement).getByLabelText(FULL_LIST_NAME);
		await expect(line).toHaveFocus();
	},
};

export const JoinsLeavesRemovals: Story = {
	args: {
		events: [
			event({
				kind: "joined",
				implicit: true,
				implicit_reason: "owner_invite",
				targets: [AIDA_DAMIAN],
				after_seq: 1,
				at: at(1),
			}),
			event({
				kind: "consented",
				actor: SANA,
				targets: [AIDA_SANA],
				after_seq: 2,
				at: at(9),
			}),
			event({
				kind: "left",
				actor: BEN,
				targets: [BEN],
				after_seq: 3,
				at: at(20),
			}),
			event({
				kind: "removed",
				targets: [MILO],
				after_seq: 3,
				at: at(21),
			}),
			event({
				kind: "ownership_transferred",
				after_seq: 4,
				at: at(31),
			}),
		],
	},
};
