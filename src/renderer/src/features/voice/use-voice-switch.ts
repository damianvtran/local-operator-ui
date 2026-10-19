/**
 * THE PERSON'S VOICE SWITCH, renderer half. Main owns the value
 * (`src/main/voice/qwen-voice-setting.ts`, default OFF); this mirrors it so
 * every voice surface can ask one question. Unknown (no bridge, or main has not
 * answered yet) reads as OFF: nothing voice-related renders or requests until
 * main says on.
 */

import { useEffect } from "react";
import { create } from "zustand";
import type { QwenVoiceBridge } from "../../../../shared/desktop-contract";

const bridge = (): QwenVoiceBridge | undefined =>
	(window as { api?: { desktop?: { qwenVoice?: QwenVoiceBridge } } }).api
		?.desktop?.qwenVoice;

export const useVoiceSwitchStore = create<{ enabled: boolean }>(() => ({
	enabled: false,
}));

/** Mount once (the settings row or the controller); it follows main's pushes. */
export function useVoiceSwitchSync(): void {
	useEffect(() => {
		const rig = bridge();
		if (!rig?.getEnabled) return;
		let live = true;
		void rig.getEnabled().then(
			(enabled) => live && useVoiceSwitchStore.setState({ enabled }),
			() => undefined,
		);
		const off = rig.onEnabled((enabled) =>
			useVoiceSwitchStore.setState({ enabled }),
		);
		return () => {
			live = false;
			off();
		};
	}, []);
}

export function useVoiceSwitch(): boolean {
	return useVoiceSwitchStore((s) => s.enabled);
}

/** Write the switch through main; main stops everything on off. */
export async function setVoiceSwitch(on: boolean): Promise<void> {
	const rig = bridge();
	if (!rig?.setEnabled) return;
	const enabled = await rig.setEnabled(on);
	useVoiceSwitchStore.setState({ enabled });
}
