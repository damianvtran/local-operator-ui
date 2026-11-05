/**
 * The live profile-action status read: the SOLE authority for enabling a Revert.
 *
 * WHY A LIVE READ AND NOT A FLAG. Core's revert gate is an action-registration and
 * status check. A saved card's tool result may carry `revert_verified: true`, but
 * that text can be replayed by a reload, a restored transcript, or an agent that
 * wrote it — so it is EVIDENCE, never authority. Only a FRESH answer for this
 * exact action, bound to the row's own tool call, can enable the control.
 *
 * THE REQUEST. One allowlisted, read-only, authenticated session-control op
 * (`sessions.profileActionStatus` in `desktop-contract.ts`) whose body is exactly
 * `{action_id, receipt_id, profile_kind, profile_name, tool_call_id}`. The session
 * comes from the session-control transport, never from this body.
 *
 * THE ANSWER. Exactly `{action_id, state}` with `state` in the closed vocabulary
 * below. Anything else — an extra field, a missing id, an unknown state — is a
 * REFUSAL, and a refusal is `unavailable` (never a guess in either direction).
 *
 * NO LIVE CLAIM: core's route and the `profile_save` kind's revert registration are
 * not committed yet, so every read below goes through the ordinary desktop
 * transport and will be refused by this build's own validation or by a backend
 * that does not serve it. The control therefore renders `unavailable` with its
 * reason, and nothing here asserts a working revert.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { z } from "zod";

/** The closed status vocabulary. */
export const PROFILE_REVERT_STATUSES = [
	"available",
	"pending",
	"succeeded",
	"stale",
	"failed",
	"unavailable",
] as const;
export type ProfileRevertStatusWord = (typeof PROFILE_REVERT_STATUSES)[number];

/** The exact identity a status read is offered for. */
export const profileRevertIdentitySchema = z
	.object({
		/*
		 * THE FROZEN MINT, in the identity too (review R2.8): the same
		 * `^prv_[A-Za-z0-9_-]{32}$` core mints, so an id this app would offer a
		 * status read for is one core can actually resolve.
		 */
		action_id: z.string().regex(/^prv_[A-Za-z0-9_-]{32}$/),
		receipt_id: z.string().min(1).max(160),
		profile_kind: z.enum(["agent", "team"]),
		profile_name: z.string().min(1).max(128),
		/** The call whose card asked. Bound so an answer cannot land on another row. */
		tool_call_id: z.string().min(1).max(160),
	})
	.strict();
export type ProfileRevertIdentity = z.infer<typeof profileRevertIdentitySchema>;

/** The answer's closed schema: exactly two keys, `extra: forbid` on core's side too. */
export const profileRevertStatusSchema = z
	.object({
		action_id: z.string().regex(/^prv_[A-Za-z0-9_-]{32}$/),
		state: z.enum(PROFILE_REVERT_STATUSES),
	})
	.strict();
export type ProfileRevertStatusAnswer = z.infer<
	typeof profileRevertStatusSchema
>;

/** Why a control is unavailable when no successful read stands behind it. */
export const PROFILE_REVERT_STATUS_UNVERIFIABLE =
	"This build cannot verify a revert action yet";

/** A transport the seam reads through; injectable so the states are testable. */
export type ProfileRevertStatusTransport = (input: {
	sessionId: string;
	identity: ProfileRevertIdentity;
}) => Promise<unknown>;

const desktopTransport: ProfileRevertStatusTransport = async ({
	sessionId,
	identity,
}) =>
	desktopResult({
		op: "sessions.profileActionStatus",
		sessionId,
		actionId: identity.action_id,
		receiptId: identity.receipt_id,
		profileKind: identity.profile_kind,
		profileName: identity.profile_name,
		toolCallId: identity.tool_call_id,
	});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Core answers a status read with the EXISTING acknowledgment frame —
 * `{op: "ack", req, detail: {action_id, state}}` — rather than a new result
 * envelope, so the value has to be unwrapped before the closed two-key schema
 * sees it (review R2.7). Only an `op: "ack"` frame carrying an OBJECT `detail` is
 * unwrapped; anything else is returned untouched and refused by the schema.
 *
 * WHY A STRING `detail` IS NEVER PARSED: a string there is a refusal, and
 * `JSON.parse`ing it would let a refusal re-enter as a status this build believed.
 */
