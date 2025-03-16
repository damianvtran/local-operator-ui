import {
	CssBaseline,
	Typography,
	LinearProgress,
	Button,
	Alert,
	Snackbar,
	Box,
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

// Type definition for our mock callbacks
type UpdaterCallbacks = {
	updateAvailable?: ((info: UpdateInfo) => void)[];
	updateNotAvailable?: ((info: UpdateInfo) => void)[];
	updateDownloaded?: ((info: UpdateInfo) => void)[];
	updateError?: ((message: string) => void)[];
	updateProgress?: ((progressObj: ProgressInfo) => void)[];
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
			onUpdateDevMode: () => () => {},
			onUpdateNpxAvailable: () => () => {},
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
		onUpdateDevMode: (callback: (message: string) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateDevMode) {
				// Immediately trigger the callback
				callback("Dev mode is active");
			}
			return () => {};
		},
		onUpdateNpxAvailable: (
			callback: (info: {
				currentVersion: string;
				latestVersion: string;
				updateCommand: string;
			}) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerUpdateNpxAvailable) {
				// Immediately trigger the callback
				callback({
					currentVersion: "1.0.0",
					latestVersion: "2.0.0",
					updateCommand: "npx local-operator-ui@latest",
				});
			}
			return () => {};
		},
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
		triggerUpdateDevMode?: boolean;
		triggerUpdateNpxAvailable?: boolean;
		triggerNpxUpdate?: boolean;
		triggerDevMode?: boolean;
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
	render: () => {
		// Create a component that ensures no snackbar is shown initially
		const DefaultComponent = () => {
			const [checking, setChecking] = useState(false);

			// Override the checkForUpdates function to simulate the flow
			useEffect(() => {
				// Replace with a function that simulates checking but doesn't show any snackbar
				window.api.updater.checkForUpdates = async () => {
					setChecking(true);

					// Simulate a delay for checking
					setTimeout(() => {
						setChecking(false);
					}, 500);

					return Promise.resolve({
						updateInfo: mockUpdateInfo,
						cancellationToken: {},
					});
				};

				return () => {
					// No cleanup needed for the story
				};
			}, []);

			return (
				<div style={{ minHeight: "100px", position: "relative" }}>
					<Button
						variant="outlined"
						onClick={() => window.api.updater.checkForUpdates()}
						disabled={checking}
						startIcon={
							checking ? <Box sx={{ width: 16, height: 16 }} /> : undefined
						}
					>
						{checking ? "Checking..." : "Check for Updates"}
					</Button>
				</div>
			);
		};

		return <DefaultComponent />;
	},
};

/**
 * Shows the button state when no update is available.
 */
