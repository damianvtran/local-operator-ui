/**
 * @file use-msal-instance.ts
 * @description
 * Hook to access the MSAL instance from the MicrosoftAuthProvider context.
 */

import type { IPublicClientApplication } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";

/**
 * Hook to access the MSAL instance from the MicrosoftAuthProvider context.
 * This hook MUST be called within a component tree wrapped by MicrosoftAuthProvider.
 *
 * @returns The MSAL instance from the context
 * @throws Error if used outside of MicrosoftAuthProvider
 */
export const useMsalInstance = (): IPublicClientApplication => {
	try {
		// Get the MSAL instance from the context
		const { instance } = useMsal();

		// Ensure the instance is initialized
		if (!instance) {
			throw new Error("MSAL instance is null or undefined");
		}

		return instance;
	} catch (error) {
		// Log the error with a clear message about the likely cause
		console.error(
			"Error getting MSAL instance: This usually means the hook is being used outside of MicrosoftAuthProvider or the instance is not properly initialized.",
			error,
		);

		// Re-throw the error to ensure it's not silently ignored
		// This follows React's pattern of failing fast for hook usage errors
		throw error;
	}
};
