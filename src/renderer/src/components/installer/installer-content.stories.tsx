// This import is only for TypeScript and will be removed at runtime
import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { InstallerContent } from "./installer-content";
import { AppContainer } from "./installer-styled";

/**
 * The InstallerContent component displays the installation progress UI with a spinner,
 * progress bar, and cancel button. It's used during the one-time setup process.
 */
const meta = {
	title: "Installer/InstallerContent",
	component: InstallerContent,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story) => (
			<AppContainer style={{ height: "100vh", width: "100vw" }}>
				<Story />
			</AppContainer>
		),
	],
	tags: ["autodocs"],
} satisfies Meta<typeof InstallerContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state of the installer content showing the progress UI
 */
export const Default: Story = {};
