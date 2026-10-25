import {
	observedRadientAuthority,
	radientAuthorityPending,
	radientAuthoritySnapshot,
	subscribeRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import { t } from "@shared/i18n";
import { showInfoToast } from "@shared/utils/toast-manager";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
	type TeamBridgeOpenResult,
	teamBridgeOpenPath,
} from "../../../../shared/team-bridge-notify";

/** The identity journal intentionally gives pending and settled sign-out the
 * same account token. A held notification click needs to observe that final
 * settlement too, without changing the journal's global identity contract. */
function notificationAuthoritySnapshot(client: QueryClient): string {
	return JSON.stringify([
		radientAuthoritySnapshot(client),
		radientAuthorityPending(client),
	]);
}

/** A click may outlive its renderer's credential counter. Admission uses the
 * settled account, never the former document's epoch. Keep clicks while auth
 * settles; a mismatch answers visibly without disclosing private routing IDs. */
export function useTeamBridgeNotificationOpen(
	enabled: boolean,
	navigate: (path: string) => void,
): void {
	const client = useQueryClient();
	const subscribe = useCallback(
		(listener: () => void) => subscribeRadientAuthority(client, listener),
		[client],
	);
	const snapshot = useCallback(
		() => notificationAuthoritySnapshot(client),
		[client],
	);
	const token = useSyncExternalStore(subscribe, snapshot, snapshot);
	const authority = { ...observedRadientAuthority(client), token };
	const [target, setTarget] = useState<TeamBridgeOpenResult | null>(null);
	useEffect(() => {
		let mounted = true;
		const bridge = window.api?.desktop?.teamBridge;
		const pull = () => {
			void bridge
				?.pendingOpen?.()
				.then((next) => {
					if (mounted && next) setTarget(next);
				})
				.catch(() => undefined);
		};
		const unsubscribe = bridge?.onOpen?.(pull);
		pull();
		return () => {
			mounted = false;
			unsubscribe?.();
		};
	}, []);
	useEffect(() => {
		if (
			!target ||
			radientAuthorityPending(client) ||
			authority.token !== notificationAuthoritySnapshot(client)
		)
			return;
		const accountId = observedRadientAuthority(client).accountId;
		if (
			"unavailable" in target ||
			!target.owner?.accountId ||
			target.owner.accountId !== accountId
		) {
			showInfoToast(t("ui.teamBridge.notify.unavailable"));
			setTarget(null);
			return;
		}
		if (!enabled || authority.accountId !== accountId) return;
		navigate(teamBridgeOpenPath(target));
		setTarget(null);
	}, [target, enabled, navigate, client, authority.accountId, authority.token]);
}
