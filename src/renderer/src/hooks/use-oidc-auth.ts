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
import {
	PublicClientApplication,
	type AuthenticationResult,
} from "@azure/msal-browser";
import { CredentialsApi } from "../api/local-operator/credentials-api";
import { apiConfig } from "../config";
import { showSuccessToast, showErrorToast } from "../utils/toast-manager";
import { storeSession } from "../utils/session-store";

type AuthProvider = "google" | "microsoft";

type UseOidcAuthResult = {
	signInWithGoogle: () => void;
	signInWithMicrosoft: () => void;
	loading: boolean;
	error: string | null;
};

const GOOGLE_AUTH_ENDPOINT = "/auth/google";
const MICROSOFT_AUTH_ENDPOINT = "/auth/microsoft";
const ME_ENDPOINT = "/me";
const PROVISION_ENDPOINT = "/provision";
const RADIENT_BASE_URL = apiConfig.radientBaseUrl;

const MICROSOFT_SCOPES = ["openid", "profile", "email"];
const MICROSOFT_CLIENT_ID = import.meta.env.VITE_MICROSOFT_CLIENT_ID || "";
const MICROSOFT_TENANT_ID = import.meta.env.VITE_MICROSOFT_TENANT_ID || "";
const MICROSOFT_AUTHORITY =
	MICROSOFT_CLIENT_ID && MICROSOFT_TENANT_ID
		? `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}`
		: "";

const msalInstance =
	MICROSOFT_CLIENT_ID && MICROSOFT_TENANT_ID
		? new PublicClientApplication({
				auth: {
					clientId: MICROSOFT_CLIENT_ID,
					authority: MICROSOFT_AUTHORITY,
					redirectUri: window.location.origin,
				},
				cache: {
					cacheLocation: "memoryStorage",
					storeAuthStateInCookie: false,
				},
			})
		: undefined;

/**
 * Securely POSTs to a backend endpoint with JSON and returns the response.
 */
async function postJson<T>(
	url: string,
	body: unknown,
	jwt?: string,
): Promise<T> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (jwt) {
		headers.Authorization = `Bearer ${jwt}`;
	}
	const res = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		credentials: "same-origin",
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || `HTTP ${res.status}`);
	}
	return res.json();
}

/**
 * Securely GETs from a backend endpoint and returns the response.
 */
async function getJson<T>(url: string, jwt: string): Promise<T> {
	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${jwt}`,
		},
		credentials: "same-origin",
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || `HTTP ${res.status}`);
	}
	return res.json();
}

/**
 * Main hook for OIDC authentication.
 */
export const useOidcAuth = (): UseOidcAuthResult => {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/**
	 * Handles the full backend integration after obtaining an ID token.
	 */
	const handleBackendAuth = useCallback(
		async (provider: AuthProvider, idToken: string) => {
			setLoading(true);
			setError(null);
			try {
				// 1. Exchange ID token for backend JWT
				const authEndpoint =
					provider === "google"
						? `${RADIENT_BASE_URL}${GOOGLE_AUTH_ENDPOINT}`
						: `${RADIENT_BASE_URL}${MICROSOFT_AUTH_ENDPOINT}`;
				const { token: backendJwt } = await postJson<{ token: string }>(
					authEndpoint,
					{ id_token: idToken },
				);
				// Persist the backend JWT for session restoration (30 days)
				await storeSession(backendJwt);

				// 2. Call /me to check session/account status
				let meResponse: unknown;
				try {
					meResponse = await getJson(
						`${RADIENT_BASE_URL}${ME_ENDPOINT}`,
						backendJwt,
					);
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
					const provisionRes = await postJson<{ api_key: string }>(
						`${RADIENT_BASE_URL}${PROVISION_ENDPOINT}`,
						{},
						backendJwt,
					);
					if (!provisionRes.api_key) {
						throw new Error("Provisioning failed: No API key returned");
					}
					// Store API key securely
					await CredentialsApi.updateCredential(apiConfig.baseUrl, {
						key: "RADIENT_API_KEY",
						value: provisionRes.api_key,
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
			// Try to get id_token or credential property
			const idToken =
				typeof tokenResponse.id_token === "string"
					? tokenResponse.id_token
					: typeof tokenResponse.credential === "string"
						? tokenResponse.credential
						: undefined;
			if (!idToken) {
				setError("No ID token received from Google");
				showErrorToast("No ID token received from Google");
				return;
			}
			await handleBackendAuth("google", idToken);
		},
		onError: () => {
			setError("Google sign-in failed");
			showErrorToast("Google sign-in failed");
		},
		scope: "openid email profile",
	});

	/**
	 * Microsoft sign-in handler.
	 */
	const signInWithMicrosoft = useCallback(async () => {
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
			if (!loginResponse.idToken) {
				throw new Error("No ID token received from Microsoft");
			}
			await handleBackendAuth("microsoft", loginResponse.idToken);
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
