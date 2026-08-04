import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { InstallerContent } from "./installer-content";

/**
 * The installer window: the product on the left, the install on the right.
 *
 * It renders inside its own html entry, so the story reproduces that entry's
 * wrapper rather than the app shell. The theme control matters more here than
 * anywhere else: the installer is the first Local Operator window a person
 * ever sees and it inherits whichever palette is stored — including the light
 * ones, where the old white-only logo asset was invisible.
 */
const meta: Meta = {
	title: "Installer/InstallerContent",
	parameters: {
		layout: "fullscreen",
		viewport: {
			defaultViewport: "custom",
			viewports: {
				custom: {
					name: "Installer Window",
					styles: { width: "1380px", height: "800px" },
				},
			},
		},
	},
	/* The installer entry is its own window, so the story reproduces the
	   full-bleed row that entry renders rather than sitting in page flow. */
	render: () => (
		<div className="flex h-screen w-screen overflow-hidden font-sans">
			<InstallerContent />
		</div>
	),
};

export default meta;
type Story = StoryObj;

/** The installer as it appears while dependencies are being fetched. */
export const Default: Story = {};
