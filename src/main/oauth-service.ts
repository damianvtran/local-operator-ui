import {
	AuthorizationNotifier,
	AuthorizationRequest,
	type AuthorizationResponse,
	AuthorizationServiceConfiguration,
	BaseTokenRequestHandler,
	GRANT_TYPE_AUTHORIZATION_CODE,
	GRANT_TYPE_REFRESH_TOKEN,
	type Requestor,
	type StringMap,
	TokenRequest,
	type TokenResponse,
} from "@openid/appauth";
import { NodeCrypto } from "@openid/appauth/built/node_support/";
import { NodeBasedHandler } from "@openid/appauth/built/node_support/node_request_handler.js";
import { net, type BrowserWindow } from "electron";
import * as keytar from "keytar";
import { backendConfig } from "./backend/config";
import { LogFileType, logger } from "./backend/logger";
import type { StoreData } from "./store";
import type { Store } from "./store";

// --- Constants ---
// Use the redirect URI that the NodeBasedHandler seems to be using (localhost:1112 based on logs)
const OAUTH_LISTEN_PORT = 1112; // Match the port seen in logs
const REDIRECT_URI = `http://localhost:${OAUTH_LISTEN_PORT}`; // Use localhost and the observed port
const KEYTAR_SERVICE = "radient-local-operator-oauth"; // Unique service name for keytar

// --- Provider Configurations ---
// Using OpenID Connect discovery endpoints
const GOOGLE_BASE_SCOPES = ["openid", "email", "profile"];
const GOOGLE_CONFIG = {
	discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
	clientId: backendConfig.VITE_GOOGLE_CLIENT_ID,
	clientSecret: backendConfig.VITE_GOOGLE_CLIENT_SECRET,
};

const MICROSOFT_CONFIG = {
	// Use common endpoint for multi-tenant apps or specify tenant ID
	discoveryUrl: `https://login.microsoftonline.com/${backendConfig.VITE_MICROSOFT_TENANT_ID}/v2.0/.well-known/openid-configuration`,
	clientId: backendConfig.VITE_MICROSOFT_CLIENT_ID,
	clientSecret: "",
	scope: "openid email profile offline_access", // offline_access is crucial for refresh tokens
};

type AuthProvider = "google" | "microsoft";

type OAuthStatus = {
	loggedIn: boolean;
	provider: AuthProvider | null;
	accessToken?: string;
	idToken?: string;
	refreshToken?: string; // Added for Google refresh token
	grantedScopes?: string[]; // To inform renderer about granted scopes
	expiry?: number;
	error?: string;
};

// --- NEW: ElectronNetRequestor ---
/**
 * Implements the AppAuth Requestor interface using Electron's net module.
 */
class ElectronNetRequestor implements Requestor {
	xhr<T>(settings: {
		url: string;
		method: "GET" | "POST";
		headers?: StringMap;
		data?: StringMap;
	}): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			logger.debug(
				`ElectronNetRequestor: Making ${settings.method} request to ${settings.url}`,
				LogFileType.OAUTH,
				{ data: settings.data, headers: settings.headers },
			);

			const request = net.request({
				method: settings.method,
				url: settings.url,
			});

			// Set headers
			if (settings.headers) {
				for (const key in settings.headers) {
					if (Object.prototype.hasOwnProperty.call(settings.headers, key)) {
						request.setHeader(key, settings.headers[key]);
					}
				}
			}
			// Ensure Content-Type for POST requests if data exists
			if (settings.method === "POST" && settings.data) {
				if (
					!request.getHeader("Content-Type")?.includes("application/json") &&
					!request
						.getHeader("Content-Type")
						?.includes("application/x-www-form-urlencoded")
				) {
					// Default to form-urlencoded as AppAuth typically uses this for token requests
					request.setHeader(
						"Content-Type",
						"application/x-www-form-urlencoded",
					);
				}
			}

