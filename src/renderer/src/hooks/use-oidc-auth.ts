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
 * - Handles loading, error, and success states
 *
 * Usage:
 *   const { signInWithGoogle, signInWithMicrosoft, loading, error } = useOidcAuth();
 */

import { useState, useCallback } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import type { AuthenticationResult } from "@azure/msal-browser";
import { CredentialsApi } from "../api/local-operator/credentials-api";
import { apiConfig } from "../config";
import { showSuccessToast, showErrorToast } from "../utils/toast-manager";
import { storeSession } from "../utils/session-store";
import { jwtDecode } from "jwt-decode";
import { useMsalInstance } from "../providers/auth";
import { createRadientClient } from "../api/radient";
import { useQueryClient } from "@tanstack/react-query";
import { radientUserKeys } from "./use-radient-user-query";

type UseOidcAuthResult = {
	signInWithGoogle: () => void;
	signInWithMicrosoft: () => void;
	loading: boolean;
	error: string | null;
};

// Microsoft authentication scopes
const MICROSOFT_SCOPES = ["openid", "profile", "email"];

// Create a Radient API client
const radientClient = createRadientClient(apiConfig.radientBaseUrl);

/**
 * Main hook for OIDC authentication.
 */
export const useOidcAuth = (): UseOidcAuthResult => {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const queryClient = useQueryClient();

	// Try to get the MSAL instance at the top level of the hook
	// If it fails, we'll handle Microsoft sign-in gracefully
	let msalInstance: ReturnType<typeof useMsalInstance> | null = null;
	try {
		msalInstance = useMsalInstance();
	} catch (err) {
		// We'll handle this in signInWithMicrosoft
		console.debug(
			"MSAL instance not available, Microsoft sign-in will show an error when used",
		);
	}

	/**
	 * Handles the full backend integration after obtaining tokens.
	 */
	const handleBackendAuth = useCallback(
		async (
			provider: "google" | "microsoft",
			tokens: { idToken?: string; accessToken?: string },
		) => {
			setLoading(true);
			setError(null);
			try {
				// 1. Exchange tokens for backend JWT
				const tokenResponse =
					provider === "google"
						? await radientClient.exchangeGoogleToken(tokens)
						: await radientClient.exchangeMicrosoftToken(tokens);

				const backendJwt = tokenResponse.result.token;

				// Persist the backend JWT for session restoration (30 days)
				await storeSession(backendJwt);

				// 2. Decode JWT to get account ID (sub claim)
				let accountId: string;
				try {
					const decodedToken = jwtDecode<{ sub: string }>(backendJwt);
					if (!decodedToken || !decodedToken.sub) {
						throw new Error("Invalid JWT: Missing 'sub' claim.");
					}
					accountId = decodedToken.sub;
				} catch (decodeError) {
					setError("Failed to decode JWT. Please sign in again.");
					showErrorToast("Failed to decode JWT.");
					setLoading(false);
					return;
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
				}

				// Only create a new API key if one doesn't exist
				if (!apiKeyExists) {
					// Create an application to get an API key
					const appResponse = await radientClient.createApplication(
						accountId,
						backendJwt,
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

					showSuccessToast("Sign-in successful and new API key stored.");
				} else {
					showSuccessToast("Sign-in successful. Using existing API key.");
				}

				// Invalidate the React Query cache to trigger a refetch of the user information
				queryClient.invalidateQueries({ queryKey: radientUserKeys.all });

				setLoading(false);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				setError(msg || "Authentication failed");
				showErrorToast(msg || "Authentication failed");
				setLoading(false);
			}
		},
		[queryClient],
	);

	/**
	 * Google sign-in handler.
	 */
	const signInWithGoogle = useGoogleLogin({
		onSuccess: async (tokenResponse: Record<string, unknown>) => {
			try {
				// Try to get id_token or credential property
				let idToken: string | undefined;
				let accessToken: string | undefined;

				// First check for id_token in the response
				if (typeof tokenResponse.id_token === "string") {
					idToken = tokenResponse.id_token;
				}

				// Then check for access_token
				if (typeof tokenResponse.access_token === "string") {
					accessToken = tokenResponse.access_token;
				}

				await handleBackendAuth("google", {
					idToken,
					accessToken,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				setError(msg);
				showErrorToast(msg);
				setLoading(false);
			}
		},
		onError: (error) => {
			console.error("Google sign-in error:", error);
			setError("Google sign-in failed");
			showErrorToast("Google sign-in failed");
			setLoading(false);
		},
		flow: "implicit", // Use implicit flow to get ID token directly
		scope: "openid email profile",
	});

	/**
	 * Microsoft sign-in handler.
	 *
	 * Note: This hook must be used within a component tree wrapped by MicrosoftAuthProvider.
	 * If the provider is missing, sign-in will not work and a clear error will be shown.
	 */
	const signInWithMicrosoft = useCallback(async () => {
		if (!msalInstance) {
			const errorMsg =
				"Microsoft sign-in is not configured. Ensure MicrosoftAuthProvider is present in the component tree.";
			setError(errorMsg);
			showErrorToast(errorMsg);
			return;
		}

		setLoading(true);
		setError(null);
		try {
			// Ensure the instance is initialized before calling loginPopup
			const loginResponse: AuthenticationResult = await msalInstance.loginPopup(
				{
					scopes: MICROSOFT_SCOPES,
				},
			);

			console.log("Microsoft login response:", loginResponse);
			if (!loginResponse.idToken && !loginResponse.accessToken) {
				throw new Error("No ID token or access token received from Microsoft");
			}
			await handleBackendAuth("microsoft", {
				idToken: loginResponse.idToken,
				accessToken: loginResponse.accessToken,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setError(msg || "Microsoft sign-in failed");
			showErrorToast(msg || "Microsoft sign-in failed");
			setLoading(false);
		}
	}, [handleBackendAuth, msalInstance]);

	return {
		signInWithGoogle,
		signInWithMicrosoft,
		loading,
		error,
	};
};
