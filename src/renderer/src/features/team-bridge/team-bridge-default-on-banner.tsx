import { agentMessagesApi } from "@shared/api/local-operator/agent-messages-api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import {
	type AgentMessagesSettingsResult,
	type AgentMessagesStatus,
	agentMessagesDefaultOnBannerConsentText,
} from "../../../../shared/agent-messages-contract";
import { DefaultOnBanner } from "../agent-messages/default-on-banner";
import { agentMessagesModel } from "../agent-messages/use-agent-messages";
import {
	type DefaultOnBannerApi,
	useDefaultOnBannerActions,
	useDefaultOnBannerVisible,
} from "../agent-messages/use-default-on-banner";
import { teamBridgeKeys } from "./use-team-bridge";

/**
 * The default-on first-run banner on the Team Bridge page (runtime #2790).
 *
 * WHY THIS IS A SEPARATE CONTAINER. The page's own reads never fetch the
 * settings endpoint, and the banner rule needs it (`default_on` lives on the
 * settings read). The settings read is therefore gated on the status already
 * saying a notice is pending, so a member with nothing to be told - the common
 * case, forever after dismissal - issues no extra request from this page.
 *
 * It shares its body, copy and write hook with Settings -> Agent messages
 * (`DefaultOnBanner`, `useDefaultOnBannerActions`) so the two surfaces cannot
 * drift: same Turn off request, same dismiss route, same verbatim consent text.
 */
export const TeamBridgeDefaultOnBanner: FC<{
	status: AgentMessagesStatus | undefined;
	/** Test/story seam; the app uses the real client. */
	api?: DefaultOnBannerApi &
		Pick<typeof agentMessagesApi, "settings"> /* settings read */;
	defaultExpanded?: boolean;
}> = ({ status, api = agentMessagesApi, defaultExpanded }) => {
	const queryClient = useQueryClient();
	const tenantId = status?.tenant_id ?? null;
	const accountId = status?.account_id ?? null;
	const wanted =
		status?.surface_state === "C" && status.default_on?.notice_pending === true;
	const settingsKey = [
		...teamBridgeKeys.all,
		"default-on-settings",
		// Two accounts of one organisation share a tenant, so a tenant-only key
		// would replay the previous account's default_on/endpoint after a
		// sign-in switch. The account is part of the identity of this read.
		accountId,
		tenantId,
	] as const;
	const settings = useQuery<AgentMessagesSettingsResult | null>({
		queryKey: settingsKey,
		queryFn: () => api.settings(tenantId ?? undefined),
		enabled: wanted && tenantId !== null,
		staleTime: 60_000,
	});
	const settingsData: AgentMessagesSettingsResult | null =
		settings.data ?? null;
	const visible = useDefaultOnBannerVisible(
		status ?? null,
		settingsData,
		accountId,
	);
	const actions = useDefaultOnBannerActions({
		api,
		accountId,
		tenantId: settingsData?.settings.tenant_id ?? tenantId,
		markerTenantId: tenantId,
		onSettings: (next) =>
			queryClient.setQueryData<AgentMessagesSettingsResult | null>(
				settingsKey,
				next,
			),
		onChanged: async () => {
			// Settings reads through the shared status model: drop its cache so the
			// other surface agrees with this one on its next natural boundary.
			agentMessagesModel.invalidateStatus();
			await queryClient.invalidateQueries({ queryKey: teamBridgeKeys.status });
		},
	});
	if (!status || !visible) return null;
	return (
		/*
		 * The gutter is this column's, not the chat pane's: `NOTICE_BAND` leaves
		 * the wrapper to the call site, and the Team Bridge thread column's
		 * composer sits at `px-4`. With the chat strip's `px-6` the band started
		 * 8px inside the composer (design D7).
		 */
		<div className="shrink-0 px-4 py-1">
			<DefaultOnBanner
				consentText={agentMessagesDefaultOnBannerConsentText(
					status,
					settingsData,
				)}
				pending={actions.pending}
				failure={actions.failure}
				onTurnOff={() => void actions.turnOff()}
				onDismiss={() => void actions.dismiss()}
				defaultExpanded={defaultExpanded}
			/>
		</div>
	);
};
