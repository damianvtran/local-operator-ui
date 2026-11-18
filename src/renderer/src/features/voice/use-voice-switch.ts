/**
 * THE PERSON'S VOICE SWITCH, renderer half. Main owns the value
 * (`src/main/voice/qwen-voice-setting.ts`, default OFF); this mirrors it so
 * every voice surface can ask one question. Unknown (no bridge, or main has not
 * answered yet) reads as OFF: nothing voice-related renders or requests until
 * main says on.
 */

import { useEffect } from "react";
import { create } from "zustand";
import type {
	QwenVoiceBridge,
	QwenVoiceEngine,
} from "../../../../shared/desktop-contract";

export const bridge = (): QwenVoiceBridge | undefined =>
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

/**
 * THE ENGINE, renderer half. Main owns the value (`qwen-voice-setting.ts`,
 * default `local`); this mirrors it. Unknown reads as `local`, the engine every
 * profile had before the choice existed.
 */
export const useVoiceEngineStore = create<{ engine: QwenVoiceEngine }>(() => ({
	engine: "local",
}));

/** Mount once (the engine row); it follows main's pushes. */
export function useVoiceEngineSync(): void {
	useEffect(() => {
		const rig = bridge();
		if (!rig?.getEngine) return;
		let live = true;
		void rig.getEngine().then(
			(engine) => live && useVoiceEngineStore.setState({ engine }),
			() => undefined,
		);
		const off = rig.onEngine?.((engine) =>
			useVoiceEngineStore.setState({ engine }),
		);
		return () => {
			live = false;
			off?.();
		};
	}, []);
}

export function useVoiceEngine(): QwenVoiceEngine {
	return useVoiceEngineStore((s) => s.engine);
}

/** Ask main to change the engine; the store follows main's ANSWER, not the ask. */
export async function setVoiceEngine(engine: QwenVoiceEngine): Promise<void> {
	const rig = bridge();
	if (!rig?.setEngine) return;
	const inEffect = await rig.setEngine(engine);
	useVoiceEngineStore.setState({ engine: inEffect });
}
