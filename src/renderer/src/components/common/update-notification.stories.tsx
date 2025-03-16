import { CssBaseline } from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { ThemeProvider as StyledThemeProvider } from "styled-components";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import theme from "../../theme";
import {
	UpdateNotification,
	CheckForUpdatesButton,
} from "./update-notification";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

// Initialize window.api if it doesn't exist
if (typeof window.api === "undefined") {
	// @ts-ignore - Ignore type errors for window.api assignment in storybook context
	window.api = {};
}

// Mock process.env for Storybook
if (typeof process === "undefined" || !process.env) {
	// @ts-ignore - Ignore process assignment for Storybook context
	window.process = { env: { npm_package_version: "1.0.0" } };
}

// Mock update info for stories
const mockUpdateInfo: UpdateInfo = {
	version: "2.0.0",
	releaseNotes: "Bug fixes and performance improvements",
	files: [],
	path: "",
	sha512: "",
	releaseDate: new Date().toISOString(),
};

// Create empty updater methods to prevent errors
const createEmptyUpdaterMethods = () => {
	const noop = () => () => {};

	if (!window.api.updater) {
		window.api.updater = {
			checkForUpdates: async () =>
				Promise.resolve({ updateInfo: mockUpdateInfo, cancellationToken: {} }),
			downloadUpdate: async () => Promise.resolve([]),
			quitAndInstall: () => {},
			onUpdateAvailable: noop,
			onUpdateNotAvailable: noop,
			onUpdateDownloaded: noop,
			onUpdateError: noop,
			onUpdateProgress: noop,
			onBeforeQuitForUpdate: noop,
		};
	}
};

// Initialize empty updater methods
createEmptyUpdaterMethods();

/**
 * Mock implementation of the window.api.updater methods
 */
const mockUpdaterApi = () => {
	// Store original updater API if it exists
	const originalApi = window.api.updater;

	// Mock API methods
	const updaterMethods = {
		checkForUpdates: async () =>
			Promise.resolve({
				updateInfo: mockUpdateInfo,
				cancellationToken: {},
			}),
		downloadUpdate: async () => Promise.resolve([]),
		quitAndInstall: () => {},
		onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateAvailable) {
				setTimeout(() => {
					callback(mockUpdateInfo);
				}, 500);
			}
			return () => {};
		},
		onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateNotAvailable) {
				setTimeout(() => {
					callback(mockUpdateInfo);
				}, 500);
			}
			return () => {};
		},
		onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateDownloaded) {
				setTimeout(() => {
					callback(mockUpdateInfo);
				}, 1500);
			}
			return () => {};
		},
		onUpdateError: (callback: (message: string) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateError) {
				setTimeout(() => {
					callback("Failed to check for updates: Network error");
				}, 500);
			}
			return () => {};
		},
		onUpdateProgress: (callback: (progressObj: ProgressInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateProgress) {
				let percent = 0;
				const interval = setInterval(() => {
					percent += 10;
					callback({
						percent,
						transferred: percent * 1024 * 10,
						total: 1024 * 1024,
						bytesPerSecond: 1024 * 50,
						delta: percent * 1024,
					});

					if (percent >= 100) {
						clearInterval(interval);
					}
				}, 500);
			}
			return () => {};
		},
		onBeforeQuitForUpdate: () => {
			return () => {};
		},
	};

	// Apply mock API
	window.api.updater = updaterMethods;

	// Return cleanup function
	return () => {
		// Restore original API
		window.api.updater = originalApi;
	};
};

// Add custom properties to window for story control
declare global {
	interface Window {
		triggerUpdateAvailable?: boolean;
		triggerUpdateNotAvailable?: boolean;
		triggerUpdateDownloaded?: boolean;
		triggerUpdateError?: boolean;
		triggerUpdateProgress?: boolean;
	}
}

/**
 * The UpdateNotification component displays notifications about available updates,
 * download progress, and installation options. It also provides a button to manually
 * check for updates.
 */
