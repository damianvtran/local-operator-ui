// This import is only for TypeScript and will be removed at runtime
import React from "react";
import type { Preview } from "@storybook/react";
import { ThemeProvider } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";
import theme from "../src/renderer/src/theme";
import { AuthProviders } from "../src/renderer/src/providers/auth";

// Mock the Electron preload API for Storybook
if (typeof window !== "undefined") {
	// Mock window.api for Storybook
	// biome-ignore lint/suspicious/noExplicitAny: Necessary for mocking the window object
	(window as any).api = {
		// Mock session storage methods
		session: {
			getSession: async () => ({
				jwt: "mock-jwt",
				expiry: Date.now() + 86400000,
			}),
			storeSession: async () => true,
			clearSession: async () => true,
		},
		// Mock other API methods as needed
		openFile: async () => {},
		openExternal: async () => {},
		systemInfo: {
			getAppVersion: async () => "1.0.0",
			getPlatformInfo: async () => ({
				platform: "darwin",
				arch: "x64",
				nodeVersion: "16.0.0",
				electronVersion: "25.0.0",
				chromeVersion: "114.0.0",
			}),
		},
	};
}

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
			<AuthProviders
				googleClientId="mock-client-id-for-storybook"
				microsoftClientId="mock-client-id-for-storybook"
				microsoftTenantId="mock-tenant-id-for-storybook"
			>
				<ThemeProvider theme={theme}>
					<CssBaseline />
					<Story />
				</ThemeProvider>
			</AuthProviders>
		),
	],
};

export default preview;
