import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { TeamBridgeScheduledMessage } from "../../../../shared/team-bridge-contract";
import {
	TeamBridgeScheduleDialog,
	TeamBridgeScheduledListView,
} from "./team-bridge-scheduled";

const row: TeamBridgeScheduledMessage = {
	id: "bsch_story",
	tenant_id: "tnt_story",
	conversation_id: "bcv_story",
	body: "The **handoff** is ready.\n\n- Reviewed the change\n- Recorded the next steps",
	send_at: "2030-04-05T12:30:00Z",
	created_at: "2030-04-05T10:00:00Z",
	status: "scheduled",
};
const meta = {
	title: "Team Bridge/Scheduled",
	component: TeamBridgeScheduledListView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="flex h-[640px] bg-canvas text-ink">
				<Story />
			</div>
		),
	],
	args: { state: "ready", messages: [], refresh: async () => {} },
} satisfies Meta<typeof TeamBridgeScheduledListView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = {};
export const LoadError: Story = { args: { state: "error" } };
export const Populated: Story = { args: { messages: [row] } };
export const Sending: Story = {
	args: { messages: [{ ...row, status: "sending" }] },
};
export const ReadOnly: Story = { args: { messages: [row], readOnly: true } };
function ConfirmationStory() {
	const [open, setOpen] = useState(true);
	return (
		<TeamBridgeScheduleDialog
			open={open}
			onOpenChange={setOpen}
			busy={false}
			onSchedule={async () => {}}
		/>
	);
}
export const Confirmation: Story = { render: () => <ConfirmationStory /> };