function unwrapStatusPayload(payload: unknown): unknown {
	if (!isRecord(payload) || !("detail" in payload)) return payload;
	if (payload.op !== "ack") return payload;
	return payload.detail;
}

/**
 * Read the live status for one action.
 *
 * FAIL-CLOSED, ALWAYS: a malformed identity, a transport refusal, a response that
 * fails the closed schema (an extra field included) or an `action_id` that is not
 * the one we asked about all resolve to `unavailable`. It never throws and never
 * returns a state the caller could mistake for permission.
 */
export async function readProfileRevertStatus(
	sessionId: string | null,
	identity: unknown,
	read: (input: {
		sessionId: string;
		identity: ProfileRevertIdentity;
	}) => Promise<unknown> = readProfileRevertStatusFromTransport,
): Promise<ProfileRevertStatusAnswer> {
	const parsed = profileRevertIdentitySchema.safeParse(identity);
	if (!parsed.success || !sessionId)
		return { action_id: "", state: "unavailable" };
	let payload: unknown;
	try {
		payload = await read({ sessionId, identity: parsed.data });
	} catch {
		return { action_id: parsed.data.action_id, state: "unavailable" };
	}
	const answer = profileRevertStatusSchema.safeParse(
		unwrapStatusPayload(payload),
	);
	// The answer must be for THIS action, or it answers nothing.
	if (!answer.success || answer.data.action_id !== parsed.data.action_id)
		return { action_id: parsed.data.action_id, state: "unavailable" };
	return answer.data;
}

/** The default read: the app's ordinary desktop transport. */
export async function readProfileRevertStatusFromTransport(input: {
	sessionId: string;
	identity: ProfileRevertIdentity;
}): Promise<unknown> {
	return desktopTransport(input);
}

/**
 * Whether a press may be sent, given the answer we hold.
 *
 * Only a live `available` permits a write. `pending` (one is running), `succeeded`
 * (already done — no second write), `stale` (window over), `failed` and
 * `unavailable` all refuse, so a duplicate can never be a second revert.
 */
export function profileRevertPressAllowed(
	answer: ProfileRevertStatusAnswer | null,
): boolean {
	return answer?.state === "available";
}

/**
 * The control's own state from a status answer.
 *
 * NOTE THE ASYMMETRY, deliberately: a status-read `failed` leaves the control
 * DISABLED. It is not an answer to this press, so re-offering the control would be
 * an auto-retry of something we cannot prove is retryable.
 */
