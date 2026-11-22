import type { Meta, StoryObj } from "@storybook/react";
import type {
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { teamBridgeMessageSchema } from "../../../../shared/team-bridge-contract";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { participantLabel } from "./team-bridge-model";

/* All subjects and history are synthetic. These fixtures exercise the shipping
 * row, not transport, host capture, admission or a live account/session. Names
 * are deliberately different: owner, registered endpoint and actual session.
 * Use preview's theme/locale controls for dark/light and all shipped locales.
 * No animation is introduced; ReducedMotion also disables arrival motion. */
const owner: TeamBridgeDirectoryMember = {
	account_id: "acct_provenance_synthetic",
	display_label: "Ada Okafor",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	agent: {
		endpoint_id: "endpoint_provenance_synthetic",
		name: "Registered endpoint alias",
		state: "active",
	},
};
const copy = {
	named: (agent: string, person: string) => `${agent} (${person})`,
	unnamed: (person: string) => `${person}'s chief of staff`,
};
function row(leaf: unknown, seq = 1): TeamBridgeMessage {
	return teamBridgeMessageSchema.parse({
		id: `bcmsg_provenance_${seq}`,
		conversation_id: "bcv_provenance_synthetic",
		seq,
		sender: {
			account_id: owner.account_id,
			kind: "agent",
			display_label: "Registered endpoint alias",
			agent_session: leaf,
		},
		body: "The requested change is ready for review.",
		origin: "agent",
		created_at: `2026-11-22T10:0${seq}:00Z`,
	});
}
const actual = row({ display_label: "Release coordinator" });
function Frame({
	messages,
	width = 480,
}: { messages: TeamBridgeMessage[]; width?: number }) {
	return (
		<div style={{ width, maxWidth: "100%" }} className="bg-canvas text-ink">
			<TeamBridgeMessageList
				messages={messages}
				labelFor={(sender) => participantLabel(sender, [owner], copy)}
				profileFor={() => owner}
				tenantId="tnt_provenance_synthetic"
				arrivalsEnabled={false}
			/>
		</div>
	);
}
const meta = {
	title: "Team Bridge/Sender provenance",
	component: Frame,
	parameters: { layout: "centered" },
	args: { messages: [actual] },
} satisfies Meta<typeof Frame>;
export default meta;
type Story = StoryObj<typeof meta>;

/* Explicit reconstruction of the previous header, NOT a captured baseline.
 * It illustrates the old ambiguous endpoint attribution for comparison only. */
export const Before: Story = {
	render: () => (
		<div className="w-[480px] max-w-full bg-canvas px-5 py-3 text-ink">
			<div className="font-semibold text-[14px]">
				Registered endpoint alias (Ada Okafor)
			</div>
			<p className="text-[14px]">The requested change is ready for review.</p>
		</div>
	),
};
export const After: Story = {};
export const Populated: Story = {};
export const Legacy: Story = { args: { messages: [row(undefined)] } };
export const Unnamed: Story = {
	args: { messages: [row({ display_label: "   " })] },
};
export const Human: Story = {
	args: {
		messages: [
			{
				...actual,
				sender: { ...actual.sender, kind: "human" },
				origin: "human",
			},
		],
	},
};
export const Malformed: Story = {
	args: { messages: [row({ display_label: "Wrong shape", version: 2 })] },
};
export const LongHostile: Story = {
	args: {
		width: 280,
		messages: [
			row({
				display_label: '<img src=x onerror="alert(1)"> Release coordinator',
			}),
			row({ display_label: "a".repeat(64) }, 2),
			row({ display_label: "界".repeat(22) }, 3),
		],
	},
};
export const SameOwnerDifferentSession: Story = {
	args: {
		messages: [
			actual,
			row({ display_label: "QA coordinator" }, 2),
			row({ display_label: "QA coordinator" }, 3),
		],
	},
};
export const Narrow: Story = { args: { width: 280 } };
export const Wide: Story = { args: { width: 760 } };
export const ReducedMotion: Story = {
	args: { messages: [actual, row(undefined, 2)] },
};
