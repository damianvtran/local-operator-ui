/**
 * The saved card's one press: an ordinary authenticated approval answer.
 *
 * WHY A HOOK AND NOT A NEW DESKTOP ROUTE. A revert is a backend-verified action
 * carried on the ORIGINATING conversation's own approval channel: the descriptor's
 * opaque `action_id` is the `request_id` the answer names, and the answer is the
 * same `sessions.answer` the app already sends for a gate. Nothing here rebuilds a
 * request from model arguments, and nothing reads a command out of a tool result:
 * the only input is the verified descriptor.
 *
 * THE LATCH IS THE SAFETY PROPERTY. Once a press is dispatched the same action id
 * cannot be sent again from this row, and an answer that landed cannot be un-sent;
 * so the hook remembers the id it sent (`submitted`) and the outcome it learned
 * (`outcome`), and the view resolves both before it would consider offering the
 * control again (`profileRevertState`). A transport failure is `unconfirmed`, which
 * also does not re-enable: an unknown is not a failed send.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCallback, useState } from "react";
import type { ProfileRevertDescriptor } from "../../../../../shared/profile-consent";

export type ProfileRevertOutcome = {
	requestId: string;
	approved: boolean;
	/**
	 * The answered record's own state, when the answer carried one. `unconfirmed`
	 * is this hook's own word for "the request may or may not have landed" — never
	 * a claim that it failed.
	 */
	state?: string;
};

export type ProfileRevertPress = {
	descriptor: ProfileRevertDescriptor;
	/** The conversation the descriptor was filed on; the card only exists there. */
	sessionId: string | null;
	/** The owner epoch that identifies the gate being answered. */
	ownerEpoch: string | null;
};

export function useProfileRevertAnswer(): {
	submitted: string | null;
	outcome: ProfileRevertOutcome | null;
	press: (input: ProfileRevertPress) => void;
} {
	const [submitted, setSubmitted] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<ProfileRevertOutcome | null>(null);

	const press = useCallback(
		(input: ProfileRevertPress) => {
			const { descriptor, sessionId, ownerEpoch } = input;
			// A press with no gate identity answers nothing, so nothing is sent.
			if (!sessionId || !ownerEpoch) return;
			if (submitted === descriptor.action_id) return;
			setSubmitted(descriptor.action_id);
			setOutcome(null);
			void desktopResult({
				op: "sessions.answer",
				sessionId,
				epoch: ownerEpoch,
				requestId: descriptor.action_id,
				approved: true,
			})
				.then(() => {
					setOutcome({
						requestId: descriptor.action_id,
						approved: true,
						state: "applied",
					});
				})
				.catch(() => {
					// NOT a refusal: the press may have landed. `unconfirmed` keeps the
					// control latched, because inviting a second press would be inviting a
					// duplicate revert of a change that is already undone.
					setOutcome({
						requestId: descriptor.action_id,
						approved: false,
						state: "unconfirmed",
					});
				});
		},
		[submitted],
	);

	return { submitted, outcome, press };
}
