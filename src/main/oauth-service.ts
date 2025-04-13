import type { StoreData } from "./store";
import { type BrowserWindow, net } from "electron"; // Import net
import * as keytar from "keytar";
import crypto from "node:crypto"; // Import Node crypto for manual PKCE
import {
	AuthorizationNotifier,
	AuthorizationRequest,
	AuthorizationServiceConfiguration,
	BaseTokenRequestHandler,
	GRANT_TYPE_AUTHORIZATION_CODE,
	GRANT_TYPE_REFRESH_TOKEN,
	TokenRequest,
} from "@openid/appauth";
// Import Node specific handler and requestor
import { NodeBasedHandler } from "@openid/appauth/built/node_support/node_request_handler.js";
import { NodeRequestor } from "@openid/appauth/built/node_support/node_requestor.js"; // Import NodeRequestor
import { backendConfig } from "./backend/config";
import { LogFileType, logger } from "./backend/logger";
import type { Store } from "./store";

// --- PKCE Helper Functions ---
// See: https://tools.ietf.org/html/rfc7636#section-4.1
function base64URLEncode(str: Buffer): string {
	return str
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=/g, "");
}

// See: https://tools.ietf.org/html/rfc7636#section-4.2
function sha256(buffer: string): Buffer {
	return crypto.createHash("sha256").update(buffer).digest();
}

function generateCodeVerifier(): string {
	// Generate a random buffer (32 bytes = 256 bits)
	const buffer = crypto.randomBytes(32);
	// Base64 URL encode the buffer
	return base64URLEncode(buffer);
}

function generateCodeChallenge(verifier: string): string {
	// SHA256 hash the verifier
	const hash = sha256(verifier);
	// Base64 URL encode the hash
	return base64URLEncode(hash);
}

// --- Constants ---
// Use a local HTTP redirect URI for NodeBasedHandler
const OAUTH_LISTEN_PORT = 1112; // Choose an available port
const REDIRECT_URI = `http://localhost:${OAUTH_LISTEN_PORT}`;
const KEYTAR_SERVICE = "radient-local-operator-oauth"; // Unique service name for keytar

// --- Provider Configurations ---
// Using OpenID Connect discovery endpoints
const GOOGLE_CONFIG = {
	discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
	clientId: backendConfig.VITE_GOOGLE_CLIENT_ID,
	scope: "openid email profile",
};

const MICROSOFT_CONFIG = {
	// Use common endpoint for multi-tenant apps or specify tenant ID
	discoveryUrl: `https://login.microsoftonline.com/${backendConfig.VITE_MICROSOFT_TENANT_ID}/v2.0/.well-known/openid-configuration`,
	clientId: backendConfig.VITE_MICROSOFT_CLIENT_ID,
	scope: "openid email profile offline_access", // offline_access is crucial for refresh tokens
};

type AuthProvider = "google" | "microsoft";

type OAuthStatus = {
	loggedIn: boolean;
	provider: AuthProvider | null;
	accessToken?: string;
	idToken?: string;
	expiry?: number;
	error?: string;
};

/**
 * OAuthService manages the OpenID Connect Authorization Code Flow with PKCE.
 * It handles interactions with identity providers (Google, Microsoft),
 * token storage (using keytar for refresh tokens), and communication
 * with the renderer process.
 */
export class OAuthService {
	private configuration: AuthorizationServiceConfiguration | null = null;
	private mainWindow: BrowserWindow | null = null;
	private readonly notifier: AuthorizationNotifier;
	private readonly requestHandler: NodeBasedHandler; // Use NodeBasedHandler
	private readonly tokenHandler: BaseTokenRequestHandler;
	private currentAuthProvider: AuthProvider | null = null;
	private currentAuthorizationRequest: AuthorizationRequest | null = null;
	private currentAuthorizationCodeVerifier: string | null = null;

