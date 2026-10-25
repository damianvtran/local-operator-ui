import {
	observedRadientAuthority,
	radientAuthoritySnapshot,
	useObservedRadientAuthority,
} from "@shared/hooks/radient-account-authority";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	type TeamBridgeOpenTarget,
	teamBridgeNotifyOwnerMatches,
	teamBridgeOpenPath,
} from "../../../../shared/team-bridge-notify";

/** Main can revoke a parked target, but not an IPC result already in flight.
 * Check the journal again on receipt AND at navigation: capability readiness
 * may lag auth, and a queued A click must never become a B route. */
export function useTeamBridgeNotificationOpen(
	enabled: boolean,
	navigate: (path: string) => void,
): void {
	const client = useQueryClient();
	const authority = useObservedRadientAuthority();
	const [target, setTarget] = useState<TeamBridgeOpenTarget | null>(null);
	useEffect(() => {
		let mounted = true;
		const bridge = window.api?.desktop?.teamBridge;
		const pull = () => {
			void bridge
				?.pendingOpen?.()
				.then((next) => {
					if (
						mounted &&
						next &&
						teamBridgeNotifyOwnerMatches(
							next.owner,
							observedRadientAuthority(client),
						)
					)
						setTarget(next);
				})
				.catch(() => undefined);
		};
		const unsubscribe = bridge?.onOpen?.(pull);
		pull();
		return () => {
			mounted = false;
			unsubscribe?.();
		};
	}, [client]);
	useEffect(() => {
		if (!target) return;
		if (
			authority.token !== radientAuthoritySnapshot(client) ||
			!teamBridgeNotifyOwnerMatches(
				target.owner,
				observedRadientAuthority(client),
			)
		) {
			setTarget(null);
			return;
		}
		if (!enabled) return;
		navigate(teamBridgeOpenPath(target));
		setTarget(null);
	}, [target, enabled, navigate, client, authority.token]);
}
