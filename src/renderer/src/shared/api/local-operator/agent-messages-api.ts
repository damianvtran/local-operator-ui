import {
	type AgentMessagesBoundary,
	type AgentMessagesConsentPut,
	agentMessagesSettingsResultSchema,
	agentMessagesStatusSchema,
} from "../../../../../shared/agent-messages-contract";
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
		return parsed.success ? parsed.data : null;
	},
	async enable(body: AgentMessagesConsentPut) {
		const result = await desktopResult<unknown>({
			op: "agent_messages.enable",
			...body,
		});
		return agentMessagesSettingsResultSchema.parse(result);
	},
	async localSetting(
		key: "team_bridge.enabled" | "team_bridge.session",
		value: boolean | string,
	) {
		return desktopResult<unknown>({ op: "settings.edit", key, value });
	},
};
