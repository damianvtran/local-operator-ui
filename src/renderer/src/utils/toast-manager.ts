/**
 * Toast Manager Utility
 *
 * This utility provides functions for managing toast notifications,
 * including deduplication and rate limiting to prevent toast spam.
 */

import { type Id, type ToastOptions, toast } from "react-toastify";

// Store active toast IDs by message
const activeToasts = new Map<string, Id>();

// Store the last time a specific error was shown
const lastErrorShownTime = new Map<string, number>();

// Store count of similar errors shown in the current time period
const errorCountInPeriod = new Map<string, number>();

// Default cooldown period for showing the same error again (in milliseconds)
const DEFAULT_ERROR_COOLDOWN = 5000; // 5 seconds

// Maximum number of similar errors to show in a given time period
const MAX_SIMILAR_ERRORS = 1;

// Group error messages by type
const ERROR_GROUPS = {
	CONNECTION: [
		"Failed to fetch",
		"Network error",
		"ERR_CONNECTION_REFUSED",
		"Server is offline",
		"Connection failed",
	],
	// Add other error groups as needed
};

/**
 * Get the error group for a message
 *
 * @param message - The error message
 * @returns The error group or null if not in any group
 */
const getErrorGroup = (message: string): string | null => {
	for (const [group, patterns] of Object.entries(ERROR_GROUPS)) {
		if (patterns.some((pattern) => message.includes(pattern))) {
			return group;
		}
	}
	return null;
};

/**
 * Show an error toast with deduplication and rate limiting
 *
 * @param message - The error message to display
 * @param options - Toast options
 * @returns The toast ID or null if the toast was suppressed
 */
export const showErrorToast = (
	message: string,
	options?: ToastOptions,
): Id | null => {
	// Get the current time
	const now = Date.now();

	// Get the error group if any
	const errorGroup = getErrorGroup(message);
	const key = errorGroup || message;

	// Check if we've shown this error recently
	const lastShown = lastErrorShownTime.get(key);
	if (lastShown && now - lastShown < DEFAULT_ERROR_COOLDOWN) {
		// Error is in cooldown period, don't show it
		return null;
	}

	// Check if we've shown too many similar errors in this period
	const errorCount = errorCountInPeriod.get(key) || 0;
	if (errorCount >= MAX_SIMILAR_ERRORS) {
		// Too many similar errors, don't show it
		return null;
	}

	// Check if we already have an active toast for this error
	if (activeToasts.has(key)) {
		// Update the last shown time
		lastErrorShownTime.set(key, now);
		return activeToasts.get(key) as Id;
	}

	// Show the toast
	const id = toast.error(message, {
		...options,
		onClose: () => {
			// Remove from active toasts when closed
			activeToasts.delete(key);

			// Call the original onClose if provided
			options?.onClose?.();
		},
	});

	// Store the toast ID and update last shown time
	activeToasts.set(key, id);
	lastErrorShownTime.set(key, now);

	// Increment the error count for this period
	errorCountInPeriod.set(key, errorCount + 1);

	// Reset the error count after the cooldown period
	setTimeout(() => {
		errorCountInPeriod.set(key, 0);
	}, DEFAULT_ERROR_COOLDOWN);

	return id;
};

/**
 * Show an info toast
 *
 * @param message - The info message to display
 * @param options - Toast options
 * @returns The toast ID
 */
export const showInfoToast = (message: string, options?: ToastOptions): Id => {
	return toast.info(message, options);
};

/**
 * Show a success toast
 *
 * @param message - The success message to display
 * @param options - Toast options
 * @returns The toast ID
 */
export const showSuccessToast = (
	message: string,
	options?: ToastOptions,
): Id => {
	return toast.success(message, options);
};

/**
 * Show a warning toast
 *
 * @param message - The warning message to display
 * @param options - Toast options
 * @returns The toast ID
 */
export const showWarningToast = (
	message: string,
	options?: ToastOptions,
): Id => {
	return toast.warning(message, options);
};