	constructor(private readonly sessionStore: Store<StoreData>) {
		this.notifier = new AuthorizationNotifier();
		// Instantiate NodeBasedHandler with the chosen port
		this.requestHandler = new NodeBasedHandler(OAUTH_LISTEN_PORT);
		// Use NodeRequestor for token handling
		this.tokenHandler = new BaseTokenRequestHandler(new NodeRequestor());

		// Set listener for authorization requests (this remains the same)
		this.requestHandler.setAuthorizationNotifier(this.notifier);
		this.notifier.setAuthorizationListener(async (req, res, err) => {
			logger.info(
				`Authorization listener triggered for ${this.currentAuthProvider}`,
				LogFileType.OAUTH,
			);
			if (err) {
				const errorMessage =
					err.errorDescription || err.error || "Unknown error";
				logger.error(
					`Authorization Error: ${errorMessage}`,
					LogFileType.OAUTH,
					err,
				);
				this.sendErrorToRenderer(`Authorization failed: ${errorMessage}`);
				this.resetState();
				return;
			}

			if (res) {
				logger.info(
					`Authorization successful, received code: ${res.code}`,
					LogFileType.OAUTH,
				);
				// Don't overwrite the manually generated verifier stored during initiateLogin
				// this.currentAuthorizationCodeVerifier = req.internal?.code_verifier as string; // REMOVE THIS LINE
				this.currentAuthorizationRequest = req; // Store request info if needed elsewhere

				// Ensure we have the verifier stored from initiateLogin before proceeding
				if (!this.currentAuthorizationCodeVerifier) {
					logger.error(
						"Authorization listener: Code verifier is missing!",
						LogFileType.OAUTH,
					);
					this.sendErrorToRenderer(
						"Authorization failed: Missing internal security parameter.",
					);
					this.resetState();
					return;
				}

				await this.performTokenRequest(res.code);
			} else {
				logger.warn("Authorization response was null", LogFileType.OAUTH);
				this.sendErrorToRenderer(
					"Authorization response was unexpectedly null.",
				);
				this.resetState();
			}
		});
	}

	/**
	 * Sets the main browser window instance for sending IPC messages.
	 * @param window The main BrowserWindow instance.
	 */
	public setMainWindow(window: BrowserWindow): void {
		this.mainWindow = window;
	}

