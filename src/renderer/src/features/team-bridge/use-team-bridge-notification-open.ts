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
import { TEAM_BRIDGE_PATH } from "./team-bridge-nav";

const LEADING_HASH = /^#/;
const QUERY_OR_HASH = /[?#]/;

/** Whether a hash-router location is the Team Bridge route (`#/team-bridge…`). */
export function onTeamBridgeRoute(hash: string): boolean {
	const path = hash.replace(LEADING_HASH, "").split(QUERY_OR_HASH)[0];
	return path === TEAM_BRIDGE_PATH || path.startsWith(`${TEAM_BRIDGE_PATH}/`);
}

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
	navigate: (path: string, options?: { replace?: boolean }) => void,
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
		/*
		 * REPLACE WHEN THE WINDOW IS ALREADY ON TEAM BRIDGE (round 1, M2/Q1). A
		 * push there stacks a second `/team-bridge` entry (the page then clears its
		 * params with a replace), so the column's Back - "leave Team Bridge" -
		 * would spend its first press stepping from one bridge entry to the other
		 * with nothing visibly changing. Replacing keeps one entry per visit, the
		 * invariant `team-bridge-leave.ts` relies on. Read from the live hash at
		 * the moment of the open, because the click can land on any route.
		 */
		const onBridge = onTeamBridgeRoute(window.location.hash);
		navigate(
			teamBridgeOpenPath(target),
			onBridge ? { replace: true } : undefined,
		);
		setTarget(null);
	}, [target, enabled, navigate, client, authority.accountId, authority.token]);
}
