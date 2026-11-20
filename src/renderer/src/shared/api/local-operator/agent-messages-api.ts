import {
	type AgentMessagesAllowlistPut,
	type AgentMessagesAllowlistResult,
	type AgentMessagesBoundary,
	type AgentMessagesConsentPut,
	type AgentMessagesScreening,
	type AgentMessagesSettingsPut,
	type AgentMessagesSettingsResult,
	agentMessagesAllowlistResultSchema,
	agentMessagesOnboardingDismissResultSchema,
	agentMessagesScreeningSchema,
	agentMessagesSettingsResultSchema,
	agentMessagesStatusSchema,
} from "../../../../../shared/agent-messages-contract";
import type { TeamBridgeDirectory } from "../../../../../shared/team-bridge-contract";
import {
	browserDraftStorage,
	reconcileDraftAccount,
} from "../../store/team-bridge-draft-account";
import { desktopResult } from "./desktop-api";
import { TeamBridgeApi } from "./team-bridge-api";

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
	/**
	 * "Show when I'm typing". A share_typing-only PUT is a lop-local write and
	 * answers only `{share_typing}`, never the full settings envelope.
	 */
	async setShareTyping(accountId: string, shareTyping: boolean) {
		const answer = await desktopResult<{ share_typing?: unknown } | null>({
			op: "agent_messages.settings.share_typing",
			expected_account_id: accountId,
			share_typing: shareTyping,
		});
		return typeof answer?.share_typing === "boolean"
			? answer.share_typing
			: shareTyping;
	},
	/**
	 * The Screening model preference: a state-less, machine-local PUT (like
	 * share_typing; no hub call, no consent or endpoint-state effect). Returns
	 * the block the answer echoes when it carries a readable one, else null, so
	 * the caller re-reads settings rather than trusting the value it sent.
	 */
	async setScreeningModel(
		accountId: string,
		screeningModel: string,
	): Promise<AgentMessagesScreening | null> {
		const answer = await desktopResult<{ screening?: unknown } | null>({
			op: "agent_messages.settings.screening_model",
			expected_account_id: accountId,
			screening_model: screeningModel,
		});
		const parsed = agentMessagesScreeningSchema.safeParse(answer?.screening);
		return parsed.success ? parsed.data : null;
	},
	async localSetting(
		key: "team_bridge.enabled" | "team_bridge.session",
		value: boolean | string,
	) {
		return desktopResult<unknown>({ op: "settings.edit", key, value });
	},
	/**
	 * One organization's people and their agents, for the Reach editor's
	 * directory choices.
	 *
	 * WHY IT LIVES ON THIS API. The settings section takes its whole transport
	 * as one injectable `api` prop (stories and the jsdom lane pass a fake), so
	 * the directory read rides that same seam instead of the rail's react-query
	 * hook: no QueryClient is needed to render the section, and a fake api that
	 * omits this member simply gets the typed-ID form. It DELEGATES to
	 * `TeamBridgeApi.directory` — same op, same schema — so the two readers can
	 * never drift apart. The tenant is required for the same reason it is there:
	 * an absent tenant would let the server pick its own default roster.
	 */
	directory(tenantId: string): Promise<TeamBridgeDirectory> {
		return TeamBridgeApi.directory(tenantId);
	},
};
