/**
 * THE VOICE SWITCH AND ITS ENGINE: two values in one main-owned file.
 *
 * - `enabled`: one boolean, OFF by default, that main reads BEFORE it
 *   constructs or starts any voice machinery.
 * - `engine`: which engine hears and speaks (`local` | `byok`; see
 *   `QwenVoiceEngine`). Missing, unreadable, unknown, or the `radient`
 *   placeholder all mean `local`, so a profile from before the engine existed
 *   behaves exactly as it did.
 *
 * WHY A MAIN-OWNED FILE (not the backend's `settings_io`, not the renderer's
 * localStorage): the decision is needed synchronously at startup, before any
 * window or backend exists, and "off" has to mean the app does not even ask the
 * daemon about voice. The window-glass setting is the same shape for the same
 * reason. `features.voice` stays the server half (the daemon serves voice); this
 * is the person's half (this app may listen). Both must be true.
 *
 * A missing, unreadable or malformed file is OFF and LOCAL: the failure
 * direction is the private one, and no key or cloud engine is ever implied.
 * Each writer keeps the other's value: writing the switch must not forget the
 * engine, and writing the engine must not turn the switch on or off.
 */

import { join } from "node:path";
import {
	type QwenVoiceEngine,
	SELECTABLE_QWEN_VOICE_ENGINES,
} from "../../shared/desktop-contract";
import { readJson, writeJsonAtomic } from "../browser/atomic-json";

export const QWEN_VOICE_SETTING_FILE = "voice-setting.json";

type StoredSetting = { enabled?: unknown; engine?: unknown };

export function qwenVoiceSettingPath(userDataDir: string): string {
	return join(userDataDir, QWEN_VOICE_SETTING_FILE);
}

/** A value main will act on: only a SELECTABLE engine; never the placeholder. */
export function isSelectableEngine(value: unknown): value is QwenVoiceEngine {
	return (
		typeof value === "string" &&
		(SELECTABLE_QWEN_VOICE_ENGINES as readonly string[]).includes(value)
	);
}

function readStored(userDataDir: string): StoredSetting | null {
	return readJson<StoredSetting>(qwenVoiceSettingPath(userDataDir));
}

/** Synchronous; only an explicit stored `true` turns voice on. */
export function readQwenVoiceEnabled(userDataDir: string): boolean {
	return readStored(userDataDir)?.enabled === true;
}

/** Synchronous; anything but a stored selectable engine is `local`. */
export function readQwenVoiceEngine(userDataDir: string): QwenVoiceEngine {
	const engine = readStored(userDataDir)?.engine;
	return isSelectableEngine(engine) ? engine : "local";
}

export function writeQwenVoiceEnabled(
	userDataDir: string,
	enabled: boolean,
): boolean {
	return writeJsonAtomic(qwenVoiceSettingPath(userDataDir), {
		enabled,
		engine: readQwenVoiceEngine(userDataDir),
	});
}

/** Refuses (returns false) anything that is not a selectable engine. */
export function writeQwenVoiceEngine(
	userDataDir: string,
	engine: QwenVoiceEngine,
): boolean {
	if (!isSelectableEngine(engine)) return false;
	return writeJsonAtomic(qwenVoiceSettingPath(userDataDir), {
		enabled: readQwenVoiceEnabled(userDataDir),
		engine,
	});
}
