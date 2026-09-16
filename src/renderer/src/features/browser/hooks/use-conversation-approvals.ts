import { useMemo } from "react";
import {
	type ApprovalRequestInput,
	type ApprovalTabInput,
	requestsInScope,
	useApprovalQueue,
} from "../model/approval-queue-model";
import { useBrowserProjection } from "./use-browser-chrome";

/**
 * How many approvals THIS conversation is waiting on, for the chat header's Globe
 * trigger badge.
 * Design: docs/design/browser-approval-ux.md 5.1 (the badge's grammar), 7.2
 * (requests are scoped by requester), 7.3 (the trigger carries the badge).
 *
 * WHY THIS EXISTS SEPARATELY FROM THE PANE'S OWN MODEL, and why it is not simply
 * read off the pane: the trigger is in the chat header, which is mounted whether or
 * not the pane is, and the badge's whole job is to say "an agent in THIS
 * conversation is waiting on you" to a user who has not opened the pane. So the
 * count has to exist while the pane does not — and the pane's own instance of the
 * model goes away with the pane.
 *
 * IT IS THE SAME MODEL, NOT A SECOND COUNT. The liveness rule, the requester filter
 * and the clock are all the model's: this hook feeds it the projection filtered by
 * the same `requestsInScope` the surface uses, and asks it for `count`. That is what
 * keeps the badge and the tray from disagreeing — including the case spec 3.3
 * names, which became a real one here, because two consumers of this model can now
 * be mounted in one window at once (the clock they share lives in
 * `approval-queue-model.ts`).
 *
 * A DRAFT OWNS NO REQUESTS: with no session id the count is zero rather than every
 * request in the app. A chat whose header badge counted another conversation's
 * approval would be telling the user to answer a prompt that is not theirs.
 */

/** The requests a draft has: none, and one stable array so the model's effect —
 * which keys on this array's identity — does not re-run on every render. */
const NO_REQUESTS: ApprovalRequestInput[] = [];
/** The tabs the model reads for the strip's waiting chips. A count has no strip,
 * and this array is stable for the same reason as the one above. */
const NO_TABS: ApprovalTabInput[] = [];

export function useConversationApprovals(sessionId: string | null): number {
	const { state } = useBrowserProjection();
	const requests = state?.pendingConsent;
	const scoped = useMemo(
		() =>
			sessionId
				? requestsInScope(requests ?? NO_REQUESTS, { sessionId })
				: NO_REQUESTS,
		[requests, sessionId],
	);
	return useApprovalQueue(scoped, NO_TABS).count;
}
