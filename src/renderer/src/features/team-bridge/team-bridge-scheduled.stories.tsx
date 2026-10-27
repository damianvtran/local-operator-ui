import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
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

/*
 * THE EDIT DIALOG'S STATES, driven through its REAL submit path: the story's
 * `onSchedule` does what the row's does - moves the "server" row (another
 * device's edit), hands the refreshed row down, then throws the hub's refusal -
 * and each `play` types and confirms like a user. So a frame shows the state
 * the code reaches, not one a prop forced (design review round 1, D8).
 */
const storyImage = (id: string) => ({
	id,
	mime: "image/png",
	size: 1024,
	width: 240,
	height: 150,
	state: "reserved",
});
const editRow: TeamBridgeScheduledMessage = {
	...row,
	body: "Release notes are ready for review.",
	attachments: [storyImage("batt_story_a")],
	version: 3,
};
const concurrentEdit = () =>
	new DesktopControlError(
		409,
		"This change is not allowed for this message.",
		undefined,
		"invalid_transition",
		undefined,
		{ code: "invalid_transition", details: { rule: "concurrent_edit" } },
	);
function EditFlow({
	elsewhere,
	refusal,
	unavailable,
}: {
	/* What another device committed while the dialog was open. */
	elsewhere?: (row: TeamBridgeScheduledMessage) => TeamBridgeScheduledMessage;
	refusal?: () => Error;
	unavailable?: boolean;
}) {
	const [open, setOpen] = useState(true);
	const [server, setServer] = useState(editRow);
	return (
		<TeamBridgeScheduleDialog
			open={open}
			onOpenChange={setOpen}
			busy={false}
			unavailable={unavailable}
			initialBody={server.body}
			initialSendAt={server.send_at}
			initialAttachments={server.attachments}
			initialVersion={server.version}
			onSchedule={async () => {
				if (elsewhere) setServer(elsewhere);
				// Let the refreshed row land before the refusal, as the row's
				// own `onSchedule` refreshes before it rethrows.
				await new Promise((resolve) => setTimeout(resolve, 0));
				if (refusal) throw refusal();
			}}
		/>
	);
}
const confirm = async () => {
	await userEvent.click(
		await screen.findByRole("button", { name: "Review schedule" }),
	);
	await userEvent.click(
		await screen.findByRole("button", { name: "Confirm schedule" }),
	);
	await screen.findByRole("alert");
};
const typeBody = async (text: string) => {
	const field = await screen.findByRole("textbox", { name: "Message" });
	await userEvent.clear(field);
	await userEvent.type(field, text);
};

/* The Reschedule dialog as it opens: text, a reserved image, the time. */
export const Reschedule: Story = { render: () => <EditFlow /> };

/* A refusal that is not a conflict: the edit stays, the user retries. */
export const EditFailed: Story = {
	render: () => <EditFlow refusal={() => new Error("unavailable")} />,
	play: async () => {
		await typeBody("Release notes and the rollout checklist are ready.");
		await confirm();
	},
};

/*
 * CONFLICT, WITH A DELTA LEFT: this user removed the image while another
 * device rewrote the text. The removal survives, the new text is shown and
 * named, and Review stays live.
 */
export const EditConflictWithDeltas: Story = {
	render: () => (
		<EditFlow
			elsewhere={(current) => ({
				...current,
				body: "Release notes and screenshots are ready for review.",
				version: 4,
			})}
			refusal={concurrentEdit}
		/>
	),
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Remove images" }),
		);
		await confirm();
	},
};

/*
 * CONFLICT, NOTHING LEFT: this user's text lost to the other device's. The
 * notice says so, offers the text back, and the action is Close - never a
 * disabled Review beside "try again" (D1, D2).
 */
export const EditConflictTextReplaced: Story = {
	render: () => (
		<EditFlow
			elsewhere={(current) => ({
				...current,
				body: "Release notes are ready. Screenshots follow tomorrow.",
				version: 4,
			})}
			refusal={concurrentEdit}
		/>
	),
	play: async () => {
		await typeBody("Release notes and the rollout checklist are ready.");
		await confirm();
	},
};

/* CONFLICT, ADDED ELSEWHERE: an image appeared; the notice names it (D2). */
export const EditConflict: Story = {
	render: () => (
		<EditFlow
			elsewhere={(current) => ({
				...current,
				attachments: [storyImage("batt_story_a"), storyImage("batt_story_b")],
				version: 4,
			})}
			refusal={concurrentEdit}
		/>
	),
	play: async () => {
		await typeBody("Release notes and screenshots are ready.");
		await confirm();
	},
};

/* The schedule was cancelled or sent elsewhere: final, Close only (D3, D6). */
export const EditGone: Story = { render: () => <EditFlow unavailable /> };
