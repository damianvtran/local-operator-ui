import {
	Alert,
	Box,
	Button,
	CssBaseline,
	Snackbar,
	Typography,
} from "@mui/material";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import { DEFAULT_THEME, themes } from "@shared/themes";
import type { Meta, StoryObj } from "@storybook/react";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { useEffect, useState } from "react";
import { ThemeProvider as StyledThemeProvider } from "styled-components";
import { CheckForUpdatesButton } from "./check-for-updates-button";

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
			checkForBackendUpdates: async () => Promise.resolve(null),
			checkForAllUpdates: async () => Promise.resolve(),
			updateBackend: async () => Promise.resolve(true),
			downloadUpdate: async () => Promise.resolve([]),
			quitAndInstall: () => {},
			onUpdateDevMode: () => () => {},
			onUpdateNpxAvailable: () => () => {},
			onBackendUpdateAvailable: () => () => {},
			onBackendUpdateDevMode: () => () => {},
			onBackendUpdateNotAvailable: () => () => {},
			onBackendUpdateCompleted: () => () => {},
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
		checkForBackendUpdates: async () => Promise.resolve(null),
		checkForAllUpdates: async () => Promise.resolve(),
		updateBackend: async () => Promise.resolve(true),
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
		onBackendUpdateAvailable: (
			callback: (info: {
				currentVersion: string;
				latestVersion: string;
				updateCommand: string;
			}) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateAvailable) {
				// Immediately trigger the callback
				callback({
					currentVersion: "1.0.0",
					latestVersion: "2.0.0",
					updateCommand: "pip install --upgrade local-operator",
				});
			}
			return () => {};
		},
		onBackendUpdateDevMode: (callback: (message: string) => void) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateDevMode) {
				// Immediately trigger the callback
				callback("Backend updates are disabled in development mode.");
			}
			return () => {};
		},
		onBackendUpdateNotAvailable: (
			callback: (info: { version: string }) => void,
		) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateNotAvailable) {
				// Immediately trigger the callback
				callback({ version: "1.0.0" });
			}
			return () => {};
		},
		onBackendUpdateCompleted: (callback: () => void) => {
			// For stories that need to trigger this callback
			if (window.triggerBackendUpdateCompleted) {
				// Immediately trigger the callback
				callback();
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
		triggerBackendUpdateAvailable?: boolean;
		triggerBackendUpdateNotAvailable?: boolean;
		triggerBackendUpdateCompleted?: boolean;
		triggerBackendUpdateDevMode?: boolean;
		triggerNpxUpdate?: boolean;
		triggerDevMode?: boolean;
	}
}

/**
 * Stories for the CheckForUpdatesButton component
 */