			request.on("response", (response) => {
				let body = "";
				response.on("data", (chunk) => {
					body += chunk.toString();
				});
				response.on("end", () => {
					logger.debug(
						`ElectronNetRequestor: Received response from ${settings.url}`,
						LogFileType.OAUTH,
						{ statusCode: response.statusCode, body },
					);
					if (
						response.statusCode &&
						response.statusCode >= 200 &&
						response.statusCode < 300
					) {
						try {
							const json = JSON.parse(body);
							resolve(json as T);
						} catch (parseError) {
							logger.error(
								`ElectronNetRequestor: Failed to parse JSON response from ${settings.url}`,
								LogFileType.OAUTH,
								parseError,
							);
							reject(
								new Error(
									`Failed to parse JSON response: ${
										parseError instanceof Error
											? parseError.message
											: parseError
									}`,
								),
							);
						}
					} else {
						// AppAuth expects errors for non-2xx status codes
						logger.error(
							`ElectronNetRequestor: Request to ${settings.url} failed with status ${response.statusCode}`,
							LogFileType.OAUTH,
							{ body },
						);
						// Try to parse error details from body if possible, otherwise use status
						let errorDetails = `Status code ${response.statusCode}`;
						try {
							const errorJson = JSON.parse(body);
							errorDetails =
								errorJson.error_description ||
								errorJson.error ||
								JSON.stringify(errorJson);
						} catch {
							// Ignore parsing error, use status code
						}
						reject(
							new Error(
								`Request failed: ${errorDetails} (URL: ${settings.url})`,
							),
						);
					}
				});
				response.on("error", (error) => {
					logger.error(
						`ElectronNetRequestor: Error reading response stream from ${settings.url}`,
						LogFileType.OAUTH,
						error,
					);
					reject(
						new Error(
							`Network error reading response: ${error.message} (URL: ${settings.url})`,
						),
					);
				});
			});

			request.on("error", (error) => {
				logger.error(
					`ElectronNetRequestor: Request error for ${settings.url}`,
					LogFileType.OAUTH,
					error,
				);
				reject(
					new Error(
						`Network request error: ${error.message} (URL: ${settings.url})`,
					),
				);
			});

			// Write data for POST requests
			if (settings.method === "POST" && settings.data) {
				// AppAuth typically sends form-urlencoded data for token requests
				const formData = new URLSearchParams(settings.data).toString();
				request.write(formData);
			}

