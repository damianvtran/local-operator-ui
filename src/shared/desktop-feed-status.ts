import type { DesktopFeedFrame } from "./desktop-session-contract";

/** A connected socket alone cannot fence a rest receipt. Only its open frame
 * identifies the backend; a gap requires a fresh open, not another heartbeat.
 * The epoch names the process, not the socket: consumers still reset on every
 * open, including a reattach to the same process.
 */
export function desktopFeedEpochAfterFrame(
	epoch: string | undefined,
	frame: DesktopFeedFrame,
): string | undefined {
	if (frame.type === "open")
		return typeof frame.epoch === "string" && frame.epoch.length > 0
			? frame.epoch
			: undefined;
	return frame.type === "gap" || frame.epoch !== epoch ? undefined : epoch;
}
