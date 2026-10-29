import type { Meta, StoryObj } from "@storybook/react";
import fixture from "../../../../../scripts/fixtures/agent-messages-status.json";
import { AgentMessagesDialog } from "./agent-messages-dialog";

/** Presentation fixtures only; the consent flow's readiness needs the real
 * app + isolated harness, not Storybook's props or jsdom's missing geometry. */
const meta: Meta<typeof AgentMessagesDialog> = {
	title: "Agent messages/Onboarding",
	component: AgentMessagesDialog,
	parameters: {
		layout: "fullscreen",
		viewport: {
			defaultViewport: "bridgeFit",
			viewports: {
				bridgeFit: {
					name: "Consent fit 1024 × 673",
					styles: { width: "1024px", height: "673px" },
				},
				bridgeTall: {
					name: "Graphic 1280 × 900",
					styles: { width: "1280px", height: "900px" },
				},
			},
		},
	},
	args: {
		consent: fixture.consent,
		accountGuard: true,
		canEnable: true,
		pending: false,
		confirmed: false,
		refusal: null,
		onDismiss: () => {},
		onEnable: () => {},
	},
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Eligible: Story = {};
export const Graphic: Story = {
	parameters: { viewport: { defaultViewport: "bridgeTall" } },
};
export const Pending: Story = { args: { pending: true, canEnable: false } };
export const ConsentUnavailable: Story = {
	args: { consent: null, canEnable: false },
};
export const GuardUnavailable: Story = {
	args: { accountGuard: false, canEnable: false },
};
export const Refused: Story = {
	args: {
		canEnable: true,
		refusal: {
			code: "messaging_unavailable",
			message: "Agent messages are unavailable. Try again later.",
		},
	},
};
export const LocalFailure: Story = {
	args: {
		canEnable: false,
		confirmed: true,
		refusal: {
			code: "local_setup_failed",
			message: "Setup on this machine did not finish.",
		},
	},
};
// Eligibility loading and ineligible states intentionally have no dialog at all.
export const CheckingAbsent: Story = { render: () => <></> };
export const IneligibleAbsent: Story = { render: () => <></> };
