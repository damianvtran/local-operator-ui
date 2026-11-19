import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
	ROLE_GUARD_MS,
	guardArmedBy,
	shouldIgnoreRolePress,
} from "../composer-slots";

/**
 * The press guard for one slot of the composer cluster.
 *
 * Records when the slot's current role arrived (a layout effect, so the
 * timestamp is taken in the commit that put the control under the pointer) and
 * the role it replaced, and answers, for a click, whether it should be ignored.
 * The rules are `shouldIgnoreRolePress`'s and `guardArmedBy`'s; this is the half
 * a pure module cannot hold - the clock reading at the role edge.
 *
 * The first mount is not an arrival: a composer that mounts with Stop already
 * drawn has no reflex press in flight, so the guard stays open.
 *
 * `arming` is true for the guard's window when it was armed, so the control can
 * show that a press is not yet taken (a ramp in opacity, never `disabled`: that
 * would drop focus and read as a dead button). An ignored press with no visible
 * cause is the failure this exists to avoid.
 */
export function useRoleGuard(role: string): {
	ignore: (detail: number) => boolean;
	arming: boolean;
} {
	const arrival = useRef<{
		role: string;
		from: string | null;
		at: number | null;
	}>({ role, from: null, at: null });
	const [arming, setArming] = useState(false);
	useLayoutEffect(() => {
		if (arrival.current.role === role) return undefined;
		arrival.current = {
			role,
			from: arrival.current.role,
			at: performance.now(),
		};
		if (!guardArmedBy(role as never, arrival.current.from)) {
			setArming(false);
			return undefined;
		}
		setArming(true);
		const timer = setTimeout(() => setArming(false), ROLE_GUARD_MS);
		return () => clearTimeout(timer);
	}, [role]);
	const ignore = useCallback((detail: number) => {
		const { role: current, from, at } = arrival.current;
		if (!guardArmedBy(current as never, from)) return false;
		return shouldIgnoreRolePress({
			arrivedAt: at,
			now: performance.now(),
			detail,
		});
	}, []);
	return { ignore, arming };
}
