import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
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

/*
 * THE CONFLICT STATE (agent-server #223 QA r2, Q2): another device added an
 * image while this dialog was open. The refreshed row reaches the open dialog,
 * which rebases onto it - the other device's image is now shown, so a retry
 * cannot erase it - and says the message changed elsewhere. Driven by a prop change
 * after mount, exactly as a refresh delivers it, so no transport is faked.
 */
const conflictImage = (id: string) => ({
	id,
	mime: "image/png",
	size: 1024,
	width: 240,
	height: 150,
	state: "reserved",
});
function ConflictStory() {
	const [open, setOpen] = useState(true);
	const [server, setServer] = useState({
		...row,
		attachments: [conflictImage("batt_story_a")],
	});
	useEffect(() => {
		setServer((current) => ({
			...current,
			attachments: [
				conflictImage("batt_story_a"),
				conflictImage("batt_story_b"),
			],
		}));
	}, []);
	return (
		<TeamBridgeScheduleDialog
			open={open}
			onOpenChange={setOpen}
			busy={false}
			initialBody={server.body}
			initialSendAt={server.send_at}
			initialAttachments={server.attachments}
			onSchedule={async () => {}}
		/>
	);
}
export const EditConflict: Story = { render: () => <ConflictStory /> };
/* The schedule was cancelled or sent on another device: Close, never retry. */
function GoneStory() {
	const [open, setOpen] = useState(true);
	return (
		<TeamBridgeScheduleDialog
			open={open}
			onOpenChange={setOpen}
			busy={false}
			unavailable
			initialBody={row.body}
			initialSendAt={row.send_at}
			onSchedule={async () => {}}
		/>
	);
}
export const EditGone: Story = { render: () => <GoneStory /> };
