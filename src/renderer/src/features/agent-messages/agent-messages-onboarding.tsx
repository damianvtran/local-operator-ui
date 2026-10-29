import { useSuppressBrowserView } from "@shared/browser-view-policy";
import {
	agentMessagesOnboardingKey,
	useAgentMessagesOnboardingStore,
} from "@shared/store/agent-messages-onboarding-store";
import { useLayoutEffect } from "react";
import {
	agentMessagesOnboardingContext,
	agentMessagesServedConsent,
} from "../../../../shared/agent-messages-contract";
import { AgentMessagesDialog } from "./agent-messages-dialog";
import { useAgentMessages } from "./use-agent-messages";

export function AgentMessagesOnboarding({
	blocked,
	sessionId,
}: { blocked: boolean; sessionId: string | null }) {
	const { accountId, snapshot, model } = useAgentMessages();
	const seen = useAgentMessagesOnboardingStore((state) => state.seen);
	const context = agentMessagesOnboardingContext(snapshot.status, accountId);
	const open = Boolean(
		context &&
			snapshot.presentable &&
			!seen[agentMessagesOnboardingKey(context.accountId, context.tenantId)] &&
			!blocked,
	);
	/*
	 * The model's boundary decision must see the SAME busy fact this render does
	 * (§5.3). A layout effect runs before the passive effects that trigger
	 * boundary checks, so the component's first check cannot race it.
	 */
	useLayoutEffect(() => {
		model.setBlocked(blocked);
	});
	useSuppressBrowserView(open, "onboarding", "agent-messages");
	// Unknown/A/G/signed-out have NO nodes, strings, upsell or loading skeleton.
	// Existing onboarding and credit prompts own priority, without recording an
	// automatic dismissal merely because another modal temporarily takes over.
	if (!open || !context) return null;
	const consent = agentMessagesServedConsent(snapshot.status);
	const identity = model.consentIdentity();
	return (
		<AgentMessagesDialog
			consent={consent}
			accountGuard={snapshot.status?.consent_account_guard === true}
			canEnable={model.canEnable(identity)}
			pending={snapshot.pending}
			confirmed={snapshot.confirmed}
			refusal={snapshot.refusal}
			onDismiss={() => model.dismiss(context.accountId, context.tenantId)}
			onEnable={() => {
				if (identity) void model.enable(identity, sessionId);
			}}
		/>
	);
}
