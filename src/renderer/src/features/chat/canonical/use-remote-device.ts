import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { remoteDeviceLabel } from "../chat-remote";

/**
 * The device a PEER-held session lives on, as every remote surface names it,
 * or `null` for a local session (or one the catalogue has not carried yet).
 *
 * The transcript's waiting and offline states name the device (UX round 1,
 * U1-1/U1-6) and the attachment scope carries only ids, so the name is read
 * from the catalogue row through `remoteDeviceLabel` - the header chip's rule -
 * so one device is never named two ways.
 */
export function useRemoteSessionDevice(
	sessionId: string | null | undefined,
): string | null {
	return useCanonicalSessionsStore((state) => {
		if (!sessionId) return null;
		const row = state.sessions.find((entry) => entry.session_id === sessionId);
		if (!row || row.locality !== "remote") return null;
		return remoteDeviceLabel(row);
	});
}
