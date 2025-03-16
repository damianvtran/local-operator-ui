import {
	CssBaseline,
	Typography,
	LinearProgress,
	Button,
	Alert,
	Snackbar,
} from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { ThemeProvider as StyledThemeProvider } from "styled-components";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { styled } from "styled-components";
import theme from "../../theme";
import {
	UpdateNotification,
	CheckForUpdatesButton,
} from "./update-notification";
import type { ProgressInfo, UpdateInfo } from "electron-updater";

// Copy the styled components from the actual component for direct rendering in stories
const UpdateContainer = styled.div`
  padding: 16px;
  border-radius: 8px;
  background-color: ${(props) => props.theme.palette.background.paper};
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  margin-bottom: 16px;
`;

const UpdateActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
`;

const ProgressContainer = styled.div`
  margin-top: 16px;
  margin-bottom: 8px;
`;

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
				// Immediately trigger the callback instead of using setTimeout
				callback(mockUpdateInfo);
			}
			// Return a no-op cleanup function that won't reset the state
			return () => {};
		},
		onUpdateNotAvailable: (callback: (info: UpdateInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateNotAvailable) {
				// Immediately trigger the callback
				callback(mockUpdateInfo);
			}
			return () => {};
		},
		onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateDownloaded) {
				// Immediately trigger the callback
				callback(mockUpdateInfo);
			}
			return () => {};
		},
		onUpdateError: (callback: (message: string) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateError) {
				// Immediately trigger the callback
				callback("Failed to check for updates: Network error");
			}
			return () => {};
		},
		onUpdateProgress: (callback: (progressObj: ProgressInfo) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateProgress) {
				// Immediately send initial progress
				callback({
					percent: 50,
					transferred: 50 * 1024 * 10,
					total: 1024 * 1024,
					bytesPerSecond: 1024 * 50,
					delta: 50 * 1024,
				});

				// No need for interval that might get cleared too soon
			}
			return () => {};
		},
		onBeforeQuitForUpdate: () => {
			return () => {};
		},
	};

	// Apply mock API
	window.api.updater = updaterMethods;

	// Return cleanup function that does nothing to prevent state reset
	return () => {
		// No cleanup needed - we want to maintain the state for stories
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
 * This story doesn't trigger any update events, so we need to force a render.
 */
export const Default: Story = {
	args: {
		autoCheck: false,
	},
	render: () => {
		// Create a component that forces a render even in default state
		const DefaultComponent = () => {
			// Override the component to show something in default state
			return (
				<div
					style={{
						border: "1px dashed #ccc",
						padding: "16px",
						borderRadius: "8px",
					}}
				>
					<Typography variant="h6">Default State</Typography>
					<Typography variant="body1">
						This is the default state of the UpdateNotification component.
						Normally it doesn't render anything when no updates are available.
					</Typography>
				</div>
			);
		};

		return <DefaultComponent />;
	},
};

/**
 * Shows the component when it's checking for updates.
 */
export const Checking: Story = {
	args: {
		autoCheck: false,
	},
	parameters: {
		checking: true,
	},
	render: () => {
		// Create a component that forces the checking state to be true
		const CheckingComponent = () => {
			// Use useState to directly control the checking state
			const [isChecking, setIsChecking] = useState(true);

			// Override the checkForUpdates function to never resolve
			useEffect(() => {
				// Replace with a function that never resolves
				window.api.updater.checkForUpdates = async () => {
					// Set checking state directly
					setIsChecking(true);
					// Return a promise that never resolves to keep checking state true
					return new Promise(() => {});
				};

				// Call checkForUpdates immediately
				window.api.updater.checkForUpdates();

				// Cleanup function that doesn't actually clean up
				// to maintain the state for the story
				return () => {
					// No cleanup needed - we want to maintain the state for stories
				};
			}, []);

			// If checking, render the checking UI directly
			if (isChecking) {
				return (
					<UpdateContainer>
						<Typography variant="h6">Checking for Updates</Typography>
						<Typography variant="body1">
							Please wait while we check for available updates...
						</Typography>
						<ProgressContainer>
							<LinearProgress />
						</ProgressContainer>
					</UpdateContainer>
				);
			}

			// Fallback, should never reach here
			return <UpdateNotification autoCheck={true} />;
		};

		return <CheckingComponent />;
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
	render: () => {
		// Create a component that directly renders the update available state
		const UpdateAvailableComponent = () => {
			// Use state to force the component to render with update available
			const [available, setAvailable] = useState(true);
			const [info, setInfo] = useState(mockUpdateInfo);

			useEffect(() => {
				// Set the state immediately
				setAvailable(true);
				setInfo(mockUpdateInfo);

				// Set the trigger flag
				window.triggerUpdateAvailable = true;
			}, []);

			// If update is available, render the UI directly
			if (available && info) {
				return (
					<UpdateContainer>
						<Typography variant="h6">Update Available</Typography>
						<Typography variant="body1">
							Version {info.version} is available. You are currently using
							version {process.env.npm_package_version || "1.0.0"}.
						</Typography>
						{info.releaseNotes && (
							<Typography variant="body2" sx={{ mt: 1 }}>
								Release Notes:{" "}
								{typeof info.releaseNotes === "string"
									? info.releaseNotes
									: "See release notes on GitHub"}
							</Typography>
						)}
						<UpdateActions>
							<Button
								variant="contained"
								color="primary"
								onClick={() => {}}
								disabled={false}
							>
								Download Update
							</Button>
						</UpdateActions>
					</UpdateContainer>
				);
			}

			// Fallback to the actual component
			return <UpdateNotification autoCheck={false} />;
		};

		return <UpdateAvailableComponent />;
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
	render: () => {
		// Create a component that directly renders the downloading state
		const DownloadingComponent = () => {
			// Use state to force the component to render with downloading state
			const [available, setAvailable] = useState(true);
			const [downloading, setDownloading] = useState(true);
			const [info, setInfo] = useState(mockUpdateInfo);
			const [progress] = useState<ProgressInfo>({
				percent: 45,
				transferred: 45 * 1024 * 10,
				total: 1024 * 1024,
				bytesPerSecond: 1024 * 50,
				delta: 45 * 1024,
			});

			useEffect(() => {
				// Set the state immediately
				setAvailable(true);
				setDownloading(true);
				setInfo(mockUpdateInfo);

				// Set the trigger flags
				window.triggerUpdateAvailable = true;
				window.triggerUpdateProgress = true;
			}, []);

			// If update is available and downloading, render the UI directly
			if (available && downloading && info) {
				return (
					<UpdateContainer>
						<Typography variant="h6">Update Available</Typography>
						<Typography variant="body1">
							Version {info.version} is available. You are currently using
							version {process.env.npm_package_version || "1.0.0"}.
						</Typography>
						{info.releaseNotes && (
							<Typography variant="body2" sx={{ mt: 1 }}>
								Release Notes:{" "}
								{typeof info.releaseNotes === "string"
									? info.releaseNotes
									: "See release notes on GitHub"}
							</Typography>
						)}

						<ProgressContainer>
							<Typography variant="body2">
								Downloading: {Math.round(progress.percent)}%
							</Typography>
							<LinearProgress
								variant="determinate"
								value={progress.percent}
								sx={{ mt: 1 }}
							/>
							<Typography variant="caption" sx={{ mt: 0.5, display: "block" }}>
								{Math.round(progress.transferred / 1024)} KB of{" "}
								{Math.round(progress.total / 1024)} KB
							</Typography>
						</ProgressContainer>
					</UpdateContainer>
				);
			}

			// Fallback to the actual component
			return <UpdateNotification autoCheck={false} />;
		};

		return <DownloadingComponent />;
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
	render: () => {
		// Create a component that directly renders the downloaded state
		const DownloadedComponent = () => {
			// Use state to force the component to render with downloaded state
			const [downloaded, setDownloaded] = useState(true);
			const [info, setInfo] = useState(mockUpdateInfo);

			useEffect(() => {
				// Set the state immediately
				setDownloaded(true);
				setInfo(mockUpdateInfo);

				// Set the trigger flag
				window.triggerUpdateDownloaded = true;
			}, []);

			// If update is downloaded, render the UI directly
			if (downloaded && info) {
				return (
					<UpdateContainer>
						<Typography variant="h6">Update Ready to Install</Typography>
						<Typography variant="body1">
							Version {info.version} has been downloaded and is ready to
							install.
						</Typography>
						<Typography variant="body2" sx={{ mt: 1 }}>
							The application will restart to apply the update.
						</Typography>

						<UpdateActions>
							<Button variant="contained" color="primary" onClick={() => {}}>
								Install Now
							</Button>
							<Button variant="outlined" onClick={() => {}}>
								Install Later
							</Button>
						</UpdateActions>
					</UpdateContainer>
				);
			}

			// Fallback to the actual component
			return <UpdateNotification autoCheck={false} />;
		};

		return <DownloadedComponent />;
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
	render: () => {
		// Create a component that directly renders the error state
		const ErrorComponent = () => {
			// Use state to force the component to render with error state
			const [error, setError] = useState(
				"Failed to check for updates: Network error",
			);
			const [open, setOpen] = useState(true);

			useEffect(() => {
				// Set the state immediately
				setError("Failed to check for updates: Network error");
				setOpen(true);

				// Set the trigger flag
				window.triggerUpdateError = true;
			}, []);

			// If there's an error, render the UI directly
			if (error) {
				return (
					<Snackbar
						open={open}
						autoHideDuration={6000}
						onClose={() => setOpen(false)}
						anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
					>
						<Alert onClose={() => setOpen(false)} severity="error">
							{error}
						</Alert>
					</Snackbar>
				);
			}

			// Fallback to the actual component
			return <UpdateNotification autoCheck={false} />;
		};

		return <ErrorComponent />;
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
