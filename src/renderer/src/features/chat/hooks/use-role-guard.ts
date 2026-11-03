import { useCallback, useLayoutEffect, useRef } from "react";
import { guardedRole, shouldIgnoreRolePress } from "../composer-slots";

/**
 * The press guard for one slot of the composer cluster.
 *
 * Records when the slot's current role arrived (a layout effect, so the
 * timestamp is taken in the commit that put the control under the pointer) and
 * answers, for a click, whether it should be ignored. The rules are
 * `shouldIgnoreRolePress`'s; this is the half a pure module cannot hold - the
 * clock reading at the role edge.
 *
 * The first mount is not an arrival: a composer that mounts with Stop already
 * drawn has no reflex press in flight, so the guard stays open.
 */
export function useRoleGuard(role: string): (detail: number) => boolean {
	const arrival = useRef<{ role: string; at: number | null }>({
		role,
		at: null,
	});
	useLayoutEffect(() => {
		if (arrival.current.role === role) return;
		arrival.current = { role, at: performance.now() };
	}, [role]);
	return useCallback((detail: number) => {
		// Read the role the render is showing: the layout effect above has already
		// run for it, so `arrival.current.role === role` whenever a press can land.
		if (guardedRole(arrival.current.role as never) === null) return false;
		return shouldIgnoreRolePress({
			arrivedAt: arrival.current.at,
			now: performance.now(),
			detail,
		});
	}, []);
}
