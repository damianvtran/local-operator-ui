/**
 * What a right-slot pane says when its door was pressed where it cannot act yet
 * (the always-visible rail, D1/D3): pure functions from the route's facts to the
 * notice, so `chat-content` mounts one answer and a test can drive every branch
 * without a DOM.
 *
 * WHY HERE AND NOT IN THE COMPONENT. The rail's doors are present on every chat
 * route, so each pane that can be opened over "nothing to show" owes a sentence
 * for each reason it has nothing - and the reasons are facts the route already
 * holds (a conversation or not, a frame read or not, the backend's capability
 * state). Deciding the notice is a pure question; drawing it is
 * `SlotPaneNotice`'s.
 *
 * The run pane's strings are literal English because the run pane's own are
 * (`run-panel.tsx`); the code review pane's likewise (`code-review-pane.tsx`).
 */

import {
	backendLoadErrorMessage,
	backendPairingSentence,
} from "@shared/api/local-operator/backend-error";
import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import type { DaemonPairingCause } from "../../../../shared/backend-status";

export type SlotNotice = {
	/** Which state this is, on the element as `data-slot-pane-notice`. */
	kind: string;
	title: string;
	detail?: string;
};

export const RUN_NOTICE_DRAFT: SlotNotice = Object.freeze({
	kind: "run-draft",
	title: "Run details need a conversation",
	detail:
		"Subagents, the plan and scheduled work appear here once this conversation starts.",
});

export const RUN_NOTICE_READING: SlotNotice = Object.freeze({
	kind: "run-reading",
	title: "Reading this conversation's run…",
});

/**
 * The run pane's notice, for a slot with no run model to draw.
 *
 * `sessionId` decides which of the two absences this is: a draft has no run to
 * report until it starts, while a conversation whose frame has not been read yet
 * WILL have one - the second is a progress line, the first is not.
 */
export function runPaneNotice(
	sessionId: string | null | undefined,
): SlotNotice {
	return sessionId ? RUN_NOTICE_READING : RUN_NOTICE_DRAFT;
}

export const CODE_NOTICE_DRAFT: SlotNotice = Object.freeze({
	kind: "code-draft",
	title: "Code review needs a conversation",
	detail:
		"Pull requests and merge requests this conversation opens or mentions will appear here.",
});

export const CODE_NOTICE_BELOW_VERSION: SlotNotice = Object.freeze({
	kind: "code-below-version",
	title: "This backend doesn't serve code review.",
	detail:
		"Update the backend to see the pull requests and merge requests this conversation opens.",
});

export const CODE_NOTICE_CHECKING: SlotNotice = Object.freeze({
	kind: "code-checking",
	title: "Checking whether this backend serves code review…",
});

/** The lead `backendLoadErrorMessage` composes a failed capabilities read with. */
export const CODE_NOTICE_LOAD_LEAD = "Code review could not be loaded.";

/**
 * The code review pane's notice, or null when `CodeReviewPane` may mount.
 *
 * The pane - and with it the ledger's query - mounts ONLY on `enabled` with a
 * conversation, so a backend that predates `features.code_requests` is never
 * asked for routes it does not serve (D3: the door is always shown, the 404s are
 * not). The other states each say a different thing, because each is a different
 * fact:
 *
 * - a draft has no ledger yet, whatever the backend serves;
 * - `below-version` is durable and names its own remedy (the speech section's
 *   shape for the same condition);
 * - `unpaired` is a PAIRING fact and takes the shared table's sentence for the
 *   cause main published (`backendPairingSentence`, the seam every per-surface
 *   gate reads), so this pane cannot describe one daemon differently from the
 *   band above it;
 * - `unknown` is no answer YET while the read is in flight, and the read's own
 *   failure once it has failed - never "not answering" for a read still on its
 *   way.
 */
export function codeReviewPaneNotice(input: {
	sessionId: string | null | undefined;
	state: DesktopFeatureState;
	cause: DaemonPairingCause | null;
	/** The capabilities read's error, when it failed with no answer in hand. */
	loadError: unknown;
}): SlotNotice | null {
	if (!input.sessionId) return CODE_NOTICE_DRAFT;
	switch (input.state) {
		case "enabled":
			return null;
		case "below-version":
			return CODE_NOTICE_BELOW_VERSION;
		case "unpaired":
			return {
				kind: "code-unpaired",
				title:
					backendPairingSentence("unpaired", input.cause) ??
					CODE_NOTICE_LOAD_LEAD,
			};
		case "unknown":
			return input.loadError
				? {
						kind: "code-unreadable",
						title: backendLoadErrorMessage(
							CODE_NOTICE_LOAD_LEAD,
							input.loadError,
						),
					}
				: CODE_NOTICE_CHECKING;
	}
}
