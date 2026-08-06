/**
 * The dialog that stands between a user and a destructive action.
 *
 * Six callers use it and every one of them is destructive: deleting an agent,
 * clearing a conversation in two places, deleting a variable, and overwriting
 * a file. It had no story and therefore no frame, which is how it kept a
 * document-level Enter handler that ran `onConfirm` while the focus ring sat
 * on "Cancel" — and ran it BEFORE the button's own click, because keydown
 * reaches `document` first. The dangerous state of a dangerous dialog is worth
 * a picture.
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { ConfirmationModal } from "./confirmation-modal";

const meta: Meta<typeof ConfirmationModal> = {
	title: "Common/ConfirmationModal",
	component: ConfirmationModal,
	parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof ConfirmationModal>;

const noop = () => {};

/**
 * The destructive case, which is every case in the product today.
 *
 * Cancel is the focused control, and that is the point: Radix focuses the
 * first tabbable and the footer puts Cancel first, so the keystroke a user
 * reaches for by reflex is the safe one.
 */
export const Dangerous: Story = {
	render: () => (
		<ConfirmationModal
			open
			title="Delete agent"
			message="This removes the agent, its conversation history and its schedules. It cannot be undone."
			confirmText="Delete agent"
			cancelText="Cancel"
			isDangerous
			onConfirm={noop}
			onCancel={noop}
		/>
	),
};

/** The same dialog without the danger treatment, for the accent comparison. */
export const Ordinary: Story = {
	render: () => (
		<ConfirmationModal
			open
			title="Apply these changes?"
			message="The file on disk will be replaced with the version shown in the diff."
			confirmText="Apply changes"
			cancelText="Cancel"
			onConfirm={noop}
			onCancel={noop}
		/>
	),
};
