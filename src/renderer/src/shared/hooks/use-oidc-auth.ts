/**
 * @file use-oidc-auth.ts
 * @description
 * React hook for handling Google and Microsoft OAuth/OIDC authentication flows,
 * exchanging ID tokens for backend JWTs, validating sessions, provisioning accounts,
 * and securely storing the RADIENT_API_KEY.
 *
 * - Uses @react-oauth/google for Google sign-in
 * - Uses @azure/msal-browser for Microsoft sign-in
 * - Handles all backend integration as per PRD
 * - Never stores sensitive tokens in localStorage/sessionStorage
 * - Uses main process via IPC for native OAuth flow.
 * - Handles all backend integration as per PRD.
 * - Never stores sensitive tokens in localStorage/sessionStorage.
 * - Handles loading, error, and success states.
 *
 * Usage:
 *   const { signInWithGoogle, signInWithMicrosoft, loading, error, status } = useOidcAuth();
 */

import { apiConfig } from "@shared/config";
import { useQueryClient } from "@tanstack/react-query";
import { jwtDecode } from "jwt-decode";
import { useCallback, useEffect, useState } from "react";
import { CredentialsApi } from "../api/local-operator/credentials-api";
import { createRadientClient } from "../api/radient";
import { storeSession } from "../utils/session-store";
import { showErrorToast, showSuccessToast } from "../utils/toast-manager";
import { radientUserKeys } from "./use-radient-user-query";
import { useUpdateConfig } from "./use-update-config";

type AuthProvider = "google" | "microsoft";

// Type matching the status object sent from the main process via preload
type OAuthStatus = {
	loggedIn: boolean;
	provider: AuthProvider | null;
	accessToken?: string;
	idToken?: string;
	refreshToken?: string; // Added to match main process
	expiry?: number;
	error?: string;
};

type UseOidcAuthResult = {
	signInWithGoogle: () => void;
	signInWithMicrosoft: () => void;
	logout: () => void;
	loading: boolean;
	error: string | null;
	status: OAuthStatus;
};

/**
 * Options for the useOidcAuth hook.
 */
type UseOidcAuthOptions = {
	/**
	 * Callback function to be invoked after successful authentication
	 * and backend provisioning.
	 */
	onSuccess?: () => void;
	/**
	 * Callback function to be invoked after the RADIENT_API_KEY is set/updated.
	 * Use this to force a model refresh after Radient sign-in.
	 */
	onAfterCredentialUpdate?: () => void;
};

// Create a Radient API client
const radientClient = createRadientClient(
	apiConfig.radientBaseUrl,
	apiConfig.radientClientId,
);

const GOOGLE_ACCESS_TOKEN_KEY = "GOOGLE_ACCESS_TOKEN";
const GOOGLE_REFRESH_TOKEN_KEY = "GOOGLE_REFRESH_TOKEN";
const GOOGLE_TOKEN_EXPIRY_TIMESTAMP_KEY = "GOOGLE_TOKEN_EXPIRY_TIMESTAMP";

/**
 * Main hook for OIDC authentication via main process native flow.
 */