const meta = {
	title: "Common/UpdateNotification",
	component: UpdateNotification,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story, context) => {
			// Setup mock API
			useEffect(() => {
				const cleanup = mockUpdaterApi();
				return cleanup;
			}, []);

			// Set trigger flags based on story parameters
			useEffect(() => {
				window.triggerUpdateAvailable =
					context.parameters.triggerUpdateAvailable;
				window.triggerUpdateNotAvailable =
					context.parameters.triggerUpdateNotAvailable;
				window.triggerUpdateDownloaded =
					context.parameters.triggerUpdateDownloaded;
				window.triggerUpdateError = context.parameters.triggerUpdateError;
				window.triggerUpdateProgress = context.parameters.triggerUpdateProgress;
			}, [
				context.parameters.triggerUpdateAvailable,
				context.parameters.triggerUpdateNotAvailable,
				context.parameters.triggerUpdateDownloaded,
				context.parameters.triggerUpdateError,
				context.parameters.triggerUpdateProgress,
			]);

			return (
				<MuiThemeProvider theme={theme}>
					<StyledThemeProvider theme={theme}>
						<CssBaseline />
						<div style={{ width: "600px", padding: "20px" }}>
							<Story />
						</div>
					</StyledThemeProvider>
				</MuiThemeProvider>
			);
		},
	],
	tags: ["autodocs"],
} satisfies Meta<typeof UpdateNotification>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default state of the UpdateNotification component.
 * This story doesn't trigger any update events, so the component doesn't render anything.
 */
export const Default: Story = {
	args: {
		autoCheck: false,
	},
};

/**
 * Shows the notification when an update is available.
 */
export const UpdateAvailable: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		triggerUpdateAvailable: true,
	},
};

/**
 * Shows the notification when an update is being downloaded, with progress indication.
 */
export const Downloading: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		triggerUpdateAvailable: true,
		triggerUpdateProgress: true,
	},
};

/**
 * Shows the notification when an update has been downloaded and is ready to install.
 */
export const Downloaded: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		triggerUpdateDownloaded: true,
	},
};

/**
 * Shows the notification when there's an error checking for updates.
 */
export const ErrorState: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		triggerUpdateError: true,
	},
};

/**
 * Stories for the CheckForUpdatesButton component
 */
const buttonMeta = {
	title: "Common/CheckForUpdatesButton",
	component: CheckForUpdatesButton,
	parameters: {
		layout: "centered",
	},
	decorators: [
		(Story, context) => {
			// Setup mock API
			useEffect(() => {
				const cleanup = mockUpdaterApi();
				return cleanup;
			}, []);

			// Set trigger flags based on story parameters
			useEffect(() => {
				window.triggerUpdateNotAvailable =
					context.parameters.triggerUpdateNotAvailable;
				window.triggerUpdateError = context.parameters.triggerUpdateError;
			}, [
				context.parameters.triggerUpdateNotAvailable,
				context.parameters.triggerUpdateError,
			]);

			return (
				<MuiThemeProvider theme={theme}>
					<StyledThemeProvider theme={theme}>
						<CssBaseline />
						<div style={{ padding: "20px" }}>
							<Story />
						</div>
					</StyledThemeProvider>
				</MuiThemeProvider>
			);
		},
	],
	tags: ["autodocs"],
} satisfies Meta<typeof CheckForUpdatesButton>;

export const ButtonDefault: StoryObj<typeof buttonMeta> = {
	render: () => <CheckForUpdatesButton />,
};

/**
 * Shows the button state when no update is available.
 */
export const ButtonNoUpdateAvailable: StoryObj<typeof buttonMeta> = {
	render: () => <CheckForUpdatesButton />,
	parameters: {
		triggerUpdateNotAvailable: true,
	},
};

/**
 * Shows the button state when there's an error checking for updates.
 */
export const ButtonErrorState: StoryObj<typeof buttonMeta> = {
	render: () => <CheckForUpdatesButton />,
	parameters: {
		triggerUpdateError: true,
	},
};
