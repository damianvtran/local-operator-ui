import { config } from "./app-config";

/**
 * The daemon the MAIN process is attached to, when it is not the configured
 * origin.
 *
 * WHY this is mutable. Discovery attaches to whatever daemon it validated -
 * the operator's TUI-started one on its own port, or this app's own child on an
 * ephemeral port - so the address the renderer must dial is no longer a
 * build-time constant. The main process owns that answer (it identity-matched
 * the daemon and holds the bearer); the renderer learns it from the
 * server-status signal and every direct client here follows it.
 *
 * Null means "no discovered daemon yet", which falls back to the configured
 * URL: the behaviour this app had before discovery, and what a Storybook or
 * browser host with no desktop bridge still gets.
 */
let discoveredBackendUrl: string | null = null;

/**
 * Point the renderer's direct API clients at the daemon main attached to.
 *
 * Called from the server-status subscriber, so it tracks both discovery and a
 * later rotation (a daemon replaced on a new build, or an attach after the app
 * started with none). A `null` URL - no daemon - restores the configured
 * origin rather than making the clients dial nothing.
 */
export function setDiscoveredBackendUrl(url: string | null): void {
	discoveredBackendUrl = url;
}

/**
 * API client configuration derived from the app config
 *
 * `baseUrl` is a getter, not a value: the ~50 direct call sites in the renderer
 * read it when they make a request, and the correct address is only known once
 * main has discovered the daemon. A frozen copy would leave the whole renderer
 * talking to the configured port while main talks to the daemon it attached to
 * - two clients of two different servers, which is the confusion this whole
 * change exists to remove.
 */
export const apiConfig = {
	get baseUrl(): string {
		return discoveredBackendUrl ?? config.VITE_LOCAL_OPERATOR_API_URL;
	},
	radientBaseUrl: config.VITE_RADIENT_SERVER_BASE_URL,
	radientClientId: config.VITE_RADIENT_CLIENT_ID,
};