export const ButtonNoUpdateAvailable: StoryObj<typeof buttonMeta> = {
	parameters: {
		triggerUpdateNotAvailable: true,
	},
	render: () => {
		// Create a component that simulates clicking the button and showing "no update available"
		const NoUpdateComponent = () => {
			const [checking, setChecking] = useState(false);
			const [noUpdateAvailable, setNoUpdateAvailable] = useState(false);
			const [snackbarOpen, setSnackbarOpen] = useState(false);

			// Initialize with the snackbar open to show the state
			useEffect(() => {
				setNoUpdateAvailable(true);
				setSnackbarOpen(true);
			}, []);

			// Override the checkForUpdates function to simulate the flow
			useEffect(() => {
				// Replace with a function that simulates checking and then showing "no update available"
				window.api.updater.checkForUpdates = async () => {
					setChecking(true);
					setSnackbarOpen(false); // Close any existing snackbar

					// Simulate a delay for checking
					setTimeout(() => {
						setChecking(false);
						setNoUpdateAvailable(true);
						setSnackbarOpen(true); // Show the snackbar

						// Trigger the onUpdateNotAvailable callback
						const callbacks =
							// @ts-ignore - _callbacks is added at runtime for our mock implementation
							window.api.updater._callbacks?.updateNotAvailable || [];
						for (const callback of callbacks) {
							callback(mockUpdateInfo);
						}
					}, 500);

					return Promise.resolve({
						updateInfo: mockUpdateInfo,
						cancellationToken: {},
					});
				};

				// Add a callbacks collection to the mock API if it doesn't exist
				// @ts-ignore - _callbacks is added at runtime for our mock implementation
				if (!window.api.updater._callbacks) {
					// @ts-ignore - _callbacks is added at runtime for our mock implementation
					window.api.updater._callbacks = {} as UpdaterCallbacks;
				}

				return () => {
					// No cleanup needed for the story
				};
			}, []);

			// Override the onUpdateNotAvailable to store callbacks
			useEffect(() => {
				const originalOnUpdateNotAvailable =
					window.api.updater.onUpdateNotAvailable;
				window.api.updater.onUpdateNotAvailable = (callback) => {
					// Store the callback
					// @ts-ignore - _callbacks is added at runtime for our mock implementation
					if (!window.api.updater._callbacks) {
						// @ts-ignore - _callbacks is added at runtime for our mock implementation
						window.api.updater._callbacks = {} as UpdaterCallbacks;
					}
					// @ts-ignore - _callbacks is added at runtime for our mock implementation
					if (!window.api.updater._callbacks.updateNotAvailable) {
						// @ts-ignore - _callbacks is added at runtime for our mock implementation
						window.api.updater._callbacks.updateNotAvailable = [];
					}
					// @ts-ignore - _callbacks is added at runtime for our mock implementation
					window.api.updater._callbacks.updateNotAvailable.push(callback);

					// Call it immediately if we're already in the "no update available" state
					if (noUpdateAvailable) {
						callback(mockUpdateInfo);
					}

					// Return cleanup function
					return () => {
						// @ts-ignore - _callbacks is added at runtime for our mock implementation
						if (window.api.updater._callbacks?.updateNotAvailable) {
							// @ts-ignore - _callbacks is added at runtime for our mock implementation
							window.api.updater._callbacks.updateNotAvailable =
								// @ts-ignore - _callbacks is added at runtime for our mock implementation
								window.api.updater._callbacks.updateNotAvailable.filter(
									(cb) => cb !== callback,
								);
						}
					};
				};

				return () => {
					window.api.updater.onUpdateNotAvailable =
						originalOnUpdateNotAvailable;
				};
			}, [noUpdateAvailable]);

			return (
				<div style={{ minHeight: "100px", position: "relative" }}>
					<Button
						variant="outlined"
						onClick={() => window.api.updater.checkForUpdates()}
						disabled={checking}
						startIcon={
							checking ? <Box sx={{ width: 16, height: 16 }} /> : undefined
						}
					>
						{checking ? "Checking..." : "Check for Updates"}
					</Button>

					<Snackbar
						open={snackbarOpen}
						autoHideDuration={6000}
						onClose={() => setSnackbarOpen(false)}
						anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
					>
						<Alert onClose={() => setSnackbarOpen(false)} severity="info">
							You're using the latest version
						</Alert>
					</Snackbar>
				</div>
			);
		};

		return <NoUpdateComponent />;
	},
};

/**
 * Shows the button state when there's an error checking for updates.
 */
