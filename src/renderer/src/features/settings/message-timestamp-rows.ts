import type { BackendSetting } from "@shared/api/local-operator/desktop-api";

/**
 * The two registry rows Settings > Appearance renders for message timestamps,
 * selected BY KEY from the same `settings.list` projection the Backend section
 * reads (the speech-voicing precedent, `speech-settings-model.ts`). The keys are
 * the frozen wire contract; the master switch comes first because the style row
 * is gated by it.
 */
export const MESSAGE_TIMESTAMP_ROW_KEYS = [
	"display.message_timestamps",
	"display.message_timestamp_style",
] as const;

/**
 * The rows the registry carries, in contract order. A backend that predates the
 * keys yields an empty list and the Appearance section simply shows nothing
 * (the transcript reads the same absence as OFF).
 */
export function messageTimestampRows(
	settings: readonly BackendSetting[],
): BackendSetting[] {
	const byKey = new Map(settings.map((setting) => [setting.key, setting]));
	const rows: BackendSetting[] = [];
	for (const key of MESSAGE_TIMESTAMP_ROW_KEYS) {
		const row = byKey.get(key);
		if (row) rows.push(row);
	}
	return rows;
}
