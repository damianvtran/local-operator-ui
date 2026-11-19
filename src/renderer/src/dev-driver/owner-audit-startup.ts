import { useObservedRadientAuthority } from "@shared/hooks/radient-account-authority";
import { useEffect, useRef } from "react";

/** The startup hash races the capability-gated route's catch-all. This one
 * main-admitted QA scene therefore waits for the same real capability and
 * settled account journal the app uses, then navigates once through its router.
 * No scene means no navigation; this observer commissions no synthetic auth or
 * capability answers. Nothing from environment/fixture text becomes a route. */
export function useOwnerAuditStartupScene(
	enabled: boolean,
	navigate: (path: string) => void,
): void {
	const authority = useObservedRadientAuthority();
	const consumed = useRef(false);
	useEffect(() => {
		if (
			consumed.current ||
			!enabled ||
			!authority.accountId ||
			window.__loDevDriver?.armed !== true ||
			window.__loDevDriver.startupScene !== "team-bridge-owner-audit"
		)
			return;
		consumed.current = true;
		navigate("/team-bridge");
	}, [enabled, authority.accountId, navigate]);
}