export const useOidcAuth = (
	options?: UseOidcAuthOptions,
): UseOidcAuthResult => {
	const { onSuccess, onAfterCredentialUpdate } = options || {};
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<OAuthStatus>({
		loggedIn: false,
		provider: null,
	});
	const queryClient = useQueryClient();
	const { mutateAsync: updateConfig } = useUpdateConfig();

	/**
	 * Handles the full backend integration after obtaining tokens from the main process.
	 */
	const handleBackendAuth = useCallback(
		async (
			provider: AuthProvider,
			idToken: string,
			googleAccessToken?: string,
			googleTokenExpiry?: number,
			googleRefreshToken?: string,
		) => {
			// No need to set loading here, it's handled by the main flow
			setError(null); // Clear previous errors

			try {
				// Store Google-specific tokens if provider is Google
				// This is done before Radient exchange to ensure these are saved even if Radient flow fails
				if (provider === "google") {
					try {
						if (googleAccessToken) {
							await CredentialsApi.updateCredential(apiConfig.baseUrl, {
								key: GOOGLE_ACCESS_TOKEN_KEY,
								value: googleAccessToken,
							});
						}
						if (googleRefreshToken) {
							await CredentialsApi.updateCredential(apiConfig.baseUrl, {
								key: GOOGLE_REFRESH_TOKEN_KEY,
								value: googleRefreshToken,
							});
						}
						if (googleTokenExpiry !== undefined) {
							await CredentialsApi.updateCredential(apiConfig.baseUrl, {
								key: GOOGLE_TOKEN_EXPIRY_TIMESTAMP_KEY,
								value: String(googleTokenExpiry),
							});
						}
					} catch (credError) {
						console.error(
							"Failed to store Google OAuth specific credentials:",
							credError,
						);
						showErrorToast("Failed to store Google credentials.");
					}
				}

				// 1. Exchange ID token for backend tokens
				// We only need the ID token for the backend exchange now
				const tokenPayload = { idToken };
				const authResponse =
					provider === "google"
						? await radientClient.exchangeGoogleToken(tokenPayload)
						: await radientClient.exchangeMicrosoftToken(tokenPayload);

				// Extract the token response from the provider auth response
				const tokenResponse = authResponse.result.token_response;

				// Persist the tokens using the existing utility
				await storeSession(
					tokenResponse.access_token,
					tokenResponse.refresh_token,
					tokenResponse.expires_in,
				);

				// 2. Decode access token to get account ID (sub claim)
				let tenantId: string;
				try {
					const decodedToken = jwtDecode<{ tenant_id: string }>(
						tokenResponse.access_token,
					);
					if (!decodedToken || !decodedToken.tenant_id) {
						throw new Error("Invalid access token: Missing 'tenant_id' claim.");
					}
					tenantId = decodedToken.tenant_id;
				} catch (decodeError) {
					console.error("JWT Decode Error:", decodeError);
					setError("Failed to decode access token. Please sign in again.");
					showErrorToast("Failed to decode access token.");
					// Don't set loading false here, let the main flow handle it
					return; // Stop execution here
				}

				// 3. Check if RADIENT_API_KEY already exists
				let apiKeyExists = false;
				try {
					const credentialsResponse = await CredentialsApi.listCredentials(
						apiConfig.baseUrl,
					);
					if (credentialsResponse.result?.keys) {
						apiKeyExists =
							credentialsResponse.result.keys.includes("RADIENT_API_KEY");
					}
				} catch (credentialsError) {
					console.error(
						"Failed to check existing credentials:",
						credentialsError,
					);
					// Continue with the flow even if we couldn't check credentials
					console.warn("Proceeding without checking existing API key.");
				}

				// Only create a new API key if one doesn't exist
				if (!apiKeyExists) {
					// Create an application to get an API key
					const appResponse = await radientClient.createApplication(
						tenantId,
						tokenResponse.access_token,
						{
							name: "Local Operator UI",
							description: "Application created for Local Operator UI",
						},
					);

					if (!appResponse.result.api_key) {
						throw new Error("Application creation failed: No API key returned");
					}

					// Store API key securely
					await CredentialsApi.updateCredential(apiConfig.baseUrl, {
						key: "RADIENT_API_KEY",
						value: appResponse.result.api_key,
					});

					// Call after-credential-update callback if provided (for model refresh)
					if (onAfterCredentialUpdate) {
						try {
							onAfterCredentialUpdate();
						} catch (err) {
							console.error("Error in onAfterCredentialUpdate callback:", err);
						}
					}

					// Attempt to set Radient as the default hosting provider and model
					try {
						await updateConfig({
							hosting: "radient",
							model_name: "auto",
						});
						// Success toast is handled by useUpdateConfig hook
					} catch (configError) {
						console.error(
							"Failed to update config after provisioning API key:",
							configError,
						);
						showErrorToast(
							"Sign-in successful, but failed to set Radient hosting automatically.",
						);
						// Continue even if config update fails
					}
				} else {
					showSuccessToast("Sign-in successful. Using existing API key.");
				}

				// Invalidate the React Query cache to trigger a refetch of the user information
				queryClient.invalidateQueries({ queryKey: radientUserKeys.all });

				// --- Success ---
				// Call the onSuccess callback if provided
				if (onSuccess) {
					onSuccess();
				}
				// Let the main flow handle setting loading to false.
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error("Error during backend authentication:", err);
				setError(msg || "Authentication failed during backend processing.");
				showErrorToast(msg || "Authentication failed");
				// Let the main flow handle setting loading to false.
			}
		},
		[queryClient, updateConfig, onSuccess, onAfterCredentialUpdate],
	);

	/**
	 * Initiates Google sign-in via the main process.
	 */
	const signInWithGoogle = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await window.api.oauth.login("google");
			if (!result.success) {
				throw new Error(result.error || "Failed to initiate Google login");
			}
			// Status update will be handled by the listener effect
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("Error initiating Google sign-in:", msg);
			setError(msg);
			showErrorToast(msg);
			setLoading(false); // Set loading false only if initiation fails
		}
	}, []);

	/**
	 * Initiates Microsoft sign-in via the main process.
	 */
	const signInWithMicrosoft = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await window.api.oauth.login("microsoft");
			if (!result.success) {
				throw new Error(result.error || "Failed to initiate Microsoft login");
			}
			// Status update will be handled by the listener effect
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("Error initiating Microsoft sign-in:", msg);
			setError(msg);
			showErrorToast(msg);
			setLoading(false); // Set loading false only if initiation fails
		}
	}, []);

	/**
	 * Initiates logout via the main process.
	 */
	const logout = useCallback(async () => {
		setLoading(true); // Indicate activity during logout
		setError(null);
		try {
			const result = await window.api.oauth.logout();
			if (!result.success) {
				throw new Error(result.error || "Logout failed");
			}
			// Clear local session JWT as well
			await window.api.session.clearSession();
			// Invalidate user queries
			queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
			showSuccessToast("Successfully signed out.");
			// Status update (loggedIn: false) will be handled by the listener effect
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error("Error during logout:", msg);
			setError(msg);
			showErrorToast(msg);
			setLoading(false); // Ensure loading is false even on error
		}
	}, [queryClient]);

	// Effect to listen for status updates from the main process
	useEffect(() => {
		const cleanup = window.api.oauth.onStatusUpdate((newStatus) => {
			setStatus(newStatus);
			setLoading(false); // Update finished

			if (newStatus.error) {
				setError(newStatus.error);
				showErrorToast(`Authentication Error: ${newStatus.error}`);
			} else {
				setError(null); // Clear previous errors on success
			}

			// If login was successful and we have an ID token, trigger backend exchange
			if (newStatus.loggedIn && newStatus.provider && newStatus.idToken) {
				// Call handleBackendAuth asynchronously, don't await here
				handleBackendAuth(
					newStatus.provider,
					newStatus.idToken,
					newStatus.accessToken,
					newStatus.expiry,
					newStatus.refreshToken,
				);
			} else if (newStatus.loggedIn && !newStatus.idToken) {
				console.warn(
					"Logged in status received, but no ID token provided for backend exchange.",
				);
			}
		});

		// Cleanup function to remove the listener when the component unmounts
		return () => {
			cleanup();
		};
	}, [handleBackendAuth]); // Include handleBackendAuth in dependency array

	// Effect to check initial status on mount
	useEffect(() => {
		const checkInitialStatus = async () => {
			setLoading(true);
			try {
				const response = await window.api.oauth.getStatus();
				if (response.success && response.status) {
					console.debug("Initial status received:", {
						...response.status,
						accessToken: "...",
						idToken: "...",
					});
					setStatus(response.status);
					if (response.status.error) {
						setError(response.status.error);
						// Don't show toast for initial expired token error, it's expected
						if (response.status.error !== "Token expired") {
							showErrorToast(`Initial Auth Error: ${response.status.error}`);
						}
					}
				} else {
					console.error("Failed to get initial status:", response.error);
					setError(response.error || "Failed to get initial status");
					showErrorToast(response.error || "Failed to get initial status");
					setStatus({ loggedIn: false, provider: null }); // Ensure logged out state
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error("Error checking initial status:", msg);
				setError(msg);
				showErrorToast(msg);
				setStatus({ loggedIn: false, provider: null }); // Ensure logged out state
			} finally {
				setLoading(false);
			}
		};

		checkInitialStatus();
	}, []); // Run only on mount

	return {
		signInWithGoogle,
		signInWithMicrosoft,
		logout,
		loading,
		error,
		status,
	};
};