export const ButtonErrorState: StoryObj<typeof buttonMeta> = {
	parameters: {
		triggerUpdateError: true,
	},
	render: () => {
		// Create a component that simulates clicking the button and showing an error
		const ErrorComponent = () => {
			const [checking, setChecking] = useState(false);
			const [error, setError] = useState<string>(
				"Failed to check for updates: Network error",
			);
			const [snackbarOpen, setSnackbarOpen] = useState(true);

			// Initialize with the error snackbar open to show the state
			useEffect(() => {
				setError("Failed to check for updates: Network error");
				setSnackbarOpen(true);
			}, []);

			// Override the checkForUpdates function to simulate the flow
			useEffect(() => {
				// Replace with a function that simulates checking and then showing an error
				window.api.updater.checkForUpdates = async () => {
					setChecking(true);
					setSnackbarOpen(false); // Close any existing snackbar

					// Simulate a delay for checking
					setTimeout(() => {
						setChecking(false);
						setError("Failed to check for updates: Network error");
						setSnackbarOpen(true); // Show the snackbar

						// Trigger the onUpdateError callback
						// @ts-ignore - _callbacks is added at runtime for our mock implementation
						const callbacks = window.api.updater._callbacks?.updateError || [];
						for (const callback of callbacks) {
							callback("Failed to check for updates: Network error");
						}
					}, 500);

					return Promise.reject(new Error("Network error"));
				};

				// Add a callbacks collection to the mock API if it doesn't exist
				// @ts-ignore - _callbacks is added at runtime for our mock implementation
				if (!window.api.updater._callbacks) {
					// @ts-ignore - _callbacks is added at runtime for our mock implementation
					window.api.updater._callbacks = {} as UpdaterCallbacks;
				}

				return () => {
					// No cleanup needed for the story
				};
			}, []);

			// Override the onUpdateError to store callbacks
			useEffect(() => {
				const originalOnUpdateError = window.api.updater.onUpdateError;
				window.api.updater.onUpdateError = (callback) => {
					// Store the callback
					// @ts-ignore - _callbacks is added at runtime for our mock implementation
					if (!window.api.updater._callbacks) {
						// @ts-ignore - _callbacks is added at runtime for our mock implementation
						window.api.updater._callbacks = {} as UpdaterCallbacks;
					}
					// @ts-ignore - _callbacks is added at runtime for our mock implementation
					if (!window.api.updater._callbacks.updateError) {
						// @ts-ignore - _callbacks is added at runtime for our mock implementation
						window.api.updater._callbacks.updateError = [];
					}
					// @ts-ignore - _callbacks is added at runtime for our mock implementation
					window.api.updater._callbacks.updateError.push(callback);

					// Call it immediately if we're already in the error state
					if (error) {
						callback(error);
					}

					// Return cleanup function
					return () => {
						// @ts-ignore - _callbacks is added at runtime for our mock implementation
						if (window.api.updater._callbacks?.updateError) {
							// @ts-ignore - _callbacks is added at runtime for our mock implementation
							window.api.updater._callbacks.updateError =
								// @ts-ignore - _callbacks is added at runtime for our mock implementation
								window.api.updater._callbacks.updateError.filter(
									(cb) => cb !== callback,
								);
						}
					};
				};

				return () => {
					window.api.updater.onUpdateError = originalOnUpdateError;
				};
			}, [error]);

			return (
				<div style={{ minHeight: "100px", position: "relative" }}>
					<Button
						variant="outlined"
						onClick={() => window.api.updater.checkForUpdates()}
						disabled={checking}
						startIcon={
							checking ? <Box sx={{ width: 16, height: 16 }} /> : undefined
						}
					>
						{checking ? "Checking..." : "Check for Updates"}
					</Button>

					<Snackbar
						open={snackbarOpen}
						autoHideDuration={6000}
						onClose={() => setSnackbarOpen(false)}
						anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
					>
						<Alert onClose={() => setSnackbarOpen(false)} severity="error">
							{error}
						</Alert>
					</Snackbar>
				</div>
			);
		};

		return <ErrorComponent />;
	},
};

/**
 * Shows the notification when in development mode.
 */
