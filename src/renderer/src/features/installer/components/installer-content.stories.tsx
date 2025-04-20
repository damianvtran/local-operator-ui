import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import theme from "../../../theme"; // TODO: This path should be updated
import type { Meta, StoryObj } from "@storybook/react";
import { InstallerContent } from "./installer-content";
import { AppContainer } from "./installer-styled";

/**
 * The InstallerContent component displays a modern, full-screen installation experience
 * with a feature carousel and progress UI. It's used during the one-time setup process.
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
			<ThemeProvider theme={theme}>
				<CssBaseline />
				<AppContainer>
					<Story />
				</AppContainer>
			</ThemeProvider>
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
