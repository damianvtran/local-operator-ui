import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { InstallerContent } from "./installer-content";

/**
 * The installer window: the product on the left, the install on the right.
 *
 * It renders inside its own html entry, so the story reproduces that entry's
 * wrapper rather than the app shell.
 *
 * The window itself only ever renders one palette: `installer.tsx` calls
 * `applyThemeToDocument(DEFAULT_THEME)` and nothing there reads a stored
 * preference, so eleven of the twelve frames below show a theme this window
 * cannot produce. They are kept because the panel's own contrast should hold
 * on any ground it is ever pointed at, but the one that matches the product
 * is `localOperatorDark` - which is also why the main process paints
 * `#16130e` behind it.
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
