import { agentMessagesApi } from "@shared/api/local-operator/agent-messages-api";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useRadientUserQuery } from "@shared/hooks/use-radient-user-query";
import { t } from "@shared/i18n";
import { useAgentMessagesOnboardingStore } from "@shared/store/agent-messages-onboarding-store";
import { useUserStore } from "@shared/store/user-store";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AgentMessagesRefusal } from "../../../../shared/agent-messages-contract";
import { AgentMessagesModel } from "./agent-messages-model";

const REFUSAL_CONTROLS = /[\p{Cc}\p{Cf}]/gu;

/** Refusal copy is server-authored text, never HTML, markdown or an exception. */
function safeRefusal(error: unknown): AgentMessagesRefusal {
	const plain = (value: string) =>
		value.replace(REFUSAL_CONTROLS, "").slice(0, 1024);
	if (error instanceof DesktopControlError) {
		const body =
			typeof error.detail === "object" && error.detail !== null
				? (error.detail as { details?: { field?: unknown; rule?: unknown } })
				: null;
		const details = body?.details;
		return {
			code: error.code ?? "desktop_refused",
			message: plain(error.message),
			...(typeof details?.field === "string" && typeof details.rule === "string"
				? {
						details: { field: plain(details.field), rule: plain(details.rule) },
					}
				: {}),
		};
	}
	return {
		code: "client_unavailable",
		message: t("ui.agentMessages.dialog.failure"),
	};
}

// One app-owned instance: later settings callers use checkAgentMessagesSurface,
// not another query with a polling/retry policy that could multiply traffic.
export const agentMessagesModel = new AgentMessagesModel({
	...agentMessagesApi,
	markSeen: (accountId, tenantId) =>
		useAgentMessagesOnboardingStore.getState().markSeen(accountId, tenantId),
	describe: safeRefusal,
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
