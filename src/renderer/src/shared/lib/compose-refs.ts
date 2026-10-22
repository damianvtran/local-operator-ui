import type { Ref } from "react";

/**
 * Fan a DOM node out to several refs.
 *
 * WHY IT EXISTS: the overlay primitives now need their panel's element to MEASURE
 * it against the native browser view (`useSuppressBrowserViewWhileIntersecting`),
 * while their public `forwardRef` must keep working for callers that already pass
 * one. A node ref cannot be "shared" by assignment; one of the two would win, and
 * the loser would be a ref that silently stops updating. Handing both to this
 * function is the only shape where neither consumer can observe the other.
 */
export function composeRefs<T>(...refs: Array<Ref<T> | undefined>) {
	return (node: T | null): void => {
		for (const ref of refs) {
			if (ref == null) continue;
			if (typeof ref === "function") ref(node);
			else (ref as { current: T | null }).current = node;
		}
	};
}
