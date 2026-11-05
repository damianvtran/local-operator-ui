/**
 * The consent surface's write: one authenticated answer per verified action.
 *
 * WHY THIS HOOK EXISTS. A profile change is answered on the ORIGINATING
 * conversation's own approval channel: the descriptor's opaque `action_id` is the
 * `request_id` a gate answer names, and the answer is the same `sessions.answer`
 * the app already sends. Nothing here rebuilds a request from model arguments, and
 * nothing reads a command out of a tool result — the only inputs are the verified
 * descriptor and the conversation's own gate identity.
 *
 * THREE PROPERTIES THE REVIEW ROUND PINNED:
 *
 * 1. AUTHORITY IS CURRENT RUNTIME, NOT A PAYLOAD FLAG (R2). The caller decides
 *    whether a press may be offered (`revertAuthority`), from the running
 *    backend's registration and the conversation's session/epoch. A persisted
 *    `revert_verified: true` is a record of what some producer once verified; it
 *    is never proof this process can execute the action.
 * 2. A DUPLICATE IS STOPPED SYNCHRONOUSLY (QA1/Q1). `claim` is checked and taken
 *    before the request is built, so two presses in the same batch dispatch once.
 * 3. AN UNKNOWN OUTCOME IS NOT A FAILURE (R3/Q1). A transport error means the
 *    request may or may not have reached the backend: it resolves to
 *    `unconfirmed`, keeps the claim, and never re-offers the control. Only a
 *    refusal that positively names the record as stale/expired maps to `stale`.
 */
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useCallback, useEffect, useState } from "react";
import type { ProfileRevertDescriptor } from "../../../../../shared/profile-consent";
import { profileRevertLatch } from "./profile-revert-latch";
import {
	type ProfileRevertIdentity,
	type ProfileRevertStatusAnswer,
	profileRevertStatusCache,
	readProfileRevertStatus,
	readProfileRevertStatusFromTransport,
	runProfileRevertPress,
} from "./profile-revert-status";

export type ProfileRevertOutcome = {
	requestId: string;
	approved: boolean;
	/**
	 * The record's own state after the answer, or this app's own two words:
	 * `unconfirmed` (no answer arrived) and `stale` (a refusal said the action's
	 * window is over).
	 */
	state?: string;
};

export type ProfileRevertPress = {
	descriptor: ProfileRevertDescriptor;
	/** The conversation the descriptor was filed on; the card only exists there. */
	sessionId: string | null;
	/** The owner epoch that identifies the gate being answered. */
	ownerEpoch: string | null;
	/**
	 * The status seam's answer for THIS action (see `profile-revert-status.ts`).
	 * `null` — or anything but `available` — sends nothing: the seam is the only
	 * authority, and an absent answer is never permission.
	 */
	status: ProfileRevertStatusAnswer | null;
	/** The bound identity the status read was made for: same action, same call. */
	identity: ProfileRevertIdentity | null;
};

export function useProfileRevertAnswer(): {
	submitted: string | null;
	outcome: ProfileRevertOutcome | null;
	press: (input: ProfileRevertPress) => void;
} {
	const [submitted, setSubmitted] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<ProfileRevertOutcome | null>(null);

	const press = useCallback((input: ProfileRevertPress) => {
		const { descriptor, sessionId, ownerEpoch, status, identity } = input;
		/*
		 * THE SYNCHRONOUS CLAIM, before anything is built: React state is only true on
		 * the next paint, so the latch is what stops a second press in the same batch
		 * from sending an identical answer.
		 */
		if (!profileRevertLatch.claim(descriptor.action_id)) return;
		setSubmitted(descriptor.action_id);
		setOutcome(null);
		void (async () => {
			const answer = await runProfileRevertPress({
				descriptor,
				sessionId,
				epoch: ownerEpoch,
				status,
				identity,
				write: (request) =>
					desktopResult({
						op: "sessions.answer",
						sessionId: request.sessionId,
						epoch: request.epoch,
						requestId: request.requestId,
						approved: request.approved,
					}),
				readStatus: readProfileRevertStatusFromTransport,
			});
			/*
			 * THE ANSWER IS THE STATE, not the press's luck: a reconciled read decides
			 * whether the revert is pending, done, stale or refused. An uncertain
			 * activation therefore stays `pending`, never `failed`, and the control is
			 * not re-offered from here.
			 */
			setOutcome({
				requestId: descriptor.action_id,
				approved: answer.state === "succeeded",
				state: answer.state,
			});
		})();
	}, []);

	return { submitted, outcome, press };
}

/**
 * Read the status seam for one action, and keep the answer in the process cache.
 *
 * The effect is deliberately tiny: one read per action id, no polling. A control
 * whose status has not been read is `unavailable`, which is exactly what the
 * contract point in `profile-revert-status.ts` returns until core ships the read.
 */
export function useProfileRevertStatus(
	sessionId: string | null,
	identity: ProfileRevertIdentity | null,
): ProfileRevertStatusAnswer | null {
	const [answer, setAnswer] = useState<ProfileRevertStatusAnswer | null>(null);
	const actionId = identity?.action_id ?? null;
	useEffect(() => {
		if (!identity || !actionId) return;
		// Keyed on the whole bound identity, so another row or session cannot
		// inherit this answer (review R2.2).
		const cached = profileRevertStatusCache.read(sessionId, identity);
		if (cached) {
			setAnswer(cached);
			return;
		}
		let live = true;
		void readProfileRevertStatus(
			sessionId,
			identity,
			readProfileRevertStatusFromTransport,
		).then((next) => {
			if (!live) return;
			profileRevertStatusCache.remember(sessionId, identity, next);
			setAnswer(next);
		});
		return () => {
			live = false;
		};
	}, [identity, actionId, sessionId]);
	return answer;
}
