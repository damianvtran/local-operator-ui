/**
 * Whether THIS document's analytics client is live right now.
 *
 * WHY A LIVE VALUE (2026-11-24). Telemetry is opt-in and the user can change it
 * at any time without a restart, so the launch-time bridge value
 * (`window.api.telemetryEnabled`) is only the starting point. The controller
 * (`telemetry-controller.ts`) publishes every change here; the product-event
 * sink and the feature-flag provider read it, so all three agree.
 *
 * Until the controller has published anything, the answer falls back to the
 * bridge's explicit `true` (fail-closed: anything else is off). That keeps this
 * module importable from node test bundles and from documents that never run
 * the controller (the mini-view), which therefore stay off.
 *
 * No `posthog-js` and no config import, for `product-events.ts`'s reason: the
 * onboarding tour reaches this module in test bundles that cannot load either.
 */

let active: boolean | null = null;
const listeners = new Set<() => void>();

export function isTelemetryActive(): boolean {
	if (active !== null) return active;
	return (
		typeof window !== "undefined" &&
		(window as { api?: { telemetryEnabled?: boolean } }).api
			?.telemetryEnabled === true
	);
}

export function setTelemetryActive(next: boolean | null): void {
	if (active === next) return;
	active = next;
	for (const listener of listeners) listener();
}

/** `useSyncExternalStore`-shaped subscription. */
export function subscribeTelemetryActive(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
