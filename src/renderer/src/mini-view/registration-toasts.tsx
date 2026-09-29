/**
 * The registration toasts: one signal per transition into a failed shortcut.
 *
 * WHY THIS EXISTS (design D12/§G.3; UX round 1, U1). Registration failure was
 * surfaced only beside the settings row, which is unmounted unless the user is
 * already on Settings → Hotkeys — so a user who rebound to a taken chord, or
 * whose chord died mid-session, got no signal where they were and no clue the
 * chord was dead. The contract's dose is "one toast per transition into a
 * failed status": the row and the log line already exist, and this raises the
 * toast, through the app's own error path (`showErrorToast`, the manager every
 * other refusal goes through) so its cooldown and non-stacking policy apply
 * here too.
 *
 * THE LAUNCH-TIME STATE NEVER TOASTS ("no notification spam at boot", §G.3):
 * the first state heard from EITHER source — the mount read
 * (`getRegistration`) or the push channel — is the baseline, and only a later
 * STATUS CHANGE into a failure raises. A boot that starts taken is silent; a
 * rebind that lands taken is not. Recovery (a transition back to `registered`)
 * is not a toast either: the row's badge already says so.
 *
 * IT RENDERS NOTHING and is mounted beside `UndoToasts` in `main.tsx`, so what
 * the reader sees is the one global sonner container every other message in the
 * app uses. The sentence is `registrationCopy` itself — the same function the
 * settings row renders, so the toast and the row can never disagree about a
 * state.
 *
 * WHY THE MINI WINDOW DOES NOT MOUNT IT: the mini document mounts no sonner
 * container at all (§D.1's deliberate list), and the user is in the app's main
 * window when they rebind; a second mount there would raise a second toast for
 * one transition.
 */

import { showErrorToast } from "@shared/utils/toast-manager";
import { useEffect, useMemo, useRef } from "react";
import {
	type MiniViewRegistrationState,
	type MiniViewRegistrationStatus,
	formatQuickSendDisplay,
} from "../../../shared/mini-view";
import { registrationCopy } from "./mini-copy";
import { rendererPlatform } from "./renderer-platform";

export function RegistrationToasts() {
	const platform = useMemo(rendererPlatform, []);
	const lastStatus = useRef<MiniViewRegistrationStatus | null>(null);

	useEffect(() => {
		const api = window.api?.miniView;
		if (!api?.onRegistration) return undefined;
		let cancelled = false;
		const consider = (state: MiniViewRegistrationState): void => {
			if (cancelled) return;
			const previous = lastStatus.current;
			lastStatus.current = state.status;
			// The first state heard, from whichever source: the launch-time state.
			if (previous === null) return;
			if (state.status === previous) return;
			// A recovery is the row's story, not a toast; only entries into
			// failure are the silent dead key this raises a signal about.
			if (state.status === "registered") return;
			const display = formatQuickSendDisplay(state.value, platform);
			showErrorToast(registrationCopy(state.status, display));
		};
		/*
		 * The mount read and the push channel as ONE baseline: whichever lands
		 * first is the launch-time state (skipped) and everything after it is a
		 * transition. A read that cannot answer leaves the first push as the
		 * baseline rather than guessing at one.
		 */
		void api
			.getRegistration?.()
			?.then(consider)
			?.catch(() => {});
		const unsubscribe = api.onRegistration(consider);
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [platform]);

	return null;
}
