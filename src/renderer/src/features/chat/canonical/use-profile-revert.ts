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
import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { useCallback, useEffect, useState } from "react";
import type { ProfileRevertDescriptor } from "../../../../../shared/profile-consent";
import { profileRevertLatch } from "./profile-revert-latch";
import {
	type ProfileRevertStatusAnswer,
	profileRevertStatusCache,
	readProfileRevertStatus,
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
	status: { status: string } | null;
};

/** A refusal that positively says the action's window is over. */
const STALE_CODES = /(expired|stale|not_found|already_answered|window)/i;

function refusalState(error: unknown): string | undefined {
	if (!(error instanceof DesktopControlError)) return undefined;
	const code = error.code ?? "";
	if (STALE_CODES.test(code)) return "stale";
	return undefined;
}

export function useProfileRevertAnswer(): {
	submitted: string | null;
	outcome: ProfileRevertOutcome | null;
	press: (input: ProfileRevertPress) => void;
} {
	const [submitted, setSubmitted] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<ProfileRevertOutcome | null>(null);

	const press = useCallback((input: ProfileRevertPress) => {
		const { descriptor, sessionId, ownerEpoch, status } = input;
		// No live status for this action, or no gate identity: nothing is sent.
		if (status?.status !== "available" || !sessionId || !ownerEpoch) return;
		/* A cached completion means this action is already done: no second write. */
		if (profileRevertStatusCache.read(descriptor.action_id)) return;
		/*
		 * THE SYNCHRONOUS CLAIM. React state (`submitted`) is only true on the next
		 * paint, so the latch is what stops a second press in the same batch.
		 */
		if (!profileRevertLatch.claim(descriptor.action_id)) return;
		setSubmitted(descriptor.action_id);
		setOutcome(null);
		// Optimistically remember the in-flight answer so a sibling press is refused
		// even before any response exists.
		profileRevertStatusCache.remember(descriptor.action_id, {
			status: "pending",
		});
		void desktopResult({
			op: "sessions.answer",
			sessionId,
			epoch: ownerEpoch,
			requestId: descriptor.action_id,
			approved: true,
		})
			.then(() => {
				profileRevertStatusCache.remember(descriptor.action_id, {
					status: "succeeded",
				});
				setOutcome({
					requestId: descriptor.action_id,
					approved: true,
					state: "applied",
				});
			})
			.catch((error: unknown) => {
				/*
				 * A NAMED STALE REFUSAL IS KNOWABLE; everything else is unknown. The
				 * old code called every error `failed`, which both claimed a fact it
				 * did not have and re-armed the control over a change that may already
				 * be undone.
				 */
				const state = refusalState(error);
				/*
				 * An uncertain activation stays PENDING in the status cache until the seam
				 * reconciles it: `unconfirmed` is not a completion, and it must never be
				 * remembered as one.
				 */
				if (state === "stale")
					profileRevertStatusCache.remember(descriptor.action_id, {
						status: "stale",
					});
				setOutcome({
					requestId: descriptor.action_id,
					approved: false,
					state: state ?? "unconfirmed",
				});
			});
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
	identity: {
		action_id: string;
		receipt_id: string;
		profile_kind: "agent" | "team";
		profile_name: string;
	} | null,
): ProfileRevertStatusAnswer | null {
	const [answer, setAnswer] = useState<ProfileRevertStatusAnswer | null>(null);
	const actionId = identity?.action_id ?? null;
	useEffect(() => {
		if (!identity || !actionId) return;
		const cached = profileRevertStatusCache.read(actionId);
		if (cached) {
			setAnswer(cached);
			return;
		}
		let live = true;
		void readProfileRevertStatus(identity).then((next) => {
			if (!live) return;
			profileRevertStatusCache.remember(actionId, next);
			setAnswer(next);
		});
		return () => {
			live = false;
		};
	}, [identity, actionId]);
	return answer;
}
