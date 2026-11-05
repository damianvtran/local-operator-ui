/**
 * The profile-revert status seam: the ONE place this app may learn whether an
 * action can be pressed right now.
 *
 * WHY A SEAM RATHER THAN A ROUTE CALL. Core's gate is a LIVE action-registration
 * and status check: a persisted `revert_verified` in a tool result must never be
 * accepted as proof, because that text can be replayed by a reload, a restored
 * transcript, or an agent that wrote it. So the control's authority is a status
 * read for one exact action — and the route that answers it does not exist yet.
 * This module is that read's home and its contract point. Nothing else in the UI
 * may claim authority: no payload flag, no capability guess, no invented path.
 *
 * WHAT THIS ADAPTER ANSWERS TODAY: `unavailable`, for every identity, with the
 * reason below. That is the honest answer — this build cannot verify an action —
 * and it is why the control renders disabled with its reason instead of enabled.
 *
 * TODO(profile-revert-status contract point): core must supply ONE typed read
 * that answers this closed schema for an exact opaque action identity (action id,
 * receipt id, profile kind/name) — its exact route path, request shape and status
 * vocabulary. When it lands, the ONLY change here is the body of
 * `readProfileRevertStatus`: build the request, map the answer through
 * `profileRevertStatusSchema`, and return it. Callers, states and tests already
 * exist, so the wiring is one function body and no caller changes.
 *
 * WHAT THE ANSWER MEANS HERE:
 *   available   -> the press may be offered (status says the action is live);
 *   pending     -> an activation is in flight; stay latched, never re-offer;
 *   succeeded   -> the revert landed; a later press must make NO second write;
 *   stale       -> the action's window is over; nothing may be sent;
 *   failed      -> the backend answered a refusal; the control stays disabled
 *                  (an uncertain activation must never become failed+retryable);
 *   unavailable -> this build cannot verify the action at all.
 */

import { z } from "zod";

/** The closed status vocabulary of the seam. */
export const PROFILE_REVERT_STATUSES = [
	"available",
	"pending",
	"succeeded",
	"stale",
	"failed",
	"unavailable",
] as const;
export type ProfileRevertStatusWord = (typeof PROFILE_REVERT_STATUSES)[number];

/**
 * The exact identity a status read may be offered for: the opaque action id and
 * the record it belongs to. `receipt_id` ties it to the saved change; the kind and
 * name keep a stale id from naming another profile.
 */
export const profileRevertIdentitySchema = z
	.object({
		action_id: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[A-Za-z0-9_-]+$/),
		receipt_id: z.string().min(1).max(160),
		profile_kind: z.enum(["agent", "team"]),
		profile_name: z.string().min(1).max(128),
	})
	.strict();
export type ProfileRevertIdentity = z.infer<typeof profileRevertIdentitySchema>;

/** The answer's closed schema (`extra: forbid` on the backend side as well). */
export const profileRevertStatusSchema = z
	.object({
		status: z.enum(PROFILE_REVERT_STATUSES),
		/** An authored sentence core may send with a refusal; shown verbatim. */
		reason: z.string().max(2000).optional(),
	})
	.strict();
export type ProfileRevertStatusAnswer = z.infer<
	typeof profileRevertStatusSchema
>;

/** Why the adapter answers `unavailable` until the contract point is filled. */
export const PROFILE_REVERT_STATUS_UNVERIFIABLE =
	"This build cannot verify a revert action yet";

/*
 * THE ADAPTER — the only authority the revert control may consult.
 *
 * Deliberately not a React hook: a status read is a fact about an action, not
 * about a component, and keeping it plain is what lets the states be tested
 * without a renderer. It never throws: an unreadable answer IS `unavailable`.
 */
export async function readProfileRevertStatus(
	identity: ProfileRevertIdentity,
): Promise<ProfileRevertStatusAnswer> {
	const parsed = profileRevertIdentitySchema.safeParse(identity);
	if (!parsed.success)
		return {
			status: "unavailable",
			reason: PROFILE_REVERT_STATUS_UNVERIFIABLE,
		};
	/*
	 * No route exists to answer for `parsed.data` yet — see the contract point in
	 * this module's header. The refusal is the truthful state, not a placeholder
	 * that happens to be safe: an action cannot be verified by this build, so it
	 * cannot be pressed.
	 */
	return { status: "unavailable", reason: PROFILE_REVERT_STATUS_UNVERIFIABLE };
}

/**
 * Answers already learned about an action id, in this process.
 *
 * WHY A CACHE IS PART OF THE SAFETY, not an optimisation: a press that has
 * succeeded must make NO second write, and a press in flight must not be sent
 * again. Remembering the answer is what lets a second press be refused without
 * re-reading anything (and the latch covers the same-batch case the cache cannot
 * see yet).
 */
const answers = new Map<string, ProfileRevertStatusAnswer>();

export const profileRevertStatusCache = {
	read(actionId: string): ProfileRevertStatusAnswer | null {
		return answers.get(actionId) ?? null;
	},
	remember(actionId: string, answer: ProfileRevertStatusAnswer): void {
		const parsed = profileRevertStatusSchema.safeParse(answer);
		if (!parsed.success) return;
		answers.set(actionId, parsed.data);
	},
	forget(actionId: string): void {
		answers.delete(actionId);
	},
	/** Tests only: a process cache must not leak between cases. */
	clear(): void {
		answers.clear();
	},
};

/**
 * Whether a press may be sent for this action, given the answer we hold.
 *
 * `false` covers BOTH "we already did this" (`succeeded`) and "one is running"
 * (`pending`) and "the window is over" (`stale`) — the three cases where a second
 * write would be wrong — as well as the unverifiable case. Only a live
 * `available` answer permits a press.
 */
export function profileRevertPressAllowed(
	answer: ProfileRevertStatusAnswer | null,
): boolean {
	return answer?.status === "available";
}

/**
 * The control's state from the seam's answer.
 *
 * NOTE THE ASYMMETRY, which is the point: `failed` from a status read leaves the
 * control DISABLED. A status read is not an answer to this press, so re-offering
 * the control would be an auto-retry of something we cannot prove is retryable.
 */
export function profileRevertAuthority(
	answer: ProfileRevertStatusAnswer | null,
): {
	state: "available" | "pending" | "saved" | "stale" | "failed" | "unavailable";
	enabled: boolean;
} {
	switch (answer?.status) {
		case "available":
			return { state: "available", enabled: true };
		case "pending":
			return { state: "pending", enabled: false };
		case "succeeded":
			return { state: "saved", enabled: false };
		case "stale":
			return { state: "stale", enabled: false };
		case "failed":
			return { state: "failed", enabled: false };
		default:
			return { state: "unavailable", enabled: false };
	}
}
