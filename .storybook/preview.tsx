// This import is only for TypeScript and will be removed at runtime
import React from "react";
import type { Preview } from "@storybook/react";
import { ThemeProvider } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";
import theme from "../src/renderer/src/theme";

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		backgrounds: {
			default: "dark",
			values: [
				{
					name: "dark",
					value: theme.palette.background.default,
				},
			],
		},
	},
	decorators: [
		(Story) => (
			<ThemeProvider theme={theme}>
				<CssBaseline />
				<Story />
			</ThemeProvider>
		),
	],
};

export default preview;
