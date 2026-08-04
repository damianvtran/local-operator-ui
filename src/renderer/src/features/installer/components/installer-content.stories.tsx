import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { InstallerContent } from "./installer-content";

/**
 * The InstallerContent component is the whole of the installer window: the
 * product on the left, the install on the right. It renders inside its own html
 * entry, so the story reproduces that entry's wrapper rather than the app shell.
 */
const meta = {
	title: "Installer/InstallerContent",
	component: InstallerContent,
	parameters: {
		layout: "fullscreen",
		viewport: {
			defaultViewport: "custom",
			viewports: {
				custom: {
					name: "Installer Window",
					styles: {
						width: "1380px",
						height: "800px",
					},
				},
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="flex h-screen w-screen overflow-hidden bg-canvas">
				<Story />
			</div>
		),
	],
	tags: ["autodocs"],
} satisfies Meta<typeof InstallerContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state of the installer content showing the feature carousel and progress UI
 */
export const Default: Story = {};
