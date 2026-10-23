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
	/**
	 * Default-on banners the reader has dismissed (runtime #2790). The runtime's
	 * `notice_pending` is the authority; this is the belt for the window where
	 * the shared status model still replays a cached "pending" (its cache is
	 * five minutes) so a remount straight after Dismiss cannot bring the banner
	 * back. Only written after the runtime accepted the dismissal.
	 */
	defaultOnDismissed: Record<string, true>;
	markSeen: (accountId: string, tenantId: string) => void;
	markDefaultOnDismissed: (accountId: string, tenantId: string) => void;
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
				defaultOnDismissed: {},
				markDefaultOnDismissed: (accountId, tenantId) =>
					set((state) => ({
						defaultOnDismissed: {
							...state.defaultOnDismissed,
							[agentMessagesOnboardingKey(accountId, tenantId)]: true,
						},
					})),
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
				partialize: (state) => ({
					seen: state.seen,
					defaultOnDismissed: state.defaultOnDismissed,
				}),
			},
		),
	);
