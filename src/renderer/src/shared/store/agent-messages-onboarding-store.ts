import { create } from "zustand";
import { persist } from "zustand/middleware";

export function agentMessagesOnboardingKey(
	accountId: string,
	tenantId: string,
) {
	return JSON.stringify([accountId, tenantId]);
}

type AgentMessagesOnboardingState = {
	seen: Record<string, true>;
	markSeen: (accountId: string, tenantId: string) => void;
};

/**
 * Private per-machine UX state, not a server enrollment row. A global boolean
 * would let one account or organization silence another's first consent. Never
 * mirror this into H1's global onboarding key, analytics or a notification.
 */
export const useAgentMessagesOnboardingStore =
	create<AgentMessagesOnboardingState>()(
		persist(
			(set) => ({
				seen: {},
				markSeen: (accountId, tenantId) =>
					set((state) => ({
						seen: {
							...state.seen,
							[agentMessagesOnboardingKey(accountId, tenantId)]: true,
						},
					})),
			}),
			{
				name: "agent-messages-onboarding",
				partialize: (state) => ({ seen: state.seen }),
			},
		),
	);
