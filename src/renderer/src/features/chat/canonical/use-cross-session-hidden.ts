/**
 * The desktop transcript's read of `display.hide_cross_session`.
 *
 * The key belongs to the BACKEND registry (flat dotted, default false) and is
 * rendered generically by the Backend settings page. This hook joins that
 * page's OWN query — the same key object (`backendSettingsKeys.all`) and the
 * same `settings.list` op, deliberately imported rather than respelled — so
 * there is one fetch and one cache entry: a save in Settings refetches it (the
 * save path calls `settingsQuery.refetch()`), and every open transcript
 * re-renders in both directions while the records underneath never change.
 *
 * FAIL-CLOSED, and that is the whole safety story: an absent key (a backend
 * that predates it), an unanswered or failed query, and a desktop plane that
 * does not advertise `settings` all resolve to false — nothing is hidden.
 * Only an explicit boolean `true` from the registry hides anything, so an old
 * backend — or a test host with no bridge — renders exactly what it rendered
 * before the key existed.
 */
import { backendSettingsKeys } from "@features/settings/components/backend-settings-section";
import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useQuery } from "@tanstack/react-query";

/** The registry key, spelled once for this surface; the PR freezes the string. */
export const HIDE_CROSS_SESSION_KEY = "display.hide_cross_session";

export function useCrossSessionHidden(): boolean {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "settings");
	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled,
		staleTime: 10_000,
	});
	const setting = settingsQuery.data?.settings.find(
		(entry) => entry.key === HIDE_CROSS_SESSION_KEY,
	);
	/*
	 * A strict comparison rather than a truthiness cast: `value` is `unknown`
	 * on the wire, and only the boolean `true` this key registers may hide a
	 * row — any other value is a backend this app does not understand, and the
	 * safe reading of that is "show everything".
	 */
	return setting?.value === true;
}
