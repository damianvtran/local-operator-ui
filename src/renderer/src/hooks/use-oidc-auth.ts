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
import { useMsalInstance } from "../providers/auth";
import { createRadientClient } from "../api/radient";
import type { RadientApiResponse, UserInfoResult } from "../api/radient/types";

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

				// 2. Call /me to check session/account status
				let meResponse: RadientApiResponse<UserInfoResult> | null = null;
				try {
					meResponse = await radientClient.getUserInfo(backendJwt);
				} catch (meErr) {
					const msg = meErr instanceof Error ? meErr.message : String(meErr);

					if (
						msg.includes("expired") ||
						msg.includes("invalid") ||
						msg.includes("not logged in")
					) {
						setError("Session expired or invalid. Please sign in again.");
						setLoading(false);
						return;
					}
					if (msg.includes("not found") || msg.includes("404")) {
						// No account provisioned, proceed to provision
						meResponse = null;
					} else {
						setError(`Failed to validate session: ${msg}`);
						setLoading(false);
						return;
					}
				}

				// 3. If no account, call /provision and store API key
				if (!meResponse) {
					const provisionRes = await radientClient.provisionAccount(backendJwt);
					if (!provisionRes.result.api_key) {
						throw new Error("Provisioning failed: No API key returned");
					}
					// Store API key securely
					await CredentialsApi.updateCredential(apiConfig.baseUrl, {
						key: "RADIENT_API_KEY",
						value: provisionRes.result.api_key,
					});
					showSuccessToast("Account provisioned and API key stored.");
				} else {
					// Account exists, proceed
					showSuccessToast("Sign-in successful.");
				}
				setLoading(false);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				setError(msg || "Authentication failed");
				showErrorToast(msg || "Authentication failed");
				setLoading(false);
			}
		},
		[],
	);

	/**
	 * Google sign-in handler.
	 */
	const signInWithGoogle = useGoogleLogin({
		onSuccess: async (tokenResponse: Record<string, unknown>) => {
			try {
				// Log the token response for debugging
				console.log("Google token response:", tokenResponse);

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
	 */
	const signInWithMicrosoft = useCallback(async () => {
		// Get the MSAL instance from the context or create a new one
		const msalInstance = useMsalInstance();

		if (!msalInstance) {
			setError("Microsoft sign-in is not configured.");
			showErrorToast("Microsoft sign-in is not configured.");
			return;
		}

		setLoading(true);
		setError(null);
		try {
			const loginResponse: AuthenticationResult = await msalInstance.loginPopup(
				{
					scopes: MICROSOFT_SCOPES,
				},
			);
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
	}, [handleBackendAuth]);

	return {
		signInWithGoogle,
		signInWithMicrosoft,
		loading,
		error,
	};
};
