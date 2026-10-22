import {
	agentMessagesOnboardingKey,
	useAgentMessagesOnboardingStore,
} from "@shared/store/agent-messages-onboarding-store";
import { useRef, useState } from "react";
import {
	type AgentMessagesSettingsPut,
	type AgentMessagesSettingsResult,
	type AgentMessagesStatus,
	agentMessagesDefaultOnBannerPending,
} from "../../../../shared/agent-messages-contract";

export type DefaultOnPending = "turn_off" | "dismiss" | null;
export type DefaultOnFailure = "turn_off" | "dismiss" | null;

/** The two calls the banner makes; both surfaces hand in the same client. */
export type DefaultOnBannerApi = {
	updateSettings: (
		body: AgentMessagesSettingsPut,
	) => Promise<AgentMessagesSettingsResult>;
	dismissOnboarding: () => Promise<unknown>;
};

/**
 * Whether the default-on banner shows: the runtime's rule (surface C, settings
 * `default_on`, status `notice_pending`) AND this machine has not already
 * recorded the dismissal.
 *
 * The local record is a belt, not the authority. The shared status model may
 * replay a cached `notice_pending: true` for minutes after the runtime
 * accepted the dismissal; without it a remount in that window would bring the
 * banner back, and "once dismissed it never returns" would be false.
 */
export function useDefaultOnBannerVisible(
	status: AgentMessagesStatus | null,
	settings: Pick<AgentMessagesSettingsResult, "default_on" | "endpoint"> | null,
	accountId: string | null,
): boolean {
	const tenantId = status?.tenant_id ?? null;
	const dismissed = useAgentMessagesOnboardingStore((state) =>
		accountId && tenantId
			? state.defaultOnDismissed[
					agentMessagesOnboardingKey(accountId, tenantId)
				] === true
			: false,
	);
	return !dismissed && agentMessagesDefaultOnBannerPending(status, settings);
}

/**
 * The banner's two writes, shared by Settings and the Team Bridge page so the
 * request bodies cannot drift between the two surfaces.
 *
 * TURN OFF is exactly one request: `PUT settings {state: "disabled"}` with the
 * captured-account guard and the tenant. It deliberately does NOT also call
 * `settings.edit team_bridge.enabled`: under default-on the runtime writes the
 * sticky local opt-out itself once the hub accepts, and a second client write
 * would be a second source of truth for the same switch.
 *
 * DISMISS is the runtime's local-only, idempotent route. The local "dismissed"
 * record is written only after the runtime accepted it, so a failed dismissal
 * leaves the banner up with an honest error instead of hiding it for a promise
 * the runtime never recorded.
 *
 * Both are single-flight: a second click while one is pending is dropped.
 */
export function useDefaultOnBannerActions(input: {
	api: DefaultOnBannerApi;
	accountId: string | null;
	tenantId: string | null;
	/**
	 * The tenant the status read names - the SAME one `useDefaultOnBannerVisible`
	 * keys its local "dismissed" record by. Kept apart from `tenantId` (which
	 * the PUT carries, from the settings read) so the write and the read of that
	 * record can never disagree about the key: a marker written under one tenant
	 * and read under another would leave the banner up after a successful
	 * dismissal.
	 */
	markerTenantId: string | null;
	/** Receives the settings answer so the host can re-render from it. */
	onSettings?: (settings: AgentMessagesSettingsResult) => void;
	/** Runs after a SUCCESSFUL write, to refresh whatever the host reads. */
	onChanged?: () => Promise<unknown> | undefined;
}) {
	const { api, accountId, tenantId, markerTenantId, onSettings, onChanged } =
		input;
	const [pending, setPending] = useState<DefaultOnPending>(null);
	const [failure, setFailure] = useState<DefaultOnFailure>(null);
	const inFlight = useRef(false);

	async function run(
		kind: "turn_off" | "dismiss",
		action: () => Promise<void>,
	) {
		if (inFlight.current || !accountId) return;
		inFlight.current = true;
		setPending(kind);
		setFailure(null);
		try {
			await action();
		} catch {
			setFailure(kind);
			return;
		} finally {
			inFlight.current = false;
			setPending(null);
		}
		try {
			await onChanged?.();
		} catch {
			// The write landed; a failed refresh must not read as a failed write.
			// The next natural boundary re-reads the status.
		}
	}

	return {
		pending,
		failure,
		turnOff: () =>
			run("turn_off", async () => {
				const result = await api.updateSettings({
					expected_account_id: accountId as string,
					...(tenantId ? { tenant_id: tenantId } : {}),
					state: "disabled",
				});
				onSettings?.(result);
			}),
		dismiss: () =>
			run("dismiss", async () => {
				await api.dismissOnboarding();
				if (accountId && markerTenantId) {
					useAgentMessagesOnboardingStore
						.getState()
						.markDefaultOnDismissed(accountId, markerTenantId);
				}
			}),
	};
}
