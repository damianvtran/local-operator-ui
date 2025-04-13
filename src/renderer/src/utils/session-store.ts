/**
 * @file session-store.ts
 * @description
 * Securely persists the backend JWT for session restoration using Electron IPC.
 * Handles expiration (30 days) and provides helpers for storing, retrieving, and clearing the session.
 * Uses the preload API to communicate with the main process, avoiding direct Node.js usage in the renderer.
 */

// Session duration: 30 days in milliseconds
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Store the backend JWT with a 30-day expiration.
 * @param jwt - The backend JWT to store
 * @returns A promise that resolves when the session is stored
 */
export async function storeSession(jwt: string): Promise<void> {
	const expiry = Date.now() + SESSION_DURATION_MS;
	// Await the IPC call to ensure it completes before proceeding
	await window.api.session.storeSession(jwt, expiry);
}

/**
 * Retrieve the stored session JWT if valid and not expired.
 * @returns The JWT string if valid, or null if missing/expired
 */
export async function getSession(): Promise<string | null> {
	try {
		const { jwt, expiry } = await window.api.session.getSession();
		if (!jwt || !expiry) return null;
		if (Date.now() > expiry) {
			clearSession();
			return null;
		}
		return jwt;
	} catch (error) {
		console.error("Error retrieving session:", error);
		return null;
	}
}

/**
 * Clear the stored session JWT and expiry.
 */
export function clearSession(): void {
	window.api.session.clearSession();
}

/**
 * Check if a valid session exists.
 * @returns True if a valid, non-expired JWT is stored
 */
export async function hasValidSession(): Promise<boolean> {
	return !!(await getSession());
}
