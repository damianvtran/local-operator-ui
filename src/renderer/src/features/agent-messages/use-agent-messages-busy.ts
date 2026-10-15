import {
	useWebauthnEnding,
	useWebauthnRequests,
} from "@shared/browser-webauthn-queue";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";

/**
 * The §5.3 busy rule for the agent-messages on-ramp, in ONE place.
 *
 * A natural-boundary check that lands while any of these holds must WAIT for
 * the next boundary; the model latches that decision (`armBoundary`) and this
 * hook is the fact it reads:
 *
 * - a composer draft is STAGED (`activeDraftKey`) - a new, not-yet-created
 *   conversation;
 * - the DISPLAYED conversation has unsent text: `currentInput` (keystrokes) or
 *   `pendingText` (a returned message waiting to be adopted - it is the user's
 *   words). Mirrors the ask policy's boolean selector
 *   (`use-ask-open-policy.ts`) so a keystroke re-renders only when the empty
 *   flag flips, and reads the store the composer actually writes through;
 * - the displayed conversation has a turn in flight - "busy" is the app's own
 *   one code for that fact (the row spinner and the rail mark read the same);
 * - an archive confirmation is open (`archiveCandidate`, only while the
 *   archive capability mounts that dialog);
 * - a passkey chooser is open - the queue's live requests, OR the
 *   acknowledgement an unattended settlement leaves behind: it keeps the same
 *   modal open until dismissed (round-2 R3 - there is no timed lifetime, so
 *   the queue length alone would miss an open modal).
 */
export function useAgentMessagesBusy(input: {
	displayedSessionId: string | null | undefined;
	archiveEnabled: boolean;
}): boolean {
	const { displayedSessionId, archiveEnabled } = input;
	const canonicalBusy = useCanonicalSessionsStore((state) => {
		if (state.activeDraftKey !== null) return true;
		if (archiveEnabled && state.archiveCandidate !== null) return true;
		if (!displayedSessionId) return false;
		return state.sessions.some(
			(row) =>
				row.session_id === displayedSessionId && row.status?.code === "busy",
		);
	});
	const composerBusy = useConversationInputStore((state) => {
		if (!displayedSessionId) return false;
		const row = state.inputByConversation[displayedSessionId];
		return (
			(row?.currentInput ?? "").trim() !== "" ||
			(row?.pendingText ?? "").trim() !== ""
		);
	});
	const webauthnRequests = useWebauthnRequests();
	const webauthnEnding = useWebauthnEnding();
	return (
		canonicalBusy ||
		composerBusy ||
		webauthnRequests.length > 0 ||
		webauthnEnding !== null
	);
}
