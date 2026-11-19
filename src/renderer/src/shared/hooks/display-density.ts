import type { DesktopCapabilities } from "@shared/api/local-operator/desktop-api";
import {
	type DesktopFeature,
	desktopFeatureEnabled,
	desktopKeys,
} from "@shared/api/local-operator/desktop-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

/*
 * THE TWO READS EVERY RIGHT-SIZED PICTURE NEEDS (operator report 2026-11-03,
 * "The avatar images show up blurry in team bridge ... on retina displays").
 * One module so the Team Bridge plates (`use-account-avatar.ts`) and the local
 * agent pictures (`agent-avatar/agent-avatar.ts`) share one display listener
 * and one notion of "does this core serve it", rather than two copies that
 * drift apart.
 */

/*
 * THE DISPLAY'S DEVICE PIXEL RATIO, LIVE. Callers pick a server variant for the
 * display the window is on NOW: dragging the window from a 1x external monitor
 * to the 2x built-in panel changes `devicePixelRatio` without any resize a
 * picture would otherwise notice, so a one-shot read would keep a small file
 * upscaled on the retina panel until the next remount.
 *
 * `matchMedia("(resolution: Xdppx)")` fires `change` exactly when the ratio
 * leaves X, so the listener is re-armed for the new value on every change
 * (the standard MDN pattern; there is no "any resolution change" query). One
 * store is shared by every picture: a message list of hundreds of rows adds one
 * media listener, not one per row.
 */
const dprListeners = new Set<() => void>();
let dprQuery: MediaQueryList | undefined;
function currentDpr(): number {
	return typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
}
function onDprChange(): void {
	armDprQuery();
	for (const listener of dprListeners) listener();
}
function armDprQuery(): void {
	dprQuery?.removeEventListener("change", onDprChange);
	dprQuery = undefined;
	if (typeof window === "undefined" || typeof window.matchMedia !== "function")
		return;
	dprQuery = window.matchMedia(`(resolution: ${currentDpr()}dppx)`);
	dprQuery.addEventListener("change", onDprChange);
}
function subscribeDpr(listener: () => void): () => void {
	dprListeners.add(listener);
	if (dprListeners.size === 1) armDprQuery();
	return () => {
		dprListeners.delete(listener);
		if (dprListeners.size === 0) {
			dprQuery?.removeEventListener("change", onDprChange);
			dprQuery = undefined;
		}
	};
}
export function useDevicePixelRatio(): number {
	return useSyncExternalStore(subscribeDpr, currentDpr, () => 1);
}

/*
 * A PASSIVE read of one capability key, not `useDesktopCapabilities()`: the app
 * root already owns that poll, and a picture is mounted on every message row
 * and sidebar entry, so each one adding a query observer would add a refetch
 * interval (or, disabled, create and gc-time an empty query) per row for an
 * answer that is already in the cache. Same shape as
 * `useObservedRadientAuthority`: subscribe to the cache, read a boolean.
 * Unknown/absent answers false, which every caller treats as "the older
 * behaviour".
 */
export function usePassiveDesktopFeature(feature: DesktopFeature): boolean {
	const client = useQueryClient();
	const subscribe = useCallback(
		(listener: () => void) =>
			client.getQueryCache().subscribe((event) => {
				if (
					(event.type === "updated" || event.type === "removed") &&
					event.query.queryKey[0] === desktopKeys.capabilities[0] &&
					event.query.queryKey[1] === desktopKeys.capabilities[1]
				)
					listener();
			}),
		[client],
	);
	const snapshot = useCallback(
		() =>
			desktopFeatureEnabled(
				client.getQueryData<DesktopCapabilities>(desktopKeys.capabilities),
				feature,
			),
		[client, feature],
	);
	return useSyncExternalStore(subscribe, snapshot, snapshot);
}
