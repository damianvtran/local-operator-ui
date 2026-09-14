/*
 * The app's real faces. Both renderer entries import this, and until Storybook
 * did too every captured frame rendered `font-mono` as the platform fallback
 * rather than Geist Mono - so the evidence set could not show a typography
 * change, and reviewing type from a screenshot was measuring the reviewer's OS.
 * A verification surface that differs from the product will certify a defect
 * eventually; this is the second time that has bitten this repo, after the
 * <CssBaseline/> focus-ring split.
 */
// @ts-ignore Path aliases don't work for Storybook root
import "@renderer/assets/fonts/fonts.css";
import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
// @ts-ignore Path aliases don't work for Storybook root
import { config } from "@renderer/shared/config";
// @ts-ignore Path aliases don't work for Storybook root
import { AuthProviders } from "@renderer/shared/providers/auth";
// @ts-ignore Path aliases don't work for Storybook root
import { FeatureFlagProvider } from "@renderer/shared/providers/feature-flags";
// @ts-ignore Path aliases don't work for Storybook root
import { useUiPreferencesStore } from "@renderer/shared/store/ui-preferences-store";
// @ts-ignore Path aliases don't work for Storybook root
import "@renderer/styles/index.css";
import {
	DEFAULT_THEME,
	applyThemeToDocument,
	getTheme,
	themes,
	// @ts-ignore Path aliases don't work for Storybook root
} from "@renderer/shared/themes";
// @ts-ignore Path aliases don't work for Storybook root
import type { ThemeName } from "@renderer/shared/themes";
// @ts-ignore Path aliases don't work for Storybook root
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";
import type { Preview } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PostHogProvider } from "posthog-js/react";
import React, { type ReactNode, useLayoutEffect } from "react";
import { MemoryRouter } from "react-router-dom";

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

/**
 * Every theme the app ships, in registry order.
 *
 * Read off the registry rather than written out, because a hand-kept list here
 * is a list that goes stale the day a thirteenth palette lands and then quietly
 * makes that palette unreviewable.
 */
const THEME_IDS = Object.keys(themes) as ThemeName[];

/**
 * The theme frame, applied to every story.
 *
 * This lives here rather than in each story file because the failure mode of
 * the per-story version was silent: a story without a copy rendered the default
 * palette whatever theme was asked for, and `scripts/capture-evidence.mjs`
 * would still write twelve files named for twelve themes with identical pixels
 * in them. Evidence that asserts something false is worse than no evidence, and
 * the only way to make it impossible is to leave the story no way to opt out.
 *
 * All three halves of the bridge move together, from the one `theme` arg:
 *
 *  - MUI bakes palette values into Emotion classes as literal hexes when
 *    `createBaseTheme` runs, so it needs the theme OBJECT through context;
 *  - Tailwind role utilities resolve `--lo-*` live off `data-theme`, so the
 *    document element needs the attribute and the matching `dark` class;
 *  - components that read the palette from the preferences store rather than
 *    from context (the shell, the theme selector) need the store set.
 *
 * Moving only one of the three is what produced dark ink on light paper in
 * earlier evidence runs and read as a contrast defect in the product.
 */
const ThemeFrame = ({
	theme,
	children,
}: {
	theme: ThemeName;
	children: ReactNode;
}) => {
	/*
	 * `useLayoutEffect` so the attribute lands in the same commit as the MUI
	 * theme below; a `useEffect` shows one painted frame of the previous
	 * palette's variables under the new MUI theme on every switch, which a
	 * screenshot run is fast enough to catch.
	 */
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({ themeName: theme });
		applyThemeToDocument(theme);
	}, [theme]);

	/* No teardown restoring the previous theme: every story mounts through this
	   frame and sets its own, so a restore would only ever paint a palette
	   nothing asked for between two stories. */
	return (
		<div className="min-h-screen bg-canvas font-sans text-body text-ink">
			{children}
		</div>
	);
};

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		/* The backgrounds addon paints one fixed colour behind the story, which
		   under a light theme is a dark slab the product never shows. The frame
		   below paints `bg-canvas` instead, so the ground follows the theme. */
		backgrounds: { disable: true },
	},
	/* Declared at preview level so EVERY story has the arg, which is both what
	   puts the control in the panel and what lets the capture script drive a
	   theme through `?args=theme:<id>`. Storybook drops a URL arg a story has
	   not declared, which is how six story files came to ignore it. */
	argTypes: {
		theme: { control: { type: "select" }, options: THEME_IDS },
	},
	args: { theme: DEFAULT_THEME },
	decorators: [
		(Story, context) => {
			const queryClient = new QueryClient();
			const theme = (context.args.theme as ThemeName) ?? DEFAULT_THEME;
			const muiTheme = getTheme(theme).theme;

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
									<MuiThemeProvider theme={muiTheme}>
										<CssBaseline />
										<ThemeFrame theme={theme}>
											<Story />
										</ThemeFrame>
										<ThemedToastContainer />
									</MuiThemeProvider>
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
