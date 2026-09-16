/**
 * Toast Manager Utility
 *
 * This utility provides functions for managing toast notifications,
 * including deduplication and rate limiting to prevent toast spam.
 * Toasts are styled using sonner and themed according to the application.
 */

import { toast } from "sonner";
import type { ExternalToast } from "sonner"; // Using ExternalToast for options type
import { transientTransportFragment } from "../../../../shared/transport-failure";

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

/*
 * The verbatim strings a failed `fetch` throws, engine by engine. They reach a
 * toast unchanged wherever a caller hands `error.message` straight to
 * `showErrorToast`, and not one of them is addressed to a person: Chromium
 * says "Failed to fetch" for a refused connection, a DNS miss and a blocked
 * request alike, so the string names neither what broke nor what to do.
 *
 * Matched whole rather than by substring, unlike the grouping above. "Failed
 * to fetch conversation messages" is a sentence someone wrote on purpose and
 * says strictly more than the replacement would.
 */
const RAW_TRANSPORT_ERRORS: Record<string, true> = {
	"Failed to fetch": true,
	"TypeError: Failed to fetch": true,
	"Load failed": true,
	"NetworkError when attempting to fetch resource.": true,
	ERR_CONNECTION_REFUSED: true,
	"net::ERR_CONNECTION_REFUSED": true,
};

const CONNECTION_FAILURE_COPY =
	"Could not reach the server. Check that it is running, then try again.";

/**
 * The sentence a person reads, for one raw transport failure.
 *
 * WHY THE CLASSIFIER IS CONSULTED AT ALL, given the table above. That table
 * held exactly six strings and one of them was `net::ERR_CONNECTION_REFUSED` -
 * which is one of these having reached a toast before, and evidence that the
 * next member of the family would too. The table is a list of the spellings
 * somebody had seen; `isTransientTransportFailure` is the rule, covering the
 * whole Chromium `net::ERR_*` family and Node's errno forms, and it is the same
 * module MAIN retries the update check against
 * (`shared/transport-failure.ts`). ~50 `showErrorToast` call sites cannot each
 * be fixed by widening a table.
 *
 * TWO SHAPES, ONE RULE, and the difference is the authored half:
 *
 * - the WHOLE message is a transport string, so the sentence replaces it;
 * - the message CONTAINS one, so only that fragment is replaced and the
 *   authored prefix survives: `Failed to post comment: Failed to fetch` reads
 *   as "Failed to post comment: Could not reach the server...", never as a raw
 *   fragment and never with the prefix thrown away.
 *
 * The sentence is never emitted twice: the replacement is the same text in both
 * shapes, so a message already carrying it has nothing left for the classifier
 * to find.
 */
const transportFailureText = (message: string): string => {
	const trimmed = message.trim();
	if (Object.prototype.hasOwnProperty.call(RAW_TRANSPORT_ERRORS, trimmed)) {
		return CONNECTION_FAILURE_COPY;
	}
	const fragment = transientTransportFragment(trimmed);
	if (fragment === null) return message;
	// A fragment inside machine vocabulary is replaced along with it - see
	// `TransportFragment.clause`; one that is a clause of an authored message
	// leaves the authored half in place.
	if (!fragment.clause) return CONNECTION_FAILURE_COPY;
	return `${trimmed.slice(0, fragment.start)}${CONNECTION_FAILURE_COPY}${trimmed.slice(fragment.end)}`;
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

	/* Dedup still keys off what the caller passed, so two different raw
	   transport strings collapse the same way they did before. Only what the
	   person reads changes. The `hasOwnProperty` guard inside
	   `transportFailureText` is why a message of "toString" cannot find
	   `Object.prototype` and be rewritten; `Object.hasOwn` reads better but
	   needs an ES2022 lib this tsconfig does not target. */
	const text = transportFailureText(message);

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

	const id = toast.error(text, {
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
 * Forget every refusal `showErrorToast` has already accounted for.
 *
 * The deduplication above is a user-facing policy - the same refusal must not
 * stack, and repeating it inside the cooldown shows nothing - and it is done in
 * module state, which is right for the app: one window, one person, one
 * cooldown clock. It is wrong for a fixture that mounts the same refusal twice
 * in one document, and it does not clean itself up. A held toast (the refusal
 * story's `toastDuration: Infinity`) is never dismissed and never auto-closes,
 * so `activeToasts` keeps its id for the page's life while Sonner keeps
 * nothing: the next mount's identical refusal finds the key present, returns
 * the stale id and publishes no toast at all. The story then has no refusal on
 * screen even though the write really was refused, which is exactly the frame
 * the story exists to produce (agent review round 4, C-11).
 *
 * Production never calls this, and the policy itself is untouched: the shipping
 * cooldown still applies to everything the app says. Only the fixture's own
 * teardown does, at the same moment it dismisses the toast it was holding
 * (`RefusalFixture` in `canvas.stories.tsx`).
 */
export const resetToastDedup = () => {
	activeToasts.clear();
	lastErrorShownTime.clear();
	errorCountInPeriod.clear();
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
