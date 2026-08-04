import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect } from "react";
import "../../../styles/index.css";
import { InstallerContent } from "./installer-content";

/**
 * The installer window: the product on the left, the install on the right.
 *
 * It renders inside its own html entry, so the story reproduces that entry's
 * wrapper rather than the app shell. The theme control is here because the
 * installer is the first Local Operator window a person ever sees and it
 * inherits whichever palette is stored — including the six light ones, where
 * the old white-only logo asset was invisible.
 */
const THEME_IDS = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"dune",
	"sage",
	"monokai",
	"tokyoNight",
	"iceberg",
	"radient",
	"neon",
	"obsidian",
	"synth",
] as const;

type StoryArgs = { theme: (typeof THEME_IDS)[number] };

const InstallerFrame = ({ theme }: StoryArgs) => {
	useLayoutEffect(() => {
		const previous = document.documentElement.dataset.theme;
		document.documentElement.dataset.theme = theme;
		return () => {
			if (previous === undefined) {
				document.documentElement.removeAttribute("data-theme");
			} else {
				document.documentElement.dataset.theme = previous;
			}
		};
	}, [theme]);

	return (
		<div
			data-theme={theme}
			className="flex h-screen w-screen overflow-hidden bg-canvas font-sans"
		>
			<InstallerContent />
		</div>
	);
};

const meta: Meta<StoryArgs> = {
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
	argTypes: { theme: { control: "select", options: THEME_IDS } },
	args: { theme: "localOperatorDark" },
	render: (args) => <InstallerFrame {...args} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** The installer as it appears while dependencies are being fetched. */
export const Default: Story = {};
