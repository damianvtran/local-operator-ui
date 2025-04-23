import React from "react";
import type { Preview } from "@storybook/react";
import { ThemeProvider } from "@mui/material/styles";
import { CssBaseline } from "@mui/material";
// @ts-ignore Path aliases don't work for Storybook root
import { getTheme, DEFAULT_THEME } from "@renderer/shared/themes";
// @ts-ignore Path aliases don't work for Storybook root
import { AuthProviders } from "@renderer/shared/providers/auth";
// @ts-ignore Path aliases don't work for Storybook root
import { FeatureFlagProvider } from "@renderer/shared/providers/feature-flags";
// @ts-ignore Path aliases don't work for Storybook root
import { config } from "@renderer/shared/config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { PostHogProvider } from "posthog-js/react";
// @ts-ignore Path aliases don't work for Storybook root
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";

// Mock the Electron preload API for Storybook
if (typeof window !== "undefined") {
	// Mock window.api for Storybook
	// biome-ignore lint/suspicious/noExplicitAny: Necessary for mocking the window object
	(window as any).api = {
		// Mock session storage methods with window variable
		session: {
			getSession: async () => {
				const session = window.sessionStorage.getItem("mock-radient-session");
				return session
					? JSON.parse(session)
					: { jwt: undefined, expiry: undefined };
			},
			storeSession: async (jwt: string, expiry: number) => {
				window.sessionStorage.setItem(
					"mock-radient-session",
					JSON.stringify({ jwt, expiry }),
				);
				return true;
			},
			clearSession: async () => {
				window.sessionStorage.removeItem("mock-radient-session");
				return true;
			},
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
		// Mock ipcRenderer methods
		ipcRenderer: {
			send: () => {}, // Mock send if needed
			on: () => () => {}, // Mock on and return a cleanup function
			// Mock the new provider auth check
			checkProviderAuthEnabled: async () => {
				console.log(
					"[Storybook Mock] checkProviderAuthEnabled called, returning true",
				);
				// Default to true for Storybook, can be overridden per story if needed
				return true;
			},
		},
		// Mock oauth methods (add if needed for stories using OAuth)
		oauth: {
			login: async (provider: string) => {
				console.log(`[Storybook Mock] oauth.login called for ${provider}`);
				return { success: true };
			},
			logout: async () => {
				console.log("[Storybook Mock] oauth.logout called");
				return { success: true };
			},
			getStatus: async () => {
				console.log("[Storybook Mock] oauth.getStatus called");
				// Simulate logged-out status by default
				return { success: true, status: { loggedIn: false, provider: null } };
			},
			onStatusUpdate: (
				_callback: (status: {
					loggedIn: boolean;
					provider: string | null;
				}) => void,
			) => {
				console.log("[Storybook Mock] oauth.onStatusUpdate listener added");
				// Return a no-op cleanup function
				return () => {
					console.log("[Storybook Mock] oauth.onStatusUpdate listener removed");
				};
			},
		},
	};
}

const defaultThemeOption = getTheme(DEFAULT_THEME);
const defaultMuiTheme = defaultThemeOption.theme;

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
					value: defaultMuiTheme.palette.background.default,
				},
			],
		},
	},
	decorators: [
		(Story) => {
			const queryClient = new QueryClient();

			return (
				<QueryClientProvider client={queryClient}>
					<MemoryRouter>
						<PostHogProvider
							apiKey={config.VITE_PUBLIC_POSTHOG_KEY}
							options={{
								api_host: config.VITE_PUBLIC_POSTHOG_HOST,
								autocapture: false,
								capture_pageview: false,
							}}
						>
							<FeatureFlagProvider>
								<AuthProviders
									googleClientId={config.VITE_GOOGLE_CLIENT_ID}
									microsoftClientId={config.VITE_MICROSOFT_CLIENT_ID}
									microsoftTenantId={config.VITE_MICROSOFT_TENANT_ID}
								>
									<ThemeProvider theme={defaultMuiTheme}>
										<CssBaseline />
										<Story />
										<ThemedToastContainer />
									</ThemeProvider>
								</AuthProviders>
							</FeatureFlagProvider>
						</PostHogProvider>
					</MemoryRouter>
				</QueryClientProvider>
			);
		},
	],
};

export default preview;