export const DevMode: Story = {
	args: {
		autoCheck: false,
	},
	render: () => {
		// Create a component that directly renders the dev mode state
		const DevModeComponent = () => {
			// Use state to force the component to render with dev mode message
			const [devModeMessage, setDevModeMessage] = useState<string | null>(null);
			const [snackbarOpen, setSnackbarOpen] = useState(true);

			useEffect(() => {
				// Set the state immediately
				setDevModeMessage(
					"You're running in development mode. Updates are disabled.",
				);

				// Override the onUpdateDevMode method
				const originalOnUpdateDevMode = window.api.updater.onUpdateDevMode;
				window.api.updater.onUpdateDevMode = (callback) => {
					// Call it immediately
					callback("You're running in development mode. Updates are disabled.");
					return () => {};
				};

				// Set the trigger flag
				window.triggerDevMode = true;

				return () => {
					window.api.updater.onUpdateDevMode = originalOnUpdateDevMode;
				};
			}, []);

			return (
				<div style={{ minHeight: "100px", position: "relative" }}>
					<Button
						variant="outlined"
						onClick={() => {}}
						disabled={false}
						startIcon={undefined}
					>
						Check for Updates
					</Button>

					<Snackbar
						open={snackbarOpen}
						autoHideDuration={6000}
						onClose={() => setSnackbarOpen(false)}
						anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
					>
						<Alert onClose={() => setSnackbarOpen(false)} severity="info">
							{devModeMessage}
						</Alert>
					</Snackbar>
				</div>
			);
		};

		return <DevModeComponent />;
	},
};

/**
 * Shows the notification when an NPX update is available.
 */
export const NpxUpdateAvailable: Story = {
	args: {
		autoCheck: false,
	},
	render: () => {
		// Create a component that directly renders the NPX update available state
		const NpxUpdateComponent = () => {
			// Use state to force the component to render with NPX update info
			const [npxUpdateInfo, setNpxUpdateInfo] = useState<{
				currentVersion: string;
				latestVersion: string;
				updateCommand: string;
			} | null>(null);
			const [snackbarOpen, setSnackbarOpen] = useState(true);

			useEffect(() => {
				// Set the state immediately
				setNpxUpdateInfo({
					currentVersion: "1.0.0",
					latestVersion: "2.0.0",
					updateCommand: "npx local-operator-ui@latest",
				});

				// Override the onUpdateNpxAvailable method
				const originalOnUpdateNpxAvailable =
					window.api.updater.onUpdateNpxAvailable;
				window.api.updater.onUpdateNpxAvailable = (callback) => {
					// Call it immediately
					callback({
						currentVersion: "1.0.0",
						latestVersion: "2.0.0",
						updateCommand: "npx local-operator-ui@latest",
					});
					return () => {};
				};

				// Set the trigger flag
				window.triggerNpxUpdate = true;

				return () => {
					window.api.updater.onUpdateNpxAvailable =
						originalOnUpdateNpxAvailable;
				};
			}, []);

			// Handle copying the NPX command to clipboard
			const handleCopyNpxCommand = () => {
				if (npxUpdateInfo) {
					navigator.clipboard.writeText(npxUpdateInfo.updateCommand);
				}
			};

			return (
				<div style={{ minHeight: "100px", position: "relative" }}>
					<Button
						variant="outlined"
						onClick={() => {}}
						disabled={false}
						startIcon={undefined}
					>
						Check for Updates
					</Button>

					<Snackbar
						open={snackbarOpen}
						autoHideDuration={10000}
						onClose={() => setSnackbarOpen(false)}
						anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
					>
						<Alert
							onClose={() => setSnackbarOpen(false)}
							severity="info"
							action={
								<Button
									color="inherit"
									size="small"
									onClick={handleCopyNpxCommand}
								>
									Copy
								</Button>
							}
						>
							<Typography variant="body2" sx={{ mb: 1 }}>
								Update available: {npxUpdateInfo?.latestVersion} (current:{" "}
								{npxUpdateInfo?.currentVersion})
							</Typography>
							<Typography variant="body2">
								To update, run: <code>{npxUpdateInfo?.updateCommand}</code>
							</Typography>
						</Alert>
					</Snackbar>
				</div>
			);
		};

		return <NpxUpdateComponent />;
	},
};
