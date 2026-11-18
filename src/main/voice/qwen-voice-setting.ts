/**
 * THE VOICE SWITCH: one boolean in a main-owned file.
 *
 * - `enabled`: OFF by default, read by main BEFORE it constructs or starts any
 *   voice machinery.
 *
 * WHICH PROVIDER HEARS AND SPEAKS IS NOT HERE. The person's choice is the
 * daemon's `speech.provider` setting (Settings > Speech), read through
 * `voice.status`; this file never holds it. An `engine` key an earlier build
 * wrote into this file is ignored on read and dropped on the next write - it
 * decides nothing, and in particular can never start the local Qwen rig.
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

type StoredSetting = { enabled?: unknown };

export function qwenVoiceSettingPath(userDataDir: string): string {
	return join(userDataDir, QWEN_VOICE_SETTING_FILE);
}

function readStored(userDataDir: string): StoredSetting | null {
	return readJson<StoredSetting>(qwenVoiceSettingPath(userDataDir));
}

/** Synchronous; only an explicit stored `true` turns voice on. */
export function readQwenVoiceEnabled(userDataDir: string): boolean {
	return readStored(userDataDir)?.enabled === true;
}

export function writeQwenVoiceEnabled(
	userDataDir: string,
	enabled: boolean,
): boolean {
	return writeJsonAtomic(qwenVoiceSettingPath(userDataDir), { enabled });
}