export function profileRevertAuthority(
	answer: ProfileRevertStatusAnswer | null,
): {
	state: "available" | "pending" | "saved" | "stale" | "failed" | "unavailable";
	enabled: boolean;
} {
	switch (answer?.state) {
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

/**
 * The cache's key is the WHOLE identity a read was offered for, session included.
 *
 * Keyed by action id alone, a second conversation or another row's card inherited
 * the first one's answer — an `available` included — without any read of its own
 * (review R2.2). An action is answered on the originating conversation's gate, so
 * the session belongs in the key beside the receipt and the tool call.
 */
function identityKey(
	sessionId: string | null,
	identity: ProfileRevertIdentity,
): string {
	return [
		sessionId ?? "",
		identity.action_id,
		identity.receipt_id,
		identity.profile_kind,
		identity.profile_name,
		identity.tool_call_id,
	].join("\u0000");
}

/** Out-of-process cache of the last answer per bound identity, so a press can refuse twice. */
const answers = new Map<string, ProfileRevertStatusAnswer>();

export const profileRevertStatusCache = {
	read(
		sessionId: string | null,
		identity: unknown,
	): ProfileRevertStatusAnswer | null {
		const parsed = profileRevertIdentitySchema.safeParse(identity);
		if (!parsed.success) return null;
		return answers.get(identityKey(sessionId, parsed.data)) ?? null;
	},
	remember(
		sessionId: string | null,
		identity: unknown,
		answer: ProfileRevertStatusAnswer,
	): void {
		const parsedIdentity = profileRevertIdentitySchema.safeParse(identity);
		const parsedAnswer = profileRevertStatusSchema.safeParse(answer);
		if (!parsedIdentity.success || !parsedAnswer.success) return;
		// An answer for another action is not an answer about this one.
		if (parsedAnswer.data.action_id !== parsedIdentity.data.action_id) return;
		answers.set(identityKey(sessionId, parsedIdentity.data), parsedAnswer.data);
	},
	clear(): void {
		answers.clear();
	},
};

/**
 * ONE press, end to end — the whole activation as a pure async step.
 *
 * WHY THIS IS A FUNCTION AND NOT ONLY A HOOK. The three properties the review and
 * QA rounds demanded are orderings, not renderings: the write happens once, an
 * uncertain outcome is reconciled with a FRESH status read, and a completion makes
 * a later press write nothing. Expressing them here makes each one testable with a
 * fake transport and a counting writer, instead of only through a renderer.
 */
export async function runProfileRevertPress(input: {
	descriptor: { action_id: string };
	sessionId: string | null;
	epoch: string | null;
	status: ProfileRevertStatusAnswer | null;
	identity: ProfileRevertIdentity | null;
	write: (request: {
		sessionId: string;
		epoch: string;
		requestId: string;
		approved: true;
	}) => Promise<unknown>;
	readStatus: (input: {
		sessionId: string;
		identity: ProfileRevertIdentity;
	}) => Promise<unknown>;
}): Promise<ProfileRevertStatusAnswer> {
	const refuse = (
		state: ProfileRevertStatusWord,
	): ProfileRevertStatusAnswer => ({
		action_id: input.descriptor.action_id,
		state,
	});
	/*
	 * ONLY A COMPLETION IS A DUPLICATE (review R2.1 / QA Q2.2). The cache used to
	 * short-circuit ANY remembered answer — including an `available` — to
	 * `succeeded` with no write and no read, so the very first press reported a
	 * completion it had never performed. A remembered status word is a record of an
	 * earlier read, not proof the action finished: only `succeeded` ends the press
	 * here, and everything else is re-read below.
	 */
	const cached = profileRevertStatusCache.read(input.sessionId, input.identity);
	if (cached?.state === "succeeded") return cached;
	// No live permission, no gate identity or no bound identity: nothing is sent.
	if (!profileRevertPressAllowed(input.status))
		return input.status ?? refuse("unavailable");
	if (!input.sessionId || !input.epoch || !input.identity)
		return refuse("unavailable");
	/*
	 * A FRESH READ BEFORE THE WRITE (review R2.1). The answer the card holds was
	 * read when the control was drawn and may since have expired, been answered on
	 * another surface, or lost to a restart; nothing is dispatched on a stale
	 * permission. This read, then the outcome read below, are the press's two
	 * authority points — one to authorise, one to learn what happened.
	 */
	const live = await readProfileRevertStatus(
		input.sessionId,
		input.identity,
		input.readStatus,
	);
	if (live.state !== "available") {
		profileRevertStatusCache.remember(input.sessionId, input.identity, live);
		return live;
	}
	try {
		await input.write({
			sessionId: input.sessionId,
			epoch: input.epoch,
			requestId: input.descriptor.action_id,
			approved: true,
		});
	} catch {
		/*
		 * AN UNCERTAIN ACTIVATION STAYS PENDING and is reconciled by a FRESH read: the
		 * request may have landed, so it is never `failed`, never re-enabled and never
		 * retried from here.
		 */
		const reconciled = await readProfileRevertStatus(
			input.sessionId,
			input.identity,
			input.readStatus,
		);
		const answer =
			reconciled.state === "unavailable" ? refuse("pending") : reconciled;
		profileRevertStatusCache.remember(input.sessionId, input.identity, answer);
		return answer;
	}
	const after = await readProfileRevertStatus(
		input.sessionId,
		input.identity,
		input.readStatus,
	);
	const answer = after.state === "unavailable" ? refuse("pending") : after;
	profileRevertStatusCache.remember(input.sessionId, input.identity, answer);
	return answer;
}
