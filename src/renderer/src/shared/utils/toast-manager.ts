/**
 * Toast Manager Utility
 *
 * This utility provides functions for managing toast notifications,
 * including deduplication and rate limiting to prevent toast spam.
 * Toasts are styled using sonner and themed according to the application.
 */

import { toast } from "sonner";
import type { ExternalToast } from "sonner"; // Using ExternalToast for options type

// Store active toast IDs by message
const activeToasts = new Map<string, string | number>(); // Sonner IDs can be string or number

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
 * @param options - Sonner toast options (ExternalToast)
 * @returns The toast ID or null if the toast was suppressed
 */
export const showErrorToast = (
	message: string,
	options?: ExternalToast,
): string | number | null => {
	const now = Date.now();
	const errorGroup = getErrorGroup(message);
	const key = errorGroup || message;

	const lastShown = lastErrorShownTime.get(key);
	if (lastShown && now - lastShown < DEFAULT_ERROR_COOLDOWN) {
		return null;
	}

	const errorCount = errorCountInPeriod.get(key) || 0;
	if (errorCount >= MAX_SIMILAR_ERRORS) {
		return null;
	}

	if (activeToasts.has(key)) {
		lastErrorShownTime.set(key, now);
		// Optionally, update the existing toast if sonner allows, or just return its ID
		// For simplicity, we'll return the existing ID. Sonner might dismiss and show a new one.
		return activeToasts.get(key) as string | number;
	}

	const id = toast.error(message, {
		...options,
		onDismiss: (toastItem) => {
			activeToasts.delete(key);
			options?.onDismiss?.(toastItem);
		},
		onAutoClose: (toastItem) => {
			activeToasts.delete(key);
			options?.onAutoClose?.(toastItem);
		},
	});

	activeToasts.set(key, id);
	lastErrorShownTime.set(key, now);
	errorCountInPeriod.set(key, errorCount + 1);

	setTimeout(() => {
		errorCountInPeriod.set(key, 0);
	}, DEFAULT_ERROR_COOLDOWN);

	return id;
};

/**
 * Show an info toast
 *
 * @param message - The info message to display
 * @param options - Sonner toast options (ExternalToast)
 * @returns The toast ID
 */
export const showInfoToast = (
	message: string,
	options?: ExternalToast,
): string | number => {
	return toast.info(message, options);
};

/**
 * Show a success toast
 *
 * @param message - The success message to display
 * @param options - Sonner toast options (ExternalToast)
 * @returns The toast ID
 */
export const showSuccessToast = (
	message: string,
	options?: ExternalToast,
): string | number => {
	return toast.success(message, options);
};

/**
 * Show a warning toast
 *
 * @param message - The warning message to display
 * @param options - Sonner toast options (ExternalToast)
 * @returns The toast ID
 */
export const showWarningToast = (
	message: string,
	options?: ExternalToast,
): string | number => {
	return toast.warning(message, options);
};
