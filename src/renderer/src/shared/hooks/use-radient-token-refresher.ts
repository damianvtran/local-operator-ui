/**
 * @file use-radient-token-refresher.ts
 * @description
 * React Query hook to proactively refresh the Radient access token every 5 minutes,
 * on app startup, and on window focus, using the refresh token if available.
 * Ensures that access token expiry does not cause visible errors to the user
 * unless the refresh token is also expired.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { getSession, updateAccessToken, clearSession } from "@shared/utils/session-store";
import { createRadientClient } from "@shared/api/radient";
import { apiConfig } from "@shared/config";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { radientUserKeys } from "./use-radient-user-query";

/**
 * Hook to continuously refresh the Radient access token using the refresh token.
 * - Refreshes on mount, window focus, and every 5 minutes.
 * - Only shows expiry errors if the refresh token is expired.
 */
/**
 * Proactively refreshes the Radient access token every 5 minutes, on startup, and on window focus,
 * but only if the user is authenticated or has a local session.
 */
export const useRadientTokenRefresher = () => {
  const { authStatus, hasLocalSession } = useRadientAuth();
  const queryClient = useQueryClient();
  const refreshTimeout = useRef<NodeJS.Timeout | null>(null);

  // Memoize the Radient client instance as config values are constant
  const radientClient = useMemo(() => createRadientClient(
    apiConfig.radientBaseUrl,
    apiConfig.radientClientId,
  ), []);

  // Helper to clear any scheduled refresh
  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeout.current) {
      clearTimeout(refreshTimeout.current);
      refreshTimeout.current = null;
    }
  }, []);

  // Core refresh logic
  const refreshAccessToken = useCallback(async () => {
    const session = await getSession();
    if (!session || !session.refreshToken) {
      // No session or refresh token, nothing to do
      return;
    }

    const currentAccessToken = session.accessToken; // Store current access token

    // We do not track refresh token expiry timestamp; rely on refresh endpoint errors

    try {
      // Always refresh proactively, regardless of access token expiry
      const response = await radientClient.refreshToken(session.refreshToken);
      const newAccessToken = response.result.access_token;
      const newRefreshToken = response.result.refresh_token || session.refreshToken;

      // Always update the stored tokens (access, expiry, refresh)
      await updateAccessToken(
        newAccessToken,
        response.result.expires_in,
        newRefreshToken
      );

      // Only invalidate queries if the access token actually changed
      if (newAccessToken !== currentAccessToken) {
        queryClient.invalidateQueries({ queryKey: radientUserKeys.session() });
      }
    } catch (err) {
      // If refresh fails, check if it's due to refresh token expiry
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (
        errorMessage.toLowerCase().includes("invalid_grant") ||
        errorMessage.toLowerCase().includes("refresh token expired") ||
        errorMessage.toLowerCase().includes("invalid refresh token")
      ) {
        await clearSession(); // Ensure session is cleared before invalidating
        queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
        showErrorToast("Session expired. Please sign in again.");
      }
      // Otherwise, do not show an error (silent failure for proactive refresh)
    }
  }, [queryClient, radientClient]);

  // Schedule periodic refresh every 5 minutes
  const schedulePeriodicRefresh = useCallback(() => {
    clearRefreshTimeout();
    refreshTimeout.current = setTimeout(async () => {
      await refreshAccessToken();
      schedulePeriodicRefresh();
    }, 5 * 60 * 1000); // 5 minutes
  }, [refreshAccessToken, clearRefreshTimeout]);

  // On mount: refresh immediately, set up periodic refresh, and window focus listener
  useEffect(() => {
    // Only run refresher logic if authenticated or has a local session
    if (authStatus === "authenticated" || hasLocalSession) {
      // Refresh on mount
      refreshAccessToken();
      // Set up periodic refresh
      schedulePeriodicRefresh();

      // Refresh on window focus
      const handleFocus = () => {
        refreshAccessToken();
      };
      window.addEventListener("focus", handleFocus);

      return () => {
        clearRefreshTimeout();
        window.removeEventListener("focus", handleFocus);
      };
    } 

    // If not authenticated, clear any scheduled refresh
    clearRefreshTimeout();

    return undefined;

  }, [authStatus, hasLocalSession, refreshAccessToken, schedulePeriodicRefresh, clearRefreshTimeout]);

  // No return value; this hook is for side effects only
};
