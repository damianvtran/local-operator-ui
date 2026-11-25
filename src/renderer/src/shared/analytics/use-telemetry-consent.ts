/**
 * The user's telemetry opt-in, renderer half (2026-11-24).
 *
 * Main owns the persisted choice (`src/main/telemetry-consent.ts`); this mirrors
 * it for the Settings → Privacy toggle and follows main's broadcasts, so a
 * change made in another window shows here too. Unknown (no bridge, or main has
 * not answered yet) reads as NOT opted in: the toggle never shows "on" for a
 * choice main has not confirmed.
 */

import { useEffect } from "react";
import { create } from "zustand";
import type { TelemetryConsentState } from "../../../../main/telemetry-consent";

type ConsentBridge = Window["api"]["telemetryConsent"];

export const consentBridge = (): ConsentBridge | undefined =>
	typeof window === "undefined"
		? undefined
		: (window as { api?: { telemetryConsent?: ConsentBridge } }).api
				?.telemetryConsent;

const OFF: TelemetryConsentState = {
	optedIn: false,
	launchAllows: true,
	effective: false,
};

export const useTelemetryConsentStore = create<{
	state: TelemetryConsentState;
	known: boolean;
}>(() => ({ state: OFF, known: false }));

/** Mount once where the toggle lives; follows main's pushes. */
export function useTelemetryConsentSync(): void {
	useEffect(() => {
		const bridge = consentBridge();
		if (!bridge) return;
		let live = true;
		void bridge.get().then(
			(state) =>
				live && useTelemetryConsentStore.setState({ state, known: true }),
			() => undefined,
		);
		const off = bridge.onChange((state) =>
			useTelemetryConsentStore.setState({ state, known: true }),
		);
		return () => {
			live = false;
			off();
		};
	}, []);
}

export function useTelemetryConsent(): TelemetryConsentState & {
	known: boolean;
} {
	// Two stable selections rather than one fresh object: zustand compares
	// selector results by identity, and a new object per read re-renders forever.
	const state = useTelemetryConsentStore((s) => s.state);
	const known = useTelemetryConsentStore((s) => s.known);
	return { ...state, known };
}

/**
 * Persist a choice through main. Rejects when main could not save it; the
 * store then keeps the previous (still true) answer.
 */
export async function setTelemetryConsent(optedIn: boolean): Promise<void> {
	const bridge = consentBridge();
	if (!bridge) return;
	const state = await bridge.set(optedIn);
	useTelemetryConsentStore.setState({ state, known: true });
}
