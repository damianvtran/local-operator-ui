/**
 * Opt-in message timestamps in the desktop transcript, and the pure rules that
 * decide whether and how they are painted.
 *
 * Two BACKEND registry keys (frozen wire contract, `local_operator/settings_io.py`):
 * `display.message_timestamps` (bool, default false) and
 * `display.message_timestamp_style` (`absolute` | `relative`, default
 * `absolute`, gated by the first). Both are rendered generically by the
 * Settings page and read here fail-closed, exactly as `turn-answer-rail.ts`
 * reads its key: only an explicit `true` turns stamps on; anything else (an
 * older backend without the key, an unanswered or failed query, a plane that
 * does not advertise `settings`) is OFF and `absolute`.
 *
 * No React and no query here, so `scripts/message-timestamps.test.mjs` can
 * bundle and assert the rules without a DOM.
 */

export const MESSAGE_TIMESTAMPS_KEY = "display.message_timestamps";
export const MESSAGE_TIMESTAMP_STYLE_KEY = "display.message_timestamp_style";

export type MessageTimestampStyle = "absolute" | "relative";

export type MessageTimestamps = {
	enabled: boolean;
	style: MessageTimestampStyle;
};

/** What every transcript read before the setting existed. */
export const MESSAGE_TIMESTAMPS_OFF: MessageTimestamps = {
	enabled: false,
	style: "absolute",
};

/** Only the exact string `relative` selects relative; anything else is absolute. */
export function parseMessageTimestampStyle(
	value: unknown,
): MessageTimestampStyle {
	return value === "relative" ? "relative" : "absolute";
}

export function messageTimestampsEnabled(
	settings: ReadonlyArray<{ key: string; value?: unknown }> | null | undefined,
): boolean {
	return (
		settings?.find((entry) => entry.key === MESSAGE_TIMESTAMPS_KEY)?.value ===
		true
	);
}

export function messageTimestampStyle(
	settings: ReadonlyArray<{ key: string; value?: unknown }> | null | undefined,
): MessageTimestampStyle {
	return parseMessageTimestampStyle(
		settings?.find((entry) => entry.key === MESSAGE_TIMESTAMP_STYLE_KEY)?.value,
	);
}
