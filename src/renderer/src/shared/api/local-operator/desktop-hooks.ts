/**
 * Renderer hooks for the typed desktop control plane.
 *
 * Every privileged control goes through `desktopRequest` (main-process IPC in
 * Electron, the server-side `/__desktop` proxy in browser development). The
 * renderer never holds the bearer, a URL, or an HTTP method — it picks an
 * operation from the closed vocabulary in `desktop-contract.ts`.
 *
 * Capability negotiation is fail-closed by design: a missing feature version
 * means the backend predates the control, and the UI must show an update
 * action rather than an unauthenticated legacy fallback.
 */

import { useQuery } from "@tanstack/react-query";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";
import type { DesktopCapabilities, DesktopProvider } from "./desktop-api";

export const desktopKeys = {
	capabilities: ["desktop", "capabilities"] as const,
	providers: ["desktop", "auth", "providers"] as const,
	commands: ["desktop", "commands"] as const,
	accounts: ["desktop", "auth", "accounts"] as const,
};

/**
 * Feature negotiation. `desktop_available` is false when this app did not
 * start the backend and therefore cannot supply the bearer — protected
 * controls stay hidden/disabled rather than falling back to an open route.
 */
export function useDesktopCapabilities() {
	return useQuery({
		queryKey: desktopKeys.capabilities,
		queryFn: async () => {
			try {
				return await desktopResult<DesktopCapabilities>({ op: "capabilities" });
			} catch (error) {
				// Collapsing every failure to `null` made the banner assert "this
				// backend is older than the app expects" for four different
				// situations, three of which an "Update backend" button cannot fix
				// (UX, design and QA all hit this). Fail-closed is about what we
				// ENABLE, not about how much we are allowed to know: the surfaces
				// stay gated either way (`desktopFeatureEnabled` still sees no
				// capabilities), and the reason is preserved so the banner can say
				// what actually happened and offer the action that matches.
				throw error instanceof Error ? error : new Error(String(error));
			}
		},
		staleTime: 60_000,
		retry: false,
	});
}

export type DesktopFeature =
	| "auth"
	| "settings"
	| "commands"
	| "catalogues"
	| "profile_catalogue"
	| "team_catalogue"
	| "session_catalogue"
	// Content search over past conversations. Its own feature rather than part
	// of `session_catalogue`: a client renders the catalogue perfectly well
	// against a backend without the search route, so gating the list on the
	// search version would hide a working surface because a newer one is
	// missing. A caller that cannot negotiate it searches names only.
	| "session_search"
	| "lifecycle"
	| "mcp"
	| "radient";

/**
 * Resolve whether a negotiated feature surface may be offered.
 *
 * A feature requires BOTH the backend advertising its version AND the managed
 * pairing being available: the routes sit behind the desktop bearer, so a
 * surface without `desktop_available` would render a wall of 401s.
 */
export function desktopFeatureEnabled(
	capabilities: DesktopCapabilities | null | undefined,
	feature: DesktopFeature,
	minimumVersion = 1,
): boolean {
	if (!capabilities || !capabilities.desktop_available) return false;
	return (capabilities.features?.[feature] ?? 0) >= minimumVersion;
}

/** Canonical provider registry rows, including aliases folded into methods. */
export function useDesktopProviders(enabled: boolean) {
	return useQuery({
		queryKey: desktopKeys.providers,
		queryFn: () =>
			desktopResult<{ providers: DesktopProvider[] }>({
				op: "providers.list",
			}).then((result) => result.providers),
		enabled,
		staleTime: 30_000,
		// Same reasoning as `useConfig`: a `status: null` failure already spent
		// the transport's whole deadline learning nothing, so retrying it doubles
		// the wait to ~60s without a chance of a different answer. A failure that
		// carries a status came from a backend that answered and is still worth
		// one retry.
		retry: retryDesktopQuery,
	});
}