	/**
	 * Sends the current OAuth status to the renderer process.
	 * @param status The status object to send.
	 */
	private sendStatusToRenderer(status: OAuthStatus): void {
		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			logger.info(
				`Sending OAuth status to renderer: ${JSON.stringify({ ...status, accessToken: "...", idToken: "..." })}`,
				LogFileType.OAUTH,
			);
			this.mainWindow.webContents.send("oauth-status-update", status);
		} else {
			logger.warn(
				"Cannot send OAuth status, mainWindow is not available.",
				LogFileType.OAUTH,
			);
		}
	}

	/**
	 * Sends an error message to the renderer process.
	 * @param error The error message string.
	 */
	private sendErrorToRenderer(error: string): void {
		this.sendStatusToRenderer({
			loggedIn: false,
			provider: this.currentAuthProvider,
			error,
		});
	}

	/**
	 * Resets the internal state of the service, typically after logout or error.
	 */
	private resetState(): void {
		this.configuration = null;
		this.currentAuthProvider = null;
		this.currentAuthorizationRequest = null;
		this.currentAuthorizationCodeVerifier = null;
	}

	/**
	 * Fetches and caches the authorization service configuration from the discovery URL.
	 * @param provider The authentication provider.
	 * @returns The AuthorizationServiceConfiguration or null if an error occurs.
	 */
	private async fetchServiceConfiguration(
		provider: AuthProvider,
	): Promise<AuthorizationServiceConfiguration | null> {
		const config = provider === "google" ? GOOGLE_CONFIG : MICROSOFT_CONFIG;
		const discoveryUrl = config.discoveryUrl;

		logger.info(
			`Fetching OpenID configuration for ${provider} using Electron net from ${discoveryUrl}`,
			LogFileType.OAUTH,
		);

		return new Promise((resolve, reject) => {
			const request = net.request(discoveryUrl);

			request.on("response", (response) => {
				let body = "";
				response.on("data", (chunk) => {
					body += chunk.toString();
				});
				response.on("end", () => {
					if (
						response.statusCode &&
						response.statusCode >= 200 &&
						response.statusCode < 300
					) {
						try {
							const json = JSON.parse(body);
							// Manually create the configuration object
							const serviceConfig = new AuthorizationServiceConfiguration(json);
							logger.info(
								`Successfully fetched and parsed configuration for ${provider} via Electron net`,
								LogFileType.OAUTH,
							);
							resolve(serviceConfig);
						} catch (parseError) {
							logger.error(
								`Failed to parse OpenID configuration JSON for ${provider}:`,
								LogFileType.OAUTH,
								parseError,
							);
							this.sendErrorToRenderer(
								`Failed to parse configuration data for ${provider}.`,
							);
							resolve(null); // Resolve with null on parse error
						}
					} else {
						logger.error(
							`Failed to fetch OpenID configuration for ${provider}. Status: ${response.statusCode}`,
							LogFileType.OAUTH,
							{ body },
						);
						this.sendErrorToRenderer(
							`Failed to fetch configuration for ${provider} (Status: ${response.statusCode}).`,
						);
						resolve(null); // Resolve with null on non-2xx status
					}
				});
				response.on("error", (error) => {
					logger.error(
						`Error reading OpenID configuration response stream for ${provider}:`,
						LogFileType.OAUTH,
						error,
					);
					this.sendErrorToRenderer(
						`Network error while reading configuration for ${provider}.`,
					);
					resolve(null); // Resolve with null on response stream error
				});
			});

			request.on("error", (error) => {
				logger.error(
					`Failed to fetch OpenID configuration for ${provider} (Electron net request error):`,
					LogFileType.OAUTH,
					error,
				);
				this.sendErrorToRenderer(
					`Network error fetching configuration for ${provider}. Please check connection/proxy.`,
				);
				resolve(null); // Resolve with null on request error
			});

			request.end();
		});
	}

	/**
	 * Initiates the login flow for the specified provider.
	 * @param provider The authentication provider ('google' or 'microsoft').
	 */
	public async initiateLogin(provider: AuthProvider): Promise<void> {
		logger.info(`Initiating login with ${provider}`, LogFileType.OAUTH);
		this.resetState(); // Reset state before starting a new flow
		this.currentAuthProvider = provider;

		// Fetch configuration
		this.configuration = await this.fetchServiceConfiguration(provider);
		if (!this.configuration) {
			// Error already sent by fetchServiceConfiguration
			return;
		}

		const config = provider === "google" ? GOOGLE_CONFIG : MICROSOFT_CONFIG;

		// --- Manual PKCE Generation ---
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = generateCodeChallenge(codeVerifier);
		this.currentAuthorizationCodeVerifier = codeVerifier; // Store verifier for token request
		logger.info("Generated manual PKCE parameters", LogFileType.OAUTH);
		// --- End Manual PKCE Generation ---

		// Create authorization request, providing manual PKCE challenge
		const authRequest = new AuthorizationRequest(
			{
				client_id: config.clientId,
				redirect_uri: REDIRECT_URI,
				scope: config.scope,
				response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
				// state: undefined, // Optional state parameter
				extras: {
					code_challenge: codeChallenge,
					code_challenge_method: "S256",
				},
			},
			undefined, // Crypto utils (not needed for request itself)
			false, // IMPORTANT: Set usePkce to false as we provide challenge manually
		);

		// Store request details for later (verifier is already stored)
		this.currentAuthorizationRequest = authRequest;

		// --- Remove incorrect check for internal verifier ---
		// // The code verifier is generated internally by AuthorizationRequest when usePkce is true
		// // THIS IS NOW INCORRECT because usePkce is false
		// this.currentAuthorizationCodeVerifier = authRequest.internal?.code_verifier as string; // REMOVE
		//
		// if (!this.currentAuthorizationCodeVerifier) { // REMOVE BLOCK
		// 	logger.error("Failed to generate PKCE code verifier.", LogFileType.OAUTH);
		// 	this.sendErrorToRenderer("Failed to initialize secure login flow.");
		// 	this.resetState();
		// 	return;
		// }
		// --- End removal ---

		logger.info(
			`Performing authorization request for ${provider}`,
			LogFileType.OAUTH,
		);
		// Open the authorization URL in the system browser
		// The RedirectRequestHandler uses shell.openExternal internally
		this.requestHandler.performAuthorizationRequest(
			this.configuration,
			authRequest,
		);
	}

	/**
	 * Completes the authorization flow after the redirect from the provider.
	 * This is typically called when the app receives the custom protocol URL.
	 * @param url The full redirect URL received by the app.
	 */
	public async completeAuthorizationRequest(url: string): Promise<void> {
		logger.info(
			`Completing authorization request with URL: ${url}`,
			LogFileType.OAUTH,
		);

		if (!this.currentAuthProvider) {
			logger.error(
				"Cannot complete authorization request: No provider context.",
				LogFileType.OAUTH,
			);
			this.sendErrorToRenderer(
				"Authorization failed: Invalid state, no provider context.",
			);
			return;
		}

		if (!this.currentAuthorizationRequest) {
			logger.error(
				"Cannot complete authorization request: No pending authorization request.",
				LogFileType.OAUTH,
			);
			this.sendErrorToRenderer(
				"Authorization failed: Invalid state, no pending request.",
			);
			return;
		}

		// Pass the URL to the request handler to extract the response
		// This will internally call the listener set via `setAuthorizationNotifier`
		// Note: NodeBasedHandler listens for the redirect automatically and triggers
		// the notifier set above. No explicit call is needed here anymore.
		// The custom protocol handling might need re-evaluation if it was used
		// for more than just delivering the code (e.g., focusing the app).
		logger.info(
			"NodeBasedHandler is listening; authorization completion is handled via notifier.",
			LogFileType.OAUTH,
		);
		// this.requestHandler.completeAuthorizationRequestIfPossible(); // No longer needed
	}

	/**
	 * Exchanges the authorization code for tokens.
	 * @param code The authorization code received from the provider.
	 */
	private async performTokenRequest(code: string): Promise<void> {
		logger.info(
			`Performing token request with code: ${code}`,
			LogFileType.OAUTH,
		);

		if (!this.configuration) {
			logger.error(
				"Cannot perform token request: No service configuration.",
				LogFileType.OAUTH,
			);
			this.sendErrorToRenderer("Token request failed: Missing configuration.");
			this.resetState();
			return;
		}

		if (!this.currentAuthProvider) {
			logger.error(
				"Cannot perform token request: No provider context.",
				LogFileType.OAUTH,
			);
			this.sendErrorToRenderer(
				"Token request failed: Invalid state, no provider context.",
			);
			this.resetState();
			return;
		}

		if (!this.currentAuthorizationCodeVerifier) {
			logger.error(
				"Cannot perform token request: No PKCE code verifier.",
				LogFileType.OAUTH,
			);
			this.sendErrorToRenderer(
				"Token request failed: Missing security parameter.",
			);
			this.resetState();
			return;
		}

		const config =
			this.currentAuthProvider === "google" ? GOOGLE_CONFIG : MICROSOFT_CONFIG;

		// Create token request
		const request = new TokenRequest({
			client_id: config.clientId,
			redirect_uri: REDIRECT_URI,
			grant_type: GRANT_TYPE_AUTHORIZATION_CODE,
			code: code,
			// extras are used for PKCE verification
			extras: { code_verifier: this.currentAuthorizationCodeVerifier },
		});

		try {
			logger.info(
				`Making token request to ${this.configuration.tokenEndpoint} for ${this.currentAuthProvider}`,
				LogFileType.OAUTH,
			);
			const response = await this.tokenHandler.performTokenRequest(
				this.configuration,
				request,
			);

			logger.info(
				`Token request successful for ${this.currentAuthProvider}`,
				LogFileType.OAUTH,
			);

			// Store tokens securely
			await this.storeTokens(
				this.currentAuthProvider,
				response.accessToken,
				response.idToken,
				response.refreshToken,
				response.expiresIn,
			);

			// Send success status to renderer, including the ID token needed for backend exchange
			this.sendStatusToRenderer({
				loggedIn: true,
				provider: this.currentAuthProvider,
				accessToken: response.accessToken, // Consider if renderer needs this
				idToken: response.idToken,
				expiry: this.sessionStore.get("oauth_expiry"),
			});

			// Optionally clear the code verifier after successful use
			this.currentAuthorizationCodeVerifier = null;
			this.currentAuthorizationRequest = null; // Clear request as it's completed
		} catch (error) {
			const errorMsg =
				error instanceof Error ? error.message : "Unknown token error";
			logger.error(
				`Token Request Error for ${this.currentAuthProvider}: ${errorMsg}`,
				LogFileType.OAUTH,
				error,
			);
			this.sendErrorToRenderer(`Token exchange failed: ${errorMsg}`);
			// Clear potentially sensitive state on error
			await this.clearRefreshToken(this.currentAuthProvider);
			this.clearSessionTokens();
			this.resetState();
		}
	}

	/**
	 * Refreshes the access token using the stored refresh token.
	 */
	public async refreshAccessToken(): Promise<boolean> {
		logger.info("Attempting to refresh access token", LogFileType.OAUTH);

		const provider = this.sessionStore.get("oauth_provider");
		if (!provider) {
			logger.warn(
				"Cannot refresh token: No provider stored in session.",
				LogFileType.OAUTH,
			);
			return false;
		}

		const refreshToken = await this.getRefreshToken(provider);
		if (!refreshToken) {
			logger.warn(
				`Cannot refresh token: No refresh token found for ${provider}.`,
				LogFileType.OAUTH,
			);
			// If refresh fails, treat as logged out
			await this.logout();
			return false;
		}

		// Ensure configuration is loaded for the stored provider
		if (!this.configuration || this.currentAuthProvider !== provider) {
			this.configuration = await this.fetchServiceConfiguration(provider);
			if (!this.configuration) {
				logger.error(
					`Cannot refresh token: Failed to fetch configuration for ${provider}.`,
					LogFileType.OAUTH,
				);
				// Don't logout here, might be a temporary network issue
				this.sendErrorToRenderer(
					"Failed to refresh token: Could not fetch provider configuration.",
				);
				return false;
			}
			this.currentAuthProvider = provider; // Update current provider context
		}

		const config = provider === "google" ? GOOGLE_CONFIG : MICROSOFT_CONFIG;

		const request = new TokenRequest({
			client_id: config.clientId,
			redirect_uri: REDIRECT_URI, // Still required by some providers
			grant_type: GRANT_TYPE_REFRESH_TOKEN,
			refresh_token: refreshToken,
			// No code_verifier needed for refresh token grant
		});

		try {
			logger.info(
				`Making refresh token request to ${this.configuration.tokenEndpoint} for ${provider}`,
				LogFileType.OAUTH,
			);
			const response = await this.tokenHandler.performTokenRequest(
				this.configuration,
				request,
			);

			logger.info(
				`Token refresh successful for ${provider}`,
				LogFileType.OAUTH,
			);

			// Store the new tokens (response might include a new refresh token)
			await this.storeTokens(
				provider,
				response.accessToken,
				response.idToken, // May or may not be present in refresh response
				response.refreshToken, // Store the new refresh token if provided
				response.expiresIn,
			);

			// Notify renderer of the updated status (optional, depends on app logic)
			this.sendStatusToRenderer({
				loggedIn: true,
				provider: provider,
				accessToken: response.accessToken,
				idToken: response.idToken,
				expiry: this.sessionStore.get("oauth_expiry"),
			});

			return true;
		} catch (error) {
			const errorMsg =
				error instanceof Error ? error.message : "Unknown refresh error";
			logger.error(
				`Refresh Token Error for ${provider}: ${errorMsg}`,
				LogFileType.OAUTH,
				error,
			);

			// If refresh token is invalid/expired, logout user
			// Check for specific error codes if possible (e.g., 'invalid_grant')
			if (errorMsg.includes("invalid_grant")) {
				logger.warn(
					`Refresh token invalid for ${provider}. Logging out.`,
					LogFileType.OAUTH,
				);
				await this.logout();
			} else {
				// For other errors, just notify the renderer
				this.sendErrorToRenderer(`Failed to refresh token: ${errorMsg}`);
			}
			return false;
		}
	}

	/**
	 * Retrieves the current valid access token, refreshing if necessary.
	 * @returns The access token or null if unavailable/error.
	 */
	public async getAccessToken(): Promise<string | null> {
		logger.info("Attempting to get access token", LogFileType.OAUTH);

		const expiry = this.sessionStore.get("oauth_expiry");
		const accessToken = this.sessionStore.get("oauth_access_token");
		const provider = this.sessionStore.get("oauth_provider");

		// Check if we have a token and provider
		if (!accessToken || !provider) {
			logger.info(
				"No access token or provider found in session.",
				LogFileType.OAUTH,
			);
			return null;
		}

		// Check if the token is expired (add a small buffer, e.g., 60 seconds)
		const bufferSeconds = 60;
		const isExpired = !expiry || Date.now() >= expiry - bufferSeconds * 1000;

		if (isExpired) {
			logger.info(
				`Access token for ${provider} is expired or nearing expiry. Attempting refresh.`,
				LogFileType.OAUTH,
			);
			const refreshSuccessful = await this.refreshAccessToken();
			if (refreshSuccessful) {
				// Return the newly refreshed token
				const newAccessToken = this.sessionStore.get("oauth_access_token");
				if (newAccessToken) {
					logger.info(
						"Returning newly refreshed access token.",
						LogFileType.OAUTH,
					);
					return newAccessToken;
				}
				logger.error(
					"Refresh seemed successful, but no new access token found in store.",
					LogFileType.OAUTH,
				);
				return null; // Should not happen if refresh was truly successful
			}
			// Refresh failed (logout might have been triggered internally)
			logger.warn("Access token refresh failed.", LogFileType.OAUTH);
			return null;
		}

		// Token is valid
		logger.info(
			"Returning valid access token from session.",
			LogFileType.OAUTH,
		);
		return accessToken;
	}

	/**
	 * Retrieves the current OAuth status (logged in state, tokens).
	 * @returns The current OAuthStatus.
	 */
	public async getStatus(): Promise<OAuthStatus> {
		logger.info("Getting current OAuth status", LogFileType.OAUTH);

		const provider = this.sessionStore.get("oauth_provider");
		const accessToken = this.sessionStore.get("oauth_access_token");
		const idToken = this.sessionStore.get("oauth_id_token");
		const expiry = this.sessionStore.get("oauth_expiry");

		if (!provider || !accessToken || !expiry) {
			logger.info("No valid session found.", LogFileType.OAUTH);
			return { loggedIn: false, provider: null };
		}

		// Check expiry (use the same buffer as getAccessToken)
		const bufferSeconds = 60;
		const isExpired = Date.now() >= expiry - bufferSeconds * 1000;

		if (isExpired) {
			logger.info(
				`Session for ${provider} found, but token is expired.`,
				LogFileType.OAUTH,
			);
			// Optionally attempt refresh here, or rely on getAccessToken to handle it
			// For simplicity, just report as logged out if expired for getStatus
			return { loggedIn: false, provider: provider, error: "Token expired" };
		}

		logger.info(`Valid session found for ${provider}.`, LogFileType.OAUTH);
		return {
			loggedIn: true,
			provider: provider,
			accessToken: accessToken, // Consider if needed by renderer initially
			idToken: idToken,
			expiry: expiry,
		};
	}

	/**
	 * Logs the user out, clearing stored tokens and resetting state.
	 */
	public async logout(): Promise<void> {
		logger.info("Initiating logout process", LogFileType.OAUTH);

		const provider = this.sessionStore.get("oauth_provider");

		if (provider) {
			logger.info(`Clearing refresh token for ${provider}`, LogFileType.OAUTH);
			await this.clearRefreshToken(provider);
		} else {
			logger.warn(
				"No provider found in session during logout, attempting to clear all known providers.",
				LogFileType.OAUTH,
			);
			// Attempt to clear for both just in case state is inconsistent
			await this.clearRefreshToken("google");
			await this.clearRefreshToken("microsoft");
		}

		logger.info("Clearing session tokens", LogFileType.OAUTH);
		this.clearSessionTokens();

		logger.info("Resetting OAuth service state", LogFileType.OAUTH);
		this.resetState();

		logger.info("Sending logged out status to renderer", LogFileType.OAUTH);
		this.sendStatusToRenderer({ loggedIn: false, provider: null });
	}

	// --- Helper methods for token storage ---

	private async storeTokens(
		provider: AuthProvider,
		accessToken: string,
		idToken: string | undefined,
		refreshToken: string | undefined,
		expiresIn: number | undefined,
	): Promise<void> {
		const expiryTime = expiresIn
			? Date.now() + expiresIn * 1000
			: Date.now() + 3600 * 1000; // Default to 1 hour if not provided

		this.sessionStore.set("oauth_provider", provider);
		this.sessionStore.set("oauth_access_token", accessToken);
		this.sessionStore.set("oauth_id_token", idToken || ""); // Store empty string if undefined
		this.sessionStore.set("oauth_expiry", expiryTime);

		if (refreshToken) {
			try {
				await keytar.setPassword(
					KEYTAR_SERVICE,
					`${provider}-refresh-token`,
					refreshToken,
				);
				logger.info(
					`Stored refresh token for ${provider} securely.`,
					LogFileType.OAUTH,
				);
			} catch (error) {
				logger.error(
					`Failed to store refresh token for ${provider}:`,
					LogFileType.OAUTH,
					error,
				);
				// Decide if this is a critical failure
			}
		} else {
			// Ensure old refresh token is cleared if none provided in new response
			await this.clearRefreshToken(provider);
		}
	}

	private async getRefreshToken(
		provider: AuthProvider,
	): Promise<string | null> {
		try {
			const token = await keytar.getPassword(
				KEYTAR_SERVICE,
				`${provider}-refresh-token`,
			);
			if (token) {
				logger.info(
					`Retrieved refresh token for ${provider}.`,
					LogFileType.OAUTH,
				);
			} else {
				logger.warn(
					`No refresh token found for ${provider}.`,
					LogFileType.OAUTH,
				);
			}
			return token;
		} catch (error) {
			logger.error(
				`Failed to retrieve refresh token for ${provider}:`,
				LogFileType.OAUTH,
				error,
			);
			return null;
		}
	}

	private async clearRefreshToken(provider: AuthProvider): Promise<void> {
		try {
			await keytar.deletePassword(KEYTAR_SERVICE, `${provider}-refresh-token`);
			logger.info(`Cleared refresh token for ${provider}.`, LogFileType.OAUTH);
		} catch (error) {
			// Log error but don't necessarily fail the logout
			logger.error(
				`Failed to clear refresh token for ${provider}:`,
				LogFileType.OAUTH,
				error,
			);
		}
	}

	private clearSessionTokens(): void {
		this.sessionStore.delete("oauth_provider");
		this.sessionStore.delete("oauth_access_token");
		this.sessionStore.delete("oauth_id_token");
		this.sessionStore.delete("oauth_expiry");
		logger.info("Cleared OAuth tokens from session store.", LogFileType.OAUTH);
	}
}
