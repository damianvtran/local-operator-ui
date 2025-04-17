/**
 * @file session-store.ts
 * @description
 * Securely persists the backend JWT and refresh token for session restoration using Electron IPC.
 * Handles expiration and provides helpers for storing, retrieving, and clearing the session.
 * Uses the preload API to communicate with the main process, avoiding direct Node.js usage in the renderer.
 */

// Session duration: 7 days in milliseconds (fallback for tokens without expiry)
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Session data type
 */
export type SessionData = {
	accessToken: string;
	refreshToken?: string;
	expiry: number;
};

/**
 * Store the session tokens with expiration.
 * @param accessToken - The access token to store
 * @param refreshToken - Optional refresh token to store
 * @param expiresIn - Optional token expiration in seconds
 * @returns A promise that resolves when the session is stored
 */
export async function storeSession(
	accessToken: string,
	refreshToken?: string,
	expiresIn?: number,
): Promise<void> {
	// Calculate expiry time based on expiresIn or use default
	const expiry = expiresIn
		? Date.now() + expiresIn * 1000
		: Date.now() + SESSION_DURATION_MS;

	// Await the IPC call to ensure it completes before proceeding
	await window.api.session.storeSession(accessToken, expiry, refreshToken);
}

/**
 * Retrieve the stored session data if valid and not expired.
 * @returns The session data if valid, or null if missing/expired
 */
export async function getSession(): Promise<SessionData | null> {
	try {
		const { accessToken, refreshToken, expiry } =
			await window.api.session.getSession();

		if (!accessToken || !expiry) return null;

		// Check if the access token is expired
		if (Date.now() > expiry) {
			// If we have a refresh token, we can still consider the session valid
			// The caller will need to refresh the token
			if (refreshToken) {
				return {
					accessToken,
					refreshToken,
					expiry,
				};
			}

			// No refresh token and expired access token, clear the session
			clearSession();
			return null;
		}

		return {
			accessToken,
			refreshToken,
			expiry,
		};
	} catch (error) {
		console.error("Error retrieving session:", error);
		return null;
	}
}

/**
 * Clear the stored session data.
 */
export function clearSession(): void {
	window.api.session.clearSession();
}

/**
 * Check if a valid session exists.
 * @param checkExpiry - Whether to check if the token is expired (default: true)
 * @returns True if a valid session is stored
 */
export async function hasValidSession(checkExpiry = true): Promise<boolean> {
	const session = await getSession();
	if (!session) return false;

	// If we're not checking expiry or we have a refresh token, consider the session valid
	if (!checkExpiry || session.refreshToken) return true;

	// Otherwise, check if the access token is expired
	return Date.now() <= session.expiry;
}

/**
 * Update just the access token and its expiry, keeping or updating the refresh token.
 * @param accessToken - The new access token
 * @param expiresIn - Token expiration in seconds
 * @param refreshToken - Optional new refresh token (if not provided, keeps the existing one)
 */
export async function updateAccessToken(
	accessToken: string,
	expiresIn: number,
	newRefreshToken?: string,
): Promise<void> {
	const session = await getSession();
	// Use the provided refresh token or keep the existing one
	const refreshToken = newRefreshToken || session?.refreshToken;
	const expiry = Date.now() + expiresIn * 1000;

	await window.api.session.storeSession(accessToken, expiry, refreshToken);
}
