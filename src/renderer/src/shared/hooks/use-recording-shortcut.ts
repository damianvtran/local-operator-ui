import { useEffect } from "react";
import { create } from "zustand";
import type { MiniViewPlatform } from "../../../../shared/mini-view";
import type { RecordingShortcutState } from "../../../../shared/recording-shortcut";
import {
	DEFAULT_START_RECORDING_VALUE,
	canonicalRecordingChord,
	recordingConflictVariants,
	recordingShortcutLabel,
} from "../../../../shared/recording-shortcut";
import { rendererPlatform } from "../../mini-view/renderer-platform";

/*
 * The bridge lives on `window.api` (preload `api.recordingShortcut`). It was
 * read from `window.electron` until now, which the preload never populates, so
 * in the built app `get`/`onChange` never ran: the state stayed on its default,
 * `markPending` did nothing and the claim table was never published to main.
 */
const bridge = () => window.api?.recordingShortcut;

/** Non-persisted projection of main's cache, shared by main and mini documents. */
export const useRecordingShortcutStore = create<{
	state: RecordingShortcutState | null;
	setState: (state: RecordingShortcutState) => void;
}>((set) => ({
	state: null,
	setState: (state) => set({ state }),
}));

export function useRecordingShortcutState(): RecordingShortcutState {
	const state = useRecordingShortcutStore((store) => store.state);
	useEffect(() => {
		const api = bridge();
		if (!api) return;
		let active = true;
		void api.get().then((fresh) => {
			if (active) useRecordingShortcutStore.getState().setState(fresh);
		});
		const unsubscribe = api.onChange((fresh) => {
			if (active) useRecordingShortcutStore.getState().setState(fresh);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);
	// Storybook and DOM hosts have no preload. Keep the backend-compatible
	// default visible there rather than inventing a second settings read.
	return (
		state ?? {
			value: DEFAULT_START_RECORDING_VALUE,
			canonical: canonicalRecordingChord(DEFAULT_START_RECORDING_VALUE),
		}
	);
}

export function recordingExternalClaims(
	state: RecordingShortcutState,
	label: string,
): Map<string, string> {
	const claims = new Map<string, string>();
	for (const chord of [state.canonical, state.pending]) {
		if (!chord) continue;
		for (const variant of recordingConflictVariants(
			chord,
			rendererPlatform(),
		)) {
			claims.set(variant, label);
		}
	}
	return claims;
}

export function useRecordingShortcutLabel(
	platform: MiniViewPlatform,
	enabled = true,
): string | null {
	const state = useRecordingShortcutState();
	return !enabled || state.shadowedBy
		? null
		: recordingShortcutLabel(state.value, platform);
}
