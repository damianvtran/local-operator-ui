import { agentMessagesApi } from "@shared/api/local-operator/agent-messages-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useRadientUserQuery } from "@shared/hooks/use-radient-user-query";
import { useAgentMessagesOnboardingStore } from "@shared/store/agent-messages-onboarding-store";
import { useUserStore } from "@shared/store/user-store";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AgentMessagesModel } from "./agent-messages-model";
import { agentMessagesRefusal } from "./agent-messages-refusal";

// One app-owned instance: later settings callers use checkAgentMessagesSurface,
// not another query with a polling/retry policy that could multiply traffic.
export const agentMessagesModel = new AgentMessagesModel({
	...agentMessagesApi,
	markSeen: (accountId, tenantId) =>
		useAgentMessagesOnboardingStore.getState().markSeen(accountId, tenantId),
	describe: agentMessagesRefusal,
});
export const checkAgentMessagesSurface = () =>
	agentMessagesModel.check("surface_open");

export function useAgentMessages() {
	const capabilities = useDesktopCapabilities();
	const { user, accountRead } = useRadientUserQuery();
	const isSigningOut = useUserStore((state) => state.isSigningOut);
	const enabled = desktopFeatureEnabled(capabilities.data, "team_bridge", 1);
	const accountId =
		enabled && accountRead === "ready" && !isSigningOut
			? (user?.account.id ?? null)
			: null;
	const observedAccount = useRef(false);
	const snapshot = useSyncExternalStore(
		agentMessagesModel.subscribe,
		agentMessagesModel.getSnapshot,
		/*
		 * React requires a server snapshot when SettingsPage is rendered with
		 * react-dom/server (the settings account-gate suite). The model starts
		 * from its stable empty snapshot and no effect runs on the server, so
		 * the current snapshot is the only state the server can observe; the
		 * browser path is unchanged.
		 */
		agentMessagesModel.getSnapshot,
	);

	useEffect(() => {
		agentMessagesModel.setAccount(accountId);
		if (!accountId) {
			if (accountRead === "signed-out") observedAccount.current = true;
			return;
		}
		const boundary = observedAccount.current ? "sign_in" : "app_start";
		observedAccount.current = true;
		void agentMessagesModel.check(boundary);
	}, [accountId, accountRead]);

	useEffect(() => {
		if (!accountId) return;
		// Window focus is an EVENT, never a timer. The shared model and harness
		// both apply the five-minute floor, including rapid focus/surface repeats.
		const focus = () => {
			void agentMessagesModel.check("window_focus");
		};
		window.addEventListener("focus", focus);
		return () => window.removeEventListener("focus", focus);
	}, [accountId]);

	return { accountId, snapshot, model: agentMessagesModel };
}