			request.end();
		});
	}
}
// --- End ElectronNetRequestor ---

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
	private currentGoogleScopes: string[];
	// Store the request used in the listener to retrieve the code_verifier
	private currentAuthorizationRequest: AuthorizationRequest | null = null;
	// private currentAuthorizationCodeVerifier: string | null = null; // No longer needed

	constructor(private readonly sessionStore: Store<StoreData>) {
		this.notifier = new AuthorizationNotifier();
		this.requestHandler = new NodeBasedHandler(OAUTH_LISTEN_PORT); // Use constant
		// Load stored Google scopes or default to base scopes
		const storedGoogleScopes = this.sessionStore.get("google_requested_scopes");

		if (
			storedGoogleScopes &&
			Array.isArray(storedGoogleScopes) &&
			storedGoogleScopes.length > 0
		) {
			this.currentGoogleScopes = storedGoogleScopes;

			// For backwards compatibility, remove "offline_access" from stored scopes if present
			if (storedGoogleScopes.includes("offline_access")) {
				this.currentGoogleScopes = storedGoogleScopes.filter(
					(scope) => scope !== "offline_access",
				);
			}
		} else {
			this.currentGoogleScopes = [...GOOGLE_BASE_SCOPES];
		}

		// *** Use the new ElectronNetRequestor for token handling ***
		this.tokenHandler = new BaseTokenRequestHandler(new ElectronNetRequestor());

		// Set listener for authorization requests
		this.requestHandler.setAuthorizationNotifier(this.notifier);
		// Correct the type annotation for 'res'
		this.notifier.setAuthorizationListener(
			async (req, res: AuthorizationResponse | null, err) => {
				logger.info(
					`Authorization listener triggered for ${this.currentAuthProvider}`,
					LogFileType.OAUTH,
				);
				if (err) {
					const errorMessage =
						err.errorDescription || err.error || "Unknown authorization error";
					logger.error(
						`Authorization Error: ${errorMessage}`,
						LogFileType.OAUTH,
						err,
					);
					this.sendErrorToRenderer(`Authorization failed: ${errorMessage}`);
					this.resetState();
					return;
				}

				// No need to cast 'res' anymore, use it directly
				if (res) {
					logger.info(
						`Authorization successful, received code: ${res.code}`,
						LogFileType.OAUTH,
					);
					// Store the request to potentially access internal state like code_verifier
					this.currentAuthorizationRequest = req;

					// Retrieve the code_verifier generated by the library
					let codeVerifier: string | undefined;
					// Check if internal details are available on the request object
					// Adjust based on actual AppAuth structure if needed
					// Apply optional chaining fix
					if (req.internal?.code_verifier) {
						codeVerifier = req.internal.code_verifier;
						logger.info(
							"Retrieved code_verifier from request internal state.",
							LogFileType.OAUTH,
						);
					} else {
						logger.error(
							"Authorization listener: Could not retrieve code_verifier from request internal state!",
							LogFileType.OAUTH,
						);
						this.sendErrorToRenderer(
							"Authorization failed: Missing internal security parameter (verifier).",
						);
						this.resetState();
						return;
					}

					// Pass both code and verifier to token request
					await this.performTokenRequest(res.code, codeVerifier);
				} else {
					logger.warn("Authorization response was null", LogFileType.OAUTH);
					this.sendErrorToRenderer(
						"Authorization response was unexpectedly null.",
					);
					this.resetState();
				}
			},
		);
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
	}

	/**
	 * Fetches and caches the authorization service configuration from the discovery URL.
	 * Uses Electron's net module for network requests.
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

		return new Promise((resolve) => {
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
							// Manually create the configuration object using AppAuth's constructor
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
							resolve(null);
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
						resolve(null);
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
					resolve(null);
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
				resolve(null);
			});

			request.end();
		});
	}

	/**
	 * Initiates the login flow for the specified provider.
	 * @param provider The authentication provider ('google' or 'microsoft').
	 * @param isScopeUpdateRequest Optional flag to indicate if this is a re-authentication for new scopes.
	 */
	public async initiateLogin(
		provider: AuthProvider,
		isScopeUpdateRequest = false,
	): Promise<void> {
		logger.info(
			`Initiating login with ${provider}${isScopeUpdateRequest ? " (scope update)" : ""}`,
			LogFileType.OAUTH,
		);
		// Don't reset currentGoogleScopes if it's a scope update request,
		// but do reset other auth state.
		const scopesToKeep =
			provider === "google" ? [...this.currentGoogleScopes] : [];
		this.resetState(); // Reset state before starting a new flow
		if (provider === "google") {
			this.currentGoogleScopes = scopesToKeep.length
				? scopesToKeep
				: [...GOOGLE_BASE_SCOPES];
		}
		this.currentAuthProvider = provider;

		// Fetch configuration
		this.configuration = await this.fetchServiceConfiguration(provider);
		if (!this.configuration) {
			// Error already sent by fetchServiceConfiguration
			return;
		}

		const config = provider === "google" ? GOOGLE_CONFIG : MICROSOFT_CONFIG;

		// --- Use Library PKCE Generation ---
		// Create authorization request, passing NodeCrypto to handle PKCE automatically
		const authRequest = new AuthorizationRequest(
			{
				client_id: config.clientId,
				redirect_uri: REDIRECT_URI,
				scope:
					provider === "google"
						? this.currentGoogleScopes.join(" ")
						: MICROSOFT_CONFIG.scope, // Explicitly use MICROSOFT_CONFIG.scope for Microsoft
				response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
				state: undefined, // Optional state parameter
				extras:
					provider === "google"
						? {
								prompt: "consent", // Always force consent for Google to maximize chance of refresh token
								access_type: "offline",
							}
						: {
								// For other providers like Microsoft
								prompt: "select_account",
								access_type: "offline", // Assuming MS also uses this for refresh tokens if applicable
							},
			},
			new NodeCrypto(), // Pass NodeCrypto instance here
			true, // Set to true to use PKCE (usually default, but explicit is fine)
		);
		logger.info(
			"Created AuthorizationRequest with NodeCrypto for PKCE.",
			LogFileType.OAUTH,
		);
		// --- End Library PKCE Generation ---

		// Store the request object itself; the listener will extract the verifier later
		this.currentAuthorizationRequest = authRequest;

		logger.info(
			`Performing authorization request for ${provider}`,
			LogFileType.OAUTH,
		);
		// Open the authorization URL in the system browser
		// NodeBasedHandler uses shell.openExternal internally
		this.requestHandler.performAuthorizationRequest(
			this.configuration,
			authRequest,
		);
	}

	/**
	 * Completes the authorization flow after the redirect from the provider.
	 * This method is less relevant with NodeBasedHandler as it handles the redirect listening.
	 * Kept for potential future use or clarity.
	 * @param url The full redirect URL received by the app (if handled manually).
	 */
	public async completeAuthorizationRequest(url: string): Promise<void> {
		// NodeBasedHandler automatically listens on the specified port and triggers
		// the notifier set in the constructor when the redirect URI is hit.
		// Therefore, an explicit call to complete the request based on a URL
		// passed from elsewhere (like a custom protocol handler) is generally not needed
		// when using NodeBasedHandler's built-in server.
		// Use simple string concatenation or just log the URL separately if needed
		logger.info(
			"completeAuthorizationRequest called. NodeBasedHandler manages completion via listener.",
			LogFileType.OAUTH,
			{ url }, // Log the URL as metadata if needed
		);

		// Basic checks remain useful for debugging if issues arise
		if (!this.currentAuthProvider) {
			logger.error(
				"Cannot complete authorization request: No provider context.",
				LogFileType.OAUTH,
			);
			// Avoid sending error here as the listener handles the primary flow
			return;
		}
		if (!this.currentAuthorizationRequest) {
			logger.error(
				"Cannot complete authorization request: No pending authorization request.",
				LogFileType.OAUTH,
			);
			return;
		}
	}

	/**
	 * Exchanges the authorization code for tokens using the configured token handler.
	 * @param code The authorization code received from the provider.
	 * @param codeVerifier The PKCE code verifier corresponding to the authorization request.
	 */
	private async performTokenRequest(
		code: string,
		codeVerifier: string,
	): Promise<void> {
		const grantType = GRANT_TYPE_AUTHORIZATION_CODE; // Define grant type locally
		// Change template literal to simple string
		logger.info(
			"Performing token request with code and verifier",
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

		// codeVerifier is now passed as an argument, no need to check this.currentAuthorizationCodeVerifier

		const config =
			this.currentAuthProvider === "google" ? GOOGLE_CONFIG : MICROSOFT_CONFIG;

		// Create token request including the code verifier
		const request = new TokenRequest({
			client_id: config.clientId,
			redirect_uri: REDIRECT_URI,
			grant_type: grantType, // Use local grantType
			code: code,
			extras: {
				code_verifier: codeVerifier, // Use the passed codeVerifier
				client_secret: config.clientSecret,
			},
		});

		try {
			logger.debug(
				`Making token request to ${this.configuration.tokenEndpoint} for ${this.currentAuthProvider}`,
				LogFileType.OAUTH,
			);

			// Use the tokenHandler (now with ElectronNetRequestor)
			const response: TokenResponse =
				await this.tokenHandler.performTokenRequest(
					this.configuration,
					request,
				);

			logger.debug(
				// More detailed log for the entire TokenResponse
				`Full TokenResponse received for ${this.currentAuthProvider}:`,
				LogFileType.OAUTH,
				{
					accessToken: response.accessToken ? "present" : "absent",
					idToken: response.idToken ? "present" : "absent",
					refreshToken: response.refreshToken
						? response.refreshToken
						: "ABSENT or UNDEFINED",
					expiresIn: response.expiresIn,
					scope: response.scope,
					issuedAt: response.issuedAt,
					tokenType: response.tokenType,
				},
			);

			logger.debug(
				// Kept original summary log as well for quick overview
				`Token request successful for ${this.currentAuthProvider}`,
				LogFileType.OAUTH,
				{
					accessToken: "...", // Truncated for brevity in this specific log
					idToken: "...", // Truncated
					refreshToken: response.refreshToken ? "present" : "absent",
					expiresIn: response.expiresIn,
				},
			);

			// Store tokens securely
			await this.storeTokens(
				this.currentAuthProvider,
				response.accessToken,
				response.idToken,
				response.refreshToken,
				response.expiresIn,
				grantType, // Pass grantType to storeTokens
			);

			// Send success status to renderer
			this.sendStatusToRenderer({
				loggedIn: true,
				provider: this.currentAuthProvider,
				accessToken: response.accessToken,
				idToken: response.idToken,
				refreshToken: response.refreshToken,
				grantedScopes:
					this.currentAuthProvider === "google"
						? [...this.currentGoogleScopes]
						: undefined, // Pass granted scopes for Google
				expiry: this.sessionStore.get("oauth_expiry"),
			});

			// Clear sensitive state after successful exchange
			// this.currentAuthorizationCodeVerifier = null; // No longer stored here
			this.currentAuthorizationRequest = null; // Clear the request object
		} catch (error) {
			// Log the detailed error from ElectronNetRequestor or AppAuth
			const errorMsg =
				error instanceof Error ? error.message : "Unknown token error";
			logger.error(
				`Token Request Error for ${this.currentAuthProvider}: ${errorMsg}`,
				LogFileType.OAUTH,
				error, // Log the full error object
			);
			// Extract a user-friendly message if possible
			let displayError = `Token exchange failed: ${errorMsg}`;
			if (error instanceof Error && error.message.includes("Request failed:")) {
				// Try to get the core message from ElectronNetRequestor's error
				displayError = error.message.substring(
					error.message.indexOf("Request failed:") + "Request failed:".length,
				);
				displayError = `Token exchange failed: ${displayError.split("(URL:")[0].trim()}`;
			}

			this.sendErrorToRenderer(displayError);
			// Clear potentially sensitive state on error
			await this.clearRefreshToken(this.currentAuthProvider); // Clear potential old token
			this.clearSessionTokens();
			this.resetState();
		}
	}

	/**
	 * Refreshes the access token using the stored refresh token.
	 */
	public async refreshAccessToken(): Promise<boolean> {
		const grantType = GRANT_TYPE_REFRESH_TOKEN; // Define grant type locally
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
				`Cannot refresh token: No refresh token found for ${provider}. Logging out.`,
				LogFileType.OAUTH,
			);
			await this.logout(); // Treat missing refresh token as needing logout
			return false;
		}

		// Ensure configuration is loaded for the stored provider
		// Use a separate variable to avoid overwriting login flow state if it's happening
		let refreshConfig = this.configuration;
		if (!refreshConfig || this.currentAuthProvider !== provider) {
			refreshConfig = await this.fetchServiceConfiguration(provider);
			if (!refreshConfig) {
				logger.error(
					`Cannot refresh token: Failed to fetch configuration for ${provider}.`,
					LogFileType.OAUTH,
				);
				this.sendErrorToRenderer(
					"Failed to refresh token: Could not fetch provider configuration.",
				);
				return false; // Don't logout, might be temporary network issue
			}
			// Don't set this.configuration or this.currentAuthProvider here,
			// keep the refresh operation isolated unless it succeeds.
		}

		const clientConfig =
			provider === "google" ? GOOGLE_CONFIG : MICROSOFT_CONFIG;

		const request = new TokenRequest({
			client_id: clientConfig.clientId,
			redirect_uri: REDIRECT_URI, // Still required by some providers even for refresh
			grant_type: grantType, // Use local grantType
			refresh_token: refreshToken,
			// No code_verifier needed for refresh token grant
		});

		try {
			logger.info(
				`Making refresh token request to ${refreshConfig.tokenEndpoint} for ${provider}`,
				LogFileType.OAUTH,
			);
			// Use the same tokenHandler (with ElectronNetRequestor)
			const response = await this.tokenHandler.performTokenRequest(
				refreshConfig,
				request,
			);

			logger.info(
				`Token refresh successful for ${provider}`,
				LogFileType.OAUTH,
			);

			// Update current provider context ONLY on successful refresh
			this.currentAuthProvider = provider;
			this.configuration = refreshConfig;

			// Store the new tokens (response might include a new refresh token)
			await this.storeTokens(
				provider,
				response.accessToken,
				response.idToken, // May or may not be present in refresh response
				response.refreshToken, // Store the new refresh token if provided
				response.expiresIn,
				grantType, // Pass grantType to storeTokens
			);

			// Notify renderer of the updated status
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

			// If refresh token is invalid/expired (often 'invalid_grant'), logout user
			if (
				errorMsg.includes("invalid_grant") ||
				(error instanceof Error && error.message.includes("invalid_grant"))
			) {
				logger.warn(
					`Refresh token invalid or expired for ${provider}. Logging out.`,
					LogFileType.OAUTH,
				);
				await this.logout(); // Logout clears state and notifies renderer
			} else {
				// For other errors (e.g., network), just notify the renderer
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
		logger.debug("Attempting to get access token", LogFileType.OAUTH);

		const expiry = this.sessionStore.get("oauth_expiry");
		const accessToken = this.sessionStore.get("oauth_access_token");
		const provider = this.sessionStore.get("oauth_provider");

		// Check if we have a token and provider
		if (!accessToken || !provider) {
			logger.debug(
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
				// This case should ideally not happen if refreshAccessToken resolves true
				logger.error(
					"Refresh seemed successful, but no new access token found in store.",
					LogFileType.OAUTH,
				);
				return null;
			}
			// Refresh failed (logout might have been triggered internally by refreshAccessToken)
			logger.warn("Access token refresh failed.", LogFileType.OAUTH);
			return null;
		}

		// Token is valid
		logger.debug(
			"Returning valid access token from session.",
			LogFileType.OAUTH,
		);
		return accessToken;
	}

	/**
	 * Retrieves the current OAuth status (logged in state, tokens).
	 * Does not attempt refresh; reflects the stored state.
	 * @returns The current OAuthStatus based on stored data.
	 */
	public async getStatus(): Promise<OAuthStatus> {
		logger.info("Getting current OAuth status from store", LogFileType.OAUTH);

		const provider = this.sessionStore.get("oauth_provider");
		const accessToken = this.sessionStore.get("oauth_access_token");
		const idToken = this.sessionStore.get("oauth_id_token"); // Also get idToken
		const expiry = this.sessionStore.get("oauth_expiry");
		let grantedScopes: string[] | undefined;
		if (provider === "google") {
			const storedScopes = this.sessionStore.get("google_requested_scopes");
			if (Array.isArray(storedScopes)) {
				grantedScopes = storedScopes;
			} else {
				grantedScopes = [...GOOGLE_BASE_SCOPES];
			}
		}

		if (!provider || !accessToken || !expiry) {
			logger.info("No valid session found in store.", LogFileType.OAUTH);
			return { loggedIn: false, provider: null };
		}

		// Check expiry purely based on stored value (use same buffer for consistency)
		const bufferSeconds = 60;
		const isExpired = Date.now() >= expiry - bufferSeconds * 1000;

		if (isExpired) {
			logger.info(
				`Stored session for ${provider} found, but token is expired.`,
				LogFileType.OAUTH,
			);
			// Report as logged out if expired, let getAccessToken handle refresh attempt
			return { loggedIn: false, provider: provider, error: "Token expired" };
		}

		logger.info(`Valid session found for ${provider}.`, LogFileType.OAUTH);
		return {
			loggedIn: true,
			provider: provider,
			accessToken: accessToken, // Return tokens for renderer to use if needed
			idToken: idToken || undefined,
			grantedScopes: grantedScopes,
			expiry: expiry,
		};
	}

	/**
	 * Initiates a new Google login flow to request additional scopes.
	 * @param additionalScopes An array of additional scopes to request.
	 */
	public async requestAdditionalGoogleScopes(
		additionalScopes: string[],
	): Promise<void> {
		if (
			this.currentAuthProvider !== "google" &&
			this.sessionStore.get("oauth_provider") !== "google"
		) {
			logger.warn(
				"requestAdditionalGoogleScopes called but current provider is not Google.",
				LogFileType.OAUTH,
			);
			this.sendErrorToRenderer(
				"Cannot request Google scopes: Not signed in with Google.",
			);
			return;
		}
		this.currentAuthProvider = "google"; // Ensure it's set if re-initiating

		logger.info(
			"Requesting additional Google scopes:",
			LogFileType.OAUTH,
			additionalScopes,
		);

		const newScopeSet = new Set([
			...this.currentGoogleScopes,
			...additionalScopes,
		]);
		this.currentGoogleScopes = Array.from(newScopeSet);

		// Persist the new set of scopes
		this.sessionStore.set("google_requested_scopes", this.currentGoogleScopes);
		logger.debug(
			"Updated currentGoogleScopes:",
			LogFileType.OAUTH,
			this.currentGoogleScopes,
		);

		// Re-initiate login with 'consent' prompt
		await this.initiateLogin("google", true);
	}

	// --- Helper methods for token storage ---

	private async storeTokens(
		provider: AuthProvider,
		accessToken: string,
		idToken: string | undefined,
		refreshToken: string | undefined,
		expiresIn: number | undefined,
		grantType: string, // Add grantType parameter
	): Promise<void> {
		// Calculate expiry time (use a default of 1 hour if not provided)
		const expiryTime = expiresIn
			? Date.now() + expiresIn * 1000
			: Date.now() + 3600 * 1000; // Default to 1 hour if not provided

		logger.debug(
			`Storing tokens for ${provider}. Expiry in ${expiresIn}s (Calculated: ${new Date(expiryTime).toISOString()})`,
			LogFileType.OAUTH,
		);

		this.sessionStore.set("oauth_provider", provider);
		this.sessionStore.set("oauth_access_token", accessToken);
		this.sessionStore.set("oauth_id_token", idToken || ""); // Store empty string if undefined
		this.sessionStore.set("oauth_expiry", expiryTime);

		if (refreshToken) {
			try {
				// Revert back to template literal for keytar key
				await keytar.setPassword(
					KEYTAR_SERVICE,
					`${provider}-refresh-token`,
					refreshToken,
				);
				logger.info(
					`Stored/Updated refresh token for ${provider} securely.`,
					LogFileType.OAUTH,
				);
			} catch (error) {
				logger.error(
					`Failed to store refresh token for ${provider}:`,
					LogFileType.OAUTH,
					error,
				);
				// Consider if this is critical. Maybe notify user?
				this.sendErrorToRenderer(
					"Warning: Could not securely save refresh token.",
				);
			}
		} else {
			// If no refresh token is provided in the response (e.g., during refresh),
			// *do not* clear the existing one unless the grant type was authorization_code
			// and the provider simply didn't issue one.
			// However, if a refresh token *was* expected but not received, log it.
			// Use the passed grantType for the check
			if (grantType === GRANT_TYPE_AUTHORIZATION_CODE) {
				logger.warn(
					`No refresh token received from ${provider} during initial code exchange. Subsequent logins may be required.`,
					LogFileType.OAUTH,
				);
				// Ensure any old one is cleared in this specific case
				await this.clearRefreshToken(provider);
			} else {
				logger.debug(
					`No new refresh token received from ${provider} (expected during refresh sometimes). Keeping existing one if present.`,
					LogFileType.OAUTH,
				);
			}
		}
	}

	private async getRefreshToken(
		provider: AuthProvider,
	): Promise<string | null> {
		try {
			// Revert back to template literal for keytar key
			const token = await keytar.getPassword(
				KEYTAR_SERVICE,
				`${provider}-refresh-token`,
			);
			if (token) {
				logger.debug(
					`Retrieved refresh token for ${provider}.`,
					LogFileType.OAUTH,
				);
			} else {
				logger.warn(
					`No refresh token found in secure storage for ${provider}.`,
					LogFileType.OAUTH,
				);
			}
			return token;
		} catch (error) {
			// Log error but don't necessarily fail the logout
			logger.error(
				`Failed to retrieve refresh token for ${provider} from secure storage:`,
				LogFileType.OAUTH,
				error,
			);
			return null; // Indicate failure to retrieve
		}
	}

	private async clearRefreshToken(provider: AuthProvider): Promise<void> {
		try {
			// Revert back to template literal for keytar key
			const deleted = await keytar.deletePassword(
				KEYTAR_SERVICE,
				`${provider}-refresh-token`,
			);
			if (deleted) {
				logger.info(
					`Cleared refresh token for ${provider} from secure storage.`,
					LogFileType.OAUTH,
				);
			} else {
				logger.warn(
					`Attempted to clear refresh token for ${provider}, but none was found.`,
					LogFileType.OAUTH,
				);
			}
		} catch (error) {
			// Log error but don't necessarily fail the logout
			logger.error(
				`Failed to clear refresh token for ${provider} from secure storage:`,
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
		// Note: google_requested_scopes is cleared in the logout method
		// to ensure it's only cleared when logging out from Google.
		logger.info("Cleared OAuth tokens from session store.", LogFileType.OAUTH);
	}

	/**
	 * Logs the user out, clearing stored tokens and resetting state.
	 */
	public async logout(): Promise<void> {
		logger.info("Initiating logout process", LogFileType.OAUTH);

		const currentProvider = this.sessionStore.get("oauth_provider");

		if (currentProvider) {
			logger.info(
				`Clearing refresh token for ${currentProvider}`,
				LogFileType.OAUTH,
			);
			await this.clearRefreshToken(currentProvider);
			// Clear Google-specific scopes if the provider was Google
			if (currentProvider === "google") {
				this.sessionStore.delete("google_requested_scopes");
				this.currentGoogleScopes = [...GOOGLE_BASE_SCOPES]; // Reset to defaults
				logger.info("Cleared stored Google scopes.", LogFileType.OAUTH);
			}
		} else {
			logger.warn(
				"No provider found in session during logout, attempting to clear all known providers.",
				LogFileType.OAUTH,
			);
			// Attempt to clear for both just in case state is inconsistent
			await this.clearRefreshToken("google");
			await this.clearRefreshToken("microsoft");
			// Also clear Google scopes as a fallback
			this.sessionStore.delete("google_requested_scopes");
			this.currentGoogleScopes = [...GOOGLE_BASE_SCOPES];
			logger.info(
				"Cleared stored Google scopes as part of general cleanup.",
				LogFileType.OAUTH,
			);
		}

		logger.info("Clearing session tokens", LogFileType.OAUTH);
		this.clearSessionTokens(); // This will now only clear generic tokens

		logger.info("Resetting OAuth service state", LogFileType.OAUTH);
		this.resetState();

		logger.info("Sending logged out status to renderer", LogFileType.OAUTH);
		this.sendStatusToRenderer({ loggedIn: false, provider: null });
	}
}