const meta = {
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

			const theme = themes[DEFAULT_THEME];

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

export default meta;
type Story = StoryObj<typeof meta>;

export const ButtonDefault: Story = {
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
export const ButtonNoUpdateAvailable: Story = {
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
									(cb: (info: UpdateInfo) => void) => cb !== callback,
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
export const ButtonErrorState: Story = {
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
									(cb: (message: string) => void) => cb !== callback,
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

/**
 * Shows the notification when a backend update is available.
 */
export const BackendUpdateAvailable: Story = {
	args: {
		autoCheck: false,
	},
	render: () => {
		// Create a component that directly renders the backend update available state
		const BackendUpdateComponent = () => {
			const [backendUpdateInfo, setBackendUpdateInfo] = useState<{
				currentVersion: string;
				latestVersion: string;
				updateCommand: string;
			} | null>(null);
			const [snackbarOpen, setSnackbarOpen] = useState(true);
			const [updatingBackend, setUpdatingBackend] = useState(false);

			useEffect(() => {
				// Set the state immediately
				setBackendUpdateInfo({
					currentVersion: "1.0.0",
					latestVersion: "2.0.0",
					updateCommand: "pip install --upgrade local-operator",
				});

				// Override the onBackendUpdateAvailable method
				const originalOnBackendUpdateAvailable =
					window.api.updater.onBackendUpdateAvailable;
				window.api.updater.onBackendUpdateAvailable = (callback) => {
					// Call it immediately
					callback({
						currentVersion: "1.0.0",
						latestVersion: "2.0.0",
						updateCommand: "pip install --upgrade local-operator",
					});
					return () => {};
				};

				// Set the trigger flag
				window.triggerBackendUpdateAvailable = true;

				return () => {
					window.api.updater.onBackendUpdateAvailable =
						originalOnBackendUpdateAvailable;
				};
			}, []);

			// Handle copying the backend update command to clipboard
			const handleCopyCommand = () => {
				if (backendUpdateInfo) {
					navigator.clipboard.writeText(backendUpdateInfo.updateCommand);
				}
			};

			// Handle updating the backend
			const updateBackend = () => {
				setUpdatingBackend(true);
				// Simulate backend update
				setTimeout(() => {
					setUpdatingBackend(false);
					setBackendUpdateInfo(null);
					setSnackbarOpen(false);
				}, 1500);
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
								<>
									<Button
										color="inherit"
										size="small"
										onClick={handleCopyCommand}
										sx={{ mr: 1 }}
									>
										Copy
									</Button>
									<Button
										color="primary"
										size="small"
										onClick={updateBackend}
										disabled={updatingBackend}
									>
										{updatingBackend ? "Updating..." : "Update"}
									</Button>
								</>
							}
						>
							<Typography variant="body2" sx={{ mb: 1 }}>
								Backend update available: {backendUpdateInfo?.latestVersion}{" "}
								(current: {backendUpdateInfo?.currentVersion})
							</Typography>
							<Typography variant="body2">
								To update manually, run:{" "}
								<code>{backendUpdateInfo?.updateCommand}</code>
							</Typography>
						</Alert>
					</Snackbar>
				</div>
			);
		};

		return <BackendUpdateComponent />;
	},
};

/**
 * Shows the notification when a backend update has completed.
 */
export const BackendUpdateCompleted: Story = {
	args: {
		autoCheck: false,
	},
	render: () => {
		// Create a component that directly renders the backend update completed state
		const BackendUpdateCompletedComponent = () => {
			const [snackbarOpen, setSnackbarOpen] = useState(true);

			useEffect(() => {
				// Override the onBackendUpdateCompleted method
				const originalOnBackendUpdateCompleted =
					window.api.updater.onBackendUpdateCompleted;
				window.api.updater.onBackendUpdateCompleted = (callback) => {
					// Call it immediately
					callback();
					return () => {};
				};

				// Set the trigger flag
				window.triggerBackendUpdateCompleted = true;

				return () => {
					window.api.updater.onBackendUpdateCompleted =
						originalOnBackendUpdateCompleted;
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
						<Alert onClose={() => setSnackbarOpen(false)} severity="success">
							Backend updated successfully
						</Alert>
					</Snackbar>
				</div>
			);
		};

		return <BackendUpdateCompletedComponent />;
	},
};

/**
 * Shows the notification when no backend update is available.
 */
export const BackendUpdateNotAvailable: Story = {
	args: {
		autoCheck: false,
	},
	render: () => {
		// Create a component that directly renders the backend update not available state
		const BackendUpdateNotAvailableComponent = () => {
			const [snackbarOpen, setSnackbarOpen] = useState(true);

			useEffect(() => {
				// Override the onBackendUpdateNotAvailable method
				const originalOnBackendUpdateNotAvailable =
					window.api.updater.onBackendUpdateNotAvailable;
				window.api.updater.onBackendUpdateNotAvailable = (callback) => {
					// Call it immediately
					callback({ version: "1.0.0" });
					return () => {};
				};

				// Set the trigger flag
				window.triggerBackendUpdateNotAvailable = true;

				return () => {
					window.api.updater.onBackendUpdateNotAvailable =
						originalOnBackendUpdateNotAvailable;
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
							You're using the latest version
						</Alert>
					</Snackbar>
				</div>
			);
		};

		return <BackendUpdateNotAvailableComponent />;
	},
};
