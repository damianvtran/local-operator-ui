/**
 * The desktop transcript's read of `display.turn_answer_rail`.
 *
 * Same seam as `use-cross-session-hidden.ts`, for the same reasons: the key is
 * the BACKEND registry's (flat dotted, default false), it is rendered
 * generically by the Backend settings page, and this hook joins that page's
 * OWN `settings.list` query (`backendSettingsKeys.all`, imported rather than
 * respelled) so there is one fetch and one cache entry, and a save in Settings
 * repaints every open transcript in both directions.
 *
 * FAIL-CLOSED: an absent key (a backend that predates it), an unanswered or
 * failed query, and a plane that does not advertise `settings` all resolve to
 * false - no rail. The reading rule itself is `turnAnswerRailEnabled`.
 */
import { backendSettingsKeys } from "@features/settings/components/backend-settings-section";
import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useQuery } from "@tanstack/react-query";
import { turnAnswerRailEnabled } from "./turn-answer-rail";

export function useTurnAnswerRail(): boolean {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "settings");
	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled,
		staleTime: 10_000,
	});
	return turnAnswerRailEnabled(settingsQuery.data?.settings);
}
