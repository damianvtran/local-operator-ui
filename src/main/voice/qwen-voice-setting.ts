/**
 * THE VOICE SWITCH: one boolean, OFF by default, that main reads BEFORE it
 * constructs or starts any voice machinery.
 *
 * WHY A MAIN-OWNED FILE (not the backend's `settings_io`, not the renderer's
 * localStorage): the decision is needed synchronously at startup, before any
 * window or backend exists, and "off" has to mean the app does not even ask the
 * daemon about voice. The window-glass setting is the same shape for the same
 * reason. `features.voice` stays the server half (the daemon serves voice); this
 * is the person's half (this app may listen). Both must be true.
 *
 * A missing, unreadable or malformed file is OFF: the failure direction is the
 * private one.
 */

import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../browser/atomic-json";

export const QWEN_VOICE_SETTING_FILE = "voice-setting.json";

export function qwenVoiceSettingPath(userDataDir: string): string {
	return join(userDataDir, QWEN_VOICE_SETTING_FILE);
}

/** Synchronous; only an explicit stored `true` turns voice on. */
export function readQwenVoiceEnabled(userDataDir: string): boolean {
	return (
		readJson<{ enabled?: unknown }>(qwenVoiceSettingPath(userDataDir))
			?.enabled === true
	);
}

export function writeQwenVoiceEnabled(
	userDataDir: string,
	enabled: boolean,
): boolean {
	return writeJsonAtomic(qwenVoiceSettingPath(userDataDir), { enabled });
}
