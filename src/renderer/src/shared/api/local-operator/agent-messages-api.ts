import {
	type AgentMessagesAllowlistPut,
	type AgentMessagesAllowlistResult,
	type AgentMessagesBoundary,
	type AgentMessagesConsentPut,
	type AgentMessagesSettingsPut,
	type AgentMessagesSettingsResult,
	agentMessagesAllowlistResultSchema,
	agentMessagesOnboardingDismissResultSchema,
	agentMessagesSettingsResultSchema,
	agentMessagesStatusSchema,
} from "../../../../../shared/agent-messages-contract";
import {
	browserDraftStorage,
	reconcileDraftAccount,
} from "../../store/team-bridge-draft-account";
import { desktopResult } from "./desktop-api";

/** No Radient JWT or direct hub request crosses the renderer boundary. */
export const agentMessagesApi = {
	async status(boundary: AgentMessagesBoundary) {
		const result = await desktopResult<unknown>({
			op: "agent_messages.status",
			boundary,
		});
		const parsed = agentMessagesStatusSchema.safeParse(result);
		// An unknown shape cannot establish eligibility or permission to consent.
		if (parsed.success)
			reconcileDraftAccount(browserDraftStorage(), parsed.data);
		return parsed.success ? parsed.data : null;
	},
	async enable(body: AgentMessagesConsentPut) {
		const result = await desktopResult<unknown>({
			op: "agent_messages.enable",
			...body,
		});
		return agentMessagesSettingsResultSchema.parse(result);
	},
	/**
	 * The settings read. A shape this client cannot fully read is null rather
	 * than a partial render: every control below the read writes against it.
	 */
	async settings(
		tenantId?: string,
	): Promise<AgentMessagesSettingsResult | null> {
		const result = await desktopResult<unknown>({
			op: "agent_messages.settings",
			...(tenantId === undefined ? {} : { tenant_id: tenantId }),
		});
		const parsed = agentMessagesSettingsResultSchema.safeParse(result);
		return parsed.success ? parsed.data : null;
	},
	async updateSettings(body: AgentMessagesSettingsPut) {
		const result = await desktopResult<unknown>({
			op: "agent_messages.settings.put",
			...body,
		});
		return agentMessagesSettingsResultSchema.parse(result);
	},
	async allowlist(
		tenantId?: string,
	): Promise<AgentMessagesAllowlistResult | null> {
		const result = await desktopResult<unknown>({
			op: "agent_messages.allowlist.get",
			...(tenantId === undefined ? {} : { tenant_id: tenantId }),
		});
		const parsed = agentMessagesAllowlistResultSchema.safeParse(result);
		return parsed.success ? parsed.data : null;
	},
	async updateAllowlist(body: AgentMessagesAllowlistPut) {
		const result = await desktopResult<unknown>({
			op: "agent_messages.allowlist.put",
			...body,
		});
		return agentMessagesAllowlistResultSchema.parse(result);
	},
	/**
	 * Dismiss the default-on banner for good (runtime #2790). The runtime owns
	 * the "seen" marker; the answer is validated so a surprise body is a failed
	 * dismissal the banner reports, not a silent success that returns later.
	 */
	async dismissOnboarding() {
		const result = await desktopResult<unknown>({
			op: "agent_messages.onboarding.dismiss",
		});
		return agentMessagesOnboardingDismissResultSchema.parse(result);
	},
	async localSetting(
		key: "team_bridge.enabled" | "team_bridge.session",
		value: boolean | string,
	) {
		return desktopResult<unknown>({ op: "settings.edit", key, value });
	},
};
