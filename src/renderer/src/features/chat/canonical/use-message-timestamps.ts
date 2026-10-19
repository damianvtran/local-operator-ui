import { useMemo } from "react";
import {
	MESSAGE_TIMESTAMPS_KEY,
	MESSAGE_TIMESTAMPS_OFF,
	MESSAGE_TIMESTAMP_STYLE_KEY,
	type MessageTimestamps,
} from "./message-timestamps";
import { useDisplayChoice, useDisplayFlag } from "./use-display-flag";

/**
 * The desktop transcript's read of the two message-timestamp keys, over the
 * same shared registry read as `useTurnAnswerRail`. FAIL-CLOSED on both planes:
 * a denied or failed plane is off whatever is cached or seeded. A `pending`
 * reading (last known ON, answer still owed) paints ON, as the rail does - the
 * stamp lives in a line whose height is reserved either way, so painting and
 * retracting it moves nothing.
 */
export function useMessageTimestamps(): MessageTimestamps {
	const flag = useDisplayFlag(MESSAGE_TIMESTAMPS_KEY);
	const style = useDisplayChoice(MESSAGE_TIMESTAMP_STYLE_KEY);
	const denied = flag.plane === "denied" || flag.plane === "failed";
	const enabled = !denied && flag.reading !== "off";
	return useMemo(
		() =>
			enabled
				? {
						enabled: true,
						style: style === "relative" ? "relative" : "absolute",
					}
				: MESSAGE_TIMESTAMPS_OFF,
		[enabled, style],
	);
}
