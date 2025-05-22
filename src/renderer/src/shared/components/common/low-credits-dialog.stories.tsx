import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { LowCreditsDialog } from "./low-credits-dialog";
import { useLowCreditsStore } from "@shared/store/low-credits-store";
import { Box } from "@mui/material";

/**
 * Storybook stories for the LowCreditsDialog component.
 *
 * This showcases the dialog in an always-open state for UI testing and development.
 */
const meta: Meta<typeof LowCreditsDialog> = {
	title: "Common/LowCreditsDialog",
	component: LowCreditsDialog,
	parameters: {
		layout: "centered", // Center the dialog in the Storybook canvas
	},
	decorators: [
		(Story) => {
			// Reset the store state for consistent story rendering
			const lowCreditsStore = useLowCreditsStore.getState();
			lowCreditsStore.setHasBeenNotified(false);

			// Mock Radient Auth and Config for the hook if needed,
			// but for just showing the dialog, direct props are enough.
			// The hook logic itself won't run in this isolated story context
			// unless we specifically mock its dependencies here.

			// Mock window.api.openExternal for storybook environment
			if (typeof window !== "undefined") {
				// biome-ignore lint/suspicious/noExplicitAny: Mocking window API
				(window as any).api = {
          // biome-ignore lint/suspicious/noExplicitAny: Mocking window API
					...(window as any).api, // Preserve other mocks from preview.tsx
					openExternal: async (url: string) => {
						console.log(`[Storybook Mock] openExternal called with URL: ${url}`);
					},
				};
			}

			return (
				<Box sx={{ p: 3, display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
					<Story />
				</Box>
			);
		},
	],
	tags: ["autodocs"],
	argTypes: {
		open: { control: "boolean" },
		onClose: { action: "closed" },
		onGoToConsole: { action: "goToConsole" },
	},
};

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Default story: Dialog is open.
 * The `useLowCreditsDialog` hook's logic for showing/hiding the dialog
 * is bypassed here by directly setting the `open` prop to true.
 * The internal state of the dialog (like calling `setHasBeenNotified` on close)
 * will still work as expected.
 */
export const Default: Story = {
	args: {
		open: true,
		// onClose and onGoToConsole will be automatically mocked by Storybook
		// if argTypes are configured with `action`.
		// Or, provide simple console logs:
		onClose: () => console.log("Dialog closed (Maybe Later)"),
		onGoToConsole: () => console.log("Go To Console clicked"),
	},
};

/**
 * Story to demonstrate the dialog when the user has already been notified.
 * In a real app, the `useLowCreditsDialog` hook would prevent this from opening.
 * Here, we manually set the store and still force `open` to true to see the dialog.
 * This is more for testing the dialog's appearance than its conditional logic.
 */
export const AlreadyNotified: Story = {
	args: {
		open: true,
		onClose: () => console.log("Dialog closed (Maybe Later) - Already Notified"),
		onGoToConsole: () => console.log("Go To Console clicked - Already Notified"),
	},
	decorators: [
		(Story) => {
			const lowCreditsStore = useLowCreditsStore.getState();
			lowCreditsStore.setHasBeenNotified(true); // Set as notified
			return <Story />;
		},
	],
};
